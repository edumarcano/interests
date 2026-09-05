import type { ObjectiveId, ProfileId } from "@finance-game/rules";
import type { GameId, LoanId, PlayerId } from "@finance-game/shared";

import type { BasisPoints, Cents } from "../finance/money";
import type { RandomState } from "../random/prng";

export type GamePhase = "objective-choosing" | "ready-for-first-round";

export interface PlayerState {
  readonly id: PlayerId;
  readonly profileId: ProfileId;
  readonly offeredObjectiveIds: readonly [ObjectiveId, ObjectiveId];
  readonly selectedObjectiveId: ObjectiveId | null;
}

export interface PlayerLoan {
  readonly id: LoanId;
  readonly kind: "player-loan";
  readonly lenderPlayerId: PlayerId;
  readonly borrowerPlayerId: PlayerId;
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly termQuarters: number;
  readonly installmentsPaid: number;
}

export interface FinanceState {
  readonly cashByPlayer: Readonly<Record<PlayerId, Cents>>;
  readonly loansById: Readonly<Record<LoanId, PlayerLoan>>;
}

export interface DeterministicCounters {
  readonly asset: number;
  readonly contract: number;
  readonly loan: number;
  readonly opportunity: number;
  readonly journal: number;
}

export interface GameState {
  readonly gameId: GameId;
  readonly modeId: "standard-v1";
  readonly revision: number;
  readonly phase: GamePhase;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly finance: FinanceState;
  readonly random: RandomState;
  readonly counters: DeterministicCounters;
}
