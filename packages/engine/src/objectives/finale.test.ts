import { asAssetId, asPlayerId, type PlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import { stageOpeningFixture } from "../../test/openingFixture";
import { cents } from "../finance/money";
import { ownershipPpm } from "../finance/ownership";
import {
  applyCareerCommand,
  type CareerActionFacts,
  getCareerOffers,
} from "../game/career";
import { createGame } from "../game/createGame";
import type { EconomicActionFinalization } from "../game/finalization";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { evaluateObjective } from "./evaluate";
import { finalizeObjectiveAction } from "./finale";
import { measurePlayerObjectives } from "./measurements";

const ids = ["a", "b", "c", "d"].map(asPlayerId);
const actor = ids[2]!;
const business = asAssetId("finale-business");
const properties = [
  asAssetId("finale-property-one"),
  asAssetId("finale-property-two"),
];
function send(state: GameState, player: PlayerId, command: WirePlayerCommand) {
  const result = applyPlayerCommand(state, player, command);
  if (!result.ok) throw new Error(`${command.type}: ${result.code}`);
  assertGameState(result.state);
  return result.state;
}
function until(state: GameState, quarter: number) {
  while (state.currentQuarter < quarter) {
    if (state.round?.stage === "round-start")
      state = send(state, ids[0]!, { type: "BEGIN_ROUND" });
    state = send(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    });
  }
  return state;
}
function turn(state: GameState) {
  if (state.round?.stage === "round-start")
    state = send(state, ids[0]!, { type: "BEGIN_ROUND" });
  while (getActiveSpotlightPlayerId(state) !== actor)
    state = send(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    });
  return state;
}
/** Synthetic opening wealth for terminal boundary tests. All earned history is produced by real quarterly commands. */
function fixture(
  goal: "independent" | "executive-owner",
  labor: "employee" | "owner" | "jobless" = "employee",
  quarter = 5,
) {
  let state: GameState | undefined;
  for (let seed = 0; seed < 500; seed++) {
    const candidate = createGame({
      gameId: "finale",
      seed: `finale-${seed}`,
      playerIds: ids,
    });
    if (
      candidate.players[actor]!.offeredObjectiveIds.includes(goal) &&
      candidate.progress.byPlayer[actor]!.labor.kind === "employment"
    ) {
      state = candidate;
      break;
    }
  }
  if (!state) throw new Error("No offered finale fixture");
  for (const id of ids)
    state = send(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId:
        id === actor ? goal : state.players[id]!.offeredObjectiveIds[0],
    });
  const oldCompany = Object.values(state.finance.assetsById).find(
    (asset) =>
      asset.kind === "business" && asset.cashPolicyId === "starting-company-v1",
  )!;
  const cash = Object.fromEntries(ids.map((id) => [id, cents(100_000_000)]));
  const markets = {
    ...state.finance.publicMarketsByPlayer,
    [actor]: {
      "broad-market-fund": cents(100_000_000),
      "growth-fund": cents(0),
      "income-defensive-fund": cents(0),
    },
  };
  state = stageOpeningFixture({
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: cash,
      publicMarketsByPlayer: markets,
      loansById: Object.fromEntries(
        Object.entries(state.finance.loansById).map(([id, loan]) => [
          id,
          labor === "owner" &&
          loan.kind === "company-loan" &&
          loan.borrowerAssetId === oldCompany.id
            ? { ...loan, borrowerAssetId: business }
            : loan,
        ]),
      ),
      livingArrearsByPlayer: Object.fromEntries(
        ids.map((id) => [id, cents(0)]),
      ),
      recurringByPlayer: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            quarterlyIncomeCents: cents(
              id === actor && labor === "employee" ? 5_000_000 : 0,
            ),
            quarterlyLivingExpenseCents: cents(1_000_000),
          },
        ]),
      ),
      assetsById: {
        ...Object.fromEntries(
          Object.entries(state.finance.assetsById).filter(
            ([id]) => labor !== "owner" || id !== oldCompany.id,
          ),
        ),
        [business]: {
          id: business,
          kind: "business",
          cashPolicyId:
            labor === "owner" ? "starting-company-v1" : "retained-profit-v1",
          cashCents: cents(50_000_000),
          operatingArrearsCents: cents(0),
          annualRevenueCents: cents(100_000_000),
          annualOperatingProfitCents: cents(20_000_000),
          enterpriseValueCents: cents(80_000_000),
          ownershipByPlayerPpm: { [actor]: ownershipPpm(1_000_000) },
          ...(labor === "owner"
            ? {
                workCompensation: {
                  playerId: actor,
                  annualCompensationCents: cents(24_000_000),
                  arrearsCents: cents(0),
                },
              }
            : { debtPrincipalCents: cents(0) }),
        },
        ...Object.fromEntries(
          properties.map((id) => [
            id,
            {
              id,
              kind: "property",
              marketValueCents: cents(50_000_000),
              scheduledQuarterlyRentCents: cents(2_000_000),
              occupancyBps: 10000,
              operatingExpenseRatioBps: 0,
              ownershipByPlayerPpm: { [actor]: ownershipPpm(1_000_000) },
            },
          ]),
        ),
      },
      quarterStartBasis: {
        ...state.finance.quarterStartBasis,
        cashByPlayer: cash,
        publicMarketsByPlayer: markets,
      },
    },
  } as GameState);
  if (goal === "executive-owner")
    state = {
      ...state,
      progress: {
        byPlayer: {
          ...state.progress.byPlayer,
          [actor]: {
            ...state.progress.byPlayer[actor]!,
            labor: { kind: "employment", role: "executive" },
          },
        },
      },
    };
  assertGameState(state);
  return turn(until(state, quarter));
}
function eligible(state: GameState) {
  return evaluateObjective(
    measurePlayerObjectives(state, actor),
    state.players[actor]!.selectedObjectiveId!,
  ).status;
}
function executiveOffer(state: GameState) {
  return getCareerOffers(state, actor).find(
    (offer) => offer.ownershipCostCents > 0,
  )!;
}
function rejectUnchanged(state: GameState, command: unknown, code: string) {
  const serialized = JSON.stringify(state);
  const result = applyPlayerCommand(state, actor, command as WirePlayerCommand);
  expect(result).toMatchObject({ ok: false, code, journalEntries: [] });
  expect(result.state).toBe(state);
  expect(JSON.stringify(state)).toBe(serialized);
}

