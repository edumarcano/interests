// @vitest-environment happy-dom
import type {
  MatchPlayerView,
  RecurringAcquisitionQuote,
} from "@interests/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { previewRecurringAcquisition } from "../src/api/client";
import { RecurringAcquisitionPanel } from "../src/components/RecurringAcquisitionPanel";

vi.mock("../src/api/client", () => ({ previewRecurringAcquisition: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const quote: RecurringAcquisitionQuote = {
  id: "stored-quote",
  opportunityId: "opportunity-1",
  route: "bank-fixed",
  kind: "business",
  askingPriceCents: 10_000_000,
  purchaseFeeCents: 200_000,
  principalCents: 5_000_000,
  annualRateBps: 775,
  termQuarters: 28,
  quarterlyPaymentCents: 232_849,
  assetReserveCents: 232_849,
  personalReserveCents: 1_200_000,
  cashRequiredCents: 5_432_849,
  canClose: true,
};
const match = {
  revision: 4,
  self: {
    playerId: "player-1",
    recurringOpportunity: {
      id: "opportunity-1",
      action: "npc-business-purchase",
      status: "available",
      name: "Local service company",
      investigated: false,
    },
  },
  round: { activeSpotlightPlayerId: "player-1" },
} as unknown as MatchPlayerView;
it("reviews authoritative amounts and sends only the accepted card and quote IDs after confirmation", async () => {
  vi.mocked(previewRecurringAcquisition).mockResolvedValue([quote]);
  const send = vi.fn().mockResolvedValue({ ok: true });
  render(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={match}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  await screen.findByTestId("review-recurring-bank-fixed");
  expect(previewRecurringAcquisition).toHaveBeenCalledWith(
    "ABCDEF",
    "opportunity-1",
  );
  expect(screen.getByText(/Cash invested/).textContent).toContain("$54,328.49");
  fireEvent.click(screen.getByTestId("review-recurring-bank-fixed"));
  expect(screen.getByRole("dialog").textContent).toContain(
    "You have not paid for operating investigation",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel purchase" }));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("review-recurring-bank-fixed"));
  fireEvent.click(screen.getByTestId("confirm-recurring-acquisition"));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "ACQUIRE_RECURRING_OPPORTUNITY",
      opportunityId: "opportunity-1",
      quoteId: "stored-quote",
    }),
  );
});
it("allows off-turn planning but gates off-turn, paused and unaffordable confirmation", async () => {
  vi.mocked(previewRecurringAcquisition).mockResolvedValue([quote]);
  const send = vi.fn();
  const { rerender } = render(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={{
        ...match,
        round: { ...match.round!, activeSpotlightPlayerId: "player-2" },
      }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  expect(
    (await screen.findByTestId(
      "review-recurring-bank-fixed",
    )) as HTMLButtonElement,
  ).toHaveProperty("disabled", true);
  rerender(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={match}
      isPaused={true}
      onSendCommand={send}
    />,
  );
  expect(
    screen.getByTestId("preview-recurring-acquisition") as HTMLButtonElement,
  ).toHaveProperty("disabled", true);
  expect(send).not.toHaveBeenCalled();
});
it("discards an obsolete preview after a revision change and permits another preview", async () => {
  let resolve!: (value: readonly RecurringAcquisitionQuote[]) => void;
  vi.mocked(previewRecurringAcquisition).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { rerender } = render(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={match}
      isPaused={false}
      onSendCommand={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  rerender(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={{ ...match, revision: 5 }}
      isPaused={false}
      onSendCommand={vi.fn()}
    />,
  );
  resolve([quote]);
  await waitFor(() =>
    expect(
      screen.getByTestId("preview-recurring-acquisition") as HTMLButtonElement,
    ).toHaveProperty("disabled", false),
  );
  expect(screen.queryByTestId("review-recurring-bank-fixed")).toBeNull();
});
it("renders a rejected confirmation without pretending that the purchase succeeded", async () => {
  vi.mocked(previewRecurringAcquisition).mockResolvedValue([quote]);
  const send = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { message: "Quote is stale" } });
  render(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={match}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  await screen.findByTestId("review-recurring-bank-fixed");
  fireEvent.click(screen.getByTestId("review-recurring-bank-fixed"));
  fireEvent.click(screen.getByTestId("confirm-recurring-acquisition"));
  expect((await screen.findByRole("alert")).textContent).toBe("Quote is stale");
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("shows the quoted public property market type before optional investigation", async () => {
  vi.mocked(previewRecurringAcquisition).mockResolvedValue([
    { ...quote, kind: "property", propertyMarketKind: "commercial" },
  ]);
  const propertyMatch = {
    ...match,
    self: {
      ...match.self,
      recurringOpportunity: {
        ...match.self.recurringOpportunity!,
        action: "npc-property-purchase" as const,
        name: "Commercial service center",
      },
    },
  };
  render(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={propertyMatch}
      isPaused={false}
      onSendCommand={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  expect(
    (await screen.findByText("Property market: commercial")).textContent,
  ).toBe("Property market: commercial");
  expect(screen.queryByTestId("recurring-facts")).toBeNull();
});

function acquisitionFinaleMatch(
  objectiveId: string,
  kind: "business" | "property",
  status: "eligible" | "ineligible" = "eligible",
): MatchPlayerView {
  return {
    ...match,
    self: {
      ...match.self,
      selectedObjectiveId: objectiveId,
      financialDetails: {
        ...match.self.financialDetails,
        objectiveEvaluation: { objectiveId, status, checks: [] },
      },
      recurringOpportunity: {
        ...match.self.recurringOpportunity!,
        action:
          kind === "business"
            ? "npc-business-purchase"
            : "npc-property-purchase",
      },
    },
  };
}
it.each([
  ["founder", "business"],
  ["property-magnate", "property"],
  ["capital-allocator", "business"],
  ["capital-allocator", "property"],
  ["deal-maker", "business"],
  ["deal-maker", "property"],
  ["wealth-architect", "business"],
  ["wealth-architect", "property"],
] as const)(
  "offers eligible %s a separate %s acquisition finale without changing the ordinary purchase",
  async (objectiveId, kind) => {
    vi.mocked(previewRecurringAcquisition).mockResolvedValue([
      { ...quote, kind },
    ]);
    const send = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RecurringAcquisitionPanel
        roomCode="ABCDEF"
        match={acquisitionFinaleMatch(objectiveId, kind)}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
    await screen.findByTestId("review-recurring-bank-fixed");
    expect(
      screen.getByTestId("review-recurring-bank-fixed") as HTMLButtonElement,
    ).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByTestId("review-recurring-finale-bank-fixed"));
    const dialog = screen.getByRole("dialog", {
      name: "Confirm acquisition finale",
    });
    expect(dialog.textContent).toContain("$54,328.49");
    expect(dialog.textContent).toContain("$2,000");
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-recurring-finale"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "PURSUE_FINALE",
        action: {
          type: "ACQUIRE_RECURRING_OPPORTUNITY",
          opportunityId: "opportunity-1",
          quoteId: "stored-quote",
        },
      }),
    );
  },
);
it.each([
  ["founder", "property"],
  ["property-magnate", "business"],
  ["independent", "business"],
  ["financier", "business"],
  ["executive", "property"],
] as const)(
  "keeps %s's unsupported %s purchase ordinary",
  async (objectiveId, kind) => {
    vi.mocked(previewRecurringAcquisition).mockResolvedValue([
      { ...quote, kind },
    ]);
    render(
      <RecurringAcquisitionPanel
        roomCode="ABCDEF"
        match={acquisitionFinaleMatch(objectiveId, kind)}
        isPaused={false}
        onSendCommand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
    await screen.findByTestId("review-recurring-bank-fixed");
    expect(
      screen.queryByTestId("review-recurring-finale-bank-fixed"),
    ).toBeNull();
    expect(
      screen.getByTestId("review-recurring-bank-fixed") as HTMLButtonElement,
    ).toHaveProperty("disabled", false);
  },
);
it("clears finale intent on cancellation and revision, and ordinary confirmation stays an ordinary ID-only action", async () => {
  vi.mocked(previewRecurringAcquisition).mockResolvedValue([quote]);
  const send = vi.fn().mockResolvedValue({ ok: true });
  const eligible = acquisitionFinaleMatch("founder", "business");
  const { rerender } = render(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={eligible}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  await screen.findByTestId("review-recurring-finale-bank-fixed");
  fireEvent.click(screen.getByTestId("review-recurring-finale-bank-fixed"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel finale" }));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("review-recurring-finale-bank-fixed"));
  rerender(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={{ ...eligible, revision: 5 }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  await screen.findByTestId("review-recurring-bank-fixed");
  fireEvent.click(screen.getByTestId("review-recurring-bank-fixed"));
  fireEvent.click(screen.getByTestId("confirm-recurring-acquisition"));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "ACQUIRE_RECURRING_OPPORTUNITY",
      opportunityId: "opportunity-1",
      quoteId: "stored-quote",
    }),
  );
});
it("blocks paused/off-turn or changed private eligibility after acquisition finale review", async () => {
  vi.mocked(previewRecurringAcquisition).mockResolvedValue([quote]);
  const send = vi.fn();
  const eligible = acquisitionFinaleMatch("founder", "business");
  const { rerender } = render(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={eligible}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  fireEvent.click(screen.getByTestId("preview-recurring-acquisition"));
  await screen.findByTestId("review-recurring-finale-bank-fixed");
  fireEvent.click(screen.getByTestId("review-recurring-finale-bank-fixed"));
  rerender(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={eligible}
      isPaused={true}
      onSendCommand={send}
    />,
  );
  expect(
    screen.getByTestId("confirm-recurring-finale") as HTMLButtonElement,
  ).toHaveProperty("disabled", true);
  rerender(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={{
        ...eligible,
        round: { ...eligible.round!, activeSpotlightPlayerId: "other" },
      }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    screen.getByTestId("confirm-recurring-finale") as HTMLButtonElement,
  ).toHaveProperty("disabled", true);
  rerender(
    <RecurringAcquisitionPanel
      roomCode="ABCDEF"
      match={acquisitionFinaleMatch("founder", "business", "ineligible")}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    screen.getByTestId("confirm-recurring-finale") as HTMLButtonElement,
  ).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByTestId("confirm-recurring-finale"));
  expect(send).not.toHaveBeenCalled();
  expect(screen.queryByTestId("review-recurring-finale-bank-fixed")).toBeNull();
});
