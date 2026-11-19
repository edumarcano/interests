import { describe, expect, it } from "vitest";
import { cents } from "./money";
import { ownershipPpm } from "./ownership";
import {
  addStakeAcquisitionSlice,
  diluteStakeBasis,
  disposeStakeBasis,
  type StakeBasisSlice,
} from "./stakeBasis";

const slice = (
  acquiredQuarter: number,
  units: number,
  cost: number,
): StakeBasisSlice => ({
  acquiredQuarter,
  ownershipPpm: ownershipPpm(units),
  costCents: cents(cost),
});
const book = Object.freeze([
  Object.freeze(slice(0, 300_000, 900)),
  Object.freeze(slice(2, 200_000, 1000)),
]);
const sum = (
  slices: readonly StakeBasisSlice[],
  key: "costCents" | "ownershipPpm",
) => slices.reduce((total, item) => total + item[key], 0);

describe("raw stake acquisitions", () => {
  it("starts an empty book and preserves distinct same-quarter acquisition evidence", () => {
    const first = addStakeAcquisitionSlice([], slice(0, 100_000, 10));
    const result = addStakeAcquisitionSlice(first, slice(0, 100_000, 20));
    expect(result).toEqual([slice(0, 100_000, 10), slice(0, 100_000, 20)]);
    expect(first).toEqual([slice(0, 100_000, 10)]);
    expect(result[0]).not.toBe(first[0]);
  });
  it("adds cost and ownership without mutating a frozen input", () => {
    const result = addStakeAcquisitionSlice(
      book,
      Object.freeze(slice(3, 100_000, 77)),
    );
    expect(result).toEqual([...book, slice(3, 100_000, 77)]);
    expect(book).toHaveLength(2);
  });
  it("rejects aggregate cost and ownership overflow", () => {
    expect(() =>
      addStakeAcquisitionSlice(
        [slice(0, 1, Number.MAX_SAFE_INTEGER)],
        slice(1, 1, 1),
      ),
    ).toThrow(RangeError);
    expect(() =>
      addStakeAcquisitionSlice([slice(0, 1_000_000, 0)], slice(1, 1, 0)),
    ).toThrow(RangeError);
  });
  it("rejects class instances rather than erasing their nonplain input representation", () => {
    class Acquired {
      acquiredQuarter = 1;
      ownershipPpm = ownershipPpm(1);
      costCents = cents(1);
    }
    expect(() => addStakeAcquisitionSlice([], new Acquired())).toThrow(
      TypeError,
    );
    expect(() =>
      addStakeAcquisitionSlice([new Acquired()], slice(2, 1, 1)),
    ).toThrow(TypeError);
  });
});

describe("proportional stake disposal evidence", () => {
  it("reconciles sold and retained PPM and cost while allocating net proceeds by actual sold PPM", () => {
    const result = disposeStakeBasis(book, 250_000, 999);
    expect(result).toEqual({
      retainedSlices: [slice(0, 150_000, 450), slice(2, 100_000, 500)],
      disposedSlices: [
        { ...slice(0, 150_000, 450), netProceedsCents: 599 },
        { ...slice(2, 100_000, 500), netProceedsCents: 400 },
      ],
      removedCostCents: 950,
    });
    expect(
      sum(result.retainedSlices, "ownershipPpm") +
        sum(result.disposedSlices, "ownershipPpm"),
    ).toBe(500_000);
    expect(
      sum(result.retainedSlices, "costCents") + result.removedCostCents,
    ).toBe(1900);
    expect(
      result.disposedSlices.reduce(
        (total, item) => total + item.netProceedsCents,
        0,
      ),
    ).toBe(999);
    expect(book).toEqual([slice(0, 300_000, 900), slice(2, 200_000, 1000)]);
  });
  it("fully disposes every slice without leaving zero-PPM records or stranded cost", () => {
    const result = disposeStakeBasis(book, 500_000, 1234);
    expect(result.retainedSlices).toEqual([]);
    expect(result.removedCostCents).toBe(1900);
    expect(result.disposedSlices).toEqual([
      { ...book[0], netProceedsCents: 740 },
      { ...book[1], netProceedsCents: 494 },
    ]);
  });
  it("breaks sold-PPM ties by earlier acquisition quarter, retaining original book order", () => {
    const original = [slice(4, 1, 40), slice(1, 1, 10)];
    const result = disposeStakeBasis(original, 1, 31);
    expect(result.disposedSlices).toEqual([
      { ...original[1], netProceedsCents: 31 },
    ]);
    expect(result.retainedSlices).toEqual([original[0]]);
  });
  it("breaks same-quarter ties by persisted book index", () => {
    const original = [slice(1, 1, 10), slice(1, 1, 20)];
    expect(disposeStakeBasis(original, 1, 7)).toEqual({
      retainedSlices: [original[1]],
      disposedSlices: [{ ...original[0], netProceedsCents: 7 }],
      removedCostCents: 10,
    });
  });
  it("allocates proceeds only to slices that actually sold a whole PPM", () => {
    const result = disposeStakeBasis(
      [slice(0, 1, 100), slice(1, 1, 200), slice(2, 1, 300)],
      2,
      1,
    );
    expect(result.disposedSlices).toEqual([
      { ...slice(0, 1, 100), netProceedsCents: 1 },
      { ...slice(1, 1, 200), netProceedsCents: 0 },
    ]);
    expect(result.retainedSlices).toEqual([slice(2, 1, 300)]);
    expect(result.removedCostCents).toBe(300);
  });
  it("rounds half-cent removed basis up and reconciles the remaining cost", () => {
    expect(disposeStakeBasis([slice(0, 2, 1)], 1, 0)).toEqual({
      retainedSlices: [slice(0, 1, 0)],
      disposedSlices: [{ ...slice(0, 1, 1), netProceedsCents: 0 }],
      removedCostCents: 1,
    });
  });
  it("handles maximum safe costs and proceeds without losing cents", () => {
    const original = [slice(0, 2, Number.MAX_SAFE_INTEGER - 1), slice(1, 1, 1)];
    const result = disposeStakeBasis(original, 3, Number.MAX_SAFE_INTEGER);
    expect(result.removedCostCents).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.disposedSlices.map((item) => item.netProceedsCents)).toEqual([
      6004799503160661, 3002399751580330,
    ]);
    expect(sum(result.disposedSlices, "ownershipPpm")).toBe(3);
  });
  it("repeated partial disposals eventually remove all cost exactly once", () => {
    let remaining: readonly StakeBasisSlice[] = [
      slice(0, 7, 101),
      slice(1, 3, 207),
    ];
    let removed = 0;
    for (let units = 10; units > 0; units--) {
      const result = disposeStakeBasis(remaining, 1, 13);
      removed += result.removedCostCents;
      remaining = result.retainedSlices;
      expect(sum(remaining, "ownershipPpm")).toBe(units - 1);
      expect(sum(remaining, "costCents") + removed).toBe(308);
    }
    expect(removed).toBe(308);
    expect(remaining).toEqual([]);
  });
  it.each([
    0,
    -1,
    0.5,
    500_001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid sale quantity %s", (units) => {
    expect(() => disposeStakeBasis(book, units, 1)).toThrow(RangeError);
  });
  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid net proceeds %s", (proceeds) => {
    expect(() => disposeStakeBasis(book, 1, proceeds)).toThrow(RangeError);
  });
});

