import type { AssetId, PlayerId, TransactionId } from "@finance-game/shared";

import type { JournalEntry } from "../finance/journal";
import type { Cents } from "../finance/money";
import type { GameState } from "../model/gameState";

export interface CashReservation {
  readonly playerId: PlayerId;
  readonly amountCents: Cents;
  readonly purpose: "purchase-price";
}

export interface CashBusinessPurchaseTransaction {
  readonly id: TransactionId;
  readonly kind: "cash-business-purchase";
  readonly buyerPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly purchasePriceCents: Cents;
  readonly createdQuarter: number;
  readonly reservation: CashReservation;
}

export type ActiveTransaction = CashBusinessPurchaseTransaction;

export interface OpenCashBusinessPurchaseInput {
  readonly buyerPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly purchasePriceCents: number;
}

export type TransactionErrorCode =
  | "WRONG_PHASE"
  | "ACTIVE_TRANSACTION_EXISTS"
  | "NO_ACTIVE_TRANSACTION"
  | "TRANSACTION_ID_MISMATCH"
  | "UNKNOWN_PLAYER"
  | "SAME_PARTY"
  | "UNKNOWN_ASSET"
  | "UNSUPPORTED_ASSET"
  | "ENCUMBERED_ASSET"
  | "SELLER_NOT_SOLE_OWNER"
  | "INVALID_PRICE"
  | "INSUFFICIENT_AVAILABLE_CASH"
  | "INSUFFICIENT_FUNDS"
  | "DESTINATION_OVERFLOW"
  | "INVALID_RESERVATION";

export type TransactionResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly journalEntries: readonly JournalEntry[];
      readonly transactionId?: TransactionId;
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: TransactionErrorCode;
      readonly journalEntries: readonly [];
    };
