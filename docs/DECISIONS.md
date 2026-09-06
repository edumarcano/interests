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
4. **Opening Business Representation (`@finance-game/engine`):** Business assets include `debtPrincipalCents` used to derive business equity (`enterpriseValue - debtPrincipal`). The generic calculator returns signed safe-integer cents, supporting negative equity for distressed businesses without imposing an artificial universal `debt <= EV` invariant. Starting fixtures guarantee non-negative equity. In Quarter 1, business debt is balance-sheet-only and does not amortize; business operating profits are not separately distributed to prevent double counting spendable owner income.
5. **Deterministic Setup (`createGame`):** Starting assets and legacy bank loans are created in deterministic `playerOrder` advancing asset and loan counters without consuming RNG, without cash movements, and without emitting journal entries.
6. **Quarter Settlement Planning & Ordering (`settleQuarter`):** Two-phase execution: pure multi-stage planning validates solvency (`INSUFFICIENT_FUNDS` on negative projected balance) and capacity (`DESTINATION_OVERFLOW`) before any state change. Under the approved quarter-start recurring entitlement convention (A1), future cash interest uses quarter-start cash and future dividends use quarter-start holdings (market/yield execution deferred). Execution follows a strict 4-stage deterministic posting sequence:
   1. Recurring personal income by PlayerId (`personal-earned-income -> player`);
   2. Property operating distributions by AssetId then PlayerId (`property-operating-cashflow -> player`);
   3. Living expenses by PlayerId (`player -> living-expense-sink`);
   4. Legacy bank loan payments by LoanId (`player -> bank` with structured principal/interest breakdown).
7. **Idempotency & Replay:** Quarter 1 settlement advances `currentQuarter` to 2 and sets `lastSettledQuarter` to 1. Retrying returns `QUARTER_ALREADY_SETTLED` with state unchanged and zero journal entries.

## ARCH-022 - Corrected bounded RNG semantics

**Status:** Accepted  
**Date:** September 5, 2026

Refine ARCH-019 to correct bounded-random sampling bias before market, opportunity, or balance simulation begins:

1. **Root cause:** The `xorshift32-v1` implementation performed rejection sampling assuming a raw generator domain of $2^{32}$ (`0x1_0000_0000`). Because zero is the absorbing xorshift32 state, the valid non-zero xorshift32 cycle contains $2^{32} - 1$ states (`0xffffffff` = 4,294,967,295), creating a microscopic modulo bias and accepting an invalid bound of $2^{32}$.
2. **`xorshift32-v2` Semantics:** Introduce `xorshift32-v2` as the active default generator for new games (`RNG_ALGORITHM = RNG_ALGORITHM_V2`). It preserves the seed hashing algorithm and raw xorshift32 state transition unchanged. Bounded draws remap raw draws uniformly via `sample = raw - 1` over the true domain size of `0xffffffff`, with rejection limit `DOMAIN_SIZE - (DOMAIN_SIZE % bound)` and valid bounds strictly in `[1, 0xffffffff]`.
3. **Legacy Compatibility:** Explicit `xorshift32-v1` random states remain fully supported and retain the legacy bounded sampling behavior, preserving deterministic replay compatibility for recorded v1 matches.
4. **State Invariant:** Generator state is strictly enforced across the engine to be an integer in `[1, 0xffffffff]`. Non-integer, zero, negative, out-of-range values, and unrecognized algorithm identifiers are rejected before any draw or bitwise coercion.
5. **Operational Randomness:** Security-sensitive randomness (tokens, room codes, credentials) remains outside the engine kernel and continues to use platform CSPRNGs.

## ARCH-023 - Public-market value-balance representation and yield settlement

**Status:** Accepted  
**Date:** September 5, 2026

Establish the bounded public-market holdings and yield-settlement foundation for Standard V1:

