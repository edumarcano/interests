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
| **A4: business distributions** | Separate work pay and ownership returns; company cash/claims; Q1 starting-company operations; Q2 acquisition fixture; 80/20 surplus split | Integrated starting fixtures and canonical company loans replace legacy owner income. Broader performance, growth, labor-exit and transfer rules remain separate work. |
| **A5: default and insolvency** | Partial payments, explicit living/operating/work/loan claims, ordinary principal interest, fixed maturity and private recovery outcomes | Company operating costs, fixed work pay, old operating claims and company loans now settle before dividends. Collateral enforcement, bankruptcy, write-offs and broader financing contracts remain open. |

ARCH-039 and GAME_DESIGN 16.3.2 record the approved integrated calibration. Opening company loans pay from Q1 to Q28 at 8% fixed APR; debt exists once in the loan registry and company equity derives it. Employment-only recurring income for the three owner profiles is zero. Work compensation and ownership distributions are funded once from company cash. Old saves require their compatible build; no automatic conversion occurs.

The three profiles' ordinary quarterly personal surpluses before cash yield are $6,994.50, $11,548.17 and $3,144.50. Exact starting-fixture tests cover all eight profiles; company tests cover on-time 28-quarter repayment, uncompensated work, arrears cure, privacy and atomic numeric rejection. The original financed acquisition still pays $3,000 and retains $750 from Q2; normalized starting income also makes the shorter original loan affordable. Distress acceptance scenarios must therefore deliberately exercise inadequate resources rather than assume that purchase still defaults.

## Near-term development goals

1. Consolidate financial acceptance scenarios, simulation metrics and four-client durability evidence for the unified company model.
2. Follow up with physical-device and strategy/family playtests; browser emulation does not establish enjoyment or balance.
3. Expand recurring opportunities and actions across businesses, real estate, career, markets and financing.
4. Resolve broader default, collateral and ownership contracts before adding their executable actions.

The wider Milestone 7 scope remains defined in `docs/ARCHITECTURE.md`. This document records current progress and next gameplay priorities; `docs/GAME_DESIGN.md` and `docs/DECISIONS.md` remain authoritative for rules and decisions.
