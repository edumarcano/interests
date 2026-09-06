import type { PublicMarketInstrumentId } from "./markets";

export const ECONOMIC_REGIME_IDS = [
  "expansion",
  "overheating",
  "slowdown",
  "recession",
  "recovery",
] as const;

export type EconomicRegimeId = (typeof ECONOMIC_REGIME_IDS)[number];

export const STANDARD_V1_STARTING_REGIME: EconomicRegimeId =
  "expansion" as const;

export function isEconomicRegimeId(value: unknown): value is EconomicRegimeId {
  return (
    typeof value === "string" &&
    ECONOMIC_REGIME_IDS.includes(value as EconomicRegimeId)
  );
}

export const ECONOMIC_REGIME_TRANSITION_PERCENT: Readonly<
  Record<EconomicRegimeId, Readonly<Record<EconomicRegimeId, number>>>
> = {
  expansion: {
    expansion: 75,
    overheating: 20,
    slowdown: 5,
    recession: 0,
    recovery: 0,
  },
  overheating: {
    expansion: 10,
    overheating: 60,
    slowdown: 30,
    recession: 0,
    recovery: 0,
  },
  slowdown: {
    expansion: 0,
    overheating: 5,
    slowdown: 60,
    recession: 30,
    recovery: 5,
  },
  recession: {
    expansion: 0,
    overheating: 0,
    slowdown: 10,
    recession: 55,
    recovery: 35,
  },
  recovery: {
    expansion: 45,
    overheating: 0,
    slowdown: 5,
    recession: 0,
    recovery: 50,
  },
};

export const PUBLIC_MARKET_REGIME_MEANS_BPS: Readonly<
  Record<EconomicRegimeId, Readonly<Record<PublicMarketInstrumentId, number>>>
> = {
  expansion: {
    "broad-market-fund": 200,
    "growth-fund": 280,
    "income-defensive-fund": 120,
  },
  overheating: {
    "broad-market-fund": 100,
    "growth-fund": 50,
    "income-defensive-fund": 120,
  },
  slowdown: {
    "broad-market-fund": -100,
    "growth-fund": -200,
    "income-defensive-fund": 0,
  },
  recession: {
    "broad-market-fund": -400,
    "growth-fund": -650,
    "income-defensive-fund": -150,
  },
  recovery: {
    "broad-market-fund": 350,
    "growth-fund": 500,
    "income-defensive-fund": 200,
  },
};

export const PUBLIC_MARKET_NOISE_AMPLITUDE_BPS: Readonly<
  Record<PublicMarketInstrumentId, number>
> = {
  "broad-market-fund": 400,
  "growth-fund": 600,
  "income-defensive-fund": 250,
};
