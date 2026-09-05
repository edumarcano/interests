import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  type CalculatePlayerLoanScheduleInput,
  calculatePlayerLoanSchedule,
} from "./amortization";
import { FinanceDecimal } from "./decimal";

describe("decimal configuration", () => {
  it("uses 40 significant digits and ROUND_HALF_UP without mutating global Decimal", () => {
    // Configured FinanceDecimal precision is 40
    expect(FinanceDecimal.precision).toBe(40);
    expect(FinanceDecimal.rounding).toBe(Decimal.ROUND_HALF_UP);

    // Global Decimal remains at default (20 precision)
    expect(Decimal.precision).toBe(20);

    // Tests ROUND_HALF_UP mode on FinanceDecimal
    const halfUpTest = new FinanceDecimal("1.5").round();
    expect(halfUpTest.toNumber()).toBe(2);

    const halfDownTest = new FinanceDecimal("1.4").round();
    expect(halfDownTest.toNumber()).toBe(1);

    const halfBoundary = new FinanceDecimal("2.5").round();
    expect(halfBoundary.toNumber()).toBe(3);
  });
});

describe("calculatePlayerLoanSchedule", () => {
  it("matches the exact 10% APR / 3-quarter approved fixture line by line", () => {
    const input: CalculatePlayerLoanScheduleInput = {
      principalCents: 1_000_000, // $10,000.00
      annualRateBps: 1_000, // 10.00% APR
      termQuarters: 3,
    };

    const schedule = calculatePlayerLoanSchedule(input);

    expect(schedule).toHaveLength(3);

    // Installment 1
    expect(schedule[0]).toEqual({
      installmentNumber: 1,
      openingPrincipalCents: 1_000_000,
      paymentCents: 350_137,
      interestCents: 25_000,
      principalCents: 325_137,
      closingPrincipalCents: 674_863,
    });

    // Installment 2
    expect(schedule[1]).toEqual({
      installmentNumber: 2,
      openingPrincipalCents: 674_863,
      paymentCents: 350_137,
      interestCents: 16_872,
      principalCents: 333_265,
      closingPrincipalCents: 341_598,
    });

    // Installment 3
    expect(schedule[2]).toEqual({
      installmentNumber: 3,
      openingPrincipalCents: 341_598,
      paymentCents: 350_138,
      interestCents: 8_540,
      principalCents: 341_598,
      closingPrincipalCents: 0,
    });

    // Totals
    const totalPrincipal = schedule.reduce(
      (sum, r) => sum + r.principalCents,
      0,
    );
    const totalInterest = schedule.reduce((sum, r) => sum + r.interestCents, 0);
    const totalPayment = schedule.reduce((sum, r) => sum + r.paymentCents, 0);

    expect(totalPrincipal).toBe(1_000_000);
    expect(totalInterest).toBe(50_412);
    expect(totalPayment).toBe(1_050_412);
  });

  it("calculates zero-interest schedule and distributes remainder cents to earliest installments", () => {
    // 100,001 cents over 3 quarters:
    // base = 33,333 cents, remainder = 2 cents.
    // Installment 1: 33,334
    // Installment 2: 33,334
    // Installment 3: 33,333
    const schedule = calculatePlayerLoanSchedule({
      principalCents: 100_001,
      annualRateBps: 0,
      termQuarters: 3,
    });

    expect(schedule).toHaveLength(3);

    expect(schedule[0]).toEqual({
      installmentNumber: 1,
      openingPrincipalCents: 100_001,
      paymentCents: 33_334,
      interestCents: 0,
      principalCents: 33_334,
      closingPrincipalCents: 66_667,
    });

    expect(schedule[1]).toEqual({
      installmentNumber: 2,
      openingPrincipalCents: 66_667,
      paymentCents: 33_334,
      interestCents: 0,
      principalCents: 33_334,
      closingPrincipalCents: 33_333,
    });

    expect(schedule[2]).toEqual({
      installmentNumber: 3,
      openingPrincipalCents: 33_333,
      paymentCents: 33_333,
      interestCents: 0,
      principalCents: 33_333,
      closingPrincipalCents: 0,
    });

    const sumPrincipal = schedule.reduce((sum, r) => sum + r.principalCents, 0);
    expect(sumPrincipal).toBe(100_001);
  });

  it("handles boundary terms: 2 quarters (min) and 8 quarters (max)", () => {
    const minTermSchedule = calculatePlayerLoanSchedule({
      principalCents: 200_000,
      annualRateBps: 800,
      termQuarters: 2,
    });
    expect(minTermSchedule).toHaveLength(2);
    expect(minTermSchedule[1]?.closingPrincipalCents).toBe(0);

    const maxTermSchedule = calculatePlayerLoanSchedule({
      principalCents: 800_000,
      annualRateBps: 600,
      termQuarters: 8,
    });
    expect(maxTermSchedule).toHaveLength(8);
    expect(maxTermSchedule[7]?.closingPrincipalCents).toBe(0);
  });

  it("verifies schedule invariants across all rows", () => {
    const schedule = calculatePlayerLoanSchedule({
      principalCents: 754_321,
      annualRateBps: 1_250,
      termQuarters: 5,
    });

    expect(schedule).toHaveLength(5);

    let runningPrincipalSum = 0;
    for (let i = 0; i < schedule.length; i++) {
      const row = schedule[i];
      expect(row).toBeDefined();
      if (!row) return;

      // 1. interest + principal == payment
      expect(row.interestCents + row.principalCents).toBe(row.paymentCents);

      // 2. previous closing == next opening
      if (i > 0) {
        expect(schedule[i - 1]?.closingPrincipalCents).toBe(
          row.openingPrincipalCents,
        );
      }

      runningPrincipalSum += row.principalCents;
    }

    // 3. sum(all principal components) == original principal
    expect(runningPrincipalSum).toBe(754_321);

    // 4. final closing principal == 0
    expect(schedule[schedule.length - 1]?.closingPrincipalCents).toBe(0);
  });

  it("rejects invalid schedule inputs", () => {
    // Negative rate
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: 100_000,
        annualRateBps: -100,
        termQuarters: 4,
      }),
    ).toThrow(RangeError);

    // Zero principal
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: 0,
        annualRateBps: 500,
        termQuarters: 4,
      }),
    ).toThrow(RangeError);

    // Negative principal
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: -500,
        annualRateBps: 500,
        termQuarters: 4,
      }),
    ).toThrow(RangeError);

    // Unsafe principal
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: Number.MAX_SAFE_INTEGER + 1,
        annualRateBps: 500,
        termQuarters: 4,
      }),
    ).toThrow(RangeError);

    // Fractional principal
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: 100.5,
        annualRateBps: 500,
        termQuarters: 4,
      }),
    ).toThrow(RangeError);

    // Unsafe rate
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: 100_000,
        annualRateBps: Number.MAX_SAFE_INTEGER + 1,
        termQuarters: 4,
      }),
    ).toThrow(RangeError);

    // Invalid term: 1 quarter (< 2)
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: 100_000,
        annualRateBps: 500,
        termQuarters: 1,
      }),
    ).toThrow(RangeError);

    // Invalid term: 9 quarters (> 8)
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: 100_000,
        annualRateBps: 500,
        termQuarters: 9,
      }),
    ).toThrow(RangeError);

    // Unsupported terms where rounding causes non-final installment to fail to reduce principal
    expect(() =>
      calculatePlayerLoanSchedule({
        principalCents: 1,
        annualRateBps: 100,
        termQuarters: 8,
      }),
    ).toThrow(/fails to reduce principal/);
  });
});
