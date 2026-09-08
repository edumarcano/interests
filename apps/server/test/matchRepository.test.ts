import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGame } from "@finance-game/engine";
import { asMatchId, asPlayerId } from "@finance-game/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCurrentVersionMetadata } from "../src/match/versions.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import { openDatabase } from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";
import { SqliteMatchRepository } from "../src/persistence/sqlite/SqliteMatchRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

describe("SqliteMatchRepository", () => {
  let tempDbPath: string;
  let db: ReturnType<typeof openDatabase>;
  let lobbyRepo: SqliteLobbyRepository;
  let matchRepo: SqliteMatchRepository;

  beforeEach(() => {
    tempDbPath = path.join(
      os.tmpdir(),
      `finance-game-matchrepo-test-${Date.now()}-${Math.random().toString(36).substring(2)}.sqlite`,
    );
    db = openDatabase({ dbPath: tempDbPath });
    runMigrations(db, migrationsDir);
    lobbyRepo = new SqliteLobbyRepository(db);
    matchRepo = new SqliteMatchRepository(db);
  });

  afterEach(() => {
    try {
      db.close();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      const wal = `${tempDbPath}-wal`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = `${tempDbPath}-shm`;
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {
      // ignore cleanup errors
    }
  });

  function setupFourSeatRoom() {
    const r1 = lobbyRepo.createRoomWithHost({ nickname: "Host" });
    const code = r1.room.code;
    const r2 = lobbyRepo.joinRoom({ roomCode: code, nickname: "Player2" });
    const r3 = lobbyRepo.joinRoom({ roomCode: code, nickname: "Player3" });
    const r4 = lobbyRepo.joinRoom({ roomCode: code, nickname: "Player4" });

    return {
      code,
      members: [
        r1.self.memberId,
        r2.self.memberId,
        r3.self.memberId,
        r4.self.memberId,
      ],
    };
  }

  it("atomically creates match, member mappings, and marks room IN_MATCH", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code);
    expect(roomInfo).toBeDefined();
    if (!roomInfo) throw new Error("Room info not found");

    const playerIds = [
      asPlayerId("player-1"),
      asPlayerId("player-2"),
      asPlayerId("player-3"),
      asPlayerId("player-4"),
    ];
    const matchId = asMatchId("match-12345");
    const initialGameState = createGame({
      gameId: matchId,
      seed: "seed-123",
      playerIds,
    });

    const memberMappings = members.map((mId, idx) => ({
      roomMemberId: mId,
      playerId: playerIds[idx]!,
      playerOrder: idx,
    }));

    const result = matchRepo.createMatch({
      matchId,
      roomId: roomInfo.room.id,
      modeId: "standard-v1",
      initializationManifest: {
        gameId: matchId,
        modeId: "standard-v1",
        seed: "seed-123",
        orderedPlayerIds: playerIds,
      },
      initialSnapshot: initialGameState,
      memberMappings,
      versions: getCurrentVersionMetadata(),
    });

    expect(result.match.id).toBe(matchId);
    expect(result.match.status).toBe("ACTIVE");
    expect(result.match.revision).toBe(0);
    expect(result.members).toHaveLength(4);

    // Verify room is now IN_MATCH
    const updatedRoom = matchRepo.findRoomWithMembers(code);
    expect(updatedRoom?.room.status).toBe("IN_MATCH");

    // Joining an IN_MATCH room is rejected
    expect(() => {
      lobbyRepo.joinRoom({ roomCode: code, nickname: "LateJoiner" });
    }).toThrow(/Room is not open for joining/i);

    // Mapping is stable and resolvable
    for (let i = 0; i < 4; i++) {
      const pId = matchRepo.findPlayerForRoomMember(matchId, members[i]!);
      expect(pId).toBe(playerIds[i]);
    }
  });

  it("rejects creating a second match for the same room", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code)!;
    const playerIds = [
      asPlayerId("player-1"),
      asPlayerId("player-2"),
      asPlayerId("player-3"),
      asPlayerId("player-4"),
    ];

    const initialGameState = createGame({
      gameId: "match-1",
      seed: "seed-1",
      playerIds,
    });

    const memberMappings = members.map((mId, idx) => ({
      roomMemberId: mId,
      playerId: playerIds[idx]!,
      playerOrder: idx,
    }));

    matchRepo.createMatch({
      matchId: asMatchId("match-1"),
      roomId: roomInfo.room.id,
      modeId: "standard-v1",
      initializationManifest: {
        gameId: "match-1",
        modeId: "standard-v1",
        seed: "seed-1",
        orderedPlayerIds: playerIds,
      },
      initialSnapshot: initialGameState,
      memberMappings,
      versions: getCurrentVersionMetadata(),
    });

    // Second match creation fails
    expect(() => {
      matchRepo.createMatch({
        matchId: asMatchId("match-2"),
        roomId: roomInfo.room.id,
        modeId: "standard-v1",
        initializationManifest: {
          gameId: "match-2",
          modeId: "standard-v1",
          seed: "seed-2",
          orderedPlayerIds: playerIds,
        },
        initialSnapshot: initialGameState,
        memberMappings,
        versions: getCurrentVersionMetadata(),
      });
    }).toThrow(/Room is not in OPEN status for match start/i);
  });

  it("commits accepted commands atomically with monotonic sequence and receipt", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code)!;
    const playerIds = [
      asPlayerId("player-1"),
      asPlayerId("player-2"),
      asPlayerId("player-3"),
      asPlayerId("player-4"),
    ];
    const matchId = asMatchId("match-seq-test");
    const initialGameState = createGame({
      gameId: matchId,
      seed: "seed-seq",
      playerIds,
    });

    matchRepo.createMatch({
      matchId,
      roomId: roomInfo.room.id,
      modeId: "standard-v1",
      initializationManifest: {
        gameId: matchId,
        modeId: "standard-v1",
        seed: "seed-seq",
        orderedPlayerIds: playerIds,
      },
      initialSnapshot: initialGameState,
      memberMappings: members.map((mId, idx) => ({
        roomMemberId: mId,
        playerId: playerIds[idx]!,
        playerOrder: idx,
      })),
      versions: getCurrentVersionMetadata(),
    });

    const nextState = {
      ...initialGameState,
      revision: 1,
    };

    const commit1 = matchRepo.commitAcceptedCommand({
      matchId,
      expectedPreviousRevision: 0,
      nextRevision: 1,
      nextState,
      actorPlayerId: playerIds[0]!,
      commandId: "cmd-uuid-1",
      commandType: "CHOOSE_OBJECTIVE",
      payloadJson: JSON.stringify({ objectiveId: "obj-1" }),
      payloadHash: "hash-1",
    });

    expect(commit1.sequence).toBe(1);
    expect(commit1.receipt.outcome).toBe("ACCEPTED");
    expect(commit1.receipt.resultingRevision).toBe(1);

    const matchAfter1 = matchRepo.findMatchById(matchId);
    expect(matchAfter1?.match.revision).toBe(1);

    // Stale expected revision is rejected
    expect(() => {
      matchRepo.commitAcceptedCommand({
        matchId,
        expectedPreviousRevision: 0, // Stale! Current is 1
        nextRevision: 2,
        nextState: { ...nextState, revision: 2 },
        actorPlayerId: playerIds[1]!,
        commandId: "cmd-uuid-2",
        commandType: "CHOOSE_OBJECTIVE",
        payloadJson: JSON.stringify({ objectiveId: "obj-2" }),
        payloadHash: "hash-2",
      });
    }).toThrow(/Revision conflict/i);

    // Valid revision commit advances sequence to 2
    const commit2 = matchRepo.commitAcceptedCommand({
      matchId,
      expectedPreviousRevision: 1,
      nextRevision: 2,
      nextState: { ...nextState, revision: 2 },
      actorPlayerId: playerIds[1]!,
      commandId: "cmd-uuid-2",
      commandType: "CHOOSE_OBJECTIVE",
      payloadJson: JSON.stringify({ objectiveId: "obj-2" }),
      payloadHash: "hash-2",
    });

    expect(commit2.sequence).toBe(2);
    expect(commit2.receipt.resultingRevision).toBe(2);

    const matchAfter2 = matchRepo.findMatchById(matchId);
    expect(matchAfter2?.match.revision).toBe(2);
  });

  it("records rejected receipt without mutating revision or command sequence", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code)!;
    const playerIds = [
      asPlayerId("player-1"),
      asPlayerId("player-2"),
      asPlayerId("player-3"),
      asPlayerId("player-4"),
    ];
    const matchId = asMatchId("match-reject-test");
    const initialGameState = createGame({
      gameId: matchId,
      seed: "seed-rej",
      playerIds,
    });

    matchRepo.createMatch({
      matchId,
      roomId: roomInfo.room.id,
      modeId: "standard-v1",
      initializationManifest: {
        gameId: matchId,
        modeId: "standard-v1",
        seed: "seed-rej",
        orderedPlayerIds: playerIds,
      },
      initialSnapshot: initialGameState,
      memberMappings: members.map((mId, idx) => ({
        roomMemberId: mId,
        playerId: playerIds[idx]!,
        playerOrder: idx,
      })),
      versions: getCurrentVersionMetadata(),
    });

    const receipt = matchRepo.recordRejectedReceipt({
      matchId,
      actorPlayerId: playerIds[0]!,
      commandId: "rejected-cmd-1",
      payloadHash: "rej-hash",
      errorCode: "ROOM_PAUSED",
      resultingRevision: 0,
    });

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.errorCode).toBe("ROOM_PAUSED");
    expect(receipt.acceptedSequence).toBeNull();

    // Query receipt
    const foundReceipt = matchRepo.findCommandReceipt(
      matchId,
      playerIds[0]!,
      "rejected-cmd-1",
    );
    expect(foundReceipt).toBeDefined();
    expect(foundReceipt?.outcome).toBe("REJECTED");
    expect(foundReceipt?.errorCode).toBe("ROOM_PAUSED");

    // Match revision must remain unchanged
    const match = matchRepo.findMatchById(matchId);
    expect(match?.match.revision).toBe(0);

    // match_commands table must remain empty
    const commandsCount = db
      .prepare("SELECT COUNT(*) as cnt FROM match_commands WHERE match_id = ?")
      .get(matchId) as { cnt: number };
    expect(commandsCount.cnt).toBe(0);
  });
});