it("finishes explicit resignation using real earned history before spotlight advancement", () => {
  const before = fixture("independent");
  expect(eligible(before)).toBe("eligible");
  const result = applyPlayerCommand(before, actor, {
    type: "PURSUE_FINALE",
    action: { type: "RESIGN_LABOR" },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  expect(result.state).toMatchObject({
    phase: "finished",
    round: null,
    revision: before.revision + 1,
    currentQuarter: 5,
    lastSettledQuarter: 4,
    result: {
      kind: "objective-victory",
      winnerPlayerId: actor,
      completedQuarter: 5,
    },
  });
  expect(result.state.progress.byPlayer[actor]!.labor).toEqual({
    kind: "not-working",
  });
  expect(result.state.progress.byPlayer[actor]!.quarters).toEqual(
    before.progress.byPlayer[actor]!.quarters,
  );
  expect(result.state.finance.quarterStartBasis).toEqual(
    before.finance.quarterStartBasis,
  );
  expect(result.state.finance.lastSettlement).toEqual(
    before.finance.lastSettlement,
  );
  expect(result.state.random).toEqual(before.random);
  expect(result.state.counters).toEqual(before.counters);
  expect(result.journalEntries).toEqual([]);
});

it.each([5, 8])(
  "keeps an eligible ordinary resignation ordinary in Q%i",
  (quarter) => {
    const before = fixture("independent", "employee", quarter);
    const after = send(before, actor, { type: "RESIGN_LABOR" });
    expect(after.phase).toBe("ready-for-first-round");
    expect(after.result).toBeNull();
    if (quarter === 8) {
      expect(after.currentQuarter).toBe(9);
      expect(after.lastSettledQuarter).toBe(8);
      expect(after.revision).toBe(before.revision + 1);
    } else
      expect(after.round!.spotlightsCompleted).toBe(
        before.round!.spotlightsCompleted + 1,
      );
  },
);

it("keeps necessary management and unpaid worker claims when the owner explicitly leaves work", () => {
  let before = fixture("independent", "owner", 4);
  const company = before.finance.assetsById[business]!;
  if (company.kind !== "business") throw new Error("No company");
  // A synthetic operating shock produces real missed worker/debt payments at Q4 settlement.
  before = {
    ...before,
    finance: {
      ...before.finance,
      assetsById: {
        ...before.finance.assetsById,
        [business]: {
          ...company,
          cashCents: cents(0),
          annualOperatingProfitCents: cents(-24_000_000),
        },
      },
      quarterStartBasis: {
        ...before.finance.quarterStartBasis,
        businessesById: {
          ...before.finance.quarterStartBasis.businessesById,
          [business]: {
            ...before.finance.quarterStartBasis.businessesById[business]!,
            annualOperatingProfitCents: cents(-24_000_000),
          },
        },
      },
    },
  };
  before = turn(send(before, actor, { type: "PASS_SPOTLIGHT" }));
  const old = before.finance.assetsById[business]!;
  if (old.kind !== "business" || !old.workCompensation)
    throw new Error("No worker");
  expect(old.workCompensation.arrearsCents).toBe(6_000_000);
  assertGameState(before);
  expect(eligible(before)).toBe("eligible");
  const after = send(before, actor, {
    type: "PURSUE_FINALE",
    action: { type: "RESIGN_LABOR" },
  });
  expect(after.finance.assetsById[business]).toMatchObject({
    annualManagementCostCents: 24_000_000,
    workCompensation: { annualCompensationCents: 0, arrearsCents: 6_000_000 },
    cashCents: old.cashCents,
    annualOperatingProfitCents: old.annualOperatingProfitCents,
  });
  expect(
    after.finance.quarterStartBasis.businessesById[business]!.workCompensation!
      .annualCompensationCents,
  ).toBe(24_000_000);
});

it("allows already-jobless confirmation only inside the explicit wrapper", () => {
  const before = fixture("independent", "jobless");
  rejectUnchanged(before, { type: "CONFIRM_INDEPENDENCE" }, "INVALID_ACTION");
  const after = send(before, actor, {
    type: "PURSUE_FINALE",
    action: { type: "CONFIRM_INDEPENDENCE" },
  });
  expect(after.phase).toBe("finished");
  expect(after.finance).toEqual(before.finance);
  expect(after.progress).toEqual(before.progress);
  expect(after.revision).toBe(before.revision + 1);
  rejectUnchanged(
    fixture("independent"),
    { type: "PURSUE_FINALE", action: { type: "CONFIRM_INDEPENDENCE" } },
    "FINALE_ACTION_UNAVAILABLE",
  );
});

it("uses paid executive exposure and fees, without crediting the new salary or new company's future income", () => {
  const before = fixture("executive-owner");
  expect(eligible(before)).toBe("eligible");
  const offer = executiveOffer(before);
  const result = applyPlayerCommand(before, actor, {
    type: "PURSUE_FINALE",
    action: { type: "ACCEPT_CAREER_OFFER", offerId: offer.id },
  });
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  expect(result.state.phase).toBe("finished");
  expect(
    result.journalEntries.map((entry) => [entry.reason, entry.amountCents]),
  ).toEqual([
    ["executive-secondary-purchase", 10_000_000],
    ["executive-business-purchase-fee", 200_000],
  ]);
  const labor = result.state.progress.byPlayer[actor]!.labor;
  if (labor.kind !== "employment" || !labor.ownershipPositionAssetId)
    throw new Error("No purchased position");
  expect(
    result.state.finance.assetsById[labor.ownershipPositionAssetId],
  ).toMatchObject({ cashCents: 0, enterpriseValueCents: 10_000_000 });
  expect(
    result.state.progress.byPlayer[actor]!.assetsById[
      labor.ownershipPositionAssetId
    ]!.costCents,
  ).toBe(10_200_000);
  expect(
    measurePlayerObjectives(result.state, actor).annualEmploymentIncomeCents,
  ).toBe(measurePlayerObjectives(before, actor).annualEmploymentIncomeCents);
  expect(
    measurePlayerObjectives(result.state, actor).annualInvestmentIncomeCents,
  ).toBe(measurePlayerObjectives(before, actor).annualInvestmentIncomeCents);
  const ordinary = send(before, actor, {
    type: "ACCEPT_CAREER_OFFER",
    offerId: offer.id,
  });
  expect(ordinary.phase).toBe("ready-for-first-round");
  expect(ordinary.result).toBeNull();
  expect(ordinary.finance).toEqual(result.state.finance);
});

it("rejects the whole executive purchase when its fee makes post-close liquidity one cent short", () => {
  let before = fixture("executive-owner");
  before = {
    ...before,
    finance: {
      ...before.finance,
      cashByPlayer: {
        ...before.finance.cashByPlayer,
        [actor]: cents(17_699_999),
      },
      publicMarketsByPlayer: {
        ...before.finance.publicMarketsByPlayer,
        [actor]: {
          "broad-market-fund": cents(0),
          "growth-fund": cents(0),
          "income-defensive-fund": cents(0),
        },
      },
    },
  };
  expect(eligible(before)).toBe("eligible");
  const offer = executiveOffer(before);
  rejectUnchanged(
    before,
    {
      type: "PURSUE_FINALE",
      action: { type: "ACCEPT_CAREER_OFFER", offerId: offer.id },
    },
    "FINALE_INELIGIBLE",
  );
  const ordinary = send(before, actor, {
    type: "ACCEPT_CAREER_OFFER",
    offerId: offer.id,
  });
  expect(ordinary.finance.cashByPlayer[actor]).toBe(7_499_999);
  expect(eligible(ordinary)).toBe("ineligible");
});

it("rejects free raises, another objective, overdue obligations and incomplete earned history", () => {
  const executive = fixture("executive-owner");
  const free = getCareerOffers(executive, actor).find(
    (offer) => offer.ownershipCostCents === 0,
  )!;
  rejectUnchanged(
    executive,
    {
      type: "PURSUE_FINALE",
      action: { type: "ACCEPT_CAREER_OFFER", offerId: free.id },
    },
    "FINALE_INELIGIBLE",
  );
  rejectUnchanged(
    executive,
    { type: "PURSUE_FINALE", action: { type: "RESIGN_LABOR" } },
    "FINALE_ACTION_UNAVAILABLE",
  );
  const young = fixture("executive-owner", "employee", 1);
  rejectUnchanged(
    young,
    {
      type: "PURSUE_FINALE",
      action: {
        type: "ACCEPT_CAREER_OFFER",
        offerId: executiveOffer(young).id,
      },
    },
    "FINALE_INELIGIBLE",
  );
  const independent = fixture("independent");
  const overdue = {
    ...independent,
    finance: {
      ...independent.finance,
      livingArrearsByPlayer: {
        ...independent.finance.livingArrearsByPlayer,
        [actor]: cents(1),
      },
    },
  };
  rejectUnchanged(
    overdue,
    { type: "PURSUE_FINALE", action: { type: "RESIGN_LABOR" } },
    "FINALE_INELIGIBLE",
  );
});

it("rejects client objective/result injection, nested wrappers and off-turn attempts", () => {
  const before = fixture("independent");
  for (const command of [
    {
      type: "PURSUE_FINALE",
      objectiveId: "independent",
      action: { type: "RESIGN_LABOR" },
    },
    { type: "PURSUE_FINALE", action: { type: "RESIGN_LABOR", eligible: true } },
    {
      type: "PURSUE_FINALE",
      action: { type: "PURSUE_FINALE", action: { type: "RESIGN_LABOR" } },
    },
    { type: "PURSUE_FINALE", action: { type: "PASS_SPOTLIGHT" } },
  ])
    rejectUnchanged(before, command, "INVALID_ACTION");
  const inactive = {
    ...before,
    round: { stage: "spotlight" as const, spotlightsCompleted: 0 },
  };
  rejectUnchanged(
    inactive,
    { type: "PURSUE_FINALE", action: { type: "RESIGN_LABOR" } },
    "NOT_ACTIVE_SPOTLIGHT",
  );
});

it("passes actual unadvanced account effects to the typed callback and rejects already-advanced drafts", () => {
  const before = fixture("executive-owner");
  const offer = executiveOffer(before);
  let evidence: EconomicActionFinalization<CareerActionFacts> | undefined;
  const rejected = applyCareerCommand(before, actor, offer.id, (input) => {
    evidence = input;
    return {
      ok: false,
      state: input.before,
      code: "FINALE_INELIGIBLE",
      journalEntries: [],
    };
  });
  expect(rejected.state).toBe(before);
  expect(evidence!.draft.revision).toBe(before.revision);
  expect(evidence!.draft.currentQuarter).toBe(before.currentQuarter);
  expect(evidence!.draft.round).toEqual(before.round);
  expect(evidence!.facts).toMatchObject({
    kind: "career-acceptance",
    ownershipPosition: {
      considerationCents: 10_000_000,
      purchaseFeeCents: 200_000,
    },
  });
  const advanced = send(before, actor, {
    type: "ACCEPT_CAREER_OFFER",
    offerId: offer.id,
  });
  const result = finalizeObjectiveAction(
    { ...evidence!, draft: advanced },
    { objectiveId: "executive-owner", qualifies: () => true },
  );
  expect(result).toMatchObject({
    ok: false,
    code: "FINALE_ACTION_UNAVAILABLE",
    journalEntries: [],
  });
  expect(result.state).toBe(before);
});

it.each(["independent", "executive-owner"] as const)(
  "wins %s in the actual Q32 fourth spotlight before settlement or future preparation",
  (goal) => {
    const before = fixture(
      goal,
      goal === "independent" ? "jobless" : "employee",
      32,
    );
    expect(before.round!.spotlightsCompleted).toBe(3);
    expect(before.lastSettledQuarter).toBe(31);
    const action =
      goal === "independent"
        ? { type: "CONFIRM_INDEPENDENCE" as const }
        : {
            type: "ACCEPT_CAREER_OFFER" as const,
            offerId: executiveOffer(before).id,
          };
    const after = send(before, actor, { type: "PURSUE_FINALE", action });
    expect(after).toMatchObject({
      phase: "finished",
      currentQuarter: 32,
      lastSettledQuarter: 31,
      revision: before.revision + 1,
      result: {
        kind: "objective-victory",
        winnerPlayerId: actor,
        completedQuarter: 32,
      },
      round: null,
    });
    expect(
      after.progress.byPlayer[actor]!.quarters.map(
        (observation) => observation.quarter,
      ),
    ).toEqual([28, 29, 30, 31]);
    expect(after.finance.lastSettlement).toEqual(before.finance.lastSettlement);
    expect(after.random).toEqual(before.random);
    expect(after.finance.quarterStartBasis.quarter).toBe(32);
    const observer = ids[0]!;
    const view = projectPlayerGameState(after, observer);
    const otherObjective = after.players[actor]!.offeredObjectiveIds.find(
      (objective) => objective !== goal,
    )!;
    const hiddenChanged = {
      ...after,
      players: {
        ...after.players,
        [actor]: {
          ...after.players[actor]!,
          selectedObjectiveId: otherObjective,
        },
      },
    };
    assertGameState(hiddenChanged);
    expect(projectPlayerGameState(hiddenChanged, observer)).toEqual(view);
    expect(view.result).toEqual({
      kind: "objective-victory",
      winnerPlayerId: actor,
      completedQuarter: 32,
    });
    rejectUnchanged(after, { type: "PURSUE_FINALE", action }, "WRONG_PHASE");
    rejectUnchanged(after, { type: "PASS_SPOTLIGHT" }, "WRONG_PHASE");
  },
);

it("rolls a failed explicit Q32 final-spotlight purchase back before all settlement and RNG", () => {
  let before = fixture("executive-owner", "employee", 32);
  before = {
    ...before,
    finance: {
      ...before.finance,
      cashByPlayer: {
        ...before.finance.cashByPlayer,
        [actor]: cents(17_699_999),
      },
      publicMarketsByPlayer: {
        ...before.finance.publicMarketsByPlayer,
        [actor]: {
          "broad-market-fund": cents(0),
          "growth-fund": cents(0),
          "income-defensive-fund": cents(0),
        },
      },
    },
  };
  expect(eligible(before)).toBe("eligible");
  expect(before.round!.spotlightsCompleted).toBe(3);
  const offer = executiveOffer(before);
  rejectUnchanged(
    before,
    {
      type: "PURSUE_FINALE",
      action: { type: "ACCEPT_CAREER_OFFER", offerId: offer.id },
    },
    "FINALE_INELIGIBLE",
  );
  expect(before.lastSettledQuarter).toBe(31);
});
