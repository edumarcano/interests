import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  PropertyAcquisitionCommand,
  PropertyAcquisitionTerms,
} from "@interests/shared";
import { useState } from "react";

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );

export function PropertyAcquisitionPanel({
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
  const [editing, setEditing] = useState(false),
    [catalogue, setCatalogue] = useState(""),
    [quoteIndex, setQuoteIndex] = useState(0);
  const [drafts, setDrafts] = useState<
    Record<string, { included: boolean; cash: string; stake: string }>
  >({});
  const tx = match.propertyAcquisition,
    self = match.self.playerId;
  const active = match.round?.activeSpotlightPlayerId === self;
  const busy =
    match.hasActiveTransaction ??
    Boolean(
      match.activeTransaction ||
        match.businessCapital ||
        match.jointProperty ||
        match.businessAuction ||
        tx,
    );
  const disabled = isPaused || pending;
  const offers = match.self.propertyOffers ?? [],
    offer = offers.find((item) => item.catalogueId === catalogue) ?? offers[0];
  const quote = offer?.quotes[quoteIndex];
  const name = (id: string) =>
    match.players.find((player) => player.playerId === id)?.nickname ?? "Buyer";
  if (!tx && (!active || busy || !offers.length)) return null;
  function beginEdit() {
    setEditing(true);
    setCatalogue(tx?.terms.catalogueId ?? offers[0]?.catalogueId ?? "");
    setQuoteIndex(0);
    setDrafts(
      Object.fromEntries(
        match.players.map((player) => {
          const buyer = tx?.terms.buyers.find(
            (item) => item.playerId === player.playerId,
          );
          return [
            player.playerId,
            {
              included: Boolean(buyer) || player.playerId === self,
              cash: buyer ? String(buyer.cashContributionCents / 100) : "",
              stake: buyer ? String(buyer.ownershipPpm / 10_000) : "",
            },
          ];
        }),
      ),
    );
  }
  async function send(command: PropertyAcquisitionCommand) {
    setPending(true);
    setError(null);
    try {
      const result = await onSendCommand(command);
      if (!result.ok) setError(result.error.message);
      else setEditing(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Purchase agreement failed",
      );
    } finally {
      setPending(false);
    }
  }
  const bound = (
    type:
      | "CONFIRM_PROPERTY_ACQUISITION"
      | "WITHDRAW_PROPERTY_ACQUISITION"
      | "CLOSE_PROPERTY_ACQUISITION"
      | "CANCEL_PROPERTY_ACQUISITION",
  ): PropertyAcquisitionCommand => ({
    type,
    transactionId: tx!.id,
    expectedTermsRevision: tx!.termsRevision,
  });
  function propose() {
    if (!offer || !quote) return;
    const terms: PropertyAcquisitionTerms = {
      catalogueId: offer.catalogueId,
      principalCents: quote.principalCents,
      rateKind: quote.rateKind,
      buyers: match.players.flatMap((player) => {
        const draft = drafts[player.playerId];
        return draft?.included
          ? [
              {
                playerId: player.playerId,
                cashContributionCents: Math.round(Number(draft.cash) * 100),
                ownershipPpm: Math.round(Number(draft.stake) * 10_000),
              },
            ]
          : [];
      }),
    };
    void send(
      tx
        ? {
            type: "REVISE_PROPERTY_ACQUISITION",
            transactionId: tx.id,
            expectedTermsRevision: tx.termsRevision,
            terms,
          }
        : { type: "OPEN_PROPERTY_ACQUISITION", terms },
    );
  }
  function update(
    id: string,
    patch: Partial<{ included: boolean; cash: string; stake: string }>,
  ) {
    setDrafts((prior) => ({
      ...prior,
      [id]: { included: false, cash: "", stake: "", ...prior[id], ...patch },
    }));
  }
  return (
    <section
      className="property-review property-acquisition"
      data-testid="property-acquisition-panel"
    >
      <h3>Buy property together</h3>
      {error && <p role="alert">{error}</p>}
      {!tx && !editing && (
        <button
          className="btn-secondary"
          type="button"
          disabled={disabled}
          onClick={beginEdit}
        >
          Draft shared purchase
        </button>
      )}
      {tx && (
        <>
          <p>
            Catalogue property {tx.terms.catalogueId}. Lead buyer{" "}
            {name(tx.leadPlayerId)}. Terms revision {tx.termsRevision}.
          </p>
          <p>
            Price {usd(tx.quote.askingPriceCents)}; fee {usd(tx.quote.feeCents)}
            ; property reserve {usd(tx.quote.assetReserveCents)}. Total buyer
            cash {usd(tx.quote.cashRequiredCents)}.
          </p>
          <p>
            {tx.quote.principalCents ? (
              <>
                Asset mortgage {usd(tx.quote.principalCents)},{" "}
                {tx.quote.rateKind} {tx.quote.annualRateBps / 100}% APR for{" "}
                {tx.quote.termQuarters} quarters;{" "}
                {usd(tx.quote.quarterlyPaymentCents)}/quarter from Q
                {tx.quote.firstDueQuarter}.
              </>
            ) : (
              "Cash purchase."
            )}{" "}
            No personal guarantee or automatic partner cash calls. Each buyer
            explicitly funds only the listed contribution.
          </p>
          <ul>
            {tx.terms.buyers.map((buyer) => (
              <li key={buyer.playerId}>
                {name(buyer.playerId)} pays {usd(buyer.cashContributionCents)},
                receives {buyer.ownershipPpm / 10_000}% ownership:{" "}
                {tx.confirmedPlayerIds.includes(buyer.playerId)
                  ? "confirmed"
                  : "awaiting confirmation"}
                .
              </li>
            ))}
          </ul>
          <p>
            The lead keeps their own personal reserve. Acquired property income
            begins next quarter. Closing or cancelling ends the lead's
            spotlight.
          </p>
          <div className="property-buttons">
            <button
              className="btn-secondary"
              type="button"
              disabled={disabled}
              onClick={() =>
                send(
                  bound(
                    tx.confirmedPlayerIds.includes(self)
                      ? "WITHDRAW_PROPERTY_ACQUISITION"
                      : "CONFIRM_PROPERTY_ACQUISITION",
                  ),
                )
              }
            >
              {tx.confirmedPlayerIds.includes(self)
                ? "Withdraw purchase confirmation"
                : "Confirm exact purchase terms"}
            </button>
            {tx.leadPlayerId === self && (
              <>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={
                    disabled ||
                    !tx.terms.buyers.every((buyer) =>
                      tx.confirmedPlayerIds.includes(buyer.playerId),
                    )
                  }
                  onClick={() => send(bound("CLOSE_PROPERTY_ACQUISITION"))}
                >
                  Close shared property purchase
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={disabled}
                  onClick={beginEdit}
                >
                  Revise purchase terms
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={disabled}
                  onClick={() => send(bound("CANCEL_PROPERTY_ACQUISITION"))}
                >
                  Cancel shared purchase
                </button>
              </>
            )}
          </div>
        </>
      )}
      {editing && (!tx || tx.leadPlayerId === self) && (
        <fieldset disabled={disabled}>
          <legend>Negotiate buyer cash and ownership</legend>
          <label>
            Shared purchase property{" "}
            <select
              value={offer?.catalogueId ?? ""}
              onChange={(event) => {
                setCatalogue(event.target.value);
                setQuoteIndex(0);
              }}
            >
              {offers.map((item) => (
                <option key={item.catalogueId} value={item.catalogueId}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shared purchase financing{" "}
            <select
              value={quoteIndex}
              onChange={(event) => setQuoteIndex(Number(event.target.value))}
            >
              {offer?.quotes.map((item, index) => (
                <option
                  key={`${item.rateKind}-${item.principalCents}`}
                  value={index}
                >
                  {item.principalCents
                    ? `${item.rateKind} mortgage ${usd(item.principalCents)}`
                    : "Cash"}
                </option>
              ))}
            </select>
          </label>
          {quote && (
            <p>
              Engine quote: total buyer cash {usd(quote.cashRequiredCents)}, fee{" "}
              {usd(quote.feeCents)}, asset reserve{" "}
              {usd(quote.assetReserveCents)}. Lead retains{" "}
              {usd(quote.personalReserveCents)} personal cash.{" "}
              {quote.principalCents > 0 &&
                `${quote.annualRateBps / 100}% APR, ${usd(quote.quarterlyPaymentCents)}/quarter.`}{" "}
              Partner funds cannot replace that personal reserve.
            </p>
          )}
          {match.players.map((player) => (
            <div key={player.playerId}>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Include ${player.nickname}`}
                  checked={drafts[player.playerId]?.included ?? false}
                  disabled={player.playerId === self}
                  onChange={(event) =>
                    update(player.playerId, { included: event.target.checked })
                  }
                />{" "}
                {player.nickname}
              </label>
              {drafts[player.playerId]?.included && (
                <>
                  <label>
                    {player.nickname} cash contribution ($){" "}
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={drafts[player.playerId]?.cash ?? ""}
                      onChange={(event) =>
                        update(player.playerId, { cash: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {player.nickname} ownership (%){" "}
                    <input
                      type="number"
                      min="0.0001"
                      max="100"
                      step="0.0001"
                      value={drafts[player.playerId]?.stake ?? ""}
                      onChange={(event) =>
                        update(player.playerId, { stake: event.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          ))}
          <p>
            Include at least two funded buyers. Cash must equal the engine quote
            and ownership must sum to exactly 100%. Revised terms clear every
            confirmation.
          </p>
          <button className="btn-secondary" type="button" onClick={propose}>
            {tx
              ? "Submit revised purchase terms"
              : "Propose shared property purchase"}
          </button>{" "}
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setEditing(false)}
          >
            Cancel purchase draft
          </button>
        </fieldset>
      )}
    </section>
  );
}
