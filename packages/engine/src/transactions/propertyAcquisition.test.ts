import {
  asPlayerId,
  type PropertyAcquisitionCommand,
  type PropertyAcquisitionTerms,
} from "@interests/shared";
import { describe, expect, it } from "vitest";
import { bankBorrowerStrength } from "../finance/bank";
import { cents } from "../finance/money";
import { allocateProportionalCents } from "../finance/ownership";
import { propertyOffers } from "../finance/propertyActions";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState, PropertyAsset } from "../model/gameState";
import { getReservedCashCents } from "./reservations";

const ids = ["A", "B", "C", "D"].map(asPlayerId),
  a = ids[0]!,
  b = ids[1]!,
  c = ids[2]!;
function accepted(
  state: GameState,
  actor: typeof a,
  command: Parameters<typeof applyPlayerCommand>[2],
): GameState {
  const result = applyPlayerCommand(state, actor, command);
  expect(result.ok, result.ok ? undefined : result.code).toBe(true);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  return result.state;
}
function ready(rich = true): GameState {
  let state = createGame({
    gameId: "shared-acquisition",
    seed: "property-acceptance",
    playerIds: ids,
  });
  for (const id of ids)
    state = accepted(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
  if (rich)
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [a]: cents(30_000_000),
          [b]: cents(30_000_000),
        },
      },
    };
  return accepted(state, a, { type: "BEGIN_ROUND" });
}
function tx(state: GameState) {
  const tx = state.activeTransaction;
  if (tx?.kind !== "property-acquisition") throw new Error();
  return tx;
}
function bound(
  state: GameState,
  type: Exclude<
    PropertyAcquisitionCommand["type"],
    "OPEN_PROPERTY_ACQUISITION" | "REVISE_PROPERTY_ACQUISITION"
  >,
): PropertyAcquisitionCommand {
  return {
    type,
    transactionId: tx(state).id,
    expectedTermsRevision: tx(state).termsRevision,
  };
}
function terms(state: GameState, mortgage = true): PropertyAcquisitionTerms {
  const quote = propertyOffers(state, a)[0]!.quotes.find((q) =>
    mortgage
      ? q.principalCents > 0 && q.rateKind === "fixed"
      : q.principalCents === 0,
  )!;
  return {
    catalogueId: "residential-duplex",
    principalCents: quote.principalCents,
    rateKind: quote.rateKind,
    buyers: [
      { playerId: a, cashContributionCents: 1_000_000, ownershipPpm: 600_000 },
      {
        playerId: b,
        cashContributionCents: quote.cashRequiredCents - 1_000_000,
        ownershipPpm: 400_000,
      },
    ],
  };
}
function open(state: GameState, input = terms(state)): GameState {
  return accepted(state, a, {
    type: "OPEN_PROPERTY_ACQUISITION",
    terms: input,
  });
}
function confirm(state: GameState): GameState {
  for (const id of [a, b])
    state = accepted(state, id, bound(state, "CONFIRM_PROPERTY_ACQUISITION"));
  return state;
}
function asset(state: GameState): PropertyAsset {
  return Object.values(state.finance.assetsById).find(
    (asset): asset is PropertyAsset =>
      asset.kind === "property" && asset.catalogueId === "residential-duplex",
  )!;
}

