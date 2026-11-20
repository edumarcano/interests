import { OBJECTIVE_IDS, type ObjectiveId } from "@interests/rules";
import { asAssetId, asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { stageOpeningFixture } from "../../test/openingFixture";
import { cents } from "../finance/money";
import { ownershipPpm } from "../finance/ownership";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { getActiveSpotlightPlayerId } from "../game/round";
import type { QuarterObservation } from "../model/completionState";
import type { Asset, GameState } from "../model/gameState";
import { evaluateAllObjectives, evaluateObjective } from "./evaluate";
import { measurePlayerObjectives } from "./measurements";
import type {
  ObjectiveDisposalEvidence,
  ObjectiveEvidence,
  ObjectiveFinancingEvidence,
  ObjectiveMeasurements,
} from "./model";

const ids = ["one", "two", "three", "four"].map(asPlayerId);
const actor = ids[0]!;
const owner = { [actor]: ownershipPpm(1_000_000) };
const company1 = asAssetId("company-one"),
  company2 = asAssetId("company-two");
const properties = ["property-one", "property-two", "property-three"].map(
  asAssetId,
);
const emptyObservation = (quarter: number): QuarterObservation => ({
  quarter,
  employmentIncomeCents: cents(0),
  workIncomeCents: cents(0),
  recurringWorkIncomeCents: cents(0),
  livingCostOwedCents: cents(0),
  debtServiceOwedCents: cents(0),
  debtServicePaidCents: cents(0),
  sourcesById: {},
  companyOperatingProfitById: {},
});

/** Explicit synthetic eligibility fixture; not ordinary reachability or balance evidence. */
function fixture() {
  let state = createGame({
    gameId: "objective-fixture",
    seed: "objective-fixture",
    playerIds: ids,
  });
  for (const id of ids)
    state = applyPlayerCommand(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    }).state;
  const assets: Record<string, Asset> = {
    [company1]: {
      id: company1,
      kind: "business",
      cashPolicyId: "retained-profit-v1",
      cashCents: cents(0),
      operatingArrearsCents: cents(0),
      debtPrincipalCents: cents(0),
      enterpriseValueCents: cents(150_000_000),
      annualRevenueCents: cents(200_000_000),
      annualOperatingProfitCents: cents(40_000_000),
      ownershipByPlayerPpm: owner,
    },
    [company2]: {
      id: company2,
      kind: "business",
      cashPolicyId: "retained-profit-v1",
      cashCents: cents(0),
      operatingArrearsCents: cents(0),
      debtPrincipalCents: cents(0),
      enterpriseValueCents: cents(80_000_000),
      annualRevenueCents: cents(100_000_000),
      annualOperatingProfitCents: cents(20_000_000),
      ownershipByPlayerPpm: owner,
    },
  };
  for (const id of properties)
    assets[id] = {
      id,
      kind: "property",
      marketValueCents: cents(70_000_000),
      scheduledQuarterlyRentCents: cents(1_000_000),
      occupancyBps: 10_000 as never,
      operatingExpenseRatioBps: 5_000 as never,
      ownershipByPlayerPpm: owner,
    };
  state = stageOpeningFixture({
    ...state,
    currentQuarter: 5,
    lastSettledQuarter: 4,
    finance: {
      ...state.finance,
      assetsById: assets,
      loansById: {},
      cashByPlayer: Object.fromEntries(
        ids.map((id) => [id, cents(id === actor ? 20_000_000 : 0)]),
      ),
      livingArrearsByPlayer: Object.fromEntries(
        ids.map((id) => [id, cents(0)]),
      ),
      recurringByPlayer: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            quarterlyIncomeCents: cents(id === actor ? 5_000_000 : 0),
            quarterlyLivingExpenseCents: cents(id === actor ? 1_000_000 : 0),
          },
        ]),
      ),
      publicMarketsByPlayer: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            "broad-market-fund": cents(id === actor ? 50_000_000 : 0),
            "growth-fund": cents(0),
            "income-defensive-fund": cents(0),
          },
        ]),
      ),
    },
  });
  state = {
    ...state,
    progress: {
      byPlayer: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            ...state.progress.byPlayer[id]!,
            labor:
              id === actor
                ? { kind: "employment", role: "executive" }
                : { kind: "not-working" },
            quarters: [1, 2, 3, 4].map((quarter) =>
              id !== actor
                ? emptyObservation(quarter)
                : {
                    ...emptyObservation(quarter),
                    employmentIncomeCents: cents(5_000_000),
                    livingCostOwedCents: cents(1_000_000),
                    companyOperatingProfitById: {
                      [company1]: cents(10_000_000),
                      [company2]: cents(5_000_000),
                    },
                    sourcesById: {
                      [`asset:${company1}`]: {
                        category: "business",
                        recurringReceivedCents: cents(1_500_000),
                        debtServiceOwedCents: cents(0),
                      },
                      [`asset:${company2}`]: {
                        category: "business",
                        recurringReceivedCents: cents(1_000_000),
                        debtServiceOwedCents: cents(0),
                      },
                      ...Object.fromEntries(
                        properties.map((id) => [
                          `asset:${id}`,
                          {
                            category: "property",
                            recurringReceivedCents: cents(500_000),
                            debtServiceOwedCents: cents(0),
                          },
                        ]),
                      ),
                      "fund:broad-market-fund": {
                        category: "public-markets",
                        recurringReceivedCents: cents(500_000),
                        debtServiceOwedCents: cents(0),
                      },
                      cash: {
                        category: "cash",
                        recurringReceivedCents: cents(25_000),
                        debtServiceOwedCents: cents(0),
                      },
                    },
                  },
            ),
          },
        ]),
      ),
    },
  } as GameState;
  const financing: ObjectiveFinancingEvidence[] = [1, 2, 3].map((number) => ({
    loanId: `npc-loan-${number}`,
    lenderPlayerId: actor,
    beneficialBorrowerId: `npc-borrower-${number}`,
    fundedTransactionId: `funded-deal-${number}`,
    originatedQuarter: 1,
    fundedPrincipalCents: cents(10_000_000),
    outstandingPrincipalCents: cents(10_000_000),
    unpaidInterestCents: cents(0),
    pastDuePrincipalCents: cents(0),
    funding: "non-circular",
    feesPaidCents: cents(0),
    realizedLossesCents: cents(0),
    interestReceipts: [2, 3, 4].map((quarter) => ({
      quarter,
      receivedCents: cents(1_000_000),
      currentEarnedCents: cents(1_000_000),
    })),
  }));
  const entries: ObjectiveDisposalEvidence[] = [1, 2, 3].map((number) => ({
    transactionId: `sale-${number}`,
    underlyingAssetId: `sold-${number}`,
    category: number === 3 ? "property" : "business",
    counterparty: { kind: "non-player", id: `external-${number}` },
    acquiredQuarter: 1,
    settledExposureThroughQuarter: 1,
    soldQuarter: 2,
    proceedsCents: cents(25_000_000),
    saleFeesCents: cents(1_000_000),
    acquisitionBasisCents: cents(10_000_000),
    referenceProceedsCents: null,
    economicSubstance: "genuine",
  }));
  state = {
    ...state,
    progress: {
      byPlayer: {
        ...state.progress.byPlayer,
        [actor]: {
          ...state.progress.byPlayer[actor]!,
          disposalEvidence: undefined,
        },
      },
    },
  };
  const evidence: ObjectiveEvidence = {
    financing,
    disposalLedger: { throughRevision: state.revision, entries },
  };
  return { state, evidence };
}
const measure = (input = fixture()) =>
  measurePlayerObjectives(input.state, actor, input.evidence);
