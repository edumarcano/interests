import {
  asAssetId,
  asPlayerId,
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
import {
  canOfferBusinessEquity,
  equityRequests,
  isEquitySelection,
  reservedBusinessEquityCash,
  validEquityOffer,
} from "./businessEquityOffers";
import {
  borrowerHasArrears,
  canOfferBusinessLoan,
  fundBusinessSaleWithPlayerLoans,
  loanRequests,
  reservedBusinessLoanCash,
  validateBusinessLoanOffer,
} from "./businessLoanOffers";
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
    if (
      proposal.terms.kind === "secondary-stake-sale" &&
      loanRequests(proposal).length &&
      borrowerHasArrears(state, asPlayerId(proposal.terms.buyerPlayerId))
    )
      return reject("FINANCING_NOT_READY");
    if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
      return reject("TRANSACTION_ID_EXHAUSTED");
    const { id, counters } = nextDeterministicId("transaction", state.counters);
    return save(
      {
        ...proposal,
        terms: plan.terms,
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
  if (command.expectedTermsRevision !== tx.termsRevision)
    return reject("STALE_TERMS_REVISION");
  const requests = loanRequests(tx);
  const offers = tx.loanOffers ?? [];
  const selected = tx.selectedLoans ?? [];
  const financingChange = (
    changes: Partial<
      Pick<
        BusinessCapitalTransaction,
        "loanOffers" | "selectedLoans" | "equityOffers" | "selectedEquity"
      >
    >,
  ) => {
    if (tx.termsRevision >= Number.MAX_SAFE_INTEGER)
      return reject("COUNTER_EXHAUSTED");
    const next = {
      ...tx,
      ...changes,
      termsRevision: tx.termsRevision + 1,
      confirmedPlayerIds: [],
    };
    if (!planBusinessCapital(state, asset, next))
      return reject("INVALID_CAPITAL_CONSIDERATION");
    return save(next);
  };
  if (command.type === "OFFER_BUSINESS_EQUITY") {
    const offer = {
      investorPlayerId: actor,
      slot: command.slot,
      postMoneyOwnershipPpm: command.postMoneyOwnershipPpm,
    };
    if (!canOfferBusinessEquity(tx, actor, command.slot))
      return reject("CAPITAL_PARTICIPANT_REQUIRED");
    if (!validEquityOffer(tx, offer))
      return reject("INVALID_CAPITAL_CONSIDERATION");
    const offers = tx.equityOffers ?? [];
    if (
      offers.some(
        (row) => row.investorPlayerId === actor && row.slot === command.slot,
      )
    )
      return reject("OFFER_ALREADY_EXISTS");
    if (
      (equityRequests(tx)[command.slot]?.amountCents ?? 0) >
      (state.finance.cashByPlayer[actor] ?? 0) -
        reservedBusinessEquityCash(tx, actor)
    )
      return reject("INSUFFICIENT_AVAILABLE_CASH");
    return save({ ...tx, equityOffers: [...offers, offer] });
  }
  if (command.type === "WITHDRAW_BUSINESS_EQUITY") {
    if (command.investorPlayerId !== actor)
      return reject("CAPITAL_PARTICIPANT_REQUIRED");
    const offer = tx.equityOffers?.find(
      (row) => row.slot === command.slot && row.investorPlayerId === actor,
    );
    if (!offer) return reject("NO_OFFER");
    const remaining = tx.equityOffers?.filter((row) => row !== offer) ?? [];
    return isEquitySelection(tx, offer)
      ? financingChange({
          equityOffers: remaining,
          selectedEquity:
            tx.selectedEquity?.filter((row) => row.slot !== command.slot) ?? [],
        })
      : save({ ...tx, equityOffers: remaining });
  }
  if (command.type === "SELECT_BUSINESS_EQUITY") {
    if (tx.initiatorPlayerId !== actor || tx.terms.kind !== "request-equity")
      return reject("CAPITAL_PARTICIPANT_REQUIRED");
    const offer = tx.equityOffers?.find(
      (row) =>
        row.slot === command.slot &&
        row.investorPlayerId === command.investorPlayerId,
    );
    if (!offer) return reject("NO_OFFER");
    if (isEquitySelection(tx, offer)) return reject("OFFER_ALREADY_ACCEPTED");
    return financingChange({
      selectedEquity: [
        ...(tx.selectedEquity ?? []).filter((row) => row.slot !== offer.slot),
        { slot: offer.slot, investorPlayerId: offer.investorPlayerId },
      ],
    });
  }
  if (command.type === "OFFER_BUSINESS_LOAN") {
    if (
      tx.terms.kind !== "secondary-stake-sale" ||
      !canOfferBusinessLoan(tx, actor, command.slot)
    )
      return reject("CAPITAL_PARTICIPANT_REQUIRED");
    const offer = {
      lenderPlayerId: actor,
      slot: command.slot,
      annualRateBps: command.annualRateBps,
      termQuarters: command.termQuarters,
    };
    if (!validateBusinessLoanOffer(tx, offer))
      return reject("UNSUPPORTED_TERMS");
    if (
      offers.some(
        (row) => row.lenderPlayerId === actor && row.slot === command.slot,
      )
    )
      return reject("OFFER_ALREADY_EXISTS");
    if (
      (requests[command.slot]?.principalCents ?? 0) >
      (state.finance.cashByPlayer[actor] ?? 0) -
        reservedBusinessLoanCash(tx, actor)
    )
      return reject("INSUFFICIENT_AVAILABLE_CASH");
    return save({ ...tx, loanOffers: [...offers, offer] });
  }
  if (command.type === "WITHDRAW_BUSINESS_LOAN") {
    if (command.lenderPlayerId !== actor)
      return reject("CAPITAL_PARTICIPANT_REQUIRED");
    const remaining = offers.filter(
      (row) => row.lenderPlayerId !== actor || row.slot !== command.slot,
    );
    if (remaining.length === offers.length) return reject("NO_OFFER");
    const retained = selected.filter(
      (row) => row.lenderPlayerId !== actor || row.slot !== command.slot,
    );
    if (retained.length < selected.length)
      return financingChange({
        loanOffers: remaining,
        selectedLoans: retained,
      });
    return save({ ...tx, loanOffers: remaining });
  }
  if (command.type === "SELECT_BUSINESS_LOAN") {
    if (
      tx.terms.kind !== "secondary-stake-sale" ||
      tx.terms.buyerPlayerId !== actor
    )
      return reject("UNAUTHORIZED_BUYER");
    const winner = offers.find(
      (row) =>
        row.slot === command.slot &&
        row.lenderPlayerId === command.lenderPlayerId,
    );
    if (!winner) return reject("NO_OFFER");
    if (
      selected.some(
        (row) =>
          row.slot === winner.slot &&
          row.lenderPlayerId === winner.lenderPlayerId,
      )
    )
      return reject("OFFER_ALREADY_ACCEPTED");
    return financingChange({
      loanOffers: offers,
      selectedLoans: [
        ...selected.filter((row) => row.slot !== winner.slot),
        { slot: winner.slot, lenderPlayerId: winner.lenderPlayerId },
      ],
    });
  }
  if (!plan.participants.includes(actor))
    return reject("CAPITAL_PARTICIPANT_REQUIRED");
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
        loanOffers: [],
        selectedLoans: [],
        equityOffers: [],
        selectedEquity: [],
      };
      const next = planBusinessCapital(state, asset, revised);
      if (!next) return reject("INVALID_CAPITAL_CONSIDERATION");
      if (
        revised.terms.kind === "secondary-stake-sale" &&
        loanRequests(revised).length &&
        borrowerHasArrears(state, asPlayerId(revised.terms.buyerPlayerId))
      )
        return reject("FINANCING_NOT_READY");
      return save({ ...revised, terms: next.terms });
    }
    case "CONFIRM_BUSINESS_CAPITAL": {
      if (!plan.ready) return reject("FINANCING_NOT_READY");
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
      if (!plan.ready) return reject("FINANCING_NOT_READY");
      if (plan.participants.some((id) => !tx.confirmedPlayerIds.includes(id)))
        return reject("CAPITAL_CONFIRMATIONS_REQUIRED");
      return resolveTerminalTransactionAndAdvanceSpotlight(state, actor, () => {
        const funded = fundBusinessSaleWithPlayerLoans(state, tx);
        if (!funded.ok) return funded;
        const result =
          plan.action.kind === "company-expansion"
            ? applyCompanyExpansion(
                funded.state,
                tx.assetId,
                plan.action.investmentCents,
                tx.id,
              )
            : postBusinessCapitalConsideration(
                funded.state,
                tx.assetId,
                tx.id,
                plan.action,
              );
        if (!result.ok) return result;
        return {
          ...result,
          journalEntries: [...funded.journalEntries, ...result.journalEntries],
          state: { ...result.state, activeTransaction: null },
        };
      });
  }
}
