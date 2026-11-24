import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { cents } from "../finance/money";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { getReservedCashCents } from "./reservations";

const players = ["one", "two", "three", "four"].map(asPlayerId);

function send(state: GameState, actor: PlayerId, command: WirePlayerCommand) {
  const outcome = applyPlayerCommand(state, actor, command);
  if (!outcome.ok) throw new Error(outcome.code);
  return outcome;
}

function start() {
  let state = createGame({
    gameId: "capital-test",
    seed: "business-expansion",
    playerIds: players,
  });
  for (const playerId of players) {
    const player = state.players[playerId];
    if (!player) throw new Error("Expected player");
    state = send(state, playerId, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: player.offeredObjectiveIds[0],
    }).state;
  }
  state = send(state, players[0]!, { type: "BEGIN_ROUND" }).state;
  while (state.currentQuarter === 1) {
    const owner = getActiveSpotlightPlayerId(state)!;
    const asset = Object.values(state.finance.assetsById).find(
      (item) =>
        item.kind === "business" &&
        item.ownershipByPlayerPpm[owner] &&
        item.cashPolicyId === "starting-company-v1",
    );
    if (asset?.kind === "business") {
      const [buyer, second, rival] = players.filter(
        (player) => player !== owner,
      );
      if (!buyer || !second || !rival) throw new Error("Expected all seats");
      return { state, owner, asset, buyer, second, rival };
    }
    state = send(state, owner, { type: "PASS_SPOTLIGHT" }).state;
  }
  throw new Error("Expected a normal starting business");
}

function binding(state: GameState) {
  const tx = state.activeTransaction;
  if (tx?.kind !== "business-capital")
    throw new Error("Expected capital proposal");
  return { transactionId: tx.id, expectedTermsRevision: tx.termsRevision };
}

