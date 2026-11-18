import { BUSINESS_CASH_POLICIES } from "@interests/rules";
import type { AssetId, LoanId, PlayerId } from "@interests/shared";
import type {
  BusinessAsset,
  BusinessQuarterBasis,
  FinanceState,
  Loan,
} from "../model/gameState";
import {
  businessCashAccount,
  externalCashAccount,
  playerCashAccount,
} from "./account";
import { allocateWeightedCents } from "./allocation";
import { calculateBusinessEquity } from "./business";
import { FinanceDecimal } from "./decimal";
import { type Cents, cents } from "./money";
import {
  applyLoanPaymentAllocation,
  calculateLoanObligation,
  type LoanPaymentOutcome,
} from "./obligations";
import { allocateProportionalCents } from "./ownership";
import type { CashPostingRequest } from "./posting";

export interface BusinessSettlementOutcome {
  readonly assetId: AssetId;
  readonly openingCashCents: Cents;
  readonly openingOperatingArrearsCents: Cents;
  readonly operatingCashCents: Cents;
  readonly operatingDueCents: Cents;
  readonly operatingPaidCents: Cents;
  readonly closingOperatingArrearsCents: Cents;
  readonly retainedFromSurplusCents: Cents;
  readonly closingCashCents: Cents;
  readonly cashBeforeCompensationCents?: Cents;
  readonly managementPaidCents?: Cents;
  readonly managementDueCents?: Cents;
  readonly companyDebtPaidCents?: Cents;
  readonly workCompensation?: {
    readonly playerId: PlayerId;
    readonly currentDueCents: Cents;
    readonly currentPaidCents: Cents;
    readonly arrearsDueCents: Cents;
    readonly arrearsPaidCents: Cents;
    readonly closingArrearsCents: Cents;
  };
  readonly distributionsByPlayer: Readonly<Record<PlayerId, Cents>>;
}

export class BusinessCashOverflowError extends RangeError {}

export function captureBusinessBasis(
  assets: FinanceState["assetsById"],
): Record<AssetId, BusinessQuarterBasis> {
  const result: Record<AssetId, BusinessQuarterBasis> = {};
  for (const id of (Object.keys(assets) as AssetId[]).sort()) {
    const asset = assets[id];
    if (asset?.kind === "business")
      result[id] = {
        cashPolicyId: asset.cashPolicyId,
        ...(asset.annualManagementCostCents !== undefined
          ? { annualManagementCostCents: asset.annualManagementCostCents }
          : {}),
        ...(asset.workCompensation
          ? {
              workCompensation: {
                playerId: asset.workCompensation.playerId,
                annualCompensationCents:
                  asset.workCompensation.annualCompensationCents,
              },
            }
          : {}),
        annualOperatingProfitCents: asset.annualOperatingProfitCents,
        ownershipByPlayerPpm: { ...asset.ownershipByPlayerPpm },
      };
  }
  return result;
}

