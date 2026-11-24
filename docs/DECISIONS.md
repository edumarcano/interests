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
   - Browser authentication uses high-entropy 32-byte cryptographically secure random bearer tokens (`generateBearerToken`) transmitted via an `HttpOnly`, `SameSite=Strict`, `Path=/` cookie (`interests_session`).
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
   - Socket.IO authenticates exclusively through the existing opaque browser-session cookie (`interests_session`).
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

6. **Terminal Transaction Resolution Composition Boundary:**
   - Terminal transaction resolution (close or cancel) and immediate spotlight completion compose as one authoritative accepted player-command transition (`resultingRevision === previousRevision + 1`):
     - Intermediate spotlight terminal resolution applies transaction effects, clears the active transaction, advances `spotlightsCompleted`, and advances revision by exactly 1 total.
     - Final spotlight terminal resolution composes transaction effects, transaction journal entries, and quarterly settlement atomically within a single command transition and exactly 1 revision increment total.
     - Emitted journal events strictly preserve deterministic ordering: transaction closing journal entries precede end-of-quarter settlement journal entries.
     - Atomic rollback: if either the terminal transaction fails or composed end-of-quarter settlement fails, the entire transition rejects atomically, preserving the original state, active transaction, and revision with zero journal entries emitted.
   - Low-level domain operations (`applyCloseCashBusinessPurchaseTransaction`, `applyCancelActiveTransaction`, and `applyQuarterSettlement`) provide un-revisioned state transformations so that orchestration wrappers (`resolveTerminalTransactionAndAdvanceSpotlight`) can compose operations before committing the single final public command revision.
   - `settleQuarter()` is an internal/trusted finance primitive for tests, migrations, and simulations; normal gameplay quarter settlement is exclusively controlled by the round orchestration loop upon final spotlight completion.

7. **Transaction Initiation Spotlight Authority:**
   - Opening cash or financed business purchase transactions requires `round.stage === "spotlight"` and requires the buyer to be the active spotlight player (`getActiveSpotlightPlayerId(state) === buyerPlayerId`).
   - Non-active players or opening attempts during `round-start` are rejected atomically with `NOT_ACTIVE_SPOTLIGHT` or `WRONG_ROUND_STAGE`.
   - Active transactions block `PASS_SPOTLIGHT` with `ACTIVE_TRANSACTION`.

8. **Durability and Restart Recovery:**
   - Canonical `round` state survives JSON serialization, SQLite persistence, and process restart exactly.
   - Server restart during an active spotlight or at `round-start` preserves exact quarter, stage, spotlight count, and RNG. Host resume clears operational pauses without altering `GameState`.

## ARCH-035 - Responsive browser player view and session cookie standardization

**Status:** Accepted  
**Date:** September 8, 2026

Establish the responsive web browser player application, wire contract boundaries, and session cookie standardization for Standard V1:

1. **Browser Application Architecture (`apps/web`):**
   - Built with React 19, TypeScript, Vite, and custom responsive CSS. No heavyweight state libraries (Redux, Zustand) or CSS utility frameworks (Tailwind) are used.
   - Strictly depends on `@interests/shared`, `react`, `react-dom`, and `socket.io-client`. Never directly imports `@interests/engine`, `@interests/rules`, or `@interests/server`.
   - Single responsive player view serves mobile phones, tablets, and desktop browsers with 44px+ touch targets and fluid card-based layouts.

2. **Session Cookie Standardization (`interests_session`):**
   - The session cookie name is standardized repository-wide as `interests_session` (formerly prototype `finance_game_session`).
   - Defined as a constant `SESSION_COOKIE_NAME = "interests_session"` in `@interests/shared/src/transportProtocol.ts`.
   - Replaces all legacy names across server HTTP routes, Socket.IO handshake auth, and test fixtures without backwards-compatibility fallbacks.

3. **Same-Origin Vite Proxy Semantics & LAN Reachability:**
   - The local Vite development server configures proxies for `/api` and `/socket.io` with `changeOrigin: false` and `ws: true`.
   - Binds to `host: "0.0.0.0"` in `vite.config.ts` so phones and other devices on home Wi-Fi/LAN can reach `http://<LAN-IP>:5173`.
   - Preserves browser Host and Origin headers so Fastify's `validateSameOrigin` security hook verifies matching origin without modifying server security boundaries.

