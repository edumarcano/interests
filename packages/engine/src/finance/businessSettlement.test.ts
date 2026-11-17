import { asAssetId, asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { beginRound, getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import {
  closeCashBusinessPurchaseTransaction,
  openCashBusinessPurchaseTransaction,
} from "../transactions/cashBusinessPurchase";
import {
  businessCashAccount,
  externalCashAccount,
  playerCashAccount,
} from "./account";
import { calculateBusinessEquity } from "./business";
import { captureBusinessBasis } from "./businessSettlement";
import { createZeroPublicMarketPortfolio } from "./markets";
import { cents } from "./money";
import { ownershipPpm } from "./ownership";
import { postCash } from "./posting";
import { type SettleQuarterResult, settleQuarter } from "./settlement";

const ids = ["player-1", "player-2", "player-3", "player-4"].map(
  asPlayerId,
) as [PlayerId, PlayerId, PlayerId, PlayerId];
const [a, b, c, d] = ids;
const assetId = asAssetId("company");
function selectObjectives(state: GameState): GameState {
  for (const playerId of ids) {
    const player = state.players[playerId];
    if (!player) throw new Error("Missing player");
    const result = applyPlayerCommand(state, playerId, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: player.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  return state;
}
function settle(state: GameState): Extract<SettleQuarterResult, { ok: true }> {
  const result = settleQuarter(state, { quarter: state.currentQuarter });
  if (!result.ok) throw new Error(result.code);
  return result;
}
function companyFixture(
  profit = 1_500_000,
  cash = 0,
  arrears = 0,
  owners: BusinessAsset["ownershipByPlayerPpm"] = {
    [a]: ownershipPpm(1_000_000),
  },
): GameState {
  const base = selectObjectives(
    createGame({
      gameId: "company-fixture",
      seed: "company-fixture",
      playerIds: ids,
    }),
  );
  const company: BusinessAsset = {
    id: assetId,
    kind: "business",
    cashPolicyId: "retained-profit-v1",
    cashCents: cents(cash),
    operatingArrearsCents: cents(arrears),
    annualRevenueCents: cents(8_000_000),
    annualOperatingProfitCents: cents(profit),
    enterpriseValueCents: cents(0),
    debtPrincipalCents: cents(0),
    ownershipByPlayerPpm: owners,
  };
  const balances = Object.fromEntries(ids.map((id) => [id, cents(0)]));
  const portfolios = Object.fromEntries(
    ids.map((id) => [id, createZeroPublicMarketPortfolio()]),
  );
  const assetsById = { [assetId]: company };
  const state: GameState = {
    ...base,
    opportunitiesById: {},
    finance: {
      ...base.finance,
      cashByPlayer: balances,
      assetsById,
      loansById: {},
      publicMarketsByPlayer: portfolios,
      recurringByPlayer: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
        ]),
      ),
      quarterStartBasis: {
        quarter: 1,
        cashByPlayer: balances,
        publicMarketsByPlayer: portfolios,
        businessesById: captureBusinessBasis(assetsById),
      },
    },
  };
  return settle(state).state;
}
function financedJourney(term: number) {
  let state = selectObjectives(
    createGame({
      gameId: "financed-m7",
      seed: "m7-planning-1",
      playerIds: ids,
    }),
  );
  const opportunity = Object.values(state.opportunitiesById)[0];
  if (!opportunity) throw new Error("Missing fixture");
  const buyer = opportunity.targetPlayerId;
  const lender = ids.find(
    (id) =>
      id !== buyer &&
      id !== opportunity.sellerPlayerId &&
      (state.finance.cashByPlayer[id] ?? 0) >= 2_000_000,
  );
  if (!lender) throw new Error("Missing lender");
  const settlements: Extract<SettleQuarterResult, { ok: true }>[] = [];
  const run = (actor: PlayerId, command: WirePlayerCommand) => {
    const before = state;
    const result = applyPlayerCommand(state, actor, command);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.revision).toBe(before.revision + 1);
    state = result.state;
    if (result.settlementOutcome)
      settlements.push({
        ok: true,
        state,
        settlementId: result.settlementOutcome.settlementId,
        settlementOutcome: result.settlementOutcome,
        journalEntries: result.journalEntries,
      });
  };
  run(a, { type: "BEGIN_ROUND" });
  while (getActiveSpotlightPlayerId(state) !== buyer) {
    const active = getActiveSpotlightPlayerId(state);
    if (!active) throw new Error("Missing active seat");
    run(active, { type: "PASS_SPOTLIGHT" });
  }
  run(buyer, {
    type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
    opportunityId: opportunity.id,
    buyerCashContributionCents: 3_000_000,
    requestedPrincipalCents: 2_000_000,
  });
  const transaction = state.activeTransaction;
  if (!transaction) throw new Error("Missing transaction");
  run(lender, {
    type: "SUBMIT_PLAYER_LOAN_OFFER",
    transactionId: transaction.id,
    annualRateBps: 1_000,
    termQuarters: term,
  });
  run(buyer, {
    type: "ACCEPT_PLAYER_LOAN_OFFER",
    transactionId: transaction.id,
    expectedTermsRevision: 1,
  });
  run(buyer, {
    type: "CLOSE_BUSINESS_PURCHASE",
    transactionId: transaction.id,
  });
  while (state.currentQuarter <= 4) {
    if (state.round?.stage === "round-start") run(a, { type: "BEGIN_ROUND" });
    const active = getActiveSpotlightPlayerId(state);
    if (!active) throw new Error("Missing active seat");
    run(active, { type: "PASS_SPOTLIGHT" });
  }
  return { state, settlements, opportunity, buyer, lender };
}

