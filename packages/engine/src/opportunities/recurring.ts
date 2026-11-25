import {
  ASSET_UNDERWRITING,
  COMPLETION_ECONOMY_TARGETS,
  MARKET_BORROWER_TEMPLATES,
  OBJECTIVE_MEASUREMENT_RULES,
  PROFILES,
  RECURRING_CONTENT_RULES,
  RECURRING_CONTENT_TEMPLATES,
  type RecurringCategory,
  type RecurringContentTemplate,
  TRANSACTION_FEES_BPS,
} from "@interests/rules";
import type {
  LoanId,
  OpportunityId,
  PlayerId,
  RecurringOpportunityFacts,
  RecurringOpportunityView,
} from "@interests/shared";
import { externalCashAccount, playerCashAccount } from "../finance/account";
import { bankBorrowerStrength } from "../finance/bank";
import { FinanceDecimal } from "../finance/decimal";
import { isLenderLoan } from "../finance/loanParties";
import { type Cents, cents } from "../finance/money";
import {
  type FrozenNpcFundingTerms,
  materializeNpcFundingTerms,
  npcOfferAvailable,
  quoteNpcFunding,
} from "../finance/npcLending";
import { postCash } from "../finance/posting";
import type { ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import { assertGameState } from "../invariants/assertGameState";
import { FOCUS_AREAS, type FocusArea } from "../model/completionState";
import type { GameState } from "../model/gameState";
import { drawBoundedInt, type RandomState } from "../random/prng";
import { getAvailableCashCents } from "../transactions/reservations";
import {
  authorRecurringBusinessBuyer,
  type RecurringBusinessBuyer,
  recurringBusinessExitQuote,
  seasonedSoleOwnedBusinesses,
} from "./recurringBusinessExit";
import { getRecurringAcquisitionQuotes } from "./recurringPurchase";

export interface RecurringOpportunity {
  readonly businessBuyer?: RecurringBusinessBuyer;
  readonly disposedAssetId?: import("@interests/shared").AssetId;
  readonly id: OpportunityId;
  readonly targetPlayerId: PlayerId;
  readonly templateId: string;
  readonly category: RecurringCategory;
  readonly createdQuarter: number;
  readonly status:
    | "available"
    | "expired"
    | "acquired"
    | "funded"
    | "completed";
  readonly acquiredAssetId?: import("@interests/shared").AssetId;
  readonly fundedLoanId?: LoanId;
  readonly npcFundingTerms?: FrozenNpcFundingTerms;
  readonly askingPriceCents: Cents;
  readonly investigationFeeCents: Cents;
  readonly investigated: boolean;
  readonly facts: RecurringOpportunityFacts | null;
}
export interface RecurringContentState {
  readonly scenario: "standard-v1" | "q1-business-diagnostic";
  readonly random: RandomState;
  readonly generatedQuarter: number;
  readonly cardsByPlayer: Readonly<
    Record<PlayerId, RecurringOpportunity | null>
  >;
  readonly recentCategoriesByPlayer: Readonly<
    Record<PlayerId, readonly RecurringCategory[]>
  >;
}

function ownsCategory(
  state: GameState,
  player: PlayerId,
  category: RecurringCategory,
) {
  if (category === "business" || category === "property")
    return Object.values(state.finance.assetsById).some(
      (asset) =>
        asset.kind === category &&
        (asset.ownershipByPlayerPpm[player] ?? 0) > 0,
    );
  if (category === "markets")
    return Object.values(
      state.finance.publicMarketsByPlayer[player] ?? {},
    ).some((value) => value > 0);
  if (category === "financing")
    return Object.values(state.finance.loansById).some(
      (loan) =>
        isLenderLoan(loan) &&
        loan.lenderPlayerId === player &&
        loan.outstandingPrincipalCents > 0,
    );
  return false;
}

// Discovery uses a Standard V1 affordability assumption, independent of peers' private cash.
const ASSUMED_PARTNER_CASH_CENTS = Math.max(
  ...Object.values(PROFILES).map((profile) => profile.startingCashCents),
);

/** Use the authored variation bounds to check cash and bank capacity without rerolls. */
function canAcquireTemplate(
  state: GameState,
  player: PlayerId,
  template: RecurringContentTemplate,
): boolean {
  if (!template.facts) throw new Error("Missing acquisition template facts");
  const askingPriceCents = cents(
    new FinanceDecimal(template.askingPriceCents)
      .times(10_000 + RECURRING_CONTENT_RULES.askingPriceVariationBps)
      .div(10_000)
      .round()
      .toNumber(),
  );
  const limits =
    ASSET_UNDERWRITING[
      COMPLETION_ECONOMY_TARGETS[state.economy.currentRegime].credit
    ];
  const business = template.facts.kind === "business";
  const loanValue = business
    ? askingPriceCents
    : template.facts.kind === "property"
      ? template.facts.marketValueCents
      : 0;
  const maximumPrincipal = Math.min(
    askingPriceCents,
    new FinanceDecimal(loanValue)
      .times(business ? limits.businessShareBps : limits.propertyLtvBps)
      .div(10_000)
      .round()
      .toNumber(),
  );
  const fee = new FinanceDecimal(askingPriceCents)
    .times(
      business
        ? TRANSACTION_FEES_BPS.business.purchase
        : TRANSACTION_FEES_BPS.property.purchase,
    )
    .div(10_000)
    .round()
    .toNumber();
  const cash = getAvailableCashCents(state, player);
  const cashPrice = askingPriceCents + fee;
  const borrower = bankBorrowerStrength(state, player);
  const personalReserve = borrower.personalQuarterlyObligationsCents;
  const cashContribution = cash - (business ? 0 : personalReserve);
  if (
    cashContribution >= cashPrice ||
    (cashContribution > 0 &&
      cashPrice - cashContribution <= ASSUMED_PARTNER_CASH_CENTS)
  )
    return true;
  const availableForFinancedPurchase = cash - personalReserve;
  if (
    borrower.overdue ||
    availableForFinancedPurchase <= 0 ||
    cashPrice - maximumPrincipal - availableForFinancedPurchase >
      ASSUMED_PARTNER_CASH_CENTS
  )
    return false;
  const facts =
    template.facts.kind === "business"
      ? {
          ...template.facts,
          annualOperatingProfitCents: cents(
            new FinanceDecimal(template.facts.annualOperatingProfitCents)
              .times(
                10_000 - RECURRING_CONTENT_RULES.businessProfitVariationBps,
              )
              .div(10_000)
              .round()
              .toNumber(),
          ),
        }
      : template.facts;
  const id = "candidate-finance-check" as OpportunityId;
  const draft: GameState = {
    ...state,
    phase: "ready-for-first-round",
    content: {
      ...state.content,
      cardsByPlayer: {
        ...state.content.cardsByPlayer,
        [player]: {
          id,
          targetPlayerId: player,
          templateId: template.id,
          category: template.category,
          createdQuarter: state.currentQuarter,
          status: "available",
          askingPriceCents,
          investigationFeeCents:
            recurringInvestigationFeeCents(askingPriceCents),
          investigated: false,
          facts,
        },
      },
    },
  };
  return (
    getRecurringAcquisitionQuotes(draft, player, id).some(
      (quote) => quote.canClose,
    ) ||
    getRecurringAcquisitionQuotes(draft, player, id, {
      leadCashCents: availableForFinancedPurchase,
    }).some(
      (quote) =>
        quote.canClose &&
        quote.cashRequiredCents - availableForFinancedPurchase <=
          ASSUMED_PARTNER_CASH_CENTS,
    )
  );
}

/** Current owned resources and personal focus only; selected/offered objectives are never read. */
export function recurringCandidateWeights(state: GameState, player: PlayerId) {
  if (!state.players[player]) throw new RangeError("Unknown content recipient");
  const cash = getAvailableCashCents(state, player);
  const focus = state.progress.byPlayer[player]?.focus;
  const recent = state.content.recentCategoriesByPlayer[player] ?? [];
  return RECURRING_CONTENT_TEMPLATES.flatMap((template) => {
    if (template.finaleOnly) return [];
    if (template.action === "npc-financing") {
      const borrower = MARKET_BORROWER_TEMPLATES.find(
        (row) => row.cardTemplateId === template.id,
      );
      if (!borrower) throw new Error("Missing market borrower template");
      if (!npcOfferAvailable(state, borrower.borrowerId)) return [];
    }
    const acquisition =
      template.action === "npc-business-purchase" ||
      template.action === "npc-property-purchase";
    if (
      template.action === "npc-business-exit" &&
      !seasonedSoleOwnedBusinesses(state, player).length
    )
      return [];
    if (
      (acquisition
        ? !canAcquireTemplate(state, player, template)
        : cash < template.minimumCashCents) ||
      (template.requiredOwnership &&
        !ownsCategory(state, player, template.requiredOwnership))
    )
      return [];
    let weight = template.baseWeight * 2;
    if (focus === template.category)
      weight *= RECURRING_CONTENT_RULES.focusWeightMultiplier;
    if (ownsCategory(state, player, template.category))
      weight *= RECURRING_CONTENT_RULES.ownershipWeightMultiplier;
    if (recent.includes(template.category))
      weight /= RECURRING_CONTENT_RULES.recentCategoryWeightDivisor;
    if (
      state.currentQuarter >= RECURRING_CONTENT_RULES.pressureStartsQuarter &&
      template.intensity === "major"
    )
      weight *= 2;
    return [{ template, weight }];
  });
}

export function recurringInvestigationFeeCents(priceCents: number): Cents {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0)
    throw new RangeError("Invalid asking price");
  const percentage = new FinanceDecimal(priceCents)
    .times(RECURRING_CONTENT_RULES.investigationFeeBps)
    .dividedBy(10_000)
    .round()
    .toNumber();
  return cents(
    Math.max(
      RECURRING_CONTENT_RULES.investigationMinimumCents,
      Math.min(RECURRING_CONTENT_RULES.investigationMaximumCents, percentage),
    ),
  );
}

