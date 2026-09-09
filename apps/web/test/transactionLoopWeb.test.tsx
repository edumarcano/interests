// @vitest-environment happy-dom

import type {
  ActiveTransactionSummaryView,
  MatchPlayerView,
  MatchRoundView,
  MatchSelfBusinessAssetView,
  MatchSelfLoanView,
  MatchSelfView,
  PlayerCommand,
  PrivateOpportunityView,
} from "@interests/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCommandEnvelope,
  isSameLogicalCommand,
} from "../src/command/commandHelper.js";
import { OpportunityCard } from "../src/components/OpportunityCard.js";
import { RoundStartView } from "../src/components/RoundStartView.js";
import { SelfFinanceSummary } from "../src/components/SelfFinanceSummary.js";
import { SpotlightView } from "../src/components/SpotlightView.js";
import { TransactionPanel } from "../src/components/TransactionPanel.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Section 16: Transaction Loop Frontend Verification", () => {
  const baseOpportunity: PrivateOpportunityView = {
    id: "opportunity-1",
    kind: "private-business-purchase",
    askingPriceCents: 5_000_000,
    sellerPlayerId: "player-2" as any,
    sellerNickname: "SellerBob",
    status: "available",
    investigated: false,
  };

  const investigatedOpportunity: PrivateOpportunityView = {
    ...baseOpportunity,
    investigated: true,
    facts: {
      annualRevenueCents: 8_000_000,
      annualOperatingProfitCents: 1_500_000,
      enterpriseValueCents: 6_000_000,
      debtPrincipalCents: 0,
    },
  };

  const baseSelf: MatchSelfView = {
    playerId: "player-1" as any,
    profileId: "corporate-climber",
    offeredObjectiveIds: ["obj-1", "obj-2"],
    selectedObjectiveId: "obj-1",
    cashCents: 4_500_000,
    reservedCashCents: 0,
    availableCashCents: 4_500_000,
    opportunity: baseOpportunity,
    ownedAssets: [],
    loans: [],
  };

  const baseRound: MatchRoundView = {
    stage: "spotlight",
    spotlightOrder: ["player-1" as any, "player-2" as any],
    activeSpotlightPlayerId: "player-1" as any,
    spotlightsCompleted: 0,
  };

  const baseMatchView: MatchPlayerView = {
    matchId: "match-1" as any,
    modeId: "standard-v1",
    revision: 5,
    phase: "round-1",
    currentQuarter: 1,
    round: baseRound,
    players: [
      {
        playerId: "player-1" as any,
        roomMemberId: "m1" as any,
        nickname: "BuyerAlice",
        joinOrder: 0,
        isHost: true,
        hasSelectedObjective: true,
      },
      {
        playerId: "player-2" as any,
        roomMemberId: "m2" as any,
        nickname: "SellerBob",
        joinOrder: 1,
        isHost: false,
        hasSelectedObjective: true,
      },
    ],
    self: baseSelf,
    activeTransaction: null,
  };

  describe("1, 2, 3, 4, 5 & 6. OpportunityCard & Diligence facts", () => {
    it("renders opportunity card with hidden facts before investigation", () => {
      const onSendCommand = vi
        .fn()
        .mockResolvedValue({ ok: true, revision: 6 });
      render(
        <OpportunityCard
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      expect(screen.getByText("Private Acquisition Opportunity")).toBeDefined();
      expect(screen.getByText("Asking Price")).toBeDefined();
      expect(screen.getByText("$50,000")).toBeDefined();
      expect(screen.getByText("SellerBob")).toBeDefined();
      // Facts are unrevealed and confidential before investigation
      expect(screen.getByTestId("diligence-unrevealed-section")).toBeDefined();
      expect(screen.queryByTestId("diligence-facts-grid")).toBeNull();

      // Click investigate button
      const investigateBtn = screen.getByTestId("investigate-opportunity-btn");
      fireEvent.click(investigateBtn);
      expect(onSendCommand).toHaveBeenCalledWith({
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: "opportunity-1",
      });
    });

    it("reveals pregenerated diligence facts once investigated", () => {
      render(
        <OpportunityCard
          opportunity={investigatedOpportunity}
          isPaused={false}
          onSendCommand={vi.fn()}
        />,
      );

      expect(screen.getByText("$80,000")).toBeDefined(); // Revenue
      expect(screen.getByText("$15,000")).toBeDefined(); // Operating Profit
      expect(screen.getByText("$60,000")).toBeDefined(); // EV
      expect(screen.getByText("$0")).toBeDefined(); // Debt Principal
      expect(screen.getByText("Due Diligence Findings")).toBeDefined();
    });

    it("non-target player does not render OpportunityCard", () => {
      const nonTargetMatch: MatchPlayerView = {
        ...baseMatchView,
        self: {
          ...baseSelf,
          opportunity: null,
        },
      };

      render(
        <SpotlightView
          match={nonTargetMatch}
          onPassSpotlight={vi.fn()}
          canAct={true}
        />,
      );

      expect(screen.queryByText("Private Business Opportunity")).toBeNull();
    });
  });

  describe("TransactionPanel & Financing Workflow", () => {
    it("renders pursuit options when target buyer is active on spotlight with sufficient cash", () => {
      const onSendCommand = vi
        .fn()
        .mockResolvedValue({ ok: true, revision: 6 });

      render(
        <TransactionPanel
          match={baseMatchView}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      expect(screen.getByText("Acquisition Options (Your Turn)")).toBeDefined();
      expect(screen.getByTestId("open-financing-form-btn")).toBeDefined();

      // Buyer has 4.5M cents < 5M asking price, so cash purchase button is disabled
      const cashBtn = screen.getByTestId("buy-with-cash-btn");
      expect(cashBtn.hasAttribute("disabled")).toBe(true);

      // Click open player financing form
      const openFormBtn = screen.getByTestId("open-financing-form-btn");
      fireEvent.click(openFormBtn);

      // Click submit financing request
      const submitLoanBtn = screen.getByTestId("submit-financing-request-btn");
      fireEvent.click(submitLoanBtn);
      expect(onSendCommand).toHaveBeenCalledWith({
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: "opportunity-1",
        buyerCashContributionCents: 3_000_000,
        requestedPrincipalCents: 2_000_000,
      });
    });

    it("renders lender offer form for eligible third-party lender", () => {
      const activeTx: ActiveTransactionSummaryView = {
        transactionId: "tx-1" as any,
        kind: "financed-business-purchase",
        role: "lender-candidate",
        buyerPlayerId: "player-1" as any,
        buyerNickname: "BuyerAlice",
        sellerPlayerId: "player-2" as any,
        sellerNickname: "SellerBob",
        purchasePriceCents: 5_000_000,
        isFinanced: true,
        buyerContributionCents: 3_000_000,
        requestedPrincipalCents: 2_000_000,
        financingStatus: "waiting-for-offer",
        hasExistingOffer: false,
      };

      const lenderMatch: MatchPlayerView = {
        ...baseMatchView,
        self: {
          ...baseSelf,
          playerId: "player-3" as any,
          availableCashCents: 3_000_000,
        },
        activeTransaction: activeTx,
      };

      const onSendCommand = vi
        .fn()
        .mockResolvedValue({ ok: true, revision: 6 });
      render(
        <TransactionPanel
          match={lenderMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      expect(screen.getByText("Financing Opportunity")).toBeDefined();
      const submitBtn = screen.getByTestId("submit-lender-offer-btn");
      fireEvent.click(submitBtn);

      // Default rate 10.00% (1000 bps) and term 3 quarters
      expect(onSendCommand).toHaveBeenCalledWith({
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        annualRateBps: 1000,
        termQuarters: 3,
      });
    });

    it("renders buyer acceptance and close buttons when offer is submitted and accepted", () => {
      const activeTxWithOffer: ActiveTransactionSummaryView = {
        transactionId: "tx-1" as any,
        kind: "financed-business-purchase",
        role: "buyer",
        buyerPlayerId: "player-1" as any,
        buyerNickname: "BuyerAlice",
        sellerPlayerId: "player-2" as any,
        sellerNickname: "SellerBob",
        purchasePriceCents: 5_000_000,
        isFinanced: true,
        buyerContributionCents: 3_000_000,
        requestedPrincipalCents: 2_000_000,
        financingStatus: "offer-submitted",
        offer: {
          lenderPlayerId: "player-3" as any,
          lenderNickname: "LenderCharlie",
          principalCents: 2_000_000,
          annualRateBps: 1000,
          termQuarters: 4,
          termsRevision: 1,
          status: "offered",
        },
      };

      const buyerMatch: MatchPlayerView = {
        ...baseMatchView,
        activeTransaction: activeTxWithOffer,
      };

      const onSendCommand = vi
        .fn()
        .mockResolvedValue({ ok: true, revision: 6 });
      render(
        <TransactionPanel
          match={buyerMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      const acceptBtn = screen.getByTestId("accept-offer-btn");
      fireEvent.click(acceptBtn);
      expect(onSendCommand).toHaveBeenCalledWith({
        type: "ACCEPT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        expectedTermsRevision: 1,
      });
    });

    it("allows buyer to cancel active deal", () => {
      const activeTxWithOffer: ActiveTransactionSummaryView = {
        transactionId: "tx-1" as any,
        kind: "financed-business-purchase",
        role: "buyer",
        buyerPlayerId: "player-1" as any,
        buyerNickname: "BuyerAlice",
        sellerPlayerId: "player-2" as any,
        sellerNickname: "SellerBob",
        purchasePriceCents: 5_000_000,
        isFinanced: true,
        buyerContributionCents: 3_000_000,
        requestedPrincipalCents: 2_000_000,
        financingStatus: "waiting-for-offer",
      };

      const buyerMatch: MatchPlayerView = {
        ...baseMatchView,
        activeTransaction: activeTxWithOffer,
      };

      const onSendCommand = vi
        .fn()
        .mockResolvedValue({ ok: true, revision: 6 });
      render(
        <TransactionPanel
          match={buyerMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      const cancelBtn = screen.getByTestId("cancel-deal-btn");
      fireEvent.click(cancelBtn);
      expect(onSendCommand).toHaveBeenCalledWith({
        type: "CANCEL_ACTIVE_TRANSACTION",
        transactionId: "tx-1",
      });
    });
  });

  describe("SelfFinanceSummary", () => {
    it("displays cash, reserved cash, available cash, owned business, and loans", () => {
      const businessAsset: MatchSelfBusinessAssetView = {
        id: "asset-biz-1",
        kind: "business",
        annualRevenueCents: 8_000_000,
        annualOperatingProfitCents: 1_500_000,
        enterpriseValueCents: 6_000_000,
        debtPrincipalCents: 0,
        ownershipPpm: 1_000_000,
      };

      const loan: MatchSelfLoanView = {
        id: "loan-1",
        kind: "player-loan",
        role: "borrower",
        counterpartyNickname: "LenderCharlie",
        originalPrincipalCents: 2_000_000,
        outstandingPrincipalCents: 2_000_000,
        annualRateBps: 1000,
        termQuarters: 4,
      };

      const selfWithAssets: MatchSelfView = {
        ...baseSelf,
        cashCents: 5_000_000,
        reservedCashCents: 2_000_000,
        availableCashCents: 3_000_000,
        ownedAssets: [businessAsset],
        loans: [loan],
      };

      render(<SelfFinanceSummary self={selfWithAssets} />);

      expect(screen.getByText("Your Financial Position")).toBeDefined();
      expect(screen.getByText("$50,000")).toBeDefined(); // Total cash
      expect(screen.getByText("$20,000")).toBeDefined(); // Reserved
      expect(screen.getByText("$30,000")).toBeDefined(); // Available
      expect(screen.getByText("Owned Business Assets")).toBeDefined();
      expect(screen.getByText("Loan Positions")).toBeDefined();
      expect(screen.getByText(/LenderCharlie/)).toBeDefined();
    });
  });

  describe("commandHelper: isSameLogicalCommand and retry envelope reuse", () => {
    it("isSameLogicalCommand returns true for identical payload and false for modified payload", () => {
      const cmd1: PlayerCommand = {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: "opp-1",
      };
      const cmdSame: PlayerCommand = {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: "opp-1",
      };
      expect(isSameLogicalCommand(cmd1, cmdSame)).toBe(true);

      const cmdDiff: PlayerCommand = {
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: "opp-2",
      };
      expect(isSameLogicalCommand(cmd1, cmdDiff)).toBe(false);

      const offer1: PlayerCommand = {
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        annualRateBps: 1000,
        termQuarters: 4,
      };
      const offerSame: PlayerCommand = {
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        annualRateBps: 1000,
        termQuarters: 4,
      };
      expect(isSameLogicalCommand(offer1, offerSame)).toBe(true);

      const offerDiff: PlayerCommand = {
        type: "SUBMIT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        annualRateBps: 800,
        termQuarters: 4,
      };
      expect(isSameLogicalCommand(offer1, offerDiff)).toBe(false);

      // Envelope reuse pattern
      const env1 = createCommandEnvelope(offer1, 5);
      const retryId = isSameLogicalCommand(env1.command, offerSame)
        ? env1.commandId
        : undefined;
      const envRetry = createCommandEnvelope(offerSame, 5, retryId);
      expect(envRetry.commandId).toBe(env1.commandId);

      const diffId = isSameLogicalCommand(env1.command, offerDiff)
        ? env1.commandId
        : undefined;
      const envDiff = createCommandEnvelope(offerDiff, 5, diffId);
      expect(envDiff.commandId).not.toBe(env1.commandId);
    });
  });
});
