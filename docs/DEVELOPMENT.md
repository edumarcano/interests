# Development status

**Updated:** 2026-11-17
**Active milestone:** 7, full gameplay rules and content  
**Current focus:** Build multiplayer business capital on the reviewed bank/property PR. Operating economy and objective measurement are in progress on separate branches. No PRs merged.

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
| 5 | Bank underwriting, fixed/variable property finance, sale/refinance/renovation | Delivered in open [PR #40](https://github.com/edumarcano/interests/pull/40), stacked on #39; both Remora review axes passed; unmerged |
| 6 | Business expansion, stake sale/issuance, multi-party capital and public bids | Delivered in open [PR #41](https://github.com/edumarcano/interests/pull/41), stacked on #40; both Remora review axes passed; unmerged |
| 7 | Operating economy, recurring private/public content and non-player alternatives | Operating economy, discovery/focus/diligence, ordinary NPC purchases and lending, and unanimous co-purchase integrated locally; matched business exits, landmark content and final review pending |
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

### Packet 7 and 8 integration status

PR #41 remains open and unmerged. Hosted CI run #119 passed on head `c5adba4`. The packet 7 operating economy and acquisition commits are locally rebased as `b831af5` on `codex/m7-npc-lending`, with the lending controller and its browser proof on the same feature branch. Isolated evidence below retains its original test scope.

Packet 8 stays isolated until packet 7 stabilizes. The pure evaluator passed at `5203855`; the Q32 draw passed at `d27e270` with four actual browsers through 164 accepted commands, reload and restart. Property and financing evidence landed in `a2fd825`; dated disposal evidence at `adfa7f9` passed 907 tests on its own branch. The private finale coordinator is in progress. Ordinary command proof for all eight routes and a four-client browser win remain packet 9.

### Shared property acquisition and management checkpoint

Catalogue co-purchase supports cash or an asset mortgage with named funded buyers and negotiated ownership totaling 100%. All buyers confirm the same frozen quote before closing. The lead keeps their own personal reserve; partners may fund purchase costs and the property's debt-service reserve. Joint sale, refinance and renovation then use unanimous owner confirmations. Sale proceeds allocate pro rata; refinance and renovation debit only their explicit initiating payer. Proposal details remain private to their parties, with a public transaction-presence flag for unrelated actions.

On local `codex/m7-shared-acquisition` from `d57d3e8`, the full unit/server suite passed 876 tests. After additional malformed-buyer rejection assertions, all eight focused engine/component cases passed. All 14 production browser scenarios passed. All package typechecks, lint, production build and local harness consistency checks passed. An ordinary four-client 320px browser journey created a bank-backed 60/40 property from unchanged starting balances, restored an unfinished purchase across process restart, and closed a unanimously confirmed joint sale with exact quoted proceeds. No injected asset, reduced threshold or wealth adjustment was used. The earlier synthetic shared-property journey remains targeted coverage for known ownership and earned-rights boundaries. The shared-acquisition commit is integrated into the local packet 7 lending branch; combined packet 7 and hosted checks remain separate.

### Packet 7 operating-economy checkpoint

Implemented on `codex/m7-operating-economy` from career tip `e1d666f`: regime-target rate movement, credit/inflation indicators, next-quarter living/rent indexation, residential opening-property value and occupancy movement, and calibrated starting-business performance. Necessary labor remains fixed; actual operating quarters determine normalized valuations with the original Operator owner-earnings basis. The market/regime stream is unchanged, and the independently labeled operating stream is persisted. ARCH-047 records implementation boundaries.

The three starting-business calibrations use the newly approved local-practice/mature/growth sensitivity assignments and proportional non-labor costs. The Q1 acquisition diagnostic remains fixed, and two synthetic constant-loss scenarios explicitly omit operating dynamics. Managed executive-company content still needs an explicit fixed-labor calibration. This checkpoint does not remove the demonstration fixture, generate recurring cards, activate finales or claim packet 7/M7 completion.

All 758 tests and six package/app typechecks pass. Lint passes with 776 warnings and three infos; the production build and local Remora manifest/hash consistency check pass (trusted-source provenance is not checked). Seven production-build browser scenarios passed, including four recipients seeing the same public economic indicators without an operating stream leak, 320px layout, reload and process restart. An ordinary eight-quarter command journey repeated byte-for-byte, reached Q9 with exactly four recent business observations, and kept fixed labor unchanged while value, revenue, profit, rent, occupancy and rates moved. The six financial-acceptance scenarios still reach Q5; a 25-game, eight-quarter passive batch completed all 200 settlements without failure. Local Remora specification and engineering reviews found no blocking defects within this operating checkpoint; independent integration review remains pending. These are deterministic execution results, not balance or enjoyment findings.

Property PR #40 and packet 6 are not integrated into this isolated branch. Rebase must connect variable-rate resets, effective renovations, catalogue classifications, sold-record exclusion and expansion adjustments to the new boundary. Ordered compatibility versions require reconciliation before publication. No PR has been published, pushed or merged for this checkpoint.

### Packet 7 recurring-content checkpoint

The engine now generates one objective-neutral private card per player each quarter using immutable authored templates, current cash/ownership, focus, recent categories and Q9 pressure. It persists asking prices and typed hidden facts once, supports private focus changes, charges paid stable property/business investigation, expires unused cards with their owner's spotlight and rejects Q33/finished generation. ARCH-048 records the stable state and command contracts.

Ordinary initialization grants no Q1 demonstration company. Legacy transaction, server and browser journeys explicitly select `q1-business-diagnostic`; the financial CLI labels that scenario accordingly. Synthetic shortfall cases remain separate. An ordinary command journey using seed `recurring-proof-0` reaches an affordable local-service-company card in Q4 without injected wealth, pays $249.05 once, reveals its existing facts and creates no asset. Repeated JSON is identical. HTTP/socket/receipt/bootstrap checks preserve private cards and focus; paired-state projection tests hide undisclosed facts and rival card IDs.

The seven production browser regressions pass with ordinary market/career setup and explicitly named legacy diagnostic financial/recovery setup. All 775 tests, six package/app typechecks, production build and seven browser scenarios pass. Lint passes with 831 warnings and three infos; local Remora manifest/hash consistency passes without trusted-source provenance checking. The reproduced privacy-test false positive now checks exact serialized objective IDs, so ordinary “independent seller” prose cannot masquerade as a leaked objective. Local specification and engineering review found no blocking defect within this checkpoint. NPC acquisition/funding closes and financing-supported discovery remain capital/content integration work. Authored asking prices and terms are rules-owned, and discovery never claims a closing quote or grants proceeds. Packet 7 and M7 remain incomplete.

### Packet 7 recurring-card browser checkpoint

The ordinary browser now renders private cards, asking amounts, paid stable facts, expiry and future-focus controls. Pause, insufficient cash, pending commands and explicit retry errors gate investigation. Quick prompts link to career, market or private-finance panels. NPC purchase/funding controls wait for working closing routes. The trusted acquisition helper resolves persisted business/property facts and rule-owned fees by recipient/card ID; business labor is included in after-labor profit, but its un-authored annual split remains `null`.

All 783 tests, six package/app typechecks, production build and eight production-browser journeys pass. Lint passes with 849 warnings and three infos. The new four-client journey verifies ordinary private card discovery and focus, then uses an explicitly labeled offline synthetic card fixture to exercise paid diligence without altering cash, assets or thresholds. It proves the $250 journal charge through the real command/HTTP path, stable facts after reload, rival privacy, pause gating, expiry, Q2 replacement and retained focus. The inspected 320px screenshot has no horizontal overflow. The earlier ordinary Q4 command proof supplies discovery evidence separately. Local split-axis review found no blocking defect in this bounded checkpoint; full capital integration, hosted CI and human validation remain pending.

### Packet 7 capital integration checkpoint

The economy/content stack is rebased onto stable capital checkpoint `b2df61b`. Catalogue property classifications, next-rate variable-loan resets, sold-record exclusion, renovation activation after operating movement and persistent calibrated expansion adjustments are connected. Earned opening entitlements remain unchanged. Fixed bank-origination/servicing fixtures explicitly use the named Q1 diagnostic and omit dynamic operating calibration where they assert constant synthetic profits. All 912 tests and six package/app typechecks pass. Full integrated browser verification follows recurring acquisition execution.

### Packet 7 recurring acquisition checkpoint

Recurring private business/property cards now close through real cash or approved bank finance. The engine owns financial alternatives, quote freshness, same-draft business bank pricing/origination, one-quarter asset and personal reserves, the separate 2% purchase fee, acquisition source/funding evidence and one atomic spotlight/settlement. Business stake basis is actual buyer cash invested; property retains its established gross-price basis convention. Diligence stays optional: pre-investigation bank terms disclose financing without raw operating facts, and paid facts remain fixed. Acquisition uses no same-quarter operating entitlement or bank payment. Candidate discovery admits conservatively bank-fundable cards using existing authored variation bounds without rerolls or objective reads.

Ordinary production-command proof with seed `ordinary-npc-close-0` reaches business cash purchase in Q12, business bank purchase in Q5, property cash purchase in Q14 and variable property finance in Q5. It pays diligence and buys real assets without injected cash, holdings, outcomes or lowered thresholds; repeated JSON is identical. The Q5 business pays $99,650 consideration, $1,993 fee, borrows $59,790 and invests $44,639.81 cash including the retained reserve. Its stake basis is exactly that buyer cash, and the bank liability stays canonical. Cash/bank/basis, private/raw fact boundaries, current-turn authority, unrelated auctions, exhausted counters, duplicate availability and fourth-spotlight rollback have focused protection.

All 927 tests and six package/app typechecks pass, as do production build, lint (1,114 warnings and three infos), diff and local Remora manifest/hash consistency checks. The reproduced discovery performance regression is fixed by checking an already approved maximum before binary search and rejecting impossible equity funding before full quotes; simulation tests pass with unchanged timeouts. All 14 integrated production-browser journeys pass. Ordinary four-client bank-business and cash-property purchases verify paid facts, quote cancellation/confirmation, actual private holdings/loans and process-restart durability. Their inspected screenshots and the existing 320px diligence proof show responsive layouts; rival views omit the created asset IDs. A screenshot also exposed a property-specific label on generic asset bank debt; it now reads “Asset borrower/loan.” The capital browser fixture handles a company-free ordinary opening by actually acquiring a managed NPC company before its separate capital action, preserving four-player proof without a giveaway.

### Packet 7 market-lending checkpoint

The rules own five distinct borrowing requests from a local supplier to a commercial-services company. Eligible seats receive an objective-neutral private offer, with fixed APR based on the opening rate and authored credit spread. Players see the cash commitment, first scheduled payment, on-time interest and repayment-risk category. The exact borrower budget stays internal. `FUND_RECURRING_LOAN` accepts only the card ID and spends the recipient’s actual unreserved cash during their spotlight. The journal ties the advance to the card, close and canonical loan. A borrower can carry only one live loan; another seat offered the same borrower cannot also fund it. Settlement starts the following quarter and records actual principal and interest separately, while retaining unpaid obligations.

The integrated lending and property capacity regression passed all 954 tests. The new four-browser test funded an ordinary private card, saw the exact cash debit, advanced to the first actual payment and restored the private loan and balance after process restart. No synthetic wealth or lowered thresholds were used. Review reproduced a property discovery false positive when an overdue player could cover the conservative purchase price and fee but lacked the required cash reserve. Discovery now checks both cash reserves and genuine bank eligibility. A sole business owner can now explicitly cover an expansion shortfall with personal cash. The contribution and purchase are atomic and retain the ownership dates and earned quarter. Matched business exit, larger authored opportunities, hosted CI and final packet review remain pending.

## M7 completion and M8 handoff

M7 is complete only after production-command journeys demonstrate all eight legal objective routes without injected wealth or reduced thresholds, an ordinary four-client match reaches a valid winner, Q32 produces a durable draw when required, and privacy/retry/restart checks cover the new actions and terminal results. Finale boundary fixtures supplement those journeys rather than replace them.

Keep deterministic accounting and the current family/LAN evidence as regression protection. M8 owns strategy comparisons, empirical balance and repetition findings, numerical tuning from those findings, and real human/physical-device playtest campaigns. No enjoyment, balance or human-duration claim accompanies this M7 policy checkpoint.

The milestone boundaries remain in `ARCHITECTURE.md`; accepted decisions supersede its older OPEN dependency summaries. `GAME_DESIGN.md` and `DECISIONS.md` own policy, while this document records actual progress and evidence.
