import {
  asAssetId,
  asPlayerId,
  asTransactionId,
  type PublicMarketTradeLeg,
} from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { calculateRevaluedMarketValueCents } from "./markets";
import { cents } from "./money";
import { previewPublicMarketTrade } from "./publicMarketTrading";

const players = ["p1", "p2", "p3", "p4"].map(asPlayerId);
const actor = players[0]!;
const broad = "broad-market-fund";
const growth = "growth-fund";
function setup(): GameState {
  let state = createGame({
    gameId: "market-test",
    seed: "market-test",
    playerIds: players,
  });
  for (const player of players) {
    const result = applyPlayerCommand(state, player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[player]!.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  const begin = applyPlayerCommand(state, actor, { type: "BEGIN_ROUND" });
  if (!begin.ok) throw new Error(begin.code);
  state = begin.state;
  // Synthetic accounting fixture; actions below use the real wire adapter.
  return {
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: { ...state.finance.cashByPlayer, [actor]: cents(100_000) },
      publicMarketsByPlayer: {
        ...state.finance.publicMarketsByPlayer,
        [actor]: {
          [broad]: cents(20_000),
          [growth]: cents(0),
          "income-defensive-fund": cents(0),
        },
      },
    },
    progress: {
      ...state.progress,
      byPlayer: {
        ...state.progress.byPlayer,
        [actor]: {
          ...state.progress.byPlayer[actor]!,
          publicMarketBasis: {
            [broad]: cents(12_000),
            [growth]: cents(0),
            "income-defensive-fund": cents(0),
          },
        },
      },
    },
  };
}
const buy = (amount: number): PublicMarketTradeLeg => ({
  instrumentId: growth,
  buyCents: amount,
  sellCents: 0,
});
const sell = (amount: number): PublicMarketTradeLeg => ({
  instrumentId: broad,
  buyCents: 0,
  sellCents: amount,
});
function execute(
  state: GameState,
  trades: readonly PublicMarketTradeLeg[],
  player = actor,
) {
  return applyPlayerCommand(state, player, {
    type: "TRADE_PUBLIC_MARKETS",
    trades,
  });
}

describe("production public-market baskets", () => {
  it("buys at value, capitalizes the exact fee, posts cash and advances once without RNG", () => {
    const state = setup();
    const result = execute(state, [buy(10_000)]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.finance.cashByPlayer[actor]).toBe(89_975);
    expect(result.state.finance.publicMarketsByPlayer[actor]![growth]).toBe(
      10_000,
    );
    expect(
      result.state.progress.byPlayer[actor]!.publicMarketBasis[growth],
    ).toBe(10_025);
    expect(result.state.progress.byPlayer[actor]!.realizedGainsCents).toBe(0);
    expect(
      result.journalEntries.map((entry) => [entry.reason, entry.amountCents]),
    ).toEqual([
      ["public-market-purchase", 10_000],
      ["public-market-trade-fee", 25],
    ]);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.round?.spotlightsCompleted).toBe(1);
    expect(result.state.random).toEqual(state.random);
    expect(result.state.finance.quarterStartBasis).toEqual(
      state.finance.quarterStartBasis,
    );
    assertGameState(result.state);
  });
  it("removes weighted basis and retains exact sale loss/gain evidence", () => {
    const state = setup();
    const result = execute(state, [sell(5_000)]);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.finance.cashByPlayer[actor]).toBe(104_987);
    expect(result.state.finance.publicMarketsByPlayer[actor]![broad]).toBe(
      15_000,
    );
    expect(
      result.state.progress.byPlayer[actor]!.publicMarketBasis[broad],
    ).toBe(9_000);
    expect(result.state.progress.byPlayer[actor]!.realizedGainsCents).toBe(
      1_987,
    );
    expect(
      result.state.progress.byPlayer[actor]!.publicMarketDisposals,
    ).toEqual([
      {
        instrumentId: broad,
        soldQuarter: 1,
        tradeValueCents: 5_000,
        feeCents: 13,
        removedBasisCents: 3_000,
        realizedGainCents: 1_987,
        quarterStartValueCents:
          state.finance.quarterStartBasis.publicMarketsByPlayer[actor]![broad],
      },
    ]);
  });
  it("lets sales fund purchases even when the wire puts the buy first", () => {
    const fixture = setup();
    const state = {
      ...fixture,
      finance: {
        ...fixture.finance,
        cashByPlayer: { ...fixture.finance.cashByPlayer, [actor]: cents(0) },
      },
    };
    const result = execute(state, [buy(19_000), sell(20_000)]);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.finance.cashByPlayer[actor]).toBe(902);
    expect(result.state.finance.publicMarketsByPlayer[actor]![broad]).toBe(0);
    expect(
      result.state.progress.byPlayer[actor]!.publicMarketBasis[broad],
    ).toBe(0);
    expect(
      result.state.progress.byPlayer[actor]!.publicMarketBasis[growth],
    ).toBe(19_048);
    expect(result.journalEntries.map((entry) => entry.reason)).toEqual([
      "public-market-sale",
      "public-market-trade-fee",
      "public-market-purchase",
      "public-market-trade-fee",
    ]);
    expect(execute(state, [sell(20_000), buy(19_000)])).toEqual(result);
  });
  it("rounds half cents up and records a loss including both purchase and sale fees", () => {
    const state = setup();
    expect(previewPublicMarketTrade(state, actor, [buy(200)])).toMatchObject({
      ok: true,
      preview: { totalFeesCents: 1 },
    });
    const lostBasis = {
      ...state,
      progress: {
        ...state.progress,
        byPlayer: {
          ...state.progress.byPlayer,
          [actor]: {
            ...state.progress.byPlayer[actor]!,
            publicMarketBasis: {
              ...state.progress.byPlayer[actor]!.publicMarketBasis,
              [broad]: cents(30_000),
            },
          },
        },
      },
    };
    const result = execute(lostBasis, [sell(20_000)]);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.progress.byPlayer[actor]!.realizedGainsCents).toBe(
      -10_050,
    );
    expect(
      result.state.progress.byPlayer[actor]!.publicMarketBasis[broad],
    ).toBe(0);
  });
  it.each([
    [],
    [buy(0)],
    [buy(-1)],
    [buy(0.5)],
    [buy(Number.MAX_SAFE_INTEGER + 1)],
    [buy(Number.NaN)],
    [buy(1), buy(2)],
    [{ instrumentId: "unknown", buyCents: 1, sellCents: 0 }],
    [{ instrumentId: broad, buyCents: 1, sellCents: 1 }],
    [sell(20_001)],
    [buy(100_000)],
  ])(
    "rejects malformed or unaffordable baskets atomically: %j",
    (...trades) => {
      const state = setup();
      const before = JSON.stringify(state);
      const result = execute(state, trades as PublicMarketTradeLeg[]);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
      expect(result.journalEntries).toEqual([]);
      expect(JSON.stringify(state)).toBe(before);
    },
  );
  it("previews privately off-turn but rejects execution by that player", () => {
    const state = setup();
    const recipient = players[1]!;
    expect(
      previewPublicMarketTrade(state, recipient, [buy(100)]),
    ).toMatchObject({ ok: true, preview: { revision: state.revision } });
    expect(execute(state, [buy(100)], recipient)).toMatchObject({
      ok: false,
      code: "NOT_ACTIVE_SPOTLIGHT",
      state,
    });
  });
  it("preserves reserved cash during planning and blocks execution during another transaction", () => {
    const original = setup();
    const state: GameState = {
      ...original,
      activeTransaction: {
        id: asTransactionId("transaction-1"),
        kind: "cash-business-purchase",
        buyerPlayerId: actor,
        sellerPlayerId: players[1]!,
        assetId: asAssetId("fixture"),
        purchasePriceCents: cents(99_999),
        createdQuarter: 1,
        reservation: {
          playerId: actor,
          amountCents: cents(99_999),
          purpose: "purchase-price",
        },
      },
    };
    expect(previewPublicMarketTrade(state, actor, [buy(2)])).toEqual({
      ok: false,
      code: "INSUFFICIENT_AVAILABLE_CASH",
    });
    expect(execute(state, [buy(1)])).toMatchObject({
      ok: false,
      code: "ACTIVE_TRANSACTION",
      state,
    });
  });
  it("settles the final spotlight once, dividends on opening funds and marks closing holdings", () => {
    const original = setup();
    const finalActor = players[3]!;
    const state = {
      ...original,
      round: { stage: "spotlight" as const, spotlightsCompleted: 3 },
    };
    const before = state.finance.publicMarketsByPlayer[finalActor]![growth];
    const result = execute(state, [buy(100)], finalActor);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.currentQuarter).toBe(2);
    expect(result.state.lastSettledQuarter).toBe(1);
    expect(
      result.journalEntries.filter(
        (entry) =>
          entry.destination.kind === "player" &&
          entry.destination.playerId === finalActor &&
          entry.relatedMarketInstrumentId === growth &&
          entry.reason === "public-market-dividend",
      ),
    ).toEqual([]);
    expect(
      result.state.finance.publicMarketsByPlayer[finalActor]![growth],
    ).toBe(
      calculateRevaluedMarketValueCents({
        currentValueCents: before + 100,
        returnBps:
          result.state.economy.lastMarketUpdate!.returnBpsByInstrument[growth],
      }),
    );
    expect(
      result.state.progress.byPlayer[finalActor]!.quarters[0]!.sourcesById[
        `fund:${growth}`
      ],
    ).toBeUndefined();
    expect(result.state.counters.settlement).toBe(
      state.counters.settlement + 1,
    );
    assertGameState(result.state);
  });
  it("pays the opening dividend after a full final-spotlight disposal without counting principal as income", () => {
    const initial = setup();
    const opening = {
      [broad]: cents(20_000),
      [growth]: cents(0),
      "income-defensive-fund": cents(0),
    };
    const state: GameState = {
      ...initial,
      round: { stage: "spotlight", spotlightsCompleted: 3 },
      playerOrder: [players[1]!, players[2]!, players[3]!, actor],
      finance: {
        ...initial.finance,
        quarterStartBasis: {
          ...initial.finance.quarterStartBasis,
          publicMarketsByPlayer: {
            ...initial.finance.quarterStartBasis.publicMarketsByPlayer,
            [actor]: opening,
          },
        },
      },
    };
    const result = execute(state, [sell(20_000)]);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.finance.publicMarketsByPlayer[actor]![broad]).toBe(0);
    const dividends = result.journalEntries.filter(
      (entry) =>
        entry.destination.kind === "player" &&
        entry.destination.playerId === actor &&
        entry.relatedMarketInstrumentId === broad &&
        entry.reason === "public-market-dividend",
    );
    expect(dividends.map((entry) => entry.amountCents)).toEqual([75]);
    expect(
      result.state.progress.byPlayer[actor]!.quarters[0]!.sourcesById[
        `fund:${broad}`
      ],
    ).toEqual({
      category: "public-markets",
      recurringReceivedCents: 75,
      debtServiceOwedCents: 0,
    });
    expect(
      result.state.finance.quarterStartBasis.publicMarketsByPlayer[actor]![
        broad
      ],
    ).toBe(0);
  });
  it("rejects realized-gain overflow atomically", () => {
    const initial = setup();
    const state = {
      ...initial,
      progress: {
        ...initial.progress,
        byPlayer: {
          ...initial.progress.byPlayer,
          [actor]: {
            ...initial.progress.byPlayer[actor]!,
            realizedGainsCents: cents(Number.MAX_SAFE_INTEGER),
            publicMarketBasis: {
              ...initial.progress.byPlayer[actor]!.publicMarketBasis,
              [broad]: cents(0),
            },
          },
        },
      },
    };
    expect(execute(state, [sell(1)])).toMatchObject({
      ok: false,
      code: "DESTINATION_OVERFLOW",
      state,
      journalEntries: [],
    });
  });
  it("rejects a preview whose ordered gross sale posting would overflow", () => {
    const initial = setup();
    const state = {
      ...initial,
      finance: {
        ...initial.finance,
        cashByPlayer: {
          ...initial.finance.cashByPlayer,
          [actor]: cents(Number.MAX_SAFE_INTEGER - 100),
        },
      },
    };
    const trades = [sell(1000), buy(1000)];
    expect(previewPublicMarketTrade(state, actor, trades)).toEqual({
      ok: false,
      code: "DESTINATION_OVERFLOW",
    });
    expect(execute(state, trades)).toMatchObject({
      ok: false,
      code: "DESTINATION_OVERFLOW",
      state,
      journalEntries: [],
    });
  });
  it("rejects journal exhaustion without consuming counters or financial state", () => {
    const initial = setup();
    const state = {
      ...initial,
      counters: { ...initial.counters, journal: Number.MAX_SAFE_INTEGER - 1 },
    };
    const result = execute(state, [buy(1000)]);
    expect(result).toMatchObject({
      ok: false,
      code: "JOURNAL_ID_EXHAUSTED",
      state,
      journalEntries: [],
    });
    expect(result.state).toBe(state);
  });
  it("rolls back the entire final trade when settlement cannot commit", () => {
    const initial = setup();
    const state = {
      ...initial,
      round: { stage: "spotlight" as const, spotlightsCompleted: 3 },
      counters: { ...initial.counters, settlement: Number.MAX_SAFE_INTEGER },
    };
    const result = execute(state, [buy(100)], players[3]!);
    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_ID_EXHAUSTED",
      state,
      journalEntries: [],
    });
    expect(result.state).toBe(state);
  });
  it("keeps holdings, basis and disposal differences private in paired projections", () => {
    const state = setup();
    const changed = {
      ...state,
      progress: {
        ...state.progress,
        byPlayer: {
          ...state.progress.byPlayer,
          [actor]: {
            ...state.progress.byPlayer[actor]!,
            publicMarketBasis: {
              ...state.progress.byPlayer[actor]!.publicMarketBasis,
              [broad]: cents(1),
            },
            realizedGainsCents: cents(77),
            publicMarketDisposals: [
              {
                instrumentId: broad,
                soldQuarter: 1,
                tradeValueCents: cents(100),
                feeCents: cents(0),
                removedBasisCents: cents(23),
                realizedGainCents: cents(77),
                quarterStartValueCents: cents(100),
              },
            ],
          },
        },
      },
    };
    expect(projectPlayerGameState(changed, actor)).not.toEqual(
      projectPlayerGameState(state, actor),
    );
    for (const recipient of players.slice(1)) {
      expect(projectPlayerGameState(changed, recipient)).toEqual(
        projectPlayerGameState(state, recipient),
      );
      expect(previewPublicMarketTrade(changed, recipient, [buy(10)])).toEqual(
        previewPublicMarketTrade(state, recipient, [buy(10)]),
      );
    }
  });
});
