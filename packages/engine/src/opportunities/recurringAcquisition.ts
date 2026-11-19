import {
  type PropertyMarketKind,
  RECURRING_CONTENT_TEMPLATES,
  TRANSACTION_FEES_BPS,
} from "@interests/rules";
import type {
  OpportunityId,
  PlayerId,
  RecurringOpportunityFacts,
} from "@interests/shared";
import { FinanceDecimal } from "../finance/decimal";
import { type Cents, cents, isNonNegativeCents } from "../finance/money";
import type { GameState } from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";

interface RecurringAcquisitionCommon {
  readonly opportunityId: OpportunityId;
  readonly templateId: string;
  readonly recipientPlayerId: PlayerId;
  readonly quarter: number;
  readonly askingPriceCents: Cents;
  readonly purchaseFeeCents: Cents;
  readonly totalCashRequiredCents: Cents;
  readonly cashAffordable: boolean;
}

/** Trusted close inputs, including hidden facts. Never send this result as a client projection. */
export type RecurringAcquisitionTerms =
  | (RecurringAcquisitionCommon & {
      readonly kind: "business";
      readonly facts: Extract<RecurringOpportunityFacts, { kind: "business" }>;
      readonly annualTotalOperatingCostsCents: Cents;
      readonly necessaryLabor: {
        readonly kind: "included-in-after-labor-profit";
        readonly explicitAnnualCostCents: null;
      };
    })
  | (RecurringAcquisitionCommon & {
      readonly kind: "property";
      readonly marketKind: PropertyMarketKind;
      readonly facts: Extract<RecurringOpportunityFacts, { kind: "property" }>;
    });
export type RecurringAcquisitionResult =
  | { readonly ok: true; readonly terms: RecurringAcquisitionTerms }
  | {
      readonly ok: false;
      readonly code:
        | "WRONG_PHASE"
        | "NOT_FOUND_OR_NOT_VISIBLE"
        | "OPPORTUNITY_NOT_AVAILABLE"
        | "INVALID_ACTION"
        | "DESTINATION_OVERFLOW";
    };

/** Resolve stored terms by authenticated recipient/card ID; no client-supplied price or outcome. */
export function getRecurringAcquisitionTerms(
  state: GameState,
  player: PlayerId,
  opportunityId: string,
): RecurringAcquisitionResult {
  if (state.phase !== "ready-for-first-round")
    return { ok: false, code: "WRONG_PHASE" };
  const card = state.content.cardsByPlayer[player];
  if (!card || card.id !== opportunityId || card.targetPlayerId !== player)
    return { ok: false, code: "NOT_FOUND_OR_NOT_VISIBLE" };
  if (
    card.status !== "available" ||
    card.createdQuarter !== state.currentQuarter
  )
    return { ok: false, code: "OPPORTUNITY_NOT_AVAILABLE" };
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (candidate) => candidate.id === card.templateId,
  );
  if (
    !template ||
    !card.facts ||
    !(
      template.action === "npc-business-purchase" ||
      template.action === "npc-property-purchase"
    )
  )
    return { ok: false, code: "INVALID_ACTION" };
  const facts = card.facts;
  if (
    (template.action === "npc-business-purchase" &&
      facts.kind !== "business") ||
    (template.action === "npc-property-purchase" && facts.kind !== "property")
  )
    return { ok: false, code: "INVALID_ACTION" };
  try {
    const feeRate =
      facts.kind === "business"
        ? TRANSACTION_FEES_BPS.business.purchase
        : TRANSACTION_FEES_BPS.property.purchase;
    const fee = cents(
      new FinanceDecimal(card.askingPriceCents)
        .times(feeRate)
        .dividedBy(10_000)
        .round()
        .toNumber(),
    );
    const total = cents(
      new FinanceDecimal(card.askingPriceCents).plus(fee).toNumber(),
    );
    if (
      !isNonNegativeCents(card.askingPriceCents) ||
      card.askingPriceCents === 0
    )
      return { ok: false, code: "INVALID_ACTION" };
    const common: RecurringAcquisitionCommon = {
      opportunityId: card.id,
      templateId: card.templateId,
      recipientPlayerId: player,
      quarter: state.currentQuarter,
      askingPriceCents: card.askingPriceCents,
      purchaseFeeCents: fee,
      totalCashRequiredCents: total,
      cashAffordable: getAvailableCashCents(state, player) >= total,
    };
    if (facts.kind === "business") {
      const costs = cents(
        new FinanceDecimal(facts.annualRevenueCents)
          .minus(facts.annualOperatingProfitCents)
          .toNumber(),
      );
      if (costs < 0 || facts.debtPrincipalCents !== 0)
        return { ok: false, code: "INVALID_ACTION" };
      return {
        ok: true,
        terms: {
          ...common,
          kind: "business",
          facts: { ...facts },
          annualTotalOperatingCostsCents: costs,
          necessaryLabor: {
            kind: "included-in-after-labor-profit",
            explicitAnnualCostCents: null,
          },
        },
      };
    }
    if (!template.propertyMarketKind)
      return { ok: false, code: "INVALID_ACTION" };
    return {
      ok: true,
      terms: {
        ...common,
        kind: "property",
        marketKind: template.propertyMarketKind,
        facts: { ...facts },
      },
    };
  } catch (cause) {
    if (cause instanceof RangeError)
      return { ok: false, code: "DESTINATION_OVERFLOW" };
    throw cause;
  }
}
