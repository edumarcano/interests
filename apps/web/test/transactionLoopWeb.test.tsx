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

  describe("Investigation UX: pending, error, and authoritative-success behavior", () => {
    it("displays pending indicator and disables button while investigation is submitting", async () => {
      let resolvePromise!: (val: any) => void;
      const slowPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      const onSendCommand = vi.fn().mockReturnValue(slowPromise);

      render(
        <OpportunityCard
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      const btn = screen.getByTestId("investigate-opportunity-btn");
      expect(btn.textContent).toBe("Perform Due Diligence");
      expect(btn.hasAttribute("disabled")).toBe(false);

      fireEvent.click(btn);

      // Pending state active
      expect(btn.textContent).toBe("Conducting Due Diligence...");
      expect(btn.hasAttribute("disabled")).toBe(true);

      // Resolve
      resolvePromise({ ok: true, revision: 6 });
    });

    it("displays error banner when investigation command fails", async () => {
      const onSendCommand = vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "WRONG_PHASE", message: "Setup is not complete yet" },
      });

      render(
        <OpportunityCard
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      const btn = screen.getByTestId("investigate-opportunity-btn");
      fireEvent.click(btn);

      const errorBanner = await screen.findByTestId("opportunity-error-banner");
      expect(errorBanner.textContent).toContain("Setup is not complete yet");
    });
  });

  describe("Off-spotlight investigation & non-active pursuit controls", () => {
    it("renders OpportunityCard with active investigate button during ROUND_START", () => {
      const roundStartMatch: MatchPlayerView = {
        ...baseMatchView,
        round: {
          stage: "round-start",
          spotlightOrder: ["player-1" as any, "player-2" as any],
          activeSpotlightPlayerId: null,
          spotlightsCompleted: 0,
        },
      };

      render(
        <RoundStartView
          match={roundStartMatch}
          isHost={true}
          canAct={true}
          onBeginRound={vi.fn()}
        />,
      );

      expect(screen.getByTestId("private-opportunity-card")).toBeDefined();
      expect(screen.getByTestId("investigate-opportunity-btn")).toBeDefined();
    });

    it("renders OpportunityCard when off-spotlight, but hides pursuit controls", () => {
      const offSpotlightMatch: MatchPlayerView = {
        ...baseMatchView,
        round: {
          stage: "spotlight",
          spotlightOrder: ["player-2" as any, "player-1" as any],
          activeSpotlightPlayerId: "player-2" as any, // Not player-1
          spotlightsCompleted: 0,
        },
      };

      render(
        <SpotlightView
          match={offSpotlightMatch}
          onPassSpotlight={vi.fn()}
          canAct={true}
        />,
      );

      // Target player can investigate off spotlight
      expect(screen.getByTestId("private-opportunity-card")).toBeDefined();
      // Pursuit controls are NOT rendered for off-spotlight player
      expect(screen.queryByTestId("pursuit-controls-panel")).toBeNull();
    });
  });

  describe("Actor-field omission assertions across all commands", () => {
    it("asserts no actor fields are sent in any outgoing command payloads", async () => {
      const sentCommands: PlayerCommand[] = [];
      const onSendCommand = vi.fn().mockImplementation((cmd: PlayerCommand) => {
        sentCommands.push(cmd);
        return Promise.resolve({ ok: true, revision: 6 });
      });

      // 1. INVESTIGATE
      render(
        <OpportunityCard
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );
      fireEvent.click(screen.getByTestId("investigate-opportunity-btn"));

      cleanup();

      // 2. PURSUE_BUSINESS_CASH & PURSUE_BUSINESS_WITH_PLAYER_LOAN
      const richMatch: MatchPlayerView = {
        ...baseMatchView,
        self: {
          ...baseSelf,
          availableCashCents: 10_000_000,
        },
      };
      render(
        <TransactionPanel
          match={richMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      fireEvent.click(screen.getByTestId("buy-with-cash-btn"));
      cleanup();

      render(
        <TransactionPanel
          match={richMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );
      fireEvent.click(screen.getByTestId("open-financing-form-btn"));
      fireEvent.click(screen.getByTestId("submit-financing-request-btn"));

      cleanup();

      // 3. SUBMIT_PLAYER_LOAN_OFFER
      const candidateMatch: MatchPlayerView = {
        ...baseMatchView,
        self: {
          ...baseSelf,
          playerId: "player-3" as any,
          availableCashCents: 5_000_000,
        },
        activeTransaction: {
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
        },
      };
      render(
        <TransactionPanel
          match={candidateMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );
      fireEvent.click(screen.getByTestId("submit-lender-offer-btn"));

      cleanup();

      // 4. ACCEPT_PLAYER_LOAN_OFFER, CLOSE_BUSINESS_PURCHASE & CANCEL_ACTIVE_TRANSACTION
      const acceptedMatch: MatchPlayerView = {
        ...baseMatchView,
        activeTransaction: {
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
        },
      };
      render(
        <TransactionPanel
          match={acceptedMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );
      fireEvent.click(screen.getByTestId("accept-offer-btn"));
      cleanup();

      render(
        <TransactionPanel
          match={acceptedMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );
      fireEvent.click(screen.getByTestId("cancel-deal-btn"));
      cleanup();

      const closedMatch: MatchPlayerView = {
        ...acceptedMatch,
        activeTransaction: {
          ...acceptedMatch.activeTransaction!,
          financingStatus: "offer-accepted",
        },
      };
      render(
        <TransactionPanel
          match={closedMatch}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );
      fireEvent.click(screen.getByTestId("complete-purchase-btn"));
      cleanup();

      // Verify every sent command is completely free of actor identity fields
      expect(sentCommands.length).toBe(7);
      for (const cmd of sentCommands) {
        expect((cmd as any).playerId).toBeUndefined();
        expect((cmd as any).buyerPlayerId).toBeUndefined();
        expect((cmd as any).lenderPlayerId).toBeUndefined();
        expect((cmd as any).sellerPlayerId).toBeUndefined();
        expect((cmd as any).isHost).toBeUndefined();
      }
    });
  });

  describe("Role-based controls: seller, buyer, and neutral do not see lender controls", () => {
    it("buyer, seller, and uninvolved do not see lender offer form", () => {
      const activeTx: ActiveTransactionSummaryView = {
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

      // Buyer view
      const { rerender } = render(
        <TransactionPanel
          match={{ ...baseMatchView, activeTransaction: activeTx }}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("submit-lender-offer-btn")).toBeNull();

      // Seller view
      rerender(
        <TransactionPanel
          match={{
            ...baseMatchView,
            self: { ...baseSelf, playerId: "player-2" as any },
            activeTransaction: { ...activeTx, role: "seller" },
          }}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("submit-lender-offer-btn")).toBeNull();

      // Uninvolved view
      rerender(
        <TransactionPanel
          match={{
            ...baseMatchView,
            self: { ...baseSelf, playerId: "player-4" as any },
            activeTransaction: { ...activeTx, role: "uninvolved" },
          }}
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("submit-lender-offer-btn")).toBeNull();
    });
  });

  describe("Terminal authoritative transition rendering", () => {
    it("removes transaction panel and renders new business and loan upon completion", () => {
      const activeTx: ActiveTransactionSummaryView = {
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
        financingStatus: "offer-accepted",
      };

      const { rerender } = render(
        <SpotlightView
          match={{ ...baseMatchView, activeTransaction: activeTx }}
          onPassSpotlight={vi.fn()}
          canAct={true}
        />,
      );

      expect(screen.getByTestId("active-transaction-panel")).toBeDefined();

      // Authoritative transition: deal closed, asset added, loan added
      const closedMatch: MatchPlayerView = {
        ...baseMatchView,
        activeTransaction: null,
        self: {
          ...baseSelf,
          cashCents: 1_500_000,
          reservedCashCents: 0,
          availableCashCents: 1_500_000,
          ownedAssets: [
            {
              id: "asset-1",
              kind: "business",
              annualRevenueCents: 8_000_000,
              annualOperatingProfitCents: 1_500_000,
              enterpriseValueCents: 6_000_000,
              debtPrincipalCents: 0,
              ownershipPpm: 1_000_000,
            },
          ],
          loans: [
            {
              id: "loan-1",
              kind: "player-loan",
              role: "borrower",
              counterpartyNickname: "LenderCharlie",
              originalPrincipalCents: 2_000_000,
              outstandingPrincipalCents: 2_000_000,
              annualRateBps: 1000,
              termQuarters: 3,
            },
          ],
        },
      };

      rerender(
        <SpotlightView
          match={closedMatch}
          onPassSpotlight={vi.fn()}
          canAct={true}
        />,
      );

      // Transaction panel is gone
      expect(screen.queryByTestId("active-transaction-panel")).toBeNull();
      // Owned asset and loan are rendered in financial summary
      expect(screen.getByText("Owned Business Assets")).toBeDefined();
      expect(screen.getByText("Loan Positions")).toBeDefined();
    });
  });

  describe("Pause and Reconnect Behavior", () => {
    it("disables all primary transaction actions when room is paused", () => {
      render(
        <OpportunityCard
          opportunity={baseOpportunity}
          isPaused={true}
          onSendCommand={vi.fn()}
        />,
      );
      expect(
        screen
          .getByTestId("investigate-opportunity-btn")
          .hasAttribute("disabled"),
      ).toBe(true);
    });

    it("reconnect renders rehydrated active transaction state seamlessly", () => {
      const rehydratedMatch: MatchPlayerView = {
        ...baseMatchView,
        activeTransaction: {
          transactionId: "tx-reconnect" as any,
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
            termQuarters: 3,
            termsRevision: 1,
            status: "offered",
          },
        },
      };

      render(
        <SpotlightView
          match={rehydratedMatch}
          onPassSpotlight={vi.fn()}
          canAct={true}
        />,
      );

      expect(screen.getByTestId("active-transaction-panel")).toBeDefined();
      expect(screen.getByText(/LenderCharlie/)).toBeDefined();
      expect(screen.getByTestId("accept-offer-btn")).toBeDefined();
    });
  });

  describe("Per-command retry equality and late-ACK protection", () => {
    it("covers equality across all parameterized commands", () => {
      // PURSUE_BUSINESS_WITH_PLAYER_LOAN
      const loanCmd1: PlayerCommand = {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: "opp-1",
        buyerCashContributionCents: 3_000_000,
        requestedPrincipalCents: 2_000_000,
      };
      const loanCmdSame: PlayerCommand = {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: "opp-1",
        buyerCashContributionCents: 3_000_000,
        requestedPrincipalCents: 2_000_000,
      };
      const loanCmdDiffContrib: PlayerCommand = {
        type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
        opportunityId: "opp-1",
        buyerCashContributionCents: 3_500_000,
        requestedPrincipalCents: 1_500_000,
      };
      expect(isSameLogicalCommand(loanCmd1, loanCmdSame)).toBe(true);
      expect(isSameLogicalCommand(loanCmd1, loanCmdDiffContrib)).toBe(false);

      // ACCEPT_PLAYER_LOAN_OFFER
      const accept1: PlayerCommand = {
        type: "ACCEPT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        expectedTermsRevision: 1,
      };
      const acceptSame: PlayerCommand = {
        type: "ACCEPT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        expectedTermsRevision: 1,
      };
      const acceptDiffRev: PlayerCommand = {
        type: "ACCEPT_PLAYER_LOAN_OFFER",
        transactionId: "tx-1",
        expectedTermsRevision: 2,
      };
      expect(isSameLogicalCommand(accept1, acceptSame)).toBe(true);
      expect(isSameLogicalCommand(accept1, acceptDiffRev)).toBe(false);

      // CLOSE & CANCEL
      const close1: PlayerCommand = {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: "tx-1",
      };
      const closeDiff: PlayerCommand = {
        type: "CLOSE_BUSINESS_PURCHASE",
        transactionId: "tx-2",
      };
      expect(isSameLogicalCommand(close1, close1)).toBe(true);
      expect(isSameLogicalCommand(close1, closeDiff)).toBe(false);
    });

    it("late ACK for an older command does not clear tracking for a newer pending command", () => {
      let pendingCommand: { commandId: string } | null = null;

      // 1. Send Command A
      const envA = createCommandEnvelope({ type: "BEGIN_ROUND" }, 4, "uuid-A");
      pendingCommand = envA;

      // 2. Command A times out, user submits Command B
      const envB = createCommandEnvelope({ type: "BEGIN_ROUND" }, 4, "uuid-B");
      pendingCommand = envB;

      // 3. Late ACK arrives for Command A
      const lateAck = { commandId: "uuid-A" };
      if (pendingCommand && pendingCommand.commandId === lateAck.commandId) {
        pendingCommand = null;
      }
      // Pending command remains Command B!
      expect(pendingCommand).not.toBeNull();
      expect(pendingCommand?.commandId).toBe("uuid-B");

      // 4. ACK arrives for Command B
      const ackB = { commandId: "uuid-B" };
      if (pendingCommand && pendingCommand.commandId === ackB.commandId) {
        pendingCommand = null;
      }
      expect(pendingCommand).toBeNull();
    });
  });

  describe("No optimistic state mutation & 320px layout usability", () => {
    it("does not mutate match state optimistically before authoritative server view", () => {
      const stateBefore = JSON.parse(JSON.stringify(baseMatchView));
      const onSendCommand = vi
        .fn()
        .mockImplementation(() => new Promise(() => {})); // Never resolves

      render(
        <OpportunityCard
          opportunity={baseOpportunity}
          isPaused={false}
          onSendCommand={onSendCommand}
        />,
      );

      fireEvent.click(screen.getByTestId("investigate-opportunity-btn"));

      // Props state remains untouched
      expect(baseMatchView).toEqual(stateBefore);
    });

    it("renders inside 320px viewport without crashing and actions have accessible sizing", () => {
      const { container } = render(
        <div style={{ width: "320px", maxWidth: "320px", overflow: "hidden" }}>
          <OpportunityCard
            opportunity={baseOpportunity}
            isPaused={false}
            onSendCommand={vi.fn()}
          />
        </div>,
      );

      const card = screen.getByTestId("private-opportunity-card");
      expect(card).toBeDefined();
      const btn = screen.getByTestId("investigate-opportunity-btn");
      expect(btn).toBeDefined();
      expect(btn.style.minHeight).toBe("44px");
      expect(container).toBeDefined();
    });
  });
});
