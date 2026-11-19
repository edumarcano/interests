import { describe, expect, it } from "vitest";
import { createRandomState } from "../random/prng";
import {
  calculateBusinessOperatingInputs,
  calculateNormalizedBusinessValueCents,
  generateBusinessRevenueMovement,
} from "./businessPerformance";
import { cents } from "./money";

const operator = {
  referenceAnnualRevenueCents: cents(18_000_000),
  referenceAnnualNonLaborCostsCents: cents(7_200_000),
  fixedAnnualLaborCostsCents: cents(8_400_000),
};
describe("explicit business-calibration arithmetic", () => {
  it("preserves fixed necessary labor while variable non-labor costs follow revenue", () => {
    expect(
      calculateBusinessOperatingInputs(18_000_000, 1000, operator),
    ).toEqual({
      annualRevenueCents: 19_800_000,
      annualNonLaborCostsCents: 7_920_000,
      fixedAnnualLaborCostsCents: 8_400_000,
      annualOperatingProfitCents: 3_480_000,
    });
    expect(
      calculateBusinessOperatingInputs(18_000_000, -1000, operator)
        .annualOperatingProfitCents,
    ).toBe(1_320_000);
  });
  it("permits genuine operating losses without deleting necessary labor", () => {
    const result = calculateBusinessOperatingInputs(
      10_000_000,
      -1000,
      operator,
    );
    expect(result.annualOperatingProfitCents).toBe(-3_000_000);
    expect(result.fixedAnnualLaborCostsCents).toBe(8_400_000);
  });
  it("uses approved sensitivity and inclusive bounded noise deterministically", () => {
    const initial = createRandomState("business-performance-seam");
    let random = initial;
    for (let index = 0; index < 100; index++) {
      const result = generateBusinessRevenueMovement({
        regime: "recession",
        sensitivity: "high",
        random,
      });
      expect(Number.isSafeInteger(result.revenueChangeBps)).toBe(true);
      expect(result.revenueChangeBps).toBeGreaterThanOrEqual(-1000);
      expect(result.revenueChangeBps).toBeLessThanOrEqual(-100);
      random = result.nextRandom;
    }
    expect(
      generateBusinessRevenueMovement({
        regime: "recession",
        sensitivity: "high",
        random: initial,
      }),
    ).toEqual(
      generateBusinessRevenueMovement({
        regime: "recession",
        sensitivity: "high",
        random: initial,
      }),
    );
  });
  it("preserves the original Operator owner-earnings denominator before and after equal-cost replacement", () => {
    const input = {
      openingEnterpriseValueCents: 9_000_000,
      openingValuationEarningsCents: 10_800_000,
      basis: "owner-earnings" as const,
      fixedAnnualLaborCostsCents: 8_400_000,
      observedQuarterlyOperatingProfitCents: [600_000],
    };
    expect(calculateNormalizedBusinessValueCents(input)).toBe(9_000_000);
    // The same necessary labor amount applies regardless of its recipient.
    expect(
      calculateNormalizedBusinessValueCents({
        ...input,
        observedQuarterlyOperatingProfitCents: [600_000, 600_000],
      }),
    ).toBe(9_000_000);
  });
  it("normalizes actual available quarters without filling missing history", () => {
    const input = {
      openingEnterpriseValueCents: 32_000_000,
      openingValuationEarningsCents: 8_000_000,
      basis: "after-labor-profit" as const,
      fixedAnnualLaborCostsCents: 8_400_000,
    };
    expect(
      calculateNormalizedBusinessValueCents({
        ...input,
        observedQuarterlyOperatingProfitCents: [],
      }),
    ).toBe(32_000_000);
    expect(
      calculateNormalizedBusinessValueCents({
        ...input,
        observedQuarterlyOperatingProfitCents: [1_000_000],
      }),
    ).toBe(16_000_000);
    expect(
      calculateNormalizedBusinessValueCents({
        ...input,
        observedQuarterlyOperatingProfitCents: [
          99_000_000, 1_000_000, 2_000_000, 3_000_000, 4_000_000,
        ],
      }),
    ).toBe(40_000_000);
    expect(
      calculateNormalizedBusinessValueCents({
        ...input,
        observedQuarterlyOperatingProfitCents: [-1_000_000],
      }),
    ).toBe(0);
  });
  it("rejects overflow and invalid explicit calibration", () => {
    expect(() =>
      calculateBusinessOperatingInputs(Number.MAX_SAFE_INTEGER, 1000, operator),
    ).toThrow(RangeError);
    expect(() => calculateBusinessOperatingInputs(100, 1001, operator)).toThrow(
      RangeError,
    );
    expect(() =>
      calculateBusinessOperatingInputs(100, 0, {
        ...operator,
        referenceAnnualRevenueCents: cents(0),
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateNormalizedBusinessValueCents({
        openingEnterpriseValueCents: 1,
        openingValuationEarningsCents: 0,
        basis: "after-labor-profit",
        fixedAnnualLaborCostsCents: 0,
        observedQuarterlyOperatingProfitCents: [],
      }),
    ).toThrow(RangeError);
  });
});
