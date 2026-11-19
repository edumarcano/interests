import { RECURRING_CONTENT_TEMPLATES } from "@interests/rules";
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
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { recurringInvestigationFeeCents } from "./recurring";
import { getRecurringAcquisitionQuotes } from "./recurringPurchase";

const players = ["a", "b", "c", "d"].map(asPlayerId);
// Explicit synthetic close-boundary fixture: authored terms, injected liquidity, no outcome claims.
function fixture(templateId = "local-service-company", actor = players[0]!) {
  let state = createGame({
    gameId: "recurring-close",
    seed: "recurring-close",
    playerIds: players,
  });
  for (const player of players) {
    const result = applyPlayerCommand(state, player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[player]!.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (item) => item.id === templateId,
  )!;
  const card = {
    id: state.content.cardsByPlayer[actor]!.id,
    targetPlayerId: actor,
    createdQuarter: state.currentQuarter,
    status: "available" as const,
    investigated: false,
    templateId,
    category: template.category,
    askingPriceCents: cents(template.askingPriceCents),
    investigationFeeCents: recurringInvestigationFeeCents(
      template.askingPriceCents,
    ),
    facts: template.facts,
  };
  state = {
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [actor]: cents(100_000_000),
      },
    },
    round: { stage: "spotlight", spotlightsCompleted: players.indexOf(actor) },
    content: {
      ...state.content,
      cardsByPlayer: { ...state.content.cardsByPlayer, [actor]: card },
    },
  };
  assertGameState(state);
  return { state, actor, card };
}
function close(
  state: GameState,
  actor: PlayerId,
  route: RecurringAcquisitionRoute,
) {
  const id = state.content.cardsByPlayer[actor]!.id;
  const quote = getRecurringAcquisitionQuotes(state, actor, id).find(
    (item) => item.route === route,
  )!;
  expect(quote, route).toBeTruthy();
  expect(quote.canClose).toBe(true);
  const result = applyPlayerCommand(state, actor, {
    type: "ACQUIRE_RECURRING_OPPORTUNITY",
    opportunityId: id,
    quoteId: quote.id,
  });
  expect(result.ok, result.ok ? undefined : result.code).toBe(true);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  const asset = Object.values(result.state.finance.assetsById).find(
    (item) => !state.finance.assetsById[item.id],
  )!;
  return { result, quote, asset };
}

