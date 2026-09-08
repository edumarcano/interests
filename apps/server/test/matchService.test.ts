import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MatchPlayerView } from "@finance-game/shared";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/createServer.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import { openDatabase } from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";
import { SqliteMatchRepository } from "../src/persistence/sqlite/SqliteMatchRepository.js";
import {
  SOCKET_CLIENT_EVENTS,
  SOCKET_SERVER_EVENTS,
} from "../src/realtime/socketProtocol.js";
import type { BootstrapPayload } from "../src/realtime/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

describe("MatchService and Realtime Pipeline", () => {
  let tempDbPath: string;
  let db: ReturnType<typeof openDatabase>;
  let lobbyRepo: SqliteLobbyRepository;
  let matchRepo: SqliteMatchRepository;
  let server: ReturnType<typeof createServer>;
  let serverPort: number;
  const clientSockets: ClientSocket[] = [];

  beforeEach(async () => {
    tempDbPath = path.join(
      os.tmpdir(),
      `finance-game-matchservice-test-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
    );
    db = openDatabase({ dbPath: tempDbPath });
    runMigrations(db, migrationsDir);
    lobbyRepo = new SqliteLobbyRepository(db);
    matchRepo = new SqliteMatchRepository(db);

    server = createServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        dbPath: tempDbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: lobbyRepo,
      matchRepository: matchRepo,
    });

    await server.fastify.listen({ host: "127.0.0.1", port: 0 });
    const address = server.fastify.server.address();
    serverPort = typeof address === "object" && address ? address.port : 3000;
  });

  afterEach(async () => {
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets.length = 0;

    await server.close();
    db.close();

    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      const wal = `${tempDbPath}-wal`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = `${tempDbPath}-shm`;
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {
      // ignore temporary file cleanup errors
    }
  });

  async function createAndFillRoom() {
    const hostRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const hostBody = JSON.parse(hostRes.body);
    const roomCode = hostBody.room.code;
    const hostCookie = hostRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )!.value;

    const p2Res = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/join`,
      payload: { nickname: "Player2" },
    });
    const p2Cookie = p2Res.cookies.find(
      (c) => c.name === "finance_game_session",
    )!.value;

    const p3Res = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/join`,
      payload: { nickname: "Player3" },
    });
    const p3Cookie = p3Res.cookies.find(
      (c) => c.name === "finance_game_session",
    )!.value;

    const p4Res = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/join`,
      payload: { nickname: "Player4" },
    });
    const p4Cookie = p4Res.cookies.find(
      (c) => c.name === "finance_game_session",
    )!.value;

    return {
      roomCode,
      cookies: [hostCookie, p2Cookie, p3Cookie, p4Cookie],
    };
  }

  function connectSocket(
    cookieValue: string,
    roomCode: string,
  ): Promise<{
    socket: ClientSocket;
    bootstrap: BootstrapPayload;
  }> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${serverPort}`, {
        extraHeaders: {
          cookie: `finance_game_session=${cookieValue}`,
          origin: `http://127.0.0.1:${serverPort}`,
        },
        auth: {
          roomCode,
          protocolVersion: "1",
        },
        transports: ["websocket"],
        forceNew: true,
      });

      clientSockets.push(socket);

      socket.once(
        SOCKET_SERVER_EVENTS.BOOTSTRAP,
        (bootstrap: BootstrapPayload) => {
          resolve({ socket, bootstrap });
        },
      );

      socket.on("connect_error", (err) => {
        reject(err);
      });
    });
  }

  async function syncSocket(
    socket: ClientSocket,
    generation: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: generation },
        (res: any) => {
          if (res?.ok) resolve();
          else reject(new Error(res?.error?.message ?? "Sync failed"));
        },
      );
    });
  }

  it("prevents match start if caller is non-host or players not synchronized", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    // 1. Non-host attempts start via HTTP
    const nonHostRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: cookies[1]! },
    });
    expect(nonHostRes.statusCode).toBe(403);
    const nonHostBody = JSON.parse(nonHostRes.body);
    expect(nonHostBody.error.code).toBe("NOT_ROOM_HOST");

    // 2. Host attempts start before members connect sockets
    const hostResBeforeSync = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: cookies[0]! },
    });
    expect(hostResBeforeSync.statusCode).toBe(409);
    const hostBodyBeforeSync = JSON.parse(hostResBeforeSync.body);
    expect(hostBodyBeforeSync.error.code).toBe("ROOM_NOT_READY");
  });

  it("starts match atomically when four members connect and synchronize", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    // Connect and synchronize all 4 sockets
    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const c = await connectSocket(cookies[i]!, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Register match:view listeners on all 4 sockets
    const receivedViews: Array<Promise<MatchPlayerView>> = clients.map((c) => {
      return new Promise((resolve) => {
        c.socket.once(
          SOCKET_SERVER_EVENTS.MATCH_VIEW,
          (view: MatchPlayerView) => {
            resolve(view);
          },
        );
      });
    });

    // Host starts match
    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: cookies[0]! },
    });
    expect(startRes.statusCode).toBe(200);
    const startBody = JSON.parse(startRes.body);
    expect(startBody.match).toBeDefined();
    expect(startBody.match.revision).toBe(0);
    expect(startBody.match.phase).toBe("objective-choosing");

    // All 4 sockets receive personalized match views
    const views = await Promise.all(receivedViews);
    expect(views).toHaveLength(4);

    // Objective privacy check:
    // Host sees own offers, but not Player 2's offers
    const hostView = views[0]!;
    const p2View = views[1]!;

    expect(hostView.self.offeredObjectiveIds).toHaveLength(2);
    expect(p2View.self.offeredObjectiveIds).toHaveLength(2);

    const hostViewJson = JSON.stringify(hostView);
    expect(hostViewJson).not.toContain(p2View.self.offeredObjectiveIds[0]);
    expect(hostViewJson).not.toContain(p2View.self.offeredObjectiveIds[1]);

    // HTTP match view endpoint check
    const getMatchRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { finance_game_session: cookies[0]! },
    });
    expect(getMatchRes.statusCode).toBe(200);
    expect(getMatchRes.headers["cache-control"]).toBe("no-store");
    const getMatchBody = JSON.parse(getMatchRes.body);
    expect(getMatchBody.match.matchId).toBe(startBody.match.matchId);

    // Idempotent second start
    const secondStartRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: cookies[0]! },
    });
    expect(secondStartRes.statusCode).toBe(200);
    const secondStartBody = JSON.parse(secondStartRes.body);
    expect(secondStartBody.match.matchId).toBe(startBody.match.matchId);
  });

  it("handles CHOOSE_OBJECTIVE command with atomic commit, idempotent retry, and conflict detection", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const c = await connectSocket(cookies[i]!, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Host starts match
    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: cookies[0]! },
    });
    const startBody = JSON.parse(startRes.body);
    const hostView = startBody.match as MatchPlayerView;
    const chosenObjective = hostView.self.offeredObjectiveIds[0]!;

    const p1Socket = clients[0]!.socket;

    // Set up match:view listener to verify broadcast on commit
    const nextViewPromise = new Promise<MatchPlayerView>((resolve) => {
      const handler = (v: MatchPlayerView) => {
        if (v.revision === 1) {
          p1Socket.off(SOCKET_SERVER_EVENTS.MATCH_VIEW, handler);
          resolve(v);
        }
      };
      p1Socket.on(SOCKET_SERVER_EVENTS.MATCH_VIEW, handler);
    });

    // 1. Submit valid CHOOSE_OBJECTIVE
    const commandId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const commandEnvelope = {
      commandId,
      expectedRevision: 0,
      command: {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: chosenObjective,
      },
    };

    const ack1 = await new Promise<any>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        commandEnvelope,
        (res: any) => {
          resolve(res);
        },
      );
    });

    expect(ack1.ok).toBe(true);
    expect(ack1.outcome).toBe("ACCEPTED");
    expect(ack1.revision).toBe(1);

    const broadcastedView = await nextViewPromise;
    expect(broadcastedView.revision).toBe(1);
    expect(broadcastedView.self.selectedObjectiveId).toBe(chosenObjective);

    // 2. Retry identical command (lost ack recovery): returns identical receipt without incrementing revision
    const ackRetry = await new Promise<any>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        commandEnvelope,
        (res: any) => {
          resolve(res);
        },
      );
    });

    expect(ackRetry.ok).toBe(true);
    expect(ackRetry.outcome).toBe("ACCEPTED");
    expect(ackRetry.revision).toBe(1);

    // 3. Reusing the same commandId with changed payload is rejected with COMMAND_ID_REUSED
    const reusedIdEnvelope = {
      commandId, // SAME id
      expectedRevision: 1, // DIFFERENT payload
      command: {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: hostView.self.offeredObjectiveIds[1]!,
      },
    };

    const ackReused = await new Promise<any>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        reusedIdEnvelope,
        (res: any) => {
          resolve(res);
        },
      );
    });

    expect(ackReused.ok).toBe(false);
    expect(ackReused.error.code).toBe("COMMAND_ID_REUSED");

    // 4. Stale revision rejection: new commandId with expectedRevision 0 when match is at revision 1
    const staleEnvelope = {
      commandId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      expectedRevision: 0,
      command: {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: hostView.self.offeredObjectiveIds[1]!,
      },
    };

    const ackStale = await new Promise<any>((resolve) => {
      p1Socket.emit(SOCKET_CLIENT_EVENTS.COMMAND, staleEnvelope, (res: any) => {
        resolve(res);
      });
    });

    expect(ackStale.ok).toBe(false);
    expect(ackStale.error.code).toBe("STALE_REVISION");
  });

  it("blocks new commands while room is paused, but allows receipt retries", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const c = await connectSocket(cookies[i]!, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Host starts match
    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: cookies[0]! },
    });
    const startBody = JSON.parse(startRes.body);
    const hostView = startBody.match as MatchPlayerView;
    const p1Socket = clients[0]!.socket;

    // Execute first command successfully
    const commandId1 = "11111111-1111-4111-8111-111111111111";
    const ack1 = await new Promise<any>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: commandId1,
          expectedRevision: 0,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: hostView.self.offeredObjectiveIds[0]!,
          },
        },
        (res: any) => resolve(res),
      );
    });
    expect(ack1.ok).toBe(true);

    // Disconnect player 4 to trigger DISCONNECTED_MEMBER pause
    clients[3]!.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const pauseReasons = lobbyRepo.getPauseReasons(roomCode);
    expect(pauseReasons).toContain("DISCONNECTED_MEMBER");

    // Attempt NEW command while paused -> rejected ROOM_PAUSED
    const commandId2 = "22222222-2222-4222-8222-222222222222";
    const ackPaused = await new Promise<any>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: commandId2,
          expectedRevision: 1,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: hostView.self.offeredObjectiveIds[1]!,
          },
        },
        (res: any) => resolve(res),
      );
    });
    expect(ackPaused.ok).toBe(false);
    expect(ackPaused.error.code).toBe("ROOM_PAUSED");

    // Retry of previous committed commandId1 WHILE PAUSED succeeds with original receipt!
    const ackRetryWhilePaused = await new Promise<any>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: commandId1,
          expectedRevision: 0,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: hostView.self.offeredObjectiveIds[0]!,
          },
        },
        (res: any) => resolve(res),
      );
    });
    expect(ackRetryWhilePaused.ok).toBe(true);
    expect(ackRetryWhilePaused.outcome).toBe("ACCEPTED");
    expect(ackRetryWhilePaused.revision).toBe(1);
  });
});
