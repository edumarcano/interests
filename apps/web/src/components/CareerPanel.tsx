import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import { useState } from "react";

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function CareerPanel({
  match,
  isPaused,
  onSendCommand,
}: {
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const details = match.self.financialDetails;
  if (!details) return null;
  const canAct =
    !isPaused &&
    match.phase !== "finished" &&
    match.round?.stage === "spotlight" &&
    match.round.activeSpotlightPlayerId === match.self.playerId &&
    !match.activeTransaction &&
    !pending;
  async function send(command: PlayerCommand) {
    setPending(true);
    setError("");
    try {
      const result = await onSendCommand(command);
      if (!result.ok) setError(result.error.message);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Career command failed",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-label="Career and labor"
      style={{ marginBlock: "1rem", overflowWrap: "anywhere" }}
    >
      <h2>Career and labor</h2>
      <p>
        Current role:{" "}
        {details.labor.kind === "employment"
          ? details.labor.role
          : details.labor.kind === "owner-work"
            ? "working owner"
            : "not working"}
        . Labor compensation:{" "}
        {details.annualLaborCompensationCents === null
          ? "unavailable"
          : money(details.annualLaborCompensationCents)}{" "}
        per year. Employment: {money(details.quarterlyIncomeCents)} per quarter.
      </p>
      <p>
        Each acceptance or resignation uses your spotlight for this quarter.
        Changes take effect next quarter. Earned pay for the current quarter
        remains due.
      </p>
      {details.labor.kind === "owner-work" && (
        <p>
          Leaving owner work hires management at the same annual cost.
          Ownership, company profit and unpaid work claims remain.
        </p>
      )}
      {!canAct && (
        <p>
          Inspect offers anytime. Accept during your spotlight when no
          transaction is active.
        </p>
      )}
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {details.careerOffers?.map((offer) => (
          <article
            key={offer.id}
            style={{
              padding: "0.75rem",
              border: "1px solid var(--border-subtle)",
              borderRadius: "0.5rem",
            }}
          >
            <h3>{offer.name}</h3>
            <p>
              {money(offer.annualCompensationCents)} per year
              {offer.raiseBps > 0 && ` (${offer.raiseBps / 100}% raise)`}.
              Transition cost: {money(offer.transitionCostCents)}. Ownership
              investment: {money(offer.ownershipCostCents)}. Business purchase
              fee: {money(offer.ownershipPurchaseFeeCents)}. Total cash
              required: {money(offer.totalCashRequiredCents)}.
            </p>
            <p>{offer.tradeoff}</p>
            {offer.ownershipPosition && (
              <p>
                Managed company: {offer.ownershipPosition.ownershipPpm / 10000}%
                ownership; enterprise value{" "}
                {money(offer.ownershipPosition.enterpriseValueCents)}; company
                cash {money(offer.ownershipPosition.companyCashCents)}; debt{" "}
                {money(offer.ownershipPosition.debtPrincipalCents)}; annual
                revenue {money(offer.ownershipPosition.annualRevenueCents)} and
                after-labor operating profit{" "}
                {money(offer.ownershipPosition.annualOperatingProfitCents)}.
                Ownership income starts next quarter.
              </p>
            )}
            {!offer.affordable && <p>Insufficient cash for this offer.</p>}
            <button
              className="btn-gold"
              type="button"
              disabled={!canAct || !offer.affordable}
              onClick={() =>
                void send({ type: "ACCEPT_CAREER_OFFER", offerId: offer.id })
              }
            >
              Accept {offer.name}
            </button>
          </article>
        ))}
      </div>
      {details.labor.kind !== "not-working" && (
        <button
          className="btn-secondary"
          style={{ marginTop: "0.75rem" }}
          type="button"
          disabled={!canAct}
          onClick={() => void send({ type: "RESIGN_LABOR" })}
        >
          {details.labor.kind === "owner-work"
            ? "Hire management and stop owner work"
            : "Resign from employment"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
