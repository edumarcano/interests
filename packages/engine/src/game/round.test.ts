import { asAssetId, asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";

import { cents } from "../finance/money";
import { createSoleOwnership } from "../finance/ownership";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import { openCashBusinessPurchaseTransaction } from "../transactions/cashBusinessPurchase";
import { applyAction } from "./actions";
import { createGame } from "./createGame";
import { applyPlayerCommand } from "./playerCommand";
import {
  advanceSpotlight,
  beginRound,
  getActiveSpotlightPlayerId,
  getSpotlightOrder,
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

    // Set pD cash to zero so settlement fails due to living expenses
    const insolventState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [pD]: cents(0),
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
    expect(failResult.code).toBe("INSUFFICIENT_FUNDS");
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
