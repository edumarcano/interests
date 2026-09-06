export const PUBLIC_MARKET_INSTRUMENT_IDS = [
  "broad-market-fund",
  "growth-fund",
  "income-defensive-fund",
] as const;

export type PublicMarketInstrumentId =
  (typeof PUBLIC_MARKET_INSTRUMENT_IDS)[number];

export interface PublicMarketInstrumentDefinition {
  readonly id: PublicMarketInstrumentId;
  readonly name: string;
  readonly annualDividendYieldBps: number;
}

export const PUBLIC_MARKET_INSTRUMENTS: Readonly<
  Record<PublicMarketInstrumentId, PublicMarketInstrumentDefinition>
> = {
  "broad-market-fund": {
    id: "broad-market-fund",
    name: "Broad Market Fund",
    annualDividendYieldBps: 150,
  },
  "growth-fund": {
    id: "growth-fund",
    name: "Growth Fund",
    annualDividendYieldBps: 50,
  },
  "income-defensive-fund": {
    id: "income-defensive-fund",
    name: "Income / Defensive Fund",
    annualDividendYieldBps: 350,
  },
};

export const STANDARD_V1_OPENING_BASE_RATE_BPS = 450 as const;
export const CASH_YIELD_OFFSET_BPS = 150 as const;
export const CASH_YIELD_FLOOR_BPS = 50 as const;
export const STANDARD_V1_OPENING_CASH_YIELD_BPS = 300 as const;
export const STANDARD_V1_OPENING_PUBLIC_MARKET_INSTRUMENT_ID: PublicMarketInstrumentId =
  "broad-market-fund" as const;

export function calculateCashYieldBps(baseRateBps: number): number {
  if (!Number.isSafeInteger(baseRateBps) || baseRateBps < 0) {
    throw new RangeError(
      "baseRateBps must be a non-negative safe integer of basis points",
    );
  }
  return Math.max(CASH_YIELD_FLOOR_BPS, baseRateBps - CASH_YIELD_OFFSET_BPS);
}

export function isPublicMarketInstrumentId(
  value: unknown,
): value is PublicMarketInstrumentId {
  return (
    typeof value === "string" &&
    PUBLIC_MARKET_INSTRUMENT_IDS.includes(value as PublicMarketInstrumentId)
  );
}
