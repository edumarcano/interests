# Development status

**Updated:** 2026-11-19
**Active milestone:** 7, full gameplay rules and content  
**Current focus:** Verify the combined operating-economy and recurring-content branch for packet 7. Objective finales and terminal persistence are in separate packet 8 worktrees. The M7 stack remains open and unmerged.

## Milestone 6: physical playtest outcome

Four independent devices (Windows host laptop, phone, tablet, Linux laptop) successfully joined and played the same match. Objective selection, synchronized spotlight rotation, business diligence, player financing, completed business acquisition, loan positions, disconnect-triggered pause, reconnect, and host resume worked in physical testing.

Two limitations emerged:

- **Limited content:** The initial private business opportunity is a deterministic Q1 fixture. Later quarters currently offer little to do beyond passing spotlights.
- **Settlement deadlock:** In a second match, the phone purchased the Q1 business using a player loan from the host (10% annual rate, three-quarter term). During Q3, the phone was the final spotlight player; passing returned `INSUFFICIENT_FUNDS` in red and did not advance the match. The final spotlight triggers settlement for *all* players, so the insolvent player and exact unpaid obligation are **not confirmed**. At that time, settlement rejected the entire quarter rather than handling defaults.

The acquisition and repayment flow is playable, but prolonged financial gameplay remains incomplete.

## Milestone 7: financial foundation

| Area | Approved policy | Remaining work |
| --- | --- | --- |
| **A4: business distributions** | Separate work pay and ownership returns; company cash/claims; Q1 starting-company operations; Q2 acquisition fixture; 80/20 surplus split | Starting-company performance, growth, labor exit, ownership and consent are implemented in the open M7 stack. Purchased-company calibration is in progress. |
| **A5: default and insolvency** | Partial payments, explicit living/operating/work/loan claims, ordinary principal interest, fixed maturity and private recovery outcomes | Claims/cash cure, asset bank loans, market lending and shared closing are implemented on the local M7 stack. Foreclosure, bankruptcy, write-offs and secured player loans remain deferred. |

ARCH-039 and GAME_DESIGN 16.3.2 record the approved integrated calibration. Opening company loans pay from Q1 to Q28 at 8% fixed APR; debt exists once in the loan registry and company equity derives it. Employment-only recurring income for the three owner profiles is zero. Work compensation and ownership distributions are funded once from company cash. Old saves require their compatible build; no automatic conversion occurs.

The three profiles' ordinary quarterly personal surpluses before cash yield are $6,994.50, $11,548.17 and $3,144.50. Exact starting-fixture tests cover all eight profiles; company tests cover on-time 28-quarter repayment, uncompensated work, arrears cure, privacy and atomic numeric rejection. The original financed acquisition still pays $3,000 and retains $750 from Q2; normalized starting income also makes the shorter original loan affordable. Distress acceptance scenarios deliberately exercise inadequate resources rather than assume that purchase still defaults.

## Financial acceptance checkpoint

The six fixed-seed scenarios documented in `docs/SIMULATION.md` use the real command/spotlight API and continue through Q4 to Q5. They cover the ordinary financed acquisition and explicitly synthetic living-cost, mortgage, cyclic-loan, company-loss and post-maturity recovery boundaries. The $200 recovery fixture collects $215 in Q4 without compounding unpaid interest. Scenario tests reconcile every personal/company cash posting and repeat deterministically.

A 25-game, eight-quarter passive run completed all 200 settlements without engine failures or missed payments. Repeating the batch and the six acceptance scenarios produced identical JSON. This establishes deterministic execution for those fixtures, not strategy balance.

Four independent Chrome contexts completed ordinary and synthetic distress variants through Q5. The acquired company paid $3,000 per quarter from Q2 and retained $2,250 by Q5. Borrower/lender overdue feedback, unpaid living costs, 320px layout, reload and process restart passed; all four private views survived restart unchanged. Server integration checks cover once-only command settlement and HTTP/socket/bootstrap/error privacy. No new physical-device playtest was performed.

The default Windows test run again hit fork-worker exit code 3221226505; a bounded single-worker full-suite rerun passed all 653 tests. An existing recovery-browser setup synchronization failure passed on targeted rerun. No test-tooling change or claim of resolved worker instability accompanies this financial work.

## M7 completion delivery