export function planBusinessSettlement(
  asset: BusinessAsset,
  basis: BusinessQuarterBasis,
  quarter: number,
  loansById: FinanceState["loansById"] = {},
): {
  readonly postings: readonly CashPostingRequest[];
  readonly outcome: BusinessSettlementOutcome;
  readonly loansById: Record<LoanId, Loan>;
  readonly loanPayments: readonly LoanPaymentOutcome[];
} | null {
  const policy = BUSINESS_CASH_POLICIES[basis.cashPolicyId];
  if (quarter < policy.firstOperatingQuarter) return null;
  if ((asset.debtPrincipalCents ?? 0) !== 0)
    throw new Error("Productive company debt requires an approved schedule");
  if (asset.cashPolicyId === "starting-company-v1")
    return planStartingCompany(asset, basis, quarter, loansById);
  const operatingCashCents = cents(
    new FinanceDecimal(basis.annualOperatingProfitCents)
      .div(4)
      .round()
      .toNumber(),
  );
  if (
    Math.max(0, operatingCashCents) >
    Number.MAX_SAFE_INTEGER - asset.cashCents
  ) {
    throw new BusinessCashOverflowError(
      "Company operating receipt exceeds cash capacity",
    );
  }
  const available = cents(asset.cashCents + Math.max(0, operatingCashCents));
  const operatingDueCents = cents(
    asset.operatingArrearsCents + Math.max(0, -operatingCashCents),
  );
  const operatingPaidCents = cents(Math.min(available, operatingDueCents));
  const closingOperatingArrearsCents = cents(
    operatingDueCents - operatingPaidCents,
  );
  const debt = planCompanyDebt(
    asset.id,
    loansById,
    quarter,
    cents(available - operatingPaidCents),
  );
  const surplus =
    closingOperatingArrearsCents > 0 || debt.hasArrears
      ? 0
      : Math.min(
          debt.closingCashCents,
          Math.max(0, operatingCashCents - operatingPaidCents - debt.paidCents),
        );
  const retainedFromSurplusCents = cents(
    new FinanceDecimal(surplus)
      .times(policy.retentionBps)
      .div(10_000)
      .round()
      .toNumber(),
  );
  const payout = cents(surplus - retainedFromSurplusCents);
  const closingCashCents = cents(debt.closingCashCents - payout);
  try {
    calculateBusinessEquity(
      {
        ...asset,
        cashCents: closingCashCents,
        operatingArrearsCents: closingOperatingArrearsCents,
      },
      { ...loansById, ...debt.loansById },
    );
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new BusinessCashOverflowError(
      "Closing company equity exceeds capacity",
    );
  }
  const distributionsByPlayer = allocateProportionalCents(
    payout,
    basis.ownershipByPlayerPpm,
  );
  const postings: CashPostingRequest[] = [];
  if (operatingCashCents > 0)
    postings.push({
      source: externalCashAccount("business-operating-cashflow"),
      destination: businessCashAccount(asset.id),
      amountCents: operatingCashCents,
      quarter,
      reason: "business-operating-cashflow",
      relatedAssetId: asset.id,
    });
  if (operatingPaidCents > 0)
    postings.push({
      source: businessCashAccount(asset.id),
      destination: externalCashAccount("business-operating-costs"),
      amountCents: operatingPaidCents,
      quarter,
      reason: "business-operating-cost-payment",
      relatedAssetId: asset.id,
    });
  postings.push(...debt.postings);
  for (const playerId of (
    Object.keys(distributionsByPlayer) as PlayerId[]
  ).sort()) {
    const amountCents = distributionsByPlayer[playerId];
    if (amountCents !== undefined && amountCents > 0)
      postings.push({
        source: businessCashAccount(asset.id),
        destination: playerCashAccount(playerId),
        amountCents,
        quarter,
        reason: "business-distribution",
        relatedAssetId: asset.id,
      });
  }
  return {
    postings,
    loansById: debt.loansById,
    loanPayments: debt.loanPayments,
    outcome: {
      assetId: asset.id,
      openingCashCents: asset.cashCents,
      openingOperatingArrearsCents: asset.operatingArrearsCents,
      operatingCashCents,
      operatingDueCents,
      operatingPaidCents,
      closingOperatingArrearsCents,
      ...(debt.loanPayments.length
        ? { companyDebtPaidCents: debt.paidCents }
        : {}),
      retainedFromSurplusCents,
      closingCashCents,
      distributionsByPlayer,
    },
  };
}

