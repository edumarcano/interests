import {
  COMPATIBILITY_MATRIX,
  getCompatibility,
  isObjectiveId,
  isPairValid,
  isProfileId,
  OBJECTIVE_FAMILIES,
  OBJECTIVE_IDS,
  OBJECTIVES,
  type ObjectiveId,
  PROFILE_IDS,
  PROFILES,
  type ProfileId,
  STANDARD_V1_OBJECTIVE_CHOICES_PER_PLAYER,
  STANDARD_V1_PLAYER_COUNT,
} from "@interests/rules";
import { asPlayerId } from "@interests/shared";
import { describe, expect, it, vi } from "vitest";

import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import {
  createRandomState,
  drawBoundedInt,
  RNG_ALGORITHM_V1,
  RNG_ALGORITHM_V2,
} from "../random/prng";
import { applyAction } from "./actions";
import { createGame } from "./createGame";
import {
  FEASIBLE_PROFILE_COMBINATIONS,
  generateDeterministicSetup,
  generateValidDeals,
  isProfileCombinationFeasible,
  type ProfileCombination,
  scoreObjectivePair,
} from "./setup";

const players4 = [
  asPlayerId("alice"),
  asPlayerId("bob"),
  asPlayerId("carol"),
  asPlayerId("dave"),
] as const;

describe("Standard V1 Rules and Content Integrity", () => {
  it("defines exactly eight starting profiles with unique IDs and display names", () => {
    expect(PROFILE_IDS.length).toBe(8);
    expect(new Set(PROFILE_IDS).size).toBe(8);
    expect(Object.keys(PROFILES).length).toBe(8);

    for (const id of PROFILE_IDS) {
      expect(isProfileId(id)).toBe(true);
      expect(PROFILES[id].id).toBe(id);
      expect(PROFILES[id].name.length).toBeGreaterThan(0);
    }
  });

  it("defines exactly eight objectives across four strategic families", () => {
    expect(OBJECTIVE_IDS.length).toBe(8);
    expect(new Set(OBJECTIVE_IDS).size).toBe(8);
    expect(OBJECTIVE_FAMILIES.length).toBe(4);
    expect(new Set(OBJECTIVE_FAMILIES).size).toBe(4);

    const familyCounts: Record<string, number> = {};
    for (const id of OBJECTIVE_IDS) {
      expect(isObjectiveId(id)).toBe(true);
      const def = OBJECTIVES[id];
      expect(def.id).toBe(id);
      expect(def.name.length).toBeGreaterThan(0);
      familyCounts[def.family] = (familyCounts[def.family] ?? 0) + 1;
    }

    for (const family of OBJECTIVE_FAMILIES) {
      expect(familyCounts[family]).toBe(2);
    }
  });

  it("contains complete compatibility data referencing only valid profiles and objectives", () => {
    for (const profileId of PROFILE_IDS) {
      for (const objectiveId of OBJECTIVE_IDS) {
        const rating = getCompatibility(profileId, objectiveId);
        expect(["S", "V", "T"]).toContain(rating);
        expect(COMPATIBILITY_MATRIX[profileId][objectiveId]).toBe(rating);
      }
    }
  });

  it("declares standard V1 player count and objective choice constants", () => {
    expect(STANDARD_V1_PLAYER_COUNT).toBe(4);
    expect(STANDARD_V1_OBJECTIVE_CHOICES_PER_PLAYER).toBe(2);
  });
});

