import {
  OPENING_PERSONAL_DEBT_APR_BPS,
  PROFILES,
  STANDARD_V1_OPENING_BASE_RATE_BPS,
  STANDARD_V1_OPENING_PUBLIC_MARKET_INSTRUMENT_ID,
  STANDARD_V1_PLAYER_COUNT,
  STANDARD_V1_STARTING_REGIME,
} from "@finance-game/rules";
import {
  type AssetId,
  asGameId,
  type LoanId,
  type PlayerId,
} from "@finance-game/shared";
import { createZeroPublicMarketPortfolio } from "../finance/markets";
import { basisPoints, type Cents, cents } from "../finance/money";
import { ownershipPpm } from "../finance/ownership";
import { assertGameState } from "../invariants/assertGameState";
import type {
  Asset,
  DeterministicCounters,
  GameState,
  Loan,
  PlayerState,
  PublicMarketPortfolio,
  QuarterStartFinanceBasis,
  RecurringPersonalFinance,
} from "../model/gameState";
import { createRandomState } from "../random/prng";
import { nextDeterministicId } from "./deterministicIds";
import { generateDeterministicSetup } from "./setup";

export interface CreateGameInput {
  readonly gameId: string;
  readonly seed: string;
  readonly playerIds: readonly PlayerId[];
}

