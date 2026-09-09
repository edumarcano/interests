import type {
  CommandAckResult,
  MatchPlayerView,
  PauseReason,
  PlayerCommand,
  PlayerCommandEnvelope,
  ResumeData,
  RoomLobbyView,
  RoomMemberId,
  RoomPresencePayload,
  SessionReplacedPayload,
  SocketAckResult,
  SocketBootstrapPayload,
} from "@interests/shared";
import {
  SOCKET_CLIENT_EVENTS,
  SOCKET_ERROR_CODES,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_SERVER_EVENTS,
} from "@interests/shared";
import { io, type Socket } from "socket.io-client";
import {
  createCommandEnvelope,
  isSameLogicalCommand,
} from "../command/commandHelper.js";

export type ConnectionStatus =
  | "connecting"
  | "synchronizing"
  | "synchronized"
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
  private pendingCommand: PlayerCommandEnvelope | null = null;
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

  getPendingCommand(): PlayerCommandEnvelope | null {
    return this.pendingCommand;
  }

  setMatch(match: MatchPlayerView): void {
    if (
      this.pendingCommand &&
      match.revision > this.pendingCommand.expectedRevision
    ) {
      this.pendingCommand = null;
    }
    this.updateState({ match });
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
      // Waiting for session:bootstrap and session:synchronized ack
    });

    socket.on("disconnect", (reason) => {
      if (this.state.status !== "replaced") {
        this.updateState({
          status: "disconnected",
          error: `Disconnected: ${reason}`,
        });
      }
    });

    socket.on("connect_error", (err) => {
      this.updateState({
        status: "disconnected",
        error: err.message || "Failed to connect to room",
      });
    });

    socket.on(
      SOCKET_SERVER_EVENTS.BOOTSTRAP,
      (payload: SocketBootstrapPayload) => {
        const currentGen = payload.self.connectionGeneration;

        this.updateState({
          status: "synchronizing",
          room: payload.room,
          presence: payload.presence,
          pauseReasons: payload.pause.reasons,
          match: payload.match ?? null,
          selfMemberId: payload.self.memberId,
          connectionGeneration: currentGen,
          error: null,
        });

        // Acknowledge session synchronization to arm controller presence
        socket.emit(
          SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
          { connectionGeneration: currentGen },
          (res: SocketAckResult) => {
            if (res && res.ok) {
              this.updateState({
                status: "synchronized",
                error: null,
              });
            } else {
              const message =
                res && !res.ok ? res.error.message : "Synchronization failed";
              this.updateState({
                status: "disconnected",
                error: message,
              });
              socket.disconnect();
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
      if (
        this.pendingCommand &&
        payload.revision > this.pendingCommand.expectedRevision
      ) {
        this.pendingCommand = null;
      }
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

  async sendCommand(
    commandOrEnvelope: PlayerCommand | PlayerCommandEnvelope,
    timeoutMs = 10000,
  ): Promise<CommandAckResult> {
    let envelope: PlayerCommandEnvelope;
    const currentRevision = this.state.match?.revision ?? 0;
    if (
      "commandId" in commandOrEnvelope &&
      "expectedRevision" in commandOrEnvelope
    ) {
      envelope = commandOrEnvelope;
    } else {
      // If we already have a pending command for the exact same logical action at this revision,
      // reuse the existing envelope across uncertain delivery / timeout retry!
      if (
        this.pendingCommand &&
        isSameLogicalCommand(this.pendingCommand.command, commandOrEnvelope) &&
        this.pendingCommand.expectedRevision === currentRevision
      ) {
        envelope = this.pendingCommand;
      } else {
        envelope = createCommandEnvelope(commandOrEnvelope, currentRevision);
      }
    }

    this.pendingCommand = envelope;

    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        return resolve({
          ok: false,
          commandId: envelope.commandId,
          error: {
            code: SOCKET_ERROR_CODES.INTERNAL_ERROR,
            message: "Socket is not connected",
          },
          revision: currentRevision,
        });
      }

      let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        timer = null;
        resolve({
          ok: false,
          commandId: envelope.commandId,
          error: {
            code: "TIMEOUT",
            message:
              "Command acknowledgement timed out; retry will reuse this envelope",
          },
          revision: currentRevision,
        });
      }, timeoutMs);

      this.socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        envelope,
        (ack: CommandAckResult) => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          // Clear pendingCommand on terminal acknowledgements (both accepted and rejected),
          // but only if it matches this envelope (preventing late acks from clearing newer commands).
          if (
            this.pendingCommand &&
            this.pendingCommand.commandId === envelope.commandId
          ) {
            this.pendingCommand = null;
          }
          resolve(ack);
        },
      );
    });
  }

  async retryPendingCommand(timeoutMs?: number): Promise<CommandAckResult> {
    if (!this.pendingCommand) {
      return {
        ok: false,
        commandId: "",
        error: {
          code: "NO_PENDING_COMMAND",
          message: "No pending command to retry",
        },
        revision: this.state.match?.revision ?? 0,
      };
    }
    return this.sendCommand(this.pendingCommand, timeoutMs);
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
