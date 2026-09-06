import {
  PUBLIC_MARKET_INSTRUMENTS,
  STANDARD_V1_OPENING_CASH_YIELD_BPS,
} from "@finance-game/rules";
import { describe, expect, it } from "vitest";

import {
  calculateQuarterlyYieldCents,
  calculateRevaluedMarketValueCents,
  createZeroPublicMarketPortfolio,
  revaluePublicMarketPortfolio,
  totalPublicMarketValueCents,
} from "./markets";
import { cents } from "./money";

describe("public market finance calculations", () => {
  describe("totalPublicMarketValueCents", () => {
    it("sums portfolio values across canonical instruments", () => {
      const portfolio = {
        "broad-market-fund": cents(2_000_000),
        "growth-fund": cents(1_500_000),
        "income-defensive-fund": cents(500_000),
      };
      expect(totalPublicMarketValueCents(portfolio)).toBe(cents(4_000_000));
    });

    it("returns zero for zero portfolio", () => {
      const zeroPortfolio = createZeroPublicMarketPortfolio();
      expect(totalPublicMarketValueCents(zeroPortfolio)).toBe(cents(0));
    });

    it("rejects negative or non-safe-integer values", () => {
      expect(() =>
        totalPublicMarketValueCents({
          "broad-market-fund": cents(-100),
          "growth-fund": cents(0),
          "income-defensive-fund": cents(0),
        }),
      ).toThrow(RangeError);

      expect(() =>
        totalPublicMarketValueCents({
          "broad-market-fund": cents(1.5),
          "growth-fund": cents(0),
          "income-defensive-fund": cents(0),
        }),
      ).toThrow(RangeError);
    });

    it("rejects non-object input", () => {
      expect(() =>
        totalPublicMarketValueCents(
          null as unknown as typeof createZeroPublicMarketPortfolio extends () => infer R
            ? R
            : never,
        ),
      ).toThrow(TypeError);
    });
  });

  describe("calculateQuarterlyYieldCents", () => {
    it("reproduces exact HALF_UP rounding boundary fixture from Section 8", () => {
      // 100 cents × 200 BPS / 40000 = 0.5 cents -> 1 cent
      const yieldCents = calculateQuarterlyYieldCents({
        principalCents: 100,
        annualYieldBps: 200,
      });
      expect(yieldCents).toBe(cents(1));
    });

    it("rounds down below 0.5 cents and rounds up at or above 0.5 cents", () => {
      // 100 × 100 / 40000 = 0.25 cents -> 0 cents
      expect(
        calculateQuarterlyYieldCents({
          principalCents: 100,
          annualYieldBps: 100,
        }),
      ).toBe(cents(0));

      // 100 × 300 / 40000 = 0.75 cents -> 1 cent
      expect(
        calculateQuarterlyYieldCents({
          principalCents: 100,
          annualYieldBps: 300,
        }),
      ).toBe(cents(1));
    });

    it("returns zero when principal is zero or yield is zero", () => {
      expect(
        calculateQuarterlyYieldCents({
          principalCents: 0,
          annualYieldBps: 300,
        }),
      ).toBe(cents(0));

      expect(
        calculateQuarterlyYieldCents({
          principalCents: 1_000_000,
          annualYieldBps: 0,
        }),
      ).toBe(cents(0));
    });

    it("calculates representative opening cash yield (3.00% annual)", () => {
      // $50,000 = 5,000,000 cents
      // 5,000,000 × 300 / 40000 = 37,500 cents ($375.00)
      const cashYield = calculateQuarterlyYieldCents({
        principalCents: 5_000_000,
        annualYieldBps: STANDARD_V1_OPENING_CASH_YIELD_BPS,
      });
      expect(cashYield).toBe(cents(37_500));
    });

    it("rejects negative or non-safe integer inputs", () => {
      expect(() =>
        calculateQuarterlyYieldCents({
          principalCents: -100,
          annualYieldBps: 300,
        }),
      ).toThrow(RangeError);

      expect(() =>
        calculateQuarterlyYieldCents({
          principalCents: 100,
          annualYieldBps: -50,
        }),
      ).toThrow(RangeError);

      expect(() =>
        calculateQuarterlyYieldCents({
          principalCents: 10.5,
          annualYieldBps: 300,
        }),
      ).toThrow(RangeError);
    });

    it("verifies dividend calculation for all three instruments across synthetic holdings", () => {
      // Test $10,000 (1,000,000 cents) across all three instruments:
      const broadYield = calculateQuarterlyYieldCents({
        principalCents: 1_000_000,
        annualYieldBps:
          PUBLIC_MARKET_INSTRUMENTS["broad-market-fund"].annualDividendYieldBps, // 150 BPS
      });
      // 1,000,000 × 150 / 40000 = 3,750 cents ($37.50)
      expect(broadYield).toBe(cents(3_750));

      const growthYield = calculateQuarterlyYieldCents({
        principalCents: 1_000_000,
        annualYieldBps:
          PUBLIC_MARKET_INSTRUMENTS["growth-fund"].annualDividendYieldBps, // 50 BPS
      });
      // 1,000,000 × 50 / 40000 = 1,250 cents ($12.50)
      expect(growthYield).toBe(cents(1_250));

      const defensiveYield = calculateQuarterlyYieldCents({
        principalCents: 1_000_000,
        annualYieldBps:
          PUBLIC_MARKET_INSTRUMENTS["income-defensive-fund"]
            .annualDividendYieldBps, // 350 BPS
      });
      // 1,000,000 × 350 / 40000 = 8,750 cents ($87.50)
      expect(defensiveYield).toBe(cents(8_750));
    });
  });

  describe("calculateRevaluedMarketValueCents (Section 14 & 15)", () => {
    it("handles positive exact price movement (+2.00%)", () => {
      // $10,000 = 1,000,000 cents with +200 BPS (+2.00%)
      // 1,000,000 * 10,200 / 10,000 = 1,020,000 cents ($10,200)
      const revalued = calculateRevaluedMarketValueCents({
        currentValueCents: 1_000_000,
        returnBps: 200,
      });
      expect(revalued).toBe(cents(1_020_000));
    });

    it("handles negative exact price movement (-4.00%)", () => {
      // $10,000 = 1,000,000 cents with -400 BPS (-4.00%)
      // 1,000,000 * 9,600 / 10,000 = 960,000 cents ($9,600)
      const revalued = calculateRevaluedMarketValueCents({
        currentValueCents: 1_000_000,
        returnBps: -400,
      });
      expect(revalued).toBe(cents(960_000));
    });

    it("proves ROUND_HALF_UP behavior on exact half-cent boundaries", () => {
      // 1 cent with +5000 BPS (+50%): 1 * 1.5 = 1.5 cents -> 2 cents
      expect(
        calculateRevaluedMarketValueCents({
          currentValueCents: 1,
          returnBps: 5000,
        }),
      ).toBe(cents(2));

      // 1 cent with +4999 BPS: 1 * 1.4999 = 1.4999 -> 1 cent
      expect(
        calculateRevaluedMarketValueCents({
          currentValueCents: 1,
          returnBps: 4999,
        }),
      ).toBe(cents(1));

      // 3 cents with +5000 BPS: 3 * 1.5 = 4.5 cents -> 5 cents
      expect(
        calculateRevaluedMarketValueCents({
          currentValueCents: 3,
          returnBps: 5000,
        }),
      ).toBe(cents(5));

      // 3 cents with -5000 BPS: 3 * 0.5 = 1.5 cents -> 2 cents
      expect(
        calculateRevaluedMarketValueCents({
          currentValueCents: 3,
          returnBps: -5000,
        }),
      ).toBe(cents(2));
    });

    it("preserves zero holdings: 0 -> 0", () => {
      expect(
        calculateRevaluedMarketValueCents({
          currentValueCents: 0,
          returnBps: 500,
        }),
      ).toBe(cents(0));

      expect(
        calculateRevaluedMarketValueCents({
          currentValueCents: 0,
          returnBps: -500,
        }),
      ).toBe(cents(0));
    });

    it("rejects overflow on near MAX_SAFE_INTEGER holdings", () => {
      expect(() =>
        calculateRevaluedMarketValueCents({
          currentValueCents: Number.MAX_SAFE_INTEGER,
          returnBps: 200,
        }),
      ).toThrow(RangeError);
    });

    it("rejects returns below -100% (-10000 BPS) that would yield a negative multiplier", () => {
      expect(() =>
        calculateRevaluedMarketValueCents({
          currentValueCents: 10_000,
          returnBps: -10_001,
        }),
      ).toThrow(RangeError);

      // -10000 BPS is exactly -100% (multiplier 0) -> 0 cents
      expect(
        calculateRevaluedMarketValueCents({
          currentValueCents: 10_000,
          returnBps: -10_000,
        }),
      ).toBe(cents(0));
    });

    it("rejects negative current values and non-safe integers", () => {
      expect(() =>
        calculateRevaluedMarketValueCents({
          currentValueCents: -1,
          returnBps: 100,
        }),
      ).toThrow(RangeError);

      expect(() =>
        calculateRevaluedMarketValueCents({
          currentValueCents: 100,
          returnBps: 1.5,
        }),
      ).toThrow(RangeError);

      expect(() =>
        calculateRevaluedMarketValueCents({
          currentValueCents: 100.5,
          returnBps: 100,
        }),
      ).toThrow(RangeError);
    });
  });

  describe("revaluePublicMarketPortfolio (Section 16)", () => {
    it("revalues every instrument in canonical order with individual instrument returns", () => {
      const initial = {
        "broad-market-fund": cents(1_000_000), // +200 BPS (+2%) -> 1,020,000
        "growth-fund": cents(2_000_000), // +500 BPS (+5%) -> 2,100,000
        "income-defensive-fund": cents(500_000), // -200 BPS (-2%) -> 490,000
      };

      const returns = {
        "broad-market-fund": 200,
        "growth-fund": 500,
        "income-defensive-fund": -200,
      };

      const revalued = revaluePublicMarketPortfolio(initial, returns);
      expect(revalued["broad-market-fund"]).toBe(cents(1_020_000));
      expect(revalued["growth-fund"]).toBe(cents(2_100_000));
      expect(revalued["income-defensive-fund"]).toBe(cents(490_000));
      expect(totalPublicMarketValueCents(revalued)).toBe(cents(3_610_000));
    });
  });
});
