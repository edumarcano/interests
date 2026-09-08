import type { RoomMemberId } from "@finance-game/shared";
import type { Socket, Server as SocketIOServer } from "socket.io";
import { normalizeRoomCode } from "../lobby/roomCode.js";
import type {
  AuthenticatedMemberResult,
  LobbyRepository,
} from "../lobby/types.js";
import type { MatchService } from "../match/MatchService.js";
import { loadAndValidatePersistedMatch } from "../match/snapshotLoader.js";
import type { MatchRepository } from "../match/types.js";
import {
  SOCKET_ERROR_CODES,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_SERVER_EVENTS,
} from "./socketProtocol.js";
import type {
  AckResult,
  AuthenticatedSocketData,
  BootstrapPayload,
  MemberSessionState,
  PresenceMemberView,
  ResumeData,
  RoomPresencePayload,
  SessionReplacedPayload,
  SynchronizePayload,
} from "./types.js";

interface RoomMeta {
  presenceArmed: boolean;
}

function safeAck<T>(ack: unknown, result: T): void {
  if (typeof ack === "function") {
    try {
      ack(result);
    } catch {
      // client callback threw or socket closed; ignore safely
    }
  }
}

export class RoomConnectionCoordinator {
  private readonly memberStates = new Map<RoomMemberId, MemberSessionState>();
  private readonly roomMeta = new Map<string, RoomMeta>();
  private isShuttingDown = false;
  private matchRepository?: MatchRepository;
  private matchService?: MatchService;

  constructor(
    private readonly io: SocketIOServer,
    private readonly repository: LobbyRepository,
    matchRepository?: MatchRepository,
    matchService?: MatchService,
  ) {
    this.matchRepository = matchRepository;
    this.matchService = matchService;
  }

  setMatchRepository(repo: MatchRepository): void {
    this.matchRepository = repo;
  }

  setMatchService(service: MatchService): void {
    this.matchService = service;
  }

  prepareShutdown(): void {
    this.isShuttingDown = true;
  }

  private getOrCreateRoomMeta(roomCode: string): RoomMeta {
    const normalized = normalizeRoomCode(roomCode);
    let meta = this.roomMeta.get(normalized);
    if (!meta) {
      meta = { presenceArmed: false };
      this.roomMeta.set(normalized, meta);
    }
    return meta;
  }

  isRoomArmed(roomCode: string): boolean {
    const normalized = normalizeRoomCode(roomCode);
    return this.roomMeta.get(normalized)?.presenceArmed ?? false;
  }

  getMemberState(memberId: RoomMemberId): MemberSessionState | undefined {
    return this.memberStates.get(memberId);
  }

  buildPresencePayload(roomCode: string): RoomPresencePayload {
    const normalized = normalizeRoomCode(roomCode);
    const roomView = this.repository.getRoomLobbyViewByCode(normalized);
    if (!roomView) {
      return {
        members: [],
        allConnected: false,
        allSynchronized: false,
        pauseReasons: [],
      };
    }

    const members: PresenceMemberView[] = roomView.members.map((m) => {
      const state = this.memberStates.get(m.memberId);
      return {
        memberId: m.memberId,
        nickname: m.nickname,
        joinOrder: m.joinOrder,
        isHost: m.isHost,
        connected: state?.connected ?? false,
        synchronized: state?.synchronized ?? false,
      };
    });

    const allConnected =
      members.length === 4 && members.every((m) => m.connected);
    const allSynchronized =
      members.length === 4 && members.every((m) => m.synchronized);
    const pauseReasons = this.repository.getPauseReasons(normalized);

    return {
      members,
      allConnected,
      allSynchronized,
      pauseReasons,
    };
  }

  broadcastPresence(roomCode: string): void {
    try {
      const normalized = normalizeRoomCode(roomCode);
      const presence = this.buildPresencePayload(normalized);
      this.io
        .to(`room:${normalized}`)
        .emit(SOCKET_SERVER_EVENTS.PRESENCE, presence);
    } catch {
      // Gracefully ignore during database closure or server teardown
    }
  }

