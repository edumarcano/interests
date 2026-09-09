# Architecture Decisions

This file records implementation decisions that refine or supersede examples in `ARCHITECTURE.md` without changing the game design.

## ARCH-017 - Workspace package namespace

**Status:** Accepted  
**Date:** September 5, 2026 (Updated September 8, 2026)

Use the `@interests/*` namespace for workspace packages.

Current package names:

- `@interests/shared`
- `@interests/rules`
- `@interests/engine`
- `@interests/simulation`
- `@interests/server`

Supersedes the initial temporary `@finance-game/*` workspace namespace. Any `@game/*` names in architecture examples should be read as `@interests/*`.

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

1. **Starting Finance Fixtures (`@interests/rules`):** Define typed starting finance fixtures and constants (`OPENING_PERSONAL_DEBT_APR_BPS = 800`, `PROPERTY_STARTER_MORTGAGE_APR_BPS = 550`, `PROPERTY_STARTER_MORTGAGE_QUARTERLY_PAYMENT_CENTS = 433_537`) as the single source of truth for profile starting finances.
2. **Recurring Personal Finance State (`@interests/engine`):** Model `recurringByPlayer` in `FinanceState` tracking authoritative `quarterlyIncomeCents` and `quarterlyLivingExpenseCents` per player.
3. **Canonical Loan Registry Union (`@interests/engine`):** Extend `loansById` to a discriminated union `Loan = PlayerLoan | LegacyBankLoan`. Legacy bank loans carry fixed APR basis points, fixed scheduled quarterly payment cents, and derived amortization (no invented contractual term). Purpose is restricted to `"personal-debt"` or `"property-mortgage"` (with optional `relatedAssetId`). Existing player loan helpers reject legacy bank loans with `WRONG_LOAN_KIND`.
4. **Opening Business Representation (`@interests/engine`):** Business assets include `debtPrincipalCents` used to derive business equity (`enterpriseValue - debtPrincipal`). The generic calculator returns signed safe-integer cents, supporting negative equity for distressed businesses without imposing an artificial universal `debt <= EV` invariant. Starting fixtures guarantee non-negative equity. In Quarter 1, business debt is balance-sheet-only and does not amortize; business operating profits are not separately distributed to prevent double counting spendable owner income.
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

1. **Fungible Value-Balance Representation (`@interests/engine`):** Model public market investments as per-player mark-to-market balances in integer cents (`publicMarketsByPlayer: Record<PlayerId, PublicMarketPortfolio>`) across three fixed instruments (`broad-market-fund`, `growth-fund`, `income-defensive-fund`). Do not introduce discrete share counts, unit prices, tax lots, or discrete `AssetId` entities.
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
2. **Canonical Regimes and Prototype Transitions (`@interests/rules`):** Define five economic regimes in canonical order: `expansion`, `overheating`, `slowdown`, `recession`, `recovery`. Transition probabilities are immutable rule-owned prototype constants where each row sums to 100%. Next regime is sampled via `drawBoundedInt(random, 100)` over cumulative probabilities in canonical order without floating-point comparisons.
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

Establish the headless baseline simulation protocol and reporting harness in `@interests/simulation` building upon ARCH-015:

1. **Same Engine Architecture:** Simulation orchestrates the authoritative `@interests/engine` via public APIs (`createGame`, `applyAction`, `settleQuarter`, `totalPublicMarketValueCents`). It never duplicates financial rules, recalculates expected cash flows independently, or bypasses engine validation.
2. **Passive Baseline Setup & Policy:** Standard V1 games initialize with four deterministic branded simulation players (`simulation-player-1` .. `simulation-player-4`). In canonical `playerOrder`, each player selects their first offered objective (`offeredObjectiveIds[0]`) through real `applyAction()` calls, transitioning phase to `ready-for-first-round`. Players take zero optional gameplay actions thereafter.
3. **Deterministic Indexed Seed Suite:** Games are seeded deterministically via pure format `<seedPrefix>:<formattedIndex>` where `gameIndex` is zero-based and padded to at least 6 digits without truncation (e.g. `baseline-v1:000000`). No simulation-owned gameplay RNG or separate PRNG is introduced.
4. **Sequential V1 Execution:** Games execute in strictly ascending index order without worker threads, process pools, or concurrency.
5. **Observed Financial Metrics:** Financial accumulators measure actual `JournalEntry` outputs emitted by `settleQuarter()` (cash yield, dividends, income, property distributions, living expenses, legacy debt principal and interest). Portfolio valuations observe engine `totalPublicMarketValueCents()`.
6. **Narrow Liquid Net Position Metric:** The harness reports `liquidNetPositionCents` defined strictly as liquid capital plus player-loan receivables minus legacy debt and player-loan debt. It explicitly avoids inventing universal "net worth" by excluding property and business equity.
7. **Settlement Rejection as Measurement:** Engine settlement rejections (such as `INSUFFICIENT_FUNDS`) stop horizon progression for that individual game and are recorded by error code and quarter. Batches continue to completion without retry, state patching, or artificial bailouts.
8. **Environment-Free Canonical Reports:** Emitted JSON reports contain only deterministic scenario, configuration, versioning, reconciliation totals, profile metrics, economy regime occupancy, Markov transition counts, and market return statistics. Wall-clock timestamps, execution durations, hostnames, process IDs, and non-deterministic diagnostics are strictly excluded.
9. **Diagnostic Boundary:** Baseline reports measure opening position mechanics and macroeconomic drift; they do not report win rates, objective completion rates, or strategy rankings, and the simulation harness does not auto-tune game balance constants.

