import {
  OBJECTIVE_MEASUREMENT_RULES,
  RECURRING_CATEGORIES,
  RECURRING_CONTENT_RULES,
  RECURRING_CONTENT_TEMPLATES,
} from "@interests/rules";
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
      !["available", "expired", "acquired"].includes(card.status) ||
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
