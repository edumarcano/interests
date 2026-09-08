import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface OpenDatabaseOptions {
  dbPath: string;
}

export type SqliteDatabase = Database.Database;

export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const { dbPath } = options;
  const isMemory = dbPath === ":memory:" || dbPath.startsWith("file::memory:");

  if (!isMemory) {
    const resolvedPath = path.resolve(dbPath);
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Enable foreign key constraints
  db.pragma("foreign_keys = ON;");

  // Configure busy timeout (5 seconds)
  db.pragma("busy_timeout = 5000;");

  // If file-backed, enable WAL mode and safe synchronous mode
  if (!isMemory) {
    db.pragma("journal_mode = WAL;");
    db.pragma("synchronous = NORMAL;");
  }

  return db;
}