## ARCH-026 - Atomic cash asset-sale transaction foundation

**Status:** Accepted  
**Date:** September 6, 2026

Establish the initial atomic cash asset-sale transaction foundation in `@interests/engine` as the transaction kernel for Architecture Milestone 4:

1. **Dedicated Transaction Identifier & Deterministic Counter:**
   - Introduce branded `TransactionId` in `@interests/shared` and `asTransactionId()`.
   - Extend `DeterministicCounters` with `transaction: number` and `nextDeterministicId("transaction", counters)` generating deterministic IDs (`transaction-1`, `transaction-2`, ...).
   - Opening a transaction consumes exactly one transaction ID; rejected attempts, cancellation, and closing consume zero new transaction IDs.
   - Transaction operations consume zero gameplay RNG.

2. **One Active Major Transaction & Reservation State:**
   - Model `activeTransaction: ActiveTransaction | null` at the top level of `GameState` initialized to `null`.
   - PR #13 supports exactly one discriminated type: `CashBusinessPurchaseTransaction` with explicit `CashReservation` (`{ playerId: buyerPlayerId, amountCents: purchasePriceCents, purpose: "purchase-price" }`).
   - Reservations reduce pure helper `getAvailableCashCents(state, playerId)` (`actual cash - reservations`), while actual `finance.cashByPlayer` remains unaltered until closing. No secondary editable cash balances are introduced.

3. **Narrow Supported Asset Scope (Implementation Boundary):**
   - The supported transaction is strictly a fixed-price sale of 100% (1,000,000 PPM) ownership of an existing debt-free (`debtPrincipalCents === 0`) business asset between two distinct valid players.
   - Opening validates setup phase (`ready-for-first-round`), no other active transaction, valid distinct parties, sole 100% seller ownership, zero entity debt, positive safe-integer price, and sufficient buyer available cash.
   - Property sales, debt-bearing businesses, co-owned assets, partial stakes, seller financing, third-party financing, and partnerships are explicitly rejected and deferred.

4. **Pure Domain Foundation Boundary:**
   - Transaction operations (`openCashBusinessPurchaseTransaction`, `cancelActiveTransaction`, `closeCashBusinessPurchaseTransaction`) are domain primitives.
   - They are **not** wired into player-facing `applyAction()` dispatching in this milestone, avoiding prematurely inventing turn order, spotlight sequencing, or authorization before G1 is resolved.

5. **Lifecycle Semantics & Full Rejection Atomicity:**
   - **Open:** Reserves buyer cash, sets `activeTransaction`, advances revision by 1, advances transaction counter, emits zero journal entries. Rejections return the original state unchanged.
   - **Cancel:** Revalidates active transaction ID, clears `activeTransaction`, releases reservation, advances revision by 1, moves no cash, transfers no ownership, emits zero journal entries.
   - **Close:** Revalidates complete transaction state (parties, asset, 100% ownership, zero debt, price, buyer cash solvency, seller destination overflow). Atomically executes buyer $\to$ seller cash posting using authoritative `postCash` (`reason: "business-purchase"`), replaces business ownership with 100% sole buyer ownership via `createSoleOwnership`, clears `activeTransaction`, advances revision by 1, and advances journal counter by 1.

6. **Journal Transaction & Asset Linkage:**
   - Extend `JournalEntry` and `CashPostingRequest` with optional `relatedTransactionId?: TransactionId`.
   - The closing cash journal entry explicitly records `relatedTransactionId` and `relatedAssetId`, enabling end-to-end ledger traceability without emitting pseudo-entries for non-cash ownership transfers.

7. **Settlement Blocking Invariant:**
   - `settleQuarter` rejects with `"ACTIVE_TRANSACTION"` whenever `state.activeTransaction !== null`, preserving state, revision, counters, RNG, and journal entries. Transactions must resolve before round settlement executes.

8. **Deferred Milestone 4 Scope & OPEN Questions:**
    - Opportunities, investigation, focus weighting, financing offers, auctions, counter-offers, transaction expiry, fees, and taxes remain deferred.
    - This milestone does not resolve OPEN game-design questions A4 (business distributions), A5 (debt default/collateral), A6 (market fees/expiry), or G1 (spotlight sequencing).

## ARCH-027 - Private opportunity lifecycle and pregenerated diligence facts

**Status:** Accepted  
**Date:** September 6, 2026

