import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import { calculateCompanyLoanSchedule } from "./amortization";
import { calculateBusinessEquity } from "./business";
import { captureBusinessBasis } from "./businessSettlement";
import { cents } from "./money";
import { settleQuarter } from "./settlement";

const ids = ["a", "b", "c", "d"].map(asPlayerId);
const fixtures = [
  {
    profile: "small-business-owner",
    cash: 1_500_000,
    work: 600_000,
    profit: 2_000_000,
    payment: 281_938,
    principal: 161_938,
    retention: 343_612,
    payout: 1_374_450,
    equity: 27_500_000,
    personal: 3_721_950,
  },
  {
    profile: "self-employed-operator",
    cash: 1_000_000,
    work: 2_100_000,
    profit: 600_000,
    payment: 93_979,
    principal: 53_979,
    retention: 101_204,
    payout: 404_817,
    equity: 8_000_000,
    personal: 5_184_817,
  },
  {
    profile: "early-stage-entrepreneur",
    cash: 1_500_000,
    work: 900_000,
    profit: 750_000,
    payment: 281_938,
    principal: 161_938,
    retention: 93_612,
    payout: 374_450,
    equity: 10_500_000,
    personal: 2_329_450,
  },
];

function ready(profile: string): {
  state: GameState;
  owner: PlayerId;
  company: BusinessAsset;
} {
  for (let seed = 0; seed < 100; seed++) {
    let state = createGame({
      gameId: "company-proof",
      seed: `company-proof-${seed}`,
      playerIds: ids,
    });
    const owner = state.playerOrder.find(
      (id) => state.players[id]?.profileId === profile,
    );
    if (!owner) continue;
    for (const id of state.playerOrder) {
      const result = applyPlayerCommand(state, id, {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: state.players[id]!.offeredObjectiveIds[0],
      });
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }
    const company = Object.values(state.finance.assetsById).find(
      (a) =>
        a.kind === "business" &&
        a.cashPolicyId === "starting-company-v1" &&
        a.workCompensation?.playerId === owner,
    );
    if (company?.kind !== "business") throw new Error("Missing company");
    return { state, owner, company };
  }
  throw new Error("Profile seed not found");
}
function settle(state: GameState) {
  const result = settleQuarter(state, { quarter: state.currentQuarter });
  if (!result.ok) throw new Error(result.code);
  return result;
}

