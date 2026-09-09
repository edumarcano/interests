import type {
  CommandId,
  MatchId,
  PlayerId,
  RoomMemberId,
  TransactionId,
} from "./primitives/ids.js";

export interface ChooseObjectiveCommandPayload {
  readonly type: "CHOOSE_OBJECTIVE";
  readonly objectiveId: string;
}

export interface BeginRoundCommandPayload {
  readonly type: "BEGIN_ROUND";
}

export interface PassSpotlightCommandPayload {
  readonly type: "PASS_SPOTLIGHT";
}

export type PlayerCommand =
  | ChooseObjectiveCommandPayload
  | BeginRoundCommandPayload
  | PassSpotlightCommandPayload;

export interface PlayerCommandEnvelope {
  readonly commandId: CommandId | string;
  readonly expectedRevision: number;
  readonly command: PlayerCommand;
}

export interface MatchPlayerSummaryView {
  readonly playerId: PlayerId;
  readonly roomMemberId: RoomMemberId;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly isHost: boolean;
  readonly hasSelectedObjective: boolean;
}

export interface MatchProfileView {
  readonly id: string;
  readonly name: string;
  readonly startingCashCents?: number;
}

export interface MatchObjectiveOptionView {
  readonly id: string;
  readonly name: string;
  readonly family: string;
}

export interface MatchSelfView {
  readonly playerId: PlayerId;
  readonly profileId: string;
  readonly profile?: MatchProfileView;
  readonly offeredObjectiveIds: readonly [string, string];
  readonly offeredObjectives?: readonly [
    MatchObjectiveOptionView,
    MatchObjectiveOptionView,
  ];
  readonly selectedObjectiveId: string | null;
  readonly selectedObjective?: MatchObjectiveOptionView | null;
}

export interface ActiveTransactionSummaryView {
  readonly transactionId: TransactionId;
  readonly kind: string;
}

export interface MatchRoundView {
  readonly stage: "round-start" | "spotlight";
  readonly spotlightOrder: readonly PlayerId[];
  readonly activeSpotlightPlayerId: PlayerId | null;
  readonly spotlightsCompleted: number;
}

export interface MatchPlayerView {
  readonly matchId: MatchId;
  readonly modeId: string;
  readonly revision: number;
  readonly phase: string;
  readonly currentQuarter: number;
  readonly round: MatchRoundView | null;
  readonly players: readonly MatchPlayerSummaryView[];
  readonly self: MatchSelfView;
  readonly activeTransaction: ActiveTransactionSummaryView | null;
}

export interface CommandAckAccepted {
  readonly ok: true;
  readonly commandId: string;
  readonly outcome: "ACCEPTED";
  readonly revision: number;
}

export interface CommandAckRejected {
  readonly ok: false;
  readonly commandId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly revision: number;
}

export type CommandAckResult = CommandAckAccepted | CommandAckRejected;