Establish the first private business-purchase opportunity lifecycle in `@interests/engine` as the next narrow vertical slice of Architecture Milestone 4:

1. **Authoritative Normalized Opportunity Registry (`opportunitiesById`):**
   - Model `opportunitiesById: Record<OpportunityId, Opportunity>` at the top level of `GameState`, initialized to `{}` for new games.
   - Opportunities are stored in a single normalized match registry rather than nested or duplicated inside individual `PlayerState` records.

2. **First Supported Private Business Opportunity Kind (`private-business-purchase`):**
   - Model `PrivateBusinessPurchaseOpportunity` representing private access by a target buyer to purchase 100% sole ownership of an existing debt-free business from another player at a fixed asking price.
   - Pre-conditions match the PR #13 transaction capability (debt-free business, sole 100% seller ownership, positive safe-integer price). Affordability is deliberately not required for opportunity discovery.

3. **Deterministic Trusted Creation & RNG Boundary:**
   - Add trusted domain primitive `createPrivateBusinessPurchaseOpportunity()`.
   - Successful creation advances `counters.opportunity` via `nextDeterministicId("opportunity", counters)` and revision by 1.
   - Discovery consumes zero gameplay RNG (`drawBoundedInt` is not called). Selection, weighting, and focus tables remain a future opportunity-selection responsibility.
   - Preflight counter exhaustion returns typed `OPPORTUNITY_ID_EXHAUSTED` atomically without throwing.

4. **Pregenerated Due-Diligence Snapshot:**
   - At opportunity discovery, snapshot `annualRevenueCents`, `annualOperatingProfitCents`, `enterpriseValueCents`, and `debtPrincipalCents` from the underlying business into `investigation.facts`.
   - Subsequent investigation merely discloses this stored snapshot; it never regenerates facts from the live asset or rerolls values.

5. **Target-Only Private Projection & Existence Privacy (`getOpportunityView`):**
   - Private opportunities are completely concealed from unauthorized players: view, investigate, and pursue operations all return typed `NOT_FOUND_OR_NOT_VISIBLE` for both non-existent and unauthorized private opportunities to prevent existence leakage.
   - Prior to investigation, the target player's view contains basic opportunity terms (seller, asset, asking price, status) while diligence facts remain `null`.
   - After investigation, the view reveals the exact stored due-diligence snapshot.

6. **Optional Zero-Cost Investigation (`investigatePrivateBusinessPurchaseOpportunity`):**
   - Target player may investigate to reveal diligence facts (`investigated: false -> true`). Unauthorized or missing opportunities return non-disclosing `NOT_FOUND_OR_NOT_VISIBLE`.
   - Investigation consumes zero cash, zero RNG, and zero IDs, advancing revision by 1.
   - Repeat attempts reject atomically with `ALREADY_INVESTIGATED`.
   - Investigation is optional: an uninvestigated opportunity may still be pursued directly.

7. **Pursuit via PR #13 Transaction Kernel Delegation (`pursuePrivateBusinessPurchaseOpportunity`):**
   - Pursuit validates opportunity availability and target player identity (`NOT_FOUND_OR_NOT_VISIBLE` on mismatch or missing), then delegates legality and execution directly to `openCashBusinessPurchaseTransaction()`.
   - If the transaction kernel rejects (insufficient cash, active transaction collision, stale ownership, encumbered debt), the rejection is surfaced with `{ code: "TRANSACTION_REJECTED", transactionCode }`, and the opportunity remains `available` with zero state/counter/revision changes.
   - Upon successful transaction opening, opportunity status transitions to `"pursued"` and stores `relatedTransactionId` as a single atomic transition (revision is not incremented a second time).
   - Once pursued, the opportunity cannot be pursued again (one-shot pursuit in this slice).

8. **Historical State Invariants & Settlement Independence:**
   - Completed ownership transfer does not invalidate historical opportunity records; `assertGameState` allows past seller/business references.
   - The presence of available or pursued opportunities does not block quarterly settlement. Active transactions remain the sole settlement-blocking mechanism.

9. **Deferred Scope & OPEN Boundaries:**
   - Random opportunity selection, eligibility pools, focus weighting, spotlight sequencing (G1), paid diligence, multiple diligence tiers, financing offers, auctions, counteroffers, transaction retry policies, and opportunity expiry (A6) remain explicitly deferred.
   - This slice does not resolve OPEN decisions A4, A5, A6, or G1, and does not claim Milestone 4 complete.

## ARCH-028 - Transaction-scoped player-loan financing and recurring repayment

**Status:** Accepted  
**Date:** September 6, 2026

Establish the first executable domain version of Architecture Milestone 4 (one opportunity, investigation, financing offer, reservation, atomic close) in `@interests/engine`:

