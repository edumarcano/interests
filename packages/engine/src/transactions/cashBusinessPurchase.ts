import {
  PLAYER_LOAN_MAX_TERM_QUARTERS,
  PLAYER_LOAN_MIN_TERM_QUARTERS,
} from "@finance-game/rules";
import type { AssetId, PlayerId, TransactionId } from "@finance-game/shared";

import { playerCashAccount } from "../finance/account";
import { calculatePlayerLoanSchedule } from "../finance/amortization";
import { originateConfirmedPlayerLoan } from "../finance/loans";
import { basisPoints, cents } from "../finance/money";
import { createSoleOwnership, TOTAL_OWNERSHIP_PPM } from "../finance/ownership";
import { postCash } from "../finance/posting";
import { nextDeterministicId } from "../game/deterministicIds";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import type {
  CashBusinessPurchaseTransaction,
  CashReservation,
  OpenCashBusinessPurchaseInput,
  OpenFinancedBusinessPurchaseInput,
  PlayerLoanFinancingOffer,
  SubmitPlayerLoanFinancingOfferInput,
  TransactionErrorCode,
  TransactionResult,
} from "./model";
import { getAvailableCashCents } from "./reservations";

/**
 * Shared pre-validation for opening cash or financed business purchases.
 */
function validateCommonBusinessPurchase(
  state: GameState,
  buyerPlayerId: PlayerId,
  sellerPlayerId: PlayerId,
  assetId: AssetId,
  purchasePriceCents: number,
): TransactionErrorCode | null {
  // 1. Phase validation: must have completed setup
  if (state.phase !== "ready-for-first-round") {
    return "WRONG_PHASE";
  }

  // 2. Concurrency validation: at most one active transaction permitted in this slice
  if (state.activeTransaction !== null) {
    return "ACTIVE_TRANSACTION_EXISTS";
  }

  // 3. Parties existence and distinctness validation
  if (!state.players[buyerPlayerId]) {
    return "UNKNOWN_PLAYER";
  }
  if (!state.players[sellerPlayerId]) {
    return "UNKNOWN_PLAYER";
  }
  if (buyerPlayerId === sellerPlayerId) {
    return "SAME_PARTY";
  }

  // 4. Asset validation: must exist and be a supported business
  const asset = state.finance.assetsById[assetId];
  if (!asset) {
    return "UNKNOWN_ASSET";
  }
  if (asset.kind !== "business") {
    return "UNSUPPORTED_ASSET";
  }
  if (asset.debtPrincipalCents !== 0) {
    return "ENCUMBERED_ASSET";
  }

  // 5. Ownership validation: seller must be the sole 100% owner
  const sellerOwnership = asset.ownershipByPlayerPpm[sellerPlayerId];
  const ownerCount = Object.keys(asset.ownershipByPlayerPpm).length;
  if (sellerOwnership !== TOTAL_OWNERSHIP_PPM || ownerCount !== 1) {
    return "SELLER_NOT_SOLE_OWNER";
  }

  // 6. Price validation: must be a positive safe integer cents
  if (!Number.isSafeInteger(purchasePriceCents) || purchasePriceCents <= 0) {
    return "INVALID_PRICE";
  }

  // 7. Transaction counter validation: counter must be able to advance safely
  if (state.counters.transaction >= Number.MAX_SAFE_INTEGER) {
    return "TRANSACTION_ID_EXHAUSTED";
  }

  return null;
}

/**
 * Pure domain function to open a 100% debt-free cash business purchase transaction.
 * Reserves buyer cash without altering actual cash or emitting journal entries.
 */
