import type { ObjectiveId, ProfileId } from "@finance-game/rules";
import type { GameId, PlayerId } from "@finance-game/shared";

import type { RandomState } from "../random/prng";

export type GamePhase = "objective-choosing" | "ready-for-first-round";

export interface PlayerState {
  readonly id: PlayerId;
  readonly profileId: ProfileId;
  readonly offeredObjectiveIds: readonly [ObjectiveId, ObjectiveId];
  readonly selectedObjectiveId: ObjectiveId | null;
}

export interface DeterministicCounters {
  readonly asset: number;
  readonly contract: number;
  readonly loan: number;
  readonly opportunity: number;
}

export interface GameState {
  readonly gameId: GameId;
  readonly modeId: "standard-v1";
  readonly revision: number;
  readonly phase: GamePhase;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly random: RandomState;
  readonly counters: DeterministicCounters;
}
