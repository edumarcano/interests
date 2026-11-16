import { FinanceDecimal } from "./decimal";
import { type Cents, cents, isNonNegativeCents } from "./money";

/** Allocate whole cents by arbitrary integer weights, with stable ID ties. */
export function allocateWeightedCents<Id extends string>(
  total: Cents,
  weights: Readonly<Record<Id, number>>,
): Record<Id, Cents> {
  if (!isNonNegativeCents(total))
    throw new RangeError("Invalid allocation total");
  const ids = (Object.keys(weights) as Id[]).sort();
  let denominator = new FinanceDecimal(0);
  for (const id of ids) {
    const weight = weights[id];
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(
        "Allocation weights must be nonnegative safe integers",
      );
    }
    denominator = denominator.plus(weight);
  }
  if (denominator.isZero() && total !== 0) {
    throw new RangeError("Positive allocation requires positive weights");
  }
  const result = {} as Record<Id, Cents>;
  let remaining = total as number;
  const remainders = ids.map((id) => {
    const exact = denominator.isZero()
      ? new FinanceDecimal(0)
      : new FinanceDecimal(total).times(weights[id]).div(denominator);
    const whole = exact.floor().toNumber();
    result[id] = cents(whole);
    remaining -= whole;
    return { id, remainder: exact.minus(whole) };
  });
  remainders.sort(
    (a, b) =>
      b.remainder.comparedTo(a.remainder) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const { id } of remainders) {
    if (remaining === 0) break;
    result[id] = cents(result[id] + 1);
    remaining -= 1;
  }
  if (remaining !== 0) throw new Error("Allocation did not reconcile");
  return result;
}
