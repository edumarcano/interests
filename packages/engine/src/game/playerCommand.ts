import type { ObjectiveId } from "@interests/rules";
import type {
  AcceptCareerOfferCommandPayload,
  BusinessAuctionCommand,
  BusinessCapitalCommand,
  ExpandBusinessCommandPayload,
  JointPropertyCommand,
  OpportunityId,
  PlayerId,
  PropertyAcquisitionCommand,
  PropertyCommand,
  ResignLaborCommandPayload,
  SetFocusCommandPayload,
  TradePublicMarketsCommandPayload,
  TransactionId,
} from "@interests/shared";
import { expandBusinessAndAdvanceSpotlight } from "../finance/businessExpansion.js";
import { applyPropertyCommand } from "../finance/propertyActions";
import { tradePublicMarketsAndAdvanceSpotlight } from "../finance/publicMarketTrading.js";
import type { GameState } from "../model/gameState.js";
import {
  investigatePrivateBusinessPurchaseOpportunity,
  pursuePrivateBusinessPurchaseOpportunity,
  pursuePrivateBusinessPurchaseOpportunityWithFinancingRequest,
} from "../opportunities/privateBusinessPurchase.js";
import { applyBusinessAuctionCommand } from "../transactions/businessAuction";
import { applyBusinessCapitalCommand } from "../transactions/businessCapital";
import {
  investigateRecurringOpportunity,
  setPlayerFocus,
} from "../opportunities/recurring";
import {
  acceptPlayerLoanFinancingOffer,
  submitPlayerLoanFinancingOffer,
} from "../transactions/cashBusinessPurchase.js";
import { applyJointPropertyCommand } from "../transactions/jointProperty";
import { applyPropertyAcquisitionCommand } from "../transactions/propertyAcquisition";
import { type ActionResult, applyAction } from "./actions.js";
import { applyCareerCommand } from "./career";
import {
  advanceSpotlight,
  beginRound,
  cancelActiveTransactionAndAdvanceSpotlight,
  closeCashBusinessPurchaseAndAdvanceSpotlight,
} from "./round.js";

export interface WireChooseObjectiveCommand {
  readonly type: "CHOOSE_OBJECTIVE";
  readonly objectiveId: string;
}

export interface WireBeginRoundCommand {
  readonly type: "BEGIN_ROUND";
}

export interface WirePassSpotlightCommand {
  readonly type: "PASS_SPOTLIGHT";
}

export interface WireInvestigateOpportunityCommand {
  readonly type: "INVESTIGATE_OPPORTUNITY";
  readonly opportunityId: string;
}

export interface WirePursueBusinessCashCommand {
  readonly type: "PURSUE_BUSINESS_CASH";
  readonly opportunityId: string;
}

export interface WirePursueBusinessWithPlayerLoanCommand {
  readonly type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN";
  readonly opportunityId: string;
  readonly buyerCashContributionCents: number;
  readonly requestedPrincipalCents: number;
}

export interface WireSubmitPlayerLoanOfferCommand {
  readonly type: "SUBMIT_PLAYER_LOAN_OFFER";
  readonly transactionId: string;
  readonly annualRateBps: number;
  readonly termQuarters: number;
}

export interface WireAcceptPlayerLoanOfferCommand {
  readonly type: "ACCEPT_PLAYER_LOAN_OFFER";
  readonly transactionId: string;
  readonly expectedTermsRevision: number;
}

export interface WireCloseBusinessPurchaseCommand {
  readonly type: "CLOSE_BUSINESS_PURCHASE";
  readonly transactionId: string;
}

export interface WireCancelActiveTransactionCommand {
  readonly type: "CANCEL_ACTIVE_TRANSACTION";
  readonly transactionId: string;
}

export type WirePlayerCommand =
  | PropertyAcquisitionCommand
  | BusinessAuctionCommand
  | JointPropertyCommand
  | BusinessCapitalCommand
  | PropertyCommand
  | ExpandBusinessCommandPayload
  | SetFocusCommandPayload
  | TradePublicMarketsCommandPayload
  | AcceptCareerOfferCommandPayload
  | ResignLaborCommandPayload
  | WireChooseObjectiveCommand
  | WireBeginRoundCommand
  | WirePassSpotlightCommand
  | WireInvestigateOpportunityCommand
  | WirePursueBusinessCashCommand
  | WirePursueBusinessWithPlayerLoanCommand
  | WireSubmitPlayerLoanOfferCommand
  | WireAcceptPlayerLoanOfferCommand
  | WireCloseBusinessPurchaseCommand
  | WireCancelActiveTransactionCommand;

