import type { ObjectiveId } from "@interests/rules";
import type { PlayerId } from "@interests/shared";
import type { GameState } from "../model/gameState.js";
import { type ActionResult, applyAction } from "./actions.js";

export interface WireChooseObjectiveCommand {
  readonly type: "CHOOSE_OBJECTIVE";
  readonly objectiveId: string;
}

export type WirePlayerCommand = WireChooseObjectiveCommand;

/**
 * Pure engine player command adapter.
 *
 * Translates an authenticated actor and an untrusted wire command into an
 * engine action. Discards any actor or identity fields inside the wire payload,
 * enforcing that actor identity is strictly server-derived.
 *
 * For Milestone 5 (PR #19), only CHOOSE_OBJECTIVE is supported.
 */
export function applyPlayerCommand(
  state: GameState,
  actorPlayerId: PlayerId,
  wireCommand: WirePlayerCommand,
): ActionResult {
  if (
    !wireCommand ||
    typeof wireCommand !== "object" ||
    wireCommand.type !== "CHOOSE_OBJECTIVE" ||
    typeof wireCommand.objectiveId !== "string"
  ) {
    return {
      ok: false,
      state,
      code: "INVALID_ACTION",
      journalEntries: [],
    };
  }

  return applyAction(state, {
    type: "CHOOSE_OBJECTIVE",
    playerId: actorPlayerId,
    objectiveId: wireCommand.objectiveId as ObjectiveId,
  });
}
