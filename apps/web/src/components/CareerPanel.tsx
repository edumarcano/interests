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
    !match.hasActiveTransaction &&
    !match.activeTransaction &&
    !match.businessCapital &&
    !match.businessAuction &&
    !pending;
  const evaluation = details.objectiveEvaluation;
  const eligibleFinale =
    match.phase === "ready-for-first-round" &&
    evaluation?.status === "eligible" &&
    evaluation.objectiveId === match.self.selectedObjectiveId;
  const independentFinale =
    eligibleFinale && evaluation?.objectiveId === "independent";
  const executiveOffers =
    eligibleFinale && evaluation?.objectiveId === "executive-owner"
      ? details.careerOffers.filter(
          (offer) =>
            offer.role === "executive" &&
            offer.ownershipPosition !== null &&
            offer.ownershipCostCents > 0,
        )
      : [];
  async function send(command: PlayerCommand) {
    setPending(true);
    setError("");
    try {
      const result = await onSendCommand(command);
      if (!result.ok) {
        const message = result.error.message;
        setError(
          command.type === "PURSUE_FINALE" && message === "FINALE_INELIGIBLE"
            ? "The finale requirements are not met for this attempt. No changes were made."
            : command.type === "PURSUE_FINALE" &&
                message === "FINALE_ACTION_UNAVAILABLE"
              ? "This finale action is unavailable. No changes were made."
              : message,
        );
      }
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
      id="career-and-labor"
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
      {(independentFinale || executiveOffers.length > 0) && (
        <section
          aria-label="Your private career finale"
          style={{ marginTop: "1rem" }}
        >
          <h3>Attempt your finale</h3>
          <p>
            Your requirements are checked again after the action and its costs.
            A failed attempt makes no changes. A successful attempt ends the
            match.
          </p>
          {independentFinale && (
            <button
              className="btn-gold"
              style={{ maxWidth: "100%", whiteSpace: "normal" }}
              type="button"
              disabled={!canAct}
              onClick={() =>
                void send({
                  type: "PURSUE_FINALE",
                  action:
                    details.labor.kind === "not-working"
                      ? { type: "CONFIRM_INDEPENDENCE" }
                      : { type: "RESIGN_LABOR" },
                })
              }
            >
              {details.labor.kind === "not-working"
                ? "Attempt Independent finale: confirm independence"
                : details.labor.kind === "owner-work"
                  ? "Attempt Independent finale with management"
                  : "Attempt Independent finale by resigning"}
            </button>
          )}
          {executiveOffers.map((offer) => (
            <div key={offer.id} style={{ marginTop: "0.75rem" }}>
              <p>
                {offer.name}: total cash required{" "}
                {money(offer.totalCashRequiredCents)}.
              </p>
              <button
                className="btn-gold"
                style={{ maxWidth: "100%", whiteSpace: "normal" }}
                type="button"
                disabled={!canAct || !offer.affordable}
                onClick={() =>
                  void send({
                    type: "PURSUE_FINALE",
                    action: { type: "ACCEPT_CAREER_OFFER", offerId: offer.id },
                  })
                }
              >
                Attempt Executive Owner finale: {offer.name}
              </button>
            </div>
          ))}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