1. **Transaction-Scoped Player-Loan Financing Model (`CashBusinessPurchaseTransaction`):**
   - Extend the authoritative transaction model to optionally carry a narrow player-loan financing request (`playerLoanFinancing?: PlayerLoanFinancingRequest`).
   - The financing request specifies `requestedPrincipalCents` and tracks at most one firm third-party financing offer (`offer: PlayerLoanFinancingOffer | null`).
   - Exact funding equation: `buyerCashContributionCents + requestedPrincipalCents === purchasePriceCents` (safe checked integer arithmetic). Buyer contribution can be zero (100% financed purchase).

2. **Dual-Reservation Architecture (`CashReservation`):**
   - Extend `CashReservation.purpose` to `"purchase-price" | "player-loan-funding"`.
   - Buyer cash contribution is reserved upon transaction opening (`"purchase-price"`).
   - Lender loan principal is reserved upon offer submission (`"player-loan-funding"`).
   - Neither reservation moves actual cash before close.
   - `getReservedCashCents()` computes the safe sum of all active reservations owned by a player; `getAvailableCashCents()` deducts total reserved cash from actual balance.
   - Cancellation releases both buyer and lender reservations without moving cash, altering ownership, creating loans, or consuming deterministic IDs.

3. **Firm Offer Submission & Exact-Revision Acceptance:**
   - Add domain primitives `submitPlayerLoanFinancingOffer` and `acceptPlayerLoanFinancingOffer`.
   - The lender specifies APR basis points and term (2 to 8 quarters) using the approved PR #6 player-loan constraints and amortization calculator.
   - The lender must be a third-party human player (differing from buyer and seller).
   - Acceptance requires the buyer to explicitly bind to `expectedTermsRevision` (terms revision 1 in this slice). Stale or mismatched terms reject atomically.

4. **Atomic Funded Close Sequence (`closeCashBusinessPurchaseTransaction`):**
   - Financed transactions require an accepted financing offer (`FINANCING_NOT_READY` rejection if offer is absent or unaccepted).
   - Closing executes an all-or-nothing atomic sequence:
     1. Originate loan lender $\to$ buyer for requested principal (`originateConfirmedPlayerLoan`);
     2. Post cash buyer $\to$ seller for full purchase price (`postCash`);
     3. Transfer 100% sole business ownership to buyer;
     4. Clear active transaction and release reservations.
   - Emits exactly two journal entries in canonical order: loan origination (`relatedLoanId`, `relatedTransactionId`), then business purchase (`relatedAssetId`, `relatedTransactionId`).
   - Preflights loan counter and journal counter (2 entries); capacity exhaustion returns typed atomic rejections (`LOAN_ID_EXHAUSTED`, `JOURNAL_ID_EXHAUSTED`).

5. **PlayerLoan `originatedQuarter` & Settlement Timing ($Q_N \to Q_{N+1}$):**
   - Add `originatedQuarter: number` to `PlayerLoan` and validate in state invariants.
   - Scheduled player-loan repayment is integrated into authoritative `settleQuarter()`.
   - A player loan is due in Quarter $Q$ only when `loan.originatedQuarter < Q` and `installmentsPaid < termQuarters`. Loans originated in $Q_1$ have zero repayment in $Q_1$; first repayment occurs in $Q_2$.

6. **Order-Independent Settlement Planning & Solvency:**
   - Player loan repayment forms a dedicated settlement stage after legacy bank loans.
   - Repayments are executed in canonical `LoanId` ascending order.
   - Solvency is evaluated across all borrowers simultaneously against cash available at the start of the player-loan stage.
   - Incoming player-loan payments during the same stage do not fund a borrower's outgoing obligations, ensuring deterministic simultaneous settlement rather than order-dependent funding.
   - If any borrower cannot afford their scheduled installment, the entire quarter settlement rejects atomically under the existing no-default prototype convention.

7. **Milestone 4 Status & Deferred Scope:**
   - This completes the first executable domain version of Architecture Milestone 4 (opportunity discovery $\to$ optional investigation $\to$ financed pursuit $\to$ lender firm offer $\to$ buyer acceptance $\to$ atomic funded close $\to$ recurring quarterly repayment).
   - Competing offers, seller financing, bank financing, equity financing, collateral, defaults, prepayment, refinancing, transaction expiry, negotiation UI, and spotlight sequencing remain deferred.

## ARCH-029 - Local-first LAN runtime and SQLite persistence

**Status:** Accepted (supersedes ARCH-012)  
**Date:** September 8, 2026

Establish the local-first in-person architecture and SQLite persistence model for Standard V1:

1. **Same-Room / Local-LAN Deployment Target:**
   - Standard V1 is primarily designed for four people playing together in the same physical room.
   - The primary deployment model is a single local Node process running on the host machine, hosting Fastify, Socket.IO, the authoritative engine, SQLite, and (later) serving the built React client over the local Wi-Fi / LAN.
   - The server binds to `0.0.0.0` on the configured port (default `3000`) so phones and laptops on the same LAN can connect.
   - Remote internet play and paid cloud hosting are not required for V1.

