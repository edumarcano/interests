# Development status

**Updated:** 2026-11-16
**Active milestone:** 7, full gameplay rules and content  
**Current focus:** Packet 2 state/accounting foundations on `codex/m7-state-foundations`, stacked on open PR #36

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

ARCH-040 records the approved completion boundary; GAME_DESIGN owns the rules. The active runtime still implements the financial slice described above. Policy approval does not supply executable markets, careers, recurring content, objective evaluation or a winner.

| Packet | Deliverable | Current state |
| --- | --- | --- |
| 1 | Canonical completion policy and immutable rule data | Delivered in open [PR #36](https://github.com/edumarcano/interests/pull/36), `codex/m7-completion-policies`; both Remora review axes passed; unmerged; runtime activation unchanged |
| 2 | Entitlements, basis/history, career/focus, financing and terminal contracts | Implemented on `codex/m7-state-foundations`; delivered in open [PR #37](https://github.com/edumarcano/interests/pull/37), stacked on #36; both Remora axes passed; unmerged |
| 3 | Public-fund buy/sell/rebalance, fees and browser controls | Pending |
| 4 | Careers, executive ownership, resignation and equal-cost management conversion | Pending |
| 5 | Bank underwriting, fixed/variable property finance, sale/refinance/renovation | Pending |
| 6 | Business expansion, stake sale/issuance, multi-party capital and public bids | Pending |
| 7 | Operating economy, recurring private/public content and non-player alternatives | Pending; remove Q1 demonstration windfall from ordinary setup |
| 8 | All eight objective evaluators/finales and durable victory/Q32 draw | Pending |
| 9 | Ordinary complete-match journeys, four-client result/restart proof, M7 handoff | Pending |

Each packet requires relevant behavior tests, typecheck, lint, tests and Remora split-axis review. Browser-facing changes also require build and applicable E2E proof. Record actual PR/head/check state here as delivery changes; leave every PR unmerged unless the user explicitly approves merging.

The planning audit on `38bfead` passed typecheck, build, 653 tests and five browser scenarios. Lint passed with existing warnings; Remora's local manifest/hash consistency check passed without trusted-source provenance verification. Loopback server tests required execution outside the sandbox. These are baseline results, not verification of pending M7 features.

### Packet 1 verification

Typecheck and all 657 tests passed. Lint exited successfully with the existing 517 warnings and three infos. The real financial-acceptance CLI ran twice through `node --import tsx`; its outputs matched and all six scenarios reached Q5. This verifies unchanged active behavior, not pending M7 actions. Independent Remora specification and standards reviews passed with no blockers. PR #36 is open and unmerged at `965f5c0`; hosted CI run 108 passed. No merge has occurred. Exact objective threshold assertions will accompany evaluator tests in packet 8.

### Packet 2 verification

Quarter-start property and recurring income/living entitlements, acquisition/disposal evidence, labor/focus state, four-quarter observations and private finance/requirement projections are implemented. The state includes terminal contracts and command rejection; production victory/draw execution remains packet 8. ARCH-041 records ownership and compatibility details.

All 676 tests and typecheck passed. Lint passed with 584 warnings and three infos; build passed. Both independent Remora axes approved after fixing public-close overflow rejection and ownership/basis snapshot reconciliation. Real command execution reached Q6 with exactly Q2-Q5 retained for all four players; repeated output matched. The six financial acceptance scenarios still reach Q5 and repeat identically. All five browser scenarios passed, including ordinary and synthetic distress paths, seat recovery and process restart. PR #37 is open and unmerged; hosted CI is pending. No PR has been merged.

## M7 completion and M8 handoff

M7 is complete only after production-command journeys demonstrate all eight legal objective routes without injected wealth or reduced thresholds, an ordinary four-client match reaches a valid winner, Q32 produces a durable draw when required, and privacy/retry/restart checks cover the new actions and terminal results. Finale boundary fixtures supplement those journeys rather than replace them.

Keep deterministic accounting and the current family/LAN evidence as regression protection. M8 owns strategy comparisons, empirical balance and repetition findings, numerical tuning from those findings, and real human/physical-device playtest campaigns. No enjoyment, balance or human-duration claim accompanies this M7 policy checkpoint.

The milestone boundaries remain in `ARCHITECTURE.md`; accepted decisions supersede its older OPEN dependency summaries. `GAME_DESIGN.md` and `DECISIONS.md` own policy, while this document records actual progress and evidence.
