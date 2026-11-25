import { RECURRING_CONTENT_TEMPLATES } from "@interests/rules";
import {
  asPlayerId,
  type PlayerId,
  type SharedRecurringAcquisitionCommand,
  type SharedRecurringAcquisitionTerms,
  type SharedRecurringAcquisitionView,
} from "@interests/shared";
import { calculatePlayerLoanSchedule } from "../finance/amortization";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import {
  cancelActiveTransactionAndAdvanceSpotlight,
  getActiveSpotlightPlayerId,
} from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import {
  acquireRecurringOpportunity,
  getRecurringAcquisitionQuotes,
} from "../opportunities/recurringPurchase";
import { borrowerHasArrears } from "./businessLoanOffers";
import type { SharedRecurringAcquisitionTransaction } from "./model";

function quoteSharedAcquisition(
  state: GameState,
  lead: PlayerId,
  terms: SharedRecurringAcquisitionTerms,
  transactionId?: SharedRecurringAcquisitionTransaction["id"],
) {
  if (
    !terms ||
    !state.playerOrder.includes(asPlayerId(terms.partnerPlayerId)) ||
    terms.partnerPlayerId === lead ||
    !Number.isSafeInteger(terms.leadCashCents) ||
    terms.leadCashCents <= 0
  )
    return undefined;
  if (terms.playerLoan) {
    if (
      terms.partnerOwnershipPpm !== undefined ||
      borrowerHasArrears(state, lead) ||
      state.counters.loan >= Number.MAX_SAFE_INTEGER
    )
      return undefined;
  } else if (
    !Number.isSafeInteger(terms.partnerOwnershipPpm) ||
    terms.partnerOwnershipPpm <= 0 ||
    terms.partnerOwnershipPpm >= 1_000_000
  ) {
    return undefined;
  }
  // Repricing considers the lead's proposed contribution exactly once.
  const quote = getRecurringAcquisitionQuotes(
    { ...state, activeTransaction: null },
    lead,
    terms.opportunityId,
    {
      leadCashCents: terms.leadCashCents,
      ...(transactionId === undefined
        ? {}
        : { closingTransactionId: transactionId }),
      partner: terms.playerLoan
        ? {
            playerId: asPlayerId(terms.partnerPlayerId),
            playerLoan: terms.playerLoan,
          }
        : {
            playerId: asPlayerId(terms.partnerPlayerId),
            ownershipPpm: terms.partnerOwnershipPpm,
          },
    },
  ).find((item) => item.route === terms.route && item.canClose);
  if (quote && terms.playerLoan) {
    try {
      calculatePlayerLoanSchedule({
        ...terms.playerLoan,
        principalCents: quote.cashRequiredCents - terms.leadCashCents,
      });
    } catch (error) {
      if (error instanceof RangeError) return undefined;
      throw error;
    }
  }
  return quote;
}

function normalizeTerms(
  terms: SharedRecurringAcquisitionTerms,
): SharedRecurringAcquisitionTerms {
  const common = {
    opportunityId: terms.opportunityId,
    leadCashCents: terms.leadCashCents,
    partnerPlayerId: terms.partnerPlayerId,
  };
  return terms.playerLoan
    ? {
        ...common,
        route: terms.route,
        playerLoan: {
          annualRateBps: terms.playerLoan.annualRateBps,
          termQuarters: terms.playerLoan.termQuarters,
        },
      }
    : {
        ...common,
        route: terms.route,
        partnerOwnershipPpm: terms.partnerOwnershipPpm,
      };
}

function contribution(
  tx: SharedRecurringAcquisitionTransaction,
  player: PlayerId,
) {
  return player === tx.leadPlayerId
    ? tx.terms.leadCashCents
    : tx.quote.cashRequiredCents - tx.terms.leadCashCents;
}