ARCH-040 records the approved completion boundary; GAME_DESIGN owns the rules. The local stack implements financial foundations, public markets, careers, bank and property finance, multiplayer capital and recurring economic choices through packet 7. Winning finales and complete-match payment and result proof remain in packets 8 and 9.

| Packet | Deliverable | Current state |
| --- | --- | --- |
| 1 | Canonical completion policy and immutable rule data | Delivered in open [PR #36](https://github.com/edumarcano/interests/pull/36), `codex/m7-completion-policies`; both Remora review axes passed; unmerged; runtime activation unchanged |
| 2 | Entitlements, basis/history, career/focus, financing and terminal contracts | Implemented on `codex/m7-state-foundations`; delivered in open [PR #37](https://github.com/edumarcano/interests/pull/37), stacked on #36; both Remora axes passed; unmerged |
| 3 | Public-fund buy/sell/rebalance, fees and browser controls | Delivered in open [PR #38](https://github.com/edumarcano/interests/pull/38), `codex/m7-public-markets`, stacked on #37; both Remora review axes passed; unmerged |
| 4 | Careers, executive ownership, resignation and equal-cost management conversion | Delivered in open [PR #39](https://github.com/edumarcano/interests/pull/39), `codex/m7-career-labor`, stacked on #38; unmerged |
| 5 | Bank underwriting, fixed/variable property finance, sale/refinance/renovation | Delivered in open [PR #40](https://github.com/edumarcano/interests/pull/40), stacked on #39; both Remora review axes passed; unmerged |
| 6 | Business expansion, stake sale/issuance, multi-party capital and public bids | Delivered in open [PR #41](https://github.com/edumarcano/interests/pull/41), stacked on #40; both Remora review axes passed; unmerged |
| 7 | Operating economy, recurring private/public content and non-player alternatives | Operating economy, discovery, lending, matched exits, larger acquisitions and unanimous co-purchase integrated on `codex/m7-npc-lending`. Managed operating calibration and final integrated verification are in progress. |
| 8 | All eight objective evaluators/finales and durable victory/Q32 draw | Pure evaluation, canonical evidence and durable Q32 draw verified in isolation; the private finale coordinator and route integrations are in progress |
| 9 | Ordinary complete-match journeys, four-client result/restart proof, M7 handoff | Pending |

Each packet requires relevant behavior tests, typecheck, lint, tests and Remora split-axis review. Browser-facing changes also require build and applicable E2E proof. Record actual PR/head/check state here as delivery changes; leave every PR unmerged unless the user explicitly approves merging.

The planning audit on `38bfead` passed typecheck, build, 653 tests and five browser scenarios. Lint passed with existing warnings; Remora's local manifest/hash consistency check passed without trusted-source provenance verification. Loopback server tests required execution outside the sandbox. These are baseline results, not verification of pending M7 features.

### Packet 1 verification

Typecheck and all 657 tests passed. Lint exited successfully with the existing 517 warnings and three infos. The real financial-acceptance CLI ran twice through `node --import tsx`; its outputs matched and all six scenarios reached Q5. This verifies unchanged active behavior, not pending M7 actions. Independent Remora specification and standards reviews passed with no blockers. PR #36 is open and unmerged at `965f5c0`; hosted CI run 108 passed. No merge has occurred. Exact objective threshold assertions will accompany evaluator tests in packet 8.

### Packet 2 verification

Quarter-start property and recurring income/living entitlements, acquisition/disposal evidence, labor/focus state, four-quarter observations and private finance/requirement projections are implemented. The state includes terminal contracts and command rejection; production victory/draw execution remains packet 8. ARCH-041 records ownership and compatibility details.

All 676 tests and typecheck passed. Lint passed with 584 warnings and three infos; build passed. Both independent Remora axes approved after fixing public-close overflow rejection and ownership/basis snapshot reconciliation. Real command execution reached Q6 with exactly Q2-Q5 retained for all four players; repeated output matched. The six financial acceptance scenarios still reach Q5 and repeat identically. All five browser scenarios passed, including ordinary and synthetic distress paths, seat recovery and process restart. PR #37 is open and unmerged; hosted CI run 111 passed on `32b0282`. No PR has been merged.

The three isolated feature worktrees begin at `09b304a`. Integrate and publish in markets → career → bank/property order, rebasing descendants and resolving shared contracts before each verification/review checkpoint. Worktree dependencies reuse local installed packages; invoke their local `node_modules/.bin` tools directly because pnpm's automatic worktree restoration attempts an uncached registry install. No dependencies or lockfile changed.

### Packet 3 verification

`TRADE_PUBLIC_MARKETS` buys, sells or rebalances the three value-balance funds atomically. The engine quotes 25 BPS fees per instrument, capitalizes purchase fees, removes weighted cost basis on sales and retains signed disposal evidence. Cash journals distinguish purchases, sale principal and fees. Opening holdings still determine dividends; closing holdings receive the current quarter's price return. A successful basket finishes the spotlight and the fourth basket settles exactly once.

The browser displays private holdings, basis, yields and server-calculated previews during round start and spotlights. The read-only preview endpoint authenticates the room cookie, derives the recipient, validates origin and respects reserved cash. Confirmation uses the existing revision/idempotency command path and revalidates affordability. Paired projections keep other players' basis and disposal evidence private.

Focused tests cover weighted basis, HALF_UP fees, cash-funded rebalancing, losses, unsafe/malformed inputs, cash reservations, transient posting overflow, journal exhaustion, opening dividends after liquidation and final-settlement rollback. HTTP/socket/SQLite tests persist the last-spotlight trade, journals and settlement once, including receipt retry. A production-build four-browser journey bought Growth Fund for all four players, sold $50 and bought $40 in Q2 with 23 cents in fees and $9.77 net cash received, checked a 320px preview and preserved holdings on reload.

Typecheck, lint, the production build and all six browser scenarios passed. Separate Remora specification and engineering reviews found no blockers after correcting preview rejection for unsafe intermediate cash postings and checking snapshot validation against the room membership. A reproduced timeout bug then led to shared canonical command comparison between browser and server: the browser reuses the original market command ID on retry. All 705 tests and the production four-browser market journey passed with that fix. The quote and execution agree on the trade itself; the final spotlight can still reject the basket if quarter settlement cannot commit. These checks do not establish objective reachability or balance.

PR #38 is open and unmerged. Hosted CI run #115 passed at `f18648a`, including the timeout fix.

### Packet 4 verification

Persistent current-capacity career quotes, acceptance, resignation and owner-work conversion are implemented through authenticated commands and browser controls. Employment replaces the previous labor role; current-quarter earned rights and unpaid worker claims survive. Executive ownership requires $100,000 of secondary consideration plus the separate 2% ($2,000) business purchase fee; cash required and acquisition basis are $102,000 while enterprise value remains $100,000 and company cash remains zero. ARCH-043 owns the contracts and prototype authored terms.

Private finance displays include current and earned income/living costs, funds and basis, properties, company management costs and exact owner-only objective instructions. The instructions include control, protected living costs, source grouping and income exclusions; this packet does not calculate finale eligibility or declare a winner.

PR #39 is open and unmerged at `6bd4101`; hosted CI run #116 passed on that exact head. On public-markets packet 3 at `f18648a`, all 729 unit/integration tests and seven production-build browser scenarios passed, along with lint, all six TypeScript projects and Remora local manifest/hash consistency. Trusted-source provenance was not checked. The browser career journey uses four ordinary clients and a 320-pixel phone viewport, verifies authoritative HTTP amounts and recipient privacy, advances to Q2 once, reloads, and preserves compensation through a real process restart. Existing financial/recovery browser journeys remain passing. A stricter single-labor-role invariant required correcting an explicitly synthetic arrears fixture that previously assigned two active owner-work contracts; its original company now has equal-cost management.

Engine tests cover stable/no-RNG quotes, objective/profile neutrality, funded executive equity and basis, affordability/stale/offturn rejection, one-action spotlight advancement, fourth-action settlement rollback, three starting-owner conversions, partial management payables and retained worker arrears. An ordinary production-command journey reaches a funded executive ownership position without injected wealth. The missing purchase fee was reproduced before repair by a $100,000-only affordability test; the repaired quote rejects that amount, posts the fee separately and rolls back consideration if fee journaling fails. Component tests cover command payloads, timing, disabled/error states and private requirements. Synthetic liquidity/shortfall fixtures are labeled separately from the ordinary career browser journey. Remora specification and engineering reviews found no blockers after the fee correction and integration of the market retry fix.

### Packet 5 verification

Asset-borrower fixed/variable mortgages, current credit-grade/LTV/DSCR underwriting, property cash/reserves, acquisition, sale, performing/no-cash-out refinancing, once-only renovation and voluntary reserve funding are implemented. Three stable authored NPC property quotes make the slice playable before packet 7's recurring generation. Opening balances, the legacy mortgage and the Q1 business fixture retain their existing behavior. ARCH-044 owns the contract; multiplayer sale/refinance consent, shared-property management rights and business actions remain packet 6.

Standalone on the packet 2 foundations, the 694-test suite passed with loopback access, and the production web build passed. Six Chromium scenarios passed, including an ordinary four-client mortgage review, local cancellation and funded close at 320px. Engine cases cover first payment next quarter, canonical asset debt before distributions, shared ownership, property defaults/cash cure, legacy payoff, earned-quarter sale/renovation, fixed/variable pricing and maturity-preserving resets, numeric/permission rejection and paired-state privacy. Server execution persists the real property close, bank journal and retry receipt once; forged terms are rejected. Reproduced browser spotlight setup races now wait for the next active client before continuing; no transport or gameplay workaround is introduced. New property and loan positions remain private. These are local implementation results; no new physical-device or hosted-CI result is claimed. The combined stack at `7829a8b` passed all 747 unit/integration tests and eight production browser scenarios. All six TypeScript projects, lint, the build and the local Remora harness check passed. Specification and engineering reviews found no blocker. PR #40 is stacked on #39, open and mergeable. GitHub CI run #117 passed on head `df98bd6`; the PR remains unmerged.

### Packet 6 verification

Stake sales pay the seller, charge both approved fees, and preserve dated basis and earned ownership. Equity issuance puts funds into the company. Players can make targeted or open cash-backed loan and equity offers, compare eligible offers, and confirm the selected terms. Editing the final terms invalidates the affected confirmations. Shared expansion uses company reserves and raises next-quarter profit. Former working owners can exit ownership after resigning while their unpaid claims and company replacement labor remain intact.

A seller can list a stake at auction; the eligible seats submit one sealed bid or pass. Buyer fees are reserved with the bid, losing holds release at close, and the first accepted bid wins an exact tie. Joint property sale, refinance and renovation require all owners to confirm a frozen quote; sales pay 60/40 or other actual ownership shares and refinance/renovation charge only the named payer. A changed live quote cannot close on stale approval, but the payer can still withdraw and release the hold.

The combined stack at `d57d3e8` passed 868 unit/integration tests, all 13 production Chromium scenarios, typecheck, lint, build and the local Remora harness check. Four-browser runs at 320px closed a $1,000 stake sale, preserved a $500 selected loan at 6.25%, selected $600 equity for 8%, and resolved competing $1,200 bids after a restart. The shared-property browser run used a labeled synthetic ownership fixture, preserved both owners' rights through restart, and reconciled the exact 60/40 payout. Socket, HTTP and SQLite tests cover recipient privacy and receipt retry. Both Remora review axes passed after fixing withdrawal when a refinance quote has changed. PR #41 is open and unmerged. New fixed business loans have canonical servicing and a trusted funded-close primitive; recurring acquisition and an ordinary shared-property purchase path remain in packet 7.

### Packet 7 implementation and verification

PR #41 remains open and unmerged at `c5adba4`; hosted CI run #119 passed. Packet 7 is locally stacked on it under `codex/m7-npc-lending`. ARCH-047 and ARCH-048 describe the operating and discovery contracts. The economy adjusts rates and credit, inflation, occupancy, property value and realized company performance. Rate resets, renovation and expansion preserve the closing quarter’s earned rights. A sole owner may explicitly fund an expansion shortfall from personal cash; the contribution and company expenditure reconcile atomically and preserve ownership dates.

Ordinary setup creates one private card per seat each quarter without the Q1 demonstration company. Focus, capacity and holdings influence later discovery without reading hidden objectives. Diligence reveals stable facts after the fee. Cash and bank acquisition use exact engine quotes and booked cash, fees, reserves, ownership basis and canonical debt. The catalogue includes a $650k residential court, $1.1M commercial center and $1M managed service group; residential and commercial types persist on the owned asset. Shared catalogue purchases take unanimous same-terms buyer commitments, then use the existing mortgage and purchase path with one loan. The lead retains their own personal reserve.

Five fixed-rate market borrowers offer different sizes, terms and repayment risk. Funding spends actual cash and creates one canonical loan; payment starts next quarter. The lender sees scheduled terms and actual payments. Same-borrower repeat funding is blocked while a loan is live. A frozen loan quote retains the base rate used to create it. A seasoned sole-owner company can receive a scarce matched buyer card whose bid remains fixed. The private exit quote shows company cash included, fees, claims/payoff and net proceeds. Closing clears related claims, preserves earned rights and removes the sold company from future operations.

Verified component journeys include an ordinary 60/40 shared bank purchase and joint sale after restart (`96d14c9`), business bank and property cash purchases with paid diligence (`a40dcc8`), market lending through first payment and restart (`0292075`), and an ordinary four-client whole-company exit after cancelled review and restart (`ad89615`). The capacity/funding checkpoint passed 954 integrated tests; the larger-listings and business-exit branches passed 963 and 962 respectively before the final combination. The synthetic fixture uses only supported fields after integration. The current branch still needs a full review and suite at its final exact head.

The `ordinary-npc-close-0` command evidence closed bank-backed purchases in Q5 and cash purchases in Q12/Q14 on the same acquisition implementation. The Q5 company paid $99,650 price, $1,993 fee and $44,639.81 buyer cash with a $59,790 balance-sheet loan. The `landmark-content-0` proof acquired the residential court in Q9, commercial center in Q15 and service group in Q16 through ordinary commands. These receipts prove funded paths and remain tied to their tested content revisions. Browser proofs use production commands and real sessions; explicitly synthetic fixtures cover counter, loan and qualification boundaries.

### Packet 8 integration status

The pure evaluator passed at `5203855`, property/financing evidence at `a2fd825`, and canonical disposal evidence at `adfa7f9` with 907 tests on its isolated branch. The terminal economy port `61d89ab` settles Q32 once, records its actual earnings and skips Q33 rates, plans, basis and random draws. It passed 57 focused engine and UI cases, the SQLite fault/restart integration and an ordinary four-client draw after 164 accepted commands. The private finale coordinator and production adapters remain in progress. Packet 9 still requires ordinary command journeys for every objective and a four-browser legitimate winner with durable public result.

### Packet 7 purchased-company performance

New local, regional, mature-service and Executive ownership companies now use explicit necessary-labor calibration under the existing regime rules. Their closing revenue, after-labor profit, operating value, cash accounting and opening income entitlement stay unchanged. The model begins in acquisition quarter + 1, preserving fourth-spotlight closes and omitting zero-entitlement prehistory. Fixed labor is $60k local/Executive, $180k regional and $360k mature-service; actual stored profit determines the matching variable-cost reference and rational opening multiple. ARCH-048 records the content assumptions.

All 61 focused financial/career cases and six typechecks pass. Lint passes with 1,415 warnings and four infos; local harness and diff checks pass. The full suite passes 984 of 985 tests: the remaining existing server property fixture assumes one holding after a purchase even when the seat already owns an opening property (`matchRoundOrchestration.test.ts:1353`, actual two). That fixture uses no new managed purchase or Executive command; the property fixture correction remains a separate integration step. Five earlier assertions of absent models/null labor now assert exact authored models, and the landmark synthetic card explicitly constructs its own action metadata instead of retaining a generated business buyer.

An ordinary command proof (`managed-proof-0`) repeats byte-for-byte for local purchase in Q3, regional in Q9, mature service group in Q12 and Executive ownership in Q4, followed by two actual earned quarters each. It changes no starting cash/assets, fixed outcomes or thresholds. Actual first-quarter earnings match stored after-labor profit / 4, labor stays fixed, bounded future revenue/profit move, and histories start only after acquisition. This is deterministic accounting evidence; generic valuation integration, complete-match acceptance and human balance findings remain separate.

## M7 completion and M8 handoff

M7 is complete only after production-command journeys demonstrate all eight legal objective routes without injected wealth or reduced thresholds, an ordinary four-client match reaches a valid winner, Q32 produces a durable draw when required, and privacy/retry/restart checks cover the new actions and terminal results. Finale boundary fixtures supplement those journeys rather than replace them.

Keep deterministic accounting and the current family/LAN evidence as regression protection. M8 owns strategy comparisons, empirical balance and repetition findings, numerical tuning from those findings, and real human/physical-device playtest campaigns. No enjoyment, balance or human-duration claim accompanies this M7 policy checkpoint.

The milestone boundaries remain in `ARCHITECTURE.md`; accepted decisions supersede its older OPEN dependency summaries. `GAME_DESIGN.md` and `DECISIONS.md` own policy, while this document records actual progress and evidence.
