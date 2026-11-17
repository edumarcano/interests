# Simulation harness

`@interests/simulation` measures the authoritative engine. Report format version `0.0.2` separates work pay, ownership distributions, company balances and mandatory claims. All monetary fields use integer cents.

## Passive baseline

`passive-baseline-v1` creates four players, selects each player's first offered objective through `applyAction`, and settles quarters through the trusted `settleQuarter` accounting primitive. It takes no optional actions. Engine faults stop a game and remain visible in the report; insufficient cash records claims and permits later quarters.

```powershell
pnpm --filter @interests/simulation exec tsx src/cli.ts --games 25 --quarters 8 --seed-prefix m7-finance-review
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--scenario` | `passive-baseline-v1` | Passive batch or fixed financial acceptance scenarios |
| `--games` | `1000` | Positive integer game count |
| `--quarters` | `20` | Positive integer settlement horizon |
| `--seed-prefix` | `baseline-v1` | Indexed deterministic seeds; changing it changes the batch |

Use `exec tsx` to save JSON without a package-script command banner:

```powershell
pnpm --filter @interests/simulation exec tsx src/cli.ts --games 25 --quarters 8 --seed-prefix m7-finance-review | Set-Content -Encoding utf8 tmp/finance-report.json
```

The report contains configuration and engine/rules compatibility identifiers. Repeating an identical command on the same versions produces identical JSON. `simulationVersion` identifies the report format independently of engine rules.

## Financial acceptance scenarios

```powershell
pnpm --filter @interests/simulation exec tsx src/cli.ts --scenario finance-acceptance-v1
```

This command runs six fixed-seed scenarios through `applyPlayerCommand`, including rotating spotlights and the final pass that settles each quarter. It rejects batch options because these scenarios have fixed seeds and a Q4 horizon. Output includes opening/final synthetic states, cash journals, settlement outcomes, cash-flow measurements and per-quarter checkpoints; each reaches Q5.

| Scenario | Initialization and purpose |
| --- | --- |
| `financed-acquisition` | Unmodified `m7-planning-1` setup; Q1 purchase with $30,000 buyer cash and a $20,000 player loan, 10% APR, three quarters. The unified starting income makes this purchase affordable. |
| `living-shortfall` | Synthetic zero-resource accounts, no loans, $10 quarterly living costs for one player; records $40 unpaid by Q4. |
| `mortgage-shortfall` | Synthetic zero-resource accounts with the opening mortgage from `m7-diagnostic-5`; claims continue without deleting principal. |
| `cyclic-loans` | Synthetic zero-resource accounts with two opposite $200 loans, 10% APR, two quarters; incoming repayments cannot fund same-quarter payments. |
| `company-loss` | Synthetic zero-reserve starting company with operating losses beyond work pay; preserves company operating/work/loan claims and prevents personal cash calls. |
| `post-maturity-recovery` | Synthetic zero-resource $200 player loan matures in Q3. An explicitly reported $1,000 cash injection at Q4 permits $215 recovery: $200 principal and $15 simple interest. |

Diagnostic initialization removes unrelated resource flows and uses explicit synthetic loans or company performance. These states and the Q4 injection are boundary experiments, not supported player actions, ordinary economic forecasts or observed playtest outcomes. Only `financed-acquisition` is labeled `player-journey`.

## Measurement contracts

| Measurement | Interpretation |
| --- | --- |
| Player cash flows | Actual journal receipts/payments: employment income, company work pay including recovered work arrears, business/property distributions, cash yield, fund dividends, bank and player-loan principal/interest. Unpaid interest is not realized income. |
| Quarter finance observations | Closing living, operating and work arrears; unpaid loan interest and overdue principal; company cash, company principal and engine-calculated company equity. Company balances remain separate from personal cash. |
| Batch `finance.endingBalances` | Sum of each game's final balances, including games that fail before their first settlement. These balances are not cumulative quarterly amounts. |
| Batch finance flows | Sum of actual bank principal/interest and operating-cost payments, retained surplus, missed loan-payment events and claim cures across settled quarters. |
| Claim cures | Count per living account, company operating/work account or loan when an opening arrears balance becomes zero. A later relapse may produce another cure. |
| `liquidNetPositionCents` | Cash + public holdings + nominal player-loan principal/unpaid-interest receivables, less personal bank/player-loan principal, unpaid loan interest and living arrears. Overdue principal is already part of outstanding principal and is not deducted again. Excludes business/property equity and company work claims. |
| Company equity | Engine-calculated operating EV + company cash - company principal, unpaid interest and operating/work payables. This entity total is not added to liquid position. |

Nominal claims are not guaranteed recoverable value. No bad-debt fair-value policy is inferred. Passive results do not establish strategy strength, win probability, objective reachability, enjoyment, session duration or balance.

## Verification boundaries

The financial acceptance tests reconcile personal and company cash against real journal postings, distinguish principal from interest, verify fixed maturity and cure, and repeat each scenario deterministically. Server integration tests verify duplicate commands and recipient-specific HTTP, socket, error and bootstrap payloads across a database restart.

The browser suite has ordinary and explicitly synthetic distress variants of the four-client financed purchase. Both advance through Q4 to Q5, check the $3,000 acquired-business payout and $2,250 accumulated company cash, reload, restart the server, and compare all four private views. The distress variant edits only its stopped temporary test database before Q2; it checks unpaid living costs and matching borrower/lender overdue feedback. The unrelated views exclude those exact claims. A 320px viewport is checked for overflow.

```powershell
pnpm build:web
pnpm test:e2e
```

Browser contexts do not establish physical-device networking, family playability or balance. Repeat a real-device session and strategy playtests separately.