describe("Standard V1 Initialization Validation", () => {
  it("succeeds with exactly four unique player IDs", () => {
    const state = createGame({
      gameId: "match-1",
      seed: "seed-alpha",
      playerIds: players4,
    });
    expect(state.playerOrder).toEqual(players4);
    expect(state.phase).toBe("objective-choosing");
    expect(state.revision).toBe(0);
  });

  it("rejects fewer than four players", () => {
    expect(() =>
      createGame({
        gameId: "match-1",
        seed: "seed",
        playerIds: [asPlayerId("p1"), asPlayerId("p2"), asPlayerId("p3")],
      }),
    ).toThrow(/requires exactly 4 players/);
  });

  it("rejects more than four players", () => {
    expect(() =>
      createGame({
        gameId: "match-1",
        seed: "seed",
        playerIds: [
          asPlayerId("p1"),
          asPlayerId("p2"),
          asPlayerId("p3"),
          asPlayerId("p4"),
          asPlayerId("p5"),
        ],
      }),
    ).toThrow(/requires exactly 4 players/);
  });

  it("rejects duplicate player IDs", () => {
    expect(() =>
      createGame({
        gameId: "match-1",
        seed: "seed",
        playerIds: [
          asPlayerId("p1"),
          asPlayerId("p2"),
          asPlayerId("p3"),
          asPlayerId("p1"),
        ],
      }),
    ).toThrow(/player IDs must be unique/);
  });
});