const check = (
  measured: ObjectiveMeasurements,
  id: ObjectiveId,
  checkId: string,
) =>
  evaluateObjective(measured, id).checks.find((value) => value.id === checkId)!;
function changedActorQuarters(
  state: GameState,
  update: (quarter: QuarterObservation) => QuarterObservation,
): GameState {
  return {
    ...state,
    progress: {
      byPlayer: {
        ...state.progress.byPlayer,
        [actor]: {
          ...state.progress.byPlayer[actor]!,
          quarters: state.progress.byPlayer[actor]!.quarters.map(update),
        },
      },
    },
  };
}

describe("exact objective criteria", () => {
  it.each(OBJECTIVE_IDS)(
    "qualifies %s from explicit actual evidence and current positions",
    (id) => {
      const measured = measure();
      const result = evaluateObjective(measured, id);
      expect(
        result.status,
        JSON.stringify(result.checks.filter((value) => !value.met)),
      ).toBe("eligible");
    },
  );
  const nearMisses: readonly [
    ObjectiveId,
    Partial<ObjectiveMeasurements>,
    string,
  ][] = [
    [
      "founder",
      {
        companies: [
          {
            ...measure().companies[0]!,
            annualOperatingProfitCents: cents(24_999_999),
          },
        ],
      },
      "actual-annual-company-profit",
    ],
    [
      "property-magnate",
      { annualPropertyNetCashFlowCents: cents(5_999_999) },
      "actual-annual-property-net-cashflow",
    ],
    [
      "independent",
      { annualInvestmentAfterPersonalDebtServiceCents: cents(5_999_999) },
      "nonlabor-cashflow-after-personal-debt",
    ],
    [
      "capital-allocator",
      { annualInvestmentIncomeCents: cents(3_499_999) },
      "actual-annual-investment-income",
    ],
    [
      "financier",
      { earnedFinancingProfitCents: cents(7_499_999) },
      "earned-received-financing-profit",
    ],
    [
      "deal-maker",
      { creditedDealGainsCents: cents(24_999_999) },
      "seasoned-reference-bounded-gains",
    ],
    [
      "executive-owner",
      { annualEmploymentIncomeCents: cents(17_999_999) },
      "actual-annual-employment-income",
    ],
    [
      "wealth-architect",
      { annualRecurringSurplusCents: cents(6_999_999) },
      "actual-annual-recurring-surplus",
    ],
  ];
  it.each(nearMisses)(
    "rejects %s one cent below its distinct numerical threshold",
    (id, changed, failingCheck) => {
      const measured = { ...measure(), ...changed };
      expect(evaluateObjective(measured, id).status).toBe("ineligible");
      expect(check(measured, id, failingCheck).met).toBe(false);
    },
  );
  it("requires all Founder predicates on the same controlled performing company", () => {
    const measured = measure();
    const [first, second] = measured.companies;
    const input = {
      ...measured,
      companies: [
        { ...first!, ownershipPpm: 500_000 },
        {
          ...second!,
          annualOperatingProfitCents: cents(100),
          attributableEquityCents: cents(10_000_000),
        },
      ],
    };
    expect(evaluateObjective(input, "founder").status).toBe("ineligible");
    expect(
      evaluateObjective(
        { ...measured, companies: [{ ...first!, overdue: true }] },
        "founder",
      ).status,
    ).toBe("ineligible");
    expect(
      evaluateObjective(
        {
          ...measured,
          companies: [{ ...first!, consecutivePositiveQuarters: 1 }],
        },
        "founder",
      ).status,
    ).toBe("ineligible");
  });
  it("compares leverage and concentration exactly rather than rounding a boundary into eligibility", () => {
    const measured = measure();
    expect(
      check(
        {
          ...measured,
          propertyValueCents: cents(180_000_000),
          propertyPrincipalCents: cents(126_000_001),
        },
        "property-magnate",
        "property-ltv",
      ).met,
    ).toBe(false);
    expect(
      check(
        {
          ...measured,
          totalLiabilitiesCents: cents(45_000_001),
          grossAssetValueCents: cents(100_000_000),
        },
        "wealth-architect",
        "liabilities-to-assets",
      ).met,
    ).toBe(false);
    expect(
      check(
        { ...measured, cashCents: cents(measured.netWorthCents / 2 + 1) },
        "wealth-architect",
        "largest-holding-to-net-worth",
      ).met,
    ).toBe(false);
  });
});

