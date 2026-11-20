import type { MarketLoanQuoteView } from "@interests/shared";
import { money } from "./CareerPanel";

export function MarketLoanOffer({
  quote,
  isSpotlight,
  isBlocked,
  isSubmitting,
  onFund,
  onPursueFinale,
}: {
  quote: MarketLoanQuoteView;
  isSpotlight: boolean;
  isBlocked: boolean;
  isSubmitting: boolean;
  onFund: () => void;
  onPursueFinale?: () => void;
}) {
  return (
    <div>
      <dl>
        <dt>Borrower</dt>
        <dd>{quote.borrowerName}</dd>
        <dt>You lend from your cash</dt>
        <dd>{money(quote.principalCents)}</dd>
        <dt>Fixed annual interest rate</dt>
        <dd>{(quote.annualRateBps / 100).toFixed(2)}%</dd>
        <dt>First scheduled payment</dt>
        <dd>
          {money(quote.scheduledQuarterlyPaymentCents)} in quarter{" "}
          {quote.firstDueQuarter}
        </dd>
        <dt>Scheduled term</dt>
        <dd>{quote.termQuarters} quarters</dd>
        <dt>Interest if paid on schedule</dt>
        <dd>{money(quote.onTimeTotalInterestCents)}</dd>
      </dl>
      <p>
        {quote.repaymentRisk === "tight-budget"
          ? "The borrower may fall behind on the scheduled payments."
          : "The borrower's budget covers the scheduled payments."}{" "}
        Funding uses your spotlight and ties up cash until payments arrive.
      </p>
      {quote.unavailableReason === "borrower-funded" && (
        <p>This borrower already has an active market loan.</p>
      )}
      {quote.unavailableReason === "insufficient-cash" && (
        <p>You need more available cash to fund this loan.</p>
      )}
      {quote.unavailableReason === "transaction-active" && (
        <p>Finish the active transaction before funding this loan.</p>
      )}
      {quote.canFund && !isSpotlight && (
        <p>You can fund this loan during your spotlight.</p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={isBlocked || !isSpotlight || !quote.canFund}
        onClick={onFund}
      >
        {isSubmitting ? "Funding…" : `Fund ${money(quote.principalCents)} loan`}
      </button>
      {onPursueFinale && (
        <button
          type="button"
          className="btn-secondary"
          disabled={isBlocked || !isSpotlight || !quote.canFund}
          onClick={onPursueFinale}
        >
          Pursue finale with this loan
        </button>
      )}
    </div>
  );
}
