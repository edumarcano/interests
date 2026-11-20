// @vitest-environment happy-dom
import type { MatchPlayerView } from "@interests/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessCapitalPanel } from "../src/components/BusinessCapitalPanel";
import { RecurringBusinessExitPanel } from "../src/components/RecurringBusinessExitPanel";
import { RecurringOpportunityPanel } from "../src/components/RecurringOpportunityPanel";

afterEach(cleanup);
function match(
  objectiveId: string,
  status: "eligible" | "ineligible" = "eligible",
): MatchPlayerView {
  return {
    phase: "ready-for-first-round",
    revision: 7,
    hasActiveTransaction: false,
    round: { activeSpotlightPlayerId: "A", stage: "spotlight" },
    players: [
      { playerId: "A", nickname: "Alice" },
      { playerId: "B", nickname: "Bob" },
    ],
    self: {
      playerId: "A",
      availableCashCents: 100_000_000,
      financialDetails: {
        focus: "general",
        objectiveEvaluation: { objectiveId, status, checks: [] },
      },
      ownedAssets: [
        {
          id: "business-1",
          kind: "business",
          companyCashCents: 1_000_000,
          ownershipPpm: 1_000_000,
        },
      ],
      recurringOpportunity: {
        id: "opportunity-8",
        action: "npc-financing",
        status: "available",
        category: "financing",
        intensity: "standard",
        name: "Working capital",
        createdQuarter: 2,
        askingPriceCents: 15_000_000,
        investigationFeeCents: 0,
        investigated: false,
        marketLoanQuote: {
          borrowerName: "Independent borrower",
          principalCents: 15_000_000,
          annualRateBps: 800,
          termQuarters: 8,
          firstDueQuarter: 3,
          scheduledQuarterlyPaymentCents: 2_000_000,
          onTimeTotalInterestCents: 1_000_000,
          repaymentRisk: "full-budget",
          canFund: true,
          unavailableReason: null,
        },
      },
    },
  } as unknown as MatchPlayerView;
}
function saleMatch(
  objectiveId: string,
  status: "eligible" | "ineligible" = "eligible",
) {
  const own = match(objectiveId, status);
  return {
    ...own,
    self: {
      ...own.self,
      recurringOpportunity: {
        ...own.self.recurringOpportunity!,
        action: "npc-business-exit",
        businessExitQuote: {
          id: "exact-quote-7",
          assetId: "business-1",
          operatingEnterpriseBidCents: 9_000_000,
          referenceEnterpriseValueCents: 9_000_000,
          companyCashIncludedCents: 500_000,
          grossConsiderationCents: 9_500_000,
          saleFeeCents: 285_000,
          bankPayoffCents: 2_000_000,
          bankInterestPaidCents: 40_000,
          operatingArrearsPaidCents: 0,
          workArrearsPaidCents: 0,
          sellerNetCents: 7_215_000,
        },
      },
    },
  } as MatchPlayerView;
}
function expansionDraft() {
  fireEvent.click(
    screen.getByRole("button", { name: "Expand this business", exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Company investment ($)"), {
    target: { value: "15000" },
  });
}

describe("private explicit economic finale controls", () => {
  it("keeps ordinary market funding separate from the eligible Financier's explicit wrapper", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RecurringOpportunityPanel
        match={match("financier")}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Pursue finale with this loan" }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "PURSUE_FINALE",
        action: { type: "FUND_RECURRING_LOAN", opportunityId: "opportunity-8" },
      }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /^Fund .* loan$/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Fund .* loan$/ }));
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith({
        type: "FUND_RECURRING_LOAN",
        opportunityId: "opportunity-8",
      }),
    );
  });
  it.each(["founder", "deal-maker", "capital-allocator"])(
    "does not offer market-loan finales for %s",
    (objective) => {
      render(
        <RecurringOpportunityPanel
          match={match(objective)}
          isPaused={false}
          onSendCommand={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /Pursue finale/ }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: /^Fund .* loan$/ }),
      ).toBeTruthy();
    },
  );
  it("blocks market finale funding while paused, off spotlight, unaffordable or pending, and hides ineligible intent", async () => {
    const send = vi.fn().mockImplementation(() => new Promise(() => {})),
      own = match("financier");
    const { rerender } = render(
      <RecurringOpportunityPanel
        match={own}
        isPaused={true}
        onSendCommand={send}
      />,
    );
    const button = () =>
      screen.getByRole("button", {
        name: "Pursue finale with this loan",
      }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    rerender(
      <RecurringOpportunityPanel
        match={{
          ...own,
          round: { ...own.round!, activeSpotlightPlayerId: "B" },
        }}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(button().disabled).toBe(true);
    rerender(
      <RecurringOpportunityPanel
        match={{
          ...own,
          self: {
            ...own.self,
            recurringOpportunity: {
              ...own.self.recurringOpportunity!,
              marketLoanQuote: {
                ...own.self.recurringOpportunity!.marketLoanQuote!,
                canFund: false,
                unavailableReason: "insufficient-cash",
              },
            },
          },
        }}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(button().disabled).toBe(true);
    rerender(
      <RecurringOpportunityPanel
        match={match("financier", "ineligible")}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(screen.queryByRole("button", { name: /Pursue finale/ })).toBeNull();
    rerender(
      <RecurringOpportunityPanel
        match={own}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(["founder", "deal-maker"])(
    "adds an opt-in reviewed sale for eligible %s while retaining ordinary confirmation",
    async (objective) => {
      const send = vi.fn().mockResolvedValue({ ok: true });
      render(
        <RecurringBusinessExitPanel
          match={saleMatch(objective)}
          isPaused={false}
          onSendCommand={send}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /Pursue finale/ }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Review matched business sale",
          exact: true,
        }),
      );
      expect(
        screen.getByRole("button", {
          name: "Confirm matched business sale",
          exact: true,
        }),
      ).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Pursue finale with reviewed sale",
        }),
      );
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith({
          type: "PURSUE_FINALE",
          action: {
            type: "SELL_RECURRING_BUSINESS",
            opportunityId: "opportunity-8",
            quoteId: "exact-quote-7",
          },
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", {
            name: "Pursue finale with reviewed sale",
          }),
        ).toBeNull(),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Review matched business sale",
          exact: true,
        }),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Confirm matched business sale",
          exact: true,
        }),
      );
      await waitFor(() =>
        expect(send).toHaveBeenLastCalledWith({
          type: "SELL_RECURRING_BUSINESS",
          opportunityId: "opportunity-8",
          quoteId: "exact-quote-7",
        }),
      );
    },
  );
  it("does not expose a sale finale to other or ineligible objectives and keeps paused review inert", () => {
    const own = saleMatch("financier"),
      send = vi.fn(),
      { rerender } = render(
        <RecurringBusinessExitPanel
          match={own}
          isPaused={false}
          onSendCommand={send}
        />,
      );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review matched business sale",
        exact: true,
      }),
    );
    expect(screen.queryByRole("button", { name: /Pursue finale/ })).toBeNull();
    rerender(
      <RecurringBusinessExitPanel
        match={saleMatch("founder", "ineligible")}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(screen.queryByRole("button", { name: /Pursue finale/ })).toBeNull();
    rerender(
      <RecurringBusinessExitPanel
        match={saleMatch("founder")}
        isPaused={true}
        onSendCommand={send}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Pursue finale with reviewed sale",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(send).not.toHaveBeenCalled();
  });
  it("uses the same direct sole-owner expansion draft for an eligible Founder finale and ordinary funding", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    render(
      <BusinessCapitalPanel
        match={match("founder")}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expansionDraft();
    expect(
      screen.getByRole("button", { name: "Fund expansion", exact: true }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Pursue finale with this expansion" }),
    );
    const action = {
      type: "EXPAND_BUSINESS",
      assetId: "business-1",
      investmentCents: 1_500_000,
      ownerContributionCents: 500_000,
    };
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "PURSUE_FINALE", action }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Company investment ($)")).toBeNull(),
    );
    expansionDraft();
    fireEvent.click(
      screen.getByRole("button", { name: "Fund expansion", exact: true }),
    );
    await waitFor(() => expect(send).toHaveBeenLastCalledWith(action));
  });
  it("hides expansion finales for shared stakes and ineligible objectives, and respects pause", () => {
    const send = vi.fn(),
      own = match("founder"),
      { rerender } = render(
        <BusinessCapitalPanel
          match={own}
          isPaused={false}
          onSendCommand={send}
        />,
      );
    expansionDraft();
    rerender(
      <BusinessCapitalPanel match={own} isPaused={true} onSendCommand={send} />,
    );
    const button = screen.getByRole("button", {
      name: "Pursue finale with this expansion",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(send).not.toHaveBeenCalled();
    rerender(
      <BusinessCapitalPanel
        match={match("founder", "ineligible")}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(screen.queryByRole("button", { name: /Pursue finale/ })).toBeNull();
    rerender(
      <BusinessCapitalPanel
        match={{
          ...own,
          self: {
            ...own.self,
            ownedAssets: [
              { ...own.self.ownedAssets![0]!, ownershipPpm: 500_000 },
            ],
          },
        }}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(screen.queryByRole("button", { name: /Pursue finale/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Send business proposal" }),
    ).toBeTruthy();
  });
});