4. **Shared Wire Contracts & Shared Version Bump:**
   - Move client-facing wire types, constants, socket event mappings (`SOCKET_CLIENT_EVENTS`, `SOCKET_SERVER_EVENTS`), and error codes (`SOCKET_ERROR_CODES`) into `@interests/shared/src/transportProtocol.ts`.
   - Bump `SHARED_VERSION` to `0.0.3`.

5. **Server Presentation Metadata Projection:**
   - Enrich recipient's private `MatchSelfView` in `buildMatchPlayerView` with profile presentation (`name`, `startingCashCents`) and offered/selected objectives (`name`, `family`) using `@interests/rules` definitions.
   - Strictly preserves player privacy: other players appear only as public summaries (`hasSelectedObjective: boolean`) without leaking profiles, offered objectives, or selected objective cards.

6. **Client State Machine & Lifecycle Flows:**
   - `EntryScreen`: Create Room, Join Room, Recover Seat with immediate private recovery code modal presentation.
   - `LobbyView`: 4-seat lobby layout showing join order (mapping durable `joinOrder: 0..3` to display seats 1..4), host crown, connection status, synchronization status, rotate recovery code action, and host-only "Start Game" button enabled only when 4 members are connected and synchronized. Immediate optimistic transition using returned personalized match view from `POST /start` response while continuing to receive socket replacements.
   - `ObjectiveSelection`: Card deck presentation of profile and 2 secret objectives with durable `CHOOSE_OBJECTIVE` submission, routed when `match.phase === "objective-choosing" || match.round === null`.
   - `RoundStartView`: Quarter overview, rotating spotlight order, and host-only `BEGIN_ROUND` control, routed when `match.round?.stage === "round-start"`.
   - `SpotlightView`: Active player highlight, completed spotlight counter, and active-player-only "Pass Spotlight" action advancing through Quarter 2 round-start upon 4 passes, routed when `match.round?.stage === "spotlight"`.
   - `PauseBanner`: Formatted pause reasons with host resume button enabled only when all 4 seats are connected AND synchronized (`presence.allConnected && presence.allSynchronized`) and blocked when `SYSTEM_FAULT` is present.
   - `ReplacedScreen`: Clean disconnect screen when superseded by another tab or recovered by a new session.

7. **Socket Synchronization Lifecycle & Controller Arming:**
   - Explicit three-state connection progression: `connecting` -> `synchronizing` -> `synchronized`.
   - On `session:bootstrap`, status enters `synchronizing`. The transition to `synchronized` occurs only after the server acknowledges `session:synchronized` with `{ ok: true }`.
   - Synchronization failure immediately disconnects the socket and surfaces the error, preventing misleading "connected" indicators for un-synchronized controllers.

8. **Command Envelope Preservation & Idempotent Retry:**
   - `RealtimeManager` and client action boundaries preserve the exact `(commandId, expectedRevision, command)` envelope across uncertain delivery or timeouts.
   - Submitting the same logical action after a timeout reuses the existing envelope rather than generating new identifiers.
   - Terminal acknowledgements (both accepted and rejected) matching the pending envelope clear pending command tracking; late acknowledgements for prior commands cannot clear newer pending envelopes. Advancing match revisions also clears pending commands.
   - Cryptographically strong UUIDv4 generation uses RFC4122 byte formatting via `crypto.getRandomValues()`, ensuring compatibility with plain-HTTP LAN access where `crypto.randomUUID()` is restricted by browsers.

## ARCH-036 - First playable business opportunity and player-financing command loop

**Status:** Accepted  
**Date:** September 9, 2026

Establish the first playable financial-strategy loop (Milestone 6) across the engine, server, and responsive web browser interface:

1. **Deterministic Q1 Vertical-Slice Opportunity Fixture:**
   - Add exactly one debt-free private business asset and one private business-purchase opportunity during deterministic game initialization (`createdQuarter: 1`).
   - This is explicitly a narrow Milestone-6 vertical slice playability fixture, not the permanent weighted opportunity generator.
   - Fixed facts: annual revenue `8_000_000` cents, annual operating profit `1_500_000` cents, enterprise value `6_000_000` cents, debt principal `0` cents, asking price `5_000_000` cents, seller ownership `1_000_000` ppm (100%).
   - Role selection is deterministic without consuming RNG:
     - Target buyer: player with highest initial cash strictly less than `5_000_000` cents, tie-broken by canonical `playerOrder`.
     - Seller: next player in canonical `playerOrder` after buyer, wrapping cyclically.
     - Lender: not preselected; any eligible non-buyer/non-seller player may offer financing.
     - Feasibility resolution: Across all 69 feasible profile combinations in `@interests/rules` and across all 24 seat permutations per combination (1,656 total setups), the buyer is guaranteed to have `buyerCash < 5_000_000` (cannot buy with cash alone) and `buyerCash >= 2_000_000`. In 1,536 setups (64 combinations * 24 permutations, 92.8%), buyer cash is >= `3_000_000` cents, supporting the canonical manual demonstration fixture ($30k contribution / $20k loan). In the remaining 120 setups (5 combinations * 24 permutations, 7.2%), buyer cash is $25k or $28k. Across all 1,656 setups, the seller is deterministically the next seat in player order, and at least one eligible third-party lender has enough cash to fund the full financing gap (`5_000_000 - buyerCash`).
   - Leaves initial `GameState.revision === 0` and consumes zero gameplay RNG draws.