2. **Single Authoritative Node Process & SQLite Persistence:**
   - SQLite via `better-sqlite3` supersedes PostgreSQL for Milestone 5 and Standard V1.
   - The local runtime characteristics (single Node process, single local database file, single writer process, four human participants, low transaction volume) make SQLite optimal and eliminate external container or database service dependencies.
   - Node's experimental `node:sqlite` API, Prisma, Drizzle, and full ORMs are excluded.

3. **Strict Persistence Boundary Isolation:**
   - `better-sqlite3` and raw SQL statements are strictly encapsulated inside `apps/server/src/persistence/sqlite/`.
   - The deterministic engine knows nothing about SQLite or persistence.
   - Server domain and session logic interact solely with typed persistence operations, not direct database handles.
   - No simultaneous SQLite + PostgreSQL implementation or premature multi-dialect abstraction is built for V1. Future hosted versions may implement the same operation-level repository contracts backed by PostgreSQL without altering engine logic.

4. **Database Pragmas and Hygiene:**
   - Safe operational pragmas are configured upon database opening: `PRAGMA foreign_keys = ON;`, `PRAGMA journal_mode = WAL;`, `PRAGMA busy_timeout = 5000;`, `PRAGMA synchronous = FULL;`.
   - Local database files, WAL files, and test databases (`data/`, `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`) are excluded from version control (`.gitignore`).

5. **Numbered SQL Migration Foundation:**
   - A lightweight custom runner executes numbered SQL migration files (e.g. `001_initial_schema.sql`) in deterministic ascending numeric order.
   - Each migration runs inside an atomic SQLite transaction.
   - Applied migration versions are tracked in a `schema_migrations` table.
   - Failed migrations roll back completely and are not recorded as applied. Already applied migrations are not executed again.

6. **Single Responsive Player View:**
   - One responsive authenticated Player View replaces a dedicated Table View for the first playable version.
   - Phones and laptops have identical capabilities and information permissions (laptop: wider multi-panel layout, phone: tabbed/pane navigation).
   - "Everything" on screen always represents authorized public information plus that player's own private information, never another player's protected secrets.
   - A neutral shared Table View remains a potential future enhancement.

## ARCH-030 - Rotating spotlight orchestration for Standard V1

**Status:** Accepted  
**Date:** September 8, 2026

Establish the software orchestration and turn-entitlement rules for the locked G1 game design (`GAME_DESIGN.md` v0.4):

1. **Authority and Source of Truth:**
   - `GAME_DESIGN.md` owns the gameplay rule and experience intent for G1. ARCH-030 records the corresponding architectural and software consequences.

2. **Quarterly Round Progression:**
   - The quarterly round structure is strictly:
     `ROUND_START -> Spotlight 1 -> Spotlight 2 -> Spotlight 3 -> Spotlight 4 -> ROUND_CLOSE -> SETTLEMENT -> next ROUND_START`.
   - There is no mandatory synchronous planning or ready phase.

3. **Continuous Background Preparation:**
   - Off-spotlight players may continuously perform permitted personal and preparatory actions: reviewing personal accounts/statements, reading public market prices and indicators, inspecting private opportunities, performing permitted diligence/investigation, and drafting future actions.
   - Authorized off-spotlight preparatory actions (such as paid investigation) require explicit authoritative commands and may mutate that player's canonical and private state (e.g. cash balances and private disclosures) when rules allow, but cannot initiate a major transaction, alter shared market state, or advance the spotlight.

4. **Deterministic Rotating Spotlight Policy (`rotating-seat-v1`):**
   - Every player receives exactly one spotlight turn per quarter.
   - The initial spotlight rotates deterministically each quarter based on player collection order:
     For canonical `playerOrder = [A, B, C, D]`:
     - Q1: A -> B -> C -> D
     - Q2: B -> C -> D -> A
     - Q3: C -> D -> A -> B
     - Q4: D -> A -> B -> C
     - Q5: A -> B -> C -> D
   - The data model and state representations remain strictly collection-shaped rather than fixed seat arithmetic or four fixed fields.

5. **Spotlight Initiation & Single-Transaction Concurrency Boundary:**
   - Only the active spotlight player may initiate a new major transaction.
   - Non-spotlight players participate in that transaction when eligible via formal reactions, financing offers, bids, partnership proposals, or consents.
   - At most one unresolved major transaction exists in the game at any moment across all players.
   - Participating in another player's transaction does not consume the reacting player's own quarterly spotlight.

6. **Spotlight Advancement & Settlement:**
   - A spotlight ends when its active major transaction reaches terminal resolution (closes, is cancelled, or expires) or when the spotlight player explicitly passes.
   - Advancing past the spotlight advances immediately to the next spotlight in sequence.
   - After the fourth spotlight finishes, the quarter immediately proceeds to `ROUND_CLOSE` and `SETTLEMENT`. No second major-action window exists after the fourth spotlight.

## ARCH-031 - Accountless lobby identity and recovery credentials

**Status:** Accepted  
**Date:** September 8, 2026

Establish the persistent accountless multiplayer lobby, credential architecture, and seat recovery model for Standard V1:

