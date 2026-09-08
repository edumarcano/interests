-- Migration 003: Matches and Commands
-- Persists authoritative GameState snapshots, RoomMember->PlayerId mappings,
-- ordered accepted commands, command idempotency receipts, and journal events.

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'FINISHED', 'ABANDONED')),
  mode_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  initialization_json TEXT NOT NULL,
  initial_snapshot_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  shared_version TEXT NOT NULL,
  persistence_format_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE match_members (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  room_member_id TEXT NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  player_order INTEGER NOT NULL,
  PRIMARY KEY (match_id, room_member_id),
  UNIQUE (match_id, player_id),
  UNIQUE (match_id, player_order)
);

CREATE TABLE match_commands (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  actor_player_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_revision INTEGER NOT NULL,
  resulting_revision INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (match_id, sequence),
  UNIQUE (match_id, actor_player_id, command_id)
);

CREATE TABLE command_receipts (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  actor_player_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ACCEPTED', 'REJECTED')),
  error_code TEXT,
  resulting_revision INTEGER NOT NULL,
  accepted_sequence INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, actor_player_id, command_id)
);

CREATE TABLE match_events (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  command_sequence INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  event_kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (match_id, command_sequence, event_index)
);

CREATE INDEX idx_matches_room_id ON matches(room_id);
CREATE INDEX idx_match_members_match_id ON match_members(match_id);
CREATE INDEX idx_match_members_room_member_id ON match_members(room_member_id);
CREATE INDEX idx_match_commands_match_id ON match_commands(match_id);
CREATE INDEX idx_command_receipts_match_id ON command_receipts(match_id);