function planStartingCompany(
  asset: BusinessAsset,
  basis: BusinessQuarterBasis,
  quarter: number,
  loans: FinanceState["loansById"],
) {
  const contract = basis.workCompensation;
  const work = asset.workCompensation;
  if (!contract || !work)
    throw new Error("Starting company requires a work contract");
  const operatingCashCents = cents(
    new FinanceDecimal(basis.annualOperatingProfitCents)
      .div(4)
      .round()
      .toNumber(),
  );
  const currentDueCents = cents(
    new FinanceDecimal(contract.annualCompensationCents)
      .div(4)
      .round()
      .toNumber(),
  );
  cents(currentDueCents + work.arrearsCents);
  const managementDueCents = cents(
    new FinanceDecimal(basis.annualManagementCostCents ?? 0)
      .div(4)
      .round()
      .toNumber(),
  );
  const cashBeforeCompensationCents = cents(
    operatingCashCents + currentDueCents + managementDueCents,
  );
  if (
    Math.max(0, cashBeforeCompensationCents) >
    Number.MAX_SAFE_INTEGER - asset.cashCents
  )
    throw new BusinessCashOverflowError(
      "Company operating receipt exceeds cash capacity",
    );
  let cash = cents(asset.cashCents + Math.max(0, cashBeforeCompensationCents));
  const postings: CashPostingRequest[] = [];
  const transfer = (
    amount: number,
    destination: CashPostingRequest["destination"],
    reason: string,
    extra: Partial<CashPostingRequest> = {},
  ) => {
    if (amount === 0) return;
    cash = cents(cash - amount);
    postings.push({
      source: businessCashAccount(asset.id),
      destination,
      amountCents: amount,
      quarter,
      reason,
      relatedAssetId: asset.id,
      ...extra,
    });
  };
  if (cashBeforeCompensationCents > 0)
    postings.push({
      source: externalCashAccount("business-operating-cashflow"),
      destination: businessCashAccount(asset.id),
      amountCents: cashBeforeCompensationCents,
      quarter,
      reason: "business-operating-cashflow",
      relatedAssetId: asset.id,
    });
  const currentOperatingDue = cents(Math.max(0, -cashBeforeCompensationCents));
  const currentOperatingPaid = cents(Math.min(cash, currentOperatingDue));
  transfer(
    currentOperatingPaid,
    externalCashAccount("business-operating-costs"),
    "business-operating-cost-payment",
  );
  const managementPaidCents = cents(Math.min(cash, managementDueCents));
  transfer(
    managementPaidCents,
    externalCashAccount("business-management"),
    "business-management-payment",
  );
  const currentPaidCents = cents(Math.min(cash, currentDueCents));
  transfer(
    currentPaidCents,
    playerCashAccount(contract.playerId),
    "business-work-compensation",
  );
  const oldDue = new FinanceDecimal(asset.operatingArrearsCents).plus(
    work.arrearsCents,
  );
  const oldBudget = cents(oldDue.greaterThan(cash) ? cash : oldDue.toNumber());
  const old = allocateWeightedCents(oldBudget, {
    operations: asset.operatingArrearsCents,
    work: work.arrearsCents,
  });
  transfer(
    old.operations,
    externalCashAccount("business-operating-costs"),
    "business-operating-arrears-payment",
  );
  transfer(
    old.work,
    playerCashAccount(contract.playerId),
    "business-work-compensation-arrears",
  );
  const closingOperatingArrearsCents = cents(
    cents(asset.operatingArrearsCents - old.operations) +
      cents(currentOperatingDue - currentOperatingPaid) +
      managementDueCents -
      managementPaidCents,
  );
  const closingWorkArrears = cents(
    cents(work.arrearsCents - old.work) +
      cents(currentDueCents - currentPaidCents),
  );
  const debt = planCompanyDebt(asset.id, loans, quarter, cash);
  const updatedLoans = debt.loansById;
  const loanPayments = debt.loanPayments;
  const companyDebtPaidCents = debt.paidCents;
  cash = debt.closingCashCents;
  postings.push(...debt.postings);
  const hasArrears =
    closingOperatingArrearsCents > 0 ||
    closingWorkArrears > 0 ||
    debt.hasArrears;
  const surplus = hasArrears
    ? 0
    : Math.min(
        cash,
        Math.max(0, operatingCashCents - oldBudget - companyDebtPaidCents),
      );
  const retainedFromSurplusCents = cents(
    new FinanceDecimal(surplus)
      .times(BUSINESS_CASH_POLICIES["starting-company-v1"].retentionBps)
      .div(10000)
      .round()
      .toNumber(),
  );
  const distributionsByPlayer = allocateProportionalCents(
    cents(surplus - retainedFromSurplusCents),
    basis.ownershipByPlayerPpm,
  );
  for (const id of (Object.keys(distributionsByPlayer) as PlayerId[]).sort())
    transfer(
      distributionsByPlayer[id]!,
      playerCashAccount(id),
      "business-distribution",
    );
  try {
    calculateBusinessEquity(
      {
        ...asset,
        cashCents: cash,
        operatingArrearsCents: closingOperatingArrearsCents,
        workCompensation: { ...work, arrearsCents: closingWorkArrears },
      },
      { ...loans, ...updatedLoans },
    );
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new BusinessCashOverflowError(
      "Closing company equity exceeds capacity",
    );
  }
  return {
    postings,
    loansById: updatedLoans,
    loanPayments,
    outcome: {
      assetId: asset.id,
      openingCashCents: asset.cashCents,
      openingOperatingArrearsCents: asset.operatingArrearsCents,
      operatingCashCents,
      cashBeforeCompensationCents,
      managementPaidCents,
      managementDueCents,
      operatingDueCents: cents(
        asset.operatingArrearsCents + currentOperatingDue + managementDueCents,
      ),
      operatingPaidCents: cents(
        currentOperatingPaid + old.operations + managementPaidCents,
      ),
      closingOperatingArrearsCents,
      companyDebtPaidCents,
      retainedFromSurplusCents,
      closingCashCents: cash,
      distributionsByPlayer,
      workCompensation: {
        playerId: contract.playerId,
        currentDueCents,
        currentPaidCents,
        arrearsDueCents: work.arrearsCents,
        arrearsPaidCents: old.work,
        closingArrearsCents: closingWorkArrears,
      },
    },
  };
}