/**
 * Pure engine player command adapter.
 *
 * Translates an authenticated actor and an untrusted wire command into an
 * engine action. Discards any actor or identity fields inside the wire payload,
 * enforcing that actor identity is strictly server-derived.
 *
 * Standard V1 player commands:
 * - CHOOSE_OBJECTIVE
 * - BEGIN_ROUND
 * - PASS_SPOTLIGHT
 * - INVESTIGATE_OPPORTUNITY
 * - PURSUE_BUSINESS_CASH
 * - PURSUE_BUSINESS_WITH_PLAYER_LOAN
 * - SUBMIT_PLAYER_LOAN_OFFER
 * - ACCEPT_PLAYER_LOAN_OFFER
 * - CLOSE_BUSINESS_PURCHASE
 * - CANCEL_ACTIVE_TRANSACTION
 */
export function applyPlayerCommand(
  state: GameState,
  actorPlayerId: PlayerId,
  wireCommand: WirePlayerCommand,
): ActionResult {
  if (!wireCommand || typeof wireCommand !== "object") {
    return {
      ok: false,
      state,
      code: "INVALID_ACTION",
      journalEntries: [],
    };
  }

  if (state.phase === "finished")
    return { ok: false, state, code: "WRONG_PHASE", journalEntries: [] };

  switch (wireCommand.type) {
    case "OPEN_BUSINESS_AUCTION":
    case "RESPOND_BUSINESS_AUCTION":
      return applyBusinessAuctionCommand(state, actorPlayerId, wireCommand);
    case "OPEN_PROPERTY_ACQUISITION":
    case "REVISE_PROPERTY_ACQUISITION":
    case "CONFIRM_PROPERTY_ACQUISITION":
    case "WITHDRAW_PROPERTY_ACQUISITION":
    case "CLOSE_PROPERTY_ACQUISITION":
    case "CANCEL_PROPERTY_ACQUISITION":
      return applyPropertyAcquisitionCommand(state, actorPlayerId, wireCommand);
    case "OPEN_JOINT_PROPERTY":
    case "REVISE_JOINT_PROPERTY":
    case "CONFIRM_JOINT_PROPERTY":
    case "WITHDRAW_JOINT_PROPERTY":
    case "CLOSE_JOINT_PROPERTY":
    case "CANCEL_JOINT_PROPERTY":
      return applyJointPropertyCommand(state, actorPlayerId, wireCommand);
    case "OPEN_BUSINESS_CAPITAL":
    case "REVISE_BUSINESS_CAPITAL":
    case "CONFIRM_BUSINESS_CAPITAL":
    case "WITHDRAW_BUSINESS_CAPITAL":
    case "CLOSE_BUSINESS_CAPITAL":
    case "OFFER_BUSINESS_LOAN":
    case "SELECT_BUSINESS_LOAN":
    case "WITHDRAW_BUSINESS_LOAN":
    case "OFFER_BUSINESS_EQUITY":
    case "SELECT_BUSINESS_EQUITY":
    case "WITHDRAW_BUSINESS_EQUITY":
      return applyBusinessCapitalCommand(state, actorPlayerId, wireCommand);
    case "BUY_PROPERTY":
    case "SELL_PROPERTY":
    case "REFINANCE_PROPERTY":
    case "RENOVATE_PROPERTY":
    case "FUND_PROPERTY_RESERVE":
      return applyPropertyCommand(state, actorPlayerId, wireCommand);
    case "EXPAND_BUSINESS":
      return expandBusinessAndAdvanceSpotlight(
        state,
        actorPlayerId,
        wireCommand,
      );
    case "SET_FOCUS":
      return setPlayerFocus(state, actorPlayerId, wireCommand.focus);
    case "TRADE_PUBLIC_MARKETS":
      return tradePublicMarketsAndAdvanceSpotlight(
        state,
        actorPlayerId,
        wireCommand.trades,
      );
    case "ACCEPT_CAREER_OFFER":
      if (typeof wireCommand.offerId !== "string" || !wireCommand.offerId)
        return { ok: false, state, code: "INVALID_ACTION", journalEntries: [] };
      return applyCareerCommand(state, actorPlayerId, wireCommand.offerId);
    case "RESIGN_LABOR":
      return applyCareerCommand(state, actorPlayerId, null);
    case "CHOOSE_OBJECTIVE": {
      if (typeof wireCommand.objectiveId !== "string") {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      return applyAction(state, {
        type: "CHOOSE_OBJECTIVE",
        playerId: actorPlayerId,
        objectiveId: wireCommand.objectiveId as ObjectiveId,
      });
    }

    case "BEGIN_ROUND": {
      return beginRound(state);
    }

    case "PASS_SPOTLIGHT": {
      return advanceSpotlight(state, actorPlayerId);
    }

    case "INVESTIGATE_OPPORTUNITY": {
      if (
        typeof wireCommand.opportunityId !== "string" ||
        !wireCommand.opportunityId
      ) {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      if (
        state.content.cardsByPlayer[actorPlayerId]?.id ===
        wireCommand.opportunityId
      )
        return investigateRecurringOpportunity(
          state,
          actorPlayerId,
          wireCommand.opportunityId,
        );
      const res = investigatePrivateBusinessPurchaseOpportunity(
        state,
        wireCommand.opportunityId as OpportunityId,
        actorPlayerId,
      );
      if (!res.ok) {
        return {
          ok: false,
          state: res.state,
          code: res.code,
          journalEntries: [],
        };
      }
      return {
        ok: true,
        state: res.state,
        journalEntries: [],
      };
    }

    case "PURSUE_BUSINESS_CASH": {
      if (
        typeof wireCommand.opportunityId !== "string" ||
        !wireCommand.opportunityId
      ) {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      const res = pursuePrivateBusinessPurchaseOpportunity(
        state,
        wireCommand.opportunityId as OpportunityId,
        actorPlayerId,
      );
      if (!res.ok) {
        const code =
          res.code === "TRANSACTION_REJECTED" ? res.transactionCode : res.code;
        return {
          ok: false,
          state: res.state,
          code,
          journalEntries: [],
        };
      }
      return {
        ok: true,
        state: res.state,
        journalEntries: [],
      };
    }

    case "PURSUE_BUSINESS_WITH_PLAYER_LOAN": {
      if (
        typeof wireCommand.opportunityId !== "string" ||
        !wireCommand.opportunityId ||
        typeof wireCommand.buyerCashContributionCents !== "number" ||
        typeof wireCommand.requestedPrincipalCents !== "number"
      ) {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      const res = pursuePrivateBusinessPurchaseOpportunityWithFinancingRequest(
        state,
        wireCommand.opportunityId as OpportunityId,
        actorPlayerId,
        {
          buyerCashContributionCents: wireCommand.buyerCashContributionCents,
          requestedPrincipalCents: wireCommand.requestedPrincipalCents,
        },
      );
      if (!res.ok) {
        const code =
          res.code === "TRANSACTION_REJECTED" ? res.transactionCode : res.code;
        return {
          ok: false,
          state: res.state,
          code,
          journalEntries: [],
        };
      }
      return {
        ok: true,
        state: res.state,
        journalEntries: [],
      };
    }

    case "SUBMIT_PLAYER_LOAN_OFFER": {
      if (
        typeof wireCommand.transactionId !== "string" ||
        !wireCommand.transactionId ||
        typeof wireCommand.annualRateBps !== "number" ||
        typeof wireCommand.termQuarters !== "number"
      ) {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      const res = submitPlayerLoanFinancingOffer(
        state,
        wireCommand.transactionId as TransactionId,
        actorPlayerId,
        {
          annualRateBps: wireCommand.annualRateBps,
          termQuarters: wireCommand.termQuarters,
        },
      );
      if (!res.ok) {
        return {
          ok: false,
          state: res.state,
          code: res.code,
          journalEntries: [],
        };
      }
      return {
        ok: true,
        state: res.state,
        journalEntries: res.journalEntries,
      };
    }

    case "ACCEPT_PLAYER_LOAN_OFFER": {
      if (
        typeof wireCommand.transactionId !== "string" ||
        !wireCommand.transactionId ||
        typeof wireCommand.expectedTermsRevision !== "number"
      ) {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      const res = acceptPlayerLoanFinancingOffer(
        state,
        wireCommand.transactionId as TransactionId,
        actorPlayerId,
        wireCommand.expectedTermsRevision,
      );
      if (!res.ok) {
        return {
          ok: false,
          state: res.state,
          code: res.code,
          journalEntries: [],
        };
      }
      return {
        ok: true,
        state: res.state,
        journalEntries: res.journalEntries,
      };
    }

    case "CLOSE_BUSINESS_PURCHASE": {
      if (
        typeof wireCommand.transactionId !== "string" ||
        !wireCommand.transactionId
      ) {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      return closeCashBusinessPurchaseAndAdvanceSpotlight(
        state,
        actorPlayerId,
        wireCommand.transactionId as TransactionId,
      );
    }

    case "CANCEL_ACTIVE_TRANSACTION": {
      if (
        typeof wireCommand.transactionId !== "string" ||
        !wireCommand.transactionId
      ) {
        return {
          ok: false,
          state,
          code: "INVALID_ACTION",
          journalEntries: [],
        };
      }
      return cancelActiveTransactionAndAdvanceSpotlight(
        state,
        actorPlayerId,
        wireCommand.transactionId as TransactionId,
      );
    }

    default: {
      return {
        ok: false,
        state,
        code: "INVALID_ACTION",
        journalEntries: [],
      };
    }
  }
}
