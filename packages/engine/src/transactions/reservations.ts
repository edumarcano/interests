import type { PlayerId } from "@finance-game/shared";

import { type Cents, cents, subtractCents } from "../finance/money";
import type { GameState } from "../model/gameState";

/**
 * Pure helper calculating total reserved cash in cents for a player across active transactions.
 * For PR #13, there is at most one active transaction.
 */
export function getReservedCashCents(
  state: GameState,
  playerId: PlayerId,
): Cents {
  if (
    state.activeTransaction !== null &&
    state.activeTransaction.reservation.playerId === playerId
  ) {
    return cents(state.activeTransaction.reservation.amountCents);
  }
  return cents(0);
}

/**
 * Pure helper calculating available (unreserved) cash in cents for a player.
 * Definition: actual cash - active transaction reservations.
 * If player is unknown or has no recorded cash balance, returns 0 cents.
 */
export function getAvailableCashCents(
  state: GameState,
  playerId: PlayerId,
): Cents {
  const actualCash = state.finance.cashByPlayer[playerId];
  if (actualCash === undefined) {
    return cents(0);
  }
  const reserved = getReservedCashCents(state, playerId);
  return subtractCents(actualCash, reserved);
}
