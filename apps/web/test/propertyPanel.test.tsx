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
import { PropertyPanel } from "../src/components/PropertyPanel";

afterEach(cleanup);
it("reviews authoritative terms, cancels locally and submits the exact selected mortgage without client calculations", async () => {
  const match = {
    round: { activeSpotlightPlayerId: "A" },
    activeTransaction: null,
    self: {
      playerId: "A",
      availableCashCents: 4_000_000,
      propertyManagement: [],
      financialDetails: { properties: [] },
      propertyOffers: [
        {
          catalogueId: "residential-duplex",
          name: "Residential duplex",
          askingPriceCents: 10_000_000,
          scheduledQuarterlyRentCents: 275_000,
          occupancyBps: 9500,
          operatingExpenseRatioBps: 3000,
          quotes: [
            {
              termQuarters: 120,
              creditGrade: "good",
              creditEnvironment: "normal",
              maximumLtvBps: 7500,
              minimumDscrBps: 12000,
              principalCents: 7_500_000,
              rateKind: "variable",
              annualRateBps: 675,
              quarterlyPaymentCents: 145_916,
              feeCents: 200_000,
              assetReserveCents: 145_916,
              personalReserveCents: 700_000,
              cashRequiredCents: 2_845_916,
              canClose: true,
            },
          ],
        },
      ],
    },
  } as unknown as MatchPlayerView;
  const onSendCommand = vi.fn().mockResolvedValue({ ok: true });
  render(
    <PropertyPanel
      match={match}
      isPaused={false}
      onSendCommand={onSendCommand}
    />,
  );
  fireEvent.click(screen.getByText("View cash and mortgage terms"));
  const button = screen.getAllByRole("button", {
    name: "Review variable purchase",
  })[0]!;
  fireEvent.click(button);
  expect(
    screen.getByRole("region", { name: "Review property action" }).textContent,
  ).toContain("Cash required");
  fireEvent.click(screen.getByRole("button", { name: "Cancel review" }));
  expect(onSendCommand).not.toHaveBeenCalled();
  fireEvent.click(button);
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm property action" }),
  );
  const quote = match.self.propertyOffers![0]!.quotes.find(
    (item) => item.rateKind === "variable",
  )!;
  await waitFor(() =>
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "BUY_PROPERTY",
      catalogueId: "residential-duplex",
      principalCents: quote.principalCents,
      rateKind: "variable",
    }),
  );
});
