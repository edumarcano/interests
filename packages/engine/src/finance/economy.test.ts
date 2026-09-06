import {
  type EconomicRegimeId,
  PUBLIC_MARKET_NOISE_AMPLITUDE_BPS,
  PUBLIC_MARKET_REGIME_MEANS_BPS,
} from "@finance-game/rules";
import { describe, expect, it } from "vitest";

import { createRandomState, drawBoundedInt } from "../random/prng";
import {
  drawMarketNoiseBps,
  generateQuarterMarketUpdate,
  selectNextEconomicRegime,
} from "./economy";

describe("selectNextEconomicRegime (Section 9 & 10)", () => {
  describe("Expansion transitions", () => {
    it("handles boundary rolls correctly", () => {
      // 0..74 -> expansion (75%)
      expect(selectNextEconomicRegime("expansion", 0)).toBe("expansion");
      expect(selectNextEconomicRegime("expansion", 74)).toBe("expansion");
      // 75..94 -> overheating (20%)
      expect(selectNextEconomicRegime("expansion", 75)).toBe("overheating");
      expect(selectNextEconomicRegime("expansion", 94)).toBe("overheating");
      // 95..99 -> slowdown (5%)
      expect(selectNextEconomicRegime("expansion", 95)).toBe("slowdown");
      expect(selectNextEconomicRegime("expansion", 99)).toBe("slowdown");
    });
  });

  describe("Overheating transitions", () => {
    it("handles boundary rolls correctly", () => {
      // 0..9 -> expansion (10%)
      expect(selectNextEconomicRegime("overheating", 0)).toBe("expansion");
      expect(selectNextEconomicRegime("overheating", 9)).toBe("expansion");
      // 10..69 -> overheating (60%)
      expect(selectNextEconomicRegime("overheating", 10)).toBe("overheating");
      expect(selectNextEconomicRegime("overheating", 69)).toBe("overheating");
      // 70..99 -> slowdown (30%)
      expect(selectNextEconomicRegime("overheating", 70)).toBe("slowdown");
      expect(selectNextEconomicRegime("overheating", 99)).toBe("slowdown");
    });
  });

  describe("Slowdown transitions", () => {
    it("handles boundary rolls correctly (expansion has 0% interval)", () => {
      // 0..4 -> overheating (5%)
      expect(selectNextEconomicRegime("slowdown", 0)).toBe("overheating");
      expect(selectNextEconomicRegime("slowdown", 4)).toBe("overheating");
      // 5..64 -> slowdown (60%)
      expect(selectNextEconomicRegime("slowdown", 5)).toBe("slowdown");
      expect(selectNextEconomicRegime("slowdown", 64)).toBe("slowdown");
      // 65..94 -> recession (30%)
      expect(selectNextEconomicRegime("slowdown", 65)).toBe("recession");
      expect(selectNextEconomicRegime("slowdown", 94)).toBe("recession");
      // 95..99 -> recovery (5%)
      expect(selectNextEconomicRegime("slowdown", 95)).toBe("recovery");
      expect(selectNextEconomicRegime("slowdown", 99)).toBe("recovery");
    });
  });

  describe("Recession transitions", () => {
    it("handles boundary rolls correctly", () => {
      // 0..9 -> slowdown (10%)
      expect(selectNextEconomicRegime("recession", 0)).toBe("slowdown");
      expect(selectNextEconomicRegime("recession", 9)).toBe("slowdown");
      // 10..64 -> recession (55%)
      expect(selectNextEconomicRegime("recession", 10)).toBe("recession");
      expect(selectNextEconomicRegime("recession", 64)).toBe("recession");
      // 65..99 -> recovery (35%)
      expect(selectNextEconomicRegime("recession", 65)).toBe("recovery");
      expect(selectNextEconomicRegime("recession", 99)).toBe("recovery");
    });
  });

  describe("Recovery transitions", () => {
    it("handles boundary rolls correctly", () => {
      // 0..44 -> expansion (45%)
      expect(selectNextEconomicRegime("recovery", 0)).toBe("expansion");
      expect(selectNextEconomicRegime("recovery", 44)).toBe("expansion");
      // 45..49 -> slowdown (5%)
      expect(selectNextEconomicRegime("recovery", 45)).toBe("slowdown");
      expect(selectNextEconomicRegime("recovery", 49)).toBe("slowdown");
      // 50..99 -> recovery (50%)
      expect(selectNextEconomicRegime("recovery", 50)).toBe("recovery");
      expect(selectNextEconomicRegime("recovery", 99)).toBe("recovery");
    });
  });

  describe("Rejection of invalid inputs", () => {
    it("rejects rolls outside [0, 99] and non-safe-integer values", () => {
      expect(() => selectNextEconomicRegime("expansion", -1)).toThrow(
        RangeError,
      );
      expect(() => selectNextEconomicRegime("expansion", 100)).toThrow(
        RangeError,
      );
      expect(() => selectNextEconomicRegime("expansion", 50.5)).toThrow(
        RangeError,
      );
      expect(() => selectNextEconomicRegime("expansion", Number.NaN)).toThrow(
        RangeError,
      );
      expect(() =>
        selectNextEconomicRegime("expansion", Number.POSITIVE_INFINITY),
      ).toThrow(RangeError);
      expect(() =>
        selectNextEconomicRegime(
          "invalid-regime" as unknown as EconomicRegimeId,
          50,
        ),
      ).toThrow(RangeError);
    });
  });
});

