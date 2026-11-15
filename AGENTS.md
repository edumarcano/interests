# Interests Agent Instructions

Canonical instruction source for AI coding agents (`Interests`). Tool-specific rule files only bridge here and must not duplicate instructions.

## Source of truth

- `docs/GAME_DESIGN.md`: authoritative for game rules, balance intent, and status (LOCKED, PROTOTYPE, TENTATIVE, OPEN, POST-V1).
- `docs/DECISIONS.md`: authoritative for accepted implementation decisions; supersedes examples in `ARCHITECTURE.md`.
- `docs/ARCHITECTURE.md`: authoritative for system boundaries, package ownership, data flow, and milestones unless superseded by `DECISIONS.md`.
- `AGENTS.md`: governs agent operations. Never silently redefine game design or architecture.
- `.remora/standards/engineering.md`: shared engineering baseline and workflow standards.

If sources conflict, follow the most specific authoritative source. Agents decide implementation details autonomously, but must never invent rules for gameplay items marked OPEN or make unapproved architectural decisions. Surface those decisions explicitly and update `docs/DECISIONS.md` when approved.

## Working principles

- Keep V1 simple, deterministic, testable, and modular.
- Do not silently change game rules, numerical assumptions, package boundaries, or accepted architecture.
- Preserve backwards-compatible deterministic replay behavior unless a versioned rule change is explicitly authorized.

## Repository architecture

Modular TypeScript monolith with strict one-way dependency directions:
- `apps/web` -> `@interests/shared`
- `apps/server` -> `@interests/shared`, `@interests/engine`, `@interests/rules`
- `@interests/simulation` -> `@interests/engine`, `@interests/rules`, `@interests/shared`
- `@interests/engine` -> `@interests/rules`, `@interests/shared`
- `@interests/rules` -> `@interests/shared`
- `@interests/shared` -> primitives only; no game-domain package dependencies

Do not introduce reverse dependencies, cross-package relative imports, or browser imports of engine internals.

Package roles:
- `shared`: JSON-compatible IDs, protocol/view types, cross-boundary primitives.
- `rules`: Immutable rule/content data and schemas; no engine behavior.
- `engine`: Authoritative deterministic state, legality, calculations, transitions, RNG use, projections; no I/O, server, or web frameworks.
- `simulation`: Policies, scenarios, and reports using engine.
- `server`: Rooms, identity, persistence, and transport; no duplicated financial logic.
- `web`: Browser rendering, transport, and local drafts; no authoritative state calculations.

## Determinism and state

- The server is authoritative; clients request actions and never submit authoritative balances, state, or outcomes.
- Engine transitions must be deterministic for the same state, command, and immutable rules bundle.
- Gameplay randomness flows strictly through the engine random adapter. Never use `Math.random()`.
- Rejected commands must not mutate state, consume RNG, advance counters, or increment revisions.
- Canonical engine state must remain JSON-compatible: plain objects, arrays, strings, safe integers, booleans, and null. Never store `Date`, `Map`, `Set`, `BigInt`, functions, class instances, or Decimal objects.
- Deterministic entity IDs come from explicit match-scoped counters, not wall clock, UUIDs, or socket IDs.
- Hidden facts are generated once and persisted; diligence inspection reveals existing facts rather than rerolling them.

## Financial correctness

- Store money as safe integer cents.
- Store rates as basis points and ownership/ratios as explicit fixed-point integers. Never use floating-point dollars as canonical state.
- Cash, debt, fees, ownership, collateral, and transaction closing must be atomic.
- Contracts and loans have one canonical record; derive mirrored views rather than mutating separate borrower/lender copies.
- Quarterly recurring settlement must occur exactly once per round.

## Privacy and information boundaries

- Public position, private details: Never expose complete authoritative state to clients.
- Build recipient-specific allowlisted projections.
- Hidden objectives, private finances, unrevealed diligence facts, and private plans must never leak into public views, logs, errors, or snapshots.
- Add paired-state privacy regression tests when projection code is added or changed.

## Change discipline

- Work on a feature/fix/chore branch. Never commit directly to `main` or merge a PR without explicit user approval.
- Keep each PR focused on one bounded milestone or defect.
- Do not add dependencies, upgrade libraries, or replace tooling without a concrete need; record architectural changes in `docs/DECISIONS.md`.

## Verification

Required verification checks:
```text
pnpm typecheck
pnpm lint
pnpm test
```
Run `pnpm format` if formatting changes or Biome reports formatting issues. For harness integrity verification, run `python .remora/helpers/install.py --check --target .`.

## Multi-agent handoff & harness

The repository is edited interchangeably by Codex, Cursor, and Antigravity:
- Remora is installed under `.agents/skills/` and `.remora/` as the canonical workflow harness. Follow `.remora/standards/engineering.md` and use the applicable Remora skills. Do not add divergent tool-specific skills or subagents.
- Treat Git, tests, documentation, and PRs as persistent memory; do not rely on prior chat history.
- Keep branches buildable and commits focused on one logical change.

## Current implementation posture

The project is early V1. Complete deterministic setup, financial foundations, and transaction loops before investing in rich UI or infrastructure.
