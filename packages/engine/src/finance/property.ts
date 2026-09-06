import { FinanceDecimal } from "./decimal";
import {
  type BasisPoints,
  type Cents,
  cents,
  isNonNegativeCents,
} from "./money";

export interface PropertyOperatingCashFlow {
  readonly scheduledRentCents: Cents;
  readonly effectiveRentCents: Cents;
  readonly operatingExpensesCents: Cents;
  readonly netOperatingIncomeCents: Cents;
}

export interface PropertyCashFlowInput {
  readonly scheduledQuarterlyRentCents: Cents;
  readonly occupancyBps: BasisPoints;
  readonly operatingExpenseRatioBps: BasisPoints;
}

/**
 * Pure calculation of debt-free property operating cash flow for one quarter.
 *
 * Relationships (GAME_DESIGN Section 16.1):
 *   effective rent = scheduled quarterly rent x occupancy
 *   operating expenses = effective rent x operating-expense ratio
 *   NOI = effective rent - operating expenses
 *
 * Rounding: HALF_UP to whole cents at explicit calculation boundaries:
 * 1. effective rent;
 * 2. operating expenses.
 *
 * NOI is then: rounded effective rent - rounded operating expenses.
 * Since occupancy and operating-expense ratio are within [0, 10,000] bps,
 * NOI is guaranteed to be non-negative safe integer cents.
 */
export function calculatePropertyCashFlow(
  property: PropertyCashFlowInput,
): PropertyOperatingCashFlow {
  if (!isNonNegativeCents(property.scheduledQuarterlyRentCents)) {
    throw new RangeError(
      `scheduledQuarterlyRentCents must be non-negative safe integer cents, got ${String(property.scheduledQuarterlyRentCents)}`,
    );
  }

  if (
    !Number.isSafeInteger(property.occupancyBps) ||
    property.occupancyBps < 0 ||
    property.occupancyBps > 10_000
  ) {
    throw new RangeError(
      `occupancyBps must be an integer in [0, 10000], got ${String(property.occupancyBps)}`,
    );
  }

  if (
    !Number.isSafeInteger(property.operatingExpenseRatioBps) ||
    property.operatingExpenseRatioBps < 0 ||
    property.operatingExpenseRatioBps > 10_000
  ) {
    throw new RangeError(
      `operatingExpenseRatioBps must be an integer in [0, 10000], got ${String(property.operatingExpenseRatioBps)}`,
    );
  }

  const decBpsBase = new FinanceDecimal(10_000);

  // 1. Effective rent rounded HALF_UP
  const rawEffectiveRent = new FinanceDecimal(
    property.scheduledQuarterlyRentCents,
  )
    .times(property.occupancyBps)
    .dividedBy(decBpsBase);
  const roundedEffectiveRent = rawEffectiveRent.round();
  const effectiveRentCents = cents(roundedEffectiveRent.toNumber());

  // 2. Operating expenses rounded HALF_UP
  const rawOperatingExpenses = roundedEffectiveRent
    .times(property.operatingExpenseRatioBps)
    .dividedBy(decBpsBase);
  const roundedOperatingExpenses = rawOperatingExpenses.round();
  const operatingExpensesCents = cents(roundedOperatingExpenses.toNumber());

  // 3. NOI = rounded effective rent - rounded operating expenses
  const rawNoi = roundedEffectiveRent.minus(roundedOperatingExpenses);
  const netOperatingIncomeCents = cents(rawNoi.toNumber());

  return {
    scheduledRentCents: property.scheduledQuarterlyRentCents,
    effectiveRentCents,
    operatingExpensesCents,
    netOperatingIncomeCents,
  };
}

/**
 * Exact deterministic regression fixture from TASK.md Section 21 / GAME_DESIGN Section 16.
 *
 * NOTE: This is an arithmetic test fixture only, NOT a starting Standard V1 property.
 */
export const EXACT_PROPERTY_REGRESSION_FIXTURE = {
  scheduledQuarterlyRentCents: cents(300_000),
  occupancyBps: 9_500 as BasisPoints,
  operatingExpenseRatioBps: 3_500 as BasisPoints,
  expected: {
    effectiveRentCents: cents(285_000),
    operatingExpensesCents: cents(99_750),
    netOperatingIncomeCents: cents(185_250),
  },
} as const;
