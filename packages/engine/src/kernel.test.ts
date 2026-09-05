import { asPlayerId } from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import { basisPoints, cents } from "./finance/money";
import { applyAction } from "./game/actions";
import { createGame } from "./game/createGame";
import { nextDeterministicId } from "./game/deterministicIds";
import type { DeterministicCounters } from "./model/gameState";
import { createRandomState, drawBoundedInt, drawUint32 } from "./random/prng";

const players = [
  asPlayerId("p1"),
  asPlayerId("p2"),
  asPlayerId("p3"),
  asPlayerId("p4"),
] as const;

describe("deterministic kernel", () => {
  it("creates identical initial state for identical inputs", () => {
    const input = {
      gameId: "game-1",
      seed: "family-night",
      playerIds: players,
    };
    expect(createGame(input)).toEqual(createGame(input));
  });

  it("produces repeatable random draws", () => {
    const first = drawUint32(createRandomState("same-seed"));
    const second = drawUint32(createRandomState("same-seed"));
    expect(first).toEqual(second);
  });

  it("draws unbiased bounded integers deterministically", () => {
    const random = createRandomState("bounded-seed");
    const draw1 = drawBoundedInt(random, 10);
    const draw2 = drawBoundedInt(random, 10);
    expect(draw1).toEqual(draw2);
    expect(draw1.value).toBeGreaterThanOrEqual(0);
    expect(draw1.value).toBeLessThan(10);

    // Test rejection sampling bounds validation
    expect(() => drawBoundedInt(random, 0)).toThrow(RangeError);
    expect(() => drawBoundedInt(random, -5)).toThrow(RangeError);
    expect(() => drawBoundedInt(random, 1.5)).toThrow(RangeError);
    expect(() => drawBoundedInt(random, 0x1_0000_0001)).toThrow(RangeError);

    // Test bound === 1
    const unitDraw = drawBoundedInt(random, 1);
    expect(unitDraw.value).toBe(0);

    // Deterministic distribution across buckets
    let current = createRandomState("distribution-seed");
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i += 1) {
      const d = drawBoundedInt(current, 5);
      const bucket = d.value;
      const prev = counts[bucket];
      if (prev !== undefined) {
        counts[bucket] = prev + 1;
      }
      current = d.nextState;
    }
    // Each bucket should get roughly 1000 draws (between 850 and 1150)
    for (const count of counts) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it("does not mutate state or random state when an action is rejected", () => {
    const state = createGame({
      gameId: "game-1",
      seed: "seed",
      playerIds: players,
    });
    const snapshot = structuredClone(state);
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: "missing",
      objectiveId: "founder",
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.journalEntries).toEqual([]);
    expect(state).toEqual(snapshot);
  });

  it("returns a new state for an accepted action without consuming randomness or mutating finance", () => {
    const state = createGame({
      gameId: "game-1",
      seed: "seed",
      playerIds: players,
    });
    const firstPlayer = players[0];
    const playerState = state.players[firstPlayer];
    expect(playerState).toBeDefined();
    if (playerState === undefined) return;
    const offered = playerState.offeredObjectiveIds[0];
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: firstPlayer,
      objectiveId: offered,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(state);
    expect(result.state.players[firstPlayer]?.selectedObjectiveId).toBe(
      offered,
    );
    expect(result.state.random).toEqual(state.random);
    expect(result.state.revision).toBe(1);
    expect(result.journalEntries).toEqual([]);
    expect(result.state.finance).toBe(state.finance);
    expect(result.state.counters.journal).toBe(0);
  });

  it("generates deterministic IDs from explicit counters", () => {
    const state = createGame({
      gameId: "game-1",
      seed: "seed",
      playerIds: players,
    });
    const first = nextDeterministicId("asset", state.counters);
    const second = nextDeterministicId("asset", state.counters);
    expect(first).toEqual(second);
    expect(first.id).toBe("asset-1");

    const j1 = nextDeterministicId("journal", state.counters);
    const j2 = nextDeterministicId("journal", state.counters);
    expect(j1).toEqual(j2);
    expect(j1.id).toBe("journal-1");
    expect(j1.counters.journal).toBe(1);

    const s1 = nextDeterministicId("settlement", state.counters);
    const s2 = nextDeterministicId("settlement", state.counters);
    expect(s1).toEqual(s2);
    expect(s1.id).toBe("settlement-1");
    expect(s1.counters.settlement).toBe(1);
  });

  it("rejects counter increment when counter is exhausted at MAX_SAFE_INTEGER", () => {
    const kinds = [
      "asset",
      "contract",
      "loan",
      "opportunity",
      "journal",
      "settlement",
    ] as const;
    for (const kind of kinds) {
      const exhaustedCounters: DeterministicCounters = {
        asset: 0,
        contract: 0,
        loan: 0,
        opportunity: 0,
        journal: 0,
        settlement: 0,
        [kind]: Number.MAX_SAFE_INTEGER,
      };
      expect(() => nextDeterministicId(kind, exhaustedCounters)).toThrow(
        RangeError,
      );
      expect(() => nextDeterministicId(kind, exhaustedCounters)).toThrow(
        /maximum safe integer limit/,
      );
    }
  });

  it("rejects counter increment for negative or non-integer counter values", () => {
    const invalidCounters: DeterministicCounters = {
      asset: -1,
      contract: 1.5,
      loan: Number.NaN,
      opportunity: 0,
      journal: -5,
      settlement: -2,
    };
    expect(() => nextDeterministicId("asset", invalidCounters)).toThrow(
      RangeError,
    );
    expect(() => nextDeterministicId("contract", invalidCounters)).toThrow(
      RangeError,
    );
    expect(() => nextDeterministicId("loan", invalidCounters)).toThrow(
      RangeError,
    );
    expect(() => nextDeterministicId("journal", invalidCounters)).toThrow(
      RangeError,
    );
    expect(() => nextDeterministicId("settlement", invalidCounters)).toThrow(
      RangeError,
    );
  });

  it("rejects unsafe money and rate values", () => {
    expect(cents(12_345)).toBe(12_345);
    expect(basisPoints(625)).toBe(625);
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(() => basisPoints(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
