import { asAssetId, asPlayerId, asTransactionId } from "@interests/shared";
import { describe, expect, it } from "vitest";

import { cents } from "../finance/money";
import { createSoleOwnership } from "../finance/ownership";
import { applyQuarterSettlement, settleQuarter } from "../finance/settlement";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import {
  applyCancelActiveTransaction,
  applyCloseCashBusinessPurchaseTransaction,
  cancelActiveTransaction,
  closeCashBusinessPurchaseTransaction,
  openCashBusinessPurchaseTransaction,
} from "../transactions/cashBusinessPurchase";
import { applyAction } from "./actions";
import { createGame } from "./createGame";
import { applyPlayerCommand } from "./playerCommand";
import {
  advanceSpotlight,
  beginRound,
  cancelActiveTransactionAndAdvanceSpotlight,
  closeCashBusinessPurchaseAndAdvanceSpotlight,
  getActiveSpotlightPlayerId,
  getSpotlightOrder,
  resolveTerminalTransactionAndAdvanceSpotlight,
} from "./round";

const pA = asPlayerId("player-A");
const pB = asPlayerId("player-B");
const pC = asPlayerId("player-C");
const pD = asPlayerId("player-D");
const playerIds = [pA, pB, pC, pD] as const;

function createTestGame(): GameState {
  return createGame({
    gameId: "round-test-game",
    seed: "round-test-seed",
    playerIds,
  });
}

function chooseAllObjectives(initialState: GameState): GameState {
  let state = initialState;
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId]!;
    const objectiveId = player.offeredObjectiveIds[0]!;
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId,
      objectiveId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    state = result.state;
  }
  return state;
}

describe("Section 16: Rotating Spotlight Order", () => {
  it("rotates deterministically across Q1 to Q5 for 4 players", () => {
    const state = { playerOrder: [pA, pB, pC, pD] };

    expect(getSpotlightOrder({ ...state, currentQuarter: 1 })).toEqual([
      pA,
      pB,
      pC,
      pD,
    ]);
    expect(getSpotlightOrder({ ...state, currentQuarter: 2 })).toEqual([
      pB,
      pC,
      pD,
      pA,
    ]);
    expect(getSpotlightOrder({ ...state, currentQuarter: 3 })).toEqual([
      pC,
      pD,
      pA,
      pB,
    ]);
    expect(getSpotlightOrder({ ...state, currentQuarter: 4 })).toEqual([
      pD,
      pA,
      pB,
      pC,
    ]);
    expect(getSpotlightOrder({ ...state, currentQuarter: 5 })).toEqual([
      pA,
      pB,
      pC,
      pD,
    ]);
  });

  it("rotates in a collection-generic manner for 2, 3, and 5 players", () => {
    const twoPlayers = [pA, pB];
    expect(
      getSpotlightOrder({ playerOrder: twoPlayers, currentQuarter: 1 }),
    ).toEqual([pA, pB]);
    expect(
      getSpotlightOrder({ playerOrder: twoPlayers, currentQuarter: 2 }),
    ).toEqual([pB, pA]);
    expect(
      getSpotlightOrder({ playerOrder: twoPlayers, currentQuarter: 3 }),
    ).toEqual([pA, pB]);

    const threePlayers = [pA, pB, pC];
    expect(
      getSpotlightOrder({ playerOrder: threePlayers, currentQuarter: 1 }),
    ).toEqual([pA, pB, pC]);
    expect(
      getSpotlightOrder({ playerOrder: threePlayers, currentQuarter: 2 }),
    ).toEqual([pB, pC, pA]);
    expect(
      getSpotlightOrder({ playerOrder: threePlayers, currentQuarter: 3 }),
    ).toEqual([pC, pA, pB]);
    expect(
      getSpotlightOrder({ playerOrder: threePlayers, currentQuarter: 4 }),
    ).toEqual([pA, pB, pC]);

    const pE = asPlayerId("player-E");
    const fivePlayers = [pA, pB, pC, pD, pE];
    expect(
      getSpotlightOrder({ playerOrder: fivePlayers, currentQuarter: 1 }),
    ).toEqual([pA, pB, pC, pD, pE]);
    expect(
      getSpotlightOrder({ playerOrder: fivePlayers, currentQuarter: 2 }),
    ).toEqual([pB, pC, pD, pE, pA]);
    expect(
      getSpotlightOrder({ playerOrder: fivePlayers, currentQuarter: 5 }),
    ).toEqual([pE, pA, pB, pC, pD]);
    expect(
      getSpotlightOrder({ playerOrder: fivePlayers, currentQuarter: 6 }),
    ).toEqual([pA, pB, pC, pD, pE]);
  });

  it("derives active spotlight player or null when not in spotlight stage", () => {
    const state = {
      playerOrder: [pA, pB, pC, pD],
      currentQuarter: 1,
      round: null,
    };
    expect(getActiveSpotlightPlayerId(state)).toBeNull();

    const roundStartState = {
      ...state,
      round: { stage: "round-start" as const, spotlightsCompleted: 0 },
    };
    expect(getActiveSpotlightPlayerId(roundStartState)).toBeNull();

    const spotlight0State = {
      ...state,
      round: { stage: "spotlight" as const, spotlightsCompleted: 0 },
    };
    expect(getActiveSpotlightPlayerId(spotlight0State)).toBe(pA);

    const spotlight1State = {
      ...state,
      round: { stage: "spotlight" as const, spotlightsCompleted: 1 },
    };
    expect(getActiveSpotlightPlayerId(spotlight1State)).toBe(pB);

    const q2Spotlight0State = {
      ...state,
      currentQuarter: 2,
      round: { stage: "spotlight" as const, spotlightsCompleted: 0 },
    };
    expect(getActiveSpotlightPlayerId(q2Spotlight0State)).toBe(pB);
  });
});

