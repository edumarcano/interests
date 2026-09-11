import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeInfoResponse } from "@interests/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/createServer.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import { openDatabase } from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";
import { SqliteMatchRepository } from "../src/persistence/sqlite/SqliteMatchRepository.js";

describe("Server static delivery and runtime-info", () => {
  let tempDir: string;
  let tempDbPath: string;
  let staticRoot: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-server-test-"));
    tempDbPath = path.join(tempDir, "test.sqlite");
    staticRoot = path.join(tempDir, "dist");
    fs.mkdirSync(staticRoot, { recursive: true });
    fs.writeFileSync(
      path.join(staticRoot, "index.html"),
      "<!DOCTYPE html><html><body><div id='root'>Mock Interests App</div></body></html>",
    );
    fs.mkdirSync(path.join(staticRoot, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(staticRoot, "assets", "app.js"),
      "console.log('test asset');",
    );
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("serves static assets and provides SPA fallback to index.html without shadowing APIs", async () => {
    const db = openDatabase({ dbPath: tempDbPath });
    const migrationsDir = path.resolve(__dirname, "../migrations");
    runMigrations(db, migrationsDir);

    const repository = new SqliteLobbyRepository(db);
    const matchRepository = new SqliteMatchRepository(db);

    const server = createServer({
      config: {
        host: "127.0.0.1",
        port: 3999,
        dbPath: tempDbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
        staticRoot,
      },
      repository,
      matchRepository,
      onClose: () => {
        db.close();
      },
    });

    // 1. /api/health responds normally
    const healthRes = await server.fastify.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(JSON.parse(healthRes.body)).toEqual({ status: "ok" });

    // 2. /api/runtime-info responds with public locator data only
    const runtimeRes = await server.fastify.inject({
      method: "GET",
      url: "/api/runtime-info",
    });
    expect(runtimeRes.statusCode).toBe(200);
    const runtimeBody = JSON.parse(runtimeRes.body) as RuntimeInfoResponse;
    expect(Array.isArray(runtimeBody.lanOrigins)).toBe(true);
    // Invariant: no session tokens, recovery codes, or sensitive properties
    expect((runtimeBody as any).sessionToken).toBeUndefined();
    expect((runtimeBody as any).recoveryCode).toBeUndefined();
    expect((runtimeBody as any).seed).toBeUndefined();

    // 3. Static asset file delivery works
    const assetRes = await server.fastify.inject({
      method: "GET",
      url: "/assets/app.js",
    });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.body).toContain("console.log('test asset');");

    // 4. Root / serves index.html
    const rootRes = await server.fastify.inject({
      method: "GET",
      url: "/",
    });
    expect(rootRes.statusCode).toBe(200);
    expect(rootRes.body).toContain("Mock Interests App");

    // 5. Join deep-link /?room=ABC123 serves index.html (SPA routing)
    const deepLinkRes = await server.fastify.inject({
      method: "GET",
      url: "/?room=ABC123",
    });
    expect(deepLinkRes.statusCode).toBe(200);
    expect(deepLinkRes.body).toContain("Mock Interests App");

    // 6. Arbitrary SPA deep path serves index.html
    const spaRes = await server.fastify.inject({
      method: "GET",
      url: "/rooms/ABC123",
    });
    expect(spaRes.statusCode).toBe(200);
    expect(spaRes.body).toContain("Mock Interests App");

    // 7. Non-existent API route returns 404 JSON, not index.html
    const missingApiRes = await server.fastify.inject({
      method: "GET",
      url: "/api/nonexistent",
    });
    expect(missingApiRes.statusCode).toBe(404);
    const missingApiBody = JSON.parse(missingApiRes.body);
    expect(missingApiBody.error?.code).toBe("NOT_FOUND");

    await server.close();
  });

  it("server functions normally when static delivery is not configured", async () => {
    const db = openDatabase({ dbPath: tempDbPath });
    const repository = new SqliteLobbyRepository(db);
    const matchRepository = new SqliteMatchRepository(db);

    const server = createServer({
      config: {
        host: "127.0.0.1",
        port: 3998,
        dbPath: tempDbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository,
      matchRepository,
      onClose: () => {
        db.close();
      },
    });

    const healthRes = await server.fastify.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthRes.statusCode).toBe(200);

    const runtimeRes = await server.fastify.inject({
      method: "GET",
      url: "/api/runtime-info",
    });
    expect(runtimeRes.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(runtimeRes.body).lanOrigins)).toBe(true);

    await server.close();
  });
});
