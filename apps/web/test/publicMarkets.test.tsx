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
