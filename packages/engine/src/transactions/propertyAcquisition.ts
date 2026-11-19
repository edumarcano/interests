import type { PlayerId, PropertyAcquisitionCommand } from "@interests/shared";
import { ownershipPpm } from "../finance/ownership";
import { draftPropertyOwnerAction } from "../finance/propertyActions";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import {
  advanceSpotlight,
  cancelActiveTransactionAndAdvanceSpotlight,
  getActiveSpotlightPlayerId,
} from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import type { PropertyAcquisitionTransaction } from "./model";
import {
  normalizePropertyAcquisitionTerms,
  quotePropertyAcquisition,
} from "./propertyAcquisitionTerms";

export function applyPropertyAcquisitionCommand(
  state: GameState,
  actor: PlayerId,
  command: PropertyAcquisitionCommand,
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
    tx: PropertyAcquisitionTransaction,
    counters = state.counters,
  ): ActionResult => {
    const next = {
      ...state,
      activeTransaction: tx,
      counters,
      revision: state.revision + 1,
    };
    assertGameState(next);
    return { ok: true, state: next, journalEntries: [] };
  };
  try {
    if (command.type === "OPEN_PROPERTY_ACQUISITION") {
      if (getActiveSpotlightPlayerId(state) !== actor)
        return reject("NOT_ACTIVE_SPOTLIGHT");
      if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
      const quote = quotePropertyAcquisition(state, actor, command.terms);
      if (!quote) return reject("INVALID_PROPERTY_TERMS");
      if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
        return reject("TRANSACTION_ID_EXHAUSTED");
      const { id, counters } = nextDeterministicId(
        "transaction",
        state.counters,
      );
      return save(
        {
          id,
          kind: "property-acquisition",
          leadPlayerId: actor,
          createdQuarter: state.currentQuarter,
          termsRevision: 1,
          terms: normalizePropertyAcquisitionTerms(state, command.terms),
          quote,
          confirmedPlayerIds: [],
        },
        counters,
      );
    }
    const tx = state.activeTransaction;
    if (!tx) return reject("NO_ACTIVE_TRANSACTION");
    if (tx.id !== command.transactionId)
      return reject("TRANSACTION_ID_MISMATCH");
    if (tx.kind !== "property-acquisition")
      return reject("INVALID_TRANSACTION_KIND");
    if (tx.termsRevision !== command.expectedTermsRevision)
      return reject("STALE_TERMS_REVISION");
    const buyer = tx.terms.buyers.find((party) => party.playerId === actor);
    if (!buyer) return reject("PROPERTY_OWNER_REQUIRED");
    if (command.type === "CANCEL_PROPERTY_ACQUISITION") {
      if (actor !== tx.leadPlayerId) return reject("NOT_ACTIVE_SPOTLIGHT");
      return cancelActiveTransactionAndAdvanceSpotlight(state, actor, tx.id);
    }
    if (command.type === "WITHDRAW_PROPERTY_ACQUISITION") {
      if (!tx.confirmedPlayerIds.includes(actor))
        return reject("PROPERTY_NOT_CONFIRMED");
      return save({
        ...tx,
        confirmedPlayerIds: tx.confirmedPlayerIds.filter((id) => id !== actor),
      });
    }
    if (command.type === "REVISE_PROPERTY_ACQUISITION") {
      if (actor !== tx.leadPlayerId) return reject("NOT_ACTIVE_SPOTLIGHT");
      if (tx.termsRevision >= Number.MAX_SAFE_INTEGER)
        return reject("COUNTER_EXHAUSTED");
      const quote = quotePropertyAcquisition(state, actor, command.terms);
      if (!quote) return reject("INVALID_PROPERTY_TERMS");
      return save({
        ...tx,
        terms: normalizePropertyAcquisitionTerms(state, command.terms),
        quote,
        termsRevision: tx.termsRevision + 1,
        confirmedPlayerIds: [],
      });
    }
    const quote = quotePropertyAcquisition(state, tx.leadPlayerId, tx.terms);
    if (!quote || JSON.stringify(quote) !== JSON.stringify(tx.quote))
      return reject("PROPERTY_QUOTE_CHANGED");
    if (command.type === "CONFIRM_PROPERTY_ACQUISITION") {
      if (tx.confirmedPlayerIds.includes(actor))
        return reject("PROPERTY_ALREADY_CONFIRMED");
      if (state.finance.cashByPlayer[actor]! < buyer.cashContributionCents)
        return reject("INSUFFICIENT_AVAILABLE_CASH");
      return save({
        ...tx,
        confirmedPlayerIds: [...tx.confirmedPlayerIds, actor],
      });
    }
    if (actor !== tx.leadPlayerId) return reject("NOT_ACTIVE_SPOTLIGHT");
    if (
      !tx.terms.buyers.every((party) =>
        tx.confirmedPlayerIds.includes(party.playerId as PlayerId),
      )
    )
      return reject("PROPERTY_CONFIRMATIONS_REQUIRED");
    const draft = draftPropertyOwnerAction(
      { ...state, activeTransaction: null },
      actor,
      {
        type: "BUY_PROPERTY",
        catalogueId: tx.terms.catalogueId,
        principalCents: tx.terms.principalCents,
        rateKind: tx.terms.rateKind,
      },
      "sole-owner",
      {
        cashByPlayer: Object.fromEntries(
          tx.terms.buyers.map((party) => [
            party.playerId,
            party.cashContributionCents,
          ]),
        ),
        ownershipByPlayerPpm: Object.fromEntries(
          tx.terms.buyers.map((party) => [
            party.playerId,
            ownershipPpm(party.ownershipPpm),
          ]),
        ),
      },
    );
    if (!draft.ok) return { ...draft, state, journalEntries: [] };
    const advanced = advanceSpotlight(draft.state, actor);
    if (!advanced.ok) return { ...advanced, state, journalEntries: [] };
    return {
      ...advanced,
      journalEntries: [
        ...draft.journalEntries.map((entry) => ({
          ...entry,
          relatedTransactionId: tx.id,
        })),
        ...advanced.journalEntries,
      ],
    };
  } catch (error) {
    if (error instanceof RangeError) return reject("DESTINATION_OVERFLOW");
    throw error;
  }
}