describe("Section 17: Required Engine Tests", () => {
  it("1. fourth objective selection creates Q1 round-start", () => {
    let state = createTestGame();
    expect(state.phase).toBe("objective-choosing");
    expect(state.round).toBeNull();

    for (let i = 0; i < 3; i++) {
      const pId = state.playerOrder[i]!;
      const res = applyAction(state, {
        type: "CHOOSE_OBJECTIVE",
        playerId: pId,
        objectiveId: state.players[pId]!.offeredObjectiveIds[0]!,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error();
      state = res.state;
      expect(state.phase).toBe("objective-choosing");
      expect(state.round).toBeNull();
    }

    const fourthPlayerId = state.playerOrder[3]!;
    const res = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId: fourthPlayerId,
      objectiveId: state.players[fourthPlayerId]!.offeredObjectiveIds[0]!,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error();
    state = res.state;

    expect(state.phase).toBe("ready-for-first-round");
    expect(state.round).toEqual({
      stage: "round-start",
      spotlightsCompleted: 0,
    });
    expect(state.currentQuarter).toBe(1);
    expect(getActiveSpotlightPlayerId(state)).toBeNull();
  });

  it("2. BEGIN_ROUND enters Q1 Spotlight A", () => {
    const readyState = chooseAllObjectives(createTestGame());
    expect(readyState.round?.stage).toBe("round-start");

    const result = beginRound(readyState);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();

    expect(result.state.round).toEqual({
      stage: "spotlight",
      spotlightsCompleted: 0,
    });
    expect(getActiveSpotlightPlayerId(result.state)).toBe(pA);
  });

  it("3. BEGIN_ROUND consumes no RNG/counters/finance/economy changes", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const result = beginRound(readyState);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();

    const next = result.state;
    expect(next.revision).toBe(readyState.revision + 1);
    expect(next.random).toEqual(readyState.random);
    expect(next.counters).toEqual(readyState.counters);
    expect(next.finance).toEqual(readyState.finance);
    expect(next.economy).toEqual(readyState.economy);
    expect(next.currentQuarter).toBe(readyState.currentQuarter);
    expect(next.lastSettledQuarter).toBe(readyState.lastSettledQuarter);
    expect(result.journalEntries).toEqual([]);
  });

  it("4. BEGIN_ROUND in an invalid round stage rejects unchanged", () => {
    const choosingState = createTestGame();
    const rej1 = beginRound(choosingState);
    expect(rej1.ok).toBe(false);
    if (rej1.ok) throw new Error();
    expect(rej1.code).toBe("WRONG_PHASE");
    expect(rej1.state).toBe(choosingState);

    const readyState = chooseAllObjectives(createTestGame());
    const spotlightState = beginRound(readyState);
    if (!spotlightState.ok) throw new Error();

    const rej2 = beginRound(spotlightState.state);
    expect(rej2.ok).toBe(false);
    if (rej2.ok) throw new Error();
    expect(rej2.code).toBe("WRONG_ROUND_STAGE");
    expect(rej2.state).toBe(spotlightState.state);
  });

  it("5. active spotlight can pass", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const beginRes = beginRound(readyState);
    if (!beginRes.ok) throw new Error();

    const passRes = advanceSpotlight(beginRes.state, pA);
    expect(passRes.ok).toBe(true);
    if (!passRes.ok) throw new Error();

    expect(passRes.state.round).toEqual({
      stage: "spotlight",
      spotlightsCompleted: 1,
    });
    expect(getActiveSpotlightPlayerId(passRes.state)).toBe(pB);
  });

  it("6. non-active spotlight cannot pass", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const beginRes = beginRound(readyState);
    if (!beginRes.ok) throw new Error();

    const passRes = advanceSpotlight(beginRes.state, pB);
    expect(passRes.ok).toBe(false);
    if (passRes.ok) throw new Error();
    expect(passRes.code).toBe("NOT_ACTIVE_SPOTLIGHT");
    expect(passRes.state).toBe(beginRes.state);
  });

  it("7. rejected pass preserves revision/RNG/counters/state", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const beginRes = beginRound(readyState);
    if (!beginRes.ok) throw new Error();

    const before = beginRes.state;
    const passRes = advanceSpotlight(before, pC);
    expect(passRes.ok).toBe(false);
    expect(passRes.state).toBe(before);
    expect(passRes.state.revision).toBe(before.revision);
    expect(passRes.state.random).toEqual(before.random);
    expect(passRes.state.counters).toEqual(before.counters);
  });

  it("8. active transaction blocks pass", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const beginRes = beginRound(readyState);
    if (!beginRes.ok) throw new Error();

    const bizId = asAssetId("biz-1");
    const testBiz: BusinessAsset = {
      id: bizId,
      kind: "business",
      annualRevenueCents: cents(5_000_000),
      annualOperatingProfitCents: cents(1_000_000),
      enterpriseValueCents: cents(10_000_000),
      debtPrincipalCents: cents(0),
      ownershipByPlayerPpm: createSoleOwnership(pB),
    };

    const stateWithBiz: GameState = {
      ...beginRes.state,
      finance: {
        ...beginRes.state.finance,
        cashByPlayer: {
          ...beginRes.state.finance.cashByPlayer,
          [pA]: cents(10_000_000),
        },
        assetsById: {
          ...beginRes.state.finance.assetsById,
          [bizId]: testBiz,
        },
      },
    };

    const openTx = openCashBusinessPurchaseTransaction(stateWithBiz, {
      buyerPlayerId: pA,
      sellerPlayerId: pB,
      assetId: bizId,
      purchasePriceCents: 5_000_000,
    });
    expect(openTx.ok).toBe(true);
    if (!openTx.ok) throw new Error();

    const passRes = advanceSpotlight(openTx.state, pA);
    expect(passRes.ok).toBe(false);
    if (passRes.ok) throw new Error();
    expect(passRes.code).toBe("ACTIVE_TRANSACTION");
    expect(passRes.state).toBe(openTx.state);
  });

  it("9. spotlights advance A -> B -> C -> D", () => {
    const readyState = chooseAllObjectives(createTestGame());
    let state = beginRound(readyState).ok
      ? (beginRound(readyState) as { ok: true; state: GameState }).state
      : readyState;

    expect(getActiveSpotlightPlayerId(state)).toBe(pA);

    const passA = advanceSpotlight(state, pA);
    expect(passA.ok).toBe(true);
    if (!passA.ok) throw new Error();
    state = passA.state;
    expect(getActiveSpotlightPlayerId(state)).toBe(pB);

    const passB = advanceSpotlight(state, pB);
    expect(passB.ok).toBe(true);
    if (!passB.ok) throw new Error();
    state = passB.state;
    expect(getActiveSpotlightPlayerId(state)).toBe(pC);

    const passC = advanceSpotlight(state, pC);
    expect(passC.ok).toBe(true);
    if (!passC.ok) throw new Error();
    state = passC.state;
    expect(getActiveSpotlightPlayerId(state)).toBe(pD);
    expect(state.round?.spotlightsCompleted).toBe(3);
  });

  it("10. passing D settles Quarter 1 exactly once", () => {
    const readyState = chooseAllObjectives(createTestGame());
    let state = (beginRound(readyState) as { ok: true; state: GameState })
      .state;

    state = (advanceSpotlight(state, pA) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pB) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pC) as { ok: true; state: GameState })
      .state;

    const initialSettlementCounter = state.counters.settlement;
    const finalPassResult = advanceSpotlight(state, pD);
    expect(finalPassResult.ok).toBe(true);
    if (!finalPassResult.ok) throw new Error();

    expect(finalPassResult.state.counters.settlement).toBe(
      initialSettlementCounter + 1,
    );
    expect(finalPassResult.journalEntries.length).toBeGreaterThan(0);
  });

  it("11. successful settlement enters Quarter 2 round-start", () => {
    const readyState = chooseAllObjectives(createTestGame());
    let state = (beginRound(readyState) as { ok: true; state: GameState })
      .state;

    state = (advanceSpotlight(state, pA) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pB) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pC) as { ok: true; state: GameState })
      .state;

    const finalPassResult = advanceSpotlight(state, pD);
    if (!finalPassResult.ok) throw new Error();
    const q2State = finalPassResult.state;

    expect(q2State.currentQuarter).toBe(2);
    expect(q2State.lastSettledQuarter).toBe(1);
    expect(q2State.round).toEqual({
      stage: "round-start",
      spotlightsCompleted: 0,
    });
    expect(getActiveSpotlightPlayerId(q2State)).toBeNull();
  });

  it("12. Q2 spotlight order begins B", () => {
    const readyState = chooseAllObjectives(createTestGame());
    let state = (beginRound(readyState) as { ok: true; state: GameState })
      .state;

    state = (advanceSpotlight(state, pA) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pB) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pC) as { ok: true; state: GameState })
      .state;

    const finalPassResult = advanceSpotlight(state, pD);
    if (!finalPassResult.ok) throw new Error();
    const q2RoundStartState = finalPassResult.state;

    expect(getSpotlightOrder(q2RoundStartState)).toEqual([pB, pC, pD, pA]);

    const q2Begin = beginRound(q2RoundStartState);
    expect(q2Begin.ok).toBe(true);
    if (!q2Begin.ok) throw new Error();
    expect(getActiveSpotlightPlayerId(q2Begin.state)).toBe(pB);
  });

  it("13. Q3/Q4/Q5 rotation is correct", () => {
    const readyState = chooseAllObjectives(createTestGame());
    let state = (beginRound(readyState) as { ok: true; state: GameState })
      .state;

    // Run through Q1
    for (const p of [pA, pB, pC, pD]) {
      state = (advanceSpotlight(state, p) as { ok: true; state: GameState })
        .state;
    }
    expect(state.currentQuarter).toBe(2);
    expect(getSpotlightOrder(state)[0]).toBe(pB);

    // Q2
    state = (beginRound(state) as { ok: true; state: GameState }).state;
    for (const p of [pB, pC, pD, pA]) {
      state = (advanceSpotlight(state, p) as { ok: true; state: GameState })
        .state;
    }
    expect(state.currentQuarter).toBe(3);
    expect(getSpotlightOrder(state)[0]).toBe(pC);

    // Q3
    state = (beginRound(state) as { ok: true; state: GameState }).state;
    for (const p of [pC, pD, pA, pB]) {
      state = (advanceSpotlight(state, p) as { ok: true; state: GameState })
        .state;
    }
    expect(state.currentQuarter).toBe(4);
    expect(getSpotlightOrder(state)[0]).toBe(pD);

    // Q4
    state = (beginRound(state) as { ok: true; state: GameState }).state;
    for (const p of [pD, pA, pB, pC]) {
      state = (advanceSpotlight(state, p) as { ok: true; state: GameState })
        .state;
    }
    expect(state.currentQuarter).toBe(5);
    expect(getSpotlightOrder(state)[0]).toBe(pA);
  });

  it("14. final pass increments revision exactly once", () => {
    const readyState = chooseAllObjectives(createTestGame());
    let state = (beginRound(readyState) as { ok: true; state: GameState })
      .state;

    state = (advanceSpotlight(state, pA) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pB) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pC) as { ok: true; state: GameState })
      .state;

    const revisionBeforeD = state.revision;
    const finalPassResult = advanceSpotlight(state, pD);
    expect(finalPassResult.ok).toBe(true);
    if (!finalPassResult.ok) throw new Error();

    expect(finalPassResult.state.revision).toBe(revisionBeforeD + 1);
  });

  it("15. final pass settlement failure is fully atomic and unchanged", () => {
    const readyState = chooseAllObjectives(createTestGame());
    let state = (beginRound(readyState) as { ok: true; state: GameState })
      .state;

    state = (advanceSpotlight(state, pA) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pB) as { ok: true; state: GameState })
      .state;
    state = (advanceSpotlight(state, pC) as { ok: true; state: GameState })
      .state;

    // Destination overflow remains an atomic failure under the shortfall policy
    const insolventState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [pD]: cents(Number.MAX_SAFE_INTEGER),
        },
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [pD]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(1_000_000),
          },
        },
      },
    };

    const failResult = advanceSpotlight(insolventState, pD);
    expect(failResult.ok).toBe(false);
    if (failResult.ok) throw new Error();
    expect(failResult.code).toBe("DESTINATION_OVERFLOW");
    expect(failResult.state).toBe(insolventState);
    expect(failResult.state.currentQuarter).toBe(1);
    expect(failResult.state.round?.spotlightsCompleted).toBe(3);
    expect(failResult.journalEntries).toEqual([]);
  });

  it("16. business transaction initiation rejects outside a spotlight", () => {
    const readyState = chooseAllObjectives(createTestGame());
    expect(readyState.round?.stage).toBe("round-start");

    const bizId = asAssetId("biz-open-test");
    const testBiz: BusinessAsset = {
      id: bizId,
      kind: "business",
      annualRevenueCents: cents(5_000_000),
      annualOperatingProfitCents: cents(1_000_000),
      enterpriseValueCents: cents(10_000_000),
      debtPrincipalCents: cents(0),
      ownershipByPlayerPpm: createSoleOwnership(pB),
    };

    const stateWithBiz: GameState = {
      ...readyState,
      finance: {
        ...readyState.finance,
        cashByPlayer: {
          ...readyState.finance.cashByPlayer,
          [pA]: cents(10_000_000),
        },
        assetsById: {
          ...readyState.finance.assetsById,
          [bizId]: testBiz,
        },
      },
    };

    const openTx = openCashBusinessPurchaseTransaction(stateWithBiz, {
      buyerPlayerId: pA,
      sellerPlayerId: pB,
      assetId: bizId,
      purchasePriceCents: 5_000_000,
    });
    expect(openTx.ok).toBe(false);
    if (openTx.ok) throw new Error();
    expect(openTx.code).toBe("WRONG_ROUND_STAGE");
  });

  it("17. business transaction initiation rejects a non-active buyer", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const spotlightState = (
      beginRound(readyState) as { ok: true; state: GameState }
    ).state;
    expect(getActiveSpotlightPlayerId(spotlightState)).toBe(pA);

    const bizId = asAssetId("biz-open-test");
    const testBiz: BusinessAsset = {
      id: bizId,
      kind: "business",
      annualRevenueCents: cents(5_000_000),
      annualOperatingProfitCents: cents(1_000_000),
      enterpriseValueCents: cents(10_000_000),
      debtPrincipalCents: cents(0),
      ownershipByPlayerPpm: createSoleOwnership(pA),
    };

    const stateWithBiz: GameState = {
      ...spotlightState,
      finance: {
        ...spotlightState.finance,
        cashByPlayer: {
          ...spotlightState.finance.cashByPlayer,
          [pB]: cents(10_000_000),
        },
        assetsById: {
          ...spotlightState.finance.assetsById,
          [bizId]: testBiz,
        },
      },
    };

    // pB tries to buy while pA is active spotlight
    const openTx = openCashBusinessPurchaseTransaction(stateWithBiz, {
      buyerPlayerId: pB,
      sellerPlayerId: pA,
      assetId: bizId,
      purchasePriceCents: 5_000_000,
    });
    expect(openTx.ok).toBe(false);
    if (openTx.ok) throw new Error();
    expect(openTx.code).toBe("NOT_ACTIVE_SPOTLIGHT");
  });

  it("18. active spotlight buyer can open the transaction", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const spotlightState = (
      beginRound(readyState) as { ok: true; state: GameState }
    ).state;

    const bizId = asAssetId("biz-open-test");
    const testBiz: BusinessAsset = {
      id: bizId,
      kind: "business",
      annualRevenueCents: cents(5_000_000),
      annualOperatingProfitCents: cents(1_000_000),
      enterpriseValueCents: cents(10_000_000),
      debtPrincipalCents: cents(0),
      ownershipByPlayerPpm: createSoleOwnership(pB),
    };

    const stateWithBiz: GameState = {
      ...spotlightState,
      finance: {
        ...spotlightState.finance,
        cashByPlayer: {
          ...spotlightState.finance.cashByPlayer,
          [pA]: cents(10_000_000),
        },
        assetsById: {
          ...spotlightState.finance.assetsById,
          [bizId]: testBiz,
        },
      },
    };

    const openTx = openCashBusinessPurchaseTransaction(stateWithBiz, {
      buyerPlayerId: pA,
      sellerPlayerId: pB,
      assetId: bizId,
      purchasePriceCents: 5_000_000,
    });
    expect(openTx.ok).toBe(true);
    if (!openTx.ok) throw new Error();
    expect(openTx.state.activeTransaction).not.toBeNull();
  });

  it("19. existing one-active-transaction invariant remains intact", () => {
    const readyState = chooseAllObjectives(createTestGame());
    const spotlightState = (
      beginRound(readyState) as { ok: true; state: GameState }
    ).state;

    const bizId = asAssetId("biz-open-test");
    const testBiz: BusinessAsset = {
      id: bizId,
      kind: "business",
      annualRevenueCents: cents(5_000_000),
      annualOperatingProfitCents: cents(1_000_000),
      enterpriseValueCents: cents(10_000_000),
      debtPrincipalCents: cents(0),
      ownershipByPlayerPpm: createSoleOwnership(pB),
    };

    const stateWithBiz: GameState = {
      ...spotlightState,
      finance: {
        ...spotlightState.finance,
        cashByPlayer: {
          ...spotlightState.finance.cashByPlayer,
          [pA]: cents(10_000_000),
        },
        assetsById: {
          ...spotlightState.finance.assetsById,
          [bizId]: testBiz,
        },
      },
    };

    const open1 = openCashBusinessPurchaseTransaction(stateWithBiz, {
      buyerPlayerId: pA,
      sellerPlayerId: pB,
      assetId: bizId,
      purchasePriceCents: 2_000_000,
    });
    expect(open1.ok).toBe(true);
    if (!open1.ok) throw new Error();

    const open2 = openCashBusinessPurchaseTransaction(open1.state, {
      buyerPlayerId: pA,
      sellerPlayerId: pB,
      assetId: bizId,
      purchasePriceCents: 2_000_000,
    });
    expect(open2.ok).toBe(false);
    if (open2.ok) throw new Error();
    expect(open2.code).toBe("ACTIVE_TRANSACTION_EXISTS");
  });

  it("20. assertGameState rejects malformed round state", () => {
    const choosingState = createTestGame();
    // 1. objective-choosing requires round === null
    expect(() =>
      assertGameState({
        ...choosingState,
        round: { stage: "round-start", spotlightsCompleted: 0 },
      }),
    ).toThrow(/objective-choosing requires round to be null/);

    const readyState = chooseAllObjectives(createTestGame());
    // 2. ready-for-first-round requires non-null round
    expect(() =>
      assertGameState({
        ...readyState,
        round: null,
      }),
    ).toThrow(/ready-for-first-round requires non-null round state/);

    // 3. invalid stage
    expect(() =>
      assertGameState({
        ...readyState,
        round: { stage: "invalid-stage" as any, spotlightsCompleted: 0 },
      }),
    ).toThrow(/unrecognized round stage/);

    // 4. negative spotlightsCompleted
    expect(() =>
      assertGameState({
        ...readyState,
        round: { stage: "spotlight", spotlightsCompleted: -1 },
      }),
    ).toThrow(/spotlightsCompleted must be a non-negative safe integer/);

    // 5. round-start with completed > 0
    expect(() =>
      assertGameState({
        ...readyState,
        round: { stage: "round-start", spotlightsCompleted: 1 },
      }),
    ).toThrow(/round-start requires spotlightsCompleted to be 0/);

    // 6. spotlight with completed >= playerOrder.length
    expect(() =>
      assertGameState({
        ...readyState,
        round: { stage: "spotlight", spotlightsCompleted: 4 },
      }),
    ).toThrow(/spotlight stage requires spotlightsCompleted < 4/);
  });

  it("dispatches wire commands through applyPlayerCommand", () => {
    const readyState = chooseAllObjectives(createTestGame());

    // BEGIN_ROUND
    const beginRes = applyPlayerCommand(readyState, pA, {
      type: "BEGIN_ROUND",
    });
    expect(beginRes.ok).toBe(true);
    if (!beginRes.ok) throw new Error();
    expect(beginRes.state.round?.stage).toBe("spotlight");

    // PASS_SPOTLIGHT
    const passRes = applyPlayerCommand(beginRes.state, pA, {
      type: "PASS_SPOTLIGHT",
    });
    expect(passRes.ok).toBe(true);
    if (!passRes.ok) throw new Error();
    expect(passRes.state.round?.spotlightsCompleted).toBe(1);

    // Non-active player pass
    const rejPass = applyPlayerCommand(passRes.state, pA, {
      type: "PASS_SPOTLIGHT",
    });
    expect(rejPass.ok).toBe(false);
    if (rejPass.ok) throw new Error();
    expect(rejPass.code).toBe("NOT_ACTIVE_SPOTLIGHT");
  });
});

