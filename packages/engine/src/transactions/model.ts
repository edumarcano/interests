import type {
  AssetId,
  BusinessCapitalTerms,
  PlayerId,
  TransactionId,
} from "@interests/shared";

import type { JournalEntry } from "../finance/journal";
import type { BasisPoints, Cents } from "../finance/money";
import type { GameState } from "../model/gameState";
import type { SealedAuction } from "./sealedAuction";

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

export interface BusinessCapitalTransaction {
  readonly id: TransactionId;
  readonly kind: "business-capital";
  readonly assetId: AssetId;
  readonly initiatorPlayerId: PlayerId;
  readonly createdQuarter: number;
  readonly terms: BusinessCapitalTerms;
  readonly termsRevision: number;
  readonly confirmedPlayerIds: readonly PlayerId[];
  readonly loanOffers?: readonly BusinessLoanOffer[];
  readonly selectedLoans?: readonly {
    readonly slot: number;
    readonly lenderPlayerId: PlayerId;
  }[];
  readonly equityOffers?: readonly BusinessEquityOffer[];
  readonly selectedEquity?: readonly {
    readonly slot: number;
    readonly investorPlayerId: PlayerId;
  }[];
}

export interface BusinessEquityOffer {
  readonly investorPlayerId: PlayerId;
  readonly slot: number;
  readonly postMoneyOwnershipPpm: number;
}

export interface BusinessLoanOffer {
  readonly lenderPlayerId: PlayerId;
  readonly slot: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
}

export type ActiveTransaction =
  | CashBusinessPurchaseTransaction
  | BusinessCapitalTransaction
  | BusinessAuctionTransaction;

export interface BusinessAuctionTransaction extends SealedAuction {
  readonly id: TransactionId;
  readonly kind: "business-auction";
  readonly assetId: AssetId;
  readonly sellerPlayerId: PlayerId;
  readonly createdQuarter: number;
  readonly ownershipPpm: number;
}

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
  | "AUCTION_SEAT_INELIGIBLE"
  | "AUCTION_ALREADY_RESPONDED"
  | "AUCTION_BID_TOO_LOW"
  | "INVALID_CAPITAL_CONSIDERATION"
  | "CAPITAL_PARTICIPANT_REQUIRED"
  | "CAPITAL_CONFIRMATIONS_REQUIRED"
  | "CAPITAL_ALREADY_CONFIRMED"
  | "CAPITAL_NOT_CONFIRMED"
  | "INVALID_TRANSACTION_KIND"
  | "INVALID_EXPANSION"
  | "COUNTER_EXHAUSTED"
  | "JOURNAL_ID_EXHAUSTED"
  | "INVALID_QUARTER"
  | "WRONG_PHASE"
  | "WRONG_ROUND_STAGE"
  | "NOT_ACTIVE_SPOTLIGHT"
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
