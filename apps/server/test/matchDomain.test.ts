import {
  applyPlayerCommand,
  createGame,
  projectPlayerGameState,
} from "@interests/engine";
import { asPlayerId, type RoomMemberId } from "@interests/shared";
import { describe, expect, it } from "vitest";

describe("Match Domain - Engine Command Adapter and Privacy Projection", () => {
  const p1 = asPlayerId("player-1");
  const p2 = asPlayerId("player-2");
  const p3 = asPlayerId("player-3");
  const p4 = asPlayerId("player-4");
  const playerIds = [p1, p2, p3, p4];

  function createInitialGame() {
    return createGame({
      gameId: "test-match-1",
      seed: "deterministic-test-seed-12345",
      playerIds,
    });
  }

  it("applies valid CHOOSE_OBJECTIVE and discards any wire-supplied actor", () => {
    const state = createInitialGame();
    const p1State = state.players[p1];
    if (!p1State) throw new Error("Missing player 1 state");
    const offeredObjective = p1State.offeredObjectiveIds[0];
    if (!offeredObjective) throw new Error("Missing offered objective");

    const wirePayload = {
      type: "CHOOSE_OBJECTIVE" as const,
      objectiveId: offeredObjective,
      playerId: "spoofed-player",
    };

    const result = applyPlayerCommand(
      state,
      p1,
      wirePayload as unknown as {
        type: "CHOOSE_OBJECTIVE";
        objectiveId: string;
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.state.revision).toBe(1);
    expect(result.state.players[p1]?.selectedObjectiveId).toBe(
      offeredObjective,
    );
  });

  it("rejects objective not offered to the player", () => {
    const state = createInitialGame();
    const p2State = state.players[p2];
    if (!p2State) throw new Error("Missing player 2 state");
    const p2Objective = p2State.offeredObjectiveIds[0];
    if (!p2Objective) throw new Error("Missing player 2 objective");

    const result = applyPlayerCommand(state, p1, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: p2Objective,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.code).toBe("OBJECTIVE_NOT_OFFERED");
    expect(result.state.revision).toBe(0);
  });

  it("rejects selecting an objective a second time", () => {
    const state = createInitialGame();
    const p1State = state.players[p1];
    if (!p1State) throw new Error("Missing player 1 state");
    const firstOffer = p1State.offeredObjectiveIds[0];
    const secondOffer = p1State.offeredObjectiveIds[1];
    if (!firstOffer || !secondOffer)
      throw new Error("Missing objective offers");

    const firstResult = applyPlayerCommand(state, p1, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: firstOffer,
    });
    expect(firstResult.ok).toBe(true);

    const secondResult = applyPlayerCommand(firstResult.state, p1, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: secondOffer,
    });

    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) throw new Error("Expected rejection");
    expect(secondResult.code).toBe("ALREADY_CHOSEN");
    expect(secondResult.state.revision).toBe(1);
  });

  it("rejects malformed wire command", () => {
    const state = createInitialGame();

    const result = applyPlayerCommand(state, p1, {
      type: "UNKNOWN_ACTION",
      objectiveId: "obj-1",
    } as unknown as { type: "CHOOSE_OBJECTIVE"; objectiveId: string });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.code).toBe("INVALID_ACTION");
  });

  it("projects player view with strict objective and financial privacy", () => {
    const state = createInitialGame();

    const projectionP1 = projectPlayerGameState(state, p1);
    const projectionP2 = projectPlayerGameState(state, p2);

    expect(projectionP2.self.playerId).toBe(p2);
    // P1 sees own offered objectives
    expect(projectionP1.self.playerId).toBe(p1);
    expect(projectionP1.self.offeredObjectiveIds).toEqual(
      state.players[p1]?.offeredObjectiveIds,
    );

    // P1 projection serialized to JSON does NOT leak P2/P3/P4 offers
    const p1Json = JSON.stringify(projectionP1);
    const p2Offers = state.players[p2]?.offeredObjectiveIds ?? [];
    expect(p2Offers.length).toBeGreaterThanOrEqual(2);
    const p2Offer0 = p2Offers[0];
    const p2Offer1 = p2Offers[1];
    if (!p2Offer0 || !p2Offer1) throw new Error("Missing p2 offers");
    expect(p1Json).not.toContain(p2Offer0);
    expect(p1Json).not.toContain(p2Offer1);

    // Financial secrets are excluded from pure player projection
    expect(p1Json).not.toContain("startingCashCents");
    expect(p1Json).not.toContain("cashByPlayer");
    expect(p1Json).not.toContain("counters");
    expect(p1Json).not.toContain("deterministic-test-seed-12345");

    // Other players appear only as public summary
    expect(projectionP1.players).toHaveLength(4);
    const p2Summary = projectionP1.players.find((p) => p.playerId === p2);
    expect(p2Summary).toBeDefined();
    expect(p2Summary?.hasSelectedObjective).toBe(false);
    expect("offeredObjectiveIds" in (p2Summary ?? {})).toBe(false);
    expect("selectedObjectiveId" in (p2Summary ?? {})).toBe(false);

    // P2 selects an objective
    const chosenP2 = applyPlayerCommand(state, p2, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: p2Offer0,
    });
    expect(chosenP2.ok).toBe(true);

    const updatedProjectionP1 = projectPlayerGameState(chosenP2.state, p1);
    const updatedP2Summary = updatedProjectionP1.players.find(
      (p) => p.playerId === p2,
    );
    expect(updatedP2Summary?.hasSelectedObjective).toBe(true);
    // P1 still cannot see which objective P2 chose
    const updatedP1Json = JSON.stringify(updatedProjectionP1);
    expect(updatedP1Json).not.toContain(p2Offer0);
  });

  it("projects public round information correctly through setup, spotlight, and settlement", () => {
    let state = createInitialGame();
    // 1. During objective selection: round is null
    const projBefore = projectPlayerGameState(state, p1);
    expect(projBefore.round).toBeNull();

    // 2. Select all 4 objectives
    for (const pId of state.playerOrder) {
      const offer = state.players[pId]!.offeredObjectiveIds[0]!;
      const res = applyPlayerCommand(state, pId, {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: offer,
      });
      if (!res.ok) throw new Error();
      state = res.state;
    }

    const projRoundStart = projectPlayerGameState(state, p1);
    expect(projRoundStart.round).toEqual({
      stage: "round-start",
      spotlightOrder: [p1, p2, p3, p4],
      activeSpotlightPlayerId: null,
      spotlightsCompleted: 0,
    });

    // 3. Begin round: stage becomes spotlight, active player is p1
    const beginRes = applyPlayerCommand(state, p1, { type: "BEGIN_ROUND" });
    if (!beginRes.ok) throw new Error();
    state = beginRes.state;

    const projSpotlight1 = projectPlayerGameState(state, p1);
    expect(projSpotlight1.round).toEqual({
      stage: "spotlight",
      spotlightOrder: [p1, p2, p3, p4],
      activeSpotlightPlayerId: p1,
      spotlightsCompleted: 0,
    });

    // 4. Pass spotlights 1 to 3
    for (const actor of [p1, p2, p3]) {
      const pass = applyPlayerCommand(state, actor, { type: "PASS_SPOTLIGHT" });
      if (!pass.ok) throw new Error();
      state = pass.state;
    }

    const projSpotlight4 = projectPlayerGameState(state, p1);
    expect(projSpotlight4.round).toEqual({
      stage: "spotlight",
      spotlightOrder: [p1, p2, p3, p4],
      activeSpotlightPlayerId: p4,
      spotlightsCompleted: 3,
    });

    // 5. Pass final spotlight (p4) -> Quarter 1 settles atomically -> enters Q2 round-start
    const finalPass = applyPlayerCommand(state, p4, {
      type: "PASS_SPOTLIGHT",
    });
    if (!finalPass.ok) throw new Error();
    state = finalPass.state;

    const projQ2 = projectPlayerGameState(state, p1);
    expect(projQ2.currentQuarter).toBe(2);
    expect(projQ2.round).toEqual({
      stage: "round-start",
      spotlightOrder: [p2, p3, p4, p1],
      activeSpotlightPlayerId: null,
      spotlightsCompleted: 0,
    });
  });

  it("enriches self with presentation metadata without leaking other players' secrets in buildMatchPlayerView", async () => {
    const { buildMatchPlayerView } = await import("../src/match/projection.js");
    type MatchMemberRecord = import("../src/match/types.js").MatchMemberRecord;
    type MatchRoomMember = import("../src/match/types.js").MatchRoomMember;
    const state = createInitialGame();
    const hostMemberId = "member-host" as RoomMemberId;
    const roomMembers: MatchRoomMember[] = [
      {
        id: "member-host" as RoomMemberId,
        roomId: "r1" as any,
        nickname: "HostNick",
        nicknameKey: "hostnick",
        joinOrder: 1,
        createdAt: "",
      },
      {
        id: "member-2" as RoomMemberId,
        roomId: "r1" as any,
        nickname: "P2Nick",
        nicknameKey: "p2nick",
        joinOrder: 2,
        createdAt: "",
      },
      {
        id: "member-3" as RoomMemberId,
        roomId: "r1" as any,
        nickname: "P3Nick",
        nicknameKey: "p3nick",
        joinOrder: 3,
        createdAt: "",
      },
      {
        id: "member-4" as RoomMemberId,
        roomId: "r1" as any,
        nickname: "P4Nick",
        nicknameKey: "p4nick",
        joinOrder: 4,
        createdAt: "",
      },
    ];
    const matchMembers: MatchMemberRecord[] = [
      {
        matchId: "m1" as any,
        playerId: p1,
        roomMemberId: "member-host" as RoomMemberId,
        playerOrder: 1,
      },
      {
        matchId: "m1" as any,
        playerId: p2,
        roomMemberId: "member-2" as RoomMemberId,
        playerOrder: 2,
      },
      {
        matchId: "m1" as any,
        playerId: p3,
        roomMemberId: "member-3" as RoomMemberId,
        playerOrder: 3,
      },
      {
        matchId: "m1" as any,
        playerId: p4,
        roomMemberId: "member-4" as RoomMemberId,
        playerOrder: 4,
      },
    ];

    const view = buildMatchPlayerView({
      gameState: state,
      targetPlayerId: p1,
      roomMembers,
      matchMembers,
      hostMemberId,
    });

    // Enriched self view
    expect(view.self.playerId).toBe(p1);
    expect(view.self.profile).toBeDefined();
    expect(view.self.profile?.name).toBeTruthy();
    expect(view.self.offeredObjectives).toBeDefined();
    expect(view.self.offeredObjectives).toHaveLength(2);
    expect(view.self.offeredObjectives?.[0]?.name).toBeTruthy();
    expect(view.self.offeredObjectives?.[0]?.family).toBeTruthy();

    // Other players have only public summary and no profile/objective leaks
    for (const player of view.players) {
      if (player.playerId !== p1) {
        expect("profile" in player).toBe(false);
        expect("offeredObjectives" in player).toBe(false);
      }
    }
  });
});
