import { asAssetId, asPlayerId, asTransactionId } from "@interests/shared";
import { describe, expect, it } from "vitest";

import { basisPoints, cents } from "../finance/money";
import {
  createSoleOwnership,
  ownershipPpm,
  TOTAL_OWNERSHIP_PPM,
} from "../finance/ownership";
import { settleQuarter } from "../finance/settlement";
import { applyAction } from "../game/actions";
import { createGame } from "../game/createGame";
import { assertGameState } from "../invariants/assertGameState";
import type {
  BusinessAsset,
  GameState,
  PropertyAsset,
} from "../model/gameState";
import {
  cancelActiveTransaction,
  closeCashBusinessPurchaseTransaction,
  openCashBusinessPurchaseTransaction,
} from "./cashBusinessPurchase";
import type { OpenCashBusinessPurchaseInput } from "./model";
import { getAvailableCashCents, getReservedCashCents } from "./reservations";

const p1 = asPlayerId("test-buyer");
const p2 = asPlayerId("test-seller");
const p3 = asPlayerId("test-player-3");
const p4 = asPlayerId("test-player-4");
const playerIds = [p1, p2, p3, p4] as const;

/**
 * Creates a ready-for-first-round standard game state with test players.
 */
function createReadyGame(): GameState {
  let state = createGame({
    gameId: "transaction-test-game",
    seed: "transaction-test-seed",
    playerIds,
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

  return state;
}

/**
 * Creates a test fixture with exact financial values specified in TASK.md:
 * - Buyer cash: $100,000.00 (10,000,000 cents)
 * - Seller cash: $25,000.00 (2,500,000 cents)
 * - Supported test business: debt-free, seller owns 100%, EV = $100,000.00
 */
function createTransactionFixture(): {
  readonly state: GameState;
  readonly businessAssetId: ReturnType<typeof asAssetId>;
} {
  const base = createReadyGame();
  const businessAssetId = asAssetId("asset-test-biz-1");

  const testBusiness: BusinessAsset = {
    id: businessAssetId,
    kind: "business",
    enterpriseValueCents: cents(10_000_000), // $100,000.00 EV
    debtPrincipalCents: cents(0), // debt-free
    annualRevenueCents: cents(5_000_000),
    annualOperatingProfitCents: cents(1_000_000),
    ownershipByPlayerPpm: createSoleOwnership(p2), // seller owns 100%
  };

  const state: GameState = {
    ...base,
    finance: {
      ...base.finance,
      cashByPlayer: {
        ...base.finance.cashByPlayer,
        [p1]: cents(10_000_000), // Buyer opening cash: $100,000.00
        [p2]: cents(2_500_000), // Seller opening cash: $25,000.00
      },
      assetsById: {
        ...base.finance.assetsById,
        [businessAssetId]: testBusiness,
      },
    },
  };

  assertGameState(state);
  return { state, businessAssetId };
}

describe("cash-business-purchase transaction lifecycle", () => {
  it("executes core end-to-end transaction lifecycle (open -> close) with exact financial correctness", () => {
    const { state: initial, businessAssetId } = createTransactionFixture();
    const purchasePriceCents = 6_000_000; // $60,000.00

    const initialRevision = initial.revision;
    const initialCounters = { ...initial.counters };
    const initialRandom = { ...initial.random };

    // 1. Check pre-transaction helpers
    expect(getReservedCashCents(initial, p1)).toBe(0);
    expect(getAvailableCashCents(initial, p1)).toBe(10_000_000);
    expect(getReservedCashCents(initial, p2)).toBe(0);
    expect(getAvailableCashCents(initial, p2)).toBe(2_500_000);

    // 2. Open transaction
    const openInput: OpenCashBusinessPurchaseInput = {
      buyerPlayerId: p1,
      sellerPlayerId: p2,
      assetId: businessAssetId,
      purchasePriceCents,
    };
    const openResult = openCashBusinessPurchaseTransaction(initial, openInput);
    expect(openResult.ok).toBe(true);
    if (!openResult.ok) throw new Error("open failed");

    const openedState = openResult.state;
    expect(openResult.journalEntries).toHaveLength(0);
    expect(openResult.transactionId).toBe(asTransactionId("transaction-1"));

    const txId = openResult.transactionId;
    expect(txId).toBeDefined();
    if (!txId) throw new Error("Missing transactionId");

    // Verify state after OPEN
    expect(openedState.revision).toBe(initialRevision + 1);
    expect(openedState.counters.transaction).toBe(
      initialCounters.transaction + 1,
    );
    expect(openedState.counters.journal).toBe(initialCounters.journal);
    expect(openedState.random).toEqual(initialRandom); // zero RNG consumption

    // Buyer cash and availability
    expect(openedState.finance.cashByPlayer[p1]).toBe(10_000_000); // actual cash unchanged
    expect(getReservedCashCents(openedState, p1)).toBe(6_000_000); // reserved = $60,000.00
    expect(getAvailableCashCents(openedState, p1)).toBe(4_000_000); // available = $40,000.00

    // Seller cash and ownership unchanged
    expect(openedState.finance.cashByPlayer[p2]).toBe(2_500_000);
    expect(getReservedCashCents(openedState, p2)).toBe(0);
    expect(getAvailableCashCents(openedState, p2)).toBe(2_500_000);

    const bizDuringOpen = openedState.finance.assetsById[
      businessAssetId
    ] as BusinessAsset;
    expect(bizDuringOpen.ownershipByPlayerPpm[p2]).toBe(TOTAL_OWNERSHIP_PPM);
    expect(bizDuringOpen.ownershipByPlayerPpm[p1]).toBeUndefined();

    // Active transaction details
    expect(openedState.activeTransaction).not.toBeNull();
    expect(openedState.activeTransaction?.id).toBe(
      asTransactionId("transaction-1"),
    );
    expect(openedState.activeTransaction?.kind).toBe("cash-business-purchase");
    expect(openedState.activeTransaction?.buyerPlayerId).toBe(p1);
    expect(openedState.activeTransaction?.sellerPlayerId).toBe(p2);
    expect(openedState.activeTransaction?.assetId).toBe(businessAssetId);
    expect(openedState.activeTransaction?.purchasePriceCents).toBe(6_000_000);
    expect(openedState.activeTransaction?.createdQuarter).toBe(
      openedState.currentQuarter,
    );
    expect(openedState.activeTransaction?.reservation).toEqual({
      playerId: p1,
      amountCents: 6_000_000,
      purpose: "purchase-price",
    });

    // 3. Close transaction
    const closeResult = closeCashBusinessPurchaseTransaction(openedState, txId);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) throw new Error("close failed");

    const closedState = closeResult.state;
    expect(closeResult.journalEntries).toHaveLength(1);

    // Verify state after CLOSE
    expect(closedState.revision).toBe(openedState.revision + 1);
    expect(closedState.counters.transaction).toBe(
      openedState.counters.transaction,
    ); // not advanced on close
    expect(closedState.counters.journal).toBe(openedState.counters.journal + 1); // 1 journal entry emitted
    expect(closedState.random).toEqual(initialRandom); // zero RNG consumption
    expect(closedState.activeTransaction).toBeNull(); // transaction cleared

    // Buyer cash and availability after CLOSE
    expect(closedState.finance.cashByPlayer[p1]).toBe(4_000_000); // $40,000.00
    expect(getReservedCashCents(closedState, p1)).toBe(0);
    expect(getAvailableCashCents(closedState, p1)).toBe(4_000_000);

    // Seller cash and availability after CLOSE
    expect(closedState.finance.cashByPlayer[p2]).toBe(8_500_000); // $25,000 + $60,000 = $85,000.00
    expect(getReservedCashCents(closedState, p2)).toBe(0);
    expect(getAvailableCashCents(closedState, p2)).toBe(8_500_000);

    // Asset ownership transferred 100% to buyer
    const bizAfterClose = closedState.finance.assetsById[
      businessAssetId
    ] as BusinessAsset;
    expect(bizAfterClose.ownershipByPlayerPpm[p1]).toBe(TOTAL_OWNERSHIP_PPM);
    expect(bizAfterClose.ownershipByPlayerPpm[p2]).toBeUndefined();
    expect(Object.keys(bizAfterClose.ownershipByPlayerPpm)).toEqual([p1]);

    // Preserved asset fields
    expect(bizAfterClose.id).toBe(businessAssetId);
    expect(bizAfterClose.enterpriseValueCents).toBe(10_000_000);
    expect(bizAfterClose.debtPrincipalCents).toBe(0);
    expect(bizAfterClose.annualRevenueCents).toBe(5_000_000);
    expect(bizAfterClose.annualOperatingProfitCents).toBe(1_000_000);

    // Journal entry validation
    const entry = closeResult.journalEntries[0];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Missing journal entry");

    expect(entry.id).toBe("journal-1");
    expect(entry.source).toEqual({ kind: "player", playerId: p1 });
    expect(entry.destination).toEqual({ kind: "player", playerId: p2 });
    expect(entry.amountCents).toBe(6_000_000);
    expect(entry.reason).toBe("business-purchase");
    expect(entry.quarter).toBe(closedState.currentQuarter);
    expect(entry.relatedAssetId).toBe(businessAssetId);
    expect(entry.relatedTransactionId).toBe(asTransactionId("transaction-1"));
  });

  it("executes cancellation lifecycle (open -> cancel) releasing reservation without moving cash or ownership", () => {
    const { state: initial, businessAssetId } = createTransactionFixture();
    const purchasePriceCents = 6_000_000;

    const initialRevision = initial.revision;
    const initialCounters = { ...initial.counters };

    // 1. Open
    const openResult = openCashBusinessPurchaseTransaction(initial, {
      buyerPlayerId: p1,
      sellerPlayerId: p2,
      assetId: businessAssetId,
      purchasePriceCents,
    });
    expect(openResult.ok).toBe(true);
    if (!openResult.ok) throw new Error("open failed");
    const openedState = openResult.state;
    const txId = openResult.transactionId;
    expect(txId).toBeDefined();
    if (!txId) throw new Error("Missing transactionId");

    expect(getAvailableCashCents(openedState, p1)).toBe(4_000_000);
    expect(openedState.activeTransaction).not.toBeNull();

    // 2. Cancel
    const cancelResult = cancelActiveTransaction(openedState, txId);
    expect(cancelResult.ok).toBe(true);
    if (!cancelResult.ok) throw new Error("cancel failed");

    const cancelledState = cancelResult.state;
    expect(cancelResult.journalEntries).toHaveLength(0);

    // Active transaction cleared
    expect(cancelledState.activeTransaction).toBeNull();
    expect(cancelledState.revision).toBe(initialRevision + 2); // open + cancel
    expect(cancelledState.counters.transaction).toBe(
      initialCounters.transaction + 1,
    ); // 1 ID consumed
    expect(cancelledState.counters.journal).toBe(initialCounters.journal); // no journal entries
    expect(cancelledState.random).toEqual(initial.random); // zero RNG consumption

    // Cash remains untouched, available cash fully restored
    expect(cancelledState.finance.cashByPlayer[p1]).toBe(10_000_000);
    expect(getReservedCashCents(cancelledState, p1)).toBe(0);
    expect(getAvailableCashCents(cancelledState, p1)).toBe(10_000_000);

    expect(cancelledState.finance.cashByPlayer[p2]).toBe(2_500_000);
    expect(getReservedCashCents(cancelledState, p2)).toBe(0);
    expect(getAvailableCashCents(cancelledState, p2)).toBe(2_500_000);

    // Ownership unchanged
    const biz = cancelledState.finance.assetsById[
      businessAssetId
    ] as BusinessAsset;
    expect(biz.ownershipByPlayerPpm[p2]).toBe(TOTAL_OWNERSHIP_PPM);
    expect(biz.ownershipByPlayerPpm[p1]).toBeUndefined();

    // Re-opening after cancel consumes next deterministic ID ("transaction-2")
    const secondOpenResult = openCashBusinessPurchaseTransaction(
      cancelledState,
      {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 5_000_000,
      },
    );
    expect(secondOpenResult.ok).toBe(true);
    if (!secondOpenResult.ok) throw new Error("second open failed");
    expect(secondOpenResult.transactionId).toBe(
      asTransactionId("transaction-2"),
    );
    expect(secondOpenResult.state.counters.transaction).toBe(2);
  });

  describe("opening rejection atomicity and validation rules", () => {
    it("rejects when game is in wrong phase (objective-choosing)", () => {
      const freshGame = createGame({
        gameId: "unready-game",
        seed: "test-seed",
        playerIds,
      });
      expect(freshGame.phase).toBe("objective-choosing");

      const result = openCashBusinessPurchaseTransaction(freshGame, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: asAssetId("asset-1"),
        purchasePriceCents: 10_000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("WRONG_PHASE");
      expect(result.state).toBe(freshGame);
    });

    it("rejects when an active transaction already exists (one active major transaction rule)", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const open1 = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 1_000_000,
      });
      expect(open1.ok).toBe(true);
      if (!open1.ok) throw new Error();

      const open2 = openCashBusinessPurchaseTransaction(open1.state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 1_000_000,
      });
      expect(open2.ok).toBe(false);
      if (open2.ok) throw new Error();
      expect(open2.code).toBe("ACTIVE_TRANSACTION_EXISTS");
      expect(open2.state).toBe(open1.state);
      expect(open2.state.counters.transaction).toBe(
        open1.state.counters.transaction,
      );
    });

    it("rejects invalid price: zero, negative, non-integer, unsafe", () => {
      const { state, businessAssetId } = createTransactionFixture();

      for (const badPrice of [
        0,
        -100,
        1.5,
        Number.NaN,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        const result = openCashBusinessPurchaseTransaction(state, {
          buyerPlayerId: p1,
          sellerPlayerId: p2,
          assetId: businessAssetId,
          purchasePriceCents: badPrice,
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error();
        expect(result.code).toBe("INVALID_PRICE");
        expect(result.state).toBe(state);
      }
    });

    it("rejects unknown buyer, unknown seller, or buyer == seller", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const unknownId = asPlayerId("ghost-player");

      const unknownBuyer = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: unknownId,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 10_000,
      });
      expect(unknownBuyer.ok).toBe(false);
      if (unknownBuyer.ok) throw new Error();
      expect(unknownBuyer.code).toBe("UNKNOWN_PLAYER");
      expect(unknownBuyer.state).toBe(state);

      const unknownSeller = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: unknownId,
        assetId: businessAssetId,
        purchasePriceCents: 10_000,
      });
      expect(unknownSeller.ok).toBe(false);
      if (unknownSeller.ok) throw new Error();
      expect(unknownSeller.code).toBe("UNKNOWN_PLAYER");
      expect(unknownSeller.state).toBe(state);

      const sameParty = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p1,
        assetId: businessAssetId,
        purchasePriceCents: 10_000,
      });
      expect(sameParty.ok).toBe(false);
      if (sameParty.ok) throw new Error();
      expect(sameParty.code).toBe("SAME_PARTY");
      expect(sameParty.state).toBe(state);
    });

    it("rejects unknown asset", () => {
      const { state } = createTransactionFixture();
      const result = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: asAssetId("unknown-asset"),
        purchasePriceCents: 10_000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("UNKNOWN_ASSET");
      expect(result.state).toBe(state);
    });

    it("rejects unsupported PropertyAsset", () => {
      const { state } = createTransactionFixture();
      const propertyId = asAssetId("property-test-asset");
      const testProperty: PropertyAsset = {
        id: propertyId,
        kind: "property",
        marketValueCents: cents(25_000_000),
        scheduledQuarterlyRentCents: cents(500_000),
        occupancyBps: basisPoints(9500),
        operatingExpenseRatioBps: basisPoints(3000),
        ownershipByPlayerPpm: createSoleOwnership(p2),
      };

      const propertyState: GameState = {
        ...state,
        finance: {
          ...state.finance,
          assetsById: {
            ...state.finance.assetsById,
            [propertyId]: testProperty,
          },
        },
      };

      const result = openCashBusinessPurchaseTransaction(propertyState, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: propertyId,
        purchasePriceCents: 100_000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("UNSUPPORTED_ASSET");
      expect(result.state).toBe(propertyState);
    });

    it("rejects encumbered business carrying debt (debtPrincipalCents > 0)", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const indebtedBusiness: BusinessAsset = {
        ...(state.finance.assetsById[businessAssetId] as BusinessAsset),
        debtPrincipalCents: cents(1_000_000), // carrying $10,000 debt
      };

      const indebtedState: GameState = {
        ...state,
        finance: {
          ...state.finance,
          assetsById: {
            ...state.finance.assetsById,
            [businessAssetId]: indebtedBusiness,
          },
        },
      };

      const result = openCashBusinessPurchaseTransaction(indebtedState, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 500_000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("ENCUMBERED_ASSET");
      expect(result.state).toBe(indebtedState);
    });

    it("rejects co-owned business or seller not 100% sole owner", () => {
      const { state, businessAssetId } = createTransactionFixture();

      // Case A: 50% seller, 50% other player
      const coOwnedBusiness: BusinessAsset = {
        ...(state.finance.assetsById[businessAssetId] as BusinessAsset),
        ownershipByPlayerPpm: {
          [p2]: ownershipPpm(500_000),
          [p3]: ownershipPpm(500_000),
        },
      };
      const coOwnedState: GameState = {
        ...state,
        finance: {
          ...state.finance,
          assetsById: {
            ...state.finance.assetsById,
            [businessAssetId]: coOwnedBusiness,
          },
        },
      };

      const resultCoOwned = openCashBusinessPurchaseTransaction(coOwnedState, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 500_000,
      });
      expect(resultCoOwned.ok).toBe(false);
      if (resultCoOwned.ok) throw new Error();
      expect(resultCoOwned.code).toBe("SELLER_NOT_SOLE_OWNER");
      expect(resultCoOwned.state).toBe(coOwnedState);

      // Case B: seller owns 0% (p3 owns 100%)
      const otherOwnerBusiness: BusinessAsset = {
        ...(state.finance.assetsById[businessAssetId] as BusinessAsset),
        ownershipByPlayerPpm: createSoleOwnership(p3),
      };
      const otherOwnerState: GameState = {
        ...state,
        finance: {
          ...state.finance,
          assetsById: {
            ...state.finance.assetsById,
            [businessAssetId]: otherOwnerBusiness,
          },
        },
      };

      const resultOtherOwner = openCashBusinessPurchaseTransaction(
        otherOwnerState,
        {
          buyerPlayerId: p1,
          sellerPlayerId: p2,
          assetId: businessAssetId,
          purchasePriceCents: 500_000,
        },
      );
      expect(resultOtherOwner.ok).toBe(false);
      if (resultOtherOwner.ok) throw new Error();
      expect(resultOtherOwner.code).toBe("SELLER_NOT_SOLE_OWNER");
      expect(resultOtherOwner.state).toBe(otherOwnerState);
    });

    it("rejects when buyer lacks sufficient available cash", () => {
      const { state, businessAssetId } = createTransactionFixture();
      // Buyer has 10,000,000 cents available; attempt purchase for 10,000,001 cents
      const result = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 10_000_001,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("INSUFFICIENT_AVAILABLE_CASH");
      expect(result.state).toBe(state);
      expect(result.state.counters.transaction).toBe(
        state.counters.transaction,
      );
    });

    it("rejects atomically with TRANSACTION_ID_EXHAUSTED when transaction counter is exhausted at MAX_SAFE_INTEGER", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const exhaustedState: GameState = {
        ...state,
        counters: {
          ...state.counters,
          transaction: Number.MAX_SAFE_INTEGER,
        },
      };

      const result = openCashBusinessPurchaseTransaction(exhaustedState, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 1_000_000,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("TRANSACTION_ID_EXHAUSTED");
      expect(result.state).toBe(exhaustedState); // exact reference identity
      expect(result.journalEntries).toHaveLength(0);
      expect(result.state.revision).toBe(exhaustedState.revision);
      expect(result.state.counters).toEqual(exhaustedState.counters);
      expect(result.state.random).toEqual(exhaustedState.random);
      expect(result.state.finance.cashByPlayer).toEqual(
        exhaustedState.finance.cashByPlayer,
      );
      expect(result.state.finance.assetsById).toEqual(
        exhaustedState.finance.assetsById,
      );
      expect(result.state.activeTransaction).toBeNull();
    });
  });

  describe("cancellation rejection rules", () => {
    it("rejects cancel when no active transaction exists", () => {
      const { state } = createTransactionFixture();
      expect(state.activeTransaction).toBeNull();

      const result = cancelActiveTransaction(
        state,
        asTransactionId("transaction-1"),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("NO_ACTIVE_TRANSACTION");
      expect(result.state).toBe(state);
    });

    it("rejects cancel with mismatched transaction ID", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 1_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const result = cancelActiveTransaction(
        openResult.state,
        asTransactionId("wrong-tx-id"),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("TRANSACTION_ID_MISMATCH");
      expect(result.state).toBe(openResult.state);
    });
  });

  describe("closing rejection rules and atomicity", () => {
    it("rejects close when no active transaction exists", () => {
      const { state } = createTransactionFixture();
      const result = closeCashBusinessPurchaseTransaction(
        state,
        asTransactionId("transaction-1"),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("NO_ACTIVE_TRANSACTION");
      expect(result.state).toBe(state);
    });

    it("rejects close with mismatched transaction ID", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 1_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const result = closeCashBusinessPurchaseTransaction(
        openResult.state,
        asTransactionId("wrong-tx-id"),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.code).toBe("TRANSACTION_ID_MISMATCH");
      expect(result.state).toBe(openResult.state);
    });

    it("rejects close atomically when buyer actual cash becomes insufficient before close", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 6_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const txId = openResult.transactionId;
      if (!txId) throw new Error("Missing transactionId");

      // Mutate state to simulate buyer cash being reduced to $5,000.00 (below $60,000 price)
      const cashDepletedState: GameState = {
        ...openResult.state,
        finance: {
          ...openResult.state.finance,
          cashByPlayer: {
            ...openResult.state.finance.cashByPlayer,
            [p1]: cents(500_000), // $5,000.00 < $60,000.00
          },
        },
      };

      const closeResult = closeCashBusinessPurchaseTransaction(
        cashDepletedState,
        txId,
      );
      expect(closeResult.ok).toBe(false);
      if (closeResult.ok) throw new Error();
      expect(closeResult.code).toBe("INSUFFICIENT_FUNDS");
      expect(closeResult.state).toBe(cashDepletedState);
      expect(closeResult.journalEntries).toHaveLength(0);

      // Verify no partial mutations occurred
      expect(closeResult.state.finance.cashByPlayer[p1]).toBe(500_000);
      expect(closeResult.state.finance.cashByPlayer[p2]).toBe(2_500_000);
      const biz = closeResult.state.finance.assetsById[
        businessAssetId
      ] as BusinessAsset;
      expect(biz.ownershipByPlayerPpm[p2]).toBe(TOTAL_OWNERSHIP_PPM);
      expect(biz.ownershipByPlayerPpm[p1]).toBeUndefined();
    });

    it("rejects close atomically when seller destination cash would overflow", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 6_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const txId = openResult.transactionId;
      if (!txId) throw new Error("Missing transactionId");

      // Set seller cash near MAX_SAFE_INTEGER
      const overflowState: GameState = {
        ...openResult.state,
        finance: {
          ...openResult.state.finance,
          cashByPlayer: {
            ...openResult.state.finance.cashByPlayer,
            [p2]: cents(Number.MAX_SAFE_INTEGER - 1_000),
          },
        },
      };

      const closeResult = closeCashBusinessPurchaseTransaction(
        overflowState,
        txId,
      );
      expect(closeResult.ok).toBe(false);
      if (closeResult.ok) throw new Error();
      expect(closeResult.code).toBe("DESTINATION_OVERFLOW");
      expect(closeResult.state).toBe(overflowState);
      expect(closeResult.journalEntries).toHaveLength(0);
      expect(closeResult.state.counters).toEqual(overflowState.counters);
      expect(closeResult.state.revision).toBe(overflowState.revision);
    });

    it("rejects close atomically when ownership becomes stale before close", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 6_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const txId = openResult.transactionId;
      if (!txId) throw new Error("Missing transactionId");

      // Seller ownership changed prior to close (e.g. transferred to p3)
      const staleOwnershipState: GameState = {
        ...openResult.state,
        finance: {
          ...openResult.state.finance,
          assetsById: {
            ...openResult.state.finance.assetsById,
            [businessAssetId]: {
              ...(openResult.state.finance.assetsById[
                businessAssetId
              ] as BusinessAsset),
              ownershipByPlayerPpm: createSoleOwnership(p3),
            },
          },
        },
      };

      const closeResult = closeCashBusinessPurchaseTransaction(
        staleOwnershipState,
        txId,
      );
      expect(closeResult.ok).toBe(false);
      if (closeResult.ok) throw new Error();
      expect(closeResult.code).toBe("SELLER_NOT_SOLE_OWNER");
      expect(closeResult.state).toBe(staleOwnershipState);
      expect(closeResult.journalEntries).toHaveLength(0);
    });
  });

  describe("settlement blocking while transaction is unresolved", () => {
    it("blocks quarter settlement with ACTIVE_TRANSACTION while a transaction is unresolved", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 6_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const activeState = openResult.state;
      expect(activeState.activeTransaction).not.toBeNull();

      // Attempt quarter settlement
      const settleResult = settleQuarter(activeState, { quarter: 1 });
      expect(settleResult.ok).toBe(false);
      if (settleResult.ok) throw new Error();
      expect(settleResult.code).toBe("ACTIVE_TRANSACTION");
      expect(settleResult.state).toBe(activeState);
      expect(settleResult.journalEntries).toHaveLength(0);
      expect(settleResult.state.revision).toBe(activeState.revision);
      expect(settleResult.state.counters).toEqual(activeState.counters);
      expect(settleResult.state.random).toEqual(activeState.random);

      const txId = openResult.transactionId;
      if (!txId) throw new Error("Missing transactionId");

      // Once cancelled, settlement succeeds normally
      const cancelResult = cancelActiveTransaction(activeState, txId);
      expect(cancelResult.ok).toBe(true);
      if (!cancelResult.ok) throw new Error();

      const settleAfterCancel = settleQuarter(cancelResult.state, {
        quarter: 1,
      });
      expect(settleAfterCancel.ok).toBe(true);
      expect(settleAfterCancel.state.lastSettledQuarter).toBe(1);
    });
  });

  describe("invariants and JSON serialization", () => {
    it("round-trips active transaction state through JSON serialization losslessly", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 6_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const serialized = JSON.stringify(openResult.state);
      const parsed: GameState = JSON.parse(serialized);

      expect(parsed).toEqual(openResult.state);
      expect(() => assertGameState(parsed)).not.toThrow();
    });

    it("throws invariant violation for malformed transaction state", () => {
      const { state, businessAssetId } = createTransactionFixture();
      const openResult = openCashBusinessPurchaseTransaction(state, {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: businessAssetId,
        purchasePriceCents: 6_000_000,
      });
      expect(openResult.ok).toBe(true);
      if (!openResult.ok) throw new Error();

      const activeTx = openResult.state.activeTransaction;
      if (!activeTx) throw new Error("Missing activeTransaction");

      // Corrupt reservation amount to not match price
      const corruptedReservation: GameState = {
        ...openResult.state,
        activeTransaction: {
          ...activeTx,
          reservation: {
            ...activeTx.reservation,
            amountCents: cents(5_000_000), // != 6_000_000
          },
        },
      };
      expect(() => assertGameState(corruptedReservation)).toThrow(
        /reservation amountCents .* must equal purchasePriceCents/,
      );

      // Corrupt buyer actual cash < reservation
      const corruptedCash: GameState = {
        ...openResult.state,
        finance: {
          ...openResult.state.finance,
          cashByPlayer: {
            ...openResult.state.finance.cashByPlayer,
            [p1]: cents(5_000_000), // < 6_000_000 reserved
          },
        },
      };
      expect(() => assertGameState(corruptedCash)).toThrow(
        /buyer actual cash .* must be >= reservation amount/,
      );

      // Corrupt transaction counter
      const corruptedCounter: GameState = {
        ...openResult.state,
        counters: {
          ...openResult.state.counters,
          transaction: -1,
        },
      };
      expect(() => assertGameState(corruptedCounter)).toThrow(
        /deterministic counters must be non-negative safe integers|transaction counter must be a non-negative safe integer/,
      );
    });
  });

  describe("deterministic repeatability", () => {
    it("produces deeply equal results and states when identical open call is run twice from the exact same initial state", () => {
      const fixture1 = createTransactionFixture();
      const fixture2 = createTransactionFixture();

      // Initial fixtures from identical inputs are deeply equal
      expect(fixture1.state).toEqual(fixture2.state);
      expect(fixture1.businessAssetId).toBe(fixture2.businessAssetId);

      const input: OpenCashBusinessPurchaseInput = {
        buyerPlayerId: p1,
        sellerPlayerId: p2,
        assetId: fixture1.businessAssetId,
        purchasePriceCents: 6_000_000,
      };

      const result1 = openCashBusinessPurchaseTransaction(
        fixture1.state,
        input,
      );
      const result2 = openCashBusinessPurchaseTransaction(
        fixture2.state,
        input,
      );

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) throw new Error();

      // Deep equality of complete transaction results
      expect(result1).toEqual(result2);

      // Explicit verification of required components
      expect(result1.transactionId).toBe(asTransactionId("transaction-1"));
      expect(result2.transactionId).toBe(asTransactionId("transaction-1"));
      expect(result1.state.counters).toEqual(result2.state.counters);
      expect(result1.state.counters.transaction).toBe(1);
      expect(result1.state.revision).toBe(result2.state.revision);
      expect(result1.state.random).toEqual(result2.state.random);
      expect(result1.state.activeTransaction).toEqual(
        result2.state.activeTransaction,
      );
      expect(result1.state.activeTransaction?.reservation).toEqual(
        result2.state.activeTransaction?.reservation,
      );
      expect(result1.journalEntries).toEqual(result2.journalEntries);
    });
  });
});
