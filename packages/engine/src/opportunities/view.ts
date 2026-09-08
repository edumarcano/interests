import type {
  AssetId,
  OpportunityId,
  PlayerId,
  TransactionId,
} from "@interests/shared";

import type { Cents } from "../finance/money";
import type { GameState } from "../model/gameState";
import type { BusinessPurchaseDueDiligence } from "./model";

export interface PrivateBusinessPurchaseOpportunityView {
  readonly id: OpportunityId;
  readonly kind: "private-business-purchase";
  readonly access: "private";
  readonly targetPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly askingPriceCents: Cents;
  readonly createdQuarter: number;
  readonly status: "available" | "pursued";
  readonly investigated: boolean;
  readonly facts: BusinessPurchaseDueDiligence | null;
  readonly relatedTransactionId?: TransactionId;
}

export type OpportunityView = PrivateBusinessPurchaseOpportunityView;

export type OpportunityViewErrorCode = "NOT_FOUND_OR_NOT_VISIBLE";

export type OpportunityViewResult =
  | {
      readonly ok: true;
      readonly view: OpportunityView;
    }
  | {
      readonly ok: false;
      readonly code: OpportunityViewErrorCode;
    };

/**
 * Pure projection function to retrieve a player-safe opportunity view.
 * Conceals private opportunities from unauthorized viewers and conceals
 * due-diligence facts until investigated by the target player.
 */
export function getOpportunityView(
  state: GameState,
  opportunityId: OpportunityId,
  viewerPlayerId: PlayerId,
): OpportunityViewResult {
  const opportunity = state.opportunitiesById[opportunityId];
  if (!opportunity) {
    return {
      ok: false,
      code: "NOT_FOUND_OR_NOT_VISIBLE",
    };
  }

  // Allowlist: only the target player may see a private opportunity
  if (
    opportunity.access === "private" &&
    viewerPlayerId !== opportunity.targetPlayerId
  ) {
    return {
      ok: false,
      code: "NOT_FOUND_OR_NOT_VISIBLE",
    };
  }

  const isInvestigated = opportunity.investigation.investigated;

  const view: PrivateBusinessPurchaseOpportunityView = {
    id: opportunity.id,
    kind: opportunity.kind,
    access: opportunity.access,
    targetPlayerId: opportunity.targetPlayerId,
    sellerPlayerId: opportunity.sellerPlayerId,
    assetId: opportunity.assetId,
    askingPriceCents: opportunity.askingPriceCents,
    createdQuarter: opportunity.createdQuarter,
    status: opportunity.status,
    investigated: isInvestigated,
    facts: isInvestigated ? opportunity.investigation.facts : null,
    ...(opportunity.relatedTransactionId !== undefined
      ? { relatedTransactionId: opportunity.relatedTransactionId }
      : {}),
  };

  return {
    ok: true,
    view,
  };
}
