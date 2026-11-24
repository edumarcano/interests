import {
  asPlayerId,
  type SharedRecurringAcquisitionTerms,
} from "@interests/shared";
import { expect, it } from "vitest";
import { cents } from "../finance/money";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { assertGameState } from "../invariants/assertGameState";
import { recurringCandidateWeights } from "../opportunities/recurring";
import { getRecurringAcquisitionQuotes } from "../opportunities/recurringPurchase";
import { getReservedCashCents } from "./reservations";

const players = ["player-1", "player-2", "player-3", "player-4"].map(
  asPlayerId,
);
const [lead, rival, partner, other] = players as [
  (typeof players)[number],
  (typeof players)[number],
  (typeof players)[number],
  (typeof players)[number],
];

it("discovers realistic partnership purchases independently of private rival finance", () => {
  const opening = createGame({
    gameId: "shared-recurring-discovery",
    seed: "property-acceptance",
    playerIds: players,
  });
  const templates = recurringCandidateWeights(opening, partner);
  expect(opening.finance.cashByPlayer[partner]).toBe(2_000_000);
  expect(templates.map(({ template }) => template.id)).toContain(
    "local-service-company",
  );
  const privateChange = {
    ...opening,
    finance: {
      ...opening.finance,
      cashByPlayer: { ...opening.finance.cashByPlayer, [other]: cents(0) },
    },
  };
  expect(recurringCandidateWeights(privateChange, partner)).toEqual(templates);
});

