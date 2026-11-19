import type { PlayerId } from "@interests/shared";

import { type Cents, cents, subtractCents } from "../finance/money";
import type { GameState } from "../model/gameState";
import { reservedAuctionCash } from "./businessAuctionTerms";
import { planBusinessCapital } from "./businessCapitalTerms";
import { reservedBusinessEquityCash } from "./businessEquityOffers";
import { reservedBusinessLoanCash } from "./businessLoanOffers";

/**
 * Pure helper calculating total reserved cash in cents for a player across active transactions.
 * For PR #13, there is at most one active transaction.
 */
export function getReservedCashCents(
  state: GameState,
  playerId: PlayerId,
): Cents {
  const tx = state.activeTransaction;
  if (tx === null) {
    return cents(0);
  }
  if (tx.kind === "business-auction") return reservedAuctionCash(tx, playerId);
  if (tx.kind === "joint-property")
    return cents(
      tx.confirmedPlayerIds.includes(playerId) &&
        tx.initiatorPlayerId === playerId &&
        tx.quote.kind !== "sale"
        ? tx.quote.cashRequiredCents
        : 0,
    );
  if (tx.kind === "business-capital") {
    const offers = cents(
      reservedBusinessLoanCash(tx, playerId) +
        reservedBusinessEquityCash(tx, playerId),
    );
    if (!tx.confirmedPlayerIds.includes(playerId)) return cents(offers);
    const asset = state.finance.assetsById[tx.assetId];
    const plan =
      asset?.kind === "business" ? planBusinessCapital(state, asset, tx) : null;
    if (!plan) throw new Error("Missing business capital reservation terms");
    return cents(offers + (plan.cashContributions.get(playerId) ?? 0));
  }
  let totalReserved = 0;
  if (tx.reservation.playerId === playerId) {
    totalReserved += tx.reservation.amountCents;
  }
  const offer = tx.playerLoanFinancing?.offer;
  if (
    offer !== null &&
    offer !== undefined &&
    offer.reservation.playerId === playerId
  ) {
    if (
      offer.reservation.amountCents >
      Number.MAX_SAFE_INTEGER - totalReserved
    ) {
      throw new RangeError("Reserved cash sum exceeded MAX_SAFE_INTEGER");
    }
    totalReserved += offer.reservation.amountCents;
  }
  return cents(totalReserved);
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