describe("drawMarketNoiseBps (Section 11)", () => {
  it("draws bounded discrete uniform noise within [-amplitude, +amplitude]", () => {
    const random = createRandomState("noise-test-seed");
    const amplitude = 400; // Broad Market Fund

    let current = random;
    const minSeen = { val: Number.POSITIVE_INFINITY };
    const maxSeen = { val: Number.NEGATIVE_INFINITY };

    for (let i = 0; i < 500; i += 1) {
      const { value, nextState } = drawMarketNoiseBps(current, amplitude);
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-amplitude);
      expect(value).toBeLessThanOrEqual(amplitude);
      if (value < minSeen.val) minSeen.val = value;
      if (value > maxSeen.val) maxSeen.val = value;
      current = nextState;
    }

    // Over 500 draws with uniform range [-400, 400], we should see positive and negative values
    expect(minSeen.val).toBeLessThan(0);
    expect(maxSeen.val).toBeGreaterThan(0);
  });

  it("handles zero amplitude by returning 0 and advancing RNG with bound 1", () => {
    const random = createRandomState("zero-amplitude-seed");
    const { value, nextState } = drawMarketNoiseBps(random, 0);
    expect(value).toBe(0);
    expect(nextState.state).not.toBe(random.state);
  });

  it("rejects negative or non-safe integer amplitudes", () => {
    const random = createRandomState("invalid-amplitude-seed");
    expect(() => drawMarketNoiseBps(random, -1)).toThrow(RangeError);
    expect(() => drawMarketNoiseBps(random, 1.5)).toThrow(RangeError);
    expect(() => drawMarketNoiseBps(random, Number.NaN)).toThrow(RangeError);
  });
});

describe("generateQuarterMarketUpdate (Section 12 & 13)", () => {
  it("consumes RNG in exact canonical order: Broad -> Growth -> Defensive -> regime", () => {
    const startRandom = createRandomState("canonical-rng-order-seed");

    // Manually step through the exact 4 approved draws
    const d1 = drawMarketNoiseBps(
      startRandom,
      PUBLIC_MARKET_NOISE_AMPLITUDE_BPS["broad-market-fund"],
    );
    const d2 = drawMarketNoiseBps(
      d1.nextState,
      PUBLIC_MARKET_NOISE_AMPLITUDE_BPS["growth-fund"],
    );
    const d3 = drawMarketNoiseBps(
      d2.nextState,
      PUBLIC_MARKET_NOISE_AMPLITUDE_BPS["income-defensive-fund"],
    );
    const d4 = drawBoundedInt(d3.nextState, 100);
    const expectedNextRegime = selectNextEconomicRegime("expansion", d4.value);

    // Call generateQuarterMarketUpdate
    const update = generateQuarterMarketUpdate({
      regime: "expansion",
      random: startRandom,
    });

    const expansionMeans = PUBLIC_MARKET_REGIME_MEANS_BPS.expansion;
    expect(update.returnBpsByInstrument["broad-market-fund"]).toBe(
      expansionMeans["broad-market-fund"] + d1.value,
    );
    expect(update.returnBpsByInstrument["growth-fund"]).toBe(
      expansionMeans["growth-fund"] + d2.value,
    );
    expect(update.returnBpsByInstrument["income-defensive-fund"]).toBe(
      expansionMeans["income-defensive-fund"] + d3.value,
    );
    expect(update.regimeUsed).toBe("expansion");
    expect(update.nextRegime).toBe(expectedNextRegime);
    expect(update.nextRandom).toEqual(d4.nextState);
  });

  it("is structurally holdings-independent: identical regime + RandomState generates identical returns and next regime", () => {
    const random = createRandomState("holdings-independence-seed");

    const update1 = generateQuarterMarketUpdate({
      regime: "expansion",
      random,
    });
    const update2 = generateQuarterMarketUpdate({
      regime: "expansion",
      random,
    });

    expect(update1).toEqual(update2);
  });
});
