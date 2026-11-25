import type {
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
const usd = (cents: number) => dollars.format(cents / 100);

export function BusinessAuctionPanel({
  match,
  isPaused,
  onSendCommand,
}: {
  readonly match: MatchPlayerView;
  readonly isPaused: boolean;
  readonly onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const auction = match.businessAuction;
  const [assetId, setAssetId] = useState("");
  const [stake, setStake] = useState("");
  const [minimum, setMinimum] = useState("");
  const [bid, setBid] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companies = match.self.ownedAssets ?? [];
  const isSpotlight =
    match.self.playerId === match.round?.activeSpotlightPlayerId;
  const canList =
    isSpotlight &&
    companies.length > 0 &&
    !match.hasActiveTransaction &&
    !match.businessCapital &&
    !match.activeTransaction;
  if (!auction && !canList) return null;

  const disabled = isPaused || submitting;
  const seller = match.players.find(
    (player) => player.playerId === auction?.sellerPlayerId,
  );
  const isSeller = auction?.sellerPlayerId === match.self.playerId;
  const selected = companies.find((asset) => asset.id === assetId);
  const stakePpm = scaledInput(stake, 10_000, 4);
  const minimumBidCents = scaledInput(minimum, 100, 2);
  const bidCents = scaledInput(bid, 100, 2);
  async function send(command: PlayerCommand) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSendCommand(command);
      if (result.ok) {
        setAssetId("");
        setBid("");
      } else {
        const code = result.error.message;
        setError(
          code === "INSUFFICIENT_AVAILABLE_CASH"
            ? "You need enough cash for the bid and purchase fee."
            : code === "INVALID_CAPITAL_CONSIDERATION"
              ? "That stake cannot be listed. Check the ownership and company obligations."
              : code,
        );
      }
    } catch {
      setError("The action could not be sent. Try again.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section
      aria-label="Public stake auction"
      className="card business-capital"
    >
      <h3>Public stake auction</h3>
      {auction ? (
        <>
          <p>
            {seller?.nickname ?? "A player"} is selling{" "}
            {auction.ownershipPpm / 10_000}% of business {auction.assetId}.
            Minimum bid: {usd(auction.minimumBidCents)}.
          </p>
          <p>
            {auction.responsesReceived} of {auction.responsesRequired} seats
            have responded. The highest bidder pays their bid plus the business
            purchase fee. The first accepted bid wins an exact tie.
          </p>
          {isSeller ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled}
              onClick={() =>
                void send({
                  type: "CANCEL_ACTIVE_TRANSACTION",
                  transactionId: auction.id,
                })
              }
            >
              Cancel auction
            </button>
          ) : auction.ownResponse ? (
            <p>
              {auction.ownResponse.kind === "bid"
                ? `Your sealed bid: ${usd(auction.ownResponse.amountCents)}. Funds are held until the auction ends.`
                : "You passed."}
            </p>
          ) : (
            <fieldset disabled={disabled}>
              <legend>Bid or pass</legend>
              <label>
                Sealed bid ($)
                <input
                  inputMode="decimal"
                  value={bid}
                  onChange={(event) => setBid(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  bidCents === null || bidCents < auction.minimumBidCents
                }
                onClick={() =>
                  bidCents !== null &&
                  void send({
                    type: "RESPOND_BUSINESS_AUCTION",
                    transactionId: auction.id,
                    bidCents,
                  })
                }
              >
                Submit sealed bid
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void send({
                    type: "RESPOND_BUSINESS_AUCTION",
                    transactionId: auction.id,
                    bidCents: null,
                  })
                }
              >
                Pass on auction
              </button>
            </fieldset>
          )}
        </>
      ) : (
        <details>
          <summary>List a business stake at auction</summary>
          <p>
            Choose a stake to sell and the lowest price you will accept. Every
            other seat can bid once or pass. Selling uses your spotlight.
          </p>
          <fieldset disabled={disabled}>
            <legend>Auction terms</legend>
            <label>
              Business
              <select
                aria-label="Auction business"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                <option value="">Choose a business</option>
                {companies.map((asset) => (
                  <option value={asset.id} key={asset.id}>
                    {asset.id} · {asset.ownershipPpm / 10_000}% owned
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stake to auction (%)
              <input
                inputMode="decimal"
                value={stake}
                onChange={(event) => setStake(event.target.value)}
              />
            </label>
            <label>
              Minimum bid ($)
              <input
                inputMode="decimal"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={
                !selected ||
                !stakePpm ||
                stakePpm > selected.ownershipPpm ||
                !minimumBidCents
              }
              onClick={() =>
                stakePpm &&
                minimumBidCents &&
                void send({
                  type: "OPEN_BUSINESS_AUCTION",
                  assetId,
                  ownershipPpm: stakePpm,
                  minimumBidCents,
                })
              }
            >
              Open stake auction
            </button>
          </fieldset>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
