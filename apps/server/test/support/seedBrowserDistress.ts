import { assertGameState, cents, type GameState } from "@interests/engine";
import Database from "better-sqlite3";

// Offline synthetic E2E setup only. No production endpoint permits this edit.
const [dbPath, matchId] = process.argv.slice(2);
if (!dbPath || !matchId)
  throw new Error("Expected test database path and match ID");
const db = new Database(dbPath, { fileMustExist: true });
try {
  const row = db
    .prepare("SELECT snapshot_json FROM matches WHERE id = ?")
    .get(matchId) as { snapshot_json: string } | undefined;
  if (!row) throw new Error("Missing test match");
  const state = JSON.parse(row.snapshot_json) as GameState;
  if (state.currentQuarter !== 2 || state.round?.stage !== "round-start")
    throw new Error("Expected Q2 round start");
  const loan = Object.values(state.finance.loansById).find(
    (l) => l.kind === "player-loan",
  );
  if (loan?.kind !== "player-loan")
    throw new Error("Missing financed purchase");
  const old = state.finance.recurringByPlayer[loan.borrowerPlayerId]!;
  const recurringByPlayer = {
    ...state.finance.recurringByPlayer,
    [loan.borrowerPlayerId]: {
      ...old,
      quarterlyLivingExpenseCents: cents(9_382_715),
    },
  };
  const diagnostic: GameState = {
    ...state,
    finance: {
      ...state.finance,
      recurringByPlayer,
      quarterStartBasis: {
        ...state.finance.quarterStartBasis,
        recurringByPlayer,
      },
    },
  };
  assertGameState(diagnostic);
  db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
    JSON.stringify(diagnostic),
    matchId,
  );
} finally {
  db.close();
}
