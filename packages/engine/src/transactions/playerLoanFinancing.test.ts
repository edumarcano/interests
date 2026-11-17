import { asAssetId, asPlayerId, asTransactionId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { captureBusinessBasis } from "../finance/businessSettlement";
import { basisPoints, cents } from "../finance/money";
import { createSoleOwnership } from "../finance/ownership";
import { createProgress } from "../finance/progress";
import { applyAction } from "../game/actions";
import { createGame } from "../game/createGame";
import { beginRound } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState, PlayerLoan } from "../model/gameState";
import {
  createPrivateBusinessPurchaseOpportunity,
  pursuePrivateBusinessPurchaseOpportunityWithFinancingRequest,
} from "../opportunities/privateBusinessPurchase";
import {
  acceptPlayerLoanFinancingOffer,
  cancelActiveTransaction,
  closeCashBusinessPurchaseTransaction,
  openCashBusinessPurchaseTransaction,
  openFinancedBusinessPurchaseTransaction,
  submitPlayerLoanFinancingOffer,
} from "./cashBusinessPurchase";
import { getAvailableCashCents, getReservedCashCents } from "./reservations";

const buyerId = asPlayerId("test-buyer");
const sellerId = asPlayerId("test-seller");
const lenderId = asPlayerId("test-lender");
const neutralId = asPlayerId("test-neutral");
const playerIds = [buyerId, sellerId, lenderId, neutralId] as const;

/**
 * Creates a ready-for-first-round standard game state with test players.
 */
