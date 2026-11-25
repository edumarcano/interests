import type { PlayerId, TransactionId } from "@interests/shared";
import { applyQuarterSettlement } from "../finance/settlement.js";
import { assertGameState } from "../invariants/assertGameState.js";
import type { GameState, RoundState } from "../model/gameState.js";
import { expireRecurringOpportunity } from "../opportunities/recurring";
import {
  applyCancelActiveTransaction,
  applyCloseCashBusinessPurchaseTransaction,
} from "../transactions/cashBusinessPurchase.js";
import type {
  TransactionErrorCode,
  TransactionResult,
} from "../transactions/model.js";
import type { ActionErrorCode, ActionResult } from "./actions.js";

/**
 * Returns the rotating spotlight order for the specified quarter and player order.
 * Generic over collection length.
 *
 * For playerOrder [A, B, C, D]:
 * Q1: A -> B -> C -> D
 * Q2: B -> C -> D -> A
 * Q3: C -> D -> A -> B
 * Q4: D -> A -> B -> C
 * Q5: A -> B -> C -> D
 */
export function getSpotlightOrder(
  state: Pick<GameState, "playerOrder" | "currentQuarter">,
): readonly PlayerId[] {
  const { playerOrder, currentQuarter } = state;
  const len = playerOrder.length;
  if (len === 0) return [];
  const startIndex = (((currentQuarter - 1) % len) + len) % len;
  const order: PlayerId[] = [];
  for (let i = 0; i < len; i++) {
    order.push(playerOrder[(startIndex + i) % len]!);
  }
  return order;
}

/**
 * Returns the active spotlight PlayerId for the given game state,
 * or null if the round is not in the "spotlight" stage.
 */
export function getActiveSpotlightPlayerId(
  state: Pick<GameState, "round" | "playerOrder" | "currentQuarter">,
): PlayerId | null {
  if (!state.round || state.round.stage !== "spotlight") {
    return null;
  }
  const order = getSpotlightOrder(state);
  return order[state.round.spotlightsCompleted] ?? null;
}

/**
 * Pure engine transition to advance from round-start into the first spotlight.
 * Host authorization is enforced by the server/session layer before dispatching.
 */
export function beginRound(state: GameState): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  if (state.phase !== "ready-for-first-round") {
    return reject("WRONG_PHASE");
  }

  if (!state.round || state.round.stage !== "round-start") {
    return reject("WRONG_ROUND_STAGE");
  }

  if (state.activeTransaction !== null) {
    return reject("ACTIVE_TRANSACTION");
  }

  const nextRound: RoundState = {
    stage: "spotlight",
    spotlightsCompleted: 0,
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    round: nextRound,
  };

  assertGameState(nextState);
  return { ok: true, state: nextState, journalEntries: [] };
}

/**
 * Pure engine transition to advance the spotlight.
 *
 * For Spotlights 1 to N-1: advances to the next spotlight (revision + 1).
 * For Spotlight N (final spotlight): executes quarter settlement atomically
 * inside this single accepted command (exactly 1 revision increment total).
 */
export function advanceSpotlight(
  state: GameState,
  actorPlayerId: PlayerId,
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  if (state.phase !== "ready-for-first-round") {
    return reject("WRONG_PHASE");
  }

  if (!state.round || state.round.stage !== "spotlight") {
    return reject("WRONG_ROUND_STAGE");
  }

  if (state.activeTransaction !== null) {
    return reject("ACTIVE_TRANSACTION");
  }

  const activePlayerId = getActiveSpotlightPlayerId(state);
  if (activePlayerId !== actorPlayerId) {
    return reject("NOT_ACTIVE_SPOTLIGHT");
  }

  const expired = expireRecurringOpportunity(state, actorPlayerId);
  const playerCount = state.playerOrder.length;
  if (state.round.spotlightsCompleted < playerCount - 1) {
    // Intermediate spotlight pass: advance spotlight count
    const nextRound: RoundState = {
      stage: "spotlight",
      spotlightsCompleted: state.round.spotlightsCompleted + 1,
    };

    const nextState: GameState = {
      ...expired,
      revision: state.revision + 1,
      round: nextRound,
    };

    assertGameState(nextState);
    return { ok: true, state: nextState, journalEntries: [] };
  }

  // Final spotlight: atomic quarter settlement
  const settleResult = applyQuarterSettlement(expired, {
    quarter: state.currentQuarter,
  });
  if (!settleResult.ok) {
    return reject(settleResult.code);
  }

  const finalState: GameState = {
    ...settleResult.state,
    revision: state.revision + 1,
  };

  assertGameState(finalState);

  return {
    ok: true,
    state: finalState,
    journalEntries: settleResult.journalEntries,
    settlementOutcome: settleResult.settlementOutcome,
  };
}

