import {
  asLoanId,
  asPlayerId,
  asTransactionId,
  type PlayerId,
} from "@interests/shared";
import { describe, expect, it } from "vitest";
import { stageOpeningFixture } from "../../test/openingFixture";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type {
  AssetBankLoan,
  BusinessAsset,
  GameState,
} from "../model/gameState";
import { calculateAmortizingSchedule } from "./amortization";
import { bankPayoff } from "./bank";
import {
  closeMatchedBusinessExitAndAdvanceSpotlight,
  draftMatchedBusinessExit,
  type MatchedIndependentBusinessBuyer,
  quoteMatchedBusinessExit,
} from "./businessExit";
import { basisPoints, cents } from "./money";
import { ownershipPpm } from "./ownership";

const ids = ["A", "B", "C", "D"].map(asPlayerId),
  seller = ids[3]!,
  partner = ids[0]!,
  transaction = asTransactionId("transaction-1");
function accepted(
  state: GameState,
  actor: PlayerId,
  command: Parameters<typeof applyPlayerCommand>[2],
) {
  const result = applyPlayerCommand(state, actor, command);
  expect(result.ok, result.ok ? "" : result.code).toBe(true);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  return result.state;
}
function fixture(
  options: {
    shared?: boolean;
    profit?: number;
    cash?: number;
    claims?: boolean;
    bank?: boolean;
  } = {},
) {
  let state!: GameState, company!: BusinessAsset;
  for (let seed = 0; seed < 100; seed++) {
    state = createGame({
      gameId: "npc-business-exit",
      seed: `npc-business-exit-${seed}`,
      playerIds: ids,
    });
    const found = Object.values(state.finance.assetsById).find(
      (asset): asset is BusinessAsset =>
        asset.kind === "business" &&
        asset.cashPolicyId === "starting-company-v1" &&
        (asset.ownershipByPlayerPpm[seller] ?? 0) > 0,
    );
    if (found) {
      company = found;
      break;
    }
  }
  if (!company) throw new Error("No fixture seed");
  for (const id of ids)
    state = accepted(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
  company = {
    ...company,
    cashCents: cents(options.cash ?? 500_000),
    annualOperatingProfitCents: cents(options.profit ?? 4_000_000),
    operatingArrearsCents: cents(options.claims ? 13_000 : 0),
    workCompensation: {
      ...company.workCompensation!,
      arrearsCents: cents(options.claims ? 27_000 : 0),
    },
    ...(options.shared
      ? {
          ownershipByPlayerPpm: {
            [seller]: ownershipPpm(600_000),
            [partner]: ownershipPpm(400_000),
          },
        }
      : {}),
  };
  const loans = { ...state.finance.loansById };
  if (options.bank) {
    const principal = cents(2_000_000),
      rate = basisPoints(800),
      payment = calculateAmortizingSchedule({
        principalCents: principal,
        annualRateBps: rate,
        termQuarters: 28,
      })[0]!.paymentCents;
    const loan: AssetBankLoan = {
      id: asLoanId("business-exit-bank"),
      kind: "asset-bank-loan",
      borrowerAssetId: company.id,
      leadPlayerId: seller,
      purpose: "business-acquisition",
      originalPrincipalCents: principal,
      outstandingPrincipalCents: principal,
      annualRateBps: rate,
      pricing: { kind: "fixed" },
      scheduledQuarterlyPaymentCents: payment,
      firstDueQuarter: 2,
      maturityQuarter: 29,
      termQuarters: 28,
      periodsProcessed: 0,
      interestPaidThroughQuarter: 1,
      paymentResetQuarter: 2,
      paymentBasisPrincipalCents: principal,
      principalRepaidCents: cents(0),
      pastDuePrincipalCents: cents(0),
      unpaidInterestCents: cents(0),
      lastProcessedQuarter: 0,
    };
    loans[loan.id] = loan;
  }
  state = stageOpeningFixture({
    ...state,
    finance: {
      ...state.finance,
      loansById: loans,
      assetsById: { ...state.finance.assetsById, [company.id]: company },
    },
  });
  state = accepted(state, ids[0]!, { type: "BEGIN_ROUND" });
  while (getActiveSpotlightPlayerId(state) !== seller)
    state = accepted(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    });
  return { state, id: company.id };
}
function match(
  state: GameState,
  id: BusinessAsset["id"],
): MatchedIndependentBusinessBuyer {
  const asset = state.finance.assetsById[id] as BusinessAsset;
  return {
    kind: "matched-independent-business-buyer",
    quoteId: "opportunity-npc-buyer-1",
    buyerId: "independent-buyer-1",
    assetId: id,
    quarter: state.currentQuarter,
    operatingEnterpriseBidCents: 30_000_000,
    retainedCompanyCashCents: asset.cashCents,
    sellerOwnershipByPlayerPpm: { ...asset.ownershipByPlayerPpm },
  };
}
function quote(state: GameState, terms: MatchedIndependentBusinessBuyer) {
  const result = quoteMatchedBusinessExit(state, terms);
  if (!result.ok) throw new Error(result.code);
  return result.quote;
}

