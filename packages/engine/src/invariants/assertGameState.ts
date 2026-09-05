import type { GameState } from "../model/gameState";
import { RNG_ALGORITHM } from "../random/prng";

export function assertGameState(state: GameState): void {
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new Error(
      "Game invariant failed: revision must be a non-negative safe integer",
    );
  }
  if (
    state.random.algorithm !== RNG_ALGORITHM ||
    !Number.isInteger(state.random.state)
  ) {
    throw new Error("Game invariant failed: random state is invalid");
  }
  if (new Set(state.playerOrder).size !== state.playerOrder.length) {
    throw new Error("Game invariant failed: player order contains duplicates");
  }
  for (const playerId of state.playerOrder) {
    if (state.players[playerId] === undefined) {
      throw new Error(`Game invariant failed: missing player ${playerId}`);
    }
  }
  for (const counter of Object.values(state.counters)) {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error(
        "Game invariant failed: deterministic counters must be non-negative safe integers",
      );
    }
  }
}
