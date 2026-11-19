import {
  asAssetId,
  type BusinessAuctionCommand,
  type PlayerId,
} from "@interests/shared";
import {
  businessStakePurchaseTotalCents,
  postBusinessCapitalConsideration,
} from "../finance/businessCapitalAccounting";
import { cents, isNonNegativeCents } from "../finance/money";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import {
  getActiveSpotlightPlayerId,
  resolveTerminalTransactionAndAdvanceSpotlight,
} from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { canListAuction, saleTerms } from "./businessAuctionTerms";
import type { BusinessAuctionTransaction } from "./model";
import { respondToSealedAuction } from "./sealedAuction";

export function applyBusinessAuctionCommand(
  state: GameState,
  actor: PlayerId,
  command: BusinessAuctionCommand,
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
    activeTransaction: BusinessAuctionTransaction,
    counters = state.counters,
  ) => {
    const next = {
      ...state,
      activeTransaction,
      counters,
      revision: state.revision + 1,
    };
    assertGameState(next);
    return { ok: true, state: next, journalEntries: [] } as const;
  };
  if (command.type === "OPEN_BUSINESS_AUCTION") {
    if (getActiveSpotlightPlayerId(state) !== actor)
      return reject("NOT_ACTIVE_SPOTLIGHT");
    if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
    if (
      !isNonNegativeCents(command.minimumBidCents) ||
      !command.minimumBidCents
    )
      return reject("INVALID_PRICE");
    if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
      return reject("TRANSACTION_ID_EXHAUSTED");
    const { id, counters } = nextDeterministicId("transaction", state.counters);
    const tx: BusinessAuctionTransaction = {
      kind: "business-auction",
      id,
      assetId: asAssetId(command.assetId),
      ownershipPpm: command.ownershipPpm,
      sellerPlayerId: actor,
      createdQuarter: state.currentQuarter,
      minimumBidCents: command.minimumBidCents,
      eligiblePlayerIds: state.playerOrder.filter((player) => player !== actor),
      responses: [],
    };
    if (!canListAuction(state, tx))
      return reject("INVALID_CAPITAL_CONSIDERATION");
    return save(tx, counters);
  }
  const tx = state.activeTransaction;
  if (!tx) return reject("NO_ACTIVE_TRANSACTION");
  if (tx.id !== command.transactionId) return reject("TRANSACTION_ID_MISMATCH");
  if (tx.kind !== "business-auction") return reject("INVALID_TRANSACTION_KIND");
  const available = state.finance.cashByPlayer[actor] ?? cents(0);
  if (command.bidCents !== null && isNonNegativeCents(command.bidCents)) {
    try {
      if (businessStakePurchaseTotalCents(command.bidCents) > available)
        return reject("INSUFFICIENT_AVAILABLE_CASH");
    } catch (error) {
      if (error instanceof RangeError)
        return reject("INSUFFICIENT_AVAILABLE_CASH");
      throw error;
    }
  }
  const bid = respondToSealedAuction(tx, actor, command.bidCents, available);
  if (!bid.ok) return reject(bid.code);
  const result = bid.resolution;
  if (result.kind === "collecting")
    return save({ ...tx, responses: bid.auction.responses });
  return resolveTerminalTransactionAndAdvanceSpotlight(
    state,
    tx.sellerPlayerId,
    () => {
      if (result.kind === "no-bids")
        return {
          ok: true,
          state: { ...state, activeTransaction: null },
          journalEntries: [],
        };
      const closing = postBusinessCapitalConsideration(
        state,
        tx.assetId,
        tx.id,
        saleTerms(tx, result.winnerPlayerId, result.priceCents),
      );
      return closing.ok
        ? { ...closing, state: { ...closing.state, activeTransaction: null } }
        : closing;
    },
  );
}