export function assertSharedRecurringAcquisition(
  state: GameState,
  tx: SharedRecurringAcquisitionTransaction,
  active: PlayerId | null,
) {
  if (
    active !== tx.leadPlayerId ||
    tx.createdQuarter !== state.currentQuarter ||
    !Number.isSafeInteger(tx.termsRevision) ||
    tx.termsRevision < 1 ||
    !Array.isArray(tx.confirmedPlayerIds) ||
    new Set(tx.confirmedPlayerIds).size !== tx.confirmedPlayerIds.length ||
    !tx.confirmedPlayerIds.every(
      (id) =>
        (id === tx.leadPlayerId || id === tx.terms.partnerPlayerId) &&
        contribution(tx, id) <= (state.finance.cashByPlayer[id] ?? 0),
    )
  )
    throw new Error("Invalid shared recurring acquisition transaction");
  const quote = quoteSharedAcquisition(state, tx.leadPlayerId, tx.terms, tx.id);
  if (!quote || JSON.stringify(quote) !== JSON.stringify(tx.quote))
    throw new Error("Invalid shared recurring acquisition quote");
}

export function projectSharedRecurringAcquisition(
  state: GameState,
  player: PlayerId,
): SharedRecurringAcquisitionView | null {
  const tx = state.activeTransaction;
  if (
    tx?.kind !== "shared-recurring-acquisition" ||
    (player !== tx.leadPlayerId && player !== tx.terms.partnerPlayerId)
  )
    return null;
  const card = state.content.cardsByPlayer[tx.leadPlayerId]!;
  const template = RECURRING_CONTENT_TEMPLATES.find(
    (row) => row.id === card.templateId,
  )!;
  return {
    id: tx.id,
    leadPlayerId: tx.leadPlayerId,
    name: template.name,
    termsRevision: tx.termsRevision,
    terms: normalizeTerms(tx.terms),
    quote: {
      opportunityId: tx.quote.opportunityId,
      kind: tx.quote.kind,
      ...(tx.quote.propertyMarketKind
        ? { propertyMarketKind: tx.quote.propertyMarketKind }
        : {}),
      route: tx.quote.route,
      askingPriceCents: tx.quote.askingPriceCents,
      purchaseFeeCents: tx.quote.purchaseFeeCents,
      principalCents: tx.quote.principalCents,
      annualRateBps: tx.quote.annualRateBps,
      termQuarters: tx.quote.termQuarters,
      quarterlyPaymentCents: tx.quote.quarterlyPaymentCents,
      assetReserveCents: tx.quote.assetReserveCents,
      cashRequiredCents: tx.quote.cashRequiredCents,
    },
    confirmedPlayerIds: tx.confirmedPlayerIds,
    ...(tx.terms.playerLoan
      ? {
          playerLoanPayments: calculatePlayerLoanSchedule({
            ...tx.terms.playerLoan,
            principalCents: contribution(
              tx,
              asPlayerId(tx.terms.partnerPlayerId),
            ),
          }).map((row) => row.paymentCents),
        }
      : {}),
  };
}

