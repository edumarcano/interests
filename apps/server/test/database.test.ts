import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  type SqliteDatabase,
} from "../src/persistence/sqlite/openDatabase.js";

describe("SQLite database initialization", () => {
  let tempDir: string;
  let dbsToClose: SqliteDatabase[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-game-db-test-"));
    dbsToClose = [];
  });

  afterEach(() => {
    for (const db of dbsToClose) {
      if (db.open) {
        db.close();
      }
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates a database in a temporary nested directory and creates parent directories", () => {
    const nestedDir = path.join(tempDir, "nested", "storage");
    const dbPath = path.join(nestedDir, "test.sqlite");

    expect(fs.existsSync(nestedDir)).toBe(false);

    const db = openDatabase({ dbPath });
    dbsToClose.push(db);

    expect(db.open).toBe(true);
    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("enables foreign key enforcement", () => {
    const dbPath = path.join(tempDir, "foreign_keys.sqlite");
    const db = openDatabase({ dbPath });
    dbsToClose.push(db);

    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);

    // Verify foreign keys actively reject violations
    db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
    `);

    expect(() => {
      db.prepare("INSERT INTO child (id, parent_id) VALUES (1, 999)").run();
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("configures WAL journal mode, synchronous FULL, and busy timeout for file-backed databases", () => {
    const dbPath = path.join(tempDir, "wal_mode.sqlite");
    const db = openDatabase({ dbPath });
    dbsToClose.push(db);

    const journalMode = db.pragma("journal_mode", { simple: true });
    expect(journalMode).toBe("wal");

    const synchronous = db.pragma("synchronous", { simple: true });
    expect(synchronous).toBe(2);

    const busyTimeout = db.pragma("busy_timeout", { simple: true });
    expect(busyTimeout).toBe(5000);
  });

  it("closes cleanly", () => {
    const dbPath = path.join(tempDir, "clean_close.sqlite");
    const db = openDatabase({ dbPath });

    expect(db.open).toBe(true);
    db.close();
    expect(db.open).toBe(false);
  });
});
