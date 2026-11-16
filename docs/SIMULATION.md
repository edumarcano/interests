# Simulation Harness Documentation

The `@interests/simulation` package provides deterministic, headless measurement tools for Standard V1 gameplay. It orchestrates the authoritative `@interests/engine` without bypassing or re-implementing game or financial rules.

## Scenario: `passive-baseline-v1`

The `passive-baseline-v1` scenario measures how Standard V1 opening positions evolve when players complete initial setup and take no optional gameplay actions beyond quarterly financial settlement.

### Setup and Execution Policy

1. Call the authoritative engine `createGame()`;
2. Complete objective selection through the real `applyAction()` API;
3. For each player in canonical `playerOrder`, select `player.offeredObjectiveIds[0]`;
4. After setup reaches `ready-for-first-round`, take no optional gameplay actions;
5. Sequentially call the real engine `settleQuarter()` until the requested horizon is reached or the engine rejects settlement;
6. Record engine settlement failures as measurements rather than patching or modifying state.

---

## CLI Usage

### Standard Run (1,000 games × 20 quarters)

```powershell
pnpm --filter @interests/simulation simulate -- --games 1000 --quarters 20 --seed-prefix baseline-v1
```

### Smaller Development Run

```powershell
pnpm --filter @interests/simulation simulate -- --games 25 --quarters 8 --seed-prefix dev
```

### Saving JSON Output in PowerShell

To capture the UTF-8 JSON report to a local file in PowerShell without encoding corruption:

```powershell
pnpm --filter @interests/simulation simulate -- --games 1000 --quarters 20 --seed-prefix baseline-v1 | Set-Content -Encoding utf8 baseline-report.json
```

or:

```powershell
pnpm --filter @interests/simulation simulate -- --games 1000 --quarters 20 --seed-prefix baseline-v1 | Out-File -Encoding utf8 baseline-report.json
```

---

## Interpretation Guidelines

The `passive-baseline-v1` simulation is a diagnostic measurement tool, not a game-balance or victory verdict.

### What This Baseline Measures

- **Passive Cash Accumulation:** Net cash accumulation from baseline recurring personal income and living expenses;
- **Debt Amortization:** Scheduled amortization of opening legacy personal debt and Property Starter mortgage;
- **Property Operating Distributions:** Net cash distributions received by property owners from scheduled rent and occupancy;
- **Cash Yield:** Interest earned on quarter-start cash balances at the base rate minus spread floor;
- **Public-Market Dividends:** Dividend cash yield earned on quarter-start public fund balances;
- **Public-Market Revaluation:** Mark-to-market portfolio value changes driven by regime returns and bounded uniform noise;
- **Shared Macroeconomic Path:** Economy regime occupancy and Markov transitions over time;
- **Liquidity Boundaries:** Minimum cash balances observed during the run and any insolvency/overflow settlement rejections.

### What This Baseline Does NOT Measure

- **Strategy Strength:** There are no simulated strategic player choices;
- **Win Probability / Win Rate:** No culmination or victory evaluation is modeled;
- **Objective Success Rate:** Objective culminations are not attempted;
- **Opportunity Quality:** No opportunities are generated, evaluated, or taken;
- **Trading Skill:** No public-market buy or sell actions occur;
- **Financing / Negotiation:** No new debt is originated, refinanced, or renegotiated;
- **Career Progression:** No salary increases, promotions, or career switches occur;
- **Universal Net Worth:** The reported `liquidNetPositionCents` metric measures only liquid capital (`cash + public market value + player loan receivables - legacy debt - player loan debt`) and explicitly excludes property and business equity.

## Mandatory shortfalls in M7

Insufficient cash now records partial payments and arrears while the simulation continues. Actual engine faults (such as exhausted IDs or arithmetic overflow) still stop a run and are reported as failures. Living-expense cash metrics include payments of earlier arrears. Player snapshots separate principal debt/receivables from unpaid living and interest obligations and nominal unpaid-interest receivables; liquid net position includes those claims once. Nominal receivables are not guaranteed recoverable value or realized interest profit. Company equity and broader distress/balance reports remain outside this narrow metric.