describe("recurring NPC acquisitions through production commands", () => {
  it.each(["cash", "bank-fixed"] as const)(
    "buys a real managed business using %s, with exact buyer equity basis",
    (route) => {
      const { state, actor, card } = fixture();
      const before = JSON.stringify(state);
      const quotes = getRecurringAcquisitionQuotes(state, actor, card.id);
      expect(JSON.stringify(state)).toBe(before);
      expect(JSON.stringify(quotes)).not.toMatch(
        /annualRevenue|annualOperatingProfit|enterpriseValue|facts/,
      );
      const { result, quote, asset } = close(state, actor, route);
      expect(result.state.revision).toBe(state.revision + 1);
      expect(result.state.finance.cashByPlayer[actor]).toBe(
        state.finance.cashByPlayer[actor]! - quote.cashRequiredCents,
      );
      expect(asset).toMatchObject({
        kind: "business",
        annualRevenueCents: 25_000_000,
        annualOperatingProfitCents: 3_000_000,
        enterpriseValueCents: 12_000_000,
        cashCents: quote.assetReserveCents,
      });
      expect(asset).not.toHaveProperty("operatingModel");
      expect(
        result.state.progress.byPlayer[actor]!.assetsById[asset.id],
      ).toMatchObject({
        costCents: quote.cashRequiredCents,
        acquiredQuarter: 1,
        ownershipPpm: 1_000_000,
        acquisition: {
          considerationCents: 10_000_000,
          feeCents: 200_000,
          bankPrincipalCents: quote.principalCents,
          buyerCashCents: quote.cashRequiredCents,
        },
      });
      expect(quote.cashRequiredCents + quote.principalCents).toBe(
        10_200_000 + quote.assetReserveCents,
      );
      const loan = Object.values(result.state.finance.loansById).find(
        (item) =>
          item.kind === "asset-bank-loan" && item.borrowerAssetId === asset.id,
      );
      if (route === "bank-fixed")
        expect(loan).toMatchObject({
          purpose: "business-acquisition",
          originalPrincipalCents: quote.principalCents,
          annualRateBps: quote.annualRateBps,
          scheduledQuarterlyPaymentCents: quote.quarterlyPaymentCents,
          firstDueQuarter: 2,
        });
      else expect(loan).toBeUndefined();
      expect(
        result.state.finance.quarterStartBasis.businessesById[asset.id],
      ).toMatchObject({ annualOperatingProfitCents: 0 });
      expect(result.state.content.cardsByPlayer[actor]!.status).toBe(
        "acquired",
      );
      expect(
        result.journalEntries.filter(
          (item) => item.reason === "recurring-acquisition-purchase-fee",
        ),
      ).toHaveLength(1);
      expect(
        projectPlayerGameState(result.state, actor).self.recurringOpportunity,
      ).not.toHaveProperty("facts");
    },
  );
  it.each(["cash", "bank-fixed", "bank-variable"] as const)(
    "buys a residential property using %s and preserves the existing gross-basis convention",
    (route) => {
      const { state, actor } = fixture("residential-rental");
      const { result, quote, asset } = close(state, actor, route);
      expect(asset).toMatchObject({
        kind: "property",
        marketKind: "residential",
        marketValueCents: 15_500_000,
        scheduledQuarterlyRentCents: 450_000,
        cashCents: quote.assetReserveCents,
      });
      expect(
        result.state.progress.byPlayer[actor]!.assetsById[asset.id]!.costCents,
      ).toBe(15_300_000 + quote.assetReserveCents);
      expect(quote.cashRequiredCents + quote.principalCents).toBe(
        15_300_000 + quote.assetReserveCents,
      );
      expect(
        result.state.finance.quarterStartBasis.propertiesById[asset.id],
      ).toBeUndefined();
    },
  );
  it("atomically settles a fourth spotlight once, with first earnings and bank payment next quarter", () => {
    const { state, actor } = fixture("local-service-company", players[3]!);
    const { result, asset, quote } = close(state, actor, "bank-fixed");
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.currentQuarter).toBe(2);
    expect(
      result.settlementOutcome!.businesses.some(
        (item) => item.assetId === asset.id,
      ),
    ).toBe(false);
    expect(
      result.settlementOutcome!.loanPayments.some(
        (item) => item.borrowerAssetId === asset.id,
      ),
    ).toBe(false);
    expect(
      result.state.finance.quarterStartBasis.businessesById[asset.id],
    ).toMatchObject({ annualOperatingProfitCents: 3_000_000 });
    let next = applyPlayerCommand(result.state, players[0]!, {
      type: "BEGIN_ROUND",
    });
    if (!next.ok) throw new Error(next.code);
    for (const player of [players[1]!, players[2]!, players[3]!, players[0]!]) {
      next = applyPlayerCommand(next.state, player, { type: "PASS_SPOTLIGHT" });
      if (!next.ok) throw new Error(next.code);
    }
    expect(
      next.state.finance.lastSettlement!.businesses.find(
        (item) => item.assetId === asset.id,
      )!.operatingCashCents,
    ).toBe(750_000);
    expect(
      next.state.finance.lastSettlement!.loanPayments.find(
        (item) => item.borrowerAssetId === asset.id,
      )!.paidCents,
    ).toBe(quote.quarterlyPaymentCents);
  });
  it("rolls back consideration, fee, debt, source evidence and every counter when final settlement fails", () => {
    const { state, actor, card } = fixture(
      "local-service-company",
      players[3]!,
    );
    const exhausted = {
      ...state,
      counters: { ...state.counters, settlement: Number.MAX_SAFE_INTEGER },
    };
    const quote = getRecurringAcquisitionQuotes(exhausted, actor, card.id).find(
      (item) => item.route === "bank-fixed",
    )!;
    const before = JSON.stringify(exhausted);
    const result = applyPlayerCommand(exhausted, actor, {
      type: "ACQUIRE_RECURRING_OPPORTUNITY",
      opportunityId: card.id,
      quoteId: quote.id,
    });
    expect(result).toMatchObject({
      ok: false,
      state: exhausted,
      journalEntries: [],
    });
    expect(result.state).toBe(exhausted);
    expect(JSON.stringify(exhausted)).toBe(before);
  });
  it("rejects off-turn, stale, unavailable and other recipients' cards without mutation", () => {
    const { state, actor, card } = fixture();
    const quote = getRecurringAcquisitionQuotes(state, actor, card.id)[0]!;
    const command = {
      type: "ACQUIRE_RECURRING_OPPORTUNITY" as const,
      opportunityId: card.id,
      quoteId: quote.id,
    };
    for (const [input, player, payload] of [
      [state, players[1]!, command],
      [state, actor, { ...command, quoteId: `${quote.id}:stale` }],
      [state, actor, { ...command, opportunityId: "not-visible" }],
    ] as const) {
      const before = JSON.stringify(input);
      const result = applyPlayerCommand(input, player, payload);
      expect(result).toMatchObject({
        ok: false,
        state: input,
        journalEntries: [],
      });
      expect(result.state).toBe(input);
      expect(JSON.stringify(input)).toBe(before);
    }
    expect(getRecurringAcquisitionQuotes(state, players[1]!, card.id)).toEqual(
      [],
    );
    const bought = close(state, actor, "cash").result.state;
    const repeated = applyPlayerCommand(
      { ...bought, round: state.round },
      actor,
      command,
    );
    expect(repeated.ok).toBe(false);
  });
  it("rejects journal/asset/loan/transaction exhaustion and actual cash shortfalls without leaking partial closes", () => {
    const { state, actor, card } = fixture();
    const quote = getRecurringAcquisitionQuotes(state, actor, card.id).find(
      (item) => item.route === "bank-fixed",
    )!;
    for (const counter of [
      "journal",
      "asset",
      "loan",
      "transaction",
    ] as const) {
      const input = {
        ...state,
        counters: { ...state.counters, [counter]: Number.MAX_SAFE_INTEGER },
      };
      const before = JSON.stringify(input);
      const result = applyPlayerCommand(input, actor, {
        type: "ACQUIRE_RECURRING_OPPORTUNITY",
        opportunityId: card.id,
        quoteId: quote.id,
      });
      expect(result).toMatchObject({
        ok: false,
        state: input,
        journalEntries: [],
      });
      expect(JSON.stringify(input)).toBe(before);
    }
    const poor = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: { ...state.finance.cashByPlayer, [actor]: cents(1) },
      },
    };
    expect(
      getRecurringAcquisitionQuotes(poor, actor, card.id).every(
        (item) => !item.canClose,
      ),
    ).toBe(true);
  });
  it("blocks an unrelated live auction without using pledged cash or advancing", () => {
    const initial = fixture();
    const business = Object.values(initial.state.finance.assetsById).find(
      (asset) => asset.kind === "business",
    );
    if (!business)
      throw new Error("Expected a starting company for the auction boundary");
    const owner = Object.keys(business.ownershipByPlayerPpm)[0] as PlayerId;
    const { state, card } = fixture("local-service-company", owner);
    const quote = getRecurringAcquisitionQuotes(state, owner, card.id)[0]!;
    const opened = applyPlayerCommand(state, owner, {
      type: "OPEN_BUSINESS_AUCTION",
      assetId: business.id,
      ownershipPpm: 100_000,
      minimumBidCents: 10_000,
    });
    if (!opened.ok) throw new Error(opened.code);
    const before = JSON.stringify(opened.state);
    const result = applyPlayerCommand(opened.state, owner, {
      type: "ACQUIRE_RECURRING_OPPORTUNITY",
      opportunityId: card.id,
      quoteId: quote.id,
    });
    expect(result).toEqual({
      ok: false,
      state: opened.state,
      code: "ACTIVE_TRANSACTION",
      journalEntries: [],
    });
    expect(JSON.stringify(opened.state)).toBe(before);
    expect(getRecurringAcquisitionQuotes(opened.state, owner, card.id)).toEqual(
      [],
    );
  });
  it("allows optional paid diligence before the same stored cash acquisition", () => {
    const { state, actor, card } = fixture();
    const investigated = applyPlayerCommand(state, actor, {
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: card.id,
    });
    if (!investigated.ok) throw new Error(investigated.code);
    const { result, asset } = close(investigated.state, actor, "cash");
    expect(asset.kind === "business" && asset.annualOperatingProfitCents).toBe(
      card.facts!.kind === "business" && card.facts!.annualOperatingProfitCents,
    );
    expect(result.state.finance.cashByPlayer[actor]).toBe(
      state.finance.cashByPlayer[actor]! - 10_200_000 - 25_000,
    );
  });
});
