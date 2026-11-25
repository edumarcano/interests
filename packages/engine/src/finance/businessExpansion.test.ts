import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { getActiveSpotlightPlayerId } from "../game/round";
import type { GameState } from "../model/gameState";

const players = ["one", "two", "three", "four"].map(asPlayerId);

function command(state: GameState, actor: PlayerId, input: WirePlayerCommand) {
  const result = applyPlayerCommand(state, actor, input);
  if (!result.ok) throw new Error(result.code);
  return result;
}

function enterOwnerSpotlight() {
  let state = createGame({
    gameId: "business-expansion",
    seed: "business-expansion",
    playerIds: players,
  });
  for (const actor of players) {
    const objectiveId = state.players[actor]!.offeredObjectiveIds[0];
    state = command(state, actor, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId,
    }).state;
  }
  state = command(state, players[0]!, { type: "BEGIN_ROUND" }).state;
  while (state.currentQuarter === 1) {
    const actor = getActiveSpotlightPlayerId(state)!;
    const asset = Object.values(state.finance.assetsById).find(
      (holding) =>
        holding.kind === "business" &&
        holding.ownershipByPlayerPpm[actor] === 1_000_000,
    );
    if (asset?.kind === "business") return { state, actor, asset };
    state = command(state, actor, { type: "PASS_SPOTLIGHT" }).state;
  }
  throw new Error("Expansion seed must have an opening company");
}

function nextQuarter(state: GameState) {
  const quarter = state.currentQuarter;
  while (state.currentQuarter === quarter) {
    const actor = getActiveSpotlightPlayerId(state)!;
    state = command(state, actor, { type: "PASS_SPOTLIGHT" }).state;
  }
  return state;
}

describe("company-funded expansion", () => {
  it("spends actual company reserves once and raises operating earnings from the next quarter", () => {
    const { state, actor, asset } = enterOwnerSpotlight();
    const investmentCents = 400_000;
    const baselineQ2 = nextQuarter(state);
    const expanded = command(state, actor, {
      type: "EXPAND_BUSINESS",
      assetId: asset.id,
      investmentCents,
    });
    expect(expanded.state.revision).toBe(state.revision + 1);
    expect(expanded.journalEntries[0]).toMatchObject({
      reason: "business-expansion",
      source: { kind: "business", assetId: asset.id },
      amountCents: investmentCents,
    });
    const expandedQ2 =
      expanded.state.currentQuarter === 2
        ? expanded.state
        : nextQuarter(expanded.state);
    expect(expandedQ2.finance.cashByPlayer).toEqual(
      baselineQ2.finance.cashByPlayer,
    );
    expect(expandedQ2.finance.assetsById[asset.id]).toMatchObject({
      cashCents:
        (baselineQ2.finance.assetsById[asset.id] as typeof asset).cashCents -
        investmentCents,
      annualOperatingProfitCents: asset.annualOperatingProfitCents + 100_000,
    });
    expect(expandedQ2.finance.assetsById[asset.id]).not.toHaveProperty(
      "pendingAnnualProfitIncreaseCents",
    );
    const q1Profit =
      state.finance.quarterStartBasis.businessesById[asset.id]!
        .annualOperatingProfitCents;
    expect(
      expandedQ2.progress.byPlayer[actor]!.quarters[0]!
        .companyOperatingProfitById[asset.id],
    ).toBe(Math.round(q1Profit / 4));
    expect(
      expandedQ2.finance.quarterStartBasis.businessesById[asset.id]!
        .annualOperatingProfitCents,
    ).toBe(q1Profit + 100_000);
    const q3 = nextQuarter(
      command(expandedQ2, players[0]!, { type: "BEGIN_ROUND" }).state,
    );
    expect(
      q3.progress.byPlayer[actor]!.quarters[1]!.companyOperatingProfitById[
        asset.id
      ],
    ).toBe(Math.round(q1Profit / 4) + 25_000);
  });

  it("rejects invalid or unfunded expansion without spending cash or advancing", () => {
    const { state, actor, asset } = enterOwnerSpotlight();
    for (const input of [
      {
        assetId: "constructor",
        investmentCents: 400_000,
        code: "UNKNOWN_ASSET",
      },
      { assetId: asset.id, investmentCents: 3, code: "INVALID_EXPANSION" },
      {
        assetId: asset.id,
        investmentCents: 40_000_000,
        code: "INSUFFICIENT_FUNDS",
      },
    ]) {
      const { code, ...terms } = input;
      const result = applyPlayerCommand(state, actor, {
        type: "EXPAND_BUSINESS",
        ...terms,
      });
      expect(result).toEqual({ ok: false, state, code, journalEntries: [] });
      expect(result.state).toBe(state);
    }
  });

  it("rolls back the company posting when the last spotlight cannot settle", () => {
    const { state, actor, asset } = enterOwnerSpotlight();
    let lastSpotlight = command(nextQuarter(state), players[0]!, {
      type: "BEGIN_ROUND",
    }).state;
    for (let index = 0; index < 3; index++) {
      lastSpotlight = command(
        lastSpotlight,
        getActiveSpotlightPlayerId(lastSpotlight)!,
        { type: "PASS_SPOTLIGHT" },
      ).state;
    }
    expect(getActiveSpotlightPlayerId(lastSpotlight)).toBe(actor);
    const exhausted = {
      ...lastSpotlight,
      counters: {
        ...lastSpotlight.counters,
        settlement: Number.MAX_SAFE_INTEGER,
      },
    };
    const result = applyPlayerCommand(exhausted, actor, {
      type: "EXPAND_BUSINESS",
      assetId: asset.id,
      investmentCents: 400_000,
    });
    expect(result).toEqual({
      ok: false,
      state: exhausted,
      code: "SETTLEMENT_ID_EXHAUSTED",
      journalEntries: [],
    });
    expect(result.state).toBe(exhausted);
  });
});
