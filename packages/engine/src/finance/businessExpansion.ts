import { OPERATING_RULES } from "@interests/rules";
import {
  type AssetId,
  asAssetId,
  type PlayerId,
  type TransactionId,
} from "@interests/shared";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type { GameState } from "../model/gameState";
import type { TransactionResult } from "../transactions/model";
import { businessCashAccount, externalCashAccount } from "./account";
import { cents } from "./money";
import { TOTAL_OWNERSHIP_PPM } from "./ownership";
import { postCash } from "./posting";

export function expandBusinessAndAdvanceSpotlight(
  state: GameState,
  actor: PlayerId,
  input: { readonly assetId: string; readonly investmentCents: number },
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    code,
    state,
    journalEntries: [],
  });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (getActiveSpotlightPlayerId(state) !== actor)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");

  const asset = state.finance.assetsById[asAssetId(input.assetId)];
  if (asset?.kind !== "business") return reject("UNKNOWN_ASSET");
  const stake = asset.ownershipByPlayerPpm[actor];
  if (!stake) return reject("UNKNOWN_ASSET");
  if (stake !== TOTAL_OWNERSHIP_PPM)
    return reject("BUSINESS_EXPANSION_REQUIRES_CONSENT");

  const posted = applyCompanyExpansion(state, asset.id, input.investmentCents);
  if (!posted.ok) return reject(posted.code);
  const advanced = advanceSpotlight(posted.state, actor);
  if (!advanced.ok) return reject(advanced.code);
  return {
    ...advanced,
    journalEntries: [...posted.journalEntries, ...advanced.journalEntries],
  };
}

/** Draft a company-funded expansion after the participating owners agree. */
export function applyCompanyExpansion(
  state: GameState,
  assetId: AssetId,
  investmentCents: number,
  transactionId?: TransactionId,
): TransactionResult {
  const reject = (
    code: Extract<TransactionResult, { ok: false }>["code"],
  ): TransactionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });
  const asset = state.finance.assetsById[assetId];
  if (asset?.kind !== "business") return reject("UNKNOWN_ASSET");
  const ratio = OPERATING_RULES.businessGrowthCostPerAnnualProfitUnit;
  if (
    !Number.isSafeInteger(investmentCents) ||
    investmentCents <= 0 ||
    investmentCents % ratio !== 0 ||
    asset.pendingAnnualProfitIncreaseCents !== undefined
  )
    return reject("INVALID_EXPANSION");
  if (investmentCents > asset.cashCents) return reject("INSUFFICIENT_FUNDS");
  if (state.counters.journal >= Number.MAX_SAFE_INTEGER)
    return reject("JOURNAL_ID_EXHAUSTED");
  const increase = cents(investmentCents / ratio);
  if (!Number.isSafeInteger(asset.annualOperatingProfitCents + increase))
    return reject("DESTINATION_OVERFLOW");

  const posting = postCash(state.finance, state.counters, {
    source: businessCashAccount(asset.id),
    destination: externalCashAccount("business-operating-costs"),
    amountCents: investmentCents,
    reason: "business-expansion",
    quarter: state.currentQuarter,
    relatedAssetId: asset.id,
    ...(transactionId ? { relatedTransactionId: transactionId } : {}),
  });
  if (!posting.ok) return reject("INSUFFICIENT_FUNDS");
  const fundedAsset = posting.finance.assetsById[asset.id];
  if (fundedAsset?.kind !== "business")
    throw new Error("Missing funded company");
  return {
    ok: true,
    state: {
      ...state,
      counters: posting.counters,
      finance: {
        ...posting.finance,
        assetsById: {
          ...posting.finance.assetsById,
          [asset.id]: {
            ...fundedAsset,
            pendingAnnualProfitIncreaseCents: increase,
          },
        },
      },
    },
    journalEntries: [posting.entry],
  };
}
