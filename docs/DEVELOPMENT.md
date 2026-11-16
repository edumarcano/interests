# Development status

**Updated:** 2026-11-15  
**Active milestone:** 7, full gameplay rules and content  
**Current focus:** Business cash distributions (A4) and insolvency/defaults (A5)

## Milestone 6: physical playtest outcome

Four independent devices (Windows host laptop, phone, tablet, Linux laptop) successfully joined and played the same match. Objective selection, synchronized spotlight rotation, business diligence, player financing, completed business acquisition, loan positions, disconnect-triggered pause, reconnect, and host resume worked in physical testing.

Two limitations emerged:

- **Limited content:** The initial private business opportunity is a deterministic Q1 fixture. Later quarters currently offer little to do beyond passing spotlights.
- **Settlement deadlock:** In a second match, the phone purchased the Q1 business using a player loan from the host (10% annual rate, three-quarter term). During Q3, the phone was the final spotlight player; passing returned `INSUFFICIENT_FUNDS` in red and did not advance the match. The final spotlight triggers settlement for *all* players, so the insolvent player and exact unpaid obligation are **not confirmed**. Current settlement rejects the entire quarter rather than handling defaults.

The acquisition and repayment flow is playable, but prolonged financial gameplay remains incomplete.

## Milestone 7: financial foundation

| Area | Approved direction | Decisions still needed |
| --- | --- | --- |
| **A4: business distributions** | Profitable businesses distribute cash quarterly in proportion to ownership while retaining some profits. Newly acquired businesses begin paying their new owners in a subsequent quarter. Avoid double-counting the spendable income already included in starting business-owner profiles. | Distribution/retention formula, treatment of losses and retained company cash, debt service, owner-income normalization, and precise entitlement basis |
| **A5: default and insolvency** | Insufficient cash results in explicit missed payments/defaults and recorded arrears. No invented funds, silent debt forgiveness, or automatic elimination; the game must continue for the table. | Payment priority, partial payments, lender claims and losses, legacy-bank versus player-loan obligations, interest on arrears, recovery/collateral, and what information is visible to other players |

These directions are agreed, **not yet complete executable rules**. Detailed gameplay/accounting decisions remain open in `GAME_DESIGN.md` (A4/A5) and should be settled with concrete examples before implementation; accepted decisions belong in `DECISIONS.md`.

## Near-term development goals

1. Define the A4 quarterly business payout and retained-earnings model, including starting-owner income reconciliation.
2. Define A5 settlement and shortfall treatment for *all* required obligations, not only player-loan installments.
3. Implement the agreed rules across engine and player-facing views, retaining deterministic accounting and private-finance boundaries.
4. Verify the original failure scenario: a four-player Q1 financed purchase, subsequent payouts and repayments/defaults, and successful progression past Q3 without creating or losing money incorrectly.
5. Once the financial foundation holds, expand recurring opportunities and actions across businesses, real estate, career, markets, and financing.

The wider Milestone 7 scope remains defined in `docs/ARCHITECTURE.md`. This document records current progress and next gameplay priorities; `docs/GAME_DESIGN.md` and `docs/DECISIONS.md` remain authoritative for rules and decisions.
