import { asLoanId, asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState, PlayerLoan } from "../model/gameState";
import {
  closeCashBusinessPurchaseTransaction,
  openCashBusinessPurchaseTransaction,
} from "../transactions/cashBusinessPurchase";
import { captureBusinessBasis } from "./businessSettlement";
import { createZeroPublicMarketPortfolio } from "./markets";
import { basisPoints, cents } from "./money";
import {
  capturePropertyBasis,
  captureRecurringBasis,
  createProgress,
  recordBusinessPurchaseBasis,
  recordQuarterObservations,
} from "./progress";
import { settleQuarter } from "./settlement";

const ids = ["a", "b", "c", "d"].map(asPlayerId);
function ready(seed = "progress-test"): GameState {
  let state = createGame({ gameId: "progress-test", seed, playerIds: ids });
  for (const id of ids) {
    const result = applyPlayerCommand(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  return state;
}
function settle(state: GameState) {
  const result = settleQuarter(state, { quarter: state.currentQuarter });
  if (!result.ok) throw new Error(result.code);
  return result;
}
function isolated(): GameState {
  const state = ready();
  const zeroCash = Object.fromEntries(ids.map((id) => [id, cents(0)]));
  const portfolios = Object.fromEntries(
    ids.map((id) => [id, createZeroPublicMarketPortfolio()]),
  );
  const recurring = Object.fromEntries(
    ids.map((id) => [
      id,
      { quarterlyIncomeCents: cents(0), quarterlyLivingExpenseCents: cents(0) },
    ]),
  );
  const finance = {
    ...state.finance,
    cashByPlayer: zeroCash,
    publicMarketsByPlayer: portfolios,
    recurringByPlayer: recurring,
    assetsById: {},
    loansById: {},
    quarterStartBasis: {
      quarter: 1,
      cashByPlayer: zeroCash,
      publicMarketsByPlayer: portfolios,
      businessesById: {},
      propertiesById: {},
      recurringByPlayer: captureRecurringBasis(recurring),
    },
  };
  return {
    ...state,
    opportunitiesById: {},
    finance,
    progress: createProgress(finance, ids),
  };
}
function loan(id: string, borrower: PlayerId, lender: PlayerId): PlayerLoan {
  return {
    id: asLoanId(id),
    kind: "player-loan",
    borrowerPlayerId: borrower,
    lenderPlayerId: lender,
    originalPrincipalCents: cents(10_000),
    outstandingPrincipalCents: cents(10_000),
    annualRateBps: basisPoints(1000),
    termQuarters: 2,
    installmentsProcessed: 0,
    originatedQuarter: 1,
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
  };
}

describe("canonical progress accounting", () => {
  it("settles salary and living costs from opening entitlement before rolling changed contracts", () => {
    const state = ready("foundation-proof");
    const worker = ids.find(
      (id) => state.finance.recurringByPlayer[id]!.quarterlyIncomeCents > 0,
    )!;
    const old = state.finance.recurringByPlayer[worker]!;
    const changed = {
      quarterlyIncomeCents: cents(old.quarterlyIncomeCents + 100_000),
      quarterlyLivingExpenseCents: cents(
        old.quarterlyLivingExpenseCents + 100_000,
      ),
    };
    const result = settle({
      ...state,
      finance: {
        ...state.finance,
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [worker]: changed,
        },
      },
    });
    expect(
      result.state.progress.byPlayer[worker]!.quarters[0]!
        .employmentIncomeCents,
    ).toBe(old.quarterlyIncomeCents);
    expect(
      result.settlementOutcome.livingByPlayer[worker]!.currentDueCents,
    ).toBe(old.quarterlyLivingExpenseCents);
    expect(
      result.state.finance.quarterStartBasis.recurringByPlayer[worker],
    ).toEqual({ ...changed, quarterlyLivingExpenseCents: 1_368_500 });
  });

  it("keeps a property's earned quarter with its opening owner after current ownership changes", () => {
    const state = ready("foundation-proof");
    const property = Object.values(state.finance.assetsById).find(
      (asset) => asset.kind === "property",
    );
    if (!property) throw new Error("Expected property fixture");
    const owner = ids.find(
      (id) => (property.ownershipByPlayerPpm[id] ?? 0) > 0,
    )!;
    const buyer = ids.find((id) => id !== owner)!;
    // Isolate the entitlement boundary; future property commands perform the cash/debt close.
    const finance = {
      ...state.finance,
      assetsById: {
        ...state.finance.assetsById,
        [property.id]: {
          ...property,
          ownershipByPlayerPpm: {
            [buyer]: property.ownershipByPlayerPpm[owner]!,
          },
        },
      },
    };
    const result = settle({
      ...state,
      finance,
      progress: createProgress(finance, ids),
    });
    const distributions = result.journalEntries.filter(
      (entry) => entry.reason === "property-operating-distribution",
    );
    expect(distributions).toHaveLength(1);
    expect(distributions[0]!.destination).toEqual({
      kind: "player",
      playerId: owner,
    });
    expect(
      result.state.finance.quarterStartBasis.propertiesById[property.id]!
        .ownershipByPlayerPpm,
    ).toEqual({ [buyer]: 1_000_000 });
  });
  it.each(["cash", "financed"] as const)(
    "rejects cumulative gain overflow through the %s command without partial effects",
    (funding) => {
      let state = ready();
      const opportunity = Object.values(state.opportunitiesById)[0]!;
      const buyer = opportunity.targetPlayerId;
      const seller = opportunity.sellerPlayerId;
      const lender = ids.find((id) => id !== buyer && id !== seller)!;
      function command(
        actor: PlayerId,
        payload: Parameters<typeof applyPlayerCommand>[2],
      ) {
        const result = applyPlayerCommand(state, actor, payload);
        if (!result.ok) throw new Error(result.code);
        state = result.state;
      }
      command(ids[0]!, { type: "BEGIN_ROUND" });
      while (getActiveSpotlightPlayerId(state) !== buyer)
        command(getActiveSpotlightPlayerId(state)!, { type: "PASS_SPOTLIGHT" });
      state = {
        ...state,
        finance: {
          ...state.finance,
          cashByPlayer: {
            ...state.finance.cashByPlayer,
            [buyer]: cents(10_000_000),
            [lender]: cents(10_000_000),
          },
        },
        progress: {
          byPlayer: {
            ...state.progress.byPlayer,
            [seller]: {
              ...state.progress.byPlayer[seller]!,
              realizedGainsCents: cents(-Number.MAX_SAFE_INTEGER),
            },
          },
        },
      };
      assertGameState(state);
      if (funding === "cash")
        command(buyer, {
          type: "PURSUE_BUSINESS_CASH",
          opportunityId: opportunity.id,
        });
      else {
        command(buyer, {
          type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
          opportunityId: opportunity.id,
          buyerCashContributionCents: 3_000_000,
          requestedPrincipalCents: 2_000_000,
        });
        command(lender, {
          type: "SUBMIT_PLAYER_LOAN_OFFER",
          transactionId: state.activeTransaction!.id,
          annualRateBps: 1_000,
          termQuarters: 3,
        });
        command(buyer, {
          type: "ACCEPT_PLAYER_LOAN_OFFER",
          transactionId: state.activeTransaction!.id,
          expectedTermsRevision: 1,
        });
      }
      const before = structuredClone(state);
      const rejected = applyPlayerCommand(state, buyer, {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: state.activeTransaction!.id,
      });
      expect(rejected).toMatchObject({
        ok: false,
        code: "DESTINATION_OVERFLOW",
        state,
        journalEntries: [],
      });
      expect(rejected.state).toBe(state);
      expect(state).toEqual(before);
    },
  );
  it("initializes real opening costs and labor without fabricated objective history", () => {
    const state = ready();
    for (const id of ids) {
      const progress = state.progress.byPlayer[id]!;
      expect(progress.focus).toBe("general");
      expect(progress.quarters).toEqual([]);
      expect(progress.publicMarketBasis).toEqual(
        state.finance.publicMarketsByPlayer[id],
      );
      for (const asset of Object.values(state.finance.assetsById)) {
        const units = asset.ownershipByPlayerPpm[id] ?? 0;
        if (units === 0) continue;
        expect(progress.assetsById[asset.id]?.ownershipPpm).toBe(units);
        expect(progress.assetsById[asset.id]?.acquiredQuarter).toBe(0);
        if (
          asset.kind === "business" &&
          asset.workCompensation?.playerId === id
        )
          expect(progress.labor).toEqual({
            kind: "owner-work",
            assetId: asset.id,
          });
      }
    }
  });

  it("copies operating inputs and ownership independently of later drafts", () => {
    let state = ready();
    for (
      let n = 0;
      Object.values(state.finance.assetsById).every(
        (a) => a.kind !== "property",
      );
      n++
    )
      state = ready(`property-progress-${n}`);
    const property = Object.values(state.finance.assetsById).find(
      (a) => a.kind === "property",
    )!;
    const captured = capturePropertyBasis(state.finance.assetsById);
    expect(captured[property.id]).not.toBe(property);
    expect(captured[property.id]?.ownershipByPlayerPpm).not.toBe(
      property.ownershipByPlayerPpm,
    );
    const recurring = captureRecurringBasis(state.finance.recurringByPlayer);
    expect(recurring[ids[0]!]).toEqual(
      state.finance.recurringByPlayer[ids[0]!],
    );
    expect(recurring[ids[0]!]).not.toBe(
      state.finance.recurringByPlayer[ids[0]!],
    );
  });

  it("keeps four actual settlements and rejects a repeated observation", () => {
    let state = ready();
    const initial = structuredClone(state);
    for (let n = 0; n < 6; n++) state = settle(state).state;
    for (const id of ids)
      expect(
        state.progress.byPlayer[id]?.quarters.map((q) => q.quarter),
      ).toEqual([3, 4, 5, 6]);
    expect(initial.progress.byPlayer[ids[0]!]?.quarters).toEqual([]);
    expect(settleQuarter(state, { quarter: 6 })).toMatchObject({
      ok: false,
      code: "QUARTER_ALREADY_SETTLED",
      state,
    });
    expect(() =>
      recordQuarterObservations(state, state.finance.lastSettlement!, []),
    ).toThrow("already recorded");
  });

  it("records owed service after a miss, groups the borrower, and excludes principal and arrears-interest catch-up", () => {
    const borrower = ids[0]!,
      lender = ids[1]!;
    let state = settle(isolated()).state;
    const one = loan("loan-test-1", borrower, lender),
      two = loan("loan-test-2", borrower, lender);
    state = {
      ...state,
      finance: {
        ...state.finance,
        loansById: { [one.id]: one, [two.id]: two },
      },
    };
    const missed = settle(state);
    expect(
      missed.state.progress.byPlayer[borrower]?.quarters.at(-1),
    ).toMatchObject({ debtServiceOwedCents: 10_376, debtServicePaidCents: 0 });
    state = {
      ...missed.state,
      finance: {
        ...missed.state.finance,
        cashByPlayer: {
          ...missed.state.finance.cashByPlayer,
          [borrower]: cents(30_000),
        },
      },
    };
    const cured = settle(state);
    const paid = cured.settlementOutcome.loanPayments;
    expect(
      cured.state.progress.byPlayer[lender]?.financingInterestReceivedCents,
    ).toBe(1_000);
    expect(paid.reduce((sum, p) => sum + p.principalPaidCents, 0)).toBe(20_000);
    expect(paid.reduce((sum, p) => sum + p.interestPaidCents, 0)).toBe(1_000);
    expect(
      cured.state.progress.byPlayer[lender]?.quarters.at(-1)?.sourcesById,
    ).toEqual({
      [`borrower:${borrower}`]: {
        category: "financing",
        recurringReceivedCents: 500,
        debtServiceOwedCents: 0,
      },
    });
    expect(
      cured.state.progress.byPlayer[borrower]?.quarters.at(-1),
    ).toMatchObject({
      debtServiceOwedCents: 21_000,
      debtServicePaidCents: 21_000,
    });
  });

  it("updates basis and actual realized losses atomically on a real business close", () => {
    let state = ready();
    const opportunity = Object.values(state.opportunitiesById)[0]!;
    const buyer = opportunity.targetPlayerId,
      seller = opportunity.sellerPlayerId;
    const begun = applyPlayerCommand(state, ids[0]!, { type: "BEGIN_ROUND" });
    if (!begun.ok) throw new Error(begun.code);
    state = begun.state;
    while (
      state.playerOrder[
        (state.currentQuarter - 1 + state.round!.spotlightsCompleted) % 4
      ] !== buyer
    ) {
      const actor =
        state.playerOrder[
          (state.currentQuarter - 1 + state.round!.spotlightsCompleted) % 4
        ]!;
      const pass = applyPlayerCommand(state, actor, { type: "PASS_SPOTLIGHT" });
      if (!pass.ok) throw new Error(pass.code);
      state = pass.state;
    }
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyer]: cents(10_000_000),
        },
      },
    };
    const before = structuredClone(state);
    const open = openCashBusinessPurchaseTransaction(state, {
      buyerPlayerId: buyer,
      sellerPlayerId: seller,
      assetId: opportunity.assetId,
      purchasePriceCents: opportunity.askingPriceCents,
    });
    if (!open.ok) throw new Error(open.code);
    const closed = closeCashBusinessPurchaseTransaction(
      open.state,
      open.transactionId!,
    );
    if (!closed.ok) throw new Error(closed.code);
    expect(closed.state.progress.byPlayer[seller]?.realizedGainsCents).toBe(
      -1_000_000,
    );
    expect(closed.state.progress.byPlayer[seller]?.disposals).toEqual([
      {
        assetId: opportunity.assetId,
        category: "business",
        counterpartyPlayerId: buyer,
        acquiredQuarter: 0,
        soldQuarter: 1,
        proceedsCents: 5_000_000,
        costCents: 6_000_000,
        referenceEquityCents: 6_000_000,
      },
    ]);
    expect(
      closed.state.progress.byPlayer[seller]?.assetsById[opportunity.assetId],
    ).toBeUndefined();
    expect(
      closed.state.progress.byPlayer[buyer]?.assetsById[opportunity.assetId],
    ).toEqual({
      costCents: 5_000_000,
      acquiredQuarter: 1,
      ownershipPpm: 1_000_000,
    });
    expect(
      closed.state.progress.byPlayer[seller]?.profitableDisposalAssetIds,
    ).toEqual([]);
    expect(state).toEqual(before);
  });

  it("keeps recovered work pay separate from current recurring work and passive sources", () => {
    let state = ready();
    const original = Object.values(state.finance.assetsById).find(
      (asset) => asset.kind === "business" && asset.workCompensation,
    );
    if (original?.kind !== "business" || !original.workCompensation)
      throw new Error("Missing working company");
    const owner = original.workCompensation.playerId;
    const quarterlyWork = original.workCompensation.annualCompensationCents / 4;
    const impaired = {
      ...original,
      cashCents: cents(0),
      annualOperatingProfitCents: cents(
        -original.workCompensation.annualCompensationCents,
      ),
    };
    const impairedAssets = {
      ...state.finance.assetsById,
      [original.id]: impaired,
    };
    state = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: impairedAssets,
        quarterStartBasis: {
          ...state.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(impairedAssets),
        },
      },
    };
    const missed = settle(state).state;
    expect(missed.progress.byPlayer[owner]?.quarters.at(-1)).toMatchObject({
      workIncomeCents: 0,
      recurringWorkIncomeCents: 0,
    });
    const company = missed.finance.assetsById[original.id];
    if (company?.kind !== "business") throw new Error("Missing company");
    const restored = {
      ...company,
      cashCents: cents(100_000_000),
      annualOperatingProfitCents: original.annualOperatingProfitCents,
    };
    const restoredAssets = {
      ...missed.finance.assetsById,
      [original.id]: restored,
    };
    state = {
      ...missed,
      finance: {
        ...missed.finance,
        assetsById: restoredAssets,
        quarterStartBasis: {
          ...missed.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(restoredAssets),
        },
      },
    };
    const cured = settle(state).state;
    const observation = cured.progress.byPlayer[owner]?.quarters.at(-1);
    if (!observation) throw new Error("Missing settlement observation");
    expect(observation.workIncomeCents).toBe(quarterlyWork * 2);
    expect(observation.recurringWorkIncomeCents).toBe(quarterlyWork);
    expect(
      Object.values(observation.sourcesById).every(
        (source) => source.category !== ("work" as string),
      ),
    ).toBe(true);
    expect(observation.companyOperatingProfitById[original.id]).toBe(
      original.annualOperatingProfitCents / 4,
    );
  });

  it("rejects gain overflow without mutating either party's acquisition evidence", () => {
    const state = ready();
    const opportunity = Object.values(state.opportunitiesById)[0]!;
    const buyer = opportunity.targetPlayerId,
      seller = opportunity.sellerPlayerId;
    const progress = {
      byPlayer: {
        ...state.progress.byPlayer,
        [seller]: {
          ...state.progress.byPlayer[seller]!,
          realizedGainsCents: cents(Number.MAX_SAFE_INTEGER),
        },
      },
    };
    const before = structuredClone(progress);
    const asset = {
      ...state.finance.assetsById[opportunity.assetId]!,
      ownershipByPlayerPpm: { [buyer]: 1_000_000 },
    } as BusinessAsset;
    expect(() =>
      recordBusinessPurchaseBasis(
        progress,
        seller,
        buyer,
        asset,
        cents(6_000_001),
        1,
      ),
    ).toThrow(RangeError);
    expect(progress).toEqual(before);
  });

  it("does not invent a zero cost when acquisition evidence is missing", () => {
    const state = ready();
    const opportunity = Object.values(state.opportunitiesById)[0]!;
    const buyer = opportunity.targetPlayerId,
      seller = opportunity.sellerPlayerId;
    const progress = {
      byPlayer: {
        ...state.progress.byPlayer,
        [seller]: { ...state.progress.byPlayer[seller]!, assetsById: {} },
      },
    };
    const asset = {
      ...state.finance.assetsById[opportunity.assetId]!,
      ownershipByPlayerPpm: { [buyer]: 1_000_000 },
    } as BusinessAsset;
    expect(() =>
      recordBusinessPurchaseBasis(
        progress,
        seller,
        buyer,
        asset,
        cents(5_000_000),
        1,
      ),
    ).toThrow("Missing acquisition basis");
  });
});
