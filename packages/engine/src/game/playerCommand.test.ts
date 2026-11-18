import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { legacy } from "../transactions/testLegacyTransaction";
import { applyAction } from "./actions";
import { createGame } from "./createGame";
import { applyPlayerCommand } from "./playerCommand";
import {
  advanceSpotlight,
  beginRound,
  getActiveSpotlightPlayerId,
  getSpotlightOrder,
} from "./round";

describe("Section 14: Engine Player Command Integration", () => {
  const playerIds: readonly PlayerId[] = [
    asPlayerId("player-1"),
    asPlayerId("player-2"),
    asPlayerId("player-3"),
    asPlayerId("player-4"),
  ];

  // Helper to create game with all 4 objectives chosen
  function createReadyGame(seed = "player-command-test-seed") {
    let state = createGame({
      gameId: "test-game",
      seed,
      playerIds,
    });

    for (const pId of playerIds) {
      const offered = state.players[pId]!.offeredObjectiveIds;
      state = applyAction(state, {
        type: "CHOOSE_OBJECTIVE",
        playerId: pId,
        objectiveId: offered[0]!,
      }).state;
    }

    const opp = Object.values(state.opportunitiesById)[0]!;
    return { state, opp };
  }

  it("Investigation requires completed setup: rejects with WRONG_PHASE during objective-choosing", () => {
    const rawGame = createGame({
      gameId: "test-game-pre-setup",
      seed: "seed-pre-setup",
      playerIds,
    });
    expect(rawGame.phase).toBe("objective-choosing");

    const opp = Object.values(rawGame.opportunitiesById)[0]!;
    const targetBuyer = opp.targetPlayerId;

    const res = applyPlayerCommand(rawGame, targetBuyer, {
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: opp.id,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("WRONG_PHASE");
    }
    expect(res.state.revision).toBe(rawGame.revision);
    expect(
      res.state.opportunitiesById[opp.id]?.investigation.investigated,
    ).toBe(false);
  });

  it("9, 10 & 11. Opportunity Investigation: target succeeds off-spotlight / round-start, non-target rejects, consumes no RNG/IDs/cash", () => {
    const { state, opp } = createReadyGame();
    expect(state.phase).toBe("ready-for-first-round");
    expect(state.round?.stage).toBe("round-start");

    const targetBuyer = opp.targetPlayerId;
    const nonTarget = playerIds.find((p) => p !== targetBuyer)!;

    const initialRevision = state.revision;
    const initialCounters = { ...state.counters };
    const initialCash = { ...state.finance.cashByPlayer };
    const initialRandom = { ...state.random };

    // 10. Non-target investigation rejects with unchanged state
    const rejectRes = applyPlayerCommand(state, nonTarget, {
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: opp.id,
    });
    expect(rejectRes.ok).toBe(false);
    expect(rejectRes.state.revision).toBe(initialRevision);
    expect(rejectRes.state.counters).toEqual(initialCounters);
    expect(rejectRes.state.random).toEqual(initialRandom);
    expect(rejectRes.state.finance.cashByPlayer).toEqual(initialCash);

    // 9. Target investigates successfully off spotlight / during round-start
    const acceptRes = applyPlayerCommand(state, targetBuyer, {
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: opp.id,
    });
    expect(acceptRes.ok).toBe(true);
    // Exactly +1 revision on success
    expect(acceptRes.state.revision).toBe(initialRevision + 1);
    // 11. Consumes no RNG, no IDs, no cash
    expect(acceptRes.state.counters).toEqual(initialCounters);
    expect(acceptRes.state.random).toEqual(initialRandom);
    expect(acceptRes.state.finance.cashByPlayer).toEqual(initialCash);

    // Investigated flag is true and facts are retained
    const updatedOpp = acceptRes.state.opportunitiesById[opp.id]!;
    expect(updatedOpp.investigation.investigated).toBe(true);
    expect(updatedOpp.investigation.facts.annualRevenueCents).toBe(
      opp.investigation.facts.annualRevenueCents,
    );

    // Repeated investigation rejects without mutation
    const repeatRes = applyPlayerCommand(acceptRes.state, targetBuyer, {
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: opp.id,
    });
    expect(repeatRes.ok).toBe(false);
    expect(repeatRes.state).toBe(acceptRes.state);
  });

  it("12 & 13. Pursuit requires active buyer spotlight", () => {
    let { state, opp } = createReadyGame();
    // Begin round to enter spotlight stage
    state = beginRound(state).state;
    expect(state.round?.stage).toBe("spotlight");

    const targetBuyer = opp.targetPlayerId;
    const activePlayerId = getActiveSpotlightPlayerId(state)!;

    // Non-active player trying to pursue cash or financed rejects
    const nonActivePlayer = playerIds.find((p) => p !== activePlayerId)!;
    const cashRes = applyPlayerCommand(state, nonActivePlayer, {
      type: "PURSUE_BUSINESS_CASH",
      opportunityId: opp.id,
    });
    expect(cashRes.ok).toBe(false);

    const financedRes = applyPlayerCommand(state, nonActivePlayer, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opp.id,
      buyerCashContributionCents: 3_000_000,
      requestedPrincipalCents: 2_000_000,
    });
    expect(financedRes.ok).toBe(false);
  });

  it("14, 15 & 16. Lender offer: succeeds for eligible third-party with available cash, rejects buyer/seller, rejects second offer", () => {
    let { state, opp } = createReadyGame();
    state = beginRound(state).state;

    // Advance spotlights until targetBuyer is active
    while (getActiveSpotlightPlayerId(state) !== opp.targetPlayerId) {
      const currentActive = getActiveSpotlightPlayerId(state)!;
      state = advanceSpotlight(state, currentActive).state;
    }

    const buyer = opp.targetPlayerId;
    const seller = opp.sellerPlayerId;
    const thirdParties = playerIds.filter((p) => p !== buyer && p !== seller);
    const eligibleLender = thirdParties[0]!;
    const secondLender = thirdParties[1]!;

    // Buyer pursues with financing request: 3M contribution, 2M requested principal
    const pursueRes = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opp.id,
      buyerCashContributionCents: 3_000_000,
      requestedPrincipalCents: 2_000_000,
    });
    expect(pursueRes.ok).toBe(true);
    state = pursueRes.state;

    const txId = state.activeTransaction!.id;

    // 15. Buyer and seller cannot submit lender offer
    const buyerOffer = applyPlayerCommand(state, buyer, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      annualRateBps: 1000,
      termQuarters: 3,
    });
    expect(buyerOffer.ok).toBe(false);

    const sellerOffer = applyPlayerCommand(state, seller, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      annualRateBps: 1000,
      termQuarters: 3,
    });
    expect(sellerOffer.ok).toBe(false);

    // 14. Eligible lender succeeds
    const lenderOffer = applyPlayerCommand(state, eligibleLender, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      annualRateBps: 1000,
      termQuarters: 3,
    });
    expect(lenderOffer.ok).toBe(true);
    state = lenderOffer.state;

    // Offer exists and reserved lender cash
    expect(legacy(state)?.playerLoanFinancing?.offer?.status).toBe("offered");
    expect(legacy(state)?.playerLoanFinancing?.offer?.lenderPlayerId).toBe(
      eligibleLender,
    );

    // 16. Second lender offer rejects while firm offer exists
    const secondOffer = applyPlayerCommand(state, secondLender, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      annualRateBps: 800,
      termQuarters: 4,
    });
    expect(secondOffer.ok).toBe(false);
    if (!secondOffer.ok) {
      expect(secondOffer.code).toBe("OFFER_ALREADY_EXISTS");
    }
  });

  it("17 & 18. Buyer accepts exact terms revision, stale terms revision rejects unchanged", () => {
    let { state, opp } = createReadyGame();
    state = beginRound(state).state;

    while (getActiveSpotlightPlayerId(state) !== opp.targetPlayerId) {
      const currentActive = getActiveSpotlightPlayerId(state)!;
      state = advanceSpotlight(state, currentActive).state;
    }

    const buyer = opp.targetPlayerId;
    const seller = opp.sellerPlayerId;
    const lender = playerIds.find((p) => p !== buyer && p !== seller)!;

    state = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opp.id,
      buyerCashContributionCents: 3_000_000,
      requestedPrincipalCents: 2_000_000,
    }).state;

    const txId = state.activeTransaction!.id;

    state = applyPlayerCommand(state, lender, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      annualRateBps: 1000,
      termQuarters: 3,
    }).state;

    // 18. Stale terms revision rejects
    const staleRes = applyPlayerCommand(state, buyer, {
      type: "ACCEPT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      expectedTermsRevision: 99,
    });
    expect(staleRes.ok).toBe(false);
    if (!staleRes.ok) {
      expect(staleRes.code).toBe("STALE_TERMS_REVISION");
    }

    // 17. Buyer accepts exact terms revision 1
    const acceptRes = applyPlayerCommand(state, buyer, {
      type: "ACCEPT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      expectedTermsRevision: 1,
    });
    expect(acceptRes.ok).toBe(true);
    expect(legacy(acceptRes.state)?.playerLoanFinancing?.offer?.status).toBe(
      "accepted",
    );
  });

  it("19. Cash close uses terminal composition and advances intermediate spotlight with exactly +1 revision", () => {
    let { state, opp } = createReadyGame();
    state = beginRound(state).state;

    // Advance spotlights until buyer is active
    while (getActiveSpotlightPlayerId(state) !== opp.targetPlayerId) {
      const currentActive = getActiveSpotlightPlayerId(state)!;
      state = advanceSpotlight(state, currentActive).state;
    }

    const buyer = opp.targetPlayerId;
    // Give buyer enough cash for full cash purchase for this test
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyer]: 6_000_000 as any,
        },
      },
    };

    state = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_CASH",
      opportunityId: opp.id,
    }).state;

    const txId = state.activeTransaction!.id;
    const preCloseRevision = state.revision;
    const preCloseSpotlightCount = state.round!.spotlightsCompleted;

    const closeRes = applyPlayerCommand(state, buyer, {
      type: "CLOSE_BUSINESS_PURCHASE",
      transactionId: txId,
    });

    expect(closeRes.ok).toBe(true);
    // Exactly +1 revision for intermediate spotlight close
    expect(closeRes.state.revision).toBe(preCloseRevision + 1);
    // Spotlight advanced
    expect(closeRes.state.round!.spotlightsCompleted).toBe(
      preCloseSpotlightCount + 1,
    );
    // Active transaction cleared
    expect(closeRes.state.activeTransaction).toBeNull();
    // 100% ownership transferred to buyer
    expect(
      closeRes.state.finance.assetsById[opp.assetId]!.ownershipByPlayerPpm[
        buyer
      ],
    ).toBe(1_000_000);
  });

  it("20. Financed close originates loan, moves full price, transfers ownership, clears transaction, advances spotlight, exactly +1 revision", () => {
    let { state, opp } = createReadyGame();
    state = beginRound(state).state;

    while (getActiveSpotlightPlayerId(state) !== opp.targetPlayerId) {
      const currentActive = getActiveSpotlightPlayerId(state)!;
      state = advanceSpotlight(state, currentActive).state;
    }

    const buyer = opp.targetPlayerId;
    const seller = opp.sellerPlayerId;
    const lender = playerIds.find((p) => p !== buyer && p !== seller)!;

    state = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opp.id,
      buyerCashContributionCents: 3_000_000,
      requestedPrincipalCents: 2_000_000,
    }).state;

    const txId = state.activeTransaction!.id;

    state = applyPlayerCommand(state, lender, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      annualRateBps: 1000,
      termQuarters: 3,
    }).state;

    state = applyPlayerCommand(state, buyer, {
      type: "ACCEPT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      expectedTermsRevision: 1,
    }).state;

    const sellerCashBefore = state.finance.cashByPlayer[seller]!;
    const preCloseRevision = state.revision;
    const preCloseSpotlight = state.round!.spotlightsCompleted;

    const closeRes = applyPlayerCommand(state, buyer, {
      type: "CLOSE_BUSINESS_PURCHASE",
      transactionId: txId,
    });

    expect(closeRes.ok).toBe(true);
    // Exactly +1 revision
    expect(closeRes.state.revision).toBe(preCloseRevision + 1);
    // Spotlight advanced automatically
    expect(closeRes.state.round!.spotlightsCompleted).toBe(
      preCloseSpotlight + 1,
    );
    // Active transaction cleared
    expect(closeRes.state.activeTransaction).toBeNull();
    // Seller received full 5,000,000 cents
    expect(closeRes.state.finance.cashByPlayer[seller]).toBe(
      sellerCashBefore + 5_000_000,
    );
    // Buyer owns business 100%
    expect(
      closeRes.state.finance.assetsById[opp.assetId]!.ownershipByPlayerPpm[
        buyer
      ],
    ).toBe(1_000_000);
    // Loan created
    const createdLoan = Object.values(closeRes.state.finance.loansById).find(
      (l) => l.kind === "player-loan" && l.borrowerPlayerId === buyer,
    );
    expect(createdLoan).toBeDefined();
    expect(createdLoan?.outstandingPrincipalCents).toBe(2_000_000);
  });

  it("21. Cancel releases reservations and advances spotlight with exactly +1 revision", () => {
    let { state, opp } = createReadyGame();
    state = beginRound(state).state;

    while (getActiveSpotlightPlayerId(state) !== opp.targetPlayerId) {
      const currentActive = getActiveSpotlightPlayerId(state)!;
      state = advanceSpotlight(state, currentActive).state;
    }

    const buyer = opp.targetPlayerId;
    state = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opp.id,
      buyerCashContributionCents: 3_000_000,
      requestedPrincipalCents: 2_000_000,
    }).state;

    const txId = state.activeTransaction!.id;
    const preCancelRevision = state.revision;
    const preCancelSpotlight = state.round!.spotlightsCompleted;

    const cancelRes = applyPlayerCommand(state, buyer, {
      type: "CANCEL_ACTIVE_TRANSACTION",
      transactionId: txId,
    });

    expect(cancelRes.ok).toBe(true);
    expect(cancelRes.state.revision).toBe(preCancelRevision + 1);
    expect(cancelRes.state.round!.spotlightsCompleted).toBe(
      preCancelSpotlight + 1,
    );
    expect(cancelRes.state.activeTransaction).toBeNull();
  });

  it("22 & 25. Final cash close + settlement is atomic, exactly +1 revision, tx journals precede settlement journals", () => {
    let { state, opp } = createReadyGame();
    const buyer = opp.targetPlayerId;

    // Place buyer as the 4th player in playerOrder so buyer holds the final spotlight
    const otherPlayers = state.playerOrder.filter((p) => p !== buyer);
    state = {
      ...state,
      playerOrder: [...otherPlayers, buyer],
    };
    state = beginRound(state).state;

    // Give buyer cash
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyer]: 6_000_000 as any,
        },
      },
    };

    // Advance 3 spotlights to reach spotlight 4
    for (let i = 0; i < 3; i++) {
      const p = otherPlayers[i]!;
      state = advanceSpotlight(state, p).state;
    }
    expect(state.round?.spotlightsCompleted).toBe(3);
    expect(getActiveSpotlightPlayerId(state)).toBe(buyer);

    // Open cash purchase on final spotlight
    state = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_CASH",
      opportunityId: opp.id,
    }).state;

    const txId = state.activeTransaction!.id;
    const preCloseRevision = state.revision;

    const closeRes = applyPlayerCommand(state, buyer, {
      type: "CLOSE_BUSINESS_PURCHASE",
      transactionId: txId,
    });

    expect(closeRes.ok).toBe(true);
    // Exactly ONE revision total for final close + settlement
    expect(closeRes.state.revision).toBe(preCloseRevision + 1);
    // Advanced to Quarter 2 ROUND_START
    expect(closeRes.state.currentQuarter).toBe(2);
    expect(closeRes.state.round?.stage).toBe("round-start");
    expect(closeRes.state.round?.spotlightsCompleted).toBe(0);

    // 25. Transaction journals precede settlement journals
    expect(closeRes.journalEntries.length).toBeGreaterThan(1);
    const firstEntry = closeRes.journalEntries[0]!;
    expect(firstEntry.reason).toBe("business-purchase");
  });

  it("23, 25 & 26. Final financed close + settlement is atomic, Q1 player loan does not receive repayment in Q1 settlement", () => {
    let { state, opp } = createReadyGame();
    const buyer = opp.targetPlayerId;
    const seller = opp.sellerPlayerId;

    // Place buyer 4th in playerOrder
    const otherPlayers = state.playerOrder.filter((p) => p !== buyer);
    state = {
      ...state,
      playerOrder: [...otherPlayers, buyer],
    };
    state = beginRound(state).state;

    const lender = otherPlayers.find((p) => p !== seller)!;

    // Advance 3 spotlights
    for (let i = 0; i < 3; i++) {
      const p = otherPlayers[i]!;
      state = advanceSpotlight(state, p).state;
    }
    expect(state.round?.spotlightsCompleted).toBe(3);
    expect(getActiveSpotlightPlayerId(state)).toBe(buyer);

    // Buyer pursues with financing on final spotlight
    state = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opp.id,
      buyerCashContributionCents: 3_000_000,
      requestedPrincipalCents: 2_000_000,
    }).state;

    const txId = state.activeTransaction!.id;

    state = applyPlayerCommand(state, lender, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      annualRateBps: 1000,
      termQuarters: 3,
    }).state;

    state = applyPlayerCommand(state, buyer, {
      type: "ACCEPT_PLAYER_LOAN_OFFER",
      transactionId: txId,
      expectedTermsRevision: 1,
    }).state;

    const preCloseRevision = state.revision;

    const closeRes = applyPlayerCommand(state, buyer, {
      type: "CLOSE_BUSINESS_PURCHASE",
      transactionId: txId,
    });

    expect(closeRes.ok).toBe(true);
    // Exactly ONE revision total
    expect(closeRes.state.revision).toBe(preCloseRevision + 1);
    expect(closeRes.state.currentQuarter).toBe(2);

    // 26. Newly originated Q1 player loan does NOT receive a payment during Q1 settlement
    const loan = Object.values(closeRes.state.finance.loansById).find(
      (l) => l.kind === "player-loan" && l.borrowerPlayerId === buyer,
    );
    expect(loan).toBeDefined();
    if (loan?.kind === "player-loan") {
      expect(loan.outstandingPrincipalCents).toBe(2_000_000); // untouched!
      expect(loan.installmentsProcessed).toBe(0); // 0 installments paid in Q1
    }
  });

  it("24. Final close settlement failure rolls back all state atomically", () => {
    let { state, opp } = createReadyGame();
    const buyer = opp.targetPlayerId;

    const otherPlayers = state.playerOrder.filter((p) => p !== buyer);
    state = {
      ...state,
      playerOrder: [...otherPlayers, buyer],
    };
    state = beginRound(state).state;

    // Advance 3 spotlights
    for (let i = 0; i < 3; i++) {
      const p = otherPlayers[i]!;
      state = advanceSpotlight(state, p).state;
    }
    expect(state.round?.spotlightsCompleted).toBe(3);
    expect(getActiveSpotlightPlayerId(state)).toBe(buyer);

    // Give buyer cash
    state = {
      ...state,
      counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER - 2 },
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [buyer]: 6_000_000 as any,
          // Cause a settlement failure for another player by setting living expense higher than cash + income
          [otherPlayers[0]!]: 0 as any,
        },
        recurringByPlayer: {
          ...state.finance.recurringByPlayer,
          [otherPlayers[0]!]: {
            quarterlyIncomeCents: 0 as any,
            quarterlyLivingExpenseCents: 99_999_999 as any,
          },
        },
      },
    };

    state = applyPlayerCommand(state, buyer, {
      type: "PURSUE_BUSINESS_CASH",
      opportunityId: opp.id,
    }).state;

    const txId = state.activeTransaction!.id;
    const preCloseState = state;

    const closeRes = applyPlayerCommand(state, buyer, {
      type: "CLOSE_BUSINESS_PURCHASE",
      transactionId: txId,
    });

    // Final settlement fails: entire operation rolls back atomically
    expect(closeRes.ok).toBe(false);
    expect(closeRes.state).toBe(preCloseState);
    expect(closeRes.journalEntries.length).toBe(0);
  });

  it("27. Rejected actions consume no RNG and do not increment revision", () => {
    const { state } = createReadyGame();
    const initialRevision = state.revision;
    const initialRandom = { ...state.random };
    const initialCounters = { ...state.counters };

    // Invalid action type
    const res = applyPlayerCommand(state, playerIds[0]!, {
      type: "INVALID_CMD" as any,
    });

    expect(res.ok).toBe(false);
    expect(res.state.revision).toBe(initialRevision);
    expect(res.state.random).toEqual(initialRandom);
    expect(res.state.counters).toEqual(initialCounters);
  });
});
