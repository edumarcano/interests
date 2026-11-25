import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { stageOpeningFixture } from "../../test/openingFixture";
import { calculateBusinessEquity } from "../finance/business";
import {
  captureBusinessBasis,
  planBusinessSettlement,
} from "../finance/businessSettlement";
import { cents } from "../finance/money";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import { getCareerOffers } from "./career";
import { createGame } from "./createGame";
import { applyPlayerCommand } from "./playerCommand";
import { projectPlayerGameState } from "./playerView";
import { getActiveSpotlightPlayerId } from "./round";

const ids = ["a", "b", "c", "d"].map(asPlayerId);
function ready(profile?: string) {
  for (let seed = 0; seed < 100; seed++) {
    let state = createGame({
      gameId: "career",
      seed: `career-${seed}`,
      playerIds: ids,
    });
    const actor = profile
      ? ids.find((id) => state.players[id]!.profileId === profile)
      : ids[0];
    if (!actor) continue;
    for (const id of ids)
      state = command(state, id, {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: state.players[id]!.offeredObjectiveIds[0],
      });
    state = command(state, ids[0]!, { type: "BEGIN_ROUND" });
    while (getActiveSpotlightPlayerId(state) !== actor)
      state = command(state, getActiveSpotlightPlayerId(state)!, {
        type: "PASS_SPOTLIGHT",
      });
    return { state, actor };
  }
  throw new Error("Missing ordinary profile seed");
}
function command(
  state: GameState,
  actor: PlayerId,
  payload: Parameters<typeof applyPlayerCommand>[2],
) {
  const result = applyPlayerCommand(state, actor, payload);
  if (!result.ok) throw new Error(result.code);
  return result.state;
}
function nextQuarter(state: GameState) {
  const quarter = state.currentQuarter;
  while (state.currentQuarter === quarter)
    state = command(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    });
  return state;
}
function companyFor(state: GameState, actor: PlayerId): BusinessAsset {
  const asset = Object.values(state.finance.assetsById).find(
    (a) => a.kind === "business" && a.workCompensation?.playerId === actor,
  );
  if (asset?.kind !== "business") throw new Error("Missing company");
  return asset;
}

