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
});
