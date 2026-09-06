import type { ObjectiveId, ProfileId } from "@finance-game/rules";
import type { AssetId, GameId, LoanId, PlayerId } from "@finance-game/shared";

import type { BasisPoints, Cents } from "../finance/money";
import type { OwnershipPpm } from "../finance/ownership";
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

export interface PropertyAsset {
  readonly id: AssetId;
  readonly kind: "property";
  readonly marketValueCents: Cents;
  readonly scheduledQuarterlyRentCents: Cents;
  readonly occupancyBps: BasisPoints;
  readonly operatingExpenseRatioBps: BasisPoints;
  readonly ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>;
}

export interface BusinessAsset {
  readonly id: AssetId;
  readonly kind: "business";
  readonly annualRevenueCents: Cents;
  readonly annualOperatingProfitCents: Cents;
  readonly enterpriseValueCents: Cents;
  readonly ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>;
}

export type Asset = PropertyAsset | BusinessAsset;

export interface FinanceState {
  readonly cashByPlayer: Readonly<Record<PlayerId, Cents>>;
  readonly loansById: Readonly<Record<LoanId, PlayerLoan>>;
  readonly assetsById: Readonly<Record<AssetId, Asset>>;
}

export interface DeterministicCounters {
  readonly asset: number;
  readonly contract: number;
  readonly loan: number;
  readonly opportunity: number;
  readonly journal: number;
  readonly settlement: number;
}

export interface GameState {
  readonly gameId: GameId;
  readonly modeId: "standard-v1";
  readonly revision: number;
  readonly phase: GamePhase;
  readonly currentQuarter: number;
  readonly lastSettledQuarter: number;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly finance: FinanceState;
  readonly random: RandomState;
  readonly counters: DeterministicCounters;
}
