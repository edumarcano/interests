import type { PublicMarketInstrumentId } from "@interests/rules";
import type { PlayerId } from "@interests/shared";
import type {
  CanonicalDisposalRecord,
  OwnershipTransferExposure,
  PlayerProgress,
  PublicMarketExposureSlice,
} from "../model/completionState";
import { FinanceDecimal } from "./decimal";
import { addCents, type Cents, cents, isNonNegativeCents } from "./money";

/** Integer allocation for evidence only. Account pricing and weighted cost basis stay authoritative. */
export function allocateDisposalCents(
  total: Cents,
  weights: readonly number[],
): readonly Cents[] {
  if (
    !isNonNegativeCents(total) ||
    weights.some((weight) => !isNonNegativeCents(weight))
  )
    throw new RangeError("Invalid disposal allocation");
  const denominator = weights.reduce(
    (sum, weight) => addCents(cents(sum), cents(weight)),
    cents(0),
  );
  if (denominator === 0) {
    if (total !== 0)
      throw new RangeError("Missing disposal allocation weights");
    return weights.map(() => cents(0));
  }
  const entries = weights.map((weight, index) => {
    const exact = new FinanceDecimal(total).times(weight).div(denominator);
    return {
      index,
      amount: exact.floor().toNumber(),
      remainder: exact.minus(exact.floor()),
    };
  });
  const remaining =
    total - entries.reduce((sum, entry) => sum + entry.amount, 0);
  const ranked = [...entries].sort(
    (a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index,
  );
  for (let index = 0; index < remaining; index++) ranked[index]!.amount++;
  return entries.map((entry) => cents(entry.amount));
}

/** Absent or inconsistent old evidence receives no invented acquisition age. */
export function fundExposure(
  progress: PlayerProgress,
  instrumentId: PublicMarketInstrumentId,
  valueCents: Cents,
  quarter: number,
): readonly PublicMarketExposureSlice[] {
  const slices = progress.publicMarketExposure?.[instrumentId];
  if (
    slices &&
    slices.reduce((sum, slice) => sum + slice.valueCents, 0) === valueCents &&
    slices.reduce((sum, slice) => sum + slice.costCents, 0) ===
      progress.publicMarketBasis[instrumentId]
  )
    return slices;
  return valueCents || progress.publicMarketBasis[instrumentId]
    ? [
        {
          acquiredQuarter: quarter,
          settledExposureThroughQuarter: 0,
          valueCents,
          costCents: progress.publicMarketBasis[instrumentId],
        },
      ]
    : [];
}

/** A returned, traceable slice invalidates that exposure along the observed ownership cycle. */
export function recordOwnershipTransfer(
  record: CanonicalDisposalRecord,
  sellerPlayerId: PlayerId,
  buyerPlayerId: PlayerId,
  previousTransfers: readonly OwnershipTransferExposure[] = [],
): {
  readonly record: CanonicalDisposalRecord;
  readonly previousTransfers: readonly OwnershipTransferExposure[];
} {
  const returning = previousTransfers.findIndex(
    (transfer) =>
      transfer.playerId === buyerPlayerId && transfer.ownershipUnits > 0,
  );
  const current = {
    playerId: sellerPlayerId,
    disposalId: record.disposalId,
    ownershipUnits: record.ownershipUnits,
  };
  if (returning < 0)
    return { record, previousTransfers: [...previousTransfers, current] };
  return {
    record: {
      ...record,
      circularReturns: [...previousTransfers.slice(returning), current].map(
        ({ disposalId, ownershipUnits }) => ({ disposalId, ownershipUnits }),
      ),
    },
    previousTransfers: [...previousTransfers.slice(0, returning), current],
  };
}
