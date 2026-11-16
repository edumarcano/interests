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
  const surplus =
    closingOperatingArrearsCents > 0
      ? 0
      : Math.min(
          available - operatingPaidCents,
          Math.max(0, operatingCashCents - operatingPaidCents),
        );
  const retainedFromSurplusCents = cents(
    new FinanceDecimal(surplus)
      .times(policy.retentionBps)
      .div(10_000)
      .round()
      .toNumber(),
  );
  const payout = cents(surplus - retainedFromSurplusCents);
  const closingCashCents = cents(available - operatingPaidCents - payout);
  try {
    calculateBusinessEquity({
      ...asset,
      cashCents: closingCashCents,
      operatingArrearsCents: closingOperatingArrearsCents,
    });
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
    loansById: {},
    loanPayments: [],
    outcome: {
      assetId: asset.id,
      openingCashCents: asset.cashCents,
      openingOperatingArrearsCents: asset.operatingArrearsCents,
      operatingCashCents,
      operatingDueCents,
      operatingPaidCents,
      closingOperatingArrearsCents,
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
  const cashBeforeCompensationCents = cents(
    operatingCashCents + currentDueCents,
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
      cents(currentOperatingDue - currentOperatingPaid),
  );
  const closingWorkArrears = cents(
    cents(work.arrearsCents - old.work) +
      cents(currentDueCents - currentPaidCents),
  );
  const updatedLoans: Record<LoanId, Loan> = {};
  const loanPayments: LoanPaymentOutcome[] = [];
  const dueById: Record<
    LoanId,
    NonNullable<ReturnType<typeof calculateLoanObligation>>
  > = {};
  for (const id of (Object.keys(loans) as LoanId[]).sort()) {
    const loan = loans[id];
    if (loan?.kind !== "company-loan" || loan.borrowerAssetId !== asset.id)
      continue;
    const due = calculateLoanObligation(loan, quarter);
    if (due) dueById[id] = due;
  }
  const totalDue = Object.values(dueById).reduce(
    (sum, due) => sum.plus(due.amountDueCents),
    new FinanceDecimal(0),
  );
  const allocation = allocateWeightedCents(
    cents(totalDue.greaterThan(cash) ? cash : totalDue.toNumber()),
    Object.fromEntries(
      Object.entries(dueById).map(([id, due]) => [id, due.amountDueCents]),
    ),
  );
  let companyDebtPaidCents = cents(0);
  for (const id of Object.keys(dueById) as LoanId[]) {
    const loan = loans[id];
    const due = dueById[id];
    if (!loan || !due) throw new Error("Missing planned company loan");
    const payment = applyLoanPaymentAllocation(
      loan,
      due,
      allocation[id]!,
      quarter,
    );
    updatedLoans[id] = payment.loan;
    loanPayments.push(payment.outcome);
    companyDebtPaidCents = cents(
      companyDebtPaidCents + payment.outcome.paidCents,
    );
    transfer(
      payment.outcome.paidCents,
      externalCashAccount("bank"),
      "company-loan-payment",
      {
        relatedLoanId: id,
        loanPayment: {
          principalCents: payment.outcome.principalPaidCents,
          interestCents: payment.outcome.interestPaidCents,
        },
      },
    );
  }
  const hasArrears =
    closingOperatingArrearsCents > 0 ||
    closingWorkArrears > 0 ||
    Object.values(updatedLoans).some(
      (loan) => loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0,
    );
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
      operatingDueCents: cents(
        asset.operatingArrearsCents + currentOperatingDue,
      ),
      operatingPaidCents: cents(currentOperatingPaid + old.operations),
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
