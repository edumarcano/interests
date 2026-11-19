import { OBJECTIVE_PROGRESS_LABELS } from "@interests/rules";
import { asPlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { assertGameState } from "../invariants/assertGameState";
import { evaluateAllObjectives, evaluateObjective } from "./evaluate";
import { measurePlayerObjectives } from "./measurements";

const ids = ["a", "b", "c", "d"].map(asPlayerId);
function ready() {
  let state = createGame({
    gameId: "private-progress",
    seed: "private-progress",
    playerIds: ids,
  });
  for (const id of ids) {
    const result = applyPlayerCommand(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  return state;
}

it("supplies rules-owned readable labels for all eight evaluations and projects only the selected one", () => {
  const state = ready();
  const serialized = JSON.stringify(state);
  const owner = ids[0]!;
  expect(
    Object.values(OBJECTIVE_PROGRESS_LABELS).every(
      (label) => label.trim().length > 0,
    ),
  ).toBe(true);
  const measured = measurePlayerObjectives(state, owner);
  for (const evaluation of evaluateAllObjectives(measured))
    for (const check of evaluation.checks) {
      expect(check.label).toBe(OBJECTIVE_PROGRESS_LABELS[check.id]);
      expect(check.label.length).toBeGreaterThan(0);
    }
  const view = projectPlayerGameState(state, owner);
  expect(view.self.financialDetails.objectiveEvaluation).toEqual(
    evaluateObjective(measured, state.players[owner]!.selectedObjectiveId!),
  );
  expect(JSON.stringify(state)).toBe(serialized);
});

it("keeps changed private selected progress out of other recipients' public views", () => {
  const state = ready();
  const owner = ids[0]!;
  const observer = ids[1]!;
  const alternative = state.players[owner]!.offeredObjectiveIds[1];
  const changed = {
    ...state,
    players: {
      ...state.players,
      [owner]: { ...state.players[owner]!, selectedObjectiveId: alternative },
    },
  };
  assertGameState(changed);
  expect(projectPlayerGameState(changed, observer)).toEqual(
    projectPlayerGameState(state, observer),
  );
  expect(
    projectPlayerGameState(changed, owner).self.financialDetails
      .objectiveEvaluation!.objectiveId,
  ).toBe(alternative);
  expect(
    projectPlayerGameState(state, owner).self.financialDetails
      .objectiveEvaluation!.objectiveId,
  ).not.toBe(alternative);
  expect(
    JSON.stringify(projectPlayerGameState(state, observer).players),
  ).not.toContain("objectiveEvaluation");
  expect(
    JSON.stringify(projectPlayerGameState(state, observer).players),
  ).not.toContain("checks");
});
