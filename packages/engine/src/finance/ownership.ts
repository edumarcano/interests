import type { PlayerId } from "@finance-game/shared";

import { FinanceDecimal } from "./decimal";
import { type Cents, cents, isNonNegativeCents } from "./money";

declare const ownershipBrand: unique symbol;

export type OwnershipPpm = number & {
  readonly [ownershipBrand]: "OwnershipPpm";
};

export const TOTAL_OWNERSHIP_PPM = 1_000_000;

export function ownershipPpm(value: number): OwnershipPpm {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Ownership PPM must be a safe integer");
  }
  if (value < 0 || value > TOTAL_OWNERSHIP_PPM) {
    throw new RangeError(
      `Ownership PPM must be between 0 and ${TOTAL_OWNERSHIP_PPM}, got ${value}`,
    );
  }
  return value as OwnershipPpm;
}

export function isOwnershipPpm(value: unknown): value is OwnershipPpm {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= TOTAL_OWNERSHIP_PPM
  );
}

interface OwnerShareCalculation {
  readonly playerId: PlayerId;
  readonly flooredCents: number;
  readonly remainder: FinanceDecimal;
}

/**
 * Pure deterministic largest-remainder allocator for distributing whole cents
 * proportionally according to ownership PPM weights summing to 1,000,000.
 *
 * Steps:
 * 1. Calculate exact proportional shares using FinanceDecimal;
 * 2. Floor each preliminary allocation to whole cents;
 * 3. Calculate leftover cents;
 * 4. Allocate leftover cents to largest fractional remainders;
 * 5. Break exact remainder ties using canonical PlayerId ordering.
 *
 * Invariant: sum(allocated cents) == totalCents
 */
export function allocateProportionalCents(
  totalCents: Cents,
  ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>,
): Record<PlayerId, Cents> {
  if (!isNonNegativeCents(totalCents)) {
    throw new RangeError(
      `Total cents to allocate must be a non-negative safe integer, got ${String(totalCents)}`,
    );
  }

  // Canonical ordering of owner IDs ensures results never depend on JS object insertion order
  const sortedOwnerIds = (Object.keys(ownershipByPlayerPpm) as PlayerId[]).sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );

  if (sortedOwnerIds.length === 0) {
    throw new RangeError("Ownership map cannot be empty");
  }

  let totalWeight = 0;
  for (const playerId of sortedOwnerIds) {
    const weight = ownershipByPlayerPpm[playerId];
    if (
      typeof weight !== "number" ||
      !Number.isSafeInteger(weight) ||
      weight <= 0 ||
      weight > TOTAL_OWNERSHIP_PPM
    ) {
      throw new RangeError(
        `Ownership PPM for player ${playerId} must be a positive safe integer <= ${TOTAL_OWNERSHIP_PPM}, got ${String(weight)}`,
      );
    }
    totalWeight += weight;
  }

  if (totalWeight !== TOTAL_OWNERSHIP_PPM) {
    throw new RangeError(
      `Total ownership PPM must sum to exactly ${TOTAL_OWNERSHIP_PPM}, got ${totalWeight}`,
    );
  }

  if (totalCents === 0) {
    const zeroAllocations: Record<PlayerId, Cents> = {} as Record<
      PlayerId,
      Cents
    >;
    for (const playerId of sortedOwnerIds) {
      zeroAllocations[playerId] = cents(0);
    }
    return zeroAllocations;
  }

  const decTotal = new FinanceDecimal(totalCents);
  const decDenominator = new FinanceDecimal(TOTAL_OWNERSHIP_PPM);

  const calculations: OwnerShareCalculation[] = [];
  let sumFloored = 0;

  for (const playerId of sortedOwnerIds) {
    const weight = ownershipByPlayerPpm[playerId];
    if (weight === undefined) {
      throw new Error(
        `Invariant violation: missing ownership for player ${playerId}`,
      );
    }
    const exactShare = decTotal.times(weight).dividedBy(decDenominator);
    const floored = exactShare.floor();
    const flooredCents = floored.toNumber();
    const remainder = exactShare.minus(floored);

    sumFloored += flooredCents;
    calculations.push({
      playerId,
      flooredCents,
      remainder,
    });
  }

  const leftoverCents = totalCents - sumFloored;
  if (leftoverCents < 0 || leftoverCents > calculations.length) {
    throw new Error(
      `Invariant violation: invalid leftover cents in allocation: ${leftoverCents}`,
    );
  }

  // Sort by remainder descending, breaking ties with canonical PlayerId ascending
  const remainderRanking = [...calculations].sort((a, b) => {
    const diff = b.remainder.comparedTo(a.remainder);
    if (diff !== 0) {
      return diff;
    }
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  });

  const bonusRecipients = new Set<PlayerId>();
  for (let i = 0; i < leftoverCents; i++) {
    const rank = remainderRanking[i];
    if (rank !== undefined) {
      bonusRecipients.add(rank.playerId);
    }
  }

  const result: Record<PlayerId, Cents> = {} as Record<PlayerId, Cents>;
  let totalAllocated = 0;

  for (const calc of calculations) {
    const allocated =
      calc.flooredCents + (bonusRecipients.has(calc.playerId) ? 1 : 0);
    result[calc.playerId] = cents(allocated);
    totalAllocated += allocated;
  }

  if (totalAllocated !== totalCents) {
    throw new Error(
      `Invariant violation: allocated cents (${totalAllocated}) does not equal total cents (${totalCents})`,
    );
  }

  return result;
}
