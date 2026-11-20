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
        objectiveEvaluation: null,
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

it("renders engine-provided qualitative checks and updates them while exact private requirements remain available", () => {
  const view = match();
  const evaluation = {
    objectiveId: "executive-owner",
    status: "ineligible" as const,
    checks: [
      {
        id: "executive-career-tier",
        label: "An executive career role",
        met: false,
        actual: 0,
        target: 1,
        comparison: "required" as const,
      },
      {
        id: "liquid-capital",
        label: "Liquid capital",
        met: true,
        actual: 8_000_000,
        target: 7_500_000,
        comparison: "minimum" as const,
      },
    ],
  };
  const self = {
    ...view.self,
    financialDetails: {
      ...view.self.financialDetails,
      objectiveEvaluation: evaluation,
    },
  };
  const mounted = render(<ObjectiveRequirements self={self} />);
  expect(
    screen.getByRole("region", { name: "Your objective progress" }),
  ).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "Requirements are still outstanding.",
  );
  expect(
    screen.getByText("An executive career role").closest("li")!.textContent,
  ).toContain("Still needed");
  expect(
    screen.getByText("Liquid capital").closest("li")!.textContent,
  ).toContain("Met:");
  expect(screen.getByText(/Victory requires a successful/)).toBeTruthy();
  fireEvent.click(screen.getByText("Inspect exact requirements"));
  expect(screen.getByText("Executive career tier required.")).toBeTruthy();
  mounted.rerender(
    <ObjectiveRequirements
      self={{
        ...self,
        financialDetails: {
          ...self.financialDetails,
          objectiveEvaluation: {
            ...evaluation,
            status: "eligible",
            checks: evaluation.checks.map((check) => ({
              ...check,
              met: true,
              actual: check.target,
            })),
          },
        },
      }}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("Requirements met.");
  expect(screen.queryByText(/Still needed/)).toBeNull();
});

it("keeps unavailable or mismatched progress distinct from an eligibility failure", () => {
  const view = match();
  const mounted = render(<ObjectiveRequirements self={view.self} />);
  expect(screen.getByText(/Progress is unavailable/)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  mounted.rerender(
    <ObjectiveRequirements
      self={{
        ...view.self,
        financialDetails: {
          ...view.self.financialDetails,
          objectiveEvaluation: {
            objectiveId: "independent",
            status: "eligible",
            checks: [
              {
                id: "liquid-capital",
                label: "Unselected private requirement",
                met: true,
                actual: 1,
                target: 1,
                comparison: "minimum",
              },
            ],
          },
        },
      }}
    />,
  );
  expect(screen.queryByText("Unselected private requirement")).toBeNull();
  expect(screen.queryByText("Requirements met.")).toBeNull();
});

/** UI-only eligible projection fixture; engine finale accounting is tested separately. */
function finaleMatch(
  goal: "independent" | "executive-owner",
  labor: "employment" | "owner-work" | "not-working" = "employment",
): MatchPlayerView {
  const view = match();
  const offers = view.self.financialDetails.careerOffers;
  return {
    ...view,
    self: {
      ...view.self,
      selectedObjectiveId: goal,
      financialDetails: {
        ...view.self.financialDetails,
        objectiveEvaluation: {
          objectiveId: goal,
          status: "eligible",
          checks: [],
        },
        labor:
          labor === "employment"
            ? {
                kind: "employment",
                role: goal === "executive-owner" ? "executive" : "professional",
              }
            : labor === "owner-work"
              ? { kind: "owner-work", assetId: "owned-company" }
              : { kind: "not-working" },
        careerOffers:
          goal === "executive-owner"
            ? [
                ...offers,
                {
                  ...offers[0]!,
                  id: "executive-quote",
                  name: "Executive ownership position",
                  role: "executive",
                  ownershipCostCents: 10_000_000,
                  ownershipPurchaseFeeCents: 200_000,
                  totalCashRequiredCents: 10_200_000,
                  ownershipPosition: {
                    annualRevenueCents: 10_000_000,
                    annualOperatingProfitCents: 2_000_000,
                    enterpriseValueCents: 10_000_000,
                    companyCashCents: 0,
                    debtPrincipalCents: 0,
                    ownershipPpm: 1_000_000,
                  },
                },
              ]
            : offers,
      },
    },
  };
}

it.each(["employment", "owner-work", "not-working"] as const)(
  "offers only the actual %s Independent route and requires an explicit attempt",
  async (labor) => {
    const view = finaleMatch("independent", labor);
    const send = vi.fn().mockResolvedValue({ ok: true });
    render(<CareerPanel match={view} isPaused={false} onSendCommand={send} />);
    expect(send).not.toHaveBeenCalled();
    const button = screen.getByRole("button", {
      name: /^Attempt Independent finale/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(
      screen.queryByRole("button", { name: /^Attempt Executive Owner finale/ }),
    ).toBeNull();
    if (labor === "not-working") {
      expect(button.textContent).toContain("confirm independence");
      expect(
        screen.queryByRole("button", { name: "Resign from employment" }),
      ).toBeNull();
    } else {
      expect(button.textContent).not.toContain("confirm independence");
      const ordinary = screen.getByRole("button", {
        name:
          labor === "owner-work"
            ? "Hire management and stop owner work"
            : "Resign from employment",
      });
      fireEvent.click(ordinary);
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith({ type: "RESIGN_LABOR" }),
      );
    }
    fireEvent.click(button);
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith({
        type: "PURSUE_FINALE",
        action: {
          type:
            labor === "not-working" ? "CONFIRM_INDEPENDENCE" : "RESIGN_LABOR",
        },
      }),
    );
  },
);

it("keeps ordinary executive acceptance separate and offers a finale only for funded executive ownership", async () => {
  let view = finaleMatch("executive-owner");
  const valid = view.self.financialDetails.careerOffers[1]!;
  view = {
    ...view,
    self: {
      ...view.self,
      financialDetails: {
        ...view.self.financialDetails,
        careerOffers: [
          ...view.self.financialDetails.careerOffers,
          {
            ...valid,
            id: "salary-only",
            name: "Salary-only executive",
            ownershipPosition: null,
          },
          {
            ...valid,
            id: "professional-ownership",
            name: "Professional ownership",
            role: "professional",
          },
          {
            ...valid,
            id: "free-ownership",
            name: "Unfunded ownership",
            ownershipCostCents: 0,
          },
        ],
      },
    },
  };
  const send = vi.fn().mockResolvedValue({ ok: true });
  render(<CareerPanel match={view} isPaused={false} onSendCommand={send} />);
  expect(
    screen.getAllByRole("button", { name: /^Attempt Executive Owner finale/ }),
  ).toHaveLength(1);
  expect(screen.getByText(/total cash required \$102,000/)).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: `Accept ${valid.name}` }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "ACCEPT_CAREER_OFFER",
      offerId: valid.id,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: `Attempt Executive Owner finale: ${valid.name}`,
    }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith({
      type: "PURSUE_FINALE",
      action: { type: "ACCEPT_CAREER_OFFER", offerId: valid.id },
    }),
  );
});

