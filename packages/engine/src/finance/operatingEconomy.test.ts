import { COMPLETION_ECONOMY_TARGETS } from "@interests/rules";
import { asAssetId, asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { createRandomState } from "../random/prng";
import { drawMarketNoiseBps, generateQuarterMarketUpdate } from "./economy";
import { cents } from "./money";
import {
  indexQuarterlyAmountCents,
  nextPropertyOccupancyBps,
  nextQuarterBaseRateBps,
  planQuarterOperatingUpdate,
  propertyReturnForecast,
} from "./operatingEconomy";
import { ownershipPpm } from "./ownership";
import { applyQuarterSettlement } from "./settlement";

const players = ["a", "b", "c", "d"].map(asPlayerId);
function ready(seed = "operating-economy"): GameState {
  let state = createGame({
    gameId: "operating-economy",
    seed,
    playerIds: players,
  });
  for (const player of players) {
    const next = applyPlayerCommand(state, player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[player]!.offeredObjectiveIds[0],
    });
    if (!next.ok) throw new Error(next.code);
    state = next.state;
  }
  return state;
}

describe("operating macro targets and indexing", () => {
  it.each([
    [450, "overheating", 500],
    [590, "overheating", 600],
    [600, "overheating", 600],
    [450, "recession", 400],
    [310, "recession", 300],
    [450, "recovery", 400],
  ] as const)(
    "moves %i toward %s by no more than 50 BPS",
    (current, regime, expected) => {
      expect(nextQuarterBaseRateBps(current, regime)).toBe(expected);
    },
  );
  it("uses nominal annual inflation /4 with HALF_UP cents and rejects overflow", () => {
    expect(indexQuarterlyAmountCents(10_000, 250)).toBe(10_063);
    expect(indexQuarterlyAmountCents(80, 250)).toBe(81);
    expect(indexQuarterlyAmountCents(0, 450)).toBe(0);
    expect(() =>
      indexQuarterlyAmountCents(Number.MAX_SAFE_INTEGER, 250),
    ).toThrow(RangeError);
  });
  it("preserves Q1 earned living and rents, then indexes Q2 inputs exactly once", () => {
    const state = ready();
    const settled = applyQuarterSettlement(state, { quarter: 1 });
    if (!settled.ok) throw new Error(settled.code);
    for (const player of players) {
      const opening = state.finance.recurringByPlayer[player]!;
      expect(
        settled.state.finance.lastSettlement!.livingByPlayer[player]!
          .currentDueCents,
      ).toBe(opening.quarterlyLivingExpenseCents);
      expect(
        settled.state.finance.recurringByPlayer[player]!.quarterlyIncomeCents,
      ).toBe(opening.quarterlyIncomeCents);
      expect(
        settled.state.finance.quarterStartBasis.recurringByPlayer[player]!
          .quarterlyLivingExpenseCents,
      ).toBe(
        indexQuarterlyAmountCents(opening.quarterlyLivingExpenseCents, 250),
      );
    }
    expect(applyQuarterSettlement(settled.state, { quarter: 1 })).toMatchObject(
      { ok: false, state: settled.state, code: "QUARTER_ALREADY_SETTLED" },
    );
    assertGameState(settled.state);
  });
  it("keeps every public-market and regime RNG draw identical over multiple quarters", () => {
    let state = ready();
    let marketRandom = state.random;
    let regime = state.economy.currentRegime;
    for (let quarter = 1; quarter <= 8; quarter++) {
      const expected = generateQuarterMarketUpdate({
        regime,
        random: marketRandom,
      });
      const settled = applyQuarterSettlement(state, { quarter });
      if (!settled.ok) throw new Error(settled.code);
      expect(settled.state.random).toEqual(expected.nextRandom);
      expect(settled.state.economy.currentRegime).toBe(expected.nextRegime);
      expect(
        settled.state.economy.lastMarketUpdate!.returnBpsByInstrument,
      ).toEqual(expected.returnBpsByInstrument);
      expect(
        Math.abs(settled.state.economy.baseRateBps - state.economy.baseRateBps),
      ).toBeLessThanOrEqual(50);
      expect(
        COMPLETION_ECONOMY_TARGETS[settled.state.economy.currentRegime].credit,
      ).toBeTruthy();
      marketRandom = expected.nextRandom;
      regime = expected.nextRegime;
      state = settled.state;
    }
  });
  it("rejects the entire settlement when indexed costs overflow, including both RNG streams", () => {
    const initial = ready();
    const player = players[0]!;
    const state = {
      ...initial,
      finance: {
        ...initial.finance,
        recurringByPlayer: {
          ...initial.finance.recurringByPlayer,
          [player]: {
            ...initial.finance.recurringByPlayer[player]!,
            quarterlyLivingExpenseCents: cents(Number.MAX_SAFE_INTEGER),
          },
        },
      },
    };
    const before = JSON.stringify(state);
    const result = applyQuarterSettlement(state, { quarter: 1 });
    expect(result).toMatchObject({ ok: false, state, journalEntries: [] });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("property closing returns", () => {
  it.each([
    ["expansion", 9600, 9400],
    ["overheating", 9800, 9700],
    ["slowdown", 9400, 9000],
    ["recession", 8800, 8000],
    ["recovery", 9500, 9000],
  ] as const)(
    "moves occupancy toward approved %s targets without overshooting",
    (regime, residential, commercial) => {
      for (const [kind, target] of [
        ["residential", residential],
        ["commercial", commercial],
      ] as const) {
        expect(nextPropertyOccupancyBps(target - 150, regime, kind)).toBe(
          target - 50,
        );
        expect(nextPropertyOccupancyBps(target + 150, regime, kind)).toBe(
          target + 50,
        );
        expect(nextPropertyOccupancyBps(target - 1, regime, kind)).toBe(target);
        expect(nextPropertyOccupancyBps(target, regime, kind)).toBe(target);
      }
    },
  );
  it("applies current-regime means and one incremental rate shock", () => {
    expect(
      propertyReturnForecast({
        regime: "expansion",
        marketKind: "residential",
        baseRateChangeBps: 50,
      }),
    ).toEqual({
      meanReturnBps: 0,
      minimumReturnBps: -75,
      maximumReturnBps: 75,
      noiseAmplitudeBps: 75,
    });
    expect(
      propertyReturnForecast({
        regime: "recession",
        marketKind: "commercial",
        baseRateChangeBps: -50,
      }),
    ).toEqual({
      meanReturnBps: -150,
      minimumReturnBps: -275,
      maximumReturnBps: -25,
      noiseAmplitudeBps: 125,
    });
  });
  it("draws property noise in canonical asset order on its separate stream and moves occupancy toward the approved target", () => {
    const state = ready();
    const a = asAssetId("property-a"),
      b = asAssetId("property-b");
    const property = {
      kind: "property" as const,
      marketKind: "residential" as const,
      marketValueCents: cents(1_000_000),
      scheduledQuarterlyRentCents: cents(10_000),
      occupancyBps: 9000 as never,
      operatingExpenseRatioBps: 3000 as never,
      ownershipByPlayerPpm: { [players[0]!]: ownershipPpm(1_000_000) },
    };
    const assets = { [b]: { ...property, id: b }, [a]: { ...property, id: a } };
    const first = drawMarketNoiseBps(state.economy.operatingRandom, 75);
    const second = drawMarketNoiseBps(first.nextState, 75);
    const result = planQuarterOperatingUpdate(state, assets, "overheating");
    expect(result.assetsById[a]).toMatchObject({
      marketValueCents: 1_000_000 + first.value * 100,
      scheduledQuarterlyRentCents: 10_063,
      occupancyBps: 9100,
    });
    expect(result.assetsById[b]).toMatchObject({
      marketValueCents: 1_000_000 + second.value * 100,
    });
    expect(result.nextOperatingRandom).toEqual(second.nextState);
    expect(
      planQuarterOperatingUpdate(
        state,
        { [a]: assets[a]!, [b]: assets[b]! },
        "overheating",
      ),
    ).toEqual(result);
    expect(state.economy.operatingRandom).toEqual(
      createRandomState("operating-economy:operating-economy-v1"),
    );
  });
  it("leaves sold property records and the operating stream untouched", () => {
    const state = ready();
    const id = asAssetId("sold-property");
    const sold = {
      id,
      kind: "property" as const,
      disposition: "sold" as const,
      marketKind: "residential" as const,
      marketValueCents: cents(1_000_000),
      scheduledQuarterlyRentCents: cents(10_000),
      occupancyBps: 9000 as never,
      operatingExpenseRatioBps: 3000 as never,
      ownershipByPlayerPpm: {},
    };
    const result = planQuarterOperatingUpdate(
      state,
      { [id]: sold },
      "overheating",
    );
    expect(result.assetsById[id]).toEqual(sold);
    expect(result.nextOperatingRandom).toEqual(state.economy.operatingRandom);
  });
  it("rejects missing or malformed operating stream snapshots instead of inventing one", () => {
    const state = ready();
    const candidate = JSON.parse(JSON.stringify(state));
    delete candidate.economy.operatingRandom;
    expect(() => assertGameState(candidate)).toThrow(
      /operating economy random/,
    );
  });
});

describe("active business operating models", () => {
  for (const [profile, sensitivity, labor] of [
    ["small-business-owner", "medium", 8_400_000],
    ["self-employed-operator", "low", 8_400_000],
    ["early-stage-entrepreneur", "high", 3_600_000],
  ] as const) {
    it(`settles earned ${profile} results before moving next-quarter inputs`, () => {
      let state: GameState | undefined;
      let assetId: ReturnType<typeof asAssetId> | undefined;
      for (let seed = 0; seed < 100; seed++) {
        const candidate = ready(`operating-${profile}-${seed}`);
        const owner = players.find(
          (id) => candidate.players[id]!.profileId === profile,
        );
        if (!owner) continue;
        const company = Object.values(candidate.finance.assetsById).find(
          (asset) =>
            asset.kind === "business" &&
            asset.operatingModel &&
            asset.ownershipByPlayerPpm[owner],
        );
        if (!company) continue;
        state = candidate;
        assetId = company.id;
        break;
      }
      if (!state || !assetId)
        throw new Error("Missing ordinary starting company");
      const opening = state.finance.assetsById[assetId];
      if (opening?.kind !== "business") throw new Error("Missing company");
      expect(opening.operatingModel).toMatchObject({
        sensitivity,
        fixedAnnualLaborCostsCents: labor,
        quarters: [],
      });
      const first = applyQuarterSettlement(state, { quarter: 1 });
      if (!first.ok) throw new Error(first.code);
      const after = first.state.finance.assetsById[assetId];
      if (after?.kind !== "business") throw new Error("Missing company");
      expect(after.operatingModel!.quarters).toEqual([
        {
          quarter: 1,
          operatingProfitCents: opening.annualOperatingProfitCents / 4,
        },
      ]);
      expect(after.enterpriseValueCents).toBe(opening.enterpriseValueCents);
      expect(
        first.settlementOutcome.businesses.find(
          (outcome) => outcome.assetId === assetId,
        )!.workCompensation!.currentDueCents,
      ).toBe(opening.workCompensation!.annualCompensationCents / 4);
      expect(after.operatingModel!.fixedAnnualLaborCostsCents).toBe(labor);
      state = first.state;
      for (let quarter = 2; quarter <= 5; quarter++) {
        const settled = applyQuarterSettlement(state, { quarter });
        if (!settled.ok) throw new Error(settled.code);
        state = settled.state;
      }
      const final = state.finance.assetsById[assetId];
      if (final?.kind !== "business") throw new Error("Missing company");
      expect(
        final.operatingModel!.quarters.map((observed) => observed.quarter),
      ).toEqual([2, 3, 4, 5]);
      expect(final.operatingModel!.fixedAnnualLaborCostsCents).toBe(labor);
      assertGameState(state);
    });
  }
  it("rejects malformed operating calibration and fabricated future observations", () => {
    let state: GameState | undefined;
    for (let seed = 0; seed < 100; seed++) {
      const candidate = ready(`model-invariant-${seed}`);
      if (
        Object.values(candidate.finance.assetsById).some(
          (asset) => asset.kind === "business" && asset.operatingModel,
        )
      ) {
        state = candidate;
        break;
      }
    }
    if (!state) throw new Error("Missing model fixture");
    const company = Object.values(state.finance.assetsById).find(
      (asset) => asset.kind === "business" && asset.operatingModel,
    )!;
    for (const defect of ["sensitivity", "denominator", "future-history"]) {
      const candidate = JSON.parse(JSON.stringify(state));
      const model = candidate.finance.assetsById[company.id].operatingModel;
      if (defect === "sensitivity") model.sensitivity = "invented";
      else if (defect === "denominator")
        model.openingValuationEarningsCents = 0;
      else model.quarters = [{ quarter: 1, operatingProfitCents: 100 }];
      expect(() => assertGameState(candidate)).toThrow(/operating/);
    }
  });
  it("keeps operating random state and raw performance histories out of all recipient views", () => {
    const state = ready();
    const changed = {
      ...state,
      economy: {
        ...state.economy,
        operatingRandom: createRandomState("other-private-operating-stream"),
      },
    };
    for (const player of players) {
      expect(projectPlayerGameState(changed, player)).toEqual(
        projectPlayerGameState(state, player),
      );
      expect(
        JSON.stringify(projectPlayerGameState(state, player)),
      ).not.toContain("operatingRandom");
      expect(projectPlayerGameState(state, player).economicConditions).toEqual({
        baseRateBps: 450,
        annualInflationBps: 250,
        creditEnvironment: "normal",
      });
    }
  });
});
