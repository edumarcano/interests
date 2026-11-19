import {
  COMPLETION_ECONOMY_TARGETS,
  type EconomicRegimeId,
  OBJECTIVE_MEASUREMENT_RULES,
  OPERATING_RULES,
  PROPERTY_OCCUPANCY_TARGET_BPS,
  PROPERTY_RETURN_MEANS_BPS,
  PROPERTY_RETURN_NOISE_BPS,
  type PropertyMarketKind,
} from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import type {
  Asset,
  GameState,
  RecurringPersonalFinance,
} from "../model/gameState";
import type { RandomState } from "../random/prng";
import {
  calculateBusinessOperatingInputs,
  calculateNormalizedBusinessValueCents,
  generateBusinessRevenueMovement,
} from "./businessPerformance";
import type { BusinessSettlementOutcome } from "./businessSettlement";
import { FinanceDecimal } from "./decimal";
import { drawMarketNoiseBps } from "./economy";
import { calculateRevaluedMarketValueCents } from "./markets";
import { basisPoints, type Cents, cents, isNonNegativeCents } from "./money";

export function nextQuarterBaseRateBps(
  currentRateBps: number,
  nextRegime: EconomicRegimeId,
): number {
  if (!Number.isSafeInteger(currentRateBps) || currentRateBps < 0)
    throw new RangeError("Invalid base rate");
  const target = COMPLETION_ECONOMY_TARGETS[nextRegime]?.baseRateBps;
  if (target === undefined)
    throw new RangeError("Invalid next economic regime");
  return (
    currentRateBps +
    Math.sign(target - currentRateBps) *
      Math.min(
        Math.abs(target - currentRateBps),
        OPERATING_RULES.maxQuarterlyRateStepBps,
      )
  );
}

/** Nominal annual inflation / 4, rounded once to integer cents. */
export function indexQuarterlyAmountCents(
  amountCents: number,
  annualInflationBps: number,
): Cents {
  if (
    !isNonNegativeCents(amountCents) ||
    !Number.isSafeInteger(annualInflationBps) ||
    annualInflationBps < 0
  )
    throw new RangeError("Invalid inflation indexing input");
  return cents(
    new FinanceDecimal(amountCents)
      .times(new FinanceDecimal(40_000).plus(annualInflationBps))
      .dividedBy(40_000)
      .round()
      .toNumber(),
  );
}

/** Current-quarter regime plus this boundary's incremental rate change, applied once. */
export function propertyReturnForecast(input: {
  regime: EconomicRegimeId;
  marketKind: PropertyMarketKind;
  baseRateChangeBps: number;
}) {
  const mean = PROPERTY_RETURN_MEANS_BPS[input.regime]?.[input.marketKind];
  const amplitude = PROPERTY_RETURN_NOISE_BPS[input.marketKind];
  if (
    mean === undefined ||
    amplitude === undefined ||
    !Number.isSafeInteger(input.baseRateChangeBps)
  )
    throw new RangeError("Invalid property forecast input");
  const sensitivity =
    input.marketKind === "residential"
      ? OPERATING_RULES.residentialRateSensitivity
      : OPERATING_RULES.commercialRateSensitivity;
  const meanReturnBps = mean + sensitivity * input.baseRateChangeBps;
  if (!Number.isSafeInteger(meanReturnBps))
    throw new RangeError("Property return overflow");
  return {
    meanReturnBps,
    minimumReturnBps: meanReturnBps - amplitude,
    maximumReturnBps: meanReturnBps + amplitude,
    noiseAmplitudeBps: amplitude,
  };
}

export function nextPropertyOccupancyBps(
  currentOccupancyBps: number,
  regime: EconomicRegimeId,
  marketKind: PropertyMarketKind,
): number {
  const target = PROPERTY_OCCUPANCY_TARGET_BPS[regime]?.[marketKind];
  if (
    !Number.isSafeInteger(currentOccupancyBps) ||
    currentOccupancyBps < 0 ||
    currentOccupancyBps > 10_000 ||
    target === undefined
  )
    throw new RangeError("Invalid property occupancy input");
  return (
    currentOccupancyBps +
    Math.sign(target - currentOccupancyBps) *
      Math.min(
        Math.abs(target - currentOccupancyBps),
        OPERATING_RULES.maxQuarterlyOccupancyStepBps,
      )
  );
}

