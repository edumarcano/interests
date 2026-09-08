import {
  applyPlayerCommand,
  createGame,
  projectPlayerGameState,
} from "@finance-game/engine";
import { asPlayerId } from "@finance-game/shared";
import { describe, expect, it } from "vitest";

describe("Match Domain - Engine Command Adapter and Privacy Projection", () => {
  const playerIds = [
    asPlayerId("player-1"),
    asPlayerId("player-2"),
    asPlayerId("player-3"),
    asPlayerId("player-4"),
  ];

  function createInitialGame() {
    return createGame({
      gameId: "test-match-1",
      seed: "deterministic-test-seed-12345",
      playerIds,
    });
  }

  it("applies valid CHOOSE_OBJECTIVE and discards any wire-supplied actor", () => {
    const state = createInitialGame();
    const p1 = playerIds[0]!;
    const offeredObjective = state.players[p1]!.offeredObjectiveIds[0]!;

    const result = applyPlayerCommand(state, p1, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: offeredObjective,
      // Wire payload attempting to spoof actor should be ignored
      ...({ playerId: "spoofed-player" } as any),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.state.revision).toBe(1);
    expect(result.state.players[p1]!.selectedObjectiveId).toBe(
      offeredObjective,
    );
  });

  it("rejects objective not offered to the player", () => {
    const state = createInitialGame();
    const p1 = playerIds[0]!;
    const p2 = playerIds[1]!;
    const p2Objective = state.players[p2]!.offeredObjectiveIds[0]!;

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
    const p1 = playerIds[0]!;
    const firstOffer = state.players[p1]!.offeredObjectiveIds[0]!;

    const firstResult = applyPlayerCommand(state, p1, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: firstOffer,
    });
    expect(firstResult.ok).toBe(true);

    const secondOffer = state.players[p1]!.offeredObjectiveIds[1]!;
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
    const p1 = playerIds[0]!;

    const result = applyPlayerCommand(state, p1, {
      type: "UNKNOWN_ACTION" as any,
      objectiveId: "obj-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.code).toBe("INVALID_ACTION");
  });

  it("projects player view with strict objective and financial privacy", () => {
    const state = createInitialGame();
    const p1 = playerIds[0]!;
    const p2 = playerIds[1]!;

    const projectionP1 = projectPlayerGameState(state, p1);
    const projectionP2 = projectPlayerGameState(state, p2);

    // P1 sees own offered objectives
    expect(projectionP1.self.playerId).toBe(p1);
    expect(projectionP1.self.offeredObjectiveIds).toEqual(
      state.players[p1]!.offeredObjectiveIds,
    );

    // P1 projection serialized to JSON does NOT leak P2/P3/P4 offers
    const p1Json = JSON.stringify(projectionP1);
    const p2Offers = state.players[p2]!.offeredObjectiveIds;
    expect(p1Json).not.toContain(p2Offers[0]);
    expect(p1Json).not.toContain(p2Offers[1]);

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
    expect((p2Summary as any).offeredObjectiveIds).toBeUndefined();
    expect((p2Summary as any).selectedObjectiveId).toBeUndefined();

    // P2 selects an objective
    const chosenP2 = applyPlayerCommand(state, p2, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: p2Offers[0]!,
    });
    expect(chosenP2.ok).toBe(true);

    const updatedProjectionP1 = projectPlayerGameState(chosenP2.state, p1);
    const updatedP2Summary = updatedProjectionP1.players.find(
      (p) => p.playerId === p2,
    );
    expect(updatedP2Summary?.hasSelectedObjective).toBe(true);
    // P1 still cannot see which objective P2 chose
    const updatedP1Json = JSON.stringify(updatedProjectionP1);
    expect(updatedP1Json).not.toContain(p2Offers[0]);
  });
});
