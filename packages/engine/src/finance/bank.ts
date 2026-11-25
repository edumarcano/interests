import {
  ASSET_UNDERWRITING,
  BANK_CREDIT_GRADES,
  BANK_LENDING_RULES,
  COMPLETION_ECONOMY_TARGETS,
  calculateCashYieldBps,
  PUBLIC_MARKET_INSTRUMENTS,
} from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import type {
  AssetBankLoan,
  GameState,
  Loan,
  PropertyAsset,
} from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";
import {
  calculateAmortizingPayment,
  calculateVariableMortgagePayment,
} from "./amortization";
import { planBusinessSettlement } from "./businessSettlement";
import { FinanceDecimal } from "./decimal";
import { isLenderLoan, isPersonalBorrower } from "./loanParties";
import { basisPoints, cents } from "./money";
import { calculateLoanObligation } from "./obligations";
import { calculatePropertyCashFlow } from "./property";

export function roundedRatio(
  value: number,
  numerator: number,
  denominator = 10_000,
): number {
  return cents(
    new FinanceDecimal(value)
      .times(numerator)
      .div(denominator)
      .round()
      .toNumber(),
  );
}
export function isAssetBorrower(
  loan: Loan,
): loan is Extract<Loan, { kind: "company-loan" | "asset-bank-loan" }> {
  return loan.kind === "company-loan" || loan.kind === "asset-bank-loan";
}
export function assetBankLiens(state: GameState, assetId: AssetId): Loan[] {
  return Object.values(state.finance.loansById).filter(
    (loan) =>
      ((loan.kind === "asset-bank-loan" && loan.borrowerAssetId === assetId) ||
        (loan.kind === "legacy-bank-loan" &&
          loan.relatedAssetId === assetId)) &&
      (loan.outstandingPrincipalCents > 0 || loan.unpaidInterestCents > 0),
  );
}
export function bankBorrowerStrength(state: GameState, playerId: PlayerId) {
  const personal = Object.values(state.finance.loansById).filter(
    (loan) => isPersonalBorrower(loan) && loan.borrowerPlayerId === playerId,
  );
  const debt = cents(
    personal.reduce((sum, loan) => {
      const dueQuarter =
        loan.kind === "player-loan"
          ? Math.max(state.currentQuarter, loan.originatedQuarter + 1)
          : state.currentQuarter;
      return (
        sum + (calculateLoanObligation(loan, dueQuarter)?.amountDueCents ?? 0)
      );
    }, 0),
  );
  const obligations = cents(
    state.finance.recurringByPlayer[playerId]!.quarterlyLivingExpenseCents +
      debt,
  );
  let qualifyingIncome =
    state.finance.recurringByPlayer[playerId]!.quarterlyIncomeCents;
  let other = 0;
  const addOther = (flow: number) => {
    other = cents(
      other +
        (flow > 0
          ? roundedRatio(flow, BANK_LENDING_RULES.otherPositiveIncomeBps)
          : flow),
    );
  };
  addOther(
    roundedRatio(
      getAvailableCashCents(state, playerId),
      calculateCashYieldBps(state.economy.baseRateBps),
      40_000,
    ),
  );
  let funds = 0;
  for (const [id, value] of Object.entries(
    state.finance.publicMarketsByPlayer[playerId]!,
  )) {
    funds = cents(funds + value);
    addOther(
      roundedRatio(
        value,
        PUBLIC_MARKET_INSTRUMENTS[id as keyof typeof PUBLIC_MARKET_INSTRUMENTS]
          .annualDividendYieldBps,
        40_000,
      ),
    );
  }
  for (const asset of Object.values(state.finance.assetsById)) {
    const ownership = asset.ownershipByPlayerPpm[playerId] ?? 0;
    if (!ownership) continue;
    if (asset.kind === "property") {
      const flow =
        calculatePropertyCashFlow(asset).netOperatingIncomeCents -
        assetBankLiens(state, asset.id)
          .filter(isAssetBorrower)
          .reduce((sum, loan) => sum + loan.scheduledQuarterlyPaymentCents, 0);
      addOther(roundedRatio(flow, ownership, 1_000_000));
    } else {
      const basis = {
        cashPolicyId: asset.cashPolicyId,
        ...(asset.annualManagementCostCents !== undefined
          ? { annualManagementCostCents: asset.annualManagementCostCents }
          : {}),
        annualOperatingProfitCents: asset.annualOperatingProfitCents,
        ownershipByPlayerPpm: asset.ownershipByPlayerPpm,
        ...(asset.workCompensation
          ? { workCompensation: asset.workCompensation }
          : {}),
      };
      const plan = planBusinessSettlement(
        asset,
        basis,
        state.currentQuarter,
        state.finance.loansById,
      );
      addOther(plan?.outcome.distributionsByPlayer[playerId] ?? 0);
      if (asset.workCompensation?.playerId === playerId)
        addOther(plan?.outcome.workCompensation?.currentPaidCents ?? 0);
      if (asset.annualOperatingProfitCents < 0)
        addOther(
          roundedRatio(asset.annualOperatingProfitCents, ownership, 4_000_000),
        );
    }
  }
  for (const loan of Object.values(state.finance.loansById))
    if (
      isLenderLoan(loan) &&
      loan.lenderPlayerId === playerId &&
      !loan.pastDuePrincipalCents &&
      !loan.unpaidInterestCents
    )
      addOther(
        Math.min(
          loan.kind === "npc-loan"
            ? loan.quarterlyRepaymentCapacityCents
            : Number.MAX_SAFE_INTEGER,
          roundedRatio(
            loan.outstandingPrincipalCents,
            loan.annualRateBps,
            40_000,
          ),
        ),
      );
  qualifyingIncome = cents(qualifyingIncome + other);
  const liquidity = cents(
    getAvailableCashCents(state, playerId) +
      roundedRatio(funds, BANK_LENDING_RULES.publicFundLiquidityBps),
  );
  const grade = BANK_CREDIT_GRADES.find(
    (item) =>
      item.id === "limited" ||
      (new FinanceDecimal(liquidity).gte(
        new FinanceDecimal(obligations).times(item.reserveQuarters),
      ) &&
        qualifyingIncome > 0 &&
        new FinanceDecimal(debt)
          .times(10_000)
          .lte(
            new FinanceDecimal(qualifyingIncome).times(item.maxDebtServiceBps!),
          )),
  )!;
  const overdue =
    (state.finance.livingArrearsByPlayer[playerId] ?? 0) > 0 ||
    personal.some(
      (loan) => loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0,
    );
  return {
    grade: grade.id,
    spreadBps: grade.spreadBps,
    qualifyingLiquidityCents: liquidity,
    qualifyingQuarterlyIncomeCents: qualifyingIncome,
    personalQuarterlyObligationsCents: obligations,
    overdue,
  };
}

