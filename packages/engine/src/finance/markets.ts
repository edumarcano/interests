import {
  PUBLIC_MARKET_INSTRUMENT_IDS,
  type PublicMarketInstrumentId,
} from "@finance-game/rules";

import type { PublicMarketPortfolio } from "../model/gameState";
import { FinanceDecimal } from "./decimal";
import { type Cents, cents } from "./money";

export interface CalculateQuarterlyYieldInput {
  readonly principalCents: number;
  readonly annualYieldBps: number;
}

/**
 * Pure helper to construct an empty/zero public-market portfolio with all
 * canonical instrument keys initialized to 0 cents.
 */
export function createZeroPublicMarketPortfolio(): Record<
  PublicMarketInstrumentId,
  Cents
> {
  return {
    "broad-market-fund": cents(0),
    "growth-fund": cents(0),
    "income-defensive-fund": cents(0),
  };
}

/**
 * Pure checked helper for total mark-to-market value of a public-market portfolio.
 *
 * Iterates strictly in canonical rules instrument order, validating safe integers
 * and safe addition.
 */
export function totalPublicMarketValueCents(
  portfolio: PublicMarketPortfolio,
): Cents {
  if (portfolio === null || typeof portfolio !== "object") {
    throw new TypeError("Portfolio must be a non-null object");
  }

  let total = 0;
  for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
    const value = portfolio[instrumentId];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        `Portfolio value for ${instrumentId} must be a non-negative safe integer of cents, got ${String(value)}`,
      );
    }
    if (value > Number.MAX_SAFE_INTEGER - total) {
      throw new RangeError("Portfolio total value exceeds safe integer limit");
    }
    total += value;
  }

  return cents(total);
}

/**
 * Pure calculation for fixed annual yield applied quarterly:
 *
 *   quarterly cash amount = principalCents × annualYieldBps / 40000
 *
 * Rounded to integer cents using ROUND_HALF_UP via FinanceDecimal.
 */
export function calculateQuarterlyYieldCents(
  input: CalculateQuarterlyYieldInput,
): Cents {
  const { principalCents, annualYieldBps } = input;

  if (!Number.isSafeInteger(principalCents) || principalCents < 0) {
    throw new RangeError(
      `principalCents must be a non-negative safe integer, got ${String(principalCents)}`,
    );
  }

  if (!Number.isSafeInteger(annualYieldBps) || annualYieldBps < 0) {
    throw new RangeError(
      `annualYieldBps must be a non-negative safe integer, got ${String(annualYieldBps)}`,
    );
  }

  if (principalCents === 0 || annualYieldBps === 0) {
    return cents(0);
  }

  const calculated = new FinanceDecimal(principalCents)
    .times(annualYieldBps)
    .dividedBy(40_000)
    .round();

  const resultNum = calculated.toNumber();
  if (!Number.isSafeInteger(resultNum)) {
    throw new RangeError(
      "Calculated quarterly yield exceeds safe integer limit",
    );
  }

  return cents(resultNum);
}