2. **Diligence and Privacy Boundaries:**
   - Due diligence facts are pregenerated once upon initialization and revealed only when the target buyer executes `INVESTIGATE_OPPORTUNITY`.
   - Investigation consumes no RNG, advances no counters, and costs zero cash. It advances revision by exactly +1 on success.
   - The target buyer may conduct background diligence at `ROUND_START` or while another player holds the spotlight.
   - Non-target players never receive or see the private opportunity in bootstrap views or socket updates.
   - Other players' exact cash, reserved cash, and available cash remain hidden from public views.

3. **Spotlight Authority and Transaction Lifecycle:**
   - Only the active spotlight buyer may initiate transaction pursuit (`PURSUE_BUSINESS_CASH` or `PURSUE_BUSINESS_WITH_PLAYER_LOAN`). Non-active players or wrong stage attempts are rejected with `NOT_ACTIVE_SPOTLIGHT` or `WRONG_ROUND_STAGE`.
   - Off-spotlight eligible third-party players may participate by submitting a loan financing offer (`SUBMIT_PLAYER_LOAN_OFFER`) without consuming or holding the spotlight.
   - Single firm offer per transaction: a second offer is rejected with `OFFER_ALREADY_EXISTS`.
   - The buyer accepts exact terms revision via `ACCEPT_PLAYER_LOAN_OFFER`; stale terms revision is rejected with `STALE_TERMS_REVISION`.
   - Cash reservations prevent over-committing available funds but do not move cash until close.

4. **Terminal Composition Boundary & Exactly One Revision:**
   - Terminal close (`CLOSE_BUSINESS_PURCHASE`) or cancel (`CANCEL_ACTIVE_TRANSACTION`) automatically advances the active spotlight without requiring a separate "Pass Spotlight" action.
   - Intermediate spotlight close/cancel increments GameState revision by exactly 1 total.
   - Final spotlight close/cancel composes terminal transaction resolution + quarterly settlement into a single atomic transition that advances revision by exactly 1 total and rolls into Quarter 2 `ROUND_START`.
   - Emitted transaction journal entries strictly precede quarterly settlement journal entries.
   - If quarterly settlement fails during final close, the entire transition rolls back atomically to the pre-close state with zero journal entries.
   - A player loan originated in Quarter 1 does not receive repayment in the same Quarter 1 final settlement; scheduled repayments begin in Quarter 2.

5. **Server Pipeline & Actor Security:**
   - Actor identity is strictly derived from the controlling session/socket member mapping.
   - Strict Zod schemas reject any injected actor/authority fields (`playerId`, `buyerPlayerId`, `lenderPlayerId`, `isHost`, etc.).
   - Commands are durable, idempotent, and serialized through the room's single-writer queue. Retrying the same commandId with the same payload returns the original receipt; modifying the payload returns `COMMAND_ID_REUSED`.
   - Paused rooms reject transaction commands with `ROOM_PAUSED`.
   - Active transactions, offers, acceptances, and diligence facts survive server restarts exactly.

6. **Web Client Architecture & Versioning:**
   - The responsive browser interface provides `OpportunityCard`, `TransactionPanel`, and `SelfFinanceSummary` within the single-column mobile-friendly view.
   - No client-side game engine: the browser renders authoritative state views and dispatches commands.
   - Engine version bumped to `0.0.3`, Shared version bumped to `0.0.4`. Rules and persistence format versions remain unchanged.

## ARCH-037 - Local single-origin runtime, LAN join discovery, and four-client E2E validation

**Status:** Accepted  
**Date:** September 10, 2026

Establish the Milestone-6 hardening architecture for physical local/LAN multi-device play and browser end-to-end reliability:

