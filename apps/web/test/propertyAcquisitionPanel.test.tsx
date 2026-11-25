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
import { PropertyAcquisitionPanel } from "../src/components/PropertyAcquisitionPanel";

afterEach(cleanup);
const match = {
  hasActiveTransaction: true,
  round: { activeSpotlightPlayerId: "A" },
  players: [
    { playerId: "A", nickname: "Alice" },
    { playerId: "B", nickname: "Bob" },
  ],
  self: { playerId: "B", propertyOffers: [] },
  propertyAcquisition: {
    id: "transaction-1",
    leadPlayerId: "A",
    termsRevision: 4,
    terms: {
      catalogueId: "residential-duplex",
      principalCents: 7_000_000,
      rateKind: "fixed",
      buyers: [
        {
          playerId: "A",
          cashContributionCents: 1_000_000,
          ownershipPpm: 600_000,
        },
        {
          playerId: "B",
          cashContributionCents: 2_300_000,
          ownershipPpm: 400_000,
        },
      ],
    },
    quote: {
      askingPriceCents: 10_000_000,
      feeCents: 200_000,
      assetReserveCents: 100_000,
      cashRequiredCents: 3_300_000,
      principalCents: 7_000_000,
      rateKind: "fixed",
      annualRateBps: 675,
      quarterlyPaymentCents: 100_000,
      firstDueQuarter: 2,
      termQuarters: 120,
    },
    confirmedPlayerIds: ["A"],
  },
} as unknown as MatchPlayerView;
it("shows negotiated cash, ownership and debt to each buyer with revision-bound consent", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true });
  render(
    <PropertyAcquisitionPanel
      match={match}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    screen.getByTestId("property-acquisition-panel").textContent,
  ).toContain("Bob pays $23,000.00, receives 40% ownership");
  expect(
    screen.getByTestId("property-acquisition-panel").textContent,
  ).toContain("Asset mortgage $70,000.00, fixed 6.75% APR");
  expect(
    screen.queryByRole("button", { name: "Close shared property purchase" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm exact purchase terms" }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "CONFIRM_PROPERTY_ACQUISITION",
      transactionId: "transaction-1",
      expectedTermsRevision: 4,
    }),
  );
});
it("gates the lead's close on every buyer and pause while retaining cancellation", () => {
  const own = {
    ...match,
    self: { ...match.self, playerId: "A" },
  } as MatchPlayerView;
  const send = vi.fn();
  const { rerender } = render(
    <PropertyAcquisitionPanel
      match={own}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Close shared property purchase",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel shared purchase" }),
  );
  expect(send).toHaveBeenCalledWith({
    type: "CANCEL_PROPERTY_ACQUISITION",
    transactionId: "transaction-1",
    expectedTermsRevision: 4,
  });
  rerender(
    <PropertyAcquisitionPanel
      match={{
        ...own,
        propertyAcquisition: {
          ...own.propertyAcquisition!,
          confirmedPlayerIds: ["A", "B"],
        },
      }}
      isPaused={true}
      onSendCommand={send}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Close shared property purchase",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
