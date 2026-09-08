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
  SOCKET_ERROR_CODES,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_SERVER_EVENTS,
} from "../src/realtime/socketProtocol.js";
import type {
  AckResult,
  BootstrapPayload,
  ResumeData,
  RoomPresencePayload,
  SessionReplacedPayload,
} from "../src/realtime/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

interface ClientOptions {
  roomCode?: string;
  protocolVersion?: string;
  sessionToken?: string;
  origin?: string;
  host?: string;
  auth?: Record<string, unknown>;
  transports?: ("polling" | "websocket")[];
}

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

function connectClient(
  port: number,
  options: ClientOptions = {},
  activeSocketsList?: ClientSocket[],
): Promise<{
  client: ClientSocket;
  bootstrapPromise: Promise<BootstrapPayload>;
}> {
  return new Promise((resolve, reject) => {
    const hostHeader = options.host ?? `127.0.0.1:${port}`;
    const originHeader =
      options.origin !== undefined ? options.origin : `http://${hostHeader}`;
    const extraHeaders: Record<string, string> = {
      host: hostHeader,
    };
    if (originHeader) {
      extraHeaders.origin = originHeader;
    }
    if (options.sessionToken) {
      extraHeaders.cookie = `finance_game_session=${options.sessionToken}`;
    }

    const authPayload: Record<string, unknown> = options.auth ?? {
      roomCode: options.roomCode,
      protocolVersion: options.protocolVersion ?? SOCKET_PROTOCOL_VERSION,
    };

    const client: ClientSocket = ioClient(`http://127.0.0.1:${port}`, {
      transports: options.transports ?? ["polling", "websocket"],
      autoConnect: false,
      reconnection: false,
      auth: authPayload,
      extraHeaders,
    });

    if (activeSocketsList) {
      activeSocketsList.push(client);
    }

    client.on("error", () => {});
    client.io.on("error", () => {});

    let settled = false;

    client.on("connect_error", (err: Error & { data?: unknown }) => {
      if (!settled) {
        settled = true;
        client.disconnect();
        reject(err);
      }
    });

    client.on("connect", () => {
      if (!settled) {
        settled = true;
        const bootstrapPromise = new Promise<BootstrapPayload>((res) => {
          client.once(
            SOCKET_SERVER_EVENTS.BOOTSTRAP,
            (payload: BootstrapPayload) => {
              res(payload);
            },
          );
        });
        resolve({ client, bootstrapPromise });
      }
    });

    client.connect();
  });
}

function waitForEvent<T>(client: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => {
    client.once(event, (data: T) => {
      resolve(data);
    });
  });
}

