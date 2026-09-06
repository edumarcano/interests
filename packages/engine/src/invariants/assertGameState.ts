import {
  isObjectiveId,
  isPairValid,
  isProfileId,
  OBJECTIVE_IDS,
  PLAYER_LOAN_MAX_TERM_QUARTERS,
  PLAYER_LOAN_MIN_TERM_QUARTERS,
  STANDARD_V1_PLAYER_COUNT,
} from "@finance-game/rules";
import {
  calculateLegacyBankLoanNextPayment,
  calculatePlayerLoanSchedule,
} from "../finance/amortization";
import { calculateBusinessEquity } from "../finance/business";
import { TOTAL_OWNERSHIP_PPM } from "../finance/ownership";
import { calculatePropertyCashFlow } from "../finance/property";
import type { GameState } from "../model/gameState";
import { RNG_ALGORITHM } from "../random/prng";

export function assertGameState(state: GameState): void {
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new Error(
      "Game invariant failed: revision must be a non-negative safe integer",
    );
  }
  if (
    state.random.algorithm !== RNG_ALGORITHM ||
    !Number.isInteger(state.random.state)
  ) {
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
}
