import { type Cents, cents, isNonNegativeCents } from "./money";

export interface BusinessEquityInput {
  readonly annualRevenueCents: Cents;
  readonly annualOperatingProfitCents: Cents;
  readonly enterpriseValueCents: Cents;
}

export interface DebtFreeBusinessEquityResult {
  readonly enterpriseValueCents: Cents;
  readonly equityValueCents: Cents;
}

/**
 * Pure calculation of debt-free business equity value.
 *
 * NOTE: This is explicitly for the debt-free foundation slice where
 * equity value = enterprise value (no debt, no entity cash, no retained earnings).
 * A4 remains OPEN.
 */
export function calculateDebtFreeBusinessEquity(
  business: BusinessEquityInput,
): DebtFreeBusinessEquityResult {
  if (!isNonNegativeCents(business.annualRevenueCents)) {
    throw new RangeError(
      `annualRevenueCents must be non-negative safe integer cents, got ${String(business.annualRevenueCents)}`,
    );
  }

  if (!isNonNegativeCents(business.annualOperatingProfitCents)) {
    throw new RangeError(
      `annualOperatingProfitCents must be non-negative safe integer cents, got ${String(business.annualOperatingProfitCents)}`,
    );
  }

  if (!isNonNegativeCents(business.enterpriseValueCents)) {
    throw new RangeError(
      `enterpriseValueCents must be non-negative safe integer cents, got ${String(business.enterpriseValueCents)}`,
    );
  }

  return {
    enterpriseValueCents: business.enterpriseValueCents,
    equityValueCents: cents(business.enterpriseValueCents),
  };
}

/**
 * Exact deterministic regression fixture from TASK.md Section 22 / GAME_DESIGN Section 16.3.
 *
 * NOTE: This is an arithmetic test fixture only, NOT automatically a starting business.
 */
export const EXACT_BUSINESS_REGRESSION_FIXTURE = {
  annualRevenueCents: cents(50_000_000),
  annualOperatingProfitCents: cents(8_000_000),
  enterpriseValueCents: cents(32_000_000),
  expected: {
    equityValueCents: cents(32_000_000),
  },
} as const;