describe("approved integrated starting companies", () => {
  it.each(fixtures)(
    "funds $profile work and ownership exactly once from Q1",
    (f) => {
      const { state, owner, company } = ready(f.profile);
      expect(state.finance.recurringByPlayer[owner]?.quarterlyIncomeCents).toBe(
        0,
      );
      expect(Object.hasOwn(company, "debtPrincipalCents")).toBe(false);
      expect(
        calculateBusinessEquity(company, state.finance.loansById)
          .equityValueCents,
      ).toBe(f.equity);
      const before = JSON.stringify(state);
      const result = settle(state);
      const outcome = result.settlementOutcome.businesses.find(
        (b) => b.assetId === company.id,
      );
      expect(outcome).toMatchObject({
        operatingCashCents: f.profit,
        cashBeforeCompensationCents: f.profit + f.work,
        companyDebtPaidCents: f.payment,
        retainedFromSurplusCents: f.retention,
        closingCashCents: f.cash + f.retention,
        distributionsByPlayer: { [owner]: f.payout },
        workCompensation: {
          currentDueCents: f.work,
          currentPaidCents: f.work,
          closingArrearsCents: 0,
        },
      });
      const paid = result.settlementOutcome.loanPayments.find(
        (p) => p.borrowerAssetId === company.id,
      );
      expect(paid).toMatchObject({
        borrowerPlayerId: null,
        paidCents: f.payment,
        principalPaidCents: f.principal,
        interestPaidCents: f.payment - f.principal,
      });
      expect(result.state.finance.cashByPlayer[owner]).toBe(f.personal);
      expect(
        result.journalEntries.filter(
          (e) =>
            e.reason === "recurring-personal-income" &&
            e.destination.kind === "player" &&
            e.destination.playerId === owner,
        ),
      ).toEqual([]);
      expect(JSON.stringify(state)).toBe(before);
      const view = projectPlayerGameState(result.state, owner).self;
      expect(view.lastSettlement?.workCompensation).toContainEqual({
        assetId: company.id,
        dueCents: f.work,
        paidCents: f.work,
        unpaidCents: 0,
      });
      expect(view.loans.some((l) => l.role === "company-borrower")).toBe(true);
      expect(projectPlayerGameState(state, owner)).toEqual(
        projectPlayerGameState(state, owner),
      );
    },
  );

  it.each(fixtures)(
    "amortizes $profile company debt fully at Q28 without a personal debt mirror",
    (f) => {
      let { state, company } = ready(f.profile);
      const loan = Object.values(state.finance.loansById).find(
        (l) => l.kind === "company-loan" && l.borrowerAssetId === company.id,
      );
      if (!loan) throw new Error("Missing loan");
      const schedule = calculateCompanyLoanSchedule({
        principalCents: loan.originalPrincipalCents,
        annualRateBps: loan.annualRateBps,
      });
      expect(schedule).toHaveLength(28);
      for (let quarter = 1; quarter <= 28; quarter++) {
        const result = settle(state);
        state = result.state;
        const payment = result.settlementOutcome.loanPayments.find(
          (p) => p.loanId === loan.id,
        );
        expect(payment).toMatchObject({
          paidCents: schedule[quarter - 1]?.paymentCents,
          principalPaidCents: schedule[quarter - 1]?.principalCents,
          interestPaidCents: schedule[quarter - 1]?.interestCents,
        });
      }
      expect(state.finance.loansById[loan.id]).toMatchObject({
        outstandingPrincipalCents: 0,
        principalRepaidCents: loan.originalPrincipalCents,
        unpaidInterestCents: 0,
      });
      expect(
        Object.hasOwn(
          state.finance.assetsById[company.id]!,
          "debtPrincipalCents",
        ),
      ).toBe(false);
    },
  );

  it("keeps unpaid compensation as a company claim, recovers it before dividends and never calls personal cash", () => {
    const { state: base, owner, company } = ready("early-stage-entrepreneur");
    const assets = {
      ...base.finance.assetsById,
      [company.id]: {
        ...company,
        cashCents: cents(0),
        annualOperatingProfitCents: cents(-4_000_000),
      },
    };
    const state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: assets,
        quarterStartBasis: {
          ...base.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(assets),
        },
      },
    };
    assertGameState(state);
    const loss = settle(state);
    const outcome = loss.settlementOutcome.businesses.find(
      (b) => b.assetId === company.id,
    );
    expect(outcome).toMatchObject({
      closingCashCents: 0,
      closingOperatingArrearsCents: 100_000,
      workCompensation: { currentPaidCents: 0, closingArrearsCents: 900_000 },
      distributionsByPlayer: { [owner]: 0 },
    });
    expect(
      loss.journalEntries.some(
        (e) =>
          e.source.kind === "player" &&
          e.source.playerId === owner &&
          e.destination.kind === "business",
      ),
    ).toBe(false);
    const distressed = loss.state.finance.assetsById[company.id];
    if (distressed?.kind !== "business") throw new Error();
    const improved = {
      ...loss.state.finance.assetsById,
      [company.id]: {
        ...distressed,
        annualOperatingProfitCents: cents(12_000_000),
      },
    };
    const recovery = settle({
      ...loss.state,
      finance: {
        ...loss.state.finance,
        assetsById: improved,
        quarterStartBasis: {
          ...loss.state.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(improved),
        },
      },
    });
    const cured = recovery.settlementOutcome.businesses.find(
      (b) => b.assetId === company.id,
    );
    expect(cured?.workCompensation).toMatchObject({
      arrearsDueCents: 900_000,
      arrearsPaidCents: 900_000,
      closingArrearsCents: 0,
    });
    expect(cured?.closingOperatingArrearsCents).toBe(0);
    expect(cured?.distributionsByPlayer[owner]).toBeGreaterThan(0);
    expect(recovery.state.currentQuarter).toBe(3);
  });

  it("isolates company cash, work claims and loans from unrelated paired-state views", () => {
    const { state, owner, company } = ready("self-employed-operator");
    const other = state.playerOrder.find((id) => id !== owner)!;
    const paired: GameState = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [company.id]: {
            ...company,
            cashCents: cents(company.cashCents + 1),
            workCompensation: {
              ...company.workCompensation!,
              arrearsCents: cents(73_241),
            },
          },
        },
      },
    };
    assertGameState(paired);
    expect(projectPlayerGameState(paired, other)).toEqual(
      projectPlayerGameState(state, other),
    );
    expect(projectPlayerGameState(paired, owner).self.ownedAssets).not.toEqual(
      projectPlayerGameState(state, owner).self.ownedAssets,
    );
  });

  it("rejects an unrepresentable work claim atomically before publishing an unsafe view", () => {
    const { state: base, company } = ready("small-business-owner");
    const asset = {
      ...company,
      workCompensation: {
        ...company.workCompensation!,
        arrearsCents: cents(Number.MAX_SAFE_INTEGER - 1),
      },
    };
    const state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: { ...base.finance.assetsById, [company.id]: asset },
      },
    };
    assertGameState(state);
    const before = JSON.stringify(state);
    const result = settleQuarter(state, { quarter: 1 });
    expect(result).toMatchObject({
      ok: false,
      code: "OBLIGATION_OVERFLOW",
      journalEntries: [],
    });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("keeps Q28 maturity after misses and charges Q29 interest only on remaining principal", () => {
    const { state: base, company } = ready("early-stage-entrepreneur");
    const assets = {
      ...base.finance.assetsById,
      [company.id]: {
        ...company,
        cashCents: cents(0),
        annualOperatingProfitCents: cents(-3_600_000),
      },
    };
    let state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: assets,
        quarterStartBasis: {
          ...base.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(assets),
        },
      },
    };
    const loan = Object.values(state.finance.loansById).find(
      (l) => l.kind === "company-loan" && l.borrowerAssetId === company.id,
    )!;
    for (let quarter = 1; quarter <= 28; quarter++) state = settle(state).state;
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 6_000_000,
      principalRepaidCents: 0,
      pastDuePrincipalCents: 6_000_000,
      unpaidInterestCents: 3_360_000,
      firstDueQuarter: 1,
    });
    const current = state.finance.assetsById[company.id];
    if (current?.kind !== "business") throw new Error();
    // Isolated large recovery fixture; no performance/growth action is implied.
    const recoveredAssets = {
      ...state.finance.assetsById,
      [company.id]: {
        ...current,
        annualOperatingProfitCents: cents(200_000_000),
      },
    };
    const result = settle({
      ...state,
      finance: {
        ...state.finance,
        assetsById: recoveredAssets,
        quarterStartBasis: {
          ...state.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(recoveredAssets),
        },
      },
    });
    expect(
      result.settlementOutcome.loanPayments.find((p) => p.loanId === loan.id),
    ).toMatchObject({
      principalPaidCents: 6_000_000,
      interestPaidCents: 3_480_000,
      closingPastDuePrincipalCents: 0,
      closingUnpaidInterestCents: 0,
    });
    expect(result.state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 0,
      principalRepaidCents: 6_000_000,
      unpaidInterestCents: 0,
    });
    expect(
      result.settlementOutcome.businesses.find((b) => b.assetId === company.id)
        ?.workCompensation,
    ).toMatchObject({
      arrearsDueCents: 25_200_000,
      arrearsPaidCents: 25_200_000,
      closingArrearsCents: 0,
    });
  });
});
