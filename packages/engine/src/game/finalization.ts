import type { PlayerId } from "@interests/shared";
import type { JournalEntry } from "../finance/journal";
import type { GameState } from "../model/gameState";
import type { ActionResult } from "./actions";

/** Internal effects and realized facts from the owning transition, never command data. */
export interface EconomicActionFinalization<Facts> {
  readonly before: GameState;
  readonly draft: GameState;
  readonly actorPlayerId: PlayerId;
  readonly journalEntries: readonly JournalEntry[];
  readonly facts: Facts;
}

/** Runs after economic effects and before any spotlight, quarter or revision advancement. */
export type EconomicActionFinalizer<Facts> = (
  input: EconomicActionFinalization<Facts>,
) => ActionResult;
