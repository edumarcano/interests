import type {
  BusinessEquityInvitationView,
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import { useState } from "react";
import { scaledInput } from "./capitalInput";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function BusinessEquityPanel({
  invitation,
  match,
  isPaused,
  onSendCommand,
}: {
  readonly invitation: BusinessEquityInvitationView;
  readonly match: MatchPlayerView;
  readonly isPaused: boolean;
  readonly onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const [stakes, setStakes] = useState<Readonly<Record<number, string>>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const binding = {
    transactionId: invitation.transactionId,
    expectedTermsRevision: invitation.termsRevision,
  };
  const issuer = match.players.find(
    (player) => player.playerId === invitation.issuerPlayerId,
  )?.nickname;
  const selected = invitation.ownOffers.some((offer) => offer.selected);
  async function send(command: PlayerCommand) {
    setSending(true);
    setError(null);
    try {
      const outcome = await onSendCommand(command);
      if (!outcome.ok) setError(outcome.error.message);
    } catch {
      setError("The action could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  }
  return (
    <section
      aria-label="Company investment invitations"
      className="card business-capital"
    >
      <h3>Company investment invitations</h3>
      <p>
        {issuer ?? "A player"} is raising company cash. Offer the percentage you
        want after issuance. Cash is held while your offer stands. This buys
        ownership; it is not a loan.
      </p>
      {invitation.slots.map(({ slot, amountCents }) => {
        const offer = invitation.ownOffers.find((row) => row.slot === slot);
        const stake = stakes[slot] ?? "";
        const ppm = scaledInput(stake, 10_000, 4);
        const canFund = match.self.availableCashCents >= amountCents;
        return (
          <fieldset key={slot} disabled={isPaused || sending}>
            <legend>
              Investment {slot + 1} · {dollars.format(amountCents / 100)}
            </legend>
            {offer ? (
              <>
                <p>
                  Your offer: {offer.postMoneyOwnershipPpm / 10_000}% after
                  issuance.{" "}
                  {offer.selected
                    ? "Selected for confirmation."
                    : "Waiting for selection."}
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    void send({
                      type: "WITHDRAW_BUSINESS_EQUITY",
                      ...binding,
                      slot,
                      investorPlayerId: match.self.playerId,
                    })
                  }
                >
                  Withdraw investment {slot + 1}
                </button>
              </>
            ) : (
              <>
                <label>
                  Requested stake (%)
                  <input
                    aria-label={`Investment ${slot + 1} stake (%)`}
                    inputMode="decimal"
                    value={stake}
                    onChange={(event) =>
                      setStakes({ ...stakes, [slot]: event.target.value })
                    }
                  />
                </label>
                {!canFund && (
                  <p>
                    You do not have enough unreserved cash for this investment.
                  </p>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!ppm || ppm >= 1_000_000 || !canFund}
                  onClick={() =>
                    ppm &&
                    void send({
                      type: "OFFER_BUSINESS_EQUITY",
                      ...binding,
                      slot,
                      postMoneyOwnershipPpm: ppm,
                    })
                  }
                >
                  Offer investment {slot + 1}
                </button>
              </>
            )}
          </fieldset>
        );
      })}
      {selected && !invitation.mustConfirmThroughOwnerView && (
        <button
          type="button"
          className="btn-secondary"
          disabled={isPaused || sending || !invitation.readyToConfirm}
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
            ? "Withdraw investment confirmation"
            : "Confirm selected investment"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
