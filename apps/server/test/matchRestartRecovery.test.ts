import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  assertGameState,
  createProgress,
  createSoleOwnership,
  openCashBusinessPurchaseTransaction,
} from "@interests/engine";
import { asAssetId, asPlayerId, asRoomMemberId } from "@interests/shared";
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

describe("Match Crash and Restart Recovery", () => {
  let tempDbPath: string;
  const clientSockets: ClientSocket[] = [];

  beforeEach(() => {
    tempDbPath = path.join(
      os.tmpdir(),
      `interests-restart-recov-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
    );
  });

  afterEach(() => {
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets.length = 0;

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

  function connectSocket(
    port: number,
    cookieValue: string,
    roomCode: string,
  ): Promise<{ socket: ClientSocket; bootstrap: BootstrapPayload }> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        extraHeaders: {
          cookie: `interests_session=${cookieValue}`,
          origin: `http://127.0.0.1:${port}`,
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
        (res: SyncResponse) => {
          if (res?.ok) resolve();
          else reject(new Error(res?.error?.message ?? "Sync failed"));
        },
      );
    });
  }

  it("recovers ordinary GameState exactly after process restart with SERVER_RESTART pause", async () => {
    // 1. Initial process lifecycle
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

    // Create 4 members
    const hostRes = await server1.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const roomCode = JSON.parse(hostRes.body).room.code;
    const hostCookie = hostRes.cookies.find(
      (c) => c.name === "interests_session",
    )?.value;
    if (!hostCookie) throw new Error("Missing host cookie");
    const cookies: string[] = [hostCookie];

    for (let i = 2; i <= 4; i++) {
      const joinRes = await server1.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/join`,
        payload: { nickname: `Player${i}` },
      });
      const joinCookie = joinRes.cookies.find(
        (c) => c.name === "interests_session",
      )?.value;
      if (!joinCookie) throw new Error(`Missing cookie for Player${i}`);
      cookies.push(joinCookie);
    }

    // Connect & synchronize all 4
    const clients1: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (const cookie of cookies) {
      const c = await connectSocket(port1, cookie, roomCode);
      clients1.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Host starts match
    const startRes = await server1.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { interests_session: cookies[0] ?? "" },
    });
    expect(startRes.statusCode).toBe(200);
    const startBody = JSON.parse(startRes.body);
    const matchId = startBody.match.matchId;

    // Player 1 chooses an objective
    const chosenObjective = startBody.match.self.offeredObjectiveIds[0];
    const hostClient1 = clients1[0];
    if (!hostClient1) throw new Error("Missing host client");

    const ack1 = await new Promise<CommandAckResponse>((resolve) => {
      hostClient1.socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        {
          commandId: "11111111-1111-4111-8111-111111111111",
          expectedRevision: 0,
          command: {
            type: "CHOOSE_OBJECTIVE",
            objectiveId: chosenObjective,
          },
        },
        (res: CommandAckResponse) => resolve(res),
      );
    });
    expect(ack1.ok).toBe(true);
    expect(ack1.revision).toBe(1);

    // Capture pre-restart match record
    const preRestartMatch = matchRepo1.findMatchById(matchId);
    if (!preRestartMatch) throw new Error("Pre-restart match not found");
    const preRestartSnapshot = JSON.parse(preRestartMatch.match.snapshotJson);
    const preRestartMembers = matchRepo1.listMatchMembers(matchId);

    // Disconnect clients and shut down server1
    for (const c of clients1) {
      c.socket.disconnect();
    }
    clientSockets.length = 0;
    await server1.close();
    db1.close();

    // 2. Simulate Process Restart: reopen same DB
    const db2 = openDatabase({ dbPath: tempDbPath });
    runMigrations(db2, migrationsDir);
    const lobbyRepo2 = new SqliteLobbyRepository(db2);
    const matchRepo2 = new SqliteMatchRepository(db2);

    // Run startup recovery
    recoverActiveMatchesOnStartup(matchRepo2, lobbyRepo2);

    // Confirm SERVER_RESTART pause was added
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

    // Verify snapshot in DB is byte-identical
    const postRestartMatch = matchRepo2.findMatchById(matchId);
    if (!postRestartMatch) throw new Error("Post-restart match not found");
    expect(postRestartMatch.match.snapshotJson).toBe(
      preRestartMatch.match.snapshotJson,
    );
    expect(postRestartMatch.match.revision).toBe(1);

    // Reconnect the 4 players using their persistent session cookies
    const clients2: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error(`Missing cookie for index ${i}`);
      const c = await connectSocket(port2, cookie, roomCode);
      clients2.push(c);
      // Verify bootstrap includes the same match ID and player ID
      expect(c.bootstrap.match).toBeDefined();
      expect(c.bootstrap.match?.matchId).toBe(matchId);
      const expectedMember = preRestartMembers[i];
      if (!expectedMember) throw new Error(`Missing preRestartMember ${i}`);
      expect(c.bootstrap.match?.self.playerId).toBe(expectedMember.playerId);
      expect(c.bootstrap.pause.reasons).toContain("SERVER_RESTART");
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Host calls room:resume
    const hostClient2 = clients2[0];
    if (!hostClient2) throw new Error("Missing host client 2");
    const resumeRes = await new Promise<ResumeResponse>((resolve) => {
      hostClient2.socket.emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        (res: ResumeResponse) => resolve(res),
      );
    });
    expect(resumeRes.ok).toBe(true);
    expect(resumeRes.data?.pauseReasons).not.toContain("SERVER_RESTART");

    // Verify GameState is still intact and revision is still 1
    const postResumeMatch = matchRepo2.findMatchById(matchId);
    if (!postResumeMatch) throw new Error("Post-resume match not found");
    const postResumeSnapshot = JSON.parse(postResumeMatch.match.snapshotJson);
    expect(postResumeSnapshot).toEqual(preRestartSnapshot);

    // Clean up
    for (const c of clients2) {
      c.socket.disconnect();
    }
    clientSockets.length = 0;
    await server2.close();
    db2.close();
  }, 30000);

  it("recovers an unfinished active business-purchase transaction exactly across crash/restart (Milestone 5 core proof)", async () => {
    // 1. Setup server 1
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

    // Create 4 members in room
    const hostRes = await server1.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "BuyerHost" },
    });
    const roomCode = JSON.parse(hostRes.body).room.code;
    const hostCookie = hostRes.cookies.find(
      (c) => c.name === "interests_session",
    )?.value;
    if (!hostCookie) throw new Error("Missing buyer host cookie");
    const cookies: string[] = [hostCookie];
    for (let i = 2; i <= 4; i++) {
      const joinRes = await server1.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/join`,
        payload: { nickname: `Member${i}` },
      });
      const joinCookie = joinRes.cookies.find(
        (c) => c.name === "interests_session",
      )?.value;
      if (!joinCookie) throw new Error(`Missing cookie for Member${i}`);
      cookies.push(joinCookie);
    }

    // Connect & sync all 4
    const clients1: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (const cookie of cookies) {
      const c = await connectSocket(port1, cookie, roomCode);
      clients1.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Start match
    await server1.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { interests_session: cookies[0] ?? "" },
    });

    const matchWithMembers = matchRepo1.findMatchByRoomCode(roomCode);
    if (!matchWithMembers) throw new Error("Match with members not found");
    const matchId = matchWithMembers.match.id;

    // Advance all 4 players through objective selection with atomic repository commits (revisions 0->1, 1->2, 2->3, 3->4)
    let state = JSON.parse(matchWithMembers.match.snapshotJson);
    for (let i = 0; i < state.playerOrder.length; i++) {
      const pId = state.playerOrder[i];
      const objectiveId = state.players[pId].offeredObjectiveIds[0];
      const prevRev = state.revision;
      const res = applyAction(state, {
        type: "CHOOSE_OBJECTIVE",
        playerId: pId,
        objectiveId,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("Action failed");
      state = res.state;

      matchRepo1.commitAcceptedCommand({
        matchId,
        expectedPreviousRevision: prevRev,
        nextRevision: state.revision,
        nextState: state,
        actorPlayerId: pId,
        commandId: `choose-objective-cmd-${i + 1}`,
        commandType: "CHOOSE_OBJECTIVE",
        payloadJson: JSON.stringify({ type: "CHOOSE_OBJECTIVE", objectiveId }),
        payloadHash: `obj-hash-${i + 1}`,
      });
    }
    expect(state.phase).toBe("ready-for-first-round");
    expect(state.revision).toBe(4);

    // Add a valid business asset to seller (player-2) and adequate cash to buyer (player-1) on revision 4 state
    const p1 = asPlayerId("player-1");
    const p2 = asPlayerId("player-2");
    const businessAssetId = asAssetId("asset-fixture-biz-1");

    state = {
      ...state,
      round: {
        stage: "spotlight",
        spotlightsCompleted: 0,
      },
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [p1]: 10_000_000, // $100k buyer cash
          [p2]: 2_500_000,
        },
        assetsById: {
          ...state.finance.assetsById,
          [businessAssetId]: {
            id: businessAssetId,
            kind: "business",
            cashPolicyId: "retained-profit-v1",
            cashCents: 0,
            operatingArrearsCents: 0,
            enterpriseValueCents: 10_000_000,
            debtPrincipalCents: 0,
            annualRevenueCents: 5_000_000,
            annualOperatingProfitCents: 1_000_000,
            ownershipByPlayerPpm: createSoleOwnership(p2),
          },
        },
      },
    };
    state = {
      ...state,
      finance: {
        ...state.finance,
        quarterStartBasis: {
          ...state.finance.quarterStartBasis,
          businessesById: {
            ...state.finance.quarterStartBasis.businessesById,
            [businessAssetId]: {
              cashPolicyId: "retained-profit-v1",
              annualOperatingProfitCents: 1_000_000,
              ownershipByPlayerPpm: createSoleOwnership(p2),
            },
          },
        },
      },
    };
    state = {
      ...state,
      progress: createProgress(state.finance, state.playerOrder),
    };
    assertGameState(state);

    // Open an unresolved active business-purchase transaction using pure engine domain function
    // (advances state revision 4 -> 5)
    const openTxResult = openCashBusinessPurchaseTransaction(state, {
      buyerPlayerId: p1,
      sellerPlayerId: p2,
      assetId: businessAssetId,
      purchasePriceCents: 6_000_000,
    });
    expect(openTxResult.ok).toBe(true);
    if (!openTxResult.ok) throw new Error("open transaction failed");

    const stateWithActiveTx = openTxResult.state;
    expect(stateWithActiveTx.revision).toBe(5);
    expect(stateWithActiveTx.activeTransaction).not.toBeNull();
    assertGameState(stateWithActiveTx);

    // Persist this valid state advancing exactly one revision (4 -> 5) with descriptive commandType
    matchRepo1.commitAcceptedCommand({
      matchId,
      expectedPreviousRevision: 4,
      nextRevision: 5,
      nextState: stateWithActiveTx,
      actorPlayerId: p1,
      commandId: "open-tx-cmd-1",
      commandType: "OPEN_BUSINESS_PURCHASE",
      payloadJson: JSON.stringify({
        assetId: businessAssetId,
        purchasePriceCents: 6_000_000,
      }),
      payloadHash: "tx-fixture-hash",
    });

    // Capture captured transaction & state fields
    const capturedTx = JSON.parse(
      JSON.stringify(stateWithActiveTx.activeTransaction),
    );
    const capturedRevision = stateWithActiveTx.revision;
    const capturedCounters = JSON.parse(
      JSON.stringify(stateWithActiveTx.counters),
    );
    const capturedRandom = JSON.parse(JSON.stringify(stateWithActiveTx.random));
    const capturedCash = JSON.parse(
      JSON.stringify(stateWithActiveTx.finance.cashByPlayer),
    );

    // Shut down server1 & close DB
    for (const c of clients1) c.socket.disconnect();
    clientSockets.length = 0;
    await server1.close();
    db1.close();

    // 2. Simulate process restart: reopen same database file
    const db2 = openDatabase({ dbPath: tempDbPath });
    runMigrations(db2, migrationsDir);
    const lobbyRepo2 = new SqliteLobbyRepository(db2);
    const matchRepo2 = new SqliteMatchRepository(db2);

    recoverActiveMatchesOnStartup(matchRepo2, lobbyRepo2);

    // Confirm SERVER_RESTART pause exists outside GameState
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

    // Load persisted snapshot directly and verify ALL captured fields are unchanged
    const reloadedMatch = matchRepo2.findMatchById(matchId);
    if (!reloadedMatch) throw new Error("Reloaded match not found");
    const reloadedState = JSON.parse(reloadedMatch.match.snapshotJson);

    expect(reloadedState.activeTransaction).not.toBeNull();
    expect(reloadedState.activeTransaction).toEqual(capturedTx);
    expect(reloadedState.revision).toBe(capturedRevision);
    expect(reloadedState.counters).toEqual(capturedCounters);
    expect(reloadedState.random).toEqual(capturedRandom);
    expect(reloadedState.finance.cashByPlayer).toEqual(capturedCash);

    // Reconnect all four members
    const clients2: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error(`Missing cookie for reconnect index ${i}`);
      const c = await connectSocket(port2, cookie, roomCode);
      clients2.push(c);
      // Safe active transaction summary is present in player view
      expect(c.bootstrap.match?.activeTransaction).toMatchObject({
        transactionId: capturedTx.id,
        kind: capturedTx.kind,
      });
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Host resumes
    const hostClient2 = clients2[0];
    if (!hostClient2) throw new Error("Missing host client 2 on restart");
    const resumeRes = await new Promise<ResumeResponse>((resolve) => {
      hostClient2.socket.emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        (res: ResumeResponse) => resolve(res),
      );
    });
    expect(resumeRes.ok).toBe(true);

    // Confirm active transaction is STILL present and unchanged after host resume
    const postResumeMatch = matchRepo2.findMatchById(matchId);
    if (!postResumeMatch) throw new Error("Post-resume match not found");
    const postResumeState = JSON.parse(postResumeMatch.match.snapshotJson);

    expect(postResumeState.activeTransaction).toEqual(capturedTx);
    expect(postResumeState.counters).toEqual(capturedCounters);
    expect(postResumeState.random).toEqual(capturedRandom);
    expect(postResumeState.finance.cashByPlayer).toEqual(capturedCash);

    for (const c of clients2) c.socket.disconnect();
    clientSockets.length = 0;
    await server2.close();
    db2.close();
  }, 30000);

  it("retains exact same PlayerId after PR #17 credential recovery", async () => {
    const db = openDatabase({ dbPath: tempDbPath });
    runMigrations(db, migrationsDir);
    const lobbyRepo = new SqliteLobbyRepository(db);
    const matchRepo = new SqliteMatchRepository(db);

    const server = createServer({
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
    const port = getPort(server);

    // Create room with host
    const hostRes = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const roomCode = JSON.parse(hostRes.body).room.code;
    const hostCookie = hostRes.cookies.find(
      (c) => c.name === "interests_session",
    )?.value;
    if (!hostCookie) throw new Error("Missing host session cookie");
    const cookies = [hostCookie];

    // Join 3 players; capture player 2's recovery code
    let player2RecoveryCode = "";
    let player2MemberId = "";
    for (let i = 2; i <= 4; i++) {
      const joinRes = await server.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/join`,
        payload: { nickname: `Player${i}` },
      });
      const joinBody = JSON.parse(joinRes.body);
      if (i === 2) {
        player2RecoveryCode = joinBody.self.recoveryCode;
        player2MemberId = joinBody.self.memberId;
      }
      const memberCookie = joinRes.cookies.find(
        (c) => c.name === "interests_session",
      )?.value;
      if (!memberCookie) {
        throw new Error(`Missing cookie for player ${i}`);
      }
      cookies.push(memberCookie);
    }

    // Connect & sync all 4
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i];
      if (!cookie) throw new Error(`Missing cookie for index ${i}`);
      const c = await connectSocket(port, cookie, roomCode);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Host starts match
    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { interests_session: cookies[0] ?? "" },
    });
    expect(startRes.statusCode).toBe(200);

    const match = matchRepo.findMatchByRoomCode(roomCode);
    if (!match) throw new Error("Match not found");
    const member2Id = asRoomMemberId(player2MemberId);
    const p2IdBeforeRecovery = matchRepo.findPlayerForRoomMember(
      match.match.id,
      member2Id,
    );
    expect(p2IdBeforeRecovery).toBe(asPlayerId("player-2"));

    // Player 2 uses new browser (no session cookie) and recovers seat using recovery code
    const recoverRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/recover`,
      payload: { recoveryCode: player2RecoveryCode },
    });
    expect(recoverRes.statusCode).toBe(200);
    const recoverBody = JSON.parse(recoverRes.body);
    expect(recoverBody.self.memberId).toBe(player2MemberId);

    const newPlayer2Cookie = recoverRes.cookies.find(
      (c) => c.name === "interests_session",
    )?.value;
    if (!newPlayer2Cookie) {
      throw new Error("Missing recovered cookie");
    }

    // Reconnect socket with new session cookie
    const recoveredSocket = await connectSocket(
      port,
      newPlayer2Cookie,
      roomCode,
    );
    expect(recoveredSocket.bootstrap.self.memberId).toBe(player2MemberId);
    expect(recoveredSocket.bootstrap.match?.self.playerId).toBe(
      p2IdBeforeRecovery,
    );

    // Verify mapping in SQLite remains unchanged
    const p2IdAfterRecovery = matchRepo.findPlayerForRoomMember(
      match.match.id,
      member2Id,
    );
    expect(p2IdAfterRecovery).toBe(p2IdBeforeRecovery);

    recoveredSocket.socket.disconnect();
    await server.close();
    db.close();
  });
});
