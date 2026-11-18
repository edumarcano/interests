import {
  applyPlayerCommand,
  assertGameState,
  basisPoints,
  captureBusinessBasis,
  capturePropertyBasis,
  captureRecurringBasis,
  cents,
  createGame,
  createProgress,
  type GameState,
  getActiveSpotlightPlayerId,
  type JournalEntry,
  type PlayerLoan,
  type WirePlayerCommand,
} from "@interests/engine";
import { asLoanId, type PlayerId } from "@interests/shared";
import {
  completePassiveBaselineSetup,
  STANDARD_SIMULATION_PLAYER_IDS,
} from "./baseline";
import {
  applySettlementJournalToCashFlows,
  createZeroPlayerCashFlow,
  observeFinance,
} from "./metrics";

export const FINANCE_SCENARIO_NAMES = [
  "financed-acquisition",
  "living-shortfall",
  "mortgage-shortfall",
  "cyclic-loans",
  "company-loss",
  "post-maturity-recovery",
] as const;
export type FinanceScenarioName = (typeof FINANCE_SCENARIO_NAMES)[number];

function ready(seed = "m7-planning-1"): GameState {
  return completePassiveBaselineSetup(
    createGame({
      gameId: "m7-finance-acceptance",
      seed,
      playerIds: STANDARD_SIMULATION_PLAYER_IDS,
    }),
  );
}

