import type { AssetId, PlayerId, SettlementId } from "@finance-game/shared";

import { nextDeterministicId } from "../game/deterministicIds";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { externalCashAccount, playerCashAccount } from "./account";
import type { JournalEntry } from "./journal";
import { allocateProportionalCents } from "./ownership";
import { type CashPostingRequest, postCash } from "./posting";
import { calculatePropertyCashFlow } from "./property";

export interface SettleQuarterRequest {
  readonly quarter: number;
}

export type SettleQuarterErrorCode =
  | "INVALID_QUARTER"
  | "QUARTER_ALREADY_SETTLED"
  | "WRONG_QUARTER";

export type SettleQuarterResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly settlementId: SettlementId;
      readonly journalEntries: readonly JournalEntry[];
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: SettleQuarterErrorCode;
      readonly journalEntries: readonly [];
    };

interface PlannedPropertyDistribution {
  readonly sourceAccount: ReturnType<typeof externalCashAccount>;
  readonly destinationPlayerId: PlayerId;
  readonly amountCents: number;
  readonly reason: string;
  readonly quarter: number;
  readonly assetId: AssetId;
}

/**
 * Pure internal authoritative quarter-settlement operation.
 *
 * Slices supported in PR #7:
 * - Debt-free property operating cash-flow distribution.
 *
 * Deliberately NOT supported (A1-A6 remain OPEN):
 * - Business distributions (A4);
 * - Scheduled player-loan payments / default (A5);
 * - Personal legacy debt, mortgages, salaries, living expenses.
 *
 * Guarantees:
 * - Deterministic plan computed before any state mutation;
 * - Rejection preserves state, revision, counters, RNG, and emits zero journal entries;
 * - Atomic execution of postings;
 * - Canonical ordering of assets and owners prevents insertion-order variance;
 * - Exactly one SettlementId created and counter advanced once per successful settlement.
 */
export function settleQuarter(
  state: GameState,
  request: SettleQuarterRequest,
): SettleQuarterResult {
  const reject = (code: SettleQuarterErrorCode): SettleQuarterResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  // 1. Quarter validation
  if (!Number.isSafeInteger(request.quarter) || request.quarter <= 0) {
    return reject("INVALID_QUARTER");
  }

  if (request.quarter <= state.lastSettledQuarter) {
    return reject("QUARTER_ALREADY_SETTLED");
  }

  if (request.quarter !== state.currentQuarter) {
    return reject("WRONG_QUARTER");
  }

  // 2. Settlement Planning (Pure, no state mutation)
  // Canonical sorting of assets by AssetId
  const sortedAssetIds = (
    Object.keys(state.finance.assetsById) as AssetId[]
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const plannedDistributions: PlannedPropertyDistribution[] = [];

  for (const assetId of sortedAssetIds) {
    const asset = state.finance.assetsById[assetId];
    if (asset === undefined) continue;

    // Business assets are intentionally NOT cash-settled in PR #7 (A4 remains OPEN)
    if (asset.kind === "business") {
      continue;
    }

    if (asset.kind === "property") {
      const cashFlow = calculatePropertyCashFlow(asset);
      if (cashFlow.netOperatingIncomeCents <= 0) {
        continue;
      }

      const allocations = allocateProportionalCents(
        cashFlow.netOperatingIncomeCents,
        asset.ownershipByPlayerPpm,
      );

      // Canonical sorting of owners by PlayerId
      const sortedOwnerIds = (Object.keys(allocations) as PlayerId[]).sort(
        (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      );

      for (const ownerId of sortedOwnerIds) {
        const allocatedCents = allocations[ownerId];
        if (allocatedCents !== undefined && allocatedCents > 0) {
          plannedDistributions.push({
            sourceAccount: externalCashAccount("property-operating-cashflow"),
            destinationPlayerId: ownerId,
            amountCents: allocatedCents,
            reason: "property-operating-distribution",
            quarter: request.quarter,
            assetId: asset.id,
          });
        }
      }
    }
  }

  // 3. Atomic application
  // Generate deterministic SettlementId
  const { id: settlementId, counters: countersWithSettlement } =
    nextDeterministicId("settlement", state.counters);

  let currentFinance = state.finance;
  let currentCounters = countersWithSettlement;
  const journalEntries: JournalEntry[] = [];

  for (const distribution of plannedDistributions) {
    const postRequest: CashPostingRequest = {
      source: distribution.sourceAccount,
      destination: playerCashAccount(distribution.destinationPlayerId),
      amountCents: distribution.amountCents,
      reason: distribution.reason,
      quarter: distribution.quarter,
      relatedAssetId: distribution.assetId,
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during quarter settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);
  }

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    currentQuarter: request.quarter + 1,
    lastSettledQuarter: request.quarter,
    finance: currentFinance,
    counters: currentCounters,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    settlementId,
    journalEntries,
  };
}
