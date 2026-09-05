# Finance Game Agent Instructions

This file is the canonical repository-level instruction source for AI coding agents working on `finance-game`, including Codex, Cursor, and Antigravity. Tool-specific rule files may point here, but they must not duplicate project instructions.

## Source of truth

Use the repository documentation according to subject:

- `docs/GAME_DESIGN.md` is authoritative for game rules, player experience, balance intent, and what is LOCKED, PROTOTYPE, TENTATIVE, OPEN, or POST-V1.
- `docs/DECISIONS.md` is authoritative for accepted implementation decisions and may explicitly supersede examples in `docs/ARCHITECTURE.md`.
- `docs/ARCHITECTURE.md` is authoritative for system boundaries, package ownership, data flow, persistence, networking, testing, and implementation milestones unless superseded by `docs/DECISIONS.md`.
- `AGENTS.md` governs how coding agents operate in the repository. It must not silently redefine game design or architecture.

If these sources conflict, follow the most specific authoritative source for the subject. If a requested implementation reaches an item marked OPEN or requires a new product/architecture decision, do not invent a permanent rule. Surface the decision explicitly and update `docs/DECISIONS.md` when the user approves it.

## Working principles

- Keep V1 simple, deterministic, testable, and modular.
- Prefer small vertical slices and small pull requests over broad rewrites.
- Do not add speculative abstractions, frameworks, services, or dependencies for hypothetical future needs.
- Do not silently change game rules, numerical assumptions, package boundaries, or accepted architecture.
- Preserve backwards-compatible deterministic behavior unless the task explicitly changes a versioned rule or compatibility boundary.
- Treat Git, tests, documentation, and the current PR as persistent project memory. Do not assume another agent's prior conversation is available.

## Before editing

For continuation work, inspect the repository state before making changes:

```text
git status
git log --oneline -5
git diff main...HEAD
```

Then read the relevant sections of `docs/GAME_DESIGN.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` for the task. Inspect nearby production code and tests before designing a new pattern.

Do not overwrite or revert unrelated user or agent work.

## Repository architecture

The project is a TypeScript modular monolith with these intended dependency directions:

- `apps/web` -> `@finance-game/shared`
- `apps/server` -> `@finance-game/shared`, `@finance-game/engine`, `@finance-game/rules`
- `@finance-game/simulation` -> `@finance-game/engine`, `@finance-game/rules`, `@finance-game/shared`
- `@finance-game/engine` -> `@finance-game/rules`, `@finance-game/shared`
- `@finance-game/rules` -> `@finance-game/shared`
- `@finance-game/shared` -> no game-domain package

Do not introduce reverse dependencies, browser imports of engine internals, cross-package relative imports, or a second implementation of financial/game rules in the server or UI.

Package responsibilities:

- `shared`: JSON-compatible IDs, protocol/view types, and cross-boundary primitives only.
- `rules`: immutable rule/content data and schemas; no engine behavior or infrastructure.
- `engine`: authoritative deterministic game state, legality, calculations, transitions, RNG use, and projections; no network, database, filesystem, React, wall clock, credentials, or session management.
- `simulation`: policies, scenarios, reports using the same engine; no alternate game rules.
- `server`: rooms, identity, queues, persistence, authorization, and transport; no duplicate financial engine.
- `web`: rendering, local drafts, responsive UX, and transport; no hidden authoritative state or client-side victory/affordability authority.

## Determinism and state

- The server is authoritative; clients request actions and never submit authoritative balances, state, random outcomes, or winners.
- Engine transitions must be deterministic for the same state, command, and immutable rules bundle.
- Gameplay randomness may only flow through the engine random adapter. Never use `Math.random()` in engine gameplay code.
- Rejected commands must not mutate state, consume RNG, advance counters, or change revision.
- Canonical engine state must remain JSON-compatible: plain objects, arrays, strings, safe integers, booleans, and null. Do not store `Date`, `Map`, `Set`, `BigInt`, functions, class instances, or Decimal objects.
- Deterministic entity identifiers come from explicit match-scoped counters, not wall clock, random UUIDs, socket IDs, or nicknames.
- Hidden facts are generated once and persisted; inspection reveals existing facts rather than rerolling them.

## Financial correctness

- Store money as safe integer cents.
- Store rates as basis points and ownership/ratios using explicit fixed-point conventions defined by the architecture or accepted decisions.
- Do not use floating-point dollars as canonical state.
- Cash, debt, fees, ownership, collateral, and transaction closing must be atomic where the architecture requires it.
- A loan or contract must have one canonical record; derive mirrored views rather than mutating independent borrower/lender copies.
- Quarterly recurring settlement must occur exactly once per round.
- Add or update tests before merging changes that affect money, debt, ownership, settlement, RNG, privacy, or transaction atomicity.

## Privacy and information boundaries

- Follow the design rule: public position, private details.
- Never expose complete authoritative state to clients and hide secrets in UI code.
- Build recipient-specific allowlisted projections.
- Hidden objectives, exact private finances, unrevealed opportunity facts, private plans, and other secret state must not leak through public views, logs, errors, snapshots, or test fixtures intended for another player.
- Add paired-state privacy regression tests when projection code is introduced or changed.

## Change discipline

- Work on a feature/fix/chore branch. Do not commit directly to `main` unless the user explicitly requests it.
- Keep each PR focused on one bounded milestone or defect.
- Do not merge a PR unless the user explicitly asks for the merge.
- Do not add or upgrade dependencies without a concrete need. Explain new production dependencies and record meaningful architecture changes in `docs/DECISIONS.md`.
- Do not replace existing tooling or architectural choices because another tool is more familiar.
- When a task changes an accepted architecture decision, update `docs/DECISIONS.md` in the same PR.

## Verification

Before considering a code change complete, run the repository checks appropriate to the change. The default required checks are:

```text
pnpm typecheck
pnpm lint
pnpm test
```

Run `pnpm format` before the final check when formatting has changed or Biome reports formatting issues.

Do not knowingly open a PR with failing local checks unless the failure is external, pre-existing, or explicitly documented in the PR.

For deterministic engine changes, add focused tests proving repeatability and rejected-action immutability. For financial or ownership changes, add invariant tests. For network/persistence work, add failure/retry/idempotency coverage appropriate to the slice.

## Multi-agent handoff

This repository may be edited interchangeably with Codex, Cursor, and Antigravity because of usage limits. Every agent must assume another agent may continue the branch later.

- Keep the branch buildable whenever practical.
- Prefer clear commits that describe one logical change.
- Leave unfinished work visible in the PR description, issue, tests, or explicit TODO only when necessary; do not rely on chat history.
- Before continuing another agent's branch, inspect the diff and tests rather than recreating work from memory.
- Do not create tool-specific copies of project instructions. `AGENTS.md` remains canonical.

## Skills, subagents, and extra automation

Do not add project skills, custom subagents, MCP configuration, or agent-specific workflow frameworks yet unless a recurring workflow has appeared often enough to justify them and the user approves the addition.

If project skills are introduced later, keep one canonical implementation and use adapters only where a tool requires them. Do not maintain three divergent copies for Codex, Cursor, and Antigravity.

## Current implementation posture

The project is still early. Favor correctness and architectural clarity over implementation speed. Complete deterministic setup, financial foundations, and transaction slices before investing in rich UI or infrastructure that does not unlock the next playable vertical slice.
