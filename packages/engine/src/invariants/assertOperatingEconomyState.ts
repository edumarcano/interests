import {
  BUSINESS_SENSITIVITY,
  OBJECTIVE_MEASUREMENT_RULES,
} from "@interests/rules";
import { isNonNegativeCents, isSafeCents } from "../finance/money";
import type { GameState } from "../model/gameState";

export function assertOperatingEconomyState(state: GameState): void {
  for (const asset of Object.values(state.finance.assetsById)) {
    if (asset.kind !== "business" || asset.operatingModel === undefined)
      continue;
    const model = asset.operatingModel;
    if (
      !model ||
      typeof model !== "object" ||
      Object.getPrototypeOf(model) !== Object.prototype ||
      model.kind !== "revenue-cost-v1" ||
      !Object.hasOwn(BUSINESS_SENSITIVITY, model.sensitivity)
    )
      throw new Error("Invalid business operating model");
    if (
      model.firstOperatingQuarter !== undefined &&
      (!Number.isSafeInteger(model.firstOperatingQuarter) ||
        model.firstOperatingQuarter < 1 ||
        model.firstOperatingQuarter > state.currentQuarter + 1)
    )
      throw new Error("Invalid first operating quarter");
    for (const value of [
      model.referenceAnnualRevenueCents,
      model.referenceAnnualNonLaborCostsCents,
      model.fixedAnnualLaborCostsCents,
      model.openingEnterpriseValueCents,
      model.openingValuationEarningsCents,
    ])
      if (!isNonNegativeCents(value))
        throw new Error("Invalid operating model money");
    if (
      model.referenceAnnualRevenueCents === 0 ||
      model.openingValuationEarningsCents === 0 ||
      !isSafeCents(model.annualProfitAdjustmentCents) ||
      !["after-labor-profit", "owner-earnings"].includes(model.valuationBasis)
    )
      throw new Error("Invalid operating valuation calibration");
    if (
      !Array.isArray(model.quarters) ||
      model.quarters.length > OBJECTIVE_MEASUREMENT_RULES.lookbackQuarters
    )
      throw new Error("Invalid operating observation history");
    let previous = 0;
    for (const observed of model.quarters) {
      if (
        !observed ||
        typeof observed !== "object" ||
        !Number.isSafeInteger(observed.quarter) ||
        observed.quarter < (model.firstOperatingQuarter ?? 1) ||
        observed.quarter > state.lastSettledQuarter ||
        (previous !== 0 && observed.quarter !== previous + 1) ||
        !isSafeCents(observed.operatingProfitCents)
      )
        throw new Error("Invalid operating quarter evidence");
      previous = observed.quarter;
    }
  }
}
