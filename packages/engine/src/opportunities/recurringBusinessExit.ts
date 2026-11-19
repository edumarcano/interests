import { RECURRING_CONTENT_RULES } from "@interests/rules";
import type {
  AssetId,
  PlayerId,
  RecurringBusinessExitQuote,
} from "@interests/shared";
import { roundedRatio } from "../finance/bank";
import {
  draftMatchedBusinessExit,
  type MatchedIndependentBusinessBuyer,
  quoteMatchedBusinessExit,
} from "../finance/businessExit";
import type { ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type { BusinessAsset, GameState } from "../model/gameState";
import type { RecurringOpportunity } from "./recurring";

export interface RecurringBusinessBuyer {
  readonly assetId: AssetId;
  readonly buyerId: string;
  readonly referenceEnterpriseValueCents: number;
  readonly operatingEnterpriseBidCents: number;
}
/** Actual settled ownership/operation is required; forecasts and recent purchases do not season a company. */
export function seasonedSoleOwnedBusinesses(
  state: GameState,
  player: PlayerId,
): BusinessAsset[] {
  if (state.lastSettledQuarter < 1) return [];
  const progress = state.progress.byPlayer[player];
  return Object.values(state.finance.assetsById)
    .filter(
      (asset): asset is BusinessAsset =>
        asset.kind === "business" &&
        !asset.npcSale &&
        asset.enterpriseValueCents > 0 &&
        asset.ownershipByPlayerPpm[player] === 1_000_000 &&
        (progress?.assetsById[asset.id]?.acquiredQuarter ??
          Number.MAX_SAFE_INTEGER) <= state.lastSettledQuarter &&
        progress!.quarters.some((quarter) =>
          Object.hasOwn(quarter.companyOperatingProfitById, asset.id),
        ),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function matchedBuyer(
  state: GameState,
  player: PlayerId,
  card: RecurringOpportunity,
): MatchedIndependentBusinessBuyer | null {
  const buyer = card.businessBuyer,
    asset = buyer ? state.finance.assetsById[buyer.assetId] : null;
  if (
    !buyer ||
    asset?.kind !== "business" ||
    asset.npcSale ||
    asset.ownershipByPlayerPpm[player] !== 1_000_000
  )
    return null;
  return {
    kind: "matched-independent-business-buyer",
    quoteId: card.id,
    buyerId: buyer.buyerId,
    assetId: buyer.assetId,
    quarter: card.createdQuarter,
    operatingEnterpriseBidCents: buyer.operatingEnterpriseBidCents,
    retainedCompanyCashCents: asset.cashCents,
    sellerOwnershipByPlayerPpm: {
      [player]: asset.ownershipByPlayerPpm[player],
    },
  };
}
export function recurringBusinessExitQuote(
  state: GameState,
  player: PlayerId,
): RecurringBusinessExitQuote | null {
  const card = state.content.cardsByPlayer[player];
  if (
    !card ||
    card.targetPlayerId !== player ||
    card.status !== "available" ||
    card.createdQuarter !== state.currentQuarter
  )
    return null;
  const buyer = matchedBuyer(state, player, card);
  if (!buyer) return null;
  const quoted = quoteMatchedBusinessExit(state, buyer);
  if (!quoted.ok) return null;
  const quote = quoted.quote;
  return {
    id: [
      card.id,
      "exit",
      state.revision,
      buyer.assetId,
      buyer.operatingEnterpriseBidCents,
      buyer.retainedCompanyCashCents,
      quote.saleFeeCents,
      quote.operatingArrearsPaidCents,
      quote.workArrearsPaidCents,
      quote.netOwnerProceedsCents,
      ...quote.bankPayoffs.flatMap((claim) => [
        claim.loanId,
        claim.principalCents,
        claim.interestCents,
      ]),
    ].join(":"),
    assetId: buyer.assetId,
    operatingEnterpriseBidCents: buyer.operatingEnterpriseBidCents,
    referenceEnterpriseValueCents:
      card.businessBuyer!.referenceEnterpriseValueCents,
    companyCashIncludedCents: buyer.retainedCompanyCashCents,
    grossConsiderationCents: quote.grossConsiderationCents,
    saleFeeCents: quote.saleFeeCents,
    bankPayoffCents: quote.bankPayoffCents,
    bankInterestPaidCents: quote.bankInterestPaidCents,
    operatingArrearsPaidCents: quote.operatingArrearsPaidCents,
    workArrearsPaidCents: quote.workArrearsPaidCents,
    sellerNetCents: quote.netOwnerProceedsCents,
  };
}
export function sellRecurringBusiness(
  state: GameState,
  player: PlayerId,
  opportunityId: string,
  quoteId: string,
): ActionResult {
  const reject = (
    code:
      | "WRONG_PHASE"
      | "NOT_ACTIVE_SPOTLIGHT"
      | "ACTIVE_TRANSACTION"
      | "NOT_FOUND_OR_NOT_VISIBLE"
      | "OPPORTUNITY_NOT_AVAILABLE"
      | "INVALID_ACTION"
      | "COUNTER_EXHAUSTED",
  ): ActionResult => ({ ok: false, code, state, journalEntries: [] });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  const card = state.content.cardsByPlayer[player];
  if (
    !card ||
    card.id !== opportunityId ||
    card.targetPlayerId !== player ||
    !card.businessBuyer
  )
    return reject("NOT_FOUND_OR_NOT_VISIBLE");
  if (
    card.status !== "available" ||
    card.createdQuarter !== state.currentQuarter
  )
    return reject("OPPORTUNITY_NOT_AVAILABLE");
  if (getActiveSpotlightPlayerId(state) !== player)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
  const preview = recurringBusinessExitQuote(state, player),
    buyer = matchedBuyer(state, player, card);
  if (!preview || preview.id !== quoteId || !buyer)
    return reject("INVALID_ACTION");
  if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
    return reject("COUNTER_EXHAUSTED");
  const next = nextDeterministicId("transaction", state.counters),
    quoted = quoteMatchedBusinessExit(state, buyer);
  if (!quoted.ok) return reject("INVALID_ACTION");
  const draft = draftMatchedBusinessExit(
    { ...state, counters: next.counters },
    player,
    next.id,
    buyer,
    quoted.quote,
  );
  if (!draft.ok) return reject("INVALID_ACTION");
  const consumed = {
    ...draft.state,
    content: {
      ...draft.state.content,
      cardsByPlayer: {
        ...draft.state.content.cardsByPlayer,
        [player]: {
          ...card,
          status: "completed" as const,
          disposedAssetId: buyer.assetId,
        },
      },
    },
  };
  const advanced = advanceSpotlight(consumed, player);
  if (!advanced.ok) return { ...advanced, state, journalEntries: [] };
  return {
    ...advanced,
    journalEntries: [...draft.journalEntries, ...advanced.journalEntries],
  };
}

/** Persist this single authored bid at genesis, after the existing content-stream price draw. */
export function authorRecurringBusinessBuyer(
  state: GameState,
  player: PlayerId,
  opportunityId: string,
  priceNoiseBps: number,
): RecurringBusinessBuyer {
  const asset = seasonedSoleOwnedBusinesses(state, player)[0];
  if (
    !asset ||
    Math.abs(priceNoiseBps) > RECURRING_CONTENT_RULES.askingPriceVariationBps
  )
    throw new Error("No eligible matched business buyer");
  return {
    assetId: asset.id,
    buyerId: `independent-buyer:${opportunityId}`,
    referenceEnterpriseValueCents: asset.enterpriseValueCents,
    operatingEnterpriseBidCents: roundedRatio(
      asset.enterpriseValueCents,
      10_000 + priceNoiseBps,
    ),
  };
}