/** Shared underwriting for property now and business acquisitions in packet 6. */
export function quoteAssetBankLoan(
  state: GameState,
  playerId: PlayerId,
  input: {
    purpose: "property-mortgage" | "business-acquisition";
    qualifyingValueCents: number;
    quarterlyOperatingIncomeCents: number;
    principalCents: number;
    rateKind: "fixed" | "variable";
  },
) {
  const strength = bankBorrowerStrength(state, playerId);
  const property = input.purpose === "property-mortgage";
  const termQuarters = property
    ? BANK_LENDING_RULES.propertyTermQuarters
    : BANK_LENDING_RULES.businessTermQuarters;
  const annualRateBps = cents(
    state.economy.baseRateBps +
      strength.spreadBps +
      (property
        ? input.rateKind === "fixed"
          ? BANK_LENDING_RULES.fixedPropertyPremiumBps
          : 0
        : BANK_LENDING_RULES.businessPremiumBps),
  );
  const credit = COMPLETION_ECONOMY_TARGETS[state.economy.currentRegime].credit;
  const limits = ASSET_UNDERWRITING[credit];
  const maxShareBps = property
    ? limits.propertyLtvBps
    : limits.businessShareBps;
  const minimumDscrBps = property
    ? limits.propertyDscrBps
    : limits.businessDscrBps;
  if (
    !Number.isSafeInteger(input.principalCents) ||
    input.principalCents < 0 ||
    (!property && input.rateKind === "variable")
  )
    throw new RangeError("Invalid loan terms");
  const payment =
    input.principalCents === 0
      ? 0
      : calculateAmortizingPayment({
          principalCents: input.principalCents,
          annualRateBps,
          termQuarters,
        });
  const ltvPass = new FinanceDecimal(input.principalCents)
    .times(10_000)
    .lte(new FinanceDecimal(input.qualifyingValueCents).times(maxShareBps));
  const dscrPass = new FinanceDecimal(input.quarterlyOperatingIncomeCents)
    .times(10_000)
    .gte(new FinanceDecimal(payment).times(minimumDscrBps));
  return {
    ...strength,
    annualRateBps,
    termQuarters,
    scheduledQuarterlyPaymentCents: payment,
    firstDueQuarter: state.currentQuarter + 1,
    creditEnvironment: credit,
    maxShareBps,
    minimumDscrBps,
    approved:
      !strength.overdue &&
      ltvPass &&
      dscrPass &&
      (input.principalCents === 0 ||
        payment > roundedRatio(input.principalCents, annualRateBps, 40_000)),
    ltvPass,
    dscrPass,
  };
}