export function openCashBusinessPurchaseTransaction(
  state: GameState,
  input: OpenCashBusinessPurchaseInput,
): TransactionResult {
  const reject = (code: TransactionErrorCode): TransactionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  const commonError = validateCommonBusinessPurchase(
    state,
    input.buyerPlayerId,
    input.sellerPlayerId,
    input.assetId,
    input.purchasePriceCents,
  );
  if (commonError !== null) {
    return reject(commonError);
  }

  // Affordability validation: buyer must have sufficient AVAILABLE cash
  const availableCash = getAvailableCashCents(state, input.buyerPlayerId);
  if (availableCash < input.purchasePriceCents) {
    return reject("INSUFFICIENT_AVAILABLE_CASH");
  }

  // Generate deterministic transaction ID
  const { id: transactionId, counters: nextCounters } = nextDeterministicId(
    "transaction",
    state.counters,
  );

  const priceCents = cents(input.purchasePriceCents);

  const reservation: CashReservation = {
    playerId: input.buyerPlayerId,
    amountCents: priceCents,
    purpose: "purchase-price",
  };

  const activeTransaction: CashBusinessPurchaseTransaction = {
    id: transactionId,
    kind: "cash-business-purchase",
    buyerPlayerId: input.buyerPlayerId,
    sellerPlayerId: input.sellerPlayerId,
    assetId: input.assetId,
    purchasePriceCents: priceCents,
    createdQuarter: state.currentQuarter,
    reservation,
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    counters: nextCounters,
    activeTransaction,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    journalEntries: [],
    transactionId,
  };
}

/**
 * Pure domain function to open a financed business purchase transaction.
 * Reserves buyer cash contribution and records the requested principal.
 */
export function openFinancedBusinessPurchaseTransaction(
  state: GameState,
  input: OpenFinancedBusinessPurchaseInput,
): TransactionResult {
  const reject = (code: TransactionErrorCode): TransactionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  const commonError = validateCommonBusinessPurchase(
    state,
    input.buyerPlayerId,
    input.sellerPlayerId,
    input.assetId,
    input.purchasePriceCents,
  );
  if (commonError !== null) {
    return reject(commonError);
  }

  // Buyer contribution and requested principal rules:
  // buyerCashContributionCents >= 0 safe integer
  // requestedPrincipalCents > 0 safe integer
  // requestedPrincipalCents <= purchasePriceCents
  // buyerCashContributionCents + requestedPrincipalCents === purchasePriceCents
  if (
    !Number.isSafeInteger(input.buyerCashContributionCents) ||
    input.buyerCashContributionCents < 0 ||
    !Number.isSafeInteger(input.requestedPrincipalCents) ||
    input.requestedPrincipalCents <= 0 ||
    input.requestedPrincipalCents > input.purchasePriceCents ||
    input.buyerCashContributionCents >
      Number.MAX_SAFE_INTEGER - input.requestedPrincipalCents ||
    input.buyerCashContributionCents + input.requestedPrincipalCents !==
      input.purchasePriceCents
  ) {
    return reject("INVALID_FINANCING_REQUEST");
  }

  // Affordability validation: buyer must have sufficient AVAILABLE cash for contribution
  const availableCash = getAvailableCashCents(state, input.buyerPlayerId);
  if (availableCash < input.buyerCashContributionCents) {
    return reject("INSUFFICIENT_AVAILABLE_CASH");
  }

  // Generate deterministic transaction ID
  const { id: transactionId, counters: nextCounters } = nextDeterministicId(
    "transaction",
    state.counters,
  );

  const priceCents = cents(input.purchasePriceCents);
  const contributionCents = cents(input.buyerCashContributionCents);
  const requestedPrincipalCents = cents(input.requestedPrincipalCents);

  const reservation: CashReservation = {
    playerId: input.buyerPlayerId,
    amountCents: contributionCents,
    purpose: "purchase-price",
  };

  const activeTransaction: CashBusinessPurchaseTransaction = {
    id: transactionId,
    kind: "cash-business-purchase",
    buyerPlayerId: input.buyerPlayerId,
    sellerPlayerId: input.sellerPlayerId,
    assetId: input.assetId,
    purchasePriceCents: priceCents,
    createdQuarter: state.currentQuarter,
    reservation,
    playerLoanFinancing: {
      requestedPrincipalCents,
      offer: null,
    },
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    counters: nextCounters,
    activeTransaction,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    journalEntries: [],
    transactionId,
  };
}

/**
 * Pure domain function to submit a single firm player-loan financing offer.
 * Reserves the requested principal from the lender.
 */
