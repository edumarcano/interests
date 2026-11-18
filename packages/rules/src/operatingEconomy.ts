import type { EconomicRegimeId } from "./economy";

export const PROPERTY_MARKET_KINDS = ["residential", "commercial"] as const;
export type PropertyMarketKind = (typeof PROPERTY_MARKET_KINDS)[number];

export const PROPERTY_RETURN_MEANS_BPS = Object.freeze({
  expansion: Object.freeze({ residential: 100, commercial: 120 }),
  overheating: Object.freeze({ residential: 50, commercial: 30 }),
  slowdown: Object.freeze({ residential: -50, commercial: -100 }),
  recession: Object.freeze({ residential: -150, commercial: -300 }),
  recovery: Object.freeze({ residential: 100, commercial: 150 }),
} as const satisfies Record<
  EconomicRegimeId,
  Record<PropertyMarketKind, number>
>);
export const PROPERTY_RETURN_NOISE_BPS = Object.freeze({
  residential: 75,
  commercial: 125,
});

export const BUSINESS_REVENUE_EFFECT_BPS = Object.freeze({
  expansion: 100,
  overheating: 50,
  slowdown: -150,
  recession: -400,
  recovery: 200,
} as const satisfies Record<EconomicRegimeId, number>);
export const BUSINESS_SENSITIVITY = Object.freeze({
  low: Object.freeze({ multiplierBps: 5_000, noiseBps: 200 }),
  medium: Object.freeze({ multiplierBps: 10_000, noiseBps: 350 }),
  high: Object.freeze({ multiplierBps: 15_000, noiseBps: 500 }),
});
export type BusinessSensitivity = keyof typeof BUSINESS_SENSITIVITY;

export const PROPERTY_OCCUPANCY_TARGET_BPS = Object.freeze({
  expansion: Object.freeze({ residential: 9600, commercial: 9400 }),
  overheating: Object.freeze({ residential: 9800, commercial: 9700 }),
  slowdown: Object.freeze({ residential: 9400, commercial: 9000 }),
  recession: Object.freeze({ residential: 8800, commercial: 8000 }),
  recovery: Object.freeze({ residential: 9500, commercial: 9000 }),
} as const satisfies Record<
  EconomicRegimeId,
  Record<PropertyMarketKind, number>
>);
export const STARTING_BUSINESS_SENSITIVITY = Object.freeze({
  "small-business-owner": "medium",
  "self-employed-operator": "low",
  "early-stage-entrepreneur": "high",
} as const);
