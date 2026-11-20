import {
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_NOISE_AMPLITUDE_BPS,
} from "@interests/rules";
import { asPlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import {
  drawMarketNoiseBps,
  generateQuarterMarketUpdate,
} from "../finance/economy";
import { cents } from "../finance/money";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { createGame } from "./createGame";
import { applyPlayerCommand } from "./playerCommand";
import { projectPlayerGameState } from "./playerView";
import {
  getActiveSpotlightPlayerId,
  resolveTerminalTransactionAndAdvanceSpotlight,
} from "./round";

const ids = ["a", "b", "c", "d"].map(asPlayerId);
function ordinaryLastSpotlight() {
  let state = createGame({
    gameId: "ordinary-safety-horizon",
    seed: "business-expansion",
    playerIds: ids,
  });
  for (const id of ids)
    state = applyPlayerCommand(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    }).state;
  while (
    state.currentQuarter < 32 ||
    state.round?.stage !== "spotlight" ||
    state.round.spotlightsCompleted < 3
  ) {
    const command =
      state.round?.stage === "round-start"
        ? { type: "BEGIN_ROUND" as const }
        : { type: "PASS_SPOTLIGHT" as const };
    const result = applyPlayerCommand(
      state,
      command.type === "BEGIN_ROUND"
        ? ids[0]!
        : getActiveSpotlightPlayerId(state)!,
      command,
    );
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  return state;
}
it("settles the actual 32-quarter ordinary match once and creates no Q33 state or randomness", () => {
  const state = ordinaryLastSpotlight();
  expect(state.counters.settlement).toBe(31);
  const before = JSON.stringify(state);
  const result = applyPlayerCommand(state, getActiveSpotlightPlayerId(state)!, {
    type: "PASS_SPOTLIGHT",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  const final = result.state;
  expect(final).toMatchObject({
    phase: "finished",
    currentQuarter: 32,
    lastSettledQuarter: 32,
    result: { kind: "safety-draw", completedQuarter: 32 },
    round: null,
    activeTransaction: null,
    revision: 164,
  });
  expect(final.counters.settlement).toBe(32);
  expect(final.counters.opportunity).toBe(state.counters.opportunity);
  expect(final.finance.quarterStartBasis).toEqual(
    state.finance.quarterStartBasis,
  );
  expect(final.economy.currentRegime).toBe(state.economy.currentRegime);
  expect(final.economy.baseRateBps).toBe(state.economy.baseRateBps);
  expect(final.economy.operatingRandom).toEqual(state.economy.operatingRandom);
  expect(final.content.random).toEqual(state.content.random);
  expect(final.content.generatedQuarter).toBe(32);
  expect(
    Object.values(final.content.cardsByPlayer).every(
      (card) => card && card.status === "expired",
    ),
  ).toBe(true);
  expect(final.finance.recurringByPlayer).toEqual(
    state.finance.recurringByPlayer,
  );
  const calibratedBusinesses = Object.values(final.finance.assetsById).filter(
    (asset) => asset.kind === "business" && asset.operatingModel,
  );
  expect(calibratedBusinesses.length).toBeGreaterThan(0);
  for (const asset of calibratedBusinesses) {
    if (asset.kind !== "business") throw new Error("Expected business");
    const opening = state.finance.assetsById[asset.id];
    if (opening?.kind !== "business")
      throw new Error("Expected opening business");
    expect(asset.annualRevenueCents).toBe(opening.annualRevenueCents);
    expect(asset.annualOperatingProfitCents).toBe(
      opening.annualOperatingProfitCents,
    );
    expect(asset.operatingModel?.quarters.map((row) => row.quarter)).toEqual([
      29, 30, 31, 32,
    ]);
  }
  expect(final.economy.lastMarketUpdate!.quarter).toBe(32);
  let expectedRandom = state.random;
  for (const instrument of PUBLIC_MARKET_INSTRUMENT_IDS)
    expectedRandom = drawMarketNoiseBps(
      expectedRandom,
      PUBLIC_MARKET_NOISE_AMPLITUDE_BPS[instrument],
    ).nextState;
  expect(final.random).toEqual(expectedRandom);
  expect(final.random).not.toEqual(
    generateQuarterMarketUpdate({
      regime: state.economy.currentRegime,
      random: state.random,
    }).nextRandom,
  );
  expect(result.journalEntries.length).toBeGreaterThan(0);
  expect(result.journalEntries.every((entry) => entry.quarter === 32)).toBe(
    true,
  );
  for (const id of ids) {
    expect(
      final.progress.byPlayer[id]!.quarters.map((quarter) => quarter.quarter),
    ).toEqual([29, 30, 31, 32]);
    expect(
      final.finance.lastSettlement!.livingByPlayer[id]!.currentDueCents,
    ).toBe(
      state.finance.quarterStartBasis.recurringByPlayer[id]!
        .quarterlyLivingExpenseCents,
    );
    const delta = result.journalEntries.reduce(
      (sum, entry) =>
        sum +
        (entry.destination.kind === "player" &&
        entry.destination.playerId === id
          ? entry.amountCents
          : 0) -
        (entry.source.kind === "player" && entry.source.playerId === id
          ? entry.amountCents
          : 0),
      0,
    );
    expect(final.finance.cashByPlayer[id]).toBe(
      state.finance.cashByPlayer[id]! + delta,
    );
    expect(
      projectPlayerGameState(final, id).self.ownedAssets.every(
        (asset) =>
          asset.payoutQuarter === null &&
          asset.expectedPayoutCents === null &&
          asset.expectedWorkPayCents === null,
      ),
    ).toBe(true);
    expect(projectPlayerGameState(final, id).result).toEqual({
      kind: "safety-draw",
      completedQuarter: 32,
    });
  }
  expect(JSON.stringify(state)).toBe(before);
  assertGameState(final);
  for (const command of [
    { type: "PASS_SPOTLIGHT" },
    { type: "BEGIN_ROUND" },
    { type: "RESIGN_LABOR" },
  ] as const) {
    const rejected = applyPlayerCommand(final, ids[0]!, command);
    expect(rejected).toMatchObject({
      ok: false,
      code: "WRONG_PHASE",
      journalEntries: [],
    });
    expect(rejected.state).toBe(final);
  }
});
it("rolls back the final spotlight completely if Q32 financial settlement fails", () => {
  const ordinary = ordinaryLastSpotlight();
  const staged: GameState = {
    ...ordinary,
    counters: { ...ordinary.counters, journal: Number.MAX_SAFE_INTEGER },
  };
  const before = JSON.stringify(staged);
  const rejected = applyPlayerCommand(
    staged,
    getActiveSpotlightPlayerId(staged)!,
    { type: "PASS_SPOTLIGHT" },
  );
  expect(rejected).toMatchObject({
    ok: false,
    code: "JOURNAL_ID_EXHAUSTED",
    journalEntries: [],
  });
  expect(rejected.state).toBe(staged);
  expect(JSON.stringify(staged)).toBe(before);
  expect(staged.result).toBeNull();
});

it("preserves an independently produced terminal result before the fourth Q32 spotlight can settle a draw", () => {
  const state = ordinaryLastSpotlight();
  const actor = getActiveSpotlightPlayerId(state)!;
  // Synthetic orchestration outcome, not eligibility or ordinary-victory acceptance evidence.
  const result = resolveTerminalTransactionAndAdvanceSpotlight(
    state,
    actor,
    (draft) => ({
      ok: true,
      state: {
        ...draft,
        phase: "finished",
        round: null,
        result: {
          kind: "objective-victory",
          winnerPlayerId: actor,
          completedQuarter: 32,
        },
      },
      journalEntries: [],
    }),
  );
  expect(result.ok).toBe(true);
  expect(result.state.result).toEqual({
    kind: "objective-victory",
    winnerPlayerId: actor,
    completedQuarter: 32,
  });
  expect(result.state.lastSettledQuarter).toBe(31);
  expect(result.state.counters).toEqual(state.counters);
  expect(result.state.random).toEqual(state.random);
  expect(result.state.revision).toBe(state.revision + 1);
  expect(result.journalEntries).toEqual([]);
});
