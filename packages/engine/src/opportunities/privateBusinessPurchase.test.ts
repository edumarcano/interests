import { asAssetId, asOpportunityId, asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { captureBusinessBasis } from "../finance/businessSettlement";
import { cents } from "../finance/money";
import {
  createSoleOwnership,
  ownershipPpm,
  TOTAL_OWNERSHIP_PPM,
} from "../finance/ownership";
import { createProgress } from "../finance/progress";
import { settleQuarter } from "../finance/settlement";
import { applyAction } from "../game/actions";
import { createGame } from "../game/createGame";
import { beginRound } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import {
  closeCashBusinessPurchaseTransaction,
  openCashBusinessPurchaseTransaction,
} from "../transactions/cashBusinessPurchase";
import {
  getAvailableCashCents,
  getReservedCashCents,
} from "../transactions/reservations";
import {
  createPrivateBusinessPurchaseOpportunity,
  investigatePrivateBusinessPurchaseOpportunity,
  pursuePrivateBusinessPurchaseOpportunity,
} from "./privateBusinessPurchase";
import { getOpportunityView } from "./view";

const buyerId = asPlayerId("test-buyer");
const sellerId = asPlayerId("test-seller");
const otherPlayer3 = asPlayerId("test-player-3");
const otherPlayer4 = asPlayerId("test-player-4");
const testPlayerIds = [buyerId, sellerId, otherPlayer3, otherPlayer4] as const;

/**
 * Creates a ready-for-first-round standard game state with test players.
 */
function createReadyGame(): GameState {
  let state = createGame({
    gameId: "opportunity-test-game",
    seed: "opportunity-test-seed",
    playerIds: testPlayerIds,
  });

  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (player === undefined) {
      throw new Error(`Missing player ${playerId}`);
    }
    const objectiveId = player.offeredObjectiveIds[0];
    if (objectiveId === undefined) {
      throw new Error(`Missing objective for player ${playerId}`);
    }
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId,
      objectiveId,
    });
    if (!result.ok) {
      throw new Error(`Failed to choose objective: ${result.code}`);
    }
    state = result.state;
  }

  const roundResult = beginRound(state);
  if (!roundResult.ok) {
    throw new Error(`Failed to begin round: ${roundResult.code}`);
  }
  return roundResult.state;
}

/**
 * Creates the exact fixture defined in TASK.md Section 27:
 * Buyer cash: 10_000_000 cents ($100,000)
 * Seller cash: 2_500_000 cents ($25,000)
 * Business:
 *   annual revenue: 5_000_000 cents
 *   annual operating profit: 1_000_000 cents
 *   enterprise value: 10_000_000 cents ($100,000)
 *   debt principal: 0 cents (debt-free)
 *   seller ownership: 1_000_000 PPM (100% sole owner)
 */
function createOpportunityFixture(): {
  readonly state: GameState;
  readonly businessAssetId: ReturnType<typeof asAssetId>;
} {
  const base = createReadyGame();
  const businessAssetId = asAssetId("asset-biz-fixture-1");

  const testBusiness: BusinessAsset = {
    id: businessAssetId,
    kind: "business",
    cashPolicyId: "retained-profit-v1",
    cashCents: cents(0),
    operatingArrearsCents: cents(0),
    enterpriseValueCents: cents(10_000_000),
    debtPrincipalCents: cents(0),
    annualRevenueCents: cents(5_000_000),
    annualOperatingProfitCents: cents(1_000_000),
    ownershipByPlayerPpm: createSoleOwnership(sellerId),
  };

  let state: GameState = {
    ...base,
    opportunitiesById: {},
    counters: {
      ...base.counters,
      opportunity: 0,
    },
    finance: {
      ...base.finance,
      cashByPlayer: {
        ...base.finance.cashByPlayer,
        [buyerId]: cents(10_000_000),
        [sellerId]: cents(2_500_000),
      },
      quarterStartBasis: {
        ...base.finance.quarterStartBasis,
        businessesById: {
          ...base.finance.quarterStartBasis.businessesById,
          ...captureBusinessBasis({ [businessAssetId]: testBusiness }),
        },
      },
      assetsById: {
        ...base.finance.assetsById,
        [businessAssetId]: testBusiness,
      },
    },
  };

  state = {
    ...state,
    progress: createProgress(state.finance, state.playerOrder),
  };
  assertGameState(state);
  return { state, businessAssetId };
}

