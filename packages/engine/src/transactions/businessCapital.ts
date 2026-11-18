import {
  asAssetId,
  type BusinessCapitalCommand,
  type PlayerId,
} from "@interests/shared";
import { postBusinessCapitalConsideration } from "../finance/businessCapitalAccounting";
import { applyCompanyExpansion } from "../finance/businessExpansion";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import {
  getActiveSpotlightPlayerId,
  resolveTerminalTransactionAndAdvanceSpotlight,
} from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { planBusinessCapital } from "./businessCapitalTerms";
import type { BusinessCapitalTransaction } from "./model";

export function applyBusinessCapitalCommand(
  state: GameState,
  actor: PlayerId,
  command: BusinessCapitalCommand,
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });
  if (!Object.hasOwn(state.players, actor)) return reject("UNKNOWN_PLAYER");
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (state.revision >= Number.MAX_SAFE_INTEGER)
    return reject("COUNTER_EXHAUSTED");
  const save = (
    activeTransaction: BusinessCapitalTransaction,
    counters = state.counters,
  ) => {
    const next = {
      ...state,
      revision: state.revision + 1,
      activeTransaction,
      counters,
    };
    assertGameState(next);
    return { ok: true, state: next, journalEntries: [] } as const;
  };
  if (command.type === "OPEN_BUSINESS_CAPITAL") {
    if (getActiveSpotlightPlayerId(state) !== actor)
      return reject("NOT_ACTIVE_SPOTLIGHT");
    if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
    if (typeof command.assetId !== "string") return reject("UNKNOWN_ASSET");
    const asset = state.finance.assetsById[asAssetId(command.assetId)];
    if (asset?.kind !== "business") return reject("UNKNOWN_ASSET");
    const proposal = {
      terms: command.terms,
      initiatorPlayerId: actor,
    };
    const plan = planBusinessCapital(state, asset, proposal);
    if (!plan) return reject("INVALID_CAPITAL_CONSIDERATION");
    if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
      return reject("TRANSACTION_ID_EXHAUSTED");
    const { id, counters } = nextDeterministicId("transaction", state.counters);
    return save(
      {
        ...proposal,
        terms: plan.action,
        kind: "business-capital",
        id,
        assetId: asset.id,
        createdQuarter: state.currentQuarter,
        termsRevision: 1,
        confirmedPlayerIds: [],
      },
      counters,
    );
  }
  const tx = state.activeTransaction;
  if (!tx) return reject("NO_ACTIVE_TRANSACTION");
  if (tx.id !== command.transactionId) return reject("TRANSACTION_ID_MISMATCH");
  if (tx.kind !== "business-capital") return reject("INVALID_TRANSACTION_KIND");
  const asset = state.finance.assetsById[tx.assetId];
  if (asset?.kind !== "business") return reject("UNKNOWN_ASSET");
  const plan = planBusinessCapital(state, asset, tx);
  if (!plan) return reject("INVALID_CAPITAL_CONSIDERATION");
  if (!plan.participants.includes(actor))
    return reject("CAPITAL_PARTICIPANT_REQUIRED");
  if (command.expectedTermsRevision !== tx.termsRevision)
    return reject("STALE_TERMS_REVISION");
  switch (command.type) {
    case "REVISE_BUSINESS_CAPITAL": {
      if (tx.initiatorPlayerId !== actor) return reject("NOT_ACTIVE_SPOTLIGHT");
      if (tx.termsRevision >= Number.MAX_SAFE_INTEGER)
        return reject("COUNTER_EXHAUSTED");
      const revised = {
        ...tx,
        terms: command.terms,
        termsRevision: tx.termsRevision + 1,
        confirmedPlayerIds: [],
      };
      const next = planBusinessCapital(state, asset, revised);
      if (!next) return reject("INVALID_CAPITAL_CONSIDERATION");
      return save({ ...revised, terms: next.action });
    }
    case "CONFIRM_BUSINESS_CAPITAL": {
      if (tx.confirmedPlayerIds.includes(actor))
        return reject("CAPITAL_ALREADY_CONFIRMED");
      if (
        (state.finance.cashByPlayer[actor] ?? 0) <
        (plan.cashContributions.get(actor) ?? 0)
      )
        return reject("INSUFFICIENT_AVAILABLE_CASH");
      return save({
        ...tx,
        confirmedPlayerIds: [...tx.confirmedPlayerIds, actor],
      });
    }
    case "WITHDRAW_BUSINESS_CAPITAL":
      if (!tx.confirmedPlayerIds.includes(actor))
        return reject("CAPITAL_NOT_CONFIRMED");
      return save({
        ...tx,
        confirmedPlayerIds: tx.confirmedPlayerIds.filter((id) => id !== actor),
      });
    case "CLOSE_BUSINESS_CAPITAL":
      if (tx.initiatorPlayerId !== actor) return reject("NOT_ACTIVE_SPOTLIGHT");
      if (plan.participants.some((id) => !tx.confirmedPlayerIds.includes(id)))
        return reject("CAPITAL_CONFIRMATIONS_REQUIRED");
      return resolveTerminalTransactionAndAdvanceSpotlight(state, actor, () => {
        const result =
          plan.action.kind === "company-expansion"
            ? applyCompanyExpansion(
                state,
                tx.assetId,
                plan.action.investmentCents,
                tx.id,
              )
            : postBusinessCapitalConsideration(
                state,
                tx.assetId,
                tx.id,
                plan.action,
              );
        if (!result.ok) return result;
        return {
          ...result,
          state: { ...result.state, activeTransaction: null },
        };
      });
  }
}
