import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as roomCodeModule from "../src/lobby/roomCode.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import {
  openDatabase,
  type SqliteDatabase,
} from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

function requireSessionToken(result: { sessionToken?: string }): string {
  expect(result.sessionToken).toBeDefined();
  if (!result.sessionToken) {
    throw new Error("Expected sessionToken to be defined");
  }
  return result.sessionToken;
}

describe("SqliteLobbyRepository", () => {
  let db: SqliteDatabase;
  let repo: SqliteLobbyRepository;

  beforeEach(() => {
    vi.restoreAllMocks();
    db = openDatabase({ dbPath: ":memory:" });
    runMigrations(db, migrationsDir);
    repo = new SqliteLobbyRepository(db);
  });

  it("retries safely on room code collisions", () => {
    // Force first code to be COLLID, second to be UNIQUE
    let callCount = 0;
    vi.spyOn(roomCodeModule, "generateRoomCode").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return "COLLID";
      }
      return "UNIQUE";
    });

    // Seed a room with code COLLID
    db.prepare(
      `INSERT INTO rooms (id, code, status, host_member_id, created_at, updated_at, last_activity_at)
       VALUES ('r1', 'COLLID', 'OPEN', 'm1', '2026-09-08', '2026-09-08', '2026-09-08')`,
    ).run();

    const result = repo.createRoomWithHost({ nickname: "Maya" });
    expect(result.room.code).toBe("UNIQUE");
    expect(callCount).toBe(2);
  });

  it("fails atomically when room code retries are exhausted", () => {
    // Always return COLLID
    vi.spyOn(roomCodeModule, "generateRoomCode").mockReturnValue("COLLID");

    // Seed a room with code COLLID
    db.prepare(
      `INSERT INTO rooms (id, code, status, host_member_id, created_at, updated_at, last_activity_at)
       VALUES ('r1', 'COLLID', 'OPEN', 'm1', '2026-09-08', '2026-09-08', '2026-09-08')`,
    ).run();

    const membersBefore = db
      .prepare("SELECT COUNT(*) as count FROM room_members")
      .get() as { count: number };
    const sessionsBefore = db
      .prepare("SELECT COUNT(*) as count FROM browser_sessions")
      .get() as { count: number };

    expect(() => repo.createRoomWithHost({ nickname: "Maya" })).toThrowError(
      expect.objectContaining({
        code: "ROOM_CODE_EXHAUSTED",
        statusCode: 500,
      }),
    );

    // Verify atomicity: no orphan room, member, or session created
    const membersAfter = db
      .prepare("SELECT COUNT(*) as count FROM room_members")
      .get() as { count: number };
    const sessionsAfter = db
      .prepare("SELECT COUNT(*) as count FROM browser_sessions")
      .get() as { count: number };
    expect(membersAfter.count).toBe(membersBefore.count);
    expect(sessionsAfter.count).toBe(sessionsBefore.count);
  });

  it("creator becomes first member (join order 0) and room host", () => {
    const result = repo.createRoomWithHost({ nickname: "Maya" });

    expect(result.room.code).toHaveLength(6);
    expect(result.room.status).toBe("OPEN");
    expect(result.room.capacity).toBe(4);
    expect(result.room.memberCount).toBe(1);
    expect(result.room.members).toHaveLength(1);

    const host = result.room.members[0];
    expect(host?.nickname).toBe("Maya");
    expect(host?.joinOrder).toBe(0);
    expect(host?.isHost).toBe(true);
    expect(host?.memberId).toBe(result.self.memberId);
    expect(result.self.recoveryCode).toBeDefined();
    expect(result.sessionToken).toBeDefined();
  });

  it("handles lowercase room-code input on join and resolves correctly", () => {
    const createRes = repo.createRoomWithHost({ nickname: "Host" });
    const lowerCode = createRes.room.code.toLowerCase();

    const joinRes = repo.joinRoom({
      roomCode: lowerCode,
      nickname: "Player2",
    });

    expect(joinRes.room.code).toBe(createRes.room.code);
    expect(joinRes.room.memberCount).toBe(2);
    expect(joinRes.room.members[1]?.nickname).toBe("Player2");
    expect(joinRes.room.members[1]?.joinOrder).toBe(1);
    expect(joinRes.room.members[1]?.isHost).toBe(false);
  });

  it("assigns deterministic sequential join orders up to 4 members", () => {
    const room = repo.createRoomWithHost({ nickname: "Seat0" });
    const code = room.room.code;

    const j1 = repo.joinRoom({ roomCode: code, nickname: "Seat1" });
    const j2 = repo.joinRoom({ roomCode: code, nickname: "Seat2" });
    const j3 = repo.joinRoom({ roomCode: code, nickname: "Seat3" });

    expect(j1.room.members.map((m) => m.joinOrder)).toEqual([0, 1]);
    expect(j2.room.members.map((m) => m.joinOrder)).toEqual([0, 1, 2]);
    expect(j3.room.members.map((m) => m.joinOrder)).toEqual([0, 1, 2, 3]);
    expect(j3.room.memberCount).toBe(4);
  });

  it("rejects a fifth member atomically with ROOM_FULL", () => {
    const room = repo.createRoomWithHost({ nickname: "P1" });
    const code = room.room.code;

    repo.joinRoom({ roomCode: code, nickname: "P2" });
    repo.joinRoom({ roomCode: code, nickname: "P3" });
    repo.joinRoom({ roomCode: code, nickname: "P4" });

    // 5th player attempts to join
    expect(() =>
      repo.joinRoom({ roomCode: code, nickname: "P5" }),
    ).toThrowError(
      expect.objectContaining({
        code: "ROOM_FULL",
        statusCode: 409,
      }),
    );

    // Verify room state is completely unchanged
    const countRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM room_members WHERE room_id = (SELECT id FROM rooms WHERE code = ?)",
      )
      .get(code) as { count: number };
    expect(countRow.count).toBe(4);
  });

  it("rejects duplicate nicknames within the same room including case-equivalent names", () => {
    const room = repo.createRoomWithHost({ nickname: "Alex" });
    const code = room.room.code;

    expect(() =>
      repo.joinRoom({ roomCode: code, nickname: "alex" }),
    ).toThrowError(
      expect.objectContaining({
        code: "NICKNAME_TAKEN",
        statusCode: 409,
      }),
    );

    expect(() =>
      repo.joinRoom({ roomCode: code, nickname: "  ALEX  " }),
    ).toThrowError(
      expect.objectContaining({
        code: "NICKNAME_TAKEN",
        statusCode: 409,
      }),
    );
  });

  it("rejects when the caller browser session is already a member of the room", () => {
    const room = repo.createRoomWithHost({ nickname: "Alex" });
    const code = room.room.code;
    const sessionToken = room.sessionToken;

    expect(() =>
      repo.joinRoom({
        roomCode: code,
        nickname: "Sam",
        existingSessionToken: sessionToken,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ALREADY_MEMBER",
        statusCode: 409,
      }),
    );
  });

  it("allows a single browser session to hold membership grants in multiple rooms", () => {
    const room1 = repo.createRoomWithHost({ nickname: "Alex" });
    const sessionToken = requireSessionToken(room1);

    const room2 = repo.createRoomWithHost({
      nickname: "Alex",
      existingSessionToken: sessionToken,
    });

    const bootstrap = repo.getSessionBootstrap(sessionToken);
    expect(bootstrap).toHaveLength(2);
    const codes = bootstrap.map((b) => b.roomCode);
    expect(codes).toContain(room1.room.code);
    expect(codes).toContain(room2.room.code);
  });

  it("authorizes getRoomLobbyView for members and rejects non-members", () => {
    const room1 = repo.createRoomWithHost({ nickname: "Alex" });
    const room2 = repo.createRoomWithHost({ nickname: "Charlie" });
    const sessionToken1 = requireSessionToken(room1);

    // Session 1 in room 1 can read room 1
    const view1 = repo.getRoomLobbyView({
      roomCode: room1.room.code,
      sessionToken: sessionToken1,
    });
    expect(view1.room.code).toBe(room1.room.code);
    expect(view1.self.memberId).toBe(room1.self.memberId);

    // Session 1 cannot read room 2 (not a member)
    expect(() =>
      repo.getRoomLobbyView({
        roomCode: room2.room.code,
        sessionToken: sessionToken1,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "NOT_A_ROOM_MEMBER",
        statusCode: 403,
      }),
    );
  });

  it("rejects unauthenticated, expired, or revoked sessions", () => {
    expect(() => repo.getSessionBootstrap("non-existent-token")).toThrowError(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        statusCode: 401,
      }),
    );

    // Test expired session
    const room = repo.createRoomWithHost({ nickname: "P1" });
    const token = requireSessionToken(room);
    db.prepare(
      "UPDATE browser_sessions SET expires_at = '2020-01-01T00:00:00.000Z'",
    ).run();

    expect(() => repo.getSessionBootstrap(token)).toThrowError(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        statusCode: 401,
      }),
    );

    // Test revoked session
    db.prepare(
      "UPDATE browser_sessions SET expires_at = '2030-01-01T00:00:00.000Z', revoked_at = '2026-09-08T00:00:00.000Z'",
    ).run();

    expect(() => repo.getSessionBootstrap(token)).toThrowError(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        statusCode: 401,
      }),
    );
  });

  it("updates browser_sessions.last_used_at on authenticated use without extending expires_at", () => {
    const room = repo.createRoomWithHost({ nickname: "Host" });
    const token = requireSessionToken(room);

    // Check initial timestamps
    const initialSession = db
      .prepare(
        "SELECT last_used_at, expires_at FROM browser_sessions WHERE id = (SELECT session_id FROM session_memberships LIMIT 1)",
      )
      .get() as { last_used_at: string; expires_at: string };

    // Set last_used_at to an older timestamp to detect update
    const pastTimestamp = "2026-09-08T00:00:00.000Z";
    db.prepare("UPDATE browser_sessions SET last_used_at = ?").run(
      pastTimestamp,
    );

    // Perform authenticated read
    const view = repo.getRoomLobbyView({
      roomCode: room.room.code,
      sessionToken: token,
    });
    expect(view.room.code).toBe(room.room.code);

    const updatedSession = db
      .prepare(
        "SELECT last_used_at, expires_at FROM browser_sessions WHERE id = (SELECT session_id FROM session_memberships LIMIT 1)",
      )
      .get() as { last_used_at: string; expires_at: string };

    // last_used_at must be updated to a newer timestamp
    expect(updatedSession.last_used_at).not.toBe(pastTimestamp);
    expect(new Date(updatedSession.last_used_at).getTime()).toBeGreaterThan(
      new Date(pastTimestamp).getTime(),
    );

    // expires_at must remain untouched
    expect(updatedSession.expires_at).toBe(initialSession.expires_at);
  });

  it("recovers membership on a new browser: reclaims exact same seat and revokes previous session authority", () => {
    const created = repo.createRoomWithHost({ nickname: "Host" });
    const roomCode = created.room.code;
    const oldSessionToken = requireSessionToken(created);
    const recoveryCode = created.self.recoveryCode;
    const originalMemberId = created.self.memberId;

    // Recover from a separate browser without a session
    const recovered = repo.recoverMembership({
      roomCode,
      recoveryCode,
    });

    expect(recovered.self.memberId).toBe(originalMemberId);
    expect(recovered.room.members[0]?.memberId).toBe(originalMemberId);
    expect(recovered.room.members[0]?.joinOrder).toBe(0);
    expect(recovered.room.members[0]?.isHost).toBe(true);
    expect(recovered.room.members[0]?.nickname).toBe("Host");

    const newSessionToken = requireSessionToken(recovered);
    expect(newSessionToken).not.toBe(oldSessionToken);

    // New session now has authority
    const newView = repo.getRoomLobbyView({
      roomCode,
      sessionToken: newSessionToken,
    });
    expect(newView.self.memberId).toBe(originalMemberId);

    // Old session authority has been revoked for this member!
    expect(() =>
      repo.getRoomLobbyView({
        roomCode,
        sessionToken: oldSessionToken,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "NOT_A_ROOM_MEMBER",
        statusCode: 403,
      }),
    );
  });

  it("rejects recovery if the recovering session already controls a different member in the same room", () => {
    // 1. Host creates room
    const hostRoom = repo.createRoomWithHost({ nickname: "Host" });
    const roomCode = hostRoom.room.code;
    const hostRecoveryCode = hostRoom.self.recoveryCode;

    // 2. Member2 joins room on their own session
    const member2Room = repo.joinRoom({
      roomCode,
      nickname: "Member2",
    });
    const member2SessionToken = requireSessionToken(member2Room);

    // 3. Member2 attempts to recover Host's seat using Host's recovery code while logged in as Member2
    expect(() =>
      repo.recoverMembership({
        roomCode,
        recoveryCode: hostRecoveryCode,
        existingSessionToken: member2SessionToken,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ALREADY_MEMBER",
        statusCode: 409,
      }),
    );

    // Verify atomicity: Member2 still controls Member2
    const m2View = repo.getRoomLobbyView({
      roomCode,
      sessionToken: member2SessionToken,
    });
    expect(m2View.self.memberId).toBe(member2Room.self.memberId);

    // Host still controls Host
    const hostView = repo.getRoomLobbyView({
      roomCode,
      sessionToken: requireSessionToken(hostRoom),
    });
    expect(hostView.self.memberId).toBe(hostRoom.self.memberId);
  });

  it("invalid recovery does not revoke the existing valid controlling grant", () => {
    const created = repo.createRoomWithHost({ nickname: "Host" });
    const roomCode = created.room.code;
    const sessionToken = requireSessionToken(created);

    // Attempt invalid recovery
    expect(() =>
      repo.recoverMembership({
        roomCode,
        recoveryCode: "invalid-wrong-code",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_RECOVERY_CREDENTIAL",
        statusCode: 401,
      }),
    );

    // The original session is still fully authorized
    const view = repo.getRoomLobbyView({
      roomCode,
      sessionToken,
    });
    expect(view.self.memberId).toBe(created.self.memberId);
  });

  it("rotates recovery code: old code immediately invalid, new code works", () => {
    const created = repo.createRoomWithHost({ nickname: "Host" });
    const roomCode = created.room.code;
    const sessionToken = requireSessionToken(created);
    const oldRecoveryCode = created.self.recoveryCode;

    const rotated = repo.rotateRecoveryCode({
      roomCode,
      sessionToken,
    });

    expect(rotated.recoveryCode).not.toBe(oldRecoveryCode);
    const newRecoveryCode = rotated.recoveryCode;

    // Attempt recovery with old code -> must fail
    expect(() =>
      repo.recoverMembership({
        roomCode,
        recoveryCode: oldRecoveryCode,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_RECOVERY_CREDENTIAL",
        statusCode: 401,
      }),
    );

    // Recovery with new code -> succeeds
    const recovered = repo.recoverMembership({
      roomCode,
      recoveryCode: newRecoveryCode,
    });
    expect(recovered.self.memberId).toBe(created.self.memberId);
  });
});