describe("actual history and current exposure", () => {
  it("does not invent or annualize missing quarters, or accept projected operating profit", () => {
    const input = fixture();
    input.state = {
      ...input.state,
      lastSettledQuarter: 1,
      currentQuarter: 2,
      progress: {
        byPlayer: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              ...input.state.progress.byPlayer[id]!,
              quarters: input.state.progress.byPlayer[id]!.quarters.slice(0, 1),
            },
          ]),
        ),
      },
    };
    const measured = measurePlayerObjectives(input.state, actor);
    expect(measured.companies[0]!.annualOperatingProfitCents).toBe(10_000_000);
    expect(measured.annualEmploymentIncomeCents).toBe(5_000_000);
    expect(evaluateObjective(measured, "founder").status).toBe("ineligible");
    expect(evaluateObjective(measured, "executive-owner").status).toBe(
      "ineligible",
    );
  });
  it("uses the greater of actual owed expenses and current annual expenses", () => {
    const { state } = fixture();
    const raised = {
      ...state,
      finance: {
        ...state.finance,
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [actor]: {
            quarterlyIncomeCents: cents(5_000_000),
            quarterlyLivingExpenseCents: cents(2_000_000),
          },
        },
      },
    };
    expect(
      measurePlayerObjectives(raised, actor).protectedAnnualLivingCostCents,
    ).toBe(8_000_000);
    const cut = {
      ...state,
      finance: {
        ...state.finance,
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [actor]: {
            quarterlyIncomeCents: cents(5_000_000),
            quarterlyLivingExpenseCents: cents(1),
          },
        },
      },
    };
    expect(
      measurePlayerObjectives(cut, actor).protectedAnnualLivingCostCents,
    ).toBe(4_000_000);
  });
  it("removes fully disposed income sources and departed labor without guessing future returns", () => {
    const { state } = fixture();
    const sold = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: Object.fromEntries(
          Object.entries(state.finance.assetsById).map(([id, asset]) => [
            id,
            {
              ...asset,
              ownershipByPlayerPpm: { [ids[1]!]: ownershipPpm(1_000_000) },
            },
          ]),
        ),
        publicMarketsByPlayer: {
          ...state.finance.publicMarketsByPlayer,
          [actor]: {
            "broad-market-fund": cents(0),
            "growth-fund": cents(0),
            "income-defensive-fund": cents(0),
          },
        },
      },
      progress: {
        byPlayer: {
          ...state.progress.byPlayer,
          [actor]: {
            ...state.progress.byPlayer[actor]!,
            labor: { kind: "not-working" as const },
          },
        },
      },
    };
    const measured = measurePlayerObjectives(sold, actor);
    expect(measured.incomeSources.map((source) => source.id)).toEqual(["cash"]);
    expect(measured.annualEmploymentIncomeCents).toBe(0);
    expect(evaluateObjective(measured, "independent").status).toBe(
      "ineligible",
    );
    expect(evaluateObjective(measured, "wealth-architect").status).toBe(
      "ineligible",
    );
  });
  it("deduplicates transferred company operating history without crediting another company's profits", () => {
    const { state } = fixture();
    const moved = changedActorQuarters(state, (quarter) => ({
      ...quarter,
      companyOperatingProfitById: {},
    }));
    const previousOwner = ids[1]!;
    const transferred = {
      ...moved,
      progress: {
        byPlayer: {
          ...moved.progress.byPlayer,
          [previousOwner]: {
            ...moved.progress.byPlayer[previousOwner]!,
            quarters: state.progress.byPlayer[actor]!.quarters.map(
              (quarter) => ({
                ...emptyObservation(quarter.quarter),
                companyOperatingProfitById: quarter.companyOperatingProfitById,
              }),
            ),
          },
        },
      },
    };
    expect(
      measurePlayerObjectives(transferred, actor).companies[0]!
        .annualOperatingProfitCents,
    ).toBe(40_000_000);
    expect(
      evaluateObjective(measurePlayerObjectives(transferred, actor), "founder")
        .status,
    ).toBe("eligible");
  });
  it("subtracts required personal debt service once, including legacy mortgage attribution", () => {
    const { state } = fixture();
    const changed = changedActorQuarters(state, (quarter) => ({
      ...quarter,
      debtServiceOwedCents: cents(700_000),
      debtServicePaidCents: cents(700_000),
      sourcesById: {
        ...quarter.sourcesById,
        [`asset:${properties[0]}`]: {
          category: "property",
          recurringReceivedCents: cents(500_000),
          debtServiceOwedCents: cents(200_000),
          personalDebtServiceOwedCents: cents(200_000),
        },
      },
    }));
    const measured = measurePlayerObjectives(changed, actor);
    expect(measured.annualRequiredPersonalDebtServiceCents).toBe(2_800_000);
    expect(
      measured.annualInvestmentIncomeCents -
        measured.annualInvestmentAfterPersonalDebtServiceCents,
    ).toBe(2_000_000);
  });
});

