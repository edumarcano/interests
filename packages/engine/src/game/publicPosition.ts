import { OBJECTIVE_MEASUREMENT_RULES } from "@interests/rules";
import type {
  PlayerId,
  PublicEconomicAction,
  PublicPlayerPositionView,
} from "@interests/shared";
import { FinanceDecimal } from "../finance/decimal";
import type { GameState } from "../model/gameState";
import { measurePlayerObjectives } from "../objectives/measurements";
import type { ActionResult } from "./actions";
import type { WirePlayerCommand } from "./playerCommand";

export function projectPublicPosition(
  state: GameState,
  playerId: PlayerId,
): PublicPlayerPositionView {
  const latestAction = state.progress.byPlayer[playerId]?.latestPublicAction;
  const measured = measurePlayerObjectives(state, playerId);
  const opening = state.finance.quarterStartBasis;
  const liquid = Object.values(opening.publicMarketsByPlayer[playerId]!).reduce(
    (total, value) => total.plus(value),
    new FinanceDecimal(opening.cashByPlayer[playerId]!),
  );
  const living =
    opening.recurringByPlayer[playerId]!.quarterlyLivingExpenseCents;
  const assets = new FinanceDecimal(measured.grossAssetValueCents);
  const debt = new FinanceDecimal(measured.totalLiabilitiesCents);
  return {
    liquidity: liquid.lt(living)
      ? "tight"
      : liquid.lt(living * 4)
        ? "adequate"
        : "strong",
    leverage: debt.times(4).lte(assets)
      ? "low"
      : debt.times(2).lte(assets)
        ? "moderate"
        : "high",
    cashFlow:
      measured.completedQuarters < 4
        ? "unseasoned"
        : measured.annualRecurringSurplusCents > 0
          ? "surplus"
          : measured.annualRecurringSurplusCents < 0
            ? "deficit"
            : "break-even",
    assets: Object.values(state.finance.assetsById).flatMap((asset) => {
      const ownershipPpm = asset.ownershipByPlayerPpm[playerId];
      if (
        !ownershipPpm ||
        (asset.kind === "property" && asset.disposition === "sold")
      )
        return [];
      return [
        {
          assetId: asset.id,
          kind: asset.kind,
          ownershipPpm,
          partnerIds: state.playerOrder.filter(
            (id) =>
              id !== playerId && (asset.ownershipByPlayerPpm[id] ?? 0) > 0,
          ),
        },
      ];
    }),
    ...(latestAction
      ? {
          latestAction: {
            kind: latestAction.kind,
            quarter: latestAction.quarter,
          },
        }
      : {}),
  };
}

const journalAction = new Map<string, PublicEconomicAction>([
  ["property-purchase", "property-purchase"],
  ["property-sale", "property-sale"],
  ["property-renovation", "property-improvement"],
  ["property-refinancing-fee", "property-refinancing"],
  ["business-purchase", "business-purchase"],
  ["npc-business-sale-consideration", "business-sale"],
  ["business-stake-consideration", "business-stake-transfer"],
  ["business-primary-equity-contribution", "business-capital-raise"],
  ["business-expansion", "business-expansion"],
  ["executive-secondary-purchase", "executive-ownership"],
  ["npc-loan-advance", "market-loan"],
]);

export function recordPublicAction(
  before: GameState,
  playerId: PlayerId,
  command: WirePlayerCommand,
  outcome: ActionResult,
): ActionResult {
  if (!outcome.ok) return outcome;
  let kind: PublicEconomicAction | undefined;
  for (const entry of outcome.journalEntries) {
    if (entry.reason === "recurring-acquisition-purchase") {
      const asset = entry.relatedAssetId
        ? outcome.state.finance.assetsById[entry.relatedAssetId]
        : undefined;
      kind =
        asset?.kind === "property" ? "property-purchase" : "business-purchase";
      break;
    }
    kind = journalAction.get(entry.reason);
    if (kind) break;
  }
  if (!kind && command.type === "TRADE_PUBLIC_MARKETS") {
    const tradedCents = outcome.journalEntries.reduce(
      (total, entry) =>
        entry.reason === "public-market-purchase" ||
        entry.reason === "public-market-sale"
          ? total.plus(entry.amountCents)
          : total,
      new FinanceDecimal(0),
    );
    if (tradedCents.gte(OBJECTIVE_MEASUREMENT_RULES.materialEquityCents))
      kind = "public-fund-trade";
  }
  if (!kind && command.type === "RESIGN_LABOR") kind = "work-status";
  if (!kind && command.type === "PURSUE_FINALE") {
    if (command.action.type === "TRADE_PUBLIC_MARKETS")
      kind = "public-fund-trade";
    if (
      command.action.type === "RESIGN_LABOR" ||
      command.action.type === "CONFIRM_INDEPENDENCE"
    )
      kind = "work-status";
  }
  if (!kind) return outcome;
  const state = outcome.state;
  const announcedPlayer =
    command.type === "RESPOND_BUSINESS_AUCTION" &&
    before.activeTransaction?.kind === "business-auction"
      ? before.activeTransaction.sellerPlayerId
      : playerId;
  return {
    ...outcome,
    state: {
      ...state,
      progress: {
        byPlayer: {
          ...state.progress.byPlayer,
          [announcedPlayer]: {
            ...state.progress.byPlayer[announcedPlayer]!,
            latestPublicAction: { kind, quarter: before.currentQuarter },
          },
        },
      },
    },
  };
}
