// @vitest-environment happy-dom
import type {
  MatchPlayerView,
  PublicMarketTradePreview,
} from "@interests/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicMarketsPanel } from "../src/components/PublicMarketsPanel";

const match = {
  revision: 7,
  self: {
    playerId: "self",
    financialDetails: {
      publicMarkets: [
        {
          id: "growth-fund",
          name: "Growth Fund",
          valueCents: 100_000,
          basisCents: 90_000,
          annualDividendYieldBps: 50,
          tradeFeeBps: 25,
        },
      ],
    },
  },
  round: { activeSpotlightPlayerId: "self" },
  activeTransaction: null,
} as unknown as MatchPlayerView;
const quote: PublicMarketTradePreview = {
  revision: 7,
  feeRateBps: 25,
  trades: [
    {
      instrumentId: "growth-fund",
      buyCents: 1234,
      sellCents: 0,
      feeCents: 3,
      removedBasisCents: 0,
      realizedGainCents: 0,
      resultingValueCents: 101234,
      resultingBasisCents: 91237,
    },
  ],
  totalFeesCents: 3,
  cashImpactCents: -1237,
  resultingCashCents: 55555,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function stubPreview() {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ preview: quote }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("private public-market controls", () => {
  it("parses cents, displays the server's figures and submits only the quoted basket", async () => {
    const fetchMock = stubPreview();
    const send = vi.fn().mockResolvedValue({ ok: true });
    render(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={match}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    fireEvent.change(screen.getByLabelText("Growth Fund amount"), {
      target: { value: "12.34" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview market trades" }),
    );
    await screen.findByTestId("market-trade-preview");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      trades: [{ instrumentId: "growth-fund", buyCents: 1234, sellCents: 0 }],
    });
    expect(screen.getByTestId("market-trade-preview").textContent).toContain(
      "$555.55",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm trades and finish spotlight",
      }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "TRADE_PUBLIC_MARKETS",
        trades: [{ instrumentId: "growth-fund", buyCents: 1234, sellCents: 0 }],
      }),
    );
  });
  it("invalidates a quote after an edit and refuses fractional-cent input", async () => {
    const fetchMock = stubPreview();
    render(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={match}
        isPaused={false}
        onSendCommand={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Growth Fund amount"), {
      target: { value: "12.34" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview market trades" }),
    );
    await screen.findByTestId("market-trade-preview");
    fireEvent.change(screen.getByLabelText("Growth Fund amount"), {
      target: { value: "12.345" },
    });
    expect(screen.queryByTestId("market-trade-preview")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview market trades" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "two decimal places",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("allows off-turn planning and disables stale, paused and off-turn confirmation", async () => {
    stubPreview();
    const props = {
      roomCode: "ROOM",
      match,
      isPaused: false,
      onSendCommand: vi.fn(),
    };
    const { rerender } = render(<PublicMarketsPanel {...props} />);
    fireEvent.change(screen.getByLabelText("Growth Fund amount"), {
      target: { value: "12.34" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview market trades" }),
    );
    await screen.findByTestId("market-trade-preview");
    const confirm = () =>
      screen.getByRole("button", {
        name: "Confirm trades and finish spotlight",
      }) as HTMLButtonElement;
    expect(confirm().disabled).toBe(false);
    rerender(<PublicMarketsPanel {...props} isPaused={true} />);
    expect(confirm().disabled).toBe(true);
    rerender(
      <PublicMarketsPanel {...props} match={{ ...match, revision: 8 }} />,
    );
    expect(confirm().disabled).toBe(true);
    expect(
      screen.getByText("Finances changed. Preview again before trading."),
    ).toBeTruthy();
    rerender(
      <PublicMarketsPanel
        {...props}
        match={{
          ...match,
          round: { ...match.round!, activeSpotlightPlayerId: "other" as never },
        }}
      />,
    );
    expect(confirm().disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Preview market trades",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

function marketFinaleMatch(
  objectiveId: string,
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
    },
  };
}
async function openMarketPreview() {
  fireEvent.change(screen.getByLabelText("Growth Fund amount"), {
    target: { value: "12.34" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Preview market trades" }),
  );
  await screen.findByTestId("market-trade-preview");
}
describe("private explicit market finale choice", () => {
  it.each(["capital-allocator", "deal-maker", "wealth-architect"])(
    "offers %s a separate quoted finale confirmation and sends only the explicit wrapper",
    async (objectiveId) => {
      stubPreview();
      const send = vi.fn().mockResolvedValue({ ok: true });
      render(
        <PublicMarketsPanel
          roomCode="ROOM"
          match={marketFinaleMatch(objectiveId)}
          isPaused={false}
          onSendCommand={send}
        />,
      );
      await openMarketPreview();
      expect(
        screen.getByRole("button", {
          name: "Confirm trades and finish spotlight",
        }),
      ).toBeTruthy();
      fireEvent.click(screen.getByTestId("review-market-finale"));
      expect(
        screen.getByRole("dialog", { name: "Confirm market finale" })
          .textContent,
      ).toContain("$555.55");
      expect(send).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("confirm-market-finale"));
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith({
          type: "PURSUE_FINALE",
          action: {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              { instrumentId: "growth-fund", buyCents: 1234, sellCents: 0 },
            ],
          },
        }),
      );
    },
  );
  it.each([
    "founder",
    "property-magnate",
    "independent",
    "financier",
    "executive",
  ])(
    "keeps the ordinary market action but exposes no unsupported %s finale",
    async (objectiveId) => {
      stubPreview();
      render(
        <PublicMarketsPanel
          roomCode="ROOM"
          match={marketFinaleMatch(objectiveId)}
          isPaused={false}
          onSendCommand={vi.fn()}
        />,
      );
      await openMarketPreview();
      expect(screen.queryByTestId("review-market-finale")).toBeNull();
      expect(
        screen.getByRole("button", {
          name: "Confirm trades and finish spotlight",
        }) as HTMLButtonElement,
      ).toHaveProperty("disabled", false);
    },
  );
  it("does not arm ordinary confirmation after cancelling a finale or editing the basket", async () => {
    stubPreview();
    const send = vi.fn().mockResolvedValue({ ok: true });
    render(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={marketFinaleMatch("capital-allocator")}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    await openMarketPreview();
    fireEvent.click(screen.getByTestId("review-market-finale"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel finale" }));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("review-market-finale"));
    fireEvent.change(screen.getByLabelText("Growth Fund amount"), {
      target: { value: "20" },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await openMarketPreview();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm trades and finish spotlight",
      }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "TRADE_PUBLIC_MARKETS",
        trades: [{ instrumentId: "growth-fund", buyCents: 1234, sellCents: 0 }],
      }),
    );
  });
  it("uses only matching private eligibility and blocks stale, paused and off-turn finale confirmation", async () => {
    stubPreview();
    const eligible = marketFinaleMatch("deal-maker"),
      send = vi.fn();
    const { rerender } = render(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={eligible}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    await openMarketPreview();
    fireEvent.click(screen.getByTestId("review-market-finale"));
    rerender(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={eligible}
        isPaused={true}
        onSendCommand={send}
      />,
    );
    expect(
      screen.getByTestId("confirm-market-finale") as HTMLButtonElement,
    ).toHaveProperty("disabled", true);
    rerender(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={{ ...eligible, revision: 8 }}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(
      screen.getByTestId("confirm-market-finale") as HTMLButtonElement,
    ).toHaveProperty("disabled", true);
    rerender(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={{
          ...eligible,
          round: {
            ...eligible.round!,
            activeSpotlightPlayerId: "other" as never,
          },
        }}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(
      screen.getByTestId("confirm-market-finale") as HTMLButtonElement,
    ).toHaveProperty("disabled", true);
    rerender(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={marketFinaleMatch("deal-maker", "ineligible")}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-market-finale"));
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByTestId("review-market-finale")).toBeNull();
    const mismatched = {
      ...eligible,
      self: { ...eligible.self, selectedObjectiveId: "wealth-architect" },
    };
    rerender(
      <PublicMarketsPanel
        roomCode="ROOM"
        match={mismatched}
        isPaused={false}
        onSendCommand={send}
      />,
    );
    expect(screen.queryByTestId("review-market-finale")).toBeNull();
  });
});
