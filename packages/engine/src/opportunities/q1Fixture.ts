import type { AssetId, OpportunityId, PlayerId } from "@interests/shared";
import { type Cents, cents } from "../finance/money";
import { ownershipPpm } from "../finance/ownership";
import { nextDeterministicId } from "../game/deterministicIds";
import type {
  Asset,
  BusinessAsset,
  DeterministicCounters,
} from "../model/gameState";
import type {
  BusinessPurchaseDueDiligence,
  Opportunity,
  PrivateBusinessPurchaseOpportunity,
} from "./model";

export const Q1_FIXTURE_ANNUAL_REVENUE_CENTS = 8_000_000;
export const Q1_FIXTURE_ANNUAL_OPERATING_PROFIT_CENTS = 1_500_000;
export const Q1_FIXTURE_ENTERPRISE_VALUE_CENTS = 6_000_000;
export const Q1_FIXTURE_BUSINESS_DEBT_PRINCIPAL_CENTS = 0;
export const Q1_FIXTURE_ASKING_PRICE_CENTS = 5_000_000;
export const Q1_FIXTURE_SELLER_OWNERSHIP_PPM = 1_000_000;

export interface Q1FixtureRoles {
  readonly targetBuyerPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
}

/**
 * Deterministically select target buyer and seller for the Q1 business opportunity fixture:
 * - Target buyer: among players whose initial cash is strictly less than 5_000_000 cents,
 *   choose the player with the HIGHEST cash; tie-break by canonical playerOrder.
 * - Seller: next player in canonical playerOrder after target buyer, wrapping cyclically.
 */
export function selectQ1FixtureRoles(
  playerOrder: readonly PlayerId[],
  cashByPlayer: Readonly<Record<PlayerId, Cents>>,
): Q1FixtureRoles {
  let targetBuyerPlayerId: PlayerId | null = null;
  let bestCash = -1;

  for (const playerId of playerOrder) {
    const cash = cashByPlayer[playerId];
    if (cash !== undefined && cash < Q1_FIXTURE_ASKING_PRICE_CENTS) {
      if (cash > bestCash) {
        bestCash = cash;
        targetBuyerPlayerId = playerId;
      }
    }
  }

  if (targetBuyerPlayerId === null) {
    throw new Error(
      "Setup invariant failed: no eligible player found for Q1 opportunity",
    );
  }

  const buyerIndex = playerOrder.indexOf(targetBuyerPlayerId);
  if (buyerIndex === -1) {
    throw new Error(
      "Setup invariant failed: target buyer not found in playerOrder",
    );
  }

  const sellerIndex = (buyerIndex + 1) % playerOrder.length;
  const sellerPlayerId = playerOrder[sellerIndex];
  if (!sellerPlayerId || sellerPlayerId === targetBuyerPlayerId) {
    throw new Error("Setup invariant failed: could not select distinct seller");
  }

  return { targetBuyerPlayerId, sellerPlayerId };
}

export interface AttachQ1FixtureResult {
  readonly assetsById: Record<AssetId, Asset>;
  readonly opportunitiesById: Record<OpportunityId, Opportunity>;
  readonly counters: DeterministicCounters;
  readonly targetBuyerPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly assetId: AssetId;
  readonly opportunityId: OpportunityId;
}

/**
 * Creates and attaches the Milestone-6 Standard V1 Q1 vertical-slice debt-free business asset
 * and private business-purchase opportunity.
 *
 * Guaranteed properties:
 * - Deterministic asset and opportunity IDs advancing counters
 * - Consumes NO gameplay RNG draws
 * - Keeps initial GameState.revision === 0
 * - Diligence facts pregenerated from underlying asset
 * - Opportunity created with status: "available" and investigated: false
 * - Private to target buyer
 */
export function attachQ1BusinessOpportunityFixture(
  assetsById: Record<AssetId, Asset>,
  opportunitiesById: Record<OpportunityId, Opportunity>,
  counters: DeterministicCounters,
  playerOrder: readonly PlayerId[],
  cashByPlayer: Readonly<Record<PlayerId, Cents>>,
  createdQuarter = 1,
): AttachQ1FixtureResult {
  const { targetBuyerPlayerId, sellerPlayerId } = selectQ1FixtureRoles(
    playerOrder,
    cashByPlayer,
  );

  // 1. Allocate deterministic AssetId
  const { id: assetId, counters: countersAfterAsset } = nextDeterministicId(
    "asset",
    counters,
  );

  const businessAsset: BusinessAsset = {
    id: assetId,
    kind: "business",
    annualRevenueCents: cents(Q1_FIXTURE_ANNUAL_REVENUE_CENTS),
    annualOperatingProfitCents: cents(Q1_FIXTURE_ANNUAL_OPERATING_PROFIT_CENTS),
    enterpriseValueCents: cents(Q1_FIXTURE_ENTERPRISE_VALUE_CENTS),
    debtPrincipalCents: cents(Q1_FIXTURE_BUSINESS_DEBT_PRINCIPAL_CENTS),
    ownershipByPlayerPpm: {
      [sellerPlayerId]: ownershipPpm(Q1_FIXTURE_SELLER_OWNERSHIP_PPM),
    },
  };

  // 2. Allocate deterministic OpportunityId
  const { id: opportunityId, counters: countersAfterOpp } = nextDeterministicId(
    "opportunity",
    countersAfterAsset,
  );

  const facts: BusinessPurchaseDueDiligence = {
    annualRevenueCents: businessAsset.annualRevenueCents,
    annualOperatingProfitCents: businessAsset.annualOperatingProfitCents,
    enterpriseValueCents: businessAsset.enterpriseValueCents,
    debtPrincipalCents: businessAsset.debtPrincipalCents,
  };

  const opportunity: PrivateBusinessPurchaseOpportunity = {
    id: opportunityId,
    kind: "private-business-purchase",
    access: "private",
    targetPlayerId: targetBuyerPlayerId,
    sellerPlayerId,
    assetId,
    askingPriceCents: cents(Q1_FIXTURE_ASKING_PRICE_CENTS),
    createdQuarter,
    investigation: {
      investigated: false,
      facts,
    },
    status: "available",
  };

  return {
    assetsById: {
      ...assetsById,
      [assetId]: businessAsset,
    },
    opportunitiesById: {
      ...opportunitiesById,
      [opportunityId]: opportunity,
    },
    counters: countersAfterOpp,
    targetBuyerPlayerId,
    sellerPlayerId,
    assetId,
    opportunityId,
  };
}
