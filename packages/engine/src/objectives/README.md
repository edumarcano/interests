# Private objective evaluation

`measurePlayerObjectives(state, playerId, evidence)` reads canonical current positions and actual settled observations. `evaluateObjective(measurements, objectiveId)` returns exact numerical checks and an eligibility status. `evaluateAllObjectives` evaluates the same private measurements for all eight objectives. The functions never change balances, history, counters, RNG, revisions or match results.

This module does not execute finales, expose transport payloads, declare a winner or project another player's requirements. Terminal code must authenticate the actor, select their pursued objective, apply the real closing effects and evaluate again before awarding victory. Ordinary eligibility never awards victory.

## Sources and integration

| Input | Authoritative owner | Measurement |
| --- | --- | --- |
| Cash, public funds, business/property ownership and company loans | Current `GameState.finance` | Current face-value liquid capital; attributed assets and liabilities; company equity; control; performing personal-loan principal |
| Employment, work, living costs, investment receipts and company operating profit | Actual `progress.byPlayer[*].quarters` | Last four completed quarters; missing quarters contribute zero, never an annualized projection. Company operating history is deduplicated across its actual owners. |
| Asset-borrower property principal, cash reserves, interest and operating claims | Property accounting adapter | `ObjectivePropertyClaims`, aggregated once per asset. Do not include the legacy personal mortgage here; the state adapter already counts it. |
| Genuine lending exposure and interest received | Loan settlement/funding adapter | `ObjectiveFinancingEvidence`, with lender, beneficial borrower, funded transaction, original supplied capital and actual settled interest receipts. Collection of old interest contributes lifetime received profit but not fresh recurring income. |
| Sales, basis, fees, seasoning and reference quotes | Complete signed transaction ledger | `disposalLedger`, current through the evaluated state's revision. Include losses and all closed disposals, not only profitable transactions. Never reconstruct acquisition age from current holdings or a current-quarter opening value. |

`ObjectiveEvidence` is an internal engine adapter contract, **not a command or browser payload**. Populate it only from persisted canonical funding, settlement and close records. Parent integration must validate and persist these records alongside their owning transitions. No endpoint may accept a caller-supplied supplement as authoritative evidence. Future NPC records use the same economic facts and safeguards, without fabricating historical returns.

Existing raw `realizedGainsCents`, `financingInterestReceivedCents` and `profitableDisposalAssetIds` do not independently establish qualified progress. Missing funding, paid-interest, seasoning or reference evidence contributes no positive qualified progress; evidence gaps remain explicit. A stale ledger, duplicate loan/transaction evidence, inconsistent company history or malformed money rejects measurement. Callers must handle that failure without granting eligibility or exposing private details.

## Approved interpretations

The numerical targets remain owned by `rules/completion.ts`; the newly approved section 18.5 deal-count definitions live in `rules/objectiveQualifications.ts`. The approved clarifications are recorded in canonical documentation commit `478cdc4`, to be integrated by the parent task.

| Requirement | Interpretation |
| --- | --- |
| Recurring sources | Count actual receipts from currently retained economic positions. Fully disposed funds/assets, repaid loans and departed labor cease recurring contribution; no projected future return is substituted. |
| Living-cost protection | Greater of current annual living costs and actual living costs owed in the trailing four completed quarters. Missing quarters contribute zero. |
| Independent | Actual non-employment cash flow after required personal debt service must cover the protected-cost multiple; property mortgage service already deducted from attributed property income is not deducted twice. Require no personal overdue obligations and rely only on performing sources. |
| Founder | Control, attributed equity, actual profit, leverage, positive consecutive quarters and performing status must hold for one company. Profits from different companies cannot be combined to satisfy it. |
| Relevant borrower | Personal overdue obligations gate eligibility. Company arrears gate the qualifying Founder company; property arrears gate the Magnate portfolio. An unrelated passive asset default does not globally veto every other objective. Its distributions are excluded from performing recurring sources. |
| Debt and claims | Deduct personal and attributed asset principal, unpaid interest and operating/work payables once. Omit unpaid labor receivables from objective assets until collected; the canonical payable still exists. Overdue lender claims have zero objective asset value while remaining collectible in canonical state. |
| Lending diversity | Group holdings and recurring income by beneficial borrower. Count a distinct performing funded deal only after at least $50,000 was originally supplied by the player; group its split tranches. Preserve lifetime actually received qualified interest after repayment. |
| Disposal progress | Positive credit requires an actual settled quarter of exposure, genuine economic substance and an independent stake quote for player transfers. Net losses and transaction fees reduce progress. Count a profitable disposal only at $50,000 or more gross proceeds. Genuine non-player bargain cost remains its actual cost. |
| Concentration | Use exact Decimal cross-multiplication. Capital Allocator compares invested holdings with invested equity. Wealth Architect includes cash as a holding against net worth; cash supplies no productive category. Material positive holdings establish productive categories. |

The tests label synthetic eligibility evidence separately from ordinary command history. The ordinary proof runs four real settlement quarters and measures their actual records; it does not claim ordinary reachability, completed finales or M7 balance. Final-command, transport/privacy projection, durable winner/draw and full-match acceptance remain parent integration work.

## Local verification

The evaluator slice passes 34 focused cases and the full 763-test suite on its career foundation. All six package/app TypeScript projects pass. Lint passes with 816 existing and added warnings and three infos; Remora local manifest/hash consistency passes without trusted-source provenance verification.

A separate executable engine harness chooses four real objectives, sends production `BEGIN_ROUND`/`PASS_SPOTLIGHT` commands through four settlements, and evaluates all four players at Q5/revision 24. Both runs produce identical JSON, retain quarters 1–4, report no premature eligible objective and leave the canonical state unchanged. This is artifact evidence for actual history consumption, not a completed finale or ordinary endgame reachability.
