import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type GameServer } from "../src/createServer.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import {
  openDatabase,
  type SqliteDatabase,
} from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

describe("HTTP Lobby Routes", () => {
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
        rateLimitDisabled: false,
      },
      repository: repo,
    });
    await server.fastify.ready();
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("POST /api/rooms creates room and issues HttpOnly session cookie", async () => {
    const res = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "HostPlayer" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.room.code).toHaveLength(6);
    expect(body.room.status).toBe("OPEN");
    expect(body.room.capacity).toBe(4);
    expect(body.room.memberCount).toBe(1);
    expect(body.room.members[0].nickname).toBe("HostPlayer");
    expect(body.room.members[0].isHost).toBe(true);

    expect(body.self.memberId).toBe(body.room.members[0].memberId);
    expect(body.self.recoveryCode).toBeDefined();

    // Verify session cookie
    const cookies = res.cookies;
    const sessionCookie = cookies.find(
      (c) => c.name === "finance_game_session",
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Strict");
    expect(sessionCookie?.path).toBe("/");
    expect(sessionCookie?.secure).toBeFalsy();
  });

  it("POST /api/rooms respects cookieSecure config when enabled", async () => {
    const secureServer = createServer({
      config: {
        host: "127.0.0.1",
        port: 3000,
        dbPath: ":memory:",
        cookieSecure: true,
        rateLimitDisabled: true,
      },
      repository: repo,
    });
    await secureServer.fastify.ready();

    const res = await secureServer.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "SecurePlayer" },
    });

    const sessionCookie = res.cookies.find(
      (c) => c.name === "finance_game_session",
    );
    expect(sessionCookie?.secure).toBe(true);
    await secureServer.close();
  });

  it("POST /api/rooms/:roomCode/join joins room and returns private recovery code", async () => {
    const createRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const code = JSON.parse(createRes.body).room.code;

    const joinRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/join`,
      payload: { nickname: "Joiner" },
    });

    expect(joinRes.statusCode).toBe(201);
    const body = JSON.parse(joinRes.body);
    expect(body.room.memberCount).toBe(2);
    expect(body.room.members[1].nickname).toBe("Joiner");
    expect(body.self.recoveryCode).toBeDefined();
  });

  it("GET /api/rooms/:roomCode returns authorized lobby view and rejects unauthorized requests", async () => {
    const createRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const code = JSON.parse(createRes.body).room.code;
    const sessionCookie = createRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )!;

    // Unauthenticated GET (missing cookie)
    const unauthRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${code}`,
    });
    expect(unauthRes.statusCode).toBe(401);
    expect(JSON.parse(unauthRes.body).error.code).toBe("UNAUTHENTICATED");

    // Authenticated GET with valid cookie
    const authRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${code}`,
      cookies: { finance_game_session: sessionCookie.value },
    });
    expect(authRes.statusCode).toBe(200);
    const body = JSON.parse(authRes.body);
    expect(body.room.code).toBe(code);
    expect(body.room.members).toHaveLength(1);
    expect(body.self.memberId).toBeDefined();
    // Verify recovery codes are NOT exposed in GET room response
    expect(body.room.members[0].recoveryCode).toBeUndefined();
    expect(body.self.recoveryCode).toBeUndefined();

    // Authenticated but not a member of another room
    const otherRoomRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "OtherHost" },
    });
    const otherCode = JSON.parse(otherRoomRes.body).room.code;

    const forbiddenRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${otherCode}`,
      cookies: { finance_game_session: sessionCookie.value },
    });
    expect(forbiddenRes.statusCode).toBe(403);
    expect(JSON.parse(forbiddenRes.body).error.code).toBe("NOT_A_ROOM_MEMBER");
  });

  it("GET /api/session returns authorized active memberships", async () => {
    const createRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const code = JSON.parse(createRes.body).room.code;
    const sessionCookie = createRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )!;

    const sessionRes = await server.fastify.inject({
      method: "GET",
      url: "/api/session",
      cookies: { finance_game_session: sessionCookie.value },
    });

    expect(sessionRes.statusCode).toBe(200);
    const body = JSON.parse(sessionRes.body);
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].roomCode).toBe(code);
    expect(body.memberships[0].nickname).toBe("Host");
    expect(body.memberships[0].roomStatus).toBe("OPEN");
  });

  it("POST /api/rooms/:roomCode/recover reclaims seat and invalidates old session", async () => {
    const createRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "RecoverMe" },
    });
    const createBody = JSON.parse(createRes.body);
    const code = createBody.room.code;
    const recoveryCode = createBody.self.recoveryCode;
    const oldCookie = createRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )!;

    // Recover on a new client (no cookies)
    const recoverRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/recover`,
      payload: { recoveryCode },
    });

    expect(recoverRes.statusCode).toBe(200);
    const recoverBody = JSON.parse(recoverRes.body);
    expect(recoverBody.self.memberId).toBe(createBody.self.memberId);
    expect(recoverBody.room.members[0].nickname).toBe("RecoverMe");

    const newCookie = recoverRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )!;
    expect(newCookie.value).not.toBe(oldCookie.value);

    // Old cookie is revoked
    const oldRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${code}`,
      cookies: { finance_game_session: oldCookie.value },
    });
    expect(oldRes.statusCode).toBe(403);
    expect(JSON.parse(oldRes.body).error.code).toBe("NOT_A_ROOM_MEMBER");
  });

  it("POST /api/rooms/:roomCode/recovery-code rotates recovery code", async () => {
    const createRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "RotateMe" },
    });
    const code = JSON.parse(createRes.body).room.code;
    const oldRecoveryCode = JSON.parse(createRes.body).self.recoveryCode;
    const cookie = createRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )!;

    const rotateRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/recovery-code`,
      cookies: { finance_game_session: cookie.value },
    });

    expect(rotateRes.statusCode).toBe(200);
    const newRecoveryCode = JSON.parse(rotateRes.body).recoveryCode;
    expect(newRecoveryCode).not.toBe(oldRecoveryCode);

    // Old recovery code fails
    const failRecover = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/recover`,
      payload: { recoveryCode: oldRecoveryCode },
    });
    expect(failRecover.statusCode).toBe(401);

    // New recovery code succeeds
    const succeedRecover = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${code}/recover`,
      payload: { recoveryCode: newRecoveryCode },
    });
    expect(succeedRecover.statusCode).toBe(200);
  });

  it("enforces same-origin validation on state-changing requests", async () => {
    // 1. Same-origin matches Host: OK
    const okRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
      payload: { nickname: "GoodOrigin" },
    });
    expect(okRes.statusCode).toBe(201);

    // 2. Mismatched origin: 403 Forbidden
    const badRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      headers: {
        host: "localhost:3000",
        origin: "http://attacker.com",
      },
      payload: { nickname: "EvilOrigin" },
    });
    expect(badRes.statusCode).toBe(403);
    expect(JSON.parse(badRes.body).error.code).toBe("FORBIDDEN");

    // 3. Missing origin: OK (for test/API clients)
    const noOriginRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      headers: {
        host: "localhost:3000",
      },
      payload: { nickname: "NoOrigin" },
    });
    expect(noOriginRes.statusCode).toBe(201);
  });

  it("enforces rate limits on room creation bursts", async () => {
    // Limits: 10 create requests per minute per IP
    const responses = [];
    for (let i = 0; i < 12; i++) {
      const res = await server.fastify.inject({
        method: "POST",
        url: "/api/rooms",
        payload: { nickname: `Player${i}` },
      });
      responses.push(res);
    }

    const rateLimited = responses.filter((r) => r.statusCode === 429);
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
    const firstRateLimited = rateLimited[0];
    expect(firstRateLimited).toBeDefined();
    if (!firstRateLimited) throw new Error("Expected rate limited response");
    const errBody = JSON.parse(firstRateLimited.body);
    expect(errBody.error.code).toBe("RATE_LIMITED");
  });
});
