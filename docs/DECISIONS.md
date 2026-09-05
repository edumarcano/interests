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

## ARCH-019 - Engine-owned deterministic PRNG

**Status:** Accepted  
**Date:** September 5, 2026

Use a small engine-owned, versioned pseudo-random number generator with explicit serializable state instead of depending on a general-purpose random library for the deterministic kernel.

The initial algorithm identifier is `xorshift32-v1`. Seed hashing, algorithm name, and generator state are part of replay compatibility. Changing the algorithm requires a new version identifier rather than silently altering old replays.

Gameplay code must consume randomness only through the engine random adapter. Credentials, reconnect tokens, and other security-sensitive randomness remain a server responsibility and must use cryptographically secure APIs.

This decision supersedes the architecture v0.1 example that named `seedrandom`; the architectural requirement is deterministic, explicit, versioned randomness rather than a particular library.

## ARCH-020 - Shared AI agent guidance

**Status:** Accepted  
**Date:** September 5, 2026

Use the root `AGENTS.md` as the single canonical repository-level instruction source for AI coding agents. Codex, Cursor, Antigravity, and any future coding agent must follow the same project guidance rather than maintaining separate copies.

Tool-specific rule files may exist only as compatibility bridges that direct the tool to `AGENTS.md`. They must not duplicate project instructions or become independent sources of truth.

The repository may be worked on interchangeably by multiple coding agents because of usage limits. Git history, the active branch, tests, repository documentation, and pull-request context are the persistent handoff mechanism; agents must not rely on conversation history being available to the next tool.

Do not add project skills, custom subagents, MCP configuration, or agent-specific workflow frameworks yet. Introduce them only after a recurring workflow demonstrates a concrete need and the user approves it. If skills are introduced later, maintain one canonical implementation with compatibility adapters only where required.

## ARCH-021 - Standard V1 objective-deal scoring and selection

**Status:** Accepted  
**Date:** September 5, 2026

Resolve Section 9.6 dealing preferences (and consistency item G7) with an explicit, deterministic scoring model:

1. **Validity filter**: An allocation of eight objectives across four players (two each) is valid if and only if every player receives zero Stretch (`T`) objectives and at least one Strong-fit (`S`) objective.
2. **Scoring formula**: Valid deals are scored across the four offered pairs. For each player:
   - +1 point if the two offered objectives belong to different strategic families.
   - +1 point if the two offered objectives offer contrast (one Strong fit and one Viable alternative).
   Maximum score per player is 2; maximum score per match is 8.
3. **High-quality subset**: Defined as the set of candidate deals achieving the maximum score for that four-profile combination (`score === maxScore`).
   Across all 69 feasible four-profile combinations, every combination contains multiple deals achieving the theoretical maximum of 8 (between 3 and 106 deals). Selection from this subset is chosen uniformly at random using the engine PRNG adapter.

