import { OBJECTIVE_TARGETS, type ObjectiveId } from "@interests/rules";
import type {
  AssetId,
  PlayerId,
  PursueFinaleCommandPayload,
} from "@interests/shared";
import { calculateBusinessEquity } from "../finance/business";
import {
  type BusinessExpansionRealizedFacts,
  expandBusinessAndAdvanceSpotlight,
} from "../finance/businessExpansion";
import type { JournalEntry } from "../finance/journal";
import {
  type MarketTradeFacts,
  tradePublicMarketsAndAdvanceSpotlight,
} from "../finance/publicMarketTrading";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { applyCareerCommand, type CareerActionFacts } from "../game/career";
import type { EconomicActionFinalization } from "../game/finalization";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import {
  type RecurringBusinessSaleRealizedFacts,
  sellRecurringBusiness,
} from "../opportunities/recurringBusinessExit";
import {
  fundRecurringLoan,
  type RecurringLendingRealizedFacts,
} from "../opportunities/recurringLending";
import {
  acquireRecurringOpportunity,
  type RecurringAcquisitionRealizedFacts,
} from "../opportunities/recurringPurchase";
import { evaluateObjective } from "./evaluate";
import { measurePlayerObjectives } from "./measurements";
import type { ObjectiveMeasurements } from "./model";

export interface ObjectiveFinaleRoute<Facts> {
  readonly objectiveId: ObjectiveId;
  /** Trusted owning-transition facts establish the actual qualifying economic action. */
  readonly qualifies: (input: EconomicActionFinalization<Facts>) => boolean;
  readonly resultingPosition?: (measured: ObjectiveMeasurements) => boolean;
}

function rejection(state: GameState, code: ActionErrorCode): ActionResult {
  return { ok: false, state, code, journalEntries: [] };
}

/** Private preflight; transaction owners still enforce their own closing/consent guards. */
export function finalePrecondition(
  state: GameState,
  actor: PlayerId,
  objectiveId: ObjectiveId,
): ActionErrorCode | null {
  if (!state.players[actor]) return "UNKNOWN_PLAYER";
  if (state.phase !== "ready-for-first-round") return "WRONG_PHASE";
  if (state.round?.stage !== "spotlight") return "WRONG_ROUND_STAGE";
  if (getActiveSpotlightPlayerId(state) !== actor)
    return "NOT_ACTIVE_SPOTLIGHT";
  if (state.players[actor]!.selectedObjectiveId !== objectiveId)
    return "FINALE_ACTION_UNAVAILABLE";
  if (state.revision >= Number.MAX_SAFE_INTEGER) return "COUNTER_EXHAUSTED";
  try {
    return evaluateObjective(measurePlayerObjectives(state, actor), objectiveId)
      .status === "eligible"
      ? null
      : "FINALE_INELIGIBLE";
  } catch (error) {
    if (error instanceof RangeError) return "FINALE_INELIGIBLE";
    throw error;
  }
}

/** Atomically finish one actual close. Ordinary actions never call this coordinator. */
export function finalizeObjectiveAction<Facts>(
  input: EconomicActionFinalization<Facts>,
  route: ObjectiveFinaleRoute<Facts>,
): ActionResult {
  const { before, draft, actorPlayerId: actor } = input;
  const precondition = finalePrecondition(before, actor, route.objectiveId);
  if (precondition) return rejection(before, precondition);
  if (
    draft.phase !== before.phase ||
    draft.currentQuarter !== before.currentQuarter ||
    draft.lastSettledQuarter !== before.lastSettledQuarter ||
    draft.revision !== before.revision ||
    draft.activeTransaction !== null ||
    getActiveSpotlightPlayerId(draft) !== actor
  )
    return rejection(before, "FINALE_ACTION_UNAVAILABLE");
  try {
    if (!route.qualifies(input)) return rejection(before, "FINALE_INELIGIBLE");
    const resulting = measurePlayerObjectives(draft, actor);
    const retainsEligibility = route.resultingPosition
      ? route.resultingPosition(resulting)
      : evaluateObjective(resulting, route.objectiveId).status === "eligible";
    if (!retainsEligibility) return rejection(before, "FINALE_INELIGIBLE");
    const finished: GameState = {
      ...draft,
      phase: "finished",
      round: null,
      activeTransaction: null,
      revision: before.revision + 1,
      result: {
        kind: "objective-victory",
        winnerPlayerId: actor,
        completedQuarter: before.currentQuarter,
      },
    };
    assertGameState(finished);
    return { ok: true, state: finished, journalEntries: input.journalEntries };
  } catch (error) {
    if (error instanceof RangeError)
      return rejection(before, "FINALE_INELIGIBLE");
    throw error;
  }
}