1. **Fungible Value-Balance Representation (`@finance-game/engine`):** Model public market investments as per-player mark-to-market balances in integer cents (`publicMarketsByPlayer: Record<PlayerId, PublicMarketPortfolio>`) across three fixed instruments (`broad-market-fund`, `growth-fund`, `income-defensive-fund`). Do not introduce discrete share counts, unit prices, tax lots, or discrete `AssetId` entities.
2. **Standard V1 Opening Allocation (`createGame`):** In Standard V1 setup, profile starting public investments are allocated 100% to `broad-market-fund`, with zero in `growth-fund` and `income-defensive-fund`. This reconciles exactly with profile starting balance sheets without consuming RNG, advancing ID counters, or posting journal entries.
3. **Authoritative Quarter-Start Entitlement Basis (`quarterStartBasis`):** Store an authoritative `quarterStartBasis: QuarterStartFinanceBasis` snapshot in `FinanceState` capturing opening cash and public market portfolios for the quarter. Quarterly cash yield and public-market dividends are strictly calculated from this snapshot, ensuring mid-quarter cash transfers or spends do not retroactively alter that quarter's entitlement.
4. **Nominal Yield Calculation & Rounding (`calculateQuarterlyYieldCents`):** Quarterly yields use nominal annual rate / 4 with `ROUND_HALF_UP` rounding to integer cents (`principalCents × annualYieldBps / 40000`) using `FinanceDecimal`. Cash yield opening rate is 300 BPS (base rate 450 BPS minus 150 BPS offset, with 50 BPS floor). Instrument annual dividend yields are 150 BPS (`broad-market-fund`), 50 BPS (`growth-fund`), and 350 BPS (`income-defensive-fund`). Zero yields emit no journal entries.
5. **Canonical Settlement Sequence (`settleQuarter`):** Multi-stage planning validates capacity and solvency across all inflows and outflows before any mutation. Execution follows an atomic 6-stage sequence:
   1. Cash yield by PlayerId (`bank -> player`, reason `"cash-yield"`);
   2. Public-market dividends in canonical instrument order then PlayerId (`market -> player`, reason `"public-market-dividend"`, with `relatedMarketInstrumentId`);
   3. Recurring personal income by PlayerId (`personal-earned-income -> player`);
   4. Property operating distributions by AssetId then PlayerId (`property-operating-cashflow -> player`);
   5. Living expenses by PlayerId (`player -> living-expense-sink`);
   6. Legacy bank loan payments by LoanId (`player -> bank` with principal/interest breakdown).
6. **Next Quarter Basis Roll:** Upon successful settlement of Quarter N, `quarterStartBasis` is advanced to `quarter: N + 1` with closing cash and public market portfolios from Quarter N, ensuring newly settled cash and dividends earn yield in Quarter N+1.
7. **Deferred Scope:** Stochastic price movement, macroeconomic regimes, market trading, transaction fees, share counts, and qualifying liquidity underwriting are explicitly deferred.

## ARCH-024 - Deterministic shared economy and market-quarter sequencing

**Status:** Accepted  
**Date:** September 6, 2026

Establish the authoritative shared-economy cycle and deterministic public-market revaluation foundation for Standard V1:

1. **Authoritative Economy State (`EconomyState`):** Model a shared authoritative `economy` in `GameState` tracking `currentRegime: EconomicRegimeId`, `baseRateBps: BasisPoints`, and `lastMarketUpdate: MarketUpdateRecord | null`. Standard V1 starts in `expansion` with `baseRateBps = 450` (4.50%). Setup consumes zero additional RNG, counters, IDs, or revision.
2. **Canonical Regimes and Prototype Transitions (`@finance-game/rules`):** Define five economic regimes in canonical order: `expansion`, `overheating`, `slowdown`, `recession`, `recovery`. Transition probabilities are immutable rule-owned prototype constants where each row sums to 100%. Next regime is sampled via `drawBoundedInt(random, 100)` over cumulative probabilities in canonical order without floating-point comparisons.
3. **One Shared Market Return Per Instrument:** In each quarter, public-market price returns are determined by the regime mean plus bounded discrete uniform integer-BPS noise ($\text{returnBps} = \text{regimeMeanBps} + \text{noiseBps}$). Inclusive noise amplitudes are fixed in rules: Broad ($\pm 400$ BPS), Growth ($\pm 600$ BPS), Defensive ($\pm 250$ BPS). Every player holding an instrument shares the exact same price return.
4. **Holdings-Independent RNG Order:** Market return generation consumes engine RNG in strict canonical order:
   1. Broad Market Fund noise
   2. Growth Fund noise
   3. Income / Defensive Fund noise
   4. Next-regime transition roll  
   Draws occur regardless of whether any player holds an instrument or whether all holdings are zero, ensuring the macro path does not diverge based on portfolio decisions.
