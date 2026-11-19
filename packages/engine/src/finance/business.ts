import type { AssetId } from "@interests/shared";
import type { FinanceState, WorkCompensation } from "../model/gameState";
import { FinanceDecimal } from "./decimal";
import { type Cents, cents, isNonNegativeCents, isSafeCents } from "./money";

export interface BusinessEquityInput {
  readonly id?: AssetId;
  readonly workCompensation?: WorkCompensation;
  readonly cashCents?: Cents;
  readonly operatingArrearsCents?: Cents;
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

/** Operating EV excludes company cash; company claims are deducted once. */
export function calculateBusinessEquity(
  business: BusinessEquityInput,
  loansById: FinanceState["loansById"] = {},
): BusinessEquityResult {
  if (!isNonNegativeCents(business.annualRevenueCents)) {
    throw new RangeError(
      `annualRevenueCents must be non-negative safe integer cents, got ${String(business.annualRevenueCents)}`,
    );
  }

  if (!isSafeCents(business.annualOperatingProfitCents)) {
    throw new RangeError(
      `annualOperatingProfitCents must be signed safe integer cents, got ${String(business.annualOperatingProfitCents)}`,
    );
  }

  if (!isNonNegativeCents(business.enterpriseValueCents)) {
    throw new RangeError(
      `enterpriseValueCents must be non-negative safe integer cents, got ${String(business.enterpriseValueCents)}`,
    );
  }

  let debt = new FinanceDecimal(business.debtPrincipalCents ?? 0);
  let unpaidInterest = new FinanceDecimal(0);
  for (const loan of Object.values(loansById)) {
    if (
      (loan.kind !== "company-loan" &&
        !(
          loan.kind === "asset-bank-loan" &&
          loan.purpose === "business-acquisition"
        )) ||
      loan.borrowerAssetId !== business.id
    )
      continue;
    debt = debt.plus(loan.outstandingPrincipalCents);
    unpaidInterest = unpaidInterest.plus(loan.unpaidInterestCents);
  }
  const debtCents = cents(debt.toNumber());
  if (!isNonNegativeCents(debtCents)) {
    throw new RangeError(
      `debtPrincipalCents must be non-negative safe integer cents, got ${String(debtCents)}`,
    );
  }

  const cash = business.cashCents ?? cents(0);
  const arrears = business.operatingArrearsCents ?? cents(0);
  if (!isNonNegativeCents(cash) || !isNonNegativeCents(arrears))
    throw new RangeError("Invalid company cash/payables");
  return {
    enterpriseValueCents: business.enterpriseValueCents,
    debtPrincipalCents: debtCents,
    equityValueCents: cents(
      new FinanceDecimal(business.enterpriseValueCents)
        .plus(cash)
        .minus(debt)
        .minus(unpaidInterest)
        .minus(arrears)
        .minus(business.workCompensation?.arrearsCents ?? 0)
        .toNumber(),
    ),
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
