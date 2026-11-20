import { asPlayerId, asTransactionId, type PlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import { calculateBusinessEquity } from "../finance/business";
import {
  closeMatchedBusinessExitAndAdvanceSpotlight,
  type MatchedIndependentBusinessBuyer,
  quoteMatchedBusinessExit,
} from "../finance/businessExit";
import { cents } from "../finance/money";
import { propertyOffers } from "../finance/propertyActions";
import { createGame, createQ1BusinessDiagnosticGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type {
  BusinessAsset,
  GameState,
  PropertyAsset,
} from "../model/gameState";
import { openCashBusinessPurchaseTransaction } from "../transactions/cashBusinessPurchase";
import { collectPlayerObjectiveEvidence } from "./evidence";
import { measurePlayerObjectives } from "./measurements";

const ids = ["one", "two", "three", "four"].map(asPlayerId);
const actor = ids[0]!;
const broad = "broad-market-fund";
function send(state: GameState, player: PlayerId, command: WirePlayerCommand) {
  const result = applyPlayerCommand(state, player, command);
  if (!result.ok) throw new Error(`${command.type}: ${result.code}`);
  assertGameState(result.state);
  return result.state;
}
function setup(seed = "business-expansion") {
  let state = createGame({ gameId: "disposal-proof", seed, playerIds: ids });
  for (const id of ids)
    state = send(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
  return state;
}
function turn(state: GameState, player = actor) {
  for (let guard = 0; guard < 10; guard++) {
    if (state.round?.stage === "round-start")
      state = send(state, actor, { type: "BEGIN_ROUND" });
    const active = getActiveSpotlightPlayerId(state)!;
    if (active === player) return state;
    state = send(state, active, { type: "PASS_SPOTLIGHT" });
  }
  throw new Error("No spotlight");
}
function until(state: GameState, quarter: number) {
  while (state.currentQuarter < quarter) {
    if (state.round?.stage === "round-start")
      state = send(state, actor, { type: "BEGIN_ROUND" });
    state = send(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    });
  }
  return state;
}
function trade(state: GameState, buyCents: number, sellCents: number) {
  return send(turn(state), actor, {
    type: "TRADE_PUBLIC_MARKETS",
    trades: [{ instrumentId: broad, buyCents, sellCents }],
  });
}
function capitalSale(
  state: GameState,
  seller: PlayerId,
  buyer: PlayerId,
  assetId: string,
  ownershipPpm: number,
  priceCents: number,
) {
  state = send(turn(state, seller), seller, {
    type: "OPEN_BUSINESS_CAPITAL",
    assetId,
    terms: {
      kind: "secondary-stake-sale",
      sellerPlayerId: seller,
      buyerPlayerId: buyer,
      ownershipPpm,
      priceCents,
    },
  });
  const tx = state.activeTransaction!;
  if (tx.kind !== "business-capital") throw new Error("Wrong transaction");
  const binding = {
    transactionId: tx.id,
    expectedTermsRevision: tx.termsRevision,
  };
  for (const id of [seller, buyer])
    state = send(state, id, { type: "CONFIRM_BUSINESS_CAPITAL", ...binding });
  return send(state, seller, { type: "CLOSE_BUSINESS_CAPITAL", ...binding });
}
function companyFixture() {
  const state = setup();
  const asset = Object.values(state.finance.assetsById).find(
    (asset): asset is BusinessAsset =>
      asset.kind === "business" && asset.cashPolicyId === "starting-company-v1",
  )!;
  const owner = ids.find((id) => asset.ownershipByPlayerPpm[id] === 1_000_000)!;
  const buyer = ids.find(
    (id) => id !== owner && state.finance.cashByPlayer[id]! >= 1_020_000,
  )!;
  return { state, asset, owner, buyer };
}
function propertyPurchase() {
  let state: GameState | undefined;
  for (let seed = 0; seed < 100; seed++) {
    const candidate = setup(`disposal-property-${seed}`);
    if (candidate.players[actor]!.profileId === "disciplined-saver") {
      state = turn(candidate);
      break;
    }
  }
  if (!state) throw new Error("No saver");
  const offer = propertyOffers(state, actor)[0]!;
  const quote = offer.quotes.find(
    (quote) => quote.canClose && quote.principalCents > 0,
  )!;
  state = send(state, actor, {
    type: "BUY_PROPERTY",
    catalogueId: offer.catalogueId,
    principalCents: Math.floor(quote.principalCents * 0.9),
    rateKind: quote.rateKind,
  });
  const asset = Object.values(state.finance.assetsById).find(
    (asset): asset is PropertyAsset =>
      asset.kind === "property" && asset.catalogueId === offer.catalogueId,
  )!;
  return { state, asset };
}

function matchedExit(
  initial: GameState,
  seller: PlayerId,
  assetId: BusinessAsset["id"],
) {
  const state = turn(initial, seller);
  const asset = state.finance.assetsById[assetId] as BusinessAsset;
  // Explicit trusted buyer fixture; the production exit performs all accounting and evidence writes.
  const match: MatchedIndependentBusinessBuyer = {
    kind: "matched-independent-business-buyer",
    quoteId: "gain-floor-independent-buyer",
    buyerId: "gain-floor-outside-buyer",
    assetId,
    quarter: state.currentQuarter,
    operatingEnterpriseBidCents: asset.enterpriseValueCents,
    retainedCompanyCashCents: asset.cashCents,
    sellerOwnershipByPlayerPpm: asset.ownershipByPlayerPpm,
  };
  const quote = quoteMatchedBusinessExit(state, match);
  if (!quote.ok) throw new Error(quote.code);
  const closed = closeMatchedBusinessExitAndAdvanceSpotlight(
    {
      ...state,
      counters: {
        ...state.counters,
        transaction: state.counters.transaction + 1,
      },
    },
    seller,
    asTransactionId(`transaction-${state.counters.transaction + 1}`),
    match,
    quote.quote,
    "unanimous-owners",
  );
  if (!closed.ok) throw new Error(closed.code);
  assertGameState(closed.state);
  return closed.state;
}

it("does not credit a discounted player acquisition as an earned third-party resale gain", () => {
  const f = companyFixture();
  const entryReference = Math.round(
    calculateBusinessEquity(f.asset, f.state.finance.loansById)
      .equityValueCents / 4,
  );
  let state = capitalSale(f.state, f.owner, f.buyer, f.asset.id, 250_000, 100);
  const actualCost =
    state.progress.byPlayer[f.buyer]!.assetsById[f.asset.id]!.costCents;
  expect(actualCost).toBe(102);
  state = until(state, 4);
  const other = ids.find(
    (id) =>
      id !== f.owner &&
      id !== f.buyer &&
      state.finance.cashByPlayer[id]! > 10_200_000,
  )!;
  state = capitalSale(state, f.buyer, other, f.asset.id, 250_000, 10_000_000);
  const record = state.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  const expected = Math.max(
    0,
    Math.min(record.proceedsCents, record.referenceProceedsCents!) -
      record.saleFeesCents -
      (entryReference + 2),
  );
  expect(measurePlayerObjectives(state, f.buyer).creditedDealGainsCents).toBe(
    expected,
  );
  expect(record.acquisitionBasisCents).toBe(actualCost);
  expect(record.objectiveAcquisitionBasisFloorCents).toBe(entryReference + 2);
});

it("retains an allocated player entry floor through a partial disposal and a later NPC exit", () => {
  const f = companyFixture();
  let state = capitalSale(f.state, f.owner, f.buyer, f.asset.id, 250_000, 100);
  const acquired = state.progress.byPlayer[f.buyer]!.assetsById[f.asset.id]!;
  state = until(state, 4);
  const other = ids.find(
    (id) =>
      id !== f.owner &&
      id !== f.buyer &&
      state.finance.cashByPlayer[id]! > 5_100_000,
  )!;
  state = capitalSale(state, f.buyer, other, f.asset.id, 125_000, 5_000_000);
  const disposed = state.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  const retained = state.progress.byPlayer[f.buyer]!.assetsById[f.asset.id]!;
  expect(
    disposed.objectiveAcquisitionBasisFloorCents! +
      retained.objectiveCostFloorCents!,
  ).toBe(acquired.objectiveCostFloorCents);
  expect(disposed.acquisitionBasisCents + retained.costCents).toBe(
    acquired.costCents,
  );
  state = matchedExit(until(state, 5), f.buyer, f.asset.id);
  const records = state.progress.byPlayer[f.buyer]!.disposalEvidence!;
  expect(records.at(-1)!.counterparty.kind).toBe("non-player");
  expect(records.at(-1)!.objectiveAcquisitionBasisFloorCents).toBe(
    retained.objectiveCostFloorCents,
  );
  const expected = records.reduce((sum, record) => {
    const actual =
      record.proceedsCents -
      record.saleFeesCents -
      record.acquisitionBasisCents -
      (record.companyClaimsPaidCents ?? 0);
    const bounded =
      (record.counterparty.kind === "player"
        ? Math.min(record.proceedsCents, record.referenceProceedsCents!)
        : record.proceedsCents) -
      record.saleFeesCents -
      record.objectiveAcquisitionBasisFloorCents! -
      (record.companyClaimsPaidCents ?? 0);
    return sum + (actual < 0 ? actual : Math.max(0, bounded));
  }, 0);
  expect(measurePlayerObjectives(state, f.buyer).creditedDealGainsCents).toBe(
    expected,
  );
  expect(
    measurePlayerObjectives(JSON.parse(JSON.stringify(state)), f.buyer)
      .creditedDealGainsCents,
  ).toBe(expected);
});

it("bounds cheaply negotiated primary ownership without changing the contributed company cash", () => {
  const f = companyFixture();
  let state = send(turn(f.state, f.owner), f.owner, {
    type: "OPEN_BUSINESS_CAPITAL",
    assetId: f.asset.id,
    terms: {
      kind: "primary-issuance",
      contributions: [
        { playerId: f.buyer, amountCents: 100, postMoneyOwnershipPpm: 250_000 },
      ],
    },
  });
  const transaction = state.activeTransaction!;
  if (transaction.kind !== "business-capital")
    throw new Error("Wrong transaction");
  const binding = {
    transactionId: transaction.id,
    expectedTermsRevision: transaction.termsRevision,
  };
  for (const id of [f.owner, f.buyer])
    state = send(state, id, { type: "CONFIRM_BUSINESS_CAPITAL", ...binding });
  state = send(state, f.owner, { type: "CLOSE_BUSINESS_CAPITAL", ...binding });
  const basis = state.progress.byPlayer[f.buyer]!.assetsById[f.asset.id]!;
  expect(basis.costCents).toBe(100);
  expect(basis.objectiveCostFloorCents).toBe(
    Math.round(
      (calculateBusinessEquity(f.asset, f.state.finance.loansById)
        .equityValueCents +
        100) /
        4,
    ),
  );
  expect(
    (state.finance.assetsById[f.asset.id] as BusinessAsset).cashCents,
  ).toBe(f.asset.cashCents + 100);
  state = matchedExit(until(state, 4), f.buyer, f.asset.id);
  const record = state.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  expect(record.acquisitionBasisCents).toBe(100);
  const expected = Math.max(
    0,
    record.proceedsCents -
      record.saleFeesCents -
      (record.companyClaimsPaidCents ?? 0) -
      basis.objectiveCostFloorCents!,
  );
  expect(measurePlayerObjectives(state, f.buyer).creditedDealGainsCents).toBe(
    expected,
  );
});

it("protects the direct whole-business purchase path without changing its actual cash basis", () => {
  let state = createQ1BusinessDiagnosticGame({
    gameId: "whole-entry-floor",
    seed: "whole-entry-floor",
    playerIds: ids,
  });
  for (const id of ids)
    state = send(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
  const opportunity = Object.values(state.opportunitiesById)[0]!;
  state = turn(state, opportunity.targetPlayerId);
  const asset = state.finance.assetsById[opportunity.assetId] as BusinessAsset;
  const opened = openCashBusinessPurchaseTransaction(state, {
    buyerPlayerId: opportunity.targetPlayerId,
    sellerPlayerId: opportunity.sellerPlayerId,
    assetId: asset.id,
    purchasePriceCents: 100,
  });
  if (!opened.ok) throw new Error(opened.code);
  state = send(opened.state, opportunity.targetPlayerId, {
    type: "CLOSE_BUSINESS_PURCHASE",
    transactionId: opened.state.activeTransaction!.id,
  });
  const basis =
    state.progress.byPlayer[opportunity.targetPlayerId]!.assetsById[asset.id]!;
  expect(basis.costCents).toBe(100);
  expect(basis.objectiveCostFloorCents).toBe(asset.enterpriseValueCents);
  state = turn(until(state, 3), opportunity.targetPlayerId);
  const contribution =
    1_000_000 - (state.finance.assetsById[asset.id] as BusinessAsset).cashCents;
  state = send(state, opportunity.targetPlayerId, {
    type: "EXPAND_BUSINESS",
    assetId: asset.id,
    investmentCents: 1_000_000,
    ownerContributionCents: contribution,
  });
  const expanded =
    state.progress.byPlayer[opportunity.targetPlayerId]!.assetsById[asset.id]!;
  expect(expanded.costCents).toBe(basis.costCents + contribution);
  expect(expanded.objectiveCostFloorCents).toBe(
    basis.objectiveCostFloorCents! + contribution,
  );
  state = matchedExit(until(state, 4), opportunity.targetPlayerId, asset.id);
  expect(
    measurePlayerObjectives(state, opportunity.targetPlayerId)
      .creditedDealGainsCents,
  ).toBe(0);
});

it("rejects an unsafe or underreported negotiated entry floor at canonical and measurement boundaries", () => {
  const f = companyFixture();
  let state = capitalSale(f.state, f.owner, f.buyer, f.asset.id, 250_000, 100);
  const invalid = JSON.parse(JSON.stringify(state)) as GameState;
  Object.assign(invalid.progress.byPlayer[f.buyer]!.assetsById[f.asset.id]!, {
    objectiveCostFloorCents: 101,
  });
  expect(() => assertGameState(invalid)).toThrow("below actual basis");
  state = matchedExit(until(state, 4), f.buyer, f.asset.id);
  const corrupt = JSON.parse(JSON.stringify(state)) as GameState;
  const record = corrupt.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  Object.assign(record, {
    objectiveAcquisitionBasisFloorCents: record.acquisitionBasisCents - 1,
  });
  expect(() => assertGameState(corrupt)).toThrow("below actual basis");
  expect(() => measurePlayerObjectives(corrupt, f.buyer)).toThrow(
    "below actual acquisition cost",
  );
  Object.assign(record, {
    objectiveAcquisitionBasisFloorCents: Number.MAX_SAFE_INTEGER + 1,
  });
  expect(() => assertGameState(corrupt)).toThrow();
});

it("dates a real new fund acquisition only after a full following quarter, preserving aggregate weighted basis", () => {
  let state = setup();
  state = trade(state, 100_000, 0);
  const bought =
    state.progress.byPlayer[actor]!.publicMarketExposure![broad].at(-1)!;
  expect(bought).toMatchObject({
    acquiredQuarter: 1,
    settledExposureThroughQuarter: 0,
    costCents: 100_250,
  });
  state = until(state, 2);
  expect(
    state.progress.byPlayer[actor]!.publicMarketExposure![broad].at(-1)!
      .settledExposureThroughQuarter,
  ).toBe(0);
  state = until(state, 3);
  expect(
    state.progress.byPlayer[actor]!.publicMarketExposure![broad].at(-1)!
      .settledExposureThroughQuarter,
  ).toBe(2);
  const oldBasis = state.progress.byPlayer[actor]!.publicMarketBasis[broad];
  state = trade(state, 0, state.finance.publicMarketsByPlayer[actor]![broad]);
  const records = state.progress.byPlayer[actor]!.disposalEvidence!;
  expect(new Set(records.map((record) => record.transactionId)).size).toBe(1);
  expect(
    records.reduce((sum, record) => sum + record.acquisitionBasisCents, 0),
  ).toBe(oldBasis);
  expect(state.progress.byPlayer[actor]!.publicMarketBasis[broad]).toBe(0);
  expect(
    records.every((record) => record.settledExposureThroughQuarter === 2),
  ).toBe(true);
});

it("does not age a partial same-quarter fund buy using older holdings", () => {
  let state = trade(setup(), 100_000, 0);
  // The new position is sold in Q2: its acquisition-quarter settlement is not a full quarter of exposure.
  state = until(state, 2);
  state = trade(state, 0, state.finance.publicMarketsByPlayer[actor]![broad]);
  const records = collectPlayerObjectiveEvidence(state, actor).disposalLedger!
    .entries;
  const fresh = records.filter((record) => record.acquiredQuarter === 1);
  expect(fresh.length).toBeGreaterThan(0);
  expect(
    fresh.every((record) => record.settledExposureThroughQuarter === 0),
  ).toBe(true);
  const measured = measurePlayerObjectives(state, actor);
  const freshLosses = fresh.reduce(
    (sum, record) =>
      sum +
      Math.min(
        0,
        record.proceedsCents -
          record.saleFeesCents -
          record.acquisitionBasisCents,
      ),
    0,
  );
  const oldCredit = records
    .filter((record) => record.acquiredQuarter === 0)
    .reduce(
      (sum, record) =>
        sum +
        record.proceedsCents -
        record.saleFeesCents -
        record.acquisitionBasisCents,
      0,
    );
  expect(measured.creditedDealGainsCents).toBe(oldCredit + freshLosses);
});

it("preserves real property gross price, reserve cash, fees and payoff interest without crediting returned principal", () => {
  const bought = propertyPurchase();
  const before = turn(until(bought.state, 3));
  const basis = before.progress.byPlayer[actor]!.assetsById[bought.asset.id]!;
  const listed = before.finance.assetsById[bought.asset.id];
  if (listed?.kind !== "property")
    throw new Error("Expected property at resale");
  const originalRaw = before.progress.byPlayer[actor]!.realizedGainsCents;
  const after = send(before, actor, {
    type: "SELL_PROPERTY",
    assetId: bought.asset.id,
  });
  const record = after.progress.byPlayer[actor]!.disposalEvidence!.at(-1)!;
  expect(record).toMatchObject({
    category: "property",
    proceedsCents: listed.marketValueCents,
    acquisitionBasisCents: basis.costCents,
    settledExposureThroughQuarter: 2,
    acquiredQuarter: 1,
  });
  const actual =
    record.proceedsCents +
    (record.assetCashReleasedCents ?? 0) -
    record.saleFeesCents -
    (record.financingCostsCents ?? 0) -
    record.acquisitionBasisCents;
  expect(after.progress.byPlayer[actor]!.realizedGainsCents - originalRaw).toBe(
    actual,
  );
  expect(actual).toBeLessThan(0);
  expect(measurePlayerObjectives(after, actor).creditedDealGainsCents).toBe(
    actual,
  );
  expect(measurePlayerObjectives(after, actor).profitableDisposals).toBe(0);
});

it("retains an actual non-player bargain's recorded cost instead of raising it to a reference quote", () => {
  const bought = propertyPurchase();
  let state = until(bought.state, 3);
  // Synthetic bargain-accounting fixture; close and measurements use production paths.
  const old = state.progress.byPlayer[actor]!;
  state = {
    ...state,
    progress: {
      byPlayer: {
        ...state.progress.byPlayer,
        [actor]: {
          ...old,
          assetsById: {
            ...old.assetsById,
            [bought.asset.id]: {
              ...old.assetsById[bought.asset.id]!,
              costCents: cents(1_000_000),
            },
          },
        },
      },
    },
  };
  state = send(turn(state), actor, {
    type: "SELL_PROPERTY",
    assetId: bought.asset.id,
  });
  const record = state.progress.byPlayer[actor]!.disposalEvidence!.at(-1)!;
  expect(record.acquisitionBasisCents).toBe(1_000_000);
  expect(record.referenceProceedsCents).toBeNull();
  expect(measurePlayerObjectives(state, actor).creditedDealGainsCents).toBe(
    record.proceedsCents +
      (record.assetCashReleasedCents ?? 0) -
      record.saleFeesCents -
      (record.financingCostsCents ?? 0) -
      1_000_000,
  );
  expect(measurePlayerObjectives(state, actor).profitableDisposals).toBe(1);
});

it("caps a real player sale at the independent current stake quote and records its actual fees", () => {
  const f = companyFixture();
  let state = capitalSale(
    f.state,
    f.owner,
    f.buyer,
    f.asset.id,
    250_000,
    100_000,
  );
  state = until(state, 4);
  const other = ids.find(
    (id) =>
      id !== f.owner &&
      id !== f.buyer &&
      state.finance.cashByPlayer[id]! > 10_200_000,
  )!;
  expect(other).toBeDefined();
  state = capitalSale(
    until(state, 4),
    f.buyer,
    other,
    f.asset.id,
    250_000,
    10_000_000,
  );
  const record = state.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  expect(record).toMatchObject({
    saleFeesCents: 300_000,
    acquiredQuarter: 1,
    settledExposureThroughQuarter: 3,
  });
  expect(record.referenceProceedsCents).toBeLessThan(record.proceedsCents);
  const actual =
    record.proceedsCents - record.saleFeesCents - record.acquisitionBasisCents;
  const capped =
    Math.min(record.proceedsCents, record.referenceProceedsCents!) -
    record.saleFeesCents -
    record.objectiveAcquisitionBasisFloorCents!;
  expect(capped).toBeGreaterThan(0);
  expect(capped).toBeLessThan(actual);
  expect(measurePlayerObjectives(state, f.buyer).creditedDealGainsCents).toBe(
    capped,
  );
});

it("invalidates only documented returning stake exposure and retains its financial loss", () => {
  const f = companyFixture();
  let state = capitalSale(
    f.state,
    f.owner,
    f.buyer,
    f.asset.id,
    250_000,
    100_000,
  );
  const other = ids.find(
    (id) =>
      id !== f.owner &&
      id !== f.buyer &&
      state.finance.cashByPlayer[id]! > 10_200_000,
  )!;
  state = capitalSale(
    until(state, 4),
    f.buyer,
    other,
    f.asset.id,
    250_000,
    10_000_000,
  );
  const original = state.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  const beforeCredit = measurePlayerObjectives(
    state,
    f.buyer,
  ).creditedDealGainsCents;
  expect(beforeCredit).toBeGreaterThan(0);
  state = capitalSale(
    until(state, 6),
    other,
    f.buyer,
    f.asset.id,
    125_000,
    2_000_000,
  );
  const projected = collectPlayerObjectiveEvidence(
    state,
    f.buyer,
  ).disposalLedger!.entries.filter(
    (entry) => entry.transactionId === original.transactionId,
  );
  expect(projected.map((entry) => entry.economicSubstance).sort()).toEqual([
    "circular",
    "genuine",
  ]);
  expect(projected.reduce((sum, entry) => sum + entry.proceedsCents, 0)).toBe(
    original.proceedsCents,
  );
  expect(
    projected.find((entry) => entry.economicSubstance === "circular")!
      .proceedsCents,
  ).toBe(5_000_000);
  expect(measurePlayerObjectives(state, f.buyer).creditedDealGainsCents).toBe(
    beforeCredit / 2,
  );
  const returning = state.progress.byPlayer[other]!.disposalEvidence!.at(-1)!;
  expect(returning.circularReturns).toEqual(
    expect.arrayContaining([
      { disposalId: original.disposalId, ownershipUnits: 125_000 },
    ]),
  );
  const loss =
    returning.proceedsCents -
    returning.saleFeesCents -
    returning.acquisitionBasisCents;
  expect(loss).toBeLessThan(0);
  expect(measurePlayerObjectives(state, other).creditedDealGainsCents).toBe(
    loss,
  );
  state = capitalSale(
    until(state, 8),
    other,
    f.buyer,
    f.asset.id,
    125_000,
    2_000_000,
  );
  expect(measurePlayerObjectives(state, f.buyer).creditedDealGainsCents).toBe(
    0,
  );
  expect(measurePlayerObjectives(state, f.buyer).profitableDisposals).toBe(0);
});

it("groups mixed acquisition slices into one close, nets losses and protects private dated evidence", () => {
  const f = companyFixture();
  let state = capitalSale(
    f.state,
    f.owner,
    f.buyer,
    f.asset.id,
    400_000,
    100_000,
  );
  state = capitalSale(
    until(state, 2),
    f.owner,
    f.buyer,
    f.asset.id,
    400_000,
    100_000,
  );
  const other = ids.find((id) => id !== f.owner && id !== f.buyer)!;
  state = until(state, 4);
  // Synthetic counterparty liquidity; the seasoned stakes sell at their current reference value.
  state = {
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [other]: cents(100_000_000),
      },
    },
  };
  const salePrice = Math.round(
    calculateBusinessEquity(
      state.finance.assetsById[f.asset.id] as BusinessAsset,
      state.finance.loansById,
    ).equityValueCents * 0.8,
  );
  state = capitalSale(state, f.buyer, other, f.asset.id, 800_000, salePrice);
  const records = state.progress.byPlayer[f.buyer]!.disposalEvidence!;
  expect(records).toHaveLength(2);
  expect(new Set(records.map((record) => record.transactionId)).size).toBe(1);
  expect(records.map((record) => record.acquiredQuarter)).toEqual([1, 2]);
  expect(measurePlayerObjectives(state, f.buyer).profitableDisposals).toBe(1);
  // Synthetic signed-slice probe: a losing slice must prevent the close being counted as profitable.
  const losing = {
    ...state,
    progress: {
      byPlayer: {
        ...state.progress.byPlayer,
        [f.buyer]: {
          ...state.progress.byPlayer[f.buyer]!,
          disposalEvidence: records.map((record, index) => ({
            ...record,
            acquisitionBasisCents: cents(index === 0 ? salePrice : 0),
            objectiveAcquisitionBasisFloorCents: undefined,
          })),
        },
      },
    },
  };
  expect(measurePlayerObjectives(losing, f.buyer).creditedDealGainsCents).toBe(
    -records.reduce((total, record) => total + record.saleFeesCents, 0),
  );
  expect(measurePlayerObjectives(losing, f.buyer).profitableDisposals).toBe(0);
  const observer = ids.find(
    (id) => id !== f.owner && id !== f.buyer && id !== other,
  )!;
  const view = projectPlayerGameState(state, observer);
  const changed = {
    ...state,
    progress: {
      byPlayer: {
        ...state.progress.byPlayer,
        [f.buyer]: {
          ...state.progress.byPlayer[f.buyer]!,
          disposalEvidence: records.map((record) => ({
            ...record,
            acquisitionBasisCents: cents(record.acquisitionBasisCents + 1),
            ...(record.objectiveAcquisitionBasisFloorCents !== undefined
              ? {
                  objectiveAcquisitionBasisFloorCents: cents(
                    record.objectiveAcquisitionBasisFloorCents + 1,
                  ),
                }
              : {}),
          })),
        },
      },
    },
  };
  assertGameState(changed);
  expect(projectPlayerGameState(changed, observer)).toEqual(view);
  expect(() =>
    measurePlayerObjectives(state, f.buyer, {
      disposalLedger: { throughRevision: state.revision, entries: [] },
    }),
  ).toThrow("cannot be overridden");
  const roundTrip = JSON.parse(JSON.stringify(state)) as GameState;
  assertGameState(roundTrip);
  expect(measurePlayerObjectives(roundTrip, f.buyer)).toEqual(
    measurePlayerObjectives(state, f.buyer),
  );
});

it("denies positive credit for an actual same-quarter stake resale", () => {
  const f = companyFixture();
  let state = capitalSale(
    f.state,
    f.owner,
    f.buyer,
    f.asset.id,
    250_000,
    100_000,
  );
  const other = ids.find(
    (id) =>
      id !== f.owner &&
      id !== f.buyer &&
      state.finance.cashByPlayer[id]! > 6_120_000,
  )!;
  state = capitalSale(state, f.buyer, other, f.asset.id, 250_000, 6_000_000);
  const record = state.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  expect(record).toMatchObject({
    acquiredQuarter: 1,
    soldQuarter: 1,
    settledExposureThroughQuarter: 0,
  });
  expect(
    record.proceedsCents - record.saleFeesCents - record.acquisitionBasisCents,
  ).toBeGreaterThan(0);
  expect(measurePlayerObjectives(state, f.buyer).creditedDealGainsCents).toBe(
    0,
  );
  expect(measurePlayerObjectives(state, f.buyer).profitableDisposals).toBe(0);
});

it("does not turn an inflated small-stake price into a material player disposal", () => {
  const f = companyFixture();
  let state = capitalSale(
    f.state,
    f.owner,
    f.buyer,
    f.asset.id,
    250_000,
    100_000,
  );
  const other = ids.find(
    (id) =>
      id !== f.owner &&
      id !== f.buyer &&
      state.finance.cashByPlayer[id]! > 5_100_000,
  )!;
  state = capitalSale(
    until(state, 16),
    f.buyer,
    other,
    f.asset.id,
    10_000,
    5_000_000,
  );
  const record = state.progress.byPlayer[f.buyer]!.disposalEvidence!.at(-1)!;
  expect(record.proceedsCents).toBe(5_000_000);
  expect(record.referenceProceedsCents).toBeLessThan(5_000_000);
  expect(
    measurePlayerObjectives(state, f.buyer).creditedDealGainsCents,
  ).toBeGreaterThan(0);
  expect(measurePlayerObjectives(state, f.buyer).profitableDisposals).toBe(0);
});

it("rejects fabricated exposure dates, duplicate slice identities and unknown return lineage", () => {
  const f = companyFixture();
  const state = capitalSale(
    until(f.state, 2),
    f.owner,
    f.buyer,
    f.asset.id,
    250_000,
    100_000,
  );
  const progress = state.progress.byPlayer[f.owner]!;
  const original = progress.disposalEvidence![0]!;
  for (const entries of [
    [{ ...original, settledExposureThroughQuarter: 2 }],
    [original, original],
    [
      {
        ...original,
        circularReturns: [{ disposalId: "invented", ownershipUnits: 1 }],
      },
    ],
    [{ ...original, saleFeesCents: -1 }],
  ]) {
    const changed = {
      ...state,
      progress: {
        byPlayer: {
          ...state.progress.byPlayer,
          [f.owner]: { ...progress, disposalEvidence: entries },
        },
      },
    } as GameState;
    expect(() => assertGameState(changed)).toThrow();
  }
});