describe("Deterministic Profile Assignment and Feasibility", () => {
  it("assigns exactly four unique profiles per game", () => {
    const state = createGame({
      gameId: "match-1",
      seed: "seed-profiles",
      playerIds: players4,
    });
    const assigned = players4.map((p) => state.players[p]?.profileId);
    expect(assigned.length).toBe(4);
    expect(new Set(assigned).size).toBe(4);
    for (const profile of assigned) {
      expect(isProfileId(profile)).toBe(true);
    }
  });

  it("exhaustively proves 69 feasible 4-profile combinations and 1 infeasible combination", () => {
    expect(FEASIBLE_PROFILE_COMBINATIONS.length).toBe(69);

    // Enumerate all 70 combinations of 4 out of 8
    const allCombos: ProfileCombination[] = [];
    const total = PROFILE_IDS.length;
    for (let i = 0; i < total; i += 1) {
      for (let j = i + 1; j < total; j += 1) {
        for (let k = j + 1; k < total; k += 1) {
          for (let l = k + 1; l < total; l += 1) {
            const p0 = PROFILE_IDS[i];
            const p1 = PROFILE_IDS[j];
            const p2 = PROFILE_IDS[k];
            const p3 = PROFILE_IDS[l];
            if (
              p0 !== undefined &&
              p1 !== undefined &&
              p2 !== undefined &&
              p3 !== undefined
            ) {
              allCombos.push([p0, p1, p2, p3]);
            }
          }
        }
      }
    }
    expect(allCombos.length).toBe(70);

    const infeasible = allCombos.filter(
      (c) => !isProfileCombinationFeasible(c),
    );
    expect(infeasible.length).toBe(1);
    expect(infeasible[0]).toEqual([
      "disciplined-saver",
      "small-business-owner",
      "property-starter",
      "early-stage-entrepreneur",
    ]);

    // Verify all 69 feasible combinations can achieve the theoretical max score of 8
    for (const combo of FEASIBLE_PROFILE_COMBINATIONS) {
      const deals = generateValidDeals(combo);
      expect(deals.length).toBeGreaterThan(0);
      const score8Deals = deals.filter((d) => d.score === 8);
      expect(score8Deals.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("Deterministic Objective Deal", () => {
  it("deals each player exactly two distinct compatible objective offers", () => {
    const state = createGame({
      gameId: "match-1",
      seed: "seed-deals",
      playerIds: players4,
    });

    const globallyOffered = new Set<string>();

    for (const playerId of players4) {
      const player = state.players[playerId];
      expect(player).toBeDefined();
      if (player === undefined) continue;

      expect(player.offeredObjectiveIds.length).toBe(2);
      const [first, second] = player.offeredObjectiveIds;
      expect(first).not.toBe(second);

      // Must be compatible: no T, at least one S
      expect(isPairValid(player.profileId, first, second)).toBe(true);

      globallyOffered.add(first);
      globallyOffered.add(second);
    }

    // All 8 objectives dealt exactly once across the match
    expect(globallyOffered.size).toBe(8);
    for (const objId of OBJECTIVE_IDS) {
      expect(globallyOffered.has(objId)).toBe(true);
    }
  });

  it("guarantees chosen deals are within the high-quality subset (score >= maxScore - 1)", () => {
    const scoresSeen = new Set<number>();

    for (let s = 1; s <= 50; s += 1) {
      const state = createGame({
        gameId: `test-deal-${s}`,
        seed: `deal-seed-${s}`,
        playerIds: players4,
      });

      let totalScore = 0;
      for (const playerId of players4) {
        const player = state.players[playerId];
        expect(player).toBeDefined();
        if (player === undefined) continue;
        const [o1, o2] = player.offeredObjectiveIds;
        totalScore += scoreObjectivePair(player.profileId, o1, o2);
      }

      // Max score for all feasible combinations is 8, so high-quality subset is score >= 7
      expect(totalScore).toBeGreaterThanOrEqual(7);
      expect(totalScore).toBeLessThanOrEqual(8);
      scoresSeen.add(totalScore);
    }

    // Both top score 8 and near-top score 7 should appear across a 50-game sample
    expect(scoresSeen.has(7)).toBe(true);
    expect(scoresSeen.has(8)).toBe(true);
  });
});

describe("Determinism and Randomness Integrity", () => {
  it("produces identical setup and RNG state for the same seed and input", () => {
    const input1 = {
      gameId: "g1",
      seed: "fixed-seed-42",
      playerIds: players4,
    };
    const input2 = {
      gameId: "g1",
      seed: "fixed-seed-42",
      playerIds: players4,
    };

    const state1 = createGame(input1);
    const state2 = createGame(input2);

    expect(state1).toEqual(state2);
    expect(state1.random).toEqual(state2.random);
  });

  it("produces multiple distinct valid setups across a deterministic batch of seeds", () => {
    const profileCombosSeen = new Set<string>();
    const dealsSeen = new Set<string>();

    for (let i = 0; i < 15; i += 1) {
      const state = createGame({
        gameId: `batch-${i}`,
        seed: `batch-seed-${i}`,
        playerIds: players4,
      });

      const profilesKey = players4
        .map((p) => state.players[p]?.profileId)
        .join(",");
      const dealsKey = players4
        .map((p) => state.players[p]?.offeredObjectiveIds.join("-"))
        .join(",");

      profileCombosSeen.add(profilesKey);
      dealsSeen.add(dealsKey);
    }

    expect(profileCombosSeen.size).toBeGreaterThan(1);
    expect(dealsSeen.size).toBeGreaterThan(1);
  });

  it("never calls Math.random during setup generation", () => {
    const spy = vi.spyOn(Math, "random");
    createGame({
      gameId: "g-norandom",
      seed: "no-math-random-seed",
      playerIds: players4,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("CHOOSE_OBJECTIVE Action and Phase Progression", () => {
  it("accepts valid offered objective selection and increments revision without RNG consumption", () => {
    const state = createGame({
      gameId: "match-1",
      seed: "choice-seed",
      playerIds: players4,
    });

    const player1 = players4[0];
    const player1State = state.players[player1];
    expect(player1State).toBeDefined();
    if (player1State === undefined) return;
    expect(player1State.selectedObjectiveId).toBeNull();

    const chosenOffer = player1State.offeredObjectiveIds[0];
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: player1,
      objectiveId: chosenOffer,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.random).toEqual(state.random);
    expect(result.state.counters).toEqual(state.counters);
    expect(result.state.players[player1]?.selectedObjectiveId).toBe(
      chosenOffer,
    );
    expect(result.state.phase).toBe("objective-choosing");
  });

  it("rejects non-offered objective selection and leaves state untouched", () => {
    const state = createGame({
      gameId: "match-1",
      seed: "choice-seed",
      playerIds: players4,
    });
    const player1 = players4[0];
    const player1State = state.players[player1];
    expect(player1State).toBeDefined();
    if (player1State === undefined) return;
    const nonOffered = OBJECTIVE_IDS.find(
      (id) => !player1State.offeredObjectiveIds.includes(id),
    );
    expect(nonOffered).toBeDefined();
    if (nonOffered === undefined) return;

    const snapshot = structuredClone(state);
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: player1,
      objectiveId: nonOffered,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("OBJECTIVE_NOT_OFFERED");
    expect(result.state).toBe(state);
    expect(state).toEqual(snapshot);
  });

  it("rejects unknown player and leaves state untouched", () => {
    const state = createGame({
      gameId: "match-1",
      seed: "choice-seed",
      playerIds: players4,
    });
    const snapshot = structuredClone(state);

    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: asPlayerId("unknown-player"),
      objectiveId: "founder",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNKNOWN_PLAYER");
    expect(result.state).toBe(state);
    expect(state).toEqual(snapshot);
  });

  it("rejects duplicate selection by the same player (cannot pivot)", () => {
    const state = createGame({
      gameId: "match-1",
      seed: "choice-seed",
      playerIds: players4,
    });
    const player1 = players4[0];
    const player1State = state.players[player1];
    expect(player1State).toBeDefined();
    if (player1State === undefined) return;
    const [offer1, offer2] = player1State.offeredObjectiveIds;

    const step1 = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: player1,
      objectiveId: offer1,
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;

    // Second choice by same player
    const step2 = applyAction(step1.state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: player1,
      objectiveId: offer2,
    });
    expect(step2.ok).toBe(false);
    if (step2.ok) return;
    expect(step2.code).toBe("ALREADY_CHOSEN");
    expect(step2.state).toBe(step1.state);
  });

  it("remains in objective-choosing for first 3 players and advances to ready-for-first-round after 4th", () => {
    let state = createGame({
      gameId: "match-progression",
      seed: "progression-seed",
      playerIds: players4,
    });

    // Players 0, 1, 2 choose
    for (let i = 0; i < 3; i += 1) {
      const pid = players4[i];
      expect(pid).toBeDefined();
      if (pid === undefined) return;
      const player = state.players[pid];
      expect(player).toBeDefined();
      if (player === undefined) return;

      const offer = player.offeredObjectiveIds[0];
      const res = applyAction(state, {
        type: "CHOOSE_OBJECTIVE",
        playerId: pid,
        objectiveId: offer,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      state = res.state;
      expect(state.phase).toBe("objective-choosing");
    }

    // Player 3 chooses
    const lastPid = players4[3];
    expect(lastPid).toBeDefined();
    if (lastPid === undefined) return;
    const lastPlayer = state.players[lastPid];
    expect(lastPlayer).toBeDefined();
    if (lastPlayer === undefined) return;

    const lastOffer = lastPlayer.offeredObjectiveIds[1];
    const finalRes = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: lastPid,
      objectiveId: lastOffer,
    });
    expect(finalRes.ok).toBe(true);
    if (!finalRes.ok) return;
    state = finalRes.state;

    expect(state.phase).toBe("ready-for-first-round");
    expect(state.revision).toBe(4);

    // Attempting action in ready-for-first-round must reject with WRONG_PHASE
    const p0 = players4[0];
    const p0State = state.players[p0];
    expect(p0State).toBeDefined();
    if (p0State === undefined) return;

    const extraAction = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: p0,
      objectiveId: p0State.offeredObjectiveIds[0],
    });
    expect(extraAction.ok).toBe(false);
    if (extraAction.ok) return;
    expect(extraAction.code).toBe("WRONG_PHASE");
  });
});

describe("assertGameState Invariant Coverage", () => {
  it("rejects state with invalid player count in playerOrder", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const mutated = {
      ...valid,
      playerOrder: [players4[0], players4[1], players4[2]],
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /requires exactly 4 players/,
    );
  });

  it("rejects state with duplicate profile assignment", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const p0 = players4[0];
    const p1 = players4[1];
    const p0State = valid.players[p0];
    const p1State = valid.players[p1];
    expect(p0State).toBeDefined();
    expect(p1State).toBeDefined();
    if (p0State === undefined || p1State === undefined) return;

    const mutated = {
      ...valid,
      players: {
        ...valid.players,
        [p1]: {
          ...p1State,
          profileId: p0State.profileId,
        },
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /duplicate profileId/,
    );
  });

  it("rejects state with duplicate offer in a single player pair", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const p0 = players4[0];
    const p0State = valid.players[p0];
    expect(p0State).toBeDefined();
    if (p0State === undefined) return;

    const mutated = {
      ...valid,
      players: {
        ...valid.players,
        [p0]: {
          ...p0State,
          offeredObjectiveIds: ["founder", "founder"] as readonly [
            ObjectiveId,
            ObjectiveId,
          ],
        },
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /duplicate objective offer/,
    );
  });

  it("rejects state with incompatible objective offers (e.g. Stretch)", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const p0 = players4[0];
    const p0State = valid.players[p0];
    expect(p0State).toBeDefined();
    if (p0State === undefined) return;

    // property-magnate is Stretch (T) for early-stage-entrepreneur
    const mutated = {
      ...valid,
      players: {
        ...valid.players,
        [p0]: {
          ...p0State,
          profileId: "early-stage-entrepreneur" as ProfileId,
          offeredObjectiveIds: ["property-magnate", "founder"] as readonly [
            ObjectiveId,
            ObjectiveId,
          ],
        },
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /incompatible with profile/,
    );
  });

  it("rejects ready-for-first-round phase if any player has not selected", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const mutated = {
      ...valid,
      phase: "ready-for-first-round",
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /ready-for-first-round requires all 4 players to have selected/,
    );
  });

  it("rejects state with missing or invalid finance state", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const mutated = {
      ...valid,
      finance: undefined,
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /finance state is missing or invalid/,
    );
  });

  it("rejects state where a player is missing a cash balance", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const { [players4[0]]: _, ...rest } = valid.finance.cashByPlayer;
    const mutated = {
      ...valid,
      finance: {
        cashByPlayer: rest,
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /cashByPlayer must have exactly 4 player balances/,
    );
  });

  it("rejects state with extra unknown player cash balance", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const mutated = {
      ...valid,
      finance: {
        cashByPlayer: {
          ...valid.finance.cashByPlayer,
          [asPlayerId("intruder")]: 1_000_000,
        },
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /cashByPlayer must have exactly 4 player balances/,
    );
  });

  it("rejects state with negative player cash balance", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const mutated = {
      ...valid,
      finance: {
        cashByPlayer: {
          ...valid.finance.cashByPlayer,
          [players4[0]]: -100,
        },
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /cash balance must be a non-negative safe integer of cents/,
    );
  });

  it("rejects state with non-integer or unsafe cash balance", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const mutated = {
      ...valid,
      finance: {
        cashByPlayer: {
          ...valid.finance.cashByPlayer,
          [players4[0]]: 100.5,
        },
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /cash balance must be a non-negative safe integer of cents/,
    );
  });

  it("rejects state with invalid journal counter", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });
    const mutated = {
      ...valid,
      counters: {
        ...valid.counters,
        journal: -1,
      },
    };
    expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
      /deterministic counters must be non-negative safe integers|journal counter must be a non-negative safe integer/,
    );
  });

  it("rejects state with invalid random state values or unsupported algorithm", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });

    const invalidRandomStates = [
      { algorithm: RNG_ALGORITHM_V2, state: 0 },
      { algorithm: RNG_ALGORITHM_V2, state: -1 },
      { algorithm: RNG_ALGORITHM_V2, state: 0x1_0000_0000 },
      { algorithm: RNG_ALGORITHM_V2, state: 1.5 },
      {
        algorithm: "xorshift32-v3" as unknown as typeof RNG_ALGORITHM_V2,
        state: 1,
      },
    ];

    for (const inv of invalidRandomStates) {
      const mutated = {
        ...valid,
        random: inv,
      };
      expect(() => assertGameState(mutated as unknown as GameState)).toThrow(
        /Game invariant failed: random state is invalid/,
      );
    }
  });

  it("accepts valid minimum and maximum nonzero uint32 random states for v1 and v2", () => {
    const valid = createGame({
      gameId: "g",
      seed: "s",
      playerIds: players4,
    });

    const validRandomStates = [
      { algorithm: RNG_ALGORITHM_V1, state: 1 },
      { algorithm: RNG_ALGORITHM_V1, state: 0xffffffff },
      { algorithm: RNG_ALGORITHM_V2, state: 1 },
      { algorithm: RNG_ALGORITHM_V2, state: 0xffffffff },
    ];

    for (const rnd of validRandomStates) {
      const mutated = {
        ...valid,
        random: rnd,
      };
      expect(() =>
        assertGameState(mutated as unknown as GameState),
      ).not.toThrow();
    }
  });
});