export interface QuarterOperatingUpdate {
  readonly assetsById: Readonly<Record<AssetId, Asset>>;
  readonly recurringByPlayer: Readonly<
    Record<PlayerId, RecurringPersonalFinance>
  >;
  readonly nextBaseRateBps: number;
  readonly nextOperatingRandom: RandomState;
}

/** Pure next-quarter planning; rejected settlement never commits these outputs. */
export function planQuarterOperatingUpdate(
  state: GameState,
  assets: GameState["finance"]["assetsById"],
  nextRegime: EconomicRegimeId,
  businesses: readonly BusinessSettlementOutcome[] = [],
): QuarterOperatingUpdate {
  const nextBaseRateBps = nextQuarterBaseRateBps(
    state.economy.baseRateBps,
    nextRegime,
  );
  const inflation =
    COMPLETION_ECONOMY_TARGETS[state.economy.currentRegime].annualInflationBps;
  const recurringByPlayer = { ...state.finance.recurringByPlayer };
  for (const playerId of state.playerOrder) {
    const current = recurringByPlayer[playerId];
    if (!current) throw new Error("Missing recurring finances");
    recurringByPlayer[playerId] = {
      ...current,
      quarterlyLivingExpenseCents: indexQuarterlyAmountCents(
        current.quarterlyLivingExpenseCents,
        inflation,
      ),
    };
  }
  const assetsById = { ...assets };
  let random = state.economy.operatingRandom;
  for (const id of Object.keys(assetsById).sort() as AssetId[]) {
    const asset = assetsById[id];
    if (!asset || (asset.kind === "property" && asset.disposition === "sold"))
      continue;
    if (asset.kind === "business") {
      const model = asset.operatingModel;
      if (!model) continue;
      const outcome = businesses.find((company) => company.assetId === id);
      const quarters = outcome
        ? [
            ...model.quarters,
            {
              quarter: state.currentQuarter,
              operatingProfitCents: outcome.operatingCashCents,
            },
          ].slice(-OBJECTIVE_MEASUREMENT_RULES.lookbackQuarters)
        : model.quarters;
      const movement = generateBusinessRevenueMovement({
        regime: state.economy.currentRegime,
        sensitivity: model.sensitivity,
        random,
      });
      random = movement.nextRandom;
      const inputs = calculateBusinessOperatingInputs(
        asset.annualRevenueCents,
        movement.revenueChangeBps,
        model,
      );
      assetsById[id] = {
        ...asset,
        annualRevenueCents: inputs.annualRevenueCents,
        annualOperatingProfitCents: cents(
          new FinanceDecimal(inputs.annualOperatingProfitCents)
            .plus(model.annualProfitAdjustmentCents)
            .toNumber(),
        ),
        enterpriseValueCents: calculateNormalizedBusinessValueCents({
          openingEnterpriseValueCents: model.openingEnterpriseValueCents,
          openingValuationEarningsCents: model.openingValuationEarningsCents,
          basis: model.valuationBasis,
          fixedAnnualLaborCostsCents: model.fixedAnnualLaborCostsCents,
          observedQuarterlyOperatingProfitCents: quarters.map(
            (observed) => observed.operatingProfitCents,
          ),
        }),
        operatingModel: { ...model, quarters },
      };
      continue;
    }
    let marketValueCents = asset.marketValueCents;
    let occupancyBps = asset.occupancyBps;
    if (asset.marketKind !== undefined) {
      occupancyBps = basisPoints(
        nextPropertyOccupancyBps(
          occupancyBps,
          state.economy.currentRegime,
          asset.marketKind,
        ),
      );
      const forecast = propertyReturnForecast({
        regime: state.economy.currentRegime,
        marketKind: asset.marketKind,
        baseRateChangeBps: nextBaseRateBps - state.economy.baseRateBps,
      });
      const noise = drawMarketNoiseBps(random, forecast.noiseAmplitudeBps);
      random = noise.nextState;
      marketValueCents = calculateRevaluedMarketValueCents({
        currentValueCents: marketValueCents,
        returnBps: forecast.meanReturnBps + noise.value,
      });
    }
    assetsById[id] = {
      ...asset,
      marketValueCents,
      scheduledQuarterlyRentCents: indexQuarterlyAmountCents(
        asset.scheduledQuarterlyRentCents,
        inflation,
      ),
      occupancyBps,
    };
  }
  return {
    assetsById,
    recurringByPlayer,
    nextBaseRateBps,
    nextOperatingRandom: random,
  };
}
