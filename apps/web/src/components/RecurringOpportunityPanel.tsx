import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  RecurringOpportunityFacts,
  SetFocusCommandPayload,
} from "@interests/shared";
import { useEffect, useState } from "react";
import { money } from "./CareerPanel";
import { MarketLoanOffer } from "./MarketLoanOffer";
import { RecurringAcquisitionPanel } from "./RecurringAcquisitionPanel";
import { RecurringBusinessExitPanel } from "./RecurringBusinessExitPanel";

const focusOptions = [
  ["general", "General"],
  ["business", "Business"],
  ["property", "Property"],
  ["career", "Career"],
  ["markets", "Public markets"],
  ["financing", "Financing"],
] as const;
const fundingErrors: Readonly<Record<string, string>> = {
  NPC_BORROWER_UNAVAILABLE: "This borrower already has an active loan.",
  INSUFFICIENT_AVAILABLE_CASH:
    "You no longer have enough available cash to fund this loan.",
  OPPORTUNITY_NOT_AVAILABLE: "This market offer has expired.",
  NOT_ACTIVE_SPOTLIGHT: "You can fund this loan during your own spotlight.",
  ACTIVE_TRANSACTION: "Finish the active transaction before funding this loan.",
};
type Focus = SetFocusCommandPayload["focus"];

function Facts({ facts }: { facts: RecurringOpportunityFacts }) {
  return facts.kind === "business" ? (
    <dl data-testid="recurring-facts">
      <dt>Annual revenue</dt>
      <dd>{money(facts.annualRevenueCents)}</dd>
      <dt>Annual operating profit after necessary labor</dt>
      <dd>{money(facts.annualOperatingProfitCents)}</dd>
      <dt>Operating enterprise value</dt>
      <dd>{money(facts.enterpriseValueCents)}</dd>
      <dt>Business debt</dt>
      <dd>{money(facts.debtPrincipalCents)}</dd>
    </dl>
  ) : (
    <dl data-testid="recurring-facts">
      <dt>Market value</dt>
      <dd>{money(facts.marketValueCents)}</dd>
      <dt>Scheduled quarterly rent</dt>
      <dd>{money(facts.scheduledQuarterlyRentCents)}</dd>
      <dt>Occupancy</dt>
      <dd>{(facts.occupancyBps / 100).toFixed(2)}%</dd>
      <dt>Operating expenses / effective rent</dt>
      <dd>{(facts.operatingExpenseRatioBps / 100).toFixed(2)}%</dd>
    </dl>
  );
}

