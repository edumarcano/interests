import {
  asAssetId,
  asContractId,
  asLoanId,
  asOpportunityId,
} from "@finance-game/shared";

import type { DeterministicCounters } from "../model/gameState";

export type CounterKind = keyof DeterministicCounters;

export function nextDeterministicId(
  kind: CounterKind,
  counters: DeterministicCounters,
) {
  const nextValue = counters[kind] + 1;
  const nextCounters = { ...counters, [kind]: nextValue };
  const rawId = `${kind}-${nextValue}`;

  switch (kind) {
    case "asset":
      return { id: asAssetId(rawId), counters: nextCounters };
    case "contract":
      return { id: asContractId(rawId), counters: nextCounters };
    case "loan":
      return { id: asLoanId(rawId), counters: nextCounters };
    case "opportunity":
      return { id: asOpportunityId(rawId), counters: nextCounters };
  }
}