5. **Mark-to-Market Revaluation vs. Dividend Basis:**
   - **Dividends:** Calculated from the quarter-start entitlement basis (`finance.quarterStartBasis.publicMarketsByPlayer`) and posted as cash journal entries (`market -> player`).
   - **Price Revaluation:** Applied at quarter close to current closing holdings (`finance.publicMarketsByPlayer`) via $\text{newValue} = \text{round}(\text{currentValue} \times (10000 + \text{returnBps}) / 10000)$ using `FinanceDecimal` with `ROUND_HALF_UP`. Revaluation updates portfolio balances directly and emits no cash journal entries.
6. **Quarter-Close Timing and Basis Roll:** Settlement sequencing follows:
   1. Settle Quarter $N$ cash flows (yield, dividends, income, properties, expenses, loans);
   2. Apply Quarter $N$ price movement using Quarter $N$ regime to current holdings;
   3. Record completed `lastMarketUpdate` and transition `economy.currentRegime` to Quarter $N+1$;
   4. Capture Quarter $N+1$ `quarterStartBasis` containing revalued closing market holdings and closing cash;
   5. Commit tentative next `RandomState` and advance quarter.
7. **Two-Phase Atomicity and RNG Rollback:** Settlement validates cash solvency, capacity, and market revaluation bounds in pure planning before any state change. Any failure (including `MARKET_VALUE_OVERFLOW`) rejects atomically and returns the original state with RNG state unchanged.
8. **Deferred Macro Scope:** Base rate remains fixed at 450 BPS (with cash yield derived via `calculateCashYieldBps(baseRateBps)`). Market trading, transaction fees, shares/unit prices, property revaluation, business performance movement, inflation indexing, and credit-environment transitions remain explicitly deferred.

## ARCH-025 - Reproducible headless baseline simulation protocol

**Status:** Accepted  
**Date:** September 6, 2026

Establish the headless baseline simulation protocol and reporting harness in `@finance-game/simulation` building upon ARCH-015:

1. **Same Engine Architecture:** Simulation orchestrates the authoritative `@finance-game/engine` via public APIs (`createGame`, `applyAction`, `settleQuarter`, `totalPublicMarketValueCents`). It never duplicates financial rules, recalculates expected cash flows independently, or bypasses engine validation.
2. **Passive Baseline Setup & Policy:** Standard V1 games initialize with four deterministic branded simulation players (`simulation-player-1` .. `simulation-player-4`). In canonical `playerOrder`, each player selects their first offered objective (`offeredObjectiveIds[0]`) through real `applyAction()` calls, transitioning phase to `ready-for-first-round`. Players take zero optional gameplay actions thereafter.
3. **Deterministic Indexed Seed Suite:** Games are seeded deterministically via pure format `<seedPrefix>:<formattedIndex>` where `gameIndex` is zero-based and padded to at least 6 digits without truncation (e.g. `baseline-v1:000000`). No simulation-owned gameplay RNG or separate PRNG is introduced.
4. **Sequential V1 Execution:** Games execute in strictly ascending index order without worker threads, process pools, or concurrency.
5. **Observed Financial Metrics:** Financial accumulators measure actual `JournalEntry` outputs emitted by `settleQuarter()` (cash yield, dividends, income, property distributions, living expenses, legacy debt principal and interest). Portfolio valuations observe engine `totalPublicMarketValueCents()`.
6. **Narrow Liquid Net Position Metric:** The harness reports `liquidNetPositionCents` defined strictly as liquid capital plus player-loan receivables minus legacy debt and player-loan debt. It explicitly avoids inventing universal "net worth" by excluding property and business equity.
7. **Settlement Rejection as Measurement:** Engine settlement rejections (such as `INSUFFICIENT_FUNDS`) stop horizon progression for that individual game and are recorded by error code and quarter. Batches continue to completion without retry, state patching, or artificial bailouts.
8. **Environment-Free Canonical Reports:** Emitted JSON reports contain only deterministic scenario, configuration, versioning, reconciliation totals, profile metrics, economy regime occupancy, Markov transition counts, and market return statistics. Wall-clock timestamps, execution durations, hostnames, process IDs, and non-deterministic diagnostics are strictly excluded.
9. **Diagnostic Boundary:** Baseline reports measure opening position mechanics and macroeconomic drift; they do not report win rates, objective completion rates, or strategy rankings, and the simulation harness does not auto-tune game balance constants.
