import type { PlayerId } from "@interests/shared";
import { allocateDisposalCents } from "../finance/disposalEvidence";
import { cents } from "../finance/money";
import type { GameState } from "../model/gameState";
import type { ObjectiveEvidence, ObjectiveFinancingEvidence } from "./model";

/** Internal canonical adapters. No command payload or network-supplied evidence enters here. */
export function collectPlayerObjectiveEvidence(
  state: GameState,
  playerId: PlayerId,
): ObjectiveEvidence {
  if (!state.players[playerId])
    throw new Error("Unknown objective evidence player");
  const propertyClaims = Object.values(state.finance.assetsById)
    .filter(
      (asset) =>
        asset.kind === "property" &&
        asset.disposition !== "sold" &&
        (asset.ownershipByPlayerPpm[playerId] ?? 0) > 0,
    )
    .map((asset) => {
      if (asset.kind !== "property") throw new Error("Expected property");
      const loans = Object.values(state.finance.loansById).filter(
        (loan) =>
          loan.kind === "asset-bank-loan" && loan.borrowerAssetId === asset.id,
      );
      return {
        assetId: asset.id,
        cashReserveCents: asset.cashCents ?? cents(0),
        principalCents: cents(
          loans.reduce((sum, loan) => sum + loan.outstandingPrincipalCents, 0),
        ),
        unpaidInterestCents: cents(
          loans.reduce((sum, loan) => sum + loan.unpaidInterestCents, 0),
        ),
        pastDuePrincipalCents: cents(
          loans.reduce((sum, loan) => sum + loan.pastDuePrincipalCents, 0),
        ),
        operatingArrearsCents: cents(0),
      };
    });
  const financing: ObjectiveFinancingEvidence[] = [];
  for (const loan of Object.values(state.finance.loansById)) {
    if (
      loan.kind !== "player-loan" ||
      loan.lenderPlayerId !== playerId ||
      loan.fundedTransactionId === undefined
    )
      continue;
    if (loan.settledInterestReceipts === undefined)
      throw new Error("Missing canonical funded-loan interest history");
    financing.push({
      loanId: loan.id,
      lenderPlayerId: loan.lenderPlayerId,
      beneficialBorrowerId: loan.borrowerPlayerId,
      fundedTransactionId: loan.fundedTransactionId,
      originatedQuarter: loan.originatedQuarter,
      fundedPrincipalCents: loan.originalPrincipalCents,
      outstandingPrincipalCents: loan.outstandingPrincipalCents,
      unpaidInterestCents: loan.unpaidInterestCents,
      pastDuePrincipalCents: loan.pastDuePrincipalCents,
      // This ID is created only by a confirmed, cash-funded transaction close, not a standalone loan request.
      funding: "non-circular",
      feesPaidCents: cents(0),
      realizedLossesCents: cents(0),
      interestReceipts: loan.settledInterestReceipts
        .filter((receipt) => receipt.quarter <= state.lastSettledQuarter)
        .map((receipt) => ({ ...receipt })),
    });
  }
  const records = state.progress.byPlayer[playerId]!.disposalEvidence;
  const returns = new Map<string, number>();
  for (const progress of Object.values(state.progress.byPlayer))
    for (const record of progress.disposalEvidence ?? [])
      for (const returned of record.circularReturns ?? [])
        returns.set(
          returned.disposalId,
          (returns.get(returned.disposalId) ?? 0) + returned.ownershipUnits,
        );
  const entries = records?.flatMap((record) => {
    const circular = Math.min(
      record.ownershipUnits,
      returns.get(record.disposalId) ?? 0,
    );
    if (circular === 0) return [record];
    const weights = [record.ownershipUnits - circular, circular];
    const amounts = [
      record.proceedsCents,
      record.saleFeesCents,
      record.acquisitionBasisCents,
      record.assetCashReleasedCents ?? cents(0),
      record.financingCostsCents ?? cents(0),
    ].map((amount) => allocateDisposalCents(amount, weights));
    const references =
      record.referenceProceedsCents === null
        ? null
        : allocateDisposalCents(record.referenceProceedsCents, weights);
    return weights.flatMap((weight, index) =>
      weight === 0
        ? []
        : [
            {
              ...record,
              disposalId: `${record.disposalId}:${index}`,
              ownershipUnits: weight,
              proceedsCents: amounts[0]![index]!,
              saleFeesCents: amounts[1]![index]!,
              acquisitionBasisCents: amounts[2]![index]!,
              assetCashReleasedCents: amounts[3]![index]!,
              financingCostsCents: amounts[4]![index]!,
              referenceProceedsCents: references?.[index] ?? null,
              economicSubstance:
                index === 1 ? ("circular" as const) : record.economicSubstance,
            },
          ],
    );
  });
  return {
    propertyClaims,
    financing,
    ...(entries
      ? { disposalLedger: { throughRevision: state.revision, entries } }
      : {}),
  };
}

/** Optional future NPC adapters cannot replace current canonical property, player-loan or disposal records. */
export function combineObjectiveEvidence(
  state: GameState,
  playerId: PlayerId,
  additional: ObjectiveEvidence,
): ObjectiveEvidence {
  const canonical = collectPlayerObjectiveEvidence(state, playerId);
  if (canonical.disposalLedger && additional.disposalLedger)
    throw new Error("Canonical disposal ledger cannot be overridden");
  if (additional.propertyClaims?.length)
    throw new Error("Canonical property claims cannot be overridden");
  if (
    additional.financing?.some((loan) =>
      Object.hasOwn(state.finance.loansById, loan.loanId),
    )
  )
    throw new Error("Canonical player loan evidence cannot be overridden");
  return {
    propertyClaims: canonical.propertyClaims,
    financing: [
      ...(canonical.financing ?? []),
      ...(additional.financing ?? []),
    ],
    ...((canonical.disposalLedger ?? additional.disposalLedger)
      ? {
          disposalLedger: canonical.disposalLedger ?? additional.disposalLedger,
        }
      : {}),
  };
}