describe("distinct objective exploit protection", () => {
  it("requires three genuinely controlled properties instead of tiny portfolio interests", () => {
    const input = fixture();
    const split = {
      ...input.state,
      finance: {
        ...input.state.finance,
        assetsById: {
          ...input.state.finance.assetsById,
          [properties[0]!]: {
            ...input.state.finance.assetsById[properties[0]!]!,
            ownershipByPlayerPpm: {
              [actor]: ownershipPpm(500_000),
              [ids[1]!]: ownershipPpm(500_000),
            },
          },
        },
      },
    };
    expect(measurePlayerObjectives(split, actor).controlledProperties).toBe(2);
    expect(
      evaluateObjective(
        measurePlayerObjectives(split, actor),
        "property-magnate",
      ).status,
    ).toBe("ineligible");
  });
  it("groups loan interests by beneficial borrower and split deal tranches before diversity/count checks", () => {
    const { state, evidence } = fixture();
    const original = evidence.financing![0]!;
    const tranches = [1, 2, 3].map((number) => ({
      ...original,
      loanId: `split-${number}`,
      fundedPrincipalCents: cents(2_000_000),
      outstandingPrincipalCents: cents(2_000_000),
      interestReceipts: original.interestReceipts.map((receipt) => ({
        ...receipt,
        receivedCents: cents(100_000),
        currentEarnedCents: cents(100_000),
      })),
    }));
    const measured = measurePlayerObjectives(state, actor, {
      financing: tranches,
    });
    expect(measured.distinctFundedTransactions).toBe(1);
    expect(measured.distinctPerformingBorrowers).toBe(1);
    expect(
      measured.holdings.filter((holding) => holding.category === "financing"),
    ).toHaveLength(1);
    expect(
      measured.incomeSources.filter(
        (source) => source.category === "financing",
      ),
    ).toHaveLength(1);
    expect(evaluateObjective(measured, "financier").status).toBe("ineligible");
    const underMinimum = measurePlayerObjectives(state, actor, {
      financing: [
        {
          ...original,
          fundedPrincipalCents: cents(4_999_999),
          outstandingPrincipalCents: cents(4_999_999),
        },
      ],
    });
    expect(underMinimum.distinctFundedTransactions).toBe(0);
  });
  it("excludes circular/unreceived/principal returns while retaining lifetime actually received interest", () => {
    const { state, evidence } = fixture();
    const circular = measurePlayerObjectives(state, actor, {
      financing: evidence.financing!.map((loan) => ({
        ...loan,
        funding: "circular",
      })),
    });
    expect(circular.earnedFinancingProfitCents).toBe(0);
    expect(circular.performingFinancingBookCents).toBe(0);
    expect(
      circular.incomeSources.some((source) => source.category === "financing"),
    ).toBe(false);
    expect(
      circular.holdings.some((holding) => holding.category === "financing"),
    ).toBe(false);
    const repaid = measurePlayerObjectives(state, actor, {
      financing: evidence.financing!.map((loan) => ({
        ...loan,
        outstandingPrincipalCents: cents(0),
      })),
    });
    expect(repaid.earnedFinancingProfitCents).toBe(9_000_000);
    expect(repaid.performingFinancingBookCents).toBe(0);
    expect(
      repaid.incomeSources.some((source) => source.category === "financing"),
    ).toBe(false);
    const catchup = measurePlayerObjectives(state, actor, {
      financing: evidence.financing!.map((loan) => ({
        ...loan,
        interestReceipts: loan.interestReceipts.map((receipt) => ({
          ...receipt,
          currentEarnedCents: cents(0),
        })),
      })),
    });
    expect(catchup.earnedFinancingProfitCents).toBe(9_000_000);
    expect(
      catchup.incomeSources
        .filter((source) => source.category === "financing")
        .every((source) => source.annualReceivedCents === 0),
    ).toBe(true);
    const unfunded = measurePlayerObjectives(
      {
        ...state,
        progress: {
          byPlayer: {
            ...state.progress.byPlayer,
            [actor]: {
              ...state.progress.byPlayer[actor]!,
              financingInterestReceivedCents: cents(999_999_999),
              realizedGainsCents: cents(999_999_999),
            },
          },
        },
      },
      actor,
    );
    expect(unfunded.earnedFinancingProfitCents).toBe(0);
    expect(unfunded.creditedDealGainsCents).toBe(0);
  });
  it("marks overdue lending at zero objective value without deleting its canonical collectible claim", () => {
    const { state, evidence } = fixture();
    const current = measurePlayerObjectives(state, actor, evidence);
    const changed = {
      financing: evidence.financing!.map((loan, index) =>
        index === 0 ? { ...loan, pastDuePrincipalCents: cents(1) } : loan,
      ),
    };
    const before = JSON.stringify(changed);
    const overdue = measurePlayerObjectives(state, actor, changed);
    expect(overdue.grossAssetValueCents).toBe(
      current.grossAssetValueCents - 10_000_000,
    );
    expect(overdue.performingFinancingBookCents).toBe(20_000_000);
    expect(overdue.distinctFundedTransactions).toBe(2);
    expect(JSON.stringify(changed)).toBe(before);
    expect(changed.financing[0]!.outstandingPrincipalCents).toBe(10_000_000);
  });
  it("keeps signed disposal losses, charges fees, and caps player-sale gains against independent quotes", () => {
    const { state, evidence } = fixture();
    const original = evidence.disposalLedger!.entries[0]!;
    const entries = [
      {
        ...original,
        transactionId: "inflated",
        counterparty: { kind: "player" as const, id: ids[1]! },
        proceedsCents: cents(100_000_000),
        referenceProceedsCents: cents(15_000_000),
      },
      {
        ...original,
        transactionId: "loss",
        proceedsCents: cents(5_000_000),
        acquisitionBasisCents: cents(10_000_000),
      },
      {
        ...original,
        transactionId: "bargain",
        proceedsCents: cents(25_000_000),
        acquisitionBasisCents: cents(1_000_000),
      },
    ];
    const measured = measurePlayerObjectives(state, actor, {
      disposalLedger: { throughRevision: state.revision, entries },
    });
    expect(measured.creditedDealGainsCents).toBe(
      4_000_000 - 6_000_000 + 23_000_000,
    );
    expect(measured.profitableDisposals).toBe(2);
    expect(evaluateObjective(measured, "deal-maker").status).toBe("ineligible");
  });
  it("rejects same-quarter churn, fictional starting exposure, missing reference prices and circular transactions", () => {
    const { state, evidence } = fixture();
    const original = evidence.disposalLedger!.entries[0]!;
    for (const changed of [
      { acquiredQuarter: 2, settledExposureThroughQuarter: 1 },
      { acquiredQuarter: 0, settledExposureThroughQuarter: 0, soldQuarter: 1 },
      { economicSubstance: "circular" as const },
      {
        counterparty: { kind: "player" as const, id: ids[1]! },
        referenceProceedsCents: null,
      },
    ]) {
      const measured = measurePlayerObjectives(state, actor, {
        disposalLedger: {
          throughRevision: state.revision,
          entries: [{ ...original, ...changed }],
        },
      });
      expect(measured.creditedDealGainsCents).toBe(0);
      expect(measured.profitableDisposals).toBe(0);
    }
    const cheapBasis = {
      ...original,
      proceedsCents: cents(5_000_000),
      acquisitionBasisCents: cents(100_000),
      saleFeesCents: cents(0),
    };
    expect(
      measurePlayerObjectives(state, actor, {
        disposalLedger: {
          throughRevision: state.revision,
          entries: [cheapBasis],
        },
      }).profitableDisposals,
    ).toBe(1);
    expect(
      measurePlayerObjectives(state, actor, {
        disposalLedger: {
          throughRevision: state.revision,
          entries: [{ ...cheapBasis, proceedsCents: cents(4_999_999) }],
        },
      }).profitableDisposals,
    ).toBe(0);
  });
  it("rejects principal-only paper wealth, tiny positions, and one-category token diversification", () => {
    const measured = measure();
    const oneFund = {
      ...measured,
      holdings: [
        {
          id: "fund:one",
          category: "public-markets" as const,
          equityCents: cents(100_000_000),
        },
        ...[1, 2, 3].map((number) => ({
          id: `asset:${number}`,
          category: "property" as const,
          equityCents: cents(4_999_999),
        })),
      ],
    };
    expect(check(oneFund, "capital-allocator", "material-holdings").met).toBe(
      false,
    );
    expect(
      check(oneFund, "capital-allocator", "productive-categories").met,
    ).toBe(false);
    expect(
      check(
        { ...measured, holdings: [] },
        "wealth-architect",
        "material-productive-categories",
      ).met,
    ).toBe(false);
    expect(
      evaluateObjective(
        { ...measured, annualInvestmentIncomeCents: cents(0) },
        "capital-allocator",
      ).status,
    ).toBe("ineligible");
    expect(
      evaluateObjective({ ...measured, holdings: [] }, "executive-owner")
        .status,
    ).toBe("ineligible");
  });
  it("applies personal overdue gating while leaving unrelated minority-asset arrears out of other objective gates", () => {
    const { state, evidence } = fixture();
    const debtor = {
      ...state,
      finance: {
        ...state.finance,
        livingArrearsByPlayer: {
          ...state.finance.livingArrearsByPlayer,
          [actor]: cents(1),
        },
      },
    };
    expect(
      evaluateAllObjectives(
        measurePlayerObjectives(debtor, actor, evidence),
      ).every((result) => result.status === "ineligible"),
    ).toBe(true);
    const badCompany = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [company2]: {
            ...state.finance.assetsById[company2]!,
            operatingArrearsCents: cents(1),
          },
        },
      },
    } as GameState;
    const measured = measurePlayerObjectives(badCompany, actor, evidence);
    expect(evaluateObjective(measured, "founder").status).toBe("eligible");
    expect(evaluateObjective(measured, "executive-owner").status).toBe(
      "eligible",
    );
    expect(
      measured.incomeSources.some(
        (source) => source.id === `asset:${company2}`,
      ),
    ).toBe(false);
  });
  it("requires exact actual chronological evidence and rejects duplicates or stale ledgers", () => {
    const { state, evidence } = fixture();
    expect(() =>
      measurePlayerObjectives(state, actor, {
        financing: [...evidence.financing!, evidence.financing![0]!],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      measurePlayerObjectives(state, actor, {
        disposalLedger: {
          ...evidence.disposalLedger!,
          throughRevision: state.revision - 1,
        },
      }),
    ).toThrow("Stale");
    expect(() =>
      measurePlayerObjectives(state, actor, {
        financing: [
          {
            ...evidence.financing![0]!,
            interestReceipts: [
              {
                quarter: 5,
                receivedCents: cents(1),
                currentEarnedCents: cents(1),
              },
            ],
          },
        ],
      }),
    ).toThrow("Unsettled");
    const skipped = changedActorQuarters(state, (quarter) => ({
      ...quarter,
      quarter: quarter.quarter === 3 ? 2 : quarter.quarter,
    }));
    expect(() => measurePlayerObjectives(skipped, actor)).toThrow(
      "nonconsecutive",
    );
  });
});

