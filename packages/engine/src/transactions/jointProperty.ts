import {
  asAssetId,
  type JointPropertyCommand,
  type PlayerId,
} from "@interests/shared";
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
import {
  jointPropertyCashRequired,
  jointPropertyCommand,
  jointPropertyParticipants,
  jointPropertyRightsMatch,
  quoteJointProperty,
} from "./jointPropertyTerms";
import type { JointPropertyTransaction } from "./model";

export function applyJointPropertyCommand(
  state: GameState,
  actor: PlayerId,
  command: JointPropertyCommand,
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
    tx: JointPropertyTransaction,
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
  if (command.type === "OPEN_JOINT_PROPERTY") {
    if (getActiveSpotlightPlayerId(state) !== actor)
      return reject("NOT_ACTIVE_SPOTLIGHT");
    if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
    const asset = state.finance.assetsById[asAssetId(command.assetId)];
    if (asset?.kind !== "property" || !asset.ownershipByPlayerPpm[actor])
      return reject("PROPERTY_OWNER_REQUIRED");
    const quote = quoteJointProperty(state, asset, actor, command.terms);
    if (!quote) return reject("INVALID_PROPERTY_TERMS");
    if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
      return reject("TRANSACTION_ID_EXHAUSTED");
    const { id, counters } = nextDeterministicId("transaction", state.counters);
    return save(
      {
        id,
        kind: "joint-property",
        assetId: asset.id,
        initiatorPlayerId: actor,
        createdQuarter: state.currentQuarter,
        termsRevision: 1,
        terms:
          quote.kind === "refinance"
            ? { kind: "refinance", rateKind: quote.rateKind }
            : { kind: quote.kind },
        quote,
        ownershipByPlayerPpm: { ...asset.ownershipByPlayerPpm },
        confirmedPlayerIds: [],
      },
      counters,
    );
  }
  const tx = state.activeTransaction;
  if (!tx) return reject("NO_ACTIVE_TRANSACTION");
  if (tx.id !== command.transactionId) return reject("TRANSACTION_ID_MISMATCH");
  if (tx.kind !== "joint-property") return reject("INVALID_TRANSACTION_KIND");
  if (command.expectedTermsRevision !== tx.termsRevision)
    return reject("STALE_TERMS_REVISION");
  if (!jointPropertyRightsMatch(state, tx))
    return reject("PROPERTY_QUOTE_CHANGED");
  const asset = state.finance.assetsById[tx.assetId];
  if (asset?.kind !== "property" || !asset.ownershipByPlayerPpm[actor])
    return reject("PROPERTY_OWNER_REQUIRED");
  if (command.type === "CANCEL_JOINT_PROPERTY") {
    if (actor !== tx.initiatorPlayerId) return reject("NOT_ACTIVE_SPOTLIGHT");
    return cancelActiveTransactionAndAdvanceSpotlight(state, actor, tx.id);
  }
  if (command.type === "REVISE_JOINT_PROPERTY") {
    if (actor !== tx.initiatorPlayerId) return reject("NOT_ACTIVE_SPOTLIGHT");
    if (tx.termsRevision >= Number.MAX_SAFE_INTEGER)
      return reject("COUNTER_EXHAUSTED");
    const quote = quoteJointProperty(state, asset, actor, command.terms);
    if (!quote) return reject("INVALID_PROPERTY_TERMS");
    return save({
      ...tx,
      terms:
        quote.kind === "refinance"
          ? { kind: "refinance", rateKind: quote.rateKind }
          : { kind: quote.kind },
      quote,
      termsRevision: tx.termsRevision + 1,
      confirmedPlayerIds: [],
    });
  }
  if (command.type === "WITHDRAW_JOINT_PROPERTY") {
    if (!tx.confirmedPlayerIds.includes(actor))
      return reject("PROPERTY_NOT_CONFIRMED");
    return save({
      ...tx,
      confirmedPlayerIds: tx.confirmedPlayerIds.filter((id) => id !== actor),
    });
  }
  const quote = quoteJointProperty(
    state,
    asset,
    tx.initiatorPlayerId,
    tx.terms,
  );
  if (!quote || JSON.stringify(quote) !== JSON.stringify(tx.quote))
    return reject("PROPERTY_QUOTE_CHANGED");
  switch (command.type) {
    case "CONFIRM_JOINT_PROPERTY":
      if (tx.confirmedPlayerIds.includes(actor))
        return reject("PROPERTY_ALREADY_CONFIRMED");
      if (
        (state.finance.cashByPlayer[actor] ?? 0) <
        jointPropertyCashRequired(tx, actor)
      )
        return reject("INSUFFICIENT_AVAILABLE_CASH");
      return save({
        ...tx,
        confirmedPlayerIds: [...tx.confirmedPlayerIds, actor],
      });
    case "CLOSE_JOINT_PROPERTY": {
      if (actor !== tx.initiatorPlayerId) return reject("NOT_ACTIVE_SPOTLIGHT");
      if (
        jointPropertyParticipants(state, asset).some(
          (id) => !tx.confirmedPlayerIds.includes(id),
        )
      )
        return reject("PROPERTY_CONFIRMATIONS_REQUIRED");
      const draft = draftPropertyOwnerAction(
        { ...state, activeTransaction: null },
        actor,
        jointPropertyCommand(tx),
        "unanimous-owners",
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
    }
  }
}
