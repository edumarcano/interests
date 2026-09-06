import {
  PUBLIC_MARKET_INSTRUMENTS,
  STANDARD_V1_OPENING_CASH_YIELD_BPS,
} from "@finance-game/rules";
import { describe, expect, it } from "vitest";

import {
  calculateQuarterlyYieldCents,
  createZeroPublicMarketPortfolio,
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
});
