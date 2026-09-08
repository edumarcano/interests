# Financial Strategy Game - Technical Architecture

> **Version:** 0.2  
> **Date:** September 8, 2026  
> **Status:** Architecture baseline for implementation  
> **Companion:** [GAME_DESIGN.md](GAME_DESIGN.md), canonical game design v0.4  
> **Intended location:** `docs/ARCHITECTURE.md`

## Purpose and authority

This document defines how to build the agreed game: a modular, browser-based financial strategy game for four people playing together, with private information, negotiation, seeded randomness, and reconnectable sessions.

`GAME_DESIGN.md` owns gameplay and balance. This document owns software boundaries, data flow, reliability, security, tooling, and session management. It does not silently resolve the financial and victory questions still marked OPEN in the game specification.

The decisions here are the implementation defaults. Change them deliberately, record the reason, and update the affected tests. Exact dependency patches belong in the repository's version pins and lockfile, not in this document. No scaffolding, tests, deployment, or production readiness is implied by this specification.

**Working principle: simple modules, explicit transitions, one authoritative state, and no hidden business logic in the interface.**

## Contents

1. [Decision summary](#1-decision-summary)
2. [Scope and expansion policy](#2-scope-and-expansion-policy)
3. [System topology](#3-system-topology)
4. [Repository layout and package ownership](#4-repository-layout-and-package-ownership)
5. [Dependency and modularity rules](#5-dependency-and-modularity-rules)
6. [Domain state and identifiers](#6-domain-state-and-identifiers)
7. [Commands, transitions, and concurrency](#7-commands-transitions-and-concurrency)
8. [Round and transaction state machines](#8-round-and-transaction-state-machines)
9. [Financial representation and settlement](#9-financial-representation-and-settlement)
10. [Determinism, randomness, and replay](#10-determinism-randomness-and-replay)
11. [Rules, content, and versioning](#11-rules-content-and-versioning)
12. [Private information and player views](#12-private-information-and-player-views)
13. [Network protocol and synchronization](#13-network-protocol-and-synchronization)
14. [Identity, room codes, and recovery](#14-identity-room-codes-and-recovery)
15. [Host powers, disconnection, and pause](#15-host-powers-disconnection-and-pause)
16. [Persistence and crash recovery](#16-persistence-and-crash-recovery)
17. [Frontend architecture](#17-frontend-architecture)
18. [Security, logging, and errors](#18-security-logging-and-errors)
19. [Testing and simulations](#19-testing-and-simulations)
20. [Tooling, CI, and deployment](#20-tooling-ci-and-deployment)
21. [Implementation sequence](#21-implementation-sequence)
22. [Open gameplay dependencies](#22-open-gameplay-dependencies)
23. [AI-assisted development rules](#23-ai-assisted-development-rules)
24. [Decision register](#24-decision-register)
25. [References](#25-references)

## 1. Decision summary

### 1.1 Chosen stack

| Area | Decision | Reason for this project |
| --- | --- | --- |
| Application language | TypeScript throughout | One language for browser, server, engine, tests, and simulations. |
| Runtime | Node.js 24 LTS | Use the supported LTS line, not a Current release. [R1] |
| Package management | pnpm; exact version pinned | One lockfile and explicit workspace dependencies. |
| Repository | pnpm workspaces; no Turbo or Nx initially | The workspace already supplies the package structure we need. [R2] |
| Frontend | React + Vite | A client application rather than an SEO or server-rendering product. [R3] |
| Routing | React Router, declarative mode | Explicit lobby, match, and recovery routes without another server framework. [R4] |
| UI state | React Context + reducers and component state | Store the latest player view, connection state, and local drafts; no Redux or second game engine. |
| Styling | CSS Modules + shared CSS variables | Responsive layouts with a small, understandable styling surface. |
| HTTP server | Fastify | HTTP routing, lifecycle, logging, health checks, and static delivery. [R5] |
| Live communication | Socket.IO server and client | Reconnection support and event transport; application-level recovery remains our responsibility. [R6], [R7] |
| Boundary validation | Zod | Validate external input and persisted data; infer wire types from schemas. [R8] |
| Engine updates | Immutable public API; Immer internally | Concise draft updates without modifying caller-owned state. [R9] |
| Financial calculations | Integer-cent state; `decimal.js` for intermediate arithmetic | Centralize precision and rounding rather than using scattered floating-point dollar calculations. [R10] |
| Gameplay randomness | `seedrandom` behind an engine-owned adapter | Explicit seeds and serializable generator state. Never use it for credentials. [R11] |
| Persistence | SQLite via `better-sqlite3`, parameterized SQL | Durable snapshots, action records, and atomic writes. Isolated inside the server persistence layer. No ORM. [R12], [R13] |
| Tests | Vitest, fast-check, React Testing Library, Playwright | Financial examples, invariants, generated cases, components, and real browser flows. [R14], [R15], [R16], [R23] |
| Code quality | Biome | Unified fast formatting and linting across the workspace. |
| CI | GitHub Actions | Run the same reproducible checks locally and on pull requests. [R18] |
| Initial deployment | Local-first Node server on host machine (Fastify + Socket.IO + SQLite) | Local-first LAN play for players physically together. Binds to local network; no paid cloud, external database container, or internet connection required for V1. [ARCH-029] |

Choose compatible stable package releases when scaffolding and commit exact direct-dependency versions. Do not install pre-releases just because they are newer. Record the exact Node patch in `.nvmrc` and the pnpm version in `package.json#packageManager`.

### 1.2 Important refinements to earlier proposals

- The first headless engine needs no database. The first **reconnectable multiplayer build does**: SQLite via `better-sqlite3` is part of that milestone, not an optional final polish task.
- The web app imports neither the server nor the authoritative engine. It receives a deliberately limited view.
- A seed is not sufficient for exact match replay. Initialization, ordered accepted commands, rule/content versions, and compatible engine/RNG code are also required.
- A disconnected player's quarter is not simulated in real time. The match pauses; no bot makes financial decisions for them.
- Supporting a larger future player count requires new content and balance rules, not just a bigger lobby setting.

## 2. Scope and expansion policy

### 2.1 V1 match configuration

Standard V1 supports **exactly four occupied human seats to start**, selected from the eight starting profiles and eight objectives in the game design. A lobby may contain fewer people while waiting. It cannot start early, and a fifth participant cannot join as another player. Spectators are not a V1 feature.

The room creator is the initial host and occupies one seat. Every player uses a nickname, a room code to locate the lobby, and private credentials to retain control of their seat. No accounts, email verification, or passwords are required.

### 2.2 Future player counts

A versioned `GameModeDefinition` declares:

- mode ID and rules version;
- supported player counts;
- profile and objective pools;
- objective choices per player;
- the objective-dealing policy and pacing parameters.

Standard V1 declares `supportedPlayerCounts: [4]` and two objective choices per player. Engine collections use IDs and arrays, not `player1` through `player4` fields. The UI renders a variable-length roster.

The V1 deal consumes eight distinct offered objectives. Five players with two non-overlapping choices would require ten available objectives or a different approved dealing policy. Likewise, unique profiles require a sufficiently large pool. Configuration validation must reject impossible modes. Do not silently allow duplicate ambitions or exclude an objective merely to fit more people.

Generic infrastructure is expansion-ready; the four-player rules remain deliberately specific.

### 2.3 Explicit exclusions

No team mode, in-game chat, voice infrastructure, 3D, mandatory TV display, AI opponents, real-time economic clock, income acceleration, nested financing chains, or custom contract scripting in V1. Ordinary non-player banks and market counterparties remain authored game entities, not human-player bots.

## 3. System topology

```text
Phone / laptop browser
  React interface + player-specific view
                |
                | HTTP + Socket.IO (Local LAN / Wi-Fi; HTTPS for future deployed play)
                v
Single Node.js / Fastify application (Host PC / Laptop)
  Authentication -> room controller -> command queue
                                      |
                                      v
                             Pure TypeScript engine
                                      |
                         candidate next state + effects
                                      |
                    SQLite atomic persistence (better-sqlite3)
                                      |
                     Authorized player projections
                                      |
                           Individual browser updates

Simulation CLI -> the same engine + the same rules
              -> no browser, sockets, or database required
```

Fastify owns one underlying HTTP server. Attach Socket.IO to that server; do not create a second independent listening server or also install a competing WebSocket transport. Socket.IO clients must use `socket.io-client`, not a raw browser `WebSocket` connection. [R5], [R19]

The browser expresses intent. The engine determines legality and financial consequences. The server authenticates, orders, persists, and distributes the result. SQLite stores durable state. The host is a player with limited administrative permissions, not the authority for calculations.

No part of gameplay requires a live AI service. AI-assisted development does not imply AI-generated financial rules or opportunities at runtime.

## 4. Repository layout and package ownership

This is the target structure. Create modules when implementing their first responsibility, not as dozens of empty placeholders.

```text
/
  apps/
    web/
      src/
        app/                  # Router, providers, bootstrapping
        features/
          lobby/
          recovery/
          dashboard/
          spotlight/
          negotiations/
          portfolio/
          objectives/
        components/           # Reusable presentational components
        transport/            # Socket client, HTTP client, reconnect flow
        styles/               # Tokens and global foundations
      e2e/
    server/
      src/
        bootstrap/
        http/
        realtime/
        sessions/             # Credentials, membership, host, presence
        rooms/                # Per-room queue and orchestration
        persistence/          # Repositories and database transactions
        observability/
      migrations/             # Numbered SQL migrations
      test/
  packages/
    shared/
      src/
        primitives/           # Branded IDs, units, public identifiers
        protocol/             # Client command / server response schemas
        views/                # Explicit player-view schemas
    rules/
      src/
        schemas/
        modes/
        profiles/
        objectives/
        opportunities/
        economy/
        finance/
        manifests/
    engine/
      src/
        model/                # Internal, complete authoritative state
        game/                 # Initialization, command dispatch, phases
        random/
        finance/              # Money, loans, credit, ledger calculations
        assets/               # Properties, businesses, market positions
        contracts/            # Offers, reservations, closing, agreements
        opportunities/
        players/
        objectives/
        settlement/
        views/                # Authorized projections and safe previews
        invariants/
      test/
        fixtures/
        replay/
    simulation/
      src/
        cli/
        policies/
        runners/
        reports/
  docs/
    GAME_DESIGN.md
    ARCHITECTURE.md
    DECISIONS.md               # Short future change records; link here
    ROADMAP.md                 # Milestones and acceptance criteria
  scripts/                    # Repository checks and development helpers
  .github/workflows/
  .env.example
  .gitignore
  .nvmrc
  biome.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  package.json
  tsconfig.base.json
  README.md
```

### 4.1 Workspace responsibilities

| Workspace | Owns | Must not own |
| --- | --- | --- |
| `@game/shared` | Branded primitives, protocol schemas, public/player-view contracts | Full game state, hidden-world generation, financial decisions, server code |
| `@game/rules` | Typed, versioned game definitions and numeric parameters | Runtime state changes, network calls, imports from the engine |
| `@game/engine` | Complete game state, legal transitions, all financial logic, visibility projection | React, HTTP, sockets, database operations, wall-clock timers |
| `@game/simulation` | Automated decision policies, batch execution, reports | An alternative financial model or alternative victory implementation |
| `@game/server` | Authentication, per-room serialization, persistence, session lifecycle, transport | Duplicated mortgage formulas, client-trusted outcomes, UI components |
| `@game/web` | Responsive presentation, user intent, local forms, synchronization status | Authoritative balances, full hidden state, secret seeds, direct database access |

`@game/shared` is deliberately small. A type does not belong there merely because two internal engine files need it.

Rule schemas live with rules. Internal domain types live with the engine. Network schemas live in shared. Storage schemas live with server persistence. They may refer to common primitives, but they are not all aliases for the same unrestricted object.

## 5. Dependency and modularity rules

### 5.1 Allowed workspace imports

An arrow means "may import from."

```text
rules      -> shared/primitives
engine     -> rules, shared/primitives, shared/views
simulation -> engine, rules, shared
server     -> engine, rules, shared
web        -> shared
shared     -> no other workspace
```

`engine` may use public command payload types from `shared/protocol` through its command adapter; it must not depend on transport envelopes or Socket.IO types. `shared` and `rules` cannot import engine internals to resolve a circular dependency.

The browser never imports `rules` wholesale. When it needs public rule explanations, the server supplies a safe description, or a deliberately public static subset is generated into shared. Hidden opportunity data and live secrets never enter the web build.

### 5.2 Enforcement

Use workspace package exports and `workspace:*` dependencies. Import public entry points, not another package's `src/` paths. Configure ESLint restrictions by package and a repository dependency check in CI to reject forbidden edges and cycles. TypeScript project references describe build dependencies. [R2], [R20]

Engine code cannot directly call `Math.random()`, `Date.now()`, `new Date()`, timers, filesystem APIs, environment variables, network clients, or database clients. Static restrictions and tests enforce this. UTC timestamps and operational timers belong on the server.

### 5.3 Module size and shape

Organize around game concepts rather than generic `utils`, `helpers`, or one enormous service. A loan module should own its schedules and calculations; contracts can call it instead of maintaining a second loan formula.

A module can begin as one readable file and a colocated test. Split it when it acquires multiple responsibilities. Around 300 lines is a review signal, not an automatic rejection or an excuse to create dozens of trivial files.

Use plain functions and explicit dependencies. No dependency-injection framework, generic plugin system, event bus, or reusable "enterprise base service" layer is required.

## 6. Domain state and identifiers

### 6.1 Separate operational and game state

**RoomSession**, owned by the server, includes room code, member identities, host, connection presence, pause reasons, reconnect credentials, and retention metadata.

**GameState**, owned by the engine, includes the economic world, player positions, financial agreements, turn phase, and deterministic random state.

Disconnecting changes `RoomSession`. It does not change a player's salary, consume an opportunity, or advance the game RNG. Both layers are persisted where necessary, but only game commands belong in the deterministic economic replay.

### 6.2 Normalized authoritative entities

Use records keyed by branded IDs and explicit ordered ID arrays where order matters.

| State area | Canonical information |
| --- | --- |
| Match identity | Match ID, mode ID, engine/rules/content/schema versions |
| Progress | Quarter number, phase, acted/remaining players, current interaction |
| Players | Starting profile, career, selected objective, private choices and preferences |
| Cash accounts | Player cash and any explicitly modeled asset/entity cash |
| Assets | Property/business operating facts, value basis, market positions |
| Ownership | One canonical ownership register per ownable asset |
| Loans | One canonical record per loan, including borrower, lender, schedule, balance |
| Opportunities | Generated facts, lifecycle, visibility, investigation state |
| Transaction | At most one active deal, its offers, consents, financing plan, reservations |
| Disclosure | Which generated facts have been disclosed to which players |
| History summaries | Required lookback data, realized gains, principal/interest totals, settlement markers |
| Random state | Hidden master seed, named stream states, deterministic ID counters |

Assets are not copied inside every co-owner's player record. Player net worth, debt exposure, and portfolios are derived from the registries. A loan appearing as a lender's receivable and a borrower's liability is still one loan, not two independently editable balances.

Do not persist unrestricted computed caches such as an editable `netWorth` alongside all its underlying data. Recompute small derived views; any necessary cache must have a documented invalidation rule.

Persist plain JSON-compatible values: objects, arrays, strings, booleans, nulls, and bounded numbers. No functions, prototypes, `Map`, `Set`, `Date`, `Decimal`, `BigInt`, or socket objects in `GameState`. Undefined optional fields must have a documented serialization treatment.

### 6.3 IDs and units

Use branded types for `PlayerId`, `AssetId`, `LoanId`, `OpportunityId`, `TransactionId`, `CommandId`, `MoneyCents`, `RateBps`, and `OwnershipUnits`. Brands protect compile-time use; runtime schemas still validate input.

Server identities, room codes, and credentials use cryptographic randomness. In-engine entity IDs use deterministic counters with type prefixes. They must not encode a secret objective or unrevealed asset quality. IDs are references, never authorization.

Clients generate command IDs with a browser cryptographic UUID API. The server validates their format, binds them to the authenticated member, and treats collisions with different payloads as errors.

### 6.4 Engine API shape

The public API should remain small:

```ts
// API contract; named domain types are defined in their owning modules.
interface EngineApi {
  createGame(input: Initialization, rules: RuleSet): GameState;
  applyCommand(
    state: GameState, command: TrustedGameCommand, rules: RuleSet
  ): TransitionResult;
  getPlayerView(
    state: GameState, viewerId: PlayerId, rules: RuleSet
  ): PlayerGameView;
  getActionPreview(
    state: GameState, viewerId: PlayerId, request: PreviewRequest, rules: RuleSet
  ): PreviewResult;
  assertInvariants(state: GameState, rules: RuleSet): void;
}
```

A successful transition returns the next state plus domain events and ledger entries. A normal rule rejection returns a typed error without changing state, consuming IDs, or advancing randomness.

## 7. Commands, transitions, and concurrency

### 7.1 One authoritative mutation entry point

All changes to live game state go through `applyCommand`. Domain handlers implement the actual work. The server does not edit balances after the engine returns, and the UI cannot post a replacement `GameState`.

Representative player commands include `CHOOSE_OBJECTIVE`, `SET_FOCUS`, `READY`, `PURSUE_OPPORTUNITY`, `INVESTIGATE`, `OPEN_FINANCING_REQUEST`, `SUBMIT_OFFER`, `ACCEPT_OFFER`, `CANCEL_TRANSACTION`, `CLOSE_TRANSACTION`, and `PASS_SPOTLIGHT`.

Commands describe intent and refer to existing entities. Clients do not choose resulting profit, future random outcomes, interest payments, ownership totals, or a winner.

System transitions such as initializing a quarter or executing settlement are engine/server-owned. They are not generic client actions available to the host.

### 7.2 Validation layers

1. **Transport validation:** correct schema, sizes, and supported protocol version.
2. **Identity and membership:** credential grants access to this room and seat.
3. **Session state:** game is not paused, abandoned, incompatible, or finished.
4. **Domain authorization:** actor can perform this action in this phase and on this entity.
5. **Financial/rule validation:** current resources, consents, ownership, and terms permit it.
6. **Post-transition invariants:** resulting state remains internally consistent.

Zod handles shape validation. Domain functions handle affordability and game legality. Passing a schema never proves an action is legal.

### 7.3 Update style

Export readonly state. Inside `applyCommand`, use Immer's draft mechanism for a single synchronous update boundary. Pure calculations remain ordinary functions. No asynchronous work or persistence occurs inside an Immer recipe. Immer leaves the input state unchanged while producing the updated state. [R9]

A validation failure discards the draft, including speculative RNG changes and ID increments. A programming invariant failure aborts the operation and faults the room; it must not publish partial effects.

### 7.4 Per-room command queue

The server gives each room one serial queue. State-changing player commands, host administration, disconnection handling, and authoritative phase transitions pass through it.

Different rooms may progress independently. Within one room, only one transition commits at a time. An `await` during database work must not let a second handler race ahead using the same starting state.

A long human negotiation never holds a database transaction open. Each offer, acceptance, or cancellation is its own short committed command; the active negotiation state is saved between them.

### 7.5 Retry and stale-state rules

Every submitted command carries a unique `commandId`. Store its payload hash and durable result under `(matchId, memberId, commandId)`. A retry of the same command returns the recorded result; reuse with a different payload is rejected.

Use an overall state revision for synchronization, and **context/terms versions** for decisions. Do not reject every parallel background response merely because another player submitted first. Instead:

- commands bind to the expected phase or interaction ID;
- financial acceptances bind to the exact offer/terms revision;
- current affordability is checked again inside the queue;
- changed relevant terms cause `STALE_CONTEXT` and a refreshed preview.

A harmless update elsewhere does not invalidate another player's preparatory actions. A price or ownership change does invalidate an acceptance based on old terms. There is no automatic resubmission with a newly invented command ID.

## 8. Round and transaction state machines

### 8.1 Match phases

Represent phases with discriminated unions so impossible combinations are difficult to construct.

Standard V1 uses the locked G1 flow without a mandatory synchronous planning or ready phase:

```text
OBJECTIVE_SELECTION
        |
        v
   ROUND_START
        |
        +-> SPOTLIGHT 1
        |       |
        |   [REACTION_WINDOW]
        |       |
        |   close / cancel / pass
        |
        +-> SPOTLIGHT 2
        |       |
        |   [REACTION_WINDOW]
        |       |
        |   close / cancel / pass
        |
        +-> SPOTLIGHT 3
        |       |
        |   [REACTION_WINDOW]
        |       |
        |   close / cancel / pass
        |
        +-> SPOTLIGHT 4
        |       |
        |   [REACTION_WINDOW]
        |       |
        |   close / cancel / pass
        |
        v
   ROUND_CLOSE
        |
        v
   SETTLEMENT
        |
        v
  next ROUND_START

A valid culminating transaction can enter FINISHED.
```

ROUND_START enters and presents the shared new-quarter economy (presenting opening conditions in Quarter 1, and presenting the revalued market state, new regime, and entitlement basis already computed at the conclusion of the preceding quarter's settlement per ARCH-024 without rolling a second economy transition). Quarter preparation and settlement are atomic engine operations, not screens that accept competing financial actions. Recurring salaries, distributions, expenses, debt service, and contracts settle deterministically once for the full quarter after the fourth spotlight.

Continuous background activity includes reviewing data, reading public market indicators, inspecting private opportunities, and preparing drafts. Authorized off-spotlight preparatory actions (such as permitted diligence/investigation) are command-authorized transitions that may mutate that player's canonical and private state (e.g. paying an investigation fee from cash and recording revealed facts) without initiating a new major transaction, altering shared turn progress, or advancing the spotlight. Only the current spotlight player may initiate a new major transaction. Non-spotlight players may participate through reactions when invited or eligible.

The spotlight order follows the named Standard V1 policy `rotating-seat-v1` [ARCH-030]:
- Each of the four players receives exactly one spotlight per quarter.
- The starting seat rotates deterministically each quarter (`Q1: A->B->C->D`, `Q2: B->C->D->A`, `Q3: C->D->A->B`, `Q4: D->A->B->C`, etc.).
- State structures remain strictly collection-shaped (`playerOrder = [A, B, C, D]`) rather than fixed seat arithmetic or four fixed fields.
- A spotlight advances immediately upon terminal resolution (closed, cancelled, expired) of its active transaction, or when the spotlight player explicitly passes.
- At most one unresolved major transaction exists at a time across the entire match.

### 8.2 Offers and closing

The engine supports one active major transaction, with a finite sequence:

```text
PROPOSED -> NEGOTIATING -> READY_TO_CLOSE -> CLOSED
                 |               |
                 +-----> CANCELLED / EXPIRED
```

Investigation, funding, and bank quotes are substages of that transaction, not separate recursive deal engines. A player reacting to a request cannot open a second borrowing request to fund their response.

Formal offers identify their maker, recipient/request, terms revision, expiry in game terms, and resource commitment. Submitting a firm offer is an explicit conditional authorization, clearly labeled in the UI. The initiator's acceptance supplies the other consent. Changed terms require fresh consent; nobody can silently rewrite an accepted rate or share percentage.

### 8.3 Reservations and atomicity

Reserve promised cash when a firm offer is submitted. Reservation reduces **available** cash, not actual account cash. The ledger moves money only at closing. A replacement offer adjusts its reservation atomically. Rejected, withdrawn, expired, or cancelled offers release reservations.

Competing offers for the same funding slot are alternatives, not cumulative funding. If several investors participate, each occupies an explicit funding slot, and the engine checks the combined plan. Reservations may never count the same cent twice.

At close, validate the complete plan, then atomically apply:

- buyer and investor contributions;
- new borrowing and any old-loan payoff;
- seller proceeds and fees;
- asset and ownership transfers;
- loan and partnership creation;
- release of reservations;
- the applicable victory checks.

Either all closing steps happen or none happen. Previously paid investigation costs remain spent after cancellation. An unsuccessful acquisition must not accidentally leave a newly funded loan behind.

A saved negotiation resumes exactly where it stopped. Pausing does not revoke offers or run down an economic-round expiry. Technical session retention is a separate policy.

## 9. Financial representation and settlement

### 9.1 Units and precision

| Quantity | Representation |
| --- | --- |
| Persisted money | Integer cents in a branded, safe JavaScript integer |
| Rates | Integer basis points; 100 basis points = 1 percentage point |
| Ownership | Integer units out of 1,000,000 per fully represented asset |
| Simulation time | Integer quarters and explicitly named period indices |
| Intermediate finance calculations | Private configured `decimal.js` instance |
| Operational time | Server UTC timestamps; never an engine clock |

Use constructors and checked arithmetic. Reject NaN, Infinity, unsafe integers, and out-of-range inputs. Rates may be signed where a particular rule permits negative movement; a rate field's valid bounds belong to its schema.

Do not calculate `dollars * 100` from an arbitrary binary float and assume the result is safe. Parse user money input as a decimal string, validate scale, and convert once. No `Decimal` object crosses an engine serialization boundary.

Set the finance decimal context centrally: 40 significant digits and half-up rounding, including the equivalent away-from-zero behavior for exact negative ties. Do not modify global library defaults from unrelated modules. Round ledger postings at documented boundaries, not at every multiplication. Record this as part of `rulesVersion`. Decimal precision and rounding are explicitly configurable in the library. [R10]

For proportional distributions, allocate whole cents and use a stable largest-remainder rule with canonical ID ordering as the tie-breaker. Shares sum exactly to the recorded issued ownership total; fractional dust is not destroyed or given to whoever clicked first.

### 9.2 Central financial functions

Finance modules exclusively own currency conversion, fees, amortization, rate resets, underwriting, realized gains, distributions, and net-worth calculations. Frontend formatting may convert cents to display strings; it may not independently decide the binding payment or available borrowing amount.

Compute previews through the same domain functions used at execution, using only the viewer's disclosed information for visible results. Label estimates explicitly when unrevealed facts can affect outcomes.

Annual-to-quarter conversion, payment dates, debt amortization, and income entitlement must follow the financial rules approved under A1-A4. Quarterly simulation does not justify approximating three contractual monthly payments as one unrelated payment. The implementation may use a closed-form three-payment calculation without introducing three user-visible subrounds.

### 9.3 Ledger

Every actual cash movement creates a journal entry with a deterministic ID, source account, destination account, amount, reason, quarter, and related transaction/loan/asset IDs.

The model is not a complete real-world accounting product. It does, however, identify external bank/market/employer sources and sinks so money never appears as an unexplained mutation.

Player-to-player transfers reconcile exactly. Loans create a borrower liability and a lender receivable from the same loan record. Interest and principal have different classifications. Valuation changes update valuations, not cash. Company debt is not deducted twice from personal net worth. Retained entity cash is counted once according to the adopted business-valuation rule.

Durable journal history lives in server persistence. The engine retains only the summaries and history needed for rules, lookbacks, and invariants; it returns new entries with each transition.

### 9.4 Quarterly settlement

Each quarter has a unique settlement ID and may settle exactly once. Settlement produces a complete plan before changing balances: entitlements, income, expenses, loan obligations, transfers, defaults/recoveries under the adopted rule, and objective measurements.

Use the period's documented entitlement basis. Never iterate through players and let iteration order decide whether one player's repayment funds another's payment. Circular obligations and insufficient funds require a deterministic settlement/default rule, not repeated transfers until the numbers happen to work.

Apply settlement, its journal, the new quarter marker, and associated command receipt in one durable operation. No client observes half the quarter. A crash or retry cannot pay salaries twice.

The existing OPEN accounting rules are real blockers for a complete numerical simulation. Section 22 identifies them. The architecture supplies their home; it does not invent repayment or insolvency behavior.

## 10. Determinism, randomness, and replay

### 10.1 Randomness ownership

Use a local `seedrandom` instance through `engine/random`; never patch global `Math.random`. Always pass an explicit seed and enable state capture. The library supports exporting a plain state object and restoring the generator from it. [R11]

Initialize separate streams with unambiguous seed labels for:

- setup and objective dealing;
- economy and shared markets;
- opportunity selection and generated deal facts;
- asset outcomes and event resolution.

Store all stream states. A read, preview, validation rejection, reconnect, or UI rerender must consume no gameplay random draws. Bot policy randomness uses a separate simulation seed and never advances the economic streams.

Construct generated asset facts once when the opportunity is created. Inspection reads persisted fields. Cancelling and reopening a screen cannot reroll the deal.

### 10.2 IDs, iteration, and numeric stability

Entity IDs created inside transitions come from persisted counters, not timestamps or random UUID calls. Sort unordered collections by a documented stable ID order whenever processing order could affect draws, rounding, tie-breaks, or effects.

Keep RNG algorithms and sampling functions versioned. "Plus or minus 4%" is not an implemented distribution until the rules say whether it is uniform, a capped distribution, or another model. Never leave that choice to a utility function's undocumented default.

### 10.3 Replay manifest

Persist enough information to reconstruct the same match:

```text
initialization / initial snapshot
master seed and named RNG algorithm/version
mode, setup, rules and content IDs + hashes
engine version / source commit and schema version
ordered accepted game commands with trusted actors
deterministic state/journal hashes at checkpoints
```

The action order is part of the scenario. A different human choice, a different command order, or different content can change the future even with the same seed.

A replay runs through the real engine and compares checkpoint results. Restoring a saved snapshot is the normal reconnect path; replay is a test, audit, and recovery tool, not something every phone runs.

### 10.4 Secrets and operational randomness

The master seed and stream state are private server data. Do not expose them to players, including the host, during a live match. A seed could disclose hidden opportunities and future random results.

Room codes, session secrets, recovery credentials, and security tokens come from Node's cryptographic randomness, never from the game seed. Protect full replay exports as private debug data. A user's ordinary game-history view is a filtered projection, not the raw command log.

## 11. Rules, content, and versioning

### 11.1 Data definitions, not scripts

Author profiles, objectives, economic coefficients, eligibility conditions, and opportunity templates as TypeScript data objects validated against rules schemas. Use `satisfies`/inferred types for authoring feedback and runtime validation when loading a rules bundle.

Definitions refer to a small set of supported condition/effect identifiers. The engine implements those effects. Do not place executable callbacks, `eval`, arbitrary formulas, or server functions in content records. No YAML pipeline, CMS, or runtime content database is required initially.

A new opportunity that uses existing mechanics should normally add data and tests, not a new transaction engine.

### 11.2 Rule manifests

Each match selects an immutable, validated bundle containing `modeId`, `rulesVersion`, `contentVersion`, and hashes. Store its descriptor with the match and retain the matching source/build artifact.

Freeze rules for the lifetime of an active match. Changing a balance constant creates a new rules version for new matches. Do not load the current `rules` folder and silently apply changed thresholds to an old saved match.

Use separate versions for the network protocol and persisted state schema. Compatible presentation updates need not change balance rules. Incompatible engine changes require a tested migration or the compatible engine build; never pretend a new build necessarily reproduces old behavior.

### 11.3 Content validation

Validate references, amounts and units, finite scale bounds, eligibility operators, required effect implementations, profile/objective compatibility, and visibility rules. Reject impossible configurations before revealing setup.

Enumerate the V1 profile combinations and objective allocations in tests. Verify no Stretch offer, at least one Strong option, two choices per player, and no repeated offered objective. Preference for different strategic families is a scoring preference, not a newly invented absolute restriction.

A bundle may be marked `simulationFixture` or `playable`. Test fixtures can isolate a mechanic with explicit assumptions. A real match must use a playable bundle whose required financial, victory, and default policies are present. Missing policies cause a clear initialization error, never a guessed default.

## 12. Private information and player views

### 12.1 Projection is an allowlist

`getPlayerView` constructs an explicitly defined `PlayerGameView`. It never clones complete state and deletes a few sensitive fields. Adding a new secret field to `GameState` must not accidentally expose it.

The same projection policy governs full snapshots, action acknowledgements, previews, activity feeds, error details, and recovery responses. Host privilege grants no additional financial visibility.

### 12.2 Default visibility policy

| Information | Who receives it |
| --- | --- |
| Room roster, nicknames, host, connection/pause status | Authorized members |
| Current public economy, phase, permitted spotlight summary | All players |
| Public ownership relationships and ownership percentages | All players, where the asset is public |
| Exact personal finances, selected ambition and objective choices | That player only |
| Private opportunity and purchased investigation facts | Discoverer plus explicitly authorized recipients |
| Formal targeted request | Initiator and target |
| Open request's intentionally published terms | All eligible recipients |
| Competing offer terms | Offer maker and request initiator, not competing bidders by default |
| Contract terms, binding contributions, debt schedule | All parties who must consent or bear the obligation |
| Completed major deal announcement | Public asset/relationship summary, not every private term |
| Seed, RNG state, hidden regime, undisclosed facts | Server and authorized development tools only |

An investor must see the binding deal terms and exposure they are being asked to accept. Information asymmetry is not permission to hide an obligation from its contracting party. Facts unrelated to that obligation can remain private according to the opportunity's disclosure rules.

### 12.3 Safe derived information

Public liquidity/leverage bands are deliberately coarse and computed through one visibility policy. Exact cutoff values are game parameters. Do not show another player's exact funding gap, borrowing ceiling, or loan rejection reason.

Opportunity discovery must not consult another player's hidden cash and then reveal a tailored funding hint that exposes it. Use public/own information and objective-neutral capability assumptions for discovery; execution uses actual confirmed financing.

Safe previews cannot expose undiscovered defects through an exact cash-flow calculation or a recommended price. They use the viewer's known facts and labeled assumptions. Public source code or knowledge of rule formulas is not considered secret; unrevealed match-specific values are.

Tests should vary another player's secrets and verify that the unauthorized view does not change except through explicitly allowed public indicators and activity metadata. Revision numbers are synchronization metadata, not an additional permission to expose event contents.

## 13. Network protocol and synchronization

### 13.1 HTTP and realtime responsibilities

HTTP handles room creation/joining, session bootstrap, credential recovery, health endpoints, and fetching an authorized current snapshot.

Socket.IO handles subscribed player views, gameplay commands, command acknowledgements, and connection/pause notices. Use its standard transport negotiation initially, including polling fallback, rather than forcing WebSocket-only connections without a demonstrated need.

The initial command envelope contains:

```ts
// Public transport shape; actor identity is intentionally absent.
type ClientCommandEnvelope = {
  protocolVersion: string;
  commandId: CommandId;
  observedRevision: number;
  contextId: string;
  contextVersion: number;
  action: ClientAction;
};
```

The server binds the authenticated actor and room. A client cannot nominate another player's ID as its actor or submit system-only actions. Targets inside an action still undergo authorization.

### 13.2 Full projected snapshots

After a meaningful committed change, send each connected player their own full projected snapshot. Use monotonically increasing revision metadata. The client replaces its authoritative view, ignores older snapshots, and requests a fresh one when synchronization is uncertain.

A bounded recent visible activity feed may accompany the view; the entire private replay log does not. Do not add JSON patch synchronization, CRDTs, client-side rollback, or optimistic financial state in V1.

Whole-view updates trade some bandwidth for simpler recovery. Measure snapshot size and update rate before adding complexity. Presence updates need not resend large financial views if a small authorized session notice suffices.

### 13.3 Acknowledgements and reconnect behavior

Socket.IO preserves ordering of delivered events, but its default delivery is at most once. A library reconnection is not proof that a command was committed. [R6]

Application behavior is therefore explicit:

1. Submit an action only while authenticated and synchronized.
2. Mark it pending and disable duplicate confirmation locally.
3. Persist its `commandId` locally if needed to survive a refresh; do not persist sensitive terms unnecessarily.
4. The server commits or rejects it and returns a durable receipt.
5. On timeout/reconnect, query that command's status and fetch the current authorized state.
6. Retry only with the same ID and identical payload when appropriate. A changed decision is a new command after a new preview.

Do not rely on Socket.IO's disconnected-event buffer to execute financial decisions automatically after reconnection. Commands created while offline remain unsent drafts until the player reconfirms them against fresh state.

Do not enable connection-state recovery as a correctness dependency in V1. Its recovery can fail; application synchronization is still necessary. [R7] Explicit reauthentication and full-view resynchronization are the baseline.

### 13.4 Commit-before-acknowledge pipeline

```text
Authenticate and parse
  -> enqueue in room
  -> look up duplicate receipt
  -> validate session, context, and game rules
  -> compute candidate transition
  -> check invariants
  -> commit snapshot + command/receipt + journal/events
  -> install committed state in room memory
  -> acknowledge
  -> send authorized views
```

A database failure never produces a successful game acknowledgement. A committed action whose acknowledgement was lost is recovered from the command receipt, not repeated financially. This produces idempotent effects, not a claim of magical exactly-once network delivery.

## 14. Identity, room codes, and recovery

### 14.1 Join flow

The server creates a cryptographically random, case-insensitive room code using an unambiguous alphabet. Start with six characters, check uniqueness, and enforce creation/join rate limits. The room code locates a lobby; it is not proof of ownership of any seat.

The player supplies a nickname, normalized and validated for length and unsafe content. Require nicknames to be distinct within a room for clarity. The server generates the durable member/player ID. Nicknames can never be used alone to reclaim a disconnected seat.

New members may join only while the lobby is open and has capacity. Match start locks the roster. No late replacement, midgame nickname-based impersonation, or unapproved spectator endpoint.

### 14.2 Browser session

Use a random opaque server-issued session credential in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie for deployed play. Store only its cryptographic digest server-side. A session grants access to specific room memberships, not to arbitrary room IDs. Revalidate that membership for HTTP reads and every game command. [R21]

Use one origin for web, API, and socket transport. Validate Origin for socket handshakes and state-changing HTTP requests and use CSRF protection for cookie-authenticated writes. Do not put credentials in URL query strings or normal browser local storage. [R22]

Local HTTP development may use a specifically configured non-Secure cookie. That exception must never activate in production. Browser privacy mode, cleared cookies, and a different device require the recovery route below.

### 14.3 Private recovery code

Each membership receives a separate high-entropy recovery code, at least 128 random bits, displayed privately with an option to copy/save it. Store only a digest. It is a bearer credential, not a short nickname/PIN or the public room code.

To recover on another device, enter the room code and private recovery code. The server verifies them, grants that device the same existing seat, revokes the previous device's authority for that membership, and sends a fresh authorized snapshot. Finances, objective, transactions, and player ID do not change.

Recovery codes remain valid until explicitly regenerated, the membership is revoked, or retained game data expires. An authenticated player can regenerate theirs; the old code then stops working. Never log it or include it in replay exports.

The host cannot view or reset another player's private credential to take control of their portfolio. If both the browser credential and saved recovery code are lost, there is no safe automatic account-recovery path in accountless V1. The match can remain paused or be abandoned. Explain this when displaying the recovery code.

### 14.4 Duplicate tabs and device handoff

Allow one controlling connection per seat. A newly authenticated connection becomes the controller and invalidates the older connection's command authority. The older tab receives a "session opened elsewhere" notice and must not reconnect in a loop trying to reclaim control.

Track a connection generation on the server. A delayed disconnect from an old socket must not mark a seat offline when its newer controlling connection is healthy. `socket.id` is never the durable player identity.

## 15. Host powers, disconnection, and pause

### 15.1 Host powers

The creator starts as host. Host administration includes starting a full ready lobby, removing an unstarted lobby member, pausing a match, resuming a valid paused session, transferring host duties, and explicitly abandoning a match.

It does not include reading secrets, editing money, choosing another player's actions, skipping their financial decisions, changing live rules, rerolling opportunities, reversing committed deals, or declaring a winner. An abandonment ends the session without an economic winner; it is not a gameplay shortcut.

### 15.2 Chosen disconnect policy

**V1 automatically pauses when any occupied seat loses its controlling connection. Resume requires the host and all four seats to be connected and synchronized.**

This deliberately chooses pause-and-reconnect over simulating an absent player. The latter would need decisions about contracts, bids, optional actions, emergencies, and victory while someone is missing.

Once a disconnect is detected, freeze new game commands at the next atomic boundary. A transition already committed remains committed. Never undo a purchase because its buyer's phone went offline just after acceptance. Socket heartbeat detection has finite delay; the engine does not claim to know the instant a phone loses reception.

During a pause, players may reconnect, view their saved position, talk, and prepare local drafts. The server may process credential recovery, synchronization acknowledgements, and host administration. It may not advance the quarter, generate another opportunity, settle income, or approve a new financial action.

When everyone is back, show "All players reconnected - host may resume." Resumption returns to the saved phase and active negotiation. It does not restart the round or redraw anything.

### 15.3 Pause reasons

Track reasons separately: `MANUAL`, `DISCONNECTED_MEMBER`, `SERVER_RESTART`, and `SYSTEM_FAULT`. Clearing a connection-related pause cannot accidentally clear a manual or fault pause.

The host may resume only when required connections are healthy, views are synchronized, rules/schema versions are supported, and no system-fault blocker remains. A developer invariant failure is not a warning the host can override.

No strict decision timer is required in V1. Operational timeouts do not advance the economy. Future timed modes must persist their own remaining decision time and freeze it while paused.

### 15.4 Disconnect handling and host administration

For the local-first in-person V1 release:
- no gameplay timers;
- no automatic financial decisions;
- no AI bots;
- no automatic pass;
- no automatic forfeiture.

If a required player disconnects, gameplay waits in a paused state until they reconnect.

Automatic time-based host succession is removed as a V1 requirement. The **server host machine** is the physical device running the authoritative Node process and SQLite database. Distinctly, the **room host player** is the session administrator (initially the room creator). If the room host player temporarily disconnects from their browser, the server pauses gameplay until they return and reconnect; running the local Node process and holding room-host player authority remain separate concepts. Explicit room host transfer while connected may remain an administrative feature in future session milestones, but automatic timers do not reassign host status.

Under no circumstances does the host gain access to another player's private objectives, exact finances, or unrevealed opportunities.

### 15.5 Lobby, restart, and abandonment behavior

| Situation | Behavior |
| --- | --- |
| Fewer than four players in lobby | Wait; start is disabled. |
| Lobby member disconnects | Reserve their seat; host can remove it before start. |
| Player disconnects during objective choice | Pause choices; preserve already confirmed choices. |
| Player disconnects mid-offer or acquisition | Pause at committed state; retain offers and reservations. |
| Server restarts | Restore latest committed state; require reconnect and explicit host resume. |
| Player cannot return | Keep paused or explicitly abandon; no V1 autopilot or permanent-seat replacement. |
| Host abandons | Persist terminal session state; stop game commands; no fabricated winner. |

Do not silently delete an actively played game. Initial operational retention defaults: unstarted lobbies expire after 24 hours of inactivity; started/paused games after 30 days without a human session/game action; finished or abandoned games after 30 days. Show expiry in the recovery/session UI. Heartbeats alone do not extend retention indefinitely. These deployment defaults are configurable and are not a game-length limit.

## 16. Persistence and crash recovery

### 16.1 Development stages

The engine and simulation tools run entirely in memory. Server tests use in-memory databases or temporary filesystem databases for fast and transactional integration testing.

SQLite via `better-sqlite3` is the authoritative persistence implementation for Milestone 5 and Standard V1 [ARCH-029]. It is appropriate because the local V1 runtime has:
- one authoritative Node process;
- one local database file;
- one process performing writes;
- four human players;
- extremely low transaction volume.

Persistence is strictly isolated behind the `apps/server/src/persistence/` boundary. The deterministic engine knows nothing about SQLite. Server domain/session logic interacts with typed persistence operations, while `persistence/sqlite/` encapsulates `better-sqlite3` and raw SQL statements. Do not build simultaneous PostgreSQL support or generic multi-dialect abstractions in V1.

### 16.2 Initial storage model

Use explicit relational records plus JSON snapshots; do not create a relational table for every internal property field.

| Record | Purpose |
| --- | --- |
| `rooms` | Code, host, lifecycle, pause metadata, retention timestamps |
| `room_members` | Durable seat, nickname, join order, recovery-code digest |
| `sessions` / `session_memberships` | Browser-session digests, access grants, expiry/revocation |
| `matches` | Current snapshot, revision, initialization snapshot, version/seed manifest |
| `match_commands` | Accepted ordered trusted commands and reproducibility metadata |
| `command_receipts` | Authenticated command ID, payload hash, terminal result for safe retries |
| `match_events` | Domain events and journal entries, private until projected |
| `schema_migrations` | Applied database migrations |

Schema details belong in numbered migrations. Foreign keys and uniqueness constraints (`(matchId, actorId, commandId)`) are enforced by the database (`PRAGMA foreign_keys = ON`).

The complete active snapshot remains the recovery source. Command and journal history support replay and diagnosis. This is not a general event-sourcing framework and does not require rebuilding the world from events on every request.

### 16.3 Atomic persistence

A repository commit writes the next snapshot, revision, accepted command, receipt, and emitted entries in one atomic SQLite transaction (`db.transaction(...)`).

Use an expected revision check in addition to the room queue. If the stored revision differs, abort rather than overwrite a newer snapshot. SQLite transactions provide the all-or-nothing database boundary [R12].

Do not acknowledge success before database commit. On uncertain commit outcome, reload the receipt/snapshot before accepting another command. A crashed process may be missing its cache; it must not be missing an acknowledged purchase.

Rejected well-formed authenticated commands can have durable receipts without advancing the game revision. Malformed/unauthenticated traffic is rate-limited and not accumulated as unlimited database history.

### 16.4 Recovery cases

| Failure | Required result |
| --- | --- |
| Client drops before submit | No committed action; unsent draft only. |
| Server fails before database commit | Old snapshot remains; no partial deal. |
| Commit succeeds but response is lost | Retry/query returns the existing result without duplicate effects. |
| Process fails after commit, before view broadcast | Reconnect reads the new committed snapshot. |
| Database unavailable | Stop accepting game transitions and show service unavailable; do not switch to unsaved play. |
| Saved schema/engine unsupported | Preserve data and report incompatibility; never guess a migration. |

On startup, treat persisted presence as offline until reauthenticated. Restore ongoing matches into a recoverable paused session. Engine state remains at its last committed phase.

### 16.5 Deployment, pragmas, and data durability

Run one authoritative application instance. SQLite uses WAL mode (`PRAGMA journal_mode = WAL;`), foreign keys enabled (`PRAGMA foreign_keys = ON;`), and a reasonable busy timeout (`PRAGMA busy_timeout = 5000;`).

Database files and sidecars (`data/`, `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`) are excluded from Git. Local game saves and development test databases must not be committed to the repository.

Use small numbered SQL migrations executed by a minimal server migration runner; no heavy third-party migration framework is required. Migrations are executed in ascending numeric order inside individual transactions, recording applied versions in `schema_migrations`.

## 17. Frontend architecture

### 17.1 Routes and screens

Use React Router in declarative mode. Initial routes:

```text
/                         Create / join / return to a saved session
/rooms/:roomCode           Lobby and setup
/matches/:matchId          Responsive play surface
/recover                  Room code + private recovery code
```

Changing the URL grants no authority. Bootstrap every protected screen through the authenticated server session.

### 17.2 Three independent UI concerns

- **Authoritative view:** replaceable server-projected state; read-only in the browser.
- **Connection state:** connecting, synchronized, submitting, uncertain, paused, or recovering.
- **Local UI state:** open tabs, display depth, form drafts, accessibility preferences.

Keep them in separate reducers/contexts so editing a form cannot alter the financial snapshot. Derived display selectors may sort and format authorized data, but they cannot award money or reconstruct another player's private statement.

No optimistic financial commits. A form can show a pending indicator; balances and ownership change only after the server confirms. Disable finance confirmation while disconnected or unsure whether a previous submission succeeded.

### 17.3 Responsive behavior and Player View

There is one responsive authenticated Player View across all devices. Phone and laptop have the exact same information permissions and gameplay capabilities:
- **Laptop:** Displays a wider multi-panel layout showing personal finances, the active spotlight transaction, public market indicators, and action controls side by side.
- **Phone:** Displays the same authorized information distributed across clean navigation tabs and panels.

Do **not** define a separate spectator or dedicated Table View application for the first playable version. A neutral shared table display remains a possible future enhancement, but is not part of Standard V1.

On any player's screen, "everything" always strictly means:
```text
authorized public information + that player's own private information
```
It never displays another player's protected private objectives, exact finances, or unrevealed opportunities.

Prioritize readable figures, clear units, touch-sized controls, keyboard access, visible focus, reduced-motion support, and text labels alongside color. Use standard HTML controls where possible. Add a small accessible component primitive library only when a concrete component requires it, not a full design system in the initial scaffold.

Connection and pause status stays prominent. A person returning from a locked phone should see the saved interaction and pending-command status, not a misleading fresh lobby.

All confirmed offers remain visible after reconnect because they are server state. Unsent form drafts may be lost on refresh in V1; disclose that distinction.

### 17.4 Frontend/server integration early

After core engine tests, build the first browser slice against the real server protocol, not a second React-only game model. Test create/join, a private view, one transaction, disconnect, and recovery before expanding the visual surface.

The game should work when a phone connects to the developer's machine on the local network. Frontend requests use relative/same-origin paths, not a hardcoded `localhost` address pointing at the phone itself. Vite's development proxy routes API and Socket.IO traffic to the server.

## 18. Security, logging, and errors

### 18.1 Boundary protections

Treat every network input as untrusted, including an already connected player. Validate payloads and authorize each command. Use an explicit Origin allowlist, encrypted transport in deployed environments, bounded message sizes, and rate limits. These are important WebSocket controls, not protections automatically supplied by TypeScript. [R22]

Initial application limits are configuration values: small command bodies, bounded nickname/form lengths, bounded offer counts, and per-member/IP request rates. Start with a 64 KiB maximum incoming message and tighten individual schemas well below it. Disable transport compression unless measurement justifies it.

Serve player-specific HTTP responses with `Cache-Control: no-store`. Avoid a service worker/offline cache for authenticated game state in V1. A browser screen hiding information with CSS is not a privacy boundary.

Use parameterized SQL. Validate environment configuration on server startup. No server secret may use the frontend's exposed environment-variable prefix or be imported into the web build.

### 18.2 Logging

Use Fastify/Pino structured logging with request ID, match ID, command ID, outcome/error code, duration, and revision. Redact credentials, cookies, recovery codes, seeds, objectives, private offers, and complete snapshots from ordinary logs.

The private command/journal store is not the general log stream. Debug replay exports require operator authorization and deliberate handling; they are not host menu features.

Track command failures, reconnect counts, pause duration, slow transitions, database failures, and client/server version mismatches. Measure real human decision time separately from engine execution time.

### 18.3 Error classes

| Class | Examples | Treatment |
| --- | --- | --- |
| Expected gameplay rejection | Insufficient funds, not an eligible participant, expired opportunity, stale terms | Typed player-safe error; no mutation. |
| Session/transport condition | Disconnected, paused, credential expired, incompatible protocol | Explain recovery action; no economic guesswork. |
| Transient infrastructure failure | Database unavailable, uncertain response | Preserve last committed state; recover via receipt/snapshot. |
| Programming invariant failure | Ownership overflow, missing referenced asset, duplicate settlement | Abort transition, fault/pause room, private diagnostic record. |
| Financial distress | Unpaid loan, negative equity, operating loss | Apply explicit gameplay distress rules; not automatically a software bug. |

Negative net worth can be a valid position. An unexplained negative loan principal cannot. Cash availability must follow the approved overdraft/default rules, not a blanket assertion that distressed players are impossible.

The server returns stable error codes and safe descriptions, not stack traces or another player's exact resources.

## 19. Testing and simulations

### 19.1 Test layers

| Layer | Coverage |
| --- | --- |
| Unit: Vitest | Money, rates, fees, loans, ownership, eligibility, projections |
| Generated cases: fast-check | Rounding totals, schedules, invariants, input boundaries, invalid command sequences |
| Engine integration | Setup through full quarter, negotiations, atomic close, objective checks |
| Replay | Fixed seed + initialization + accepted commands produce identical checkpoints |
| Server integration | Authentication, queueing, retries, stale terms, privacy, persistence, host succession |
| Database integration | Migrations, unique constraints, rollback, revision conflicts, commit/retry behavior |
| Component tests | Accessible forms, pending/paused states, private screen rendering |
| Browser E2E: Playwright | Four separate browser contexts, phone layouts, reload, dropped connection, recovery, server restart |

Use the official Vitest, fast-check, and Playwright facilities rather than inventing a test framework. [R14], [R15], [R16] Browser emulation is useful but does not replace trying actual family phones and mobile Safari.

### 19.2 Required engine invariants

- Monetary state uses valid bounded integer cents; no non-finite values.
- Issued ownership allocations reconcile and never exceed their defined total.
- All references point to valid entities or explicitly retained historical records.
- A loan's principal, schedule, and principal/interest journal reconcile.
- Player transfers balance exactly; external sources/sinks are identified.
- Reservations do not exceed available resources or double-count the same commitment.
- At most one major transaction is active; only authorized participants can act.
- Settlement cannot run twice for a quarter or omit a required account.
- An invalid command leaves state, RNG streams, and ID counters unchanged.
- No unauthorized projection contains hidden seed, objective, opportunity, or contract details.
- Pausing/reconnecting changes no economic values or random draws.
- A finished match rejects further economic actions.

### 19.3 Essential regression scenarios

Test a funded acquisition that is cancelled; two competing offers using the same investor cash; a terms change after preview; a duplicate accept; a reload after a lost acknowledgement; a borrower without enough money; a declining asset with ongoing positive income; a co-owned asset sale; inspection followed by reconnect; and a finale whose transaction changes eligibility.

Test disconnection during setup, negotiation, and a quarter commit. Test old-socket disconnect after a new controller connects. Test host loss, host reassignment, all players offline, and resumption after server restart.

Privacy tests use four independently authenticated browser contexts and inspect actual responses, not just rendered components.

### 19.4 Simulation principles

Simulation runs the same engine and same rule bundles used by live games. Policies choose actions; they do not modify balances or bypass eligibility. Policies should see the same information as their represented player unless a run is explicitly labeled an omniscient diagnostic.

Use several policy styles and separate policy seeds. Report unreachable/stalled/censored matches, failures, distribution of rounds, objective/profile win frequencies, resource trajectories, and rule versions. A run stopped at a computational budget is not an in-game draw or proof the match would finish.

No automated batch demonstrates that verbal negotiations are fun or that a match lasts a particular number of minutes. Combine round counts with measured family playtests before claiming duration or balance.

Parallel batch workers are a later optimization. Start with a reproducible single-process CLI and machine-readable JSON reports. A new plot or report must not introduce a second set of financial formulas.

## 20. Tooling, CI, and deployment

### 20.1 TypeScript and builds

Use ESM. Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and consistent type-only imports. Prohibit unreviewed `any` and unexplained compiler/lint suppressions. TypeScript's strict mode is the starting point, not a replacement for runtime checks. [R25]

Build reusable packages with TypeScript into explicit `dist/` exports using project references. Node-facing packages use Node-compatible module resolution; the web app uses Vite's bundler resolution and no-emit checking. Do not rely on root path aliases that only the editor understands. [R20]

Use `tsx` for local server/CLI execution during development; production runs built JavaScript with Node. Typecheck remains a separate command even when development tooling can execute TypeScript. Pin tooling and keep one pnpm lockfile.

### 20.2 Standard repository commands

Define these scripts as their milestones are implemented. They are command names to provide, not a claim that they already exist:

```text
pnpm install --frozen-lockfile
pnpm dev                 # Shared build watch + server + Vite
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm check:boundaries
pnpm check:rules
pnpm simulate -- --seed <seed> --runs <count>
pnpm replay -- <authorized-replay-file>
pnpm db:migrate
```

The root orchestrates package scripts; avoid depending on manual terminal ordering. A small development process runner is acceptable. Do not add a build platform just to launch two watch processes.

### 20.3 GitHub Actions

On pull requests and main-branch pushes, run:

1. Pinned Node and pnpm setup; frozen-lockfile installation.
2. Formatting, typed lint, import-boundary, and rules-bundle checks.
3. Typecheck and production build.
4. Unit, engine integration, and deterministic replay tests.
5. SQLite integration tests once persistence exists.
6. A small four-player browser smoke suite once the UI exists.

GitHub documents Node setup and build/test workflows; the project workflow should use its own pinned versions and package scripts. [R18]

Run larger multi-seed simulations and broader browser suites on a schedule or manually. Preserve failed synthetic replay fixtures, reports, and traces as CI artifacts; never upload real-player credentials or private production state.

Use least-privilege workflow permissions, pin third-party actions to reviewed commit SHAs, and do not expose deployment secrets to untrusted pull-request code. Protect `main` with required checks. Dependency updates are reviewed pull requests, not untested automatic major upgrades.

### 20.4 Hosting defaults and local-first deployment

Standard V1 is designed primarily for four people physically together in the same room [ARCH-029].

The first playable deployment model is:
- A host laptop or PC runs one local Node process hosting Fastify, Socket.IO, the authoritative engine, SQLite, and (later) the built React application.
- The server binds to `0.0.0.0` on the configured port (default `3000`) so phones and laptops on the same local Wi-Fi / LAN can connect via plain HTTP (with HTTPS reserved for future hosted cloud deployment).
- Remote internet play is not a current product requirement.
- There is no paid cloud hosting or external database container requirement for V1.
- Future hosted cloud deployment remains possible behind the existing package boundaries, but must not complicate the local architecture today.

Include liveness and readiness endpoints (`/api/health`). Graceful shutdown stops accepting new transitions, drains short in-flight commits, closes Socket.IO and SQLite database handles, and allows clients to reconnect to the last durable state upon restart.

Do not run production games on `vite preview`, autoscaled independent room servers, or an ephemeral database volume. No continuous-deployment workflow is necessary until the playable slice and recovery tests pass.

## 21. Implementation sequence

Implement narrow, tested slices rather than asking an AI agent to generate the complete game.

| Milestone | Deliverable | Completion criterion |
| --- | --- | --- |
| 0. Documentation | This architecture, linked decisions and roadmap, source-of-truth rules | No hidden duplication of gameplay values; unresolved rules are named. |
| 1. Workspace foundation | pnpm packages, TS, lint/format, Vitest, CI | Empty builds and a small cross-package test pass; forbidden imports fail. |
| 2. Deterministic kernel | IDs, money, RNG adapter, state schema, createGame, commands | Repeatable initialization; invalid actions do not mutate state/RNG. |
| 3. Executable finance slice | Approved accounting rules, loans, one property, one business, journal | End-to-end numeric fixtures reconcile; settlement is idempotent. |
| 4. Transaction slice | One opportunity, investigation, financing offer, reservation, atomic close | No double spending, partial funding, or hidden-data exposure. |
| 5. Persistent session slice | Fastify, Socket.IO, credentials, four seats, SQLite, pause/recovery | Create, join, reconnect, restart, and recover an unfinished transaction. |
| 6. Browser vertical slice | Real phone/laptop views and forms against that server | Four people complete a quarter and recover after interruption. |
| 7. Full rules and content | Eight profiles/objectives, economy, remaining supported effects | All required open gameplay policies resolved and regression-tested. |
| 8. Balance and playtests | Multiple simulation policies plus real family sessions | Documented findings; numbers revised through rules versions. |
| 9. Release hardening | Backups, privacy/security checks, operational documentation, UI polish | Recovery, migration, supported-device, and production-build checks pass. |

Networking security is designed now, not bolted on after a frontend has been built around complete private state. Equally, a full lobby/backend need not delay testing the first loan formula.

## 22. Open gameplay dependencies

The software architecture is selected. Several *game rules* in `GAME_DESIGN.md` section 19 still need executable definitions. They belong in rules and engine tests, not in ad hoc server/UI behavior.

| Game-design ID | Remaining decision | Software owner / gate |
| --- | --- | --- |
| A1 | Mid-round income/expense ownership, dividend eligibility, cash-interest basis | Settlement policy; required before complete quarter tests |
| A2 | Opening loan schedules, APR and period conventions, variable resets | Finance rules and fixture validation |
| A3 | Existing Property Starter mortgage versus new-loan requirements | Explicit legacy-loan fixture, not an underwriting bypass |
| A4 | Business distributions, retained cash, normalization, labor-dependent income | Business/settlement rules; net-worth reconciliation |
| A5 | Issuance versus secondary sales, default, recovery, collateral priority, consent | Contract and distress policies; required before exposed player lending |
| A6 | Reservation/closing/expiry/inspection semantics | Architectural reservation and atomic-close rules selected here; game-specific fees and expiry windows still need definitions |
| G1 | LOCKED for Standard V1: rotating spotlight order (`rotating-seat-v1`), continuous background preparation, spotlight major transaction initiation, single unresolved transaction concurrency boundary | Resolved in GAME_DESIGN v0.4 and ARCH-030 |
| G2 | Capacity cutoffs and credit grades; financing discovery | Eligibility/credit rules; discovery must not leak private balances |
| G3 | Economic distributions, growth/margin updates, rate sensitivities, fees | Versioned economic/asset parameters |
| G4 | Objective lookbacks, materiality, attribution, gains and bad debt | Objective measurement functions and history summaries |
| G5 | Finale exceptions, already-independent route, winner-check timing | Objective/transaction rules; no improvised win decisions |
| G6 | Duration pressure and finite gameplay failsafe | Game design and playtesting; not session expiry or an architecture timer |
| G7 | Setup feasibility, variant fairness, revised baseline balance | Rules enumeration, simulation, and human playtests |

Resolve each rule in a small decision, update the game design and versioned rule data, and add concrete examples before implementing its full behavior. In particular, no module may invent money to avoid a default, treat an absent player as consenting, or award a winner because an undefined finale condition "seems close enough."

This distinction permits architecture and scaffolding to proceed while preventing a supposedly complete simulation from silently relying on unresolved rules.

## 23. AI-assisted development rules

Before implementing a feature, state its owning module, inputs, allowed state changes, visibility, error cases, and invariants. Work in a narrow pull request with tests demonstrating those properties.

An implementation is complete only when:

- behavior matches the relevant design rule and any open assumption is explicit;
- financial logic has one owner and is not reimplemented in the UI;
- types, schemas, persistence, and projections are updated together where affected;
- tests include rejection/retry behavior and any money/ownership invariants;
- private information is absent from unauthorized payloads;
- deterministic replay remains valid for the supported version;
- architecture boundaries, typecheck, lint, tests, and build pass;
- changed rules or dependencies are documented.

Do not let an agent make a large cross-package refactor just to add one opportunity. Do not bypass an invariant to make a test pass. Do not accept a generated implementation because it compiles when the underlying game rule is still undefined.

Use the documents and tests as durable project memory. Keep `GAME_DESIGN.md` authoritative for gameplay, this document authoritative for architecture, and `DECISIONS.md` concise records of future changes linked to the affected sections.

## 24. Decision register

These initial decisions can be indexed in `DECISIONS.md` without copying the entire architecture a second time.

| ID | Decision | Main consequence |
| --- | --- | --- |
| ARCH-001 | Full TypeScript, Node LTS, pnpm workspaces | One language and one modular repository |
| ARCH-002 | Independent deterministic engine | No framework, transport, database, or wall clock in rules |
| ARCH-003 | Normalized state and one command boundary | Explicit ownership and auditable transitions |
| ARCH-004 | Integer money, centralized decimal arithmetic | Documented units, safe conversions, deterministic rounding |
| ARCH-005 | Seeded, versioned random streams | Repeatable gameplay without exposing future secrets |
| ARCH-006 | Fastify + Socket.IO, server authority | Browser sends intent; server validates and persists |
| ARCH-007 | Allowlisted player projections | Clients do not receive complete hidden state |
| ARCH-008 | Full view sync and idempotent command receipts | Simple reconnect without duplicate economic effects |
| ARCH-009 | Room code + nickname + private credentials | Accountless entry with durable seat recovery |
| ARCH-010 | Pause on disconnect; host resumes after recovery | No offline economic simulation or fabricated consent |
| ARCH-011 | Host is session administrator only | No privileged financial control or hidden information |
| ARCH-012 | PostgreSQL from persistent multiplayer milestone | Superseded by ARCH-029 (SQLite persistence for local V1) |
| ARCH-013 | Four-player mode with generic collections | Expansion requires validated new rules/content |
| ARCH-014 | Rules/content as versioned typed data | Balance changes do not require scattered code edits |
| ARCH-015 | Same engine for live games and simulation | Balance tools cannot disagree with actual accounting |
| ARCH-016 | Small tested slices and GitHub Actions | AI-assisted development stays reviewable |
| ARCH-029 | Local-first LAN runtime and SQLite persistence | Same-room LAN play; better-sqlite3 isolated in server persistence; no cloud/PostgreSQL in V1 |
| ARCH-030 | Rotating spotlight orchestration for Standard V1 | Deterministic rotating-seat-v1 turn order, continuous background preparation, atomic single-deal concurrency boundary |

## 25. References

The game specification and subsequent agreed session requirements define this project's behavior. The references below support library capabilities and engineering constraints; they do not claim the game has been implemented or balanced. Documentation reviewed September 8, 2026.

- **R1 - Node.js release lifecycle:** <https://nodejs.org/en/about/previous-releases>
- **R2 - pnpm workspaces and workspace protocol:** <https://pnpm.io/workspaces>
- **R3 - Vite guide and React TypeScript template:** <https://vite.dev/guide/>
- **R4 - React Router declarative installation:** <https://reactrouter.com/start/declarative/installation>
- **R5 - Fastify server factory and underlying server:** <https://fastify.dev/docs/latest/Reference/Server/>
- **R6 - Socket.IO delivery guarantees:** <https://socket.io/docs/v4/delivery-guarantees>
- **R7 - Socket.IO connection-state recovery limitations:** <https://socket.io/docs/v4/connection-state-recovery>
- **R8 - Zod schema validation:** <https://zod.dev/>
- **R9 - Immer produce and immutable state updates:** <https://immerjs.github.io/immer/produce/>
- **R10 - decimal.js arithmetic and rounding configuration:** <https://mikemcl.github.io/decimal.js/>
- **R11 - seedrandom explicit seeds and state restoration:** <https://github.com/davidbau/seedrandom>
- **R12 - SQLite WAL mode and transactions:** <https://www.sqlite.org/wal.html>
- **R13 - better-sqlite3 API and transactions:** <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md>
- **R14 - Vitest guide:** <https://vitest.dev/guide/>
- **R15 - fast-check introduction:** <https://fast-check.dev/docs/introduction/>
- **R16 - Playwright test projects and device configurations:** <https://playwright.dev/docs/test-projects>
- **R17 - Type-aware ESLint configuration:** <https://typescript-eslint.io/getting-started/typed-linting/>
- **R18 - GitHub Actions for Node builds and tests:** <https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs>
- **R19 - Socket.IO server initialization:** <https://socket.io/docs/v4/server-initialization/>
- **R20 - TypeScript project references:** <https://www.typescriptlang.org/docs/handbook/project-references.html>
- **R21 - OWASP session management:** <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- **R22 - OWASP WebSocket security:** <https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html>
- **R23 - React Testing Library:** <https://testing-library.com/docs/react-testing-library/intro/>
- **R24 - SQLite SQL syntax and schema constraints:** <https://www.sqlite.org/lang.html>
- **R25 - TypeScript strict compiler option:** <https://www.typescriptlang.org/tsconfig/strict.html>

## Change log

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | September 5, 2026 | Initial architecture baseline: modular TypeScript stack, package boundaries, deterministic engine, private projections, persistent sessions, host administration, pause/reconnect, testing, CI, and implementation gates. |
| 0.2 | September 8, 2026 | Local-first LAN architecture and SQLite persistence ([ARCH-029]); rotating-seat-v1 spotlight orchestration ([ARCH-030]); single responsive Player View; disconnect/pause simplification without automatic host succession. |

[R1]: https://nodejs.org/en/about/previous-releases
[R2]: https://pnpm.io/workspaces
[R3]: https://vite.dev/guide/
[R4]: https://reactrouter.com/start/declarative/installation
[R5]: https://fastify.dev/docs/latest/Reference/Server/
[R6]: https://socket.io/docs/v4/delivery-guarantees
[R7]: https://socket.io/docs/v4/connection-state-recovery
[R8]: https://zod.dev/
[R9]: https://immerjs.github.io/immer/produce/
[R10]: https://mikemcl.github.io/decimal.js/
[R11]: https://github.com/davidbau/seedrandom
[R12]: https://www.sqlite.org/wal.html
[R13]: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
[R14]: https://vitest.dev/guide/
[R15]: https://fast-check.dev/docs/introduction/
[R16]: https://playwright.dev/docs/test-projects
[R17]: https://typescript-eslint.io/getting-started/typed-linting/
[R18]: https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs
[R19]: https://socket.io/docs/v4/server-initialization/
[R20]: https://www.typescriptlang.org/docs/handbook/project-references.html
[R21]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
[R22]: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
[R23]: https://testing-library.com/docs/react-testing-library/intro/
[R24]: https://www.sqlite.org/lang.html
[R25]: https://www.typescriptlang.org/tsconfig/strict.html
