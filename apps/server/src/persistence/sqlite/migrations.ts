import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  filepath: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  applied_at: string;
}

export interface MigrationResult {
  applied: MigrationFile[];
  alreadyApplied: number[];
}

const MIGRATION_FILE_PATTERN = /^(\d+)[-_](.+)\.sql$/;

export function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function parseMigrationFilename(
  filename: string,
): { version: number; name: string } | null {
  const match = filename.match(MIGRATION_FILE_PATTERN);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const version = parseInt(match[1], 10);
  if (Number.isNaN(version) || version <= 0) {
    return null;
  }
  return { version, name: match[2] };
}

export function loadMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrationFiles: MigrationFile[] = [];
  const versionsSeen = new Map<number, string>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) {
      continue;
    }

    const parsed = parseMigrationFilename(entry.name);
    if (!parsed) {
      throw new Error(
        `Invalid migration filename '${entry.name}'. Migration files must match pattern '<number>_<name>.sql' or '<number>-<name>.sql'.`,
      );
    }

    if (versionsSeen.has(parsed.version)) {
      throw new Error(
        `Duplicate migration version ${parsed.version}: '${entry.name}' and '${versionsSeen.get(parsed.version)}'`,
      );
    }

    versionsSeen.set(parsed.version, entry.name);
    migrationFiles.push({
      version: parsed.version,
      name: parsed.name,
      filename: entry.name,
      filepath: path.join(migrationsDir, entry.name),
    });
  }

  // Sort deterministically by version ascending
  migrationFiles.sort((a, b) => a.version - b.version);

  return migrationFiles;
}

export function getAppliedMigrations(
  db: Database.Database,
): AppliedMigration[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC",
    )
    .all() as AppliedMigration[];
  return rows;
}

export function runMigrations(
  db: Database.Database,
  migrationsDir: string,
): MigrationResult {
  ensureMigrationsTable(db);

  const migrationFiles = loadMigrationFiles(migrationsDir);
  const appliedRows = getAppliedMigrations(db);
  const appliedVersionSet = new Set(appliedRows.map((r) => r.version));

  const result: MigrationResult = {
    applied: [],
    alreadyApplied: Array.from(appliedVersionSet).sort((a, b) => a - b),
  };

  for (const migration of migrationFiles) {
    if (appliedVersionSet.has(migration.version)) {
      continue;
    }

    const sqlContent = fs.readFileSync(migration.filepath, "utf-8");

    try {
      const executeTransaction = db.transaction(() => {
        db.exec(sqlContent);
        db.prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        ).run(migration.version, migration.name, new Date().toISOString());
      });

      executeTransaction();
      result.applied.push(migration);
      appliedVersionSet.add(migration.version);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to execute migration ${migration.filename} (version ${migration.version}): ${message}`,
      );
    }
  }

  return result;
}
