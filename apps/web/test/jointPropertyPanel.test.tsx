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
import { JointPropertyPanel } from "../src/components/JointPropertyPanel";

afterEach(cleanup);
const match = {
  hasActiveTransaction: true,
  round: { activeSpotlightPlayerId: "A" },
  players: [
    { playerId: "A", nickname: "Alice" },
    { playerId: "B", nickname: "Bob" },
  ],
  self: { playerId: "B", financialDetails: { properties: [] } },
  jointProperty: {
    id: "transaction-1",
    assetId: "property-1",
    initiatorPlayerId: "A",
    termsRevision: 3,
    terms: { kind: "renovation" },
    quote: {
      kind: "renovation",
      payerPlayerId: "A",
      cashRequiredCents: 1_000_000,
      effectiveQuarter: 2,
      rentIncreaseBps: 500,
      occupancyIncreaseBps: 500,
      valueIncreaseCents: 800_000,
    },
    ownershipByPlayerPpm: { A: 600_000, B: 400_000 },
    participantIds: ["A", "B"],
    confirmedPlayerIds: ["A"],
    yourCashRequiredCents: 0,
  },
} as unknown as MatchPlayerView;
it("shows the exact payer and cash effect to a co-owner and binds confirmation to the terms revision", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true });
  render(
    <JointPropertyPanel match={match} isPaused={false} onSendCommand={send} />,
  );
  expect(screen.getByTestId("joint-property-panel").textContent).toContain(
    "Alice alone pays $10,000.00",
  );
  expect(screen.getByTestId("joint-property-panel").textContent).toContain(
    "Your cash commitment: $0.00",
  );
  expect(
    screen.queryByRole("button", { name: "Close shared property agreement" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm exact property terms" }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "CONFIRM_JOINT_PROPERTY",
      transactionId: "transaction-1",
      expectedTermsRevision: 3,
    }),
  );
});
it("permits the initiator to cancel or revise, but gates close on unanimity and pause", () => {
  const send = vi.fn();
  const own = {
    ...match,
    self: { ...match.self, playerId: "A" },
  } as MatchPlayerView;
  const { rerender } = render(
    <JointPropertyPanel match={own} isPaused={false} onSendCommand={send} />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Close shared property agreement",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel shared property agreement" }),
  );
  expect(send).toHaveBeenCalledWith({
    type: "CANCEL_JOINT_PROPERTY",
    transactionId: "transaction-1",
    expectedTermsRevision: 3,
  });
  rerender(
    <JointPropertyPanel
      match={{
        ...own,
        jointProperty: {
          ...own.jointProperty!,
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
        name: "Close shared property agreement",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
