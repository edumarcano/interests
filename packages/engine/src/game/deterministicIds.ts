import {
  asAssetId,
  asContractId,
  asLoanId,
  asOpportunityId,
} from "@finance-game/shared";

import { asJournalEntryId } from "../finance/journal";
import type { DeterministicCounters } from "../model/gameState";

export type CounterKind = keyof DeterministicCounters;

export function nextDeterministicId(
  kind: "asset",
  counters: DeterministicCounters,
): { id: ReturnType<typeof asAssetId>; counters: DeterministicCounters };
export function nextDeterministicId(
  kind: "contract",
  counters: DeterministicCounters,
): { id: ReturnType<typeof asContractId>; counters: DeterministicCounters };
export function nextDeterministicId(
  kind: "loan",
  counters: DeterministicCounters,
): { id: ReturnType<typeof asLoanId>; counters: DeterministicCounters };
export function nextDeterministicId(
  kind: "opportunity",
  counters: DeterministicCounters,
): { id: ReturnType<typeof asOpportunityId>; counters: DeterministicCounters };
export function nextDeterministicId(
  kind: "journal",
  counters: DeterministicCounters,
): { id: ReturnType<typeof asJournalEntryId>; counters: DeterministicCounters };
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
    case "journal":
      return { id: asJournalEntryId(rawId), counters: nextCounters };
  }
}
