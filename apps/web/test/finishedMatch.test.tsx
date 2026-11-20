// @vitest-environment happy-dom
import { asPlayerId, type MatchPlayerView } from "@interests/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MatchView } from "../src/components/MatchView";

afterEach(cleanup);
function finalMatch(): MatchPlayerView {
  return {
    matchId: "draw" as MatchPlayerView["matchId"],
    modeId: "standard-v1",
    revision: 164,
    phase: "finished",
    currentQuarter: 32,
    round: null,
    activeTransaction: null,
    players: [],
    result: { kind: "safety-draw", completedQuarter: 32 },
    self: {
      playerId: asPlayerId("self"),
      profileId: "corporate-climber",
      offeredObjectiveIds: ["independent", "founder"],
      selectedObjectiveId: "independent",
      cashCents: 123_456,
      reservedCashCents: 0,
      availableCashCents: 123_456,
      financialDetails: {
        annualLaborCompensationCents: null,
        careerOffers: [],
        quarterlyIncomeCents: 0,
        quarterlyLivingExpenseCents: 1_000,
        entitledQuarterlyIncomeCents: 2_000,
        entitledQuarterlyLivingExpenseCents: 1_000,
        labor: { kind: "not-working" },
        focus: "general",
        completedObservationQuarters: 4,
        properties: [],
        publicMarkets: [],
        objectiveRequirements: [],
      },
      lastSettlement: {
        quarter: 32,
        livingDueCents: 1_000,
        livingPaidCents: 1_000,
        livingArrearsCents: 0,
        loanPayments: [],
      },
    },
  };
}
it("renders the durable draw and own Q32 finances without setup, resume, career or gameplay controls", () => {
  const send = vi.fn(),
    resume = vi.fn();
  render(
    <MatchView
      match={finalMatch()}
      presence={null}
      pauseReasons={["DISCONNECTED_MEMBER", "SERVER_RESTART"]}
      isHost
      onSendCommand={send}
      onResumeRoom={resume}
    />,
  );
  expect(screen.getByRole("heading", { name: "Match drawn" })).toBeTruthy();
  expect(screen.getByTestId("final-result-description").textContent).toBe(
    "Quarter 32 has settled. The match ended in a draw.",
  );
  expect(screen.getByTestId("last-settlement").textContent).toContain(
    "Q32 settled",
  );
  expect(screen.getByTestId("self-total-cash").textContent).toBe("$1,234.56");
  expect(screen.queryByTestId("objective-selection-view")).toBeNull();
  expect(screen.queryByTestId("pause-banner")).toBeNull();
  expect(screen.queryByText(/Play continues/)).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Your objective progress" }),
  ).toBeNull();
  expect(screen.queryByText(/Due this quarter/)).toBeNull();
  expect(
    screen.getByText("Unpaid claims remain recorded in the final accounts."),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText(/Employment at closing/)).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
});
it("renders a public winner identity without introducing the winner's hidden objective", () => {
  const match: MatchPlayerView = {
    ...finalMatch(),
    result: {
      kind: "objective-victory",
      winnerPlayerId: asPlayerId("other"),
      completedQuarter: 12,
    },
    players: [
      {
        playerId: asPlayerId("other"),
        nickname: "Other player",
        roomMemberId: "other-member" as never,
        joinOrder: 1,
        isHost: false,
        hasSelectedObjective: true,
      },
    ],
  };
  render(
    <MatchView
      match={match}
      presence={null}
      pauseReasons={[]}
      isHost={false}
      onSendCommand={vi.fn()}
      onResumeRoom={vi.fn()}
    />,
  );
  expect(screen.getByTestId("final-result-description").textContent).toBe(
    "Other player won in Quarter 12.",
  );
  expect(screen.queryByTestId("objective-selection-view")).toBeNull();
});
