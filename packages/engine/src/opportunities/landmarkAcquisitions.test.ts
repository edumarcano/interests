import {
  RECURRING_CONTENT_RULES,
  RECURRING_CONTENT_TEMPLATES,
} from "@interests/rules";
import {
  asPlayerId,
  type PlayerId,
  type RecurringAcquisitionRoute,
} from "@interests/shared";
import { describe, expect, it } from "vitest";
import { cents } from "../finance/money";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import {
  recurringCandidateWeights,
  recurringInvestigationFeeCents,
} from "./recurring";
import { getRecurringAcquisitionTerms } from "./recurringAcquisition";
import { getRecurringAcquisitionQuotes } from "./recurringPurchase";

const players = ["a", "b", "c", "d"].map(asPlayerId),
  actor = players[0]!;
function send(
  state: GameState,
  player: PlayerId,
  command: Parameters<typeof applyPlayerCommand>[2],
) {
  const result = applyPlayerCommand(state, player, command);
  if (!result.ok) throw new Error(`${command.type}: ${result.code}`);
  assertGameState(result.state);
  return result;
}
function ready() {
  let state = createGame({
    gameId: "landmark-closing",
    seed: "landmark-closing",
    playerIds: players,
  });
  for (const player of players)
    state = send(state, player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[player]!.offeredObjectiveIds[0],
    }).state;
  // Explicit synthetic cash boundary. This does not claim ordinary objective reachability.
  state = {
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [actor]: cents(2_000_000_000),
      },
    },
  };
  state = send(state, actor, { type: "BEGIN_ROUND" }).state;
  return state;
}
function stageCard(
  state: GameState,
  templateId: string,
  priceDirection: -1 | 0 | 1 = 0,
) {
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (item) => item.id === templateId,
  )!;
  const askingPriceCents = cents(
    (template.askingPriceCents *
      (10_000 +
        priceDirection * RECURRING_CONTENT_RULES.askingPriceVariationBps)) /
      10_000,
  );
  const facts =
    template.facts?.kind === "business"
      ? {
          ...template.facts,
          annualOperatingProfitCents:
            (template.facts.annualOperatingProfitCents *
              (10_000 - RECURRING_CONTENT_RULES.businessProfitVariationBps)) /
            10_000,
        }
      : template.facts;
  const card = {
    id: state.content.cardsByPlayer[actor]!.id,
    targetPlayerId: actor,
    createdQuarter: state.currentQuarter,
    templateId,
    category: template.category,
    askingPriceCents,
    investigationFeeCents: recurringInvestigationFeeCents(askingPriceCents),
    facts,
    status: "available" as const,
    investigated: false,
  };
  const staged: GameState = {
    ...state,
    content: {
      ...state.content,
      cardsByPlayer: { ...state.content.cardsByPlayer, [actor]: card },
    },
  };
  assertGameState(staged);
  return staged;
}
function close(state: GameState, route: RecurringAcquisitionRoute) {
  const card = state.content.cardsByPlayer[actor]!;
  const quote = getRecurringAcquisitionQuotes(state, actor, card.id).find(
    (item) => item.route === route,
  )!;
  expect(quote.canClose).toBe(true);
  const result = send(state, actor, {
    type: "ACQUIRE_RECURRING_OPPORTUNITY",
    opportunityId: card.id,
    quoteId: quote.id,
  });
  const asset = Object.values(result.state.finance.assetsById).find(
    (item) => !state.finance.assetsById[item.id],
  )!;
  return { result, asset, quote };
}
function nextOwnSpotlight(initial: GameState) {
  let state = initial;
  for (let step = 0; step < 10; step++) {
    if (state.round?.stage === "round-start")
      state = send(state, actor, { type: "BEGIN_ROUND" }).state;
    const active = getActiveSpotlightPlayerId(state)!;
    if (active === actor) return state;
    state = send(state, active, { type: "PASS_SPOTLIGHT" }).state;
  }
  throw new Error("No next own spotlight");
}

