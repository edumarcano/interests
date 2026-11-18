import type {
  BusinessLoanInvitationView,
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import { useState } from "react";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function aprBps(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimals] = text.split(".");
  const result = Number(whole) * 100 + Number((decimals ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

export function BusinessLendingPanel({
  invitation,
  match,
  isPaused,
  onSendCommand,
}: {
  readonly invitation: BusinessLoanInvitationView;
  readonly match: MatchPlayerView;
  readonly isPaused: boolean;
  readonly onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const [drafts, setDrafts] = useState<
    Readonly<Record<number, { readonly rate: string; readonly term: number }>>
  >({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const binding = {
    transactionId: invitation.transactionId,
    expectedTermsRevision: invitation.termsRevision,
  };
  const disabled = isPaused || sending;
  const borrower =
    match.players.find(
      (player) => player.playerId === invitation.borrowerPlayerId,
    )?.nickname ?? "A player";
  async function send(command: PlayerCommand) {
    setSending(true);
    setError(null);
    try {
      const result = await onSendCommand(command);
      if (!result.ok) setError(result.error.message);
    } catch {
      setError("The action could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  }
  return (
    <section aria-label="Business lending" className="card business-capital">
      <h3>Business lending</h3>
      <p>
        {borrower} is seeking a loan to buy a business stake. Cash is held when
        you submit an offer. If the deal closes, payments start next quarter.
        This loan has no collateral.
      </p>
      {invitation.slots.map(({ slot, principalCents }) => {
        const own = invitation.ownOffers.find((offer) => offer.slot === slot);
        const draft = drafts[slot] ?? { rate: "", term: 4 };
        const annualRateBps = aprBps(draft.rate);
        const canFund = match.self.availableCashCents >= principalCents;
        return (
          <fieldset disabled={disabled} key={slot}>
            <legend>
              Loan {slot + 1} · {dollars.format(principalCents / 100)}
            </legend>
            {own ? (
              <>
                <p>
                  Your offer: {(own.annualRateBps / 100).toFixed(2)}% APR for{" "}
                  {own.termQuarters} quarters.{" "}
                  {own.selected
                    ? "Selected by the buyer."
                    : "Waiting for the buyer."}
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    void send({
                      type: "WITHDRAW_BUSINESS_LOAN",
                      ...binding,
                      slot,
                      lenderPlayerId: match.self.playerId,
                    })
                  }
                >
                  Withdraw loan {slot + 1}
                </button>
              </>
            ) : (
              <>
                <label>
                  Annual interest (%)
                  <input
                    aria-label={`Loan ${slot + 1} APR (%)`}
                    inputMode="decimal"
                    value={draft.rate}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [slot]: { ...draft, rate: event.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Term in quarters
                  <select
                    aria-label={`Loan ${slot + 1} term (quarters)`}
                    value={draft.term}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [slot]: { ...draft, term: Number(event.target.value) },
                      })
                    }
                  >
                    {[2, 3, 4, 5, 6, 7, 8].map((term) => (
                      <option key={term} value={term}>
                        {term}
                      </option>
                    ))}
                  </select>
                </label>
                {!canFund && (
                  <p>
                    You do not have enough unreserved cash to offer this loan.
                  </p>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canFund || annualRateBps === null}
                  onClick={() =>
                    annualRateBps !== null &&
                    void send({
                      type: "OFFER_BUSINESS_LOAN",
                      ...binding,
                      slot,
                      annualRateBps,
                      termQuarters: draft.term,
                    })
                  }
                >
                  Offer loan {slot + 1}
                </button>
              </>
            )}
          </fieldset>
        );
      })}
      {invitation.selected && (
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || !invitation.readyToConfirm}
          onClick={() =>
            void send({
              type: invitation.confirmed
                ? "WITHDRAW_BUSINESS_CAPITAL"
                : "CONFIRM_BUSINESS_CAPITAL",
              ...binding,
            })
          }
        >
          {invitation.confirmed
            ? "Withdraw financing confirmation"
            : "Confirm selected financing"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
