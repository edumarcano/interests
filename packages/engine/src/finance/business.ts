import { type Cents, cents, isNonNegativeCents } from "./money";

export interface BusinessEquityInput {
  readonly annualRevenueCents: Cents;
  readonly annualOperatingProfitCents: Cents;
  readonly enterpriseValueCents: Cents;
  readonly debtPrincipalCents?: Cents;
}

export interface BusinessEquityResult {
  readonly enterpriseValueCents: Cents;
  readonly debtPrincipalCents: Cents;
  readonly equityValueCents: Cents;
}

export interface DebtFreeBusinessEquityResult {
  readonly enterpriseValueCents: Cents;
  readonly equityValueCents: Cents;
}

/**
 * Pure calculation of business equity value.
 *
 * Equity value = enterprise value - business debt principal.
 * For PR #8 starting business slice, business debt is balance-sheet-only
 * (no retained earnings, no entity cash, no business-debt schedule).
 * A4 remains OPEN.
 */
export function calculateBusinessEquity(
  business: BusinessEquityInput,
): BusinessEquityResult {
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

  const debtCents = business.debtPrincipalCents ?? cents(0);
  if (!isNonNegativeCents(debtCents)) {
    throw new RangeError(
      `debtPrincipalCents must be non-negative safe integer cents, got ${String(debtCents)}`,
    );
  }

  if (debtCents > business.enterpriseValueCents) {
    throw new RangeError(
      `debtPrincipalCents (${debtCents}) cannot exceed enterpriseValueCents (${business.enterpriseValueCents}) for supported starting business fixtures`,
    );
  }

  return {
    enterpriseValueCents: business.enterpriseValueCents,
    debtPrincipalCents: debtCents,
    equityValueCents: cents(business.enterpriseValueCents - debtCents),
  };
}

/**
 * Pure calculation of debt-free business equity value.
 *
 * NOTE: Backwards-compatible helper delegating to calculateBusinessEquity with zero debt.
 */
export function calculateDebtFreeBusinessEquity(
  business: BusinessEquityInput,
): DebtFreeBusinessEquityResult {
  const result = calculateBusinessEquity({
    ...business,
    debtPrincipalCents: cents(0),
  });
  return {
    enterpriseValueCents: result.enterpriseValueCents,
    equityValueCents: result.equityValueCents,
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
