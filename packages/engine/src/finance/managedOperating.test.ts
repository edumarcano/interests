import {
  EXECUTIVE_COMPANY_TERMS,
  RECURRING_CONTENT_TEMPLATES,
} from "@interests/rules";
import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { getCareerOffers } from "../game/career";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import { recurringInvestigationFeeCents } from "../opportunities/recurring";
import { getRecurringAcquisitionTerms } from "../opportunities/recurringAcquisition";
import { getRecurringAcquisitionQuotes } from "../opportunities/recurringPurchase";
import { createManagedBusinessOperatingModel } from "./businessPerformance";
import { FinanceDecimal } from "./decimal";
import { cents } from "./money";

const players = ["a", "b", "c", "d"].map(asPlayerId);
function send(
  state: GameState,
  actor: PlayerId,
  command: Parameters<typeof applyPlayerCommand>[2],
) {
  const result = applyPlayerCommand(state, actor, command);
  if (!result.ok) throw new Error(`${command.type}: ${result.code}`);
  assertGameState(result.state);
  return result;
}
function ready(seed = "managed-operating") {
  let state = createGame({
    gameId: "managed-operating",
    seed,
    playerIds: players,
  });
  for (const actor of players)
    state = send(state, actor, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[actor]!.offeredObjectiveIds[0],
    }).state;
  return state;
}
function finishQuarter(initial: GameState) {
  let state = initial;
  const quarter = state.currentQuarter;
  if (state.round?.stage === "round-start")
    state = send(state, players[0]!, { type: "BEGIN_ROUND" }).state;
  while (state.currentQuarter === quarter)
    state = send(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    }).state;
  return state;
}
function onTurn(initial: GameState, actor: PlayerId) {
  let state = initial;
  if (state.round?.stage === "round-start")
    state = send(state, players[0]!, { type: "BEGIN_ROUND" }).state;
  while (getActiveSpotlightPlayerId(state) !== actor)
    state = send(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    }).state;
  return state;
}
/** Authored acquisition-boundary fixture; liquidity is synthetic, no reachability claim. */
function purchase(templateId: string, quarter = 1, actor = players[0]!) {
  let state = ready();
  while (state.currentQuarter < quarter) state = finishQuarter(state);
  state = onTurn(state, actor);
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (item) => item.id === templateId,
  )!;
  const card = {
    id: state.content.cardsByPlayer[actor]!.id,
    targetPlayerId: actor,
    createdQuarter: state.currentQuarter,
    templateId,
    category: template.category,
    askingPriceCents: cents(template.askingPriceCents),
    investigationFeeCents: recurringInvestigationFeeCents(
      template.askingPriceCents,
    ),
    facts: template.facts,
    status: "available" as const,
    investigated: false,
  };
  state = {
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [actor]: cents(1_000_000_000),
      },
    },
    content: {
      ...state.content,
      cardsByPlayer: { ...state.content.cardsByPlayer, [actor]: card },
    },
  };
  assertGameState(state);
  const quote = getRecurringAcquisitionQuotes(state, actor, card.id).find(
    (item) => item.route === "cash",
  )!;
  const result = send(state, actor, {
    type: "ACQUIRE_RECURRING_OPPORTUNITY",
    opportunityId: card.id,
    quoteId: quote.id,
  });
  const asset = Object.values(result.state.finance.assetsById).find(
    (item): item is BusinessAsset =>
      item.kind === "business" && !state.finance.assetsById[item.id],
  )!;
  return { before: state, result, actor, asset, template };
}
function company(state: GameState, id: BusinessAsset["id"]) {
  const asset = state.finance.assetsById[id];
  if (asset?.kind !== "business") throw new Error("Missing purchased company");
  return asset;
}
function verifyFirstEarnedQuarter(
  state: GameState,
  asset: BusinessAsset,
  firstQuarter: number,
) {
  const earned = state.finance.quarterStartBasis.businessesById[asset.id]!;
  expect(earned.annualOperatingProfitCents).toBe(
    asset.annualOperatingProfitCents,
  );
  const next = finishQuarter(state),
    current = company(next, asset.id),
    model = current.operatingModel!;
  expect(
    next.finance.lastSettlement!.businesses.find(
      (item) => item.assetId === asset.id,
    )!.operatingCashCents,
  ).toBe(asset.annualOperatingProfitCents / 4);
  expect(model.quarters).toEqual([
    {
      quarter: firstQuarter,
      operatingProfitCents: asset.annualOperatingProfitCents / 4,
    },
  ]);
  expect(current.enterpriseValueCents).toBe(asset.enterpriseValueCents);
  expect(model.fixedAnnualLaborCostsCents).toBe(
    asset.operatingModel!.fixedAnnualLaborCostsCents,
  );
  expect(
    Math.abs(current.annualRevenueCents - asset.annualRevenueCents) * 10_000,
  ).toBeLessThanOrEqual(asset.annualRevenueCents * 1000);
  expect(current.annualRevenueCents).not.toBe(asset.annualRevenueCents);
  const variable = new FinanceDecimal(current.annualRevenueCents)
    .times(model.referenceAnnualNonLaborCostsCents)
    .div(model.referenceAnnualRevenueCents)
    .round();
  expect(current.annualOperatingProfitCents).toBe(
    new FinanceDecimal(current.annualRevenueCents)
      .minus(variable)
      .minus(model.fixedAnnualLaborCostsCents)
      .toNumber(),
  );
  return next;
}

