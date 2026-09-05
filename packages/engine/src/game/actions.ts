import type { PlayerId } from "@finance-game/shared";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";

export interface SetPlayerReadyAction {
  readonly type: "SET_PLAYER_READY";
  readonly playerId: PlayerId;
  readonly ready: boolean;
}

export type GameAction = SetPlayerReadyAction;

export type ActionResult =
  | { readonly ok: true; readonly state: GameState }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: "INVALID_ACTION" | "UNKNOWN_PLAYER" | "WRONG_PHASE";
    };

export function applyAction(state: GameState, action: unknown): ActionResult {
  if (!isSetPlayerReadyAction(action)) {
    return { ok: false, state, code: "INVALID_ACTION" };
  }
  if (state.phase !== "setup") {
    return { ok: false, state, code: "WRONG_PHASE" };
  }
  const player = state.players[action.playerId];
  if (player === undefined) {
    return { ok: false, state, code: "UNKNOWN_PLAYER" };
  }

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    players: {
      ...state.players,
      [action.playerId]: { ...player, ready: action.ready },
    },
  };

  assertGameState(nextState);
  return { ok: true, state: nextState };
}

function isSetPlayerReadyAction(value: unknown): value is SetPlayerReadyAction {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SetPlayerReadyAction>;
  return (
    candidate.type === "SET_PLAYER_READY" &&
    typeof candidate.playerId === "string" &&
    typeof candidate.ready === "boolean"
  );
}
