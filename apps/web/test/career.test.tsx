// @vitest-environment happy-dom
import { asPlayerId, type MatchPlayerView } from "@interests/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CareerPanel } from "../src/components/CareerPanel";
import { ObjectiveRequirements } from "../src/components/ObjectiveRequirements";

afterEach(cleanup);
function match(): MatchPlayerView {
  const actor = asPlayerId("a");
  return {
    matchId: "ui-career" as MatchPlayerView["matchId"],
    modeId: "standard-v1",
    revision: 5,
    phase: "ready-for-first-round",
    currentQuarter: 1,
    result: null,
    round: {
      stage: "spotlight",
      activeSpotlightPlayerId: actor,
      spotlightOrder: [actor],
      spotlightsCompleted: 0,
    },
    players: [],
    activeTransaction: null,
    self: {
      playerId: actor,
      profileId: "corporate-climber",
      offeredObjectiveIds: ["executive-owner", "independent"],
      selectedObjectiveId: "executive-owner",
      cashCents: 2_000_000,
      reservedCashCents: 0,
      availableCashCents: 2_000_000,
      financialDetails: {
        quarterlyIncomeCents: 2_250_000,
        quarterlyLivingExpenseCents: 1_500_000,
        entitledQuarterlyIncomeCents: 2_250_000,
        entitledQuarterlyLivingExpenseCents: 1_500_000,
        annualLaborCompensationCents: 9_000_000,
        labor: { kind: "employment", role: "professional" },
        focus: "general",
        completedObservationQuarters: 0,
        properties: [],
        publicMarkets: ["broad-index", "dividend-income", "growth"].map(
          (id) => ({ id, valueCents: 100_000, basisCents: 100_000 }),
        ),
        objectiveRequirements: [
          {
            objectiveId: "executive-owner",
            instructionsVersion: "test-v1",
            instructions: ["Executive career tier required."],
            targets: { annualEmploymentIncomeCents: 18_000_000 },
          },
          {
            objectiveId: "independent",
            instructionsVersion: "test-v1",
            instructions: ["No labor-dependent income."],
            targets: { liquidityCents: 5_000_000 },
          },
        ],
        careerOffers: [
          {
            id: "quoted-id",
            name: "Steady role",
            role: "professional",
            annualCompensationCents: 9_720_000,
            raiseBps: 800,
            transitionCostCents: 0,
            ownershipCostCents: 0,
            ownershipPurchaseFeeCents: 0,
            totalCashRequiredCents: 0,
            ownershipPosition: null,
            affordable: true,
            tradeoff:
              "Smaller raise without transition costs. Replaces your current labor role.",
          },
        ],
      },
    },
  };
}
it("shows authoritative offers, tradeoffs and quarter timing, and sends only the quoted offer ID", async () => {
  const view = match();
  const send = vi.fn().mockResolvedValue({ ok: true });
  render(<CareerPanel match={view} isPaused={false} onSendCommand={send} />);
  expect(
    screen.getByText(/Each acceptance or resignation/).textContent,
  ).toContain("Changes take effect next quarter");
  expect(screen.getByText(/Smaller raise without/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Accept ${view.self.financialDetails.careerOffers[0]!.name}`,
    }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "ACCEPT_CAREER_OFFER",
      offerId: view.self.financialDetails.careerOffers[0]!.id,
    }),
  );
});
it("disables offturn and paused actions while preserving readable private quotes", () => {
  const view = match();
  const send = vi.fn();
  const mounted = render(
    <CareerPanel
      match={{
        ...view,
        round: { ...view.round!, activeSpotlightPlayerId: asPlayerId("other") },
      }}
      isPaused={false}
      onSendCommand={send}
    />,
  );
  expect(
    screen
      .getAllByRole("button")
      .every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
  mounted.rerender(<CareerPanel match={view} isPaused onSendCommand={send} />);
  expect(
    screen
      .getAllByRole("button")
      .every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
  expect(send).not.toHaveBeenCalled();
});
it("shows failures and allows retry after a rejected acceptance", async () => {
  const view = match();
  const send = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { message: "STALE_REVISION" } });
  render(<CareerPanel match={view} isPaused={false} onSendCommand={send} />);
  const button = screen.getByRole("button", {
    name: `Accept ${view.self.financialDetails.careerOffers[0]!.name}`,
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("STALE_REVISION"),
  );
  expect((button as HTMLButtonElement).disabled).toBe(false);
});
it("renders private fund values/basis, property details and only the selected exact objective requirements", () => {
  const view = match();
  render(<ObjectiveRequirements self={view.self} />);
  expect(
    screen.getByRole("heading", { name: "Your private finances" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Public funds" })).toBeTruthy();
  expect(screen.getAllByText(/cost basis/)).toHaveLength(3);
  expect(
    screen.getByRole("heading", { name: view.self.selectedObjectiveId! }),
  ).toBeTruthy();
  expect(screen.getByText(/Missing quarters count as zero/)).toBeTruthy();
  fireEvent.click(screen.getByText("Inspect exact requirements"));
  expect(screen.getByText("Executive career tier required.")).toBeTruthy();
  const unselected = view.self.offeredObjectiveIds.find(
    (id) => id !== view.self.selectedObjectiveId,
  )!;
  expect(screen.queryByRole("heading", { name: unselected })).toBeNull();
});

it("shows the authoritative executive purchase fee and total funding requirement before acceptance", () => {
  const view = match();
  const offer = {
    ...view.self.financialDetails.careerOffers[0]!,
    ownershipCostCents: 10_000_000,
    ownershipPurchaseFeeCents: 200_000,
    totalCashRequiredCents: 10_200_000,
    affordable: false,
  };
  render(
    <CareerPanel
      match={{
        ...view,
        self: {
          ...view.self,
          financialDetails: {
            ...view.self.financialDetails,
            careerOffers: [offer],
          },
        },
      }}
      isPaused={false}
      onSendCommand={vi.fn()}
    />,
  );
  expect(screen.getByText(/Business purchase fee:/).textContent).toContain(
    "Business purchase fee: $2,000. Total cash required: $102,000.",
  );
  expect(
    (
      screen.getByRole("button", {
        name: `Accept ${offer.name}`,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