1. **Unified Single-Origin Fastify Static Delivery:**
   - The Fastify server serves production static assets (`apps/web/dist`) via `@fastify/static` with an SPA HTML fallback handler when configured or when `apps/web/dist` exists.
   - Eliminates Vite proxy ports, separate client servers, and CORS complexity during local LAN play.
   - Preserves dedicated API and Socket.IO paths (`/api/*`, `/socket.io/*`) without shadowing.
   - Server remains fully functional in headless/test configurations where static delivery is disabled.

2. **Public LAN Runtime-Info Boundary & Default-Route Origin Selection:**
   - A lightweight `GET /api/runtime-info` endpoint reports host LAN candidate origins (`lanOrigins`) discovered via network interfaces and routing inspection.
   - *Amended September 11, 2026 (PR25):* Supersedes the static RFC1918 range preference (`192.168` > `10` > `172`). Interests now inspects the host operating system's routing table (`route print 0.0.0.0` on Windows, `/proc/net/route` / `ip route` on Linux, `route -n get default` / `netstat -rn` on macOS) to identify the IPv4 address associated with the active default route / default gateway.
   - When the active default-route IPv4 is a valid external candidate, it is selected as the primary origin (`lanOrigins[0]`), ensuring the lobby QR code and share URL encode the actual outbound network interface (e.g. physical Wi-Fi) rather than an unreachable virtual adapter (e.g. VirtualBox `192.168.56.1`).
   - Discovered alternate candidates remain available in deterministic fallback order.
   - If default-route discovery is unavailable, fails, throws, or does not correspond to a candidate, discovery falls back gracefully to deterministic candidate ordering without throwing or failing server startup.
   - Excludes loopback (`127.0.0.1`, `localhost`), IPv6, and internal interfaces.
   - Returns public locator information only; never leaks session tokens, recovery credentials, member IDs, seeds, or private routing details.
   - If no external interfaces are detected, returns an empty array allowing clients to fall back safely to `window.location.origin`.

3. **Public Deep-Link and QR Privacy Rule:**
   - Room codes are public locators, not authentication credentials.
   - The lobby displays a copyable join link (`/?room=<ROOM_CODE>`) and renders an SVG QR code using `qrcode.react`.
   - Scanning the QR code or following the link opens the Join Room tab with the room code pre-filled, prompting the user to choose their nickname.
   - It does not auto-join a seat or bypass player consent.
   - Recovery credentials and session cookies are strictly excluded from URLs, QR codes, and web storage.
   - Shared version bumped to `0.0.5` for the `RuntimeInfoResponse` protocol type.

4. **Playwright Multi-Context E2E Foundation:**
   - Automated end-to-end tests use Playwright with four distinct `BrowserContext` instances to enforce real multi-user session boundaries (independent cookies and socket connections).
   - Viewport configuration exercises realistic mixed clients: desktop host (1280x800), mobile clients (390x844), and narrow phone layout (320x568) with no horizontal overflow.
   - Automated coverage tests:
     - Full 4-player vertical slice: room creation, joining, objective selection, diligence discovery, player loan financing, transaction closing, and transition into Quarter 2.
     - Disconnect & pause: player disconnect causes `DISCONNECTED_MEMBER` pause; reconnect does not auto-resume; host legally resumes.
     - Recovery takeover: fresh browser context reclaims seat using recovery code; revokes previous controller.
     - Server restart: process restart during active transaction restores exact state from SQLite and permits clean resumption and closing.

5. **Restartable Process Test Harness:**
   - `apps/web/e2e/support/serverHarness.ts` provides real process lifecycle management (`tsx src/main.ts`) using isolated temporary SQLite databases and dynamic port assignment.
   - Supports clean process termination (`SIGTERM` with `SIGKILL` timeout fallback) and process restart against the identical SQLite database file.
   - Disables HTTP rate limiting for E2E speed via `INTERESTS_RATE_LIMIT_DISABLED=true`.

6. **Local Play Launcher (`pnpm play`):**
   - Root script `scripts/play.ts` and Windows convenience script `scripts/play-interests.cmd` launch the single-origin server on `0.0.0.0:3000`.
   - Automatically builds `apps/web/dist` if missing.
   - Logs local and LAN access URLs and handles clean `SIGINT`/`SIGTERM` process shutdown.
   - No Electron, Tauri, or native installer packaging in Milestone 6.

## ARCH-038 - M7 business cash and mandatory arrears policies

**Status:** Accepted
**Date:** November 16, 2026

