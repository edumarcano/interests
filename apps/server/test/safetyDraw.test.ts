import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameState, JournalEntry } from "@interests/engine";
import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  PlayerCommandEnvelope,
} from "@interests/shared";
import { io as ioClient, type Socket } from "socket.io-client";
import { expect, it } from "vitest";
import { createServer } from "../src/createServer";
import { loadAndValidatePersistedMatch } from "../src/match/snapshotLoader";
import { recoverActiveMatchesOnStartup } from "../src/match/startupRecovery";
import { runMigrations } from "../src/persistence/sqlite/migrations";
import { openDatabase } from "../src/persistence/sqlite/openDatabase";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository";
import { SqliteMatchRepository } from "../src/persistence/sqlite/SqliteMatchRepository";
import {
  SOCKET_CLIENT_EVENTS,
  SOCKET_SERVER_EVENTS,
} from "../src/realtime/socketProtocol";
import type { BootstrapPayload } from "../src/realtime/types";

it("finishes an ordinary four-client Q32 match atomically, retains terminal HTTP/socket views and survives restart without pauses", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "interests-real-q32-"));
  const dbPath = path.join(temp, "match.sqlite");
  const migrations = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../migrations",
  );
  let db = openDatabase({ dbPath });
  runMigrations(db, migrations);
  let lobby = new SqliteLobbyRepository(db);
  let matches = new SqliteMatchRepository(db);
  let server = createServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      dbPath,
      cookieSecure: false,
      rateLimitDisabled: true,
    },
    repository: lobby,
    matchRepository: matches,
  });
  await server.fastify.listen({ host: "127.0.0.1", port: 0 });
  let port = (server.fastify.server.address() as { port: number }).port;
  const sockets: Socket[] = [];
  async function connect(cookie: string, roomCode: string) {
    const result = await new Promise<{
      socket: Socket;
      bootstrap: BootstrapPayload;
    }>((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
        extraHeaders: {
          cookie: `interests_session=${cookie}`,
          origin: `http://127.0.0.1:${port}`,
        },
        auth: { roomCode, protocolVersion: "1" },
      });
      sockets.push(socket);
      socket.once(SOCKET_SERVER_EVENTS.BOOTSTRAP, (bootstrap) =>
        resolve({ socket, bootstrap }),
      );
      socket.once("connect_error", reject);
    });
    const ack = await new Promise<{ ok: boolean }>((resolve) =>
      result.socket.emit(
        SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
        { connectionGeneration: result.bootstrap.self.connectionGeneration },
        resolve,
      ),
    );
    expect(ack.ok).toBe(true);
    return result;
  }
  function send(socket: Socket, envelope: PlayerCommandEnvelope) {
    return new Promise<CommandAckResult>((resolve) =>
      socket.emit(SOCKET_CLIENT_EVENTS.COMMAND, envelope, resolve),
    );
  }
  try {
    const created = await server.fastify.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { nickname: "Host" },
    });
    const roomCode = created.json().room.code as string;
    const cookies = [
      created.cookies.find((cookie) => cookie.name === "interests_session")!
        .value,
    ];
    const recoveryCodes = [created.json().self.recoveryCode as string];
    for (let number = 2; number <= 4; number++) {
      const response = await server.fastify.inject({
        method: "POST",
        url: `/api/rooms/${roomCode}/join`,
        payload: { nickname: `Player ${number}` },
      });
      cookies.push(
        response.cookies.find((cookie) => cookie.name === "interests_session")!
          .value,
      );
      recoveryCodes.push(response.json().self.recoveryCode);
    }
    let clients = [];
    for (const cookie of cookies) clients.push(await connect(cookie, roomCode));
    const started = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/start`,
      cookies: { interests_session: cookies[0]! },
    });
    expect(started.statusCode).toBe(200);
    const matchId = started.json().match.matchId;
    async function view(index = 0): Promise<MatchPlayerView> {
      const response = await server.fastify.inject({
        method: "GET",
        url: `/api/rooms/${roomCode}/match`,
        cookies: { interests_session: cookies[index]! },
      });
      expect(response.statusCode).toBe(200);
      return response.json().match;
    }
    let playerViews = await Promise.all(cookies.map((_, index) => view(index)));
    for (let index = 0; index < 4; index++) {
      expect(
        (
          await send(clients[index]!.socket, {
            commandId: randomUUID(),
            expectedRevision: index,
            command: {
              type: "CHOOSE_OBJECTIVE",
              objectiveId: playerViews[index]!.self.offeredObjectiveIds[0],
            },
          })
        ).ok,
      ).toBe(true);
    }
    let current = await view();
    let finalEnvelope: PlayerCommandEnvelope | null = null;
    let finalActorIndex = 0;
    let beforeFinal: GameState | null = null;
    while (current.phase !== "finished") {
      const command: PlayerCommand =
        current.round!.stage === "round-start"
          ? { type: "BEGIN_ROUND" }
          : { type: "PASS_SPOTLIGHT" };
      const actorIndex =
        command.type === "BEGIN_ROUND"
          ? 0
          : playerViews.findIndex(
              (player) =>
                player.self.playerId === current.round!.activeSpotlightPlayerId,
            );
      const envelope: PlayerCommandEnvelope = {
        commandId: randomUUID(),
        expectedRevision: current.revision,
        command,
      };
      if (
        current.currentQuarter === 32 &&
        current.round!.stage === "spotlight" &&
        current.round!.spotlightsCompleted === 3
      ) {
        finalEnvelope = envelope;
        finalActorIndex = actorIndex;
        beforeFinal = JSON.parse(
          matches.findMatchByRoomCode(roomCode)!.match.snapshotJson,
        );
        // Deliberate failure in this temporary database proves the terminal transaction rolls back every earlier write.
        db.exec(
          "CREATE TRIGGER refuse_finish BEFORE UPDATE OF status ON rooms WHEN NEW.status = 'FINISHED' BEGIN SELECT RAISE(ABORT, 'isolated terminal transaction failure'); END;",
        );
        const failed = await send(clients[actorIndex]!.socket, envelope);
        expect(failed).toMatchObject({
          ok: false,
          error: { code: "INTERNAL_ERROR" },
        });
        expect(matches.findMatchByRoomCode(roomCode)!.match.snapshotJson).toBe(
          JSON.stringify(beforeFinal),
        );
        expect(matches.findMatchByRoomCode(roomCode)!.match.status).toBe(
          "ACTIVE",
        );
        expect(matches.findRoomWithMembers(roomCode)!.room.status).toBe(
          "IN_MATCH",
        );
        expect(
          matches.findCommandReceipt(
            matchId,
            playerViews[actorIndex]!.self.playerId,
            envelope.commandId,
          ),
        ).toBeNull();
        expect(
          (
            db
              .prepare(
                "SELECT count(*) AS n FROM match_events WHERE match_id = ? AND event_kind = 'match-result'",
              )
              .get(matchId) as { n: number }
          ).n,
        ).toBe(0);
        db.exec("DROP TRIGGER refuse_finish");
      }
      const accepted = await send(clients[actorIndex]!.socket, envelope);
      expect(accepted).toMatchObject({
        ok: true,
        revision: current.revision + 1,
      });
      current = await view();
    }
    if (!finalEnvelope || !beforeFinal)
      throw new Error("Ordinary journey skipped the final spotlight");
    expect(current).toMatchObject({
      phase: "finished",
      currentQuarter: 32,
      revision: 164,
      result: { kind: "safety-draw", completedQuarter: 32 },
      round: null,
    });
    const persisted = matches.findMatchByRoomCode(roomCode)!;
    const room = matches.findRoomWithMembers(roomCode)!;
    expect(persisted.match.status).toBe("FINISHED");
    expect(room.room.status).toBe("FINISHED");
    expect(matches.listActiveMatches()).toEqual([]);
    const finalState = loadAndValidatePersistedMatch(
      persisted,
      room.members,
      room.room.status,
    );
    expect(() =>
      loadAndValidatePersistedMatch(
        { ...persisted, match: { ...persisted.match, status: "ACTIVE" } },
        room.members,
        room.room.status,
      ),
    ).toThrow("operational status");
    expect(() =>
      loadAndValidatePersistedMatch(persisted, room.members, "IN_MATCH"),
    ).toThrow("Room status");
    expect(finalState.lastSettledQuarter).toBe(32);
    expect(finalState.counters.settlement).toBe(32);
    expect(finalState.finance.quarterStartBasis).toEqual(
      beforeFinal.finance.quarterStartBasis,
    );
    const acceptedRows = db.prepare(
      "SELECT count(*) AS n FROM match_commands WHERE match_id = ?",
    );
    expect((acceptedRows.get(matchId) as { n: number }).n).toBe(164);
    const finalEvents = db
      .prepare(
        "SELECT event_kind, payload_json FROM match_events WHERE match_id = ? AND command_sequence = 164 ORDER BY event_index",
      )
      .all(matchId) as { event_kind: string; payload_json: string }[];
    expect(
      finalEvents.filter((event) => event.event_kind === "match-result"),
    ).toEqual([
      {
        event_kind: "match-result",
        payload_json: JSON.stringify({
          kind: "safety-draw",
          completedQuarter: 32,
        }),
      },
    ]);
    expect(
      finalEvents.filter((event) => event.event_kind === "settlement-outcome"),
    ).toHaveLength(1);
    const journals = finalEvents
      .filter((event) => event.event_kind === "journal-entry")
      .map((event) => JSON.parse(event.payload_json) as JournalEntry);
    expect(journals.length).toBeGreaterThan(0);
    expect(journals.every((entry) => entry.quarter === 32)).toBe(true);
    for (const id of finalState.playerOrder) {
      const net = journals.reduce(
        (value, entry) =>
          value +
          (entry.destination.kind === "player" &&
          entry.destination.playerId === id
            ? entry.amountCents
            : 0) -
          (entry.source.kind === "player" && entry.source.playerId === id
            ? entry.amountCents
            : 0),
        0,
      );
      expect(finalState.finance.cashByPlayer[id]).toBe(
        beforeFinal.finance.cashByPlayer[id]! + net,
      );
      expect(
        finalState.progress.byPlayer[id]!.quarters.map(
          (quarter) => quarter.quarter,
        ),
      ).toEqual([29, 30, 31, 32]);
    }
    playerViews = await Promise.all(cookies.map((_, index) => view(index)));
    expect(
      playerViews.every(
        (player) =>
          JSON.stringify(player.result) === JSON.stringify(current.result),
      ),
    ).toBe(true);
    for (const player of playerViews)
      expect(
        player.players.every(
          (summary) =>
            !("selectedObjectiveId" in summary) && !("cashCents" in summary),
        ),
      ).toBe(true);
    const immutableSnapshot = persisted.match.snapshotJson;
    const retry = await send(clients[finalActorIndex]!.socket, finalEnvelope);
    expect(retry).toMatchObject({ ok: true, revision: 164 });
    expect(
      await send(clients[0]!.socket, {
        commandId: randomUUID(),
        expectedRevision: 164,
        command: { type: "BEGIN_ROUND" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "MATCH_FINISHED" },
      revision: 164,
    });
    expect(matches.findMatchByRoomCode(roomCode)!.match.snapshotJson).toBe(
      immutableSnapshot,
    );
    expect((acceptedRows.get(matchId) as { n: number }).n).toBe(164);
    const replacement = await connect(cookies[1]!, roomCode);
    expect(replacement.bootstrap.match!.result).toEqual(current.result);
    expect(server.coordinator!.isRoomArmed(roomCode)).toBe(false);
    for (const client of clients) client.socket.disconnect();
    replacement.socket.disconnect();
    await expect.poll(() => lobby.getPauseReasons(roomCode)).toEqual([]);
    await server.close();
    db.close();
    db = openDatabase({ dbPath });
    lobby = new SqliteLobbyRepository(db);
    matches = new SqliteMatchRepository(db);
    recoverActiveMatchesOnStartup(matches, lobby);
    expect(lobby.getPauseReasons(roomCode)).toEqual([]);
    server = createServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        dbPath,
        cookieSecure: false,
        rateLimitDisabled: true,
      },
      repository: lobby,
      matchRepository: matches,
    });
    await server.fastify.listen({ host: "127.0.0.1", port: 0 });
    port = (server.fastify.server.address() as { port: number }).port;
    clients = [];
    for (const cookie of cookies) {
      const client = await connect(cookie, roomCode);
      clients.push(client);
      expect(client.bootstrap.match!.result).toEqual(current.result);
      expect(client.bootstrap.pause.reasons).toEqual([]);
    }
    expect(matches.findMatchByRoomCode(roomCode)!.match.snapshotJson).toBe(
      immutableSnapshot,
    );
    expect(
      await send(clients[finalActorIndex]!.socket, finalEnvelope),
    ).toMatchObject({ ok: true, revision: 164 });
    const resume = await new Promise<{ ok: boolean; error?: { code: string } }>(
      (resolve) =>
        clients[0]!.socket.emit(SOCKET_CLIENT_EVENTS.RESUME, resolve),
    );
    expect(resume).toMatchObject({
      ok: false,
      error: { code: "MATCH_FINISHED" },
    });
    const recovered = await server.fastify.inject({
      method: "POST",
      url: `/api/rooms/${roomCode}/recover`,
      payload: { recoveryCode: recoveryCodes[1]! },
    });
    expect(recovered.statusCode).toBe(200);
    cookies[1] = recovered.cookies.find(
      (cookie) => cookie.name === "interests_session",
    )!.value;
    const restored = await connect(cookies[1]!, roomCode);
    expect(restored.bootstrap.match!.result).toEqual(current.result);
    expect(lobby.getPauseReasons(roomCode)).toEqual([]);
    expect((await view(1)).result).toEqual(current.result);
    expect(matches.findMatchByRoomCode(roomCode)!.match.snapshotJson).toBe(
      immutableSnapshot,
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}, 30_000);
