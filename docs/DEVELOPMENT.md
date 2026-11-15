# Development status

**Updated:** 2026-11-15  
**Active milestone:** 7, Full rules and content (current focus: financial gameplay foundation)  
**Working mode:** Milestone-driven autonomous development with Remora; no `TASK.md` handoffs required.

This is a **living handoff and progress record**, not a game-rule specification. `docs/GAME_DESIGN.md` owns game rules and unresolved design items; `docs/DECISIONS.md` owns accepted implementation decisions; `docs/ARCHITECTURE.md` owns architecture and milestone definitions; `AGENTS.md` and the installed Remora skills govern agent execution. Do not treat an approved direction below as approval of unspecified financial formulas.

## Current checkpoint

| Area | Status | Evidence or gap |
| --- | --- | --- |
| Milestone 6, browser/LAN vertical slice | Physically validated | Human playtests with host Windows laptop, phone, tablet, and secondary Linux laptop; four independently connected players |
| Multiplayer/recovery | Physically validated | Room join, independent objective choices, synchronized turns, disconnect-triggered pause, reconnect, and host resume |
| First financed acquisition | Physically validated | Q1 diligence, off-spotlight financing, accepted offer (1,000 bps annual rate, three-quarter term), acquired business and mirrored lender/borrower loan views |
| Quarter advancement | Partially validated | Played into Q3; no ongoing opportunity content beyond the one deterministic Q1 fixture |
| Distressed settlement | **Blocked** | At the final Q3 spotlight, Pass Spotlight returned raw `INSUFFICIENT_FUNDS` and the match could not advance |
| Milestone 7, full rules/content | Active, incomplete | Financial distress and business distributions first; recurring opportunity breadth and other open V1 policies follow |

### Reproduction and interpretation

The observed Q3 failure occurs when the final spotlight attempts **global quarterly settlement**, not necessarily because the final spotlight player is insolvent. Current settlement rejects the command atomically if any required obligation cannot be paid; it has no playable default/arrears policy. The affected player's identity and exact unpaid obligation have **not** been determined from the playtest. Do not attribute the failure to the phone borrower without financial-state evidence.

The initial Q1 business purchase is a **deterministic vertical-slice fixture**, not a recurring opportunity generator. Starting profile owners already receive modeled spendable owner income, while separate acquired-business distributions are not implemented. These are current implementation limitations, not indications of a finished financial game.

## Approved M7 direction, pending detailed rule decisions

| Item | Approved product direction | Still requires explicit rule definition |
| --- | --- | --- |
| **A4: business distributions** | Profitable businesses generate quarterly distributions tied to ownership, retain some profit, and provide newly acquired owners with cash flow starting in a subsequent quarter; never double-count opening owner income | Distributable-profit basis and payout/retention percentages, company cash treatment, losses, debt servicing, ownership entitlement timing, interactions with profile owner income |
| **A5: defaults and insolvency** | Shortfalls produce explicit missed-payment/default and arrears consequences, not fabricated cash, silent forgiveness, or automatic player elimination; distressed matches must continue | Cash-flow priority, partial payments versus unpaid balances, legacy bank debt versus player loans, arrears/interest and lender impact, privacy and UI disclosure, recovery and collateral scope |

These principles were approved after the four-device playtests. **A4/A5 are not yet fully specified or marked resolved in the canonical design/decision register.** The coding agent should inspect those sources, propose a small coherent prototype rule set with numeric examples and invariants, and obtain approval for material choices within its coding-agent conversation before implementing them. Routine engineering choices do not require approval. Record accepted rules in `GAME_DESIGN.md` and `DECISIONS.md`; keep this document concise.

## Autonomous development workflow

1. **Orient:** Read `AGENTS.md`, this document, relevant canonical specifications, current `main`, and existing PR/branch status. Do not assume previous agent chats or a local `TASK.md` exist.
2. **Plan within the milestone:** Use Remora planning as needed. Own the technical decomposition and order of work; surface only genuine unapproved product rules or material architectural changes.
3. **Execute end to end:** Use Remora implementation, regression, review, and PR workflows. Agents may create branches, commits, push changes, open **multiple stacked PRs**, and repair their own findings for work authorized by the active milestone. GitHub Issues are optional; a saved plan is not a precondition.
4. **Preserve boundaries:** No direct commits to `main`, no automatic merges, no unapproved irreversible migrations or design rules. Each stacked PR should declare its base/dependency, be narrowly reviewable, and pass the checks relevant to that branch state.
5. **Checkpoint:** Update this document after substantial verified progress or a change in active focus. Report actual evidence, open PRs, unresolved decisions, and the next resume point, not raw CI transcripts.

## Immediate execution priorities

1. Resolve and document the smallest coherent A4 distribution/accounting policy, explicitly reconciling starting owner income and acquisition entitlement timing.
2. Resolve and document A5 settlement/default/arrears policy across all obligatory payments (not just player loans), so one player's insolvency cannot deadlock the table.
3. Implement the engine, rules, authoritative projections, persistence/version migrations where required, and understandable privacy-safe player UX in reviewable slices. Regression-test deterministic posting, no invented money, no double-counting, idempotence/retries, privacy, and rejected-command immutability.
4. Prove a multiquarter flow: four players, Q1 financed acquisition, subsequent business cash flow, scheduled loan installments or recorded shortfalls, and progression beyond the previously blocked Q3 settlement. Use automated tests plus a subsequent physical-device acceptance test.
5. Continue the remainder of M7 full rules and recurring content only after the financial foundation is coherent. Do not mark the whole M7 milestone complete just because A4/A5 work.

**Resume cue for a coding agent:** "Continue Interests' active milestone using `AGENTS.md`, `docs/DEVELOPMENT.md`, the canonical game rules/decisions, and the current Git/PR state. Plan and execute the next authorized coherent set of PRs; stop only for genuinely unresolved core rules or approval to merge."