function createReadyGame(): GameState {
  let state = createGame({
    gameId: "financed-test-game",
    seed: "financed-test-seed",
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

  const roundResult = beginRound(state);
  if (!roundResult.ok) {
    throw new Error(`Failed to begin round: ${roundResult.code}`);
  }
  return roundResult.state;
}

/**
 * Creates the exact literal test fixture from Section 20 of TASK.md:
 * - buyer cash: 5_000_000 cents ($50,000.00)
 * - seller cash: 2_500_000 cents ($25,000.00)
 * - lender cash: 10_000_000 cents ($100,000.00)
 * - business price: 6_000_000 cents ($60,000.00)
 * - buyer contribution: 2_000_000 cents ($20,000.00)
 * - requested principal: 4_000_000 cents ($40,000.00)
 * - lender APR: 1_000 bps (10%)
 * - term: 3 quarters
 */
function createSection20Fixture(): {
  readonly state: GameState;
  readonly businessAssetId: ReturnType<typeof asAssetId>;
} {
  const base = createReadyGame();
  const businessAssetId = asAssetId("asset-test-biz-sec20");

  const testBusiness: BusinessAsset = {
    id: businessAssetId,
    kind: "business",
    cashPolicyId: "retained-profit-v1",
    cashCents: cents(0),
    operatingArrearsCents: cents(0),
    enterpriseValueCents: cents(6_000_000),
    debtPrincipalCents: cents(0),
    annualRevenueCents: cents(8_000_000),
    annualOperatingProfitCents: cents(1_500_000),
    ownershipByPlayerPpm: createSoleOwnership(sellerId),
  };

  let state: GameState = {
    ...base,
    finance: {
      ...base.finance,
      cashByPlayer: {
        ...base.finance.cashByPlayer,
        [buyerId]: cents(5_000_000),
        [sellerId]: cents(2_500_000),
        [lenderId]: cents(10_000_000),
        [neutralId]: cents(1_000_000),
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

describe("Section 20: Exact Financed Acquisition Fixture", () => {
  it("executes complete lifecycle: opportunity -> financed pursuit -> offer -> accept -> atomic close", () => {
    const { state: initial, businessAssetId } = createSection20Fixture();

    // 1. Create opportunity with asking price 6_000_000 cents ($60,000)
    const oppResult = createPrivateBusinessPurchaseOpportunity(initial, {
      targetPlayerId: buyerId,
      sellerPlayerId: sellerId,
      assetId: businessAssetId,
      askingPriceCents: 6_000_000,
    });
    expect(oppResult.ok).toBe(true);
    if (!oppResult.ok) return;

    const stateAfterOpp = oppResult.state;
    const opportunityId = oppResult.opportunityId;

    // 2. Pursue with financing request: contribution $20,000, principal $40,000
    const pursueResult =
      pursuePrivateBusinessPurchaseOpportunityWithFinancingRequest(
        stateAfterOpp,
        opportunityId,
        buyerId,
        {
          buyerCashContributionCents: 2_000_000,
          requestedPrincipalCents: 4_000_000,
        },
      );
    expect(pursueResult.ok).toBe(true);
    if (!pursueResult.ok) return;

    const stateAfterPursue = pursueResult.state;
    const transactionId = pursueResult.transactionId;

    // Expected after financed pursuit (Section 20):
    // buyer actual cash = 5_000_000, reserved = 2_000_000, available = 3_000_000
    expect(stateAfterPursue.finance.cashByPlayer[buyerId]).toBe(5_000_000);
    expect(getReservedCashCents(stateAfterPursue, buyerId)).toBe(2_000_000);
    expect(getAvailableCashCents(stateAfterPursue, buyerId)).toBe(3_000_000);

    // Opportunity state
    const opp = stateAfterPursue.opportunitiesById[opportunityId];
    expect(opp?.status).toBe("pursued");
    expect(opp?.relatedTransactionId).toBe(transactionId);

    // Active transaction state
    const tx = stateAfterPursue.activeTransaction;
    expect(tx).not.toBeNull();
    expect(tx?.id).toBe(transactionId);
    expect(tx?.purchasePriceCents).toBe(6_000_000);
    expect(tx?.reservation.amountCents).toBe(2_000_000);
    expect(tx?.reservation.playerId).toBe(buyerId);
    expect(tx?.playerLoanFinancing?.requestedPrincipalCents).toBe(4_000_000);
    expect(tx?.playerLoanFinancing?.offer).toBeNull();

    // 3. Lender submits firm financing offer: APR = 1000 bps (10%), term = 3 quarters
    const offerResult = submitPlayerLoanFinancingOffer(
      stateAfterPursue,
      transactionId,
      lenderId,
      {
        annualRateBps: 1_000,
        termQuarters: 3,
      },
    );
    expect(offerResult.ok).toBe(true);
    if (!offerResult.ok) return;

    const stateAfterOffer = offerResult.state;

    // Expected after lender offer (Section 20):
    // lender actual cash = 10_000_000, reserved = 4_000_000, available = 6_000_000
    expect(stateAfterOffer.finance.cashByPlayer[lenderId]).toBe(10_000_000);
    expect(getReservedCashCents(stateAfterOffer, lenderId)).toBe(4_000_000);
    expect(getAvailableCashCents(stateAfterOffer, lenderId)).toBe(6_000_000);

    // Buyer remains reserved = 2_000_000, available = 3_000_000
    expect(stateAfterOffer.finance.cashByPlayer[buyerId]).toBe(5_000_000);
    expect(getReservedCashCents(stateAfterOffer, buyerId)).toBe(2_000_000);
    expect(getAvailableCashCents(stateAfterOffer, buyerId)).toBe(3_000_000);

    // No cash has moved yet!
    expect(stateAfterOffer.finance.cashByPlayer[sellerId]).toBe(2_500_000);
    const playerLoansBeforeClose = Object.values(
      stateAfterOffer.finance.loansById,
    ).filter((l) => l.kind === "player-loan");
    expect(playerLoansBeforeClose).toHaveLength(0);

    const offer = stateAfterOffer.activeTransaction?.playerLoanFinancing?.offer;
    expect(offer).toBeDefined();
    expect(offer?.status).toBe("offered");
    expect(offer?.termsRevision).toBe(1);
    expect(offer?.lenderPlayerId).toBe(lenderId);
    expect(offer?.principalCents).toBe(4_000_000);
    expect(offer?.annualRateBps).toBe(1_000);
    expect(offer?.termQuarters).toBe(3);

    // 4. Buyer accepts exact terms
    const acceptResult = acceptPlayerLoanFinancingOffer(
      stateAfterOffer,
      transactionId,
      buyerId,
      1,
    );
    expect(acceptResult.ok).toBe(true);
    if (!acceptResult.ok) return;

    const stateAfterAccept = acceptResult.state;
    expect(
      stateAfterAccept.activeTransaction?.playerLoanFinancing?.offer?.status,
    ).toBe("accepted");

    // Still no cash moved
    expect(stateAfterAccept.finance.cashByPlayer[buyerId]).toBe(5_000_000);
    expect(stateAfterAccept.finance.cashByPlayer[sellerId]).toBe(2_500_000);
    expect(stateAfterAccept.finance.cashByPlayer[lenderId]).toBe(10_000_000);

    // 5. Authoritatively close transaction
    const closeResult = closeCashBusinessPurchaseTransaction(
      stateAfterAccept,
      transactionId,
    );
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

    const closedState = closeResult.state;

    // Expected immediately after close (Section 20):
    // buyer cash  = 3_000_000 ($30,000)
    // seller cash = 8_500_000 ($85,000)
    // lender cash = 6_000_000 ($60,000)
    expect(closedState.finance.cashByPlayer[buyerId]).toBe(3_000_000);
    expect(closedState.finance.cashByPlayer[sellerId]).toBe(8_500_000);
    expect(closedState.finance.cashByPlayer[lenderId]).toBe(6_000_000);

    // Total tracked cash is conserved: 5M + 2.5M + 10M + 1M = 18.5M
    const totalCash = Object.values(closedState.finance.cashByPlayer).reduce(
      (sum, val) => sum + val,
      0,
    );
    expect(totalCash).toBe(18_500_000);

    // Ownership: Buyer owns 1_000_000 PPM, Seller absent from ownership map
    const asset = closedState.finance.assetsById[businessAssetId];
    expect(asset).toBeDefined();
    expect(asset?.ownershipByPlayerPpm[buyerId]).toBe(1_000_000);
    expect(asset?.ownershipByPlayerPpm[sellerId]).toBeUndefined();
    expect(Object.keys(asset?.ownershipByPlayerPpm ?? {})).toEqual([buyerId]);

    // Exactly one new PlayerLoan exists
    const playerLoans = Object.values(closedState.finance.loansById).filter(
      (l) => l.kind === "player-loan",
    );
    expect(playerLoans).toHaveLength(1);
    const loan = playerLoans[0] as PlayerLoan;
    expect(loan.kind).toBe("player-loan");
    expect(loan.lenderPlayerId).toBe(lenderId);
    expect(loan.borrowerPlayerId).toBe(buyerId);
    expect(loan.originalPrincipalCents).toBe(4_000_000);
    expect(loan.outstandingPrincipalCents).toBe(4_000_000);
    expect(loan.annualRateBps).toBe(1_000);
    expect(loan.termQuarters).toBe(3);
    expect(loan.installmentsProcessed).toBe(0);
    expect(loan.originatedQuarter).toBe(closedState.currentQuarter);

    // Exactly two journal entries in deterministic order
    expect(closeResult.journalEntries).toHaveLength(2);
    const [loanEntry, purchaseEntry] = closeResult.journalEntries;

    // 1. Loan origination entry: lender -> buyer
    expect(loanEntry?.reason).toBe("loan-origination");
    expect(loanEntry?.source).toEqual({ kind: "player", playerId: lenderId });
    expect(loanEntry?.destination).toEqual({
      kind: "player",
      playerId: buyerId,
    });
    expect(loanEntry?.amountCents).toBe(4_000_000);
    expect(loanEntry?.relatedLoanId).toBe(loan.id);
    expect(loanEntry?.relatedTransactionId).toBe(transactionId);

    // 2. Business purchase entry: buyer -> seller
    expect(purchaseEntry?.reason).toBe("business-purchase");
    expect(purchaseEntry?.source).toEqual({
      kind: "player",
      playerId: buyerId,
    });
    expect(purchaseEntry?.destination).toEqual({
      kind: "player",
      playerId: sellerId,
    });
    expect(purchaseEntry?.amountCents).toBe(6_000_000);
    expect(purchaseEntry?.relatedAssetId).toBe(businessAssetId);
    expect(purchaseEntry?.relatedTransactionId).toBe(transactionId);

    // Active transaction cleared and reservations released
    expect(closedState.activeTransaction).toBeNull();
    expect(getReservedCashCents(closedState, buyerId)).toBe(0);
    expect(getReservedCashCents(closedState, lenderId)).toBe(0);
    expect(getAvailableCashCents(closedState, buyerId)).toBe(3_000_000);
    expect(getAvailableCashCents(closedState, lenderId)).toBe(6_000_000);

    assertGameState(closedState);
  });

  it("supports a zero buyer cash contribution (100% financed purchase)", () => {
    const { state: initial, businessAssetId } = createSection20Fixture();

    const openResult = openFinancedBusinessPurchaseTransaction(initial, {
      buyerPlayerId: buyerId,
      sellerPlayerId: sellerId,
      assetId: businessAssetId,
      purchasePriceCents: 6_000_000,
      buyerCashContributionCents: 0,
      requestedPrincipalCents: 6_000_000,
    });
    expect(openResult.ok).toBe(true);
    if (!openResult.ok) return;

    expect(getReservedCashCents(openResult.state, buyerId)).toBe(0);
    expect(getAvailableCashCents(openResult.state, buyerId)).toBe(5_000_000);

    const txId = openResult.transactionId;
    if (!txId) return;

    // Lender offers full 6_000_000
    const offerResult = submitPlayerLoanFinancingOffer(
      openResult.state,
      txId,
      lenderId,
      {
        annualRateBps: 800,
        termQuarters: 4,
      },
    );
    expect(offerResult.ok).toBe(true);
    if (!offerResult.ok) return;

    // Buyer accepts and closes
    const acceptResult = acceptPlayerLoanFinancingOffer(
      offerResult.state,
      txId,
      buyerId,
      1,
    );
    expect(acceptResult.ok).toBe(true);
    if (!acceptResult.ok) return;

    const closeResult = closeCashBusinessPurchaseTransaction(
      acceptResult.state,
      txId,
    );
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

    // Buyer cash unchanged (started with 5M, paid 0 net cash because loan funded 100% of price)
    // intermediate: 5M + 6M = 11M, then paid 6M -> final 5M!
    expect(closeResult.state.finance.cashByPlayer[buyerId]).toBe(5_000_000);
    expect(closeResult.state.finance.cashByPlayer[sellerId]).toBe(8_500_000);
    expect(closeResult.state.finance.cashByPlayer[lenderId]).toBe(4_000_000);
    expect(
      closeResult.state.finance.assetsById[businessAssetId]
        ?.ownershipByPlayerPpm[buyerId],
    ).toBe(1_000_000);
  });
});

describe("Section 28: Offer and Reservation Rejection Regressions", () => {
  function setupOpenFinancedState(): {
    state: GameState;
    transactionId: ReturnType<typeof asTransactionId>;
    businessAssetId: ReturnType<typeof asAssetId>;
  } {
    const { state: initial, businessAssetId } = createSection20Fixture();
    const openResult = openFinancedBusinessPurchaseTransaction(initial, {
      buyerPlayerId: buyerId,
      sellerPlayerId: sellerId,
      assetId: businessAssetId,
      purchasePriceCents: 6_000_000,
      buyerCashContributionCents: 2_000_000,
      requestedPrincipalCents: 4_000_000,
    });
    if (!openResult.ok || !openResult.transactionId) {
      throw new Error("Failed to set up financed transaction");
    }
    return {
      state: openResult.state,
      transactionId: openResult.transactionId,
      businessAssetId,
    };
  }

  it("rejects offer submission when no active transaction exists", () => {
    const { state } = createSection20Fixture();
    const result = submitPlayerLoanFinancingOffer(
      state,
      asTransactionId("tx-nonexistent"),
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_ACTIVE_TRANSACTION");
    expect(result.state).toBe(state);
  });

  it("rejects offer submission on transaction ID mismatch", () => {
    const { state } = setupOpenFinancedState();
    const result = submitPlayerLoanFinancingOffer(
      state,
      asTransactionId("tx-wrong-id"),
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TRANSACTION_ID_MISMATCH");
    expect(result.state).toBe(state);
  });

  it("rejects offer submission on a cash-only transaction", () => {
    const { state: initial, businessAssetId } = createSection20Fixture();
    const cashResult = openCashBusinessPurchaseTransaction(initial, {
      buyerPlayerId: buyerId,
      sellerPlayerId: sellerId,
      assetId: businessAssetId,
      purchasePriceCents: 5_000_000,
    });
    expect(cashResult.ok).toBe(true);
    if (!cashResult.ok || !cashResult.transactionId) return;

    const result = submitPlayerLoanFinancingOffer(
      cashResult.state,
      cashResult.transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_FINANCING_REQUEST");
    expect(result.state).toBe(cashResult.state);
  });

  it("rejects duplicate offer submission", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const firstOffer = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(firstOffer.ok).toBe(true);
    if (!firstOffer.ok) return;

    const secondOffer = submitPlayerLoanFinancingOffer(
      firstOffer.state,
      transactionId,
      neutralId,
      { annualRateBps: 800, termQuarters: 4 },
    );
    expect(secondOffer.ok).toBe(false);
    if (secondOffer.ok) return;
    expect(secondOffer.code).toBe("OFFER_ALREADY_EXISTS");
    expect(secondOffer.state).toBe(firstOffer.state);
  });

  it("rejects offer submission from unknown lender", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const result = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      asPlayerId("unknown-player"),
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNKNOWN_PLAYER");
    expect(result.state).toBe(state);
  });

  it("rejects offer submission where lender is the buyer", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const result = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      buyerId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SAME_PARTY");
    expect(result.state).toBe(state);
  });

  it("rejects offer submission where lender is the seller", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const result = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      sellerId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SAME_PARTY");
    expect(result.state).toBe(state);
  });

  it("rejects offer submission with invalid APR", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const negativeApr = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: -500, termQuarters: 3 },
    );
    expect(negativeApr.ok).toBe(false);
    if (negativeApr.ok) return;
    expect(negativeApr.code).toBe("INVALID_RATE");

    const nonIntegerApr = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 500.5, termQuarters: 3 },
    );
    expect(nonIntegerApr.ok).toBe(false);
    if (nonIntegerApr.ok) return;
    expect(nonIntegerApr.code).toBe("INVALID_RATE");
  });

  it("rejects offer submission with invalid term", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const tooShort = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 1 },
    );
    expect(tooShort.ok).toBe(false);
    if (tooShort.ok) return;
    expect(tooShort.code).toBe("INVALID_TERM");

    const tooLong = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 9 },
    );
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.code).toBe("INVALID_TERM");
  });

  it("rejects offer submission when lender has insufficient available cash", () => {
    const { state, transactionId } = setupOpenFinancedState();
    // Lender only has 1M available, but requested principal is 4M
    const lowCashState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [lenderId]: cents(1_000_000),
        },
      },
    };

    const result = submitPlayerLoanFinancingOffer(
      lowCashState,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_AVAILABLE_CASH");
    expect(result.state).toBe(lowCashState);
  });

  it("rejects acceptance by unauthorized player", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const offerResult = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(offerResult.ok).toBe(true);
    if (!offerResult.ok) return;

    // Seller tries to accept
    const result = acceptPlayerLoanFinancingOffer(
      offerResult.state,
      transactionId,
      sellerId,
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNAUTHORIZED_BUYER");
    expect(result.state).toBe(offerResult.state);
  });

  it("rejects acceptance with stale termsRevision", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const offerResult = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    expect(offerResult.ok).toBe(true);
    if (!offerResult.ok) return;

    const result = acceptPlayerLoanFinancingOffer(
      offerResult.state,
      transactionId,
      buyerId,
      999, // Stale revision
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("STALE_TERMS_REVISION");
    expect(result.state).toBe(offerResult.state);
  });

  it("rejects second acceptance", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const offerResult = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    if (!offerResult.ok) return;

    const firstAccept = acceptPlayerLoanFinancingOffer(
      offerResult.state,
      transactionId,
      buyerId,
      1,
    );
    expect(firstAccept.ok).toBe(true);
    if (!firstAccept.ok) return;

    const secondAccept = acceptPlayerLoanFinancingOffer(
      firstAccept.state,
      transactionId,
      buyerId,
      1,
    );
    expect(secondAccept.ok).toBe(false);
    if (secondAccept.ok) return;
    expect(secondAccept.code).toBe("OFFER_ALREADY_ACCEPTED");
    expect(secondAccept.state).toBe(firstAccept.state);
  });

  it("rejects closing before an offer is submitted", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const result = closeCashBusinessPurchaseTransaction(state, transactionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FINANCING_NOT_READY");
    expect(result.state).toBe(state);
  });

  it("rejects closing before the offer is accepted", () => {
    const { state, transactionId } = setupOpenFinancedState();
    const offerResult = submitPlayerLoanFinancingOffer(
      state,
      transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    if (!offerResult.ok) return;

    const result = closeCashBusinessPurchaseTransaction(
      offerResult.state,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FINANCING_NOT_READY");
    expect(result.state).toBe(offerResult.state);
  });
});