export function RecurringOpportunityPanel({
  roomCode,
  match,
  isPaused,
  onSendCommand,
}: {
  roomCode?: string;
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}) {
  const focus =
    focusOptions.find(
      ([id]) => id === match.self.financialDetails?.focus,
    )?.[0] ?? "general";
  const [draftFocus, setDraftFocus] = useState<Focus>(focus);
  const [pending, setPending] = useState<
    "focus" | "investigate" | "fund" | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => setDraftFocus(focus), [focus]);
  const card = match.self.recurringOpportunity;
  if (!card || match.phase !== "ready-for-first-round") return null;
  const blocked = isPaused || pending !== null;
  async function send(
    command: PlayerCommand,
    kind: "focus" | "investigate" | "fund",
  ) {
    if (blocked) return;
    setPending(kind);
    setError("");
    try {
      const result = await onSendCommand(command);
      if (!result.ok) {
        const { message } = result.error;
        setError(
          kind === "fund" ? (fundingErrors[message] ?? message) : message,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Command failed. Try again.",
      );
    } finally {
      setPending(null);
    }
  }
  const negotiatingPurchase =
    match.sharedRecurringAcquisition?.leadPlayerId === match.self.playerId;
  const canInvestigate =
    card.status === "available" &&
    !card.investigated &&
    !negotiatingPurchase &&
    card.investigationFeeCents > 0 &&
    match.self.availableCashCents >= card.investigationFeeCents &&
    !blocked;
  return (
    <section
      className="card"
      aria-label="Your quarterly opportunity"
      data-testid="recurring-opportunity-panel"
      style={{ marginBlock: "1rem", overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h2>Your quarterly opportunity</h2>
      <p>
        Quarter {card.createdQuarter} · {card.category} · {card.intensity}
      </p>
      <h3 data-testid="recurring-card-name">{card.name}</h3>
      <p>{card.summary}</p>
      {card.askingPriceCents > 0 && card.action !== "npc-financing" && (
        <p>
          {card.action === "npc-business-exit"
            ? "Fixed buyer operating bid"
            : "Asking amount"}
          : {money(card.askingPriceCents)}
        </p>
      )}
      {card.status === "completed" ? (
        <p role="status">
          Business sale completed. The company is no longer player-owned.
        </p>
      ) : card.status === "acquired" ? (
        <p role="status">
          Purchase completed. Your asset appears in your private finances.
        </p>
      ) : card.status === "funded" ? (
        <p role="status">
          Loan funded. Follow payments and the outstanding balance in your
          private finances.
        </p>
      ) : card.status === "expired" ? (
        <p role="status">
          This card expired when your spotlight ended. New cards arrive next
          quarter.
        </p>
      ) : (
        <p>
          This card expires when your spotlight ends.
          {card.investigationFeeCents > 0 &&
            " You can investigate during preparation."}
        </p>
      )}
      {card.marketLoanQuote && (
        <MarketLoanOffer
          quote={card.marketLoanQuote}
          isSpotlight={
            match.round?.activeSpotlightPlayerId === match.self.playerId
          }
          isBlocked={blocked}
          isSubmitting={pending === "fund"}
          onFund={() =>
            send(
              { type: "FUND_RECURRING_LOAN", opportunityId: card.id },
              "fund",
            )
          }
        />
      )}
      {card.facts ? (
        <>
          <p>Investigation paid. These facts stay fixed.</p>
          <Facts facts={card.facts} />
        </>
      ) : (
        card.investigationFeeCents > 0 && (
          <>
            <p>
              Optional investigation costs {money(card.investigationFeeCents)}.
              It reveals existing facts and the fee remains spent if you pass.
            </p>
            <button
              type="button"
              className="btn-secondary"
              data-testid="investigate-recurring-btn"
              disabled={!canInvestigate}
              onClick={() =>
                send(
                  { type: "INVESTIGATE_OPPORTUNITY", opportunityId: card.id },
                  "investigate",
                )
              }
            >
              {pending === "investigate"
                ? "Investigating…"
                : `Investigate for ${money(card.investigationFeeCents)}`}
            </button>
            {negotiatingPurchase && (
              <p>Investigation is paused while your shared purchase is open.</p>
            )}
            {match.self.availableCashCents < card.investigationFeeCents && (
              <p>Available cash does not cover the investigation fee.</p>
            )}
          </>
        )
      )}
      {card.action === "career" && (
        <p>
          <a href="#career-and-labor">Review your career choices</a>
        </p>
      )}
      {card.action === "markets" && (
        <p>
          <a href="#public-markets-title">Review your public funds</a>
        </p>
      )}
      {(card.action === "business-management" ||
        card.action === "property-management") && (
        <p>
          <a href="#private-finances">Review your asset finances</a>
        </p>
      )}
      <RecurringBusinessExitPanel
        match={match}
        isPaused={isPaused || pending !== null}
        onSendCommand={onSendCommand}
      />
      {roomCode && (
        <RecurringAcquisitionPanel
          roomCode={roomCode}
          match={match}
          isPaused={isPaused || pending !== null}
          onSendCommand={onSendCommand}
        />
      )}
      <div style={{ marginTop: "1rem" }}>
        <label htmlFor="future-opportunity-focus">
          Focus for future opportunities
        </label>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center",
          }}
        >
          <select
            id="future-opportunity-focus"
            value={draftFocus}
            disabled={blocked}
            onChange={(event) => {
              setDraftFocus(event.target.value as Focus);
              setError("");
            }}
            style={{ maxWidth: "100%" }}
          >
            {focusOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary"
            data-testid="set-focus-btn"
            disabled={blocked || draftFocus === focus}
            onClick={() =>
              send({ type: "SET_FOCUS", focus: draftFocus }, "focus")
            }
          >
            {pending === "focus" ? "Saving…" : "Set future focus"}
          </button>
        </div>
        <p>
          Focus increases the chance of matching future cards. It does not
          replace this card or guarantee a deal.
        </p>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
