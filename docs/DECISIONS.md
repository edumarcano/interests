# Architecture Decisions

This file records implementation decisions that refine or supersede examples in `ARCHITECTURE.md` without changing the game design.

## ARCH-017 - Workspace package namespace

**Status:** Accepted  
**Date:** September 5, 2026

Use the `@finance-game/*` namespace for workspace packages.

Current package names:

- `@finance-game/shared`
- `@finance-game/rules`
- `@finance-game/engine`
- `@finance-game/simulation`

Any `@game/*` names in architecture examples should be read as `@finance-game/*` until the architecture document is revised.

## ARCH-018 - Biome for initial code quality tooling

**Status:** Accepted  
**Date:** September 5, 2026

Use Biome for formatting and baseline linting in the initial workspace instead of maintaining separate ESLint and Prettier configurations.

TypeScript strict checking remains a separate required check. Dependency-boundary enforcement will be added as a focused repository check when package boundaries need automated enforcement.

This decision supersedes the ESLint + Prettier tooling examples in architecture v0.1.