describe("business capital lifecycle", () => {
  it("keeps a former employee's work contract while selling the rest of their stake", () => {
    const { state, owner, asset, buyer, second, rival } = start();
    const advanceToOwner = (initial: GameState, quarter: number) => {
      let current = initial;
      while (
        current.currentQuarter !== quarter ||
        getActiveSpotlightPlayerId(current) !== owner
      ) {
        if (current.currentQuarter > quarter)
          throw new Error("Missed owner spotlight");
        const active = getActiveSpotlightPlayerId(current);
        current = active
          ? send(current, active, { type: "PASS_SPOTLIGHT" }).state
          : send(current, players[0]!, { type: "BEGIN_ROUND" }).state;
      }
      return current;
    };
    let current = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "primary-issuance",
        contributions: [
          {
            playerId: buyer,
            amountCents: 50_000,
            postMoneyOwnershipPpm: 100_000,
          },
          {
            playerId: second,
            amountCents: 50_000,
            postMoneyOwnershipPpm: 100_000,
          },
        ],
      },
    }).state;
    const issue = binding(current);
    for (const participant of [owner, buyer, second])
      current = send(current, participant, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...issue,
      }).state;
    current = send(current, owner, {
      type: "CLOSE_BUSINESS_CAPITAL",
      ...issue,
    }).state;
    const q2 = advanceToOwner(current, 2);
    const terms = {
      kind: "secondary-stake-sale",
      sellerPlayerId: owner,
      buyerPlayerId: buyer,
      ownershipPpm: 800_000,
      priceCents: 100_000,
    } as const;
    const open = {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms,
    } as const;
    expect(applyPlayerCommand(q2, owner, open)).toMatchObject({
      ok: false,
      code: "INVALID_CAPITAL_CONSIDERATION",
    });
    const retired = send(q2, owner, { type: "RESIGN_LABOR" }).state;
    const q3 = advanceToOwner(retired, 3);
    const formerContract = q3.finance.assetsById[asset.id];
    if (formerContract?.kind !== "business") throw new Error("Missing company");
    expect(formerContract.workCompensation).toMatchObject({
      playerId: owner,
      annualCompensationCents: 0,
    });
    let exit = send(q3, owner, open).state;
    const closing = binding(exit);
    for (const participant of [owner, buyer])
      exit = send(exit, participant, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...closing,
      }).state;
    const sold = send(exit, owner, {
      type: "CLOSE_BUSINESS_CAPITAL",
      ...closing,
    });
    expect(sold.state.finance.assetsById[asset.id]).toMatchObject({
      ownershipByPlayerPpm: { [buyer]: 900_000, [second]: 100_000 },
      workCompensation: formerContract.workCompensation,
      annualManagementCostCents: formerContract.annualManagementCostCents,
    });
    expect(
      sold.state.progress.byPlayer[owner]?.assetsById[asset.id],
    ).toBeUndefined();
    const transferred = sold.state.finance.assetsById[asset.id];
    if (transferred?.kind !== "business" || !transferred.workCompensation)
      throw new Error("Expected preserved former worker claim record");
    // Synthetic claim variation for projection only; the sale used ordinary setup funds.
    const outstanding = {
      ...sold.state,
      finance: {
        ...sold.state.finance,
        assetsById: {
          ...sold.state.finance.assetsById,
          [asset.id]: {
            ...transferred,
            workCompensation: {
              ...transferred.workCompensation,
              arrearsCents: cents(12_345),
            },
          },
        },
      },
    };
    expect(
      projectPlayerGameState(outstanding, owner).self.financialDetails
        .formerWorkClaims,
    ).toEqual([{ assetId: asset.id, amountCents: 12_345 }]);
    expect(projectPlayerGameState(outstanding, rival)).toEqual(
      projectPlayerGameState(sold.state, rival),
    );
  });
  it("lets the issuer choose among funded equity offers and settles only confirmed allocations into company cash", () => {
    const { state, owner, asset, buyer, second, rival } = start();
    let current = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "request-equity",
        requests: [
          { amountCents: 50_000 },
          { amountCents: 60_000, invitedInvestorId: second },
        ],
      },
    }).state;
    const assertOffer = (slot: number, postMoneyOwnershipPpm: number) =>
      ({
        type: "OFFER_BUSINESS_EQUITY",
        ...binding(current),
        slot,
        postMoneyOwnershipPpm,
      }) as const;
    current = send(current, buyer, assertOffer(0, 175_000)).state;
    current = send(current, rival, assertOffer(0, 100_000)).state;
    expect(
      applyPlayerCommand(current, rival, assertOffer(1, 100_000)),
    ).toMatchObject({ ok: false, code: "CAPITAL_PARTICIPANT_REQUIRED" });
    current = send(current, second, assertOffer(0, 200_000)).state;
    const limited = {
      ...current,
      finance: {
        ...current.finance,
        cashByPlayer: {
          ...current.finance.cashByPlayer,
          [second]: cents(100_000),
        },
      },
    };
    expect(
      applyPlayerCommand(limited, second, assertOffer(1, 910_000)),
    ).toEqual({
      ok: false,
      code: "INSUFFICIENT_AVAILABLE_CASH",
      state: limited,
      journalEntries: [],
    });
    current = send(current, second, assertOffer(1, 910_000)).state;
    expect(getReservedCashCents(current, second)).toBe(110_000);
    const privateOffer = projectPlayerGameState(
      current,
      buyer,
    ).businessEquityInvitation;
    expect(privateOffer).toMatchObject({
      assetId: asset.id,
      slots: [{ slot: 0, amountCents: 50_000 }],
    });
    expect(privateOffer?.ownOffers).toEqual([
      {
        investorPlayerId: buyer,
        slot: 0,
        postMoneyOwnershipPpm: 175_000,
        selected: false,
      },
    ]);
    expect(projectPlayerGameState(current, buyer).businessCapital).toBeNull();
    expect(
      projectPlayerGameState(current, owner).businessCapital?.equityOffers,
    ).toHaveLength(4);
    const choose = (slot: number, investorPlayerId: PlayerId) =>
      ({
        type: "SELECT_BUSINESS_EQUITY",
        ...binding(current),
        slot,
        investorPlayerId,
      }) as const;
    current = send(current, owner, choose(0, rival)).state;
    expect(applyPlayerCommand(current, owner, choose(1, second))).toEqual({
      ok: false,
      code: "INVALID_CAPITAL_CONSIDERATION",
      state: current,
      journalEntries: [],
    });
    const withdraw = {
      type: "WITHDRAW_BUSINESS_EQUITY",
      ...binding(current),
      slot: 1,
      investorPlayerId: second,
    } as const;
    current = send(current, second, withdraw).state;
    current = send(current, second, assertOffer(1, 125_000)).state;
    const stale = binding(current);
    current = send(current, owner, choose(1, second)).state;
    expect(
      applyPlayerCommand(current, rival, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...stale,
      }),
    ).toMatchObject({ ok: false, code: "STALE_TERMS_REVISION" });
    const exact = binding(current);
    for (const participant of [owner, rival, second])
      current = send(current, participant, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...exact,
      }).state;
    expect(getReservedCashCents(current, second)).toBe(110_000);
    const closed = send(current, owner, {
      type: "CLOSE_BUSINESS_CAPITAL",
      ...exact,
    });
    expect(closed.state.finance.assetsById[asset.id]).toMatchObject({
      ownershipByPlayerPpm: {
        [owner]: 775_000,
        [rival]: 100_000,
        [second]: 125_000,
      },
    });
    expect(
      closed.journalEntries
        .filter((entry) => entry.relatedTransactionId === exact.transactionId)
        .map((entry) => entry.amountCents)
        .sort((a, b) => a - b),
    ).toEqual([50_000, 60_000]);
    expect(closed.state.activeTransaction).toBeNull();
    expect(getReservedCashCents(closed.state, buyer)).toBe(0);
  });
  it("reserves competing and targeted player loan offers and originates only the final selections", () => {
    const { state, owner, asset, buyer, second, rival } = start();
    let draft = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "secondary-stake-sale",
        sellerPlayerId: owner,
        buyerPlayerId: buyer,
        ownershipPpm: 250_000,
        priceCents: 1_000_000,
        loanRequests: [
          { principalCents: 300_000 },
          { principalCents: 200_000, invitedLenderId: second },
        ],
      },
    }).state;
    const originalBinding = binding(draft);
    const offer = (slot: number, annualRateBps: number) =>
      ({
        type: "OFFER_BUSINESS_LOAN",
        ...originalBinding,
        slot,
        annualRateBps,
        termQuarters: 4,
      }) as const;
    draft = send(draft, second, offer(0, 650)).state;
    draft = send(draft, rival, offer(0, 700)).state;
    const insufficient = {
      ...draft,
      finance: {
        ...draft.finance,
        cashByPlayer: { ...draft.finance.cashByPlayer, [second]: 450_000 },
      },
    } as GameState;
    expect(applyPlayerCommand(insufficient, second, offer(1, 500))).toEqual({
      ok: false,
      state: insufficient,
      code: "INSUFFICIENT_AVAILABLE_CASH",
      journalEntries: [],
    });
    expect(applyPlayerCommand(draft, rival, offer(1, 500))).toMatchObject({
      ok: false,
      code: "CAPITAL_PARTICIPANT_REQUIRED",
    });
    draft = send(draft, second, offer(1, 500)).state;
    expect(getReservedCashCents(draft, second)).toBe(500_000);
    expect(getReservedCashCents(draft, rival)).toBe(300_000);
    const rivalView = projectPlayerGameState(draft, rival);
    expect(rivalView.businessCapital).toBeNull();
    expect(rivalView.businessLoanInvitation?.slots).toEqual([
      { slot: 0, principalCents: 300_000 },
    ]);
    expect(
      rivalView.businessLoanInvitation?.ownOffers.map(
        (row) => row.annualRateBps,
      ),
    ).toEqual([700]);
    expect(
      projectPlayerGameState(draft, owner).businessCapital?.loanOffers,
    ).toEqual([]);
    expect(
      projectPlayerGameState(draft, buyer).businessCapital?.loanOffers,
    ).toHaveLength(3);
    expect(
      applyPlayerCommand(draft, owner, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...originalBinding,
      }),
    ).toMatchObject({ ok: false, code: "FINANCING_NOT_READY" });
    draft = send(draft, buyer, {
      type: "SELECT_BUSINESS_LOAN",
      ...binding(draft),
      slot: 0,
      lenderPlayerId: rival,
    }).state;
    draft = send(draft, buyer, {
      type: "SELECT_BUSINESS_LOAN",
      ...binding(draft),
      slot: 1,
      lenderPlayerId: second,
    }).state;
    expect(
      applyPlayerCommand(draft, rival, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...originalBinding,
      }),
    ).toMatchObject({ ok: false, code: "STALE_TERMS_REVISION" });
    const currentBinding = binding(draft);
    for (const player of [buyer, second, rival, owner])
      draft = send(draft, player, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...currentBinding,
      }).state;
    expect(getReservedCashCents(draft, buyer)).toBe(520_000);
    expect(
      projectPlayerGameState(draft, second).businessLoanInvitation?.confirmed,
    ).toBe(true);
    const posted = send(draft, owner, {
      type: "CLOSE_BUSINESS_CAPITAL",
      ...currentBinding,
    });
    const funded = Object.values(posted.state.finance.loansById).filter(
      (loan) =>
        loan.kind === "player-loan" &&
        loan.fundedTransactionId === currentBinding.transactionId,
    );
    expect(funded.map((loan) => loan.originalPrincipalCents)).toEqual([
      300_000, 200_000,
    ]);
    expect(
      posted.journalEntries
        .filter(
          (entry) =>
            entry.relatedTransactionId === currentBinding.transactionId,
        )
        .map((entry) => entry.amountCents),
    ).toEqual([300_000, 200_000, 1_000_000, 20_000, 30_000]);
    expect(getReservedCashCents(posted.state, second)).toBe(0);
    expect(
      posted.state.finance.assetsById[asset.id]?.ownershipByPlayerPpm[buyer],
    ).toBe(250_000);
  });
  it("identifies targeted issuances without projecting private company finances", () => {
    const { state, owner, asset, buyer, rival } = start();
    const draft = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "request-equity",
        requests: [{ amountCents: 50_000, invitedInvestorId: buyer }],
      },
    }).state;
    const changed = {
      ...draft,
      finance: {
        ...draft.finance,
        assetsById: {
          ...draft.finance.assetsById,
          [asset.id]: { ...asset, cashCents: cents(asset.cashCents + 10_000) },
        },
      },
    };
    const view = projectPlayerGameState(draft, buyer);
    expect(view.businessEquityInvitation).toMatchObject({ assetId: asset.id });
    expect(view.businessCapital).toBeNull();
    expect(projectPlayerGameState(changed, buyer)).toEqual(view);
    expect(
      projectPlayerGameState(draft, rival).businessEquityInvitation,
    ).toBeNull();
    expect(projectPlayerGameState(changed, rival)).toEqual(
      projectPlayerGameState(draft, rival),
    );
  });
  it("keeps buyer eligibility private until the borrower acts and prevents overdue funding", () => {
    const { state, owner, asset, buyer, second } = start();
    const overdue = {
      ...state,
      finance: {
        ...state.finance,
        livingArrearsByPlayer: {
          ...state.finance.livingArrearsByPlayer,
          [buyer]: cents(10_000),
        },
      },
    };
    const terms = {
      kind: "secondary-stake-sale" as const,
      sellerPlayerId: owner,
      buyerPlayerId: buyer,
      ownershipPpm: 250_000,
      priceCents: 1_000_000,
      loanRequests: [{ principalCents: 300_000, invitedLenderId: second }],
    };
    const open = {
      type: "OPEN_BUSINESS_CAPITAL" as const,
      assetId: asset.id,
      terms,
    };
    const current = send(state, owner, open).state;
    const opened = applyPlayerCommand(overdue, owner, open);
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("Expected a valid seller proposal");
    expect(projectPlayerGameState(opened.state, owner)).toEqual(
      projectPlayerGameState(current, owner),
    );

    const revise = {
      type: "REVISE_BUSINESS_CAPITAL" as const,
      ...binding(current),
      terms: { ...terms, priceCents: 950_000 },
    };
    const revised = send(opened.state, owner, revise).state;
    expect(projectPlayerGameState(revised, owner)).toEqual(
      projectPlayerGameState(send(current, owner, revise).state, owner),
    );

    const offered = send(revised, second, {
      type: "OFFER_BUSINESS_LOAN",
      ...binding(revised),
      slot: 0,
      annualRateBps: 650,
      termQuarters: 4,
    }).state;
    expect(
      applyPlayerCommand(offered, buyer, {
        type: "SELECT_BUSINESS_LOAN",
        ...binding(offered),
        slot: 0,
        lenderPlayerId: second,
      }),
    ).toEqual({
      ok: false,
      state: offered,
      code: "FINANCING_NOT_READY",
      journalEntries: [],
    });
    expect(
      applyPlayerCommand(offered, owner, {
        type: "CLOSE_BUSINESS_CAPITAL",
        ...binding(offered),
      }),
    ).toEqual({
      ok: false,
      state: offered,
      code: "FINANCING_NOT_READY",
      journalEntries: [],
    });
  });
  it("binds targeted sale terms, protects funds and privacy, and closes only the initiator's spotlight", () => {
    const { state, owner, asset, buyer, rival } = start();
    const terms = {
      kind: "secondary-stake-sale" as const,
      sellerPlayerId: owner,
      buyerPlayerId: buyer,
      priceCents: 1_000_000,
      ownershipPpm: 250_000,
    };
    let active = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      terms,
      assetId: asset.id,
    }).state;
    expect(getReservedCashCents(active, buyer)).toBe(0);
    const v1 = binding(active);
    active = send(active, buyer, {
      type: "CONFIRM_BUSINESS_CAPITAL",
      ...v1,
    }).state;
    expect(getReservedCashCents(active, buyer)).toBe(1_020_000);
    expect(
      projectPlayerGameState(active, buyer).businessCapital
        ?.yourContributionCents,
    ).toBe(1_020_000);
    expect(projectPlayerGameState(active, rival).businessCapital).toBeNull();
    active = send(active, owner, {
      type: "REVISE_BUSINESS_CAPITAL",
      ...v1,
      terms: { ...terms, priceCents: 900_000 },
    }).state;
    expect(getReservedCashCents(active, buyer)).toBe(0);
    expect(
      applyPlayerCommand(active, buyer, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...v1,
      }),
    ).toEqual({
      ok: false,
      code: "STALE_TERMS_REVISION",
      state: active,
      journalEntries: [],
    });
    const v2 = binding(active);
    expect(
      applyPlayerCommand(active, owner, {
        type: "CLOSE_BUSINESS_CAPITAL",
        ...v2,
      }),
    ).toMatchObject({ ok: false, code: "CAPITAL_CONFIRMATIONS_REQUIRED" });
    expect(
      applyPlayerCommand(active, rival, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...v2,
      }),
    ).toMatchObject({ ok: false, code: "CAPITAL_PARTICIPANT_REQUIRED" });
    active = send(active, buyer, {
      type: "CONFIRM_BUSINESS_CAPITAL",
      ...v2,
    }).state;
    active = send(active, owner, {
      type: "CONFIRM_BUSINESS_CAPITAL",
      ...v2,
    }).state;
    const rehydrated = JSON.parse(JSON.stringify(active)) as GameState;
    assertGameState(rehydrated);
    const close = send(rehydrated, owner, {
      type: "CLOSE_BUSINESS_CAPITAL",
      ...v2,
    });
    expect(close.state.revision).toBe(active.revision + 1);
    expect(close.state.activeTransaction).toBeNull();
    expect(
      close.state.finance.assetsById[asset.id]?.ownershipByPlayerPpm[buyer],
    ).toBe(250_000);
    expect(
      close.journalEntries.slice(0, 3).map((entry) => entry.amountCents),
    ).toEqual([900_000, 18_000, 27_000]);
    expect(
      applyPlayerCommand(close.state, owner, {
        type: "CLOSE_BUSINESS_CAPITAL",
        ...v2,
      }),
    ).toMatchObject({
      ok: false,
      code: expect.stringMatching(/NO_ACTIVE_TRANSACTION|WRONG_ROUND_STAGE/),
    });
  });

  it("allows contribution withdrawal and lets only the initiator cancel the contract", () => {
    const { state, owner, asset, buyer, second } = start();
    let active = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "primary-issuance",
        contributions: [
          {
            playerId: buyer,
            amountCents: 20_000,
            postMoneyOwnershipPpm: 100_000,
          },
          {
            playerId: second,
            amountCents: 30_000,
            postMoneyOwnershipPpm: 150_000,
          },
        ],
      },
    }).state;
    const args = binding(active);
    for (const player of [buyer, second, owner])
      active = send(active, player, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...args,
      }).state;
    expect(getReservedCashCents(active, buyer)).toBe(20_000);
    expect(getReservedCashCents(active, second)).toBe(30_000);
    active = send(active, second, {
      type: "WITHDRAW_BUSINESS_CAPITAL",
      ...args,
    }).state;
    expect(getReservedCashCents(active, second)).toBe(0);
    expect(
      applyPlayerCommand(active, owner, {
        type: "CLOSE_BUSINESS_CAPITAL",
        ...args,
      }),
    ).toMatchObject({ ok: false, code: "CAPITAL_CONFIRMATIONS_REQUIRED" });
    const cancel = {
      type: "CANCEL_ACTIVE_TRANSACTION",
      transactionId: args.transactionId,
    } as const;
    expect(applyPlayerCommand(active, buyer, cancel)).toMatchObject({
      ok: false,
      code: "NOT_ACTIVE_SPOTLIGHT",
    });
    const cleared = send(active, owner, cancel);
    expect(cleared.state.activeTransaction).toBeNull();
    expect(getReservedCashCents(cleared.state, buyer)).toBe(0);
    expect(
      cleared.journalEntries.some(
        (entry) => entry.relatedTransactionId === args.transactionId,
      ),
    ).toBe(false);
  });

  it("keeps an agreed issuance intact when final-spotlight settlement fails", () => {
    const { state, owner, asset, buyer, second } = start();
    let current = state;
    while (
      getActiveSpotlightPlayerId(current) !== owner ||
      current.round?.spotlightsCompleted !== 3
    ) {
      if (current.currentQuarter > 4)
        throw new Error("Expected a last spotlight");
      const active = getActiveSpotlightPlayerId(current);
      current = active
        ? send(current, active, { type: "PASS_SPOTLIGHT" }).state
        : send(current, players[0]!, { type: "BEGIN_ROUND" }).state;
    }
    let confirmed = send(current, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "primary-issuance",
        contributions: [
          {
            playerId: buyer,
            amountCents: 20_000,
            postMoneyOwnershipPpm: 100_000,
          },
          {
            playerId: second,
            amountCents: 30_000,
            postMoneyOwnershipPpm: 150_000,
          },
        ],
      },
    }).state;
    const args = binding(confirmed);
    for (const player of [owner, buyer, second])
      confirmed = send(confirmed, player, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...args,
      }).state;
    const close = { type: "CLOSE_BUSINESS_CAPITAL", ...args } as const;
    const exhausted = {
      ...confirmed,
      counters: { ...confirmed.counters, settlement: Number.MAX_SAFE_INTEGER },
    };
    const rejected = applyPlayerCommand(exhausted, owner, close);
    expect(rejected).toEqual({
      ok: false,
      state: exhausted,
      code: "SETTLEMENT_ID_EXHAUSTED",
      journalEntries: [],
    });
    expect(rejected.state).toBe(exhausted);
    expect(getReservedCashCents(rejected.state, second)).toBe(30_000);
    const posted = send(confirmed, owner, close);
    expect(posted.state.currentQuarter).toBe(confirmed.currentQuarter + 1);
    expect(
      posted.state.finance.assetsById[asset.id]?.ownershipByPlayerPpm,
    ).toEqual({
      [owner]: 750_000,
      [buyer]: 100_000,
      [second]: 150_000,
    });
    expect(
      posted.journalEntries
        .filter((entry) => entry.relatedTransactionId === args.transactionId)
        .map((entry) => entry.amountCents)
        .sort((a, b) => a - b),
    ).toEqual([20_000, 30_000]);
  });
});

