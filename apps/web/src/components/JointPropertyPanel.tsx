import type {
  CommandAckResult,
  JointPropertyCommand,
  JointPropertyTerms,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import { useState } from "react";

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );
const choices: readonly { label: string; terms: JointPropertyTerms }[] = [
  { label: "sale", terms: { kind: "sale" } },
  { label: "renovation", terms: { kind: "renovation" } },
  { label: "fixed refinance", terms: { kind: "refinance", rateKind: "fixed" } },
  {
    label: "variable refinance",
    terms: { kind: "refinance", rateKind: "variable" },
  },
];
export function JointPropertyPanel({
  match,
  isPaused,
  onSendCommand,
}: {
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const tx = match.jointProperty,
    self = match.self.playerId;
  const active = match.round?.activeSpotlightPlayerId === self;
  const blocked = isPaused || pending;
  const busy =
    match.hasActiveTransaction ??
    Boolean(match.activeTransaction || match.businessCapital || tx);
  const shared =
    match.self.financialDetails?.properties.filter(
      (property) =>
        property.ownershipPpm > 0 && property.ownershipPpm < 1_000_000,
    ) ?? [];
  if (!tx && (!active || busy || !shared.length)) return null;
  const name = (id: string) =>
    match.players.find((player) => player.playerId === id)?.nickname ?? "Owner";
  async function send(command: JointPropertyCommand) {
    setPending(true);
    setError(null);
    try {
      const result = await onSendCommand(command);
      if (!result.ok) setError(result.error.message);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Property agreement could not be sent",
      );
    } finally {
      setPending(false);
    }
  }
  const bound = (
    type:
      | "CONFIRM_JOINT_PROPERTY"
      | "WITHDRAW_JOINT_PROPERTY"
      | "CLOSE_JOINT_PROPERTY"
      | "CANCEL_JOINT_PROPERTY",
  ): JointPropertyCommand => ({
    type,
    transactionId: tx!.id,
    expectedTermsRevision: tx!.termsRevision,
  });
  return (
    <section className="property-review" data-testid="joint-property-panel">
      <h3>Shared property agreement</h3>
      {error && <p role="alert">{error}</p>}
      {!tx ? (
        <>
          {shared.map((property) => (
            <div key={property.id}>
              <h4>Property {property.id}</h4>
              <p>
                Every current owner must confirm the same quote. You are the
                explicit cash payer for any renovation or refinance; partners
                receive no automatic cash call.
              </p>
              <div className="property-buttons">
                {choices.map((choice) => (
                  <button
                    className="btn-secondary"
                    key={choice.label}
                    type="button"
                    disabled={blocked}
                    onClick={() =>
                      send({
                        type: "OPEN_JOINT_PROPERTY",
                        assetId: property.id,
                        terms: choice.terms,
                      })
                    }
                  >
                    Propose joint {choice.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <p>
            Property {tx.assetId}. Terms revision {tx.termsRevision}. Opening a
            proposal spends no money; closing or cancelling ends the initiator’s
            spotlight.
          </p>
          {tx.quote.kind === "sale" ? (
            <>
              <p>
                Sale price {usd(tx.quote.salePriceCents)}; fee{" "}
                {usd(tx.quote.feeCents)}; bank payoff{" "}
                {usd(tx.quote.payoffCents)}; net proceeds{" "}
                {usd(tx.quote.netProceedsCents)}.
              </p>
              <ul>
                {tx.participantIds.map((id) => (
                  <li key={id}>
                    {name(id)} receives{" "}
                    {usd(
                      tx.quote.kind === "sale"
                        ? (tx.quote.proceedsByPlayer[id] ?? 0)
                        : 0,
                    )}
                    .
                  </li>
                ))}
              </ul>
              <p>Earned quarter income stays with the entitled owners.</p>
            </>
          ) : tx.quote.kind === "renovation" ? (
            <p>
              {name(tx.quote.payerPlayerId)} alone pays{" "}
              {usd(tx.quote.cashRequiredCents)}. Effective Q
              {tx.quote.effectiveQuarter}: rent +
              {tx.quote.rentIncreaseBps / 100}%, occupancy +
              {tx.quote.occupancyIncreaseBps / 100} percentage points, value +
              {usd(tx.quote.valueIncreaseCents)}.
            </p>
          ) : (
            <p>
              {name(tx.quote.payerPlayerId)} alone pays{" "}
              {usd(tx.quote.cashRequiredCents)}, including{" "}
              {usd(tx.quote.feeCents)} fees. Replacement principal{" "}
              {usd(tx.quote.principalCents)} at {tx.quote.annualRateBps / 100}%{" "}
              {tx.quote.rateKind}, {tx.quote.termQuarters} quarters;{" "}
              {usd(tx.quote.quarterlyPaymentCents)}/quarter from Q
              {tx.quote.firstDueQuarter}. Property reserve{" "}
              {usd(tx.quote.assetReserveCents)}. No cash out or personal
              guarantee.
            </p>
          )}
          <p>Your cash commitment: {usd(tx.yourCashRequiredCents)}.</p>
          <ul>
            {tx.participantIds.map((id) => (
              <li key={id}>
                {name(id)} ({(tx.ownershipByPlayerPpm[id] ?? 0) / 10_000}%):{" "}
                {tx.confirmedPlayerIds.includes(id)
                  ? "confirmed"
                  : "awaiting confirmation"}
              </li>
            ))}
          </ul>
          <div className="property-buttons">
            <button
              className="btn-secondary"
              type="button"
              disabled={blocked}
              onClick={() =>
                send(
                  bound(
                    tx.confirmedPlayerIds.includes(self)
                      ? "WITHDRAW_JOINT_PROPERTY"
                      : "CONFIRM_JOINT_PROPERTY",
                  ),
                )
              }
            >
              {tx.confirmedPlayerIds.includes(self)
                ? "Withdraw property confirmation"
                : "Confirm exact property terms"}
            </button>
            {tx.initiatorPlayerId === self && (
              <>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={
                    blocked ||
                    !tx.participantIds.every((id) =>
                      tx.confirmedPlayerIds.includes(id),
                    )
                  }
                  onClick={() => send(bound("CLOSE_JOINT_PROPERTY"))}
                >
                  Close shared property agreement
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={blocked}
                  onClick={() => send(bound("CANCEL_JOINT_PROPERTY"))}
                >
                  Cancel shared property agreement
                </button>
              </>
            )}
          </div>
          {tx.initiatorPlayerId === self && (
            <details>
              <summary>Revise proposal and clear confirmations</summary>
              <div className="property-buttons">
                {choices.map((choice) => (
                  <button
                    className="btn-secondary"
                    key={choice.label}
                    type="button"
                    disabled={blocked}
                    onClick={() =>
                      send({
                        type: "REVISE_JOINT_PROPERTY",
                        transactionId: tx.id,
                        expectedTermsRevision: tx.termsRevision,
                        terms: choice.terms,
                      })
                    }
                  >
                    Change to {choice.label}
                  </button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