it("measures actual production-command settlement history deterministically without mutating state or evidence", () => {
  let state = createGame({
    gameId: "ordinary-objective-proof",
    seed: "ordinary-objective-proof",
    playerIds: ids,
  });
  for (const id of ids)
    state = applyPlayerCommand(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    }).state;
  while (state.lastSettledQuarter < 4) {
    const command =
      state.round?.stage === "round-start"
        ? { type: "BEGIN_ROUND" as const }
        : { type: "PASS_SPOTLIGHT" as const };
    const result = applyPlayerCommand(
      state,
      command.type === "BEGIN_ROUND"
        ? actor
        : getActiveSpotlightPlayerId(state)!,
      command,
    );
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  const before = JSON.stringify(state);
  const measured = measurePlayerObjectives(state, actor);
  expect(measured.completedQuarters).toBe(4);
  expect(measured.annualEmploymentIncomeCents).toBe(
    state.progress.byPlayer[actor]!.quarters.reduce(
      (total, quarter) => total + quarter.employmentIncomeCents,
      0,
    ),
  );
  expect(
    evaluateAllObjectives(measured).every(
      (result) => result.status === "ineligible",
    ),
  ).toBe(true);
  expect(measurePlayerObjectives(JSON.parse(before), actor)).toEqual(measured);
  expect(JSON.stringify(state)).toBe(before);
});

