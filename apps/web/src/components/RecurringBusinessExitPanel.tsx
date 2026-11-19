import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  RecurringBusinessExitQuote,
} from "@interests/shared";
import { useEffect, useState } from "react";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
export function RecurringBusinessExitPanel({
  match,
  isPaused,
  onSendCommand,
}: {
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const [review, setReview] = useState<RecurringBusinessExitQuote | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const currentQuoteId = match.self.recurringOpportunity?.businessExitQuote?.id;
  useEffect(() => {
    setReview((current) => (current?.id === currentQuoteId ? current : null));
  }, [currentQuoteId]);
  const card = match.self.recurringOpportunity;
  if (card?.action !== "npc-business-exit" || card.status !== "available")
    return null;
  const quote = card.businessExitQuote;
  const disabled =
    isPaused ||
    pending ||
    Boolean(match.hasActiveTransaction) ||
    match.round?.activeSpotlightPlayerId !== match.self.playerId;
  async function close() {
    if (!review || disabled) return;
    setPending(true);
    setError("");
    try {
      const result = await onSendCommand({
        type: "SELL_RECURRING_BUSINESS",
        opportunityId: card!.id,
        quoteId: review.id,
      });
      if (!result.ok) setError(result.error.message);
      else setReview(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sale failed. Review the current quote.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section data-testid="recurring-business-exit-panel">
      <p>
        The buyer's operating bid is fixed for this card. Closing ends your
        spotlight. The company keeps its original cash; current-quarter earned
        work and ownership income stays with the entitled players. Your future
        owner work ends.
      </p>
      {error && <p role="alert">{error}</p>}
      {!quote ? (
        <p>
          No funded closing quote is currently available for this matched
          company.
        </p>
      ) : (
        <>
          <p>
            Fixed operating bid {money(quote.operatingEnterpriseBidCents)}{" "}
            against the matched operating reference{" "}
            {money(quote.referenceEnterpriseValueCents)}.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={() => {
              setReview(quote);
              setError("");
            }}
          >
            Review matched business sale
          </button>
        </>
      )}
      {review && (
        <section
          aria-label="Review matched business sale"
          className="property-review"
        >
          <p>
            Company {review.assetId}. Gross buyer consideration{" "}
            {money(review.grossConsiderationCents)}, including{" "}
            {money(review.companyCashIncludedCents)} company cash once.
          </p>
          <p>
            Sale fee {money(review.saleFeeCents)}; exact bank payoff{" "}
            {money(review.bankPayoffCents)}, including{" "}
            {money(review.bankInterestPaidCents)} earned interest.
          </p>
          <p>
            Operating claims {money(review.operatingArrearsPaidCents)}; worker
            claims {money(review.workArrearsPaidCents)}. These are paid before
            owner proceeds.
          </p>
          <p>
            Your net sale proceeds: {money(review.sellerNetCents)}. Any separate
            earned worker claim is paid to that worker.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={close}
          >
            {pending ? "Closing sale…" : "Confirm matched business sale"}
          </button>{" "}
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => setReview(null)}
          >
            Cancel business sale review
          </button>
        </section>
      )}
    </section>
  );
}