1. **Public Room Codes:**
   - Six-character uppercase, case-insensitive codes generated from an unambiguous 32-character alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) excluding `I`, `O`, `0`, and `1`.
   - Room codes are public locator information and never authenticate or authorize a player seat.

2. **Four-Seat Lobby Capacity:**
   - Rooms accommodate exactly four human members with deterministic join orders (0 to 3).
   - The creator occupies join order 0 and becomes the initial room host.
   - A fifth join attempt is rejected atomically (`ROOM_FULL`).

3. **Opaque Browser Sessions:**
   - Browser authentication uses high-entropy 32-byte cryptographically secure random bearer tokens (`generateBearerToken`) transmitted via an `HttpOnly`, `SameSite=Strict`, `Path=/` cookie (`finance_game_session`).
   - Sessions are stored only as SHA-256 cryptographic digests in SQLite (`browser_sessions`), with a 30-day lifetime.
   - A single browser session may hold authorized membership grants for multiple rooms (`session_memberships`).

4. **Private Recovery Credentials:**
   - Each room membership receives a separate high-entropy 32-byte recovery code upon creation.
   - Recovery codes are stored only as SHA-256 digests in SQLite (`room_members`). Plaintext recovery codes are returned to the user exactly once upon creation or rotation and are never logged or exposed in room snapshots.

5. **Seat Recovery and Authority Revocation:**
   - Entering the public room code and private recovery code reclaims the caller's existing member seat (`RoomMemberId`, nickname, join order, host status) without creating an additional seat.
   - Successful recovery atomically revokes the previous browser's active session grant for that member and authorizes the recovering browser session.
   - An authenticated member may rotate their recovery code; the previous recovery code is invalidated immediately.

6. **State Boundary & Cryptographic Source of Truth:**
   - Session, room membership, and authorization state belong strictly to the server infrastructure and persistence layer; they are never part of the deterministic engine `GameState`.
   - All security-sensitive randomness (room codes, session tokens, recovery credentials) must use `node:crypto`, never the deterministic engine PRNG or `Math.random`.

7. **Cookie Security Configuration:**
   - In the local-first LAN V1 runtime, cookies default to `Secure = false` via explicit boolean configuration (`INTERESTS_COOKIE_SECURE = false`).
   - Future HTTPS deployments must explicitly configure `INTERESTS_COOKIE_SECURE = true`.

## ARCH-032 - Authenticated controlling sockets and disconnect pause

**Status:** Accepted  
**Date:** September 8, 2026

Establish the authenticated Socket.IO session layer, controlling socket lifecycle, presence tracking, and disconnect pause architecture for Standard V1:

1. **Cookie-Based Socket Authentication:**
   - Socket.IO authenticates exclusively through the existing opaque browser-session cookie (`finance_game_session`).
   - A public room code in handshake authentication selects the target room but never authenticates or authorizes a player seat.
   - The client handshake payload must not transmit `memberId`, `playerId`, session credentials, or recovery codes; actor identity is derived strictly from the validated browser session grant in SQLite.
   - Browser connections validate that Origin authority matches Host authority before connection acceptance; non-browser clients must provide valid Host/Origin headers.

2. **Single Controlling Socket per Seat & Generation Safety:**
   - Each `RoomMember` may have exactly one controlling socket at any time.
   - The newest authenticated connection for a member replaces the prior controller, notifies the previous socket (`session:replaced`), revokes its authority, and disconnects it cleanly.
   - Monotonically increasing process-local connection generations prevent delayed disconnect events from superseded sockets from marking a replacement controller offline.
   - `socket.id` is ephemeral transport metadata, never durable player identity.

3. **Bootstrap and Explicit Synchronization:**
   - Newly connected controllers receive an authorized `session:bootstrap` payload containing room lobby details, member identity, connection generation, presence summary, and active pause reasons.
   - The client must explicitly send `session:synchronized` acknowledging its connection generation before the seat is considered synchronized. Stale or replaced generations cannot synchronize.
   - Presence is runtime and session state managed in-memory by the server connection coordinator; it is never part of deterministic `GameState`.

4. **Presence Arming and Disconnect Pause:**
   - A four-seat room becomes presence-armed (`presenceArmed = true`) only after all four occupied seats simultaneously achieve connected and synchronized status at least once in the session.
   - Prior to presence arming, absent sockets represent waiting lobby members and do not create a pause.
   - After presence arming, the loss or replacement of a synchronized controller (or revocation via HTTP recovery) atomically persists an independent `DISCONNECTED_MEMBER` pause reason in SQLite (`room_pause_reasons`).
   - Reconnecting the disconnected member restores their controlling socket and synchronizes state, but does NOT automatically resume gameplay.

5. **Host-Only Explicit Resume:**
   - Only the controlling socket of the room host may invoke `room:resume`.
   - Resumption is permitted only when all four seats are actively connected and synchronized.
   - Resumption clears only `DISCONNECTED_MEMBER`, leaving other independent pause reasons (`MANUAL`, `SERVER_RESTART`, `SYSTEM_FAULT`) intact.
   - There are no offline player actions, automated bots, gameplay decision timers, automatic passes, or forfeits.

