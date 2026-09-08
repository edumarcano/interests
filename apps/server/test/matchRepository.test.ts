import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGame } from "@interests/engine";
import { asMatchId, asPlayerId, type PlayerId } from "@interests/shared";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCurrentVersionMetadata } from "../src/match/versions.js";
import { runMigrations } from "../src/persistence/sqlite/migrations.js";
import { openDatabase } from "../src/persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "../src/persistence/sqlite/SqliteLobbyRepository.js";
import { SqliteMatchRepository } from "../src/persistence/sqlite/SqliteMatchRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

describe("SqliteMatchRepository", () => {
  let tempDir: string;
  let db: Database.Database;
  let lobbyRepo: SqliteLobbyRepository;
  let matchRepo: SqliteMatchRepository;

  const p1 = asPlayerId("player-1");
  const p2 = asPlayerId("player-2");
  const p3 = asPlayerId("player-3");
  const p4 = asPlayerId("player-4");
  const playerIds: readonly PlayerId[] = [p1, p2, p3, p4];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "interests-matchrepo-test-"),
    );
    const dbPath = path.join(tempDir, "test.db");
    db = openDatabase({ dbPath });
    runMigrations(db, migrationsDir);
    lobbyRepo = new SqliteLobbyRepository(db);
    matchRepo = new SqliteMatchRepository(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
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
    if (!roomInfo) throw new Error("Room not found");

    const matchId = asMatchId("match-test-1");
    const initialGameState = createGame({
      gameId: matchId,
      seed: "seed-123",
      playerIds,
    });

    const memberMappings = members.map((mId, idx) => {
      const pId = playerIds[idx];
      if (!pId) throw new Error("Missing player id");
      return {
        roomMemberId: mId,
        playerId: pId,
        playerOrder: idx,
      };
    });

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
      const mId = members[i];
      if (!mId) throw new Error("Member missing");
      const resolvedPid = matchRepo.findPlayerForRoomMember(matchId, mId);
      expect(resolvedPid).toBe(playerIds[i]);
    }
  });

  it("rejects creating a second match for the same room", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code);
    if (!roomInfo) throw new Error("Room not found");

    const initialGameState = createGame({
      gameId: "match-1",
      seed: "seed-1",
      playerIds,
    });

    const memberMappings = members.map((mId, idx) => {
      const pId = playerIds[idx];
      if (!pId) throw new Error("Missing player id");
      return {
        roomMemberId: mId,
        playerId: pId,
        playerOrder: idx,
      };
    });

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

    // Second match creation for the same room must throw
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
    }).toThrow();
  });

  it("commits accepted commands atomically with monotonic sequence and receipt", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code);
    if (!roomInfo) throw new Error("Room not found");

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
      memberMappings: members.map((mId, idx) => {
        const pId = playerIds[idx];
        if (!pId) throw new Error("Missing player id");
        return {
          roomMemberId: mId,
          playerId: pId,
          playerOrder: idx,
        };
      }),
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
      actorPlayerId: p1,
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
        nextRevision: 1,
        nextState: { ...nextState, revision: 1 },
        actorPlayerId: p2,
        commandId: "cmd-uuid-stale",
        commandType: "CHOOSE_OBJECTIVE",
        payloadJson: JSON.stringify({ objectiveId: "obj-2" }),
        payloadHash: "hash-stale",
      });
    }).toThrow(/Revision conflict/i);

    // Non-consecutive next revision is rejected
    expect(() => {
      matchRepo.commitAcceptedCommand({
        matchId,
        expectedPreviousRevision: 1,
        nextRevision: 3, // Skipped 2!
        nextState: { ...nextState, revision: 3 },
        actorPlayerId: p2,
        commandId: "cmd-uuid-jump",
        commandType: "CHOOSE_OBJECTIVE",
        payloadJson: JSON.stringify({ objectiveId: "obj-2" }),
        payloadHash: "hash-jump",
      });
    }).toThrow(/increment revision by exactly 1/i);

    // Valid revision commit advances sequence to 2
    const commit2 = matchRepo.commitAcceptedCommand({
      matchId,
      expectedPreviousRevision: 1,
      nextRevision: 2,
      nextState: { ...nextState, revision: 2 },
      actorPlayerId: p2,
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
    const roomInfo = matchRepo.findRoomWithMembers(code);
    if (!roomInfo) throw new Error("Room not found");

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
      memberMappings: members.map((mId, idx) => {
        const pId = playerIds[idx];
        if (!pId) throw new Error("Missing player id");
        return {
          roomMemberId: mId,
          playerId: pId,
          playerOrder: idx,
        };
      }),
      versions: getCurrentVersionMetadata(),
    });

    const receipt = matchRepo.recordRejectedReceipt({
      matchId,
      actorPlayerId: p1,
      commandId: "rejected-cmd-1",
      payloadHash: "rej-hash",
      errorCode: "ROOM_PAUSED",
      errorMessage: "Room is paused",
      resultingRevision: 0,
    });

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.errorCode).toBe("ROOM_PAUSED");
    expect(receipt.errorMessage).toBe("Room is paused");
    expect(receipt.acceptedSequence).toBeNull();

    // Query receipt
    const foundReceipt = matchRepo.findCommandReceipt(
      matchId,
      p1,
      "rejected-cmd-1",
    );
    expect(foundReceipt).toBeDefined();
    expect(foundReceipt?.outcome).toBe("REJECTED");
    expect(foundReceipt?.errorCode).toBe("ROOM_PAUSED");
    expect(foundReceipt?.errorMessage).toBe("Room is paused");

    // Match revision must remain unchanged
    const match = matchRepo.findMatchById(matchId);
    expect(match?.match.revision).toBe(0);

    // match_commands table must remain empty
    const commandsCount = db
      .prepare("SELECT COUNT(*) as cnt FROM match_commands WHERE match_id = ?")
      .get(matchId) as { cnt: number };
    expect(commandsCount.cnt).toBe(0);
  });

  it("rolls back match creation if member mapping fails SQLite constraint", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code);
    if (!roomInfo) throw new Error("Room not found");

    const matchId = asMatchId("match-rollback-create");
    const initialGameState = createGame({
      gameId: matchId,
      seed: "seed-rb-create",
      playerIds,
    });

    // Deliberately provide duplicate playerOrder (0 and 0) to violate UNIQUE(match_id, player_order)
    const [m0, m1, m2, m3] = members;
    if (!m0 || !m1 || !m2 || !m3) throw new Error("Missing members");
    const duplicateOrderMappings = [
      { roomMemberId: m0, playerId: p1, playerOrder: 0 },
      { roomMemberId: m1, playerId: p2, playerOrder: 0 },
      { roomMemberId: m2, playerId: p3, playerOrder: 2 },
      { roomMemberId: m3, playerId: p4, playerOrder: 3 },
    ];

    expect(() => {
      matchRepo.createMatch({
        matchId,
        roomId: roomInfo.room.id,
        modeId: "standard-v1",
        initializationManifest: {
          gameId: matchId,
          modeId: "standard-v1",
          seed: "seed-rb-create",
          orderedPlayerIds: playerIds,
        },
        initialSnapshot: initialGameState,
        memberMappings: duplicateOrderMappings,
        versions: getCurrentVersionMetadata(),
      });
    }).toThrow(/UNIQUE constraint failed/i);

    // Match was rolled back: no row in matches
    const matchAfter = matchRepo.findMatchById(matchId);
    expect(matchAfter).toBeNull();

    // No rows in match_members
    const membersCount = db
      .prepare("SELECT COUNT(*) as cnt FROM match_members WHERE match_id = ?")
      .get(matchId) as { cnt: number };
    expect(membersCount.cnt).toBe(0);

    // Room remains OPEN (not transitioned to IN_MATCH)
    const roomAfter = matchRepo.findRoomWithMembers(code);
    expect(roomAfter?.room.status).toBe("OPEN");
  });

  it("rolls back atomic command commit if SQLite constraint is violated mid-transaction", () => {
    const { code, members } = setupFourSeatRoom();
    const roomInfo = matchRepo.findRoomWithMembers(code);
    if (!roomInfo) throw new Error("Room not found");

    const matchId = asMatchId("match-rollback-cmd");
    const initialGameState = createGame({
      gameId: matchId,
      seed: "seed-rb-cmd",
      playerIds,
    });

    matchRepo.createMatch({
      matchId,
      roomId: roomInfo.room.id,
      modeId: "standard-v1",
      initializationManifest: {
        gameId: matchId,
        modeId: "standard-v1",
        seed: "seed-rb-cmd",
        orderedPlayerIds: playerIds,
      },
      initialSnapshot: initialGameState,
      memberMappings: members.map((mId, idx) => {
        const pId = playerIds[idx];
        if (!pId) throw new Error("Missing player id");
        return {
          roomMemberId: mId,
          playerId: pId,
          playerOrder: idx,
        };
      }),
      versions: getCurrentVersionMetadata(),
    });

    // First commit succeeds
    const nextState1 = { ...initialGameState, revision: 1 };
    matchRepo.commitAcceptedCommand({
      matchId,
      expectedPreviousRevision: 0,
      nextRevision: 1,
      nextState: nextState1,
      actorPlayerId: p1,
      commandId: "cmd-first",
      commandType: "CHOOSE_OBJECTIVE",
      payloadJson: JSON.stringify({ objectiveId: "obj-1" }),
      payloadHash: "hash-first",
    });

    // Attempt second commit with a reused command_id for the same actor that violates UNIQUE(match_id, actor_player_id, command_id) in match_commands
    const nextState2 = { ...initialGameState, revision: 2 };
    expect(() => {
      matchRepo.commitAcceptedCommand({
        matchId,
        expectedPreviousRevision: 1,
        nextRevision: 2,
        nextState: nextState2,
        actorPlayerId: p1,
        commandId: "cmd-first", // Duplicate commandId!
        commandType: "CHOOSE_OBJECTIVE",
        payloadJson: JSON.stringify({ objectiveId: "obj-2" }),
        payloadHash: "hash-second",
      });
    }).toThrow(/UNIQUE constraint failed/i);

    // Revision remains 1
    const matchAfterFail = matchRepo.findMatchById(matchId);
    expect(matchAfterFail?.match.revision).toBe(1);

    // Exactly one command sequence exists (sequence 1), no sequence 2
    const commands = db
      .prepare(
        "SELECT sequence FROM match_commands WHERE match_id = ? ORDER BY sequence ASC",
      )
      .all(matchId) as Array<{ sequence: number }>;
    expect(commands).toHaveLength(1);
    expect(commands[0]?.sequence).toBe(1);

    // Exactly one receipt exists
    const receipts = db
      .prepare("SELECT command_id FROM command_receipts WHERE match_id = ?")
      .all(matchId) as Array<{ command_id: string }>;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.command_id).toBe("cmd-first");
  });
});
