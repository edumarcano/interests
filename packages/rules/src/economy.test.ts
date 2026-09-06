import { describe, expect, it } from "vitest";

import {
  ECONOMIC_REGIME_IDS,
  ECONOMIC_REGIME_TRANSITION_PERCENT,
  type EconomicRegimeId,
  isEconomicRegimeId,
  PUBLIC_MARKET_NOISE_AMPLITUDE_BPS,
  PUBLIC_MARKET_REGIME_MEANS_BPS,
  STANDARD_V1_STARTING_REGIME,
} from "./economy";
import { PUBLIC_MARKET_INSTRUMENT_IDS } from "./markets";

describe("economy rules", () => {
  it("defines the five canonical Standard V1 regimes in exact canonical order", () => {
    expect(ECONOMIC_REGIME_IDS).toEqual([
      "expansion",
      "overheating",
      "slowdown",
      "recession",
      "recovery",
    ]);
  });

  it("sets Standard V1 starting regime to expansion", () => {
    expect(STANDARD_V1_STARTING_REGIME).toBe("expansion");
  });

  it("provides an accurate isEconomicRegimeId type guard", () => {
    for (const regime of ECONOMIC_REGIME_IDS) {
      expect(isEconomicRegimeId(regime)).toBe(true);
    }
    expect(isEconomicRegimeId("depression")).toBe(false);
    expect(isEconomicRegimeId("boom")).toBe(false);
    expect(isEconomicRegimeId(null)).toBe(false);
    expect(isEconomicRegimeId(undefined)).toBe(false);
    expect(isEconomicRegimeId(123)).toBe(false);
    expect(isEconomicRegimeId({})).toBe(false);
  });

  describe("transition matrix (E3)", () => {
    it("has exactly five rows and five destinations per row matching canonical regimes", () => {
      const rows = Object.keys(
        ECONOMIC_REGIME_TRANSITION_PERCENT,
      ) as EconomicRegimeId[];
      expect(rows).toEqual([...ECONOMIC_REGIME_IDS]);

      for (const regime of ECONOMIC_REGIME_IDS) {
        const destinations = Object.keys(
          ECONOMIC_REGIME_TRANSITION_PERCENT[regime],
        ) as EconomicRegimeId[];
        expect(destinations).toEqual([...ECONOMIC_REGIME_IDS]);
      }
    });

    it("ensures every probability is a non-negative safe integer and every row totals exactly 100", () => {
      for (const regime of ECONOMIC_REGIME_IDS) {
        const row = ECONOMIC_REGIME_TRANSITION_PERCENT[regime];
        let total = 0;
        for (const dest of ECONOMIC_REGIME_IDS) {
          const prob = row[dest];
          expect(Number.isSafeInteger(prob)).toBe(true);
          expect(prob).toBeGreaterThanOrEqual(0);
          expect(prob).toBeLessThanOrEqual(100);
          total += prob;
        }
        expect(total).toBe(100);
      }
    });

    it("matches the exact approved prototype transition probabilities", () => {
      expect(ECONOMIC_REGIME_TRANSITION_PERCENT.expansion).toEqual({
        expansion: 75,
        overheating: 20,
        slowdown: 5,
        recession: 0,
        recovery: 0,
      });

      expect(ECONOMIC_REGIME_TRANSITION_PERCENT.overheating).toEqual({
        expansion: 10,
        overheating: 60,
        slowdown: 30,
        recession: 0,
        recovery: 0,
      });

      expect(ECONOMIC_REGIME_TRANSITION_PERCENT.slowdown).toEqual({
        expansion: 0,
        overheating: 5,
        slowdown: 60,
        recession: 30,
        recovery: 5,
      });

      expect(ECONOMIC_REGIME_TRANSITION_PERCENT.recession).toEqual({
        expansion: 0,
        overheating: 0,
        slowdown: 10,
        recession: 55,
        recovery: 35,
      });

      expect(ECONOMIC_REGIME_TRANSITION_PERCENT.recovery).toEqual({
        expansion: 45,
        overheating: 0,
        slowdown: 5,
        recession: 0,
        recovery: 50,
      });
    });
  });

  describe("market regime means (E5)", () => {
    it("has entries for all regimes and instruments with safe integer basis points", () => {
      for (const regime of ECONOMIC_REGIME_IDS) {
        const means = PUBLIC_MARKET_REGIME_MEANS_BPS[regime];
        expect(means).toBeDefined();
        for (const instrument of PUBLIC_MARKET_INSTRUMENT_IDS) {
          const meanBps = means[instrument];
          expect(Number.isSafeInteger(meanBps)).toBe(true);
        }
      }
    });

    it("matches the approved prototype quarterly price movement means in basis points", () => {
      expect(PUBLIC_MARKET_REGIME_MEANS_BPS.expansion).toEqual({
        "broad-market-fund": 200,
        "growth-fund": 280,
        "income-defensive-fund": 120,
      });

      expect(PUBLIC_MARKET_REGIME_MEANS_BPS.overheating).toEqual({
        "broad-market-fund": 100,
        "growth-fund": 50,
        "income-defensive-fund": 120,
      });

      expect(PUBLIC_MARKET_REGIME_MEANS_BPS.slowdown).toEqual({
        "broad-market-fund": -100,
        "growth-fund": -200,
        "income-defensive-fund": 0,
      });

      expect(PUBLIC_MARKET_REGIME_MEANS_BPS.recession).toEqual({
        "broad-market-fund": -400,
        "growth-fund": -650,
        "income-defensive-fund": -150,
      });

      expect(PUBLIC_MARKET_REGIME_MEANS_BPS.recovery).toEqual({
        "broad-market-fund": 350,
        "growth-fund": 500,
        "income-defensive-fund": 200,
      });
    });
  });

  describe("market noise amplitudes (E6)", () => {
    it("defines exact inclusive half-ranges in basis points", () => {
      expect(PUBLIC_MARKET_NOISE_AMPLITUDE_BPS).toEqual({
        "broad-market-fund": 400,
        "growth-fund": 600,
        "income-defensive-fund": 250,
      });

      for (const instrument of PUBLIC_MARKET_INSTRUMENT_IDS) {
        const amp = PUBLIC_MARKET_NOISE_AMPLITUDE_BPS[instrument];
        expect(Number.isSafeInteger(amp)).toBe(true);
        expect(amp).toBeGreaterThan(0);
      }
    });
  });
});
