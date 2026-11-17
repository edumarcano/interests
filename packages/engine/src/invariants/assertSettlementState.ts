import { isNonNegativeCents } from "../finance/money";
import type { GameState } from "../model/gameState";

function requireMoney(value: unknown, label: string): void {
  if (!isNonNegativeCents(value))
    throw new Error(
      `Game invariant failed: ${label} must be nonnegative safe integer cents`,
    );
}

export function assertSettlementState(state: GameState): void {
  const finance = state.finance;
  if (
    !finance ||
    !finance.livingArrearsByPlayer ||
    Object.keys(finance.livingArrearsByPlayer).length !==
      state.playerOrder.length
  ) {
    throw new Error(
      "Game invariant failed: living arrears must contain exactly the players",
    );
  }
  for (const id of state.playerOrder)
    requireMoney(finance.livingArrearsByPlayer[id], "living arrears");
  for (const loan of Object.values(finance.loansById)) {
    requireMoney(loan.principalRepaidCents, "principal repaid");
    requireMoney(loan.pastDuePrincipalCents, "past-due principal");
    requireMoney(loan.unpaidInterestCents, "unpaid interest");
    if (
      loan.outstandingPrincipalCents + loan.principalRepaidCents !==
      loan.originalPrincipalCents
    ) {
      throw new Error(
        "Game invariant failed: outstanding principal and repayments do not reconcile",
      );
    }
    if (loan.pastDuePrincipalCents > loan.outstandingPrincipalCents) {
      throw new Error(
        "Game invariant failed: past-due principal exceeds outstanding principal",
      );
    }
    if (
      !Number.isSafeInteger(loan.lastProcessedQuarter) ||
      loan.lastProcessedQuarter < 0 ||
      loan.lastProcessedQuarter > state.currentQuarter
    ) {
      throw new Error(
        "Game invariant failed: invalid last processed loan quarter",
      );
    }
    if (
      loan.kind === "player-loan" &&
      loan.installmentsProcessed > 0 &&
      loan.installmentsProcessed !==
        Math.min(
          loan.termQuarters,
          loan.lastProcessedQuarter - loan.originatedQuarter,
        )
    ) {
      throw new Error(
        "Game invariant failed: loan due periods do not match calendar",
      );
    }
  }
  const outcome = finance.lastSettlement;
  if (outcome === null) return;
  if (
    !outcome ||
    outcome.quarter !== state.lastSettledQuarter ||
    typeof outcome.settlementId !== "string" ||
    !outcome.livingByPlayer ||
    Object.keys(outcome.livingByPlayer).length !== state.playerOrder.length ||
    !Array.isArray(outcome.loanPayments)
  ) {
    throw new Error("Game invariant failed: invalid last settlement outcome");
  }
  for (const id of state.playerOrder) {
    const living = outcome.livingByPlayer[id];
    if (!living)
      throw new Error("Game invariant failed: missing living outcome");
    for (const key of [
      "currentDueCents",
      "arrearsDueCents",
      "currentPaidCents",
      "arrearsPaidCents",
      "closingArrearsCents",
    ] as const)
      requireMoney(living[key], key);
    if (
      living.currentPaidCents > living.currentDueCents ||
      living.arrearsPaidCents > living.arrearsDueCents ||
      living.currentDueCents -
        living.currentPaidCents +
        living.arrearsDueCents -
        living.arrearsPaidCents !==
        living.closingArrearsCents ||
      living.closingArrearsCents !== finance.livingArrearsByPlayer[id]
    ) {
      throw new Error(
        "Game invariant failed: living outcome does not reconcile",
      );
    }
  }
  const seen = new Set<string>();
  for (const payment of outcome.loanPayments) {
    const loan = finance.loansById[payment.loanId];
    if (
      !loan ||
      seen.has(payment.loanId) ||
      payment.borrowerPlayerId !==
        (loan.kind === "company-loan" ? null : loan.borrowerPlayerId) ||
      payment.borrowerAssetId !==
        (loan.kind === "company-loan" ? loan.borrowerAssetId : undefined) ||
      payment.lenderPlayerId !==
        (loan.kind === "player-loan" ? loan.lenderPlayerId : null)
    ) {
      throw new Error("Game invariant failed: invalid loan outcome parties");
    }
    seen.add(payment.loanId);
    for (const key of [
      "dueCents",
      "paidCents",
      "principalPaidCents",
      "interestPaidCents",
      "closingPastDuePrincipalCents",
      "closingUnpaidInterestCents",
    ] as const)
      requireMoney(payment[key], key);
    if (
      payment.principalPaidCents + payment.interestPaidCents !==
        payment.paidCents ||
      payment.paidCents > payment.dueCents ||
      payment.dueCents - payment.paidCents !==
        payment.closingPastDuePrincipalCents +
          payment.closingUnpaidInterestCents
    ) {
      throw new Error("Game invariant failed: loan outcome does not reconcile");
    }
  }
}
