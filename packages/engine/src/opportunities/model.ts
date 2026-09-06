import type {
  AssetId,
  OpportunityId,
  PlayerId,
  TransactionId,
} from "@finance-game/shared";

import type { Cents } from "../finance/money";
import type { GameState } from "../model/gameState";
import type { TransactionErrorCode } from "../transactions/model";

export interface BusinessPurchaseDueDiligence {
  readonly annualRevenueCents: Cents;
  readonly annualOperatingProfitCents: Cents;
  readonly enterpriseValueCents: Cents;
  readonly debtPrincipalCents: Cents;
}

export interface PrivateBusinessPurchaseInvestigation {
  readonly investigated: boolean;
  readonly facts: BusinessPurchaseDueDiligence;
}

export interface PrivateBusinessPurchaseOpportunity {
  readonly id: OpportunityId;
  readonly kind: "private-business-purchase";
  readonly access: "private";
  readonly targetPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly askingPriceCents: Cents;
  readonly createdQuarter: number;
  readonly investigation: PrivateBusinessPurchaseInvestigation;
  readonly status: "available" | "pursued";
  readonly relatedTransactionId?: TransactionId;
}

export type Opportunity = PrivateBusinessPurchaseOpportunity;

export interface CreatePrivateBusinessPurchaseOpportunityInput {
  readonly targetPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly askingPriceCents: number;
}

export type CreateOpportunityErrorCode =
  | "WRONG_PHASE"
  | "UNKNOWN_PLAYER"
  | "SAME_PARTY"
  | "UNKNOWN_ASSET"
  | "UNSUPPORTED_ASSET"
  | "ENCUMBERED_ASSET"
  | "SELLER_NOT_SOLE_OWNER"
  | "INVALID_PRICE"
  | "OPPORTUNITY_ID_EXHAUSTED";

export type CreateOpportunityResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly opportunityId: OpportunityId;
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: CreateOpportunityErrorCode;
    };

export type InvestigateOpportunityErrorCode =
  | "OPPORTUNITY_NOT_FOUND"
  | "NOT_AUTHORIZED"
  | "OPPORTUNITY_NOT_AVAILABLE"
  | "ALREADY_INVESTIGATED";

export type InvestigateOpportunityResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly opportunityId: OpportunityId;
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: InvestigateOpportunityErrorCode;
    };

export type PursueOpportunityErrorCode =
  | "OPPORTUNITY_NOT_FOUND"
  | "NOT_AUTHORIZED"
  | "OPPORTUNITY_NOT_AVAILABLE"
  | "TRANSACTION_REJECTED";

export type PursueOpportunityResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly opportunityId: OpportunityId;
      readonly transactionId: TransactionId;
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: Exclude<
        PursueOpportunityErrorCode,
        "TRANSACTION_REJECTED"
      >;
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: "TRANSACTION_REJECTED";
      readonly transactionCode: TransactionErrorCode;
    };
