import { asGameId, type PlayerId } from "@finance-game/shared";

import type { GameState, PlayerState } from "../model/gameState";
import { createRandomState } from "../random/prng";
import { assertGameState } from "../invariants/assertGameState";

export interface CreateGameInput {
  readonly gameId: string;
  readonly seed: string;
  readonly playerIds: readonly PlayerId[];
}

export function createGame(input: CreateGameInput): GameState {
  const players = Object.fromEntries(
    input.playerIds.map((id) => [id, { id, ready: false } satisfies PlayerState]),
  ) as Record<PlayerId, PlayerState>;

  const state: GameState = {
    gameId: asGameId(input.gameId),
    modeId: "standard-v1",
    revision: 0,
    phase: "setup",
    playerOrder: [...input.playerIds],
    players,
    random: createRandomState(input.seed),
    counters: {
      asset: 0,
      contract: 0,
      loan: 0,
      opportunity: 0,
    },
  };

  assertGameState(state);
  return state;
}