type IndependenceFacts =
  | CareerActionFacts
  | { readonly kind: "independence-confirmation" };
const independentRoute: ObjectiveFinaleRoute<IndependenceFacts> = {
  objectiveId: "independent",
  qualifies: ({ before, draft, actorPlayerId: actor, facts }) => {
    if (
      facts.kind !== "labor-exit" &&
      facts.kind !== "independence-confirmation"
    )
      return false;
    const old = before.progress.byPlayer[actor]!.labor;
    if (
      draft.progress.byPlayer[actor]!.labor.kind !== "not-working" ||
      draft.finance.recurringByPlayer[actor]!.quarterlyIncomeCents !== 0
    )
      return false;
    if (facts.kind === "independence-confirmation")
      return old.kind === "not-working";
    if (old.kind === "not-working") return false;
    if (old.kind !== "owner-work") return true;
    const original = before.finance.assetsById[old.assetId];
    const managed = draft.finance.assetsById[old.assetId];
    return (
      original?.kind === "business" &&
      original.workCompensation !== undefined &&
      managed?.kind === "business" &&
      managed.annualManagementCostCents ===
        original.workCompensation?.annualCompensationCents &&
      managed.workCompensation?.annualCompensationCents === 0 &&
      managed.workCompensation.arrearsCents ===
        original.workCompensation.arrearsCents &&
      managed.annualOperatingProfitCents ===
        original.annualOperatingProfitCents &&
      managed.cashCents === original.cashCents
    );
  },
};

function paid(
  journals: readonly JournalEntry[],
  actor: PlayerId,
  reason: string,
  destination: "career-counterparty" | "market",
) {
  return journals
    .filter(
      (entry) =>
        entry.reason === reason &&
        entry.source.kind === "player" &&
        entry.source.playerId === actor &&
        entry.destination.kind === "external" &&
        entry.destination.account === destination,
    )
    .reduce((sum, entry) => sum + entry.amountCents, 0);
}
const executiveRoute: ObjectiveFinaleRoute<CareerActionFacts> = {
  objectiveId: "executive-owner",
  qualifies: ({
    before,
    draft,
    actorPlayerId: actor,
    facts,
    journalEntries,
  }) => {
    if (
      facts.kind !== "career-acceptance" ||
      facts.role !== "executive" ||
      !facts.ownershipPosition
    )
      return false;
    const exposure = facts.ownershipPosition;
    const asset = draft.finance.assetsById[exposure.assetId];
    const labor = draft.progress.byPlayer[actor]!.labor;
    if (
      Object.hasOwn(before.finance.assetsById, exposure.assetId) ||
      asset?.kind !== "business" ||
      labor.kind !== "employment" ||
      labor.role !== "executive" ||
      labor.ownershipPositionAssetId !== exposure.assetId ||
      asset.ownershipByPlayerPpm[actor] !== 1_000_000
    )
      return false;
    return (
      exposure.considerationCents >=
        OBJECTIVE_TARGETS["executive-owner"].finaleEquityExposureCents &&
      calculateBusinessEquity(asset, draft.finance.loansById)
        .equityValueCents >=
        OBJECTIVE_TARGETS["executive-owner"].finaleEquityExposureCents &&
      paid(
        journalEntries,
        actor,
        "executive-secondary-purchase",
        "career-counterparty",
      ) === exposure.considerationCents &&
      paid(
        journalEntries,
        actor,
        "executive-business-purchase-fee",
        "market",
      ) === exposure.purchaseFeeCents &&
      before.finance.cashByPlayer[actor]! -
        draft.finance.cashByPlayer[actor]! ===
        exposure.considerationCents +
          exposure.purchaseFeeCents +
          facts.transitionCostCents
    );
  },
};

function qualifiesFounderCompany(
  state: GameState,
  actor: PlayerId,
  assetId: AssetId,
): boolean {
  const measured = measurePlayerObjectives(state, actor);
  return (
    evaluateObjective(
      {
        ...measured,
        companies: measured.companies.filter(
          (company) => company.assetId === assetId,
        ),
      },
      "founder",
    ).status === "eligible"
  );
}

const expansionRoute: ObjectiveFinaleRoute<BusinessExpansionRealizedFacts> = {
  objectiveId: "founder",
  qualifies: ({ before, draft, actorPlayerId, facts }) =>
    facts.totalInvestmentCents >=
      OBJECTIVE_TARGETS.founder.finaleInvestmentCents &&
    qualifiesFounderCompany(before, actorPlayerId, facts.assetId) &&
    qualifiesFounderCompany(draft, actorPlayerId, facts.assetId),
};

