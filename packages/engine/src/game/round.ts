import type { PlayerId } from "@interests/shared";
import { settleQuarter } from "../finance/settlement.js";
import { assertGameState } from "../invariants/assertGameState.js";
import type { GameState, RoundState } from "../model/gameState.js";
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

  const playerCount = state.playerOrder.length;
  if (state.round.spotlightsCompleted < playerCount - 1) {
    // Intermediate spotlight pass: advance spotlight count
    const nextRound: RoundState = {
      stage: "spotlight",
      spotlightsCompleted: state.round.spotlightsCompleted + 1,
    };

    const nextState: GameState = {
      ...state,
      revision: state.revision + 1,
      round: nextRound,
    };

    assertGameState(nextState);
    return { ok: true, state: nextState, journalEntries: [] };
  }

  // Final spotlight: atomic quarter settlement
  const settleResult = settleQuarter(state, { quarter: state.currentQuarter });
  if (!settleResult.ok) {
    return reject(settleResult.code);
  }

  // settleQuarter already advances revision by exactly 1, advances quarter,
  // revalues markets, transitions regime, captures basis, and resets round to round-start.
  return {
    ok: true,
    state: settleResult.state,
    journalEntries: settleResult.journalEntries,
  };
}
