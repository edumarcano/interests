import type { ObjectiveId } from "@interests/rules";
import type { PlayerId } from "@interests/shared";
import type { GameState } from "../model/gameState.js";
import { type ActionResult, applyAction } from "./actions.js";
import { advanceSpotlight, beginRound } from "./round.js";

export interface WireChooseObjectiveCommand {
  readonly type: "CHOOSE_OBJECTIVE";
  readonly objectiveId: string;
}

export interface WireBeginRoundCommand {
  readonly type: "BEGIN_ROUND";
}

export interface WirePassSpotlightCommand {
  readonly type: "PASS_SPOTLIGHT";
}

export type WirePlayerCommand =
  | WireChooseObjectiveCommand
  | WireBeginRoundCommand
  | WirePassSpotlightCommand;

/**
 * Pure engine player command adapter.
 *
 * Translates an authenticated actor and an untrusted wire command into an
 * engine action. Discards any actor or identity fields inside the wire payload,
 * enforcing that actor identity is strictly server-derived.
 *
 * Standard V1 player commands:
 * - CHOOSE_OBJECTIVE
 * - BEGIN_ROUND
 * - PASS_SPOTLIGHT
 */
export function applyPlayerCommand(
  state: GameState,
  actorPlayerId: PlayerId,
  wireCommand: WirePlayerCommand,
): ActionResult {
  if (!wireCommand || typeof wireCommand !== "object") {
    return {
      ok: false,
      state,
      code: "INVALID_ACTION",
      journalEntries: [],
    };
  }

  switch (wireCommand.type) {
    case "CHOOSE_OBJECTIVE": {
      if (typeof wireCommand.objectiveId !== "string") {
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

    case "BEGIN_ROUND": {
      return beginRound(state);
    }

    case "PASS_SPOTLIGHT": {
      return advanceSpotlight(state, actorPlayerId);
    }

    default: {
      return {
        ok: false,
        state,
        code: "INVALID_ACTION",
        journalEntries: [],
      };
    }
  }
}