describe("managed purchased-company operating activation", () => {
  it.each([
    ["local-service-company", "low", 6_000_000, 16_000_000],
    ["regional-company", "medium", 18_000_000, 62_000_000],
    ["established-service-group", "medium", 36_000_000, 117_000_000],
  ] as const)(
    "preserves %s closing facts and actual first earnings before moving bounded future revenue",
    (id, sensitivity, labor, variable) => {
      const { before, result, asset, actor, template } = purchase(id);
      if (template.facts?.kind !== "business")
        throw new Error("Expected business facts");
      expect(asset.annualOperatingProfitCents).toBe(
        template.facts.annualOperatingProfitCents,
      );
      expect(asset.enterpriseValueCents).toBe(
        template.facts.enterpriseValueCents,
      );
      expect(asset.operatingModel).toMatchObject({
        sensitivity,
        fixedAnnualLaborCostsCents: labor,
        referenceAnnualNonLaborCostsCents: variable,
        openingValuationEarningsCents:
          template.facts.annualOperatingProfitCents,
        openingEnterpriseValueCents: template.facts.enterpriseValueCents,
        firstOperatingQuarter: 2,
        quarters: [],
      });
      expect(asset).not.toHaveProperty("workCompensation");
      const control = finishQuarter(
        send(before, actor, { type: "PASS_SPOTLIGHT" }).state,
      );
      const first = finishQuarter(result.state),
        retained = company(first, asset.id);
      expect(retained).toEqual(asset);
      expect(first.economy.operatingRandom).toEqual(
        control.economy.operatingRandom,
      );
      expect(
        first.finance.lastSettlement!.businesses.some(
          (item) => item.assetId === asset.id,
        ),
      ).toBe(false);
      verifyFirstEarnedQuarter(first, asset, 2);
    },
  );
  it("keeps a Q2 fourth-spotlight purchase unchanged and omits its zero-entitlement quarter from operating history", () => {
    const { result, asset } = purchase("local-service-company", 2);
    expect(result.state.currentQuarter).toBe(3);
    expect(asset).toMatchObject({
      annualOperatingProfitCents: 3_000_000,
      enterpriseValueCents: 12_000_000,
      operatingModel: { firstOperatingQuarter: 3, quarters: [] },
    });
    expect(
      result.settlementOutcome!.businesses.find(
        (item) => item.assetId === asset.id,
      )!.operatingCashCents,
    ).toBe(0);
    const fabricated = {
      ...result.state,
      finance: {
        ...result.state.finance,
        assetsById: {
          ...result.state.finance.assetsById,
          [asset.id]: {
            ...asset,
            operatingModel: {
              ...asset.operatingModel!,
              quarters: [{ quarter: 2, operatingProfitCents: cents(0) }],
            },
          },
        },
      },
    };
    expect(() => assertGameState(fabricated)).toThrow(
      /operating quarter evidence/,
    );
    verifyFirstEarnedQuarter(result.state, asset, 3);
  });
  it("keeps the authored model out of pre-diligence card and quote DTOs, and every rival projection", () => {
    const { before, actor, asset } = purchase("local-service-company");
    const card = before.content.cardsByPlayer[actor]!;
    const snapshot = JSON.stringify(before);
    const terms = getRecurringAcquisitionTerms(before, actor, card.id);
    expect(terms).toMatchObject({
      ok: true,
      terms: { necessaryLabor: { explicitAnnualCostCents: 6_000_000 } },
    });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(
      projectPlayerGameState(before, actor).self.recurringOpportunity,
    ).not.toHaveProperty("facts");
    const quotes = JSON.stringify(
      getRecurringAcquisitionQuotes(before, actor, card.id),
    );
    expect(quotes).not.toMatch(
      /operatingModel|fixedAnnualLabor|referenceAnnualNonLabor|annualRevenue|annualOperatingProfit/,
    );
    const changed = {
      ...before,
      content: {
        ...before.content,
        cardsByPlayer: {
          ...before.content.cardsByPlayer,
          [actor]: {
            ...card,
            facts: { ...card.facts!, annualOperatingProfitCents: 2_900_000 },
          },
        },
      },
    };
    for (const rival of players.filter((id) => id !== actor))
      expect(projectPlayerGameState(changed, rival)).toEqual(
        projectPlayerGameState(before, rival),
      );
    expect(asset.operatingModel).toBeDefined();
  });
  it("gives Executive ownership the separate $60k management calibration without changing any quoted financial fact", () => {
    let state: GameState | undefined;
    for (let seed = 0; seed < 40; seed++) {
      const candidate = ready(`managed-executive-${seed}`);
      if (
        candidate.players[players[3]!]!.profileId === "high-income-professional"
      ) {
        state = candidate;
        break;
      }
    }
    if (!state) throw new Error("Missing Executive fourth-seat fixture");
    const actor = players[3]!;
    state = onTurn(state, actor);
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [actor]: cents(100_000_000),
        },
      },
    };
    const offer = getCareerOffers(state, actor).find(
      (item) => item.role === "executive" && item.ownershipCostCents > 0,
    )!;
    expect(offer.ownershipPosition).toEqual(EXECUTIVE_COMPANY_TERMS);
    const result = send(state, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    const asset = Object.values(result.state.finance.assetsById).find(
      (item): item is BusinessAsset =>
        item.kind === "business" && !state!.finance.assetsById[item.id],
    )!;
    expect(result.state.currentQuarter).toBe(2);
    expect(asset).toMatchObject({
      annualRevenueCents: 10_000_000,
      annualOperatingProfitCents: 2_000_000,
      enterpriseValueCents: 10_000_000,
      operatingModel: {
        sensitivity: "low",
        fixedAnnualLaborCostsCents: 6_000_000,
        referenceAnnualNonLaborCostsCents: 2_000_000,
        firstOperatingQuarter: 2,
        quarters: [],
      },
    });
    expect(asset).not.toHaveProperty("workCompensation");
    expect(
      JSON.stringify(projectPlayerGameState(result.state, actor)),
    ).not.toContain("fixedAnnualLaborCostsCents");
    verifyFirstEarnedQuarter(result.state, asset, 2);
  });
  it("rejects impossible fixed labor calibration rather than changing accepted revenue or profit", () => {
    const input = {
      annualRevenueCents: 10_000_000,
      annualOperatingProfitCents: 2_000_000,
      enterpriseValueCents: 10_000_000,
      fixedAnnualLaborCostsCents: 8_400_000,
      sensitivity: "low" as const,
      firstOperatingQuarter: 2,
    };
    const before = JSON.stringify(input);
    expect(() => createManagedBusinessOperatingModel(input)).toThrow(
      /labor exceeds/,
    );
    expect(JSON.stringify(input)).toBe(before);
  });
});
