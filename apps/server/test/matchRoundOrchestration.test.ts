import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertGameState,
  basisPoints,
  captureBusinessBasis,
  capturePropertyBasis,
  cents,
  createProgress,
  type GameState,
  getActiveSpotlightPlayerId,
  ownershipPpm,
} from "@interests/engine";
import {
  asAssetId,
  asLoanId,
  type CommandAckResult,
  type MatchId,
  type MatchPlayerView,
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

describe("Section 18: Match Round Orchestration Server Integration", () => {
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
      `interests-round-test-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
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

  /**
   * Helper to set up a match with all 4 objectives selected,
   * leaving state at revision 4, ready-for-first-round, round-start.
   */
  async function setupMatchAtRoundStart(): Promise<{
    roomCode: string;
    cookies: string[];
    clients: Array<{ socket: ClientSocket; bootstrap: BootstrapPayload }>;
    matchId: string;
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

    // All 4 players choose objectives
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

    return { roomCode, cookies, clients, matchId };
  }

  it("routes strict nested finale commands to the engine and persists an atomic private rejection exactly once", async () => {
    const { clients, cookies, roomCode, matchId } =
      await setupMatchAtRoundStart();
    expect(
      await sendCommand(clients[0]!.socket, {
        commandId: randomUUID(),
        expectedRevision: 4,
        command: { type: "BEGIN_ROUND" },
      }),
    ).toMatchObject({ ok: true, revision: 5 });
    const before = matchRepo.findMatchByRoomCode(roomCode)!.match.snapshotJson;
    const envelope = {
      commandId: randomUUID(),
      expectedRevision: 5,
      command: { type: "PURSUE_FINALE", action: { type: "RESIGN_LABOR" } },
    };
    for (const command of [
      { ...envelope.command, objectiveId: "independent" },
      { ...envelope.command, action: { type: "RESIGN_LABOR", eligible: true } },
      {
        type: "PURSUE_FINALE",
        action: { type: "CONFIRM_INDEPENDENCE", cashCents: 999 },
      },
    ])
      expect(
        await sendCommand(clients[0]!.socket, {
          ...envelope,
          commandId: randomUUID(),
          command,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "INVALID_INPUT" },
        revision: 5,
      });
    const response = await sendCommand(clients[0]!.socket, envelope);
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Ordinary Q1 cannot qualify a finale");
    expect(response.error.code).toBe("GAMEPLAY_REJECTED");
    expect(["FINALE_INELIGIBLE", "FINALE_ACTION_UNAVAILABLE"]).toContain(
      response.error.message,
    );
    expect(await sendCommand(clients[0]!.socket, envelope)).toEqual(response);
    expect(
      await sendCommand(clients[0]!.socket, {
        ...envelope,
        command: {
          type: "PURSUE_FINALE",
          action: { type: "CONFIRM_INDEPENDENCE" },
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "COMMAND_ID_REUSED" },
      revision: 5,
    });
    expect(
      await sendCommand(clients[1]!.socket, {
        ...envelope,
        commandId: randomUUID(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GAMEPLAY_REJECTED", message: "NOT_ACTIVE_SPOTLIGHT" },
      revision: 5,
    });
    const snapshot = JSON.parse(before) as GameState;
    const receipt = matchRepo.findCommandReceipt(
      matchId as MatchId,
      snapshot.playerOrder[0]!,
      envelope.commandId,
    );
    expect(receipt).toMatchObject({
      outcome: "REJECTED",
      resultingRevision: 5,
      errorCode: response.error.code,
      errorMessage: response.error.message,
    });
    expect(matchRepo.findMatchByRoomCode(roomCode)!.match.snapshotJson).toBe(
      before,
    );
    for (const [index, cookie] of cookies.entries()) {
      const view = JSON.parse(
        (
          await server.fastify.inject({
            method: "GET",
            url: `/api/rooms/${roomCode}/match`,
            cookies: { interests_session: cookie },
          })
        ).body,
      ).match as MatchPlayerView;
      expect(view.revision).toBe(5);
      expect(view.result).toBeNull();
      expect(view.self.playerId).toBe(snapshot.playerOrder[index]);
      expect(JSON.stringify(view.players)).not.toContain("objectiveEvaluation");
    }
  });

  it("quotes authenticated private market baskets and persists a final trade, fees and settlement exactly once", async () => {
    const { clients, roomCode, cookies, matchId } =
      await setupMatchAtRoundStart();
    const trades = [
      { instrumentId: "growth-fund", buyCents: 10_000, sellCents: 0 },
    ];
    const request = (
      cookie?: string,
      payload: Record<string, unknown> = { trades },
      origin?: string,
    ) =>
      server.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/public-market-preview`,
        cookies: cookie ? { interests_session: cookie } : {},
        payload,
        headers: origin ? { origin } : {},
      });
    expect((await request()).statusCode).toBe(401);
    expect(
      (await request(cookies[0], { trades }, "https://unrelated.example"))
        .statusCode,
    ).toBe(403);
    expect(
      (await request(cookies[0], { trades, actorPlayerId: "player-4" }))
        .statusCode,
    ).toBe(400);
    expect((await request("invalid-session")).statusCode).toBe(403);
    const before = matchRepo.findMatchByRoomCode(roomCode)!.match.snapshotJson;
    const offturn = await request(cookies[3]);
    expect(offturn.statusCode).toBe(200);
    expect(offturn.headers["cache-control"]).toBe("no-store");
    const quote = JSON.parse(offturn.body).preview;
    expect(quote).toMatchObject({
      revision: 4,
      totalFeesCents: 25,
      cashImpactCents: -10_025,
    });
    expect(Object.keys(JSON.parse(offturn.body))).toEqual(["preview"]);
    expect(matchRepo.findMatchByRoomCode(roomCode)!.match.snapshotJson).toBe(
      before,
    );
    expect(
      await sendCommand(clients[0]!.socket, {
        commandId: randomUUID(),
        expectedRevision: 4,
        command: { type: "BEGIN_ROUND" },
      }),
    ).toMatchObject({ ok: true, revision: 5 });
    for (let index = 0; index < 3; index++) {
      expect(
        await sendCommand(clients[index]!.socket, {
          commandId: randomUUID(),
          expectedRevision: 5 + index,
          command: { type: "PASS_SPOTLIGHT" },
        }),
      ).toMatchObject({ ok: true, revision: 6 + index });
    }
    const privateViewsBefore = await Promise.all(
      cookies.map(
        async (cookie) =>
          JSON.parse(
            (
              await server.fastify.inject({
                method: "GET",
                url: `/api/rooms/${roomCode}/match`,
                cookies: { interests_session: cookie },
              })
            ).body,
          ).match,
      ),
    );
    const snapshotBefore = JSON.parse(
      matchRepo.findMatchByRoomCode(roomCode)!.match.snapshotJson,
    ) as GameState;
    const fourth = snapshotBefore.playerOrder[3]!;
    const envelope = {
      commandId: randomUUID(),
      expectedRevision: 8,
      command: { type: "TRADE_PUBLIC_MARKETS", trades },
    };
    const accepted = await sendCommand(clients[3]!.socket, envelope);
    expect(accepted).toMatchObject({ ok: true, revision: 9 });
    const committed =
      matchRepo.findMatchByRoomCode(roomCode)!.match.snapshotJson;
    const snapshot = JSON.parse(committed) as GameState;
    expect(snapshot.currentQuarter).toBe(2);
    expect(snapshot.lastSettledQuarter).toBe(1);
    expect(snapshot.counters.settlement).toBe(
      snapshotBefore.counters.settlement + 1,
    );
    expect(
      snapshot.progress.byPlayer[fourth]!.publicMarketBasis["growth-fund"],
    ).toBe(10_025);
    expect(await sendCommand(clients[3]!.socket, envelope)).toEqual(accepted);
    expect(matchRepo.findMatchByRoomCode(roomCode)!.match.snapshotJson).toBe(
      committed,
    );
    const receipt = matchRepo.findCommandReceipt(
      matchId as MatchId,
      fourth,
      envelope.commandId,
    );
    const events = db
      .prepare(
        "SELECT event_kind, payload_json FROM match_events WHERE match_id = ? AND command_sequence = ? ORDER BY event_index ASC",
      )
      .all(matchId, receipt!.acceptedSequence) as {
      event_kind: string;
      payload_json: string;
    }[];
    expect(
      events.filter((event) => event.event_kind === "settlement-outcome"),
    ).toHaveLength(1);
    const journals = events
      .filter((event) => event.event_kind === "journal-entry")
      .map((event) => JSON.parse(event.payload_json));
    expect(
      journals.slice(0, 2).map((entry) => [entry.reason, entry.amountCents]),
    ).toEqual([
      ["public-market-purchase", 10_000],
      ["public-market-trade-fee", 25],
    ]);
    for (let index = 0; index < 3; index++) {
      const view = privateViewsBefore[index];
      expect(view.self.playerId).not.toBe(fourth);
      expect(
        view.self.financialDetails.publicMarkets.find(
          (fund: { id: string }) => fund.id === "growth-fund",
        ).valueCents,
      ).toBe(0);
      expect(
        view.players.every(
          (player: object) => !Object.hasOwn(player, "publicMarkets"),
        ),
      ).toBe(true);
    }
  });

  it("1. Host can send durable BEGIN_ROUND", async () => {
    const { clients, roomCode, cookies } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;

    const beginAck = await sendCommand(hostSocket, {
      commandId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 4,
      command: {
        type: "BEGIN_ROUND",
      },
    });

    expect(beginAck.ok).toBe(true);
    if (!beginAck.ok) throw new Error();
    expect(beginAck.outcome).toBe("ACCEPTED");
    expect(beginAck.revision).toBe(5);

    const getMatchRes = await server.fastify.inject({
      method: "GET",
      url: `/api/rooms/${roomCode}/match`,
      cookies: { interests_session: cookies[0]! },
    });
    const matchView = JSON.parse(getMatchRes.body).match as MatchPlayerView;
    expect(matchView.revision).toBe(5);
    expect(matchView.round).toEqual({
      stage: "spotlight",
      spotlightOrder: ["player-1", "player-2", "player-3", "player-4"],
      activeSpotlightPlayerId: "player-1",
      spotlightsCompleted: 0,
    });
  });

  it("2. Non-host BEGIN_ROUND is rejected and does not mutate state", async () => {
    const { clients, matchId } = await setupMatchAtRoundStart();
    const p2Socket = clients[1]!.socket;

    const nonHostAck = await sendCommand(p2Socket, {
      commandId: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 4,
      command: {
        type: "BEGIN_ROUND",
      },
    });

    expect(nonHostAck.ok).toBe(false);
    if (nonHostAck.ok) throw new Error();
    expect(nonHostAck.error.code).toBe("NOT_ROOM_HOST");
    expect(nonHostAck.revision).toBe(4);

    // Verify durable receipt persisted with REJECTED
    const receipt = matchRepo.findCommandReceipt(
      matchId as any,
      "player-2" as any,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(receipt).not.toBeNull();
    expect(receipt?.outcome).toBe("REJECTED");
    expect(receipt?.errorCode).toBe("NOT_ROOM_HOST");
    expect(receipt?.resultingRevision).toBe(4);
  });

  it("3. Repeating accepted BEGIN_ROUND with identical command ID/payload returns original receipt", async () => {
    const { clients } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;
    const commandId = "33333333-3333-4333-8333-333333333333";

    const ack1 = await sendCommand(hostSocket, {
      commandId,
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });
    expect(ack1.ok).toBe(true);

    const ack2 = await sendCommand(hostSocket, {
      commandId,
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });
    expect(ack2.ok).toBe(true);
    if (!ack2.ok) throw new Error();
    expect(ack2.outcome).toBe("ACCEPTED");
    expect(ack2.revision).toBe(5);
  });

  it("4. Reusing its command ID with modified payload is rejected", async () => {
    const { clients } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;
    const commandId = "44444444-4444-4444-8444-444444444444";

    const ack1 = await sendCommand(hostSocket, {
      commandId,
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });
    expect(ack1.ok).toBe(true);

    // Reuse command ID with PASS_SPOTLIGHT payload
    const ack2 = await sendCommand(hostSocket, {
      commandId,
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });
    expect(ack2.ok).toBe(false);
    if (ack2.ok) throw new Error();
    expect(ack2.error.code).toBe("COMMAND_ID_REUSED");
  });

  it("5. Active player can send PASS_SPOTLIGHT", async () => {
    const { clients } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;

    await sendCommand(hostSocket, {
      commandId: "55555555-5555-4555-8555-555555555551",
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });

    // player-1 (host) is active spotlight player
    const passAck = await sendCommand(hostSocket, {
      commandId: "55555555-5555-4555-8555-555555555552",
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });
    expect(passAck.ok).toBe(true);
    if (!passAck.ok) throw new Error();
    expect(passAck.outcome).toBe("ACCEPTED");
    expect(passAck.revision).toBe(6);
  });

  it("6. Non-active player receives gameplay rejection", async () => {
    const { clients } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;
    const p2Socket = clients[1]!.socket;

    await sendCommand(hostSocket, {
      commandId: "66666666-6666-4666-8666-666666666661",
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });

    // player-2 attempts to pass while player-1 has the spotlight
    const rejAck = await sendCommand(p2Socket, {
      commandId: "66666666-6666-4666-8666-666666666662",
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });

    expect(rejAck.ok).toBe(false);
    if (rejAck.ok) throw new Error();
    expect(rejAck.error.code).toBe("GAMEPLAY_REJECTED");
    expect(rejAck.error.message).toBe("NOT_ACTIVE_SPOTLIGHT");
  });

  it("7. Concurrent/stale passes cannot skip a spotlight", async () => {
    const { clients } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;

    await sendCommand(hostSocket, {
      commandId: "77777777-7777-4777-8777-777777777771",
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });

    // Send pass 1 at revision 5
    const pass1 = await sendCommand(hostSocket, {
      commandId: "77777777-7777-4777-8777-777777777772",
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });
    expect(pass1.ok).toBe(true);

    // Stale pass from another actor with expectedRevision 5
    const stalePass = await sendCommand(clients[1]!.socket, {
      commandId: "77777777-7777-4777-8777-777777777773",
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });
    expect(stalePass.ok).toBe(false);
    if (stalePass.ok) throw new Error();
    expect(stalePass.error.code).toBe("STALE_REVISION");
  });

  it("8. Personalized match views broadcast updated active spotlight", async () => {
    const { clients } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;
    const p2Socket = clients[1]!.socket;

    await sendCommand(hostSocket, {
      commandId: "88888888-8888-4888-8888-888888888881",
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });

    // Listen on p2 socket for broadcast when p1 passes
    const broadcastPromise = new Promise<MatchPlayerView>((resolve) => {
      const handler = (view: MatchPlayerView) => {
        if (view.revision === 6) {
          p2Socket.off(SOCKET_SERVER_EVENTS.MATCH_VIEW, handler);
          resolve(view);
        }
      };
      p2Socket.on(SOCKET_SERVER_EVENTS.MATCH_VIEW, handler);
    });

    await sendCommand(hostSocket, {
      commandId: "88888888-8888-4888-8888-888888888882",
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });

    const receivedView = await broadcastPromise;
    expect(receivedView.revision).toBe(6);
    expect(receivedView.round?.activeSpotlightPlayerId).toBe("player-2");
    expect(receivedView.round?.spotlightsCompleted).toBe(1);
  });

  it("9 & 10. Final spotlight pass persists command, receipt, settlement snapshot, and journal events atomically into Q2 round-start", async () => {
    const { clients, matchId } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;

    await sendCommand(hostSocket, {
      commandId: "99999999-9999-4999-8999-999999999991",
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });

    // Pass Spotlights 1, 2, 3 (revision 5, 6, 7)
    await sendCommand(clients[0]!.socket, {
      commandId: "99999999-9999-4999-8999-999999999992",
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });
    await sendCommand(clients[1]!.socket, {
      commandId: "99999999-9999-4999-8999-999999999993",
      expectedRevision: 6,
      command: { type: "PASS_SPOTLIGHT" },
    });
    await sendCommand(clients[2]!.socket, {
      commandId: "99999999-9999-4999-8999-999999999994",
      expectedRevision: 7,
      command: { type: "PASS_SPOTLIGHT" },
    });

    // Spotlight 4: player-4 passes -> final spotlight!
    const finalAck = await sendCommand(clients[3]!.socket, {
      commandId: "99999999-9999-4999-8999-999999999995",
      expectedRevision: 8,
      command: { type: "PASS_SPOTLIGHT" },
    });

    expect(finalAck.ok).toBe(true);
    if (!finalAck.ok) throw new Error();
    expect(finalAck.outcome).toBe("ACCEPTED");
    expect(finalAck.revision).toBe(9); // PR19 invariant: exactly 1 revision increment!

    // Verify snapshot in database
    const matchRecord = matchRepo.findMatchById(matchId as any);
    expect(matchRecord).not.toBeNull();
    expect(matchRecord?.match.revision).toBe(9);
    const snapshot = JSON.parse(matchRecord!.match.snapshotJson);
    expect(snapshot.currentQuarter).toBe(2);
    expect(snapshot.lastSettledQuarter).toBe(1);
    expect(snapshot.round).toEqual({
      stage: "round-start",
      spotlightsCompleted: 0,
    });

    // Verify durable receipt
    const receipt = matchRepo.findCommandReceipt(
      matchId as any,
      "player-4" as any,
      "99999999-9999-4999-8999-999999999995",
    );
    expect(receipt).not.toBeNull();
    expect(receipt?.outcome).toBe("ACCEPTED");
    expect(receipt?.resultingRevision).toBe(9);

    // Verify journal events persisted atomically in match_events
    const events = db
      .prepare(
        "SELECT event_kind, payload_json FROM match_events WHERE match_id = ? AND command_sequence = ? ORDER BY event_index ASC",
      )
      .all(matchId, receipt?.acceptedSequence) as Array<{
      event_kind: string;
      payload_json: string;
    }>;

    expect(events.length).toBeGreaterThan(0);
    const outcomes = events.filter(
      (ev) => ev.event_kind === "settlement-outcome",
    );
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(outcomes[0]!.payload_json)).toEqual(
      snapshot.finance.lastSettlement,
    );
    for (const ev of events.filter((ev) => ev.event_kind === "journal-entry")) {
      const parsed = JSON.parse(ev.payload_json);
      expect(parsed).toHaveProperty("reason");
      expect(parsed).toHaveProperty("amountCents");
    }
  });

  it("11. Restart during a spotlight preserves exact orchestration state", async () => {
    const { clients, roomCode, matchId } = await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;

    await sendCommand(hostSocket, {
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });

    // Pass Spotlight 1 -> now in Spotlight 2 (player-2 active, spotlightsCompleted: 1)
    await sendCommand(clients[0]!.socket, {
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      expectedRevision: 5,
      command: { type: "PASS_SPOTLIGHT" },
    });

    // Simulate server restart
    const matchBefore = matchRepo.findMatchById(matchId as any)!;
    expect(matchBefore.match.revision).toBe(6);

    // Run startup recovery
    recoverActiveMatchesOnStartup(matchRepo, lobbyRepo);

    // Verify snapshot loaded from DB
    const matchAfter = matchRepo.findMatchById(matchId as any)!;
    const state = JSON.parse(matchAfter.match.snapshotJson);
    expect(state.currentQuarter).toBe(1);
    expect(state.revision).toBe(6);
    expect(state.round).toEqual({
      stage: "spotlight",
      spotlightsCompleted: 1,
    });
  });

  it("12 & 13. Restart during round-start preserves it, and host resume does not alter state", async () => {
    const { clients, roomCode, matchId, cookies } =
      await setupMatchAtRoundStart();
    const hostSocket = clients[0]!.socket;

    // Advance through entire Q1 to Q2 round-start
    const beginAck = await sendCommand(hostSocket, {
      commandId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });
    expect(beginAck.ok).toBe(true);

    for (let i = 0; i < 4; i++) {
      const passAck = await sendCommand(clients[i]!.socket, {
        commandId: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${i + 2}`,
        expectedRevision: 5 + i,
        command: { type: "PASS_SPOTLIGHT" },
      });
      expect(passAck.ok).toBe(true);
    }

    const matchBeforeRestart = matchRepo.findMatchById(matchId as any)!;
    const snapshotBefore = JSON.parse(matchBeforeRestart.match.snapshotJson);
    expect(snapshotBefore.currentQuarter).toBe(2);
    expect(snapshotBefore.round.stage).toBe("round-start");
    const revisionBefore = matchBeforeRestart.match.revision;

    // Run startup recovery
    recoverActiveMatchesOnStartup(matchRepo, lobbyRepo);

    // Verify SERVER_RESTART pause reason was added
    const pauseReasons = lobbyRepo.getPauseReasons(roomCode);
    expect(pauseReasons).toContain("SERVER_RESTART");

    // Reconnect and synchronize all 4 clients to permit host resume
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets.length = 0;

    const newClients: Array<{
      socket: ClientSocket;
      bootstrap: BootstrapPayload;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const c = await connectSocket(cookies[i]!, roomCode);
      newClients.push(c);
      await syncSocket(c.socket, c.bootstrap.self.connectionGeneration);
    }

    // Host resumes the room via socket event
    const resumeRes = await new Promise<{ ok: boolean }>((resolve) => {
      newClients[0]!.socket.emit(
        SOCKET_CLIENT_EVENTS.RESUME,
        (res: { ok: boolean }) => resolve(res),
      );
    });
    expect(resumeRes.ok).toBe(true);

    // Verify state unchanged after resume
    const matchAfterResume = matchRepo.findMatchById(matchId as any)!;
    expect(matchAfterResume.match.revision).toBe(revisionBefore);
    const snapshotAfter = JSON.parse(matchAfterResume.match.snapshotJson);
    expect(snapshotAfter.currentQuarter).toBe(2);
    expect(snapshotAfter.round).toEqual({
      stage: "round-start",
      spotlightsCompleted: 0,
    });
    expect(snapshotAfter.random).toEqual(snapshotBefore.random);
    expect(snapshotAfter.counters).toEqual(snapshotBefore.counters);

    // Host can now send BEGIN_ROUND for Q2
    const q2BeginAck = await sendCommand(newClients[0]!.socket, {
      commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      expectedRevision: revisionBefore,
      command: { type: "BEGIN_ROUND" },
    });
    expect(q2BeginAck.ok).toBe(true);
    if (!q2BeginAck.ok) throw new Error();
    expect(q2BeginAck.revision).toBe(revisionBefore + 1);

    const matchFinal = matchRepo.findMatchById(matchId as any)!;
    const finalState = JSON.parse(matchFinal.match.snapshotJson);
    expect(finalState.round).toEqual({
      stage: "spotlight",
      spotlightsCompleted: 0,
    });
  });
  it("persists company receipts and payouts exactly once and isolates private company cash in HTTP views", async () => {
    const { clients, cookies, roomCode, matchId } =
      await setupMatchAtRoundStart();
    const readState = (): GameState => {
      const record = matchRepo.findMatchById(matchId as MatchId);
      if (!record) throw new Error("Missing match");
      return JSON.parse(record.match.snapshotJson) as GameState;
    };
    for (let quarter = 1; quarter <= 2; quarter++) {
      expect(
        await sendCommand(clients[0]!.socket, {
          commandId: randomUUID(),
          expectedRevision: readState().revision,
          command: { type: "BEGIN_ROUND" },
        }),
      ).toMatchObject({ ok: true });
      for (let turn = 0; turn < 4; turn++) {
        const before = readState();
        const actor = getActiveSpotlightPlayerId(before);
        if (!actor) throw new Error("Missing active player");
        const socket = clients[before.playerOrder.indexOf(actor)]!.socket;
        const envelope = {
          commandId: randomUUID(),
          expectedRevision: before.revision,
          command: { type: "PASS_SPOTLIGHT" },
        };
        expect(await sendCommand(socket, envelope)).toMatchObject({
          ok: true,
          revision: before.revision + 1,
        });
        if (turn === 3) {
          const committed = JSON.stringify(readState());
          expect(await sendCommand(socket, envelope)).toMatchObject({
            ok: true,
            revision: before.revision + 1,
          });
          expect(JSON.stringify(readState())).toBe(committed);
        }
      }
    }
    const state = readState();
    const company = Object.values(state.finance.assetsById).find(
      (asset) =>
        asset.kind === "business" &&
        asset.cashPolicyId === "retained-profit-v1",
    );
    if (company?.kind !== "business") throw new Error("Missing company");
    expect(company.cashCents).toBe(75_000);
    const outcome = state.finance.lastSettlement?.businesses.find(
      (b) => b.assetId === company.id,
    );
    expect(outcome).toMatchObject({
      assetId: company.id,
      operatingCashCents: 375_000,
      closingCashCents: 75_000,
    });
    const events = db
      .prepare(
        "SELECT payload_json FROM match_events WHERE match_id = ? AND event_kind = 'journal-entry'",
      )
      .all(matchId) as { payload_json: string }[];
    const payouts = events
      .map((event) => JSON.parse(event.payload_json))
      .filter(
        (entry) =>
          entry.reason === "business-distribution" &&
          entry.relatedAssetId === company.id,
      );
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      amountCents: 300_000,
      source: { kind: "business", assetId: company.id },
    });
    const getView = async (index: number): Promise<MatchPlayerView> => {
      const response = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[index]! },
      });
      expect(response.statusCode).toBe(200);
      return JSON.parse(response.body).match;
    };
    const ownerIndex = state.playerOrder.findIndex(
      (id) => (company.ownershipByPlayerPpm[id] ?? 0) > 0,
    );
    expect(
      (await getView(ownerIndex)).self.lastSettlement?.businessDistributions,
    ).toContainEqual({ assetId: company.id, amountCents: 300_000 });
    const unrelatedIndex = (ownerIndex + 1) % 4;
    const unrelated = await getView(unrelatedIndex);
    expect(
      unrelated.self.lastSettlement?.businessDistributions?.some(
        (b) => b.assetId === company.id,
      ),
    ).toBe(false);
    if (!outcome || !state.finance.lastSettlement)
      throw new Error("Missing company outcome");
    const paired: GameState = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [company.id]: { ...company, cashCents: cents(75_001) },
        },
        lastSettlement: {
          ...state.finance.lastSettlement,
          businesses: state.finance.lastSettlement.businesses.map((b) =>
            b.assetId === company.id
              ? {
                  ...b,
                  openingCashCents: cents(1),
                  closingCashCents: cents(75_001),
                }
              : b,
          ),
        },
      },
    };
    assertGameState(paired);
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      JSON.stringify(paired),
      matchId,
    );
    expect(await getView(unrelatedIndex)).toEqual(unrelated);
  });

  it("persists zero-payment arrears once, keeps private views isolated, and restores them after a real server/database restart", async () => {
    const { clients, cookies, roomCode, matchId } =
      await setupMatchAtRoundStart();
    const record = matchRepo.findMatchById(matchId as MatchId);
    if (!record) throw new Error("Missing match");
    const fixture = JSON.parse(record.match.snapshotJson) as GameState;
    const debtor = fixture.playerOrder[1];
    if (!debtor) throw new Error("Missing debtor");
    // Explicit isolated shortfall fixture; commands below use real authenticated transport.
    const unpaidCompanyId = asAssetId(`asset-${fixture.counters.asset + 1}`);
    const unpaidLoanId = asLoanId(`loan-${fixture.counters.loan + 1}`);
    const companies = {
      ...Object.fromEntries(
        Object.entries(fixture.finance.assetsById).map(([id, asset]) => [
          id,
          asset.kind === "business" &&
          asset.workCompensation?.playerId === debtor
            ? {
                ...asset,
                annualManagementCostCents:
                  asset.workCompensation.annualCompensationCents,
                workCompensation: {
                  ...asset.workCompensation,
                  annualCompensationCents: cents(0),
                },
              }
            : asset,
        ]),
      ),
      [unpaidCompanyId]: {
        id: unpaidCompanyId,
        kind: "business" as const,
        cashPolicyId: "starting-company-v1" as const,
        cashCents: cents(0),
        operatingArrearsCents: cents(0),
        annualRevenueCents: cents(30_000_000),
        annualOperatingProfitCents: cents(-4_000_000),
        enterpriseValueCents: cents(15_000_000),
        workCompensation: {
          playerId: debtor,
          annualCompensationCents: cents(3_600_000),
          arrearsCents: cents(0),
        },
        ownershipByPlayerPpm: { [debtor]: ownershipPpm(1_000_000) },
      },
    };
    const changed: GameState = {
      ...fixture,
      counters: {
        ...fixture.counters,
        asset: fixture.counters.asset + 1,
        loan: fixture.counters.loan + 1,
      },
      finance: {
        ...fixture.finance,
        assetsById: companies,
        loansById: {
          ...fixture.finance.loansById,
          [unpaidLoanId]: {
            id: unpaidLoanId,
            kind: "company-loan",
            borrowerAssetId: unpaidCompanyId,
            originalPrincipalCents: cents(6_000_000),
            outstandingPrincipalCents: cents(6_000_000),
            annualRateBps: basisPoints(800),
            scheduledQuarterlyPaymentCents: cents(281_938),
            firstDueQuarter: 1,
            termQuarters: 28,
            periodsProcessed: 0,
            principalRepaidCents: cents(0),
            pastDuePrincipalCents: cents(0),
            unpaidInterestCents: cents(0),
            lastProcessedQuarter: 0,
          },
        },
        cashByPlayer: { ...fixture.finance.cashByPlayer, [debtor]: cents(0) },
        quarterStartBasis: {
          ...fixture.finance.quarterStartBasis,
          businessesById: captureBusinessBasis(companies),
          cashByPlayer: {
            ...fixture.finance.quarterStartBasis.cashByPlayer,
            [debtor]: cents(0),
          },
        },
        recurringByPlayer: {
          ...fixture.finance.recurringByPlayer,
          [debtor]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(9_382_715),
          },
        },
      },
    };
    let openingChanged = {
      ...changed,
      finance: {
        ...changed.finance,
        quarterStartBasis: {
          ...changed.finance.quarterStartBasis,
          recurringByPlayer: changed.finance.recurringByPlayer,
        },
      },
    };
    openingChanged = {
      ...openingChanged,
      progress: createProgress(
        openingChanged.finance,
        openingChanged.playerOrder,
      ),
    };
    assertGameState(openingChanged);
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      JSON.stringify(openingChanged),
      matchId,
    );
    const broadcastViews = clients.map(
      (client) =>
        new Promise<MatchPlayerView>((resolve) => {
          const handler = (view: MatchPlayerView) => {
            if (view.revision === 9) {
              client.socket.off(SOCKET_SERVER_EVENTS.MATCH_VIEW, handler);
              resolve(view);
            }
          };
          client.socket.on(SOCKET_SERVER_EVENTS.MATCH_VIEW, handler);
        }),
    );
    const begin = await sendCommand(clients[0]!.socket, {
      commandId: randomUUID(),
      expectedRevision: 4,
      command: { type: "BEGIN_ROUND" },
    });
    expect(begin.ok).toBe(true);
    let finalEnvelope:
      | {
          commandId: string;
          expectedRevision: number;
          command: { type: "PASS_SPOTLIGHT" };
        }
      | undefined;
    for (let index = 0; index < 4; index++) {
      const envelope = {
        commandId: randomUUID(),
        expectedRevision: 5 + index,
        command: { type: "PASS_SPOTLIGHT" as const },
      };
      const ack = await sendCommand(clients[index]!.socket, envelope);
      expect(ack).toMatchObject({ ok: true, revision: 6 + index });
      finalEnvelope = envelope;
    }
    if (!finalEnvelope) throw new Error("Missing final command");
    const committed = matchRepo.findMatchById(matchId as MatchId);
    if (!committed) throw new Error("Missing committed match");
    const snapshot = JSON.parse(committed.match.snapshotJson) as GameState;
    expect(snapshot.currentQuarter).toBe(2);
    expect(snapshot.finance.livingArrearsByPlayer[debtor]).toBeGreaterThan(0);
    expect(
      snapshot.finance.lastSettlement?.loanPayments
        .filter((p) => p.borrowerPlayerId === debtor)
        .every((p) => p.paidCents === 0),
    ).toBe(true);
    const retry = await sendCommand(clients[3]!.socket, finalEnvelope);
    expect(retry).toMatchObject({ ok: true, revision: 9 });
    expect(
      matchRepo.findMatchById(matchId as MatchId)?.match.snapshotJson,
    ).toBe(committed.match.snapshotJson);
    const outcomes = db
      .prepare(
        "SELECT payload_json FROM match_events WHERE match_id = ? AND event_kind = 'settlement-outcome'",
      )
      .all(matchId) as { payload_json: string }[];
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(outcomes[0]!.payload_json)).toEqual(
      snapshot.finance.lastSettlement,
    );
    const getView = async (index: number) => {
      const response = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[index]! },
      });
      expect(response.statusCode).toBe(200);
      return JSON.parse(response.body).match as MatchPlayerView;
    };
    const own = await getView(1);
    const unrelated = await getView(0);
    const broadcasts = await Promise.all(broadcastViews);
    expect(broadcasts[0]).toEqual(unrelated);
    expect(broadcasts[1]).toEqual(own);
    const rejectedOriginal = await sendCommand(clients[0]!.socket, {
      commandId: randomUUID(),
      expectedRevision: 9,
      command: { type: "PASS_SPOTLIGHT" },
    });
    expect(rejectedOriginal.ok).toBe(false);
    expect(own.self.livingExpenseArrearsCents).toBe(
      snapshot.finance.livingArrearsByPlayer[debtor],
    );
    expect(own.self.lastSettlement?.livingDueCents).toBe(9_382_715);
    expect(own.self.lastSettlement?.workCompensation).toContainEqual({
      assetId: unpaidCompanyId,
      dueCents: 900_000,
      paidCents: 0,
      unpaidCents: 900_000,
    });
    expect(own.self.loans?.find((l) => l.id === unpaidLoanId)).toMatchObject({
      role: "company-borrower",
      status: "in-arrears",
      outstandingPrincipalCents: 6_000_000,
      unpaidInterestCents: 120_000,
    });
    expect(
      unrelated.players.find((player) => player.playerId === debtor)
        ?.publicPosition?.assets,
    ).toContainEqual({
      assetId: unpaidCompanyId,
      kind: "business",
      ownershipPpm: 1_000_000,
      partnerIds: [],
    });
    expect(JSON.stringify(unrelated.self)).not.toContain(unpaidCompanyId);
    expect(JSON.stringify(unrelated)).not.toContain(unpaidLoanId);
    expect(JSON.stringify(unrelated)).not.toContain("livingByPlayer");
    const alternate = JSON.parse(JSON.stringify(snapshot)) as GameState;
    const past = alternate.finance.livingArrearsByPlayer[debtor] ?? 0;
    const summary = alternate.finance.lastSettlement;
    if (!summary || !summary.livingByPlayer[debtor])
      throw new Error("Missing living summary");
    const paired: GameState = {
      ...alternate,
      finance: {
        ...alternate.finance,
        livingArrearsByPlayer: {
          ...alternate.finance.livingArrearsByPlayer,
          [debtor]: cents(past + 1),
        },
        lastSettlement: {
          ...summary,
          livingByPlayer: {
            ...summary.livingByPlayer,
            [debtor]: {
              ...summary.livingByPlayer[debtor],
              currentDueCents: cents(9_382_716),
              closingArrearsCents: cents(past + 1),
            },
          },
        },
      },
    };
    assertGameState(paired);
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      JSON.stringify(paired),
      matchId,
    );
    expect(await getView(0)).toEqual(unrelated);
    const rejectedPaired = await sendCommand(clients[0]!.socket, {
      commandId: randomUUID(),
      expectedRevision: 9,
      command: { type: "PASS_SPOTLIGHT" },
    });
    if (rejectedOriginal.ok || rejectedPaired.ok)
      throw new Error("Expected rejected spotlight command");
    expect(rejectedPaired.error).toEqual(rejectedOriginal.error);
    const pairedBootstrap = await connectSocket(cookies[0]!, roomCode);
    expect(pairedBootstrap.bootstrap.match).toEqual(unrelated);
    pairedBootstrap.socket.disconnect();
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      committed.match.snapshotJson,
      matchId,
    );
    for (const client of clients) client.socket.disconnect();
    await server.close();
    db.close();
    db = openDatabase({ dbPath: tempDbPath });
    runMigrations(db, migrationsDir);
    lobbyRepo = new SqliteLobbyRepository(db);
    matchRepo = new SqliteMatchRepository(db);
    recoverActiveMatchesOnStartup(matchRepo, lobbyRepo);
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
    if (!address || typeof address !== "object")
      throw new Error("Missing address");
    serverPort = address.port;
    expect(
      matchRepo.findMatchById(matchId as MatchId)?.match.snapshotJson,
    ).toBe(committed.match.snapshotJson);
    expect((await getView(1)).self.lastSettlement).toEqual(
      own.self.lastSettlement,
    );
    const replacements: Awaited<ReturnType<typeof connectSocket>>[] = [];
    for (const cookie of cookies) {
      const client = await connectSocket(cookie, roomCode);
      replacements.push(client);
      expect(client.bootstrap.match).toEqual(
        await getView(replacements.length - 1),
      );
      await syncSocket(
        client.socket,
        client.bootstrap.self.connectionGeneration,
      );
    }
    const resumed = await new Promise<{ ok: boolean }>((resolve) =>
      replacements[0]!.socket.emit(SOCKET_CLIENT_EVENTS.RESUME, resolve),
    );
    expect(resumed.ok).toBe(true);
    expect(
      matchRepo.findMatchById(matchId as MatchId)?.match.snapshotJson,
    ).toBe(committed.match.snapshotJson);
    expect(
      await sendCommand(replacements[0]!.socket, {
        commandId: randomUUID(),
        expectedRevision: 9,
        command: { type: "BEGIN_ROUND" },
      }),
    ).toMatchObject({ ok: true, revision: 10 });
  });
  it("persists ordinary property funding, canonical bank debt, private positions and identical retry receipts", async () => {
    const { clients, roomCode, cookies, matchId } =
      await setupMatchAtRoundStart();
    async function getView(index: number): Promise<MatchPlayerView> {
      const result = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[index]! },
      });
      expect(result.statusCode).toBe(200);
      return JSON.parse(result.body).match;
    }
    expect(
      (
        await sendCommand(clients[0]!.socket, {
          commandId: randomUUID(),
          expectedRevision: 4,
          command: { type: "BEGIN_ROUND" },
        })
      ).ok,
    ).toBe(true);
    let purchase: {
      index: number;
      view: MatchPlayerView;
      quote: NonNullable<
        MatchPlayerView["self"]["propertyOffers"]
      >[number]["quotes"][number];
    } | null = null;
    for (let turn = 0; turn < 32; turn++) {
      let first = await getView(0);
      if (first.round?.stage === "round-start") {
        expect(
          (
            await sendCommand(clients[0]!.socket, {
              commandId: randomUUID(),
              expectedRevision: first.revision,
              command: { type: "BEGIN_ROUND" },
            })
          ).ok,
        ).toBe(true);
        first = await getView(0);
      }
      const index = first.players.findIndex(
        (player) => player.playerId === first.round!.activeSpotlightPlayerId,
      );
      const own = await getView(index);
      const quote = own.self.propertyOffers![0]!.quotes.find(
        (item) => item.principalCents > 0 && item.canClose,
      );
      if (quote) {
        purchase = { index, view: own, quote };
        break;
      }
      expect(
        (
          await sendCommand(clients[index]!.socket, {
            commandId: randomUUID(),
            expectedRevision: own.revision,
            command: { type: "PASS_SPOTLIGHT" },
          })
        ).ok,
      ).toBe(true);
    }
    if (!purchase) throw new Error("Expected an ordinary affordable mortgage");
    const { index, view, quote } = purchase;
    const envelope = {
      commandId: randomUUID(),
      expectedRevision: view.revision,
      command: {
        type: "BUY_PROPERTY",
        catalogueId: "residential-duplex",
        principalCents: quote.principalCents,
        rateKind: quote.rateKind,
      },
    };
    const ack = await sendCommand(clients[index]!.socket, envelope);
    expect(ack.ok).toBe(true);
    const record = matchRepo.findMatchById(matchId as MatchId)!;
    const snapshot = JSON.parse(record.match.snapshotJson) as GameState;
    assertGameState(snapshot);
    const loan = Object.values(snapshot.finance.loansById).find(
      (loan) => loan.kind === "asset-bank-loan",
    )!;
    expect(loan).toHaveProperty(
      "outstandingPrincipalCents",
      quote.principalCents,
    );
    expect(loan).not.toHaveProperty("borrowerPlayerId");
    const retry = await sendCommand(clients[index]!.socket, envelope);
    expect(retry).toEqual(ack);
    expect(
      matchRepo.findMatchById(matchId as MatchId)!.match.snapshotJson,
    ).toBe(record.match.snapshotJson);
    const own = await getView(index);
    expect(own.self.loans!.some((item) => item.id === loan.id)).toBe(true);
    expect(
      own.self.propertyManagement!.filter(
        (item) => item.assetId === loan.borrowerAssetId,
      ),
    ).toHaveLength(1);
    for (let other = 0; other < 4; other++)
      if (other !== index) {
        const view = await getView(other);
        expect(view.self.loans!.some((item) => item.id === loan.id)).toBe(
          false,
        );
        expect(
          view.self.propertyManagement!.some(
            (item) => item.assetId === loan.borrowerAssetId,
          ),
        ).toBe(false);
      }
    const journals = db
      .prepare(
        "SELECT payload_json FROM match_events WHERE match_id = ? AND event_kind = 'journal-entry'",
      )
      .all(matchId) as { payload_json: string }[];
    expect(
      journals.filter(
        (row) =>
          JSON.parse(row.payload_json).reason === "asset-bank-loan-origination",
      ),
    ).toHaveLength(1);
    const unrelatedIndex = (index + 1) % 4;
    const unrelated = await getView(unrelatedIndex);
    const paired = JSON.parse(record.match.snapshotJson) as GameState;
    if (loan.kind !== "asset-bank-loan")
      throw new Error("Expected bank asset borrower");
    const property = paired.finance.assetsById[loan.borrowerAssetId];
    if (property?.kind !== "property")
      throw new Error("Missing financed property");
    const pairedState: GameState = {
      ...paired,
      finance: {
        ...paired.finance,
        assetsById: {
          ...paired.finance.assetsById,
          [property.id]: {
            ...property,
            cashCents: cents((property.cashCents ?? 0) + 11),
          },
        },
      },
    };
    assertGameState(pairedState);
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      JSON.stringify(pairedState),
      matchId,
    );
    try {
      expect(await getView(unrelatedIndex)).toEqual(unrelated);
      expect((await getView(index)).self.propertyManagement).not.toEqual(
        own.self.propertyManagement,
      );
    } finally {
      db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
        record.match.snapshotJson,
        matchId,
      );
    }
    const forged = await sendCommand(clients[index]!.socket, {
      commandId: randomUUID(),
      expectedRevision: own.revision,
      command: { ...envelope.command, annualRateBps: 0 },
    });
    expect(forged.ok).toBe(false);
    expect(
      matchRepo.findMatchById(matchId as MatchId)!.match.snapshotJson,
    ).toBe(record.match.snapshotJson);
  });
  it("persists unanimous shared-property closing and private terms with retry-safe pro-rata payouts", async () => {
    const { clients, roomCode, cookies, matchId } =
      await setupMatchAtRoundStart();
    const original = JSON.parse(
      matchRepo.findMatchById(matchId as MatchId)!.match.snapshotJson,
    ) as GameState;
    const [a, b, c] = original.playerOrder;
    if (!a || !b || !c) throw new Error("Missing fixture owners");
    const propertyId = asAssetId("shared-server-property");
    const property = {
      id: propertyId,
      kind: "property" as const,
      marketValueCents: cents(10_000_000),
      scheduledQuarterlyRentCents: cents(275_000),
      occupancyBps: basisPoints(9500),
      operatingExpenseRatioBps: basisPoints(3000),
      cashCents: cents(0),
      ownershipByPlayerPpm: {
        [a]: ownershipPpm(600_000),
        [b]: ownershipPpm(400_000),
      },
    };
    const finance = {
      ...original.finance,
      assetsById: { ...original.finance.assetsById, [propertyId]: property },
      quarterStartBasis: {
        ...original.finance.quarterStartBasis,
        propertiesById: capturePropertyBasis({
          ...original.finance.assetsById,
          [propertyId]: property,
        }),
      },
    };
    const fixture = {
      ...original,
      finance,
      progress: createProgress(finance, original.playerOrder),
    };
    assertGameState(fixture);
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      JSON.stringify(fixture),
      matchId,
    );
    async function view(index: number): Promise<MatchPlayerView> {
      const response = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[index]! },
      });
      expect(response.statusCode).toBe(200);
      return JSON.parse(response.body).match;
    }
    async function command(
      index: number,
      payload: unknown,
      expectedRevision: number,
      commandId = randomUUID(),
    ) {
      return sendCommand(clients[index]!.socket, {
        commandId,
        expectedRevision,
        command: payload,
      });
    }
    expect((await command(0, { type: "BEGIN_ROUND" }, 4)).ok).toBe(true);
    expect(
      (
        await command(
          0,
          {
            type: "OPEN_JOINT_PROPERTY",
            assetId: propertyId,
            terms: { kind: "sale" },
          },
          5,
        )
      ).ok,
    ).toBe(true);
    const own = await view(0),
      coowner = await view(1),
      other = await view(2);
    expect(own.jointProperty).toEqual(coowner.jointProperty);
    expect(other.jointProperty).toBeNull();
    expect(other.hasActiveTransaction).toBe(true);
    const deal = own.jointProperty!;
    const confirm = {
      type: "CONFIRM_JOINT_PROPERTY",
      transactionId: deal.id,
      expectedTermsRevision: 1,
    };
    expect((await command(2, confirm, 6)).ok).toBe(false);
    expect((await command(0, confirm, 6)).ok).toBe(true);
    const id = randomUUID();
    const ack = await command(1, confirm, 7, id);
    expect(ack.ok).toBe(true);
    expect(await command(1, confirm, 7, id)).toEqual(ack);
    const pending = matchRepo.findMatchById(matchId as MatchId)!.match
      .snapshotJson;
    const loaded = JSON.parse(pending) as GameState;
    assertGameState(loaded);
    expect(loaded.activeTransaction).toMatchObject({
      kind: "joint-property",
      confirmedPlayerIds: [a, b],
    });
    const paired = {
      ...loaded,
      finance: {
        ...loaded.finance,
        cashByPlayer: {
          ...loaded.finance.cashByPlayer,
          [b]: cents(loaded.finance.cashByPlayer[b]! + 11),
        },
      },
    };
    assertGameState(paired);
    const unrelated = await view(2);
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      JSON.stringify(paired),
      matchId,
    );
    expect(await view(2)).toEqual(unrelated);
    db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
      pending,
      matchId,
    );
    const close = {
      type: "CLOSE_JOINT_PROPERTY",
      transactionId: deal.id,
      expectedTermsRevision: 1,
    };
    const closeId = randomUUID();
    const closed = await command(0, close, 8, closeId);
    expect(closed.ok).toBe(true);
    expect(await command(0, close, 8, closeId)).toEqual(closed);
    const snapshot = JSON.parse(
      matchRepo.findMatchById(matchId as MatchId)!.match.snapshotJson,
    ) as GameState;
    expect(snapshot.finance.cashByPlayer[a]).toBe(
      fixture.finance.cashByPlayer[a]! + 5_760_000,
    );
    expect(snapshot.finance.cashByPlayer[b]).toBe(
      fixture.finance.cashByPlayer[b]! + 3_840_000,
    );
    expect(snapshot.activeTransaction).toBeNull();
    expect(snapshot.round!.spotlightsCompleted).toBe(1);
    const entries = db
      .prepare(
        "SELECT payload_json FROM match_events WHERE match_id = ? AND event_kind = 'journal-entry'",
      )
      .all(matchId) as { payload_json: string }[];
    expect(
      entries.filter((row) => {
        const entry = JSON.parse(row.payload_json);
        return (
          entry.relatedAssetId === propertyId &&
          entry.reason === "property-sale-proceeds"
        );
      }),
    ).toHaveLength(2);
  });
});
