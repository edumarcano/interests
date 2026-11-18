import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MatchPlayerView } from "@interests/shared";
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
  SOCKET_SERVER_EVENTS,
} from "../src/realtime/socketProtocol.js";
import type { BootstrapPayload } from "../src/realtime/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

interface SyncResponse {
  ok: boolean;
  error?: { message?: string };
}

interface CommandAckResponse {
  ok: boolean;
  outcome?: string;
  revision?: number;
  reason?: string;
  error?: { message?: string };
}

interface ResumeResponse {
  ok: boolean;
  data?: { pauseReasons?: string[] };
  error?: { message?: string };
}

function getPort(server: ReturnType<typeof createServer>): number {
  const address = server.fastify.server.address() as AddressInfo | null;
  if (!address || typeof address === "string") {
    throw new Error("Expected AddressInfo from fastify server");
  }
  return address.port;
}

describe("Full Four-Client Match Integration Flow (PR #19 Lifecycle Verification)", () => {
  let tempDbPath: string;
  const activeSockets: ClientSocket[] = [];

  beforeEach(() => {
    tempDbPath = path.join(
      os.tmpdir(),
      `interests-lifecycle-flow-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
    );
  });

  afterEach(() => {
    for (const socket of activeSockets) {
      if (socket.connected) socket.disconnect();
    }
    activeSockets.length = 0;

    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      const wal = `${tempDbPath}-wal`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = `${tempDbPath}-shm`;
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {
      // ignore temporary cleanup errors
    }
  });

  function connectSocket(
    port: number,
    cookie: string,
    roomCode: string,
  ): Promise<{ socket: ClientSocket; bootstrap: BootstrapPayload }> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        extraHeaders: {
          cookie: `interests_session=${cookie}`,
          origin: `http://127.0.0.1:${port}`,
        },
        auth: {
          roomCode,
          protocolVersion: "1",
        },
        transports: ["websocket"],
        forceNew: true,
      });

      activeSockets.push(socket);

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
        (res: SyncResponse) => {
          if (res?.ok) resolve();
          else reject(new Error(res?.error?.message ?? "Sync failed"));
        },
      );
    });
  }

  it("executes the full four-client start/command/restart/reconnect/resume lifecycle", async () => {
    // -------------------------------------------------------------------------
    // Phase 1: Initial server process
    // -------------------------------------------------------------------------
    const db1 = openDatabase({ dbPath: tempDbPath });
    runMigrations(db1, migrationsDir);
    const lobbyRepo1 = new SqliteLobbyRepository(db1);
    const matchRepo1 = new SqliteMatchRepository(db1);

    const server1 = createServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        dbPath: tempDbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: lobbyRepo1,
      matchRepository: matchRepo1,
    });
    await server1.fastify.listen({ host: "127.0.0.1", port: 0 });
    const port1 = getPort(server1);

    // Step 1: Create room
    const hostRes = await server1.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    expect(hostRes.statusCode).toBe(201);
    const hostCookie = hostRes.cookies.find(
      (c) => c.name === "interests_session",
    )?.value;
    if (!hostCookie) throw new Error("Missing host session cookie");
    const roomCode = JSON.parse(hostRes.body).room.code;
    const cookies: string[] = [hostCookie];

    // Step 2: Three more members join
    for (let i = 2; i <= 4; i++) {
      const joinRes = await server1.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/join`,
        payload: { nickname: `Player${i}` },
      });
      expect(joinRes.statusCode).toBe(201);
      const memberCookie = joinRes.cookies.find(
        (c) => c.name === "interests_session",
      )?.value;
      if (!memberCookie) {
        throw new Error(`Missing session cookie for member ${i}`);
      }
      cookies.push(memberCookie);
    }
    expect(cookies).toHaveLength(4);

    // Step 3: Four sockets connect & synchronize
    const clients1: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (const cookie of cookies) {
      const c = await connectSocket(port1, cookie, roomCode);
      clients1.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Prepare match:view listeners on all 4 sockets
    const initialViewPromises: Array<Promise<MatchPlayerView>> = clients1.map(
      (c) =>
        new Promise((resolve) => {
          c.socket.once(SOCKET_SERVER_EVENTS.MATCH_VIEW, (v: MatchPlayerView) =>
            resolve(v),
          );
        }),
    );

    // Step 4: Host starts match
    const startRes = await server1.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { interests_session: cookies[0] ?? "" },
    });
    expect(startRes.statusCode).toBe(200);
    const startBody = JSON.parse(startRes.body);
    const matchId = startBody.match.matchId;
    expect(startBody.match.revision).toBe(0);

    // Step 5: Each receives different authorized objective view
    const initialViews = await Promise.all(initialViewPromises);
    expect(initialViews).toHaveLength(4);

    for (let i = 0; i < 4; i++) {
      const view = initialViews[i];
      if (!view) throw new Error(`Missing initial view for index ${i}`);
      expect(view.self.offeredObjectiveIds).toHaveLength(2);
      expect(view.self.selectedObjectiveId).toBeNull();
      // Verify other players' secret offers are not in this view
      for (let j = 0; j < 4; j++) {
        if (i !== j) {
          const otherView = initialViews[j];
          if (!otherView) throw new Error(`Missing other view for index ${j}`);
          const otherOffers = otherView.self.offeredObjectiveIds;
          const viewStr = JSON.stringify(view);
          expect(viewStr).not.toContain(JSON.stringify(otherOffers[0]));
          expect(viewStr).not.toContain(JSON.stringify(otherOffers[1]));
        }
      }
    }

    // Step 6: One player submits CHOOSE_OBJECTIVE
    const p1View = initialViews[0];
    if (!p1View) throw new Error("Missing initial view for player 1");
    const chosenObjective = p1View.self.offeredObjectiveIds[0];
    if (!chosenObjective) throw new Error("Missing objective offer 0");
    const commandId = "99999999-9999-4999-8999-999999999999";

    const p1Client = clients1[0];
    if (!p1Client) throw new Error("Missing client 0");

    const p1UpdatedViewPromise = new Promise<MatchPlayerView>((resolve) => {
      p1Client.socket.once(
        SOCKET_SERVER_EVENTS.MATCH_VIEW,
        (v: MatchPlayerView) => resolve(v),
      );
    });

    const ack1 = await new Promise<CommandAckResponse>((resolve) => {
      p1Client.socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId,
          expectedRevision: 0,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: chosenObjective,
          },
        },
        (res: CommandAckResponse) => resolve(res),
      );
    });

    // Step 7: Command commits
    expect(ack1.ok).toBe(true);
    expect(ack1.outcome).toBe("ACCEPTED");
    expect(ack1.revision).toBe(1);

    const updatedView = await p1UpdatedViewPromise;
    expect(updatedView.revision).toBe(1);
    expect(updatedView.self.selectedObjectiveId).toBe(chosenObjective);

    // Step 8: Retry same commandId
    const ackRetry = await new Promise<CommandAckResponse>((resolve) => {
      p1Client.socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId,
          expectedRevision: 0,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: chosenObjective,
          },
        },
        (res: CommandAckResponse) => resolve(res),
      );
    });

    // Step 9: No duplicate transition
    expect(ackRetry.ok).toBe(true);
    expect(ackRetry.outcome).toBe("ACCEPTED");
    expect(ackRetry.revision).toBe(1);

    const matchBeforeRestart = matchRepo1.findMatchById(matchId);
    if (!matchBeforeRestart) throw new Error("Match not found before restart");
    expect(matchBeforeRestart.match.revision).toBe(1);

    // Step 10: Stop server
    for (const c of clients1) c.socket.disconnect();
    activeSockets.length = 0;
    await server1.close();
    db1.close();

    // -------------------------------------------------------------------------
    // Phase 2: Restart same DB
    // -------------------------------------------------------------------------
    // Step 11: Restart same DB
    const db2 = openDatabase({ dbPath: tempDbPath });
    runMigrations(db2, migrationsDir);
    const lobbyRepo2 = new SqliteLobbyRepository(db2);
    const matchRepo2 = new SqliteMatchRepository(db2);

    recoverActiveMatchesOnStartup(matchRepo2, lobbyRepo2);

    // Step 12: Room has SERVER_RESTART
    const pauseReasons = lobbyRepo2.getPauseReasons(roomCode);
    expect(pauseReasons).toContain("SERVER_RESTART");

    const server2 = createServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        dbPath: tempDbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: lobbyRepo2,
      matchRepository: matchRepo2,
    });
    await server2.fastify.listen({ host: "127.0.0.1", port: 0 });
    const port2 = getPort(server2);

    // Step 13: Reconnect four original browser identities & Step 14: Bootstrap same match/player
    const clients2: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error(`Missing cookie for reconnect index ${i}`);
      const c = await connectSocket(port2, cookie, roomCode);
      clients2.push(c);
      expect(c.bootstrap.match).toBeDefined();
      expect(c.bootstrap.match?.matchId).toBe(matchId);
      expect(c.bootstrap.match?.revision).toBe(1);
      if (i === 0) {
        expect(c.bootstrap.match?.self.selectedObjectiveId).toBe(
          chosenObjective,
        );
      }
      // Step 15: Synchronize
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Step 16: Host resume
    const hostClient2 = clients2[0];
    if (!hostClient2) throw new Error("Missing host client on restart");
    const resumeRes = await new Promise<ResumeResponse>((resolve) => {
      hostClient2.socket.emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        (res: ResumeResponse) => resolve(res),
      );
    });
    expect(resumeRes.ok).toBe(true);
    expect(resumeRes.data?.pauseReasons).not.toContain("SERVER_RESTART");

    // Step 17: Match continues at exact saved revision
    const matchAfterResume = matchRepo2.findMatchById(matchId);
    if (!matchAfterResume) throw new Error("Match not found after resume");
    expect(matchAfterResume.match.revision).toBe(1);

    for (const c of clients2) c.socket.disconnect();
    activeSockets.length = 0;
    await server2.close();
    db2.close();
  }, 30000);
});