/** Generate once at a quarter boundary; reads no hidden objective and creates no player asset. */
export function generateRecurringContent(state: GameState): GameState {
  if (
    state.content.scenario !== "standard-v1" ||
    state.phase === "finished" ||
    state.currentQuarter > OBJECTIVE_MEASUREMENT_RULES.safetyDrawQuarter ||
    state.content.generatedQuarter === state.currentQuarter
  )
    return state;
  if (state.content.generatedQuarter !== state.currentQuarter - 1)
    throw new Error("Skipped recurring content quarter");
  if (
    state.counters.opportunity >
    Number.MAX_SAFE_INTEGER - state.playerOrder.length
  )
    throw new RangeError("Opportunity counter exhausted");
  let random = state.content.random;
  let counters = state.counters;
  const cardsByPlayer = { ...state.content.cardsByPlayer };
  const recentCategoriesByPlayer = {
    ...state.content.recentCategoriesByPlayer,
  };
  for (const player of state.playerOrder) {
    const candidates = recurringCandidateWeights(state, player);
    const total = candidates.reduce(
      (sum, candidate) => sum + candidate.weight,
      0,
    );
    const choice = drawBoundedInt(random, total);
    random = choice.nextState;
    let remaining = choice.value;
    let selected: RecurringContentTemplate | undefined;
    for (const candidate of candidates) {
      if (remaining < candidate.weight) {
        selected = candidate.template;
        break;
      }
      remaining -= candidate.weight;
    }
    if (!selected) throw new Error("No recurring content candidate");
    const priceNoise = drawBoundedInt(
      random,
      2 * RECURRING_CONTENT_RULES.askingPriceVariationBps + 1,
    );
    random = priceNoise.nextState;
    const factNoise = drawBoundedInt(
      random,
      2 * RECURRING_CONTENT_RULES.businessProfitVariationBps + 1,
    );
    random = factNoise.nextState;
    let price = cents(
      new FinanceDecimal(selected.askingPriceCents)
        .times(
          10_000 +
            priceNoise.value -
            RECURRING_CONTENT_RULES.askingPriceVariationBps,
        )
        .dividedBy(10_000)
        .round()
        .toNumber(),
    );
    const facts = selected.facts ? { ...selected.facts } : null;
    if (facts?.kind === "business")
      facts.annualOperatingProfitCents = cents(
        new FinanceDecimal(facts.annualOperatingProfitCents)
          .times(
            10_000 +
              factNoise.value -
              RECURRING_CONTENT_RULES.businessProfitVariationBps,
          )
          .dividedBy(10_000)
          .round()
          .toNumber(),
      );
    const next = nextDeterministicId("opportunity", counters);
    counters = next.counters;
    const npcFundingTerms =
      selected.action === "npc-financing"
        ? materializeNpcFundingTerms(
            selected.id,
            price,
            state.economy.baseRateBps,
          )
        : null;
    if (selected.action === "npc-financing" && !npcFundingTerms)
      throw new Error("Invalid authored market loan quote");
    const businessBuyer =
      selected.action === "npc-business-exit"
        ? authorRecurringBusinessBuyer(
            state,
            player,
            next.id,
            priceNoise.value - RECURRING_CONTENT_RULES.askingPriceVariationBps,
          )
        : undefined;
    if (businessBuyer) price = cents(businessBuyer.operatingEnterpriseBidCents);
    cardsByPlayer[player] = {
      ...(businessBuyer ? { businessBuyer } : {}),
      id: next.id,
      targetPlayerId: player,
      templateId: selected.id,
      category: selected.category,
      createdQuarter: state.currentQuarter,
      status: "available",
      askingPriceCents: price,
      investigationFeeCents: facts
        ? recurringInvestigationFeeCents(price)
        : cents(0),
      investigated: false,
      facts,
      ...(npcFundingTerms ? { npcFundingTerms } : {}),
    };
    recentCategoriesByPlayer[player] = [
      ...(recentCategoriesByPlayer[player] ?? []),
      selected.category,
    ].slice(-RECURRING_CONTENT_RULES.recentCategoryLookback);
  }
  return {
    ...state,
    counters,
    content: {
      ...state.content,
      random,
      generatedQuarter: state.currentQuarter,
      cardsByPlayer,
      recentCategoriesByPlayer,
    },
  };
}

