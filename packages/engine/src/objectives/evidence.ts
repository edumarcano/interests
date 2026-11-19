import type { PlayerId } from "@interests/shared";
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
  return { propertyClaims, financing };
}

/** Optional future NPC/disposal adapters can add facts, but cannot replace live property or player-loan records. */
export function combineObjectiveEvidence(
  state: GameState,
  playerId: PlayerId,
  additional: ObjectiveEvidence,
): ObjectiveEvidence {
  const canonical = collectPlayerObjectiveEvidence(state, playerId);
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
    ...(additional.disposalLedger
      ? { disposalLedger: additional.disposalLedger }
      : {}),
  };
}
