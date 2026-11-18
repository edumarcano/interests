import {
  assertGameState,
  cents,
  type GameState,
  recurringInvestigationFeeCents,
} from "@interests/engine";
import { RECURRING_CONTENT_TEMPLATES } from "@interests/rules";
import { asPlayerId } from "@interests/shared";
import Database from "better-sqlite3";

// Offline synthetic discovery boundary only. Cash, wealth and owned assets stay unchanged.
const [dbPath, matchId, rawPlayerId] = process.argv.slice(2);
if (!dbPath || !matchId || !rawPlayerId)
  throw new Error("Expected database, match and recipient");
const player = asPlayerId(rawPlayerId);
const db = new Database(dbPath, { fileMustExist: true });
try {
  const row = db
    .prepare("SELECT snapshot_json FROM matches WHERE id = ?")
    .get(matchId) as { snapshot_json: string } | undefined;
  if (!row) throw new Error("Missing match");
  const state = JSON.parse(row.snapshot_json) as GameState;
  if (
    state.currentQuarter !== 1 ||
    state.round?.stage !== "round-start" ||
    state.content.scenario !== "standard-v1"
  )
    throw new Error("Expected ordinary Q1 round start");
  const current = state.content.cardsByPlayer[player];
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (candidate) => candidate.id === "local-service-company",
  );
  if (!current || !template?.facts)
    throw new Error("Missing discovery fixture");
  const fixture: GameState = {
    ...state,
    content: {
      ...state.content,
      cardsByPlayer: {
        ...state.content.cardsByPlayer,
        [player]: {
          ...current,
          templateId: template.id,
          category: template.category,
          askingPriceCents: cents(template.askingPriceCents),
          investigationFeeCents: recurringInvestigationFeeCents(
            template.askingPriceCents,
          ),
          investigated: false,
          facts: { ...template.facts },
        },
      },
      recentCategoriesByPlayer: {
        ...state.content.recentCategoriesByPlayer,
        [player]: [template.category],
      },
    },
  };
  assertGameState(fixture);
  db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
    JSON.stringify(fixture),
    matchId,
  );
} finally {
  db.close();
}
