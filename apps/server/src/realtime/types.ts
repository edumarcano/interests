import type { MatchPlayerView, RoomId, RoomMemberId } from "@interests/shared";
import type { Socket } from "socket.io";
import type { PauseReason, RoomLobbyView } from "../lobby/types.js";

export interface HandshakeAuth {
  roomCode?: unknown;
  protocolVersion?: unknown;
}

export interface PresenceMemberView {
  memberId: RoomMemberId;
  nickname: string;
  joinOrder: number;
  isHost: boolean;
  connected: boolean;
  synchronized: boolean;
}

export interface RoomPresencePayload {
  members: PresenceMemberView[];
  allConnected: boolean;
  allSynchronized: boolean;
  pauseReasons: PauseReason[];
}

export interface BootstrapPayload {
  protocolVersion: string;
  room: RoomLobbyView;
  self: {
    memberId: RoomMemberId;
    connectionGeneration: number;
  };
  presence: RoomPresencePayload;
  pause: {
    reasons: PauseReason[];
  };
  match?: MatchPlayerView | null;
}

export interface SessionReplacedPayload {
  reason: "NEW_CONTROLLER" | "RECOVERY";
}

export interface SynchronizePayload {
  connectionGeneration: number;
}

export interface SocketErrorPayload {
  code: string;
  message: string;
}

export type AckResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; error: SocketErrorPayload };

export interface ResumeData {
  pauseReasons: PauseReason[];
}

export interface MemberSessionState {
  memberId: RoomMemberId;
  roomId: RoomId;
  roomCode: string;
  isHost: boolean;
  controllingSocket: Socket | null;
  generation: number;
  connected: boolean;
  synchronized: boolean;
}

export interface AuthenticatedSocketData {
  roomId: RoomId;
  roomCode: string;
  memberId: RoomMemberId;
  generation: number;
  isHost: boolean;
}
