import type { GameState } from "@interests/engine";
import Database from "better-sqlite3";

const [dbPath, matchId] = process.argv.slice(2);
if (!dbPath || !matchId) throw new Error("Expected database and match IDs");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const match = db
    .prepare(`
    SELECT matches.status AS matchStatus, rooms.status AS roomStatus, matches.revision,
      matches.initialization_json AS initialization, matches.snapshot_json AS snapshot
    FROM matches JOIN rooms ON rooms.id = matches.room_id WHERE matches.id = ?
  `)
    .get(matchId) as
    | {
        matchStatus: string;
        roomStatus: string;
        revision: number;
        initialization: string;
        snapshot: string;
      }
    | undefined;
  if (!match) throw new Error("Expected a persisted match");
  const finale = db
    .prepare(`
    SELECT sequence, actor_player_id AS actorPlayerId, resulting_revision AS revision
    FROM match_commands WHERE match_id = ? AND command_type = 'PURSUE_FINALE'
  `)
    .all(matchId) as {
    sequence: number;
    actorPlayerId: string;
    revision: number;
  }[];
  if (finale.length !== 1) throw new Error("Expected one accepted finale");
  const sequence = finale[0]!.sequence;
  const receipts = db
    .prepare(`
    SELECT outcome, resulting_revision AS revision
    FROM command_receipts WHERE match_id = ? AND accepted_sequence = ?
  `)
    .all(matchId, sequence);
  const events = db
    .prepare(`
    SELECT event_kind AS kind, payload_json AS payload
    FROM match_events WHERE match_id = ? AND command_sequence = ? ORDER BY event_index
  `)
    .all(matchId, sequence) as { kind: string; payload: string }[];
  const state = JSON.parse(match.snapshot) as GameState;
  process.stdout.write(
    JSON.stringify({
      matchStatus: match.matchStatus,
      roomStatus: match.roomStatus,
      revision: match.revision,
      initialization: JSON.parse(match.initialization),
      lastSettledQuarter: state.lastSettledQuarter,
      result: state.result,
      finale,
      receipts,
      events: events.map((event) => ({
        kind: event.kind,
        payload: JSON.parse(event.payload),
      })),
    }),
  );
} finally {
  db.close();
}
