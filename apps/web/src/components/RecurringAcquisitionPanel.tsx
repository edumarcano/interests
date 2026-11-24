import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  RecurringAcquisitionQuote,
} from "@interests/shared";
import { useEffect, useRef, useState } from "react";
import { previewRecurringAcquisition } from "../api/client";
import { money } from "./CareerPanel";
import { SharedRecurringAcquisitionDraft } from "./SharedRecurringAcquisitionPanel";

export function RecurringAcquisitionPanel({
  roomCode,
  match,
  isPaused,
  onSendCommand,
}: {
  roomCode: string;
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const card = match.self.recurringOpportunity;
  const [quotes, setQuotes] = useState<readonly RecurringAcquisitionQuote[]>(
    [],
  );
  const [selected, setSelected] = useState<RecurringAcquisitionQuote | null>(
    null,
  );
  const [pending, setPending] = useState<"preview" | "close" | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const lastRevision = useRef(match.revision);
  useEffect(() => {
    if (lastRevision.current === match.revision) return;
    lastRevision.current = match.revision;
    generation.current++;
    setQuotes([]);
    setSelected(null);
    setPending(null);
  }, [match.revision]);
  if (
    !card ||
    !["npc-business-purchase", "npc-property-purchase"].includes(card.action) ||
    card.status !== "available"
  )
    return null;
  const canClose =
    !isPaused &&
    !pending &&
    !match.hasActiveTransaction &&
    !match.activeTransaction &&
    !match.businessCapital &&
    !match.businessAuction &&
    match.round?.activeSpotlightPlayerId === match.self.playerId;
  async function preview() {
    const request = ++generation.current;
    setPending("preview");
    setError("");
    setSelected(null);
    try {
      const result = await previewRecurringAcquisition(roomCode, card!.id);
      if (request !== generation.current) return;
      setQuotes(result);
      if (!result.length)
        setError(
          "No current closing quote is available. Finish any open transaction and refresh.",
        );
    } catch (cause) {
      if (request === generation.current)
        setError(
          cause instanceof Error ? cause.message : "Quote failed. Try again.",
        );
    } finally {
      if (request === generation.current) setPending(null);
    }
  }
  async function close() {
    if (!selected || !canClose) return;
    setPending("close");
    setError("");
    try {
      const result = await onSendCommand({
        type: "ACQUIRE_RECURRING_OPPORTUNITY",
        opportunityId: card!.id,
        quoteId: selected.id,
      });
      if (!result.ok) setError(result.error.message);
      else {
        setSelected(null);
        setQuotes([]);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Purchase failed. Refresh quotes before retrying.",
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <section aria-label="Opportunity acquisition">
      <button
        type="button"
        className="btn-secondary"
        data-testid="preview-recurring-acquisition"
        disabled={isPaused || pending !== null}
        onClick={preview}
      >
        {pending === "preview" ? "Quoting…" : "Review purchase options"}
      </button>
      <p>
        Quotes show cash, fees and bank reserves. Investigation is optional.
        Purchase uses your spotlight; new asset income and loan payments start
        next quarter.
      </p>
      {quotes.map((quote) => (
        <div className="card" key={quote.id} style={{ marginBlock: "0.75rem" }}>
          <h4>
            {quote.route === "cash"
              ? "Cash purchase"
              : quote.route === "bank-fixed"
                ? "Fixed bank finance"
                : "Variable bank finance"}
          </h4>
          {quote.propertyMarketKind && (
            <p>Property market: {quote.propertyMarketKind}</p>
          )}
          <p>
            Price {money(quote.askingPriceCents)} · Purchase fee{" "}
            {money(quote.purchaseFeeCents)}
          </p>
          <p>
            Cash invested {money(quote.cashRequiredCents)} · Asset reserve{" "}
            {money(quote.assetReserveCents)} · Personal cash retained at least{" "}
            {money(quote.personalReserveCents)}
          </p>
          {quote.principalCents > 0 && (
            <p>
              Bank principal {money(quote.principalCents)} · APR{" "}
              {(quote.annualRateBps / 100).toFixed(2)}% · {quote.termQuarters}{" "}
              quarters · Payment {money(quote.quarterlyPaymentCents)} per
              quarter. Debt belongs to the asset and is paid before owner
              distributions.{" "}
              {quote.route === "bank-variable" &&
                "Rates and payments can change."}
            </p>
          )}
          {!quote.canClose && (
            <p>
              Current available cash, required reserves or bank underwriting do
              not support this option.
            </p>
          )}
          <button
            type="button"
            className="btn-secondary"
            data-testid={`review-recurring-${quote.route}`}
            disabled={!quote.canClose || !canClose}
            onClick={() => setSelected(quote)}
          >
            Review{" "}
            {quote.route === "cash"
              ? "cash purchase"
              : quote.route === "bank-fixed"
                ? "fixed bank purchase"
                : "variable bank purchase"}
          </button>
        </div>
      ))}
      {quotes.length > 0 && canClose && (
        <SharedRecurringAcquisitionDraft
          match={match}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
          opportunityId={card.id}
          routes={quotes.map((quote) => quote.route)}
        />
      )}
      {selected && (
        <dialog
          open
          aria-label="Confirm opportunity purchase"
          style={{
            position: "fixed",
            inset: "auto 1rem 1rem",
            margin: "auto",
            maxWidth: "32rem",
            width: "calc(100% - 2rem)",
            maxHeight: "80vh",
            overflowY: "auto",
            zIndex: 20,
          }}
        >
          <h3>Confirm {card.name}</h3>
          <p>
            Invest {money(selected.cashRequiredCents)} cash. This includes the{" "}
            {money(selected.purchaseFeeCents)} purchase fee and{" "}
            {money(selected.assetReserveCents)} retained asset reserve. Bank
            borrowing: {money(selected.principalCents)}.
          </p>
          <p>
            {card.investigated
              ? "You paid to reveal the stored operating facts above."
              : "You have not paid for operating investigation. You may cancel and investigate first."}{" "}
            Returns can fall and reserves can be lost. This completes your
            spotlight.
          </p>
          <button
            type="button"
            data-testid="confirm-recurring-acquisition"
            disabled={!canClose}
            onClick={close}
          >
            {pending === "close" ? "Purchasing…" : "Confirm purchase"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending === "close"}
            onClick={() => setSelected(null)}
          >
            Cancel purchase
          </button>
        </dialog>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
