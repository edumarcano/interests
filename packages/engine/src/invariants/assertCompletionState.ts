import {
  isPublicMarketInstrumentId,
  OBJECTIVE_MEASUREMENT_RULES,
  PUBLIC_MARKET_INSTRUMENT_IDS,
} from "@interests/rules";
import type { PlayerId } from "@interests/shared";
import { FOCUS_AREAS } from "../model/completionState";
import type { GameState } from "../model/gameState";

function record(value: unknown): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("Invalid completion record");
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error("Invalid completion integer");
}
function keys(value: unknown, expected: readonly string[]) {
  record(value);
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((id) => !(id in value))
  )
    throw new Error("Invalid completion player keys");
}
export function assertCompletionState(state: GameState): void {
  record(state.progress);
  keys(state.progress.byPlayer, state.playerOrder);
  const prepaid = state.finance.prepaidAssetInterest;
  if (prepaid !== undefined) {
    record(prepaid);
    integer(prepaid.quarter, 1);
    if (prepaid.quarter > state.currentQuarter)
      throw new Error("Future prepaid interest evidence");
    record(prepaid.byAssetId);
    for (const [id, evidence] of Object.entries(prepaid.byAssetId)) {
      if (
        state.finance.assetsById[id as keyof typeof state.finance.assetsById]
          ?.kind !== "property"
      )
        throw new Error("Unknown prepaid property");
      record(evidence);
      integer(evidence.interestCents);
      record(evidence.ownershipByPlayerPpm);
      let total = 0;
      for (const [owner, units] of Object.entries(
        evidence.ownershipByPlayerPpm,
      )) {
        if (!state.players[owner as PlayerId])
          throw new Error("Unknown prepaid interest owner");
        integer(units, 1);
        total += units;
      }
      if (total !== 1_000_000)
        throw new Error("Invalid prepaid interest ownership");
    }
  }
  const basis = state.finance.quarterStartBasis;
  record(basis.propertiesById);
  keys(basis.recurringByPlayer, state.playerOrder);
  for (const playerId of state.playerOrder) {
    const recurring = basis.recurringByPlayer[playerId]!;
    record(recurring);
    integer(recurring.quarterlyIncomeCents);
    integer(recurring.quarterlyLivingExpenseCents);
    const progress = state.progress.byPlayer[playerId]!;
    record(progress);
    record(progress.labor);
    if (!FOCUS_AREAS.includes(progress.focus)) throw new Error("Invalid focus");
    if (progress.labor.kind === "owner-work") {
      const asset = state.finance.assetsById[progress.labor.assetId];
      if (
        asset?.kind !== "business" ||
        asset.npcSale ||
        asset.workCompensation?.playerId !== playerId
      )
        throw new Error("Invalid owner work reference");
    } else if (progress.labor.kind === "employment") {
      if (!["professional", "executive"].includes(progress.labor.role))
        throw new Error("Invalid employment role");
      if (progress.labor.ownershipPositionAssetId !== undefined) {
        const owned =
          state.finance.assetsById[progress.labor.ownershipPositionAssetId];
        if (
          progress.labor.role !== "executive" ||
          owned?.kind !== "business" ||
          !(owned.ownershipByPlayerPpm[playerId]! > 0)
        )
          throw new Error("Invalid executive ownership position");
      }
    } else if (progress.labor.kind !== "not-working")
      throw new Error("Invalid labor lifecycle");
    if (
      progress.labor.kind !== "employment" &&
      state.finance.recurringByPlayer[playerId]!.quarterlyIncomeCents !== 0
    )
      throw new Error("Inactive employment cannot earn current salary");
    for (const asset of Object.values(state.finance.assetsById)) {
      if (
        asset.kind === "business" &&
        !asset.npcSale &&
        asset.workCompensation?.playerId === playerId &&
        asset.workCompensation.annualCompensationCents > 0 &&
        (progress.labor.kind !== "owner-work" ||
          progress.labor.assetId !== asset.id)
      )
        throw new Error("Active owner work must match the single labor role");
    }
    keys(progress.publicMarketBasis, PUBLIC_MARKET_INSTRUMENT_IDS);
    for (const cost of Object.values(progress.publicMarketBasis)) integer(cost);
    record(progress.assetsById);
    for (const asset of Object.values(state.finance.assetsById)) {
      const units = asset.ownershipByPlayerPpm[playerId] ?? 0;
      if (units > 0 && progress.assetsById[asset.id]?.ownershipPpm !== units)
        throw new Error("Missing or inconsistent acquisition ownership");
    }
    for (const [id, acquisition] of Object.entries(progress.assetsById)) {
      if (
        !state.finance.assetsById[id as keyof typeof state.finance.assetsById]
      )
        throw new Error("Unknown basis asset");
      record(acquisition);
      if (
        state.finance.assetsById[id as keyof typeof state.finance.assetsById]
          ?.ownershipByPlayerPpm[playerId] !== acquisition.ownershipPpm
      )
        throw new Error(
          "Acquisition basis belongs to a different ownership stake",
        );

      if (acquisition.acquisition !== undefined) {
        const evidence = acquisition.acquisition;
        record(evidence);
        if (
          evidence.kind !== "recurring-npc" ||
          typeof evidence.opportunityId !== "string" ||
          !evidence.opportunityId ||
          typeof evidence.templateId !== "string" ||
          !evidence.templateId ||
          typeof evidence.transactionId !== "string" ||
          !evidence.transactionId
        )
          throw new Error("Invalid recurring acquisition evidence");
        for (const amount of [
          evidence.considerationCents,
          evidence.feeCents,
          evidence.bankPrincipalCents,
          evidence.reserveCents,
          evidence.buyerCashCents,
        ])
          integer(amount);
        if (evidence.buyerCashByPlayer !== undefined) {
          const contributions = evidence.buyerCashByPlayer;
          record(contributions);
          const contributors = Object.entries(contributions);
          if (
            contributors.length !== 2 ||
            contributors.some(
              ([id, cash]) =>
                !Object.hasOwn(state.players, id) ||
                !Number.isSafeInteger(cash) ||
                cash <= 0,
            ) ||
            contributors.reduce((total, [, cash]) => total + cash, 0) !==
              evidence.buyerCashCents
          )
            throw new Error("Invalid shared recurring acquisition funding");
        }
        if (
          !Number.isSafeInteger(
            evidence.considerationCents +
              evidence.feeCents +
              evidence.reserveCents,
          ) ||
          evidence.considerationCents +
            evidence.feeCents +
            evidence.reserveCents !==
            evidence.buyerCashCents + evidence.bankPrincipalCents
        )
          throw new Error("Unreconciled recurring acquisition funding");
      }
      integer(acquisition.costCents);
      integer(acquisition.acquiredQuarter);
      integer(acquisition.ownershipPpm, 1);
      if (
        acquisition.acquiredQuarter > state.currentQuarter ||
        acquisition.ownershipPpm > 1_000_000
      )
        throw new Error("Invalid acquisition basis");
      if (acquisition.slices !== undefined) {
        if (
          !Array.isArray(acquisition.slices) ||
          acquisition.slices.length === 0
        )
          throw new Error("Invalid acquisition slices");
        let cost = 0;
        let units = 0;
        let quarter = 0;
        for (const slice of acquisition.slices) {
          record(slice);
          integer(slice.costCents);
          integer(slice.ownershipPpm, 1);
          integer(slice.acquiredQuarter, quarter);
          cost += slice.costCents;
          units += slice.ownershipPpm;
          quarter = slice.acquiredQuarter;
          if (cost > acquisition.costCents || units > acquisition.ownershipPpm)
            throw new Error("Acquisition slices exceed basis");
        }
        if (
          cost !== acquisition.costCents ||
          units !== acquisition.ownershipPpm ||
          quarter !== acquisition.acquiredQuarter
        )
          throw new Error("Acquisition slices do not reconcile");
      }
    }
    integer(progress.realizedGainsCents, -Number.MAX_SAFE_INTEGER);
    integer(progress.financingInterestReceivedCents);
    if (!Array.isArray(progress.publicMarketDisposals))
      throw new Error("Invalid market disposal evidence");
    for (const disposal of progress.publicMarketDisposals) {
      record(disposal);
      if (!isPublicMarketInstrumentId(disposal.instrumentId))
        throw new Error("Invalid market disposal instrument");
      integer(disposal.soldQuarter, 1);
      if (disposal.soldQuarter > state.currentQuarter)
        throw new Error("Invalid market disposal quarter");
      integer(disposal.tradeValueCents, 1);
      integer(disposal.feeCents);
      integer(disposal.removedBasisCents);
      integer(disposal.quarterStartValueCents);
      integer(disposal.realizedGainCents, -Number.MAX_SAFE_INTEGER);
      if (
        disposal.realizedGainCents !==
        disposal.tradeValueCents -
          disposal.feeCents -
          disposal.removedBasisCents
      )
        throw new Error("Invalid market disposal gain");
    }
    if (!Array.isArray(progress.disposals))
      throw new Error("Invalid disposal evidence");
    for (const disposal of progress.disposals) {
      record(disposal);
      if (disposal.category !== "business" && disposal.category !== "property")
        throw new Error("Invalid disposal category");
      if (
        typeof disposal.assetId !== "string" ||
        (disposal.counterpartyPlayerId !== null &&
          !state.players[disposal.counterpartyPlayerId as PlayerId])
      )
        throw new Error("Invalid disposal parties");
      integer(disposal.acquiredQuarter);
      integer(disposal.soldQuarter, 1);
      integer(disposal.proceedsCents);
      integer(disposal.costCents);
      integer(disposal.referenceEquityCents, -Number.MAX_SAFE_INTEGER);
      if (
        disposal.transactionId !== undefined ||
        disposal.grossProceedsCents !== undefined
      ) {
        if (
          typeof disposal.transactionId !== "string" ||
          !/^transaction-[1-9]\d*$/.test(disposal.transactionId)
        )
          throw new Error("Invalid disposal transaction ID");
        integer(disposal.grossProceedsCents, disposal.proceedsCents);
      }
      if (
        disposal.acquiredQuarter > disposal.soldQuarter ||
        disposal.soldQuarter > state.currentQuarter
      )
        throw new Error("Invalid disposal timing");
    }
    if (
      !Array.isArray(progress.profitableDisposalAssetIds) ||
      progress.profitableDisposalAssetIds.some((id) => typeof id !== "string")
    )
      throw new Error("Invalid disposal history");
    if (
      !Array.isArray(progress.quarters) ||
      progress.quarters.length !==
        Math.min(
          state.lastSettledQuarter,
          OBJECTIVE_MEASUREMENT_RULES.lookbackQuarters,
        )
    )
      throw new Error("Invalid observation horizon");
    progress.quarters.forEach((observation, index) => {
      record(observation);
      if (
        observation.quarter !==
        state.lastSettledQuarter - progress.quarters.length + index + 1
      )
        throw new Error("Invalid observation sequence");
      for (const key of [
        "employmentIncomeCents",
        "workIncomeCents",
        "recurringWorkIncomeCents",
        "livingCostOwedCents",
        "debtServiceOwedCents",
        "debtServicePaidCents",
      ] as const)
        integer(observation[key]);
      integer(observation.recurringWorkIncomeCents);
      integer(observation.workIncomeCents);
      integer(observation.debtServicePaidCents);
      integer(observation.debtServiceOwedCents);
      if (
        observation.recurringWorkIncomeCents > observation.workIncomeCents ||
        observation.debtServicePaidCents > observation.debtServiceOwedCents
      )
        throw new Error("Invalid observation receipts");
      record(observation.sourcesById);
      for (const source of Object.values(observation.sourcesById)) {
        record(source);
        if (
          ![
            "cash",
            "public-markets",
            "property",
            "business",
            "financing",
          ].includes(source.category as string)
        )
          throw new Error("Invalid income category");
        integer(source.recurringReceivedCents);
        integer(source.debtServiceOwedCents);
      }
      record(observation.companyOperatingProfitById);
      for (const profit of Object.values(
        observation.companyOperatingProfitById,
      ))
        integer(profit, -Number.MAX_SAFE_INTEGER);
    });
  }
  for (const [id, property] of Object.entries(basis.propertiesById)) {
    record(property);
    if (property.id !== id || property.kind !== "property")
      throw new Error("Invalid property entitlement");
    integer(property.marketValueCents);
    integer(property.scheduledQuarterlyRentCents);
    integer(property.occupancyBps);
    integer(property.operatingExpenseRatioBps);
    if (
      property.occupancyBps > 10_000 ||
      property.operatingExpenseRatioBps > 10_000
    )
      throw new Error("Invalid property ratio");
    record(property.ownershipByPlayerPpm);
    let total = 0;
    for (const [player, units] of Object.entries(
      property.ownershipByPlayerPpm,
    )) {
      if (!state.players[player as PlayerId])
        throw new Error("Unknown property recipient");
      integer(units, 1);
      total += units as number;
    }
    if (total !== 1_000_000)
      throw new Error("Invalid property ownership total");
  }
  if (state.phase === "finished") {
    record(state.result);
    if (
      state.round !== null ||
      state.activeTransaction !== null ||
      state.playerOrder.some((id) => !state.players[id]?.selectedObjectiveId)
    )
      throw new Error("Invalid terminal lifecycle");
    integer(state.result.completedQuarter, 1);
    if (state.result.completedQuarter > state.currentQuarter)
      throw new Error("Invalid terminal quarter");
    if (state.result.kind === "objective-victory") {
      if (!state.players[state.result.winnerPlayerId])
        throw new Error("Invalid winner");
    } else if (
      state.result.kind !== "safety-draw" ||
      state.result.completedQuarter !== 32 ||
      state.lastSettledQuarter !== 32
    )
      throw new Error("Invalid safety draw");
  } else if (state.result !== null)
    throw new Error("Active match cannot have a result");
}