function isCompanyDebt(
  loan: Loan,
  assetId: AssetId,
): loan is Extract<Loan, { kind: "company-loan" | "asset-bank-loan" }> {
  return (
    (loan.kind === "company-loan" ||
      (loan.kind === "asset-bank-loan" &&
        loan.purpose === "business-acquisition")) &&
    loan.borrowerAssetId === assetId
  );
}

/** Equal-priority bank claims consume company cash, never an owner's wallet. */
function planCompanyDebt(
  assetId: AssetId,
  loans: FinanceState["loansById"],
  quarter: number,
  budget: Cents,
) {
  const rows = Object.values(loans)
    .filter((loan) => isCompanyDebt(loan, assetId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((loan) => {
      const due = calculateLoanObligation(loan, quarter);
      return due ? [{ loan, due }] : [];
    });
  const totalDue = rows.reduce(
    (sum, row) => sum.plus(row.due.amountDueCents),
    new FinanceDecimal(0),
  );
  const allocation = allocateWeightedCents(
    cents(totalDue.greaterThan(budget) ? budget : totalDue.toNumber()),
    Object.fromEntries(
      rows.map((row) => [row.loan.id, row.due.amountDueCents]),
    ),
  );
  const loansById: Record<LoanId, Loan> = {};
  const loanPayments: LoanPaymentOutcome[] = [];
  const postings: CashPostingRequest[] = [];
  let paidCents = cents(0);
  for (const { loan, due } of rows) {
    const applied = applyLoanPaymentAllocation(
      loan,
      due,
      allocation[loan.id]!,
      quarter,
    );
    loansById[loan.id] = applied.loan;
    loanPayments.push(applied.outcome);
    paidCents = cents(paidCents + applied.outcome.paidCents);
    if (applied.outcome.paidCents > 0)
      postings.push({
        source: businessCashAccount(assetId),
        destination: externalCashAccount("bank"),
        amountCents: applied.outcome.paidCents,
        quarter,
        reason:
          loan.kind === "company-loan"
            ? "company-loan-payment"
            : "asset-bank-loan-payment",
        relatedAssetId: assetId,
        relatedLoanId: loan.id,
        loanPayment: {
          principalCents: applied.outcome.principalPaidCents,
          interestCents: applied.outcome.interestPaidCents,
        },
      });
  }
  const hasArrears = Object.values(loans).some(
    (loan) =>
      isCompanyDebt(loan, assetId) &&
      ((loansById[loan.id] ?? loan).pastDuePrincipalCents > 0 ||
        (loansById[loan.id] ?? loan).unpaidInterestCents > 0),
  );
  return {
    loansById,
    loanPayments,
    postings,
    paidCents,
    closingCashCents: cents(budget - paidCents),
    hasArrears,
  };
}