describe("sealed stake auction", () => {
  it("keeps rival bids sealed, waits for three responses and closes an exact tie at the first bid", () => {
    const { state, owner, asset, buyer, second, rival } = start();
    const opened = send(state, owner, {
      type: "OPEN_BUSINESS_AUCTION",
      assetId: asset.id,
      ownershipPpm: 250_000,
      minimumBidCents: 100_000,
    }).state;
    const tx = opened.activeTransaction;
    if (tx?.kind !== "business-auction")
      throw new Error("Expected sealed auction");
    const response = (bidCents: number | null) =>
      ({
        type: "RESPOND_BUSINESS_AUCTION",
        transactionId: tx.id,
        bidCents,
      }) as const;
    const first = send(opened, buyer, response(120_000)).state;
    expect(getReservedCashCents(first, buyer)).toBe(122_400);
    const otherAmount = send(opened, buyer, response(121_000)).state;
    for (const spectator of [owner, second, rival])
      expect(projectPlayerGameState(first, spectator)).toEqual(
        projectPlayerGameState(otherAmount, spectator),
      );
    expect(
      projectPlayerGameState(first, buyer).businessAuction?.ownResponse,
    ).toEqual({ kind: "bid", amountCents: 120_000 });
    expect(applyPlayerCommand(first, buyer, response(123_000))).toMatchObject({
      ok: false,
      code: "AUCTION_ALREADY_RESPONDED",
      state: first,
    });
    const tied = send(first, second, response(120_000)).state;
    expect(tied.finance).toBe(opened.finance);
    expect(getReservedCashCents(tied, second)).toBe(122_400);
    const restored = JSON.parse(JSON.stringify(tied)) as GameState;
    assertGameState(restored);
    const closed = send(restored, rival, response(null));
    expect(closed.state.revision).toBe(tied.revision + 1);
    expect(closed.state.activeTransaction).toBeNull();
    expect(getReservedCashCents(closed.state, second)).toBe(0);
    expect(
      closed.state.finance.assetsById[asset.id]?.ownershipByPlayerPpm,
    ).toEqual({ [owner]: 750_000, [buyer]: 250_000 });
    expect(
      closed.journalEntries
        .filter((entry) => entry.relatedTransactionId === tx.id)
        .map((entry) => entry.amountCents),
    ).toEqual([120_000, 2_400, 3_600]);
  });

  it("rejects a bid without fee cash and lets only the listing owner cancel and release the reserves", () => {
    const { state, owner, asset, buyer, second } = start();
    const opened = send(state, owner, {
      type: "OPEN_BUSINESS_AUCTION",
      assetId: asset.id,
      ownershipPpm: 250_000,
      minimumBidCents: 100_000,
    }).state;
    const tx = opened.activeTransaction;
    if (tx?.kind !== "business-auction")
      throw new Error("Expected sealed auction");
    const buyerWallet = opened.finance.cashByPlayer[buyer];
    if (buyerWallet === undefined) throw new Error("Expected bid cash");
    expect(
      applyPlayerCommand(opened, buyer, {
        type: "RESPOND_BUSINESS_AUCTION",
        transactionId: tx.id,
        bidCents: buyerWallet,
      }),
    ).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_AVAILABLE_CASH",
      state: opened,
    });
    const active = send(opened, buyer, {
      type: "RESPOND_BUSINESS_AUCTION",
      transactionId: tx.id,
      bidCents: 100_000,
    }).state;
    const cancel = {
      type: "CANCEL_ACTIVE_TRANSACTION",
      transactionId: tx.id,
    } as const;
    expect(applyPlayerCommand(active, second, cancel)).toMatchObject({
      ok: false,
      code: "NOT_ACTIVE_SPOTLIGHT",
      state: active,
    });
    const cancelled = send(active, owner, cancel);
    expect(cancelled.state.activeTransaction).toBeNull();
    expect(getReservedCashCents(cancelled.state, buyer)).toBe(0);
    expect(
      cancelled.state.finance.assetsById[asset.id]?.ownershipByPlayerPpm,
    ).toEqual({ [owner]: 1_000_000 });
    expect(
      cancelled.journalEntries.some(
        (entry) => entry.relatedTransactionId === tx.id,
      ),
    ).toBe(false);
  });
});
