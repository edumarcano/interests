# Development status

**Updated:** 2026-11-16
**Active milestone:** 7, full gameplay rules and content  
**Current focus:** Business cash distributions (A4) and insolvency/defaults (A5)

## Milestone 6: physical playtest outcome

Four independent devices (Windows host laptop, phone, tablet, Linux laptop) successfully joined and played the same match. Objective selection, synchronized spotlight rotation, business diligence, player financing, completed business acquisition, loan positions, disconnect-triggered pause, reconnect, and host resume worked in physical testing.

Two limitations emerged:

- **Limited content:** The initial private business opportunity is a deterministic Q1 fixture. Later quarters currently offer little to do beyond passing spotlights.
- **Settlement deadlock:** In a second match, the phone purchased the Q1 business using a player loan from the host (10% annual rate, three-quarter term). During Q3, the phone was the final spotlight player; passing returned `INSUFFICIENT_FUNDS` in red and did not advance the match. The final spotlight triggers settlement for *all* players, so the insolvent player and exact unpaid obligation are **not confirmed**. At that time, settlement rejected the entire quarter rather than handling defaults.

The acquisition and repayment flow is playable, but prolonged financial gameplay remains incomplete.

## Milestone 7: financial foundation

| Area | Approved policy | Remaining work |
| --- | --- | --- |
| **A4: business distributions** | Quarter-start entitlement; first fixture operating settlement Q2; 80% payout / 20% retention after required company obligations; explicit cash, losses and payables | Productive debt-free businesses are implemented. Starting-owner income/debt remains on an explicit temporary legacy policy until integrated work-compensation, company-loan and opening-balance fixtures are reviewed. |
| **A5: default and insolvency** | Current living costs, living arrears, then proportional due bank/mortgage/player claims; partial payments, explicit arrears, ordinary principal interest without interest on interest, private outcomes and later cash recovery | Mandatory shortfalls now settle across engine, persistence and views. Collateral enforcement, bankruptcy, write-offs and broader ownership/financing contracts remain open. |

The first stack delivers **partial A4 and initial A5** under `GAME_DESIGN.md` sections 16.3 and 17.4.2 and ARCH-038. Mandatory shortfalls produce partial payments and persistent private arrears while the quarter advances. Productive debt-free businesses account for operating cash, reserves, losses, payables and quarter-start payout entitlement. Private views show actual distributions, company cash/equity and expected payouts. Simple whole-business transfers preserve company cash and reject unhandled debt or payables. Starting-company calibration remains a later checkpoint; old income/value figures are references rather than permanent targets.

The deterministic four-player financed-purchase probe reaches Q5: no Q1 payout, then $3,000 to the buyer and $750 retained each quarter from Q2. The original three-quarter loan repays on schedule; a two-quarter loan still produces a genuine Q3 shortfall and recovers in Q4. Engine tests cover losses, payables, resale entitlement, cent allocation and private projections. Authenticated server tests cover durable cash/outcomes and duplicate settlement commands. All four browser scenarios pass locally using installed Chrome, including Q5 payouts, 320px layout, private HTTP payloads and unchanged finances after a process restart. The pinned Playwright Chromium binary is absent locally. Physical-device verification of these policies remains outstanding.

## Near-term development goals

1. Prepare and review integrated starting-business fixtures, then replace legacy owner income with separate work compensation, ownership returns and canonical company loans.
2. Consolidate unified financial simulation, browser/restart evidence and physical-device playtesting after that calibration.
3. Expand recurring opportunities and actions across businesses, real estate, career, markets and financing.
4. Resolve broader default, collateral and ownership contracts before adding their executable actions.

The wider Milestone 7 scope remains defined in `docs/ARCHITECTURE.md`. This document records current progress and next gameplay priorities; `docs/GAME_DESIGN.md` and `docs/DECISIONS.md` remain authoritative for rules and decisions.
