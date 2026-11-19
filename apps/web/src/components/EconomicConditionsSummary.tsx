import type { MatchEconomicConditionsView } from "@interests/shared";

export function EconomicConditionsSummary({
  conditions,
}: {
  conditions?: MatchEconomicConditionsView;
}) {
  if (!conditions) return null;
  return (
    <p data-testid="economic-conditions">
      Base rate {(conditions.baseRateBps / 100).toFixed(2)}% · Annual inflation{" "}
      {(conditions.annualInflationBps / 100).toFixed(2)}% · Credit{" "}
      {conditions.creditEnvironment}
    </p>
  );
}
