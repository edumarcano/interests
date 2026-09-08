import {
  PUBLIC_MARKET_INSTRUMENT_IDS,
  type PublicMarketInstrumentId,
} from "@interests/rules";

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

export interface CalculateRevaluedMarketValueInput {
  readonly currentValueCents: number;
  readonly returnBps: number;
}

/**
 * Pure helper calculating quarterly mark-to-market revaluation:
 *
 *   newValueCents = round(oldValueCents * (10000 + returnBps) / 10000)
 *
 * Uses FinanceDecimal with ROUND_HALF_UP.
 * Rejects overflow, negative principal, non-safe integers, and returnBps < -10000.
 */
export function calculateRevaluedMarketValueCents(
  input: CalculateRevaluedMarketValueInput,
): Cents {
  const { currentValueCents, returnBps } = input;

  if (!Number.isSafeInteger(currentValueCents) || currentValueCents < 0) {
    throw new RangeError(
      `currentValueCents must be a non-negative safe integer, got ${String(currentValueCents)}`,
    );
  }

  if (!Number.isSafeInteger(returnBps)) {
    throw new RangeError(
      `returnBps must be a safe integer of basis points, got ${String(returnBps)}`,
    );
  }

  const multiplierBps = 10_000 + returnBps;
  if (multiplierBps < 0) {
    throw new RangeError(
      `returnBps must be >= -10000 to prevent negative value multiplier, got ${String(returnBps)}`,
    );
  }

  if (currentValueCents === 0 || multiplierBps === 0) {
    return cents(0);
  }

  const calculated = new FinanceDecimal(currentValueCents)
    .times(multiplierBps)
    .dividedBy(10_000)
    .round();

  const resultNum = calculated.toNumber();
  if (!Number.isSafeInteger(resultNum) || resultNum < 0) {
    throw new RangeError(
      "Calculated revalued market value exceeds safe integer limit",
    );
  }

  return cents(resultNum);
}

/**
 * Pure helper to revalue a public-market portfolio across canonical instruments.
 */
export function revaluePublicMarketPortfolio(
  portfolio: PublicMarketPortfolio,
  returnBpsByInstrument: Readonly<Record<PublicMarketInstrumentId, number>>,
): Record<PublicMarketInstrumentId, Cents> {
  const result = createZeroPublicMarketPortfolio();

  for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
    const currentVal = portfolio[instrumentId] ?? 0;
    const returnBps = returnBpsByInstrument[instrumentId];
    if (!Number.isSafeInteger(returnBps)) {
      throw new RangeError(
        `Invalid returnBps for ${instrumentId}: ${String(returnBps)}`,
      );
    }
    const revalued = calculateRevaluedMarketValueCents({
      currentValueCents: currentVal,
      returnBps,
    });
    result[instrumentId] = revalued;
  }

  // Ensure total portfolio value is safe integer
  totalPublicMarketValueCents(result);
  return result;
}
