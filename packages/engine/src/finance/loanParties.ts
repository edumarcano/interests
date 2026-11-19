import type { Loan } from "../model/gameState";

export function isPersonalBorrower(
  loan: Loan,
): loan is Extract<Loan, { kind: "player-loan" | "legacy-bank-loan" }> {
  return loan.kind === "player-loan" || loan.kind === "legacy-bank-loan";
}

export function isLenderLoan(
  loan: Loan,
): loan is Extract<Loan, { kind: "player-loan" | "npc-loan" }> {
  return loan.kind === "player-loan" || loan.kind === "npc-loan";
}

export function beneficialBorrowerId(
  loan: Extract<Loan, { kind: "player-loan" | "npc-loan" }>,
): string {
  return loan.kind === "player-loan"
    ? loan.borrowerPlayerId
    : `npc:${loan.borrowerId}`;
}
