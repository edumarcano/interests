import { describe, expect, it } from "vitest";

import {
  calculateBusinessEquity,
  calculateDebtFreeBusinessEquity,
  EXACT_BUSINESS_REGRESSION_FIXTURE,
} from "./business";
import { cents } from "./money";

describe("debt-free business accounting", () => {
  it("reconciles exact deterministic regression fixture from Section 22", () => {
    const fixture = EXACT_BUSINESS_REGRESSION_FIXTURE;
    const result = calculateDebtFreeBusinessEquity({
      annualRevenueCents: fixture.annualRevenueCents,
      annualOperatingProfitCents: fixture.annualOperatingProfitCents,
      enterpriseValueCents: fixture.enterpriseValueCents,
    });

    expect(result.enterpriseValueCents).toBe(32_000_000);
    expect(result.equityValueCents).toBe(fixture.expected.equityValueCents);
    expect(result.equityValueCents).toBe(32_000_000);
  });

  it("calculates equity value equal to enterprise value for the debt-free model", () => {
    const result = calculateDebtFreeBusinessEquity({
      annualRevenueCents: cents(10_000_000),
      annualOperatingProfitCents: cents(2_000_000),
      enterpriseValueCents: cents(8_000_000),
    });

    expect(result.equityValueCents).toBe(8_000_000);
    expect(result.enterpriseValueCents).toBe(8_000_000);
  });

  it("rejects negative monetary values", () => {
    expect(() =>
      calculateDebtFreeBusinessEquity({
        annualRevenueCents: cents(-1),
        annualOperatingProfitCents: cents(100),
        enterpriseValueCents: cents(100),
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculateDebtFreeBusinessEquity({
        annualRevenueCents: cents(100),
        annualOperatingProfitCents: cents(-1),
        enterpriseValueCents: cents(100),
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculateDebtFreeBusinessEquity({
        annualRevenueCents: cents(100),
        annualOperatingProfitCents: cents(100),
        enterpriseValueCents: cents(-1),
      }),
    ).toThrow(RangeError);
  });
});

describe("business equity calculation with debt", () => {
  it("calculates positive equity when enterprise value exceeds debt", () => {
    const result = calculateBusinessEquity({
      annualRevenueCents: cents(50_000_000),
      annualOperatingProfitCents: cents(8_000_000),
      enterpriseValueCents: cents(32_000_000),
      debtPrincipalCents: cents(6_000_000),
    });

    expect(result.enterpriseValueCents).toBe(cents(32_000_000));
    expect(result.debtPrincipalCents).toBe(cents(6_000_000));
    expect(result.equityValueCents).toBe(cents(26_000_000));
  });

  it("calculates negative equity for distressed businesses when debt exceeds enterprise value", () => {
    const result = calculateBusinessEquity({
      annualRevenueCents: cents(20_000_000),
      annualOperatingProfitCents: cents(2_000_000),
      enterpriseValueCents: cents(10_000_000),
      debtPrincipalCents: cents(15_000_000),
    });

    expect(result.enterpriseValueCents).toBe(cents(10_000_000));
    expect(result.debtPrincipalCents).toBe(cents(15_000_000));
    expect(result.equityValueCents).toBe(cents(-5_000_000));
  });

  it("defaults debt to zero when omitted", () => {
    const result = calculateBusinessEquity({
      annualRevenueCents: cents(10_000_000),
      annualOperatingProfitCents: cents(1_000_000),
      enterpriseValueCents: cents(5_000_000),
    });

    expect(result.debtPrincipalCents).toBe(cents(0));
    expect(result.equityValueCents).toBe(cents(5_000_000));
  });

  it("rejects negative debtPrincipalCents", () => {
    expect(() =>
      calculateBusinessEquity({
        annualRevenueCents: cents(10_000_000),
        annualOperatingProfitCents: cents(1_000_000),
        enterpriseValueCents: cents(5_000_000),
        debtPrincipalCents: cents(-1),
      }),
    ).toThrow(RangeError);
  });
});
