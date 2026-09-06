import { describe, expect, it } from "vitest";

import {
  CASH_YIELD_FLOOR_BPS,
  CASH_YIELD_OFFSET_BPS,
  calculateCashYieldBps,
  isPublicMarketInstrumentId,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_INSTRUMENTS,
  STANDARD_V1_OPENING_BASE_RATE_BPS,
  STANDARD_V1_OPENING_CASH_YIELD_BPS,
} from "./markets";

describe("public-market rules and constants", () => {
  it("defines exactly three Standard V1 instrument IDs in canonical order", () => {
    expect(PUBLIC_MARKET_INSTRUMENT_IDS).toEqual([
      "broad-market-fund",
      "growth-fund",
      "income-defensive-fund",
    ]);
  });

  it("defines exact dividend yields for the three instruments", () => {
    expect(
      PUBLIC_MARKET_INSTRUMENTS["broad-market-fund"].annualDividendYieldBps,
    ).toBe(150);
    expect(
      PUBLIC_MARKET_INSTRUMENTS["growth-fund"].annualDividendYieldBps,
    ).toBe(50);
    expect(
      PUBLIC_MARKET_INSTRUMENTS["income-defensive-fund"].annualDividendYieldBps,
    ).toBe(350);
  });

  it("defines opening cash yield constants and formula matching 3.00% annual", () => {
    expect(STANDARD_V1_OPENING_BASE_RATE_BPS).toBe(450);
    expect(CASH_YIELD_OFFSET_BPS).toBe(150);
    expect(CASH_YIELD_FLOOR_BPS).toBe(50);
    expect(STANDARD_V1_OPENING_CASH_YIELD_BPS).toBe(300);

    expect(calculateCashYieldBps(STANDARD_V1_OPENING_BASE_RATE_BPS)).toBe(300);
    expect(calculateCashYieldBps(500)).toBe(350);
    expect(calculateCashYieldBps(100)).toBe(50); // hits floor
    expect(calculateCashYieldBps(0)).toBe(50); // hits floor
  });

  it("validates instrument ID typeguard", () => {
    expect(isPublicMarketInstrumentId("broad-market-fund")).toBe(true);
    expect(isPublicMarketInstrumentId("growth-fund")).toBe(true);
    expect(isPublicMarketInstrumentId("income-defensive-fund")).toBe(true);
    expect(isPublicMarketInstrumentId("crypto-fund")).toBe(false);
    expect(isPublicMarketInstrumentId("")).toBe(false);
    expect(isPublicMarketInstrumentId(null)).toBe(false);
    expect(isPublicMarketInstrumentId(123)).toBe(false);
  });

  it("rejects non-safe integer or negative base rate in calculateCashYieldBps", () => {
    expect(() => calculateCashYieldBps(-10)).toThrow(RangeError);
    expect(() => calculateCashYieldBps(1.5)).toThrow(RangeError);
  });
});
