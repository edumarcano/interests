import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  PublicMarketTradeLeg,
  PublicMarketTradePreview,
} from "@interests/shared";
import { useRef, useState } from "react";
import { previewPublicMarkets } from "../api/client.js";

interface Props {
  roomCode: string;
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}
const money = (value: number) =>
  (value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function parseDollars(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a positive dollar amount with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const result = Number(`${whole}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error("Enter a positive amount within the supported range.");
  return result;
}

export function PublicMarketsPanel({
  roomCode,
  match,
  isPaused,
  onSendCommand,
}: Props) {
  const funds = match.self.financialDetails.publicMarkets;
  const [drafts, setDrafts] = useState<
    Record<string, { side: "buy" | "sell"; amount: string }>
  >({});
  const [quote, setQuote] = useState<PublicMarketTradePreview | null>(null);
  const [quotedTrades, setQuotedTrades] = useState<
    readonly PublicMarketTradeLeg[]
  >([]);
  const [pending, setPending] = useState<"preview" | "trade" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const canTrade =
    !isPaused &&
    !match.activeTransaction &&
    match.round?.activeSpotlightPlayerId === match.self.playerId;
  const change = (
    id: string,
    update: Partial<{ side: "buy" | "sell"; amount: string }>,
  ) => {
    generation.current++;
    setDrafts((current) => ({
      ...current,
      [id]: { side: "buy", amount: "", ...current[id], ...update },
    }));
    setQuote(null);
    setError(null);
    setPending(null);
  };
  const preview = async () => {
    const requestGeneration = ++generation.current;
    setError(null);
    setQuote(null);
    try {
      const trades = funds.flatMap((fund): PublicMarketTradeLeg[] => {
        const draft = drafts[fund.id];
        if (!draft?.amount.trim()) return [];
        const amount = parseDollars(draft.amount.trim());
        return [
          {
            instrumentId: fund.id,
            buyCents: draft.side === "buy" ? amount : 0,
            sellCents: draft.side === "sell" ? amount : 0,
          },
        ];
      });
      if (trades.length === 0)
        throw new Error("Enter at least one trade amount.");
      setPending("preview");
      const result = await previewPublicMarkets(roomCode, trades);
      if (generation.current !== requestGeneration) return;
      setQuote(result);
      setQuotedTrades(trades);
    } catch (cause) {
      if (generation.current === requestGeneration)
        setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      if (generation.current === requestGeneration) setPending(null);
    }
  };
  const execute = async () => {
    if (!quote || quote.revision !== match.revision || !canTrade || pending)
      return;
    setPending("trade");
    setError(null);
    try {
      const result = await onSendCommand({
        type: "TRADE_PUBLIC_MARKETS",
        trades: quotedTrades,
      });
      if (!result.ok) setError(result.error.message);
      else {
        setQuote(null);
        setDrafts({});
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Trade failed.");
    } finally {
      setPending(null);
    }
  };
  return (
    <section
      className="card"
      data-testid="public-markets-panel"
      style={{ marginBlock: "1rem" }}
      aria-labelledby="public-markets-title"
    >
      <h3 id="public-markets-title">Public markets</h3>
      <p>
        Buy, sell or rebalance in one spotlight action. Each trade costs{" "}
        {(funds[0]?.tradeFeeBps ?? 0) / 100}%. Current-quarter dividends use
        opening holdings.
      </p>
      <div style={{ display: "grid", gap: "1rem" }}>
        {funds.map((fund) => (
          <fieldset
            key={fund.id}
            style={{
              minWidth: 0,
              border: "1px solid var(--border-subtle)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
            }}
          >
            <legend>{fund.name}</legend>
            <p>
              Value {money(fund.valueCents)} · Cost basis{" "}
              {money(fund.basisCents)} · Annual dividend{" "}
              {(fund.annualDividendYieldBps / 100).toFixed(2)}%
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <label>
                Action{" "}
                <select
                  aria-label={`${fund.name} action`}
                  value={drafts[fund.id]?.side ?? "buy"}
                  onChange={(event) =>
                    change(fund.id, {
                      side: event.target.value as "buy" | "sell",
                    })
                  }
                  disabled={pending === "trade"}
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </label>
              <label style={{ minWidth: 0 }}>
                Amount ($){" "}
                <input
                  aria-label={`${fund.name} amount`}
                  inputMode="decimal"
                  value={drafts[fund.id]?.amount ?? ""}
                  onChange={(event) =>
                    change(fund.id, { amount: event.target.value })
                  }
                  disabled={pending === "trade"}
                  style={{ width: "100%", maxWidth: "12rem" }}
                />
              </label>
            </div>
          </fieldset>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="btn-secondary"
        onClick={preview}
        disabled={pending !== null}
      >
        {" "}
        {pending === "preview" ? "Calculating…" : "Preview market trades"}
      </button>
      {quote && (
        <div data-testid="market-trade-preview" aria-live="polite">
          {quote.trades.map((leg) => (
            <p key={leg.instrumentId}>
              {funds.find((fund) => fund.id === leg.instrumentId)?.name}: Fee{" "}
              {money(leg.feeCents)}; resulting value{" "}
              {money(leg.resultingValueCents)}; basis{" "}
              {money(leg.resultingBasisCents)}
              {leg.sellCents > 0 &&
                `; realized gain / loss ${money(leg.realizedGainCents)}`}
            </p>
          ))}
          <p>
            Total fees {money(quote.totalFeesCents)} · Cash change{" "}
            {money(quote.cashImpactCents)} · Resulting cash{" "}
            {money(quote.resultingCashCents)}
          </p>
          {quote.revision !== match.revision && (
            <p>Finances changed. Preview again before trading.</p>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={execute}
            disabled={
              !canTrade || pending !== null || quote.revision !== match.revision
            }
          >
            {pending === "trade"
              ? "Trading…"
              : "Confirm trades and finish spotlight"}
          </button>
        </div>
      )}
      {!canTrade && (
        <p>
          Plan at any time. Confirm during your spotlight when the room is
          active and no transaction is open.
        </p>
      )}
    </section>
  );
}