describe("Standard V1 Starting Cash Initialization", () => {
  it("initializes every player with exactly one cash balance derived from assigned profile", () => {
    const state = createGame({
      gameId: "cash-init-game",
      seed: "arbitrary-seed-1",
      playerIds: players4,
    });

    expect(Object.keys(state.finance.cashByPlayer)).toHaveLength(4);

    for (const playerId of players4) {
      const player = state.players[playerId];
      expect(player).toBeDefined();
      if (!player) continue;

      const profileDef = PROFILES[player.profileId];
      expect(profileDef).toBeDefined();
      const expectedCash = profileDef.startingCashCents;

      const actualCash = state.finance.cashByPlayer[playerId];
      expect(actualCash).toBe(expectedCash);
      expect(Number.isSafeInteger(actualCash)).toBe(true);
      expect(actualCash).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces identical financial state for identical inputs", () => {
    const input = {
      gameId: "cash-det-game",
      seed: "cash-det-seed",
      playerIds: players4,
    };
    const s1 = createGame(input);
    const s2 = createGame(input);
    expect(s1.finance).toEqual(s2.finance);
    expect(s1.counters.journal).toBe(0);
    expect(s2.counters.journal).toBe(0);
  });

  it("does not advance journal counters or consume extra RNG during cash initialization", () => {
    const state = createGame({
      gameId: "g-rng-check",
      seed: "rng-seed-check",
      playerIds: players4,
    });

    expect(state.counters.journal).toBe(0);

    // Verify RNG state matches running setup without cash
    const initialRandom = createRandomState("rng-seed-check");
    const setupOnly = generateDeterministicSetup(players4, initialRandom);
    expect(state.random).toEqual(setupOnly.random);
  });
});

describe("Unbiased Bounded Integer PRNG Helper", () => {
  it("draws values strictly within [0, bound - 1] without modulo bias", () => {
    let random = createRandomState("rejection-sampling-seed");
    for (let bound = 1; bound <= 10; bound += 1) {
      const draw = drawBoundedInt(random, bound);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(bound);
      random = draw.nextState;
    }
  });

  it("produces deterministic repeatable sequences for bounded draws", () => {
    const r1 = createRandomState("repeatable-bound");
    const r2 = createRandomState("repeatable-bound");

    let cur1 = r1;
    let cur2 = r2;
    for (let i = 0; i < 20; i += 1) {
      const d1 = drawBoundedInt(cur1, 7);
      const d2 = drawBoundedInt(cur2, 7);
      expect(d1.value).toBe(d2.value);
      expect(d1.nextState).toEqual(d2.nextState);
      cur1 = d1.nextState;
      cur2 = d2.nextState;
    }
  });
});
