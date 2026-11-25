import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  RecurringAcquisitionRoute,
  SharedRecurringAcquisitionCommand,
  SharedRecurringAcquisitionTerms,
} from "@interests/shared";
import { useState } from "react";
import { money } from "./CareerPanel";
import { scaledInput } from "./capitalInput";

interface Props {
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}

const routeNames: Record<RecurringAcquisitionRoute, string> = {
  cash: "Cash",
  "bank-fixed": "Fixed bank finance",
  "bank-variable": "Variable bank finance",
};

export function SharedRecurringAcquisitionDraft({
  match,
  isPaused,
  onSendCommand,
  opportunityId,
  routes,
}: Props & {
  opportunityId: string;
  routes: readonly RecurringAcquisitionRoute[];
}) {
  const tx = match.sharedRecurringAcquisition;
  const [partner, setPartner] = useState(tx?.terms.partnerPlayerId ?? "");
  const [cash, setCash] = useState(
    tx ? String(tx.terms.leadCashCents / 100) : "",
  );
  const [ownership, setOwnership] = useState(
    tx?.terms.partnerOwnershipPpm
      ? String(tx.terms.partnerOwnershipPpm / 10_000)
      : "",
  );
  const [funding, setFunding] = useState<"equity" | "player-loan">(
    tx?.terms.playerLoan ? "player-loan" : "equity",
  );
  const [rate, setRate] = useState(
    tx?.terms.playerLoan ? String(tx.terms.playerLoan.annualRateBps / 100) : "",
  );
  const [term, setTerm] = useState(tx?.terms.playerLoan?.termQuarters ?? 4);
  const [route, setRoute] = useState(tx?.terms.route ?? routes[0] ?? "cash");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const leadCash = scaledInput(cash, 100, 2);
  const partnerOwnership = scaledInput(ownership, 10_000, 4);
  const annualRateBps = /^0+(?:\.0{1,2})?$/.test(rate.trim())
    ? 0
    : scaledInput(rate, 100, 2);
  const hasValidTerms =
    funding === "equity"
      ? Boolean(partnerOwnership && partnerOwnership < 1_000_000)
      : annualRateBps !== null;
  async function propose() {
    if (!leadCash || !hasValidTerms) return;
    const common = {
      opportunityId,
      leadCashCents: leadCash,
      partnerPlayerId: partner,
    };
    const terms: SharedRecurringAcquisitionTerms =
      funding === "player-loan"
        ? {
            ...common,
            route,
            playerLoan: { annualRateBps: annualRateBps!, termQuarters: term },
          }
        : { ...common, route, partnerOwnershipPpm: partnerOwnership! };
    setPending(true);
    setError("");
    try {
      const result = await onSendCommand(
        tx
          ? {
              type: "REVISE_SHARED_RECURRING_ACQUISITION",
              transactionId: tx.id,
              expectedTermsRevision: tx.termsRevision,
              terms,
            }
          : { type: "OPEN_SHARED_RECURRING_ACQUISITION", terms },
      );
      if (!result.ok) setError(result.error.message);
    } catch {
      setError("The proposal could not be sent. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="property-acquisition">
      <summary>
        {tx ? "Revise shared purchase" : "Propose a shared purchase"}
      </summary>
      <fieldset disabled={isPaused || pending}>
        <label>
          Partner
          <select
            value={partner}
            onChange={(event) => setPartner(event.target.value)}
          >
            <option value="">Select a player</option>
            {match.players
              .filter((player) => player.playerId !== match.self.playerId)
              .map((player) => (
                <option key={player.playerId} value={player.playerId}>
                  {player.nickname}
                </option>
              ))}
          </select>
        </label>
        <label>
          Partner funding
          <select
            value={funding}
            onChange={(event) =>
              setFunding(
                event.target.value === "player-loan" ? "player-loan" : "equity",
              )
            }
          >
            <option value="equity">Shared ownership</option>
            <option value="player-loan">Fixed player loan</option>
          </select>
        </label>
        <label>
          Purchase funding
          <select
            value={route}
            onChange={(event) =>
              setRoute(event.target.value as RecurringAcquisitionRoute)
            }
          >
            {routes.map((item) => (
              <option key={item} value={item}>
                {routeNames[item]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Your cash contribution ($)
          <input
            value={cash}
            inputMode="decimal"
            onChange={(event) => setCash(event.target.value)}
          />
        </label>
        {funding === "equity" ? (
          <label>
            Partner ownership (%)
            <input
              value={ownership}
              inputMode="decimal"
              onChange={(event) => setOwnership(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label>
              Fixed APR (%)
              <input
                value={rate}
                inputMode="decimal"
                onChange={(event) => setRate(event.target.value)}
              />
            </label>
            <label>
              Repayment term (quarters)
              <select
                value={term}
                onChange={(event) => setTerm(Number(event.target.value))}
              >
                {[2, 3, 4, 5, 6, 7, 8].map((quarters) => (
                  <option key={quarters}>{quarters}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <p>
          {funding === "player-loan"
            ? "The lender supplies the remaining purchase cash. You retain ownership and owe the fixed installments."
            : "The partner contributes the rest of the cash required in exchange for ownership."}
          {" Both players review the exact amounts before confirming."}
        </p>
        <button
          type="button"
          className="btn-secondary"
          disabled={!partner || !leadCash || !hasValidTerms}
          onClick={propose}
        >
          {tx ? "Send revised terms" : "Invite partner"}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export function SharedRecurringAcquisitionPanel(props: Props) {
  const { match, isPaused, onSendCommand } = props;
  const tx = match.sharedRecurringAcquisition;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!tx) return null;
  const { partnerPlayerId, partnerOwnershipPpm, leadCashCents, playerLoan } =
    tx.terms;
  const partnerCash = tx.quote.cashRequiredCents - leadCashCents;
  const isLead = tx.leadPlayerId === match.self.playerId;
  const isConfirmed = tx.confirmedPlayerIds.includes(match.self.playerId);
  const ownContribution = isLead ? leadCashCents : partnerCash;
  const partner = match.players.find(
    (player) => player.playerId === partnerPlayerId,
  );
  const lead = match.players.find(
    (player) => player.playerId === tx.leadPlayerId,
  );
  async function respond(
    command: Extract<
      SharedRecurringAcquisitionCommand,
      {
        type:
          | "CLOSE_SHARED_RECURRING_ACQUISITION"
          | "CANCEL_SHARED_RECURRING_ACQUISITION"
          | "CONFIRM_SHARED_RECURRING_ACQUISITION"
          | "WITHDRAW_SHARED_RECURRING_ACQUISITION";
      }
    >["type"],
  ) {
    if (!tx) return;
    setPending(true);
    setError("");
    try {
      const result = await onSendCommand({
        type: command,
        transactionId: tx.id,
        expectedTermsRevision: tx.termsRevision,
      });
      if (!result.ok) setError(result.error.message);
    } catch {
      setError("The purchase response could not be sent. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label="Shared opportunity purchase" className="card">
      <h3>Shared purchase of {tx.name}</h3>
      <p>
        Price {money(tx.quote.askingPriceCents)} · Fee{" "}
        {money(tx.quote.purchaseFeeCents)}
      </p>
      {playerLoan ? (
        <>
          <p>
            {lead?.nickname} contributes {money(leadCashCents)} and retains all
            ownership.
          </p>
          <p>
            {partner?.nickname} lends {money(partnerCash)} at{" "}
            {(playerLoan.annualRateBps / 100).toFixed(2)}% fixed APR. Repayment
            starts next quarter.
          </p>
          <p>Installments {tx.playerLoanPayments?.map(money).join(", ")}.</p>
        </>
      ) : (
        <>
          <p>
            {lead?.nickname} contributes {money(leadCashCents)} for{" "}
            {(100 - partnerOwnershipPpm / 10_000).toFixed(4)}% ownership.
          </p>
          <p>
            {partner?.nickname} contributes {money(partnerCash)} for{" "}
            {(partnerOwnershipPpm / 10_000).toFixed(4)}% ownership.
          </p>
        </>
      )}
      {tx.quote.principalCents > 0 && (
        <p>
          {routeNames[tx.quote.route]} funds {money(tx.quote.principalCents)} at{" "}
          {(tx.quote.annualRateBps / 100).toFixed(2)}% APR. The asset pays{" "}
          {money(tx.quote.quarterlyPaymentCents)} each quarter over{" "}
          {tx.quote.termQuarters} quarters and retains{" "}
          {money(tx.quote.assetReserveCents)}.
        </p>
      )}
      <p>{tx.confirmedPlayerIds.length} of 2 participants confirmed.</p>
      {!isConfirmed && match.self.availableCashCents < ownContribution && (
        <p>You need {money(ownContribution)} in unreserved cash to confirm.</p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={
          isPaused ||
          pending ||
          (!isConfirmed && match.self.availableCashCents < ownContribution)
        }
        onClick={() =>
          respond(
            isConfirmed
              ? "WITHDRAW_SHARED_RECURRING_ACQUISITION"
              : "CONFIRM_SHARED_RECURRING_ACQUISITION",
          )
        }
      >
        {isConfirmed ? "Withdraw confirmation" : "Confirm shared purchase"}
      </button>
      {isLead && (
        <>
          <button
            type="button"
            className="btn-primary"
            disabled={isPaused || pending || tx.confirmedPlayerIds.length !== 2}
            onClick={() => respond("CLOSE_SHARED_RECURRING_ACQUISITION")}
          >
            Close shared purchase
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={isPaused || pending}
            onClick={() => respond("CANCEL_SHARED_RECURRING_ACQUISITION")}
          >
            Cancel shared purchase
          </button>
          <SharedRecurringAcquisitionDraft
            key={tx.termsRevision}
            {...props}
            opportunityId={tx.terms.opportunityId}
            routes={
              tx.quote.kind === "business"
                ? ["cash", "bank-fixed"]
                : ["cash", "bank-fixed", "bank-variable"]
            }
          />
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
