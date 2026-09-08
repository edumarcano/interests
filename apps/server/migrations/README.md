# Database Migrations

This directory contains ordered, numbered SQL migration scripts for the `@finance-game/server` SQLite database.

## Filename Convention

Migration files must follow the pattern:

```text
<version>_<name>.sql
```
or
```text
<version>-<name>.sql
```

Where:
- `<version>` is a positive integer (e.g. `001`, `002`, etc.). Zero-padding is recommended for alphabetical consistency.
- `<name>` is a descriptive alphanumeric slug (e.g. `initial_schema`, `create_rooms`).
- The extension must be `.sql`.

### Example
- `001_initial_schema.sql`
- `002_create_rooms_and_members.sql`

## Execution Rules

1. Migrations execute in strictly ascending numeric order.
2. Each migration runs inside its own atomic SQLite transaction.
3. Applied migration versions and timestamps are stored in the `schema_migrations` table.
4. An already-applied migration is skipped on subsequent runs (idempotent).
5. If a migration fails, the entire transaction rolls back and the migration is not marked as applied.
6. Once a migration has been applied and committed to `main`, it is immutable. Schema changes must be made via a new migration.
