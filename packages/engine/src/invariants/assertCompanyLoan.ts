import { OPENING_COMPANY_LOAN_CALIBRATION } from "@interests/rules";
import { calculateCompanyLoanSchedule } from "../finance/amortization";
import { isNonNegativeCents } from "../finance/money";
import type { CompanyLoan, GameState } from "../model/gameState";

export function assertCompanyLoan(state: GameState, loan: CompanyLoan): void {
  const asset = state.finance.assetsById[loan.borrowerAssetId];
  if (
    !asset ||
    asset.kind !== "business" ||
    asset.cashPolicyId !== "starting-company-v1" ||
    Object.hasOwn(loan, "borrowerPlayerId")
  )
    throw new Error("Game invariant failed: invalid company borrower");
  if (
    !isNonNegativeCents(loan.originalPrincipalCents) ||
    loan.originalPrincipalCents === 0 ||
    !isNonNegativeCents(loan.outstandingPrincipalCents) ||
    loan.outstandingPrincipalCents > loan.originalPrincipalCents
  )
    throw new Error("Game invariant failed: invalid company principal");
  if (
    loan.annualRateBps !== OPENING_COMPANY_LOAN_CALIBRATION.annualRateBps ||
    loan.termQuarters !== OPENING_COMPANY_LOAN_CALIBRATION.termQuarters ||
    loan.firstDueQuarter !== 1
  )
    throw new Error("Game invariant failed: invalid opening company terms");
  const schedule = calculateCompanyLoanSchedule({
    principalCents: loan.originalPrincipalCents,
    annualRateBps: loan.annualRateBps,
  });
  if (
    loan.scheduledQuarterlyPaymentCents !== schedule[0]?.paymentCents ||
    !Number.isSafeInteger(loan.periodsProcessed) ||
    loan.periodsProcessed < 0 ||
    loan.periodsProcessed !== loan.lastProcessedQuarter
  )
    throw new Error("Game invariant failed: invalid company payment schedule");
}
