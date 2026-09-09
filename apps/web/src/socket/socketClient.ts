import {
  type CommandAckResult,
  type MatchPlayerView,
  type PauseReason,
  type PlayerCommand,
  type ResumeData,
  type RoomLobbyView,
  type RoomMemberId,
  type RoomPresencePayload,
  type SessionReplacedPayload,
  type SocketAckResult,
  SOCKET_CLIENT_EVENTS,
  SOCKET_ERROR_CODES,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_SERVER_EVENTS,
  type SocketBootstrapPayload,
} from "@interests/shared";
import { type Socket, io } from "socket.io-client";
import { createCommandEnvelope } from "../command/commandHelper.js";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "replaced";

export interface RealtimeState {
  status: ConnectionStatus;
  replacedReason: "NEW_CONTROLLER" | "RECOVERY" | null;
  room: RoomLobbyView | null;
  presence: RoomPresencePayload | null;
  pauseReasons: readonly PauseReason[];
  match: MatchPlayerView | null;
  selfMemberId: RoomMemberId | null;
  connectionGeneration: number | null;
  error: string | null;
}

export type RealtimeListener = (state: RealtimeState) => void;

export class RealtimeManager {
  private socket: Socket | null = null;
  private listeners = new Set<RealtimeListener>();
  private state: RealtimeState = {
    status: "disconnected",
    replacedReason: null,
    room: null,
    presence: null,
    pauseReasons: [],
    match: null,
    selfMemberId: null,
    connectionGeneration: null,
    error: null,
  };

  getState(): RealtimeState {
    return this.state;
  }

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<RealtimeState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  connect(roomCode: string): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.updateState({
      status: "connecting",
      replacedReason: null,
      error: null,
    });

    const socket = io({
      path: "/socket.io",
      auth: {
        roomCode,
        protocolVersion: SOCKET_PROTOCOL_VERSION,
      },
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket = socket;

    socket.on("connect", () => {
      // Waiting for bootstrap
    });

    socket.on("connect_error", (err) => {
      this.updateState({
        status: "disconnected",
        error: err.message || "Failed to connect to room",
      });
    });

    socket.on("disconnect", (reason) => {
      if (this.state.status !== "replaced") {
        this.updateState({
          status:
            reason === "io client disconnect" ? "disconnected" : "reconnecting",
        });
      }
    });

    socket.on(
      SOCKET_SERVER_EVENTS.BOOTSTRAP,
      (payload: SocketBootstrapPayload) => {
        if (payload.protocolVersion !== SOCKET_PROTOCOL_VERSION) {
          this.updateState({
            status: "disconnected",
            error: "Protocol version mismatch",
          });
          socket.disconnect();
          return;
        }

        const currentGen = payload.self.connectionGeneration;
        this.updateState({
          status: "connected",
          room: payload.room,
          selfMemberId: payload.self.memberId,
          connectionGeneration: currentGen,
          presence: payload.presence,
          pauseReasons: payload.pause.reasons,
          match: payload.match ?? null,
          error: null,
        });

        // Automatically synchronize connection generation
        socket.emit(
          SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
          { connectionGeneration: currentGen },
          (res: SocketAckResult) => {
            if (!res.ok) {
              console.warn("Synchronization failed:", res.error);
            }
          },
        );
      },
    );

    socket.on(SOCKET_SERVER_EVENTS.PRESENCE, (payload: RoomPresencePayload) => {
      this.updateState({
        presence: payload,
        pauseReasons: payload.pauseReasons,
      });
    });

    socket.on(SOCKET_SERVER_EVENTS.MATCH_VIEW, (payload: MatchPlayerView) => {
      this.updateState({
        match: payload,
      });
    });

    socket.on(
      SOCKET_SERVER_EVENTS.REPLACED,
      (payload: SessionReplacedPayload) => {
        this.updateState({
          status: "replaced",
          replacedReason: payload.reason,
        });
        socket.disconnect();
      },
    );
  }

  async sendCommand(command: PlayerCommand): Promise<CommandAckResult> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        return resolve({
          ok: false,
          commandId: "",
          error: {
            code: SOCKET_ERROR_CODES.INTERNAL_ERROR,
            message: "Socket is not connected",
          },
          revision: this.state.match?.revision ?? 0,
        });
      }

      const expectedRevision = this.state.match?.revision ?? 0;
      const envelope = createCommandEnvelope(command, expectedRevision);

      this.socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        envelope,
        (ack: CommandAckResult) => {
          if (ack.ok) {
            // Optimistically or through ack, match:view will arrive with new state
            resolve(ack);
          } else {
            resolve(ack);
          }
        },
      );
    });
  }

  async resumeRoom(): Promise<SocketAckResult<ResumeData>> {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        return resolve({
          ok: false,
          error: {
            code: SOCKET_ERROR_CODES.INTERNAL_ERROR,
            message: "Socket is not connected",
          },
        });
      }

      this.socket.emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        {},
        (res: SocketAckResult<ResumeData>) => {
          resolve(res);
        },
      );
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.updateState({
      status: "disconnected",
    });
  }
}