const founderExitRoute: ObjectiveFinaleRoute<RecurringBusinessSaleRealizedFacts> =
  {
    objectiveId: "founder",
    qualifies: ({ before, draft, actorPlayerId, facts }) =>
      facts.netProceedsCents >=
        OBJECTIVE_TARGETS.founder.exitNetProceedsCents &&
      facts.remainingClaimsCents === 0 &&
      qualifiesFounderCompany(before, actorPlayerId, facts.assetId) &&
      !draft.finance.assetsById[facts.assetId]?.ownershipByPlayerPpm[
        actorPlayerId
      ],
    resultingPosition: (measured) =>
      !measured.overdue && measured.netWorthCents >= 0,
  };

const financierRoute: ObjectiveFinaleRoute<RecurringLendingRealizedFacts> = {
  objectiveId: "financier",
  qualifies: ({ facts }) =>
    facts.fundedPrincipalCents >=
    OBJECTIVE_TARGETS.financier.finalePrincipalCents,
};

const acquisitionRoutes = {
  founder: (facts: RecurringAcquisitionRealizedFacts) =>
    facts.assetKind === "business" &&
    facts.priceCents >= OBJECTIVE_TARGETS.founder.finaleInvestmentCents,
  "property-magnate": (facts: RecurringAcquisitionRealizedFacts) =>
    facts.assetKind === "property" &&
    facts.priceCents >=
      OBJECTIVE_TARGETS["property-magnate"].finaleAcquisitionCents,
  "capital-allocator": (facts: RecurringAcquisitionRealizedFacts) =>
    facts.priceCents - facts.borrowedPrincipalCents >=
    OBJECTIVE_TARGETS["capital-allocator"].finaleInvestmentCents,
  "deal-maker": (facts: RecurringAcquisitionRealizedFacts) =>
    facts.priceCents >=
    OBJECTIVE_TARGETS["deal-maker"].finaleConsiderationCents,
  "wealth-architect": (facts: RecurringAcquisitionRealizedFacts) =>
    facts.priceCents - facts.borrowedPrincipalCents >=
    OBJECTIVE_TARGETS["wealth-architect"].finaleDeploymentCents,
} satisfies Partial<
  Record<ObjectiveId, (facts: RecurringAcquisitionRealizedFacts) => boolean>
>;

const marketRoutes = {
  "capital-allocator": ({ purchasedCents }: MarketTradeFacts) =>
    purchasedCents >=
    OBJECTIVE_TARGETS["capital-allocator"].finaleInvestmentCents,
  "deal-maker": ({ purchasedCents, soldCents }: MarketTradeFacts) =>
    Math.max(purchasedCents, soldCents) >=
    OBJECTIVE_TARGETS["deal-maker"].finaleConsiderationCents,
  "wealth-architect": ({ purchasedCents, soldCents }: MarketTradeFacts) =>
    Math.max(purchasedCents, soldCents) >=
    OBJECTIVE_TARGETS["wealth-architect"].finaleDeploymentCents,
} satisfies Partial<Record<ObjectiveId, (facts: MarketTradeFacts) => boolean>>;

type EconomicFinaleAction = Exclude<
  PursueFinaleCommandPayload["action"],
  { type: "ACCEPT_CAREER_OFFER" | "RESIGN_LABOR" | "CONFIRM_INDEPENDENCE" }
>;
const economicActionKeys: Readonly<
  Record<EconomicFinaleAction["type"], readonly string[]>
> = {
  ACQUIRE_RECURRING_OPPORTUNITY: ["type", "opportunityId", "quoteId"],
  SELL_RECURRING_BUSINESS: ["type", "opportunityId", "quoteId"],
  FUND_RECURRING_LOAN: ["type", "opportunityId"],
  EXPAND_BUSINESS: [
    "type",
    "assetId",
    "investmentCents",
    "ownerContributionCents",
  ],
  TRADE_PUBLIC_MARKETS: ["type", "trades"],
};

