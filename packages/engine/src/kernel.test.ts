import { asPlayerId } from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import { applyAction } from "./game/actions";
import { createGame } from "./game/createGame";
import { nextDeterministicId } from "./game/deterministicIds";
import { basisPoints, cents } from "./finance/money";
import { createRandomState, drawUint32 } from "./random/prng";

const players = [asPlayerId("p1"), asPlayerId("p2"), asPlayerId("p3"), asPlayerId("p4")];

describe("deterministic kernel", () => {
  it("creates identical initial state for identical inputs", () => {
    const input = { gameId: "game-1", seed: "family-night", playerIds: players };
    expect(createGame(input)).toEqual(createGame(input));
  });

  it("produces repeatable random draws", () => {
    const first = drawUint32(createRandomState("same-seed"));
    const second = drawUint32(createRandomState("same-seed"));
    expect(first).toEqual(second);
  });

  it("does not mutate state or random state when an action is rejected", () => {
    const state = createGame({ gameId: "game-1", seed: "seed", playerIds: players });
    const snapshot = structuredClone(state);
    const result = applyAction(state, { type: "SET_PLAYER_READY", playerId: "missing", ready: true });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(state).toEqual(snapshot);
  });

  it("returns a new state for an accepted action without consuming randomness", () => {
    const state = createGame({ gameId: "game-1", seed: "seed", playerIds: players });
    const result = applyAction(state, { type: "SET_PLAYER_READY", playerId: players[0], ready: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(state);
    expect(result.state.players[players[0]]?.ready).toBe(true);
    expect(result.state.random).toEqual(state.random);
    expect(result.state.revision).toBe(1);
  });

  it("generates deterministic IDs from explicit counters", () => {
    const state = createGame({ gameId: "game-1", seed: "seed", playerIds: players });
    const first = nextDeterministicId("asset", state.counters);
    const second = nextDeterministicId("asset", state.counters);
    expect(first).toEqual(second);
    expect(first.id).toBe("asset-1");
  });

  it("rejects unsafe money and rate values", () => {
    expect(cents(12_345)).toBe(12_345);
    expect(basisPoints(625)).toBe(625);
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(() => basisPoints(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
