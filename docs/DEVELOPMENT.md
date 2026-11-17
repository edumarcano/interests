# Development status

**Updated:** 2026-11-17
**Active milestone:** 7, full gameplay rules and content  
**Current focus:** Integrate career/labor and bank/property on the public-markets PR; prepare multiplayer capital. No PRs merged.

## Milestone 6: physical playtest outcome

Four independent devices (Windows host laptop, phone, tablet, Linux laptop) successfully joined and played the same match. Objective selection, synchronized spotlight rotation, business diligence, player financing, completed business acquisition, loan positions, disconnect-triggered pause, reconnect, and host resume worked in physical testing.

Two limitations emerged:

- **Limited content:** The initial private business opportunity is a deterministic Q1 fixture. Later quarters currently offer little to do beyond passing spotlights.
- **Settlement deadlock:** In a second match, the phone purchased the Q1 business using a player loan from the host (10% annual rate, three-quarter term). During Q3, the phone was the final spotlight player; passing returned `INSUFFICIENT_FUNDS` in red and did not advance the match. The final spotlight triggers settlement for *all* players, so the insolvent player and exact unpaid obligation are **not confirmed**. At that time, settlement rejected the entire quarter rather than handling defaults.

The acquisition and repayment flow is playable, but prolonged financial gameplay remains incomplete.

## Milestone 7: financial foundation

| Area | Approved policy | Remaining work |
| --- | --- | --- |
| **A4: business distributions** | Separate work pay and ownership returns; company cash/claims; Q1 starting-company operations; Q2 acquisition fixture; 80/20 surplus split | Approved in ARCH-040; performance, growth, labor exit and ownership actions await implementation. |
| **A5: default and insolvency** | Partial payments, explicit living/operating/work/loan claims, ordinary principal interest, fixed maturity and private recovery outcomes | Claims/cash cure retained; broader financing/ownership await implementation. Foreclosure, bankruptcy, write-offs and secured player loans are deferred. |

ARCH-039 and GAME_DESIGN 16.3.2 record the approved integrated calibration. Opening company loans pay from Q1 to Q28 at 8% fixed APR; debt exists once in the loan registry and company equity derives it. Employment-only recurring income for the three owner profiles is zero. Work compensation and ownership distributions are funded once from company cash. Old saves require their compatible build; no automatic conversion occurs.

The three profiles' ordinary quarterly personal surpluses before cash yield are $6,994.50, $11,548.17 and $3,144.50. Exact starting-fixture tests cover all eight profiles; company tests cover on-time 28-quarter repayment, uncompensated work, arrears cure, privacy and atomic numeric rejection. The original financed acquisition still pays $3,000 and retains $750 from Q2; normalized starting income also makes the shorter original loan affordable. Distress acceptance scenarios deliberately exercise inadequate resources rather than assume that purchase still defaults.

## Financial acceptance checkpoint

The six fixed-seed scenarios documented in `docs/SIMULATION.md` use the real command/spotlight API and continue through Q4 to Q5. They cover the ordinary financed acquisition and explicitly synthetic living-cost, mortgage, cyclic-loan, company-loss and post-maturity recovery boundaries. The $200 recovery fixture collects $215 in Q4 without compounding unpaid interest. Scenario tests reconcile every personal/company cash posting and repeat deterministically.

A 25-game, eight-quarter passive run completed all 200 settlements without engine failures or missed payments. Repeating the batch and the six acceptance scenarios produced identical JSON. This establishes deterministic execution for those fixtures, not strategy balance.

Four independent Chrome contexts completed ordinary and synthetic distress variants through Q5. The acquired company paid $3,000 per quarter from Q2 and retained $2,250 by Q5. Borrower/lender overdue feedback, unpaid living costs, 320px layout, reload and process restart passed; all four private views survived restart unchanged. Server integration checks cover once-only command settlement and HTTP/socket/bootstrap/error privacy. No new physical-device playtest was performed.

The default Windows test run again hit fork-worker exit code 3221226505; a bounded single-worker full-suite rerun passed all 653 tests. An existing recovery-browser setup synchronization failure passed on targeted rerun. No test-tooling change or claim of resolved worker instability accompanies this financial work.

## M7 completion delivery