export function resetVariableAssetLoan(
  loan: AssetBankLoan,
  baseRateBps: number,
  nextQuarter: number,
): AssetBankLoan {
  if (loan.pricing.kind !== "variable" || !loan.outstandingPrincipalCents)
    return loan;
  const annualRateBps = basisPoints(
    cents(baseRateBps + loan.pricing.spreadBps),
  );
  if (annualRateBps === loan.annualRateBps) return loan;
  const remaining = Math.max(1, loan.maturityQuarter - nextQuarter + 1);
  return {
    ...loan,
    annualRateBps,
    paymentResetQuarter: Math.min(nextQuarter, loan.maturityQuarter),
    paymentBasisPrincipalCents: loan.outstandingPrincipalCents,
    scheduledQuarterlyPaymentCents: calculateVariableMortgagePayment({
      principalCents: loan.outstandingPrincipalCents,
      annualRateBps,
      termQuarters: remaining,
    }),
  };
}
export function bankPayoff(state: GameState, loan: Loan) {
  const coveredQuarter =
    loan.kind === "asset-bank-loan"
      ? Math.max(loan.lastProcessedQuarter, loan.interestPaidThroughQuarter)
      : loan.lastProcessedQuarter;
  const interestCents = cents(
    loan.unpaidInterestCents +
      (coveredQuarter >= state.currentQuarter
        ? 0
        : roundedRatio(
            loan.outstandingPrincipalCents,
            loan.annualRateBps,
            40_000,
          )),
  );
  return {
    principalCents: loan.outstandingPrincipalCents,
    interestCents,
    totalCents: cents(loan.outstandingPrincipalCents + interestCents),
  };
}
export function propertyLoanQuote(
  state: GameState,
  playerId: PlayerId,
  property: PropertyAsset,
  principalCents: number,
  rateKind: "fixed" | "variable",
) {
  return quoteAssetBankLoan(state, playerId, {
    purpose: "property-mortgage",
    qualifyingValueCents: property.marketValueCents,
    quarterlyOperatingIncomeCents:
      calculatePropertyCashFlow(property).netOperatingIncomeCents,
    principalCents,
    rateKind,
  });
}
