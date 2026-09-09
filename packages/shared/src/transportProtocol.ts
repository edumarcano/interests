import type { MatchPlayerView } from "./matchProtocol.js";
import type { RoomMemberId } from "./primitives/ids.js";

export const SOCKET_PROTOCOL_VERSION = "1";
export const SESSION_COOKIE_NAME = "interests_session";

export const SOCKET_CLIENT_EVENTS = {
  SYNCHRONIZE: "session:synchronized",
  RESUME: "room:resume",
  COMMAND: "match:command",
} as const;

export const SOCKET_SERVER_EVENTS = {
  BOOTSTRAP: "session:bootstrap",
  REPLACED: "session:replaced",
  PRESENCE: "room:presence",
  MATCH_VIEW: "match:view",
} as const;

export const SOCKET_ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  NOT_A_ROOM_MEMBER: "NOT_A_ROOM_MEMBER",
  INCOMPATIBLE_PROTOCOL: "INCOMPATIBLE_PROTOCOL",
  INVALID_INPUT: "INVALID_INPUT",
  NOT_CURRENT_CONTROLLER: "NOT_CURRENT_CONTROLLER",
  NOT_ROOM_HOST: "NOT_ROOM_HOST",
  ROOM_NOT_READY: "ROOM_NOT_READY",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NO_ACTIVE_MATCH: "NO_ACTIVE_MATCH",
  ROOM_PAUSED: "ROOM_PAUSED",
  STALE_REVISION: "STALE_REVISION",
  COMMAND_ID_REUSED: "COMMAND_ID_REUSED",
  GAMEPLAY_REJECTED: "GAMEPLAY_REJECTED",
  MATCH_INCOMPATIBLE: "MATCH_INCOMPATIBLE",
} as const;

export type SocketErrorCode =
  (typeof SOCKET_ERROR_CODES)[keyof typeof SOCKET_ERROR_CODES];

export type PauseReason =
  | "MANUAL"
  | "DISCONNECTED_MEMBER"
  | "SERVER_RESTART"
  | "SYSTEM_FAULT";

export interface RoomMemberView {
  readonly memberId: RoomMemberId;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly isHost: boolean;
}

export interface RoomLobbyView {
  readonly code: string;
  readonly status: string;
  readonly capacity: number;
  readonly memberCount: number;
  readonly members: readonly RoomMemberView[];
}

export interface SessionBootstrapMembership {
  readonly roomCode: string;
  readonly memberId: RoomMemberId;
  readonly nickname: string;
  readonly roomStatus: string;
}

export interface CreateRoomResponse {
  readonly room: RoomLobbyView;
  readonly self: {
    readonly memberId: RoomMemberId;
    readonly recoveryCode: string;
  };
}

export interface JoinRoomResponse {
  readonly room: RoomLobbyView;
  readonly self: {
    readonly memberId: RoomMemberId;
    readonly recoveryCode: string;
  };
}

export interface RecoverRoomResponse {
  readonly room: RoomLobbyView;
  readonly self: {
    readonly memberId: RoomMemberId;
  };
}

export interface RotateRecoveryCodeResponse {
  readonly recoveryCode: string;
}

export interface SessionBootstrapResponse {
  readonly memberships: readonly SessionBootstrapMembership[];
}

export interface GetRoomResponse {
  readonly room: RoomLobbyView;
  readonly self: {
    readonly memberId: RoomMemberId;
  };
}

export interface StartMatchResponse {
  readonly match: MatchPlayerView;
}

export interface GetMatchResponse {
  readonly match: MatchPlayerView;
}

export interface PresenceMemberView {
  readonly memberId: RoomMemberId;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly isHost: boolean;
  readonly connected: boolean;
  readonly synchronized: boolean;
}

export interface RoomPresencePayload {
  readonly members: readonly PresenceMemberView[];
  readonly allConnected: boolean;
  readonly allSynchronized: boolean;
  readonly pauseReasons: readonly PauseReason[];
}

export interface SocketBootstrapPayload {
  readonly protocolVersion: string;
  readonly room: RoomLobbyView;
  readonly self: {
    readonly memberId: RoomMemberId;
    readonly connectionGeneration: number;
  };
  readonly presence: RoomPresencePayload;
  readonly pause: {
    readonly reasons: readonly PauseReason[];
  };
  readonly match?: MatchPlayerView | null;
}

export interface SessionReplacedPayload {
  readonly reason: "NEW_CONTROLLER" | "RECOVERY";
}

export interface SynchronizePayload {
  readonly connectionGeneration: number;
}

export interface SocketErrorPayload {
  readonly code: string;
  readonly message: string;
}

export type SocketAckResult<T = void> =
  | ({ readonly ok: true } & (T extends void
      ? { readonly data?: undefined }
      : { readonly data: T }))
  | { readonly ok: false; readonly error: SocketErrorPayload };

export interface ResumeData {
  readonly pauseReasons: readonly PauseReason[];
}

export interface HandshakeAuth {
  readonly roomCode?: unknown;
  readonly protocolVersion?: unknown;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}