describe("Section 29: Close Failure Regressions (Atomicity)", () => {
  function setupAcceptedFinancedState(): {
    state: GameState;
    transactionId: ReturnType<typeof asTransactionId>;
    businessAssetId: ReturnType<typeof asAssetId>;
  } {
    const { state: initial, businessAssetId } = createSection20Fixture();
    const openResult = openFinancedBusinessPurchaseTransaction(initial, {
      buyerPlayerId: buyerId,
      sellerPlayerId: sellerId,
      assetId: businessAssetId,
      purchasePriceCents: 6_000_000,
      buyerCashContributionCents: 2_000_000,
      requestedPrincipalCents: 4_000_000,
    });
    if (!openResult.ok || !openResult.transactionId) {
      throw new Error("Setup failed");
    }
    const offerResult = submitPlayerLoanFinancingOffer(
      openResult.state,
      openResult.transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    if (!offerResult.ok) {
      throw new Error("Offer failed");
    }
    const acceptResult = acceptPlayerLoanFinancingOffer(
      offerResult.state,
      openResult.transactionId,
      buyerId,
      1,
    );
    if (!acceptResult.ok) {
      throw new Error("Accept failed");
    }
    return {
      state: acceptResult.state,
      transactionId: openResult.transactionId,
      businessAssetId,
    };
  }

  it("fails atomically when buyer contribution becomes unavailable before close", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const drainedBuyerState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyerId]: cents(1_000_000), // less than 2_000_000 contribution
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      drainedBuyerState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_FUNDS");
    expect(result.state).toBe(drainedBuyerState);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("fails atomically when lender principal becomes unavailable before close", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const drainedLenderState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [lenderId]: cents(3_000_000), // less than 4_000_000 principal
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      drainedLenderState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_FUNDS");
    expect(result.state).toBe(drainedLenderState);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("fails atomically when seller ownership becomes stale", () => {
    const { state, transactionId, businessAssetId } =
      setupAcceptedFinancedState();
    const originalAsset = state.finance.assetsById[
      businessAssetId
    ] as BusinessAsset;
    const staleOwnershipState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [businessAssetId]: {
            ...originalAsset,
            ownershipByPlayerPpm: createSoleOwnership(neutralId), // sold elsewhere
          },
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      staleOwnershipState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SELLER_NOT_SOLE_OWNER");
    expect(result.state).toBe(staleOwnershipState);
  });

  it("fails atomically when business becomes encumbered before close", () => {
    const { state, transactionId, businessAssetId } =
      setupAcceptedFinancedState();
    const originalAsset = state.finance.assetsById[
      businessAssetId
    ] as BusinessAsset;
    const encumberedState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [businessAssetId]: {
            ...originalAsset,
            debtPrincipalCents: cents(500_000),
          },
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      encumberedState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ENCUMBERED_ASSET");
    expect(result.state).toBe(encumberedState);
  });

  it("fails atomically when buyer intermediate balance would overflow", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const overflowBuyerState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyerId]: cents(Number.MAX_SAFE_INTEGER - 1_000_000), // + 4M overflows
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      overflowBuyerState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DESTINATION_OVERFLOW");
    expect(result.state).toBe(overflowBuyerState);
  });

  it("fails atomically when seller destination balance would overflow", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const overflowSellerState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [sellerId]: cents(Number.MAX_SAFE_INTEGER - 1_000_000), // + 6M overflows
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      overflowSellerState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DESTINATION_OVERFLOW");
    expect(result.state).toBe(overflowSellerState);
  });

  it("fails atomically when loan counter is exhausted", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const exhaustedLoanCounterState: GameState = {
      ...state,
      counters: {
        ...state.counters,
        loan: Number.MAX_SAFE_INTEGER,
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      exhaustedLoanCounterState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOAN_ID_EXHAUSTED");
    expect(result.state).toBe(exhaustedLoanCounterState);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("fails atomically when journal counter cannot accommodate two entries", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const exhaustedJournalState: GameState = {
      ...state,
      counters: {
        ...state.counters,
        journal: Number.MAX_SAFE_INTEGER - 1, // needs 2 slots!
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      exhaustedJournalState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("JOURNAL_ID_EXHAUSTED");
    expect(result.state).toBe(exhaustedJournalState);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("fails atomically when accepted offer has invalid rate at close", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const tx = state.activeTransaction;
    const financing = tx?.playerLoanFinancing;
    const offer = financing?.offer;
    if (
      tx === null ||
      financing === undefined ||
      offer === null ||
      offer === undefined
    ) {
      throw new Error("Missing active transaction or offer");
    }
    const invalidRateState: GameState = {
      ...state,
      activeTransaction: {
        ...tx,
        playerLoanFinancing: {
          ...financing,
          offer: {
            ...offer,
            annualRateBps: basisPoints(-1),
          },
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      invalidRateState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_RATE");
    expect(result.state).toBe(invalidRateState);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("fails atomically when accepted offer has invalid term at close", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const tx = state.activeTransaction;
    const financing = tx?.playerLoanFinancing;
    const offer = financing?.offer;
    if (
      tx === null ||
      financing === undefined ||
      offer === null ||
      offer === undefined
    ) {
      throw new Error("Missing active transaction or offer");
    }
    const invalidTermState: GameState = {
      ...state,
      activeTransaction: {
        ...tx,
        playerLoanFinancing: {
          ...financing,
          offer: {
            ...offer,
            termQuarters: 1, // below MIN_TERM_QUARTERS (2)
          },
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      invalidTermState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_TERM");
    expect(result.state).toBe(invalidTermState);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("fails atomically when accepted offer has unsupported amortization terms at close", () => {
    const { state, transactionId } = setupAcceptedFinancedState();
    const tx = state.activeTransaction;
    const financing = tx?.playerLoanFinancing;
    const offer = financing?.offer;
    if (
      tx === null ||
      financing === undefined ||
      offer === null ||
      offer === undefined
    ) {
      throw new Error("Missing active transaction or offer");
    }
    // Rate at MAX_SAFE_INTEGER causes regularPayment to exceed Number.MAX_SAFE_INTEGER
    const unsupportedState: GameState = {
      ...state,
      activeTransaction: {
        ...tx,
        playerLoanFinancing: {
          ...financing,
          offer: {
            ...offer,
            annualRateBps: basisPoints(Number.MAX_SAFE_INTEGER),
          },
        },
      },
    };

    const result = closeCashBusinessPurchaseTransaction(
      unsupportedState,
      transactionId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNSUPPORTED_TERMS");
    expect(result.state).toBe(unsupportedState);
    expect(result.journalEntries).toHaveLength(0);
  });
});

describe("Section 30: Cancellation Regression", () => {
  it("releases both buyer and lender reservations and preserves opportunity pursuit history", () => {
    const { state: initial, businessAssetId } = createSection20Fixture();

    const oppResult = createPrivateBusinessPurchaseOpportunity(initial, {
      targetPlayerId: buyerId,
      sellerPlayerId: sellerId,
      assetId: businessAssetId,
      askingPriceCents: 6_000_000,
    });
    if (!oppResult.ok) return;

    const pursueResult =
      pursuePrivateBusinessPurchaseOpportunityWithFinancingRequest(
        oppResult.state,
        oppResult.opportunityId,
        buyerId,
        {
          buyerCashContributionCents: 2_000_000,
          requestedPrincipalCents: 4_000_000,
        },
      );
    if (!pursueResult.ok || !pursueResult.transactionId) return;

    const offerResult = submitPlayerLoanFinancingOffer(
      pursueResult.state,
      pursueResult.transactionId,
      lenderId,
      { annualRateBps: 1_000, termQuarters: 3 },
    );
    if (!offerResult.ok) return;

    const acceptResult = acceptPlayerLoanFinancingOffer(
      offerResult.state,
      pursueResult.transactionId,
      buyerId,
      1,
    );
    if (!acceptResult.ok) return;

    // Both parties have reserved cash
    expect(getReservedCashCents(acceptResult.state, buyerId)).toBe(2_000_000);
    expect(getReservedCashCents(acceptResult.state, lenderId)).toBe(4_000_000);

    const initialCounters = { ...acceptResult.state.counters };

    // Cancel transaction
    const cancelResult = cancelActiveTransaction(
      acceptResult.state,
      pursueResult.transactionId,
    );
    expect(cancelResult.ok).toBe(true);
    if (!cancelResult.ok) return;

    const cancelledState = cancelResult.state;

    // Reservations released
    expect(getReservedCashCents(cancelledState, buyerId)).toBe(0);
    expect(getReservedCashCents(cancelledState, lenderId)).toBe(0);
    expect(getAvailableCashCents(cancelledState, buyerId)).toBe(5_000_000);
    expect(getAvailableCashCents(cancelledState, lenderId)).toBe(10_000_000);

    // No cash moved, no loans created, activeTransaction null
    expect(cancelledState.finance.cashByPlayer[buyerId]).toBe(5_000_000);
    expect(cancelledState.finance.cashByPlayer[sellerId]).toBe(2_500_000);
    expect(cancelledState.finance.cashByPlayer[lenderId]).toBe(10_000_000);
    expect(cancelledState.activeTransaction).toBeNull();
    const cancelledPlayerLoans = Object.values(
      cancelledState.finance.loansById,
    ).filter((l) => l.kind === "player-loan");
    expect(cancelledPlayerLoans).toHaveLength(0);

    // Opportunity remains historically pursued
    expect(
      cancelledState.opportunitiesById[oppResult.opportunityId]?.status,
    ).toBe("pursued");

    // No deterministic counters consumed on cancellation
    expect(cancelledState.counters).toEqual(initialCounters);

    assertGameState(cancelledState);
  });
});

describe("Section 31: Determinism", () => {
  it("produces deeply equal results across two identical runs from identical initial state", () => {
    const fixtureA = createSection20Fixture();
    const fixtureB = createSection20Fixture();
    expect(fixtureA.state).toEqual(fixtureB.state);

    function runFlow(state: GameState, assetId: ReturnType<typeof asAssetId>) {
      const opp = createPrivateBusinessPurchaseOpportunity(state, {
        targetPlayerId: buyerId,
        sellerPlayerId: sellerId,
        assetId,
        askingPriceCents: 6_000_000,
      });
      if (!opp.ok) throw new Error();

      const pursue =
        pursuePrivateBusinessPurchaseOpportunityWithFinancingRequest(
          opp.state,
          opp.opportunityId,
          buyerId,
          {
            buyerCashContributionCents: 2_000_000,
            requestedPrincipalCents: 4_000_000,
          },
        );
      if (!pursue.ok || !pursue.transactionId) throw new Error();

      const offer = submitPlayerLoanFinancingOffer(
        pursue.state,
        pursue.transactionId,
        lenderId,
        { annualRateBps: 1_000, termQuarters: 3 },
      );
      if (!offer.ok) throw new Error();

      const accept = acceptPlayerLoanFinancingOffer(
        offer.state,
        pursue.transactionId,
        buyerId,
        1,
      );
      if (!accept.ok) throw new Error();

      const close = closeCashBusinessPurchaseTransaction(
        accept.state,
        pursue.transactionId,
      );
      if (!close.ok) throw new Error();

      return close;
    }

    const resA = runFlow(fixtureA.state, fixtureA.businessAssetId);
    const resB = runFlow(fixtureB.state, fixtureB.businessAssetId);

    expect(resA.state).toEqual(resB.state);
    expect(resA.journalEntries).toEqual(resB.journalEntries);
    expect(resA.transactionId).toBe(resB.transactionId);
  });
});