describe("authored landmark acquisitions use the existing authoritative close", () => {
  it.each(["cash", "bank-variable"] as const)(
    "closes the minimum-price residential court via %s above the landmark consideration floor",
    (route) => {
      const state = stageCard(ready(), "residential-income-court", -1);
      const { result, quote, asset } = close(state, route);
      expect(quote.askingPriceCents).toBe(63_375_000);
      expect(quote.askingPriceCents).toBeGreaterThanOrEqual(60_000_000);
      expect(quote.propertyMarketKind).toBe("residential");
      expect(asset).toMatchObject({
        kind: "property",
        marketKind: "residential",
        marketValueCents: 67_000_000,
        scheduledQuarterlyRentCents: 1_800_000,
        ownershipByPlayerPpm: { [actor]: 1_000_000 },
        cashCents: quote.assetReserveCents,
      });
      expect(
        result.state.progress.byPlayer[actor]!.assetsById[asset.id],
      ).toMatchObject({
        acquiredQuarter: 1,
        acquisition: {
          templateId: "residential-income-court",
          considerationCents: 63_375_000,
        },
      });
      expect(
        result.state.finance.quarterStartBasis.propertiesById[asset.id],
      ).toBeUndefined();
    },
  );
  it("uses commercial template metadata in trusted terms, public quotes and the actual closed asset", () => {
    const state = stageCard(ready(), "commercial-service-center", 1);
    const card = state.content.cardsByPlayer[actor]!;
    const terms = getRecurringAcquisitionTerms(state, actor, card.id);
    expect(terms).toMatchObject({
      ok: true,
      terms: { kind: "property", marketKind: "commercial" },
    });
    const { result, asset, quote } = close(state, "bank-fixed");
    expect(quote).toMatchObject({
      propertyMarketKind: "commercial",
      askingPriceCents: 112_750_000,
    });
    expect(asset).toMatchObject({
      marketKind: "commercial",
      marketValueCents: 112_000_000,
      scheduledQuarterlyRentCents: 3_300_000,
      occupancyBps: 9200,
    });
    expect(result.state.revision).toBe(state.revision + 1);
    expect(
      result.journalEntries.find(
        (entry) => entry.reason === "recurring-acquisition-purchase-fee",
      )!.amountCents,
    ).toBe(2_255_000);
    expect(
      JSON.stringify(getRecurringAcquisitionQuotes(state, actor, card.id)),
    ).not.toMatch(/scheduledQuarterlyRent|occupancyBps|marketValueCents|facts/);
    expect(
      projectPlayerGameState(state, actor).self.recurringOpportunity,
    ).not.toHaveProperty("facts");
  });
  it("closes three separately funded properties with more than $1.8M current controlled value", () => {
    let state = ready();
    const ids: string[] = [];
    for (const template of [
      "residential-income-court",
      "residential-income-court",
      "commercial-service-center",
    ]) {
      state = stageCard(nextOwnSpotlight(state), template, -1);
      const closed = close(state, "cash");
      ids.push(closed.asset.id);
      state = closed.result.state;
    }
    expect(new Set(ids).size).toBe(3);
    const properties = ids.map(
      (id) =>
        Object.values(state.finance.assetsById).find(
          (asset) => asset.id === id,
        )!,
    );
    expect(
      properties.every(
        (asset) =>
          asset.kind === "property" &&
          asset.ownershipByPlayerPpm[actor] === 1_000_000,
      ),
    ).toBe(true);
    expect(
      properties.reduce(
        (sum, asset) =>
          sum + (asset.kind === "property" ? asset.marketValueCents : 0),
        0,
      ),
    ).toBeGreaterThanOrEqual(180_000_000);
    expect(
      Object.values(state.finance.loansById).some(
        (loan) =>
          loan.kind === "asset-bank-loan" && ids.includes(loan.borrowerAssetId),
      ),
    ).toBe(false);
  });
  it.each(["cash", "bank-fixed"] as const)(
    "acquires the mature group via %s with at least $250k actual after-labor profit and no labor invention",
    (route) => {
      const state = stageCard(ready(), "established-service-group", 1);
      const { result, asset, quote } = close(state, route);
      expect(asset).toMatchObject({
        kind: "business",
        annualRevenueCents: 180_000_000,
        annualOperatingProfitCents: 25_650_000,
        enterpriseValueCents: 108_000_000,
        cashCents: quote.assetReserveCents,
      });
      expect(asset).toMatchObject({
        operatingModel: {
          sensitivity: "medium",
          fixedAnnualLaborCostsCents: 36_000_000,
          referenceAnnualNonLaborCostsCents: 118_350_000,
          firstOperatingQuarter: 2,
        },
      });
      expect(asset).not.toHaveProperty("workCompensation");
      expect(
        result.state.progress.byPlayer[actor]!.assetsById[asset.id]!.costCents,
      ).toBe(quote.cashRequiredCents);
      expect(
        result.state.finance.quarterStartBasis.businessesById[asset.id],
      ).toMatchObject({ annualOperatingProfitCents: 0 });
    },
  );
  it("weights the new commercial decision more from Q9 while retaining quick-majority unowned choices", () => {
    const initial = ready();
    const base = {
      ...initial,
      finance: {
        ...initial.finance,
        assetsById: {},
        publicMarketsByPlayer: {
          ...initial.finance.publicMarketsByPlayer,
          [actor]: {
            "broad-market-fund": cents(0),
            "growth-fund": cents(0),
            "income-defensive-fund": cents(0),
          },
        },
      },
      progress: {
        byPlayer: {
          ...initial.progress.byPlayer,
          [actor]: {
            ...initial.progress.byPlayer[actor]!,
            focus: "general" as const,
          },
        },
      },
      content: {
        ...initial.content,
        recentCategoriesByPlayer: {
          ...initial.content.recentCategoriesByPlayer,
          [actor]: [],
        },
      },
    };
    const before = recurringCandidateWeights(
      { ...base, currentQuarter: 8 },
      actor,
    );
    const after = recurringCandidateWeights(
      { ...base, currentQuarter: 9 },
      actor,
    );
    expect(
      after.find((item) => item.template.id === "commercial-service-center")!
        .weight,
    ).toBe(
      before.find((item) => item.template.id === "commercial-service-center")!
        .weight * 2,
    );
    expect(
      after
        .filter((item) => item.template.intensity === "quick")
        .reduce((sum, item) => sum + item.weight, 0),
    ).toBeGreaterThan(
      after
        .filter((item) => item.template.intensity !== "quick")
        .reduce((sum, item) => sum + item.weight, 0),
    );
  });
});
