import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  PropertyBankQuoteView,
} from "@interests/shared";
import { useState } from "react";

const money = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount / 100);
function Terms({ quote }: { quote: PropertyBankQuoteView }) {
  return (
    <p>
      {quote.principalCents
        ? `${quote.rateKind} ${(quote.annualRateBps / 100).toFixed(2)}% APR, ${quote.termQuarters} quarters; ${money(quote.quarterlyPaymentCents)}/quarter, first payment next quarter.`
        : "Cash purchase."}{" "}
      Cash required {money(quote.cashRequiredCents)} including{" "}
      {money(quote.feeCents)} fees and {money(quote.assetReserveCents)} property
      reserve. Keep {money(quote.personalReserveCents)} in personal cash.{" "}
      {quote.principalCents > 0 && (
        <>
          Credit: {quote.creditGrade}, {quote.creditEnvironment}; maximum LTV{" "}
          {(quote.maximumLtvBps / 100).toFixed(0)}%, minimum DSCR{" "}
          {(quote.minimumDscrBps / 10_000).toFixed(2)}×.
        </>
      )}
    </p>
  );
}
export function PropertyPanel({
  match,
  isPaused,
  onSendCommand,
}: {
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    label: string;
    command: PlayerCommand;
    quote?: PropertyBankQuoteView;
  } | null>(null);
  const disabled =
    isPaused ||
    pending ||
    match.activeTransaction !== null ||
    !!match.businessCapital ||
    !!match.businessAuction ||
    match.round?.activeSpotlightPlayerId !== match.self.playerId;
  async function confirm() {
    if (!review || disabled) return;
    setPending(true);
    setError(null);
    try {
      const result = await onSendCommand(review.command);
      if (!result.ok) setError(result.error.message);
      else setReview(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Property action failed",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="property-panel" data-testid="property-panel">
      <h3>Property and bank financing</h3>
      <p>
        Each completed action uses your spotlight. Properties pay operating
        costs and asset debt before owner distributions. The bank has no
        personal guarantee.
      </p>
      {error && <p role="alert">{error}</p>}
      {review && (
        <section
          className="property-review"
          aria-label="Review property action"
        >
          <h4>{review.label}</h4>
          {review.quote && <Terms quote={review.quote} />}
          <p>This action ends your spotlight.</p>
          <button
            className="btn-secondary"
            type="button"
            disabled={disabled}
            onClick={confirm}
          >
            {pending ? "Closing…" : "Confirm property action"}
          </button>{" "}
          <button
            className="btn-secondary"
            type="button"
            disabled={pending}
            onClick={() => setReview(null)}
          >
            Cancel review
          </button>
        </section>
      )}
      <div className="property-grid">
        {match.self.propertyManagement?.map((position) => {
          const property = match.self.financialDetails.properties.find(
            (item) => item.id === position.assetId,
          );
          return (
            <article key={position.assetId} className="property-card">
              <h4>Owned property {position.assetId}</h4>
              <p>
                Ownership {((property?.ownershipPpm ?? 0) / 10_000).toFixed(1)}
                %; value {money(property?.marketValueCents ?? 0)}; occupancy{" "}
                {((property?.occupancyBps ?? 0) / 100).toFixed(1)}%; quarterly
                NOI {money(property?.quarterlyNoiCents ?? 0)}.
              </p>
              <p>
                Property cash {money(position.cashCents)}; reserve target{" "}
                {money(position.reserveTargetCents)}. Current bank payoff{" "}
                {money(position.payoffCents)}.
              </p>
              <p>
                Sale fee {money(position.saleFeeCents)}; net proceeds after bank
                payoff {money(position.netSaleProceedsCents)}. Earned quarter
                income stays with its entitled owners.
              </p>
              <div className="property-buttons">
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={disabled || !position.canSell}
                  onClick={() =>
                    setReview({
                      label: `Sell property for net ${money(position.netSaleProceedsCents)}`,
                      command: {
                        type: "SELL_PROPERTY",
                        assetId: position.assetId,
                      },
                    })
                  }
                >
                  Review sale
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={disabled || !position.canRenovate}
                  onClick={() =>
                    setReview({
                      label: `Renovate for ${money(position.renovationCostCents)}; rent +5%, occupancy up to +5 points, value +80% of cost. Improvements take effect next quarter.`,
                      command: {
                        type: "RENOVATE_PROPERTY",
                        assetId: position.assetId,
                      },
                    })
                  }
                >
                  {position.renovated
                    ? "Already renovated"
                    : "Review renovation"}
                </button>
                {position.reserveTargetCents > position.cashCents && (
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={
                      disabled ||
                      match.self.availableCashCents <
                        position.reserveTargetCents - position.cashCents
                    }
                    onClick={() =>
                      setReview({
                        label: `Fund property reserve with ${money(position.reserveTargetCents - position.cashCents)}`,
                        command: {
                          type: "FUND_PROPERTY_RESERVE",
                          assetId: position.assetId,
                          amountCents:
                            position.reserveTargetCents - position.cashCents,
                        },
                      })
                    }
                  >
                    Review reserve funding
                  </button>
                )}
              </div>
              <details>
                <summary>View refinancing options</summary>
                {position.refinancingQuotes.map((quote) => (
                  <div key={quote.rateKind}>
                    <h5>{quote.rateKind} refinance</h5>
                    <Terms quote={quote} />
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={disabled || !quote.canClose}
                      onClick={() =>
                        setReview({
                          label:
                            "Refinance without cash-out; close existing bank liens",
                          quote,
                          command: {
                            type: "REFINANCE_PROPERTY",
                            assetId: position.assetId,
                            rateKind: quote.rateKind,
                          },
                        })
                      }
                    >
                      Review {quote.rateKind} refinance
                    </button>
                  </div>
                ))}
              </details>
              {!position.canSell && (
                <p>
                  Whole-property sale and refinance require all owners’ consent
                  and funded bank payoff.
                </p>
              )}
            </article>
          );
        })}
        {match.self.propertyOffers?.map((offer) => (
          <article className="property-card" key={offer.catalogueId}>
            <h4>{offer.name}</h4>
            <p>
              NPC asking price {money(offer.askingPriceCents)}; scheduled rent{" "}
              {money(offer.scheduledQuarterlyRentCents)}/quarter; occupancy{" "}
              {(offer.occupancyBps / 100).toFixed(1)}%; operating expense ratio{" "}
              {(offer.operatingExpenseRatioBps / 100).toFixed(1)}%.
            </p>
            <details>
              <summary>View cash and mortgage terms</summary>
              {offer.quotes.map((quote) => (
                <div key={`${quote.rateKind}-${quote.principalCents}`}>
                  <h5>
                    {quote.principalCents
                      ? `${quote.rateKind} mortgage`
                      : "Cash"}
                  </h5>
                  <Terms quote={quote} />
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={disabled || !quote.canClose}
                    onClick={() =>
                      setReview({
                        label: `Buy ${offer.name}`,
                        quote,
                        command: {
                          type: "BUY_PROPERTY",
                          catalogueId: offer.catalogueId,
                          principalCents: quote.principalCents,
                          rateKind: quote.rateKind,
                        },
                      })
                    }
                  >
                    Review {quote.principalCents ? quote.rateKind : "cash"}{" "}
                    purchase
                  </button>
                  {!quote.canClose && (
                    <p>
                      Requires underwriting approval and sufficient cash after
                      reserves.
                    </p>
                  )}
                </div>
              ))}
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
