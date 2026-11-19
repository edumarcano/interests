import type { BusinessAuctionView, PlayerId } from "@interests/shared";
import { businessStakePurchaseTotalCents } from "../finance/businessCapitalAccounting";
import { type Cents, cents, isNonNegativeCents } from "../finance/money";
import type { GameState } from "../model/gameState";
import { planBusinessCapital } from "./businessCapitalTerms";
import type { BusinessAuctionTransaction } from "./model";
import { auctionReservedCash, privateAuctionResponse } from "./sealedAuction";

export function saleTerms(
  tx: Pick<BusinessAuctionTransaction, "sellerPlayerId" | "ownershipPpm">,
  buyer: PlayerId,
  price: number,
) {
  return {
    kind: "secondary-stake-sale" as const,
    sellerPlayerId: tx.sellerPlayerId,
    buyerPlayerId: buyer,
    ownershipPpm: tx.ownershipPpm,
    priceCents: price,
  };
}

export function canListAuction(
  state: GameState,
  tx: BusinessAuctionTransaction,
): boolean {
  const asset = state.finance.assetsById[tx.assetId];
  const sampleBidder = tx.eligiblePlayerIds[0];
  return (
    !!sampleBidder &&
    asset?.kind === "business" &&
    !!planBusinessCapital(state, asset, {
      initiatorPlayerId: tx.sellerPlayerId,
      terms: saleTerms(tx, sampleBidder, tx.minimumBidCents),
    })
  );
}

export function reservedAuctionCash(
  tx: BusinessAuctionTransaction,
  playerId: PlayerId,
): Cents {
  const gross = auctionReservedCash(tx, playerId);
  return gross ? businessStakePurchaseTotalCents(gross) : cents(0);
}

export function assertBusinessAuctionTransaction(
  state: GameState,
  tx: BusinessAuctionTransaction,
  spotlight: PlayerId | null,
) {
  const eligible = state.playerOrder.filter((id) => id !== tx.sellerPlayerId);
  if (
    state.phase !== "ready-for-first-round" ||
    tx.sellerPlayerId !== spotlight ||
    tx.createdQuarter !== state.currentQuarter ||
    !Array.isArray(tx.eligiblePlayerIds) ||
    tx.eligiblePlayerIds.length !== eligible.length ||
    tx.eligiblePlayerIds.some((id, index) => id !== eligible[index]) ||
    !Array.isArray(tx.responses) ||
    tx.responses.length >= eligible.length ||
    !canListAuction(state, tx)
  )
    throw new Error("Invalid business auction");
  const responded = new Set<PlayerId>();
  for (const response of tx.responses) {
    if (
      !eligible.includes(response.playerId) ||
      responded.has(response.playerId) ||
      (response.kind !== "pass" &&
        (response.kind !== "bid" ||
          !isNonNegativeCents(response.amountCents) ||
          response.amountCents < tx.minimumBidCents ||
          reservedAuctionCash(tx, response.playerId) >
            (state.finance.cashByPlayer[response.playerId] ?? 0)))
    )
      throw new Error("Invalid business auction response");
    responded.add(response.playerId);
  }
}

export function projectBusinessAuction(
  tx: BusinessAuctionTransaction,
  viewer: PlayerId,
): BusinessAuctionView {
  const own = privateAuctionResponse(tx, viewer);
  return {
    id: tx.id,
    assetId: tx.assetId,
    sellerPlayerId: tx.sellerPlayerId,
    ownershipPpm: tx.ownershipPpm,
    minimumBidCents: tx.minimumBidCents,
    responsesReceived: tx.responses.length,
    responsesRequired: tx.eligiblePlayerIds.length,
    ownResponse:
      own?.kind === "bid"
        ? { kind: "bid", amountCents: own.amountCents }
        : own?.kind === "pass"
          ? { kind: "pass" }
          : null,
  };
}
