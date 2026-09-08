import crypto from "node:crypto";
import {
  applyPlayerCommand,
  createGame,
  type GameState,
} from "@finance-game/engine";
import {
  asMatchId,
  asPlayerId,
  type CommandAckResult,
  type MatchPlayerView,
  type PlayerId,
  type RoomMemberId,
} from "@finance-game/shared";
import type { Socket } from "socket.io";
import type { LobbyRepository } from "../lobby/types.js";
import type { RoomConnectionCoordinator } from "../realtime/RoomConnectionCoordinator.js";
import { computeCommandPayloadHash } from "./payloadHash.js";
import { buildMatchPlayerView } from "./projection.js";
import { RoomCommandQueue } from "./RoomCommandQueue.js";
import { PlayerCommandEnvelopeSchema } from "./schema.js";
import { loadAndValidateSnapshot } from "./snapshotLoader.js";
import {
  MatchError,
  type MatchInitializationManifest,
  type MatchRepository,
} from "./types.js";
import { getCurrentVersionMetadata } from "./versions.js";

export class MatchService {
  private readonly commandQueue = new RoomCommandQueue();

  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly lobbyRepository: LobbyRepository,
    private coordinator?: RoomConnectionCoordinator,
  ) {}

  setCoordinator(coordinator: RoomConnectionCoordinator): void {
    this.coordinator = coordinator;
  }

  async startMatch(params: {
    roomCode: string;
    sessionToken: string;
  }): Promise<MatchPlayerView> {
    const auth = this.lobbyRepository.authenticateMemberForRoom({
      roomCode: params.roomCode,
      sessionToken: params.sessionToken,
    });
    if (!auth) {
      throw new MatchError(
        "NOT_A_ROOM_MEMBER",
        "You are not an authorized member of this room",
        403,
      );
    }
    if (!auth.isHost) {
      throw new MatchError(
        "NOT_ROOM_HOST",
        "Only the room host can start the match",
        403,
      );
    }

    // Idempotency check: if match already exists for this room, return existing view
    const existingMatch = this.matchRepository.findMatchByRoomCode(
      params.roomCode,
    );
    if (existingMatch) {
      return this.getMatchView({
        roomCode: params.roomCode,
        sessionToken: params.sessionToken,
      });
    }

    const roomInfo = this.matchRepository.findRoomWithMembers(params.roomCode);
    if (!roomInfo) {
      throw new MatchError("ROOM_NOT_FOUND", "Room not found", 404);
    }
    if (roomInfo.room.status !== "OPEN") {
      throw new MatchError(
        "ROOM_NOT_OPEN",
        "Room is not in OPEN status for match start",
        409,
      );
    }
    if (roomInfo.members.length !== 4) {
      throw new MatchError(
        "ROOM_NOT_READY",
        "Match requires exactly four room members",
        409,
      );
    }

    // Check that all four members have current controlling sockets and are synchronized
    if (this.coordinator) {
      const presence = this.coordinator.buildPresencePayload(params.roomCode);
      if (
        presence.members.length !== 4 ||
        !presence.allConnected ||
        !presence.allSynchronized
      ) {
        throw new MatchError(
          "ROOM_NOT_READY",
          "All four members must be connected and synchronized to start",
          409,
        );
      }
    }

    // Check no active pause reasons
    const pauseReasons = this.lobbyRepository.getPauseReasons(params.roomCode);
    if (pauseReasons.length > 0) {
      throw new MatchError(
        "ROOM_PAUSED",
        "Cannot start match while room has active pause reasons",
        409,
      );
    }

    // Stable PlayerId policy: player-1 .. player-4 derived from join order 0..3
    const playerIds: PlayerId[] = [
      asPlayerId("player-1"),
      asPlayerId("player-2"),
      asPlayerId("player-3"),
      asPlayerId("player-4"),
    ];

    const matchId = asMatchId(crypto.randomBytes(16).toString("base64url"));
    const seed = crypto.randomBytes(32).toString("base64url");

    // Pure engine setup
    const initialGameState = createGame({
      gameId: matchId,
      seed,
      playerIds,
    });

    const initializationManifest: MatchInitializationManifest = {
      gameId: matchId,
      modeId: "standard-v1",
      seed,
      orderedPlayerIds: playerIds,
    };

    const memberMappings = roomInfo.members.map((m, idx) => ({
      roomMemberId: m.id,
      playerId: playerIds[idx]!,
      playerOrder: idx,
    }));

    const versions = getCurrentVersionMetadata();

    // Atomic SQLite commit
    this.matchRepository.createMatch({
      matchId,
      roomId: roomInfo.room.id,
      modeId: "standard-v1",
      initializationManifest,
      initialSnapshot: initialGameState,
      memberMappings,
      versions,
    });

    // Notify coordinator to broadcast personalized views
    if (this.coordinator) {
      this.coordinator.broadcastMatchView(params.roomCode);
    }

    return this.getMatchView({
      roomCode: params.roomCode,
      sessionToken: params.sessionToken,
    });
  }

  getMatchView(params: {
    roomCode: string;
    sessionToken: string;
  }): MatchPlayerView {
    const auth = this.lobbyRepository.authenticateMemberForRoom({
      roomCode: params.roomCode,
      sessionToken: params.sessionToken,
    });
    if (!auth) {
      throw new MatchError(
        "NOT_A_ROOM_MEMBER",
        "You are not an authorized member of this room",
        403,
      );
    }

    const matchWithMembers = this.matchRepository.findMatchByRoomCode(
      params.roomCode,
    );
    if (!matchWithMembers) {
      throw new MatchError(
        "NO_ACTIVE_MATCH",
        "No active match found for this room",
        404,
      );
    }

    const targetPlayerId = this.matchRepository.findPlayerForRoomMember(
      matchWithMembers.match.id,
      auth.member.id,
    );
    if (!targetPlayerId) {
      throw new MatchError(
        "NOT_A_MATCH_PLAYER",
        "Member is not mapped to a player in this match",
        403,
      );
    }

    const versions = {
      engineVersion: matchWithMembers.match.engineVersion,
      rulesVersion: matchWithMembers.match.rulesVersion,
      sharedVersion: matchWithMembers.match.sharedVersion,
      persistenceFormatVersion: matchWithMembers.match.persistenceFormatVersion,
    };

    const gameState = loadAndValidateSnapshot(
      matchWithMembers.match.snapshotJson,
      versions,
    );

    const roomInfo = this.matchRepository.findRoomWithMembers(params.roomCode);
    if (!roomInfo) {
      throw new MatchError("ROOM_NOT_FOUND", "Room not found", 404);
    }

    return buildMatchPlayerView({
      gameState,
      targetPlayerId,
      roomMembers: roomInfo.members,
      matchMembers: matchWithMembers.members,
      hostMemberId: roomInfo.room.hostMemberId,
    });
  }

  getMatchViewForMember(params: {
    roomCode: string;
    memberId: RoomMemberId;
  }): MatchPlayerView | null {
    const matchWithMembers = this.matchRepository.findMatchByRoomCode(
      params.roomCode,
    );
    if (!matchWithMembers) {
      return null;
    }

    const targetPlayerId = this.matchRepository.findPlayerForRoomMember(
      matchWithMembers.match.id,
      params.memberId,
    );
    if (!targetPlayerId) {
      return null;
    }

    const versions = {
      engineVersion: matchWithMembers.match.engineVersion,
      rulesVersion: matchWithMembers.match.rulesVersion,
      sharedVersion: matchWithMembers.match.sharedVersion,
      persistenceFormatVersion: matchWithMembers.match.persistenceFormatVersion,
    };

    let gameState: GameState;
    try {
      gameState = loadAndValidateSnapshot(
        matchWithMembers.match.snapshotJson,
        versions,
      );
    } catch {
      return null;
    }

    const roomInfo = this.matchRepository.findRoomWithMembers(params.roomCode);
    if (!roomInfo) return null;

    return buildMatchPlayerView({
      gameState,
      targetPlayerId,
      roomMembers: roomInfo.members,
      matchMembers: matchWithMembers.members,
      hostMemberId: roomInfo.room.hostMemberId,
    });
  }

  async executeCommand(params: {
    socket: Socket;
    envelope: unknown;
  }): Promise<CommandAckResult> {
    const socketData = params.socket.data as {
      roomId?: string;
      roomCode?: string;
      memberId?: RoomMemberId;
      generation?: number;
      isHost?: boolean;
    };

    const roomCode = socketData.roomCode;
    if (!roomCode || !socketData.memberId) {
      return {
        ok: false,
        commandId: "unknown",
        error: {
          code: "NOT_CURRENT_CONTROLLER",
          message: "Socket is not authenticated",
        },
        revision: 0,
      };
    }

    return this.commandQueue.enqueue(roomCode, async () => {
      // 1. Current-controller check when job runs
      const memberState = this.coordinator?.getMemberState(
        socketData.memberId!,
      );
      if (
        !memberState ||
        !memberState.connected ||
        memberState.generation !== socketData.generation ||
        memberState.controllingSocket !== params.socket
      ) {
        return {
          ok: false,
          commandId: "unknown",
          error: {
            code: "NOT_CURRENT_CONTROLLER",
            message: "Socket is no longer the current controlling socket",
          },
          revision: 0,
        };
      }

      // 2. Locate match
      const matchWithMembers =
        this.matchRepository.findMatchByRoomCode(roomCode);
      if (!matchWithMembers) {
        return {
          ok: false,
          commandId: "unknown",
          error: {
            code: "NO_ACTIVE_MATCH",
            message: "No active match found for this room",
          },
          revision: 0,
        };
      }

      // 3. Locate actor PlayerId
      const actorPlayerId = this.matchRepository.findPlayerForRoomMember(
        matchWithMembers.match.id,
        socketData.memberId!,
      );
      if (!actorPlayerId) {
        return {
          ok: false,
          commandId: "unknown",
          error: {
            code: "NOT_CURRENT_CONTROLLER",
            message: "Member is not mapped to a player in this match",
          },
          revision: matchWithMembers.match.revision,
        };
      }

      // 4. Validate envelope with Zod schema
      const parseResult = PlayerCommandEnvelopeSchema.safeParse(
        params.envelope,
      );
      if (!parseResult.success) {
        const rawCommandId =
          params.envelope &&
          typeof params.envelope === "object" &&
          "commandId" in params.envelope &&
          typeof (params.envelope as { commandId?: unknown }).commandId ===
            "string"
            ? (params.envelope as { commandId: string }).commandId
            : "unknown";

        return {
          ok: false,
          commandId: rawCommandId,
          error: {
            code: "INVALID_INPUT",
            message: "Malformed command envelope or illegal fields",
          },
          revision: matchWithMembers.match.revision,
        };
      }

      const validEnvelope = parseResult.data;

      // 5. Compute canonical SHA-256 payload hash
      const payloadHash = computeCommandPayloadHash(validEnvelope);

      // 6. Look up existing receipt by (match_id, actor_player_id, command_id)
      const existingReceipt = this.matchRepository.findCommandReceipt(
        matchWithMembers.match.id,
        actorPlayerId,
        validEnvelope.commandId,
      );

      if (existingReceipt) {
        // Idempotency check
        if (existingReceipt.payloadHash === payloadHash) {
          if (existingReceipt.outcome === "ACCEPTED") {
            return {
              ok: true,
              commandId: validEnvelope.commandId,
              outcome: "ACCEPTED",
              revision: existingReceipt.resultingRevision,
            };
          } else {
            return {
              ok: false,
              commandId: validEnvelope.commandId,
              error: {
                code: existingReceipt.errorCode ?? "REJECTED",
                message: "Command previously rejected",
              },
              revision: existingReceipt.resultingRevision,
            };
          }
        } else {
          // Reused command ID with modified payload
          return {
            ok: false,
            commandId: validEnvelope.commandId,
            error: {
              code: "COMMAND_ID_REUSED",
              message:
                "Command ID was already used with a different payload or revision",
            },
            revision: matchWithMembers.match.revision,
          };
        }
      }

      // 7. No receipt exists yet: load latest match state
      const currentMatch = this.matchRepository.findMatchById(
        matchWithMembers.match.id,
      );
      if (!currentMatch) {
        return {
          ok: false,
          commandId: validEnvelope.commandId,
          error: {
            code: "NO_ACTIVE_MATCH",
            message: "Match disappeared",
          },
          revision: 0,
        };
      }

      let currentState: GameState;
      try {
        currentState = loadAndValidateSnapshot(
          currentMatch.match.snapshotJson,
          {
            engineVersion: currentMatch.match.engineVersion,
            rulesVersion: currentMatch.match.rulesVersion,
            sharedVersion: currentMatch.match.sharedVersion,
            persistenceFormatVersion:
              currentMatch.match.persistenceFormatVersion,
          },
        );
      } catch {
        this.lobbyRepository.addPauseReason({
          roomCode,
          reason: "SYSTEM_FAULT",
        });
        return {
          ok: false,
          commandId: validEnvelope.commandId,
          error: {
            code: "MATCH_INCOMPATIBLE",
            message: "Match snapshot corrupted or version incompatible",
          },
          revision: currentMatch.match.revision,
        };
      }

      // 8. Check pause reasons
      const pauseReasons = this.lobbyRepository.getPauseReasons(roomCode);
      if (pauseReasons.length > 0) {
        this.matchRepository.recordRejectedReceipt({
          matchId: currentMatch.match.id,
          actorPlayerId,
          commandId: validEnvelope.commandId,
          payloadHash,
          errorCode: "ROOM_PAUSED",
          resultingRevision: currentMatch.match.revision,
        });
        return {
          ok: false,
          commandId: validEnvelope.commandId,
          error: {
            code: "ROOM_PAUSED",
            message: "Room is paused; new commands cannot be executed",
          },
          revision: currentMatch.match.revision,
        };
      }

      // 9. Check expected revision
      if (validEnvelope.expectedRevision !== currentMatch.match.revision) {
        this.matchRepository.recordRejectedReceipt({
          matchId: currentMatch.match.id,
          actorPlayerId,
          commandId: validEnvelope.commandId,
          payloadHash,
          errorCode: "STALE_REVISION",
          resultingRevision: currentMatch.match.revision,
        });
        return {
          ok: false,
          commandId: validEnvelope.commandId,
          error: {
            code: "STALE_REVISION",
            message: `Expected revision ${validEnvelope.expectedRevision} but current revision is ${currentMatch.match.revision}`,
          },
          revision: currentMatch.match.revision,
        };
      }

      // 10. Pure engine transition
      const actionResult = applyPlayerCommand(
        currentState,
        actorPlayerId,
        validEnvelope.command,
      );

      if (!actionResult.ok) {
        this.matchRepository.recordRejectedReceipt({
          matchId: currentMatch.match.id,
          actorPlayerId,
          commandId: validEnvelope.commandId,
          payloadHash,
          errorCode: "GAMEPLAY_REJECTED",
          resultingRevision: currentMatch.match.revision,
        });
        return {
          ok: false,
          commandId: validEnvelope.commandId,
          error: {
            code: "GAMEPLAY_REJECTED",
            message: actionResult.code,
          },
          revision: currentMatch.match.revision,
        };
      }

      // 11. Atomic SQLite commit
      this.matchRepository.commitAcceptedCommand({
        matchId: currentMatch.match.id,
        expectedPreviousRevision: currentMatch.match.revision,
        nextRevision: actionResult.state.revision,
        nextState: actionResult.state,
        actorPlayerId,
        commandId: validEnvelope.commandId,
        commandType: validEnvelope.command.type,
        payloadJson: JSON.stringify(validEnvelope.command),
        payloadHash,
      });

      // 12. Personalized post-commit broadcast
      if (this.coordinator) {
        this.coordinator.broadcastMatchView(roomCode);
      }

      // 13. Acknowledge socket only after commit
      return {
        ok: true,
        commandId: validEnvelope.commandId,
        outcome: "ACCEPTED",
        revision: actionResult.state.revision,
      };
    });
  }
}