describe("raw basis dilution", () => {
  it("changes each existing slice's PPM proportionally while preserving all dates and costs", () => {
    const result = diluteStakeBasis(book, 250_000);
    expect(result).toEqual([slice(0, 150_000, 900), slice(2, 100_000, 1000)]);
    expect(sum(result, "costCents")).toBe(1900);
    expect(sum(result, "ownershipPpm")).toBe(250_000);
    expect(book).toEqual([slice(0, 300_000, 900), slice(2, 200_000, 1000)]);
  });
  it("retains exact current ownership on a no-change allocation", () => {
    const result = diluteStakeBasis(book, 500_000);
    expect(result).toEqual(book);
    expect(result).not.toBe(book);
    expect(result[0]).not.toBe(book[0]);
  });
  it("uses acquisition age and persisted index to resolve PPM remainder ties", () => {
    expect(diluteStakeBasis([slice(2, 3, 20), slice(0, 3, 10)], 3)).toEqual([
      slice(2, 1, 20),
      slice(0, 2, 10),
    ]);
    expect(diluteStakeBasis([slice(0, 3, 20), slice(0, 3, 10)], 3)).toEqual([
      slice(0, 2, 20),
      slice(0, 1, 10),
    ]);
  });
  it("rejects an unrepresentable positive slice rather than deleting its cost", () => {
    const original = [slice(0, 1, 1_000_000), slice(1, 999_999, 0)];
    expect(() => diluteStakeBasis(original, 1)).toThrow(
      /erase an acquisition slice/,
    );
    expect(original).toEqual([slice(0, 1, 1_000_000), slice(1, 999_999, 0)]);
    expect(() =>
      diluteStakeBasis([slice(0, 1, 0), slice(1, 999_999, 0)], 1),
    ).toThrow(/erase an acquisition slice/);
  });
  it.each([0, -1, 0.5, 500_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid dilution target %s",
    (units) => {
      expect(() => diluteStakeBasis(book, units)).toThrow(RangeError);
    },
  );
});

describe("basis-book validation", () => {
  it.each([
    { acquiredQuarter: -1, ownershipPpm: 1, costCents: 1 },
    { acquiredQuarter: 0.5, ownershipPpm: 1, costCents: 1 },
    { acquiredQuarter: 0, ownershipPpm: 0, costCents: 1 },
    { acquiredQuarter: 0, ownershipPpm: 1_000_001, costCents: 1 },
    { acquiredQuarter: 0, ownershipPpm: 1.5, costCents: 1 },
    { acquiredQuarter: 0, ownershipPpm: 1, costCents: -1 },
    { acquiredQuarter: 0, ownershipPpm: 1, costCents: 0.5 },
  ])("rejects invalid raw slice %j in every operation", (invalid) => {
    const item = invalid as StakeBasisSlice;
    expect(() => addStakeAcquisitionSlice([], item)).toThrow(RangeError);
    expect(() => disposeStakeBasis([item], 1, 1)).toThrow(RangeError);
    expect(() => diluteStakeBasis([item], 1)).toThrow(RangeError);
  });
  it("allows an empty acquisition book but rejects disposing or diluting it", () => {
    expect(() => disposeStakeBasis([], 1, 0)).toThrow(RangeError);
    expect(() => diluteStakeBasis([], 1)).toThrow(RangeError);
  });
});
