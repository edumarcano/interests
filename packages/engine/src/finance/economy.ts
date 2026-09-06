import {
  ECONOMIC_REGIME_IDS,
  ECONOMIC_REGIME_TRANSITION_PERCENT,
  type EconomicRegimeId,
  isEconomicRegimeId,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_NOISE_AMPLITUDE_BPS,
  PUBLIC_MARKET_REGIME_MEANS_BPS,
  type PublicMarketInstrumentId,
} from "@finance-game/rules";

import { drawBoundedInt, type RandomState } from "../random/prng";

/**
 * Pure helper mapping (currentRegime, integer roll 0..99) to next regime
 * using canonical regime order and cumulative percentage thresholds.
 */
export function selectNextEconomicRegime(
  currentRegime: EconomicRegimeId,
  roll: number,
): EconomicRegimeId {
  if (!isEconomicRegimeId(currentRegime)) {
    throw new RangeError(`Unknown economic regime: ${String(currentRegime)}`);
  }

  if (!Number.isSafeInteger(roll) || roll < 0 || roll >= 100) {
    throw new RangeError(
      `Transition roll must be a safe integer within [0, 99], got ${String(roll)}`,
    );
  }

  const row = ECONOMIC_REGIME_TRANSITION_PERCENT[currentRegime];
  let cumulative = 0;

  for (const destination of ECONOMIC_REGIME_IDS) {
    const probability = row[destination];
    cumulative += probability;
    if (roll < cumulative) {
      return destination;
    }
  }

  throw new Error(
    `Invariant violation: transition probabilities for ${currentRegime} did not cover roll ${roll} (cumulative ${cumulative})`,
  );
}

export interface MarketNoiseDraw {
  readonly value: number;
  readonly nextState: RandomState;
}

/**
 * Pure market noise helper for bounded discrete uniform noise in integer basis points:
 *
 *   noise in [-amplitudeBps, +amplitudeBps]
 *   bound = 2 * amplitudeBps + 1
 *   draw = drawBoundedInt(random, bound)
 *   noise = draw.value - amplitudeBps
 */
export function drawMarketNoiseBps(
  random: RandomState,
  amplitudeBps: number,
): MarketNoiseDraw {
  if (!Number.isSafeInteger(amplitudeBps) || amplitudeBps < 0) {
    throw new RangeError(
      `amplitudeBps must be a non-negative safe integer, got ${String(amplitudeBps)}`,
    );
  }

  const bound = 2 * amplitudeBps + 1;
  if (!Number.isSafeInteger(bound) || bound <= 0) {
    throw new RangeError(
      `Derived bound ${bound} exceeds safe integer limits for amplitude ${amplitudeBps}`,
    );
  }

  const draw = drawBoundedInt(random, bound);
  const noise = draw.value - amplitudeBps;

  return {
    value: noise,
    nextState: draw.nextState,
  };
}

export interface GeneratedQuarterMarketUpdate {
  readonly returnBpsByInstrument: Readonly<
    Record<PublicMarketInstrumentId, number>
  >;
  readonly regimeUsed: EconomicRegimeId;
  readonly nextRegime: EconomicRegimeId;
  readonly nextRandom: RandomState;
}

/**
 * Pure quarterly market return and regime transition generator.
 *
 * Consumes RNG in exact approved canonical order (TASK.md E9):
 *   1. Broad Market Fund noise
 *   2. Growth Fund noise
 *   3. Income / Defensive Fund noise
 *   4. Next-regime transition roll
 *
 * Generates one shared return per instrument independent of player portfolios.
 */
export function generateQuarterMarketUpdate(input: {
  readonly regime: EconomicRegimeId;
  readonly random: RandomState;
}): GeneratedQuarterMarketUpdate {
  if (!isEconomicRegimeId(input.regime)) {
    throw new RangeError(`Unknown economic regime: ${String(input.regime)}`);
  }

  let currentRandom = input.random;
  const returnBpsByInstrument: Record<PublicMarketInstrumentId, number> =
    {} as Record<PublicMarketInstrumentId, number>;

  const means = PUBLIC_MARKET_REGIME_MEANS_BPS[input.regime];

  // 1-3. Draw noise for Broad, Growth, Income/Defensive in canonical instrument order
  for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
    const amplitude = PUBLIC_MARKET_NOISE_AMPLITUDE_BPS[instrumentId];
    const noiseDraw = drawMarketNoiseBps(currentRandom, amplitude);
    currentRandom = noiseDraw.nextState;

    const mean = means[instrumentId];
    const totalReturnBps = mean + noiseDraw.value;
    if (!Number.isSafeInteger(totalReturnBps)) {
      throw new RangeError(
        `Calculated return for ${instrumentId} exceeds safe integer limits: ${mean} + ${noiseDraw.value}`,
      );
    }
    returnBpsByInstrument[instrumentId] = totalReturnBps;
  }

  // 4. Draw next-regime transition roll (0..99)
  const transitionDraw = drawBoundedInt(currentRandom, 100);
  const nextRegime = selectNextEconomicRegime(
    input.regime,
    transitionDraw.value,
  );

  return {
    returnBpsByInstrument,
    regimeUsed: input.regime,
    nextRegime,
    nextRandom: transitionDraw.nextState,
  };
}