/**
 * Pure orchestration helper to atomically compose:
 * 1. A successful terminal transaction transition (e.g. close or cancel);
 * 2. Immediate spotlight completion;
 * 3. Either:
 *    - advance to the next spotlight (if intermediate spotlight), or
 *    - perform quarterly settlement and enter next-quarter ROUND_START (if final spotlight);
 * 4. While incrementing GameState.revision exactly ONCE total.
 *
 * If terminal transaction fails, or if final settlement fails:
 * - the ENTIRE operation rejects atomically;
 * - original state is returned untouched with 0 journal entries;
 * - no partial effects, no extra revisions, no uncommitted RNG/counters.
 */
export function resolveTerminalTransactionAndAdvanceSpotlight(
  state: GameState,
  actorPlayerId: PlayerId,
  terminalTransition: (state: GameState) => TransactionResult,
): ActionResult {
  const reject = (
    code: ActionErrorCode | TransactionErrorCode,
  ): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  if (state.phase !== "ready-for-first-round") {
    return reject("WRONG_PHASE");
  }

  if (!state.round || state.round.stage !== "spotlight") {
    return reject("WRONG_ROUND_STAGE");
  }

  const activePlayerId = getActiveSpotlightPlayerId(state);
  if (activePlayerId !== actorPlayerId) {
    return reject("NOT_ACTIVE_SPOTLIGHT");
  }

  // 1. Execute terminal transaction on state (without revision increment)
  const txResult = terminalTransition(state);
  if (!txResult.ok) {
    return reject(txResult.code);
  }

  if (txResult.state.activeTransaction !== null) {
    throw new Error(
      "Invariant violation: terminal transaction did not clear activeTransaction",
    );
  }

  const postTxState = expireRecurringOpportunity(txResult.state, actorPlayerId);
  const txJournalEntries = txResult.journalEntries;
  const playerCount = state.playerOrder.length;

  // 2. Intermediate spotlight: advance spotlight index
  if (state.round.spotlightsCompleted < playerCount - 1) {
    const nextRound: RoundState = {
      stage: "spotlight",
      spotlightsCompleted: state.round.spotlightsCompleted + 1,
    };

    const finalState: GameState = {
      ...postTxState,
      revision: state.revision + 1,
      round: nextRound,
    };

    assertGameState(finalState);
    return {
      ok: true,
      state: finalState,
      journalEntries: txJournalEntries,
    };
  }

  // 3. Final spotlight: execute quarterly settlement on postTxState
  const settleResult = applyQuarterSettlement(postTxState, {
    quarter: state.currentQuarter,
  });

  if (!settleResult.ok) {
    // Entire command rejects atomically, returning the original un-mutated state
    return reject(settleResult.code);
  }

  const finalState: GameState = {
    ...settleResult.state,
    revision: state.revision + 1,
  };

  assertGameState(finalState);

  // Preserve deterministic journal order: transaction entries first, settlement entries second
  return {
    ok: true,
    state: finalState,
    journalEntries: [...txJournalEntries, ...settleResult.journalEntries],
    settlementOutcome: settleResult.settlementOutcome,
  };
}

/**
 * High-level orchestration helper for closing a cash business purchase and advancing the spotlight.
 */
export function closeCashBusinessPurchaseAndAdvanceSpotlight(
  state: GameState,
  actorPlayerId: PlayerId,
  transactionId: TransactionId,
): ActionResult {
  return resolveTerminalTransactionAndAdvanceSpotlight(
    state,
    actorPlayerId,
    (draftState) =>
      applyCloseCashBusinessPurchaseTransaction(draftState, transactionId),
  );
}

/**
 * High-level orchestration helper for cancelling an active transaction and advancing the spotlight.
 */
export function cancelActiveTransactionAndAdvanceSpotlight(
  state: GameState,
  actorPlayerId: PlayerId,
  transactionId: TransactionId,
): ActionResult {
  return resolveTerminalTransactionAndAdvanceSpotlight(
    state,
    actorPlayerId,
    (draftState) => applyCancelActiveTransaction(draftState, transactionId),
  );
}