/** Synthetic zero-resource boundary, never a reachable player journey. */
function diagnostic(seed?: string): GameState {
  const state = ready(seed);
  const assets = Object.fromEntries(
    Object.values(state.finance.assetsById).map((asset) => [
      asset.id,
      asset.kind === "business"
        ? {
            id: asset.id,
            kind: "business" as const,
            cashPolicyId: "retained-profit-v1" as const,
            cashCents: cents(0),
            operatingArrearsCents: cents(0),
            annualRevenueCents: asset.annualRevenueCents,
            annualOperatingProfitCents: cents(0),
            enterpriseValueCents: asset.enterpriseValueCents,
            debtPrincipalCents: cents(0),
            ownershipByPlayerPpm: asset.ownershipByPlayerPpm,
          }
        : { ...asset, scheduledQuarterlyRentCents: cents(0) },
    ]),
  );
  const cash = Object.fromEntries(
    state.playerOrder.map((id) => [id, cents(0)]),
  );
  const markets = Object.fromEntries(
    state.playerOrder.map((id) => [
      id,
      {
        "broad-market-fund": cents(0),
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
    ]),
  );
  return {
    ...state,
    finance: {
      ...state.finance,
      assetsById: assets,
      cashByPlayer: cash,
      publicMarketsByPlayer: markets,
      loansById: {},
      recurringByPlayer: Object.fromEntries(
        state.playerOrder.map((id) => [
          id,
          {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
        ]),
      ),
      quarterStartBasis: {
        ...state.finance.quarterStartBasis,
        cashByPlayer: cash,
        publicMarketsByPlayer: markets,
        businessesById: captureBusinessBasis(assets),
      },
    },
  };
}

function loan(id: string, borrower: PlayerId, lender: PlayerId): PlayerLoan {
  return {
    id: asLoanId(id),
    kind: "player-loan",
    borrowerPlayerId: borrower,
    lenderPlayerId: lender,
    originalPrincipalCents: cents(20_000),
    outstandingPrincipalCents: cents(20_000),
    annualRateBps: basisPoints(1_000),
    termQuarters: 2,
    installmentsProcessed: 0,
    originatedQuarter: 1,
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
  };
}

export function runFinanceScenario(name: FinanceScenarioName) {
  let state =
    name === "financed-acquisition" || name === "company-loss"
      ? ready()
      : diagnostic(
          name === "mortgage-shortfall" ? "m7-diagnostic-5" : undefined,
        );
  const [first, second] = state.playerOrder;
  if (!first || !second) throw new Error("Missing scenario players");
  let openingState = state;
  const checkpoints: {
    quarter: number;
    revision: number;
    finance: ReturnType<typeof observeFinance>;
    outcome: GameState["finance"]["lastSettlement"];
  }[] = [];
  const cashFlows = Object.fromEntries(
    state.playerOrder.map((id) => [id, createZeroPlayerCashFlow()]),
  );
  const journal: JournalEntry[] = [];
  const command = (actor: PlayerId, payload: WirePlayerCommand) => {
    const before = state;
    const result = applyPlayerCommand(state, actor, payload);
    if (!result.ok) throw new Error(`${name}: ${payload.type}: ${result.code}`);
    state = result.state;
    journal.push(...result.journalEntries);
    if (state.lastSettledQuarter > before.lastSettledQuarter) {
      applySettlementJournalToCashFlows(cashFlows, result.journalEntries);
      checkpoints.push({
        quarter: state.lastSettledQuarter,
        revision: state.revision,
        finance: observeFinance(before, state),
        outcome: state.finance.lastSettlement,
      });
    }
  };
  if (name === "financed-acquisition") {
    const opportunity = Object.values(state.opportunitiesById)[0];
    if (!opportunity) throw new Error("Missing opportunity");
    const buyer = opportunity.targetPlayerId;
    const lender = state.playerOrder.find(
      (id) =>
        id !== buyer &&
        id !== opportunity.sellerPlayerId &&
        state.finance.cashByPlayer[id]! >= 2_000_000,
    );
    if (!lender) throw new Error("Missing funded lender");
    command(first, { type: "BEGIN_ROUND" });
    while (getActiveSpotlightPlayerId(state) !== buyer)
      command(getActiveSpotlightPlayerId(state)!, { type: "PASS_SPOTLIGHT" });
    command(buyer, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opportunity.id,
      buyerCashContributionCents: 3_000_000,
      requestedPrincipalCents: 2_000_000,
    });
    const transactionId = state.activeTransaction!.id;
    command(lender, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId,
      annualRateBps: 1_000,
      termQuarters: 3,
    });
    command(buyer, {
      type: "ACCEPT_PLAYER_LOAN_OFFER",
      transactionId,
      expectedTermsRevision: 1,
    });
    command(buyer, { type: "CLOSE_BUSINESS_PURCHASE", transactionId });
  } else if (name === "living-shortfall") {
    state = {
      ...state,
      finance: {
        ...state.finance,
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [first]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(1_000),
          },
        },
      },
    };
  } else if (name === "mortgage-shortfall") {
    const source = Object.values(
      ready("m7-diagnostic-5").finance.loansById,
    ).find(
      (l) => l.kind === "legacy-bank-loan" && l.purpose === "property-mortgage",
    );
    if (!source) throw new Error("Fixed seed must include mortgage profile");
    state = {
      ...state,
      finance: { ...state.finance, loansById: { [source.id]: source } },
    };
  } else if (name === "cyclic-loans" || name === "post-maturity-recovery") {
    const a = loan("diagnostic-loan-a", first, second);
    const b = loan("diagnostic-loan-b", second, first);
    state = {
      ...state,
      finance: {
        ...state.finance,
        loansById:
          name === "cyclic-loans" ? { [a.id]: a, [b.id]: b } : { [a.id]: a },
      },
    };
  } else if (name === "company-loss") {
    const company = Object.values(state.finance.assetsById).find(
      (a) => a.kind === "business" && a.workCompensation,
    );
    if (company?.kind !== "business") throw new Error("Missing company");
    // Preserve the explicit constant-loss diagnostic rather than run a growth scenario.
    const { operatingModel: _operatingModel, ...fixedLossCompany } = company;
    const assets = {
      ...state.finance.assetsById,
      [company.id]: {
        ...fixedLossCompany,
        cashCents: cents(0),
        annualOperatingProfitCents: cents(
          -company.workCompensation!.annualCompensationCents - 400_000,
        ),
      },
    };
    state = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: assets,
        quarterStartBasis: {
          ...state.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(assets),
        },
      },
    };
  }
  if (name !== "financed-acquisition") {
    // These are explicitly synthetic opening boundaries, not mid-quarter changes.
    state = {
      ...state,
      finance: {
        ...state.finance,
        quarterStartBasis: {
          ...state.finance.quarterStartBasis,
          propertiesById: capturePropertyBasis(state.finance.assetsById),
          recurringByPlayer: captureRecurringBasis(
            state.finance.recurringByPlayer,
          ),
        },
      },
    };
    state = {
      ...state,
      progress: createProgress(state.finance, state.playerOrder),
    };
    openingState = state;
  }
  assertGameState(state);

  while (state.currentQuarter <= 4) {
    // Explicit synthetic recovery injection at Q4, after the two-period loan matured in Q3.
    if (
      name === "post-maturity-recovery" &&
      state.currentQuarter === 4 &&
      state.round?.stage === "round-start"
    ) {
      state = {
        ...state,
        finance: {
          ...state.finance,
          cashByPlayer: {
            ...state.finance.cashByPlayer,
            [first]: cents(100_000),
          },
        },
      };
      assertGameState(state);
    }
    if (state.round?.stage === "round-start")
      command(first, { type: "BEGIN_ROUND" });
    const actor = getActiveSpotlightPlayerId(state);
    if (!actor) throw new Error("Missing spotlight actor");
    command(actor, { type: "PASS_SPOTLIGHT" });
  }
  return {
    scenario: name,
    initialization:
      name === "financed-acquisition"
        ? "player-journey"
        : "synthetic-diagnostic",
    injections:
      name === "post-maturity-recovery"
        ? [{ quarter: 4, playerId: first, cashCents: 100_000 }]
        : [],
    finalQuarter: state.currentQuarter,
    checkpoints,
    cashFlows,
    journal,
    openingState,
    finalState: state,
  };
}

export function runFinanceAcceptanceScenarios() {
  return FINANCE_SCENARIO_NAMES.map(runFinanceScenario);
}
