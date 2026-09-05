import { PROFILES, STANDARD_V1_PLAYER_COUNT } from "@finance-game/rules";
import { asGameId, type PlayerId } from "@finance-game/shared";
import { type Cents, cents } from "../finance/money";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState, PlayerState } from "../model/gameState";
import { createRandomState } from "../random/prng";
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
  }

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
      loansById: {},
      assetsById: {},
    },
    random: setup.random,
    counters: {
      asset: 0,
      contract: 0,
      loan: 0,
      opportunity: 0,
      journal: 0,
      settlement: 0,
    },
  };

  assertGameState(state);
  return state;
}