  registerConnection(socket: Socket, auth: AuthenticatedMemberResult): void {
    const normalizedCode = normalizeRoomCode(auth.roomCode);
    const memberId = auth.member.id;
    const existingState = this.memberStates.get(memberId);

    const generation = existingState ? existingState.generation + 1 : 1;

    // If an existing controlling socket is present, replace it safely
    if (
      existingState?.controllingSocket &&
      existingState.controllingSocket.id !== socket.id
    ) {
      const oldSocket = existingState.controllingSocket;
      const replacedPayload: SessionReplacedPayload = {
        reason: "NEW_CONTROLLER",
      };
      oldSocket.emit(SOCKET_SERVER_EVENTS.REPLACED, replacedPayload);
      (oldSocket.data as Partial<AuthenticatedSocketData>) = {};
      oldSocket.disconnect(true);
    }

    const roomMeta = this.getOrCreateRoomMeta(normalizedCode);

    // If the room was already armed and the existing controller was synchronized,
    // replacing it temporarily removes synchronized control, adding DISCONNECTED_MEMBER pause
    if (roomMeta.presenceArmed && existingState?.synchronized) {
      this.repository.addPauseReason({
        roomCode: normalizedCode,
        reason: "DISCONNECTED_MEMBER",
      });
    }

    // Install new socket as controller
    const newState: MemberSessionState = {
      memberId,
      roomId: auth.roomId,
      roomCode: normalizedCode,
      isHost: auth.isHost,
      controllingSocket: socket,
      generation,
      connected: true,
      synchronized: false,
    };
    this.memberStates.set(memberId, newState);

    const socketData: AuthenticatedSocketData = {
      roomId: auth.roomId,
      roomCode: normalizedCode,
      memberId,
      generation,
      isHost: auth.isHost,
    };
    socket.data = socketData;

    socket.join(`room:${normalizedCode}`);

    // Build and send bootstrap
    const roomView = this.repository.getRoomLobbyViewByCode(normalizedCode);
    if (roomView) {
      const presence = this.buildPresencePayload(normalizedCode);
      const match = this.matchService
        ? this.matchService.getMatchViewForMember({
            roomCode: normalizedCode,
            memberId,
          })
        : null;

      const bootstrapPayload: BootstrapPayload = {
        protocolVersion: SOCKET_PROTOCOL_VERSION,
        room: roomView,
        self: {
          memberId,
          connectionGeneration: generation,
        },
        presence,
        pause: {
          reasons: presence.pauseReasons,
        },
        match,
      };
      socket.emit(SOCKET_SERVER_EVENTS.BOOTSTRAP, bootstrapPayload);
    }

    this.broadcastPresence(normalizedCode);
  }

