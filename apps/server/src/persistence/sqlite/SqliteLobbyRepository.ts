import crypto from "node:crypto";
import {
  asBrowserSessionId,
  asRoomId,
  asRoomMemberId,
  type RoomMemberId,
} from "@finance-game/shared";
import type Database from "better-sqlite3";
import {
  digestCredential,
  generateBearerToken,
} from "../../lobby/credentials.js";
import { LobbyError } from "../../lobby/errors.js";
import { normalizeAndValidateNickname } from "../../lobby/nickname.js";
import { generateRoomCode, normalizeRoomCode } from "../../lobby/roomCode.js";
import type {
  BrowserSessionRecord,
  CreateRoomResult,
  JoinRoomResult,
  LobbyRepository,
  RecoverMembershipResult,
  RoomLobbyView,
  RoomMemberView,
  SessionBootstrapMembership,
} from "../../lobby/types.js";

const MAX_ROOM_CODE_RETRIES = 10;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionResolution {
  session: BrowserSessionRecord;
  sessionToken?: string;
  isNew: boolean;
}

export class SqliteLobbyRepository implements LobbyRepository {
  constructor(private readonly db: Database.Database) {}

  private resolveOrCreateSession(existingToken?: string): SessionResolution {
    const now = new Date();
    const nowIso = now.toISOString();

    if (existingToken && typeof existingToken === "string") {
      const digest = digestCredential(existingToken);
      const row = this.db
        .prepare(
          `SELECT id, credential_digest as credentialDigest, created_at as createdAt,
                  expires_at as expiresAt, last_used_at as lastUsedAt, revoked_at as revokedAt
           FROM browser_sessions WHERE credential_digest = ?`,
        )
        .get(digest) as BrowserSessionRecord | undefined;

      if (row && row.revokedAt === null) {
        const expiresTime = new Date(row.expiresAt).getTime();
        if (expiresTime > now.getTime()) {
          // Session is valid; update last_used_at
          this.db
            .prepare(
              "UPDATE browser_sessions SET last_used_at = ? WHERE id = ?",
            )
            .run(nowIso, row.id);
          row.lastUsedAt = nowIso;
          return { session: row, isNew: false };
        }
      }
    }

    // Create a new session
    const token = generateBearerToken();
    const digest = digestCredential(token);
    const id = asBrowserSessionId(crypto.randomUUID());
    const expiresAt = new Date(
      now.getTime() + SESSION_LIFETIME_MS,
    ).toISOString();

    this.db
      .prepare(
        `INSERT INTO browser_sessions (id, credential_digest, created_at, expires_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, digest, nowIso, expiresAt, nowIso);

    const session: BrowserSessionRecord = {
      id,
      credentialDigest: digest,
      createdAt: nowIso,
      expiresAt,
      lastUsedAt: nowIso,
      revokedAt: null,
    };

    return { session, sessionToken: token, isNew: true };
  }

  private resolveSession(token?: string): BrowserSessionRecord | null {
    if (!token || typeof token !== "string") {
      return null;
    }

    const digest = digestCredential(token);
    const row = this.db
      .prepare(
        `SELECT id, credential_digest as credentialDigest, created_at as createdAt,
                expires_at as expiresAt, last_used_at as lastUsedAt, revoked_at as revokedAt
         FROM browser_sessions WHERE credential_digest = ?`,
      )
      .get(digest) as BrowserSessionRecord | undefined;

    if (!row || row.revokedAt !== null) {
      return null;
    }

    const expiresTime = new Date(row.expiresAt).getTime();
    if (expiresTime <= Date.now()) {
      return null;
    }

    return row;
  }

  createRoomWithHost(params: {
    nickname: string;
    existingSessionToken?: string;
  }): CreateRoomResult {
    const norm = normalizeAndValidateNickname(params.nickname);

    return this.db.transaction(() => {
      // 1. Allocate unique room code with bounded retries
      let code: string | null = null;
      for (let attempt = 0; attempt < MAX_ROOM_CODE_RETRIES; attempt++) {
        const candidate = generateRoomCode();
        const existing = this.db
          .prepare("SELECT id FROM rooms WHERE code = ?")
          .get(candidate);
        if (!existing) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        throw new LobbyError(
          "ROOM_CODE_EXHAUSTED",
          "Unable to allocate a unique room code after maximum attempts",
          500,
        );
      }

      // 2. Resolve or create browser session
      const { session, sessionToken, isNew } = this.resolveOrCreateSession(
        params.existingSessionToken,
      );

      // 3. Generate IDs and credentials
      const roomId = asRoomId(crypto.randomUUID());
      const memberId = asRoomMemberId(crypto.randomUUID());
      const recoveryCode = generateBearerToken();
      const recoveryDigest = digestCredential(recoveryCode);
      const nowIso = new Date().toISOString();

      // 4. Insert room with OPEN status and creator as host
      this.db
        .prepare(
          `INSERT INTO rooms (id, code, status, host_member_id, created_at, updated_at, last_activity_at)
           VALUES (?, ?, 'OPEN', ?, ?, ?, ?)`,
        )
        .run(roomId, code, memberId, nowIso, nowIso, nowIso);

      // 5. Insert creator member at join order 0
      this.db
        .prepare(
          `INSERT INTO room_members (id, room_id, nickname, nickname_key, join_order, recovery_credential_digest, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          memberId,
          roomId,
          norm.nickname,
          norm.nicknameKey,
          recoveryDigest,
          nowIso,
        );

      // 6. Grant session membership authority
      this.db
        .prepare(
          `INSERT INTO session_memberships (session_id, room_member_id, granted_at, revoked_at)
           VALUES (?, ?, ?, NULL)`,
        )
        .run(session.id, memberId, nowIso);

      const roomView: RoomLobbyView = {
        code,
        status: "OPEN",
        capacity: 4,
        memberCount: 1,
        members: [
          {
            memberId,
            nickname: norm.nickname,
            joinOrder: 0,
            isHost: true,
          },
        ],
      };

      return {
        room: roomView,
        self: {
          memberId,
          recoveryCode,
        },
        sessionToken: isNew ? sessionToken : undefined,
      };
    })();
  }

  joinRoom(params: {
    roomCode: string;
    nickname: string;
    existingSessionToken?: string;
  }): JoinRoomResult {
    const norm = normalizeAndValidateNickname(params.nickname);
    const normalizedCode = normalizeRoomCode(params.roomCode);

    return this.db.transaction(() => {
      // 1. Locate room
      const roomRow = this.db
        .prepare(
          "SELECT id, code, status, host_member_id as hostMemberId FROM rooms WHERE code = ?",
        )
        .get(normalizedCode) as
        | { id: string; code: string; status: string; hostMemberId: string }
        | undefined;

      if (!roomRow) {
        throw new LobbyError("ROOM_NOT_FOUND", "Room not found", 404);
      }

      if (roomRow.status !== "OPEN") {
        throw new LobbyError(
          "ROOM_NOT_OPEN",
          "Room is not open for joining",
          409,
        );
      }

      // 2. Fetch existing members
      const existingMembers = this.db
        .prepare(
          `SELECT id, nickname, nickname_key as nicknameKey, join_order as joinOrder
           FROM room_members WHERE room_id = ? ORDER BY join_order ASC`,
        )
        .all(roomRow.id) as Array<{
        id: string;
        nickname: string;
        nicknameKey: string;
        joinOrder: number;
      }>;

      // Check capacity
      if (existingMembers.length >= 4) {
        throw new LobbyError(
          "ROOM_FULL",
          "Room already has four players.",
          409,
        );
      }

      // Check nickname uniqueness in room
      const nicknameConflict = existingMembers.some(
        (m) => m.nicknameKey === norm.nicknameKey,
      );
      if (nicknameConflict) {
        throw new LobbyError(
          "NICKNAME_TAKEN",
          "Nickname is already taken in this room",
          409,
        );
      }

      // 3. Resolve or create session
      const { session, sessionToken, isNew } = this.resolveOrCreateSession(
        params.existingSessionToken,
      );

      // 4. Verify session is not already a member of this room
      const existingGrant = this.db
        .prepare(
          `SELECT sm.room_member_id FROM session_memberships sm
           JOIN room_members rm ON sm.room_member_id = rm.id
           WHERE sm.session_id = ? AND rm.room_id = ? AND sm.revoked_at IS NULL`,
        )
        .get(session.id, roomRow.id);

      if (existingGrant) {
        throw new LobbyError(
          "ALREADY_MEMBER",
          "This browser session is already a member of this room",
          409,
        );
      }

      // 5. Insert member with deterministic next join_order
      const nextJoinOrder = existingMembers.length;
      const memberId = asRoomMemberId(crypto.randomUUID());
      const recoveryCode = generateBearerToken();
      const recoveryDigest = digestCredential(recoveryCode);
      const nowIso = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO room_members (id, room_id, nickname, nickname_key, join_order, recovery_credential_digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          memberId,
          roomRow.id,
          norm.nickname,
          norm.nicknameKey,
          nextJoinOrder,
          recoveryDigest,
          nowIso,
        );

      // 6. Grant session membership
      this.db
        .prepare(
          `INSERT INTO session_memberships (session_id, room_member_id, granted_at, revoked_at)
           VALUES (?, ?, ?, NULL)`,
        )
        .run(session.id, memberId, nowIso);

      // 7. Update room timestamps
      this.db
        .prepare(
          "UPDATE rooms SET updated_at = ?, last_activity_at = ? WHERE id = ?",
        )
        .run(nowIso, nowIso, roomRow.id);

      // 8. Build member list
      const membersView: RoomMemberView[] = [
        ...existingMembers.map((m) => ({
          memberId: asRoomMemberId(m.id),
          nickname: m.nickname,
          joinOrder: m.joinOrder,
          isHost: m.id === roomRow.hostMemberId,
        })),
        {
          memberId,
          nickname: norm.nickname,
          joinOrder: nextJoinOrder,
          isHost: false,
        },
      ];

      return {
        room: {
          code: roomRow.code,
          status: roomRow.status,
          capacity: 4,
          memberCount: membersView.length,
          members: membersView,
        },
        self: {
          memberId,
          recoveryCode,
        },
        sessionToken: isNew ? sessionToken : undefined,
      };
    })();
  }

  getRoomLobbyView(params: { roomCode: string; sessionToken: string }): {
    room: RoomLobbyView;
    self: { memberId: RoomMemberId };
  } {
    const session = this.resolveSession(params.sessionToken);
    if (!session) {
      throw new LobbyError(
        "UNAUTHENTICATED",
        "Valid session cookie required",
        401,
      );
    }

    const normalizedCode = normalizeRoomCode(params.roomCode);

    const roomRow = this.db
      .prepare(
        "SELECT id, code, status, host_member_id as hostMemberId FROM rooms WHERE code = ?",
      )
      .get(normalizedCode) as
      | { id: string; code: string; status: string; hostMemberId: string }
      | undefined;

    if (!roomRow) {
      throw new LobbyError("ROOM_NOT_FOUND", "Room not found", 404);
    }

    // Verify session has an active grant for a member in this room
    const grant = this.db
      .prepare(
        `SELECT sm.room_member_id as memberId
         FROM session_memberships sm
         JOIN room_members rm ON sm.room_member_id = rm.id
         WHERE sm.session_id = ? AND rm.room_id = ? AND sm.revoked_at IS NULL`,
      )
      .get(session.id, roomRow.id) as { memberId: string } | undefined;

    if (!grant) {
      throw new LobbyError(
        "NOT_A_ROOM_MEMBER",
        "You are not an authorized member of this room",
        403,
      );
    }

    const membersRows = this.db
      .prepare(
        `SELECT id, nickname, join_order as joinOrder
         FROM room_members WHERE room_id = ? ORDER BY join_order ASC`,
      )
      .all(roomRow.id) as Array<{
      id: string;
      nickname: string;
      joinOrder: number;
    }>;

    const members: RoomMemberView[] = membersRows.map((m) => ({
      memberId: asRoomMemberId(m.id),
      nickname: m.nickname,
      joinOrder: m.joinOrder,
      isHost: m.id === roomRow.hostMemberId,
    }));

    return {
      room: {
        code: roomRow.code,
        status: roomRow.status,
        capacity: 4,
        memberCount: members.length,
        members,
      },
      self: {
        memberId: asRoomMemberId(grant.memberId),
      },
    };
  }

  getSessionBootstrap(sessionToken: string): SessionBootstrapMembership[] {
    const session = this.resolveSession(sessionToken);
    if (!session) {
      throw new LobbyError(
        "UNAUTHENTICATED",
        "Valid session cookie required",
        401,
      );
    }

    const rows = this.db
      .prepare(
        `SELECT r.code as roomCode, rm.id as memberId, rm.nickname, r.status as roomStatus
         FROM session_memberships sm
         JOIN room_members rm ON sm.room_member_id = rm.id
         JOIN rooms r ON rm.room_id = r.id
         WHERE sm.session_id = ? AND sm.revoked_at IS NULL
         ORDER BY sm.granted_at DESC`,
      )
      .all(session.id) as Array<{
      roomCode: string;
      memberId: string;
      nickname: string;
      roomStatus: string;
    }>;

    return rows.map((r) => ({
      roomCode: r.roomCode,
      memberId: asRoomMemberId(r.memberId),
      nickname: r.nickname,
      roomStatus: r.roomStatus,
    }));
  }

  recoverMembership(params: {
    roomCode: string;
    recoveryCode: string;
    existingSessionToken?: string;
  }): RecoverMembershipResult {
    if (!params.recoveryCode || typeof params.recoveryCode !== "string") {
      throw new LobbyError(
        "INVALID_INPUT",
        "Recovery code must be a non-empty string",
        400,
      );
    }

    const normalizedCode = normalizeRoomCode(params.roomCode);

    return this.db.transaction(() => {
      // 1. Locate room
      const roomRow = this.db
        .prepare(
          "SELECT id, code, status, host_member_id as hostMemberId FROM rooms WHERE code = ?",
        )
        .get(normalizedCode) as
        | { id: string; code: string; status: string; hostMemberId: string }
        | undefined;

      if (!roomRow) {
        throw new LobbyError("ROOM_NOT_FOUND", "Room not found", 404);
      }

      // 2. Locate member by recovery digest
      const recoveryDigest = digestCredential(params.recoveryCode.trim());
      const memberRow = this.db
        .prepare(
          `SELECT id, nickname, join_order as joinOrder
           FROM room_members WHERE room_id = ? AND recovery_credential_digest = ?`,
        )
        .get(roomRow.id, recoveryDigest) as
        | { id: string; nickname: string; joinOrder: number }
        | undefined;

      if (!memberRow) {
        // Must reject without modifying authorization
        throw new LobbyError(
          "INVALID_RECOVERY_CREDENTIAL",
          "Invalid recovery code for this room",
          401,
        );
      }

      // 3. Resolve or create caller's browser session
      const { session, sessionToken, isNew } = this.resolveOrCreateSession(
        params.existingSessionToken,
      );

      const nowIso = new Date().toISOString();

      // 4. Revoke previous active session memberships for this member
      this.db
        .prepare(
          "UPDATE session_memberships SET revoked_at = ? WHERE room_member_id = ? AND revoked_at IS NULL",
        )
        .run(nowIso, memberRow.id);

      // 5. Grant current browser session authority over this same member
      this.db
        .prepare(
          `INSERT INTO session_memberships (session_id, room_member_id, granted_at, revoked_at)
           VALUES (?, ?, ?, NULL)
           ON CONFLICT(session_id, room_member_id) DO UPDATE SET granted_at = excluded.granted_at, revoked_at = NULL`,
        )
        .run(session.id, memberRow.id, nowIso);

      // 6. Update room activity
      this.db
        .prepare("UPDATE rooms SET last_activity_at = ? WHERE id = ?")
        .run(nowIso, roomRow.id);

      // 7. Fetch all room members for the lobby view
      const membersRows = this.db
        .prepare(
          `SELECT id, nickname, join_order as joinOrder
           FROM room_members WHERE room_id = ? ORDER BY join_order ASC`,
        )
        .all(roomRow.id) as Array<{
        id: string;
        nickname: string;
        joinOrder: number;
      }>;

      const members: RoomMemberView[] = membersRows.map((m) => ({
        memberId: asRoomMemberId(m.id),
        nickname: m.nickname,
        joinOrder: m.joinOrder,
        isHost: m.id === roomRow.hostMemberId,
      }));

      return {
        room: {
          code: roomRow.code,
          status: roomRow.status,
          capacity: 4,
          memberCount: members.length,
          members,
        },
        self: {
          memberId: asRoomMemberId(memberRow.id),
        },
        sessionToken: isNew ? sessionToken : undefined,
      };
    })();
  }

  rotateRecoveryCode(params: { roomCode: string; sessionToken: string }): {
    recoveryCode: string;
  } {
    const session = this.resolveSession(params.sessionToken);
    if (!session) {
      throw new LobbyError(
        "UNAUTHENTICATED",
        "Valid session cookie required",
        401,
      );
    }

    const normalizedCode = normalizeRoomCode(params.roomCode);

    return this.db.transaction(() => {
      const roomRow = this.db
        .prepare("SELECT id FROM rooms WHERE code = ?")
        .get(normalizedCode) as { id: string } | undefined;

      if (!roomRow) {
        throw new LobbyError("ROOM_NOT_FOUND", "Room not found", 404);
      }

      // Verify caller's authority in this room
      const grant = this.db
        .prepare(
          `SELECT sm.room_member_id as memberId
           FROM session_memberships sm
           JOIN room_members rm ON sm.room_member_id = rm.id
           WHERE sm.session_id = ? AND rm.room_id = ? AND sm.revoked_at IS NULL`,
        )
        .get(session.id, roomRow.id) as { memberId: string } | undefined;

      if (!grant) {
        throw new LobbyError(
          "NOT_A_ROOM_MEMBER",
          "You are not an authorized member of this room",
          403,
        );
      }

      // Generate new recovery code and replace digest atomically
      const newRecoveryCode = generateBearerToken();
      const newDigest = digestCredential(newRecoveryCode);
      const nowIso = new Date().toISOString();

      this.db
        .prepare(
          "UPDATE room_members SET recovery_credential_digest = ? WHERE id = ?",
        )
        .run(newDigest, grant.memberId);

      this.db
        .prepare("UPDATE rooms SET last_activity_at = ? WHERE id = ?")
        .run(nowIso, roomRow.id);

      return { recoveryCode: newRecoveryCode };
    })();
  }

  touchSession(sessionToken: string): void {
    if (!sessionToken) return;
    const digest = digestCredential(sessionToken);
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE browser_sessions SET last_used_at = ? WHERE credential_digest = ? AND revoked_at IS NULL",
      )
      .run(nowIso, digest);
  }
}