it("keeps unrelated private player finances and objectives out of the owner's measurements", () => {
  const { state, evidence } = fixture();
  const other = ids[1]!;
  const changed: GameState = {
    ...state,
    players: {
      ...state.players,
      [other]: { ...state.players[other]!, selectedObjectiveId: "financier" },
    },
    finance: {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [other]: cents(999_999_999),
      },
    },
    progress: {
      byPlayer: {
        ...state.progress.byPlayer,
        [other]: {
          ...state.progress.byPlayer[other]!,
          quarters: state.progress.byPlayer[other]!.quarters.map((quarter) => ({
            ...quarter,
            employmentIncomeCents: cents(999_999),
            sourcesById: {
              cash: {
                category: "cash",
                recurringReceivedCents: cents(999_999),
                debtServiceOwedCents: cents(0),
              },
            },
          })),
        },
      },
    },
  };
  const before = JSON.stringify({ state, evidence });
  const measured = measurePlayerObjectives(state, actor, evidence);
  expect(measurePlayerObjectives(changed, actor, evidence)).toEqual(measured);
  expect(
    evaluateAllObjectives(measurePlayerObjectives(changed, actor, evidence)),
  ).toEqual(evaluateAllObjectives(measured));
  expect(JSON.stringify({ state, evidence })).toBe(before);
});
