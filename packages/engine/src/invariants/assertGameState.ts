import {
  isObjectiveId,
  isPairValid,
  isProfileId,
  OBJECTIVE_IDS,
  STANDARD_V1_PLAYER_COUNT,
} from "@finance-game/rules";
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
}
