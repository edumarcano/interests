import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/createServer.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import { openDatabase } from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

describe("Restart persistence", () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(
      os.tmpdir(),
      `interests-restart-test-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
    );
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
      const wal = `${tempDbPath}-wal`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = `${tempDbPath}-shm`;
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {
      // Ignore temporary file cleanup errors
    }
  });

  it("retains lobby and session identity across server and database restarts", async () => {
    // 1. Initial process lifecycle
    const db1 = openDatabase({ dbPath: tempDbPath });
    runMigrations(db1, migrationsDir);
    const repo1 = new SqliteLobbyRepository(db1);
    const server1 = createServer({
      config: {
        host: "127.0.0.1",
        port: 3000,
        dbPath: tempDbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: repo1,
    });
    await server1.fastify.ready();

    // 2. Create room and capture session cookie + identity
    const createRes = await server1.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "PersistentHost" },
    });
    expect(createRes.statusCode).toBe(201);
    const createBody = JSON.parse(createRes.body);
    const roomCode = createBody.room.code;
    const memberId = createBody.self.memberId;
    const sessionCookie = createRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;
    expect(sessionCookie).toBeDefined();
    if (!sessionCookie) throw new Error("Session cookie not found");

    await server1.close();
    db1.close();

    // 4. Simulate process restart: reopen the SAME database file
    const db2 = openDatabase({ dbPath: tempDbPath });

    // 5. Run migrations again (must be safe/idempotent)
    const migrationResult = runMigrations(db2, migrationsDir);
    expect(migrationResult.applied).toHaveLength(0); // already applied

    // 6. Recreate repository and server
    const repo2 = new SqliteLobbyRepository(db2);
    const server2 = createServer({
      config: {
        host: "127.0.0.1",
        port: 3000,
        dbPath: tempDbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: repo2,
    });
    await server2.fastify.ready();

    // 7. Call authenticated session bootstrap with the old session cookie
    const sessionRes = await server2.fastify.inject({
      method: "GET",
      url: "/api/session",
      cookies: { finance_game_session: sessionCookie },
    });
    expect(sessionRes.statusCode).toBe(200);
    const sessionBody = JSON.parse(sessionRes.body);
    expect(sessionBody.memberships).toHaveLength(1);
    expect(sessionBody.memberships[0].roomCode).toBe(roomCode);
    expect(sessionBody.memberships[0].memberId).toBe(memberId);
    expect(sessionBody.memberships[0].nickname).toBe("PersistentHost");

    // 8. Call authenticated room lobby view with the old session cookie
    const roomRes = await server2.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}`,
      cookies: { finance_game_session: sessionCookie },
    });
    expect(roomRes.statusCode).toBe(200);
    const roomBody = JSON.parse(roomRes.body);
    expect(roomBody.room.code).toBe(roomCode);
    expect(roomBody.room.status).toBe("OPEN");
    expect(roomBody.room.memberCount).toBe(1);
    expect(roomBody.room.members[0].memberId).toBe(memberId);
    expect(roomBody.room.members[0].isHost).toBe(true);
    expect(roomBody.room.members[0].nickname).toBe("PersistentHost");
    expect(roomBody.self.memberId).toBe(memberId);

    // Clean up server2 and db2
    await server2.close();
    db2.close();
  });
});
