import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type GameServer } from "../src/createServer.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import {
  openDatabase,
  type SqliteDatabase,
} from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";
import {
  SOCKET_CLIENT_EVENTS,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_SERVER_EVENTS,
} from "../src/realtime/socketProtocol.js";
import type {
  AckResult,
  BootstrapPayload,
  ResumeData,
  SessionReplacedPayload,
} from "../src/realtime/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

interface ClientSession {
  client: ClientSocket;
  bootstrap: BootstrapPayload;
}

function connectClientWithBootstrap(
  port: number,
  roomCode: string,
  sessionToken: string,
  activeSockets: ClientSocket[],
): Promise<ClientSession> {
  return new Promise((resolve, reject) => {
    const hostHeader = `127.0.0.1:${port}`;
    const client: ClientSocket = ioClient(`http://${hostHeader}`, {
      transports: ["polling", "websocket"],
      autoConnect: false,
      reconnection: false,
      auth: {
        roomCode,
        protocolVersion: SOCKET_PROTOCOL_VERSION,
      },
      extraHeaders: {
        host: hostHeader,
        origin: `http://${hostHeader}`,
        cookie: `finance_game_session=${sessionToken}`,
      },
    });

    activeSockets.push(client);
    client.on("error", () => {});
    client.io.on("error", () => {});

    let bootstrap: BootstrapPayload | null = null;
    let connected = false;

    client.on(SOCKET_SERVER_EVENTS.BOOTSTRAP, (payload: BootstrapPayload) => {
      bootstrap = payload;
      if (connected) {
        resolve({ client, bootstrap });
      }
    });

    client.on("connect_error", (err) => {
      reject(err);
    });

    client.on("connect", () => {
      connected = true;
      if (bootstrap) {
        resolve({ client, bootstrap });
      }
    });

    client.connect();
  });
}

function synchronizeClient(
  client: ClientSocket,
  generation: number,
): Promise<AckResult> {
  return new Promise<AckResult>((resolve) => {
    client.emit(
      SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
      { connectionGeneration: generation },
      (ack: AckResult) => resolve(ack),
    );
  });
}

