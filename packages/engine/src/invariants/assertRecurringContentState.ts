import {
  OBJECTIVE_MEASUREMENT_RULES,
  RECURRING_CATEGORIES,
  RECURRING_CONTENT_RULES,
  RECURRING_CONTENT_TEMPLATES,
} from "@interests/rules";
import { roundedRatio } from "../finance/bank";
import { materializeNpcFundingTerms } from "../finance/npcLending";
import type { GameState } from "../model/gameState";
import { recurringInvestigationFeeCents } from "../opportunities/recurring";
import { isValidRandomState } from "../random/prng";

export function assertRecurringContentState(state: GameState): void {
  const content = state.content;
  if (
    !content ||
    typeof content !== "object" ||
    !["standard-v1", "q1-business-diagnostic"].includes(content.scenario) ||
    !isValidRandomState(content.random)
  )
    throw new Error("Invalid recurring content state");
  if (
    !Number.isSafeInteger(content.generatedQuarter) ||
    content.generatedQuarter < 0 ||
    content.generatedQuarter >
      Math.min(
        state.currentQuarter,
        OBJECTIVE_MEASUREMENT_RULES.safetyDrawQuarter,
      )
  )
    throw new Error("Invalid content generation quarter");
  for (const record of [
    content.cardsByPlayer,
    content.recentCategoriesByPlayer,
  ]) {
    if (
      !record ||
      typeof record !== "object" ||
      Object.keys(record).length !== state.playerOrder.length ||
      state.playerOrder.some((player) => !Object.hasOwn(record, player))
    )
      throw new Error("Invalid content recipient keys");
  }
  const ids = new Set<string>();
  for (const player of state.playerOrder) {
    const recent = content.recentCategoriesByPlayer[player];
    if (
      !Array.isArray(recent) ||
      recent.length > RECURRING_CONTENT_RULES.recentCategoryLookback ||
      recent.some((category) => !RECURRING_CATEGORIES.includes(category))
    )
      throw new Error("Invalid recent content categories");
    const card = content.cardsByPlayer[player];
    if (content.scenario === "q1-business-diagnostic") {
      if (
        card !== null ||
        content.generatedQuarter !== 0 ||
        recent.length !== 0
      )
        throw new Error("Diagnostic scenario generated ordinary content");
      continue;
    }
    if (
      !card ||
      card.targetPlayerId !== player ||
      card.createdQuarter !== content.generatedQuarter ||
      !["available", "expired", "acquired", "funded", "completed"].includes(
        card.status,
      ) ||
      typeof card.investigated !== "boolean" ||
      typeof card.id !== "string" ||
      card.id.length === 0 ||
      ids.has(card.id)
    )
      throw new Error("Invalid recurring opportunity");
    ids.add(card.id);
    if (card.status === "acquired") {
      if (
        !card.acquiredAssetId ||
        !state.finance.assetsById[card.acquiredAssetId]
      )
        throw new Error("Missing recurring acquired asset");
    } else if (card.acquiredAssetId !== undefined)
      throw new Error("Unexpected recurring acquired asset");
    const template = RECURRING_CONTENT_TEMPLATES.find(
      (candidate) => candidate.id === card.templateId,
    );
    if (
      !template ||
      card.category !== template.category ||
      !Number.isSafeInteger(card.askingPriceCents) ||
      card.askingPriceCents < 0 ||
      !Number.isSafeInteger(card.investigationFeeCents) ||
      card.investigationFeeCents < 0
    )
      throw new Error("Invalid recurring template terms");
    if (template.action === "npc-financing") {
      const expected = materializeNpcFundingTerms(
        card.templateId,
        card.askingPriceCents,
        state.economy.baseRateBps,
      );
      const terms = card.npcFundingTerms;
      if (
        !terms ||
        !expected ||
        Object.getPrototypeOf(terms) !== Object.prototype ||
        Object.keys(terms).length !== Object.keys(expected).length ||
        Object.entries(expected).some(
          ([key, value]) => terms[key as keyof typeof terms] !== value,
        ) ||
        card.status === "acquired"
      )
        throw new Error("Invalid frozen market loan quote");
      if (card.status === "funded") {
        const loan =
          card.fundedLoanId && state.finance.loansById[card.fundedLoanId];
        if (
          !loan ||
          loan.kind !== "npc-loan" ||
          loan.lenderPlayerId !== player ||
          loan.fundedOpportunityId !== card.id ||
          loan.originatedQuarter !== card.createdQuarter ||
          loan.borrowerId !== terms.borrowerId ||
          loan.borrowerName !== terms.borrowerName ||
          loan.originalPrincipalCents !== terms.principalCents ||
          loan.annualRateBps !== terms.annualRateBps ||
          loan.termQuarters !== terms.termQuarters ||
          loan.quarterlyRepaymentCapacityCents !==
            terms.quarterlyRepaymentCapacityCents
        )
          throw new Error("Missing matching funded market loan");
      } else if (card.fundedLoanId !== undefined)
        throw new Error("Unexpected funded loan");
    } else if (
      card.npcFundingTerms !== undefined ||
      card.fundedLoanId !== undefined ||
      card.status === "funded"
    )
      throw new Error("Unexpected market loan terms");
    if (template.action === "npc-business-exit") {
      const buyer = card.businessBuyer;
      if (
        !buyer ||
        !state.finance.assetsById[buyer.assetId] ||
        state.finance.assetsById[buyer.assetId]?.kind !== "business" ||
        buyer.buyerId !== `independent-buyer:${card.id}` ||
        !Number.isSafeInteger(buyer.referenceEnterpriseValueCents) ||
        buyer.referenceEnterpriseValueCents <= 0 ||
        !Number.isSafeInteger(buyer.operatingEnterpriseBidCents) ||
        buyer.operatingEnterpriseBidCents !== card.askingPriceCents ||
        buyer.operatingEnterpriseBidCents <
          roundedRatio(
            buyer.referenceEnterpriseValueCents,
            10_000 - RECURRING_CONTENT_RULES.askingPriceVariationBps,
          ) ||
        buyer.operatingEnterpriseBidCents >
          roundedRatio(
            buyer.referenceEnterpriseValueCents,
            10_000 + RECURRING_CONTENT_RULES.askingPriceVariationBps,
          )
      )
        throw new Error("Invalid persisted business buyer");
      if (card.status === "completed") {
        const sold = state.finance.assetsById[buyer.assetId];
        if (
          card.disposedAssetId !== buyer.assetId ||
          sold?.kind !== "business" ||
          sold.npcSale?.quoteId !== card.id
        )
          throw new Error("Invalid completed business exit");
      } else if (card.disposedAssetId !== undefined)
        throw new Error("Unexpected business disposal");
    } else if (
      card.businessBuyer !== undefined ||
      card.disposedAssetId !== undefined ||
      card.status === "completed"
    )
      throw new Error("Unexpected business buyer");
    if (template.facts === null) {
      if (
        card.facts !== null ||
        card.investigationFeeCents !== 0 ||
        card.investigated
      )
        throw new Error("Invalid nondiligence card");
    } else {
      if (
        card.investigationFeeCents !==
        recurringInvestigationFeeCents(card.askingPriceCents)
      )
        throw new Error("Invalid authoritative diligence fee");
      const facts = card.facts;
      const keys = Object.keys(template.facts);
      if (
        !facts ||
        Object.getPrototypeOf(facts) !== Object.prototype ||
        Object.keys(facts).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(facts, key)) ||
        Object.entries(facts).some(
          ([key, value]) =>
            key !== "kind" &&
            (!Number.isSafeInteger(value) ||
              typeof value !== "number" ||
              value < 0),
        ) ||
        facts.kind !== template.facts.kind
      )
        throw new Error("Invalid persistent diligence facts");
    }
  }
}