describe("trusted matched NPC whole-business exit", () => {
  it("posts cash-inclusive consideration once, exact fees/liens/claims and owner net while retaining only the NPC's original cash", () => {
    const { state, id } = fixture({ claims: true, bank: true }),
      terms = match(state, id),
      expected = quote(state, terms);
    const result = draftMatchedBusinessExit(
      state,
      seller,
      transaction,
      terms,
      expected,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertGameState(result.state);
    const sold = result.state.finance.assetsById[id] as BusinessAsset;
    expect(sold.cashCents).toBe(500_000);
    expect(sold.ownershipByPlayerPpm).toEqual({});
    expect(expected.grossConsiderationCents).toBe(30_500_000);
    expect(expected.saleFeeCents).toBe(915_000);
    const claims = Object.values(state.finance.loansById).filter(
      (loan) =>
        (loan.kind === "company-loan" || loan.kind === "asset-bank-loan") &&
        loan.borrowerAssetId === id,
    );
    expect(expected.bankPayoffCents).toBe(
      claims.reduce((sum, loan) => sum + bankPayoff(state, loan).totalCents, 0),
    );
    expect(result.state.finance.cashByPlayer[seller]).toBe(
      state.finance.cashByPlayer[seller]! +
        expected.netOwnerProceedsCents +
        27_000,
    );
    expect(
      expected.netOwnerProceedsCents +
        expected.saleFeeCents +
        expected.bankPayoffCents +
        13_000 +
        27_000,
    ).toBe(expected.grossConsiderationCents);
    expect(
      result.journalEntries.filter(
        (entry) => entry.reason === "npc-business-sale-consideration",
      ),
    ).toHaveLength(1);
    expect(
      result.journalEntries.filter(
        (entry) => entry.reason === "business-bank-loan-payoff",
      ),
    ).toHaveLength(2);
    expect(
      result.journalEntries.filter(
        (entry) => entry.reason === "business-sale-fee",
      ),
    ).toHaveLength(1);
    for (const loan of claims)
      expect(result.state.finance.loansById[loan.id]).toMatchObject({
        outstandingPrincipalCents: 0,
        unpaidInterestCents: 0,
        pastDuePrincipalCents: 0,
        principalRepaidCents: loan.originalPrincipalCents,
      });
    expect(result.state.finance.quarterStartBasis).toBe(
      state.finance.quarterStartBasis,
    );
    expect(result.state.progress.byPlayer[seller]!.labor).toEqual({
      kind: "not-working",
    });
    expect(
      result.state.progress.byPlayer[seller]!.assetsById[id],
    ).toBeUndefined();
    expect(result.state.progress.byPlayer[seller]!.realizedGainsCents).toBe(
      expected.netOwnerProceedsCents -
        state.progress.byPlayer[seller]!.assetsById[id]!.costCents,
    );
    expect(
      result.state.progress.byPlayer[seller]!.disposals.at(-1),
    ).toMatchObject({
      counterpartyPlayerId: null,
      soldQuarter: 1,
      proceedsCents: expected.netOwnerProceedsCents,
      grossProceedsCents: expected.grossConsiderationCents,
    });
    expect(
      projectPlayerGameState(result.state, seller).self.ownedAssets.some(
        (asset) => asset.id === id,
      ),
    ).toBe(false);
    const retry = draftMatchedBusinessExit(
      result.state,
      seller,
      transaction,
      terms,
      expected,
    );
    expect(retry).toMatchObject({
      ok: false,
      state: result.state,
      journalEntries: [],
    });
  });
  it("requires trusted unanimity for shared owners, allocates by authoritative ownership and preserves dated acquisition lots", () => {
    const ready = fixture({ shared: true });
    let state = ready.state;
    const old = state.progress.byPlayer[seller]!.assetsById[ready.id]!;
    state = {
      ...state,
      progress: {
        byPlayer: {
          ...state.progress.byPlayer,
          [seller]: {
            ...state.progress.byPlayer[seller]!,
            assetsById: {
              ...state.progress.byPlayer[seller]!.assetsById,
              [ready.id]: {
                ...old,
                acquiredQuarter: 1,
                slices: [
                  {
                    acquiredQuarter: 0,
                    ownershipPpm: ownershipPpm(300_000),
                    costCents: cents(Math.floor(old.costCents / 2)),
                  },
                  {
                    acquiredQuarter: 1,
                    ownershipPpm: ownershipPpm(300_000),
                    costCents: cents(
                      old.costCents - Math.floor(old.costCents / 2),
                    ),
                  },
                ],
              },
            },
          },
        },
      },
    };
    assertGameState(state);
    const terms = match(state, ready.id),
      expected = quote(state, terms);
    expect(
      draftMatchedBusinessExit(state, seller, transaction, terms, expected),
    ).toMatchObject({ ok: false, code: "OWNER_CONSENT_REQUIRED", state });
    const result = draftMatchedBusinessExit(
      state,
      seller,
      transaction,
      terms,
      expected,
      "unanimous-owners",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertGameState(result.state);
    for (const id of [seller, partner])
      expect(result.state.finance.cashByPlayer[id]).toBe(
        state.finance.cashByPlayer[id]! + expected.proceedsByPlayer[id]!,
      );
    const disposals = result.state.progress.byPlayer[seller]!.disposals;
    expect(disposals.map((record) => record.acquiredQuarter)).toEqual([0, 1]);
    expect(disposals.reduce((sum, record) => sum + record.costCents, 0)).toBe(
      old.costCents,
    );
    expect(
      disposals.reduce((sum, record) => sum + record.proceedsCents, 0),
    ).toBe(expected.proceedsByPlayer[seller]);
  });
  it("preserves the closing quarter's earned operating and work income, counts earned payoff interest once and never recurs after sale", () => {
    const { state, id } = fixture({ claims: true }),
      terms = match(state, id),
      expected = quote(state, terms);
    const result = closeMatchedBusinessExitAndAdvanceSpotlight(
      state,
      seller,
      transaction,
      terms,
      expected,
    );
    expect(result.ok, result.ok ? "" : result.code).toBe(true);
    if (!result.ok) return;
    assertGameState(result.state);
    expect(result.state.currentQuarter).toBe(2);
    const business = result.state.finance.lastSettlement!.businesses.find(
      (business) => business.assetId === id,
    )!;
    expect(business.operatingCashCents).toBe(1_000_000);
    expect(business.workCompensation!.currentPaidCents).toBe(
      business.workCompensation!.currentDueCents,
    );
    expect(business.workCompensation!.arrearsDueCents).toBe(0);
    expect(business.companyDebtPaidCents).toBe(0);
    const observation =
      result.state.progress.byPlayer[seller]!.quarters.at(-1)!;
    expect(observation.workIncomeCents).toBe(
      business.workCompensation!.currentPaidCents + 27_000,
    );
    expect(observation.recurringWorkIncomeCents).toBe(
      business.workCompensation!.currentPaidCents,
    );
    expect(observation.sourcesById[`asset:${id}`]).toMatchObject({
      category: "business",
      debtServiceOwedCents: expected.bankInterestPaidCents,
      recurringReceivedCents: business.distributionsByPlayer[seller],
    });
    expect(
      result.state.finance.quarterStartBasis.businessesById[id],
    ).toBeUndefined();
    let next = accepted(result.state, ids[0]!, { type: "BEGIN_ROUND" });
    while (next.currentQuarter === 2)
      next = accepted(next, getActiveSpotlightPlayerId(next)!, {
        type: "PASS_SPOTLIGHT",
      });
    expect(
      next.finance.lastSettlement!.businesses.some(
        (business) => business.assetId === id,
      ),
    ).toBe(false);
    expect(
      next.progress.byPlayer[seller]!.quarters.at(-1)!.sourcesById[
        `asset:${id}`
      ],
    ).toBeUndefined();
  });
  it("settles old claims after a distressed quarter without rewriting that historical settlement", () => {
    let { state, id } = fixture({ profit: -12_000_000, cash: 0 });
    state = accepted(state, seller, { type: "PASS_SPOTLIGHT" });
    const prior = state.finance.lastSettlement!;
    expect(
      (state.finance.assetsById[id] as BusinessAsset).operatingArrearsCents,
    ).toBeGreaterThan(0);
    state = accepted(state, ids[0]!, { type: "BEGIN_ROUND" });
    while (getActiveSpotlightPlayerId(state) !== seller)
      state = accepted(state, getActiveSpotlightPlayerId(state)!, {
        type: "PASS_SPOTLIGHT",
      });
    const terms = match(state, id),
      expected = quote(state, terms),
      result = draftMatchedBusinessExit(
        state,
        seller,
        transaction,
        terms,
        expected,
      );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.finance.lastSettlement).toBe(prior);
    assertGameState(result.state);
    expect(
      (result.state.finance.assetsById[id] as BusinessAsset)
        .operatingArrearsCents,
    ).toBe(0);
  });
  it("rejects unmatched, stale, insolvent, overflowing and unreleased drafts without consuming money, IDs or RNG", () => {
    const { state, id } = fixture(),
      terms = match(state, id),
      expected = quote(state, terms);
    for (const bad of [
      { ...terms, buyerId: seller },
      { ...terms, retainedCompanyCashCents: 1 },
      { ...terms, quarter: 2 },
      { ...terms, operatingEnterpriseBidCents: 0 },
      { ...terms, operatingEnterpriseBidCents: 1.5 },
    ])
      expect(
        draftMatchedBusinessExit(state, seller, transaction, bad, expected),
      ).toMatchObject({ ok: false, state, journalEntries: [] });
    expect(
      quoteMatchedBusinessExit(state, {
        ...terms,
        operatingEnterpriseBidCents: 1,
      }),
    ).toMatchObject({ ok: false, code: "INSUFFICIENT_PAYOFF" });
    expect(
      draftMatchedBusinessExit(state, seller, transaction, terms, {
        ...expected,
        saleFeeCents: cents(1),
      }),
    ).toMatchObject({ ok: false, code: "QUOTE_CHANGED", state });
    for (const broken of [
      {
        ...state,
        counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER },
      },
      {
        ...state,
        finance: {
          ...state.finance,
          cashByPlayer: {
            ...state.finance.cashByPlayer,
            [seller]: cents(Number.MAX_SAFE_INTEGER),
          },
        },
      },
    ]) {
      const before = JSON.stringify(broken),
        result = draftMatchedBusinessExit(
          broken,
          seller,
          transaction,
          terms,
          expected,
        );
      expect(result.ok).toBe(false);
      expect(result.state).toBe(broken);
      expect(result.journalEntries).toEqual([]);
      expect(JSON.stringify(broken)).toBe(before);
    }
    const noSettlement = {
        ...state,
        counters: { ...state.counters, settlement: Number.MAX_SAFE_INTEGER },
      },
      before = JSON.stringify(noSettlement);
    const rollback = closeMatchedBusinessExitAndAdvanceSpotlight(
      noSettlement,
      seller,
      transaction,
      terms,
      expected,
    );
    expect(rollback.ok).toBe(false);
    expect(rollback.state).toBe(noSettlement);
    expect(rollback.journalEntries).toEqual([]);
    expect(JSON.stringify(noSettlement)).toBe(before);
  });
});
