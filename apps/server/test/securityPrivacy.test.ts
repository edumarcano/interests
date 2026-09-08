import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type GameServer } from "../src/createServer.js";
import { digestCredential } from "../src/lobby/credentials.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import {
  openDatabase,
  type SqliteDatabase,
} from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

describe("Security and Privacy boundaries", () => {
  let db: SqliteDatabase;
  let repo: SqliteLobbyRepository;
  let server: GameServer;

  beforeEach(async () => {
    db = openDatabase({ dbPath: ":memory:" });
    runMigrations(db, migrationsDir);
    repo = new SqliteLobbyRepository(db);

    server = createServer({
      config: {
        host: "127.0.0.1",
        port: 3000,
        dbPath: ":memory:",
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: repo,
    });
    await server.fastify.ready();
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("raw session credentials and raw recovery codes are never stored in SQLite", async () => {
    const createRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Alice" },
    });
    const body = JSON.parse(createRes.body);
    const recoveryCode = body.self.recoveryCode;
    const sessionCookie = createRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;

    expect(recoveryCode).toBeDefined();
    expect(sessionCookie).toBeDefined();
    if (!sessionCookie) throw new Error("sessionCookie not found");

    // Query entire SQLite database for plaintext occurrence of bearer tokens
    const tables = [
      "rooms",
      "room_members",
      "browser_sessions",
      "session_memberships",
    ];
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      const rowsStr = JSON.stringify(rows);

      // Bearer tokens MUST NOT appear in persistent storage
      expect(rowsStr.includes(recoveryCode)).toBe(false);
      expect(rowsStr.includes(sessionCookie)).toBe(false);
    }

    // Verify that only SHA-256 digests are stored
    const expectedRecoveryDigest = digestCredential(recoveryCode);
    const memberRow = db
      .prepare(
        "SELECT recovery_credential_digest FROM room_members WHERE id = ?",
      )
      .get(body.self.memberId) as { recovery_credential_digest: string };
    expect(memberRow.recovery_credential_digest).toBe(expectedRecoveryDigest);

    const expectedSessionDigest = digestCredential(sessionCookie);
    const sessionRow = db
      .prepare(
        "SELECT credential_digest FROM browser_sessions WHERE credential_digest = ?",
      )
      .get(expectedSessionDigest) as { credential_digest: string } | undefined;
    expect(sessionRow).toBeDefined();
  });

  it("lobby responses never contain credential digests or other players' recovery codes", async () => {
    const p1Res = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "P1" },
    });
    const code = JSON.parse(p1Res.body).room.code;
    const p1Cookie = p1Res.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;
    expect(p1Cookie).toBeDefined();
    if (!p1Cookie) throw new Error("p1Cookie not found");

    const p2Res = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/join`,
      payload: { nickname: "P2" },
    });
    const p2RecoveryCode = JSON.parse(p2Res.body).self.recoveryCode;

    // Fetch room view as P1
    const getRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${code}`,
      cookies: { finance_game_session: p1Cookie },
    });
    const getBodyStr = getRes.body;

    // P1 must never see P2's recovery code
    expect(getBodyStr.includes(p2RecoveryCode)).toBe(false);

    // No response should contain SHA-256 hex digests (64 hex characters)
    const digestPattern = /[0-9a-f]{64}/i;
    expect(digestPattern.test(getBodyStr)).toBe(false);
  });

  it("one member cannot fetch another room without a membership grant", async () => {
    const r1 = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Room1Host" },
    });
    const r2 = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Room2Host" },
    });

    const cookie1 = r1.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;
    expect(cookie1).toBeDefined();
    if (!cookie1) throw new Error("cookie1 not found");
    const code2 = JSON.parse(r2.body).room.code;

    // Client with cookie1 attempts to access room 2
    const res = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${code2}`,
      cookies: { finance_game_session: cookie1 },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("NOT_A_ROOM_MEMBER");
  });

  it("room code alone cannot access an authenticated lobby snapshot", async () => {
    const r = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "SecretLobbyHost" },
    });
    const code = JSON.parse(r.body).room.code;

    // Anonymous request without cookie
    const res = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${code}`,
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("nickname alone cannot reclaim a seat", async () => {
    const r = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Maya" },
    });
    const code = JSON.parse(r.body).room.code;

    // Re-joining with existing nickname is rejected
    const joinRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/join`,
      payload: { nickname: "Maya" },
    });
    expect(joinRes.statusCode).toBe(409);
    expect(JSON.parse(joinRes.body).error.code).toBe("NICKNAME_TAKEN");

    // Recovering without bearer recoveryCode is rejected
    const recoverRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/recover`,
      payload: { nickname: "Maya" },
    });
    expect(recoverRes.statusCode).toBe(400);
    expect(JSON.parse(recoverRes.body).error.code).toBe("INVALID_INPUT");
  });
});