describe("Orchestration Composition: Terminal Transactions & Spotlight Completion", () => {
  function setupSpotlightWithBusiness(spotlightIndex: number): {
    state: GameState;
    buyerPlayerId: typeof pA;
    sellerPlayerId: typeof pB;
    bizId: ReturnType<typeof asAssetId>;
    txId: ReturnType<typeof asTransactionId>;
  } {
    const readyState = chooseAllObjectives(createTestGame());
    let state = (beginRound(readyState) as { ok: true; state: GameState })
      .state;

    // Advance to the desired spotlight index
    for (let i = 0; i < spotlightIndex; i++) {
      const activePlayer = getActiveSpotlightPlayerId(state)!;
      const pass = advanceSpotlight(state, activePlayer);
      expect(pass.ok).toBe(true);
      if (!pass.ok) throw new Error();
      state = pass.state;
    }

    const buyerPlayerId = getActiveSpotlightPlayerId(state)!;
    const sellerPlayerId = state.playerOrder.find(
      (id) => id !== buyerPlayerId,
    )!;
    const bizId = asAssetId(`biz-${spotlightIndex}`);

    const testBiz: BusinessAsset = {
      id: bizId,
      kind: "business",
      annualRevenueCents: cents(5_000_000),
      annualOperatingProfitCents: cents(1_000_000),
      enterpriseValueCents: cents(10_000_000),
      debtPrincipalCents: cents(0),
      ownershipByPlayerPpm: createSoleOwnership(sellerPlayerId),
    };

    const stateWithBiz: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyerPlayerId]: cents(10_000_000),
        },
        assetsById: {
          ...state.finance.assetsById,
          [bizId]: testBiz,
        },
      },
    };

    const openTx = openCashBusinessPurchaseTransaction(stateWithBiz, {
      buyerPlayerId,
      sellerPlayerId,
      assetId: bizId,
      purchasePriceCents: 5_000_000,
    });
    expect(openTx.ok).toBe(true);
    if (!openTx.ok) throw new Error();

    return {
      state: openTx.state,
      buyerPlayerId: buyerPlayerId as typeof pA,
      sellerPlayerId: sellerPlayerId as typeof pB,
      bizId,
      txId: openTx.transactionId!,
    };
  }

  it("1. intermediate transaction close advances spotlight with exactly revision + 1 total", () => {
    // Spotlight 0: pA
    const { state, buyerPlayerId, sellerPlayerId, bizId, txId } =
      setupSpotlightWithBusiness(0);

    const inputRevision = state.revision;
    const pACashBefore = state.finance.cashByPlayer[buyerPlayerId]!;
    const pBCashBefore = state.finance.cashByPlayer[sellerPlayerId]!;

    const result = closeCashBusinessPurchaseAndAdvanceSpotlight(
      state,
      buyerPlayerId,
      txId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();

    // 1. Revision incremented by EXACTLY 1 total
    expect(result.state.revision).toBe(inputRevision + 1);

    // 2. Active transaction cleared
    expect(result.state.activeTransaction).toBeNull();

    // 3. Spotlight advanced to spotlight 1 (pB)
    expect(result.state.round?.stage).toBe("spotlight");
    expect(result.state.round?.spotlightsCompleted).toBe(1);
    expect(getActiveSpotlightPlayerId(result.state)).toBe(pB);

    // 4. Transaction effects applied
    expect(result.state.finance.cashByPlayer[buyerPlayerId]).toBe(
      pACashBefore - 5_000_000,
    );
    expect(result.state.finance.cashByPlayer[sellerPlayerId]).toBe(
      pBCashBefore + 5_000_000,
    );
    const updatedBiz = result.state.finance.assetsById[bizId] as BusinessAsset;
    expect(updatedBiz.ownershipByPlayerPpm[buyerPlayerId]).toBe(1_000_000);

    // 5. Transaction journal entries emitted
    expect(result.journalEntries).toHaveLength(1);
    expect(result.journalEntries[0]?.reason).toBe("business-purchase");

    // 6. Quarter remains 1; no settlement ran
    expect(result.state.currentQuarter).toBe(1);
    expect(result.state.lastSettledQuarter).toBe(0);
  });

  it("2. intermediate transaction cancel advances spotlight with exactly revision + 1 total and releases reservations", () => {
    // Spotlight 1: pB
    const { state, buyerPlayerId, sellerPlayerId, bizId, txId } =
      setupSpotlightWithBusiness(1);

    const inputRevision = state.revision;
    const buyerCashBefore = state.finance.cashByPlayer[buyerPlayerId]!;

    const result = cancelActiveTransactionAndAdvanceSpotlight(
      state,
      buyerPlayerId,
      txId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();

    // 1. Revision incremented by EXACTLY 1 total
    expect(result.state.revision).toBe(inputRevision + 1);

    // 2. Active transaction cleared
    expect(result.state.activeTransaction).toBeNull();

    // 3. Spotlight advanced to spotlight 2 (pC)
    expect(result.state.round?.stage).toBe("spotlight");
    expect(result.state.round?.spotlightsCompleted).toBe(2);
    expect(getActiveSpotlightPlayerId(result.state)).toBe(pC);

    // 4. Cash and ownership unchanged
    expect(result.state.finance.cashByPlayer[buyerPlayerId]).toBe(
      buyerCashBefore,
    );
    const biz = result.state.finance.assetsById[bizId] as BusinessAsset;
    expect(biz.ownershipByPlayerPpm[sellerPlayerId]).toBe(1_000_000);

    // 5. Zero journal entries for cancellation
    expect(result.journalEntries).toHaveLength(0);

    // 6. No settlement
    expect(result.state.currentQuarter).toBe(1);
  });

  it("3. final spotlight transaction close atomically closes transaction, runs settlement, and enters Q2 round-start with exactly revision + 1 total", () => {
    // Spotlight 3: 4th and final spotlight of Quarter 1 (pD)
    const { state, buyerPlayerId, sellerPlayerId, bizId, txId } =
      setupSpotlightWithBusiness(3);

    expect(state.round?.spotlightsCompleted).toBe(3);
    const inputRevision = state.revision;

    const result = closeCashBusinessPurchaseAndAdvanceSpotlight(
      state,
      buyerPlayerId,
      txId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();

    // 1. Revision incremented by EXACTLY 1 total from input state
    expect(result.state.revision).toBe(inputRevision + 1);

    // 2. Active transaction cleared
    expect(result.state.activeTransaction).toBeNull();

    // 3. Business ownership transferred
    const updatedBiz = result.state.finance.assetsById[bizId] as BusinessAsset;
    expect(updatedBiz.ownershipByPlayerPpm[buyerPlayerId]).toBe(1_000_000);

    // 4. Settlement completed: quarter advanced to 2, last settled to 1
    expect(result.state.currentQuarter).toBe(2);
    expect(result.state.lastSettledQuarter).toBe(1);

    // 5. Round reset to round-start for Quarter 2
    expect(result.state.round).toEqual({
      stage: "round-start",
      spotlightsCompleted: 0,
    });

    // 6. Q2 spotlight order rotates deterministically
    expect(getSpotlightOrder(result.state)).toEqual([pB, pC, pD, pA]);

    // 7. Journal entries: transaction entries first, then settlement entries
    expect(result.journalEntries.length).toBeGreaterThan(1);
    expect(result.journalEntries[0]?.reason).toBe("business-purchase");
    expect(result.journalEntries[0]?.relatedAssetId).toBe(bizId);

    // Remaining journal entries are from quarterly settlement
    const settlementReasons = result.journalEntries
      .slice(1)
      .map((e) => e.reason);
    expect(settlementReasons).toContain("recurring-personal-income");
    expect(settlementReasons).toContain("recurring-living-expense");
  });

  it("4. deterministic combined journal ordering: transaction entries precede settlement entries", () => {
    const { state, buyerPlayerId, bizId, txId } = setupSpotlightWithBusiness(3);

    const result = closeCashBusinessPurchaseAndAdvanceSpotlight(
      state,
      buyerPlayerId,
      txId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();

    // First entry is strictly the business purchase closing transaction
    expect(result.journalEntries[0]).toMatchObject({
      reason: "business-purchase",
      relatedAssetId: bizId,
      relatedTransactionId: txId,
      quarter: 1,
    });

    // Subsequent entries are settlement postings for quarter 1
    for (let i = 1; i < result.journalEntries.length; i++) {
      expect(result.journalEntries[i]?.quarter).toBe(1);
      expect(result.journalEntries[i]?.relatedTransactionId).toBeUndefined();
    }
  });

  it("5. terminal transaction failure leaves state completely unchanged", () => {
    const { state, buyerPlayerId } = setupSpotlightWithBusiness(0);
    const nonExistentTxId = asTransactionId("tx-does-not-exist");

    const result = closeCashBusinessPurchaseAndAdvanceSpotlight(
      state,
      buyerPlayerId,
      nonExistentTxId,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.code).toBe("TRANSACTION_ID_MISMATCH");

    // State returned is the identical original state
    expect(result.state).toBe(state);
    expect(result.state.revision).toBe(state.revision);
    expect(result.state.activeTransaction).not.toBeNull();
    expect(result.state.round?.spotlightsCompleted).toBe(0);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("6. non-active player cannot close or cancel transaction", () => {
    // Spotlight 0: pA is active, pB is not
    const { state, txId } = setupSpotlightWithBusiness(0);

    const result = closeCashBusinessPurchaseAndAdvanceSpotlight(
      state,
      pB,
      txId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.code).toBe("NOT_ACTIVE_SPOTLIGHT");
    expect(result.state).toBe(state);
  });

  it("7. final settlement failure rolls back the entire composed transition atomically", () => {
    // Spotlight 3: pD is active.
    const { state, buyerPlayerId, sellerPlayerId, bizId, txId } =
      setupSpotlightWithBusiness(3);

    // Closing consumes the last available journal ID; settlement must roll back the whole command.
    const insolventState: GameState = {
      ...state,
      counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER - 1 },
    };

    const initialRevision = insolventState.revision;
    const buyerCashBefore = insolventState.finance.cashByPlayer[buyerPlayerId]!;
    const sellerCashBefore =
      insolventState.finance.cashByPlayer[sellerPlayerId]!;

    const result = closeCashBusinessPurchaseAndAdvanceSpotlight(
      insolventState,
      buyerPlayerId,
      txId,
    );

    // Composed operation MUST reject atomically
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.code).toBe("JOURNAL_ID_EXHAUSTED");

    // The returned state is the ORIGINAL state before the transaction
    expect(result.state).toBe(insolventState);
    expect(result.state.revision).toBe(initialRevision);
    expect(result.state.activeTransaction?.id).toBe(txId);
    expect(result.state.round?.spotlightsCompleted).toBe(3);
    expect(result.state.currentQuarter).toBe(1);

    // Business ownership was NOT transferred
    const biz = result.state.finance.assetsById[bizId] as BusinessAsset;
    expect(biz.ownershipByPlayerPpm[sellerPlayerId]).toBe(1_000_000);
    expect(biz.ownershipByPlayerPpm[buyerPlayerId]).toBeUndefined();

    // Cash was NOT moved
    expect(result.state.finance.cashByPlayer[buyerPlayerId]).toBe(
      buyerCashBefore,
    );
    expect(result.state.finance.cashByPlayer[sellerPlayerId]).toBe(
      sellerCashBefore,
    );

    // Zero journal entries emitted
    expect(result.journalEntries).toHaveLength(0);
  });

  it("final close advances once while recording another player's living shortfall", () => {
    const { state, buyerPlayerId, bizId, txId } = setupSpotlightWithBusiness(3);
    const short: GameState = {
      ...state,
      finance: {
        ...state.finance,
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [pC]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(500_000_000),
          },
        },
      },
    };
    const result = closeCashBusinessPurchaseAndAdvanceSpotlight(
      short,
      buyerPlayerId,
      txId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.currentQuarter).toBe(2);
    expect(result.state.activeTransaction).toBeNull();
    expect(result.state.finance.livingArrearsByPlayer[pC]).toBeGreaterThan(0);
    expect(
      result.state.finance.assetsById[bizId]?.ownershipByPlayerPpm[
        buyerPlayerId
      ],
    ).toBe(1_000_000);
    expect(result.settlementOutcome).toEqual(
      result.state.finance.lastSettlement,
    );
  });

  it("8. un-revisioned primitives and trusted settleQuarter preserve exact revision behavior", () => {
    const { state, txId } = setupSpotlightWithBusiness(0);

    // applyCancelActiveTransaction keeps revision unchanged
    const unrevCancel = applyCancelActiveTransaction(state, txId);
    expect(unrevCancel.ok).toBe(true);
    if (!unrevCancel.ok) throw new Error();
    expect(unrevCancel.state.revision).toBe(state.revision);

    // cancelActiveTransaction bumps revision by exactly 1
    const revCancel = cancelActiveTransaction(state, txId);
    expect(revCancel.ok).toBe(true);
    if (!revCancel.ok) throw new Error();
    expect(revCancel.state.revision).toBe(state.revision + 1);

    // applyCloseCashBusinessPurchaseTransaction keeps revision unchanged
    const unrevClose = applyCloseCashBusinessPurchaseTransaction(state, txId);
    expect(unrevClose.ok).toBe(true);
    if (!unrevClose.ok) throw new Error();
    expect(unrevClose.state.revision).toBe(state.revision);

    // closeCashBusinessPurchaseTransaction bumps revision by exactly 1
    const revClose = closeCashBusinessPurchaseTransaction(state, txId);
    expect(revClose.ok).toBe(true);
    if (!revClose.ok) throw new Error();
    expect(revClose.state.revision).toBe(state.revision + 1);

    // applyQuarterSettlement keeps revision unchanged
    const unrevSettle = applyQuarterSettlement(revCancel.state, { quarter: 1 });
    expect(unrevSettle.ok).toBe(true);
    if (!unrevSettle.ok) throw new Error();
    expect(unrevSettle.state.revision).toBe(revCancel.state.revision);

    // trusted settleQuarter bumps revision by 1
    const revSettle = settleQuarter(revCancel.state, { quarter: 1 });
    expect(revSettle.ok).toBe(true);
    if (!revSettle.ok) throw new Error();
    expect(revSettle.state.revision).toBe(revCancel.state.revision + 1);
  });
});
