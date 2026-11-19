# Private objective evaluation

`measurePlayerObjectives(state, playerId, additionalEvidence?)` reads canonical current positions and actual settled observations. `evaluateObjective(measurements, objectiveId)` returns exact numerical checks and an eligibility status. `evaluateAllObjectives` evaluates the same private measurements for all eight objectives. The functions never change balances, history, counters, RNG, revisions or match results.

The recipient projection includes only its selected objective evaluation in `self.financialDetails.objectiveEvaluation`. Before selection, or when safe aggregate arithmetic overflows, that field is null. It never appears in public player summaries. This module does not execute finales, declare a winner or project another player's requirements. Terminal code must authenticate the actor, select their pursued objective, apply the real closing effects and evaluate again before awarding victory. Ordinary eligibility never awards victory.

## Sources and integration

| Input | Authoritative owner | Measurement |
| --- | --- | --- |
| Cash, public funds, business/property ownership and company loans | Current `GameState.finance` | Current face-value liquid capital; attributed assets and liabilities; company equity; control; performing personal-loan principal |
| Employment, work, living costs, investment receipts and company operating profit | Actual `progress.byPlayer[*].quarters` | Last four completed quarters; missing quarters contribute zero, never an annualized projection. Company operating history is deduplicated across its actual owners. |
| Asset-borrower property principal, cash reserves and arrears | `collectPlayerObjectiveEvidence` reads current owned, unsold property records and asset-bank loans | `ObjectivePropertyClaims`, aggregated once per asset. Legacy personal mortgages remain personal liabilities and reduce their related property equity once. Current property accounting has no separate operating-payable record. |
| Genuine player lending exposure and interest received | Canonical `PlayerLoan.fundedTransactionId` and `settledInterestReceipts` | Actual confirmed cash-funded transaction, original supplied capital, current principal and arrears, beneficial borrower, and per-loan paid interest. Collection of old interest contributes lifetime received profit but not fresh recurring income. |
| Sales, basis, fees, seasoning and reference quotes | Complete signed transaction ledger | `disposalLedger`, current through the evaluated state's revision. Include losses and all closed disposals, not only profitable transactions. Never reconstruct acquisition age from current holdings or a current-quarter opening value. |

`ObjectiveEvidence` is an internal engine contract, **not a command or browser payload**. Measurement automatically collects canonical property and funded player-loan evidence. Supplements cannot replace a current property or any registered loan; only future unknown-ID NPC notes and a canonical disposal ledger have an internal integration seam. No endpoint accepts supplemental evidence.

Loan origination initializes an empty receipt history. Actual payment allocation appends the quarter, total interest paid and fresh current interest paid; old unpaid interest is collected first. Snapshot invariants require history for transaction-tagged player loans and validate safe money, unique chronological quarters and current interest no larger than received interest. Old missing history is never reconstructed. Normal snapshot serialization retains these records with their loan.

Quarterly source observations separately mark personal mortgage service already deducted from property income. Asset-bank payoff interest has no personal marker, so refinancing cannot reduce the evaluator's deduction for unrelated required personal debt service.
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

The tests label synthetic eligibility evidence separately from ordinary command history. The ordinary proof runs four real settlement quarters and measures their actual records; it does not claim ordinary reachability, completed finales or M7 balance. Final commands, durable winner/draw and full-match acceptance remain parent integration work. The evaluator and evidence adapters do not change settlement amounts or award eligibility automatically.

## Local verification

The combined evidence branch passes all 897 tests, including 34 evaluator cases and seven canonical-adapter cases. All six package/app TypeScript projects, the production web build and lint pass (lint reports 1,058 warnings and three infos). Adapter tests exercise actual ordinary property purchase/refinancing and confirmed player-funded purchase commands, per-loan receipt retention through repayment, principal exclusion, missing-history rejection and paired-state privacy. The existing arrears/cure regression distinguishes collected old interest from current earned interest.

The executable proof `/tmp/m7-objective-evidence-proof.ts` uses ordinary opening finances, buys a property with a $67,500 asset mortgage and closes a $50,000 player-financed business purchase. Real settlement through Q9 repays the loan, preserves eight actual receipt rows and $4,603.91 lifetime received interest, and removes its recurring source. The server snapshot loader retains the full canonical history and identical measurements. Two runs produce identical JSON (`/tmp/m7-objective-evidence-proof-first.json` and `-second.json`) and leave measurement state unchanged. This proves actual production-command evidence consumption, not ordinary objective reachability or a completed finale.

Four existing Chromium scenarios pass through local HTTP and SQLite-backed server restarts: private stake sale, player-financed stake purchase, sealed auction and ordinary property mortgage with narrow-layout checks. These protect integration compatibility; the engine receipt and snapshot proof specifically establish the new paid-interest history.
