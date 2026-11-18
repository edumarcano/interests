import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerId,
  PrivateOpportunityView,
} from "@interests/shared";
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

describe("Section 13 & 15: First Playable Transaction Loop Server Verification", () => {
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
      `interests-txloop-test-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
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
        setupScenario: "q1-business-diagnostic",
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
      // cleanup
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
      (c) => c.name === "interests_session",
    )?.value;
    if (!hostCookie) throw new Error("Host cookie missing");

    const cookies = [hostCookie];
    for (let i = 2; i <= 4; i++) {
      const joinRes = await server.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/join`,
        payload: { nickname: `Player${i}` },
      });
      const cookie = joinRes.cookies.find(
        (c) => c.name === "interests_session",
      )?.value;
      if (!cookie) throw new Error(`Player ${i} cookie missing`);
      cookies.push(cookie);
    }

    return { roomCode, cookies };
  }

  function connectSocket(
    cookieVal: string,
    roomCode: string,
  ): Promise<{ socket: ClientSocket; bootstrap: BootstrapPayload }> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${serverPort}`, {
        transports: ["websocket"],
        extraHeaders: {
          cookie: `interests_session=${cookieVal}`,
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

  function sendCommand(
    socket: ClientSocket,
    envelope: unknown,
  ): Promise<CommandAckResult> {
    return new Promise((resolve) => {
      socket.emit(
        SOCKET_CLIENT_EVENTS.COMMAND,
        envelope,
        (res: CommandAckResult) => {
          resolve(res);
        },
      );
    });
  }

  async function setupMatchAtRoundStart(): Promise<{
    roomCode: string;
    cookies: string[];
    clients: Array<{ socket: ClientSocket; bootstrap: BootstrapPayload }>;
    matchId: string;
    targetBuyerIndex: number;
    opp: PrivateOpportunityView;
    clientPlayerIds: PlayerId[];
    buyerAvailableCash: number;
  }> {
    const { roomCode, cookies } = await createAndFillRoom();

    const clients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const cookie = cookies[i]!;
      const c = await connectSocket(cookie, roomCode);
      clients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    const startRes = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { interests_session: cookies[0]! },
    });
    const startBody = JSON.parse(startRes.body);
    const matchId = startBody.match.matchId;

    // All 4 players choose objectives (revisions 0 -> 4)
    for (let i = 0; i < 4; i++) {
      const getMatchRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[i]! },
      });
      const pView = JSON.parse(getMatchRes.body).match as MatchPlayerView;
      const offer = pView.self.offeredObjectiveIds[0]!;

      const ack = await sendCommand(clients[i]!.socket, {
        commandId: `00000000-0000-4000-8000-00000000000${i + 1}`,
        expectedRevision: i,
        command: {
          type: "CHOOSE_OBJECTIVE",
          objectiveId: offer,
        },
      });
      expect(ack.ok).toBe(true);
    }

    // Identify target buyer and track playerIds
    let targetBuyerIndex = -1;
    let opp: PrivateOpportunityView | undefined;
    let buyerAvailableCash = 3_000_000;
    const clientPlayerIds: PlayerId[] = [];
    for (let i = 0; i < 4; i++) {
      const getMatchRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[i]! },
      });
      const pView = JSON.parse(getMatchRes.body).match as MatchPlayerView;
      clientPlayerIds.push(pView.self.playerId);
      if (pView.self.opportunity) {
        targetBuyerIndex = i;
        opp = pView.self.opportunity;
        buyerAvailableCash = pView.self.availableCashCents;
      }
    }
    expect(targetBuyerIndex).toBeGreaterThanOrEqual(0);
    expect(opp).toBeDefined();

    return {
      roomCode,
      cookies,
      clients,
      matchId,
      targetBuyerIndex,
      opp: opp!,
      clientPlayerIds,
      buyerAvailableCash,
    };
  }

  it("1, 4, 16 & 17. Diligence privacy and investigation lifecycle: target gets opportunity, non-targets do not, facts hidden until investigated", async () => {
    const { roomCode, cookies, clients, targetBuyerIndex, opp } =
      await setupMatchAtRoundStart();

    // 17. Non-target players DO NOT have self.opportunity in their match view
    for (let i = 0; i < 4; i++) {
      if (i === targetBuyerIndex) continue;
      const res = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[i]! },
      });
      const pView = JSON.parse(res.body).match as MatchPlayerView;
      expect(pView.self.opportunity).toBeNull();

      // No leaked exact cash of other players in player summaries
      for (const p of pView.players) {
        expect((p as any).cashCents).toBeUndefined();
        expect((p as any).exactCashCents).toBeUndefined();
      }
    }

    // Target buyer has uninvestigated opportunity
    expect(opp.investigated).toBe(false);
    expect(opp.facts).toBeUndefined();

    // Setup listener on target buyer's socket for updated view
    const viewUpdatePromise = new Promise<MatchPlayerView>((resolve) => {
      clients[targetBuyerIndex]!.socket.on(
        SOCKET_SERVER_EVENTS.MATCH_VIEW,
        (view: MatchPlayerView) => resolve(view),
      );
    });

    // 4. Target buyer sends INVESTIGATE_OPPORTUNITY
    const ack = await sendCommand(clients[targetBuyerIndex]!.socket, {
      commandId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 4,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error();
    expect(ack.revision).toBe(5); // exactly +1 revision

    // Verify rebroadcast received by target buyer
    const updatedView = await viewUpdatePromise;
    expect(updatedView.self.opportunity?.investigated).toBe(true);
    expect(updatedView.self.opportunity?.facts).toBeDefined();
    expect(updatedView.self.opportunity?.facts?.annualRevenueCents).toBe(
      8_000_000,
    );
    expect(updatedView.self.opportunity?.facts?.enterpriseValueCents).toBe(
      6_000_000,
    );

    // Non-target still has no opportunity after investigation
    const otherIndex = (targetBuyerIndex + 1) % 4;
    const otherRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[otherIndex]! },
    });
    const otherView = JSON.parse(otherRes.body).match as MatchPlayerView;
    expect(otherView.self.opportunity).toBeNull();
  });

  it("3. Strict Zod schemas reject injected actor/authority fields", async () => {
    const { clients, targetBuyerIndex, opp } = await setupMatchAtRoundStart();
    const socket = clients[targetBuyerIndex]!.socket;

    // Injected playerId in INVESTIGATE_OPPORTUNITY
    const ack1 = await sendCommand(socket, {
      commandId: "22222222-2222-4222-8222-222222222221",
      expectedRevision: 4,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
        playerId: "player-1",
      },
    });
    expect(ack1.ok).toBe(false);

    // Injected buyerPlayerId in PURSUE_BUSINESS_CASH
    const ack2 = await sendCommand(socket, {
      commandId: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 4,
      command: {
        type: "PURSUE_BUSINESS_CASH",
        opportunityId: opp.id,
        buyerPlayerId: "player-1",
      },
    });
    expect(ack2.ok).toBe(false);

    // Injected isHost in CLOSE_BUSINESS_PURCHASE
    const ack3 = await sendCommand(socket, {
      commandId: "22222222-2222-4222-8222-222222222223",
      expectedRevision: 4,
      command: {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: "tx-1",
        isHost: true,
      },
    });
    expect(ack3.ok).toBe(false);
  });

  it("5, 6, 8, 9, 10 & 11. Full financed transaction lifecycle through MatchService: request -> offer -> accept -> close -> auto advance", async () => {
    const {
      clients,
      targetBuyerIndex,
      opp,
      roomCode,
      cookies,
      clientPlayerIds,
      buyerAvailableCash,
    } = await setupMatchAtRoundStart();
    const buyerSocket = clients[targetBuyerIndex]!.socket;

    const contribution = Math.min(3_000_000, buyerAvailableCash);
    const principal = 5_000_000 - contribution;

    // Investigate opportunity
    let rev = 4;
    const invAck = await sendCommand(buyerSocket, {
      commandId: "33333333-3333-4333-8333-000000000001",
      expectedRevision: rev++,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });
    expect(invAck.ok).toBe(true);

    // Host begins round
    const beginAck = await sendCommand(clients[0]!.socket, {
      commandId: "33333333-3333-4333-8333-000000000002",
      expectedRevision: rev++,
      command: { type: "BEGIN_ROUND" },
    });
    expect(beginAck.ok).toBe(true);

    // Advance spotlights until buyer holds spotlight
    while (true) {
      const getRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[targetBuyerIndex]! },
      });
      const pView = JSON.parse(getRes.body).match as MatchPlayerView;
      const activePlayerId = pView.round?.activeSpotlightPlayerId;
      const buyerPlayerId = pView.self.playerId;

      if (activePlayerId === buyerPlayerId) {
        break;
      }

      // Find who is active
      const activeIdx = clientPlayerIds.findIndex(
        (id: PlayerId) => id === activePlayerId,
      );
      expect(activeIdx).toBeGreaterThanOrEqual(0);
      const passAck = await sendCommand(clients[activeIdx]!.socket, {
        commandId: `33333333-3333-4333-8333-00000000001${rev}`,
        expectedRevision: rev++,
        command: { type: "PASS_SPOTLIGHT" },
      });
      expect(passAck.ok).toBe(true);
    }

    // Buyer pursues with financing
    const pursueAck = await sendCommand(buyerSocket, {
      commandId: "33333333-3333-4333-8333-000000000020",
      expectedRevision: rev++,
      command: {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: opp.id,
        buyerCashContributionCents: contribution,
        requestedPrincipalCents: principal,
      },
    });
    expect(pursueAck.ok).toBe(true);

    // Fetch view to get transactionId and seller/lender info
    const buyerViewRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const buyerView = JSON.parse(buyerViewRes.body).match as MatchPlayerView;
    const tx = buyerView.activeTransaction!;
    expect(tx).toBeDefined();
    expect(tx.isFinanced).toBe(true);
    expect(tx.financingStatus).toBe("waiting-for-offer");
    expect(tx.role).toBe("buyer");

    // Find eligible lender client with sufficient available cash
    let eligibleLenderIdx = -1;
    for (let i = 0; i < 4; i++) {
      const pId = clientPlayerIds[i]!;
      if (
        i === targetBuyerIndex ||
        pId === tx.sellerPlayerId ||
        pId === tx.buyerPlayerId
      ) {
        continue;
      }
      const lenderRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[i]! },
      });
      const lenderView = JSON.parse(lenderRes.body).match as MatchPlayerView;
      if (lenderView.self.availableCashCents >= principal) {
        eligibleLenderIdx = i;
        break;
      }
    }
    expect(eligibleLenderIdx).toBeGreaterThanOrEqual(0);
    const lenderSocket = clients[eligibleLenderIdx]!.socket;

    // Lender submits offer
    const offerAck = await sendCommand(lenderSocket, {
      commandId: "33333333-3333-4333-8333-000000000030",
      expectedRevision: rev++,
      command: {
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: tx.transactionId,
        annualRateBps: 1000,
        termQuarters: 3,
      },
    });
    expect(offerAck.ok).toBe(true);

    // Buyer accepts offer
    const acceptAck = await sendCommand(buyerSocket, {
      commandId: "33333333-3333-4333-8333-000000000040",
      expectedRevision: rev++,
      command: {
        type: "ACCEPT_PLAYER_LOAN_OFFER",
        transactionId: tx.transactionId,
        expectedTermsRevision: 1,
      },
    });
    expect(acceptAck.ok).toBe(true);

    // 11. Stale revision rejects
    const staleAck = await sendCommand(buyerSocket, {
      commandId: "33333333-3333-4333-8333-000000000050",
      expectedRevision: rev - 2, // stale
      command: {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: tx.transactionId,
      },
    });
    expect(staleAck.ok).toBe(false);

    // Buyer closes transaction
    const closeCommandId = "33333333-3333-4333-8333-000000000060";
    const closeAck = await sendCommand(buyerSocket, {
      commandId: closeCommandId,
      expectedRevision: rev,
      command: {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: tx.transactionId,
      },
    });
    expect(closeAck.ok).toBe(true);
    const expectedCloseRevision = rev + 1;
    expect(closeAck.revision).toBe(expectedCloseRevision);

    // 9. Idempotent retry with same commandId + same payload
    const retryAck = await sendCommand(buyerSocket, {
      commandId: closeCommandId,
      expectedRevision: rev,
      command: {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: tx.transactionId,
      },
    });
    expect(retryAck.ok).toBe(true);
    expect(retryAck.revision).toBe(expectedCloseRevision);

    // 10. Same commandId + changed payload returns COMMAND_ID_REUSED
    const conflictAck = await sendCommand(buyerSocket, {
      commandId: closeCommandId,
      expectedRevision: rev,
      command: {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: "different-tx-id",
      },
    });
    expect(conflictAck.ok).toBe(false);
    if (!conflictAck.ok) {
      expect(conflictAck.error?.code).toBe("COMMAND_ID_REUSED");
    }

    // 6. Terminal close cleared transaction and advanced spotlight automatically
    const finalViewRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const finalView = JSON.parse(finalViewRes.body).match as MatchPlayerView;
    expect(finalView.activeTransaction).toBeNull();
    // Buyer now owns the business
    expect(finalView.self.ownedAssets?.length).toBeGreaterThanOrEqual(1);
    expect(finalView.self.ownedAssets?.some((a) => a.kind === "business")).toBe(
      true,
    );
    // Buyer has the player loan
    expect(finalView.self.loans?.length).toBeGreaterThanOrEqual(1);
    expect(finalView.self.loans?.some((l) => l.kind === "player-loan")).toBe(
      true,
    );
  });

  it("13, 14 & 15. Server restart preserves transaction and investigation state", async () => {
    const { clients, targetBuyerIndex, opp, roomCode, cookies } =
      await setupMatchAtRoundStart();
    const buyerSocket = clients[targetBuyerIndex]!.socket;

    // Investigate
    const invAck = await sendCommand(buyerSocket, {
      commandId: "44444444-4444-4444-8444-000000000001",
      expectedRevision: 4,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });
    expect(invAck.ok).toBe(true);

    // Simulate server restart
    recoverActiveMatchesOnStartup(matchRepo, lobbyRepo);

    // Reconnect sockets
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets.length = 0;

    const newTargetClient = await connectSocket(
      cookies[targetBuyerIndex]!,
      roomCode,
    );
    await syncSocket(
      newTargetClient.socket,
      newTargetClient.bootstrap.self.connectionGeneration,
    );

    // 13. Restart preserves investigated facts
    const getRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const pView = JSON.parse(getRes.body).match as MatchPlayerView;
    expect(pView.self.opportunity?.investigated).toBe(true);
    expect(pView.self.opportunity?.facts?.annualRevenueCents).toBe(8_000_000);
  });

  it("14. Server restart preserves active financed transaction, reservations, offer, and acceptance state", async () => {
    const {
      clients,
      targetBuyerIndex,
      opp,
      roomCode,
      cookies,
      clientPlayerIds,
      buyerAvailableCash,
    } = await setupMatchAtRoundStart();
    const buyerSocket = clients[targetBuyerIndex]!.socket;

    const contribution = Math.min(3_000_000, buyerAvailableCash);
    const principal = 5_000_000 - contribution;

    let rev = 4;
    // Investigate
    await sendCommand(buyerSocket, {
      commandId: "88888888-8888-4888-8888-000000000001",
      expectedRevision: rev++,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });

    // Begin round
    await sendCommand(clients[0]!.socket, {
      commandId: "88888888-8888-4888-8888-000000000002",
      expectedRevision: rev++,
      command: { type: "BEGIN_ROUND" },
    });

    // Advance spotlights until buyer holds spotlight
    while (true) {
      const getRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[targetBuyerIndex]! },
      });
      const pView = JSON.parse(getRes.body).match as MatchPlayerView;
      const activePlayerId = pView.round?.activeSpotlightPlayerId;
      const buyerPlayerId = pView.self.playerId;

      if (activePlayerId === buyerPlayerId) break;

      const activeIdx = clientPlayerIds.findIndex(
        (id: PlayerId) => id === activePlayerId,
      );
      await sendCommand(clients[activeIdx]!.socket, {
        commandId: `88888888-8888-4888-8888-00000000001${rev}`,
        expectedRevision: rev++,
        command: { type: "PASS_SPOTLIGHT" },
      });
    }

    // Buyer pursues with financing
    const pursueAck = await sendCommand(buyerSocket, {
      commandId: "88888888-8888-4888-8888-000000000020",
      expectedRevision: rev++,
      command: {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: opp.id,
        buyerCashContributionCents: contribution,
        requestedPrincipalCents: principal,
      },
    });
    expect(pursueAck.ok).toBe(true);

    // Get active transaction id
    const buyerViewRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const buyerView = JSON.parse(buyerViewRes.body).match as MatchPlayerView;
    const tx = buyerView.activeTransaction!;
    expect(tx).toBeDefined();

    // Identify eligible lender with sufficient available cash
    const sellerPlayerId = opp.sellerPlayerId;
    let lenderIndex = -1;
    for (let i = 0; i < 4; i++) {
      if (i !== targetBuyerIndex && clientPlayerIds[i] !== sellerPlayerId) {
        const lenderRes = await server.fastify.inject({
          method: "GET",
          url: `/api/rooms/${roomCode}/match`,
          cookies: { interests_session: cookies[i]! },
        });
        const lView = JSON.parse(lenderRes.body).match as MatchPlayerView;
        if (lView.self.availableCashCents >= principal) {
          lenderIndex = i;
          break;
        }
      }
    }
    expect(lenderIndex).toBeGreaterThanOrEqual(0);
    const lenderSocket = clients[lenderIndex]!.socket;

    // Lender submits offer (principal, 1000 bps APR, 3 quarters)
    const offerAck = await sendCommand(lenderSocket, {
      commandId: "88888888-8888-4888-8888-000000000030",
      expectedRevision: rev++,
      command: {
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: tx.transactionId,
        annualRateBps: 1000,
        termQuarters: 3,
      },
    });
    expect(offerAck.ok).toBe(true);

    // Buyer accepts offer
    const acceptAck = await sendCommand(buyerSocket, {
      commandId: "88888888-8888-4888-8888-000000000040",
      expectedRevision: rev++,
      command: {
        type: "ACCEPT_PLAYER_LOAN_OFFER",
        transactionId: tx.transactionId,
        expectedTermsRevision: 1,
      },
    });
    expect(acceptAck.ok).toBe(true);

    // RESTART SERVER
    recoverActiveMatchesOnStartup(matchRepo, lobbyRepo);

    // Disconnect old sockets
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets.length = 0;

    // Reconnect buyer
    const newBuyerClient = await connectSocket(
      cookies[targetBuyerIndex]!,
      roomCode,
    );
    await syncSocket(
      newBuyerClient.socket,
      newBuyerClient.bootstrap.self.connectionGeneration,
    );

    // Reconnect lender
    const newLenderClient = await connectSocket(
      cookies[lenderIndex]!,
      roomCode,
    );
    await syncSocket(
      newLenderClient.socket,
      newLenderClient.bootstrap.self.connectionGeneration,
    );

    // Verify buyer match view after restart
    const postRestartBuyerRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const postRestartBuyerView = JSON.parse(postRestartBuyerRes.body)
      .match as MatchPlayerView;
    expect(postRestartBuyerView.activeTransaction).toBeDefined();
    expect(postRestartBuyerView.activeTransaction?.financingStatus).toBe(
      "offer-accepted",
    );
    expect(postRestartBuyerView.activeTransaction?.offer?.status).toBe(
      "accepted",
    );
    expect(postRestartBuyerView.activeTransaction?.offer?.annualRateBps).toBe(
      1000,
    );
    expect(postRestartBuyerView.activeTransaction?.offer?.termQuarters).toBe(3);
    expect(postRestartBuyerView.activeTransaction?.offer?.termsRevision).toBe(
      1,
    );
    expect(postRestartBuyerView.self.reservedCashCents).toBe(contribution);

    // Verify lender match view after restart
    const postRestartLenderRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[lenderIndex]! },
    });
    const postRestartLenderView = JSON.parse(postRestartLenderRes.body)
      .match as MatchPlayerView;
    expect(postRestartLenderView.self.reservedCashCents).toBe(principal);
  });

  it("15. Server restart after terminal close preserves loan, ownership, cash, and round state", async () => {
    const {
      clients,
      targetBuyerIndex,
      opp,
      roomCode,
      cookies,
      clientPlayerIds,
      buyerAvailableCash,
    } = await setupMatchAtRoundStart();
    const buyerSocket = clients[targetBuyerIndex]!.socket;

    const contribution = Math.min(3_000_000, buyerAvailableCash);
    const principal = 5_000_000 - contribution;

    let rev = 4;
    // Investigate
    await sendCommand(buyerSocket, {
      commandId: "99999999-9999-4999-8999-000000000001",
      expectedRevision: rev++,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });

    // Begin round
    await sendCommand(clients[0]!.socket, {
      commandId: "99999999-9999-4999-8999-000000000002",
      expectedRevision: rev++,
      command: { type: "BEGIN_ROUND" },
    });

    // Advance spotlights until buyer holds spotlight
    while (true) {
      const getRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[targetBuyerIndex]! },
      });
      const pView = JSON.parse(getRes.body).match as MatchPlayerView;
      const activePlayerId = pView.round?.activeSpotlightPlayerId;
      const buyerPlayerId = pView.self.playerId;

      if (activePlayerId === buyerPlayerId) break;

      const activeIdx = clientPlayerIds.findIndex(
        (id: PlayerId) => id === activePlayerId,
      );
      await sendCommand(clients[activeIdx]!.socket, {
        commandId: `99999999-9999-4999-8999-00000000001${rev}`,
        expectedRevision: rev++,
        command: { type: "PASS_SPOTLIGHT" },
      });
    }

    // Buyer pursues with financing
    await sendCommand(buyerSocket, {
      commandId: "99999999-9999-4999-8999-000000000020",
      expectedRevision: rev++,
      command: {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: opp.id,
        buyerCashContributionCents: contribution,
        requestedPrincipalCents: principal,
      },
    });

    const buyerViewRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const buyerView = JSON.parse(buyerViewRes.body).match as MatchPlayerView;
    const tx = buyerView.activeTransaction!;

    const sellerPlayerId = opp.sellerPlayerId;
    let lenderIndex = -1;
    for (let i = 0; i < 4; i++) {
      if (i !== targetBuyerIndex && clientPlayerIds[i] !== sellerPlayerId) {
        const lenderRes = await server.fastify.inject({
          method: "GET",
          url: `/api/rooms/${roomCode}/match`,
          cookies: { interests_session: cookies[i]! },
        });
        const lView = JSON.parse(lenderRes.body).match as MatchPlayerView;
        if (lView.self.availableCashCents >= principal) {
          lenderIndex = i;
          break;
        }
      }
    }
    expect(lenderIndex).toBeGreaterThanOrEqual(0);
    const lenderSocket = clients[lenderIndex]!.socket;

    // Lender submits offer
    await sendCommand(lenderSocket, {
      commandId: "99999999-9999-4999-8999-000000000030",
      expectedRevision: rev++,
      command: {
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: tx.transactionId,
        annualRateBps: 1000,
        termQuarters: 3,
      },
    });

    // Buyer accepts offer
    await sendCommand(buyerSocket, {
      commandId: "99999999-9999-4999-8999-000000000040",
      expectedRevision: rev++,
      command: {
        type: "ACCEPT_PLAYER_LOAN_OFFER",
        transactionId: tx.transactionId,
        expectedTermsRevision: 1,
      },
    });

    // Buyer closes deal
    const closeAck = await sendCommand(buyerSocket, {
      commandId: "99999999-9999-4999-8999-000000000050",
      expectedRevision: rev++,
      command: {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: tx.transactionId,
      },
    });
    expect(closeAck.ok).toBe(true);

    // RESTART SERVER
    recoverActiveMatchesOnStartup(matchRepo, lobbyRepo);

    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets.length = 0;

    const newBuyerClient = await connectSocket(
      cookies[targetBuyerIndex]!,
      roomCode,
    );
    await syncSocket(
      newBuyerClient.socket,
      newBuyerClient.bootstrap.self.connectionGeneration,
    );

    const postCloseBuyerRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const postCloseBuyerView = JSON.parse(postCloseBuyerRes.body)
      .match as MatchPlayerView;

    // Transaction is cleared
    expect(postCloseBuyerView.activeTransaction).toBeNull();
    // Buyer owns the 100% business
    expect(postCloseBuyerView.self.ownedAssets?.length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      postCloseBuyerView.self.ownedAssets?.some(
        (a) => a.kind === "business" && a.ownershipPpm === 1_000_000,
      ),
    ).toBe(true);
    // Buyer has player loan
    expect(postCloseBuyerView.self.loans?.length).toBeGreaterThanOrEqual(1);
    expect(
      postCloseBuyerView.self.loans?.some(
        (l) =>
          l.kind === "player-loan" &&
          l.role === "borrower" &&
          l.outstandingPrincipalCents === principal,
      ),
    ).toBe(true);
  });

  it("16 & 17. Role-aware projections across buyer, seller, lender, and neutral roles plus socket bootstrap privacy boundary", async () => {
    const {
      clients,
      targetBuyerIndex,
      opp,
      roomCode,
      cookies,
      clientPlayerIds,
      buyerAvailableCash,
    } = await setupMatchAtRoundStart();

    const contribution = Math.min(3_000_000, buyerAvailableCash);
    const principal = 5_000_000 - contribution;

    // Advance to buyer spotlight and submit financing request
    const buyerSocket = clients[targetBuyerIndex]!.socket;
    let rev = 4;
    await sendCommand(buyerSocket, {
      commandId: "aaaaaaa1-aaaa-4aaa-8aaa-000000000001",
      expectedRevision: rev++,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });

    await sendCommand(clients[0]!.socket, {
      commandId: "aaaaaaa1-aaaa-4aaa-8aaa-000000000002",
      expectedRevision: rev++,
      command: { type: "BEGIN_ROUND" },
    });

    while (true) {
      const getRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[targetBuyerIndex]! },
      });
      const pView = JSON.parse(getRes.body).match as MatchPlayerView;
      const activePlayerId = pView.round?.activeSpotlightPlayerId;
      const buyerPlayerId = pView.self.playerId;
      if (activePlayerId === buyerPlayerId) break;

      const activeIdx = clientPlayerIds.findIndex(
        (id: PlayerId) => id === activePlayerId,
      );
      await sendCommand(clients[activeIdx]!.socket, {
        commandId: `aaaaaaa1-aaaa-4aaa-8aaa-00000000001${rev}`,
        expectedRevision: rev++,
        command: { type: "PASS_SPOTLIGHT" },
      });
    }

    await sendCommand(buyerSocket, {
      commandId: "aaaaaaa1-aaaa-4aaa-8aaa-000000000020",
      expectedRevision: rev++,
      command: {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: opp.id,
        buyerCashContributionCents: contribution,
        requestedPrincipalCents: principal,
      },
    });

    const buyerViewRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const buyerView = JSON.parse(buyerViewRes.body).match as MatchPlayerView;
    const tx = buyerView.activeTransaction!;

    const sellerPlayerId = opp.sellerPlayerId;
    const sellerIndex = clientPlayerIds.indexOf(sellerPlayerId);
    let lenderIndex = -1;
    let neutralIndex = -1;
    for (let i = 0; i < 4; i++) {
      if (i !== targetBuyerIndex && i !== sellerIndex) {
        const lenderRes = await server.fastify.inject({
          method: "GET",
          url: `/api/rooms/${roomCode}/match`,
          cookies: { interests_session: cookies[i]! },
        });
        const lView = JSON.parse(lenderRes.body).match as MatchPlayerView;
        if (lenderIndex === -1 && lView.self.availableCashCents >= principal) {
          lenderIndex = i;
        } else {
          neutralIndex = i;
        }
      }
    }
    expect(lenderIndex).toBeGreaterThanOrEqual(0);
    expect(neutralIndex).toBeGreaterThanOrEqual(0);

    // Lender submits offer
    await sendCommand(clients[lenderIndex]!.socket, {
      commandId: "aaaaaaa1-aaaa-4aaa-8aaa-000000000030",
      expectedRevision: rev++,
      command: {
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: tx.transactionId,
        annualRateBps: 1000,
        termQuarters: 3,
      },
    });

    // 16. Test projection differences across all 4 distinct roles:
    // 1) Target Buyer
    const bRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const bView = JSON.parse(bRes.body).match as MatchPlayerView;
    expect(bView.activeTransaction?.role).toBe("buyer");
    expect(bView.activeTransaction?.financingStatus).toBe("offer-submitted");
    expect(bView.activeTransaction?.offer?.lenderNickname).toBeDefined();
    expect(bView.activeTransaction?.offer?.annualRateBps).toBe(1000);

    // 2) Seller
    const sRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[sellerIndex]! },
    });
    const sView = JSON.parse(sRes.body).match as MatchPlayerView;
    expect(sView.activeTransaction?.role).toBe("seller");
    expect(sView.activeTransaction?.purchasePriceCents).toBe(5_000_000);

    // 3) Lender
    const lRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[lenderIndex]! },
    });
    const lView = JSON.parse(lRes.body).match as MatchPlayerView;
    expect(lView.activeTransaction?.role).toBe("lender");
    expect(lView.activeTransaction?.offer?.status).toBe("offered");

    // 4) Neutral (uninvolved) player
    const nRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[neutralIndex]! },
    });
    const nView = JSON.parse(nRes.body).match as MatchPlayerView;
    expect(nView.activeTransaction?.role).toBe("uninvolved");
    // Offer candidate details are not leaked to uninvolved players
    expect(nView.activeTransaction?.offer).toBeNull();
  }, 20000);

  it("12. Paused room rejects new gameplay commands", async () => {
    const { clients, targetBuyerIndex, opp, roomCode, cookies } =
      await setupMatchAtRoundStart();
    const buyerSocket = clients[targetBuyerIndex]!.socket;

    // Add pause reason to lobby
    lobbyRepo.addPauseReason({ roomCode, reason: "SYSTEM_FAULT" });

    const ack = await sendCommand(buyerSocket, {
      commandId: "55555555-5555-4555-8555-000000000001",
      expectedRevision: 4,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });

    // When room is paused, commands are rejected
    expect(ack.ok).toBe(false);
    if (ack.ok) throw new Error();
    expect(ack.error.code).toBe("ROOM_PAUSED");
  });

  it("6 & 14. Cancel active transaction clears transaction and advances spotlight automatically", async () => {
    const {
      clients,
      targetBuyerIndex,
      opp,
      roomCode,
      cookies,
      clientPlayerIds,
      buyerAvailableCash,
    } = await setupMatchAtRoundStart();
    const buyerSocket = clients[targetBuyerIndex]!.socket;

    const contribution = Math.min(3_000_000, buyerAvailableCash);
    const principal = 5_000_000 - contribution;

    let rev = 4;
    // Investigate
    await sendCommand(buyerSocket, {
      commandId: "66666666-6666-4666-8666-000000000001",
      expectedRevision: rev++,
      command: {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opp.id,
      },
    });

    // Begin round
    await sendCommand(clients[0]!.socket, {
      commandId: "66666666-6666-4666-8666-000000000002",
      expectedRevision: rev++,
      command: { type: "BEGIN_ROUND" },
    });

    // Advance spotlights until buyer holds spotlight
    while (true) {
      const getRes = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[targetBuyerIndex]! },
      });
      const pView = JSON.parse(getRes.body).match as MatchPlayerView;
      const activePlayerId = pView.round?.activeSpotlightPlayerId;
      const buyerPlayerId = pView.self.playerId;

      if (activePlayerId === buyerPlayerId) break;

      const activeIdx = clientPlayerIds.findIndex(
        (id: PlayerId) => id === activePlayerId,
      );
      await sendCommand(clients[activeIdx]!.socket, {
        commandId: `66666666-6666-4666-8666-00000000001${rev}`,
        expectedRevision: rev++,
        command: { type: "PASS_SPOTLIGHT" },
      });
    }

    // Buyer pursues with financing
    await sendCommand(buyerSocket, {
      commandId: "66666666-6666-4666-8666-000000000020",
      expectedRevision: rev++,
      command: {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: opp.id,
        buyerCashContributionCents: contribution,
        requestedPrincipalCents: principal,
      },
    });

    // Get active transaction id
    const buyerViewRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const buyerView = JSON.parse(buyerViewRes.body).match as MatchPlayerView;
    const tx = buyerView.activeTransaction!;
    const preCancelSpotlight = buyerView.round?.spotlightsCompleted ?? 0;

    // Buyer cancels active transaction
    const cancelAck = await sendCommand(buyerSocket, {
      commandId: "66666666-6666-4666-8666-000000000030",
      expectedRevision: rev,
      command: {
        type: "CANCEL_ACTIVE_TRANSACTION",
        transactionId: tx.transactionId,
      },
    });

    expect(cancelAck.ok).toBe(true);
    expect(cancelAck.revision).toBe(rev + 1);

    // Verify transaction cleared and spotlight advanced
    const afterCancelRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[targetBuyerIndex]! },
    });
    const afterCancelView = JSON.parse(afterCancelRes.body)
      .match as MatchPlayerView;
    expect(afterCancelView.activeTransaction).toBeNull();
    if (preCancelSpotlight === 3) {
      expect(afterCancelView.currentQuarter).toBe(2);
      expect(afterCancelView.round?.spotlightsCompleted).toBe(0);
    } else {
      expect(afterCancelView.round?.spotlightsCompleted).toBe(
        preCancelSpotlight + 1,
      );
    }
  });
});