  handleSynchronized(
    socket: Socket,
    payload: unknown,
    ack?: (result: AckResult) => void,
  ): void {
    const data = socket.data as AuthenticatedSocketData | undefined;
    if (!data?.memberId) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.UNAUTHENTICATED,
          message: "Socket is not authenticated",
        },
      });
      return;
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as SynchronizePayload).connectionGeneration !== "number"
    ) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.INVALID_INPUT,
          message:
            "Invalid synchronization payload; connectionGeneration is required",
        },
      });
      return;
    }

    const { connectionGeneration } = payload as SynchronizePayload;
    const memberState = this.memberStates.get(data.memberId);

    if (
      !memberState ||
      memberState.generation !== data.generation ||
      memberState.controllingSocket !== socket ||
      connectionGeneration !== data.generation
    ) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.NOT_CURRENT_CONTROLLER,
          message:
            "Socket is not the current controller or connection generation is stale",
        },
      });
      return;
    }

    memberState.synchronized = true;

    // Check presence arming condition:
    // A 4-seat room becomes armed when all 4 occupied seats have simultaneously
    // reached connected = true and synchronized = true.
    const presence = this.buildPresencePayload(data.roomCode);
    if (
      presence.members.length === 4 &&
      presence.allConnected &&
      presence.allSynchronized
    ) {
      const roomMeta = this.getOrCreateRoomMeta(data.roomCode);
      roomMeta.presenceArmed = true;
    }

    this.broadcastPresence(data.roomCode);
    safeAck(ack, { ok: true });
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as AuthenticatedSocketData | undefined;
    if (!data?.memberId) {
      return;
    }

    const memberState = this.memberStates.get(data.memberId);
    if (!memberState) {
      return;
    }

    // Only change presence if disconnecting socket's generation matches current controller generation
    if (memberState.generation !== data.generation) {
      // Delayed disconnect from old/superseded socket. Do NOT mark member offline!
      return;
    }

    memberState.connected = false;
    memberState.synchronized = false;
    memberState.controllingSocket = null;

    // Suppress synthesizing disconnect pauses during graceful server teardown
    if (this.isShuttingDown) {
      return;
    }

    try {
      const roomMeta = this.getOrCreateRoomMeta(data.roomCode);
      if (roomMeta.presenceArmed) {
        this.repository.addPauseReason({
          roomCode: data.roomCode,
          reason: "DISCONNECTED_MEMBER",
        });
      }

      this.broadcastPresence(data.roomCode);
    } catch {
      // Gracefully ignore during database closure or server teardown
    }
  }

  handleResume(
    socket: Socket,
    ack?: (result: AckResult<ResumeData>) => void,
  ): void {
    const data = socket.data as AuthenticatedSocketData | undefined;
    if (!data?.memberId) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.UNAUTHENTICATED,
          message: "Socket is not authenticated",
        },
      });
      return;
    }

    const memberState = this.memberStates.get(data.memberId);
    if (
      !memberState ||
      memberState.generation !== data.generation ||
      memberState.controllingSocket !== socket
    ) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.NOT_CURRENT_CONTROLLER,
          message: "Socket is not the current controller",
        },
      });
      return;
    }

    if (!memberState.isHost) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.NOT_ROOM_HOST,
          message: "Only the room host can resume.",
        },
      });
      return;
    }

    const presence = this.buildPresencePayload(data.roomCode);
    if (
      presence.members.length !== 4 ||
      !presence.allConnected ||
      !presence.allSynchronized
    ) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.ROOM_NOT_READY,
          message:
            "All four members must be connected and synchronized before resuming.",
        },
      });
      return;
    }

    if (presence.pauseReasons.includes("SYSTEM_FAULT")) {
      safeAck(ack, {
        ok: false,
        error: {
          code: SOCKET_ERROR_CODES.ROOM_NOT_READY,
          message: "Room is in SYSTEM_FAULT state and cannot be resumed.",
        },
      });
      return;
    }

    const matchWithMembers = this.matchRepository?.findMatchByRoomCode(
      data.roomCode,
    );
    if (matchWithMembers) {
      try {
        const roomInfo = this.matchRepository?.findRoomWithMembers(
          data.roomCode,
        );
        loadAndValidatePersistedMatch(matchWithMembers, roomInfo?.members);
      } catch {
        this.repository.addPauseReason({
          roomCode: data.roomCode,
          reason: "SYSTEM_FAULT",
        });
        this.broadcastPresence(data.roomCode);
        safeAck(ack, {
          ok: false,
          error: {
            code: SOCKET_ERROR_CODES.ROOM_NOT_READY,
            message: "Match snapshot is corrupted or incompatible.",
          },
        });
        return;
      }

      // Atomically clear DISCONNECTED_MEMBER and SERVER_RESTART in a single SQLite transaction
      this.repository.removePauseReasons({
        roomCode: data.roomCode,
        reasons: ["DISCONNECTED_MEMBER", "SERVER_RESTART"],
      });
    } else {
      // Lobby without an active match
      this.repository.removePauseReason({
        roomCode: data.roomCode,
        reason: "DISCONNECTED_MEMBER",
      });
    }

    const pauseReasons = this.repository.getPauseReasons(data.roomCode);
    this.broadcastPresence(data.roomCode);
    safeAck(ack, {
      ok: true,
      data: {
        pauseReasons,
      },
    });
  }

  broadcastMatchView(roomCode: string): void {
    if (!this.matchService) return;
    const normalized = normalizeRoomCode(roomCode);
    const roomView = this.repository.getRoomLobbyViewByCode(normalized);
    if (!roomView) return;

    for (const member of roomView.members) {
      const state = this.memberStates.get(member.memberId);
      if (state?.connected && state.controllingSocket) {
        const view = this.matchService.getMatchViewForMember({
          roomCode: normalized,
          memberId: member.memberId,
        });
        if (view) {
          state.controllingSocket.emit(SOCKET_SERVER_EVENTS.MATCH_VIEW, view);
        }
      }
    }
  }

  invalidateMemberController(memberId: RoomMemberId, reason: "RECOVERY"): void {
    const memberState = this.memberStates.get(memberId);
    if (!memberState) {
      return;
    }

    const socket = memberState.controllingSocket;
    memberState.connected = false;
    memberState.synchronized = false;
    memberState.controllingSocket = null;

    if (socket?.connected) {
      const replacedPayload: SessionReplacedPayload = { reason };
      socket.emit(SOCKET_SERVER_EVENTS.REPLACED, replacedPayload);
      (socket.data as Partial<AuthenticatedSocketData>) = {};
      socket.disconnect(true);
    }

    const roomMeta = this.getOrCreateRoomMeta(memberState.roomCode);
    if (roomMeta.presenceArmed) {
      this.repository.addPauseReason({
        roomCode: memberState.roomCode,
        reason: "DISCONNECTED_MEMBER",
      });
    }

    this.broadcastPresence(memberState.roomCode);
  }

  notifyRosterChanged(roomCode: string): void {
    const normalized = normalizeRoomCode(roomCode);
    this.broadcastPresence(normalized);
  }
}
