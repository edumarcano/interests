import type { TransactionId } from "@finance-game/shared";

import { playerCashAccount } from "../finance/account";
import { cents } from "../finance/money";
import { createSoleOwnership, TOTAL_OWNERSHIP_PPM } from "../finance/ownership";
import { postCash } from "../finance/posting";
import { nextDeterministicId } from "../game/deterministicIds";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import type {
  CashBusinessPurchaseTransaction,
  CashReservation,
  OpenCashBusinessPurchaseInput,
  TransactionErrorCode,
  TransactionResult,
} from "./model";
import { getAvailableCashCents } from "./reservations";

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

  // 1. Phase validation: must have completed setup
  if (state.phase !== "ready-for-first-round") {
    return reject("WRONG_PHASE");
  }

  // 2. Concurrency validation: at most one active transaction permitted in this slice
  if (state.activeTransaction !== null) {
    return reject("ACTIVE_TRANSACTION_EXISTS");
  }

  // 3. Parties existence and distinctness validation
  if (!state.players[input.buyerPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }
  if (!state.players[input.sellerPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }
  if (input.buyerPlayerId === input.sellerPlayerId) {
    return reject("SAME_PARTY");
  }

  // 4. Asset validation: must exist and be a supported business
  const asset = state.finance.assetsById[input.assetId];
  if (!asset) {
    return reject("UNKNOWN_ASSET");
  }
  if (asset.kind !== "business") {
    return reject("UNSUPPORTED_ASSET");
  }
  if (asset.debtPrincipalCents !== 0) {
    return reject("ENCUMBERED_ASSET");
  }

  // 5. Ownership validation: seller must be the sole 100% owner
  const sellerOwnership = asset.ownershipByPlayerPpm[input.sellerPlayerId];
  const ownerCount = Object.keys(asset.ownershipByPlayerPpm).length;
  if (sellerOwnership !== TOTAL_OWNERSHIP_PPM || ownerCount !== 1) {
    return reject("SELLER_NOT_SOLE_OWNER");
  }

  // 6. Price validation: must be a positive safe integer cents
  if (
    !Number.isSafeInteger(input.purchasePriceCents) ||
    input.purchasePriceCents <= 0
  ) {
    return reject("INVALID_PRICE");
  }

  // 7. Affordability validation: buyer must have sufficient AVAILABLE cash
  const availableCash = getAvailableCashCents(state, input.buyerPlayerId);
  if (availableCash < input.purchasePriceCents) {
    return reject("INSUFFICIENT_AVAILABLE_CASH");
  }

  // 8. Generate deterministic transaction ID
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
 * Pure domain function to atomically close an active cash business purchase transaction.
 * Revalidates complete state, posts buyer -> seller cash, transfers 100% sole ownership,
 * clears the active transaction, and advances revision and journal counter.
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

  // 6. Reservation consistency revalidation
  if (
    tx.reservation.playerId !== tx.buyerPlayerId ||
    tx.reservation.amountCents !== tx.purchasePriceCents ||
    tx.reservation.purpose !== "purchase-price"
  ) {
    return reject("INVALID_RESERVATION");
  }

  // 7. Buyer actual cash revalidation
  const buyerCash = state.finance.cashByPlayer[tx.buyerPlayerId];
  if (buyerCash === undefined || buyerCash < tx.purchasePriceCents) {
    return reject("INSUFFICIENT_FUNDS");
  }

  // 8. Seller cash overflow revalidation
  const sellerCash = state.finance.cashByPlayer[tx.sellerPlayerId];
  if (sellerCash === undefined) {
    return reject("UNKNOWN_PLAYER");
  }
  if (tx.purchasePriceCents > Number.MAX_SAFE_INTEGER - sellerCash) {
    return reject("DESTINATION_OVERFLOW");
  }

  // 9. Atomic cash movement using authoritative postCash
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

  // 10. Ownership transfer: exactly 100% to buyer
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