Adopt the prototype policies in GAME_DESIGN sections 16.3.1-16.3.2 and 17.4.2. This decision supersedes ARCH-021/023/028/034/036 only where they reject an otherwise valid mandatory settlement for insufficient cash or exclude all future business cash flows. It does not weaken discretionary closing affordability, rejection atomicity, or the once-only quarter/revision boundary.

1. **Rules and scope:** Immutable `mandatory-arrears-v1`, `legacy-owner-income-v1`, and `retained-profit-v1` policy data live in `@interests/rules`. The first PR records policy without activating new engine behavior. Later functional PRs bump engine/rules/shared/persistence versions as appropriate; incompatible saved matches remain intact and require their compatible build, not silent conversion.
2. **Mandatory payments:** Pay current living costs, living arrears, then equal-priority proportional due bank/mortgage/player-loan claims. Freeze simultaneous budgets excluding same-quarter incoming loan repayments. Record unpaid interest separately and overdue principal as part of outstanding principal. Calendar due periods continue through a miss; player-loan maturity makes remaining principal due. Ordinary interest uses actual principal, never unpaid interest. Preserve exact on-time loan arithmetic.
3. **Business cash:** First operating settlement is Q2. Quarter-start ownership receives the distribution, with 20% retained after required company payments. Positive cash, losses, reserves, and operating payables have canonical accounted homes. A supported whole-business transfer preserves company cash and rejects unhandled payables/debt. No automatic owner guarantee, cash call, or reserve-driven growth is introduced.
4. **Canonical outcomes and persistence:** Actual nonzero transfers create journals. Due/paid/unpaid outcomes also cover zero-payment cases. Keep bounded current summaries in engine state and historical outcomes alongside journal events in the existing atomic SQLite commit. Full histories remain private; projections allow only the affected player's/party's detail.
5. **Starting-owner transition:** Starting businesses temporarily retain existing bundled owner income and balance-sheet-only debt without extra dividends/reserves. The permanent model separates work pay from ownership returns. Use 8% fixed APR / 28 quarters for opening company-loan calibration, not all lending. Old income/value figures may change. Review integrated viable fixtures before activation; no employee simulation or automatic growth effects.
6. **Delivery boundary:** Implement policies, mandatory shortfalls, and productive debt-free businesses as the first three-PR stack. Unified starting-company fixtures/debt follow separately. Collateral, bankruptcy, write-offs, broader ownership contracts, growth actions, and victory measurement remain outside this stack. All actual game mutations remain engine-owned; the browser displays authoritative amounts.


## ARCH-039 - Unified starting-company compensation and debt

**Status:** Accepted
**Date:** November 16, 2026

The user approved the integrated fixture checkpoint and implementation of the remaining M7 financial plan. This supersedes ARCH-038's temporary owner-income treatment and Q2-only company commencement for the three starting companies. It does not change the acquired Q1 fixture's Q2 commencement or next-quarter player-loan payments.

1. **Fixtures:** Use GAME_DESIGN 16.3.2's approved after-labor profits, owner compensation, reserves, values and opening company debt. Employment-only recurring income for these three profiles is zero. Personal opening cash, living costs, personal debt and public holdings remain unchanged.
2. **Canonical ownership:** Company loans have an asset borrower and one registry record, with no asset principal mirror. Work contracts identify the working player, fixed annual compensation and unpaid compensation claim. Company cash, external operating payables, work payables, principal and unpaid interest enter equity once.
3. **Timing:** Starting companies operate in Q1. Their existing opening loans pay from Q1 through Q28 at fixed 8% nominal APR / 4, HALF_UP annuity arithmetic and final-cent cleanup. Calendar maturity does not move after missed payments; ordinary principal interest continues without capitalization. Player loans remain limited to 2-8 quarters.
4. **Payment sequence:** Net current non-owner operations, current fixed owner work pay, proportional older operating/work claims, proportional due company-loan claims, then 80% distribution / 20% retention of remaining current operating surplus. Company reserves may fund obligations but are not automatically distributed. Unpaid compensation remains payable to the worker; no personal guarantee, automatic cash injection or discretionary salary extraction is introduced.
5. **Contracts and privacy:** Keep worker outcomes and company-finance views recipient-specific. Starting work-dependent companies remain outside the simple transfer contract, including after debt payoff; labor exit and contract reassignment require separate rules. Existing managed debt-free fixture transfers remain supported.
6. **Evidence:** The checkpoint reconciled three 28-quarter schedules and deterministic fixed-cost revenue sensitivities. These are accounting calibration evidence, not proof of balanced strategies or enjoyment. Production, persistence, privacy and browser evidence must accompany each functional PR. Incompatible saved matches remain intact and require a compatible build.

