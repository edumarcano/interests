import {
  FINANCIER_FINALE_BORROWER,
  type ObjectiveId,
  RECURRING_CONTENT_TEMPLATES,
} from "@interests/rules";
import type { PlayerId, StandingFinaleOfferView } from "@interests/shared";
import { cents } from "../finance/money";
import {
  materializeNpcFundingTerms,
  quoteNpcFunding,
} from "../finance/npcLending";
import { nextDeterministicId } from "../game/deterministicIds";
import type { GameState } from "../model/gameState";
import {
  type RecurringOpportunity,
  recurringInvestigationFeeCents,
} from "../opportunities/recurring";
import { getRecurringAcquisitionQuotes } from "../opportunities/recurringPurchase";

/** A draft-only match uses the next canonical ID. Viewing it changes no state or randomness. */
export function stageStandingFinaleOffer(
  state: GameState,
  player: PlayerId,
  objective: ObjectiveId,
) {
  if (
    state.phase !== "ready-for-first-round" ||
    state.content.scenario !== "standard-v1" ||
    state.counters.opportunity >= Number.MAX_SAFE_INTEGER
  )
    return null;
  const templateId =
    objective === "financier"
      ? FINANCIER_FINALE_BORROWER.cardTemplateId
      : objective === "property-magnate"
        ? "residential-income-court"
        : null;
  if (!templateId) return null;
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (item) => item.id === templateId,
  );
  if (!template) throw new Error("Missing standing finale template");
  const next = nextDeterministicId("opportunity", state.counters);
  const price = cents(template.askingPriceCents);
  const fundingTerms =
    objective === "financier"
      ? materializeNpcFundingTerms(
          template.id,
          price,
          state.economy.baseRateBps,
        )
      : null;
  if (objective === "financier" && !fundingTerms)
    throw new Error("Missing standing market loan terms");
  const card: RecurringOpportunity = {
    id: next.id,
    targetPlayerId: player,
    templateId: template.id,
    category: template.category,
    createdQuarter: state.currentQuarter,
    status: "available",
    askingPriceCents: price,
    investigationFeeCents: template.facts
      ? recurringInvestigationFeeCents(price)
      : cents(0),
    investigated: false,
    facts: template.facts,
    ...(fundingTerms ? { npcFundingTerms: fundingTerms } : {}),
  };
  const staged: GameState = {
    ...state,
    counters: next.counters,
    content: {
      ...state.content,
      cardsByPlayer: { ...state.content.cardsByPlayer, [player]: card },
    },
  };
  return { state: staged, card, name: template.name };
}

export function projectStandingFinaleOffer(
  state: GameState,
  player: PlayerId,
  objective: ObjectiveId,
): StandingFinaleOfferView | undefined {
  const staged = stageStandingFinaleOffer(state, player, objective);
  if (!staged) return undefined;
  const { card } = staged;
  if (card.npcFundingTerms) {
    const quote = quoteNpcFunding(state, player, card.npcFundingTerms);
    return quote
      ? { kind: "financing", opportunityId: card.id, quote }
      : undefined;
  }
  return {
    kind: "landmark",
    name: staged.name,
    opportunityId: card.id,
    quotes: getRecurringAcquisitionQuotes(staged.state, player, card.id),
  };
}
