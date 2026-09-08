import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAppliedMigrations,
  runMigrations,
} from "../src/persistence/sqlite/migrations.js";

describe("SQLite migration runner", () => {
  let tempDir: string;
  let migrationsDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "finance-game-migrations-test-"),
    );
    migrationsDir = path.join(tempDir, "migrations");
    fs.mkdirSync(migrationsDir, { recursive: true });
    db = new Database(":memory:");
  });

  afterEach(() => {
    if (db.open) {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("applies migrations in numeric ascending order and records in schema_migrations", () => {
    fs.writeFileSync(
      path.join(migrationsDir, "002_create_items.sql"),
      `CREATE TABLE items (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT);`,
    );
    fs.writeFileSync(
      path.join(migrationsDir, "001_create_users.sql"),
      `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);`,
    );

    const result = runMigrations(db, migrationsDir);
    expect(result.applied.map((m) => m.version)).toEqual([1, 2]);

    const applied = getAppliedMigrations(db);
    expect(applied.map((m) => ({ version: m.version, name: m.name }))).toEqual([
      { version: 1, name: "create_users" },
      { version: 2, name: "create_items" },
    ]);

    // Verify both tables exist
    db.prepare("INSERT INTO users (id, name) VALUES (1, 'Alice')").run();
    db.prepare(
      "INSERT INTO items (id, user_id, name) VALUES (10, 1, 'Shield')",
    ).run();
    const user = db.prepare("SELECT * FROM users WHERE id = 1").get() as {
      name: string;
    };
    expect(user.name).toBe("Alice");
  });

  it("is idempotent and does not re-apply already applied migrations", () => {
    fs.writeFileSync(
      path.join(migrationsDir, "001_initial.sql"),
      `CREATE TABLE test_table (id INTEGER PRIMARY KEY);`,
    );

    const firstRun = runMigrations(db, migrationsDir);
    expect(firstRun.applied.length).toBe(1);
    expect(firstRun.alreadyApplied.length).toBe(0);

    const secondRun = runMigrations(db, migrationsDir);
    expect(secondRun.applied.length).toBe(0);
    expect(secondRun.alreadyApplied).toEqual([1]);

    const applied = getAppliedMigrations(db);
    expect(applied.length).toBe(1);
  });

  it("atomically rolls back a failed migration and does not mark it as applied", () => {
    fs.writeFileSync(
      path.join(migrationsDir, "001_good.sql"),
      `CREATE TABLE valid_table (id INTEGER PRIMARY KEY);`,
    );
    fs.writeFileSync(
      path.join(migrationsDir, "002_bad.sql"),
      `CREATE TABLE doomed_table (id INTEGER PRIMARY KEY);
       INVALID SQL SYNTAX HERE THAT SHOULD FAIL;`,
    );

    expect(() => {
      runMigrations(db, migrationsDir);
    }).toThrow(/Failed to execute migration 002_bad\.sql/i);

    const applied = getAppliedMigrations(db);
    // Migration 001 succeeded, but 002 was rolled back and not recorded
    expect(applied.map((m) => m.version)).toEqual([1]);

    // doomed_table should not exist because of rollback
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='doomed_table'",
      )
      .get();
    expect(tableCheck).toBeUndefined();
  });

  it("rejects duplicate migration versions clearly", () => {
    fs.writeFileSync(
      path.join(migrationsDir, "001_first.sql"),
      `CREATE TABLE a (id INTEGER PRIMARY KEY);`,
    );
    fs.writeFileSync(
      path.join(migrationsDir, "001_conflict.sql"),
      `CREATE TABLE b (id INTEGER PRIMARY KEY);`,
    );

    expect(() => {
      runMigrations(db, migrationsDir);
    }).toThrow(/Duplicate migration version 1/i);
  });

  it("rejects invalid migration filenames", () => {
    fs.writeFileSync(
      path.join(migrationsDir, "invalid_filename.sql"),
      `CREATE TABLE a (id INTEGER PRIMARY KEY);`,
    );

    expect(() => {
      runMigrations(db, migrationsDir);
    }).toThrow(/Invalid migration filename 'invalid_filename\.sql'/i);
  });

  it("rejects an unapplied migration whose version is less than or equal to the highest applied version", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, 'create_items', '2026-09-08T00:00:00.000Z');
    `);

    fs.writeFileSync(
      path.join(migrationsDir, "001_create_users.sql"),
      `CREATE TABLE users (id INTEGER PRIMARY KEY);`,
    );

    expect(() => {
      runMigrations(db, migrationsDir);
    }).toThrow(
      /Cannot apply out-of-order migration '001_create_users\.sql' with version 1 because a higher version \(2\) has already been applied/i,
    );
  });

  it("rejects a recorded migration when its disk filename name has changed", () => {
    fs.writeFileSync(
      path.join(migrationsDir, "001_initial_schema.sql"),
      `CREATE TABLE users (id INTEGER PRIMARY KEY);`,
    );
    runMigrations(db, migrationsDir);

    fs.unlinkSync(path.join(migrationsDir, "001_initial_schema.sql"));
    fs.writeFileSync(
      path.join(migrationsDir, "001_renamed_schema.sql"),
      `CREATE TABLE users (id INTEGER PRIMARY KEY);`,
    );

    expect(() => {
      runMigrations(db, migrationsDir);
    }).toThrow(
      /Migration name mismatch for version 1: recorded as 'initial_schema', but file '001_renamed_schema\.sql' specifies 'renamed_schema'/i,
    );
  });

  it("applies migration 001 and 002 from actual server migrations directory successfully", () => {
    const actualMigrationsDir = path.resolve(__dirname, "../migrations");
    const result = runMigrations(db, actualMigrationsDir);
    expect(result.applied.map((m) => m.version)).toEqual([1, 2]);

    const tableInfo = db.prepare("PRAGMA table_info(room_pause_reasons)").all();
    expect(tableInfo.length).toBeGreaterThan(0);
  });
});
