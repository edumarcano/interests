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

## ARCH-021 - Standard V1 Starting Finances and Quarter-1 Settlement Foundation

**Status:** Accepted  
**Date:** September 5, 2026

Implement the deterministic financial foundations required to execute Quarter 1 for all eight Standard V1 starting profiles:

1. **Starting Finance Fixtures (`@finance-game/rules`):** Define typed starting finance fixtures and constants (`OPENING_PERSONAL_DEBT_APR_BPS = 800`, `PROPERTY_STARTER_MORTGAGE_APR_BPS = 550`, `PROPERTY_STARTER_MORTGAGE_QUARTERLY_PAYMENT_CENTS = 433_537`) as the single source of truth for profile starting finances.
2. **Recurring Personal Finance State (`@finance-game/engine`):** Model `recurringByPlayer` in `FinanceState` tracking authoritative `quarterlyIncomeCents` and `quarterlyLivingExpenseCents` per player.
3. **Canonical Loan Registry Union (`@finance-game/engine`):** Extend `loansById` to a discriminated union `Loan = PlayerLoan | LegacyBankLoan`. Legacy bank loans carry fixed APR basis points, fixed scheduled quarterly payment cents, and derived amortization (no invented contractual term). Purpose is restricted to `"personal-debt"` or `"property-mortgage"` (with optional `relatedAssetId`). Existing player loan helpers reject legacy bank loans with `WRONG_LOAN_KIND`.
4. **Opening Business Representation (`@finance-game/engine`):** Business assets include `debtPrincipalCents` used to derive business equity (`enterpriseValue - debtPrincipal`). In Quarter 1, business debt is balance-sheet-only and does not amortize; business operating profits are not separately distributed to prevent double counting spendable owner income.
5. **Deterministic Setup (`createGame`):** Starting assets and legacy bank loans are created in deterministic `playerOrder` advancing asset and loan counters without consuming RNG, without cash movements, and without emitting journal entries.
6. **Quarter Settlement Planning & Ordering (`settleQuarter`):** Two-phase execution: pure multi-stage planning validates solvency (`INSUFFICIENT_FUNDS` on negative projected balance) and capacity (`DESTINATION_OVERFLOW`) before any state change. Execution follows a strict 4-stage deterministic posting sequence:
   1. Recurring personal income by PlayerId (`personal-earned-income -> player`);
   2. Property operating distributions by AssetId then PlayerId (`property-operating-cashflow -> player`);
   3. Living expenses by PlayerId (`player -> living-expense-sink`);
   4. Legacy bank loan payments by LoanId (`player -> bank` with structured principal/interest breakdown).
7. **Idempotency & Replay:** Quarter 1 settlement advances `currentQuarter` to 2 and sets `lastSettledQuarter` to 1. Retrying returns `QUARTER_ALREADY_SETTLED` with state unchanged and zero journal entries.


