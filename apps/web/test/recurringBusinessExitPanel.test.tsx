// @vitest-environment happy-dom
import type { MatchPlayerView } from "@interests/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecurringBusinessExitPanel } from "../src/components/RecurringBusinessExitPanel";

afterEach(cleanup);
const match = {
  revision: 5,
  hasActiveTransaction: false,
  round: { activeSpotlightPlayerId: "A" },
  self: {
    playerId: "A",
    recurringOpportunity: {
      id: "opportunity-8",
      action: "npc-business-exit",
      status: "available",
      businessExitQuote: {
        id: "quote-5",
        assetId: "asset-2",
        operatingEnterpriseBidCents: 9_000_000,
        referenceEnterpriseValueCents: 9_100_000,
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
} as unknown as MatchPlayerView;
it("previews exact private sale economics, cancels without sending, and sends only the bound card/quote IDs", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true });
  render(
    <RecurringBusinessExitPanel
      match={match}
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
  expect(screen.getByRole("region").textContent).toContain(
    "Gross buyer consideration $95,000.00, including $5,000.00 company cash once",
  );
  expect(screen.getByRole("region").textContent).toContain(
    "Your net sale proceeds: $72,150.00",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel business sale review" }),
  );
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Review matched business sale",
      exact: true,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm matched business sale" }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "SELL_RECURRING_BUSINESS",
      opportunityId: "opportunity-8",
      quoteId: "quote-5",
    }),
  );
});
it("clears review after revisions and prevents paused or unrelated-transaction closes", () => {
  const send = vi.fn(),
    { rerender } = render(
      <RecurringBusinessExitPanel
        match={match}
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
  rerender(
    <RecurringBusinessExitPanel
      match={{
        ...match,
        revision: 6,
        self: {
          ...match.self,
          recurringOpportunity: {
            ...match.self.recurringOpportunity!,
            businessExitQuote: {
              ...match.self.recurringOpportunity!.businessExitQuote!,
              id: "quote-6",
            },
          },
        },
      }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(screen.queryByRole("region")).toBeNull();
  rerender(
    <RecurringBusinessExitPanel
      match={match}
      isPaused={true}
      onSendCommand={send}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Review matched business sale",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  rerender(
    <RecurringBusinessExitPanel
      match={{ ...match, hasActiveTransaction: true }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Review matched business sale",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
