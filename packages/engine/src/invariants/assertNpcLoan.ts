import { isNonNegativeCents } from "../finance/money";
import { validNpcFundingTerms } from "../finance/npcLending";
import type { GameState, NpcLoan } from "../model/gameState";

export function assertNpcLoan(state: GameState, loan: NpcLoan): void {
  const fundingSequence =
    typeof loan.fundedTransactionId === "string" &&
    /^transaction-([1-9]\d*)$/.exec(loan.fundedTransactionId);
  const ordinal = fundingSequence ? Number(fundingSequence[1]) : Number.NaN;
  if (
    !state.playerOrder.includes(loan.lenderPlayerId) ||
    Object.hasOwn(loan, "borrowerPlayerId") ||
    Object.hasOwn(loan, "borrowerAssetId") ||
    !Number.isSafeInteger(ordinal) ||
    ordinal > state.counters.transaction ||
    !isNonNegativeCents(loan.outstandingPrincipalCents) ||
    loan.outstandingPrincipalCents > loan.originalPrincipalCents ||
    !Number.isSafeInteger(loan.originatedQuarter) ||
    loan.originatedQuarter < 1 ||
    loan.originatedQuarter > state.currentQuarter ||
    !Number.isSafeInteger(loan.installmentsProcessed) ||
    loan.installmentsProcessed < 0 ||
    loan.installmentsProcessed > loan.termQuarters ||
    !validNpcFundingTerms({
      ...loan,
      principalCents: loan.originalPrincipalCents,
    }) ||
    !Array.isArray(loan.interestReceipts)
  )
    throw new Error("Invalid non-player loan");
  let previous = loan.originatedQuarter;
  for (const row of loan.interestReceipts) {
    if (
      !row ||
      !Number.isSafeInteger(row.quarter) ||
      row.quarter <= previous ||
      row.quarter > loan.lastProcessedQuarter ||
      row.quarter > state.lastSettledQuarter ||
      !isNonNegativeCents(row.receivedCents) ||
      !row.receivedCents ||
      !isNonNegativeCents(row.currentEarnedCents) ||
      row.currentEarnedCents > row.receivedCents ||
      row.receivedCents > loan.quarterlyRepaymentCapacityCents
    )
      throw new Error("Invalid non-player interest receipt");
    previous = row.quarter;
  }
}
