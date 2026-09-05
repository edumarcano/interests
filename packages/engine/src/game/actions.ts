import type { ObjectiveId } from "@finance-game/rules";
import type { PlayerId } from "@finance-game/shared";
import type { JournalEntry } from "../finance/journal";
import { assertGameState } from "../invariants/assertGameState";
import type { GamePhase, GameState, PlayerState } from "../model/gameState";

export interface ChooseObjectiveAction {
  readonly type: "CHOOSE_OBJECTIVE";
  readonly playerId: PlayerId;
  readonly objectiveId: ObjectiveId;
}

export type GameAction = ChooseObjectiveAction;

export type ActionErrorCode =
  | "INVALID_ACTION"
  | "UNKNOWN_PLAYER"
  | "WRONG_PHASE"
  | "ALREADY_CHOSEN"
  | "OBJECTIVE_NOT_OFFERED";

export type ActionResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly journalEntries: readonly JournalEntry[];
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: ActionErrorCode;
      readonly journalEntries: readonly JournalEntry[];
    };

export function applyAction(state: GameState, action: unknown): ActionResult {
  if (!isChooseObjectiveAction(action)) {
    return { ok: false, state, code: "INVALID_ACTION", journalEntries: [] };
  }
  if (state.phase !== "objective-choosing") {
    return { ok: false, state, code: "WRONG_PHASE", journalEntries: [] };
  }
  const player = state.players[action.playerId];
  if (player === undefined) {
    return { ok: false, state, code: "UNKNOWN_PLAYER", journalEntries: [] };
  }
  if (player.selectedObjectiveId !== null) {
    return { ok: false, state, code: "ALREADY_CHOSEN", journalEntries: [] };
  }
  if (
    action.objectiveId !== player.offeredObjectiveIds[0] &&
    action.objectiveId !== player.offeredObjectiveIds[1]
  ) {
    return {
      ok: false,
      state,
      code: "OBJECTIVE_NOT_OFFERED",
      journalEntries: [],
    };
  }

  const updatedPlayer: PlayerState = {
    ...player,
    selectedObjectiveId: action.objectiveId,
  };

  const nextPlayers: Record<PlayerId, PlayerState> = {
    ...state.players,
    [action.playerId]: updatedPlayer,
  };

  const allSelected = state.playerOrder.every(
    (id) => nextPlayers[id]?.selectedObjectiveId !== null,
  );

  const nextPhase: GamePhase = allSelected
    ? "ready-for-first-round"
    : "objective-choosing";

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    phase: nextPhase,
    players: nextPlayers,
  };

  assertGameState(nextState);
  return { ok: true, state: nextState, journalEntries: [] };
}

function isChooseObjectiveAction(
  value: unknown,
): value is ChooseObjectiveAction {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ChooseObjectiveAction>;
  return (
    candidate.type === "CHOOSE_OBJECTIVE" &&
    typeof candidate.playerId === "string" &&
    typeof candidate.objectiveId === "string"
  );
}