export function submitPlayerLoanFinancingOffer(
  state: GameState,
  transactionId: TransactionId,
  lenderPlayerId: PlayerId,
  input: SubmitPlayerLoanFinancingOfferInput,
): TransactionResult {
  const reject = (code: TransactionErrorCode): TransactionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  if (state.activeTransaction === null) {
    return reject("NO_ACTIVE_TRANSACTION");
  }

  const tx = state.activeTransaction;
  if (tx.id !== transactionId) {
    return reject("TRANSACTION_ID_MISMATCH");
  }

  if (!tx.playerLoanFinancing) {
    return reject("NO_FINANCING_REQUEST");
  }

  if (tx.playerLoanFinancing.offer !== null) {
    return reject("OFFER_ALREADY_EXISTS");
  }

  if (!state.players[lenderPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }

  if (
    lenderPlayerId === tx.buyerPlayerId ||
    lenderPlayerId === tx.sellerPlayerId
  ) {
    return reject("SAME_PARTY");
  }

  if (
    !Number.isSafeInteger(input.annualRateBps) ||
    input.annualRateBps < 0 ||
    input.annualRateBps > Number.MAX_SAFE_INTEGER
  ) {
    return reject("INVALID_RATE");
  }

  if (
    !Number.isSafeInteger(input.termQuarters) ||
    input.termQuarters < PLAYER_LOAN_MIN_TERM_QUARTERS ||
    input.termQuarters > PLAYER_LOAN_MAX_TERM_QUARTERS
  ) {
    return reject("INVALID_TERM");
  }

  try {
    calculatePlayerLoanSchedule({
      principalCents: tx.playerLoanFinancing.requestedPrincipalCents,
      annualRateBps: input.annualRateBps,
      termQuarters: input.termQuarters,
    });
  } catch {
    return reject("UNSUPPORTED_TERMS");
  }

  const lenderAvailable = getAvailableCashCents(state, lenderPlayerId);
  if (lenderAvailable < tx.playerLoanFinancing.requestedPrincipalCents) {
    return reject("INSUFFICIENT_AVAILABLE_CASH");
  }

  const reservation: CashReservation = {
    playerId: lenderPlayerId,
    amountCents: tx.playerLoanFinancing.requestedPrincipalCents,
    purpose: "player-loan-funding",
  };

  const offer: PlayerLoanFinancingOffer = {
    lenderPlayerId,
    principalCents: tx.playerLoanFinancing.requestedPrincipalCents,
    annualRateBps: basisPoints(input.annualRateBps),
    termQuarters: input.termQuarters,
    termsRevision: 1,
    status: "offered",
    reservation,
  };

  const updatedTx: CashBusinessPurchaseTransaction = {
    ...tx,
    playerLoanFinancing: {
      ...tx.playerLoanFinancing,
      offer,
    },
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    activeTransaction: updatedTx,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    journalEntries: [],
    transactionId: tx.id,
  };
}

/**
 * Pure domain function for the buyer to accept the exact terms revision of a financing offer.
 */
export function acceptPlayerLoanFinancingOffer(
  state: GameState,
  transactionId: TransactionId,
  buyerPlayerId: PlayerId,
  expectedTermsRevision: number,
): TransactionResult {
  const reject = (code: TransactionErrorCode): TransactionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  if (state.activeTransaction === null) {
    return reject("NO_ACTIVE_TRANSACTION");
  }

  const tx = state.activeTransaction;
  if (tx.id !== transactionId) {
    return reject("TRANSACTION_ID_MISMATCH");
  }

  if (!tx.playerLoanFinancing) {
    return reject("NO_FINANCING_REQUEST");
  }

  const offer = tx.playerLoanFinancing.offer;
  if (offer === null) {
    return reject("NO_OFFER");
  }

  if (buyerPlayerId !== tx.buyerPlayerId) {
    return reject("UNAUTHORIZED_BUYER");
  }

  if (offer.status !== "offered") {
    return reject("OFFER_ALREADY_ACCEPTED");
  }

  if (expectedTermsRevision !== offer.termsRevision) {
    return reject("STALE_TERMS_REVISION");
  }

  const lenderCash = state.finance.cashByPlayer[offer.lenderPlayerId];
  if (lenderCash === undefined || lenderCash < offer.reservation.amountCents) {
    return reject("INSUFFICIENT_FUNDS");
  }

  const updatedOffer: PlayerLoanFinancingOffer = {
    ...offer,
    status: "accepted",
  };

  const updatedTx: CashBusinessPurchaseTransaction = {
    ...tx,
    playerLoanFinancing: {
      ...tx.playerLoanFinancing,
      offer: updatedOffer,
    },
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    activeTransaction: updatedTx,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    journalEntries: [],
    transactionId: tx.id,
  };
}

/**
 * Pure domain function to cancel an active transaction and release its reservation.
 * Moves no cash, changes no ownership, emits no journal entries.
 */
export function cancelActiveTransaction(
  state: GameState,
  transactionId: TransactionId,
): TransactionResult {
  const reject = (code: TransactionErrorCode): TransactionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  if (state.activeTransaction === null) {
    return reject("NO_ACTIVE_TRANSACTION");
  }

  if (state.activeTransaction.id !== transactionId) {
    return reject("TRANSACTION_ID_MISMATCH");
  }

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    activeTransaction: null,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    journalEntries: [],
  };
}