## ARCH-040 - Standard V1 M7 completion policies and delivery

**Status:** Accepted; functional activation pending
**Date:** November 16, 2026

The user approved the M7 completion plan and its gameplay decisions. GAME_DESIGN sections 6-7 and 14-19 own numerical policies. This record supersedes unresolved-policy descriptions in ARCHITECTURE section 22 and earlier decisions only for the approved completion scope. The first packet records policy and immutable rule data without changing active engine behavior or compatibility identifiers.

| Boundary | Accepted implementation direction |
| --- | --- |
| Accounting | Extend quarter-start property/employment/work entitlements, acquisition basis and bounded four-quarter measurements before exposing transfers. Earned payments must survive ownership changes without duplication. |
| Finance | Add new asset-borrower mortgages and fixed business bank loans, underwriting, reserves and performing/no-cash-out refinancing. Preserve opening legacy schedules until actual payoff. No automatic personal guarantees. |
| Contracts | Distinguish issuance from secondary sales. Confirm every contributor and required owner consent against one terms revision; invalidate stale acceptance and release cancelled reservations. Reuse the single active transaction boundary. |
| Operations/content | Use versioned macro/performance/growth data; recurring objective-neutral opportunities and non-player alternatives. Isolate the provisional Q1 giveaway as a named diagnostic fixture. |
| Objectives | Engine-owned measurements, private requirements/progress, all eight finale routes and post-close checks. Only the spotlight initiator may win through an explicitly pursued finale. |
| Termination | Valid finale victory is immediate after closing effects and before spotlight advancement, including the fourth spotlight. Otherwise settle Q32 once, update histories, record a draw and generate no Q33 content or RNG. |
| Persistence/privacy | Atomically persist terminal result, FINISHED operational status, command receipt and journals. Terminal matches stay authenticated/viewable, reject gameplay and avoid active-match pause/recovery controls. Extend recipient-specific projections with paired-state privacy tests. |
| Compatibility | Functional packets bump changed engine/rules/protocol/persistence identifiers. Preserve old snapshots for their compatible builds; no silent conversion or replay reinterpretation. |
| Delivery | Nine bounded packets tracked in DEVELOPMENT.md; stabilize shared contracts before parallel feature work. Run Remora implementation/checkpoint and split-axis review for each PR. Deliver PRs without automatic merging. |

Persistent claims/cash cure remain the V1 default model. Overdue borrowers cannot take new credit or complete finales. Whole-asset sale/refinance clears bank liens; foreclosure, bankruptcy, write-offs and secured player loans are deferred. This does not erase any canonical claim.

M7 completion requires ordinary production-command routes for all eight objectives, a real four-client match to a valid winner, terminal restart proof and a Q32 draw journey. Synthetic eligibility fixtures alone are insufficient. Strategy policies, empirical balance/variant fairness, numerical tuning from findings and human playtest campaigns remain M8; policy approval establishes none of those results.

## ARCH-041 - M7 entitlement and measurement foundations

**Status:** Accepted
**Date:** November 16, 2026

Implement packet 2 of ARCH-040 before exposing new transaction families. Canonical state adds `progress.byPlayer` and `result`; current gameplay still has no victory/draw producer.

| Contract | Implementation |
| --- | --- |
| Earned entitlement | Snapshot property operating inputs/ownership and recurring income/living costs alongside existing business, fund and cash bases. Settlement consumes the opening snapshots, then captures the next quarter. |
| Measurements | Retain four actual settlement observations per player, including living costs owed, debt service owed/paid, labor receipts, source-grouped recurring receipts and company operating profit. Missing quarters stay absent. |
| Financing income | Preserve cumulative interest actually received separately from recurring current-period interest. Returned principal never becomes income; collecting old interest remains a receipt without becoming fresh recurring income. |
| Asset basis | Initialize opening reference costs; update buyer/seller evidence atomically with existing business closes. Retain actual disposal cost/proceeds/reference/counterparty/category facts for later objective safeguards. Borrowing creates no disposal gain. |
| Snapshot integrity | Require matching basis for every current ownership stake and reject nonowner records. Fail closed on missing progress/results or incompatible versions; never invent history during load. |
| Views | Expose only the recipient's funds, property, labor/focus, entitled/current recurring amounts and offered objective thresholds. Public result DTOs contain no hidden objective. |
| Lifecycle | Model objective-victory/safety-draw results, validate terminal shapes, and reject gameplay commands on a finished state. Actual finale execution, Q32 termination and FINISHED operational persistence follow in packet 8. |

