import type { OpportunityId, PlayerId } from "@finance-game/shared";

import { cents } from "../finance/money";
import { TOTAL_OWNERSHIP_PPM } from "../finance/ownership";
import { nextDeterministicId } from "../game/deterministicIds";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { openCashBusinessPurchaseTransaction } from "../transactions/cashBusinessPurchase";
import type {
  BusinessPurchaseDueDiligence,
  CreateOpportunityErrorCode,
  CreateOpportunityResult,
  CreatePrivateBusinessPurchaseOpportunityInput,
  InvestigateOpportunityErrorCode,
  InvestigateOpportunityResult,
  PrivateBusinessPurchaseOpportunity,
  PursueOpportunityErrorCode,
  PursueOpportunityResult,
} from "./model";

/**
 * Pure domain function to create a private business-purchase opportunity.
 * Snapshots due-diligence facts deterministically without consuming gameplay RNG.
 */
export function createPrivateBusinessPurchaseOpportunity(
  state: GameState,
  input: CreatePrivateBusinessPurchaseOpportunityInput,
): CreateOpportunityResult {
  const reject = (
    code: CreateOpportunityErrorCode,
  ): CreateOpportunityResult => ({
    ok: false,
    state,
    code,
  });

  // 1. Phase validation: must have completed setup
  if (state.phase !== "ready-for-first-round") {
    return reject("WRONG_PHASE");
  }

  // 2. Parties validation: must exist and be distinct
  if (!state.players[input.targetPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }
  if (!state.players[input.sellerPlayerId]) {
    return reject("UNKNOWN_PLAYER");
  }
  if (input.targetPlayerId === input.sellerPlayerId) {
    return reject("SAME_PARTY");
  }

  // 3. Asset validation: must exist, be a business, and be debt-free
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

  // 4. Ownership validation: seller must be sole 100% owner
  const sellerOwnership = asset.ownershipByPlayerPpm[input.sellerPlayerId];
  const ownerCount = Object.keys(asset.ownershipByPlayerPpm).length;
  if (sellerOwnership !== TOTAL_OWNERSHIP_PPM || ownerCount !== 1) {
    return reject("SELLER_NOT_SOLE_OWNER");
  }

  // 5. Price validation: must be a positive safe integer cents
  if (
    !Number.isSafeInteger(input.askingPriceCents) ||
    input.askingPriceCents <= 0
  ) {
    return reject("INVALID_PRICE");
  }

  // 6. Preflight deterministic opportunity counter exhaustion
  if (state.counters.opportunity >= Number.MAX_SAFE_INTEGER) {
    return reject("OPPORTUNITY_ID_EXHAUSTED");
  }

  // 7. Generate deterministic opportunity ID
  const { id: opportunityId, counters: nextCounters } = nextDeterministicId(
    "opportunity",
    state.counters,
  );

  // 8. Snapshot due-diligence facts from underlying business
  const facts: BusinessPurchaseDueDiligence = {
    annualRevenueCents: asset.annualRevenueCents,
    annualOperatingProfitCents: asset.annualOperatingProfitCents,
    enterpriseValueCents: asset.enterpriseValueCents,
    debtPrincipalCents: asset.debtPrincipalCents,
  };

  const opportunity: PrivateBusinessPurchaseOpportunity = {
    id: opportunityId,
    kind: "private-business-purchase",
    access: "private",
    targetPlayerId: input.targetPlayerId,
    sellerPlayerId: input.sellerPlayerId,
    assetId: input.assetId,
    askingPriceCents: cents(input.askingPriceCents),
    createdQuarter: state.currentQuarter,
    investigation: {
      investigated: false,
      facts,
    },
    status: "available",
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    counters: nextCounters,
    opportunitiesById: {
      ...state.opportunitiesById,
      [opportunityId]: opportunity,
    },
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    opportunityId,
  };
}

/**
 * Pure domain function to investigate a private business-purchase opportunity.
 * Unlocks stored pregenerated due-diligence facts without consuming cash, RNG, or IDs.
 */
export function investigatePrivateBusinessPurchaseOpportunity(
  state: GameState,
  opportunityId: OpportunityId,
  playerId: PlayerId,
): InvestigateOpportunityResult {
  const reject = (
    code: InvestigateOpportunityErrorCode,
  ): InvestigateOpportunityResult => ({
    ok: false,
    state,
    code,
  });

  const opportunity = state.opportunitiesById[opportunityId];
  if (
    !opportunity ||
    (opportunity.access === "private" &&
      opportunity.targetPlayerId !== playerId)
  ) {
    return reject("NOT_FOUND_OR_NOT_VISIBLE");
  }

  if (opportunity.status !== "available") {
    return reject("OPPORTUNITY_NOT_AVAILABLE");
  }

  if (opportunity.investigation.investigated) {
    return reject("ALREADY_INVESTIGATED");
  }

  const updatedOpportunity: PrivateBusinessPurchaseOpportunity = {
    ...opportunity,
    investigation: {
      ...opportunity.investigation,
      investigated: true,
    },
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    opportunitiesById: {
      ...state.opportunitiesById,
      [opportunityId]: updatedOpportunity,
    },
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    opportunityId,
  };
}

/**
 * Pure domain function to pursue a private business-purchase opportunity.
 * Delegates legality and cash reservation directly to the PR #13 transaction kernel.
 */
export function pursuePrivateBusinessPurchaseOpportunity(
  state: GameState,
  opportunityId: OpportunityId,
  playerId: PlayerId,
): PursueOpportunityResult {
  const reject = (
    code: Exclude<PursueOpportunityErrorCode, "TRANSACTION_REJECTED">,
  ): PursueOpportunityResult => ({
    ok: false,
    state,
    code,
  });

  const opportunity = state.opportunitiesById[opportunityId];
  if (
    !opportunity ||
    (opportunity.access === "private" &&
      opportunity.targetPlayerId !== playerId)
  ) {
    return reject("NOT_FOUND_OR_NOT_VISIBLE");
  }

  if (opportunity.status !== "available") {
    return reject("OPPORTUNITY_NOT_AVAILABLE");
  }

  // Delegate directly to transaction kernel
  const txResult = openCashBusinessPurchaseTransaction(state, {
    buyerPlayerId: opportunity.targetPlayerId,
    sellerPlayerId: opportunity.sellerPlayerId,
    assetId: opportunity.assetId,
    purchasePriceCents: opportunity.askingPriceCents,
  });

  if (!txResult.ok) {
    return {
      ok: false,
      state,
      code: "TRANSACTION_REJECTED",
      transactionCode: txResult.code,
    };
  }

  const transactionId = txResult.transactionId;
  if (!transactionId) {
    throw new Error(
      "Invariant failed: openCashBusinessPurchaseTransaction reported success without returning a transactionId",
    );
  }

  const pursuedOpportunity: PrivateBusinessPurchaseOpportunity = {
    ...opportunity,
    status: "pursued",
    relatedTransactionId: transactionId,
  };

  // One atomic transition: do not increment revision a second time
  const nextState: GameState = {
    ...txResult.state,
    opportunitiesById: {
      ...txResult.state.opportunitiesById,
      [opportunityId]: pursuedOpportunity,
    },
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    opportunityId,
    transactionId,
  };
}
