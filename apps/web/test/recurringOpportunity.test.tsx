// @vitest-environment happy-dom
import type {
  MatchPlayerView,
  RecurringOpportunityView,
} from "@interests/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecurringOpportunityPanel } from "../src/components/RecurringOpportunityPanel";

const card: RecurringOpportunityView = {
  id: "opportunity-7",
  templateId: "local-service-company",
  name: "Local service company",
  category: "business",
  intensity: "standard",
  summary: "An independent seller offers an operating company.",
  action: "npc-business-purchase",
  createdQuarter: 2,
  status: "available",
  askingPriceCents: 10_000_000,
  investigationFeeCents: 25_000,
  investigated: false,
};
const match = {
  phase: "ready-for-first-round",
  self: {
    availableCashCents: 100_000,
    financialDetails: { focus: "general" },
    recurringOpportunity: card,
  },
} as unknown as MatchPlayerView;
afterEach(cleanup);

it("renders the authoritative fee, hides facts and sends only the card ID for investigation", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true });
  render(
    <RecurringOpportunityPanel
      match={match}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(screen.getByText(/Optional investigation costs \$250/)).toBeTruthy();
  expect(screen.queryByTestId("recurring-facts")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /buy|purchase|finance/i }),
  ).toBeNull();
  fireEvent.click(screen.getByTestId("investigate-recurring-btn"));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "INVESTIGATE_OPPORTUNITY",
      opportunityId: "opportunity-7",
    }),
  );
});

it("changes future focus without sending replacement terms or rerolling the current card", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true });
  const { rerender } = render(
    <RecurringOpportunityPanel
      match={match}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  fireEvent.change(screen.getByLabelText("Focus for future opportunities"), {
    target: { value: "property" },
  });
  fireEvent.click(screen.getByTestId("set-focus-btn"));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({ type: "SET_FOCUS", focus: "property" }),
  );
  expect(screen.getByTestId("recurring-card-name").textContent).toBe(card.name);
  rerender(
    <RecurringOpportunityPanel
      match={{
        ...match,
        self: {
          ...match.self,
          financialDetails: {
            ...match.self.financialDetails,
            focus: "property",
          },
        },
      }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    (screen.getByTestId("set-focus-btn") as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("disables paid inquiry for expired, paused and unaffordable cards", () => {
  const send = vi.fn();
  const { rerender } = render(
    <RecurringOpportunityPanel
      match={match}
      isPaused={true}
      onSendCommand={send}
    />,
  );
  expect(
    (screen.getByTestId("investigate-recurring-btn") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <RecurringOpportunityPanel
      match={{ ...match, self: { ...match.self, availableCashCents: 24_999 } }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    (screen.getByTestId("investigate-recurring-btn") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen.getByText("Available cash does not cover the investigation fee."),
  ).toBeTruthy();
  rerender(
    <RecurringOpportunityPanel
      match={{
        ...match,
        self: {
          ...match.self,
          recurringOpportunity: { ...card, status: "expired" },
        },
      }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    (screen.getByTestId("investigate-recurring-btn") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("expired");
  expect(send).not.toHaveBeenCalled();
});

it("shows revealed business and property facts without exposing a nonfunctional close button", () => {
  const { rerender } = render(
    <RecurringOpportunityPanel
      match={{
        ...match,
        self: {
          ...match.self,
          recurringOpportunity: {
            ...card,
            investigated: true,
            facts: {
              kind: "business",
              annualRevenueCents: 25_000_000,
              annualOperatingProfitCents: 3_000_000,
              enterpriseValueCents: 12_000_000,
              debtPrincipalCents: 0,
            },
          },
        },
      }}
      isPaused={false}
      onSendCommand={vi.fn()}
    />,
  );
  expect(screen.getByTestId("recurring-facts").textContent).toContain(
    "Annual operating profit after necessary labor$30,000",
  );
  expect(screen.queryByTestId("investigate-recurring-btn")).toBeNull();
  rerender(
    <RecurringOpportunityPanel
      match={{
        ...match,
        self: {
          ...match.self,
          recurringOpportunity: {
            ...card,
            category: "property",
            investigated: true,
            facts: {
              kind: "property",
              marketValueCents: 15_500_000,
              scheduledQuarterlyRentCents: 450_000,
              occupancyBps: 9500,
              operatingExpenseRatioBps: 3500,
            },
          },
        },
      }}
      isPaused={false}
      onSendCommand={vi.fn()}
    />,
  );
  expect(screen.getByTestId("recurring-facts").textContent).toContain(
    "Occupancy95.00%",
  );
  expect(
    screen.queryByRole("button", { name: /buy|purchase|finance/i }),
  ).toBeNull();
});

it("displays rejection and timeout feedback and permits an explicit retry", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: { message: "Card expired" } })
    .mockRejectedValueOnce(new Error("Acknowledgement timed out"));
  render(
    <RecurringOpportunityPanel
      match={match}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  fireEvent.click(screen.getByTestId("investigate-recurring-btn"));
  expect((await screen.findByRole("alert")).textContent).toBe("Card expired");
  fireEvent.click(screen.getByTestId("investigate-recurring-btn"));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Acknowledgement timed out",
    ),
  );
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
});
