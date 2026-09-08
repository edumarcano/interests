import {
  asMatchId,
  asPlayerId,
  asRoomId,
  asRoomMemberId,
  type MatchId,
  type PlayerId,
  type RoomId,
  type RoomMemberId,
} from "@interests/shared";
import type Database from "better-sqlite3";
import {
  type CommandReceiptRecord,
  type CommitAcceptedCommandInput,
  type CreateMatchInput,
  MatchError,
  type MatchMemberRecord,
  type MatchRecord,
  type MatchRepository,
  type MatchRoomMember,
  type MatchWithMembers,
  type RecordRejectedReceiptInput,
} from "../../match/types.js";

interface DbMatchRow {
  id: string;
  room_id: string;
  status: "ACTIVE" | "FINISHED" | "ABANDONED";
  mode_id: string;
  revision: number;
  initialization_json: string;
  initial_snapshot_json: string;
  snapshot_json: string;
  engine_version: string;
  rules_version: string;
  shared_version: string;
  persistence_format_version: string;
  created_at: string;
  updated_at: string;
}

interface DbMatchMemberRow {
  match_id: string;
  room_member_id: string;
  player_id: string;
  player_order: number;
}

interface DbCommandReceiptRow {
  match_id: string;
  actor_player_id: string;
  command_id: string;
  payload_hash: string;
  outcome: "ACCEPTED" | "REJECTED";
  error_code: string | null;
  error_message: string | null;
  resulting_revision: number;
  accepted_sequence: number | null;
  created_at: string;
}

