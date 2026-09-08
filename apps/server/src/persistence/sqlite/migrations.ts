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
  const appliedMap = new Map(appliedRows.map((r) => [r.version, r.name]));
  let maxAppliedVersion = appliedRows.reduce(
    (max, r) => Math.max(max, r.version),
    0,
  );

  // Validate that on-disk migration names match previously recorded migration names
  for (const migration of migrationFiles) {
    const recordedName = appliedMap.get(migration.version);
    if (recordedName !== undefined && recordedName !== migration.name) {
      throw new Error(
        `Migration name mismatch for version ${migration.version}: recorded as '${recordedName}', but file '${migration.filename}' specifies '${migration.name}'. Migrations are immutable once applied.`,
      );
    }
  }

  const result: MigrationResult = {
    applied: [],
    alreadyApplied: Array.from(appliedMap.keys()).sort((a, b) => a - b),
  };

  for (const migration of migrationFiles) {
    if (appliedMap.has(migration.version)) {
      continue;
    }

    if (migration.version <= maxAppliedVersion) {
      throw new Error(
        `Cannot apply out-of-order migration '${migration.filename}' with version ${migration.version} because a higher version (${maxAppliedVersion}) has already been applied. Migrations must be append-only.`,
      );
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
      appliedMap.set(migration.version, migration.name);
      maxAppliedVersion = Math.max(maxAppliedVersion, migration.version);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to execute migration ${migration.filename} (version ${migration.version}): ${message}`,
      );
    }
  }

  return result;
}
