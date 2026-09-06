import { asPlayerId } from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import { basisPoints, cents } from "./finance/money";
import { applyAction } from "./game/actions";
import { createGame } from "./game/createGame";
import { nextDeterministicId } from "./game/deterministicIds";
import type { DeterministicCounters } from "./model/gameState";
import {
  createRandomState,
  drawBoundedInt,
  drawUint32,
  drawUnitInterval,
  type RandomState,
  RNG_ALGORITHM,
  RNG_ALGORITHM_V1,
  RNG_ALGORITHM_V2,
} from "./random/prng";

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
    expect(() => drawBoundedInt(random, 0x1_0000_0000)).toThrow(RangeError);
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

  it("matches exact raw xorshift32 regression vectors and preserves raw equivalence between v1 and v2", () => {
    const expectedRawValues = [
      270369, 67634689, 2647435461, 307599695, 2398689233,
    ];

    let v2State: RandomState = { algorithm: RNG_ALGORITHM_V2, state: 1 };
    let v1State: RandomState = { algorithm: RNG_ALGORITHM_V1, state: 1 };

    for (const expected of expectedRawValues) {
      const drawV2 = drawUint32(v2State);
      const drawV1 = drawUint32(v1State);

      expect(drawV2.value).toBe(expected);
      expect(drawV2.nextState.algorithm).toBe(RNG_ALGORITHM_V2);
      expect(drawV1.value).toBe(expected);
      expect(drawV1.nextState.algorithm).toBe(RNG_ALGORITHM_V1);

      expect(drawV2.value).toBe(drawV1.value);
      expect(drawV2.nextState.state).toBe(drawV1.nextState.state);

      v2State = drawV2.nextState;
      v1State = drawV1.nextState;
    }
  });

  it("preserves intentional deterministic difference between v1 and v2 on state 1 with bound 10", () => {
    const v1: RandomState = { algorithm: RNG_ALGORITHM_V1, state: 1 };
    const v2: RandomState = { algorithm: RNG_ALGORITHM_V2, state: 1 };

    const drawV1 = drawBoundedInt(v1, 10);
    const drawV2 = drawBoundedInt(v2, 10);

    expect(drawV1.value).toBe(9);
    expect(drawV1.nextState.state).toBe(270369);
    expect(drawV1.nextState.algorithm).toBe(RNG_ALGORITHM_V1);

    expect(drawV2.value).toBe(8);
    expect(drawV2.nextState.state).toBe(270369);
    expect(drawV2.nextState.algorithm).toBe(RNG_ALGORITHM_V2);
  });

  it("exercises forced rejection path under v2 from state 8192 with bound 2147483649", () => {
    const startState: RandomState = {
      algorithm: RNG_ALGORITHM_V2,
      state: 8192,
    };
    const bound = 2147483649; // 0x80000001

    // Verify step 1 raw draw is rejected
    const firstRaw = drawUint32(startState);
    expect(firstRaw.value).toBe(2214879744);
    const firstSample = firstRaw.value - 1; // 2214879743
    const limit = 0xffffffff - (0xffffffff % bound); // 2147483649
    expect(limit).toBe(2147483649);
    expect(firstSample).toBeGreaterThanOrEqual(limit);

    // Verify step 2 raw draw is accepted
    const secondRaw = drawUint32(firstRaw.nextState);
    expect(secondRaw.value).toBe(13148770);
    const secondSample = secondRaw.value - 1; // 13148769
    expect(secondSample).toBeLessThan(limit);

    // drawBoundedInt must execute exactly this 2-draw rejection sequence
    const result = drawBoundedInt(startState, bound);
    expect(result.value).toBe(13148769);
    expect(result.nextState.state).toBe(13148770);
    expect(result.nextState.algorithm).toBe(RNG_ALGORITHM_V2);
  });

  it("verifies v2 boundary conditions for bound = 1, bound = 0xffffffff, and bound = 0x1_0000_0000", () => {
    const state1: RandomState = { algorithm: RNG_ALGORITHM_V2, state: 1 };

    // bound == 1 always returns 0 and consumes exactly one raw draw
    const drawBound1 = drawBoundedInt(state1, 1);
    expect(drawBound1.value).toBe(0);
    expect(drawBound1.nextState.state).toBe(270369);

    // bound == 0xffffffff (4294967295) is valid
    const drawMax = drawBoundedInt(state1, 0xffffffff);
    expect(drawMax.value).toBe(270368);
    expect(drawMax.nextState.state).toBe(270369);

    // bound == 0x1_0000_0000 (4294967296) must reject under v2
    expect(() => drawBoundedInt(state1, 0x1_0000_0000)).toThrow(RangeError);

    // Ordinary small bounds
    for (const b of [2, 3, 4, 5, 10, 69]) {
      const draw = drawBoundedInt(state1, b);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(b);
      expect(draw.nextState.state).toBe(270369);
    }
  });

  it("enforces strict RandomState validation and input immutability upon rejection", () => {
    const invalidStates = [
      { algorithm: RNG_ALGORITHM_V2, state: 0 },
      { algorithm: RNG_ALGORITHM_V2, state: -1 },
      { algorithm: RNG_ALGORITHM_V2, state: 0x1_0000_0000 },
      { algorithm: RNG_ALGORITHM_V2, state: 1.5 },
      { algorithm: RNG_ALGORITHM_V2, state: Number.NaN },
      { algorithm: RNG_ALGORITHM_V2, state: Number.POSITIVE_INFINITY },
      {
        algorithm: "xorshift32-v3" as unknown as typeof RNG_ALGORITHM_V2,
        state: 1,
      },
    ];

    for (const inv of invalidStates) {
      expect(() => drawUint32(inv as RandomState)).toThrow(RangeError);
      expect(() => drawBoundedInt(inv as RandomState, 10)).toThrow(RangeError);
      expect(() => drawUnitInterval(inv as RandomState)).toThrow(RangeError);
    }

    // Caller state object must remain untouched on failure
    const testState: RandomState = Object.freeze({
      algorithm: RNG_ALGORITHM_V2,
      state: 1,
    });
    expect(() => drawBoundedInt(testState, 0)).toThrow(RangeError);
    expect(testState.state).toBe(1);
    expect(testState.algorithm).toBe(RNG_ALGORITHM_V2);
  });

  it("validates createRandomState algorithm creation and seed hashing preservation", () => {
    expect(() => createRandomState("")).toThrow(RangeError);
    const defaultState = createRandomState("seed");
    expect(defaultState.algorithm).toBe(RNG_ALGORITHM_V2);
    expect(defaultState.algorithm).toBe(RNG_ALGORITHM);

    const explicitV1 = createRandomState("seed", RNG_ALGORITHM_V1);
    expect(explicitV1.algorithm).toBe(RNG_ALGORITHM_V1);

    const explicitV2 = createRandomState("seed", RNG_ALGORITHM_V2);
    expect(explicitV2.algorithm).toBe(RNG_ALGORITHM_V2);

    expect(explicitV1.state).toBe(explicitV2.state);
    expect(defaultState.state).toBe(explicitV2.state);

    expect(() =>
      createRandomState(
        "seed",
        "unsupported-algo" as unknown as typeof RNG_ALGORITHM_V2,
      ),
    ).toThrow(RangeError);
  });

  it("drawUnitInterval derives raw / 2^32, preserves algorithm, and consumes one draw", () => {
    const state1V2: RandomState = { algorithm: RNG_ALGORITHM_V2, state: 1 };
    const drawV2 = drawUnitInterval(state1V2);
    expect(drawV2.value).toBe(270369 / 0x1_0000_0000);
    expect(drawV2.nextState.algorithm).toBe(RNG_ALGORITHM_V2);
    expect(drawV2.nextState.state).toBe(270369);

    const state1V1: RandomState = { algorithm: RNG_ALGORITHM_V1, state: 1 };
    const drawV1 = drawUnitInterval(state1V1);
    expect(drawV1.value).toBe(270369 / 0x1_0000_0000);
    expect(drawV1.nextState.algorithm).toBe(RNG_ALGORITHM_V1);
    expect(drawV1.nextState.state).toBe(270369);
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
    expect(first.id).toBe(`asset-${state.counters.asset + 1}`);

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

    const t1 = nextDeterministicId("transaction", state.counters);
    const t2 = nextDeterministicId("transaction", state.counters);
    expect(t1).toEqual(t2);
    expect(t1.id).toBe("transaction-1");
    expect(t1.counters.transaction).toBe(1);
  });

  it("rejects counter increment when counter is exhausted at MAX_SAFE_INTEGER", () => {
    const kinds = [
      "asset",
      "contract",
      "loan",
      "opportunity",
      "journal",
      "settlement",
      "transaction",
    ] as const;
    for (const kind of kinds) {
      const exhaustedCounters: DeterministicCounters = {
        asset: 0,
        contract: 0,
        loan: 0,
        opportunity: 0,
        journal: 0,
        settlement: 0,
        transaction: 0,
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
      transaction: -3,
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
    expect(() => nextDeterministicId("transaction", invalidCounters)).toThrow(
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