/** Called only after spotlight legality succeeds; an unused card never survives that spotlight. */
export function expireRecurringOpportunity(
  state: GameState,
  player: PlayerId,
): GameState {
  const card = state.content.cardsByPlayer[player];
  if (!card || card.status !== "available") return state;
  return {
    ...state,
    content: {
      ...state.content,
      cardsByPlayer: {
        ...state.content.cardsByPlayer,
        [player]: { ...card, status: "expired" },
      },
    },
  };
}

export function projectRecurringOpportunity(
  state: GameState,
  player: PlayerId,
): RecurringOpportunityView | null {
  const card = state.content.cardsByPlayer[player];
  if (!card || card.targetPlayerId !== player) return null;
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (candidate) => candidate.id === card.templateId,
  );
  if (!template) throw new Error("Unknown content template");
  const marketLoanQuote =
    card.status === "available" && card.npcFundingTerms
      ? quoteNpcFunding(state, player, card.npcFundingTerms)
      : null;
  return {
    id: card.id,
    templateId: card.templateId,
    name: template.name,
    category: card.category,
    intensity: template.intensity,
    summary: template.summary,
    action: template.action,
    ...(template.action === "npc-business-exit"
      ? { businessExitQuote: recurringBusinessExitQuote(state, player) }
      : {}),
    createdQuarter: card.createdQuarter,
    status: card.status,
    ...(card.acquiredAssetId ? { acquiredAssetId: card.acquiredAssetId } : {}),
    ...(marketLoanQuote ? { marketLoanQuote } : {}),
    askingPriceCents: card.askingPriceCents,
    investigationFeeCents: card.investigationFeeCents,
    investigated: card.investigated,
    ...(card.investigated && card.facts ? { facts: { ...card.facts } } : {}),
  };
}

