import type { GameState } from "@interests/engine";
import type {
  MatchId,
  PlayerId,
  RoomId,
  RoomMemberId,
} from "@interests/shared";
import type { MatchVersionMetadata } from "./versions.js";

export type MatchStatus = "ACTIVE" | "FINISHED" | "ABANDONED";

export interface MatchRecord {
  readonly id: MatchId;
  readonly roomId: RoomId;
  readonly status: MatchStatus;
  readonly modeId: string;
  readonly revision: number;
  readonly initializationJson: string;
  readonly initialSnapshotJson: string;
  readonly snapshotJson: string;
  readonly engineVersion: string;
  readonly rulesVersion: string;
  readonly sharedVersion: string;
  readonly persistenceFormatVersion: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MatchMemberRecord {
  readonly matchId: MatchId;
  readonly roomMemberId: RoomMemberId;
  readonly playerId: PlayerId;
  readonly playerOrder: number;
}

export interface MatchInitializationManifest {
  readonly setupScenario?: "standard-v1" | "q1-business-diagnostic";
  readonly gameId: string;
  readonly modeId: string;
  readonly seed: string;
  readonly orderedPlayerIds: readonly string[];
}

export type CommandOutcome = "ACCEPTED" | "REJECTED";

export interface CommandReceiptRecord {
  readonly matchId: MatchId;
  readonly actorPlayerId: PlayerId;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly outcome: CommandOutcome;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly resultingRevision: number;
  readonly acceptedSequence: number | null;
  readonly createdAt: string;
}

export interface AcceptedCommandRecord {
  readonly matchId: MatchId;
  readonly sequence: number;
  readonly actorPlayerId: PlayerId;
  readonly commandId: string;
  readonly commandType: string;
  readonly payloadJson: string;
  readonly payloadHash: string;
  readonly previousRevision: number;
  readonly resultingRevision: number;
  readonly acceptedAt: string;
}

export interface MatchWithMembers {
  readonly match: MatchRecord;
  readonly members: readonly MatchMemberRecord[];
}

export interface CreateMatchInput {
  readonly matchId: MatchId;
  readonly roomId: RoomId;
  readonly modeId: string;
  readonly initializationManifest: MatchInitializationManifest;
  readonly initialSnapshot: GameState;
  readonly memberMappings: readonly {
    readonly roomMemberId: RoomMemberId;
    readonly playerId: PlayerId;
    readonly playerOrder: number;
  }[];
  readonly versions: MatchVersionMetadata;
}

export interface CommitAcceptedCommandInput {
  readonly matchId: MatchId;
  readonly expectedPreviousRevision: number;
  readonly nextRevision: number;
  readonly nextState: GameState;
  readonly actorPlayerId: PlayerId;
  readonly commandId: string;
  readonly commandType: string;
  readonly payloadJson: string;
  readonly payloadHash: string;
  readonly events?: readonly {
    readonly eventKind: string;
    readonly payloadJson: string;
  }[];
}

export interface RecordRejectedReceiptInput {
  readonly matchId: MatchId;
  readonly actorPlayerId: PlayerId;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly errorCode: string;
  readonly errorMessage?: string;
  readonly resultingRevision: number;
}

export interface MatchRoomMember {
  readonly id: RoomMemberId;
  readonly roomId: RoomId;
  readonly nickname: string;
  readonly nicknameKey: string;
  readonly joinOrder: number;
  readonly createdAt: string;
}

export interface MatchRepository {
  createMatch(input: CreateMatchInput): MatchWithMembers;
  findMatchByRoomCode(roomCode: string): MatchWithMembers | null;
  findMatchById(matchId: MatchId): MatchWithMembers | null;
  listMatchMembers(matchId: MatchId): readonly MatchMemberRecord[];
  findPlayerForRoomMember(
    matchId: MatchId,
    roomMemberId: RoomMemberId,
  ): PlayerId | null;
  findCommandReceipt(
    matchId: MatchId,
    actorPlayerId: PlayerId,
    commandId: string,
  ): CommandReceiptRecord | null;
  recordRejectedReceipt(
    input: RecordRejectedReceiptInput,
  ): CommandReceiptRecord;
  commitAcceptedCommand(input: CommitAcceptedCommandInput): {
    sequence: number;
    receipt: CommandReceiptRecord;
  };
  listActiveMatches(): readonly {
    readonly match: MatchRecord;
    readonly roomCode: string;
  }[];
  findRoomWithMembers(roomCode: string): {
    readonly room: {
      readonly id: RoomId;
      readonly code: string;
      readonly status: string;
      readonly hostMemberId: RoomMemberId;
    };
    readonly members: readonly MatchRoomMember[];
  } | null;
}

export class MatchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "MatchError";
  }
}
