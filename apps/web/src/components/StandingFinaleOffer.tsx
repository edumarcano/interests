import type {
  CommandAckResult,
  MatchPlayerView,
  PursueFinaleCommandPayload,
} from "@interests/shared";
import { useState } from "react";
import { money } from "./CareerPanel";
import { MarketLoanOffer } from "./MarketLoanOffer";

const purchaseRoute = {
  cash: "cash purchase",
  "bank-fixed": "fixed-rate mortgage",
  "bank-variable": "variable-rate mortgage",
};

export function StandingFinaleOffer({
  match,
  isPaused,
  onSendCommand,
}: {
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (
    command: PursueFinaleCommandPayload,
  ) => Promise<CommandAckResult>;
}) {
  const offer = match.self.financialDetails.standingFinaleOffer;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!offer) return null;
  const isSpotlight =
    match.round?.activeSpotlightPlayerId === match.self.playerId;
  const blocked =
    pending ||
    isPaused ||
    Boolean(match.hasActiveTransaction || match.activeTransaction);
  async function attempt(action: PursueFinaleCommandPayload["action"]) {
    if (!isSpotlight || blocked) return;
    setPending(true);
    setError("");
    try {
      const response = await onSendCommand({ type: "PURSUE_FINALE", action });
      if (!response.ok)
        setError(
          "The finale could not close. Check the current terms, your cash and your objective requirements.",
        );
    } catch {
      setError("The action could not be sent. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="card"
      aria-label="Your private standing finale offer"
      style={{ overflowWrap: "anywhere" }}
    >
      <h2>
        {offer.kind === "landmark"
          ? `Landmark finale · ${offer.name}`
          : "Market lending finale"}
      </h2>
      <p>
        A successful close wins the match. Your cash and objective requirements
        are checked again at closing.
      </p>
      {offer.kind === "financing" ? (
        <MarketLoanOffer
          quote={offer.quote}
          isSpotlight={isSpotlight}
          isBlocked={blocked}
          isSubmitting={pending}
          onPursueFinale={() => {
            void attempt({
              type: "FUND_RECURRING_LOAN",
              opportunityId: offer.opportunityId,
            });
          }}
        />
      ) : (
        <>
          {offer.quotes.length === 0 && (
            <p>Purchase terms are unavailable while another deal is active.</p>
          )}
          {offer.quotes.map((quote) => (
            <details key={quote.route}>
              <summary>
                {purchaseRoute[quote.route]} · {money(quote.cashRequiredCents)}{" "}
                at closing
              </summary>
              <dl>
                <dt>Purchase price</dt>
                <dd>{money(quote.askingPriceCents)}</dd>
                <dt>Purchase fee</dt>
                <dd>{money(quote.purchaseFeeCents)}</dd>
                {quote.principalCents > 0 && (
                  <>
                    <dt>Mortgage principal</dt>
                    <dd>{money(quote.principalCents)}</dd>
                    <dt>Opening annual rate</dt>
                    <dd>{(quote.annualRateBps / 100).toFixed(2)}%</dd>
                    <dt>Scheduled quarterly payment</dt>
                    <dd>{money(quote.quarterlyPaymentCents)}</dd>
                    <dt>Property reserve included at closing</dt>
                    <dd>{money(quote.assetReserveCents)}</dd>
                  </>
                )}
                <dt>Personal reserve after closing</dt>
                <dd>{money(quote.personalReserveCents)}</dd>
              </dl>
              {!quote.canClose && (
                <p>Your available cash or required reserves fall short.</p>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={!isSpotlight || blocked || !quote.canClose}
                onClick={() => {
                  void attempt({
                    type: "ACQUIRE_RECURRING_OPPORTUNITY",
                    opportunityId: offer.opportunityId,
                    quoteId: quote.id,
                  });
                }}
              >
                Pursue landmark finale with {purchaseRoute[quote.route]}
              </button>
            </details>
          ))}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
