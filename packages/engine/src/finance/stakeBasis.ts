import { FinanceDecimal } from "./decimal";
import { type Cents, cents, isNonNegativeCents } from "./money";
import {
  type OwnershipPpm,
  ownershipPpm,
  TOTAL_OWNERSHIP_PPM,
} from "./ownership";

export interface StakeBasisSlice {
  readonly costCents: Cents;
  readonly acquiredQuarter: number;
  readonly ownershipPpm: OwnershipPpm;
}
export interface DisposedStakeBasisSlice extends StakeBasisSlice {
  readonly netProceedsCents: Cents;
}
export interface StakeBasisDisposal {
  readonly retainedSlices: readonly StakeBasisSlice[];
  readonly disposedSlices: readonly DisposedStakeBasisSlice[];
  readonly removedCostCents: Cents;
}

function requireSlice(slice: StakeBasisSlice): void {
  if (
    !slice ||
    typeof slice !== "object" ||
    Object.getPrototypeOf(slice) !== Object.prototype
  )
    throw new TypeError("Stake basis slices must be plain records");
  if (
    !isNonNegativeCents(slice.costCents) ||
    !Number.isSafeInteger(slice.acquiredQuarter) ||
    slice.acquiredQuarter < 0 ||
    !Number.isSafeInteger(slice.ownershipPpm) ||
    slice.ownershipPpm <= 0 ||
    slice.ownershipPpm > TOTAL_OWNERSHIP_PPM
  )
    throw new RangeError("Invalid stake basis slice");
}

function requireBook(slices: readonly StakeBasisSlice[]): {
  ownership: number;
  cost: number;
} {
  if (!Array.isArray(slices))
    throw new TypeError("Stake basis book must be an array");
  let ownership = 0;
  let cost = 0;
  for (const slice of slices) {
    requireSlice(slice);
    if (
      slice.ownershipPpm > TOTAL_OWNERSHIP_PPM - ownership ||
      slice.costCents > Number.MAX_SAFE_INTEGER - cost
    )
      throw new RangeError("Stake basis book exceeds supported totals");
    ownership += slice.ownershipPpm;
    cost += slice.costCents;
  }
  return { ownership, cost };
}

/** Largest remainder; ties use earlier acquisition quarter, then persisted book index. */
function allocateUnits(
  total: number,
  weights: readonly number[],
  slices: readonly StakeBasisSlice[],
): number[] {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  if (denominator <= 0)
    throw new RangeError("Allocation requires positive ownership");
  let allocated = 0;
  const entries = weights.map((weight, index) => {
    const exact = new FinanceDecimal(total)
      .times(weight)
      .dividedBy(denominator);
    const floor = exact.floor().toNumber();
    allocated += floor;
    return { index, floor, remainder: exact.minus(floor) };
  });
  const leftover = total - allocated;
  const ranked = [...entries].sort((a, b) => {
    const remainder = b.remainder.comparedTo(a.remainder);
    if (remainder !== 0) return remainder;
    const aSlice = slices[a.index];
    const bSlice = slices[b.index];
    if (!aSlice || !bSlice) throw new Error("Missing allocation slice");
    return aSlice.acquiredQuarter - bSlice.acquiredQuarter || a.index - b.index;
  });
  for (let index = 0; index < leftover; index++) {
    const entry = ranked[index];
    if (!entry) throw new Error("Invalid stake basis remainder");
    entry.floor++;
  }
  return entries.map((entry) => entry.floor);
}

/** Append raw acquisition evidence without merging dates or changing existing costs. */
export function addStakeAcquisitionSlice(
  slices: readonly StakeBasisSlice[],
  acquisition: StakeBasisSlice,
): readonly StakeBasisSlice[] {
  requireBook(slices);
  requireSlice(acquisition);
  const result = [...slices.map((slice) => ({ ...slice })), { ...acquisition }];
  requireBook(result);
  return result;
}

/**
 * Allocate sold PPM first. Remove HALF_UP(cost × actual sold PPM / slice PPM)
 * from each participating slice, then allocate net proceeds by actual sold PPM.
 */
export function disposeStakeBasis(
  slices: readonly StakeBasisSlice[],
  soldOwnershipPpm: number,
  netProceedsCents: number,
): StakeBasisDisposal {
  const book = requireBook(slices);
  if (
    !Number.isSafeInteger(soldOwnershipPpm) ||
    soldOwnershipPpm <= 0 ||
    soldOwnershipPpm > book.ownership
  )
    throw new RangeError(
      "Disposed ownership must be positive and held in the basis book",
    );
  if (!isNonNegativeCents(netProceedsCents))
    throw new RangeError("Invalid disposal proceeds");
  const sold = allocateUnits(
    soldOwnershipPpm,
    slices.map((slice) => slice.ownershipPpm),
    slices,
  );
  const proceeds = allocateUnits(netProceedsCents, sold, slices);
  const retainedSlices: StakeBasisSlice[] = [];
  const disposedSlices: DisposedStakeBasisSlice[] = [];
  let removedCost = 0;
  slices.forEach((slice, index) => {
    const soldPpm = sold[index];
    const allocatedProceeds = proceeds[index];
    if (soldPpm === undefined || allocatedProceeds === undefined)
      throw new Error("Missing disposal allocation");
    const removed = new FinanceDecimal(slice.costCents)
      .times(soldPpm)
      .dividedBy(slice.ownershipPpm)
      .round()
      .toNumber();
    removedCost += removed;
    if (soldPpm > 0)
      disposedSlices.push({
        acquiredQuarter: slice.acquiredQuarter,
        ownershipPpm: ownershipPpm(soldPpm),
        costCents: cents(removed),
        netProceedsCents: cents(allocatedProceeds),
      });
    if (soldPpm < slice.ownershipPpm)
      retainedSlices.push({
        acquiredQuarter: slice.acquiredQuarter,
        ownershipPpm: ownershipPpm(slice.ownershipPpm - soldPpm),
        costCents: cents(slice.costCents - removed),
      });
  });
  return {
    retainedSlices,
    disposedSlices,
    removedCostCents: cents(removedCost),
  };
}

/** Change only existing slices' PPM; no cost is realized or discarded by dilution. */
export function diluteStakeBasis(
  slices: readonly StakeBasisSlice[],
  retainedOwnershipPpm: number,
): readonly StakeBasisSlice[] {
  const book = requireBook(slices);
  if (
    !Number.isSafeInteger(retainedOwnershipPpm) ||
    retainedOwnershipPpm <= 0 ||
    retainedOwnershipPpm > book.ownership
  )
    throw new RangeError(
      "Diluted ownership must be positive and no greater than the existing stake",
    );
  const retained = allocateUnits(
    retainedOwnershipPpm,
    slices.map((slice) => slice.ownershipPpm),
    slices,
  );
  if (retained.some((units) => units === 0))
    throw new RangeError(
      "Dilution would erase an acquisition slice and its basis",
    );
  return slices.map((slice, index) => {
    const units = retained[index];
    if (units === undefined) throw new Error("Missing dilution allocation");
    return { ...slice, ownershipPpm: ownershipPpm(units) };
  });
}