describe("first private business-purchase opportunity lifecycle", () => {
  it("executes the full end-to-end lifecycle (discover -> view -> investigate -> pursue -> close) with exact financial correctness (TASK.md Section 27)", () => {
    const { state: initial, businessAssetId } = createOpportunityFixture();
    const askingPriceCents = 6_000_000; // $60,000

    const initialRevision = initial.revision;
    const initialCounters = { ...initial.counters };
    const initialRandom = { ...initial.random };

    // 1. DISCOVER
    const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
      targetPlayerId: buyerId,
      sellerPlayerId: sellerId,
      assetId: businessAssetId,
      askingPriceCents,
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const discoveredState = createResult.state;
    const opportunityId = createResult.opportunityId;

    expect(opportunityId).toBe("opportunity-1");
    expect(discoveredState.revision).toBe(initialRevision + 1);
    expect(discoveredState.counters.opportunity).toBe(
      initialCounters.opportunity + 1,
    );
    expect(discoveredState.counters.transaction).toBe(
      initialCounters.transaction,
    );
    expect(discoveredState.counters.journal).toBe(initialCounters.journal);
    expect(discoveredState.random).toEqual(initialRandom);
    expect(discoveredState.activeTransaction).toBeNull();
    expect(discoveredState.finance.cashByPlayer[buyerId]).toBe(10_000_000);
    expect(getReservedCashCents(discoveredState, buyerId)).toBe(0);
    expect(getAvailableCashCents(discoveredState, buyerId)).toBe(10_000_000);

    const opportunity = discoveredState.opportunitiesById[opportunityId];
    expect(opportunity).toBeDefined();
    if (opportunity === undefined) return;
    expect(opportunity.id).toBe("opportunity-1");
    expect(opportunity.kind).toBe("private-business-purchase");
    expect(opportunity.access).toBe("private");
    expect(opportunity.targetPlayerId).toBe(buyerId);
    expect(opportunity.sellerPlayerId).toBe(sellerId);
    expect(opportunity.assetId).toBe(businessAssetId);
    expect(opportunity.askingPriceCents).toBe(6_000_000);
    expect(opportunity.createdQuarter).toBe(discoveredState.currentQuarter);
    expect(opportunity.status).toBe("available");
    expect(opportunity.investigation.investigated).toBe(false);
    expect(opportunity.investigation.facts).toEqual({
      annualRevenueCents: 5_000_000,
      annualOperatingProfitCents: 1_000_000,
      enterpriseValueCents: 10_000_000,
      debtPrincipalCents: 0,
    });
    expect(opportunity.relatedTransactionId).toBeUndefined();

    // 2. INITIAL VIEW (target player perspective before investigation)
    const initialViewResult = getOpportunityView(
      discoveredState,
      opportunityId,
      buyerId,
    );
    expect(initialViewResult.ok).toBe(true);
    if (!initialViewResult.ok) return;

    const initialView = initialViewResult.view;
    expect(initialView.id).toBe(opportunityId);
    expect(initialView.kind).toBe("private-business-purchase");
    expect(initialView.access).toBe("private");
    expect(initialView.targetPlayerId).toBe(buyerId);
    expect(initialView.sellerPlayerId).toBe(sellerId);
    expect(initialView.assetId).toBe(businessAssetId);
    expect(initialView.askingPriceCents).toBe(6_000_000);
    expect(initialView.createdQuarter).toBe(discoveredState.currentQuarter);
    expect(initialView.status).toBe("available");
    expect(initialView.investigated).toBe(false);
    expect(initialView.facts).toBeNull(); // Due-diligence facts hidden before investigation!

    // 3. INVESTIGATE
    const investigateResult = investigatePrivateBusinessPurchaseOpportunity(
      discoveredState,
      opportunityId,
      buyerId,
    );
    expect(investigateResult.ok).toBe(true);
    if (!investigateResult.ok) return;

    const investigatedState = investigateResult.state;
    expect(investigatedState.revision).toBe(discoveredState.revision + 1);
    expect(investigatedState.counters).toEqual(discoveredState.counters); // 0 IDs consumed
    expect(investigatedState.random).toEqual(initialRandom); // 0 RNG consumed
    expect(investigatedState.finance.cashByPlayer).toEqual(
      discoveredState.finance.cashByPlayer,
    ); // 0 cash moved
    expect(investigatedState.finance.assetsById).toEqual(
      discoveredState.finance.assetsById,
    ); // 0 ownership changed
    expect(investigatedState.activeTransaction).toBeNull();

    const investigatedOp = investigatedState.opportunitiesById[opportunityId];
    expect(investigatedOp).toBeDefined();
    if (investigatedOp === undefined) return;
    expect(investigatedOp.investigation.investigated).toBe(true);

    // View after investigation reveals exact stored snapshot
    const investigatedViewResult = getOpportunityView(
      investigatedState,
      opportunityId,
      buyerId,
    );
    expect(investigatedViewResult.ok).toBe(true);
    if (!investigatedViewResult.ok) return;

    const investigatedView = investigatedViewResult.view;
    expect(investigatedView.investigated).toBe(true);
    expect(investigatedView.facts).toEqual({
      annualRevenueCents: 5_000_000,
      annualOperatingProfitCents: 1_000_000,
      enterpriseValueCents: 10_000_000,
      debtPrincipalCents: 0,
    });

    // 4. PURSUE (delegates to PR #13 transaction kernel)
    const pursueResult = pursuePrivateBusinessPurchaseOpportunity(
      investigatedState,
      opportunityId,
      buyerId,
    );
    expect(pursueResult.ok).toBe(true);
    if (!pursueResult.ok) return;

    const pursuedState = pursueResult.state;
    const transactionId = pursueResult.transactionId;

    expect(transactionId).toBe("transaction-1");
    // Crucial: pursuit + opportunity status update is ONE atomic transition!
    expect(pursuedState.revision).toBe(investigatedState.revision + 1);
    expect(pursuedState.counters.transaction).toBe(
      initialCounters.transaction + 1,
    );
    expect(pursuedState.counters.opportunity).toBe(
      discoveredState.counters.opportunity,
    );
    expect(pursuedState.counters.journal).toBe(initialCounters.journal);
    expect(pursuedState.random).toEqual(initialRandom);

    const pursuedOp = pursuedState.opportunitiesById[opportunityId];
    expect(pursuedOp).toBeDefined();
    if (pursuedOp === undefined) return;
    expect(pursuedOp.status).toBe("pursued");
    expect(pursuedOp.relatedTransactionId).toBe("transaction-1");

    expect(pursuedState.activeTransaction).not.toBeNull();
    expect(pursuedState.activeTransaction?.id).toBe("transaction-1");
    expect(pursuedState.activeTransaction?.buyerPlayerId).toBe(buyerId);
    expect(pursuedState.activeTransaction?.sellerPlayerId).toBe(sellerId);
    expect(pursuedState.activeTransaction?.purchasePriceCents).toBe(6_000_000);

    // Cash verification: actual cash unchanged, reserved cash increased, available cash decreased
    expect(pursuedState.finance.cashByPlayer[buyerId]).toBe(10_000_000);
    expect(getReservedCashCents(pursuedState, buyerId)).toBe(6_000_000);
    expect(getAvailableCashCents(pursuedState, buyerId)).toBe(4_000_000);
    expect(pursuedState.finance.cashByPlayer[sellerId]).toBe(2_500_000);

    // 5. CLOSE (using PR #13 closing operation)
    const closeResult = closeCashBusinessPurchaseTransaction(
      pursuedState,
      transactionId,
    );
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

    const finalState = closeResult.state;
    expect(finalState.revision).toBe(pursuedState.revision + 1);
    expect(finalState.activeTransaction).toBeNull();

    // Final cash
    expect(finalState.finance.cashByPlayer[buyerId]).toBe(4_000_000);
    expect(finalState.finance.cashByPlayer[sellerId]).toBe(8_500_000);
    expect(getReservedCashCents(finalState, buyerId)).toBe(0);
    expect(getAvailableCashCents(finalState, buyerId)).toBe(4_000_000);

    // Final ownership
    const finalAsset = finalState.finance.assetsById[
      businessAssetId
    ] as BusinessAsset;
    expect(finalAsset.ownershipByPlayerPpm).toEqual({
      [buyerId]: TOTAL_OWNERSHIP_PPM,
    });
    expect(finalAsset.ownershipByPlayerPpm[sellerId]).toBeUndefined();

    // Journal entries
    expect(closeResult.journalEntries).toHaveLength(1);
    const entry = closeResult.journalEntries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.amountCents).toBe(6_000_000);
    expect(entry.reason).toBe("business-purchase");
    expect(entry.relatedAssetId).toBe(businessAssetId);
    expect(entry.relatedTransactionId).toBe("transaction-1");

    // Opportunity remains historically preserved
    const finalOp = finalState.opportunitiesById[opportunityId];
    expect(finalOp).toBeDefined();
    if (finalOp === undefined) return;
    expect(finalOp.status).toBe("pursued");
    expect(finalOp.relatedTransactionId).toBe("transaction-1");
    expect(finalOp.sellerPlayerId).toBe(sellerId);
    expect(finalOp.investigation.facts.enterpriseValueCents).toBe(10_000_000);

    // Invariants pass on the historical state even after seller no longer owns the business
    expect(() => assertGameState(finalState)).not.toThrow();
  });

  describe("privacy and unauthorized view regressions (TASK.md Section 28)", () => {
    it("allows target buyer to see initial opportunity view, hides from seller and unrelated players", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const state = createResult.state;
      const opportunityId = createResult.opportunityId;

      // Target buyer can view
      const buyerView = getOpportunityView(state, opportunityId, buyerId);
      expect(buyerView.ok).toBe(true);

      // Seller cannot retrieve private opportunity view
      const sellerView = getOpportunityView(state, opportunityId, sellerId);
      expect(sellerView.ok).toBe(false);
      if (!sellerView.ok) {
        expect(sellerView.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }

      // Unrelated players cannot retrieve private opportunity view
      const p3View = getOpportunityView(state, opportunityId, otherPlayer3);
      expect(p3View.ok).toBe(false);
      if (!p3View.ok) {
        expect(p3View.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }

      const p4View = getOpportunityView(state, opportunityId, otherPlayer4);
      expect(p4View.ok).toBe(false);
      if (!p4View.ok) {
        expect(p4View.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }

      // Unknown opportunity returns NOT_FOUND_OR_NOT_VISIBLE
      const unknownView = getOpportunityView(
        state,
        asOpportunityId("opportunity-999"),
        buyerId,
      );
      expect(unknownView.ok).toBe(false);
      if (!unknownView.ok) {
        expect(unknownView.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }
    });

    it("unauthorized players still cannot retrieve facts after target player investigates", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const investigateResult = investigatePrivateBusinessPurchaseOpportunity(
        createResult.state,
        createResult.opportunityId,
        buyerId,
      );
      expect(investigateResult.ok).toBe(true);
      if (!investigateResult.ok) return;

      const state = investigateResult.state;
      const opId = createResult.opportunityId;

      // Seller and other players still get NOT_FOUND_OR_NOT_VISIBLE
      expect(getOpportunityView(state, opId, sellerId)).toEqual({
        ok: false,
        code: "NOT_FOUND_OR_NOT_VISIBLE",
      });
      expect(getOpportunityView(state, opId, otherPlayer3)).toEqual({
        ok: false,
        code: "NOT_FOUND_OR_NOT_VISIBLE",
      });
    });
  });

  describe("unauthorized mutation regressions (TASK.md Section 29)", () => {
    it("rejects investigation attempts by non-target players atomically with no revision/counter/RNG changes", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const state = createResult.state;
      const opId = createResult.opportunityId;

      // Seller attempts to investigate
      const sellerAttempt = investigatePrivateBusinessPurchaseOpportunity(
        state,
        opId,
        sellerId,
      );
      expect(sellerAttempt.ok).toBe(false);
      if (!sellerAttempt.ok) {
        expect(sellerAttempt.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }
      expect(sellerAttempt.state).toBe(state); // Identical state reference

      // Third party attempts to investigate
      const thirdPartyAttempt = investigatePrivateBusinessPurchaseOpportunity(
        state,
        opId,
        otherPlayer3,
      );
      expect(thirdPartyAttempt.ok).toBe(false);
      if (!thirdPartyAttempt.ok) {
        expect(thirdPartyAttempt.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }
      expect(thirdPartyAttempt.state).toBe(state);

      // Investigation of unknown opportunity returns exact same non-disclosing error
      const unknownAttempt = investigatePrivateBusinessPurchaseOpportunity(
        state,
        asOpportunityId("opportunity-999"),
        buyerId,
      );
      expect(unknownAttempt.ok).toBe(false);
      if (!unknownAttempt.ok) {
        expect(unknownAttempt.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }
      expect(unknownAttempt.state).toBe(state);
    });

    it("rejects pursuit attempts by non-target players atomically with no revision/counter/RNG changes", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const state = createResult.state;
      const opId = createResult.opportunityId;

      const sellerAttempt = pursuePrivateBusinessPurchaseOpportunity(
        state,
        opId,
        sellerId,
      );
      expect(sellerAttempt.ok).toBe(false);
      if (!sellerAttempt.ok) {
        expect(sellerAttempt.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }
      expect(sellerAttempt.state).toBe(state);

      const thirdPartyAttempt = pursuePrivateBusinessPurchaseOpportunity(
        state,
        opId,
        otherPlayer3,
      );
      expect(thirdPartyAttempt.ok).toBe(false);
      if (!thirdPartyAttempt.ok) {
        expect(thirdPartyAttempt.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }
      expect(thirdPartyAttempt.state).toBe(state);

      // Pursuit of unknown opportunity returns exact same non-disclosing error
      const unknownAttempt = pursuePrivateBusinessPurchaseOpportunity(
        state,
        asOpportunityId("opportunity-999"),
        buyerId,
      );
      expect(unknownAttempt.ok).toBe(false);
      if (!unknownAttempt.ok) {
        expect(unknownAttempt.code).toBe("NOT_FOUND_OR_NOT_VISIBLE");
      }
      expect(unknownAttempt.state).toBe(state);
    });
  });

  describe("pregenerated due-diligence facts regression (TASK.md Section 15)", () => {
    it("proves investigation reveals the original pregenerated snapshot even if underlying business changes", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const stateWithOp = createResult.state;
      const opId = createResult.opportunityId;

      // Modify the underlying business in a valid test state (e.g. profits and EV change)
      const currentAsset = stateWithOp.finance.assetsById[
        businessAssetId
      ] as BusinessAsset;
      const mutatedAsset: BusinessAsset = {
        ...currentAsset,
        annualRevenueCents: cents(20_000_000),
        annualOperatingProfitCents: cents(8_000_000),
        enterpriseValueCents: cents(40_000_000),
      };

      const mutatedState: GameState = {
        ...stateWithOp,
        finance: {
          ...stateWithOp.finance,
          assetsById: {
            ...stateWithOp.finance.assetsById,
            [businessAssetId]: mutatedAsset,
          },
        },
      };
      assertGameState(mutatedState);

      const initialRandom = { ...mutatedState.random };

      // Investigate on mutatedState
      const investigateResult = investigatePrivateBusinessPurchaseOpportunity(
        mutatedState,
        opId,
        buyerId,
      );
      expect(investigateResult.ok).toBe(true);
      if (!investigateResult.ok) return;

      const investigatedState = investigateResult.state;
      expect(investigatedState.random).toEqual(initialRandom); // No RNG changed

      const viewResult = getOpportunityView(investigatedState, opId, buyerId);
      expect(viewResult.ok).toBe(true);
      if (!viewResult.ok) return;

      // Stored facts must match the ORIGINAL snapshot, not the mutated asset values!
      expect(viewResult.view.facts).toEqual({
        annualRevenueCents: 5_000_000,
        annualOperatingProfitCents: 1_000_000,
        enterpriseValueCents: 10_000_000,
        debtPrincipalCents: 0,
      });
    });
  });

  describe("optional investigation and repetition (TASK.md Section 16, 17, 22)", () => {
    it("allows an uninvestigated opportunity to be pursued directly (optional investigation)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const uninvestigatedState = createResult.state;
      const opId = createResult.opportunityId;

      expect(
        uninvestigatedState.opportunitiesById[opId]?.investigation.investigated,
      ).toBe(false);

      // Pursue without investigating
      const pursueResult = pursuePrivateBusinessPurchaseOpportunity(
        uninvestigatedState,
        opId,
        buyerId,
      );
      expect(pursueResult.ok).toBe(true);
      if (!pursueResult.ok) return;

      expect(pursueResult.state.opportunitiesById[opId]?.status).toBe(
        "pursued",
      );
      expect(
        pursueResult.state.opportunitiesById[opId]?.investigation.investigated,
      ).toBe(false);
      expect(pursueResult.transactionId).toBe("transaction-1");
    });

    it("rejects a second investigation attempt with ALREADY_INVESTIGATED atomically", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const inv1 = investigatePrivateBusinessPurchaseOpportunity(
        createResult.state,
        createResult.opportunityId,
        buyerId,
      );
      expect(inv1.ok).toBe(true);
      if (!inv1.ok) return;

      const stateAfterInv1 = inv1.state;
      const initialCounters = { ...stateAfterInv1.counters };
      const initialRevision = stateAfterInv1.revision;
      const initialRandom = { ...stateAfterInv1.random };

      const inv2 = investigatePrivateBusinessPurchaseOpportunity(
        stateAfterInv1,
        createResult.opportunityId,
        buyerId,
      );
      expect(inv2.ok).toBe(false);
      if (!inv2.ok) {
        expect(inv2.code).toBe("ALREADY_INVESTIGATED");
      }
      expect(inv2.state).toBe(stateAfterInv1);
      expect(inv2.state.revision).toBe(initialRevision);
      expect(inv2.state.counters).toEqual(initialCounters);
      expect(inv2.state.random).toEqual(initialRandom);
    });

    it("rejects investigation on an already-pursued opportunity with OPPORTUNITY_NOT_AVAILABLE", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const pursueResult = pursuePrivateBusinessPurchaseOpportunity(
        createResult.state,
        createResult.opportunityId,
        buyerId,
      );
      expect(pursueResult.ok).toBe(true);
      if (!pursueResult.ok) return;

      const invAttempt = investigatePrivateBusinessPurchaseOpportunity(
        pursueResult.state,
        createResult.opportunityId,
        buyerId,
      );
      expect(invAttempt.ok).toBe(false);
      if (!invAttempt.ok) {
        expect(invAttempt.code).toBe("OPPORTUNITY_NOT_AVAILABLE");
      }
      expect(invAttempt.state).toBe(pursueResult.state);
    });

    it("rejects pursuing an already-pursued opportunity (one-shot pursuit in PR #14)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const pursue1 = pursuePrivateBusinessPurchaseOpportunity(
        createResult.state,
        createResult.opportunityId,
        buyerId,
      );
      expect(pursue1.ok).toBe(true);
      if (!pursue1.ok) return;

      const pursue2 = pursuePrivateBusinessPurchaseOpportunity(
        pursue1.state,
        createResult.opportunityId,
        buyerId,
      );
      expect(pursue2.ok).toBe(false);
      if (!pursue2.ok) {
        expect(pursue2.code).toBe("OPPORTUNITY_NOT_AVAILABLE");
      }
      expect(pursue2.state).toBe(pursue1.state);
    });
  });

  describe("transaction kernel failure delegation regressions (TASK.md Section 30, 31, 32)", () => {
    it("handles stale opportunity when seller ownership changes after creation: pursuit fails via transaction kernel, opportunity remains available (Section 30)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const opId = createResult.opportunityId;
      const stateWithOp = createResult.state;

      // Ownership changed: seller now only owns 50%, third party owns 50%
      const currentAsset = stateWithOp.finance.assetsById[
        businessAssetId
      ] as BusinessAsset;
      const alteredAsset: BusinessAsset = {
        ...currentAsset,
        ownershipByPlayerPpm: {
          [sellerId]: ownershipPpm(500_000),
          [otherPlayer3]: ownershipPpm(500_000),
        },
      };

      let alteredState: GameState = {
        ...stateWithOp,
        finance: {
          ...stateWithOp.finance,
          assetsById: {
            ...stateWithOp.finance.assetsById,
            [businessAssetId]: alteredAsset,
          },
        },
      };
      alteredState = {
        ...alteredState,
        progress: createProgress(
          alteredState.finance,
          alteredState.playerOrder,
        ),
      };
      assertGameState(alteredState);

      // Attempt pursuit
      const pursueResult = pursuePrivateBusinessPurchaseOpportunity(
        alteredState,
        opId,
        buyerId,
      );
      expect(pursueResult.ok).toBe(false);
      if (!pursueResult.ok) {
        expect(pursueResult.code).toBe("TRANSACTION_REJECTED");
        if (pursueResult.code === "TRANSACTION_REJECTED") {
          expect(pursueResult.transactionCode).toBe("SELLER_NOT_SOLE_OWNER");
        }
      }

      // Opportunity remains available and state is completely unchanged
      expect(pursueResult.state).toBe(alteredState);
      expect(pursueResult.state.opportunitiesById[opId]?.status).toBe(
        "available",
      );
      expect(pursueResult.state.activeTransaction).toBeNull();
      expect(pursueResult.state.counters.transaction).toBe(
        initial.counters.transaction,
      );
    });

    it("handles insufficient cash at pursuit: creation succeeds, pursuit fails via transaction kernel, opportunity remains available (Section 31)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();

      // Set buyer cash to only $100.00 (10,000 cents) vs asking price $60,000.00 (6,000,000 cents)
      const brokeBuyerState: GameState = {
        ...initial,
        finance: {
          ...initial.finance,
          cashByPlayer: {
            ...initial.finance.cashByPlayer,
            [buyerId]: cents(10_000),
          },
        },
      };
      assertGameState(brokeBuyerState);

      // Discovery succeeds! Affordability is NOT a precondition for discovery.
      const createResult = createPrivateBusinessPurchaseOpportunity(
        brokeBuyerState,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: businessAssetId,
          askingPriceCents: 6_000_000,
        },
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const stateWithOp = createResult.state;
      const opId = createResult.opportunityId;

      // Pursuit fails with INSUFFICIENT_AVAILABLE_CASH
      const pursueResult = pursuePrivateBusinessPurchaseOpportunity(
        stateWithOp,
        opId,
        buyerId,
      );
      expect(pursueResult.ok).toBe(false);
      if (!pursueResult.ok) {
        expect(pursueResult.code).toBe("TRANSACTION_REJECTED");
        if (pursueResult.code === "TRANSACTION_REJECTED") {
          expect(pursueResult.transactionCode).toBe(
            "INSUFFICIENT_AVAILABLE_CASH",
          );
        }
      }

      // Opportunity remains available and no transaction ID is consumed
      expect(pursueResult.state).toBe(stateWithOp);
      expect(pursueResult.state.opportunitiesById[opId]?.status).toBe(
        "available",
      );
      expect(pursueResult.state.activeTransaction).toBeNull();
      expect(pursueResult.state.counters.transaction).toBe(
        brokeBuyerState.counters.transaction,
      );
    });

    it("handles active-transaction collision: pursuit rejects via PR #13, opportunity stays available (Section 32)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();

      // Create a second business owned by player 3
      const secondBizId = asAssetId("asset-second-biz");
      const secondBiz: BusinessAsset = {
        id: secondBizId,
        kind: "business",
        cashPolicyId: "retained-profit-v1",
        cashCents: cents(0),
        operatingArrearsCents: cents(0),
        enterpriseValueCents: cents(2_000_000),
        debtPrincipalCents: cents(0),
        annualRevenueCents: cents(1_000_000),
        annualOperatingProfitCents: cents(200_000),
        ownershipByPlayerPpm: createSoleOwnership(otherPlayer3),
      };

      let stateWithTwoBiz: GameState = {
        ...initial,
        finance: {
          ...initial.finance,
          quarterStartBasis: {
            ...initial.finance.quarterStartBasis,
            businessesById: {
              ...initial.finance.quarterStartBasis.businessesById,
              ...captureBusinessBasis({ [secondBizId]: secondBiz }),
            },
          },
          assetsById: {
            ...initial.finance.assetsById,
            [secondBizId]: secondBiz,
          },
        },
      };
      stateWithTwoBiz = {
        ...stateWithTwoBiz,
        progress: createProgress(
          stateWithTwoBiz.finance,
          stateWithTwoBiz.playerOrder,
        ),
      };
      assertGameState(stateWithTwoBiz);

      // Create opportunity for first business
      const createResult = createPrivateBusinessPurchaseOpportunity(
        stateWithTwoBiz,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: businessAssetId,
          askingPriceCents: 6_000_000,
        },
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const stateWithOp = createResult.state;
      const opId = createResult.opportunityId;

      // Open a separate active transaction on the second business
      const txResult = openCashBusinessPurchaseTransaction(stateWithOp, {
        buyerPlayerId: buyerId,
        sellerPlayerId: otherPlayer3,
        assetId: secondBizId,
        purchasePriceCents: 1_000_000,
      });
      expect(txResult.ok).toBe(true);
      if (!txResult.ok) return;

      const busyState = txResult.state;
      expect(busyState.activeTransaction).not.toBeNull();

      // Attempt to pursue the opportunity while active transaction exists
      const pursueResult = pursuePrivateBusinessPurchaseOpportunity(
        busyState,
        opId,
        buyerId,
      );
      expect(pursueResult.ok).toBe(false);
      if (!pursueResult.ok) {
        expect(pursueResult.code).toBe("TRANSACTION_REJECTED");
        if (pursueResult.code === "TRANSACTION_REJECTED") {
          expect(pursueResult.transactionCode).toBe(
            "ACTIVE_TRANSACTION_EXISTS",
          );
        }
      }

      // Opportunity remains available
      expect(pursueResult.state).toBe(busyState);
      expect(pursueResult.state.opportunitiesById[opId]?.status).toBe(
        "available",
      );
      expect(pursueResult.state.counters.transaction).toBe(
        busyState.counters.transaction,
      );
    });
  });

  describe("creation validation and boundary regressions (TASK.md Section 5, 7, 33, 34)", () => {
    it("returns typed OPPORTUNITY_ID_EXHAUSTED without throwing when counter is at MAX_SAFE_INTEGER (Section 33)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();

      const exhaustedState: GameState = {
        ...initial,
        counters: {
          ...initial.counters,
          opportunity: Number.MAX_SAFE_INTEGER,
        },
      };

      const result = createPrivateBusinessPurchaseOpportunity(exhaustedState, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("OPPORTUNITY_ID_EXHAUSTED");
      }
      expect(result.state).toBe(exhaustedState); // Exact input identity preserved
    });

    it("produces deterministic, deeply equal results from identical initial state and input (Section 34)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const initialSnapshot = JSON.parse(JSON.stringify(initial));

      const input = {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      };

      // Call createPrivateBusinessPurchaseOpportunity twice from the exact same initial state object
      const res1 = createPrivateBusinessPurchaseOpportunity(initial, input);
      const res2 = createPrivateBusinessPurchaseOpportunity(initial, input);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      if (!res1.ok || !res2.ok) return;

      expect(res1.opportunityId).toBe("opportunity-1");
      expect(res2.opportunityId).toBe("opportunity-1");
      // Deep-compare complete results
      expect(res1).toEqual(res2);
      expect(res1.state).toEqual(res2.state);

      // Prove the original input state object was not mutated
      expect(initial).toEqual(initialSnapshot);
    });

    it("validates all creation preconditions", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();

      const expectCreateFailure = (
        stateToTest: GameState,
        input: Parameters<typeof createPrivateBusinessPurchaseOpportunity>[1],
        expectedCode: string,
      ) => {
        const res = createPrivateBusinessPurchaseOpportunity(
          stateToTest,
          input,
        );
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.code).toBe(expectedCode);
        }
      };

      // 1. Wrong phase
      const choosingPhaseState: GameState = {
        ...initial,
        phase: "objective-choosing",
      };
      expectCreateFailure(
        choosingPhaseState,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: businessAssetId,
          askingPriceCents: 6_000_000,
        },
        "WRONG_PHASE",
      );

      // 2. Unknown target player
      expectCreateFailure(
        initial,
        {
          targetPlayerId: asPlayerId("unknown-player"),
          sellerPlayerId: sellerId,
          assetId: businessAssetId,
          askingPriceCents: 6_000_000,
        },
        "UNKNOWN_PLAYER",
      );

      // 3. Unknown seller player
      expectCreateFailure(
        initial,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: asPlayerId("unknown-player"),
          assetId: businessAssetId,
          askingPriceCents: 6_000_000,
        },
        "UNKNOWN_PLAYER",
      );

      // 4. Same party
      expectCreateFailure(
        initial,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: buyerId,
          assetId: businessAssetId,
          askingPriceCents: 6_000_000,
        },
        "SAME_PARTY",
      );

      // 5. Unknown asset
      expectCreateFailure(
        initial,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: asAssetId("unknown-asset"),
          askingPriceCents: 6_000_000,
        },
        "UNKNOWN_ASSET",
      );

      // 6. Unsupported asset (property asset instead of business)
      const propertyAssetId = asAssetId("prop-1");
      const stateWithProperty: GameState = {
        ...initial,
        finance: {
          ...initial.finance,
          assetsById: {
            ...initial.finance.assetsById,
            [propertyAssetId]: {
              id: propertyAssetId,
              kind: "property",
              marketValueCents: cents(5_000_000),
              scheduledQuarterlyRentCents: cents(100_000),
              occupancyBps: 10_000,
              operatingExpenseRatioBps: 3_000,
              ownershipByPlayerPpm: createSoleOwnership(sellerId),
            },
          },
        },
      };
      expectCreateFailure(
        stateWithProperty,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: propertyAssetId,
          askingPriceCents: 6_000_000,
        },
        "UNSUPPORTED_ASSET",
      );

      // 7. Encumbered asset (business with debt)
      const encumberedBizId = asAssetId("biz-encumbered");
      const stateWithEncumbered: GameState = {
        ...initial,
        finance: {
          ...initial.finance,
          assetsById: {
            ...initial.finance.assetsById,
            [encumberedBizId]: {
              id: encumberedBizId,
              kind: "business",
              cashPolicyId: "retained-profit-v1",
              cashCents: cents(0),
              operatingArrearsCents: cents(0),
              enterpriseValueCents: cents(10_000_000),
              debtPrincipalCents: cents(1_000_000), // Has debt!
              annualRevenueCents: cents(5_000_000),
              annualOperatingProfitCents: cents(1_000_000),
              ownershipByPlayerPpm: createSoleOwnership(sellerId),
            },
          },
        },
      };
      expectCreateFailure(
        stateWithEncumbered,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: encumberedBizId,
          askingPriceCents: 6_000_000,
        },
        "ENCUMBERED_ASSET",
      );

      // 8. Seller not sole owner
      const coOwnedBizId = asAssetId("biz-coowned");
      const stateWithCoOwned: GameState = {
        ...initial,
        finance: {
          ...initial.finance,
          assetsById: {
            ...initial.finance.assetsById,
            [coOwnedBizId]: {
              id: coOwnedBizId,
              kind: "business",
              cashPolicyId: "retained-profit-v1",
              cashCents: cents(0),
              operatingArrearsCents: cents(0),
              enterpriseValueCents: cents(10_000_000),
              debtPrincipalCents: cents(0),
              annualRevenueCents: cents(5_000_000),
              annualOperatingProfitCents: cents(1_000_000),
              ownershipByPlayerPpm: {
                [sellerId]: 750_000,
                [otherPlayer3]: 250_000,
              },
            },
          },
        },
      };
      expectCreateFailure(
        stateWithCoOwned,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: coOwnedBizId,
          askingPriceCents: 6_000_000,
        },
        "SELLER_NOT_SOLE_OWNER",
      );

      // 9. Invalid price
      expectCreateFailure(
        initial,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: businessAssetId,
          askingPriceCents: 0,
        },
        "INVALID_PRICE",
      );

      expectCreateFailure(
        initial,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: businessAssetId,
          askingPriceCents: -500,
        },
        "INVALID_PRICE",
      );

      expectCreateFailure(
        initial,
        {
          targetPlayerId: buyerId,
          sellerPlayerId: sellerId,
          assetId: businessAssetId,
          askingPriceCents: 1.5,
        },
        "INVALID_PRICE",
      );
    });
  });

  describe("settlement and serialization compatibility (TASK.md Section 26, 35)", () => {
    it("does not block quarter settlement when an available opportunity exists in state (Section 35)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const stateWithOp = createResult.state;
      expect(stateWithOp.currentQuarter).toBe(1);

      // Quarter settlement succeeds despite the presence of the available opportunity
      const settlementResult = settleQuarter(stateWithOp, { quarter: 1 });
      expect(settlementResult.ok).toBe(true);
      if (!settlementResult.ok) return;

      expect(settlementResult.state.currentQuarter).toBe(2);
      expect(settlementResult.state.lastSettledQuarter).toBe(1);
      expect(
        settlementResult.state.opportunitiesById[createResult.opportunityId],
      ).toBeDefined();
    });

    it("survives full JSON serialization with complete structural equality and invariants passing (Section 26)", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const originalState = createResult.state;
      const json = JSON.stringify(originalState);
      const parsedState: GameState = JSON.parse(json);

      expect(parsedState).toEqual(originalState);
      expect(() => assertGameState(parsedState)).not.toThrow();
    });

    it("rejects investigation with WRONG_PHASE when match is still in objective-choosing phase", () => {
      const { state: initial, businessAssetId } = createOpportunityFixture();
      const createResult = createPrivateBusinessPurchaseOpportunity(initial, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId: businessAssetId,
        askingPriceCents: 6_000_000,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const choosingState: GameState = {
        ...createResult.state,
        phase: "objective-choosing",
      };

      const investigateResult = investigatePrivateBusinessPurchaseOpportunity(
        choosingState,
        createResult.opportunityId,
        buyerId,
      );

      expect(investigateResult.ok).toBe(false);
      if (!investigateResult.ok) {
        expect(investigateResult.code).toBe("WRONG_PHASE");
      }
      expect(investigateResult.state.revision).toBe(choosingState.revision);
    });
  });
});
