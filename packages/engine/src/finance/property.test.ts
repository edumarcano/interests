import { describe, expect, it } from "vitest";

import { basisPoints, cents } from "./money";
import {
  calculatePropertyCashFlow,
  EXACT_PROPERTY_REGRESSION_FIXTURE,
} from "./property";

describe("property operating cash-flow calculation", () => {
  it("reconciles exact deterministic regression fixture from Section 21", () => {
    const fixture = EXACT_PROPERTY_REGRESSION_FIXTURE;
    const result = calculatePropertyCashFlow({
      scheduledQuarterlyRentCents: fixture.scheduledQuarterlyRentCents,
      occupancyBps: fixture.occupancyBps,
      operatingExpenseRatioBps: fixture.operatingExpenseRatioBps,
    });

    expect(result.scheduledRentCents).toBe(300_000);
    expect(result.effectiveRentCents).toBe(fixture.expected.effectiveRentCents);
    expect(result.effectiveRentCents).toBe(285_000);
    expect(result.operatingExpensesCents).toBe(
      fixture.expected.operatingExpensesCents,
    );
    expect(result.operatingExpensesCents).toBe(99_750);
    expect(result.netOperatingIncomeCents).toBe(
      fixture.expected.netOperatingIncomeCents,
    );
    expect(result.netOperatingIncomeCents).toBe(185_250);
  });

  it("applies HALF_UP rounding at explicit calculation boundaries", () => {
    // Test half-up rounding on effective rent:
    // scheduled rent = 1000 cents, occupancy = 125 bps (1.25%)
    // 1000 * 125 / 10000 = 12.5 cents -> rounds half-up to 13 cents
    // expense ratio = 5000 bps (50%)
    // 13 * 5000 / 10000 = 6.5 cents -> rounds half-up to 7 cents
    // NOI = 13 - 7 = 6 cents
    const result = calculatePropertyCashFlow({
      scheduledQuarterlyRentCents: cents(1000),
      occupancyBps: basisPoints(125),
      operatingExpenseRatioBps: basisPoints(5000),
    });

    expect(result.effectiveRentCents).toBe(13);
    expect(result.operatingExpensesCents).toBe(7);
    expect(result.netOperatingIncomeCents).toBe(6);
  });

  it("handles zero rent, zero occupancy, and 100% occupancy cleanly", () => {
    const zeroRent = calculatePropertyCashFlow({
      scheduledQuarterlyRentCents: cents(0),
      occupancyBps: basisPoints(9500),
      operatingExpenseRatioBps: basisPoints(3500),
    });
    expect(zeroRent.effectiveRentCents).toBe(0);
    expect(zeroRent.operatingExpensesCents).toBe(0);
    expect(zeroRent.netOperatingIncomeCents).toBe(0);

    const zeroOcc = calculatePropertyCashFlow({
      scheduledQuarterlyRentCents: cents(300_000),
      occupancyBps: basisPoints(0),
      operatingExpenseRatioBps: basisPoints(3500),
    });
    expect(zeroOcc.effectiveRentCents).toBe(0);
    expect(zeroOcc.operatingExpensesCents).toBe(0);
    expect(zeroOcc.netOperatingIncomeCents).toBe(0);

    const fullOcc = calculatePropertyCashFlow({
      scheduledQuarterlyRentCents: cents(100_000),
      occupancyBps: basisPoints(10_000),
      operatingExpenseRatioBps: basisPoints(2_500),
    });
    expect(fullOcc.effectiveRentCents).toBe(100_000);
    expect(fullOcc.operatingExpensesCents).toBe(25_000);
    expect(fullOcc.netOperatingIncomeCents).toBe(75_000);
  });

  it("rejects invalid or out-of-range inputs", () => {
    expect(() =>
      calculatePropertyCashFlow({
        scheduledQuarterlyRentCents: cents(-1),
        occupancyBps: basisPoints(9500),
        operatingExpenseRatioBps: basisPoints(3500),
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculatePropertyCashFlow({
        scheduledQuarterlyRentCents: cents(100_000),
        occupancyBps: basisPoints(10_001),
        operatingExpenseRatioBps: basisPoints(3500),
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculatePropertyCashFlow({
        scheduledQuarterlyRentCents: cents(100_000),
        occupancyBps: basisPoints(9500),
        operatingExpenseRatioBps: basisPoints(-1),
      }),
    ).toThrow(RangeError);
  });
});
