import {
  assertGameState,
  basisPoints,
  capturePropertyBasis,
  cents,
  createProgress,
  type GameState,
  ownershipPpm,
} from "@interests/engine";
import { asAssetId } from "@interests/shared";
import Database from "better-sqlite3";

// Explicit offline browser fixture. No production endpoint can edit a snapshot.
const [dbPath, matchId] = process.argv.slice(2);
if (!dbPath || !matchId)
  throw new Error("Expected isolated test database and match ID");
const db = new Database(dbPath, { fileMustExist: true });
try {
  const row = db
    .prepare("SELECT snapshot_json FROM matches WHERE id = ?")
    .get(matchId) as { snapshot_json: string } | undefined;
  if (!row) throw new Error("Missing test match");
  const state = JSON.parse(row.snapshot_json) as GameState;
  if (
    state.currentQuarter !== 1 ||
    state.round?.stage !== "round-start" ||
    state.lastSettledQuarter !== 0
  )
    throw new Error("Expected untouched Q1 round start");
  const [a, b] = state.playerOrder;
  if (!a || !b) throw new Error("Missing owners");
  const id = asAssetId("browser-shared-property");
  const property = {
    id,
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
  const assetsById = { ...state.finance.assetsById, [id]: property };
  const finance = {
    ...state.finance,
    assetsById,
    quarterStartBasis: {
      ...state.finance.quarterStartBasis,
      propertiesById: capturePropertyBasis(assetsById),
    },
  };
  const staged = {
    ...state,
    finance,
    progress: createProgress(finance, state.playerOrder),
  };
  assertGameState(staged);
  db.prepare("UPDATE matches SET snapshot_json = ? WHERE id = ?").run(
    JSON.stringify(staged),
    matchId,
  );
} finally {
  db.close();
}
