import type {
  BrowserSessionId,
  RoomId,
  RoomMemberId,
} from "@finance-game/shared";

export interface RoomRecord {
  id: RoomId;
  code: string;
  status: string;
  hostMemberId: RoomMemberId;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface RoomMemberRecord {
  id: RoomMemberId;
  roomId: RoomId;
  nickname: string;
  nicknameKey: string;
  joinOrder: number;
  recoveryCredentialDigest: string;
  createdAt: string;
}

export interface BrowserSessionRecord {
  id: BrowserSessionId;
  credentialDigest: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
}

export interface RoomMemberView {
  memberId: RoomMemberId;
  nickname: string;
  joinOrder: number;
  isHost: boolean;
}

export interface RoomLobbyView {
  code: string;
  status: string;
  capacity: number;
  memberCount: number;
  members: RoomMemberView[];
}

export interface SessionBootstrapMembership {
  roomCode: string;
  memberId: RoomMemberId;
  nickname: string;
  roomStatus: string;
}

export interface CreateRoomResult {
  room: RoomLobbyView;
  self: {
    memberId: RoomMemberId;
    recoveryCode: string;
  };
  sessionToken?: string; // provided if a new session was created
}

export interface JoinRoomResult {
  room: RoomLobbyView;
  self: {
    memberId: RoomMemberId;
    recoveryCode: string;
  };
  sessionToken?: string;
}

export interface RecoverMembershipResult {
  room: RoomLobbyView;
  self: {
    memberId: RoomMemberId;
  };
  sessionToken?: string;
}

export interface LobbyRepository {
  createRoomWithHost(params: {
    nickname: string;
    existingSessionToken?: string;
  }): CreateRoomResult;

  joinRoom(params: {
    roomCode: string;
    nickname: string;
    existingSessionToken?: string;
  }): JoinRoomResult;

  getRoomLobbyView(params: { roomCode: string; sessionToken: string }): {
    room: RoomLobbyView;
    self: { memberId: RoomMemberId };
  };

  getSessionBootstrap(sessionToken: string): SessionBootstrapMembership[];

  recoverMembership(params: {
    roomCode: string;
    recoveryCode: string;
    existingSessionToken?: string;
  }): RecoverMembershipResult;

  rotateRecoveryCode(params: { roomCode: string; sessionToken: string }): {
    recoveryCode: string;
  };

  touchSession(sessionToken: string): void;
}
