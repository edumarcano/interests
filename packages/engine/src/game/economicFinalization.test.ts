import { RECURRING_CONTENT_TEMPLATES } from "@interests/rules";
import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import {
  type BusinessExpansionRealizedFacts,
  expandBusinessAndAdvanceSpotlight,
} from "../finance/businessExpansion";
import { cents } from "../finance/money";
import { quoteNpcFunding } from "../finance/npcLending";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { recurringInvestigationFeeCents } from "../opportunities/recurring";
import {
  type RecurringBusinessSaleRealizedFacts,
  recurringBusinessExitQuote,
  sellRecurringBusiness,
} from "../opportunities/recurringBusinessExit";
import {
  fundRecurringLoan,
  type RecurringLendingRealizedFacts,
} from "../opportunities/recurringLending";
import {
  acquireRecurringOpportunity,
  getRecurringAcquisitionQuotes,
  type RecurringAcquisitionRealizedFacts,
} from "../opportunities/recurringPurchase";
import type { ActionResult } from "./actions";
import { createGame } from "./createGame";
import type {
  EconomicActionFinalization,
  EconomicActionFinalizer,
} from "./finalization";
import { applyPlayerCommand } from "./playerCommand";
import { getActiveSpotlightPlayerId } from "./round";

const players = ["a", "b", "c", "d"].map(asPlayerId);
function send(
  state: GameState,
  player: PlayerId,
  command: Parameters<typeof applyPlayerCommand>[2],
) {
  const result = applyPlayerCommand(state, player, command);
  if (!result.ok) throw new Error(result.code);
  return result.state;
}
function ready(seed: string, focus?: "business" | "financing") {
  let state = createGame({
    gameId: "economic-finalization",
    seed,
    playerIds: players,
  });
  for (const id of players)
    state = send(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
  if (focus)
    for (const id of players)
      state = send(state, id, { type: "SET_FOCUS", focus });
  return send(state, players[0]!, { type: "BEGIN_ROUND" });
}
function atTurn(
  seed: string,
  focus: "business" | "financing",
  accepts: (state: GameState, actor: PlayerId) => boolean,
) {
  let state = ready(seed, focus);
  for (let turn = 0; turn < 64; turn++) {
    if (state.round?.stage === "round-start")
      state = send(state, players[0]!, { type: "BEGIN_ROUND" });
    const actor = getActiveSpotlightPlayerId(state)!;
    if (accepts(state, actor)) return { state, actor };
    state = send(state, actor, { type: "PASS_SPOTLIGHT" });
  }
  throw new Error("Missing finalization fixture turn");
}
/** Callback deliberately returns its draft on failure; owner must discard all partial effects and journals. */
function proveHook<Facts>(
  state: GameState,
  run: (finalize?: EconomicActionFinalizer<Facts>) => ActionResult,
  facts: (input: EconomicActionFinalization<Facts>) => void,
) {
  const original = JSON.stringify(state);
  let called = 0,
    finalInput: EconomicActionFinalization<Facts> | undefined;
  const finalized = run((input) => {
    called++;
    finalInput = input;
    expect(input.before).toBe(state);
    expect(input.draft.revision).toBe(state.revision);
    expect(input.draft.currentQuarter).toBe(state.currentQuarter);
    expect(input.draft.round).toEqual(state.round);
    expect(input.journalEntries.length).toBeGreaterThan(0);
    assertGameState(input.draft);
    facts(input);
    return {
      ok: true,
      state: input.draft,
      journalEntries: input.journalEntries,
    };
  });
  expect(called).toBe(1);
  expect(finalized.ok).toBe(true);
  expect(finalized.state).toBe(finalInput!.draft);
  expect(finalized.journalEntries).toBe(finalInput!.journalEntries);
  expect(JSON.stringify(state)).toBe(original);
  let rejectedCalls = 0;
  const rejected = run((input) => {
    rejectedCalls++;
    return {
      ok: false,
      code: "INVALID_ACTION",
      state: input.draft,
      journalEntries: input.journalEntries,
    };
  });
  expect(rejectedCalls).toBe(1);
  expect(rejected).toMatchObject({
    ok: false,
    code: "INVALID_ACTION",
    journalEntries: [],
  });
  expect(rejected.state).toBe(state);
  expect(JSON.stringify(state)).toBe(original);
  const ordinary = run();
  expect(ordinary.ok).toBe(true);
  expect(ordinary.state.revision).toBe(state.revision + 1);
}

describe("owning economic finalization boundaries", () => {
  it.each([
    ["local-service-company", "cash"],
    ["local-service-company", "bank-fixed"],
    ["residential-rental", "cash"],
    ["residential-rental", "bank-variable"],
  ] as const)(
    "reports actual %s %s acquisition effects before advancement",
    (templateId, route) => {
      const base = ready("recurring-close"),
        actor = players[0]!,
        template = RECURRING_CONTENT_TEMPLATES.find(
          (row) => row.id === templateId,
        )!;
      // Explicit funded close-boundary fixture; no objective threshold or production setup change.
      const card = {
        id: base.content.cardsByPlayer[actor]!.id,
        targetPlayerId: actor,
        templateId,
        category: template.category,
        createdQuarter: base.currentQuarter,
        status: "available" as const,
        askingPriceCents: cents(template.askingPriceCents),
        investigationFeeCents: recurringInvestigationFeeCents(
          template.askingPriceCents,
        ),
        investigated: false,
        facts: template.facts,
      };
      const state: GameState = {
        ...base,
        finance: {
          ...base.finance,
          cashByPlayer: {
            ...base.finance.cashByPlayer,
            [actor]: cents(100_000_000),
          },
        },
        content: {
          ...base.content,
          cardsByPlayer: { ...base.content.cardsByPlayer, [actor]: card },
        },
      };
      assertGameState(state);
      const quote = getRecurringAcquisitionQuotes(state, actor, card.id).find(
        (quote) => quote.route === route,
      )!;
      expect(quote.canClose).toBe(true);
      proveHook<RecurringAcquisitionRealizedFacts>(
        state,
        (finalize) =>
          acquireRecurringOpportunity(
            state,
            actor,
            {
              type: "ACQUIRE_RECURRING_OPPORTUNITY",
              opportunityId: card.id,
              quoteId: quote.id,
            },
            finalize,
          ),
        ({ draft, actorPlayerId, facts, journalEntries }) => {
          const asset = draft.finance.assetsById[facts.assetId]!;
          expect(actorPlayerId).toBe(actor);
          expect(facts).toEqual({
            kind: "recurring-acquisition",
            assetId: asset.id,
            assetKind: asset.kind,
            priceCents: card.askingPriceCents,
            buyerCashCents: quote.cashRequiredCents,
            borrowedPrincipalCents: quote.principalCents,
          });
          expect(state.finance.assetsById[asset.id]).toBeUndefined();
          expect(draft.finance.cashByPlayer[actor]).toBe(
            state.finance.cashByPlayer[actor]! - facts.buyerCashCents,
          );
          expect(
            Object.values(draft.finance.loansById)
              .filter(
                (loan) =>
                  loan.kind === "asset-bank-loan" &&
                  loan.borrowerAssetId === asset.id,
              )
              .reduce((sum, loan) => sum + loan.originalPrincipalCents, 0),
          ).toBe(facts.borrowedPrincipalCents);
          expect(
            journalEntries
              .filter(
                (entry) => entry.reason === "recurring-acquisition-purchase",
              )
              .reduce((sum, entry) => sum + entry.amountCents, 0),
          ).toBe(facts.priceCents);
          expect(draft.content.cardsByPlayer[actor]!.status).toBe("acquired");
        },
      );
    },
  );
  it("reports only actual matched sale proceeds and remaining canonical claims after payoff", () => {
    const { state, actor } = atTurn(
        "npc-buyer-proof-0",
        "business",
        (state, actor) => Boolean(recurringBusinessExitQuote(state, actor)),
      ),
      quote = recurringBusinessExitQuote(state, actor)!,
      card = state.content.cardsByPlayer[actor]!;
    proveHook<RecurringBusinessSaleRealizedFacts>(
      state,
      (finalize) =>
        sellRecurringBusiness(state, actor, card.id, quote.id, finalize),
      ({ draft, facts, journalEntries }) => {
        expect(facts).toEqual({
          kind: "npc-business-sale",
          assetId: quote.assetId,
          grossConsiderationCents: quote.grossConsiderationCents,
          netProceedsCents: quote.sellerNetCents,
          remainingClaimsCents: 0,
        });
        const asset = draft.finance.assetsById[facts.assetId]!;
        expect(asset.kind).toBe("business");
        expect(asset.ownershipByPlayerPpm).toEqual({});
        expect(draft.finance.cashByPlayer[actor]).toBe(
          state.finance.cashByPlayer[actor]! +
            facts.netProceedsCents +
            quote.workArrearsPaidCents,
        );
        expect(
          journalEntries
            .filter((entry) => entry.reason === "npc-business-sale-proceeds")
            .reduce((sum, entry) => sum + entry.amountCents, 0),
        ).toBe(facts.netProceedsCents);
        expect(draft.content.cardsByPlayer[actor]!.status).toBe("completed");
      },
    );
  });
  it("reports the funded market loan and posted principal, never its promised interest", () => {
    const { state, actor } = atTurn(
        "ordinary-market-loan-v1",
        "financing",
        (state, actor) => {
          const terms = state.content.cardsByPlayer[actor]?.npcFundingTerms;
          return Boolean(
            terms && quoteNpcFunding(state, actor, terms)?.canFund,
          );
        },
      ),
      card = state.content.cardsByPlayer[actor]!;
    proveHook<RecurringLendingRealizedFacts>(
      state,
      (finalize) => fundRecurringLoan(state, actor, card.id, finalize),
      ({ draft, facts, journalEntries }) => {
        const loan = draft.finance.loansById[facts.loanId]!;
        expect(facts.kind).toBe("market-lending");
        expect(loan.kind).toBe("npc-loan");
        expect(facts.fundedPrincipalCents).toBe(loan.originalPrincipalCents);
        expect(journalEntries[0]!.amountCents).toBe(facts.fundedPrincipalCents);
        expect(draft.finance.cashByPlayer[actor]).toBe(
          state.finance.cashByPlayer[actor]! - facts.fundedPrincipalCents,
        );
        expect(draft.content.cardsByPlayer[actor]!.status).toBe("funded");
      },
    );
  });
  it("reports personally funded expansion after cash, basis and deferred profit effects", () => {
    const { state, actor } = atTurn(
      "business-expansion",
      "business",
      (state, actor) =>
        Object.values(state.finance.assetsById).some(
          (asset) =>
            asset.kind === "business" &&
            asset.ownershipByPlayerPpm[actor] === 1_000_000,
        ),
    );
    const asset = Object.values(state.finance.assetsById).find(
      (asset) =>
        asset.kind === "business" &&
        asset.ownershipByPlayerPpm[actor] === 1_000_000,
    )!;
    if (asset.kind !== "business") throw new Error();
    const investment = asset.cashCents + 400_000;
    // Approved growth uses exact multiples of four; preserve the actual company reserve rather than adjusting it.
    const roundedInvestment = Math.ceil(investment / 4) * 4,
      actualContribution = roundedInvestment - asset.cashCents;
    proveHook<BusinessExpansionRealizedFacts>(
      state,
      (finalize) =>
        expandBusinessAndAdvanceSpotlight(
          state,
          actor,
          {
            assetId: asset.id,
            investmentCents: roundedInvestment,
            ownerContributionCents: actualContribution,
          },
          finalize,
        ),
      ({ draft, facts, journalEntries }) => {
        expect(facts).toEqual({
          kind: "business-expansion",
          assetId: asset.id,
          totalInvestmentCents: roundedInvestment,
          ownerContributionCents: actualContribution,
        });
        expect(draft.finance.cashByPlayer[actor]).toBe(
          state.finance.cashByPlayer[actor]! - actualContribution,
        );
        expect(
          draft.progress.byPlayer[actor]!.assetsById[asset.id]!.costCents,
        ).toBe(
          state.progress.byPlayer[actor]!.assetsById[asset.id]!.costCents +
            actualContribution,
        );
        expect(draft.finance.assetsById[asset.id]).toMatchObject({
          cashCents: 0,
          pendingAnnualProfitIncreaseCents: roundedInvestment / 4,
        });
        expect(journalEntries.map((entry) => entry.reason)).toEqual([
          "business-owner-expansion-contribution",
          "business-expansion",
        ]);
      },
    );
  });
});
