import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandAckResult, MatchPlayerView } from "@interests/shared";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/createServer.js";
import { recoverActiveMatchesOnStartup } from "../src/match/startupRecovery.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import { openDatabase } from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";
import { SqliteMatchRepository } from "../src/persistence/sqlite/SqliteMatchRepository.js";
import {
  SOCKET_CLIENT_EVENTS,
  SOCKET_ERROR_CODES,
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
      `interests-matchservice-test-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
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

  async function createAndFillRoom(): Promise<{
    roomCode: string;
    cookies: string[];
  }> {
    const hostRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const hostBody = JSON.parse(hostRes.body);
    const roomCode = hostBody.room.code;
    const hostCookie = hostRes.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;
    if (!hostCookie) throw new Error("Host cookie missing");

    const p2Res = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/join`,
      payload: { nickname: "Player2" },
    });
    const p2Cookie = p2Res.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;
    if (!p2Cookie) throw new Error("P2 cookie missing");

    const p3Res = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/join`,
      payload: { nickname: "Player3" },
    });
    const p3Cookie = p3Res.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;
    if (!p3Cookie) throw new Error("P3 cookie missing");

    const p4Res = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/join`,
      payload: { nickname: "Player4" },
    });
    const p4Cookie = p4Res.cookies.find(
      (c) => c.name === "finance_game_session",
    )?.value;
    if (!p4Cookie) throw new Error("P4 cookie missing");

    return {
      roomCode,
      cookies: [hostCookie, p2Cookie, p3Cookie, p4Cookie],
    };
  }

  function connectSocket(
    cookieVal: string,
    roomCode: string,
  ): Promise<{ socket: ClientSocket; bootstrap: BootstrapPayload }> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${serverPort}`, {
        transports: ["websocket"],
        extraHeaders: {
          cookie: `finance_game_session=${cookieVal}`,
          origin: `http://127.0.0.1:${serverPort}`,
        },
        auth: {
          protocolVersion: "1",
          roomCode,
        },
        forceNew: true,
      });

      clientSockets.push(socket);

      socket.once(
        SOCKET_SERVER_EVENTS.BOOTSTRAP,
        (bootstrap: BootstrapPayload) => {
          resolve({ socket, bootstrap });
        },
      );

      socket.once("connect_error", (err: Error) => {
        reject(err);
      });
    });
  }

  function syncSocket(socket: ClientSocket, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: generation },
        (res: { ok: boolean; error?: { message: string } }) => {
          if (res?.ok) resolve();
          else reject(new Error(res?.error?.message ?? "Sync failed"));
        },
      );
    });
  }

  it("prevents match start if caller is non-host or players not synchronized", async () => {
    const { roomCode, cookies } = await createAndFillRoom();
    const hostCookie = cookies[0];
    const nonHostCookie = cookies[1];
    if (!hostCookie || !nonHostCookie) throw new Error("Cookies missing");

    // 1. Non-host start attempt is rejected with 403 NOT_ROOM_HOST
    const nonHostRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: nonHostCookie },
    });
    expect(nonHostRes.statusCode).toBe(403);
    const nonHostBody = JSON.parse(nonHostRes.body);
    expect(nonHostBody.error.code).toBe("NOT_ROOM_HOST");

    // 2. Host start attempt before all four connected & synchronized is rejected
    const unsyncedStartRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    expect(unsyncedStartRes.statusCode).toBe(409);
    const unsyncedBody = JSON.parse(unsyncedStartRes.body);
    expect(unsyncedBody.error.code).toBe("ROOM_NOT_READY");
  });

  it("starts match atomically when four members connect and synchronize", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    // Connect & sync all four
    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    // Host starts match
    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    expect(startRes.statusCode).toBe(200);
    const startBody = JSON.parse(startRes.body);
    expect(startBody.match).toBeDefined();
    expect(startBody.match.revision).toBe(0);
    expect(startBody.match.self.offeredObjectiveIds).toHaveLength(2);

    // Each player can fetch their own personalized view
    const p2Cookie = cookies[1];
    if (!p2Cookie) throw new Error("P2 cookie missing");
    const p2MatchRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { finance_game_session: p2Cookie },
    });
    expect(p2MatchRes.statusCode).toBe(200);
    const p2View = JSON.parse(p2MatchRes.body).match as MatchPlayerView;

    // Verify objective privacy: host view does NOT contain P2 offered objectives
    const hostViewJson = JSON.stringify(startBody.match);
    const p2Offer0 = p2View.self.offeredObjectiveIds[0];
    const p2Offer1 = p2View.self.offeredObjectiveIds[1];
    if (!p2Offer0 || !p2Offer1) throw new Error("Missing p2 offers");
    expect(hostViewJson).not.toContain(p2Offer0);
    expect(hostViewJson).not.toContain(p2Offer1);

    // HTTP match view endpoint check
    const getMatchRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { finance_game_session: hostCookie },
    });
    expect(getMatchRes.statusCode).toBe(200);
    expect(getMatchRes.headers["cache-control"]).toBe("no-store");
    const getMatchBody = JSON.parse(getMatchRes.body);
    expect(getMatchBody.match.matchId).toBe(startBody.match.matchId);

    // Idempotent second start
    const secondStartRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
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
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    // Host starts match
    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    const startBody = JSON.parse(startRes.body);
    const hostView = startBody.match as MatchPlayerView;
    const chosenObjective = hostView.self.offeredObjectiveIds[0];
    if (!chosenObjective) throw new Error("Missing chosen objective");

    const p1Socket = clients[0]?.socket;
    if (!p1Socket) throw new Error("Missing p1 socket");

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

    const ack1 = await new Promise<CommandAckResult>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        commandEnvelope,
        (res: CommandAckResult) => {
          resolve(res);
        },
      );
    });

    expect(ack1.ok).toBe(true);
    if (!ack1.ok) throw new Error("Command failed");
    expect(ack1.outcome).toBe("ACCEPTED");
    expect(ack1.revision).toBe(1);

    const broadcastedView = await nextViewPromise;
    expect(broadcastedView.revision).toBe(1);
    expect(broadcastedView.self.selectedObjectiveId).toBe(chosenObjective);

    // 2. Retry identical command (lost ack recovery): returns identical receipt without incrementing revision
    const ackRetry = await new Promise<CommandAckResult>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        commandEnvelope,
        (res: CommandAckResult) => {
          resolve(res);
        },
      );
    });

    expect(ackRetry.ok).toBe(true);
    if (!ackRetry.ok) throw new Error("Retry failed");
    expect(ackRetry.outcome).toBe("ACCEPTED");
    expect(ackRetry.revision).toBe(1);

    // 3. Reusing the same commandId with changed payload is rejected with COMMAND_ID_REUSED
    const secondOffer = hostView.self.offeredObjectiveIds[1];
    if (!secondOffer) throw new Error("Missing second offer");
    const reusedIdEnvelope = {
      commandId, // SAME id
      expectedRevision: 1, // DIFFERENT payload
      command: {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: secondOffer,
      },
    };

    const ackReused = await new Promise<CommandAckResult>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        reusedIdEnvelope,
        (res: CommandAckResult) => {
          resolve(res);
        },
      );
    });

    expect(ackReused.ok).toBe(false);
    if (ackReused.ok) throw new Error("Expected failure");
    expect(ackReused.error.code).toBe("COMMAND_ID_REUSED");

    // 4. Stale revision rejection: new commandId with expectedRevision 0 when match is at revision 1
    const staleEnvelope = {
      commandId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      expectedRevision: 0,
      command: {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: secondOffer,
      },
    };

    const ackStale = await new Promise<CommandAckResult>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        staleEnvelope,
        (res: CommandAckResult) => {
          resolve(res);
        },
      );
    });

    expect(ackStale.ok).toBe(false);
    if (ackStale.ok) throw new Error("Expected failure");
    expect(ackStale.error.code).toBe("STALE_REVISION");
  });

  it("blocks new commands while room is paused, but allows receipt retries with preserved error detail", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    // Host starts match
    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    const startBody = JSON.parse(startRes.body);
    const hostView = startBody.match as MatchPlayerView;
    const p1Socket = clients[0]?.socket;
    if (!p1Socket) throw new Error("Missing p1 socket");

    const firstOffer = hostView.self.offeredObjectiveIds[0];
    const secondOffer = hostView.self.offeredObjectiveIds[1];
    if (!firstOffer || !secondOffer)
      throw new Error("Missing objective offers");

    // Execute first command successfully
    const commandId1 = "11111111-1111-4111-8111-111111111111";
    const ack1 = await new Promise<CommandAckResult>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: commandId1,
          expectedRevision: 0,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: firstOffer,
          },
        },
        (res: CommandAckResult) => resolve(res),
      );
    });
    expect(ack1.ok).toBe(true);

    // Disconnect player 4 to trigger DISCONNECTED_MEMBER pause
    clients[3]?.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const pauseReasons = lobbyRepo.getPauseReasons(roomCode);
    expect(pauseReasons).toContain("DISCONNECTED_MEMBER");

    // Attempt NEW command while paused -> rejected ROOM_PAUSED
    const commandId2 = "22222222-2222-4222-8222-222222222222";
    const ackPaused = await new Promise<CommandAckResult>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: commandId2,
          expectedRevision: 1,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: secondOffer,
          },
        },
        (res: CommandAckResult) => resolve(res),
      );
    });
    expect(ackPaused.ok).toBe(false);
    if (ackPaused.ok) throw new Error("Expected failure");
    expect(ackPaused.error.code).toBe("ROOM_PAUSED");

    // Retry of rejected commandId2 returns original error code and message
    const ackRetryRejected = await new Promise<CommandAckResult>((resolve) => {
      p1Socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: commandId2,
          expectedRevision: 1,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: secondOffer,
          },
        },
        (res: CommandAckResult) => resolve(res),
      );
    });
    expect(ackRetryRejected.ok).toBe(false);
    if (ackRetryRejected.ok) throw new Error("Expected failure");
    expect(ackRetryRejected.error.code).toBe("ROOM_PAUSED");
    expect(ackRetryRejected.error.message).toContain("Room is paused");

    // Retry of previous committed commandId1 WHILE PAUSED succeeds with original receipt!
    const ackRetryWhilePaused = await new Promise<CommandAckResult>(
      (resolve) => {
        p1Socket.emit(
          SOCKET_CLIENT_EVENTS.COMMAND,
          {
            commandId: commandId1,
            expectedRevision: 0,
            command: {
              type: "CHOOSE_OBJECTIVE",
              objectiveId: firstOffer,
            },
          },
          (res: CommandAckResult) => resolve(res),
        );
      },
    );
    expect(ackRetryWhilePaused.ok).toBe(true);
    if (!ackRetryWhilePaused.ok) throw new Error("Retry while paused failed");
    expect(ackRetryWhilePaused.outcome).toBe("ACCEPTED");
    expect(ackRetryWhilePaused.revision).toBe(1);
  });

  it("handles concurrent match start requests idempotently without race conditions", async () => {
    const { roomCode, cookies } = await createAndFillRoom();
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    // Fire two start requests concurrently
    const [start1, start2] = await Promise.all([
      server.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/start`,
        cookies: { finance_game_session: hostCookie },
      }),
      server.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/start`,
        cookies: { finance_game_session: hostCookie },
      }),
    ]);

    expect(start1.statusCode).toBe(200);
    expect(start2.statusCode).toBe(200);

    const body1 = JSON.parse(start1.body);
    const body2 = JSON.parse(start2.body);
    expect(body1.match.matchId).toBe(body2.match.matchId);
    expect(body1.match.revision).toBe(0);

    // Exactly one match exists in the database
    const matchCount = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM matches WHERE room_id = (SELECT id FROM rooms WHERE code = ?)",
      )
      .get(roomCode) as { cnt: number };
    expect(matchCount.cnt).toBe(1);
  });

  it("serializes concurrent command submissions through RoomCommandQueue", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    const startBody = JSON.parse(startRes.body);
    const hostView = startBody.match as MatchPlayerView;

    const p2Cookie = cookies[1];
    if (!p2Cookie) throw new Error("P2 cookie missing");
    const p2Res = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { finance_game_session: p2Cookie },
    });
    const p2View = JSON.parse(p2Res.body).match as MatchPlayerView;

    const p1Socket = clients[0]?.socket;
    const p2Socket = clients[1]?.socket;
    if (!p1Socket || !p2Socket) throw new Error("Missing sockets");

    const p1Obj = hostView.self.offeredObjectiveIds[0];
    const p2Obj = p2View.self.offeredObjectiveIds[0];
    if (!p1Obj || !p2Obj) throw new Error("Missing objectives");

    // Both players fire commands concurrently with expectedRevision: 0
    const [ack1, ack2] = await Promise.all([
      new Promise<CommandAckResult>((resolve) => {
        p1Socket.emit(
          SOCKET_CLIENT_EVENTS.COMMAND,
          {
            commandId: "12345678-1234-4234-8234-123456789abc",
            expectedRevision: 0,
            command: { type: "CHOOSE_OBJECTIVE", objectiveId: p1Obj },
          },
          (res: CommandAckResult) => resolve(res),
        );
      }),
      new Promise<CommandAckResult>((resolve) => {
        p2Socket.emit(
          SOCKET_CLIENT_EVENTS.COMMAND,
          {
            commandId: "87654321-4321-4321-8321-cba987654321",
            expectedRevision: 0,
            command: { type: "CHOOSE_OBJECTIVE", objectiveId: p2Obj },
          },
          (res: CommandAckResult) => resolve(res),
        );
      }),
    ]);

    // One must be accepted at revision 1, the other must be rejected with STALE_REVISION
    const outcomes = [ack1, ack2];
    const accepted = outcomes.find((a) => a.ok === true);
    const rejected = outcomes.find((a) => a.ok === false);

    expect(accepted).toBeDefined();
    expect(rejected).toBeDefined();
    if (!accepted || !rejected)
      throw new Error("Expected one pass and one fail");

    if (accepted.ok) {
      expect(accepted.revision).toBe(1);
    }
    if (!rejected.ok) {
      expect(rejected.error.code).toBe("STALE_REVISION");
    }

    // Match revision is cleanly 1
    const match = matchRepo.findMatchByRoomCode(roomCode);
    expect(match?.match.revision).toBe(1);
  });

  it("recovers lost ack when client disconnects after commit and retries on reconnection", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    const hostView = JSON.parse(startRes.body).match as MatchPlayerView;
    const chosenObjective = hostView.self.offeredObjectiveIds[0];
    if (!chosenObjective) throw new Error("Missing objective");

    const lostCommandId = "fedcba98-7654-4321-8210-fedcba987654";
    const p1Socket = clients[0]?.socket;
    if (!p1Socket) throw new Error("Missing p1 socket");

    // Client emits command without consuming ack and immediately disconnects
    p1Socket.emit(SOCKET_CLIENT_EVENTS.COMMAND, {
      commandId: lostCommandId,
      expectedRevision: 0,
      command: { type: "CHOOSE_OBJECTIVE", objectiveId: chosenObjective },
    });

    // Allow commit to complete on server
    await new Promise((r) => setTimeout(r, 150));
    p1Socket.disconnect();

    // Client reconnects with persistent session cookie
    const reconnected = await connectSocket(hostCookie, roomCode);
    await syncSocket(
      reconnected.socket,
      reconnected.bootstrap.self.connectionGeneration,
    );

    // Client retries same commandId
    const retryAck = await new Promise<CommandAckResult>((resolve) => {
      reconnected.socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: lostCommandId,
          expectedRevision: 0,
          command: { type: "CHOOSE_OBJECTIVE", objectiveId: chosenObjective },
        },
        (res: CommandAckResult) => resolve(res),
      );
    });

    expect(retryAck.ok).toBe(true);
    if (!retryAck.ok) throw new Error("Retry failed");
    expect(retryAck.outcome).toBe("ACCEPTED");
    expect(retryAck.revision).toBe(1);

    // Total commands committed in match remains exactly 1
    const match = matchRepo.findMatchByRoomCode(roomCode);
    expect(match?.match.revision).toBe(1);
  });

  it("detects persisted metadata corruption, activates SYSTEM_FAULT, and returns safe generic error", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });

    // Deliberately corrupt the persisted match record: tamper revision column to 999
    db.prepare(
      "UPDATE matches SET revision = 999 WHERE room_id = (SELECT id FROM rooms WHERE code = ?)",
    ).run(roomCode);

    // 1. GET /api/rooms/:roomCode/match should return 500 SYSTEM_FAULT with safe generic message
    const getRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { finance_game_session: hostCookie },
    });

    expect(getRes.statusCode).toBe(500);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.error.code).toBe("SYSTEM_FAULT");
    expect(getBody.error.message).toBe(
      "Match state is inconsistent or corrupted",
    );
    // Must NOT leak parser or invariant details
    expect(getBody.error.message).not.toContain("revision");

    // 2. Room pause reasons now contains SYSTEM_FAULT
    const pauseReasons = lobbyRepo.getPauseReasons(roomCode);
    expect(pauseReasons).toContain("SYSTEM_FAULT");

    // 3. Stored database data is preserved (not deleted or wiped)
    const corruptedMatch = matchRepo.findMatchByRoomCode(roomCode);
    expect(corruptedMatch).toBeDefined();
    expect(corruptedMatch?.match.revision).toBe(999);
  });

  it("detects swapped/corrupted RoomMember mappings, activates SYSTEM_FAULT, and fails closed without leaking private views across startup/HTTP/bootstrap", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    const player2Cookie = cookies[1];
    if (!hostCookie || !player2Cookie) throw new Error("Cookie missing");

    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    expect(startRes.statusCode).toBe(200);
    const startBody = JSON.parse(startRes.body);
    const matchId = startBody.match.matchId;

    // Fetch members before swap
    const membersBefore = db
      .prepare(
        "SELECT room_member_id, player_order, player_id FROM match_members WHERE match_id = ? ORDER BY player_order ASC",
      )
      .all(matchId) as Array<{
      room_member_id: string;
      player_order: number;
      player_id: string;
    }>;
    expect(membersBefore).toHaveLength(4);

    const m0 = membersBefore[0];
    const m1 = membersBefore[1];
    if (!m0 || !m1) throw new Error("Missing members before swap");

    // Swap the player_order of member 0 and member 1
    // (This corrupts the lobby joinOrder -> match member playerOrder mapping:
    //  room member with join_order 0 is now mapped to player_order 1 and vice versa,
    //  while keeping player_order 0..3 and player-1..player-4 internally intact)
    db.prepare(
      "UPDATE match_members SET player_order = 99 WHERE match_id = ? AND player_order = 0",
    ).run(matchId);
    db.prepare(
      "UPDATE match_members SET player_order = 0 WHERE match_id = ? AND player_order = 1",
    ).run(matchId);
    db.prepare(
      "UPDATE match_members SET player_order = 1 WHERE match_id = ? AND player_order = 99",
    ).run(matchId);

    // 1. Prove startup recovery fails closed: detects corruption and activates SYSTEM_FAULT
    recoverActiveMatchesOnStartup(matchRepo, lobbyRepo);
    const pauseReasons = lobbyRepo.getPauseReasons(roomCode);
    expect(pauseReasons).toContain("SYSTEM_FAULT");

    // 2. Prove HTTP getMatchView fails closed with safe generic error and does NOT expose swapped player's view
    const httpRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { finance_game_session: hostCookie },
    });
    expect(httpRes.statusCode).toBe(500);
    const httpBody = JSON.parse(httpRes.body);
    expect(httpBody.error.code).toBe("SYSTEM_FAULT");
    expect(httpBody.error.message).toBe(
      "Match state is inconsistent or corrupted",
    );
    // Ensure no private objective cards or internal player details leaked in error message
    expect(httpBody.error.message).not.toContain("player-1");
    expect(httpBody.error.message).not.toContain("player-2");

    // 3. Prove realtime bootstrap fails closed: connect new socket for player 2
    // Bootstrap must have match: null and carry SYSTEM_FAULT in pause reasons
    const c2 = await connectSocket(player2Cookie, roomCode);
    expect(c2.bootstrap.match).toBeNull();
    expect(c2.bootstrap.pause.reasons).toContain("SYSTEM_FAULT");
    expect(c2.bootstrap.presence.pauseReasons).toContain("SYSTEM_FAULT");
  });

  it("forces a command persistence/commit failure through Socket.IO and proves safe error ack with no unhandled rejection", async () => {
    const { roomCode, cookies } = await createAndFillRoom();

    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error("Cookie missing");
      const c = await connectSocket(cookie, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const hostCookie = cookies[0];
    if (!hostCookie) throw new Error("Host cookie missing");

    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { finance_game_session: hostCookie },
    });
    const hostView = JSON.parse(startRes.body).match as MatchPlayerView;
    const chosenObjective = hostView.self.offeredObjectiveIds[0];
    if (!chosenObjective) throw new Error("Missing objective");

    const p1Socket = clients[0]?.socket;
    if (!p1Socket) throw new Error("Missing p1 socket");

    // Force commitAcceptedCommand on matchRepo to throw an unexpected database failure
    const originalCommit = matchRepo.commitAcceptedCommand.bind(matchRepo);
    let commitCalled = false;
    matchRepo.commitAcceptedCommand = () => {
      commitCalled = true;
      throw new Error(
        "Simulated SQLite disk/write failure during commitAcceptedCommand",
      );
    };

    try {
      const commandId = "33333333-3333-4333-8333-333333333333";
      const ack = await new Promise<CommandAckResult>((resolve) => {
        p1Socket.emit(
          SOCKET_CLIENT_EVENTS.COMMAND,
          {
            commandId,
            expectedRevision: 0,
            command: {
              type: "CHOOSE_OBJECTIVE",
              objectiveId: chosenObjective,
            },
          },
          (res: CommandAckResult) => resolve(res),
        );
      });

      expect(commitCalled).toBe(true);
      expect(ack.ok).toBe(false);
      if (ack.ok) throw new Error("Expected failure ack");
      expect(ack.commandId).toBe(commandId);
      expect(ack.error.code).toBe(SOCKET_ERROR_CODES.INTERNAL_ERROR);
      expect(ack.error.message).toBe(
        "An internal error occurred while executing command",
      );
      // Ensure revision did not advance
      const match = matchRepo.findMatchByRoomCode(roomCode);
      expect(match?.match.revision).toBe(0);
    } finally {
      matchRepo.commitAcceptedCommand = originalCommit;
    }
  });
});
