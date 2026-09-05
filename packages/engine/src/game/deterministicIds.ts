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
): {
  id:
    | ReturnType<typeof asAssetId>
    | ReturnType<typeof asContractId>
    | ReturnType<typeof asLoanId>
    | ReturnType<typeof asOpportunityId>
    | ReturnType<typeof asJournalEntryId>;
  counters: DeterministicCounters;
};
export function nextDeterministicId(
  kind: CounterKind,
  counters: DeterministicCounters,
) {
  const currentValue = counters[kind];
  if (!Number.isSafeInteger(currentValue) || currentValue < 0) {
    throw new RangeError(
      `Counter ${kind} must be a non-negative safe integer, got ${String(currentValue)}`,
    );
  }
  if (currentValue >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `Counter ${kind} has reached the maximum safe integer limit`,
    );
  }

  const nextValue = currentValue + 1;
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