describe("shared catalogue property acquisition", () => {
  it.each([false, true])(
    "closes cash/bank=%s with exact negotiated ownership, funded cash, costs, basis and next-quarter rights",
    (mortgage) => {
      const initial = ready(),
        input = terms(initial, mortgage);
      let state = open(initial, input),
        deal = tx(state);
      expect(state.finance).toBe(initial.finance);
      state = accepted(state, a, bound(state, "CONFIRM_PROPERTY_ACQUISITION"));
      expect(getReservedCashCents(state, a)).toBe(1_000_000);
      expect(getReservedCashCents(state, b)).toBe(0);
      const unconfirmed = applyPlayerCommand(
        state,
        a,
        bound(state, "CLOSE_PROPERTY_ACQUISITION"),
      );
      expect(unconfirmed).toMatchObject({
        ok: false,
        state,
        journalEntries: [],
      });
      state = accepted(state, b, bound(state, "CONFIRM_PROPERTY_ACQUISITION"));
      const closeCommand = bound(state, "CLOSE_PROPERTY_ACQUISITION");
      const result = applyPlayerCommand(state, a, closeCommand);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
      assertGameState(state);
      const property = asset(state);
      expect(property.ownershipByPlayerPpm).toEqual({
        [a]: 600_000,
        [b]: 400_000,
      });
      expect(property.cashCents).toBe(deal.quote.assetReserveCents);
      expect(state.finance.cashByPlayer[a]).toBe(
        initial.finance.cashByPlayer[a]! - 1_000_000,
      );
      expect(state.finance.cashByPlayer[b]).toBe(
        initial.finance.cashByPlayer[b]! -
          input.buyers[1]!.cashContributionCents,
      );
      const shares = allocateProportionalCents(
        cents(input.principalCents),
        property.ownershipByPlayerPpm,
      );
      for (const buyer of input.buyers)
        expect(
          state.progress.byPlayer[buyer.playerId as typeof a]!.assetsById[
            property.id
          ],
        ).toEqual({
          costCents:
            buyer.cashContributionCents + shares[buyer.playerId as typeof a]!,
          acquiredQuarter: 1,
          ownershipPpm: buyer.ownershipPpm,
        });
      expect(
        state.finance.quarterStartBasis.propertiesById[property.id],
      ).toBeUndefined();
      expect(
        result.journalEntries.filter(
          (entry) => entry.reason === "property-equity-funding",
        ),
      ).toHaveLength(2);
      expect(
        result.journalEntries.filter(
          (entry) => entry.reason === "property-purchase-fee",
        ),
      ).toHaveLength(1);
      const loans = Object.values(state.finance.loansById).filter(
        (loan) =>
          loan.kind === "asset-bank-loan" &&
          loan.borrowerAssetId === property.id,
      );
      expect(loans).toHaveLength(mortgage ? 1 : 0);
      if (mortgage) {
        expect(loans[0]).toMatchObject({
          firstDueQuarter: 2,
          termQuarters: 120,
          leadPlayerId: a,
          purpose: "property-mortgage",
        });
        expect(loans[0]).not.toHaveProperty("borrowerPlayerId");
      }
      expect(state.round?.spotlightsCompleted).toBe(1);
      const replay = applyPlayerCommand(state, a, closeCommand);
      expect(replay).toMatchObject({ ok: false, state, journalEntries: [] });
      while (state.currentQuarter === 1)
        state = accepted(state, getActiveSpotlightPlayerId(state)!, {
          type: "PASS_SPOTLIGHT",
        });
      expect(
        state.finance.quarterStartBasis.propertiesById[property.id]!
          .ownershipByPlayerPpm,
      ).toEqual(property.ownershipByPlayerPpm);
      expect(
        state.finance.lastSettlement!.loanPayments.filter(
          (payment) => payment.borrowerAssetId === property.id,
        ),
      ).toHaveLength(0);
    },
  );
  it("binds consent to revisions, allows off-spotlight confirmation/withdrawal and clears all holds on revise/cancel", () => {
    let state = confirm(open(ready()));
    const old = bound(state, "CLOSE_PROPERTY_ACQUISITION");
    state = accepted(state, b, bound(state, "WITHDRAW_PROPERTY_ACQUISITION"));
    expect(getReservedCashCents(state, b)).toBe(0);
    state = accepted(state, a, {
      type: "REVISE_PROPERTY_ACQUISITION",
      transactionId: tx(state).id,
      expectedTermsRevision: 1,
      terms: terms(state, false),
    });
    expect(tx(state).confirmedPlayerIds).toEqual([]);
    expect(getReservedCashCents(state, a)).toBe(0);
    expect(applyPlayerCommand(state, a, old)).toMatchObject({
      ok: false,
      code: "STALE_TERMS_REVISION",
      state,
    });
    state = accepted(state, a, bound(state, "CANCEL_PROPERTY_ACQUISITION"));
    expect(state.activeTransaction).toBeNull();
    expect(state.round?.spotlightsCompleted).toBe(1);
  });
  it("requires exact funding, unique named buyers and 100% ownership without letting partners satisfy the lead's personal reserve", () => {
    const initial = ready(),
      input = terms(initial);
    for (const bad of [
      { ...input, buyers: [input.buyers[0]!, input.buyers[0]!] },
      {
        ...input,
        buyers: input.buyers.map((buyer) => ({
          ...buyer,
          ownershipPpm: 400_000,
        })),
      },
      {
        ...input,
        buyers: input.buyers.map((buyer) => ({
          ...buyer,
          cashContributionCents: buyer.cashContributionCents + 1,
        })),
      },
      { ...input, principalCents: 10_000_000 },
      { ...input, principalCents: 1.5 },
      {
        ...input,
        buyers: input.buyers.map((buyer) => ({
          ...buyer,
          playerId: "toString",
        })),
      },
      {
        ...input,
        buyers: [null, input.buyers[1]!],
      } as unknown as PropertyAcquisitionTerms,
    ])
      expect(
        applyPlayerCommand(initial, a, {
          type: "OPEN_PROPERTY_ACQUISITION",
          terms: bad,
        }),
      ).toMatchObject({ ok: false, state: initial, journalEntries: [] });
    const obligations = bankBorrowerStrength(
      initial,
      a,
    ).personalQuarterlyObligationsCents;
    const poorLead: GameState = {
      ...initial,
      finance: {
        ...initial.finance,
        cashByPlayer: {
          ...initial.finance.cashByPlayer,
          [a]: cents(obligations - 1 + input.buyers[0]!.cashContributionCents),
        },
      },
    };
    expect(
      applyPlayerCommand(poorLead, a, {
        type: "OPEN_PROPERTY_ACQUISITION",
        terms: terms(initial, false),
      }),
    ).toMatchObject({ ok: false, state: poorLead });
    const exactReserve: GameState = {
      ...poorLead,
      finance: {
        ...poorLead.finance,
        cashByPlayer: {
          ...poorLead.finance.cashByPlayer,
          [a]: cents(poorLead.finance.cashByPlayer[a]! + 1),
        },
      },
    };
    expect(
      applyPlayerCommand(exactReserve, a, {
        type: "OPEN_PROPERTY_ACQUISITION",
        terms: terms(initial, false),
      }).ok,
    ).toBe(true);
    const poorPartner = {
      ...initial,
      finance: {
        ...initial.finance,
        cashByPlayer: { ...initial.finance.cashByPlayer, [b]: cents(1) },
      },
    };
    const proposed = open(poorPartner);
    expect(
      applyPlayerCommand(
        proposed,
        b,
        bound(proposed, "CONFIRM_PROPERTY_ACQUISITION"),
      ),
    ).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_AVAILABLE_CASH",
      state: proposed,
    });
  });
  it("keeps buyer terms private, rejects outsiders, and allows changed-price withdrawal/cancel with no partial close", () => {
    const original = confirm(open(ready())),
      unrelated = projectPlayerGameState(original, c);
    expect(unrelated.propertyAcquisition).toBeNull();
    expect(unrelated.hasActiveTransaction).toBe(true);
    expect(
      projectPlayerGameState(original, b).propertyAcquisition!.terms.buyers,
    ).toEqual(tx(original).terms.buyers);
    const changed = {
      ...original,
      finance: {
        ...original.finance,
        cashByPlayer: {
          ...original.finance.cashByPlayer,
          [a]: cents(1_000_000),
        },
      },
    };
    assertGameState(changed);
    expect(projectPlayerGameState(changed, c)).toEqual(unrelated);
    expect(
      applyPlayerCommand(
        changed,
        c,
        bound(changed, "CONFIRM_PROPERTY_ACQUISITION"),
      ),
    ).toMatchObject({
      ok: false,
      code: "PROPERTY_OWNER_REQUIRED",
      state: changed,
    });
    expect(
      applyPlayerCommand(
        changed,
        a,
        bound(changed, "CLOSE_PROPERTY_ACQUISITION"),
      ),
    ).toMatchObject({
      ok: false,
      code: "PROPERTY_QUOTE_CHANGED",
      state: changed,
      journalEntries: [],
    });
    expect(
      getReservedCashCents(
        accepted(changed, a, bound(changed, "WITHDRAW_PROPERTY_ACQUISITION")),
        a,
      ),
    ).toBe(0);
    const overflow = {
      ...original,
      counters: { ...original.counters, journal: Number.MAX_SAFE_INTEGER - 1 },
    };
    expect(
      applyPlayerCommand(
        overflow,
        a,
        bound(overflow, "CLOSE_PROPERTY_ACQUISITION"),
      ),
    ).toMatchObject({ ok: false, state: overflow, journalEntries: [] });
    const corrupt = JSON.parse(JSON.stringify(original)) as GameState;
    if (corrupt.activeTransaction?.kind !== "property-acquisition")
      throw new Error();
    Object.assign(corrupt.activeTransaction.quote, { feeCents: 0 });
    expect(() => assertGameState(corrupt)).toThrow();
  });
  it("reaches shared property from unchanged ordinary profiles with partner funding and then opens a normal joint sale", () => {
    let state = ready(false),
      done = false;
    for (let n = 0; n < 4; n++) {
      const lead = getActiveSpotlightPlayerId(state)!,
        offer = propertyOffers(state, lead)[0]!,
        quote = offer.quotes.find(
          (q) => q.principalCents > 0 && q.rateKind === "fixed",
        )!;
      const reserve = bankBorrowerStrength(
        state,
        lead,
      ).personalQuarterlyObligationsCents;
      const leadCash = Math.min(
        1_000_000,
        state.finance.cashByPlayer[lead]! - reserve,
      );
      const partner = ids.find(
        (id) =>
          id !== lead &&
          state.finance.cashByPlayer[id]! >= quote.cashRequiredCents - leadCash,
      );
      if (partner && leadCash > 0) {
        const input = {
          catalogueId: offer.catalogueId,
          principalCents: quote.principalCents,
          rateKind: quote.rateKind,
          buyers: [
            {
              playerId: lead,
              cashContributionCents: leadCash,
              ownershipPpm: 600_000,
            },
            {
              playerId: partner,
              cashContributionCents: quote.cashRequiredCents - leadCash,
              ownershipPpm: 400_000,
            },
          ],
        };
        const proposed = applyPlayerCommand(state, lead, {
          type: "OPEN_PROPERTY_ACQUISITION",
          terms: input,
        });
        if (proposed.ok) {
          state = proposed.state;
          for (const id of [lead, partner])
            state = accepted(
              state,
              id,
              bound(state, "CONFIRM_PROPERTY_ACQUISITION"),
            );
          state = accepted(
            state,
            lead,
            bound(state, "CLOSE_PROPERTY_ACQUISITION"),
          );
          while (getActiveSpotlightPlayerId(state) !== lead) {
            if (state.round?.stage === "round-start")
              state = accepted(state, a, { type: "BEGIN_ROUND" });
            else
              state = accepted(state, getActiveSpotlightPlayerId(state)!, {
                type: "PASS_SPOTLIGHT",
              });
          }
          state = accepted(state, lead, {
            type: "OPEN_JOINT_PROPERTY",
            assetId: asset(state).id,
            terms: { kind: "sale" },
          });
          done = true;
          break;
        }
      }
      state = accepted(state, lead, { type: "PASS_SPOTLIGHT" });
    }
    expect(done).toBe(true);
    expect(state.activeTransaction?.kind).toBe("joint-property");
  });
});