6. **Process Restart and Crash Boundaries:**
   - In-memory presence, generations, and socket references are discarded upon process restart; every member starts offline and unsynchronized.
   - Persisted pause reasons remain stored in SQLite. Automatic `SERVER_RESTART` pause for an active match belongs to the upcoming match/GameState persistence slice, as no match record exists yet.

## ARCH-033 - Durable match snapshots and idempotent command commits

**Status:** Accepted  
**Date:** September 8, 2026

Establish the durable match boundary, GameState persistence, idempotent command processing, and restart recovery architecture for Standard V1:

1. **One Authoritative Match per Room:**
   - Each started room has exactly one persisted match (`UNIQUE(room_id)`).
   - Starting a match transitions the room lifecycle from `OPEN` to `IN_MATCH` atomically. Once `IN_MATCH`, no new members can join, the four `RoomMember` seats remain durable, and seat recovery reclaims the same member seat.
   - Second match start attempts are treated idempotently, returning the existing match view.

2. **Durable RoomMember-to-PlayerId Mapping:**
   - `RoomMember` identity is mapped to engine `PlayerId` (`player-1` .. `player-4`) strictly at match start based on deterministic lobby join order (0 to 3).
   - The mapping is persisted in `match_members` (`PRIMARY KEY(match_id, room_member_id)`, `UNIQUE(match_id, player_id)`, `UNIQUE(match_id, player_order)`) and remains immutable across refresh, credential recovery, and server restart.

3. **Complete Canonical GameState Snapshots & Initialization Manifest:**
   - Authoritative `GameState` is persisted as a complete JSON document (`snapshot_json`), which is the sole source of truth upon restart.
   - The private initialization manifest (`gameId`, `modeId`, `seed`, `orderedPlayerIds`) is persisted separately in `initialization_json` for replay reproducibility. The random seed is generated using CSPRNG (`node:crypto`, 32 bytes base64url) and is strictly server-private.
   - Version metadata (`engine_version`, `rules_version`, `shared_version`, `persistence_format_version`) is stored explicitly in dedicated columns and verified against runtime constants on load.

4. **Snapshot Trust Boundary & Validation:**
   - Persisted JSON is a trust boundary. Snapshots are loaded through an explicit validator that performs structural checks and executes engine `assertGameState`.
   - Corrupt snapshots or incompatible version metadata must never be silently repaired or replaced with new games; they activate `SYSTEM_FAULT`, preserve stored data, and prevent gameplay execution.

5. **Serialized Command Execution & Atomic Commit Pipeline:**
   - Economic commands are serialized strictly per room via an in-memory FIFO queue.
   - Transition pipeline:
     1. Authenticate and verify socket remains current controller with matching connection generation;
     2. Validate command envelope schema;
     3. Compute canonical SHA-256 payload hash over deterministic serialization of `(expectedRevision, command.type, payload)`;
     4. Look up existing receipt by `(match_id, actor_player_id, command_id)`:
        - If matching receipt exists: return original terminal outcome immediately without rerunning engine;
        - If same command ID exists with different payload hash: reject with `COMMAND_ID_REUSED`;
     5. If no receipt exists: load and validate latest snapshot, verify room is not paused, and check `expectedRevision === matches.revision`;
     6. Execute pure engine transition (`applyPlayerCommand`);
     7. Commit atomically in SQLite: verify previous revision, allocate next monotonically increasing command sequence in `match_commands`, insert terminal receipt in `command_receipts`, insert emitted events into `match_events` if any, and update `matches.snapshot_json` and `matches.revision`;
     8. Acknowledge socket only after SQLite commit succeeds;
     9. Broadcast personalized allowlisted match views to current controlling sockets.

6. **Durable Receipts and Rejection Semantics:**
   - Rejected well-formed authenticated commands (due to `ROOM_PAUSED`, `STALE_REVISION`, or engine `GAMEPLAY_REJECTED`) persist durable receipts with outcome `REJECTED` and an error code, without mutating `GameState`, consuming RNG, advancing counters, or adding `match_commands` rows.
   - Malformed or unauthenticated traffic creates no receipts.

7. **Process Restart and Crash Recovery:**
   - Operational presence, connection generations, and queues are discarded on restart; `GameState` is never mutated to reflect transport or pause changes.
   - On server startup, all persisted `ACTIVE` matches are validated. Valid matches receive an automatic `SERVER_RESTART` pause reason in `room_pause_reasons`; invalid matches receive `SYSTEM_FAULT`.
   - Host-only resume after restart requires all four seats to be connected and synchronized, the match to be valid, and `SYSTEM_FAULT` to be absent. Successful resume atomically clears `DISCONNECTED_MEMBER` and `SERVER_RESTART` without altering `GameState`, RNG, counters, or cash.
   - Unresolved active transactions, reservations, and domain state survive crash/restart exactly.