export function applySharedRecurringAcquisitionCommand(
  state: GameState,
  actor: PlayerId,
  command: SharedRecurringAcquisitionCommand,
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });
  if (!state.players[actor]) return reject("UNKNOWN_PLAYER");
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (state.revision >= Number.MAX_SAFE_INTEGER)
    return reject("COUNTER_EXHAUSTED");
  const save = (
    tx: SharedRecurringAcquisitionTransaction,
    counters = state.counters,
  ) => {
    const next = {
      ...state,
      activeTransaction: tx,
      counters,
      revision: state.revision + 1,
    };
    assertGameState(next);
    return { ok: true, state: next, journalEntries: [] } as const;
  };
  if (command.type === "OPEN_SHARED_RECURRING_ACQUISITION") {
    if (getActiveSpotlightPlayerId(state) !== actor)
      return reject("NOT_ACTIVE_SPOTLIGHT");
    if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
    if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
      return reject("TRANSACTION_ID_EXHAUSTED");
    const { id, counters } = nextDeterministicId("transaction", state.counters);
    const quote = quoteSharedAcquisition(state, actor, command.terms, id);
    if (!quote) return reject("INVALID_PROPERTY_TERMS");
    return save(
      {
        kind: "shared-recurring-acquisition",
        id,
        leadPlayerId: actor,
        createdQuarter: state.currentQuarter,
        termsRevision: 1,
        terms: normalizeTerms(command.terms),
        quote,
        confirmedPlayerIds: [],
      },
      counters,
    );
  }
  const tx = state.activeTransaction;
  if (!tx) return reject("NO_ACTIVE_TRANSACTION");
  if (tx.id !== command.transactionId) return reject("TRANSACTION_ID_MISMATCH");
  if (tx.kind !== "shared-recurring-acquisition")
    return reject("INVALID_TRANSACTION_KIND");
  if (tx.termsRevision !== command.expectedTermsRevision)
    return reject("STALE_TERMS_REVISION");
  const lead = actor === tx.leadPlayerId;
  if (!lead && actor !== tx.terms.partnerPlayerId)
    return reject("PROPERTY_OWNER_REQUIRED");
  switch (command.type) {
    case "REVISE_SHARED_RECURRING_ACQUISITION": {
      if (!lead) return reject("NOT_ACTIVE_SPOTLIGHT");
      if (tx.termsRevision >= Number.MAX_SAFE_INTEGER)
        return reject("COUNTER_EXHAUSTED");
      if (command.terms.opportunityId !== tx.terms.opportunityId)
        return reject("INVALID_PROPERTY_TERMS");
      const quote = quoteSharedAcquisition(state, actor, command.terms, tx.id);
      if (!quote) return reject("INVALID_PROPERTY_TERMS");
      return save({
        ...tx,
        terms: normalizeTerms(command.terms),
        quote,
        termsRevision: tx.termsRevision + 1,
        confirmedPlayerIds: [],
      });
    }
    case "CANCEL_SHARED_RECURRING_ACQUISITION":
      return lead
        ? cancelActiveTransactionAndAdvanceSpotlight(state, actor, tx.id)
        : reject("NOT_ACTIVE_SPOTLIGHT");
    case "WITHDRAW_SHARED_RECURRING_ACQUISITION":
      if (!tx.confirmedPlayerIds.includes(actor))
        return reject("PROPERTY_NOT_CONFIRMED");
      return save({
        ...tx,
        confirmedPlayerIds: tx.confirmedPlayerIds.filter((id) => id !== actor),
      });
    case "CONFIRM_SHARED_RECURRING_ACQUISITION":
      if (tx.confirmedPlayerIds.includes(actor))
        return reject("PROPERTY_ALREADY_CONFIRMED");
      if (state.finance.cashByPlayer[actor]! < contribution(tx, actor))
        return reject("INSUFFICIENT_AVAILABLE_CASH");
      return save({
        ...tx,
        confirmedPlayerIds: [...tx.confirmedPlayerIds, actor],
      });
    case "CLOSE_SHARED_RECURRING_ACQUISITION": {
      if (!lead) return reject("NOT_ACTIVE_SPOTLIGHT");
      if (tx.confirmedPlayerIds.length !== 2)
        return reject("PROPERTY_CONFIRMATIONS_REQUIRED");
      const quote = quoteSharedAcquisition(state, actor, tx.terms, tx.id);
      if (!quote || JSON.stringify(quote) !== JSON.stringify(tx.quote))
        return reject("PROPERTY_QUOTE_CHANGED");
      const result = acquireRecurringOpportunity(
        { ...state, activeTransaction: null },
        actor,
        {
          type: "ACQUIRE_RECURRING_OPPORTUNITY",
          opportunityId: tx.terms.opportunityId,
          quoteId: tx.quote.id,
        },
        {
          transactionId: tx.id,
          leadCashCents: tx.terms.leadCashCents,
          partnerPlayerId: asPlayerId(tx.terms.partnerPlayerId),
          ...(tx.terms.playerLoan
            ? { playerLoan: tx.terms.playerLoan }
            : { partnerOwnershipPpm: tx.terms.partnerOwnershipPpm }),
        },
      );
      return result.ok ? result : reject(result.code);
    }
  }
}
