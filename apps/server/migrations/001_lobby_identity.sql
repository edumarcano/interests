-- Migration 001: Lobby Identity and Recovery
-- Persists rooms, room members, browser sessions, and session-to-membership grants.

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  host_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);

CREATE TABLE room_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL,
  join_order INTEGER NOT NULL,
  recovery_credential_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(room_id, nickname_key),
  UNIQUE(room_id, join_order)
);

CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  credential_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE session_memberships (
  session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
  room_member_id TEXT NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (session_id, room_member_id)
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_room_members_room_id ON room_members(room_id);
CREATE INDEX idx_room_members_recovery_digest ON room_members(recovery_credential_digest);
CREATE INDEX idx_browser_sessions_digest ON browser_sessions(credential_digest);
CREATE INDEX idx_session_memberships_session_id ON session_memberships(session_id);
CREATE INDEX idx_session_memberships_member_id ON session_memberships(room_member_id);
