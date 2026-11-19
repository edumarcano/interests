import { asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import {
  diluteBusinessOwnership,
  transferBusinessStake,
} from "./businessStakes";
import { cents } from "./money";
import {
  allocateProportionalCents,
  type OwnershipPpm,
  ownershipPpm,
} from "./ownership";

const a = asPlayerId("player-a");
const b = asPlayerId("player-b");
const c = asPlayerId("player-c");
const d = asPlayerId("player-d");
const ownership = (
  entries: readonly (readonly [string, number])[],
): Readonly<Record<ReturnType<typeof asPlayerId>, OwnershipPpm>> =>
  Object.fromEntries(
    entries.map(([id, amount]) => [asPlayerId(id), ownershipPpm(amount)]),
  );
const original = Object.freeze(
  ownership([
    [a, 600_000],
    [b, 400_000],
  ]),
);

function expectCanonical(result: Readonly<Record<string, number>>) {
  expect(Object.values(result).reduce((sum, units) => sum + units, 0)).toBe(
    1_000_000,
  );
  expect(
    Object.values(result).every(
      (units) => Number.isSafeInteger(units) && units > 0,
    ),
  ).toBe(true);
  expect(Object.keys(result)).toEqual(Object.keys(result).sort());
}

describe("secondary business ownership arithmetic", () => {
  it("transfers a partial stake without changing unrelated owners or the input", () => {
    const result = transferBusinessStake(original, a, c, 250_000);
    expect(result).toEqual({ [a]: 350_000, [b]: 400_000, [c]: 250_000 });
    expect(original).toEqual({ [a]: 600_000, [b]: 400_000 });
    expect(result).not.toBe(original);
    expectCanonical(result);
  });
  it("adds a purchase to the buyer's existing ownership and removes a fully sold seller", () => {
    const partial = transferBusinessStake(original, a, b, 1);
    expect(partial).toEqual({ [a]: 599_999, [b]: 400_001 });
    const entire = transferBusinessStake(original, a, b, 600_000);
    expect(entire).toEqual({ [b]: 1_000_000 });
    expect(Object.hasOwn(entire, a)).toBe(false);
    expectCanonical(entire);
  });
  it("moves an entire sole-owned company to a new owner", () => {
    expect(
      transferBusinessStake(ownership([[a, 1_000_000]]), a, d, 1_000_000),
    ).toEqual({ [d]: 1_000_000 });
  });
  it.each([
    0,
    -1,
    0.5,
    600_001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "rejects an invalid transfer amount %s without changing ownership",
    (units) => {
      expect(() => transferBusinessStake(original, a, c, units)).toThrow(
        RangeError,
      );
      expect(original).toEqual({ [a]: 600_000, [b]: 400_000 });
    },
  );
  it("rejects missing sellers and same-party transfers", () => {
    expect(() => transferBusinessStake(original, c, d, 1)).toThrow(RangeError);
    expect(() => transferBusinessStake(original, a, a, 1)).toThrow(RangeError);
  });
  it("returns the same canonical JSON and cent allocations regardless of insertion order", () => {
    const left = transferBusinessStake(
      ownership([
        [b, 400_000],
        [a, 600_000],
      ]),
      a,
      c,
      100_000,
    );
    const right = transferBusinessStake(original, a, c, 100_000);
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(allocateProportionalCents(cents(7), left)).toEqual({
      [a]: 3,
      [b]: 3,
      [c]: 1,
    });
  });
});

describe("primary proportional business dilution", () => {
  it("retains proportional old ownership and grants the exact requested multiple-investor allocations", () => {
    const grants = Object.freeze({ [c]: 200_000, [d]: 100_000 });
    const result = diluteBusinessOwnership(original, grants);
    expect(result).toEqual({
      [a]: 420_000,
      [b]: 280_000,
      [c]: 200_000,
      [d]: 100_000,
    });
    expect(original).toEqual({ [a]: 600_000, [b]: 400_000 });
    expect(grants).toEqual({ [c]: 200_000, [d]: 100_000 });
    expectCanonical(result);
  });
  it("adds an issuance grant to an investor who already owns shares", () => {
    const result = diluteBusinessOwnership(original, {
      [a]: 200_000,
      [c]: 100_000,
    });
    expect(result).toEqual({ [a]: 620_000, [b]: 280_000, [c]: 100_000 });
    expectCanonical(result);
  });
  it("uses canonical largest remainders for a single-PPM dilution", () => {
    const equal = ownership([
      [b, 500_000],
      [a, 500_000],
    ]);
    const result = diluteBusinessOwnership(equal, { [c]: 1 });
    expect(result).toEqual({ [a]: 500_000, [b]: 499_999, [c]: 1 });
    expect(allocateProportionalCents(cents(1), result)).toEqual({
      [a]: 1,
      [b]: 0,
      [c]: 0,
    });
    expectCanonical(result);
  });
  it("ranks unequal fractional remainders before canonical player IDs", () => {
    const result = diluteBusinessOwnership(
      ownership([
        [a, 333_334],
        [b, 333_333],
        [c, 333_333],
      ]),
      { [d]: 3 },
    );
    expect(result).toEqual({
      [a]: 333_333,
      [b]: 333_332,
      [c]: 333_332,
      [d]: 3,
    });
    expectCanonical(result);
  });
  it("accepts the largest representable grant to a new investor when one owner remains", () => {
    const result = diluteBusinessOwnership(ownership([[a, 1_000_000]]), {
      [b]: 999_999,
    });
    expect(result).toEqual({ [a]: 1, [b]: 999_999 });
    expectCanonical(result);
  });
  it("rejects dilution that would round a positive residual owner to zero", () => {
    const tinyOwner = ownership([
      [a, 1],
      [b, 999_999],
    ]);
    expect(() => diluteBusinessOwnership(tinyOwner, { [c]: 999_999 })).toThrow(
      /erase an existing owner's residual interest/,
    );
    // A new grant cannot hide the loss of that owner's pre-existing residual.
    expect(() => diluteBusinessOwnership(tinyOwner, { [a]: 500_001 })).toThrow(
      /erase an existing owner's residual interest/,
    );
  });
  it.each([
    {},
    { [c]: 0 },
    { [c]: -1 },
    { [c]: 0.1 },
    { [c]: Number.NaN },
    { [c]: Number.POSITIVE_INFINITY },
    { [c]: Number.MAX_SAFE_INTEGER },
    { [c]: 1_000_000 },
    { [c]: 600_000, [d]: 400_000 },
    { [c]: 700_000, [d]: 400_000 },
  ])("rejects empty or unrepresentable grants %j", (grants) => {
    expect(() => diluteBusinessOwnership(original, grants)).toThrow(RangeError);
  });
  it("is independent of old-owner and investor insertion order", () => {
    const first = diluteBusinessOwnership(original, {
      [d]: 200_001,
      [c]: 100_002,
    });
    const second = diluteBusinessOwnership(
      ownership([
        [b, 400_000],
        [a, 600_000],
      ]),
      { [c]: 100_002, [d]: 200_001 },
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expectCanonical(first);
  });
});

describe("ownership boundary validation", () => {
  it.each([
    {},
    { [a]: 999_999 },
    { [a]: 1_000_001 },
    { [a]: 0, [b]: 1_000_000 },
    { [a]: -1, [b]: 1_000_001 },
    { [a]: 500_000.5, [b]: 499_999.5 },
    { [a]: Number.NaN },
    { [a]: Number.MAX_SAFE_INTEGER },
  ])("rejects invalid existing ownership %j in both operations", (invalid) => {
    const input = invalid as Readonly<
      Record<ReturnType<typeof asPlayerId>, OwnershipPpm>
    >;
    expect(() => transferBusinessStake(input, a, c, 1)).toThrow(RangeError);
    expect(() => diluteBusinessOwnership(input, { [c]: 1 })).toThrow(
      RangeError,
    );
  });
  it("rejects nonrecord inputs and empty player identifiers", () => {
    for (const invalid of [
      null,
      [],
      new Map(),
      Object.create({ [a]: 1_000_000 }),
    ]) {
      const input = invalid as Readonly<
        Record<ReturnType<typeof asPlayerId>, OwnershipPpm>
      >;
      expect(() => transferBusinessStake(input, a, b, 1)).toThrow(TypeError);
      expect(() => diluteBusinessOwnership(original, input)).toThrow(TypeError);
    }
    expect(() => transferBusinessStake(original, a, asPlayerId(""), 1)).toThrow(
      RangeError,
    );
    expect(() =>
      diluteBusinessOwnership(original, { [asPlayerId("")]: 1 }),
    ).toThrow(RangeError);
  });
});
