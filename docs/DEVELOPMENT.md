# Development status

**Updated:** 2026-11-16
**Active milestone:** 7, full gameplay rules and content  
**Current focus:** Business cash distributions (A4) and insolvency/defaults (A5)

## Milestone 6: physical playtest outcome

Four independent devices (Windows host laptop, phone, tablet, Linux laptop) successfully joined and played the same match. Objective selection, synchronized spotlight rotation, business diligence, player financing, completed business acquisition, loan positions, disconnect-triggered pause, reconnect, and host resume worked in physical testing.

Two limitations emerged:

- **Limited content:** The initial private business opportunity is a deterministic Q1 fixture. Later quarters currently offer little to do beyond passing spotlights.
- **Settlement deadlock:** In a second match, the phone purchased the Q1 business using a player loan from the host (10% annual rate, three-quarter term). During Q3, the phone was the final spotlight player; passing returned `INSUFFICIENT_FUNDS` in red and did not advance the match. The final spotlight triggers settlement for *all* players, so the insolvent player and exact unpaid obligation are **not confirmed**. Current settlement rejects the entire quarter rather than handling defaults.

The acquisition and repayment flow is playable, but prolonged financial gameplay remains incomplete.

## Milestone 7: financial foundation

| Area | Approved policy | Remaining work |
| --- | --- | --- |
| **A4: business distributions** | Quarter-start entitlement; first fixture operating settlement Q2; 80% payout / 20% retention after required company obligations; explicit cash, losses and payables | Implement productive debt-free businesses. Keep starting-owner income/debt on an explicit temporary legacy policy until integrated work-compensation, company-loan and opening-balance fixtures are reviewed. |
| **A5: default and insolvency** | Current living costs, living arrears, then proportional due bank/mortgage/player claims; partial payments, explicit arrears, ordinary principal interest without interest on interest, private outcomes and later cash recovery | Replace table-wide shortfall rejection across engine, persistence and views. Collateral enforcement, bankruptcy, write-offs and broader ownership/financing contracts remain open. |

These policies are approved in `GAME_DESIGN.md` sections 16.3 and 17.4.2 and ARCH-038. Policy approval is not implementation evidence: the current engine still skips business distributions and rejects mandatory cash shortfalls. The first stack records policies, implements defaults, then implements productive debt-free businesses. Starting-company calibration is a later checkpoint; old income/value figures are references rather than permanent targets.

## Near-term development goals

1. Implement the approved A4 business payout, reserves, entitlement and loss model without double-paying starting owners.
2. Implement approved A5 shortfall treatment for *all* current mandatory obligations, not only player-loan installments.
3. Implement the agreed rules across engine and player-facing views, retaining deterministic accounting and private-finance boundaries.
4. Verify the original failure scenario: a four-player Q1 financed purchase, subsequent payouts and repayments/defaults, and successful progression past Q3 without creating or losing money incorrectly.
5. Once the financial foundation holds, expand recurring opportunities and actions across businesses, real estate, career, markets, and financing.

The wider Milestone 7 scope remains defined in `docs/ARCHITECTURE.md`. This document records current progress and next gameplay priorities; `docs/GAME_DESIGN.md` and `docs/DECISIONS.md` remain authoritative for rules and decisions.