it("hides private finale controls for ineligible, missing, mismatched and unsupported objectives or a finished match", () => {
  const base = finaleMatch("independent");
  const send = vi.fn();
  const mounted = render(
    <CareerPanel match={base} isPaused={false} onSendCommand={send} />,
  );
  const views = [
    {
      ...base,
      self: {
        ...base.self,
        financialDetails: {
          ...base.self.financialDetails,
          objectiveEvaluation: null,
        },
      },
    },
    {
      ...base,
      self: {
        ...base.self,
        financialDetails: {
          ...base.self.financialDetails,
          objectiveEvaluation: {
            objectiveId: "independent",
            status: "ineligible" as const,
            checks: [],
          },
        },
      },
    },
    {
      ...base,
      self: {
        ...base.self,
        financialDetails: {
          ...base.self.financialDetails,
          objectiveEvaluation: {
            objectiveId: "executive-owner",
            status: "eligible" as const,
            checks: [],
          },
        },
      },
    },
    {
      ...base,
      self: {
        ...base.self,
        selectedObjectiveId: "founder",
        financialDetails: {
          ...base.self.financialDetails,
          objectiveEvaluation: {
            objectiveId: "founder",
            status: "eligible" as const,
            checks: [],
          },
        },
      },
    },
    { ...base, phase: "finished" as const, round: null },
  ];
  for (const view of views) {
    mounted.rerender(
      <CareerPanel match={view} isPaused={false} onSendCommand={send} />,
    );
    expect(
      screen.queryByRole("region", { name: "Your private career finale" }),
    ).toBeNull();
  }
  expect(send).not.toHaveBeenCalled();
});

it.each(["independent", "executive-owner"] as const)(
  "gates %s attempts by pause, own spotlight and active transaction",
  (goal) => {
    const base = finaleMatch(goal);
    const send = vi.fn();
    const mounted = render(
      <CareerPanel match={base} isPaused={false} onSendCommand={send} />,
    );
    const button = () =>
      screen.getByRole("button", {
        name: /^Attempt .* finale/,
      }) as HTMLButtonElement;
    expect(button().disabled).toBe(false);
    mounted.rerender(
      <CareerPanel match={base} isPaused onSendCommand={send} />,
    );
    expect(button().disabled).toBe(true);
    for (const view of [
      {
        ...base,
        round: { ...base.round!, activeSpotlightPlayerId: asPlayerId("other") },
      },
      { ...base, round: { ...base.round!, stage: "round-start" as const } },
      {
        ...base,
        activeTransaction: {} as NonNullable<
          MatchPlayerView["activeTransaction"]
        >,
      },
    ]) {
      mounted.rerender(
        <CareerPanel match={view} isPaused={false} onSendCommand={send} />,
      );
      expect(button().disabled).toBe(true);
      fireEvent.click(button());
    }
    expect(send).not.toHaveBeenCalled();
  },
);

it("uses authoritative offer affordability for the executive attempt", () => {
  const base = finaleMatch("executive-owner");
  const view = {
    ...base,
    self: {
      ...base.self,
      financialDetails: {
        ...base.self.financialDetails,
        careerOffers: base.self.financialDetails.careerOffers.map((offer) => ({
          ...offer,
          affordable: false,
        })),
      },
    },
  };
  render(<CareerPanel match={view} isPaused={false} onSendCommand={vi.fn()} />);
  expect(
    (
      screen.getByRole("button", {
        name: /^Attempt Executive Owner finale/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("makes a failed attempt readable, blocks concurrent actions and retries only on another explicit click", async () => {
  const view = finaleMatch("independent");
  const send = vi.fn().mockResolvedValue({
    ok: false,
    error: { code: "GAMEPLAY_REJECTED", message: "FINALE_INELIGIBLE" },
  });
  render(<CareerPanel match={view} isPaused={false} onSendCommand={send} />);
  const button = screen.getByRole("button", {
    name: /^Attempt Independent finale/,
  }) as HTMLButtonElement;
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Resign from employment",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "The finale requirements are not met for this attempt. No changes were made.",
    ),
  );
  expect(button.disabled).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenLastCalledWith({
    type: "PURSUE_FINALE",
    action: { type: "RESIGN_LABOR" },
  });
  fireEvent.click(button);
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
});
