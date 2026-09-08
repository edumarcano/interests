-- Migration 002: Room Pause Reasons
-- Normalized table storing independent active pause reasons for rooms.

CREATE TABLE room_pause_reasons (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, reason)
);

CREATE INDEX idx_room_pause_reasons_room_id ON room_pause_reasons(room_id);
