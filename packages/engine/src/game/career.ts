import {
  CAREER_REENTRY_ANNUAL_CENTS,
  CAREER_TEMPLATES,
  EXECUTIVE_COMPANY_TERMS,
} from "@interests/rules";
import type { AssetId, CareerOfferView, PlayerId } from "@interests/shared";
import { externalCashAccount, playerCashAccount } from "../finance/account";
import { FinanceDecimal } from "../finance/decimal";
import { cents } from "../finance/money";
import { ownershipPpm } from "../finance/ownership";
import { postCash } from "../finance/posting";
import type { BusinessAsset, GameState } from "../model/gameState";
import type { ActionErrorCode, ActionResult } from "./actions";
import { nextDeterministicId } from "./deterministicIds";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "./round";

export function currentAnnualLaborCompensation(
  state: GameState,
  playerId: PlayerId,
): number | null {
  const labor = state.progress.byPlayer[playerId]!.labor;
  if (labor.kind === "employment") {
    const annual =
      state.finance.recurringByPlayer[playerId]!.quarterlyIncomeCents * 4;
    return Number.isSafeInteger(annual) ? annual : null;
  }
  if (labor.kind === "owner-work") {
    const asset = state.finance.assetsById[labor.assetId];
    return asset?.kind === "business"
      ? (asset.workCompensation?.annualCompensationCents ?? 0)
      : 0;
  }
  return 0;
}

/** Read-only quotes are stable across inspection, reconnects and unrelated commands. */
export function getCareerOffers(
  state: GameState,
  playerId: PlayerId,
): readonly CareerOfferView[] {
  if (!state.players[playerId] || state.phase !== "ready-for-first-round")
    return [];
  const capacity = currentAnnualLaborCompensation(state, playerId);
  if (capacity === null) return [];
  const labor = state.progress.byPlayer[playerId]!.labor;
  return CAREER_TEMPLATES.filter(
    (t) => capacity >= t.minimumAnnualCapacityCents,
  ).flatMap((t) => {
    const quarterly = new FinanceDecimal(
      capacity || CAREER_REENTRY_ANNUAL_CENTS,
    )
      .times(capacity ? 10000 + t.raiseBps : 10000)
      .div(40000)
      .round()
      .toNumber();
    if (!Number.isSafeInteger(quarterly * 4)) return [];
    return [
      {
        id: `career:${state.currentQuarter}:${t.id}:${capacity}:${labor.kind}`,
        name: capacity ? t.name : `${t.name}: return to employment`,
        role:
          t.role === "executive" ||
          (labor.kind === "employment" && labor.role === "executive")
            ? ("executive" as const)
            : ("professional" as const),
        annualCompensationCents: quarterly * 4,
        raiseBps: capacity ? t.raiseBps : 0,
        transitionCostCents: t.transitionCostCents,
        ownershipCostCents: t.ownershipCostCents,
        ownershipPosition:
          t.ownershipCostCents > 0 ? { ...EXECUTIVE_COMPANY_TERMS } : null,
        affordable:
          state.finance.cashByPlayer[playerId]! >=
          t.transitionCostCents + t.ownershipCostCents,
        tradeoff:
          t.ownershipCostCents > 0
            ? "Buy $100,000 of a managed company from an external seller. Investment can lose value; no company cash is created. Replaces your current labor role."
            : t.transitionCostCents > 0
              ? "Pay $5,000 in transition costs for the larger raise. Replaces your current labor role."
              : "Smaller raise without transition costs. Replaces your current labor role.",
      },
    ];
  });
}

function leaveOwnerWork(state: GameState, playerId: PlayerId): GameState {
  const labor = state.progress.byPlayer[playerId]!.labor;
  if (labor.kind !== "owner-work") return state;
  const asset = state.finance.assetsById[labor.assetId];
  if (asset?.kind !== "business" || !asset.workCompensation)
    throw new Error("Missing owner work contract");
  return {
    ...state,
    finance: {
      ...state.finance,
      assetsById: {
        ...state.finance.assetsById,
        [asset.id]: {
          ...asset,
          annualManagementCostCents:
            asset.workCompensation.annualCompensationCents,
          workCompensation: {
            ...asset.workCompensation,
            annualCompensationCents: cents(0),
          },
        },
      },
    },
  };
}

