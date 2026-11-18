import {
  BUSINESS_REVENUE_EFFECT_BPS,
  BUSINESS_SENSITIVITY,
  type BusinessSensitivity,
  type EconomicRegimeId,
  OBJECTIVE_MEASUREMENT_RULES,
  OPERATING_RULES,
} from "@interests/rules";
import type { RandomState } from "../random/prng";
import { FinanceDecimal } from "./decimal";
import { drawMarketNoiseBps } from "./economy";
import { calculateRevaluedMarketValueCents } from "./markets";
import { type Cents, cents, isNonNegativeCents, isSafeCents } from "./money";

/** Data-only calibration supplied by an approved content template, never inferred. */
export interface BusinessOperatingCalibration {
  readonly referenceAnnualRevenueCents: Cents;
  readonly referenceAnnualNonLaborCostsCents: Cents;
  readonly fixedAnnualLaborCostsCents: Cents;
}

/** Bounded revenue movement from the explicit template sensitivity. */
export function generateBusinessRevenueMovement(input: {
  readonly regime: EconomicRegimeId;
  readonly sensitivity: BusinessSensitivity;
  readonly random: RandomState;
}) {
  const settings = BUSINESS_SENSITIVITY[input.sensitivity];
  const regimeEffect = BUSINESS_REVENUE_EFFECT_BPS[input.regime];
  if (!settings || regimeEffect === undefined)
    throw new RangeError("Invalid business performance inputs");
  const draw = drawMarketNoiseBps(input.random, settings.noiseBps);
  const movement =
    new FinanceDecimal(regimeEffect)
      .times(settings.multiplierBps)
      .dividedBy(10_000)
      .round()
      .toNumber() + draw.value;
  const cap = OPERATING_RULES.maxQuarterlyBusinessRevenueChangeBps;
  return {
    revenueChangeBps: Math.max(-cap, Math.min(cap, movement)),
    nextRandom: draw.nextState,
  };
}

/** Variable non-labor costs preserve the template ratio; necessary labor stays fixed. */
export function calculateBusinessOperatingInputs(
  currentAnnualRevenueCents: number,
  revenueChangeBps: number,
  calibration: BusinessOperatingCalibration,
) {
  if (
    !isNonNegativeCents(currentAnnualRevenueCents) ||
    !isNonNegativeCents(calibration.referenceAnnualRevenueCents) ||
    calibration.referenceAnnualRevenueCents === 0 ||
    !isNonNegativeCents(calibration.referenceAnnualNonLaborCostsCents) ||
    !isNonNegativeCents(calibration.fixedAnnualLaborCostsCents) ||
    !Number.isSafeInteger(revenueChangeBps) ||
    Math.abs(revenueChangeBps) >
      OPERATING_RULES.maxQuarterlyBusinessRevenueChangeBps
  )
    throw new RangeError("Invalid business operating calibration");
  const annualRevenueCents = calculateRevaluedMarketValueCents({
    currentValueCents: currentAnnualRevenueCents,
    returnBps: revenueChangeBps,
  });
  const annualNonLaborCostsCents = cents(
    new FinanceDecimal(annualRevenueCents)
      .times(calibration.referenceAnnualNonLaborCostsCents)
      .dividedBy(calibration.referenceAnnualRevenueCents)
      .round()
      .toNumber(),
  );
  const annualOperatingProfitCents = cents(
    new FinanceDecimal(annualRevenueCents)
      .minus(annualNonLaborCostsCents)
      .minus(calibration.fixedAnnualLaborCostsCents)
      .toNumber(),
  );
  return {
    annualRevenueCents,
    annualNonLaborCostsCents,
    fixedAnnualLaborCostsCents: calibration.fixedAnnualLaborCostsCents,
    annualOperatingProfitCents,
  };
}

/** The opening rational multiple remains fixed; only actual recent quarters normalize earnings. */
export function calculateNormalizedBusinessValueCents(input: {
  readonly openingEnterpriseValueCents: number;
  readonly openingValuationEarningsCents: number;
  readonly basis: "after-labor-profit" | "owner-earnings";
  readonly fixedAnnualLaborCostsCents: number;
  readonly observedQuarterlyOperatingProfitCents: readonly number[];
}): Cents {
  if (
    !isNonNegativeCents(input.openingEnterpriseValueCents) ||
    !isNonNegativeCents(input.openingValuationEarningsCents) ||
    input.openingValuationEarningsCents === 0 ||
    !isNonNegativeCents(input.fixedAnnualLaborCostsCents) ||
    !["after-labor-profit", "owner-earnings"].includes(input.basis) ||
    !Array.isArray(input.observedQuarterlyOperatingProfitCents) ||
    input.observedQuarterlyOperatingProfitCents.some(
      (profit) => !isSafeCents(profit),
    )
  )
    throw new RangeError("Invalid normalized business valuation input");
  const history = input.observedQuarterlyOperatingProfitCents.slice(
    -OBJECTIVE_MEASUREMENT_RULES.lookbackQuarters,
  );
  if (history.length === 0) return cents(input.openingEnterpriseValueCents);
  let earnings = history
    .reduce((sum, profit) => sum.plus(profit), new FinanceDecimal(0))
    .times(4)
    .dividedBy(history.length);
  if (input.basis === "owner-earnings")
    earnings = earnings.plus(input.fixedAnnualLaborCostsCents);
  return cents(
    FinanceDecimal.max(0, earnings)
      .times(input.openingEnterpriseValueCents)
      .dividedBy(input.openingValuationEarningsCents)
      .round()
      .toNumber(),
  );
}
