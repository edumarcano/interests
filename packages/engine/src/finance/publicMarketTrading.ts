import {
  isPublicMarketInstrumentId,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_TRADE_FEE_BPS,
} from "@interests/rules";
import type {
  PlayerId,
  PublicMarketTradeLeg,
  PublicMarketTradePreview,
} from "@interests/shared";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import type { EconomicActionFinalizer } from "../game/finalization";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type { GameState } from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";
import { externalCashAccount, playerCashAccount } from "./account";
import { FinanceDecimal } from "./decimal";
import { allocateDisposalCents, fundExposure } from "./disposalEvidence";
import type { JournalEntry } from "./journal";
import { totalPublicMarketValueCents } from "./markets";
import { cents } from "./money";
import { postCash } from "./posting";

export type PublicMarketPreviewResult =
  | { readonly ok: true; readonly preview: PublicMarketTradePreview }
  | { readonly ok: false; readonly code: ActionErrorCode };

function safeInteger(value: FinanceDecimal): number {
  const result = value.toNumber();
  if (!Number.isSafeInteger(result)) throw new RangeError("Market overflow");
  return result;
}

/** Read-only quote of a basket. The execution path always requotes current state. */
export function previewPublicMarketTrade(
  state: GameState,
  actorPlayerId: PlayerId,
  trades: readonly PublicMarketTradeLeg[],
): PublicMarketPreviewResult {
  if (!state.players[actorPlayerId])
    return { ok: false, code: "UNKNOWN_PLAYER" };
  if (state.phase !== "ready-for-first-round")
    return { ok: false, code: "WRONG_PHASE" };
  if (!Array.isArray(trades) || trades.length < 1 || trades.length > 3)
    return { ok: false, code: "INVALID_MARKET_TRADE" };
  const seen = new Set<string>();
  for (const leg of trades) {
    if (
      !leg ||
      typeof leg !== "object" ||
      !isPublicMarketInstrumentId(leg.instrumentId) ||
      seen.has(leg.instrumentId) ||
      !Number.isSafeInteger(leg.buyCents) ||
      leg.buyCents < 0 ||
      !Number.isSafeInteger(leg.sellCents) ||
      leg.sellCents < 0 ||
      (leg.buyCents === 0 && leg.sellCents === 0) ||
      (leg.buyCents > 0 && leg.sellCents > 0)
    )
      return { ok: false, code: "INVALID_MARKET_TRADE" };
    seen.add(leg.instrumentId);
  }
  const portfolio = state.finance.publicMarketsByPlayer[actorPlayerId]!;
  const progress = state.progress.byPlayer[actorPlayerId]!;
  try {
    const quoted: PublicMarketTradePreview["trades"][number][] = [];
    let fees = new FinanceDecimal(0);
    let impact = new FinanceDecimal(0);
    let gains = new FinanceDecimal(progress.realizedGainsCents);
    const resultingPortfolio = { ...portfolio };
    for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
      const leg = trades.find((trade) => trade.instrumentId === instrumentId);
      if (!leg) continue;
      const { buyCents, sellCents } = leg;
      const value = portfolio[instrumentId];
      if (sellCents > value)
        return { ok: false, code: "INSUFFICIENT_HOLDINGS" };
      const feeCents = safeInteger(
        new FinanceDecimal(buyCents || sellCents)
          .times(PUBLIC_MARKET_TRADE_FEE_BPS)
          .dividedBy(10_000)
          .round(),
      );
      const removedBasisCents =
        sellCents === 0
          ? 0
          : safeInteger(
              new FinanceDecimal(progress.publicMarketBasis[instrumentId])
                .times(sellCents)
                .dividedBy(value)
                .round(),
            );
      const realizedGainCents = safeInteger(
        new FinanceDecimal(sellCents)
          .minus(sellCents > 0 ? feeCents : 0)
          .minus(removedBasisCents),
      );
      const resultingValueCents = safeInteger(
        new FinanceDecimal(value).plus(buyCents).minus(sellCents),
      );
      const resultingBasisCents = safeInteger(
        new FinanceDecimal(progress.publicMarketBasis[instrumentId])
          .minus(removedBasisCents)
          .plus(buyCents)
          .plus(buyCents > 0 ? feeCents : 0),
      );
      resultingPortfolio[instrumentId] = cents(resultingValueCents);
      quoted.push({
        instrumentId,
        buyCents,
        sellCents,
        feeCents,
        removedBasisCents,
        realizedGainCents,
        resultingValueCents,
        resultingBasisCents,
      });
      fees = fees.plus(feeCents);
      impact = impact.plus(sellCents).minus(buyCents).minus(feeCents);
      gains = gains.plus(realizedGainCents);
    }
    totalPublicMarketValueCents(resultingPortfolio);
    safeInteger(gains);
    const cashImpactCents = safeInteger(impact);
    const resultingCashCents = safeInteger(
      new FinanceDecimal(state.finance.cashByPlayer[actorPlayerId]!).plus(
        impact,
      ),
    );
    if (
      new FinanceDecimal(getAvailableCashCents(state, actorPlayerId))
        .plus(impact)
        .isNegative()
    )
      return { ok: false, code: "INSUFFICIENT_AVAILABLE_CASH" };
    let postingCash = new FinanceDecimal(
      state.finance.cashByPlayer[actorPlayerId]!,
    );
    for (const leg of [
      ...quoted.filter((leg) => leg.sellCents > 0),
      ...quoted.filter((leg) => leg.buyCents > 0),
    ]) {
      postingCash = postingCash.plus(leg.sellCents).minus(leg.buyCents);
      safeInteger(postingCash);
      postingCash = postingCash.minus(leg.feeCents);
      safeInteger(postingCash);
    }
    const entryCount = quoted.reduce(
      (count, leg) => count + 1 + Number(leg.feeCents > 0),
      0,
    );
    if (state.counters.journal > Number.MAX_SAFE_INTEGER - entryCount)
      return { ok: false, code: "JOURNAL_ID_EXHAUSTED" };
    return {
      ok: true,
      preview: {
        revision: state.revision,
        feeRateBps: PUBLIC_MARKET_TRADE_FEE_BPS,
        trades: quoted,
        totalFeesCents: safeInteger(fees),
        cashImpactCents,
        resultingCashCents,
      },
    };
  } catch (error) {
    if (error instanceof RangeError)
      return { ok: false, code: "DESTINATION_OVERFLOW" };
    throw error;
  }
}