8. **Player Match View Projections:**
   - Sockets and HTTP bootstrap receive allowlisted, player-specific projections (`MatchPlayerView`).
   - Projections contain self profile, offered objectives, and selection status, but only public summaries of other players.
   - Seeds, raw RNG state, deterministic counters, other players' objective offers or selections, cash, and complete snapshots are strictly excluded from network DTOs.
   - In PR #19, `CHOOSE_OBJECTIVE` is the only exposed player command; post-objective major transactions await the G1 rotating spotlight orchestration in Milestone 6.

## ARCH-034 - Executable round-start and rotating spotlight state

**Status:** Accepted  
**Date:** September 8, 2026

Establish the authoritative quarterly round progression, canonical round state, rotating spotlight orchestration, and host-only continuation model for Standard V1:

1. **Canonical Round State Representation (`RoundState`):**
   - Model `round: RoundState | null` at the top level of `GameState` where `RoundState = { stage: "round-start" | "spotlight"; spotlightsCompleted: number }`.
   - During initial objective selection (`phase: "objective-choosing"`), `round === null`.
   - Transition to `phase: "ready-for-first-round"` upon selection of the fourth objective initializes `round = { stage: "round-start", spotlightsCompleted: 0 }`.
   - State invariants in `assertGameState` strictly enforce: `objective-choosing` requires `round === null`; `ready-for-first-round` requires non-null `round`; `round-start` requires `spotlightsCompleted === 0`; `spotlight` requires `spotlightsCompleted < playerOrder.length`.

2. **Derived Deterministic Rotating Spotlight Order (`rotating-seat-v1`):**
   - Spotlight order is computed dynamically via generic modular rotation across `playerOrder.length`: `startIndex = ((currentQuarter - 1) % len + len) % len`.
   - The active spotlight player identity is derived from `spotlightOrder[round.spotlightsCompleted]`.
   - No duplicate or fixed-seat turn fields (such as `player1Spotlight` or `seatA`) are persisted in `GameState`.

3. **Host-Only `BEGIN_ROUND` Authorization Boundary:**
   - Entering the quarter's active spotlights from `ROUND_START` requires an explicit, durable `BEGIN_ROUND` player command.
   - Authorization is host-only and enforced strictly by the session/server layer (`NOT_ROOM_HOST` rejected receipt).
   - Host identity remains purely server-side infrastructure metadata and is never stored in deterministic `GameState`.
   - `BEGIN_ROUND` consumes zero gameplay RNG, advances no counters, changes no cash or financial balances, and settles nothing; it merely advances `round.stage` to `"spotlight"` with `spotlightsCompleted = 0` and increments revision by 1.
   - There is no four-player readiness gate and no automatic transport-driven progression.

4. **Server-Bound Player Identity & Strict Schemas:**
   - Both `BEGIN_ROUND` and `PASS_SPOTLIGHT` payloads contain no `playerId`, `isHost`, or room credentials.
   - Actor identity is derived strictly from the authenticated controlling socket and persistent `RoomMember`-to-`PlayerId` mapping.
   - Zod schemas remain strict; client payloads containing unauthorized or extraneous fields reject as malformed (`INVALID_INPUT`).

5. **Spotlight Completion & Atomic Final Settlement:**
   - Passing spotlights 1 through $N-1$ advances `spotlightsCompleted` by 1 and increments revision by 1 without consuming RNG or counters.
   - Passing the $N$-th (final) spotlight executes authoritative `settleQuarter()` atomically within that single accepted command:
     - Settle Quarter $N$ cash flows, revalue market holdings, update regime, and roll quarter-start basis to Quarter $N+1$;
     - Reset round state to next quarter `ROUND_START` (`round = { stage: "round-start", spotlightsCompleted: 0 }`);
     - Advance revision by exactly 1 total (`resultingRevision === previousRevision + 1`);
     - Persist emitted settlement journal entries atomically in SQLite `match_events` (`event_kind: "journal-entry"`).
   - Rejections during final settlement (e.g. `INSUFFICIENT_FUNDS`) reject the command atomically, leaving state, revision, counters, RNG, and quarter completely unchanged.

6. **Transaction Initiation Spotlight Authority:**
   - Opening cash or financed business purchase transactions requires `round.stage === "spotlight"` and requires the buyer to be the active spotlight player (`getActiveSpotlightPlayerId(state) === buyerPlayerId`).
   - Non-active players or opening attempts during `round-start` are rejected atomically with `NOT_ACTIVE_SPOTLIGHT` or `WRONG_ROUND_STAGE`.
   - Active transactions block `PASS_SPOTLIGHT` with `ACTIVE_TRANSACTION`.

7. **Durability and Restart Recovery:**
   - Canonical `round` state survives JSON serialization, SQLite persistence, and process restart exactly.
   - Server restart during an active spotlight or at `round-start` preserves exact quarter, stage, spotlight count, and RNG. Host resume clears operational pauses without altering `GameState`.