describe("retained-profit-v1", () => {
  it("plays the original financed purchase through Q5 with exact payouts, reserves and on-time repayment", () => {
    const journey = financedJourney(3);
    const { state, settlements, opportunity, buyer } = journey;
    expect(
      settlements.map((r) =>
        r.settlementOutcome.businesses
          .filter((x) => x.assetId === opportunity.assetId)
          .map((x) => [x.operatingCashCents, x.closingCashCents]),
      ),
    ).toEqual([
      [],
      [[375_000, 75_000]],
      [[375_000, 150_000]],
      [[375_000, 225_000]],
    ]);
    expect(settlements.map((r) => r.state.finance.cashByPlayer[buyer])).toEqual(
      [721_950, 1_026_541, 1_333_416, 1_642_592],
    );
    expect(state.currentQuarter).toBe(5);
    const company = state.finance.assetsById[opportunity.assetId];
    if (company?.kind !== "business") throw new Error("Missing company");
    expect(company.cashCents).toBe(225_000);
    expect(calculateBusinessEquity(company).equityValueCents).toBe(6_225_000);
    const loan = Object.values(state.finance.loansById).find(
      (l) => l.kind === "player-loan",
    );
    expect(loan).toMatchObject({
      outstandingPrincipalCents: 0,
      principalRepaidCents: 2_000_000,
      unpaidInterestCents: 0,
    });
    expect(
      projectPlayerGameState(state, buyer).self.lastSettlement
        ?.businessDistributions,
    ).toContainEqual({ assetId: company.id, amountCents: 300_000 });
    for (const asset of Object.values(state.finance.assetsById))
      if (
        asset.kind === "business" &&
        asset.cashPolicyId === "starting-company-v1"
      )
        expect(asset.workCompensation?.arrearsCents).toBe(0);
    expect(financedJourney(3)).toEqual(journey);
  });

  it("repays the shorter loan without default after starting-company income normalization", () => {
    const { state, settlements } = financedJourney(2);
    const missed = settlements[2]?.settlementOutcome.loanPayments.filter(
      (p) => p.paidCents < p.dueCents,
    );
    expect(missed).toEqual([]);
    expect(settlements[2]?.state.currentQuarter).toBe(4);
    expect(state.currentQuarter).toBe(5);
    const loan = Object.values(state.finance.loansById).find(
      (l) => l.kind === "player-loan",
    );
    expect(loan).toMatchObject({
      outstandingPrincipalCents: 0,
      unpaidInterestCents: 0,
      pastDuePrincipalCents: 0,
      principalRepaidCents: 2_000_000,
    });
  });

  it("absorbs operating losses with reserves, records payables, and pays those before later distributions", () => {
    const initial = companyFixture(-400_000, 25_000);
    const loss = settle(initial);
    expect(loss.settlementOutcome.businesses[0]).toMatchObject({
      operatingCashCents: -100_000,
      operatingPaidCents: 25_000,
      closingOperatingArrearsCents: 75_000,
      closingCashCents: 0,
      distributionsByPlayer: { [a]: 0 },
    });
    expect(loss.state.finance.cashByPlayer[a]).toBe(0);
    const asset = loss.state.finance.assetsById[assetId];
    if (asset?.kind !== "business") throw new Error("Missing company");
    expect(calculateBusinessEquity(asset).equityValueCents).toBe(-75_000);
    const assetsById = {
      [assetId]: { ...asset, annualOperatingProfitCents: cents(800_000) },
    };
    // Explicit next-quarter operating fixture; no gameplay performance event is invented here.
    const improved: GameState = {
      ...loss.state,
      finance: {
        ...loss.state.finance,
        assetsById,
        quarterStartBasis: {
          ...loss.state.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(assetsById),
        },
      },
    };
    const recovered = settle(improved);
    expect(recovered.settlementOutcome.businesses[0]).toMatchObject({
      operatingCashCents: 200_000,
      operatingDueCents: 75_000,
      operatingPaidCents: 75_000,
      closingOperatingArrearsCents: 0,
      closingCashCents: 25_000,
      distributionsByPlayer: { [a]: 100_000 },
    });
    expect(
      recovered.journalEntries.find(
        (e) => e.reason === "business-operating-cost-payment",
      )?.amountCents,
    ).toBe(75_000);
  });

  it("retains old reserves in a zero-profit quarter without creating income or automatic growth", () => {
    const state = companyFixture(0, 70_000);
    const result = settle(state);
    expect(result.journalEntries).toEqual([]);
    expect(result.settlementOutcome.businesses[0]).toMatchObject({
      closingCashCents: 70_000,
      retainedFromSurplusCents: 0,
      distributionsByPlayer: { [a]: 0 },
    });
    expect(result.state.finance.assetsById[assetId]).toEqual(
      state.finance.assetsById[assetId],
    );
  });

  it.each([
    {
      annualProfit: 4,
      operatingCash: 1,
      retained: 0,
      firstShare: 1,
      secondShare: 0,
    },
    {
      annualProfit: 20,
      operatingCash: 5,
      retained: 1,
      firstShare: 2,
      secondShare: 2,
    },
  ])(
    "allocates small co-owner payouts without losing cents or using owner insertion order: $operatingCash cent(s)",
    ({ annualProfit, operatingCash, retained, firstShare, secondShare }) => {
      const first = companyFixture(annualProfit, 0, 0, {
        [a]: ownershipPpm(600_000),
        [b]: ownershipPpm(400_000),
      });
      const second = companyFixture(annualProfit, 0, 0, {
        [b]: ownershipPpm(400_000),
        [a]: ownershipPpm(600_000),
      });
      expect(settle(first)).toEqual(settle(second));
      expect(settle(first).settlementOutcome.businesses[0]).toMatchObject({
        operatingCashCents: operatingCash,
        closingCashCents: retained,
        distributionsByPlayer: { [a]: firstShare, [b]: secondShare },
      });
    },
  );

  it("preserves cash on resale and pays the opening seller before the buyer becomes entitled", () => {
    let state = settle(companyFixture()).state; // Q3, with $750 company cash.
    const ready = beginRound(state);
    if (!ready.ok) throw new Error(ready.code);
    state = ready.state;
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: { ...state.finance.cashByPlayer, [c]: cents(1_000_000) },
      },
    };
    const opening = state.finance.quarterStartBasis.businessesById[assetId];
    expect(opening?.ownershipByPlayerPpm).not.toBe(
      state.finance.assetsById[assetId]?.ownershipByPlayerPpm,
    );
    const opened = openCashBusinessPurchaseTransaction(state, {
      buyerPlayerId: c,
      sellerPlayerId: a,
      assetId,
      purchasePriceCents: 500_000,
    });
    if (!opened.ok) throw new Error(opened.code);
    const tx = opened.state.activeTransaction;
    if (!tx) throw new Error("Missing transaction");
    const closed = closeCashBusinessPurchaseTransaction(opened.state, tx.id);
    if (!closed.ok) throw new Error(closed.code);
    expect(closed.state.finance.assetsById[assetId]).toMatchObject({
      cashCents: 75_000,
      ownershipByPlayerPpm: { [c]: 1_000_000 },
    });
    const q3 = settle(closed.state);
    expect(q3.settlementOutcome.businesses[0]?.distributionsByPlayer).toEqual({
      [a]: 300_000,
    });
    const former = projectPlayerGameState(q3.state, a);
    expect(former.self.ownedAssets).toEqual([]);
    expect(former.self.lastSettlement?.businessDistributions).toEqual([
      { assetId, amountCents: 300_000 },
    ]);
    expect(
      settle(q3.state).settlementOutcome.businesses[0]?.distributionsByPlayer,
    ).toEqual({ [c]: 300_000 });
  });

  it("rejects a simple purchase of a company with operating payables", () => {
    let state = companyFixture(0, 0, 100);
    const started = beginRound(state);
    if (!started.ok) throw new Error(started.code);
    state = started.state;
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: { ...state.finance.cashByPlayer, [b]: cents(1_000) },
      },
    };
    assertGameState(state);
    const result = openCashBusinessPurchaseTransaction(state, {
      buyerPlayerId: b,
      sellerPlayerId: a,
      assetId,
      purchasePriceCents: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "ENCUMBERED_ASSET",
      journalEntries: [],
    });
    expect(result.state).toBe(state);
  });

  it("keeps unrelated paired-state views identical and forecasts without drawing RNG or IDs", () => {
    const first = settle(companyFixture(1_500_000, 0)).state;
    const second = settle(companyFixture(1_500_000, 1_000)).state;
    assertGameState(first);
    assertGameState(second);
    expect(projectPlayerGameState(first, b)).toEqual(
      projectPlayerGameState(second, b),
    );
    const before = JSON.stringify(first);
    const view = projectPlayerGameState(first, a);
    expect(view.self.ownedAssets[0]).toMatchObject({
      companyCashCents: 75_000,
      expectedPayoutCents: 300_000,
      payoutQuarter: 3,
    });
    expect(JSON.stringify(first)).toBe(before);
  });

  it("rejects company destination overflow atomically and exposes an unavailable estimate safely", () => {
    const state = companyFixture(12, Number.MAX_SAFE_INTEGER - 1);
    expect(
      projectPlayerGameState(state, a).self.ownedAssets[0]?.expectedPayoutCents,
    ).toBeNull();
    const before = JSON.stringify(state);
    const result = settleQuarter(state, { quarter: 2 });
    expect(result).toMatchObject({
      ok: false,
      code: "DESTINATION_OVERFLOW",
      journalEntries: [],
    });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("posts company accounts atomically and rejects invalid endpoints, overdrafts and self-transfers", () => {
    const state = companyFixture(0, 10);
    const request = {
      source: businessCashAccount(assetId),
      destination: playerCashAccount(a),
      amountCents: 6,
      reason: "test",
      quarter: 2,
    };
    const result = postCash(state.finance, state.counters, request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.finance.assetsById[assetId]).toMatchObject({ cashCents: 4 });
    expect(result.finance.cashByPlayer[a]).toBe(6);
    expect(state.finance.assetsById[assetId]).toMatchObject({ cashCents: 10 });
    expect(
      postCash(state.finance, state.counters, { ...request, amountCents: 11 }),
    ).toMatchObject({ ok: false, code: "INSUFFICIENT_FUNDS" });
    expect(
      postCash(state.finance, state.counters, {
        ...request,
        destination: businessCashAccount(assetId),
      }),
    ).toMatchObject({ ok: false, code: "SAME_ACCOUNT" });
    expect(
      postCash(state.finance, state.counters, {
        ...request,
        destination: businessCashAccount(asAssetId("unknown")),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_ENDPOINT" });
    expect(
      postCash(state.finance, state.counters, {
        ...request,
        source: externalCashAccount("business-operating-cashflow"),
        destination: businessCashAccount(asAssetId("unknown")),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_ENDPOINT" });
  });

  it("rejects closing company equity overflow before applying any settlement effects", () => {
    const base = companyFixture(12, Number.MAX_SAFE_INTEGER - 10);
    const asset = base.finance.assetsById[assetId];
    if (asset?.kind !== "business") throw new Error("Missing company");
    const state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: {
          ...base.finance.assetsById,
          [assetId]: { ...asset, enterpriseValueCents: cents(10) },
        },
      },
    };
    assertGameState(state);
    const before = JSON.stringify(state);
    const result = settleQuarter(state, { quarter: 2 });
    expect(result).toMatchObject({
      ok: false,
      code: "DESTINATION_OVERFLOW",
      journalEntries: [],
    });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("rejects snapshots missing a company's quarter-start entitlement", () => {
    const base = companyFixture();
    const state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        quarterStartBasis: {
          ...base.finance.quarterStartBasis,
          businessesById: {},
        },
      },
    };
    expect(() => assertGameState(state)).toThrow(/business entitlement/);
  });
});