Compatibility identifiers become engine `0.0.7`, rules `0.0.5`, shared `0.0.9`, persistence `0.0.6`. Existing snapshots need their compatible build. Synthetic accounting fixtures explicitly stage opening metadata; they are not evidence of ordinary objective reachability. No bank/NPC origination, market/career command or recurring content generator is activated by this packet.

## ARCH-042 - Atomic public-market baskets and private quotes

**Status:** Accepted
**Date:** November 17, 2026

Packet 3 executes public-market trading using the existing value-balance representation. No shares, unit prices, tax lots or asset entities are introduced.

| Boundary | Implementation |
| --- | --- |
| Command | `TRADE_PUBLIC_MARKETS` accepts one to three distinct instrument legs, each a positive safe-integer buy or sell amount. Execution requires the actor's spotlight and no active transaction. Sales fund purchases within the same atomic basket. |
| Fees and basis | Charge 25 BPS of each leg's gross value with Decimal HALF_UP rounding. Add buy fees to weighted basis; remove proportional basis on a partial sale, all remaining basis on full disposal. Signed realized gain is gross proceeds less sale fee and removed basis. |
| Evidence | Keep instrument, sale quarter, gross proceeds, fee, removed basis, realized gain/loss and opening exposure value in private canonical disposal records. Raw realization does not itself award objective progress; packet 8 applies seasoning and other measurement safeguards. Sale principal never becomes recurring income. |
| Journals and rounds | Post gross sales then sale fees, followed by purchases and buy fees, in canonical instrument order within each group. Preview checks intermediate cash overflow as well as net affordability. Compose the basket with existing spotlight advancement; final settlement failure rejects every trade effect, RNG/counter change and journal. |
| Quote privacy | An authenticated, origin-checked read-only POST returns only the recipient's basket fees, resulting values/basis and cash impact at the current revision. Off-turn planning respects cash reservations. Execution independently revalidates and uses ordinary command receipts. |
| Entitlements | Preserve opening cash/fund dividend snapshots during trades. Quarterly price movements use closing holdings; the next quarter snapshots those resulting holdings. |
| Browser | Parse dollar input into cents, request authoritative financial previews, and invalidate confirmation after draft or revision changes. Show holdings, basis, yields, per-leg fees and total cash impact. On timeout, reuse the original command ID for the same canonical command so the server can replay the existing receipt. |

Compatibility identifiers become engine `0.0.8`, rules `0.0.6`, shared `0.0.10`, persistence `0.0.7`. Existing snapshots remain associated with their compatible build; no conversion occurs.

## ARCH-043 - Persistent career choices and labor replacement

**Status:** Accepted
**Date:** November 17, 2026

Packet 4 implements the approved career/labor scope of ARCH-040. Authored career templates live in rules; current pay and affordability determine access, without profile powers or hidden-objective weighting. Persistent offers coexist with the later quarterly opportunity generator.

| Contract | Implementation |
| --- | --- |
| Stable quotes | Inspection derives quotes from current quarter and actual labor compensation without consuming RNG, counters or revisions. An ID-only acceptance resolves the current authoritative quote; stale or unaffordable choices reject unchanged. |
| Choices | An 8% raise has no transition cash cost; a 20% raise costs $5,000; a 35% executive jump requires current annual labor capacity of $120,000 and a $100,000 ownership investment plus the 2% ($2,000) business purchase fee. Reentry offers $60,000 annual employment. Every acceptance consumes the quarter's spotlight, with costs and tradeoffs visible before acceptance. These are prototype authored templates within the approved compensation bands, not balance findings. |
| One labor role | New employment replaces existing employment or owner work. Resignation removes future salary; owner exit hires equal-cost management. Workers may leave without an ownership veto; this does not authorize a sale or dilution. |
| Earned rights | Preserve quarter-start employment/work entitlements. Changes affect next quarter; the fourth spotlight composes the action with settlement atomically and increments revision once. Settlement failure returns the original state and empty journal. |
| Necessary management | Starting-company profit remains after necessary labor. Keep the former worker record with future compensation zero and unpaid claims intact; record an equal annual management cost in the asset and subsequent opening basis. Settlement adds back necessary labor to gross operating receipts and pays management externally once. Unpaid management joins operating payables. Ownership, value, after-labor profit, company cash and debt do not change at conversion. |
| Executive investment | Fund an external seller through a secondary purchase of a debt-free managed company with $100,000 enterprise/equity value, zero company cash, $100,000 annual revenue and $20,000 annual after-labor operating profit. Debit $102,000 total: $100,000 consideration to the external seller and a separate $2,000 purchase-fee journal to the market sink. Capitalize both in $102,000 acquisition basis without increasing company cash or enterprise value. Record acquisition quarter; no same-quarter investment earnings. The current executive labor record references the ownership position for later finale evaluation; accepting the ordinary offer does not win. |
| Snapshot invariants | Require the single labor role to match active positive work compensation, with zero current salary outside employment. Opening and current necessary-labor costs must reconcile across conversion. Retired worker claims remain payable; initialization/explicit synthetic fixtures identify only positive compensation as active work. Existing starting-company transfer restrictions remain. |
| Private requirements | Rules own versioned objective instructions, numerical targets and shared measurement definitions. Only the recipient's offered objectives receive those instructions; the browser displays the selected requirements, own current/earned income, fund values/basis, property details, company finances, claims and labor choices. Eligibility calculation and finales remain packet 8. |

