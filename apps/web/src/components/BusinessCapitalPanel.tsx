import type {
  BusinessCapitalTerms,
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import { useRef, useState } from "react";
import { scaledInput } from "./capitalInput";
import { type FundingDraft, FundingSlotEditor } from "./FundingSlotEditor";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const usd = (cents: number) => money.format(cents / 100);
const percent = (units: number) => `${units / 10_000}%`;

interface Props {
  readonly match: MatchPlayerView;
  readonly isPaused: boolean;
  readonly onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}

type Mode = BusinessCapitalTerms["kind"];
type DraftRow = { readonly amount: string; readonly stake: string };
export function BusinessCapitalPanel({
  match,
  isPaused,
  onSendCommand,
}: Props) {
  const companies = (match.self.ownedAssets ?? []).filter(
    (asset) => asset.kind === "business",
  );
  const ownId = match.self.playerId;
  const tx = match.businessCapital;
  const isMySpotlight = match.round?.activeSpotlightPlayerId === ownId;
  const [draft, setDraft] = useState<{
    readonly assetId: string;
    readonly mode: Mode;
  } | null>(null);
  const [amount, setAmount] = useState("");
  const [stake, setStake] = useState("");
  const [buyer, setBuyer] = useState("");
  const [rows, setRows] = useState<Record<string, DraftRow>>({});
  const [fundingDrafts, setFundingDrafts] = useState<readonly FundingDraft[]>(
    [],
  );
  const nextFundingDraftId = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || isPaused;
  const name = (id: string) =>
    match.players.find((player) => player.playerId === id)?.nickname ??
    "Player";
  const confirmed = tx?.confirmedPlayerIds.includes(ownId) ?? false;
  const canClose =
    tx?.participantIds.every((id) => tx.confirmedPlayerIds.includes(id)) ??
    false;
  if (
    !tx &&
    (!isMySpotlight ||
      !companies.length ||
      match.hasActiveTransaction ||
      match.activeTransaction ||
      match.businessAuction)
  )
    return null;

  async function send(command: PlayerCommand) {
    setPending(true);
    setError(null);
    try {
      const result = await onSendCommand(command);
      if (!result.ok) setError(result.error.message);
      else setDraft(null);
    } catch {
      setError("The action could not be sent. Try again.");
    } finally {
      setPending(false);
    }
  }

  function startDraft(assetId: string, mode: Mode) {
    setError(null);
    setAmount("");
    setStake("");
    setBuyer("");
    setRows({});
    setFundingDrafts([]);
    setDraft({ assetId, mode });
  }

  function addFundingSlot() {
    setFundingDrafts([
      ...fundingDrafts,
      { id: nextFundingDraftId.current++, amount: "", invitedId: "" },
    ]);
  }

  function makeTerms(mode: Mode): BusinessCapitalTerms | null {
    if (mode === "request-equity") {
      const requests = [];
      for (const row of fundingDrafts) {
        const amountCents = scaledInput(row.amount, 100, 2);
        if (!amountCents) return null;
        requests.push({
          amountCents,
          ...(row.invitedId ? { invitedInvestorId: row.invitedId } : {}),
        });
      }
      return requests.length ? { kind: mode, requests } : null;
    }

    if (mode === "primary-issuance") {
      const contributions = [];
      for (const player of match.players) {
        const row = rows[player.playerId];
        if (!row || (!row.amount && !row.stake)) continue;
        const amountCents = scaledInput(row.amount, 100, 2);
        const postMoneyOwnershipPpm = scaledInput(row.stake, 10_000, 4);
        if (
          !amountCents ||
          !postMoneyOwnershipPpm ||
          postMoneyOwnershipPpm >= 1_000_000
        )
          return null;
        contributions.push({
          playerId: player.playerId,
          amountCents,
          postMoneyOwnershipPpm,
        });
      }
      return contributions.length ? { kind: mode, contributions } : null;
    }
    const amountCents = scaledInput(amount, 100, 2);
    if (!amountCents) return null;
    if (mode === "company-expansion")
      return { kind: mode, investmentCents: amountCents };
    const ownershipPpm = scaledInput(stake, 10_000, 4);
    const loanRequests = [];
    for (const row of fundingDrafts) {
      const principalCents = scaledInput(row.amount, 100, 2);
      if (!principalCents || row.invitedId === buyer) return null;
      loanRequests.push({
        principalCents,
        ...(row.invitedId ? { invitedLenderId: row.invitedId } : {}),
      });
    }
    return buyer && ownershipPpm && ownershipPpm <= 1_000_000
      ? {
          kind: mode,
          sellerPlayerId: ownId,
          buyerPlayerId: buyer,
          priceCents: amountCents,
          ownershipPpm,
          ...(loanRequests.length ? { loanRequests } : {}),
        }
      : null;
  }

  const terms = draft ? makeTerms(draft.mode) : null;
  const binding = tx
    ? { transactionId: tx.id, expectedTermsRevision: tx.termsRevision }
    : null;
  const expansionCompany =
    !tx && terms?.kind === "company-expansion"
      ? companies.find(
          (asset) =>
            asset.id === draft?.assetId && asset.ownershipPpm === 1_000_000,
        )
      : undefined;
  const ownerContribution =
    expansionCompany && terms?.kind === "company-expansion"
      ? Math.max(
          0,
          terms.investmentCents - (expansionCompany.companyCashCents ?? 0),
        )
      : 0;

  return (
    <section className="card business-capital" aria-label="Business capital">
      <h3>Business capital</h3>
      {tx && binding && (
        <div>
          <h4>
            {tx.terms.kind === "primary-issuance" ||
            tx.terms.kind === "request-equity"
              ? "Raise company capital"
              : tx.terms.kind === "company-expansion"
                ? "Expand the company"
                : "Buy or sell a company stake"}
          </h4>
          <p>
            Proposal from {name(tx.initiatorPlayerId)}. Terms version{" "}
            {tx.termsRevision}.
          </p>
          {tx.terms.kind === "request-equity" && (
            <section aria-label="Company investment offers">
              <h5>Company investment offers</h5>
              <p>
                New investment goes to company cash. Existing stakes shrink
                proportionally; every current owner and selected investor must
                agree.
              </p>
              {tx.terms.requests.map((request, slot) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Frozen funding slots are identified by their position.
                <div key={slot}>
                  <p>
                    Investment {slot + 1}: {usd(request.amountCents)} from{" "}
                    {request.invitedInvestorId
                      ? name(request.invitedInvestorId)
                      : "any eligible investor"}
                    .
                  </p>
                  {(tx.equityOffers ?? [])
                    .filter((offer) => offer.slot === slot)
                    .map((offer) => (
                      <div key={offer.investorPlayerId}>
                        <p>
                          {name(offer.investorPlayerId)} asks for{" "}
                          {percent(offer.postMoneyOwnershipPpm)} after issuance.{" "}
                          {offer.selected && "Selected."}
                        </p>
                        {tx.initiatorPlayerId === ownId && !offer.selected && (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={disabled}
                            onClick={() =>
                              void send({
                                type: "SELECT_BUSINESS_EQUITY",
                                ...binding,
                                slot,
                                investorPlayerId: offer.investorPlayerId,
                              })
                            }
                          >
                            Select {name(offer.investorPlayerId)} for investment{" "}
                            {slot + 1}
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              ))}
              {tx.readyToConfirm === false && (
                <p>
                  Select an offer for every investment before requesting
                  confirmation.
                </p>
              )}
            </section>
          )}
          {tx.terms.kind === "secondary-stake-sale" && (
            <p>
              {name(tx.terms.sellerPlayerId)} sells{" "}
              {percent(tx.terms.ownershipPpm)} to {name(tx.terms.buyerPlayerId)}{" "}
              for {usd(tx.terms.priceCents)} before fees. Sale fee: 3%.
            </p>
          )}
          {tx.terms.kind === "secondary-stake-sale" &&
            tx.terms.loanRequests && (
              <section aria-label="Player financing">
                <h5>Player financing</h5>
                {tx.terms.loanRequests.map((request, slot) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Frozen contract slots are identified by their position.
                  <div key={slot}>
                    <p>
                      Loan {slot + 1}: {usd(request.principalCents)} from{" "}
                      {request.invitedLenderId
                        ? name(request.invitedLenderId)
                        : "any eligible lender"}
                      .
                    </p>
                    {(tx.loanOffers ?? [])
                      .filter((offer) => offer.slot === slot)
                      .map((offer) => (
                        <div key={offer.lenderPlayerId}>
                          <p>
                            {name(offer.lenderPlayerId)}:{" "}
                            {(offer.annualRateBps / 100).toFixed(2)}% APR for{" "}
                            {offer.termQuarters} quarters.{" "}
                            {offer.selected && "Selected."}
                          </p>
                          {tx.terms.kind === "secondary-stake-sale" &&
                            tx.terms.buyerPlayerId === ownId &&
                            !offer.selected && (
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={disabled}
                                onClick={() =>
                                  void send({
                                    type: "SELECT_BUSINESS_LOAN",
                                    ...binding,
                                    slot,
                                    lenderPlayerId: offer.lenderPlayerId,
                                  })
                                }
                              >
                                Select {name(offer.lenderPlayerId)} for loan{" "}
                                {slot + 1}
                              </button>
                            )}
                        </div>
                      ))}
                  </div>
                ))}
                {tx.readyToConfirm === false && (
                  <p>
                    Choose an offer for every loan before confirming the deal.
                  </p>
                )}
              </section>
            )}
          {tx.terms.kind === "primary-issuance" && (
            <ul>
              {tx.terms.contributions.map((item) => (
                <li key={item.playerId}>
                  {name(item.playerId)} invests {usd(item.amountCents)} in the
                  company for {percent(item.postMoneyOwnershipPpm)} after
                  issuance. Current stakes shrink proportionally.
                </li>
              ))}
            </ul>
          )}
          {tx.terms.kind === "company-expansion" && (
            <p>
              Spend {usd(tx.terms.investmentCents)} from company cash. Higher
              operating profit starts next quarter.
            </p>
          )}
          {tx.yourContributionCents > 0 && (
            <p>
              Your total cash needed, including any fees:{" "}
              {usd(tx.yourContributionCents)}.
            </p>
          )}
          <p>
            {tx.confirmedPlayerIds.length} of {tx.participantIds.length}{" "}
            confirmed.{" "}
            {confirmed
              ? "You confirmed these terms."
              : "You have not confirmed."}
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled || tx.readyToConfirm === false}
            onClick={() =>
              void send({
                type: confirmed
                  ? "WITHDRAW_BUSINESS_CAPITAL"
                  : "CONFIRM_BUSINESS_CAPITAL",
                ...binding,
              })
            }
          >
            {confirmed ? "Withdraw confirmation" : "Confirm these terms"}
          </button>
          {tx.initiatorPlayerId === ownId && (
            <>
              <button
                type="button"
                className="btn-primary"
                disabled={disabled || !canClose}
                onClick={() =>
                  void send({ type: "CLOSE_BUSINESS_CAPITAL", ...binding })
                }
              >
                Close business deal
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={disabled}
                onClick={() =>
                  void send({
                    type: "CANCEL_ACTIVE_TRANSACTION",
                    transactionId: tx.id,
                  })
                }
              >
                Cancel business deal
              </button>
              {!draft && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={disabled}
                  onClick={() => startDraft(tx.assetId, tx.terms.kind)}
                >
                  Revise terms
                </button>
              )}
            </>
          )}
        </div>
      )}
      {!tx &&
        !draft &&
        companies.map((asset) => (
          <div key={asset.id}>
            <p>
              Business {asset.id} · {percent(asset.ownershipPpm)} owned
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled}
              onClick={() => startDraft(asset.id, "secondary-stake-sale")}
            >
              Offer a stake
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled}
              onClick={() => startDraft(asset.id, "primary-issuance")}
            >
              Raise company capital
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled}
              onClick={() => startDraft(asset.id, "request-equity")}
            >
              Invite equity offers
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={disabled}
              onClick={() => startDraft(asset.id, "company-expansion")}
            >
              Expand this business
            </button>
          </div>
        ))}
      {draft && (
        <fieldset disabled={disabled}>
          <legend>
            {tx ? "Revise business deal" : "Prepare business proposal"}
          </legend>
          {draft.mode === "request-equity" ? (
            <>
              <p>
                Set the amount you want to raise in each investment. Interested
                players will propose the percentage they require.
              </p>
              <FundingSlotEditor
                kind="equity"
                players={match.players.filter(
                  (player) => player.playerId !== ownId,
                )}
                drafts={fundingDrafts}
                onChange={setFundingDrafts}
                onAdd={addFundingSlot}
              />
            </>
          ) : draft.mode === "primary-issuance" ? (
            match.players.map((player) => (
              <fieldset key={player.playerId}>
                <legend>{player.nickname}</legend>
                <label>
                  Contribution ($){" "}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rows[player.playerId]?.amount ?? ""}
                    onChange={(event) =>
                      setRows({
                        ...rows,
                        [player.playerId]: {
                          stake: rows[player.playerId]?.stake ?? "",
                          amount: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Stake after issuance (%){" "}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rows[player.playerId]?.stake ?? ""}
                    onChange={(event) =>
                      setRows({
                        ...rows,
                        [player.playerId]: {
                          amount: rows[player.playerId]?.amount ?? "",
                          stake: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              </fieldset>
            ))
          ) : (
            <label>
              {draft.mode === "company-expansion"
                ? "Company investment ($)"
                : "Sale price ($)"}{" "}
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          )}
          {draft.mode === "secondary-stake-sale" && (
            <>
              <label>
                Buyer{" "}
                <select
                  aria-label="Buyer"
                  value={buyer}
                  onChange={(event) => setBuyer(event.target.value)}
                >
                  <option value="">Choose a player</option>
                  {match.players
                    .filter((player) => player.playerId !== ownId)
                    .map((player) => (
                      <option key={player.playerId} value={player.playerId}>
                        {player.nickname}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Company stake (%){" "}
                <input
                  type="text"
                  inputMode="decimal"
                  value={stake}
                  onChange={(event) => setStake(event.target.value)}
                />
              </label>
              <p>
                Request player loans only for the portion the buyer needs to
                finance. The buyer compares and selects the offers.
              </p>
              <FundingSlotEditor
                kind="loan"
                players={match.players.filter(
                  (player) =>
                    player.playerId !== ownId && player.playerId !== buyer,
                )}
                drafts={fundingDrafts}
                onChange={setFundingDrafts}
                onAdd={addFundingSlot}
              />
            </>
          )}
          {ownerContribution > 0 && (
            <p>
              This expansion also uses {usd(ownerContribution)} of your personal
              cash. The extra annual profit starts next quarter.
              {ownerContribution > match.self.availableCashCents &&
                " Your available cash falls short."}
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={
              !terms ||
              disabled ||
              ownerContribution > match.self.availableCashCents
            }
            onClick={() =>
              terms &&
              void send(
                binding
                  ? { type: "REVISE_BUSINESS_CAPITAL", ...binding, terms }
                  : expansionCompany && terms.kind === "company-expansion"
                    ? {
                        type: "EXPAND_BUSINESS",
                        assetId: draft.assetId,
                        investmentCents: terms.investmentCents,
                        ...(ownerContribution > 0
                          ? { ownerContributionCents: ownerContribution }
                          : {}),
                      }
                    : {
                        type: "OPEN_BUSINESS_CAPITAL",
                        assetId: draft.assetId,
                        terms,
                      },
              )
            }
          >
            {tx
              ? "Send revised terms"
              : expansionCompany
                ? "Fund expansion"
                : "Send business proposal"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setDraft(null)}
          >
            Discard draft
          </button>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
