import { asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { cents } from "../finance/money";
import {
  auctionReservedCash,
  privateAuctionResponse,
  respondToSealedAuction,
  type SealedAuction,
} from "./sealedAuction";

const first = asPlayerId("first");
const second = asPlayerId("second");
const third = asPlayerId("third");
const spectator = asPlayerId("spectator");

function open(): SealedAuction {
  return {
    eligiblePlayerIds: [first, second, third],
    minimumBidCents: cents(1_000),
    responses: [],
  };
}

function bid(
  auction: SealedAuction,
  player: typeof first,
  amount: number | null,
) {
  const next = respondToSealedAuction(auction, player, amount, cents(4_000));
  if (!next.ok) throw new Error(next.code);
  return next;
}

describe("sealed scarce opportunity", () => {
  it("waits for every seat, reserves each bid, and charges the earliest equal winner their own price", () => {
    const a = bid(open(), second, 2_500);
    expect(a.resolution).toEqual({ kind: "collecting" });
    expect(auctionReservedCash(a.auction, second)).toBe(2_500);
    expect(privateAuctionResponse(a.auction, first)).toBeNull();
    const b = bid(a.auction, first, 2_500);
    expect(b.resolution).toEqual({ kind: "collecting" });
    const resumed = JSON.parse(JSON.stringify(b.auction)) as SealedAuction;
    expect(bid(resumed, third, null).resolution).toEqual({
      kind: "won",
      winnerPlayerId: second,
      priceCents: 2_500,
    });
    expect(bid(b.auction, third, 3_000).resolution).toEqual({
      kind: "won",
      winnerPlayerId: third,
      priceCents: 3_000,
    });
  });

  it("rejects ineligible, duplicate and unfunded responses without changing the auction", () => {
    const a = bid(open(), first, null).auction;
    for (const [player, amount, code] of [
      [spectator, 1_500, "AUCTION_SEAT_INELIGIBLE"],
      [first, 1_500, "AUCTION_ALREADY_RESPONDED"],
      [second, 999, "AUCTION_BID_TOO_LOW"],
      [second, 1_501, "INSUFFICIENT_AVAILABLE_CASH"],
    ] as const) {
      expect(respondToSealedAuction(a, player, amount, cents(1_500))).toEqual({
        ok: false,
        auction: a,
        code,
      });
    }
    expect(bid(bid(a, second, null).auction, third, null).resolution).toEqual({
      kind: "no-bids",
    });
  });
});