Compatibility identifiers become engine `0.0.9`, rules `0.0.7`, shared `0.0.11`, persistence `0.0.8`. Preserve old snapshots for their compatible builds; no migration or reinterpretation is supplied. This packet does not activate recurring opportunity generation, objective wins, bank underwriting or general ownership changes.
## ARCH-044 - M7 bank and property transactions

**Status:** Accepted implementation of ARCH-040 policies

**Date:** November 17, 2026

| Contract | Implementation |
| --- | --- |
| Canonical debt | `asset-bank-loan` owns the asset borrower, lead buyer, APR/pricing, original maturity, payment basis and claims. Fixed property mortgages use 120 quarters. Variable resets round the annuity over the original remaining term, with a minimum payment of rounded interest plus one cent. Servicing caps principal at the outstanding balance and collects any remainder at the original maturity. Arrears remain separate. The lead's credit sets pricing without a personal guarantee. Opening legacy mortgages remain personal until payoff/refinancing. |
| Underwriting | Current unreserved cash plus 80% of public funds determines qualifying liquidity. Employment counts fully; each other positive recurring source counts at 50%, each negative flow fully. Personal obligations determine grade and retained personal cash. Include the first scheduled installment on a personal loan originated this quarter. Property LTV/DSCR and fixed business underwriting use completion rule tables. Business origination/actions remain packet 6. |
| Entity cash | New mortgages and refinanced properties use a property cash account. Earned NOI pays canonical asset debt before proportional distributions; one quarter of new debt service stays in asset cash. A cash shortfall creates ordinary loan claims and suppresses distributions; owners may voluntarily fund reserves without a guarantee or forced cash call. |
| Closing | Fully specified NPC purchases and sole-owner sale/refinance/renovation are atomic commands through the existing queue, receipt, journal and spotlight boundary. An unrelated active transaction blocks them. The command and any fourth-spotlight settlement succeed together or reject without mutation, IDs or RNG. Browser review cancellation changes only the local draft. Shared sales/refinancing and renovation management rights wait for packet 6's confirmed owner contracts. |
| Bank payoff | Sale clears all related bank liens. Performing-only refinancing replaces the exact bank payoff without cash-out and charges 1% of new principal. Payoff collects earned current-quarter interest once, with principal/interest journal breakdowns. Paid-through quarters prevent a second charge or refinancing escape; canonical prepaid-interest evidence carries closing interest into that quarter's measurements. |
| Earned ownership | Quarter-start property operating inputs and ownership survive sale, refinance and renovation. Sold assets remain as nonowned, cashless records until their earned basis settles; next-quarter basis excludes them. Renovation is once per property, costs 5% of value with a $10k floor and persists its cost/effective quarter and applies the approved rent/occupancy/value increments at the next-quarter boundary without changing earned-quarter inputs. |
| Basis and privacy | Acquisition basis includes purchase fees and retained capital; reserve funding and renovations update the payer's basis. Sale records actual proceeds, fees, cost and NPC counterparty evidence; principal financing never becomes a gain or recurring income. Private property positions, bank quotes, terms and settlement results remain recipient-specific. |
| Persistent choices | Three fully disclosed authored NPC listings provide stable acquisition routes before packet 7 recurring generation. Facts never reroll. Initial balances and the Q1 business fixture remain unchanged. Macro rate activation and multiplayer capital stay in later packets. |

Compatibility identifiers become engine `0.0.10`, rules `0.0.8`, shared `0.0.12`, persistence `0.0.9` in the ordered M7 stack. Older snapshots require their compatible build; no silent conversion occurs.
