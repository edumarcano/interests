import {
  isEconomicRegimeId,
  isObjectiveId,
  isPairValid,
  isProfileId,
  OBJECTIVE_IDS,
  PLAYER_LOAN_MAX_TERM_QUARTERS,
  PLAYER_LOAN_MIN_TERM_QUARTERS,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  STANDARD_V1_OPENING_BASE_RATE_BPS,
  STANDARD_V1_PLAYER_COUNT,
} from "@interests/rules";
import {
  calculateLegacyBankLoanNextPayment,
  calculatePlayerLoanSchedule,
} from "../finance/amortization";
import { calculateBusinessEquity } from "../finance/business";
import { totalPublicMarketValueCents } from "../finance/markets";
import { TOTAL_OWNERSHIP_PPM } from "../finance/ownership";
import { calculatePropertyCashFlow } from "../finance/property";
import type { GameState } from "../model/gameState";
import { isValidRandomState } from "../random/prng";

export function assertGameState(state: GameState): void {
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new Error(
      "Game invariant failed: revision must be a non-negative safe integer",
    );
  }
  if (!isValidRandomState(state.random)) {
    throw new Error("Game invariant failed: random state is invalid");
  }

  // Player count and order invariants
  if (state.playerOrder.length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Game invariant failed: standard-v1 requires exactly ${STANDARD_V1_PLAYER_COUNT} players, got ${state.playerOrder.length}`,
    );
  }
  if (new Set(state.playerOrder).size !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error("Game invariant failed: player order contains duplicates");
  }
  if (Object.keys(state.players).length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Game invariant failed: players map must have exactly ${STANDARD_V1_PLAYER_COUNT} players`,
    );
  }

  const assignedProfiles = new Set<string>();
  const globallyOfferedObjectives = new Set<string>();
  let selectedCount = 0;

  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (player === undefined) {
      throw new Error(`Game invariant failed: missing player ${playerId}`);
    }

    // Profile validity and uniqueness
    if (!isProfileId(player.profileId)) {
      throw new Error(
        `Game invariant failed: invalid profileId ${String(player.profileId)} for player ${playerId}`,
      );
    }
    if (assignedProfiles.has(player.profileId)) {
      throw new Error(
        `Game invariant failed: duplicate profileId ${player.profileId}`,
      );
    }
    assignedProfiles.add(player.profileId);

    // Objective offers validity
    const offers = player.offeredObjectiveIds;
    if (offers.length !== 2) {
      throw new Error(
        `Game invariant failed: player ${playerId} must have exactly 2 objective offers`,
      );
    }
    const [firstOffer, secondOffer] = offers;
    if (!isObjectiveId(firstOffer) || !isObjectiveId(secondOffer)) {
      throw new Error(
        `Game invariant failed: invalid objective offer for player ${playerId}`,
      );
    }
    if (firstOffer === secondOffer) {
      throw new Error(
        `Game invariant failed: duplicate objective offer for player ${playerId}`,
      );
    }
    if (!isPairValid(player.profileId, firstOffer, secondOffer)) {
      throw new Error(
        `Game invariant failed: objective offers [${firstOffer}, ${secondOffer}] incompatible with profile ${player.profileId}`,
      );
    }

    // Global uniqueness across match
    if (
      globallyOfferedObjectives.has(firstOffer) ||
      globallyOfferedObjectives.has(secondOffer)
    ) {
      throw new Error(
        "Game invariant failed: objective offered to multiple players",
      );
    }
    globallyOfferedObjectives.add(firstOffer);
    globallyOfferedObjectives.add(secondOffer);

    // Selection validity
    if (player.selectedObjectiveId !== null) {
      if (
        player.selectedObjectiveId !== firstOffer &&
        player.selectedObjectiveId !== secondOffer
      ) {
        throw new Error(
          `Game invariant failed: player ${playerId} selected an un-offered objective ${player.selectedObjectiveId}`,
        );
      }
      selectedCount += 1;
    }
  }

  // All 8 objectives must appear globally
  if (globallyOfferedObjectives.size !== OBJECTIVE_IDS.length) {
    throw new Error(
      `Game invariant failed: exactly ${OBJECTIVE_IDS.length} objectives must be offered across match, got ${globallyOfferedObjectives.size}`,
    );
  }

  // Phase invariants
  if (state.phase === "ready-for-first-round") {
    if (selectedCount !== STANDARD_V1_PLAYER_COUNT) {
      throw new Error(
        "Game invariant failed: ready-for-first-round requires all 4 players to have selected an objective",
      );
    }
  } else if (state.phase === "objective-choosing") {
    if (selectedCount === STANDARD_V1_PLAYER_COUNT) {
      throw new Error(
        "Game invariant failed: game must transition to ready-for-first-round when all 4 players have selected",
      );
    }
  }

  // Counter invariants
  for (const counter of Object.values(state.counters)) {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error(
        "Game invariant failed: deterministic counters must be non-negative safe integers",
      );
    }
  }
  if (
    !Number.isSafeInteger(state.counters.journal) ||
    state.counters.journal < 0
  ) {
    throw new Error(
      "Game invariant failed: journal counter must be a non-negative safe integer",
    );
  }
  if (
    !Number.isSafeInteger(state.counters.settlement) ||
    state.counters.settlement < 0
  ) {
    throw new Error(
      "Game invariant failed: settlement counter must be a non-negative safe integer",
    );
  }
  if (
    !Number.isSafeInteger(state.counters.opportunity) ||
    state.counters.opportunity < 0
  ) {
    throw new Error(
      "Game invariant failed: opportunity counter must be a non-negative safe integer",
    );
  }
  if (
    !Number.isSafeInteger(state.counters.transaction) ||
    state.counters.transaction < 0
  ) {
    throw new Error(
      "Game invariant failed: transaction counter must be a non-negative safe integer",
    );
  }

  // Quarter state invariants
  if (
    !Number.isSafeInteger(state.currentQuarter) ||
    state.currentQuarter <= 0
  ) {
    throw new Error(
      "Game invariant failed: currentQuarter must be a positive safe integer",
    );
  }
  if (
    !Number.isSafeInteger(state.lastSettledQuarter) ||
    state.lastSettledQuarter < 0
  ) {
    throw new Error(
      "Game invariant failed: lastSettledQuarter must be a non-negative safe integer",
    );
  }
  if (state.lastSettledQuarter !== state.currentQuarter - 1) {
    throw new Error(
      `Game invariant failed: lastSettledQuarter (${state.lastSettledQuarter}) must equal currentQuarter - 1 (${state.currentQuarter - 1})`,
    );
  }

  // Financial state invariants
  if (
    state.finance === undefined ||
    state.finance === null ||
    typeof state.finance !== "object"
  ) {
    throw new Error(
      "Game invariant failed: finance state is missing or invalid",
    );
  }

  if (
    state.finance.cashByPlayer === undefined ||
    state.finance.cashByPlayer === null ||
    typeof state.finance.cashByPlayer !== "object"
  ) {
    throw new Error(
      "Game invariant failed: cashByPlayer map is missing or invalid",
    );
  }

  const cashPlayerIds = Object.keys(state.finance.cashByPlayer);
  if (cashPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Game invariant failed: cashByPlayer must have exactly ${STANDARD_V1_PLAYER_COUNT} player balances, got ${cashPlayerIds.length}`,
    );
  }

  for (const playerId of state.playerOrder) {
    const balance = state.finance.cashByPlayer[playerId];
    if (balance === undefined) {
      throw new Error(
        `Game invariant failed: player ${playerId} is missing a cash balance`,
      );
    }
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new Error(
        `Game invariant failed: player ${playerId} cash balance must be a non-negative safe integer of cents, got ${String(balance)}`,
      );
    }
  }

  for (const cashKey of cashPlayerIds) {
    if (
      !state.playerOrder.includes(cashKey as (typeof state.playerOrder)[number])
    ) {
      throw new Error(
        `Game invariant failed: extra unknown player ${cashKey} in cash balances`,
      );
    }
  }

  // Recurring personal finance invariants
  if (
    state.finance.recurringByPlayer === undefined ||
    state.finance.recurringByPlayer === null ||
    typeof state.finance.recurringByPlayer !== "object"
  ) {
    throw new Error(
      "Game invariant failed: recurringByPlayer map is missing or invalid",
    );
  }

  const recurringPlayerIds = Object.keys(state.finance.recurringByPlayer);
  if (recurringPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Game invariant failed: recurringByPlayer must have exactly ${STANDARD_V1_PLAYER_COUNT} player records, got ${recurringPlayerIds.length}`,
    );
  }

  for (const playerId of state.playerOrder) {
    const recurring = state.finance.recurringByPlayer[playerId];
    if (recurring === undefined) {
      throw new Error(
        `Game invariant failed: player ${playerId} is missing a recurring finance record`,
      );
    }
    if (
      !Number.isSafeInteger(recurring.quarterlyIncomeCents) ||
      recurring.quarterlyIncomeCents < 0
    ) {
      throw new Error(
        `Game invariant failed: player ${playerId} quarterlyIncomeCents must be a non-negative safe integer of cents, got ${String(recurring.quarterlyIncomeCents)}`,
      );
    }
    if (
      !Number.isSafeInteger(recurring.quarterlyLivingExpenseCents) ||
      recurring.quarterlyLivingExpenseCents < 0
    ) {
      throw new Error(
        `Game invariant failed: player ${playerId} quarterlyLivingExpenseCents must be a non-negative safe integer of cents, got ${String(recurring.quarterlyLivingExpenseCents)}`,
      );
    }
  }

  for (const recurringKey of recurringPlayerIds) {
    if (
      !state.playerOrder.includes(
        recurringKey as (typeof state.playerOrder)[number],
      )
    ) {
      throw new Error(
        `Game invariant failed: extra unknown player ${recurringKey} in recurringByPlayer`,
      );
    }
  }

  // Loan registry invariants
  if (
    state.finance.loansById === undefined ||
    state.finance.loansById === null ||
    typeof state.finance.loansById !== "object"
  ) {
    throw new Error(
      "Game invariant failed: loansById map is missing or invalid",
    );
  }

  for (const [loanKey, loan] of Object.entries(state.finance.loansById)) {
    if (loan === undefined || loan === null || typeof loan !== "object") {
      throw new Error(`Game invariant failed: loan ${loanKey} is invalid`);
    }
    if (loanKey !== loan.id) {
      throw new Error(
        `Game invariant failed: loan key ${loanKey} does not match loan.id ${loan.id}`,
      );
    }

    if (loan.kind === "player-loan") {
      if (!state.playerOrder.includes(loan.lenderPlayerId)) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} has unknown lender ${loan.lenderPlayerId}`,
        );
      }
      if (!state.playerOrder.includes(loan.borrowerPlayerId)) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} has unknown borrower ${loan.borrowerPlayerId}`,
        );
      }
      if (loan.lenderPlayerId === loan.borrowerPlayerId) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} has same lender and borrower`,
        );
      }
      if (
        !Number.isSafeInteger(loan.originalPrincipalCents) ||
        loan.originalPrincipalCents <= 0
      ) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} originalPrincipalCents must be a positive safe integer`,
        );
      }
      if (
        !Number.isSafeInteger(loan.outstandingPrincipalCents) ||
        loan.outstandingPrincipalCents < 0
      ) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} outstandingPrincipalCents must be a non-negative safe integer`,
        );
      }
      if (loan.outstandingPrincipalCents > loan.originalPrincipalCents) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} outstandingPrincipalCents exceeds originalPrincipalCents`,
        );
      }
      if (!Number.isSafeInteger(loan.annualRateBps) || loan.annualRateBps < 0) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} annualRateBps must be a non-negative safe integer`,
        );
      }
      if (
        !Number.isSafeInteger(loan.termQuarters) ||
        loan.termQuarters < PLAYER_LOAN_MIN_TERM_QUARTERS ||
        loan.termQuarters > PLAYER_LOAN_MAX_TERM_QUARTERS
      ) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} termQuarters must be between ${PLAYER_LOAN_MIN_TERM_QUARTERS} and ${PLAYER_LOAN_MAX_TERM_QUARTERS}`,
        );
      }
      if (
        !Number.isSafeInteger(loan.installmentsPaid) ||
        loan.installmentsPaid < 0 ||
        loan.installmentsPaid > loan.termQuarters
      ) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} installmentsPaid must be an integer between 0 and termQuarters`,
        );
      }
      if (
        !Number.isSafeInteger(loan.originatedQuarter) ||
        loan.originatedQuarter <= 0 ||
        loan.originatedQuarter > state.currentQuarter
      ) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} originatedQuarter must be a positive safe integer <= currentQuarter (${state.currentQuarter}), got ${String(loan.originatedQuarter)}`,
        );
      }

      // Schedule consistency
      let schedule: ReturnType<typeof calculatePlayerLoanSchedule>;
      try {
        schedule = calculatePlayerLoanSchedule({
          principalCents: loan.originalPrincipalCents,
          annualRateBps: loan.annualRateBps,
          termQuarters: loan.termQuarters,
        });
      } catch (err) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} schedule is invalid: ${String(err)}`,
        );
      }

      const prevRow =
        loan.installmentsPaid > 0
          ? schedule[loan.installmentsPaid - 1]
          : undefined;

      if (loan.installmentsPaid > 0 && prevRow === undefined) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} schedule has no row for installment ${loan.installmentsPaid}`,
        );
      }

      const expectedRemaining =
        loan.installmentsPaid === 0
          ? loan.originalPrincipalCents
          : (prevRow?.closingPrincipalCents ?? -1);

      if (loan.outstandingPrincipalCents !== expectedRemaining) {
        throw new Error(
          `Game invariant failed: loan ${loan.id} outstanding principal ${loan.outstandingPrincipalCents} does not match expected remaining principal ${expectedRemaining} for installmentsPaid ${loan.installmentsPaid}`,
        );
      }

      if (
        loan.installmentsPaid === loan.termQuarters &&
        loan.outstandingPrincipalCents !== 0
      ) {
        throw new Error(
          `Game invariant failed: completed loan ${loan.id} must have zero outstanding principal`,
        );
      }
    } else if (loan.kind === "legacy-bank-loan") {
      if (!state.playerOrder.includes(loan.borrowerPlayerId)) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} has unknown borrower ${loan.borrowerPlayerId}`,
        );
      }
      if (
        loan.purpose !== "personal-debt" &&
        loan.purpose !== "property-mortgage"
      ) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} has unsupported purpose ${String(loan.purpose)}`,
        );
      }
      if (
        !Number.isSafeInteger(loan.originalPrincipalCents) ||
        loan.originalPrincipalCents <= 0
      ) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} originalPrincipalCents must be a positive safe integer`,
        );
      }
      if (
        !Number.isSafeInteger(loan.outstandingPrincipalCents) ||
        loan.outstandingPrincipalCents < 0
      ) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} outstandingPrincipalCents must be a non-negative safe integer`,
        );
      }
      if (loan.outstandingPrincipalCents > loan.originalPrincipalCents) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} outstandingPrincipalCents exceeds originalPrincipalCents`,
        );
      }
      if (!Number.isSafeInteger(loan.annualRateBps) || loan.annualRateBps < 0) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} annualRateBps must be a non-negative safe integer`,
        );
      }
      if (
        !Number.isSafeInteger(loan.scheduledQuarterlyPaymentCents) ||
        loan.scheduledQuarterlyPaymentCents <= 0
      ) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} scheduledQuarterlyPaymentCents must be a positive safe integer`,
        );
      }
      if (
        !Number.isSafeInteger(loan.paymentsApplied) ||
        loan.paymentsApplied < 0
      ) {
        throw new Error(
          `Game invariant failed: legacy bank loan ${loan.id} paymentsApplied must be a non-negative safe integer`,
        );
      }
      if (
        loan.purpose === "personal-debt" &&
        loan.relatedAssetId !== undefined
      ) {
        throw new Error(
          `Game invariant failed: personal-debt loan ${loan.id} must not carry a relatedAssetId`,
        );
      }
      if (loan.purpose === "property-mortgage") {
        if (loan.relatedAssetId === undefined) {
          throw new Error(
            `Game invariant failed: property-mortgage loan ${loan.id} must carry a relatedAssetId`,
          );
        }
        const relatedAsset = state.finance.assetsById[loan.relatedAssetId];
        if (relatedAsset === undefined || relatedAsset.kind !== "property") {
          throw new Error(
            `Game invariant failed: property-mortgage loan ${loan.id} refers to non-property asset ${loan.relatedAssetId}`,
          );
        }
      }
      if (loan.outstandingPrincipalCents > 0) {
        try {
          calculateLegacyBankLoanNextPayment({
            outstandingPrincipalCents: loan.outstandingPrincipalCents,
            annualRateBps: loan.annualRateBps,
            scheduledQuarterlyPaymentCents: loan.scheduledQuarterlyPaymentCents,
          });
        } catch (err) {
          throw new Error(
            `Game invariant failed: legacy bank loan ${loan.id} next payment calculation failed: ${String(err)}`,
          );
        }
      }
    } else {
      throw new Error(
        `Game invariant failed: loan ${loanKey} has unsupported kind ${(loan as { kind?: unknown }).kind}`,
      );
    }
  }

  // Asset registry invariants
  if (
    state.finance.assetsById === undefined ||
    state.finance.assetsById === null ||
    typeof state.finance.assetsById !== "object"
  ) {
    throw new Error(
      "Game invariant failed: assetsById map is missing or invalid",
    );
  }

  for (const [assetKey, asset] of Object.entries(state.finance.assetsById)) {
    if (asset === undefined || asset === null || typeof asset !== "object") {
      throw new Error(`Game invariant failed: asset ${assetKey} is invalid`);
    }
    if (assetKey !== asset.id) {
      throw new Error(
        `Game invariant failed: asset key ${assetKey} does not match asset.id ${asset.id}`,
      );
    }
    const rawAsset = asset as { kind?: unknown };
    if (rawAsset.kind !== "property" && rawAsset.kind !== "business") {
      throw new Error(
        `Game invariant failed: asset ${assetKey} has unsupported kind ${String(rawAsset.kind)}`,
      );
    }

    // Ownership map invariants
    if (
      asset.ownershipByPlayerPpm === undefined ||
      asset.ownershipByPlayerPpm === null ||
      typeof asset.ownershipByPlayerPpm !== "object"
    ) {
      throw new Error(
        `Game invariant failed: asset ${asset.id} ownershipByPlayerPpm is missing or invalid`,
      );
    }

    const ownerIds = Object.keys(asset.ownershipByPlayerPpm);
    if (ownerIds.length === 0) {
      throw new Error(
        `Game invariant failed: asset ${asset.id} must have at least one owner`,
      );
    }

    let totalOwnershipPpm = 0;
    for (const ownerId of ownerIds) {
      if (
        !state.playerOrder.includes(
          ownerId as (typeof state.playerOrder)[number],
        )
      ) {
        throw new Error(
          `Game invariant failed: asset ${asset.id} has unknown owner ${ownerId}`,
        );
      }
      const ppm =
        asset.ownershipByPlayerPpm[
          ownerId as (typeof state.playerOrder)[number]
        ];
      if (
        ppm === undefined ||
        !Number.isSafeInteger(ppm) ||
        ppm <= 0 ||
        ppm > TOTAL_OWNERSHIP_PPM
      ) {
        throw new Error(
          `Game invariant failed: asset ${asset.id} owner ${ownerId} has invalid ownership PPM: ${String(ppm)}`,
        );
      }
      totalOwnershipPpm += ppm;
    }

    if (totalOwnershipPpm !== TOTAL_OWNERSHIP_PPM) {
      throw new Error(
        `Game invariant failed: asset ${asset.id} total ownership PPM must equal ${TOTAL_OWNERSHIP_PPM}, got ${totalOwnershipPpm}`,
      );
    }

    if (asset.kind === "property") {
      if (
        !Number.isSafeInteger(asset.marketValueCents) ||
        asset.marketValueCents < 0
      ) {
        throw new Error(
          `Game invariant failed: property ${asset.id} marketValueCents must be non-negative safe integer cents`,
        );
      }
      if (
        !Number.isSafeInteger(asset.scheduledQuarterlyRentCents) ||
        asset.scheduledQuarterlyRentCents < 0
      ) {
        throw new Error(
          `Game invariant failed: property ${asset.id} scheduledQuarterlyRentCents must be non-negative safe integer cents`,
        );
      }
      if (
        !Number.isSafeInteger(asset.occupancyBps) ||
        asset.occupancyBps < 0 ||
        asset.occupancyBps > 10_000
      ) {
        throw new Error(
          `Game invariant failed: property ${asset.id} occupancyBps must be an integer between 0 and 10000`,
        );
      }
      if (
        !Number.isSafeInteger(asset.operatingExpenseRatioBps) ||
        asset.operatingExpenseRatioBps < 0 ||
        asset.operatingExpenseRatioBps > 10_000
      ) {
        throw new Error(
          `Game invariant failed: property ${asset.id} operatingExpenseRatioBps must be an integer between 0 and 10000`,
        );
      }
      try {
        calculatePropertyCashFlow(asset);
      } catch (err) {
        throw new Error(
          `Game invariant failed: property ${asset.id} calculation failed: ${String(err)}`,
        );
      }
    } else if (asset.kind === "business") {
      if (
        !Number.isSafeInteger(asset.annualRevenueCents) ||
        asset.annualRevenueCents < 0
      ) {
        throw new Error(
          `Game invariant failed: business ${asset.id} annualRevenueCents must be non-negative safe integer cents`,
        );
      }
      if (
        !Number.isSafeInteger(asset.annualOperatingProfitCents) ||
        asset.annualOperatingProfitCents < 0
      ) {
        throw new Error(
          `Game invariant failed: business ${asset.id} annualOperatingProfitCents must be non-negative safe integer cents`,
        );
      }
      if (
        !Number.isSafeInteger(asset.enterpriseValueCents) ||
        asset.enterpriseValueCents < 0
      ) {
        throw new Error(
          `Game invariant failed: business ${asset.id} enterpriseValueCents must be non-negative safe integer cents`,
        );
      }
      if (
        !Number.isSafeInteger(asset.debtPrincipalCents) ||
        asset.debtPrincipalCents < 0
      ) {
        throw new Error(
          `Game invariant failed: business ${asset.id} debtPrincipalCents must be non-negative safe integer cents`,
        );
      }
      try {
        calculateBusinessEquity(asset);
      } catch (err) {
        throw new Error(
          `Game invariant failed: business ${asset.id} calculation failed: ${String(err)}`,
        );
      }
    }
  }

  // Public-market current portfolios invariants
  if (
    state.finance.publicMarketsByPlayer === undefined ||
    state.finance.publicMarketsByPlayer === null ||
    typeof state.finance.publicMarketsByPlayer !== "object"
  ) {
    throw new Error(
      "Game invariant failed: publicMarketsByPlayer map is missing or invalid",
    );
  }

  const marketPlayerIds = Object.keys(state.finance.publicMarketsByPlayer);
  if (marketPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Game invariant failed: publicMarketsByPlayer must have exactly ${STANDARD_V1_PLAYER_COUNT} player portfolios, got ${marketPlayerIds.length}`,
    );
  }

  for (const playerId of state.playerOrder) {
    const portfolio = state.finance.publicMarketsByPlayer[playerId];
    if (
      portfolio === undefined ||
      portfolio === null ||
      typeof portfolio !== "object"
    ) {
      throw new Error(
        `Game invariant failed: player ${playerId} is missing a public-market portfolio`,
      );
    }
    const instrumentKeys = Object.keys(portfolio);
    if (instrumentKeys.length !== PUBLIC_MARKET_INSTRUMENT_IDS.length) {
      throw new Error(
        `Game invariant failed: player ${playerId} portfolio must have exactly ${PUBLIC_MARKET_INSTRUMENT_IDS.length} instruments, got ${instrumentKeys.length}`,
      );
    }
    for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
      const value = portfolio[instrumentId];
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(
          `Game invariant failed: player ${playerId} portfolio ${instrumentId} must be a non-negative safe integer of cents, got ${String(value)}`,
        );
      }
    }
    try {
      totalPublicMarketValueCents(portfolio);
    } catch (err) {
      throw new Error(
        `Game invariant failed: player ${playerId} portfolio sum failed: ${String(err)}`,
      );
    }
  }

  for (const marketKey of marketPlayerIds) {
    if (
      !state.playerOrder.includes(
        marketKey as (typeof state.playerOrder)[number],
      )
    ) {
      throw new Error(
        `Game invariant failed: extra unknown player ${marketKey} in publicMarketsByPlayer`,
      );
    }
  }

  // Quarter-start finance basis invariants
  const basis = state.finance.quarterStartBasis;
  if (basis === undefined || basis === null || typeof basis !== "object") {
    throw new Error(
      "Game invariant failed: quarterStartBasis is missing or invalid",
    );
  }

  if (!Number.isSafeInteger(basis.quarter) || basis.quarter <= 0) {
    throw new Error(
      `Game invariant failed: quarterStartBasis.quarter must be a positive safe integer, got ${String(basis.quarter)}`,
    );
  }

  if (basis.quarter !== state.currentQuarter) {
    throw new Error(
      `Game invariant failed: quarterStartBasis.quarter (${basis.quarter}) must equal currentQuarter (${state.currentQuarter})`,
    );
  }

  if (
    basis.cashByPlayer === undefined ||
    basis.cashByPlayer === null ||
    typeof basis.cashByPlayer !== "object"
  ) {
    throw new Error(
      "Game invariant failed: quarterStartBasis.cashByPlayer is missing or invalid",
    );
  }

  const basisCashPlayerIds = Object.keys(basis.cashByPlayer);
  if (basisCashPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Game invariant failed: quarterStartBasis.cashByPlayer must have exactly ${STANDARD_V1_PLAYER_COUNT} player balances, got ${basisCashPlayerIds.length}`,
    );
  }

  for (const playerId of state.playerOrder) {
    const basisCash = basis.cashByPlayer[playerId];
    if (basisCash === undefined) {
      throw new Error(
        `Game invariant failed: player ${playerId} is missing in quarterStartBasis.cashByPlayer`,
      );
    }
    if (!Number.isSafeInteger(basisCash) || basisCash < 0) {
      throw new Error(
        `Game invariant failed: player ${playerId} basis cash must be a non-negative safe integer of cents, got ${String(basisCash)}`,
      );
    }
  }

  for (const key of basisCashPlayerIds) {
    if (
      !state.playerOrder.includes(key as (typeof state.playerOrder)[number])
    ) {
      throw new Error(
        `Game invariant failed: extra unknown player ${key} in quarterStartBasis.cashByPlayer`,
      );
    }
  }

  if (
    basis.publicMarketsByPlayer === undefined ||
    basis.publicMarketsByPlayer === null ||
    typeof basis.publicMarketsByPlayer !== "object"
  ) {
    throw new Error(
      "Game invariant failed: quarterStartBasis.publicMarketsByPlayer is missing or invalid",
    );
  }

  const basisMarketPlayerIds = Object.keys(basis.publicMarketsByPlayer);
  if (basisMarketPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
    throw new Error(
      `Game invariant failed: quarterStartBasis.publicMarketsByPlayer must have exactly ${STANDARD_V1_PLAYER_COUNT} player portfolios, got ${basisMarketPlayerIds.length}`,
    );
  }

  for (const playerId of state.playerOrder) {
    const basisPortfolio = basis.publicMarketsByPlayer[playerId];
    if (
      basisPortfolio === undefined ||
      basisPortfolio === null ||
      typeof basisPortfolio !== "object"
    ) {
      throw new Error(
        `Game invariant failed: player ${playerId} is missing in quarterStartBasis.publicMarketsByPlayer`,
      );
    }
    const basisKeys = Object.keys(basisPortfolio);
    if (basisKeys.length !== PUBLIC_MARKET_INSTRUMENT_IDS.length) {
      throw new Error(
        `Game invariant failed: player ${playerId} basis portfolio must have exactly ${PUBLIC_MARKET_INSTRUMENT_IDS.length} instruments, got ${basisKeys.length}`,
      );
    }
    for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
      const val = basisPortfolio[instrumentId];
      if (!Number.isSafeInteger(val) || val < 0) {
        throw new Error(
          `Game invariant failed: player ${playerId} basis portfolio ${instrumentId} must be a non-negative safe integer of cents, got ${String(val)}`,
        );
      }
    }
    try {
      totalPublicMarketValueCents(basisPortfolio);
    } catch (err) {
      throw new Error(
        `Game invariant failed: player ${playerId} basis portfolio sum failed: ${String(err)}`,
      );
    }
  }

  for (const key of basisMarketPlayerIds) {
    if (
      !state.playerOrder.includes(key as (typeof state.playerOrder)[number])
    ) {
      throw new Error(
        `Game invariant failed: extra unknown player ${key} in quarterStartBasis.publicMarketsByPlayer`,
      );
    }
  }

  assertEconomyState(state);
  assertOpportunitiesState(state);
}

function assertEconomyState(state: GameState): void {
  const economy = state.economy;
  if (
    economy === undefined ||
    economy === null ||
    typeof economy !== "object"
  ) {
    throw new Error(
      "Game invariant failed: economy state is missing or invalid",
    );
  }

  if (!isEconomicRegimeId(economy.currentRegime)) {
    throw new Error(
      `Game invariant failed: currentRegime is invalid: ${String(economy.currentRegime)}`,
    );
  }

  if (!Number.isSafeInteger(economy.baseRateBps) || economy.baseRateBps < 0) {
    throw new Error(
      `Game invariant failed: baseRateBps must be a non-negative safe integer, got ${String(economy.baseRateBps)}`,
    );
  }

  if (economy.baseRateBps !== STANDARD_V1_OPENING_BASE_RATE_BPS) {
    throw new Error(
      `Game invariant failed: baseRateBps must equal ${STANDARD_V1_OPENING_BASE_RATE_BPS} in this slice, got ${economy.baseRateBps}`,
    );
  }

  if (state.lastSettledQuarter === 0) {
    if (economy.lastMarketUpdate !== null) {
      throw new Error(
        "Game invariant failed: lastMarketUpdate must be null before any quarter has settled",
      );
    }
  } else {
    if (economy.lastMarketUpdate === null) {
      throw new Error(
        `Game invariant failed: lastMarketUpdate must be present after quarter ${state.lastSettledQuarter} has settled`,
      );
    }
    const update = economy.lastMarketUpdate;
    if (
      !Number.isSafeInteger(update.quarter) ||
      update.quarter <= 0 ||
      update.quarter > state.lastSettledQuarter
    ) {
      throw new Error(
        `Game invariant failed: lastMarketUpdate.quarter must be a positive safe integer <= lastSettledQuarter (${state.lastSettledQuarter}), got ${String(update.quarter)}`,
      );
    }
    if (update.quarter !== state.lastSettledQuarter) {
      throw new Error(
        `Game invariant failed: lastMarketUpdate.quarter (${update.quarter}) must equal lastSettledQuarter (${state.lastSettledQuarter}) for settled match`,
      );
    }
    if (!isEconomicRegimeId(update.regimeUsed)) {
      throw new Error(
        `Game invariant failed: lastMarketUpdate.regimeUsed is invalid: ${String(update.regimeUsed)}`,
      );
    }
    const returnKeys = Object.keys(update.returnBpsByInstrument);
    if (returnKeys.length !== PUBLIC_MARKET_INSTRUMENT_IDS.length) {
      throw new Error(
        `Game invariant failed: lastMarketUpdate.returnBpsByInstrument must have exactly ${PUBLIC_MARKET_INSTRUMENT_IDS.length} instruments, got ${returnKeys.length}`,
      );
    }
    for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
      const ret = update.returnBpsByInstrument[instrumentId];
      if (!Number.isSafeInteger(ret)) {
        throw new Error(
          `Game invariant failed: return for ${instrumentId} in lastMarketUpdate must be a safe integer of basis points, got ${String(ret)}`,
        );
      }
    }
    for (const key of returnKeys) {
      if (
        !PUBLIC_MARKET_INSTRUMENT_IDS.includes(
          key as (typeof PUBLIC_MARKET_INSTRUMENT_IDS)[number],
        )
      ) {
        throw new Error(
          `Game invariant failed: unknown instrument ${key} in lastMarketUpdate.returnBpsByInstrument`,
        );
      }
    }
  }

  // Active transaction invariants
  if (state.activeTransaction !== null) {
    const tx = state.activeTransaction;
    if (!tx || typeof tx !== "object") {
      throw new Error(
        "Game invariant failed: activeTransaction must be an object or null",
      );
    }
    if (typeof tx.id !== "string" || tx.id.trim() === "") {
      throw new Error(
        "Game invariant failed: activeTransaction.id must be a non-empty string",
      );
    }
    if (tx.kind !== "cash-business-purchase") {
      throw new Error(
        `Game invariant failed: unrecognized activeTransaction kind ${String((tx as { kind: unknown }).kind)}`,
      );
    }
    if (state.phase !== "ready-for-first-round") {
      throw new Error(
        `Game invariant failed: active transaction present in unsupported phase ${state.phase}`,
      );
    }
    if (!state.players[tx.buyerPlayerId]) {
      throw new Error(
        `Game invariant failed: buyer player ${tx.buyerPlayerId} does not exist`,
      );
    }
    if (!state.players[tx.sellerPlayerId]) {
      throw new Error(
        `Game invariant failed: seller player ${tx.sellerPlayerId} does not exist`,
      );
    }
    if (tx.buyerPlayerId === tx.sellerPlayerId) {
      throw new Error(
        "Game invariant failed: buyer and seller must be distinct players",
      );
    }
    const asset = state.finance.assetsById[tx.assetId];
    if (!asset) {
      throw new Error(
        `Game invariant failed: active transaction asset ${tx.assetId} does not exist`,
      );
    }
    if (asset.kind !== "business") {
      throw new Error(
        `Game invariant failed: active transaction asset must be a business, got ${asset.kind}`,
      );
    }
    if (asset.debtPrincipalCents !== 0) {
      throw new Error(
        `Game invariant failed: active transaction business must be debt-free, got debt ${asset.debtPrincipalCents}`,
      );
    }
    if (
      !Number.isSafeInteger(tx.purchasePriceCents) ||
      tx.purchasePriceCents <= 0
    ) {
      throw new Error(
        "Game invariant failed: purchasePriceCents must be a positive safe integer",
      );
    }
    if (!tx.reservation || typeof tx.reservation !== "object") {
      throw new Error("Game invariant failed: reservation must be an object");
    }
    if (tx.reservation.purpose !== "purchase-price") {
      throw new Error(
        `Game invariant failed: reservation purpose must be purchase-price, got ${String(tx.reservation.purpose)}`,
      );
    }
    if (tx.reservation.playerId !== tx.buyerPlayerId) {
      throw new Error(
        `Game invariant failed: reservation playerId (${tx.reservation.playerId}) must match buyerPlayerId (${tx.buyerPlayerId})`,
      );
    }
    const buyerCash = state.finance.cashByPlayer[tx.buyerPlayerId];

    if (tx.playerLoanFinancing === undefined) {
      // Cash-only transaction
      if (
        !Number.isSafeInteger(tx.reservation.amountCents) ||
        tx.reservation.amountCents <= 0
      ) {
        throw new Error(
          "Game invariant failed: reservation amountCents must be a positive safe integer",
        );
      }
      if (tx.reservation.amountCents !== tx.purchasePriceCents) {
        throw new Error(
          `Game invariant failed: reservation amountCents (${tx.reservation.amountCents}) must equal purchasePriceCents (${tx.purchasePriceCents})`,
        );
      }
      if (buyerCash === undefined || buyerCash < tx.reservation.amountCents) {
        throw new Error(
          `Game invariant failed: buyer actual cash (${String(buyerCash)}) must be >= reservation amount (${tx.reservation.amountCents})`,
        );
      }
    } else {
      // Financed transaction
      const financing = tx.playerLoanFinancing;
      if (!financing || typeof financing !== "object") {
        throw new Error(
          "Game invariant failed: playerLoanFinancing must be an object",
        );
      }
      if (
        !Number.isSafeInteger(financing.requestedPrincipalCents) ||
        financing.requestedPrincipalCents <= 0
      ) {
        throw new Error(
          "Game invariant failed: requestedPrincipalCents must be a positive safe integer",
        );
      }
      if (
        !Number.isSafeInteger(tx.reservation.amountCents) ||
        tx.reservation.amountCents < 0
      ) {
        throw new Error(
          "Game invariant failed: financed buyer reservation amountCents must be a non-negative safe integer",
        );
      }
      if (
        tx.reservation.amountCents + financing.requestedPrincipalCents !==
        tx.purchasePriceCents
      ) {
        throw new Error(
          `Game invariant failed: buyer contribution (${tx.reservation.amountCents}) + requested principal (${financing.requestedPrincipalCents}) must equal purchase price (${tx.purchasePriceCents})`,
        );
      }
      if (buyerCash === undefined || buyerCash < tx.reservation.amountCents) {
        throw new Error(
          `Game invariant failed: buyer actual cash (${String(buyerCash)}) must be >= reservation amount (${tx.reservation.amountCents})`,
        );
      }

      if (financing.offer !== null) {
        const offer = financing.offer;
        if (!offer || typeof offer !== "object") {
          throw new Error(
            "Game invariant failed: financing offer must be an object",
          );
        }
        if (!state.playerOrder.includes(offer.lenderPlayerId)) {
          throw new Error(
            `Game invariant failed: offer lender ${offer.lenderPlayerId} is unknown`,
          );
        }
        if (offer.lenderPlayerId === tx.buyerPlayerId) {
          throw new Error(
            "Game invariant failed: offer lender must differ from buyer",
          );
        }
        if (offer.lenderPlayerId === tx.sellerPlayerId) {
          throw new Error(
            "Game invariant failed: offer lender must differ from seller",
          );
        }
        if (offer.principalCents !== financing.requestedPrincipalCents) {
          throw new Error(
            `Game invariant failed: offer principal (${offer.principalCents}) must equal requested principal (${financing.requestedPrincipalCents})`,
          );
        }
        if (
          !Number.isSafeInteger(offer.annualRateBps) ||
          offer.annualRateBps < 0
        ) {
          throw new Error(
            "Game invariant failed: offer annualRateBps must be a non-negative safe integer",
          );
        }
        if (
          !Number.isSafeInteger(offer.termQuarters) ||
          offer.termQuarters < PLAYER_LOAN_MIN_TERM_QUARTERS ||
          offer.termQuarters > PLAYER_LOAN_MAX_TERM_QUARTERS
        ) {
          throw new Error(
            `Game invariant failed: offer termQuarters must be between ${PLAYER_LOAN_MIN_TERM_QUARTERS} and ${PLAYER_LOAN_MAX_TERM_QUARTERS}`,
          );
        }
        if (
          !Number.isSafeInteger(offer.termsRevision) ||
          offer.termsRevision <= 0
        ) {
          throw new Error(
            "Game invariant failed: offer termsRevision must be a positive safe integer",
          );
        }
        if (offer.status !== "offered" && offer.status !== "accepted") {
          throw new Error(
            `Game invariant failed: unrecognized offer status ${String(offer.status)}`,
          );
        }
        if (!offer.reservation || typeof offer.reservation !== "object") {
          throw new Error(
            "Game invariant failed: offer reservation must be an object",
          );
        }
        if (offer.reservation.playerId !== offer.lenderPlayerId) {
          throw new Error(
            `Game invariant failed: offer reservation playerId (${offer.reservation.playerId}) must match lenderPlayerId (${offer.lenderPlayerId})`,
          );
        }
        if (offer.reservation.purpose !== "player-loan-funding") {
          throw new Error(
            `Game invariant failed: offer reservation purpose must be player-loan-funding, got ${String(offer.reservation.purpose)}`,
          );
        }
        if (offer.reservation.amountCents !== offer.principalCents) {
          throw new Error(
            `Game invariant failed: offer reservation amountCents (${offer.reservation.amountCents}) must match offer principal (${offer.principalCents})`,
          );
        }
        const lenderCash = state.finance.cashByPlayer[offer.lenderPlayerId];
        if (
          lenderCash === undefined ||
          lenderCash < offer.reservation.amountCents
        ) {
          throw new Error(
            `Game invariant failed: lender actual cash (${String(lenderCash)}) must be >= offer reservation amount (${offer.reservation.amountCents})`,
          );
        }
        try {
          calculatePlayerLoanSchedule({
            principalCents: offer.principalCents,
            annualRateBps: offer.annualRateBps,
            termQuarters: offer.termQuarters,
          });
        } catch (err) {
          throw new Error(
            `Game invariant failed: financing offer schedule is invalid: ${String(err)}`,
          );
        }
      }
    }
    const sellerOwnership = asset.ownershipByPlayerPpm[tx.sellerPlayerId];
    if (sellerOwnership !== TOTAL_OWNERSHIP_PPM) {
      throw new Error(
        `Game invariant failed: seller must own exactly ${TOTAL_OWNERSHIP_PPM} PPM, got ${String(sellerOwnership)}`,
      );
    }
    if (Object.keys(asset.ownershipByPlayerPpm).length !== 1) {
      throw new Error(
        "Game invariant failed: seller must be the sole owner of the business",
      );
    }
    if (!Number.isSafeInteger(tx.createdQuarter) || tx.createdQuarter <= 0) {
      throw new Error(
        `Game invariant failed: createdQuarter must be a positive safe integer, got ${String(tx.createdQuarter)}`,
      );
    }
  }
}

function assertOpportunitiesState(state: GameState): void {
  if (
    state.opportunitiesById === undefined ||
    state.opportunitiesById === null ||
    typeof state.opportunitiesById !== "object"
  ) {
    throw new Error(
      "Game invariant failed: opportunitiesById map is missing or invalid",
    );
  }

  for (const [opportunityKey, opportunity] of Object.entries(
    state.opportunitiesById,
  )) {
    if (
      opportunity === undefined ||
      opportunity === null ||
      typeof opportunity !== "object"
    ) {
      throw new Error(
        `Game invariant failed: opportunity ${opportunityKey} is invalid`,
      );
    }
    if (opportunityKey !== opportunity.id) {
      throw new Error(
        `Game invariant failed: opportunity key ${opportunityKey} does not match opportunity.id ${opportunity.id}`,
      );
    }
    if (typeof opportunity.id !== "string" || opportunity.id.trim() === "") {
      throw new Error(
        "Game invariant failed: opportunity.id must be a non-empty string",
      );
    }
    if (opportunity.kind !== "private-business-purchase") {
      throw new Error(
        `Game invariant failed: unrecognized opportunity kind ${String((opportunity as { kind: unknown }).kind)}`,
      );
    }
    if (opportunity.access !== "private") {
      throw new Error(
        `Game invariant failed: opportunity access must be private, got ${String(opportunity.access)}`,
      );
    }
    if (!state.players[opportunity.targetPlayerId]) {
      throw new Error(
        `Game invariant failed: target player ${opportunity.targetPlayerId} does not exist`,
      );
    }
    if (!state.players[opportunity.sellerPlayerId]) {
      throw new Error(
        `Game invariant failed: seller player ${opportunity.sellerPlayerId} does not exist`,
      );
    }
    if (opportunity.targetPlayerId === opportunity.sellerPlayerId) {
      throw new Error(
        "Game invariant failed: target and seller must be distinct players",
      );
    }
    const asset = state.finance.assetsById[opportunity.assetId];
    if (!asset) {
      throw new Error(
        `Game invariant failed: referenced asset ${opportunity.assetId} does not exist`,
      );
    }
    if (asset.kind !== "business") {
      throw new Error(
        `Game invariant failed: referenced asset must be a business, got ${asset.kind}`,
      );
    }
    if (
      !Number.isSafeInteger(opportunity.askingPriceCents) ||
      opportunity.askingPriceCents <= 0
    ) {
      throw new Error(
        "Game invariant failed: askingPriceCents must be a positive safe integer",
      );
    }
    if (
      !Number.isSafeInteger(opportunity.createdQuarter) ||
      opportunity.createdQuarter <= 0 ||
      opportunity.createdQuarter > state.currentQuarter
    ) {
      throw new Error(
        `Game invariant failed: createdQuarter must be a positive safe integer <= currentQuarter (${state.currentQuarter}), got ${String(opportunity.createdQuarter)}`,
      );
    }
    if (
      !opportunity.investigation ||
      typeof opportunity.investigation !== "object"
    ) {
      throw new Error(
        "Game invariant failed: opportunity.investigation must be an object",
      );
    }
    if (typeof opportunity.investigation.investigated !== "boolean") {
      throw new Error(
        "Game invariant failed: opportunity.investigation.investigated must be a boolean",
      );
    }
    const facts = opportunity.investigation.facts;
    if (!facts || typeof facts !== "object") {
      throw new Error(
        "Game invariant failed: opportunity.investigation.facts must be an object",
      );
    }
    if (
      !Number.isSafeInteger(facts.annualRevenueCents) ||
      facts.annualRevenueCents < 0
    ) {
      throw new Error(
        `Game invariant failed: diligence annualRevenueCents must be a non-negative safe integer, got ${String(facts.annualRevenueCents)}`,
      );
    }
    if (
      !Number.isSafeInteger(facts.annualOperatingProfitCents) ||
      facts.annualOperatingProfitCents < 0
    ) {
      throw new Error(
        `Game invariant failed: diligence annualOperatingProfitCents must be a non-negative safe integer, got ${String(facts.annualOperatingProfitCents)}`,
      );
    }
    if (
      !Number.isSafeInteger(facts.enterpriseValueCents) ||
      facts.enterpriseValueCents < 0
    ) {
      throw new Error(
        `Game invariant failed: diligence enterpriseValueCents must be a non-negative safe integer, got ${String(facts.enterpriseValueCents)}`,
      );
    }
    if (
      !Number.isSafeInteger(facts.debtPrincipalCents) ||
      facts.debtPrincipalCents < 0
    ) {
      throw new Error(
        `Game invariant failed: diligence debtPrincipalCents must be a non-negative safe integer, got ${String(facts.debtPrincipalCents)}`,
      );
    }
    if (
      opportunity.status !== "available" &&
      opportunity.status !== "pursued"
    ) {
      throw new Error(
        `Game invariant failed: unrecognized opportunity status ${String(opportunity.status)}`,
      );
    }
    if (opportunity.status === "available") {
      if (opportunity.relatedTransactionId !== undefined) {
        throw new Error(
          "Game invariant failed: available opportunity must not have relatedTransactionId",
        );
      }
    } else if (opportunity.status === "pursued") {
      if (
        typeof opportunity.relatedTransactionId !== "string" ||
        opportunity.relatedTransactionId.trim() === ""
      ) {
        throw new Error(
          "Game invariant failed: pursued opportunity must have a non-empty relatedTransactionId",
        );
      }
    }
  }
}
