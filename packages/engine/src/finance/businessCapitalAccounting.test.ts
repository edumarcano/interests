import { asPlayerId, asTransactionId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { assertGameState } from "../invariants/assertGameState";
import { postBusinessCapitalConsideration } from "./businessCapitalAccounting";
import { cents } from "./money";

const seats = ["one", "two", "three", "four"].map(asPlayerId);
const transaction = asTransactionId("transaction-1");

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected seeded fixture value");
  return value;
}

function setup() {
  const state = createGame({
    gameId: "business-expansion",
    seed: "business-expansion",
    playerIds: seats,
  });
  const asset = Object.values(state.finance.assetsById).find(
    (value) =>
      value.kind === "business" && value.cashPolicyId === "starting-company-v1",
  );
  if (!asset || asset.kind !== "business")
    throw new Error("Expected opening company");
  const seller = seats.find(
    (seat) => asset.ownershipByPlayerPpm[seat] === 1_000_000,
  );
  const buyer = seats.find(
    (seat) =>
      seat !== seller &&
      requireValue(state.finance.cashByPlayer[seat]) >= 1_020_000,
  );
  if (!seller || !buyer) throw new Error("Expected owner and funded buyer");
  return { state, asset, seller, buyer };
}

describe("business capital close accounting", () => {
  it("pays the seller and both fees while keeping company cash and earned ownership", () => {
    const { state, asset, seller, buyer } = setup();
    const result = postBusinessCapitalConsideration(
      state,
      asset.id,
      transaction,
      {
        kind: "secondary-stake-sale",
        buyerPlayerId: buyer,
        sellerPlayerId: seller,
        ownershipPpm: 250_000,
        priceCents: 1_000_000,
      },
    );
    if (!result.ok) throw new Error(result.code);
    assertGameState(result.state);
    expect(result.journalEntries.map((e) => e.amountCents)).toEqual([
      1_000_000, 20_000, 30_000,
    ]);
    expect(result.state.finance.cashByPlayer[buyer]).toBe(
      requireValue(state.finance.cashByPlayer[buyer]) - 1_020_000,
    );
    expect(result.state.finance.cashByPlayer[seller]).toBe(
      requireValue(state.finance.cashByPlayer[seller]) + 970_000,
    );
    expect(result.state.finance.assetsById[asset.id]).toMatchObject({
      ownershipByPlayerPpm: { [seller]: 750_000, [buyer]: 250_000 },
      cashCents: asset.cashCents,
    });
    expect(result.state.finance.quarterStartBasis).toBe(
      state.finance.quarterStartBasis,
    );
    const sold = requireValue(result.state.progress.byPlayer[seller]);
    expect(sold.disposals.at(-1)).toMatchObject({
      transactionId: transaction,
      grossProceedsCents: 1_000_000,
      proceedsCents: 970_000,
      costCents: Math.round(
        requireValue(
          requireValue(state.progress.byPlayer[seller]).assetsById[asset.id],
        ).costCents / 4,
      ),
    });
    expect(
      requireValue(result.state.progress.byPlayer[buyer]).assetsById[asset.id],
    ).toMatchObject({
      costCents: 1_020_000,
      ownershipPpm: 250_000,
    });
  });

  it("issues fee-free capital to company cash, preserving acquisition ages and existing costs", () => {
    const { state, asset, seller, buyer } = setup();
    const result = postBusinessCapitalConsideration(
      state,
      asset.id,
      transaction,
      {
        kind: "primary-issuance",
        contributions: [
          {
            playerId: buyer,
            amountCents: 1_000_000,
            postMoneyOwnershipPpm: 200_000,
          },
          { playerId: seller, amountCents: 100, postMoneyOwnershipPpm: 1_000 },
        ],
      },
    );
    if (!result.ok) throw new Error(result.code);
    assertGameState(result.state);
    expect(result.journalEntries).toHaveLength(2);
    expect(
      result.journalEntries.every((e) => e.destination.kind === "business"),
    ).toBe(true);
    expect(result.state.finance.assetsById[asset.id]).toMatchObject({
      ownershipByPlayerPpm: { [seller]: 800_000, [buyer]: 200_000 },
      cashCents: asset.cashCents + 1_000_100,
      enterpriseValueCents: asset.enterpriseValueCents,
    });
    const sellerProgress = requireValue(result.state.progress.byPlayer[seller]);
    const owner = requireValue(sellerProgress.assetsById[asset.id]);
    expect(owner.slices).toEqual([
      {
        ...requireValue(state.progress.byPlayer[seller]).assetsById[asset.id],
        ownershipPpm: 799_000,
      },
      {
        acquiredQuarter: state.currentQuarter,
        costCents: 100,
        objectiveCostFloorCents: 28_500,
        ownershipPpm: 1_000,
      },
    ]);
    expect(owner.acquiredQuarter).toBe(state.currentQuarter);
    expect(result.state.finance.quarterStartBasis).toBe(
      state.finance.quarterStartBasis,
    );
    const invalid = {
      ...result.state,
      progress: {
        byPlayer: {
          ...result.state.progress.byPlayer,
          [seller]: {
            ...sellerProgress,
            assetsById: {
              ...sellerProgress.assetsById,
              [asset.id]: { ...owner, costCents: cents(owner.costCents + 1) },
            },
          },
        },
      },
    };
    expect(() => assertGameState(invalid)).toThrow(
      "Acquisition slices do not reconcile",
    );
  });

  it("rejects the whole sale if the purchase fee cannot post after consideration", () => {
    const { state, asset, seller, buyer } = setup();
    const unaffordable = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyer]: cents(1_000_000),
        },
      },
    };
    expect(
      postBusinessCapitalConsideration(unaffordable, asset.id, transaction, {
        kind: "secondary-stake-sale",
        buyerPlayerId: buyer,
        sellerPlayerId: seller,
        ownershipPpm: 250_000,
        priceCents: 1_000_000,
      }),
    ).toEqual({
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      state: unaffordable,
      journalEntries: [],
    });
  });
});
