import { RECURRING_CONTENT_TEMPLATES } from "@interests/rules";
import { asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { cents } from "../finance/money";
import { applyQuarterSettlement } from "../finance/settlement";
import { createGame, createQ1BusinessDiagnosticGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { createRandomState } from "../random/prng";
import {
  generateRecurringContent,
  projectRecurringOpportunity,
  recurringCandidateWeights,
  recurringInvestigationFeeCents,
} from "./recurring";
import { getRecurringAcquisitionTerms } from "./recurringAcquisition";

const players = ["a", "b", "c", "d"].map(asPlayerId);
function game(seed = "recurring-content") {
  return createGame({ gameId: "recurring-content", seed, playerIds: players });
}
function ready(initial = game()) {
  let state = initial;
  for (const player of players) {
    const result = applyPlayerCommand(state, player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[player]!.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  return state;
}
/** Explicit synthetic liquidity boundary, not an ordinary reachability claim. */
function investigationFixture(): {
  state: GameState;
  owner: (typeof players)[number];
} {
  for (let seed = 0; seed < 100; seed++) {
    const initial = ready(game(`diligence-${seed}`));
    const state = generateRecurringContent({
      ...initial,
      finance: {
        ...initial.finance,
        cashByPlayer: Object.fromEntries(
          players.map((id) => [id, cents(20_000_000)]),
        ),
      },
      content: {
        ...initial.content,
        generatedQuarter: 0,
        random: createRandomState(`diligence-${seed}:recurring-content-v1`),
        cardsByPlayer: Object.fromEntries(players.map((id) => [id, null])),
        recentCategoriesByPlayer: Object.fromEntries(
          players.map((id) => [id, []]),
        ),
      },
    });
    const owner = players.find(
      (player) => state.content.cardsByPlayer[player]?.facts,
    );
    if (owner) {
      assertGameState(state);
      return { state, owner };
    }
  }
  throw new Error("Missing investigation fixture");
}

describe("ordinary objective-neutral recurring generation", () => {
  it("creates one private card per player without a free diagnostic asset or cash movement", () => {
    const state = game();
    expect(Object.values(state.opportunitiesById)).toEqual([]);
    expect(state.content.generatedQuarter).toBe(1);
    expect(Object.values(state.content.cardsByPlayer)).toHaveLength(4);
    expect(
      new Set(
        Object.values(state.content.cardsByPlayer).map((card) => card!.id),
      ).size,
    ).toBe(4);
    expect(state.counters.opportunity).toBe(4);
    expect(
      Object.values(state.finance.assetsById).every(
        (asset) =>
          asset.kind !== "business" ||
          asset.cashPolicyId === "starting-company-v1",
      ),
    ).toBe(true);
    expect(state.revision).toBe(0);
    expect(state.counters.journal).toBe(0);
    expect(generateRecurringContent(state)).toBe(state);
    expect(game()).toEqual(state);
  });
  it("retains the original free-company scenario only under its explicit diagnostic name", () => {
    const input = {
      gameId: "diagnostic",
      seed: "diagnostic",
      playerIds: players,
    };
    const state = createQ1BusinessDiagnosticGame(input);
    expect(state.content.scenario).toBe("q1-business-diagnostic");
    expect(Object.values(state.content.cardsByPlayer)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(Object.values(state.opportunitiesById)).toHaveLength(1);
    expect(
      Object.values(state.finance.assetsById).some(
        (asset) =>
          asset.kind === "business" &&
          asset.cashPolicyId === "retained-profit-v1",
      ),
    ).toBe(true);
    expect(state.random).toEqual(createGame(input).random);
  });
  it("does not read objectives for candidate weighting or seeded selection", () => {
    const initial = ready();
    const player = players[0]!;
    const changed = {
      ...initial,
      players: {
        ...initial.players,
        [player]: {
          ...initial.players[player]!,
          selectedObjectiveId: initial.players[player]!.offeredObjectiveIds[1],
        },
      },
    };
    expect(recurringCandidateWeights(changed, player)).toEqual(
      recurringCandidateWeights(initial, player),
    );
    const pending = (state: GameState) => ({
      ...state,
      currentQuarter: 2,
      content: { ...state.content, generatedQuarter: 1 },
    });
    expect(generateRecurringContent(pending(changed)).content).toEqual(
      generateRecurringContent(pending(initial)).content,
    );
  });
  it("applies focus×3, recent-category half weight and Q9 larger-deal pressure", () => {
    const initial = ready();
    const player = players[0]!;
    const weight = (state: GameState, templateId: string) =>
      recurringCandidateWeights(state, player).find(
        (candidate) => candidate.template.id === templateId,
      )!.weight;
    const base = {
      ...initial,
      content: {
        ...initial.content,
        recentCategoriesByPlayer: {
          ...initial.content.recentCategoriesByPlayer,
          [player]: [],
        },
      },
    };
    const focused = applyPlayerCommand(base, player, {
      type: "SET_FOCUS",
      focus: "career",
    });
    if (!focused.ok) throw new Error(focused.code);
    expect(weight(focused.state, "career-review")).toBe(
      weight(base, "career-review") * 3,
    );
    const repeated = {
      ...focused.state,
      content: {
        ...focused.state.content,
        recentCategoriesByPlayer: {
          ...focused.state.content.recentCategoriesByPlayer,
          [player]: ["career" as const],
        },
      },
    };
    expect(weight(repeated, "career-review")).toBe(
      weight(focused.state, "career-review") / 2,
    );
    const rich = {
      ...base,
      finance: {
        ...base.finance,
        cashByPlayer: {
          ...base.finance.cashByPlayer,
          [player]: cents(50_000_000),
        },
      },
    };
    expect(weight({ ...rich, currentQuarter: 9 }, "regional-company")).toBe(
      weight({ ...rich, currentQuarter: 8 }, "regional-company") * 2,
    );
    expect(focused.state.content).toEqual(base.content);
    expect(focused.state.random).toEqual(base.random);
  });
  it("doubles ownership-relevant market weighting without reading rivals' private resources", () => {
    const initial = ready();
    const player = players.find((id) =>
      Object.values(initial.finance.publicMarketsByPlayer[id]!).some(
        (value) => value > 0,
      ),
    )!;
    const base = {
      ...initial,
      content: {
        ...initial.content,
        recentCategoriesByPlayer: {
          ...initial.content.recentCategoriesByPlayer,
          [player]: [],
        },
      },
    };
    const noHoldings = {
      ...base,
      finance: {
        ...base.finance,
        publicMarketsByPlayer: {
          ...base.finance.publicMarketsByPlayer,
          [player]: {
            "broad-market-fund": cents(0),
            "growth-fund": cents(0),
            "income-defensive-fund": cents(0),
          },
        },
      },
    };
    const owned = recurringCandidateWeights(base, player).find(
      (candidate) => candidate.template.id === "fund-allocation",
    )!;
    const unowned = recurringCandidateWeights(noHoldings, player).find(
      (candidate) => candidate.template.id === "fund-allocation",
    )!;
    expect(owned.weight).toBe(unowned.weight * 2);
  });
  it("hard-filters unavailable ownership/cash and keeps quick choices the majority", () => {
    const initial = ready();
    for (const player of players) {
      const candidates = recurringCandidateWeights(initial, player);
      for (const candidate of candidates)
        expect(
          initial.finance.cashByPlayer[player]! >=
            candidate.template.minimumCashCents ||
            ["npc-business-purchase", "npc-property-purchase"].includes(
              candidate.template.action,
            ),
        ).toBe(true);
      const quick = candidates
        .filter((candidate) => candidate.template.intensity === "quick")
        .reduce((total, candidate) => total + candidate.weight, 0);
      expect(quick).toBeGreaterThan(
        candidates
          .filter((candidate) => candidate.template.intensity !== "quick")
          .reduce((total, candidate) => total + candidate.weight, 0),
      );
    }
  });
  it("skips a property when an overdue buyer has the maximum price and fee but cannot retain the required reserve", () => {
    const base = ready();
    const buyer = players[0]!;
    const snapshot = (cash: number): GameState => ({
      ...base,
      finance: {
        ...base.finance,
        cashByPlayer: { ...base.finance.cashByPlayer, [buyer]: cents(cash) },
        livingArrearsByPlayer: {
          ...base.finance.livingArrearsByPlayer,
          [buyer]: cents(1),
        },
      },
    });
    const exactlyPriceWithFee = snapshot(15_682_500);
    assertGameState(exactlyPriceWithFee);
    const offersRental = (state: GameState) =>
      recurringCandidateWeights(state, buyer).some(
        ({ template }) => template.id === "residential-rental",
      );
    expect(offersRental(exactlyPriceWithFee)).toBe(false);
    expect(offersRental(snapshot(25_000_000))).toBe(true);
  });
  it("expires a card at its owner's spotlight and generates the next quarter once", () => {
    let state = ready();
    const begin = applyPlayerCommand(state, players[0]!, {
      type: "BEGIN_ROUND",
    });
    if (!begin.ok) throw new Error(begin.code);
    state = begin.state;
    const oldCards = state.content.cardsByPlayer;
    for (let index = 0; index < 4; index++) {
      const result = applyPlayerCommand(state, players[index]!, {
        type: "PASS_SPOTLIGHT",
      });
      if (!result.ok) throw new Error(result.code);
      expect(result.state.revision).toBe(state.revision + 1);
      if (index < 3)
        expect(
          result.state.content.cardsByPlayer[players[index]!]!.status,
        ).toBe("expired");
      state = result.state;
    }
    expect(state.currentQuarter).toBe(2);
    expect(state.content.generatedQuarter).toBe(2);
    expect(state.counters.opportunity).toBe(8);
    for (const player of players) {
      expect(state.content.cardsByPlayer[player]!.id).not.toBe(
        oldCards[player]!.id,
      );
      expect(state.content.cardsByPlayer[player]!.createdQuarter).toBe(2);
      expect(state.content.recentCategoriesByPlayer[player]).toHaveLength(2);
    }
    expect(generateRecurringContent(state)).toBe(state);
  });
  it("rejects next-quarter opportunity ID exhaustion without committing fees, expiry or streams", () => {
    const initial = ready();
    const state = {
      ...initial,
      round: { stage: "spotlight" as const, spotlightsCompleted: 3 },
      counters: { ...initial.counters, opportunity: Number.MAX_SAFE_INTEGER },
    };
    const before = JSON.stringify(state);
    const result = applyPlayerCommand(state, players[3]!, {
      type: "PASS_SPOTLIGHT",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "OPPORTUNITY_ID_EXHAUSTED",
      state,
      journalEntries: [],
    });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("does not draw content randomness for a finished match or a Q33 candidate", () => {
    const state = ready();
    for (const candidate of [
      { ...state, phase: "finished" as const },
      { ...state, currentQuarter: 33 },
    ])
      expect(generateRecurringContent(candidate)).toBe(candidate);
  });
  it("rolls back expiry, generation and RNG together when the final settlement rejects", () => {
    const state = {
      ...ready(),
      round: { stage: "spotlight" as const, spotlightsCompleted: 3 },
    };
    const exhausted = {
      ...state,
      counters: { ...state.counters, settlement: Number.MAX_SAFE_INTEGER },
    };
    const before = JSON.stringify(exhausted);
    const result = applyPlayerCommand(exhausted, players[3]!, {
      type: "PASS_SPOTLIGHT",
    });
    expect(result).toMatchObject({
      ok: false,
      state: exhausted,
      journalEntries: [],
    });
    expect(result.state).toBe(exhausted);
    expect(JSON.stringify(exhausted)).toBe(before);
  });
});

describe("authoritative recurring acquisition terms", () => {
  it("resolves typed stored facts, fees and the authored labor calibration without changing state", () => {
    const { state, owner } = investigationFixture();
    const card = state.content.cardsByPlayer[owner]!;
    const before = JSON.stringify(state);
    const result = getRecurringAcquisitionTerms(state, owner, card.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.terms.facts).toEqual(card.facts);
    expect(result.terms.askingPriceCents).toBe(card.askingPriceCents);
    expect(result.terms.totalCashRequiredCents).toBe(
      card.askingPriceCents + result.terms.purchaseFeeCents,
    );
    if (result.terms.kind === "business") {
      expect(result.terms.necessaryLabor).toEqual({
        kind: "included-in-after-labor-profit",
        explicitAnnualCostCents: 6_000_000,
      });
      expect(
        result.terms.annualTotalOperatingCostsCents +
          result.terms.facts.annualOperatingProfitCents,
      ).toBe(result.terms.facts.annualRevenueCents);
    } else expect(result.terms.marketKind).toBe("residential");
    expect(JSON.stringify(state)).toBe(before);
    expect(
      getRecurringAcquisitionTerms(
        state,
        players.find((player) => player !== owner)!,
        card.id,
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND_OR_NOT_VISIBLE" });
  });
  it("prepares residential cash-purchase terms with exact rule-owned fees", () => {
    const { state, owner } = investigationFixture();
    const original = state.content.cardsByPlayer[owner]!;
    const template = RECURRING_CONTENT_TEMPLATES.find(
      (candidate) => candidate.id === "residential-rental",
    )!;
    const property = {
      ...state,
      content: {
        ...state.content,
        cardsByPlayer: {
          ...state.content.cardsByPlayer,
          [owner]: {
            ...original,
            templateId: template.id,
            category: template.category,
            askingPriceCents: cents(15_000_000),
            investigationFeeCents: cents(37_500),
            facts: template.facts,
          },
        },
      },
    };
    assertGameState(property);
    const result = getRecurringAcquisitionTerms(property, owner, original.id);
    expect(result).toMatchObject({
      ok: true,
      terms: {
        kind: "property",
        marketKind: "residential",
        askingPriceCents: 15_000_000,
        purchaseFeeCents: 300_000,
        totalCashRequiredCents: 15_300_000,
        cashAffordable: true,
      },
    });
  });
  it("rejects expired terms and overflowing purchase totals atomically", () => {
    const { state, owner } = investigationFixture();
    const card = state.content.cardsByPlayer[owner]!;
    const expired = {
      ...state,
      content: {
        ...state.content,
        cardsByPlayer: {
          ...state.content.cardsByPlayer,
          [owner]: { ...card, status: "expired" as const },
        },
      },
    };
    expect(getRecurringAcquisitionTerms(expired, owner, card.id)).toEqual({
      ok: false,
      code: "OPPORTUNITY_NOT_AVAILABLE",
    });
    const unsafe = {
      ...state,
      content: {
        ...state.content,
        cardsByPlayer: {
          ...state.content.cardsByPlayer,
          [owner]: {
            ...card,
            askingPriceCents: cents(Number.MAX_SAFE_INTEGER),
          },
        },
      },
    };
    expect(getRecurringAcquisitionTerms(unsafe, owner, card.id)).toEqual({
      ok: false,
      code: "DESTINATION_OVERFLOW",
    });
  });
});

describe("paid persistent investigation", () => {
  it("charges the exact bounded HALF_UP fee once without rerolling facts or streams", () => {
    const { state, owner } = investigationFixture();
    const card = state.content.cardsByPlayer[owner]!;
    const hidden = projectRecurringOpportunity(state, owner)!;
    expect(hidden.facts).toBeUndefined();
    const result = applyPlayerCommand(state, owner, {
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: card.id,
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.finance.cashByPlayer[owner]).toBe(
      state.finance.cashByPlayer[owner]! - card.investigationFeeCents,
    );
    expect(
      result.journalEntries.map((entry) => [entry.reason, entry.amountCents]),
    ).toEqual([["opportunity-investigation", card.investigationFeeCents]]);
    expect(projectRecurringOpportunity(result.state, owner)!.facts).toEqual(
      card.facts,
    );
    expect(result.state.content.cardsByPlayer[owner]!.facts).toEqual(
      card.facts,
    );
    expect(result.state.content.random).toEqual(state.content.random);
    expect(result.state.economy.operatingRandom).toEqual(
      state.economy.operatingRandom,
    );
    expect(result.state.random).toEqual(state.random);
    expect(result.state.counters.opportunity).toBe(state.counters.opportunity);
    expect(
      applyPlayerCommand(result.state, owner, {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: card.id,
      }),
    ).toMatchObject({
      ok: false,
      code: "ALREADY_INVESTIGATED",
      state: result.state,
      journalEntries: [],
    });
    expect(
      JSON.parse(JSON.stringify(result.state)).content.cardsByPlayer[owner]
        .facts,
    ).toEqual(card.facts);
  });
  it("applies the fee floor, cap and half-cent rounding", () => {
    expect(recurringInvestigationFeeCents(1)).toBe(10_000);
    expect(recurringInvestigationFeeCents(10_000_200)).toBe(25_001);
    expect(recurringInvestigationFeeCents(1_000_000_000)).toBe(100_000);
  });
  it("keeps existence and facts private and rejects unaffordable investigation atomically", () => {
    const { state, owner } = investigationFixture();
    const card = state.content.cardsByPlayer[owner]!;
    const other = players.find((id) => id !== owner)!;
    const rejected = applyPlayerCommand(state, other, {
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: card.id,
    });
    expect(rejected).toMatchObject({
      ok: false,
      code: "NOT_FOUND_OR_NOT_VISIBLE",
      state,
      journalEntries: [],
    });
    const poor = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [owner]: cents(card.investigationFeeCents - 1),
        },
      },
    };
    const before = JSON.stringify(poor);
    expect(
      applyPlayerCommand(poor, owner, {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: card.id,
      }),
    ).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_AVAILABLE_CASH",
      state: poor,
      journalEntries: [],
    });
    expect(JSON.stringify(poor)).toBe(before);
    const facts = card.facts!;
    const changedFacts =
      facts.kind === "business"
        ? {
            ...facts,
            annualOperatingProfitCents: facts.annualOperatingProfitCents + 1,
          }
        : { ...facts, marketValueCents: facts.marketValueCents + 1 };
    const changed = {
      ...state,
      content: {
        ...state.content,
        cardsByPlayer: {
          ...state.content.cardsByPlayer,
          [owner]: { ...card, facts: changedFacts },
        },
      },
    };
    expect(projectRecurringOpportunity(changed, owner)).toEqual(
      projectRecurringOpportunity(state, owner),
    );
    expect(projectPlayerGameState(changed, other)).toEqual(
      projectPlayerGameState(state, other),
    );
  });
  it("rejects expired cards and journal exhaustion without a fee", () => {
    const { state, owner } = investigationFixture();
    const card = state.content.cardsByPlayer[owner]!;
    const expired = {
      ...state,
      content: {
        ...state.content,
        cardsByPlayer: {
          ...state.content.cardsByPlayer,
          [owner]: { ...card, status: "expired" as const },
        },
      },
    };
    expect(
      applyPlayerCommand(expired, owner, {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: card.id,
      }),
    ).toMatchObject({
      ok: false,
      code: "OPPORTUNITY_NOT_AVAILABLE",
      state: expired,
      journalEntries: [],
    });
    const exhausted = {
      ...state,
      counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER },
    };
    expect(
      applyPlayerCommand(exhausted, owner, {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: card.id,
      }),
    ).toMatchObject({
      ok: false,
      code: "JOURNAL_ID_EXHAUSTED",
      state: exhausted,
      journalEntries: [],
    });
  });
  it("rejects corrupt facts and missing content state before snapshot use", () => {
    const state = game();
    const noContent = JSON.parse(JSON.stringify(state));
    delete noContent.content;
    expect(() => assertGameState(noContent)).toThrow(/recurring content/);
    const { state: rich, owner } = investigationFixture();
    const extra = JSON.parse(JSON.stringify(rich));
    extra.content.cardsByPlayer[owner].facts.rivalSecret = 100;
    expect(() => assertGameState(extra)).toThrow(/diligence facts/);
  });
});
