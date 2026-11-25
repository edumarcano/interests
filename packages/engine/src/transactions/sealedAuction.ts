import type { PlayerId } from "@interests/shared";
import { type Cents, cents, isNonNegativeCents } from "../finance/money";

export type AuctionResponse =
  | { readonly playerId: PlayerId; readonly kind: "pass" }
  | {
      readonly playerId: PlayerId;
      readonly kind: "bid";
      readonly amountCents: Cents;
    };

export interface SealedAuction {
  readonly eligiblePlayerIds: readonly PlayerId[];
  readonly minimumBidCents: Cents;
  // Append only: server acceptance order is also the deterministic tie break.
  readonly responses: readonly AuctionResponse[];
}

type AuctionResolution =
  | { readonly kind: "collecting" }
  | { readonly kind: "no-bids" }
  | {
      readonly kind: "won";
      readonly winnerPlayerId: PlayerId;
      readonly priceCents: Cents;
    };

export function auctionResolution(auction: SealedAuction): AuctionResolution {
  if (auction.responses.length !== auction.eligiblePlayerIds.length)
    return { kind: "collecting" };
  let winningBid: Extract<AuctionResponse, { kind: "bid" }> | undefined;
  for (const response of auction.responses)
    if (
      response.kind === "bid" &&
      (!winningBid || response.amountCents > winningBid.amountCents)
    )
      winningBid = response;
  return winningBid
    ? {
        kind: "won",
        winnerPlayerId: winningBid.playerId,
        priceCents: winningBid.amountCents,
      }
    : { kind: "no-bids" };
}

export function privateAuctionResponse(
  auction: SealedAuction,
  playerId: PlayerId,
): AuctionResponse | null {
  return (
    auction.responses.find((response) => response.playerId === playerId) ?? null
  );
}

export function auctionReservedCash(
  auction: SealedAuction,
  playerId: PlayerId,
): Cents {
  const response = privateAuctionResponse(auction, playerId);
  return response?.kind === "bid" ? response.amountCents : cents(0);
}

type AuctionResponseResult =
  | {
      readonly ok: true;
      readonly auction: SealedAuction;
      readonly resolution: AuctionResolution;
    }
  | {
      readonly ok: false;
      readonly auction: SealedAuction;
      readonly code:
        | "AUCTION_SEAT_INELIGIBLE"
        | "AUCTION_ALREADY_RESPONDED"
        | "AUCTION_BID_TOO_LOW"
        | "INSUFFICIENT_AVAILABLE_CASH";
    };

/**
 * null passes. Cash is the player's available cash before this response.
 * The caller commits a resolved auction, including the purchase and release
 * of all reservations, atomically with its last response.
 */
export function respondToSealedAuction(
  auction: SealedAuction,
  playerId: PlayerId,
  amountCents: number | null,
  availableCashCents: Cents,
): AuctionResponseResult {
  if (!auction.eligiblePlayerIds.includes(playerId))
    return { ok: false, auction, code: "AUCTION_SEAT_INELIGIBLE" };
  if (privateAuctionResponse(auction, playerId))
    return { ok: false, auction, code: "AUCTION_ALREADY_RESPONDED" };
  if (amountCents !== null) {
    if (
      !isNonNegativeCents(amountCents) ||
      amountCents === 0 ||
      amountCents < auction.minimumBidCents
    )
      return { ok: false, auction, code: "AUCTION_BID_TOO_LOW" };
    if (amountCents > availableCashCents)
      return { ok: false, auction, code: "INSUFFICIENT_AVAILABLE_CASH" };
  }
  const response: AuctionResponse =
    amountCents === null
      ? { kind: "pass", playerId }
      : { kind: "bid", playerId, amountCents };
  const next = { ...auction, responses: [...auction.responses, response] };
  return { ok: true, auction: next, resolution: auctionResolution(next) };
}