export function applyCareerCommand(
  state: GameState,
  playerId: PlayerId,
  offerId: string | null,
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });
  if (!state.players[playerId]) return reject("UNKNOWN_PLAYER");
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (getActiveSpotlightPlayerId(state) !== playerId)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
  const previous = state.progress.byPlayer[playerId]!;
  if (offerId === null && previous.labor.kind === "not-working")
    return reject("NOT_WORKING");
  const offer =
    offerId === null
      ? null
      : getCareerOffers(state, playerId).find((o) => o.id === offerId);
  if (offerId !== null && !offer) return reject("CAREER_OFFER_UNAVAILABLE");
  if (offer && !offer.affordable) return reject("INSUFFICIENT_FUNDS");
  try {
    let draft = leaveOwnerWork(state, playerId);
    const journals = [];
    let ownershipPositionAssetId: AssetId | undefined;
    if (offer) {
      for (const [amountCents, reason] of [
        [offer.transitionCostCents, "career-transition-cost"],
        [offer.ownershipCostCents, "executive-secondary-purchase"],
      ] as const) {
        if (amountCents === 0) continue;
        const posting = postCash(draft.finance, draft.counters, {
          source: playerCashAccount(playerId),
          destination: externalCashAccount("career-counterparty"),
          amountCents,
          reason,
          quarter: state.currentQuarter,
        });
        if (!posting.ok)
          return reject(
            posting.code === "DESTINATION_OVERFLOW"
              ? posting.code
              : "INSUFFICIENT_FUNDS",
          );
        draft = {
          ...draft,
          finance: posting.finance,
          counters: posting.counters,
        };
        journals.push(posting.entry);
      }
      if (offer.ownershipCostCents > 0) {
        const generated = nextDeterministicId("asset", draft.counters);
        ownershipPositionAssetId = generated.id;
        const asset: BusinessAsset = {
          id: generated.id,
          kind: "business",
          cashPolicyId: "retained-profit-v1",
          cashCents: cents(0),
          operatingArrearsCents: cents(0),
          annualRevenueCents: cents(EXECUTIVE_COMPANY_TERMS.annualRevenueCents),
          annualOperatingProfitCents: cents(
            EXECUTIVE_COMPANY_TERMS.annualOperatingProfitCents,
          ),
          enterpriseValueCents: cents(offer.ownershipCostCents),
          debtPrincipalCents: cents(0),
          ownershipByPlayerPpm: { [playerId]: ownershipPpm(1_000_000) },
        };
        draft = {
          ...draft,
          counters: generated.counters,
          finance: {
            ...draft.finance,
            assetsById: { ...draft.finance.assetsById, [asset.id]: asset },
            quarterStartBasis: {
              ...draft.finance.quarterStartBasis,
              businessesById: {
                ...draft.finance.quarterStartBasis.businessesById,
                [asset.id]: {
                  cashPolicyId: asset.cashPolicyId,
                  annualOperatingProfitCents: cents(0),
                  ownershipByPlayerPpm: asset.ownershipByPlayerPpm,
                },
              },
            },
          },
        };
      }
    }
    draft = {
      ...draft,
      finance: {
        ...draft.finance,
        recurringByPlayer: {
          ...draft.finance.recurringByPlayer,
          [playerId]: {
            ...draft.finance.recurringByPlayer[playerId]!,
            quarterlyIncomeCents: cents(
              offer ? offer.annualCompensationCents / 4 : 0,
            ),
          },
        },
      },
      progress: {
        ...draft.progress,
        byPlayer: {
          ...draft.progress.byPlayer,
          [playerId]: {
            ...previous,
            labor: offer
              ? {
                  kind: "employment",
                  role: offer.role,
                  ...(ownershipPositionAssetId
                    ? { ownershipPositionAssetId }
                    : {}),
                }
              : { kind: "not-working" },
            assetsById: {
              ...previous.assetsById,
              ...(ownershipPositionAssetId && offer
                ? {
                    [ownershipPositionAssetId]: {
                      costCents: cents(offer.ownershipCostCents),
                      acquiredQuarter: state.currentQuarter,
                      ownershipPpm: ownershipPpm(1_000_000),
                    },
                  }
                : {}),
            },
          },
        },
      },
    };
    const advanced = advanceSpotlight(draft, playerId);
    if (!advanced.ok) return reject(advanced.code);
    return {
      ...advanced,
      journalEntries: [...journals, ...advanced.journalEntries],
    };
  } catch (error) {
    if (error instanceof RangeError) return reject("COUNTER_EXHAUSTED");
    throw error;
  }
}
