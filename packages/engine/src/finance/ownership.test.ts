import { asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";

import { cents } from "./money";
import {
  allocateProportionalCents,
  isOwnershipPpm,
  ownershipPpm,
  TOTAL_OWNERSHIP_PPM,
} from "./ownership";

const player1 = asPlayerId("player-1");
const player2 = asPlayerId("player-2");
const player3 = asPlayerId("player-3");
const player4 = asPlayerId("player-4");

describe("ownership primitive", () => {
  it("creates valid OwnershipPpm and rejects out-of-range or non-integers", () => {
    expect(ownershipPpm(0)).toBe(0);
    expect(ownershipPpm(500_000)).toBe(500_000);
    expect(ownershipPpm(TOTAL_OWNERSHIP_PPM)).toBe(TOTAL_OWNERSHIP_PPM);

    expect(isOwnershipPpm(500_000)).toBe(true);
    expect(isOwnershipPpm(-1)).toBe(false);
    expect(isOwnershipPpm(TOTAL_OWNERSHIP_PPM + 1)).toBe(false);
    expect(isOwnershipPpm(50.5)).toBe(false);
    expect(isOwnershipPpm("500000")).toBe(false);

    expect(() => ownershipPpm(-1)).toThrow(RangeError);
    expect(() => ownershipPpm(TOTAL_OWNERSHIP_PPM + 1)).toThrow(RangeError);
    expect(() => ownershipPpm(123.45)).toThrow(RangeError);
  });
});

describe("deterministic largest-remainder proportional allocator", () => {
  it("resolves exact 50/50 remainder tie on 1 cent via canonical PlayerId ordering", () => {
    const ownership = {
      [player1]: ownershipPpm(500_000),
      [player2]: ownershipPpm(500_000),
    };

    // Amount = 1 cent: exact shares are 0.5 cents each
    // player-1 < player-2, so player-1 gets the 1 cent, player-2 gets 0 cents
    const alloc = allocateProportionalCents(cents(1), ownership);

    expect(alloc[player1]).toBe(1);
    expect(alloc[player2]).toBe(0);
    expect((alloc[player1] ?? 0) + (alloc[player2] ?? 0)).toBe(1);
  });

  it("handles 1, 2, and multiple leftover cents across 3 and 4 owners", () => {
    // 3 owners with equal 1/3 (approximated in ppm: 333,334 + 333,333 + 333,333 = 1,000,000)
    const ownership3 = {
      [player1]: ownershipPpm(333_334),
      [player2]: ownershipPpm(333_333),
      [player3]: ownershipPpm(333_333),
    };

    // 2 cents distributed among 3 owners
    // p1: 2 * 333334 / 1000000 = 0.666668 -> floor 0, remainder 0.666668
    // p2: 2 * 333333 / 1000000 = 0.666666 -> floor 0, remainder 0.666666
    // p3: 2 * 333333 / 1000000 = 0.666666 -> floor 0, remainder 0.666666
    // Leftover: 2 cents.
    // 1st goes to p1 (largest remainder 0.666668)
    // 2nd goes to p2 (tie-break between p2 and p3: player-2 < player-3)
    const alloc2 = allocateProportionalCents(cents(2), ownership3);
    expect(alloc2[player1]).toBe(1);
    expect(alloc2[player2]).toBe(1);
    expect(alloc2[player3]).toBe(0);
    expect(
      (alloc2[player1] ?? 0) + (alloc2[player2] ?? 0) + (alloc2[player3] ?? 0),
    ).toBe(2);

    // 4 owners: 250,000 each
    const ownership4 = {
      [player1]: ownershipPpm(250_000),
      [player2]: ownershipPpm(250_000),
      [player3]: ownershipPpm(250_000),
      [player4]: ownershipPpm(250_000),
    };

    // 3 cents among 4 equal owners
    // Remainder is 0.75 for all 4
    // Tie-break assigns to player-1, player-2, player-3
    const alloc3 = allocateProportionalCents(cents(3), ownership4);
    expect(alloc3[player1]).toBe(1);
    expect(alloc3[player2]).toBe(1);
    expect(alloc3[player3]).toBe(1);
    expect(alloc3[player4]).toBe(0);
    expect(
      (alloc3[player1] ?? 0) +
        (alloc3[player2] ?? 0) +
        (alloc3[player3] ?? 0) +
        (alloc3[player4] ?? 0),
    ).toBe(3);

    // 10 cents among 4 equal owners: 2 cents each (8 total), 2 leftover
    // Tie-break assigns bonus to player-1 and player-2
    const alloc10 = allocateProportionalCents(cents(10), ownership4);
    expect(alloc10[player1]).toBe(3);
    expect(alloc10[player2]).toBe(3);
    expect(alloc10[player3]).toBe(2);
    expect(alloc10[player4]).toBe(2);
    expect(
      (alloc10[player1] ?? 0) +
        (alloc10[player2] ?? 0) +
        (alloc10[player3] ?? 0) +
        (alloc10[player4] ?? 0),
    ).toBe(10);
  });

  it("produces identical allocations regardless of object key insertion order", () => {
    const ownershipOrderA = {
      [player4]: ownershipPpm(250_000),
      [player1]: ownershipPpm(250_000),
      [player3]: ownershipPpm(250_000),
      [player2]: ownershipPpm(250_000),
    };

    const ownershipOrderB = {
      [player2]: ownershipPpm(250_000),
      [player3]: ownershipPpm(250_000),
      [player1]: ownershipPpm(250_000),
      [player4]: ownershipPpm(250_000),
    };

    const allocA = allocateProportionalCents(cents(3), ownershipOrderA);
    const allocB = allocateProportionalCents(cents(3), ownershipOrderB);

    expect(allocA).toEqual(allocB);
    expect(allocA[player1]).toBe(1);
    expect(allocA[player2]).toBe(1);
    expect(allocA[player3]).toBe(1);
    expect(allocA[player4]).toBe(0);
  });

  it("allocates zero cents cleanly when source amount is 0", () => {
    const ownership = {
      [player1]: ownershipPpm(700_000),
      [player2]: ownershipPpm(300_000),
    };

    const alloc = allocateProportionalCents(cents(0), ownership);
    expect(alloc[player1]).toBe(0);
    expect(alloc[player2]).toBe(0);
  });

  it("always guarantees sum of allocated cents equals source cents across large random amounts", () => {
    const ownership = {
      [player1]: ownershipPpm(412_345),
      [player2]: ownershipPpm(287_655),
      [player3]: ownershipPpm(300_000),
    };

    const testAmounts = [1, 2, 7, 99, 100, 101, 185_250, 1_000_000, 99_999_999];
    for (const amt of testAmounts) {
      const alloc = allocateProportionalCents(cents(amt), ownership);
      const sum =
        (alloc[player1] ?? 0) + (alloc[player2] ?? 0) + (alloc[player3] ?? 0);
      expect(sum).toBe(amt);
    }
  });

  it("rejects invalid ownership totals or invalid individual weights", () => {
    // Sums to 999,999 (not 1,000,000)
    const underSum = {
      [player1]: ownershipPpm(500_000),
      [player2]: ownershipPpm(499_999),
    };
    expect(() => allocateProportionalCents(cents(100), underSum)).toThrow(
      /Total ownership PPM must sum to exactly/,
    );

    // Sums to 1,000,001
    const overSum = {
      [player1]: ownershipPpm(500_000),
      [player2]: ownershipPpm(500_001),
    };
    expect(() => allocateProportionalCents(cents(100), overSum)).toThrow(
      /Total ownership PPM must sum to exactly/,
    );

    // Negative cents
    expect(() =>
      allocateProportionalCents(cents(-10), {
        [player1]: ownershipPpm(1_000_000),
      }),
    ).toThrow(RangeError);
  });
});
