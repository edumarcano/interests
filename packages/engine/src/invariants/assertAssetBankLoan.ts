import { BANK_LENDING_RULES } from "@interests/rules";
import {
  calculateAmortizingSchedule,
  calculateVariableMortgagePayment,
} from "../finance/amortization";
import { isNonNegativeCents } from "../finance/money";
import type { AssetBankLoan, GameState } from "../model/gameState";
export function assertAssetBankLoan(
  state: GameState,
  loan: AssetBankLoan,
): void {
  const asset = state.finance.assetsById[loan.borrowerAssetId];
  if (
    (loan.purpose !== "property-mortgage" &&
      loan.purpose !== "business-acquisition") ||
    !asset ||
    asset.kind !==
      (loan.purpose === "property-mortgage" ? "property" : "business") ||
    !state.players[loan.leadPlayerId] ||
    Object.hasOwn(loan, "borrowerPlayerId")
  )
    throw new Error("Invalid asset bank borrower");
  for (const value of [
    loan.originalPrincipalCents,
    loan.outstandingPrincipalCents,
    loan.annualRateBps,
    loan.scheduledQuarterlyPaymentCents,
    loan.firstDueQuarter,
    loan.maturityQuarter,
    loan.termQuarters,
    loan.periodsProcessed,
    loan.interestPaidThroughQuarter,
    loan.paymentResetQuarter,
    loan.paymentBasisPrincipalCents,
  ])
    if (!isNonNegativeCents(value))
      throw new Error("Invalid asset bank money/term");
  if (
    !loan.originalPrincipalCents ||
    !loan.scheduledQuarterlyPaymentCents ||
    loan.outstandingPrincipalCents > loan.originalPrincipalCents ||
    loan.termQuarters !==
      (loan.purpose === "property-mortgage"
        ? BANK_LENDING_RULES.propertyTermQuarters
        : BANK_LENDING_RULES.businessTermQuarters) ||
    loan.maturityQuarter !== loan.firstDueQuarter + loan.termQuarters - 1 ||
    loan.firstDueQuarter < 2 ||
    loan.firstDueQuarter > state.currentQuarter + 1 ||
    loan.interestPaidThroughQuarter > state.currentQuarter ||
    loan.periodsProcessed >
      Math.max(0, state.currentQuarter - loan.firstDueQuarter + 1)
  )
    throw new Error("Invalid asset bank schedule");
  if (
    loan.paymentResetQuarter < loan.firstDueQuarter ||
    loan.paymentResetQuarter >
      Math.min(state.currentQuarter + 1, loan.maturityQuarter) ||
    !loan.paymentBasisPrincipalCents ||
    loan.paymentBasisPrincipalCents > loan.originalPrincipalCents ||
    loan.paymentBasisPrincipalCents < loan.outstandingPrincipalCents ||
    (asset.kind === "property" &&
      (asset.cashCents === undefined ||
        asset.debtServiceReserveCents === undefined))
  )
    throw new Error("Invalid asset loan payment basis");
  if (
    loan.pricing?.kind !== "fixed" &&
    (loan.pricing?.kind !== "variable" ||
      !isNonNegativeCents(loan.pricing.spreadBps) ||
      loan.purpose !== "property-mortgage")
  )
    throw new Error("Invalid asset bank pricing");
  const paymentBasis = {
    principalCents: loan.paymentBasisPrincipalCents,
    annualRateBps: loan.annualRateBps,
    termQuarters: loan.maturityQuarter - loan.paymentResetQuarter + 1,
  };
  const expectedPayment =
    loan.pricing.kind === "variable"
      ? calculateVariableMortgagePayment(paymentBasis)
      : calculateAmortizingSchedule(paymentBasis)[0]!.paymentCents;
  if (loan.scheduledQuarterlyPaymentCents !== expectedPayment)
    throw new Error("Invalid asset loan payment basis");
}