ARCH-040 records the approved completion boundary; GAME_DESIGN owns the rules. The local runtime implements financial foundations, public-fund trading, career/labor choices and bank/property transactions. Recurring content, objective evaluation and winner execution remain pending.

| Packet | Deliverable | Current state |
| --- | --- | --- |
| 1 | Canonical completion policy and immutable rule data | Delivered in open [PR #36](https://github.com/edumarcano/interests/pull/36), `codex/m7-completion-policies`; both Remora review axes passed; unmerged; runtime activation unchanged |
| 2 | Entitlements, basis/history, career/focus, financing and terminal contracts | Implemented on `codex/m7-state-foundations`; delivered in open [PR #37](https://github.com/edumarcano/interests/pull/37), stacked on #36; both Remora axes passed; unmerged |
| 3 | Public-fund buy/sell/rebalance, fees and browser controls | Delivered in open [PR #38](https://github.com/edumarcano/interests/pull/38), `codex/m7-public-markets`, stacked on #37; both Remora review axes passed; unmerged |
| 4 | Careers, executive ownership, resignation and equal-cost management conversion | Delivered in open [PR #39](https://github.com/edumarcano/interests/pull/39), `codex/m7-career-labor`, stacked on #38; unmerged |
| 5 | Bank underwriting, fixed/variable property finance, sale/refinance/renovation | Implemented and reviewed on `codex/m7-bank-property`, stacked on #39; unmerged |
| 6 | Business expansion, stake sale/issuance, multi-party capital and public bids | In progress on `codex/m7-business-capital`; sole-owner expansion and stake arithmetic verified locally |
| 7 | Operating economy, recurring private/public content and non-player alternatives | Pending; remove Q1 demonstration windfall from ordinary setup |
| 8 | All eight objective evaluators/finales and durable victory/Q32 draw | Pending |
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

Standalone on the packet 2 foundations, the 694-test suite passed with loopback access, and the production web build passed. Six Chromium scenarios passed, including an ordinary four-client mortgage review, local cancellation and funded close at 320px. Engine cases cover first payment next quarter, canonical asset debt before distributions, shared ownership, property defaults/cash cure, legacy payoff, earned-quarter sale/renovation, fixed/variable pricing and maturity-preserving resets, numeric/permission rejection and paired-state privacy. Server execution persists the real property close, bank journal and retry receipt once; forged terms are rejected. Reproduced browser spotlight setup races now wait for the next active client before continuing; no transport or gameplay workaround is introduced. New property and loan positions remain private. These are local implementation results; no new physical-device or hosted-CI result is claimed. The combined stack at `7829a8b` passed all 747 unit/integration tests and eight production browser scenarios. All six TypeScript projects, lint, the build and the local Remora harness check passed. Specification and engineering reviews found no blocker. The branch is stacked on #39 and remains unmerged.

### Packet 6 checkpoint

The local `EXPAND_BUSINESS` engine path spends a sole owner's company reserves, keeps the current quarter's operating inputs and activates the profit increase at the following quarter boundary. A fixed-seed command test spends $4,000 in company cash for $1,000 more annual profit. Q1 personal receipts match the no-expansion control, and Q2 records $250 more operating profit. Invalid or unfunded requests and final-spotlight settlement failure leave the original state unchanged. Separate stake helpers transfer and dilute exact ownership shares and preserve proportional cost and acquisition dates when disposing of a position. The helpers still need wiring into the transaction lifecycle; browser controls, shared-company consent, financing slots and public bidding remain open. This branch starts from packet 3 and must be rebased onto packet 5 before publication.

## M7 completion and M8 handoff

M7 is complete only after production-command journeys demonstrate all eight legal objective routes without injected wealth or reduced thresholds, an ordinary four-client match reaches a valid winner, Q32 produces a durable draw when required, and privacy/retry/restart checks cover the new actions and terminal results. Finale boundary fixtures supplement those journeys rather than replace them.

Keep deterministic accounting and the current family/LAN evidence as regression protection. M8 owns strategy comparisons, empirical balance and repetition findings, numerical tuning from those findings, and real human/physical-device playtest campaigns. No enjoyment, balance or human-duration claim accompanies this M7 policy checkpoint.

The milestone boundaries remain in `ARCHITECTURE.md`; accepted decisions supersede its older OPEN dependency summaries. `GAME_DESIGN.md` and `DECISIONS.md` own policy, while this document records actual progress and evidence.