export function setPlayerFocus(
  state: GameState,
  player: PlayerId,
  focus: string,
): ActionResult {
  const reject = (
    code: "WRONG_PHASE" | "UNKNOWN_PLAYER" | "INVALID_ACTION",
  ): ActionResult => ({ ok: false, state, code, journalEntries: [] });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (!state.players[player]) return reject("UNKNOWN_PLAYER");
  if (!FOCUS_AREAS.includes(focus as FocusArea))
    return reject("INVALID_ACTION");
  const progress = state.progress.byPlayer[player];
  if (!progress || progress.focus === focus) return reject("INVALID_ACTION");
  const next: GameState = {
    ...state,
    revision: state.revision + 1,
    progress: {
      ...state.progress,
      byPlayer: {
        ...state.progress.byPlayer,
        [player]: { ...progress, focus: focus as FocusArea },
      },
    },
  };
  assertGameState(next);
  return { ok: true, state: next, journalEntries: [] };
}

export function investigateRecurringOpportunity(
  state: GameState,
  player: PlayerId,
  id: string,
): ActionResult {
  const reject = (
    code:
      | "WRONG_PHASE"
      | "NOT_FOUND_OR_NOT_VISIBLE"
      | "OPPORTUNITY_NOT_AVAILABLE"
      | "ALREADY_INVESTIGATED"
      | "INVALID_ACTION"
      | "INSUFFICIENT_AVAILABLE_CASH"
      | "JOURNAL_ID_EXHAUSTED"
      | "ACTIVE_TRANSACTION",
  ): ActionResult => ({ ok: false, state, code, journalEntries: [] });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  const card = state.content.cardsByPlayer[player];
  if (!card || card.id !== id || card.targetPlayerId !== player)
    return reject("NOT_FOUND_OR_NOT_VISIBLE");
  if (
    card.status !== "available" ||
    card.createdQuarter !== state.currentQuarter
  )
    return reject("OPPORTUNITY_NOT_AVAILABLE");
  if (
    state.activeTransaction?.kind === "shared-recurring-acquisition" &&
    state.activeTransaction.leadPlayerId === player
  )
    return reject("ACTIVE_TRANSACTION");
  if (card.investigated) return reject("ALREADY_INVESTIGATED");
  if (!card.facts) return reject("INVALID_ACTION");
  if (getAvailableCashCents(state, player) < card.investigationFeeCents)
    return reject("INSUFFICIENT_AVAILABLE_CASH");
  if (state.counters.journal >= Number.MAX_SAFE_INTEGER)
    return reject("JOURNAL_ID_EXHAUSTED");
  const posted = postCash(state.finance, state.counters, {
    source: playerCashAccount(player),
    destination: externalCashAccount("market"),
    amountCents: card.investigationFeeCents,
    reason: "opportunity-investigation",
    relatedOpportunityId: card.id,
    quarter: state.currentQuarter,
  });
  if (!posted.ok) return reject("INSUFFICIENT_AVAILABLE_CASH");
  const next: GameState = {
    ...state,
    revision: state.revision + 1,
    finance: posted.finance,
    counters: posted.counters,
    content: {
      ...state.content,
      cardsByPlayer: {
        ...state.content.cardsByPlayer,
        [player]: { ...card, investigated: true },
      },
    },
  };
  assertGameState(next);
  return { ok: true, state: next, journalEntries: [posted.entry] };
}
