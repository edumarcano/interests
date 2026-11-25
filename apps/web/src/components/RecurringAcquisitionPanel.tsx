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
  const [review, setReview] = useState<{
    quote: RecurringAcquisitionQuote;
    intent: "ordinary" | "finale";
    objectiveId: string | null;
  } | null>(null);
  const selected = review?.quote;
  const objectiveId = match.self.selectedObjectiveId;
  const evaluation = match.self.financialDetails?.objectiveEvaluation;
  const objectiveName =
    match.self.selectedObjective?.name ?? "selected objective";
  const canPursueFinale = (quote: RecurringAcquisitionQuote) =>
    evaluation?.status === "eligible" &&
    evaluation.objectiveId === objectiveId &&
    (["capital-allocator", "deal-maker", "wealth-architect"].includes(
      objectiveId ?? "",
    ) ||
      (objectiveId === "founder" && quote.kind === "business") ||
      (objectiveId === "property-magnate" && quote.kind === "property"));
  const [pending, setPending] = useState<"preview" | "close" | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const lastRevision = useRef(match.revision);
  useEffect(() => {
    if (lastRevision.current === match.revision) return;
    lastRevision.current = match.revision;
    generation.current++;
    setQuotes([]);
    setReview(null);
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
    setReview(null);
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
  async function close(intent: "ordinary" | "finale") {
    if (!selected || !canClose || review?.intent !== intent) return;
    if (
      intent === "finale" &&
      (!canPursueFinale(selected) || review.objectiveId !== objectiveId)
    )
      return;
    setPending("close");
    setError("");
    try {
      const action = {
        type: "ACQUIRE_RECURRING_OPPORTUNITY" as const,
        opportunityId: card!.id,
        quoteId: selected.id,
      };
      const result = await onSendCommand(
        intent === "finale" ? { type: "PURSUE_FINALE", action } : action,
      );
      if (!result.ok) setError(result.error.message);
      else {
        setReview(null);
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
            onClick={() =>
              setReview({ quote, intent: "ordinary", objectiveId })
            }
          >
            Review{" "}
            {quote.route === "cash"
              ? "cash purchase"
              : quote.route === "bank-fixed"
                ? "fixed bank purchase"
                : "variable bank purchase"}
          </button>
          {canPursueFinale(quote) && (
            <button
              type="button"
              className="btn-secondary"
              data-testid={`review-recurring-finale-${quote.route}`}
              disabled={!quote.canClose || !canClose}
              onClick={() =>
                setReview({ quote, intent: "finale", objectiveId })
              }
            >
              Review purchase as {objectiveName} finale
            </button>
          )}
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
          aria-label={
            review?.intent === "finale"
              ? "Confirm acquisition finale"
              : "Confirm opportunity purchase"
          }
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
          <h3>
            {review?.intent === "finale"
              ? `Pursue ${objectiveName} finale: ${card.name}`
              : `Confirm ${card.name}`}
          </h3>
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
          {review?.intent === "finale" && (
            <p>
              This explicitly requests your selected finale with this purchase.
              The server checks the required consideration, eligibility and
              resulting position before awarding a win.
            </p>
          )}
          <button
            type="button"
            data-testid={
              review?.intent === "finale"
                ? "confirm-recurring-finale"
                : "confirm-recurring-acquisition"
            }
            disabled={
              !canClose ||
              (review?.intent === "finale" &&
                (!canPursueFinale(selected) ||
                  review.objectiveId !== objectiveId))
            }
            onClick={() =>
              close(review?.intent === "finale" ? "finale" : "ordinary")
            }
          >
            {pending === "close"
              ? "Purchasing…"
              : review?.intent === "finale"
                ? "Confirm purchase and pursue finale"
                : "Confirm purchase"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending === "close"}
            onClick={() => setReview(null)}
          >
            {review?.intent === "finale" ? "Cancel finale" : "Cancel purchase"}
          </button>
        </dialog>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