describe("persistent career and labor choices", () => {
  it("offers stable objective-neutral quotes based on current labor capacity, without RNG or state mutation", () => {
    const { state, actor } = ready("high-income-professional");
    const before = JSON.stringify(state);
    const offers = getCareerOffers(state, actor);
    expect(offers.map((o) => o.raiseBps)).toEqual([800, 2000, 3500]);
    expect(getCareerOffers(JSON.parse(before), actor)).toEqual(offers);
    const changed: GameState = {
      ...state,
      players: {
        ...state.players,
        [actor]: {
          ...state.players[actor]!,
          profileId: "disciplined-saver",
          selectedObjectiveId: "independent",
        },
      },
    };
    expect(getCareerOffers(changed, actor)).toEqual(offers);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("replaces salary once, consumes the spotlight, and preserves earned current-quarter employment", () => {
    const { state, actor } = ready("corporate-climber");
    const oldIncome =
      state.finance.recurringByPlayer[actor]!.quarterlyIncomeCents;
    const offer = getCareerOffers(state, actor)[0]!;
    const accepted = command(state, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(accepted.revision).toBe(state.revision + 1);
    expect(accepted.random).toEqual(state.random);
    expect(accepted.counters).toEqual(state.counters);
    expect(getActiveSpotlightPlayerId(accepted)).not.toBe(actor);
    expect(
      accepted.finance.recurringByPlayer[actor]!.quarterlyIncomeCents,
    ).toBe(offer.annualCompensationCents / 4);
    if (accepted.currentQuarter === state.currentQuarter)
      expect(
        accepted.finance.quarterStartBasis.recurringByPlayer[actor]!
          .quarterlyIncomeCents,
      ).toBe(oldIncome);
    const end =
      accepted.currentQuarter === state.currentQuarter
        ? nextQuarter(accepted)
        : accepted;
    expect(
      end.progress.byPlayer[actor]!.quarters.at(-1)!.employmentIncomeCents,
    ).toBe(oldIncome);
    expect(
      end.finance.quarterStartBasis.recurringByPlayer[actor]!
        .quarterlyIncomeCents,
    ).toBe(offer.annualCompensationCents / 4);
  });

  it("charges the major promotion cash cost, and rejects unaffordable offers with identical state", () => {
    const { state, actor } = ready("corporate-climber");
    const offer = getCareerOffers(state, actor)[1]!;
    const poor = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: { ...state.finance.cashByPlayer, [actor]: cents(0) },
      },
    };
    const failed = applyPlayerCommand(poor, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      journalEntries: [],
    });
    expect(failed.state).toBe(poor);
    const result = applyPlayerCommand(state, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(result.ok).toBe(true);
    expect(result.journalEntries[0]).toMatchObject({
      amountCents: 500_000,
      source: { kind: "player", playerId: actor },
      destination: { kind: "external" },
      reason: "career-transition-cost",
    });
  });

  it("requires the business purchase fee in executive affordability and quotes its separate amount", () => {
    const { state, actor } = ready("high-income-professional");
    const exactPrice = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [actor]: cents(10_000_000),
        },
      },
    };
    const offer = getCareerOffers(exactPrice, actor).find(
      (offer) => offer.ownershipCostCents > 0,
    )!;
    expect(offer.affordable).toBe(false);
    expect(offer).toMatchObject({
      ownershipPurchaseFeeCents: 200_000,
      totalCashRequiredCents: 10_200_000,
    });
    const rejected = applyPlayerCommand(exactPrice, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(rejected).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      journalEntries: [],
    });
    expect(rejected.state).toBe(exactPrice);
  });

  it("rolls back consideration when the separate executive purchase fee journal cannot commit", () => {
    const { state, actor } = ready("high-income-professional");
    const staged = {
      ...state,
      counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER - 1 },
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [actor]: cents(10_200_000),
        },
      },
    };
    const offer = getCareerOffers(staged, actor).find(
      (offer) => offer.ownershipCostCents > 0,
    )!;
    expect(offer.affordable).toBe(true);
    const before = JSON.stringify(staged);
    const result = applyPlayerCommand(staged, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "COUNTER_EXHAUSTED",
      journalEntries: [],
    });
    expect(result.state).toBe(staged);
    expect(JSON.stringify(staged)).toBe(before);
  });

  it("funds executive ownership from actual cash without crediting company cash or free equity", () => {
    const { state, actor } = ready("high-income-professional");
    // Explicit synthetic liquidity fixture; compensation and access are ordinary.
    const funded = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [actor]: cents(20_000_000),
        },
      },
    };
    const offer = getCareerOffers(funded, actor).find(
      (o) => o.ownershipCostCents > 0,
    )!;
    const result = applyPlayerCommand(funded, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    const labor = result.state.progress.byPlayer[actor]!.labor;
    expect(labor.kind).toBe("employment");
    if (labor.kind !== "employment" || !labor.ownershipPositionAssetId)
      throw new Error();
    const asset = result.state.finance.assetsById[
      labor.ownershipPositionAssetId
    ] as BusinessAsset;
    expect(asset.cashCents).toBe(0);
    expect(calculateBusinessEquity(asset).equityValueCents).toBe(10_000_000);
    expect(result.state.progress.byPlayer[actor]!.assetsById[asset.id]).toEqual(
      { costCents: 10_200_000, acquiredQuarter: 1, ownershipPpm: 1_000_000 },
    );
    expect(result.journalEntries[0]).toMatchObject({
      amountCents: 10_000_000,
      reason: "executive-secondary-purchase",
      destination: { kind: "external" },
    });
    expect(result.journalEntries[1]).toMatchObject({
      amountCents: 200_000,
      reason: "executive-business-purchase-fee",
      destination: { kind: "external", account: "market" },
    });
    expect(
      result.journalEntries
        .filter(
          (entry) =>
            entry.source.kind === "player" && entry.source.playerId === actor,
        )
        .reduce((sum, entry) => sum + entry.amountCents, 0),
    ).toBe(10_200_000);
    expect(
      result.state.finance.quarterStartBasis.businessesById[asset.id]!
        .annualOperatingProfitCents,
    ).toBe(0);
    expect(result.state.result).toBeNull();
    assertGameState(result.state);
  });

  it("reaches a genuinely funded executive ownership position through ordinary career commands", () => {
    let { state, actor } = ready("high-income-professional");
    let bought = false;
    while (state.currentQuarter <= 12 && !bought) {
      if (state.round?.stage === "round-start")
        state = command(state, ids[0]!, { type: "BEGIN_ROUND" });
      const active = getActiveSpotlightPlayerId(state)!;
      if (active !== actor) {
        state = command(state, active, { type: "PASS_SPOTLIGHT" });
        continue;
      }
      const executive = getCareerOffers(state, actor).find(
        (offer) => offer.ownershipCostCents > 0 && offer.affordable,
      );
      const offer = executive ?? getCareerOffers(state, actor)[0]!;
      const beforeCash = state.finance.cashByPlayer[actor]!;
      state = command(state, actor, {
        type: "ACCEPT_CAREER_OFFER",
        offerId: offer.id,
      });
      if (executive) {
        bought = true;
        const labor = state.progress.byPlayer[actor]!.labor;
        expect(labor.kind).toBe("employment");
        if (labor.kind !== "employment" || !labor.ownershipPositionAssetId)
          throw new Error("Missing ownership position");
        const asset = state.finance.assetsById[
          labor.ownershipPositionAssetId
        ] as BusinessAsset;
        expect(asset.enterpriseValueCents).toBe(10_000_000);
        expect(asset.cashCents).toBe(0);
        expect(
          state.progress.byPlayer[actor]!.assetsById[asset.id]!.costCents,
        ).toBe(10_200_000);
        expect(beforeCash).toBeGreaterThanOrEqual(10_200_000);
        expect(state.progress.byPlayer[actor]!.quarters.length).toBeGreaterThan(
          0,
        );
        expect(state.result).toBeNull();
        assertGameState(state);
      }
    }
    expect(bought).toBe(true);
  });

  it("gates executive access by actual current pay, including owner work, and permits reentry without profile powers", () => {
    const { state, actor } = ready("corporate-climber");
    expect(
      getCareerOffers(state, actor).some((o) => o.ownershipCostCents > 0),
    ).toBe(false);
    const quit = command(state, actor, { type: "RESIGN_LABOR" });
    expect(quit.progress.byPlayer[actor]!.labor).toEqual({
      kind: "not-working",
    });
    expect(quit.finance.recurringByPlayer[actor]!.quarterlyIncomeCents).toBe(0);
    expect(getCareerOffers(quit, actor)[0]!.annualCompensationCents).toBe(
      6_000_000,
    );
  });

  it.each([
    "small-business-owner",
    "self-employed-operator",
    "early-stage-entrepreneur",
  ])(
    "converts %s work at equal management cost, preserves current work entitlement and next-quarter after-labor profit",
    (profile) => {
      const { state, actor } = ready(profile);
      const original = companyFor(state, actor);
      const before = planBusinessSettlement(
        original,
        state.finance.quarterStartBasis.businessesById[original.id]!,
        1,
        state.finance.loansById,
      )!;
      const originalSnapshot = JSON.stringify(state);
      const result = applyPlayerCommand(state, actor, { type: "RESIGN_LABOR" });
      expect(result.ok).toBe(true);
      expect(JSON.stringify(state)).toBe(originalSnapshot);
      const control = applyPlayerCommand(state, actor, {
        type: "PASS_SPOTLIGHT",
      });
      if (!control.ok) throw new Error(control.code);
      const controlCompany = companyFor(control.state, actor);
      const changed = companyFor(result.state, actor);
      expect(changed.annualOperatingProfitCents).toBe(
        controlCompany.annualOperatingProfitCents,
      );
      expect(changed.enterpriseValueCents).toBe(
        controlCompany.enterpriseValueCents,
      );
      expect(changed.workCompensation!.annualCompensationCents).toBe(0);
      expect(changed.annualManagementCostCents).toBe(
        original.workCompensation!.annualCompensationCents,
      );
      if (result.state.currentQuarter === 1) {
        expect(changed.cashCents).toBe(original.cashCents);
        expect(result.state.finance.loansById).toEqual(state.finance.loansById);
        expect(result.state.finance.quarterStartBasis).toEqual(
          state.finance.quarterStartBasis,
        );
      }
      const afterCurrent =
        result.state.currentQuarter === 1
          ? nextQuarter(result.state)
          : result.state;
      const outcome = afterCurrent.finance.lastSettlement!.businesses.find(
        (b) => b.assetId === original.id,
      )!;
      expect(outcome.workCompensation!.currentPaidCents).toBe(
        before.outcome.workCompensation!.currentPaidCents,
      );
      expect(outcome.distributionsByPlayer).toEqual(
        before.outcome.distributionsByPlayer,
      );
      expect(outcome.managementPaidCents).toBe(0);
      const managed = companyFor(afterCurrent, actor);
      const projected = planBusinessSettlement(
        managed,
        captureBusinessBasis({ [managed.id]: managed })[managed.id]!,
        2,
        afterCurrent.finance.loansById,
      )!;
      expect(projected.outcome.workCompensation!.currentDueCents).toBe(0);
      expect(projected.outcome.managementPaidCents).toBe(
        original.workCompensation!.annualCompensationCents / 4,
      );
      expect(
        projected.postings.find(
          (p) => p.reason === "business-management-payment",
        ),
      ).toMatchObject({
        destination: { kind: "external", account: "business-management" },
      });
      assertGameState(afterCurrent);
      const secondRound = command(afterCurrent, ids[0]!, {
        type: "BEGIN_ROUND",
      });
      const afterManaged = nextQuarter(secondRound);
      expect(
        afterManaged.finance.lastSettlement!.businesses.find(
          (b) => b.assetId === original.id,
        )!.managementPaidCents,
      ).toBe(original.workCompensation!.annualCompensationCents / 4);
      assertGameState(afterManaged);
    },
  );

  it("accepting employment ends owner work while preserving ownership and no dual future labor income", () => {
    const { state, actor } = ready("self-employed-operator");
    const asset = companyFor(state, actor);
    const offer = getCareerOffers(state, actor)[0]!;
    const end = command(state, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(end.progress.byPlayer[actor]!.labor.kind).toBe("employment");
    expect(
      companyFor(end, actor).workCompensation!.annualCompensationCents,
    ).toBe(0);
    expect(companyFor(end, actor).ownershipByPlayerPpm).toEqual(
      asset.ownershipByPlayerPpm,
    );
    expect(end.finance.recurringByPlayer[actor]!.quarterlyIncomeCents).toBe(
      offer.annualCompensationCents / 4,
    );
  });

  it("keeps old worker claims and management payables under zero-cash operating losses", () => {
    const { state, actor } = ready("self-employed-operator");
    const asset = companyFor(state, actor);
    const lossAsset = {
      ...asset,
      annualOperatingProfitCents: cents(-5_000_000),
      cashCents: cents(0),
      operatingArrearsCents: cents(1234),
      workCompensation: {
        ...asset.workCompensation!,
        arrearsCents: cents(5678),
      },
    };
    const staged = stageOpeningFixture({
      ...state,
      finance: {
        ...state.finance,
        assetsById: { ...state.finance.assetsById, [asset.id]: lossAsset },
      },
    });
    const result = applyPlayerCommand(staged, actor, { type: "RESIGN_LABOR" });
    expect(result.ok).toBe(true);
    const changed = companyFor(result.state, actor);
    const plan = planBusinessSettlement(
      changed,
      captureBusinessBasis({ [asset.id]: changed })[asset.id]!,
      2,
      result.state.finance.loansById,
    )!;
    expect(
      plan.outcome.workCompensation!.arrearsDueCents,
    ).toBeGreaterThanOrEqual(5678);
    expect(
      plan.outcome.workCompensation!.closingArrearsCents,
    ).toBeGreaterThanOrEqual(5678);
    expect(plan.outcome.managementDueCents).toBe(2_100_000);
    expect(plan.outcome.managementPaidCents).toBe(850_000);
    expect(plan.outcome.closingOperatingArrearsCents).toBeGreaterThanOrEqual(
      1_250_000 + 1234,
    );
    expect(plan.outcome.distributionsByPlayer[actor]).toBe(0);
  });

  it("rejects stale quotes, offturn work, and active transactions without changing state, counters or RNG", () => {
    const { state, actor } = ready("corporate-climber");
    const offer = getCareerOffers(state, actor)[0]!;
    for (const [input, who, id, code] of [
      [
        state,
        ids.find((id) => id !== actor)!,
        offer.id,
        "NOT_ACTIVE_SPOTLIGHT",
      ],
      [state, actor, "stale", "CAREER_OFFER_UNAVAILABLE"],
      [
        {
          ...state,
          activeTransaction: { id: "blocked" },
        } as unknown as GameState,
        actor,
        offer.id,
        "ACTIVE_TRANSACTION",
      ],
    ] as const) {
      const before = JSON.stringify(input);
      const result = applyPlayerCommand(input, who, {
        type: "ACCEPT_CAREER_OFFER",
        offerId: id,
      });
      expect(result).toMatchObject({ ok: false, code, journalEntries: [] });
      expect(result.state).toBe(input);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it("composes the fourth acceptance with once-only settlement and rolls back fully when settlement fails", () => {
    let { state } = ready();
    while (state.round!.spotlightsCompleted < 3)
      state = command(state, getActiveSpotlightPlayerId(state)!, {
        type: "PASS_SPOTLIGHT",
      });
    const actor = getActiveSpotlightPlayerId(state)!;
    const offer = getCareerOffers(state, actor)[0]!;
    const accepted = applyPlayerCommand(state, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state.currentQuarter).toBe(2);
    expect(accepted.state.lastSettledQuarter).toBe(1);
    expect(accepted.state.revision).toBe(state.revision + 1);
    expect(accepted.state.progress.byPlayer[actor]!.quarters).toHaveLength(1);
    const duplicate = applyPlayerCommand(accepted.state, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.state).toBe(accepted.state);
    const overflow = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [actor]: cents(Number.MAX_SAFE_INTEGER),
        },
      },
    };
    const rejected = applyPlayerCommand(overflow, actor, {
      type: "ACCEPT_CAREER_OFFER",
      offerId: offer.id,
    });
    expect(rejected).toMatchObject({
      ok: false,
      code: "DESTINATION_OVERFLOW",
      journalEntries: [],
    });
    expect(rejected.state).toBe(overflow);
  });

  it("retains former worker arrears through resignation and later recovery without future labor entitlement", () => {
    const { state, actor } = ready("small-business-owner");
    const original = companyFor(state, actor);
    const staged = stageOpeningFixture({
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [original.id]: {
            ...original,
            workCompensation: {
              ...original.workCompensation!,
              arrearsCents: cents(123_456),
            },
          },
        },
      },
    });
    const accepted = command(staged, actor, { type: "RESIGN_LABOR" });
    const settled =
      accepted.currentQuarter === 1 ? nextQuarter(accepted) : accepted;
    const outcome = settled.finance.lastSettlement!.businesses.find(
      (b) => b.assetId === original.id,
    )!;
    expect(outcome.workCompensation!.arrearsDueCents).toBe(123_456);
    expect(outcome.workCompensation!.arrearsPaidCents).toBe(123_456);
    expect(settled.progress.byPlayer[actor]!.labor.kind).toBe("not-working");
    const following = nextQuarter(
      command(settled, ids[0]!, { type: "BEGIN_ROUND" }),
    );
    const later = following.finance.lastSettlement!.businesses.find(
      (b) => b.assetId === original.id,
    )!;
    expect(later.workCompensation!.currentDueCents).toBe(0);
    expect(later.workCompensation!.arrearsDueCents).toBe(0);
    expect(
      following.progress.byPlayer[actor]!.quarters.at(-1)!
        .recurringWorkIncomeCents,
    ).toBe(0);
  });

  it("paired states keep another player's career compensation, offers and objectives private", () => {
    const { state, actor } = ready("corporate-climber");
    const observer = ids.find((id) => id !== actor)!;
    const changed = {
      ...state,
      finance: {
        ...state.finance,
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [actor]: {
            ...state.finance.recurringByPlayer[actor]!,
            quarterlyIncomeCents: cents(99_999_999),
          },
        },
      },
      players: {
        ...state.players,
        [actor]: {
          ...state.players[actor]!,
          selectedObjectiveId: "executive-owner" as const,
        },
      },
    };
    expect(projectPlayerGameState(changed, observer)).toEqual(
      projectPlayerGameState(state, observer),
    );
    expect(
      projectPlayerGameState(changed, actor).self.financialDetails,
    ).not.toEqual(projectPlayerGameState(state, actor).self.financialDetails);
  });
});