export interface MarketTradeFacts {
  readonly kind: "public-market-trade";
  readonly purchasedCents: number;
  readonly soldCents: number;
}

export function tradePublicMarketsAndAdvanceSpotlight(
  state: GameState,
  actorPlayerId: PlayerId,
  trades: readonly PublicMarketTradeLeg[],
  finalize?: EconomicActionFinalizer<MarketTradeFacts>,
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (state.activeTransaction !== null) return reject("ACTIVE_TRANSACTION");
  if (getActiveSpotlightPlayerId(state) !== actorPlayerId)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  const result = previewPublicMarketTrade(state, actorPlayerId, trades);
  if (!result.ok) return reject(result.code);
  const quote = result.preview;
  let finance = state.finance;
  let counters = state.counters;
  const journalEntries: JournalEntry[] = [];
  // Sell first so a rebalance can use its own proceeds without temporary borrowing.
  const ordered = [
    ...quote.trades.filter((leg) => leg.sellCents > 0),
    ...quote.trades.filter((leg) => leg.buyCents > 0),
  ];
  for (const leg of ordered) {
    if (!isPublicMarketInstrumentId(leg.instrumentId))
      throw new Error("Invalid quoted instrument");
    const player = playerCashAccount(actorPlayerId);
    const market = externalCashAccount("market");
    const sale = leg.sellCents > 0;
    for (const [amountCents, source, destination, reason] of [
      [
        sale ? leg.sellCents : leg.buyCents,
        sale ? market : player,
        sale ? player : market,
        sale ? "public-market-sale" : "public-market-purchase",
      ],
      [leg.feeCents, player, market, "public-market-trade-fee"],
    ] as const) {
      if (amountCents === 0) continue;
      const posted = postCash(finance, counters, {
        source,
        destination,
        amountCents,
        reason,
        quarter: state.currentQuarter,
        relatedMarketInstrumentId: leg.instrumentId,
      });
      if (!posted.ok)
        return reject(
          posted.code === "DESTINATION_OVERFLOW"
            ? posted.code
            : "INSUFFICIENT_FUNDS",
        );
      finance = posted.finance;
      counters = posted.counters;
      journalEntries.push(posted.entry);
    }
  }
  const portfolio = { ...finance.publicMarketsByPlayer[actorPlayerId]! };
  const progress = state.progress.byPlayer[actorPlayerId]!;
  const publicMarketBasis = { ...progress.publicMarketBasis };
  const publicMarketDisposals = [...progress.publicMarketDisposals];
  const disposalEvidence = [...(progress.disposalEvidence ?? [])];
  const publicMarketExposure = Object.fromEntries(
    PUBLIC_MARKET_INSTRUMENT_IDS.map((id) => [
      id,
      fundExposure(
        progress,
        id,
        state.finance.publicMarketsByPlayer[actorPlayerId]![id],
        state.currentQuarter,
      ),
    ]),
  ) as NonNullable<typeof progress.publicMarketExposure>;
  const exposure = { ...publicMarketExposure };
  let gain = new FinanceDecimal(progress.realizedGainsCents);
  for (const leg of quote.trades) {
    if (!isPublicMarketInstrumentId(leg.instrumentId))
      throw new Error("Invalid quoted instrument");
    portfolio[leg.instrumentId] = cents(leg.resultingValueCents);
    publicMarketBasis[leg.instrumentId] = cents(leg.resultingBasisCents);
    gain = gain.plus(leg.realizedGainCents);
    const slices = exposure[leg.instrumentId];
    if (leg.buyCents > 0)
      exposure[leg.instrumentId] = [
        ...slices,
        {
          acquiredQuarter: state.currentQuarter,
          settledExposureThroughQuarter: 0,
          valueCents: cents(leg.buyCents),
          costCents: cents(leg.buyCents + leg.feeCents),
        },
      ];
    if (leg.sellCents > 0) {
      const proceeds = allocateDisposalCents(
        cents(leg.sellCents),
        slices.map((slice) => slice.valueCents),
      );
      const costs = allocateDisposalCents(
        cents(leg.removedBasisCents),
        slices.map((slice) => slice.costCents),
      );
      const fees = allocateDisposalCents(cents(leg.feeCents), proceeds);
      exposure[leg.instrumentId] = slices
        .map((slice, index) => ({
          ...slice,
          valueCents: cents(slice.valueCents - proceeds[index]!),
          costCents: cents(slice.costCents - costs[index]!),
        }))
        .filter((slice) => slice.valueCents > 0 || slice.costCents > 0);
      slices.forEach((slice, index) => {
        if (proceeds[index] === 0 && costs[index] === 0) return;
        disposalEvidence.push({
          disposalId: `market:${state.revision + 1}:${actorPlayerId}:${leg.instrumentId}:${index}`,
          transactionId: `market:${state.revision + 1}:${actorPlayerId}`,
          underlyingAssetId: leg.instrumentId,
          category: "public-markets",
          counterparty: { kind: "non-player", id: "public-market" },
          acquiredQuarter: slice.acquiredQuarter,
          settledExposureThroughQuarter: slice.settledExposureThroughQuarter,
          soldQuarter: state.currentQuarter,
          proceedsCents: proceeds[index]!,
          saleFeesCents: fees[index]!,
          acquisitionBasisCents: costs[index]!,
          referenceProceedsCents: null,
          economicSubstance: "genuine",
          ownershipUnits: Math.max(proceeds[index]!, costs[index]!),
        });
      });
    }
    if (leg.sellCents > 0)
      publicMarketDisposals.push({
        instrumentId: leg.instrumentId,
        soldQuarter: state.currentQuarter,
        tradeValueCents: cents(leg.sellCents),
        feeCents: cents(leg.feeCents),
        removedBasisCents: cents(leg.removedBasisCents),
        realizedGainCents: cents(leg.realizedGainCents),
        quarterStartValueCents:
          state.finance.quarterStartBasis.publicMarketsByPlayer[actorPlayerId]![
            leg.instrumentId
          ],
      });
  }
  const draft: GameState = {
    ...state,
    counters,
    finance: {
      ...finance,
      publicMarketsByPlayer: {
        ...finance.publicMarketsByPlayer,
        [actorPlayerId]: portfolio,
      },
    },
    progress: {
      ...state.progress,
      byPlayer: {
        ...state.progress.byPlayer,
        [actorPlayerId]: {
          ...progress,
          publicMarketBasis,
          publicMarketExposure: exposure,
          disposalEvidence,
          publicMarketDisposals,
          realizedGainsCents: cents(safeInteger(gain)),
        },
      },
    },
  };
  if (finalize) {
    const postedTotal = (reason: string) =>
      cents(
        journalEntries.reduce(
          (sum, entry) =>
            sum + (entry.reason === reason ? entry.amountCents : 0),
          0,
        ),
      );
    const finished = finalize({
      before: state,
      draft,
      actorPlayerId,
      journalEntries,
      facts: {
        kind: "public-market-trade",
        purchasedCents: postedTotal("public-market-purchase"),
        soldCents: postedTotal("public-market-sale"),
      },
    });
    return finished.ok ? finished : reject(finished.code);
  }
  const advanced = advanceSpotlight(draft, actorPlayerId);
  if (!advanced.ok) return reject(advanced.code);
  return {
    ...advanced,
    journalEntries: [...journalEntries, ...advanced.journalEntries],
  };
}