describe("Realtime Coordinator and Socket Authentication", () => {
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

  function track(client: ClientSocket): ClientSocket {
    activeSockets.push(client);
    return client;
  }

  it("1. missing session cookie rejects Socket.IO connection", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        // no sessionToken
      }),
    ).rejects.toThrow();
  });

  it("2. invalid/expired/revoked session rejects", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });

    // Invalid session token
    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        sessionToken: "invalid_token_xyz_12345",
      }),
    ).rejects.toThrow();

    // Expired session token
    const p1 = repo.joinRoom({
      roomCode: hostCreated.room.code,
      nickname: "Bob",
    });
    const pastIso = new Date(Date.now() - 60000).toISOString();
    db.prepare(
      `UPDATE browser_sessions SET expires_at = ?
       WHERE id = (
         SELECT sm.session_id FROM session_memberships sm
         JOIN room_members rm ON sm.room_member_id = rm.id
         WHERE rm.id = ?
       )`,
    ).run(pastIso, p1.self.memberId);

    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        sessionToken: p1.sessionToken,
      }),
    ).rejects.toThrow();

    // Revoked session token
    const p2 = repo.joinRoom({
      roomCode: hostCreated.room.code,
      nickname: "Charlie",
    });
    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE browser_sessions SET revoked_at = ?
       WHERE id = (
         SELECT sm.session_id FROM session_memberships sm
         JOIN room_members rm ON sm.room_member_id = rm.id
         WHERE rm.id = ?
       )`,
    ).run(nowIso, p2.self.memberId);

    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        sessionToken: p2.sessionToken,
      }),
    ).rejects.toThrow();
  });

  it("3. valid member can connect to authorized room", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const { client, bootstrapPromise } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client);

    expect(client.connected).toBe(true);
    const bootstrap = await bootstrapPromise;
    expect(bootstrap.protocolVersion).toBe(SOCKET_PROTOCOL_VERSION);
    expect(bootstrap.self.memberId).toBe(hostCreated.self.memberId);
    expect(bootstrap.self.connectionGeneration).toBe(1);
  });

  it("4. member cannot connect to a room without a grant", async () => {
    const roomA = repo.createRoomWithHost({ nickname: "Alice" });
    const roomB = repo.createRoomWithHost({ nickname: "Bob" });

    // Alice tries to connect to Room B
    await expect(
      connectClient(port, {
        roomCode: roomB.room.code,
        sessionToken: roomA.sessionToken,
      }),
    ).rejects.toThrow();
  });

  it("5. room code cannot authenticate by itself", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
      }),
    ).rejects.toThrow();
  });

  it("6. malformed handshake auth rejects (or forbidden keys supplied)", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });

    // Empty roomCode
    await expect(
      connectClient(port, {
        roomCode: "",
        sessionToken: hostCreated.sessionToken,
      }),
    ).rejects.toThrow();

    // Supplying memberId in auth
    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        sessionToken: hostCreated.sessionToken,
        auth: {
          roomCode: hostCreated.room.code,
          protocolVersion: "1",
          memberId: hostCreated.self.memberId,
        },
      }),
    ).rejects.toThrow();
  });

  it("7. protocol-version mismatch rejects", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        sessionToken: hostCreated.sessionToken,
        protocolVersion: "999",
      }),
    ).rejects.toThrow();
  });

  it("8. mismatched Origin rejects", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        sessionToken: hostCreated.sessionToken,
        origin: "http://malicious-site.com",
        host: `127.0.0.1:${port}`,
      }),
    ).rejects.toThrow();
  });

  it("8b. missing Origin header rejects", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    await expect(
      connectClient(port, {
        roomCode: hostCreated.room.code,
        sessionToken: hostCreated.sessionToken,
        origin: "",
      }),
    ).rejects.toThrow();
  });

  it("9. valid localhost/LAN-style same-origin handshake succeeds", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const { client } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
      origin: `http://127.0.0.1:${port}`,
      host: `127.0.0.1:${port}`,
    });
    track(client);
    expect(client.connected).toBe(true);
  });

  it("10. bootstrap contains only authorized lobby/session information", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const { client, bootstrapPromise } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client);

    const bootstrap = await bootstrapPromise;
    expect(bootstrap.room.code).toBe(hostCreated.room.code);
    expect(bootstrap.room.members.length).toBe(1);
    expect(bootstrap.self.memberId).toBe(hostCreated.self.memberId);
    expect(bootstrap.presence).toBeDefined();
    expect(bootstrap.pause).toBeDefined();

    // Verify secret leaks are absent
    const str = JSON.stringify(bootstrap);
    expect(str).not.toContain(hostCreated.sessionToken);
    expect(str).not.toContain(hostCreated.self.recoveryCode);
    expect(str).not.toContain("credentialDigest");
    expect(str).not.toContain(client.id);
  });

  it("11. member is connected but unsynchronized before acknowledgement", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const { client, bootstrapPromise } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client);
    await bootstrapPromise;

    const presence = expectDefined(server.coordinator).buildPresencePayload(
      hostCreated.room.code,
    );
    expect(at(presence.members, 0).connected).toBe(true);
    expect(at(presence.members, 0).synchronized).toBe(false);
  });

  it("12. valid synchronization marks the seat synchronized", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const { client, bootstrapPromise } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client);
    const bootstrap = await bootstrapPromise;

    const syncPromise = new Promise<AckResult>((res) => {
      client.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: bootstrap.self.connectionGeneration },
        (ack: AckResult) => res(ack),
      );
    });

    const ack = await syncPromise;
    expect(ack.ok).toBe(true);

    const presence = expectDefined(server.coordinator).buildPresencePayload(
      hostCreated.room.code,
    );
    expect(at(presence.members, 0).connected).toBe(true);
    expect(at(presence.members, 0).synchronized).toBe(true);
  });

  it("13. stale generation cannot synchronize", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const { client, bootstrapPromise } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client);
    await bootstrapPromise;

    const syncPromise = new Promise<AckResult>((res) => {
      client.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: 999 }, // stale / mismatched generation
        (ack: AckResult) => res(ack),
      );
    });

    const ack = await syncPromise;
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe(SOCKET_ERROR_CODES.NOT_CURRENT_CONTROLLER);
    }

    const presence = expectDefined(server.coordinator).buildPresencePayload(
      hostCreated.room.code,
    );
    expect(at(presence.members, 0).synchronized).toBe(false);
  });

  it("14 & 15. second socket replaces first and old socket receives replacement notice", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });

    // First socket
    const { client: client1 } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client1);

    const replacedNoticePromise = waitForEvent<SessionReplacedPayload>(
      client1,
      SOCKET_SERVER_EVENTS.REPLACED,
    );

    // Second socket connects for same member
    const { client: client2, bootstrapPromise: boot2 } = await connectClient(
      port,
      {
        roomCode: hostCreated.room.code,
        sessionToken: hostCreated.sessionToken,
      },
    );
    track(client2);

    const replacedNotice = await replacedNoticePromise;
    expect(replacedNotice.reason).toBe("NEW_CONTROLLER");

    const boot = await boot2;
    expect(boot.self.connectionGeneration).toBe(2);

    // client1 should have been disconnected by server
    await new Promise((r) => setTimeout(r, 50));
    expect(client1.connected).toBe(false);
    expect(client2.connected).toBe(true);
  });

  it("16. delayed old disconnect does not mark the replacement offline", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });

    const { client: client1 } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client1);

    // Connect replacement
    const { client: client2, bootstrapPromise } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client2);
    const boot = await bootstrapPromise;

    // Synchronize client2
    client2.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot.self.connectionGeneration,
    });
    await new Promise((r) => setTimeout(r, 50));

    // client1 now emits disconnect or triggers disconnect handler
    // In our implementation, client1 was already disconnected, but coordinator ignores stale generation
    const presence = expectDefined(server.coordinator).buildPresencePayload(
      hostCreated.room.code,
    );
    expect(at(presence.members, 0).connected).toBe(true);
    expect(at(presence.members, 0).synchronized).toBe(true);
  });

  it("17. presence updates are broadcast to authorized room members", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const user2 = repo.joinRoom({
      roomCode: hostCreated.room.code,
      nickname: "Bob",
    });

    const { client: client1 } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client1);

    const presencePromise = waitForEvent<RoomPresencePayload>(
      client1,
      SOCKET_SERVER_EVENTS.PRESENCE,
    );

    const { client: client2 } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: user2.sessionToken,
    });
    track(client2);

    const presence = await presencePromise;
    expect(presence.members.length).toBe(2);
  });

  it("18. member join causes existing sockets to receive refreshed roster/presence", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });

    const { client: client1 } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client1);

    const presencePromise = waitForEvent<RoomPresencePayload>(
      client1,
      SOCKET_SERVER_EVENTS.PRESENCE,
    );

    // User joins via HTTP route
    const joinRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${hostCreated.room.code}/join`,
      payload: { nickname: "Bob" },
    });
    expect(joinRes.statusCode).toBe(201);

    const updatedPresence = await presencePromise;
    expect(updatedPresence.members.length).toBe(2);
    expect(updatedPresence.members.some((m) => m.nickname === "Bob")).toBe(
      true,
    );
  });

  it("19 & 20. four synchronized members arm the room; pre-armed missing members do not pause", async () => {
    const host = repo.createRoomWithHost({ nickname: "Player0" });
    const roomCode = host.room.code;
    const p1 = repo.joinRoom({ roomCode, nickname: "Player1" });
    const p2 = repo.joinRoom({ roomCode, nickname: "Player2" });
    const p3 = repo.joinRoom({ roomCode, nickname: "Player3" });

    // Connect only 2 players initially
    const { client: c0, bootstrapPromise: b0 } = await connectClient(port, {
      roomCode,
      sessionToken: host.sessionToken,
    });
    track(c0);
    const boot0 = await b0;
    c0.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot0.self.connectionGeneration,
    });

    const { client: c1, bootstrapPromise: b1 } = await connectClient(port, {
      roomCode,
      sessionToken: p1.sessionToken,
    });
    track(c1);
    const boot1 = await b1;
    c1.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot1.self.connectionGeneration,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(expectDefined(server.coordinator).isRoomArmed(roomCode)).toBe(false);
    expect(repo.getPauseReasons(roomCode)).toEqual([]);

    // Disconnect c1 before arming -> must NOT cause pause
    c1.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    expect(repo.getPauseReasons(roomCode)).toEqual([]);

    // Reconnect c1, and connect c2, c3
    const { client: c1Again, bootstrapPromise: b1Again } = await connectClient(
      port,
      {
        roomCode,
        sessionToken: p1.sessionToken,
      },
    );
    track(c1Again);
    const boot1Again = await b1Again;
    c1Again.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot1Again.self.connectionGeneration,
    });

    const { client: c2, bootstrapPromise: b2 } = await connectClient(port, {
      roomCode,
      sessionToken: p2.sessionToken,
    });
    track(c2);
    const boot2 = await b2;
    c2.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot2.self.connectionGeneration,
    });

    const { client: c3, bootstrapPromise: b3 } = await connectClient(port, {
      roomCode,
      sessionToken: p3.sessionToken,
    });
    track(c3);
    const boot3 = await b3;
    c3.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot3.self.connectionGeneration,
    });

    await new Promise((r) => setTimeout(r, 60));
    // All four are connected and synchronized!
    expect(expectDefined(server.coordinator).isRoomArmed(roomCode)).toBe(true);
    expect(repo.getPauseReasons(roomCode)).toEqual([]);
  });

  it("21 & 22. disconnect after arming persists DISCONNECTED_MEMBER; reconnect does not auto-resume", async () => {
    const host = repo.createRoomWithHost({ nickname: "Player0" });
    const roomCode = host.room.code;
    const p1 = repo.joinRoom({ roomCode, nickname: "Player1" });
    const p2 = repo.joinRoom({ roomCode, nickname: "Player2" });
    const p3 = repo.joinRoom({ roomCode, nickname: "Player3" });

    // Connect & sync all four
    const clients: ClientSocket[] = [];
    const tokens = [
      host.sessionToken,
      p1.sessionToken,
      p2.sessionToken,
      p3.sessionToken,
    ];
    for (let i = 0; i < 4; i++) {
      const { client, bootstrapPromise } = await connectClient(port, {
        roomCode,
        sessionToken: tokens[i],
      });
      track(client);
      clients.push(client);
      const b = await bootstrapPromise;
      client.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
        connectionGeneration: b.self.connectionGeneration,
      });
    }

    await new Promise((r) => setTimeout(r, 60));
    expect(expectDefined(server.coordinator).isRoomArmed(roomCode)).toBe(true);

    // Disconnect player 3
    at(clients, 3).disconnect();
    await new Promise((r) => setTimeout(r, 60));

    expect(repo.getPauseReasons(roomCode)).toContain("DISCONNECTED_MEMBER");

    // Reconnect player 3
    const { client: c3Reconnected, bootstrapPromise: b3Recon } =
      await connectClient(port, {
        roomCode,
        sessionToken: p3.sessionToken,
      });
    track(c3Reconnected);
    const boot3Recon = await b3Recon;
    c3Reconnected.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot3Recon.self.connectionGeneration,
    });

    await new Promise((r) => setTimeout(r, 60));
    // Pause remains until host explicitly resumes!
    expect(repo.getPauseReasons(roomCode)).toContain("DISCONNECTED_MEMBER");
  });

  it("23 & 24 & 25 & 26. resume permissions, conditions, and clearing pause reasons", async () => {
    const host = repo.createRoomWithHost({ nickname: "Player0" });
    const roomCode = host.room.code;
    const p1 = repo.joinRoom({ roomCode, nickname: "Player1" });
    const p2 = repo.joinRoom({ roomCode, nickname: "Player2" });
    const p3 = repo.joinRoom({ roomCode, nickname: "Player3" });

    // Connect and sync all 4
    const clients: ClientSocket[] = [];
    const tokens = [
      host.sessionToken,
      p1.sessionToken,
      p2.sessionToken,
      p3.sessionToken,
    ];
    for (let i = 0; i < 4; i++) {
      const { client, bootstrapPromise } = await connectClient(port, {
        roomCode,
        sessionToken: tokens[i],
      });
      track(client);
      clients.push(client);
      const b = await bootstrapPromise;
      client.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
        connectionGeneration: b.self.connectionGeneration,
      });
    }
    await new Promise((r) => setTimeout(r, 60));

    // Disconnect player 1
    at(clients, 1).disconnect();
    await new Promise((r) => setTimeout(r, 60));
    expect(repo.getPauseReasons(roomCode)).toContain("DISCONNECTED_MEMBER");

    // Add manual pause as well (testing independent reasons)
    repo.addPauseReason({ roomCode, reason: "MANUAL" });

    // Host attempts to resume while player 1 is disconnected -> rejected
    const resumeAttempt1 = new Promise<AckResult<ResumeData>>((res) => {
      at(clients, 0).emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        (ack: AckResult<ResumeData>) => res(ack),
      );
    });
    const ack1 = await resumeAttempt1;
    expect(ack1.ok).toBe(false);
    if (!ack1.ok) {
      expect(ack1.error.code).toBe(SOCKET_ERROR_CODES.ROOM_NOT_READY);
    }

    // Reconnect player 1
    const { client: c1Recon, bootstrapPromise: b1Recon } = await connectClient(
      port,
      {
        roomCode,
        sessionToken: p1.sessionToken,
      },
    );
    track(c1Recon);
    const boot1Recon = await b1Recon;
    c1Recon.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
      connectionGeneration: boot1Recon.self.connectionGeneration,
    });
    await new Promise((r) => setTimeout(r, 60));

    // Non-host attempts to resume -> rejected
    const resumeAttempt2 = new Promise<AckResult<ResumeData>>((res) => {
      c1Recon.emit(SOCKET_CLIENT_EVENTS.RESUME, (ack: AckResult<ResumeData>) =>
        res(ack),
      );
    });
    const ack2 = await resumeAttempt2;
    expect(ack2.ok).toBe(false);
    if (!ack2.ok) {
      expect(ack2.error.code).toBe(SOCKET_ERROR_CODES.NOT_ROOM_HOST);
    }

    // Host resumes successfully!
    const resumeAttempt3 = new Promise<AckResult<ResumeData>>((res) => {
      at(clients, 0).emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        (ack: AckResult<ResumeData>) => res(ack),
      );
    });
    const ack3 = await resumeAttempt3;
    expect(ack3.ok).toBe(true);
    if (ack3.ok) {
      // MANUAL pause must still be intact! Only DISCONNECTED_MEMBER cleared!
      expect(ack3.data.pauseReasons).toEqual(["MANUAL"]);
    }
  });

  it("27 & 28 & 29. HTTP recovery disconnects old controller and allows reconnection to same seat", async () => {
    const host = repo.createRoomWithHost({ nickname: "Player0" });
    const roomCode = host.room.code;
    const p1 = repo.joinRoom({ roomCode, nickname: "Player1" });
    const p2 = repo.joinRoom({ roomCode, nickname: "Player2" });
    const p3 = repo.joinRoom({ roomCode, nickname: "Player3" });

    // Connect & sync all four to arm room
    const clients: ClientSocket[] = [];
    const tokens = [
      host.sessionToken,
      p1.sessionToken,
      p2.sessionToken,
      p3.sessionToken,
    ];
    for (let i = 0; i < 4; i++) {
      const { client, bootstrapPromise } = await connectClient(port, {
        roomCode,
        sessionToken: tokens[i],
      });
      track(client);
      clients.push(client);
      const b = await bootstrapPromise;
      client.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
        connectionGeneration: b.self.connectionGeneration,
      });
    }
    await new Promise((r) => setTimeout(r, 60));

    const p1OldSocket = at(clients, 1);
    const replacedPromise = waitForEvent<SessionReplacedPayload>(
      p1OldSocket,
      SOCKET_SERVER_EVENTS.REPLACED,
    );

    // Recover seat via HTTP
    const recoverRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/recover`,
      payload: { recoveryCode: p1.self.recoveryCode },
    });
    expect(recoverRes.statusCode).toBe(200);
    const recoverBody = JSON.parse(recoverRes.body);
    expect(recoverBody.self.memberId).toBe(p1.self.memberId);
    expect(recoverBody.room.memberCount).toBe(4); // No additional seat created

    const replacedEvent = await replacedPromise;
    expect(replacedEvent.reason).toBe("RECOVERY");
    await new Promise((r) => setTimeout(r, 50));
    expect(p1OldSocket.connected).toBe(false);

    // Because room was armed, losing p1's controller adds DISCONNECTED_MEMBER
    expect(repo.getPauseReasons(roomCode)).toContain("DISCONNECTED_MEMBER");

    // Recovered device connects with new session token
    const newSessionCookie = recoverRes.cookies.find(
      (c) => c.name === "finance_game_session",
    );
    expect(newSessionCookie).toBeDefined();

    const { client: recoveredSocket, bootstrapPromise: recBoot } =
      await connectClient(port, {
        roomCode,
        sessionToken: expectDefined(newSessionCookie).value,
      });
    track(recoveredSocket);
    const boot = await recBoot;
    expect(boot.self.memberId).toBe(p1.self.memberId);
  });

  it("30. socket payloads contain no credentials, digests, or socket IDs", async () => {
    const host = repo.createRoomWithHost({ nickname: "Alice" });
    const { client, bootstrapPromise } = await connectClient(port, {
      roomCode: host.room.code,
      sessionToken: host.sessionToken,
    });
    track(client);

    const bootstrap = await bootstrapPromise;
    const str = JSON.stringify(bootstrap);
    expect(str).not.toContain("credentialDigest");
    expect(str).not.toContain("recoveryCredential");
    expect(str).not.toContain(client.id);
  });

  it("31. oversized incoming Socket.IO messages are bounded by configured limit (64 KiB)", async () => {
    const serverOpts = (
      server.io as unknown as {
        opts: { maxHttpBufferSize: number; perMessageDeflate: boolean };
      }
    ).opts;
    expect(serverOpts.maxHttpBufferSize).toBe(64 * 1024);
    expect(serverOpts.perMessageDeflate).toBe(false);

    const host = repo.createRoomWithHost({ nickname: "Alice" });
    const { client } = await connectClient(
      port,
      {
        roomCode: host.room.code,
        sessionToken: host.sessionToken,
        transports: ["websocket"],
      },
      activeSockets,
    );

    const oversizedData = "x".repeat(70 * 1024); // 70 KiB > 64 KiB
    const disconnectPromise = new Promise<void>((resolve) => {
      client.on("disconnect", () => resolve());
      client.io.on("error", () => resolve());
    });

    client.emit("some:event", { payload: oversizedData });
    await disconnectPromise;
    expect(client.connected).toBe(false);
  });

  it("32. server shutdown closes connected sockets cleanly", async () => {
    const host = repo.createRoomWithHost({ nickname: "Alice" });
    const { client } = await connectClient(
      port,
      {
        roomCode: host.room.code,
        sessionToken: host.sessionToken,
        transports: ["websocket"],
      },
      activeSockets,
    );

    expect(client.connected).toBe(true);
    await server.close();
    expect(client.connected).toBe(false);
  });

  it("33. malformed Socket.IO event arguments cannot throw or crash the server", async () => {
    const hostCreated = repo.createRoomWithHost({ nickname: "Alice" });
    const { client } = await connectClient(port, {
      roomCode: hostCreated.room.code,
      sessionToken: hostCreated.sessionToken,
    });
    track(client);

    // Send synchronize with non-function ack arguments or malformed payload shapes
    expect(() => {
      client.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: 1 },
        12345,
      );
      client.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: 1 },
        "not-a-function",
      );
      client.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: 1 },
        { arbitrary: "object" },
      );
      client.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, "invalid-payload", null);
      client.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE);
    }).not.toThrow();

    // Send resume with non-function argument shapes
    expect(() => {
      client.emit(SOCKET_CLIENT_EVENTS.RESUME, { fake: "payload" });
      client.emit(SOCKET_CLIENT_EVENTS.RESUME, "non-function");
      client.emit(SOCKET_CLIENT_EVENTS.RESUME, 99999);
      client.emit(SOCKET_CLIENT_EVENTS.RESUME);
    }).not.toThrow();

    // Verify socket remains alive and server did not throw unhandled exception
    await new Promise((r) => setTimeout(r, 60));
    expect(client.connected).toBe(true);
  });

  it("34. graceful server shutdown of an armed four-seat room suppresses DISCONNECTED_MEMBER", async () => {
    const host = repo.createRoomWithHost({ nickname: "Player0" });
    const roomCode = host.room.code;
    const p1 = repo.joinRoom({ roomCode, nickname: "Player1" });
    const p2 = repo.joinRoom({ roomCode, nickname: "Player2" });
    const p3 = repo.joinRoom({ roomCode, nickname: "Player3" });

    // Connect & sync all four to arm room
    const clients: ClientSocket[] = [];
    const tokens = [
      host.sessionToken,
      p1.sessionToken,
      p2.sessionToken,
      p3.sessionToken,
    ];
    for (let i = 0; i < 4; i++) {
      const { client, bootstrapPromise } = await connectClient(port, {
        roomCode,
        sessionToken: at(tokens, i),
      });
      track(client);
      clients.push(client);
      const b = await bootstrapPromise;
      client.emit(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, {
        connectionGeneration: b.self.connectionGeneration,
      });
    }
    await new Promise((r) => setTimeout(r, 60));
    expect(expectDefined(server.coordinator).isRoomArmed(roomCode)).toBe(true);
    expect(repo.getPauseReasons(roomCode)).toEqual([]);

    // Graceful server shutdown
    await server.close();

    // Verify DISCONNECTED_MEMBER was suppressed during graceful shutdown
    expect(repo.getPauseReasons(roomCode)).toEqual([]);
  });
});