function mapMatchRow(row: DbMatchRow): MatchRecord {
  return {
    id: asMatchId(row.id),
    roomId: asRoomId(row.room_id),
    status: row.status,
    modeId: row.mode_id,
    revision: row.revision,
    initializationJson: row.initialization_json,
    initialSnapshotJson: row.initial_snapshot_json,
    snapshotJson: row.snapshot_json,
    engineVersion: row.engine_version,
    rulesVersion: row.rules_version,
    sharedVersion: row.shared_version,
    persistenceFormatVersion: row.persistence_format_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemberRow(row: DbMatchMemberRow): MatchMemberRecord {
  return {
    matchId: asMatchId(row.match_id),
    roomMemberId: asRoomMemberId(row.room_member_id),
    playerId: asPlayerId(row.player_id),
    playerOrder: row.player_order,
  };
}

function mapReceiptRow(row: DbCommandReceiptRow): CommandReceiptRecord {
  return {
    matchId: asMatchId(row.match_id),
    actorPlayerId: asPlayerId(row.actor_player_id),
    commandId: row.command_id,
    payloadHash: row.payload_hash,
    outcome: row.outcome,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    resultingRevision: row.resulting_revision,
    acceptedSequence: row.accepted_sequence,
    createdAt: row.created_at,
  };
}

export class SqliteMatchRepository implements MatchRepository {
  constructor(private readonly db: Database.Database) {}

  createMatch(input: CreateMatchInput): MatchWithMembers {
    const nowIso = new Date().toISOString();
    const snapshotJson = JSON.stringify(input.initialSnapshot);
    const initializationJson = JSON.stringify(input.initializationManifest);

    return this.db.transaction(() => {
      // 1. Verify room exists and is currently OPEN
      const room = this.db
        .prepare("SELECT id, status FROM rooms WHERE id = ?")
        .get(input.roomId) as { id: string; status: string } | undefined;

      if (!room) {
        throw new MatchError("ROOM_NOT_FOUND", "Room does not exist", 404);
      }

      if (room.status !== "OPEN") {
        throw new MatchError(
          "ROOM_NOT_OPEN",
          "Room is not in OPEN status for match start",
          409,
        );
      }

      // 2. Verify no existing match for this room
      const existingMatch = this.db
        .prepare("SELECT id FROM matches WHERE room_id = ?")
        .get(input.roomId);

      if (existingMatch) {
        throw new MatchError(
          "MATCH_ALREADY_EXISTS",
          "A match already exists for this room",
          409,
        );
      }

      // 3. Insert matches row
      this.db
        .prepare(
          `INSERT INTO matches (
            id, room_id, status, mode_id, revision,
            initialization_json, initial_snapshot_json, snapshot_json,
            engine_version, rules_version, shared_version, persistence_format_version,
            created_at, updated_at
          ) VALUES (?, ?, 'ACTIVE', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.matchId,
          input.roomId,
          input.modeId,
          initializationJson,
          snapshotJson,
          snapshotJson,
          input.versions.engineVersion,
          input.versions.rulesVersion,
          input.versions.sharedVersion,
          input.versions.persistenceFormatVersion,
          nowIso,
          nowIso,
        );

      // 4. Insert match_members
      const insertMemberStmt = this.db.prepare(
        `INSERT INTO match_members (match_id, room_member_id, player_id, player_order)
         VALUES (?, ?, ?, ?)`,
      );

      const createdMembers: MatchMemberRecord[] = [];
      for (const mapping of input.memberMappings) {
        insertMemberStmt.run(
          input.matchId,
          mapping.roomMemberId,
          mapping.playerId,
          mapping.playerOrder,
        );
        createdMembers.push({
          matchId: input.matchId,
          roomMemberId: mapping.roomMemberId,
          playerId: mapping.playerId,
          playerOrder: mapping.playerOrder,
        });
      }

      // 5. Transition room to IN_MATCH
      this.db
        .prepare(
          "UPDATE rooms SET status = 'IN_MATCH', updated_at = ? WHERE id = ?",
        )
        .run(nowIso, input.roomId);

      const matchRecord: MatchRecord = {
        id: input.matchId,
        roomId: input.roomId,
        status: "ACTIVE",
        modeId: input.modeId,
        revision: 0,
        initializationJson,
        initialSnapshotJson: snapshotJson,
        snapshotJson,
        engineVersion: input.versions.engineVersion,
        rulesVersion: input.versions.rulesVersion,
        sharedVersion: input.versions.sharedVersion,
        persistenceFormatVersion: input.versions.persistenceFormatVersion,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      return {
        match: matchRecord,
        members: createdMembers,
      };
    })();
  }

  findMatchByRoomCode(roomCode: string): MatchWithMembers | null {
    const row = this.db
      .prepare(
        `SELECT m.* FROM matches m
         JOIN rooms r ON m.room_id = r.id
         WHERE r.code = ? COLLATE NOCASE`,
      )
      .get(roomCode.trim().toUpperCase()) as DbMatchRow | undefined;

    if (!row) return null;

    const match = mapMatchRow(row);
    const members = this.listMatchMembers(match.id);
    return { match, members };
  }

  findMatchById(matchId: MatchId): MatchWithMembers | null {
    const row = this.db
      .prepare("SELECT * FROM matches WHERE id = ?")
      .get(matchId) as DbMatchRow | undefined;

    if (!row) return null;

    const match = mapMatchRow(row);
    const members = this.listMatchMembers(match.id);
    return { match, members };
  }

  listMatchMembers(matchId: MatchId): readonly MatchMemberRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM match_members WHERE match_id = ? ORDER BY player_order ASC",
      )
      .all(matchId) as DbMatchMemberRow[];

    return rows.map(mapMemberRow);
  }

  findPlayerForRoomMember(
    matchId: MatchId,
    roomMemberId: RoomMemberId,
  ): PlayerId | null {
    const row = this.db
      .prepare(
        "SELECT player_id FROM match_members WHERE match_id = ? AND room_member_id = ?",
      )
      .get(matchId, roomMemberId) as { player_id: string } | undefined;

    return row ? asPlayerId(row.player_id) : null;
  }

  findCommandReceipt(
    matchId: MatchId,
    actorPlayerId: PlayerId,
    commandId: string,
  ): CommandReceiptRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM command_receipts
         WHERE match_id = ? AND actor_player_id = ? AND command_id = ?`,
      )
      .get(matchId, actorPlayerId, commandId) as
      | DbCommandReceiptRow
      | undefined;

    return row ? mapReceiptRow(row) : null;
  }

  recordRejectedReceipt(
    input: RecordRejectedReceiptInput,
  ): CommandReceiptRecord {
    const nowIso = new Date().toISOString();
    const errorMessage = input.errorMessage ?? null;

    this.db
      .prepare(
        `INSERT INTO command_receipts (
          match_id, actor_player_id, command_id, payload_hash,
          outcome, error_code, error_message, resulting_revision, accepted_sequence, created_at
        ) VALUES (?, ?, ?, ?, 'REJECTED', ?, ?, ?, NULL, ?)`,
      )
      .run(
        input.matchId,
        input.actorPlayerId,
        input.commandId,
        input.payloadHash,
        input.errorCode,
        errorMessage,
        input.resultingRevision,
        nowIso,
      );

    return {
      matchId: input.matchId,
      actorPlayerId: input.actorPlayerId,
      commandId: input.commandId,
      payloadHash: input.payloadHash,
      outcome: "REJECTED",
      errorCode: input.errorCode,
      errorMessage,
      resultingRevision: input.resultingRevision,
      acceptedSequence: null,
      createdAt: nowIso,
    };
  }

  commitAcceptedCommand(input: CommitAcceptedCommandInput): {
    sequence: number;
    receipt: CommandReceiptRecord;
  } {
    const nowIso = new Date().toISOString();
    const nextSnapshotJson = JSON.stringify(input.nextState);

    if (input.nextRevision !== input.expectedPreviousRevision + 1) {
      throw new MatchError(
        "INVALID_REVISION_TRANSITION",
        `Accepted command must increment revision by exactly 1 (expected ${input.expectedPreviousRevision + 1}, got ${input.nextRevision})`,
        500,
      );
    }

    if (input.nextState.revision !== input.nextRevision) {
      throw new MatchError(
        "INVALID_REVISION_TRANSITION",
        `Snapshot state revision must match nextRevision (state has ${input.nextState.revision}, expected ${input.nextRevision})`,
        500,
      );
    }

    return this.db.transaction(() => {
      // 1. Verify revision still equals expected previous revision
      const currentMatch = this.db
        .prepare("SELECT revision FROM matches WHERE id = ?")
        .get(input.matchId) as { revision: number } | undefined;

      if (!currentMatch) {
        throw new MatchError("MATCH_NOT_FOUND", "Match does not exist", 404);
      }

      if (currentMatch.revision !== input.expectedPreviousRevision) {
        throw new MatchError(
          "STALE_REVISION",
          `Revision conflict: expected ${input.expectedPreviousRevision}, current ${currentMatch.revision}`,
          409,
        );
      }

      // 2. Allocate next sequence
      const seqRow = this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) + 1 as nextSeq FROM match_commands WHERE match_id = ?",
        )
        .get(input.matchId) as { nextSeq: number };
      const sequence = seqRow.nextSeq;

      // 3. Insert match_commands
      this.db
        .prepare(
          `INSERT INTO match_commands (
            match_id, sequence, actor_player_id, command_id, command_type,
            payload_json, payload_hash, previous_revision, resulting_revision, accepted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.matchId,
          sequence,
          input.actorPlayerId,
          input.commandId,
          input.commandType,
          input.payloadJson,
          input.payloadHash,
          input.expectedPreviousRevision,
          input.nextRevision,
          nowIso,
        );

      // 4. Insert emitted events if any
      if (input.events && input.events.length > 0) {
        const insertEventStmt = this.db.prepare(
          `INSERT INTO match_events (match_id, command_sequence, event_index, event_kind, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        );
        let eventIndex = 0;
        for (const ev of input.events) {
          insertEventStmt.run(
            input.matchId,
            sequence,
            eventIndex++,
            ev.eventKind,
            ev.payloadJson,
          );
        }
      }

      // 5. Insert command_receipts
      this.db
        .prepare(
          `INSERT INTO command_receipts (
            match_id, actor_player_id, command_id, payload_hash,
            outcome, error_code, error_message, resulting_revision, accepted_sequence, created_at
          ) VALUES (?, ?, ?, ?, 'ACCEPTED', NULL, NULL, ?, ?, ?)`,
        )
        .run(
          input.matchId,
          input.actorPlayerId,
          input.commandId,
          input.payloadHash,
          input.nextRevision,
          sequence,
          nowIso,
        );

      // 6. Update matches snapshot_json, revision, updated_at
      const updateResult = this.db
        .prepare(
          `UPDATE matches
           SET snapshot_json = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          nextSnapshotJson,
          input.nextRevision,
          nowIso,
          input.matchId,
          input.expectedPreviousRevision,
        );

      if (updateResult.changes !== 1) {
        throw new MatchError(
          "STALE_REVISION",
          "Revision conflict detected during snapshot update",
          409,
        );
      }

      const receipt: CommandReceiptRecord = {
        matchId: input.matchId,
        actorPlayerId: input.actorPlayerId,
        commandId: input.commandId,
        payloadHash: input.payloadHash,
        outcome: "ACCEPTED",
        errorCode: null,
        errorMessage: null,
        resultingRevision: input.nextRevision,
        acceptedSequence: sequence,
        createdAt: nowIso,
      };

      return { sequence, receipt };
    })();
  }

  listActiveMatches(): readonly {
    readonly match: MatchRecord;
    readonly roomCode: string;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, r.code as room_code
         FROM matches m
         JOIN rooms r ON m.room_id = r.id
         WHERE m.status = 'ACTIVE'`,
      )
      .all() as (DbMatchRow & { room_code: string })[];

    return rows.map((r) => ({
      match: mapMatchRow(r),
      roomCode: r.room_code,
    }));
  }

  findRoomWithMembers(roomCode: string): {
    readonly room: {
      readonly id: RoomId;
      readonly code: string;
      readonly status: string;
      readonly hostMemberId: RoomMemberId;
    };
    readonly members: readonly MatchRoomMember[];
  } | null {
    const normalizedCode = roomCode.trim().toUpperCase();
    const roomRow = this.db
      .prepare(
        "SELECT id, code, status, host_member_id as hostMemberId FROM rooms WHERE code = ? COLLATE NOCASE",
      )
      .get(normalizedCode) as
      | { id: string; code: string; status: string; hostMemberId: string }
      | undefined;

    if (!roomRow) return null;

    const memberRows = this.db
      .prepare(
        `SELECT id, room_id as roomId, nickname, nickname_key as nicknameKey,
                join_order as joinOrder, created_at as createdAt
         FROM room_members WHERE room_id = ? ORDER BY join_order ASC`,
      )
      .all(roomRow.id) as Array<{
      id: string;
      roomId: string;
      nickname: string;
      nicknameKey: string;
      joinOrder: number;
      createdAt: string;
    }>;

    return {
      room: {
        id: asRoomId(roomRow.id),
        code: roomRow.code,
        status: roomRow.status,
        hostMemberId: asRoomMemberId(roomRow.hostMemberId),
      },
      members: memberRows.map((m) => ({
        id: asRoomMemberId(m.id),
        roomId: asRoomId(m.roomId),
        nickname: m.nickname,
        nicknameKey: m.nicknameKey,
        joinOrder: m.joinOrder,
        createdAt: m.createdAt,
      })),
    };
  }
}
