import { asPlayerId, type PlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import { cents } from "../finance/money";
import { propertyOffers } from "../finance/propertyActions";
import { createGame } from "../game/createGame";
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
  const originalRaw = before.progress.byPlayer[actor]!.realizedGainsCents;
  const after = send(before, actor, {
    type: "SELL_PROPERTY",
    assetId: bought.asset.id,
  });
  const record = after.progress.byPlayer[actor]!.disposalEvidence!.at(-1)!;
  expect(record).toMatchObject({
    category: "property",
    proceedsCents: bought.asset.marketValueCents,
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
    record.acquisitionBasisCents;
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
      state.finance.cashByPlayer[id]! > 6_120_000,
  )!;
  state = capitalSale(
    until(state, 4),
    f.buyer,
    other,
    f.asset.id,
    250_000,
    6_000_000,
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
  ).toBe(3_000_000);
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
  state = capitalSale(
    until(state, 4),
    f.buyer,
    other,
    f.asset.id,
    800_000,
    6_000_000,
  );
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
            acquisitionBasisCents: cents(index === 0 ? 6_000_000 : 0),
          })),
        },
      },
    },
  };
  expect(measurePlayerObjectives(losing, f.buyer).creditedDealGainsCents).toBe(
    -180_000,
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
    until(state, 4),
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