function pursueEconomicFinale(
  state: GameState,
  actor: PlayerId,
  action: EconomicFinaleAction,
): ActionResult {
  const allowed = economicActionKeys[action.type];
  if (
    !Object.hasOwn(economicActionKeys, action.type) ||
    Object.keys(action).some((key) => !allowed.includes(key))
  )
    return rejection(state, "INVALID_ACTION");
  if (!state.players[actor]) return rejection(state, "UNKNOWN_PLAYER");
  const objectiveId = state.players[actor]!.selectedObjectiveId;
  if (!objectiveId) return rejection(state, "FINALE_ACTION_UNAVAILABLE");
  const precondition = finalePrecondition(state, actor, objectiveId);
  if (precondition) return rejection(state, precondition);

  switch (action.type) {
    case "ACQUIRE_RECURRING_OPPORTUNITY": {
      if (!Object.hasOwn(acquisitionRoutes, objectiveId))
        return rejection(state, "FINALE_ACTION_UNAVAILABLE");
      const accepts =
        acquisitionRoutes[objectiveId as keyof typeof acquisitionRoutes];
      return acquireRecurringOpportunity(state, actor, action, (input) =>
        finalizeObjectiveAction(input, {
          objectiveId,
          qualifies: ({ facts }) => accepts(facts),
        }),
      );
    }
    case "SELL_RECURRING_BUSINESS":
      if (objectiveId === "founder")
        return sellRecurringBusiness(
          state,
          actor,
          action.opportunityId,
          action.quoteId,
          (input) => finalizeObjectiveAction(input, founderExitRoute),
        );
      if (objectiveId === "deal-maker")
        return sellRecurringBusiness(
          state,
          actor,
          action.opportunityId,
          action.quoteId,
          (input) =>
            finalizeObjectiveAction(input, {
              objectiveId,
              qualifies: ({ facts }) =>
                facts.grossConsiderationCents >=
                OBJECTIVE_TARGETS["deal-maker"].finaleConsiderationCents,
            }),
        );
      break;
    case "FUND_RECURRING_LOAN":
      if (objectiveId === "financier")
        return fundRecurringLoan(state, actor, action.opportunityId, (input) =>
          finalizeObjectiveAction(input, financierRoute),
        );
      break;
    case "EXPAND_BUSINESS":
      if (objectiveId === "founder")
        return expandBusinessAndAdvanceSpotlight(
          state,
          actor,
          action,
          (input) => finalizeObjectiveAction(input, expansionRoute),
        );
      break;
    case "TRADE_PUBLIC_MARKETS": {
      if (!Object.hasOwn(marketRoutes, objectiveId))
        return rejection(state, "FINALE_ACTION_UNAVAILABLE");
      const accepts = marketRoutes[objectiveId as keyof typeof marketRoutes];
      return tradePublicMarketsAndAdvanceSpotlight(
        state,
        actor,
        action.trades,
        (input) =>
          finalizeObjectiveAction(input, {
            objectiveId,
            qualifies: ({ facts }) => accepts(facts),
          }),
      );
    }
  }
  return rejection(state, "FINALE_ACTION_UNAVAILABLE");
}

/** Engine entry for the explicit shared wrapper. No objective, balances or outcomes are client inputs. */
export function pursueFinale(
  state: GameState,
  actor: PlayerId,
  command: PursueFinaleCommandPayload,
): ActionResult {
  if (Object.keys(command).some((key) => key !== "type" && key !== "action"))
    return rejection(state, "INVALID_ACTION");
  const action = command.action;
  if (!action || typeof action !== "object" || Array.isArray(action))
    return rejection(state, "INVALID_ACTION");
  if (
    action.type !== "ACCEPT_CAREER_OFFER" &&
    action.type !== "RESIGN_LABOR" &&
    action.type !== "CONFIRM_INDEPENDENCE"
  )
    return pursueEconomicFinale(state, actor, action);
  if (action.type === "ACCEPT_CAREER_OFFER") {
    if (
      typeof action.offerId !== "string" ||
      !action.offerId ||
      Object.keys(action).some((key) => key !== "type" && key !== "offerId")
    )
      return rejection(state, "INVALID_ACTION");
    const precondition = finalePrecondition(state, actor, "executive-owner");
    if (precondition) return rejection(state, precondition);
    return applyCareerCommand(state, actor, action.offerId, (input) =>
      finalizeObjectiveAction(input, executiveRoute),
    );
  }
  if (
    (action.type !== "RESIGN_LABOR" &&
      action.type !== "CONFIRM_INDEPENDENCE") ||
    Object.keys(action).some((key) => key !== "type")
  )
    return rejection(state, "INVALID_ACTION");
  const precondition = finalePrecondition(state, actor, "independent");
  if (precondition) return rejection(state, precondition);
  if (action.type === "RESIGN_LABOR")
    return applyCareerCommand(state, actor, null, (input) =>
      finalizeObjectiveAction(input, independentRoute),
    );
  if (state.activeTransaction) return rejection(state, "ACTIVE_TRANSACTION");
  if (state.progress.byPlayer[actor]!.labor.kind !== "not-working")
    return rejection(state, "FINALE_ACTION_UNAVAILABLE");
  return finalizeObjectiveAction(
    {
      before: state,
      draft: state,
      actorPlayerId: actor,
      journalEntries: [],
      facts: { kind: "independence-confirmation" },
    },
    independentRoute,
  );
}