export function createGame(input: CreateGameInput): GameState {
  if (input.playerIds.length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Invalid initialization: standard-v1 requires exactly ${STANDARD_V1_PLAYER_COUNT} players, got ${input.playerIds.length}`,
    );
  }

  const uniquePlayerIds = new Set(input.playerIds);
  if (uniquePlayerIds.size !== input.playerIds.length) {
    throw new Error(
      "Invalid initialization: player IDs must be unique within a game",
    );
  }

  const initialRandom = createRandomState(input.seed);
  const setup = generateDeterministicSetup(input.playerIds, initialRandom);

  const players: Record<PlayerId, PlayerState> = {} as Record<
    PlayerId,
    PlayerState
  >;
  const cashByPlayer: Record<PlayerId, Cents> = {} as Record<PlayerId, Cents>;
  const recurringByPlayer: Record<PlayerId, RecurringPersonalFinance> =
    {} as Record<PlayerId, RecurringPersonalFinance>;
  const publicMarketsByPlayer: Record<PlayerId, PublicMarketPortfolio> =
    {} as Record<PlayerId, PublicMarketPortfolio>;

  for (const playerId of input.playerIds) {
    const profileId = setup.profileAssignments[playerId];
    const offeredObjectiveIds = setup.objectiveOffers[playerId];
    if (profileId === undefined || offeredObjectiveIds === undefined) {
      throw new Error(
        `Setup failed: missing profile or objective offers for player ${playerId}`,
      );
    }
    const profileDef = PROFILES[profileId];
    if (profileDef === undefined) {
      throw new Error(`Setup failed: unknown profile ${profileId}`);
    }

    players[playerId] = {
      id: playerId,
      profileId,
      offeredObjectiveIds,
      selectedObjectiveId: null,
    };
    cashByPlayer[playerId] = cents(profileDef.startingCashCents);

    const finances = profileDef.startingFinances;
    const quarterlyIncome = finances.annualIncomeCents / 4;
    const quarterlyLivingExpense = finances.monthlyLivingExpenseCents * 3;

    if (!Number.isSafeInteger(quarterlyIncome) || quarterlyIncome < 0) {
      throw new RangeError(
        `Quarterly income must be a non-negative safe integer for profile ${profileId}`,
      );
    }
    if (
      !Number.isSafeInteger(quarterlyLivingExpense) ||
      quarterlyLivingExpense < 0
    ) {
      throw new RangeError(
        `Quarterly living expense must be a non-negative safe integer for profile ${profileId}`,
      );
    }

    recurringByPlayer[playerId] = {
      quarterlyIncomeCents: cents(quarterlyIncome),
      quarterlyLivingExpenseCents: cents(quarterlyLivingExpense),
    };

    const portfolio = createZeroPublicMarketPortfolio();
    portfolio[STANDARD_V1_OPENING_PUBLIC_MARKET_INSTRUMENT_ID] = cents(
      finances.startingPublicInvestmentsCents,
    );
    publicMarketsByPlayer[playerId] = portfolio;
  }

  let currentCounters: DeterministicCounters = {
    asset: 0,
    contract: 0,
    loan: 0,
    opportunity: 0,
    journal: 0,
    settlement: 0,
    transaction: 0,
  };

  // 1. Starting Assets creation in canonical playerOrder
  const assetsById: Record<AssetId, Asset> = {};
  const propertyAssetIdByPlayer: Partial<Record<PlayerId, AssetId>> = {};

  for (const playerId of input.playerIds) {
    const profileId = setup.profileAssignments[playerId];
    if (profileId === undefined) continue;
    const profileDef = PROFILES[profileId];
    if (profileDef === undefined) continue;

    const { propertyFixture, businessFixture } = profileDef.startingFinances;

    if (propertyFixture !== undefined) {
      const nextAsset = nextDeterministicId("asset", currentCounters);
      currentCounters = nextAsset.counters;
      const assetId = nextAsset.id;
      propertyAssetIdByPlayer[playerId] = assetId;

      assetsById[assetId] = {
        id: assetId,
        kind: "property",
        marketValueCents: cents(propertyFixture.marketValueCents),
        scheduledQuarterlyRentCents: cents(
          propertyFixture.scheduledQuarterlyRentCents,
        ),
        occupancyBps: basisPoints(propertyFixture.occupancyBps),
        operatingExpenseRatioBps: basisPoints(
          propertyFixture.operatingExpenseRatioBps,
        ),
        ownershipByPlayerPpm: {
          [playerId]: ownershipPpm(propertyFixture.ownershipPpm),
        },
      };
    }

    if (businessFixture !== undefined) {
      const nextAsset = nextDeterministicId("asset", currentCounters);
      currentCounters = nextAsset.counters;
      const assetId = nextAsset.id;

      assetsById[assetId] = {
        id: assetId,
        kind: "business",
        annualRevenueCents: cents(businessFixture.annualRevenueCents),
        annualOperatingProfitCents: cents(
          businessFixture.annualOperatingProfitCents,
        ),
        enterpriseValueCents: cents(businessFixture.enterpriseValueCents),
        debtPrincipalCents: cents(businessFixture.debtPrincipalCents),
        ownershipByPlayerPpm: {
          [playerId]: ownershipPpm(businessFixture.ownershipPpm),
        },
      };
    }
  }

  // 2. Starting Legacy Bank Loans creation in canonical playerOrder
  const loansById: Record<LoanId, Loan> = {};

  for (const playerId of input.playerIds) {
    const profileId = setup.profileAssignments[playerId];
    if (profileId === undefined) continue;
    const profileDef = PROFILES[profileId];
    if (profileDef === undefined) continue;

    const finances = profileDef.startingFinances;

    if (finances.openingPersonalDebtPrincipalCents > 0) {
      const nextLoan = nextDeterministicId("loan", currentCounters);
      currentCounters = nextLoan.counters;
      const loanId = nextLoan.id;
      const quarterlyPayment = finances.monthlyPersonalDebtPaymentCents * 3;

      loansById[loanId] = {
        id: loanId,
        kind: "legacy-bank-loan",
        borrowerPlayerId: playerId,
        purpose: "personal-debt",
        originalPrincipalCents: cents(
          finances.openingPersonalDebtPrincipalCents,
        ),
        outstandingPrincipalCents: cents(
          finances.openingPersonalDebtPrincipalCents,
        ),
        annualRateBps: basisPoints(OPENING_PERSONAL_DEBT_APR_BPS),
        scheduledQuarterlyPaymentCents: cents(quarterlyPayment),
        paymentsApplied: 0,
      };
    }

    if (finances.mortgageFixture !== undefined) {
      const relatedPropertyId = propertyAssetIdByPlayer[playerId];
      if (relatedPropertyId === undefined) {
        throw new Error(
          `Setup invariant failed: property mortgage for player ${playerId} has no matching property asset`,
        );
      }

      const nextLoan = nextDeterministicId("loan", currentCounters);
      currentCounters = nextLoan.counters;
      const loanId = nextLoan.id;
      const mFixture = finances.mortgageFixture;

      loansById[loanId] = {
        id: loanId,
        kind: "legacy-bank-loan",
        borrowerPlayerId: playerId,
        purpose: "property-mortgage",
        originalPrincipalCents: cents(mFixture.openingPrincipalCents),
        outstandingPrincipalCents: cents(mFixture.openingPrincipalCents),
        annualRateBps: basisPoints(mFixture.annualRateBps),
        scheduledQuarterlyPaymentCents: cents(
          mFixture.scheduledQuarterlyPaymentCents,
        ),
        paymentsApplied: 0,
        relatedAssetId: relatedPropertyId,
      };
    }
  }

  const quarterStartBasis: QuarterStartFinanceBasis = {
    quarter: 1,
    cashByPlayer: { ...cashByPlayer },
    publicMarketsByPlayer: { ...publicMarketsByPlayer },
  };

  const state: GameState = {
    gameId: asGameId(input.gameId),
    modeId: "standard-v1",
    revision: 0,
    phase: "objective-choosing",
    currentQuarter: 1,
    lastSettledQuarter: 0,
    playerOrder: [...input.playerIds],
    players,
    finance: {
      cashByPlayer,
      recurringByPlayer,
      loansById,
      assetsById,
      publicMarketsByPlayer,
      quarterStartBasis,
    },
    economy: {
      currentRegime: STANDARD_V1_STARTING_REGIME,
      baseRateBps: basisPoints(STANDARD_V1_OPENING_BASE_RATE_BPS),
      lastMarketUpdate: null,
    },
    random: setup.random,
    counters: currentCounters,
    activeTransaction: null,
    opportunitiesById: {},
  };

  assertGameState(state);
  return state;
}