describe("Realtime Four-Client Integration Flow (PR #18 Manual/Lifecycle Verification)", () => {
  let db: SqliteDatabase;
  let repo: SqliteLobbyRepository;
  let server: GameServer;
  let port: number;
  const activeSockets: ClientSocket[] = [];

  beforeEach(async () => {
    db = openDatabase({ dbPath: ":memory:" });
    runMigrations(db, migrationsDir);
    repo = new SqliteLobbyRepository(db);

    server = createServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        dbPath: ":memory:",
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: repo,
    });

    await server.fastify.listen({ host: "127.0.0.1", port: 0 });
    const addr = server.fastify.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of activeSockets) {
      s.removeAllListeners();
      try {
        s.disconnect();
        (s.io as unknown as { _close?: () => void })._close?.();
      } catch {
        // ignore
      }
    }
    activeSockets.length = 0;
    await server.close();
    db.close();
  });

  function at<T>(array: T[], index: number): T {
    const value = array[index];
    if (value === undefined) {
      throw new Error(`Index ${index} out of bounds`);
    }
    return value;
  }

  function expectDefined<T>(val: T | undefined | null): T {
    if (val === undefined || val === null) {
      throw new Error("Expected value to be defined");
    }
    return val;
  }

  it("executes the complete 15-step realtime lifecycle verification", async () => {
    // Step 1: Create room and fill four seats
    const hostCreated = repo.createRoomWithHost({ nickname: "HostPlayer" });
    const roomCode = hostCreated.room.code;

    const p1 = repo.joinRoom({ roomCode, nickname: "Player1" });
    const p2 = repo.joinRoom({ roomCode, nickname: "Player2" });
    const p3 = repo.joinRoom({ roomCode, nickname: "Player3" });

    expect(repo.getRoomLobbyViewByCode(roomCode)?.memberCount).toBe(4);

    const members = [
      {
        info: hostCreated.self,
        token: expectDefined(hostCreated.sessionToken),
      },
      { info: p1.self, token: expectDefined(p1.sessionToken) },
      { info: p2.self, token: expectDefined(p2.sessionToken) },
      { info: p3.self, token: expectDefined(p3.sessionToken) },
    ];

    // Step 2: Connect four Socket.IO clients using their real session cookies
    const clientSessions: ClientSession[] = [];
    for (let i = 0; i < 4; i++) {
      const currentMember = at(members, i);
      const session = await connectClientWithBootstrap(
        port,
        roomCode,
        currentMember.token,
        activeSockets,
      );
      clientSessions.push(session);
      expect(session.client.connected).toBe(true);
      expect(session.bootstrap.self.memberId).toBe(currentMember.info.memberId);
    }

    // Step 3: Acknowledge bootstrap for all four
    for (let i = 0; i < 4; i++) {
      const currentSession = at(clientSessions, i);
      const ack = await synchronizeClient(
        currentSession.client,
        currentSession.bootstrap.self.connectionGeneration,
      );
      expect(ack.ok).toBe(true);
    }

    // Step 4: Confirm all show connected + synchronized and room is armed
    await new Promise((r) => setTimeout(r, 60));
    const presenceAllSync = expectDefined(
      server.coordinator,
    ).buildPresencePayload(roomCode);
    expect(presenceAllSync.allConnected).toBe(true);
    expect(presenceAllSync.allSynchronized).toBe(true);
    expect(
      presenceAllSync.members.every((m) => m.connected && m.synchronized),
    ).toBe(true);
    expect(expectDefined(server.coordinator).isRoomArmed(roomCode)).toBe(true);
    expect(presenceAllSync.pauseReasons).toEqual([]);

    // Step 5: Disconnect one current controller (Player 2)
    at(clientSessions, 2).client.disconnect();
    await new Promise((r) => setTimeout(r, 60));

    // Step 6: Confirm DISCONNECTED_MEMBER is persisted
    const pauseReasonsAfterDisconnect = repo.getPauseReasons(roomCode);
    expect(pauseReasonsAfterDisconnect).toEqual(["DISCONNECTED_MEMBER"]);
    const presenceAfterDisconnect = expectDefined(
      server.coordinator,
    ).buildPresencePayload(roomCode);
    expect(at(presenceAfterDisconnect.members, 2).connected).toBe(false);
    expect(at(presenceAfterDisconnect.members, 2).synchronized).toBe(false);

    // Step 7: Reconnect the same browser/session
    const p2Member = at(members, 2);
    const p2Reconnected = await connectClientWithBootstrap(
      port,
      roomCode,
      p2Member.token,
      activeSockets,
    );
    // Step 8: Confirm same RoomMember identity is restored
    expect(p2Reconnected.bootstrap.self.memberId).toBe(p2Member.info.memberId);
    expect(p2Reconnected.bootstrap.self.connectionGeneration).toBe(2);

    // Synchronize reconnected member
    const p2SyncAck = await synchronizeClient(
      p2Reconnected.client,
      p2Reconnected.bootstrap.self.connectionGeneration,
    );
    expect(p2SyncAck.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 60));

    // Step 9: Confirm pause remains
    expect(repo.getPauseReasons(roomCode)).toEqual(["DISCONNECTED_MEMBER"]);

    // Step 10: Resume from host socket
    const hostSession = at(clientSessions, 0);
    const resumePromise = new Promise<AckResult<ResumeData>>((resolve) => {
      hostSession.client.emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        (ack: AckResult<ResumeData>) => resolve(ack),
      );
    });
    const resumeAck = await resumePromise;

    // Step 11: Confirm pause clears
    expect(resumeAck.ok).toBe(true);
    if (resumeAck.ok) {
      expect(resumeAck.data.pauseReasons).toEqual([]);
    }
    expect(repo.getPauseReasons(roomCode)).toEqual([]);

    // Step 12: Open a second controller for one seat (duplicate tab for Player 1)
    const p1OldSocket = at(clientSessions, 1).client;
    let oldSocketReplacedNotice: SessionReplacedPayload | null = null;
    p1OldSocket.on(
      SOCKET_SERVER_EVENTS.REPLACED,
      (payload: SessionReplacedPayload) => {
        oldSocketReplacedNotice = payload;
      },
    );

    const p1Member = at(members, 1);
    const p1Tab2 = await connectClientWithBootstrap(
      port,
      roomCode,
      p1Member.token,
      activeSockets,
    );

    // Step 13: Confirm the first controller is replaced safely
    await new Promise((r) => setTimeout(r, 60));
    expect(oldSocketReplacedNotice).toEqual({ reason: "NEW_CONTROLLER" });
    expect(p1OldSocket.connected).toBe(false);
    expect(p1Tab2.client.connected).toBe(true);
    expect(p1Tab2.bootstrap.self.connectionGeneration).toBe(2);

    // Step 14: Recover a seat via HTTP from another session (Player 3 recovery)
    const p3OldSocket = at(clientSessions, 3).client;
    let p3ReplacedNotice: SessionReplacedPayload | null = null;
    p3OldSocket.on(
      SOCKET_SERVER_EVENTS.REPLACED,
      (payload: SessionReplacedPayload) => {
        p3ReplacedNotice = payload;
      },
    );

    const recoverRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/recover`,
      payload: { recoveryCode: p3.self.recoveryCode },
    });
    expect(recoverRes.statusCode).toBe(200);

    // Step 15: Confirm the old live controller is invalidated immediately
    await new Promise((r) => setTimeout(r, 60));
    expect(p3ReplacedNotice).toEqual({ reason: "RECOVERY" });
    expect(p3OldSocket.connected).toBe(false);

    // Because room was armed, invalidating P3's controller triggers DISCONNECTED_MEMBER pause
    expect(repo.getPauseReasons(roomCode)).toContain("DISCONNECTED_MEMBER");

    // Recovering browser can now establish a new controlling socket
    const recoveredCookie = recoverRes.cookies.find(
      (c) => c.name === "finance_game_session",
    );
    expect(recoveredCookie).toBeDefined();

    const p3RecoveredSocket = await connectClientWithBootstrap(
      port,
      roomCode,
      expectDefined(recoveredCookie).value,
      activeSockets,
    );
    expect(p3RecoveredSocket.bootstrap.self.memberId).toBe(p3.self.memberId);
    expect(p3RecoveredSocket.client.connected).toBe(true);
  });
});