/**
 * Pure domain function to atomically close an active business purchase transaction (cash-only or financed).
 * Revalidates complete state, atomically moves funds, transfers sole 100% ownership,
 * clears active transaction and reservations, and emits authoritative journal entries.
 */
export function closeCashBusinessPurchaseTransaction(
  state: GameState,
  transactionId: TransactionId,
): TransactionResult {
  const reject = (code: TransactionErrorCode): TransactionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  // 1. Transaction existence and identity revalidation
  if (state.activeTransaction === null) {
    return reject("NO_ACTIVE_TRANSACTION");
  }

  const tx = state.activeTransaction;
  if (tx.id !== transactionId) {
    return reject("TRANSACTION_ID_MISMATCH");
  }

  // 2. Parties revalidation
  if (!state.players[tx.buyerPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }
  if (!state.players[tx.sellerPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }
  if (tx.buyerPlayerId === tx.sellerPlayerId) {
    return reject("SAME_PARTY");
  }

  // 3. Asset revalidation: must still exist and be a supported debt-free business
  const asset = state.finance.assetsById[tx.assetId];
  if (!asset) {
    return reject("UNKNOWN_ASSET");
  }
  if (asset.kind !== "business") {
    return reject("UNSUPPORTED_ASSET");
  }
  if (asset.debtPrincipalCents !== 0) {
    return reject("ENCUMBERED_ASSET");
  }

  // 4. Ownership revalidation: seller must still own 100%
  const sellerOwnership = asset.ownershipByPlayerPpm[tx.sellerPlayerId];
  const ownerCount = Object.keys(asset.ownershipByPlayerPpm).length;
  if (sellerOwnership !== TOTAL_OWNERSHIP_PPM || ownerCount !== 1) {
    return reject("SELLER_NOT_SOLE_OWNER");
  }

  // 5. Price revalidation
  if (
    !Number.isSafeInteger(tx.purchasePriceCents) ||
    tx.purchasePriceCents <= 0
  ) {
    return reject("INVALID_PRICE");
  }

  // 6. Branch: Cash-Only vs Financed Purchase
  if (tx.playerLoanFinancing === undefined) {
    // --- CASH-ONLY PATH ---
    // Reservation consistency revalidation
    if (
      tx.reservation.playerId !== tx.buyerPlayerId ||
      tx.reservation.amountCents !== tx.purchasePriceCents ||
      tx.reservation.purpose !== "purchase-price"
    ) {
      return reject("INVALID_RESERVATION");
    }

    // Buyer actual cash revalidation
    const buyerCash = state.finance.cashByPlayer[tx.buyerPlayerId];
    if (buyerCash === undefined || buyerCash < tx.purchasePriceCents) {
      return reject("INSUFFICIENT_FUNDS");
    }

    // Seller cash overflow revalidation
    const sellerCash = state.finance.cashByPlayer[tx.sellerPlayerId];
    if (sellerCash === undefined) {
      return reject("UNKNOWN_PLAYER");
    }
    if (tx.purchasePriceCents > Number.MAX_SAFE_INTEGER - sellerCash) {
      return reject("DESTINATION_OVERFLOW");
    }

    // Journal counter capacity preflight
    if (state.counters.journal >= Number.MAX_SAFE_INTEGER) {
      return reject("JOURNAL_ID_EXHAUSTED");
    }

    // Atomic cash movement using authoritative postCash
    const postingResult = postCash(state.finance, state.counters, {
      source: playerCashAccount(tx.buyerPlayerId),
      destination: playerCashAccount(tx.sellerPlayerId),
      amountCents: tx.purchasePriceCents,
      reason: "business-purchase",
      quarter: state.currentQuarter,
      relatedAssetId: tx.assetId,
      relatedTransactionId: tx.id,
    });

    if (!postingResult.ok) {
      switch (postingResult.code) {
        case "INVALID_AMOUNT":
          return reject("INVALID_PRICE");
        case "SAME_ACCOUNT":
          return reject("SAME_PARTY");
        case "UNKNOWN_PLAYER":
        case "INVALID_ENDPOINT":
          return reject("UNKNOWN_PLAYER");
        case "INSUFFICIENT_FUNDS":
          return reject("INSUFFICIENT_FUNDS");
        case "DESTINATION_OVERFLOW":
          return reject("DESTINATION_OVERFLOW");
      }
    }

    // Ownership transfer: exactly 100% to buyer
    const updatedAsset: BusinessAsset = {
      ...asset,
      ownershipByPlayerPpm: createSoleOwnership(tx.buyerPlayerId),
    };

    const nextAssetsById = {
      ...postingResult.finance.assetsById,
      [tx.assetId]: updatedAsset,
    };

    const nextState: GameState = {
      ...state,
      revision: state.revision + 1,
      finance: {
        ...postingResult.finance,
        assetsById: nextAssetsById,
      },
      counters: postingResult.counters,
      activeTransaction: null,
    };

    assertGameState(nextState);

    return {
      ok: true,
      state: nextState,
      journalEntries: [postingResult.entry],
      transactionId: tx.id,
    };
  }

  // --- FINANCED PATH ---
  const financing = tx.playerLoanFinancing;
  if (financing.offer === null || financing.offer.status !== "accepted") {
    return reject("FINANCING_NOT_READY");
  }

  const offer = financing.offer;

  // Lender existence and distinctness
  if (!state.players[offer.lenderPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }
  if (
    offer.lenderPlayerId === tx.buyerPlayerId ||
    offer.lenderPlayerId === tx.sellerPlayerId
  ) {
    return reject("SAME_PARTY");
  }

  // Buyer and lender reservations revalidation
  if (
    tx.reservation.playerId !== tx.buyerPlayerId ||
    tx.reservation.purpose !== "purchase-price" ||
    tx.reservation.amountCents + financing.requestedPrincipalCents !==
      tx.purchasePriceCents
  ) {
    return reject("INVALID_RESERVATION");
  }

  if (
    offer.reservation.playerId !== offer.lenderPlayerId ||
    offer.reservation.purpose !== "player-loan-funding" ||
    offer.reservation.amountCents !== financing.requestedPrincipalCents ||
    offer.principalCents !== financing.requestedPrincipalCents
  ) {
    return reject("INVALID_RESERVATION");
  }

  // Cash balances revalidation
  const buyerCash = state.finance.cashByPlayer[tx.buyerPlayerId];
  if (buyerCash === undefined || buyerCash < tx.reservation.amountCents) {
    return reject("INSUFFICIENT_FUNDS");
  }

  const lenderCash = state.finance.cashByPlayer[offer.lenderPlayerId];
  if (lenderCash === undefined || lenderCash < offer.reservation.amountCents) {
    return reject("INSUFFICIENT_FUNDS");
  }

  const sellerCash = state.finance.cashByPlayer[tx.sellerPlayerId];
  if (sellerCash === undefined) {
    return reject("UNKNOWN_PLAYER");
  }

  // Buyer intermediate balance capacity (receiving loan principal)
  if (offer.principalCents > Number.MAX_SAFE_INTEGER - buyerCash) {
    return reject("DESTINATION_OVERFLOW");
  }

  // Seller proceeds capacity (receiving full purchase price)
  if (tx.purchasePriceCents > Number.MAX_SAFE_INTEGER - sellerCash) {
    return reject("DESTINATION_OVERFLOW");
  }

  // Loan terms revalidation
  if (
    !Number.isSafeInteger(offer.annualRateBps) ||
    offer.annualRateBps < 0 ||
    offer.annualRateBps > Number.MAX_SAFE_INTEGER
  ) {
    return reject("INVALID_RATE");
  }

  if (
    !Number.isSafeInteger(offer.termQuarters) ||
    offer.termQuarters < PLAYER_LOAN_MIN_TERM_QUARTERS ||
    offer.termQuarters > PLAYER_LOAN_MAX_TERM_QUARTERS
  ) {
    return reject("INVALID_TERM");
  }

  try {
    calculatePlayerLoanSchedule({
      principalCents: offer.principalCents,
      annualRateBps: offer.annualRateBps,
      termQuarters: offer.termQuarters,
    });
  } catch {
    return reject("UNSUPPORTED_TERMS");
  }

  // Counter preflight: 1 LoanId, 2 JournalIds
  if (state.counters.loan >= Number.MAX_SAFE_INTEGER) {
    return reject("LOAN_ID_EXHAUSTED");
  }
  if (state.counters.journal > Number.MAX_SAFE_INTEGER - 2) {
    return reject("JOURNAL_ID_EXHAUSTED");
  }

  // 1. Originate loan lender -> buyer
  const loanResult = originateConfirmedPlayerLoan(
    state.finance,
    state.counters,
    {
      lenderPlayerId: offer.lenderPlayerId,
      borrowerPlayerId: tx.buyerPlayerId,
      principalCents: offer.principalCents,
      annualRateBps: offer.annualRateBps,
      termQuarters: offer.termQuarters,
      quarter: state.currentQuarter,
      relatedTransactionId: tx.id,
    },
  );

  if (!loanResult.ok) {
    if (loanResult.code === "LOAN_ID_EXHAUSTED") {
      return reject("LOAN_ID_EXHAUSTED");
    }
    if (loanResult.code === "DESTINATION_OVERFLOW") {
      return reject("DESTINATION_OVERFLOW");
    }
    if (loanResult.code === "INSUFFICIENT_FUNDS") {
      return reject("INSUFFICIENT_FUNDS");
    }
    if (loanResult.code === "INVALID_RATE") {
      return reject("INVALID_RATE");
    }
    if (loanResult.code === "INVALID_TERM") {
      return reject("INVALID_TERM");
    }
    if (loanResult.code === "UNSUPPORTED_TERMS") {
      return reject("UNSUPPORTED_TERMS");
    }
    throw new Error(
      `Invariant violation: unexpected loan origination failure during financed close: ${loanResult.code}`,
    );
  }

  // 2. Post cash buyer -> seller for full purchase price
  const purchaseResult = postCash(loanResult.finance, loanResult.counters, {
    source: playerCashAccount(tx.buyerPlayerId),
    destination: playerCashAccount(tx.sellerPlayerId),
    amountCents: tx.purchasePriceCents,
    reason: "business-purchase",
    quarter: state.currentQuarter,
    relatedAssetId: tx.assetId,
    relatedTransactionId: tx.id,
  });

  if (!purchaseResult.ok) {
    if (purchaseResult.code === "DESTINATION_OVERFLOW") {
      return reject("DESTINATION_OVERFLOW");
    }
    if (purchaseResult.code === "INSUFFICIENT_FUNDS") {
      return reject("INSUFFICIENT_FUNDS");
    }
    throw new Error(
      `Invariant violation: unexpected cash posting failure during financed business purchase: ${purchaseResult.code}`,
    );
  }

  // 3. Ownership transfer: exactly 100% to buyer
  const updatedAsset: BusinessAsset = {
    ...asset,
    ownershipByPlayerPpm: createSoleOwnership(tx.buyerPlayerId),
  };

  const nextAssetsById = {
    ...purchaseResult.finance.assetsById,
    [tx.assetId]: updatedAsset,
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    finance: {
      ...purchaseResult.finance,
      assetsById: nextAssetsById,
    },
    counters: purchaseResult.counters,
    activeTransaction: null,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    journalEntries: [loanResult.entry, purchaseResult.entry],
    transactionId: tx.id,
  };
}
