import type { AssetId, PlayerId, TransactionId } from "@interests/shared";

import type { JournalEntry } from "../finance/journal";
import type { BasisPoints, Cents } from "../finance/money";
import type { GameState } from "../model/gameState";

export type CashReservationPurpose = "purchase-price" | "player-loan-funding";

export interface CashReservation {
  readonly playerId: PlayerId;
  readonly amountCents: Cents;
  readonly purpose: CashReservationPurpose;
}

export interface PlayerLoanFinancingOffer {
  readonly lenderPlayerId: PlayerId;
  readonly principalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly termQuarters: number;
  readonly termsRevision: number;
  readonly status: "offered" | "accepted";
  readonly reservation: CashReservation;
}

export interface PlayerLoanFinancingRequest {
  readonly requestedPrincipalCents: Cents;
  readonly offer: PlayerLoanFinancingOffer | null;
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
  readonly playerLoanFinancing?: PlayerLoanFinancingRequest;
}

export type ActiveTransaction = CashBusinessPurchaseTransaction;

export interface OpenCashBusinessPurchaseInput {
  readonly buyerPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly purchasePriceCents: number;
}

export interface OpenFinancedBusinessPurchaseInput {
  readonly buyerPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly purchasePriceCents: number;
  readonly buyerCashContributionCents: number;
  readonly requestedPrincipalCents: number;
}

export interface SubmitPlayerLoanFinancingOfferInput {
  readonly annualRateBps: number;
  readonly termQuarters: number;
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
  | "INVALID_RESERVATION"
  | "TRANSACTION_ID_EXHAUSTED"
  | "INVALID_FINANCING_REQUEST"
  | "NO_FINANCING_REQUEST"
  | "OFFER_ALREADY_EXISTS"
  | "INVALID_RATE"
  | "INVALID_TERM"
  | "UNSUPPORTED_TERMS"
  | "NO_OFFER"
  | "UNAUTHORIZED_BUYER"
  | "OFFER_ALREADY_ACCEPTED"
  | "STALE_TERMS_REVISION"
  | "FINANCING_NOT_READY"
  | "LOAN_ID_EXHAUSTED"
  | "JOURNAL_ID_EXHAUSTED";

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