it.each(["cash", "bank-fixed", "player-loan"] as const)(
  "closes a genuine ordinary card with named partners using %s only after both confirm the same terms",
  (route) => {
    let state = createGame({
      gameId: "shared-recurring-close",
      seed: "m7-shared-recurring-64",
      playerIds: players,
    });
    function send(
      player: typeof lead,
      command: Parameters<typeof applyPlayerCommand>[2],
    ) {
      const result = applyPlayerCommand(state, player, command);
      if (!result.ok) throw new Error(result.code);
      assertGameState(result.state);
      state = result.state;
      return result;
    }
    for (const player of players)
      send(player, {
        type: "CHOOSE_OBJECTIVE",
        objectiveId: state.players[player]!.offeredObjectiveIds[0],
      });
    send(lead, { type: "BEGIN_ROUND" });
    const card = state.content.cardsByPlayer[lead]!;
    expect(card.templateId).toBe("local-service-company");
    const venue = route === "player-loan" ? "cash" : route;
    const solo = getRecurringAcquisitionQuotes(state, lead, card.id).find(
      (quote) => quote.route === venue,
    )!;
    expect(solo.canClose).toBe(false);
    const common = {
      opportunityId: card.id,
      leadCashCents: 100_000,
      partnerPlayerId: partner,
    };
    const terms: SharedRecurringAcquisitionTerms =
      route === "player-loan"
        ? {
            ...common,
            route: "cash" as const,
            playerLoan: { annualRateBps: 611, termQuarters: 5 },
          }
        : { ...common, route, partnerOwnershipPpm: 600_000 };
    send(lead, { type: "OPEN_SHARED_RECURRING_ACQUISITION", terms });
    const original = state.activeTransaction;
    expect(original?.kind).toBe("shared-recurring-acquisition");
    if (original?.kind !== "shared-recurring-acquisition")
      throw new Error("Missing proposal");
    const firstBinding = {
      transactionId: original.id,
      expectedTermsRevision: 1,
    };
    const confirm = {
      type: "CONFIRM_SHARED_RECURRING_ACQUISITION",
      ...firstBinding,
    } as const;
    expect(
      projectPlayerGameState(state, rival).sharedRecurringAcquisition,
    ).toBeNull();
    expect(
      projectPlayerGameState(state, partner).sharedRecurringAcquisition,
    ).toMatchObject({
      name: "Local service company",
      terms,
      confirmedPlayerIds: [],
    });
    expect(
      projectPlayerGameState(state, partner).sharedRecurringAcquisition?.quote,
    ).not.toHaveProperty("personalReserveCents");
    expect(applyPlayerCommand(state, rival, confirm)).toMatchObject({
      ok: false,
      state,
      journalEntries: [],
    });
    send(lead, confirm);
    send(partner, confirm);
    expect(getReservedCashCents(state, partner)).toBe(
      original.quote.cashRequiredCents - terms.leadCashCents,
    );
    send(lead, {
      type: "REVISE_SHARED_RECURRING_ACQUISITION",
      ...firstBinding,
      terms: terms.playerLoan
        ? { ...terms, playerLoan: { annualRateBps: 612, termQuarters: 5 } }
        : { ...terms, partnerOwnershipPpm: 700_000 },
    });
    expect(getReservedCashCents(state, lead)).toBe(0);
    expect(getReservedCashCents(state, partner)).toBe(0);
    expect(applyPlayerCommand(state, partner, confirm)).toMatchObject({
      ok: false,
      code: "STALE_TERMS_REVISION",
      state,
    });
    const binding = { ...firstBinding, expectedTermsRevision: 2 };
    const close = {
      type: "CLOSE_SHARED_RECURRING_ACQUISITION",
      ...binding,
    } as const;
    send(lead, { ...confirm, ...binding });
    expect(applyPlayerCommand(state, lead, close)).toMatchObject({
      ok: false,
      code: "PROPERTY_CONFIRMATIONS_REQUIRED",
      state,
    });
    send(partner, { ...confirm, ...binding });
    send(partner, {
      type: "WITHDRAW_SHARED_RECURRING_ACQUISITION",
      ...binding,
    });
    expect(getReservedCashCents(state, partner)).toBe(0);
    send(partner, { ...confirm, ...binding });
    state = JSON.parse(JSON.stringify(state)) as typeof state;
    assertGameState(state);
    const before = state;
    const receipt = send(lead, close);
    const assetId = state.content.cardsByPlayer[lead]!.acquiredAssetId!;
    const acquired = state.finance.assetsById[assetId]!;
    const partnerCash = original.quote.cashRequiredCents - terms.leadCashCents;
    expect(acquired.ownershipByPlayerPpm).toEqual(
      route === "player-loan"
        ? { [lead]: 1_000_000 }
        : { [lead]: 300_000, [partner]: 700_000 },
    );
    expect(acquired.cashCents).toBe(original.quote.assetReserveCents);
    expect(state.finance.cashByPlayer[lead]).toBe(
      before.finance.cashByPlayer[lead]! - terms.leadCashCents,
    );
    expect(state.finance.cashByPlayer[partner]).toBe(
      before.finance.cashByPlayer[partner]! - partnerCash,
    );
    if (route === "player-loan") {
      expect(state.progress.byPlayer[lead]!.assetsById[assetId]).toMatchObject({
        costCents: original.quote.cashRequiredCents,
        acquisition: { transactionId: original.id },
      });
      expect(
        state.progress.byPlayer[partner]!.assetsById[assetId],
      ).toBeUndefined();
      expect(Object.values(state.finance.loansById)).toContainEqual(
        expect.objectContaining({
          kind: "player-loan",
          lenderPlayerId: partner,
          borrowerPlayerId: lead,
          originalPrincipalCents: partnerCash,
          annualRateBps: 612,
          termQuarters: 5,
          fundedTransactionId: original.id,
        }),
      );
      expect(
        receipt.journalEntries.filter(
          (entry) => entry.reason === "loan-origination",
        ),
      ).toHaveLength(1);
    } else {
      expect(state.progress.byPlayer[lead]!.assetsById[assetId]).toMatchObject({
        costCents: terms.leadCashCents,
        acquisition: {
          transactionId: original.id,
          buyerCashByPlayer: {
            [lead]: terms.leadCashCents,
            [partner]: partnerCash,
          },
        },
      });
      expect(
        state.progress.byPlayer[partner]!.assetsById[assetId]?.costCents,
      ).toBe(partnerCash);
    }
    expect(
      receipt.journalEntries
        .filter((entry) => entry.reason === "recurring-acquisition-equity")
        .map((entry) => entry.amountCents),
    ).toEqual(
      route === "player-loan"
        ? [original.quote.cashRequiredCents]
        : [terms.leadCashCents, partnerCash],
    );
    expect(
      receipt.journalEntries.filter(
        (entry) => entry.reason === "asset-bank-loan-origination",
      ),
    ).toHaveLength(route === "bank-fixed" ? 1 : 0);
    expect(state.revision).toBe(before.revision + 1);
    expect(applyPlayerCommand(state, lead, close)).toMatchObject({
      ok: false,
      state,
      journalEntries: [],
    });
  },
);
