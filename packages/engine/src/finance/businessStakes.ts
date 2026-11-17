import type { PlayerId } from "@interests/shared";
import { cents } from "./money";
import {
  allocateProportionalCents,
  type OwnershipPpm,
  ownershipPpm,
  TOTAL_OWNERSHIP_PPM,
} from "./ownership";

type BusinessOwnership = Readonly<Record<PlayerId, OwnershipPpm>>;

function requirePlainRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new TypeError("Business ownership must be a plain record");
  if (Object.keys(value).some((id) => id.trim().length === 0))
    throw new RangeError("Business ownership requires nonempty player IDs");
}

function requireOwnership(ownership: BusinessOwnership): void {
  requirePlainRecord(ownership);
  allocateProportionalCents(cents(0), ownership);
}

function sortedOwnership(
  entries: readonly (readonly [PlayerId, number])[],
): BusinessOwnership {
  return Object.fromEntries(
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([playerId, units]) => [playerId, ownershipPpm(units)]),
  );
}

/** Transfer existing PPM; price, fees, authority and basis belong to the close. */
export function transferBusinessStake(
  ownershipByPlayerPpm: BusinessOwnership,
  sellerPlayerId: PlayerId,
  buyerPlayerId: PlayerId,
  transferredPpm: number,
): BusinessOwnership {
  requireOwnership(ownershipByPlayerPpm);
  if (
    typeof sellerPlayerId !== "string" ||
    sellerPlayerId.trim().length === 0 ||
    typeof buyerPlayerId !== "string" ||
    buyerPlayerId.trim().length === 0 ||
    sellerPlayerId === buyerPlayerId
  )
    throw new RangeError("A stake transfer requires two distinct player IDs");
  const sellerUnits = Object.hasOwn(ownershipByPlayerPpm, sellerPlayerId)
    ? ownershipByPlayerPpm[sellerPlayerId]
    : undefined;
  if (
    sellerUnits === undefined ||
    !Number.isSafeInteger(transferredPpm) ||
    transferredPpm <= 0 ||
    transferredPpm > sellerUnits
  )
    throw new RangeError(
      "Transferred PPM must be positive and owned by the seller",
    );
  const buyerUnits = Object.hasOwn(ownershipByPlayerPpm, buyerPlayerId)
    ? (ownershipByPlayerPpm[buyerPlayerId] ?? 0)
    : 0;
  const retained: (readonly [PlayerId, number])[] = Object.entries(
    ownershipByPlayerPpm,
  )
    .filter(([id]) => id !== sellerPlayerId && id !== buyerPlayerId)
    .map(([id, units]) => [id as PlayerId, units] as const);
  if (sellerUnits > transferredPpm)
    retained.push([sellerPlayerId, sellerUnits - transferredPpm]);
  retained.push([buyerPlayerId, buyerUnits + transferredPpm]);
  const result = sortedOwnership(retained);
  requireOwnership(result);
  return result;
}

/**
 * Grants are explicit post-issuance PPM. Apportion the unissued remainder among
 * existing owners before adding grants, including grants to an existing owner.
 */
export function diluteBusinessOwnership(
  ownershipByPlayerPpm: BusinessOwnership,
  issuedOwnershipByInvestorPpm: Readonly<Record<PlayerId, number>>,
): BusinessOwnership {
  requireOwnership(ownershipByPlayerPpm);
  requirePlainRecord(issuedOwnershipByInvestorPpm);
  let issuedTotal = 0;
  for (const units of Object.values(issuedOwnershipByInvestorPpm)) {
    if (
      !Number.isSafeInteger(units) ||
      units <= 0 ||
      units >= TOTAL_OWNERSHIP_PPM
    )
      throw new RangeError(
        "Each issuance grant must be positive representable PPM",
      );
    if (units >= TOTAL_OWNERSHIP_PPM - issuedTotal)
      throw new RangeError(
        "Issuance must leave representable ownership for existing owners",
      );
    issuedTotal += units;
  }
  if (issuedTotal === 0)
    throw new RangeError("Issuance requires at least one grant");
  // The existing allocator apportions whole integer units with canonical ties.
  const retained = allocateProportionalCents(
    cents(TOTAL_OWNERSHIP_PPM - issuedTotal),
    ownershipByPlayerPpm,
  );
  if (Object.values(retained).some((units) => units === 0))
    throw new RangeError(
      "Issuance would erase an existing owner's residual interest",
    );
  const players = new Set([
    ...Object.keys(ownershipByPlayerPpm),
    ...Object.keys(issuedOwnershipByInvestorPpm),
  ]);
  const result = sortedOwnership(
    [...players].map((id) => {
      const playerId = id as PlayerId;
      const grant = Object.hasOwn(issuedOwnershipByInvestorPpm, playerId)
        ? (issuedOwnershipByInvestorPpm[playerId] ?? 0)
        : 0;
      const previous = Object.hasOwn(retained, playerId)
        ? (retained[playerId] ?? 0)
        : 0;
      return [playerId, previous + grant];
    }),
  );
  requireOwnership(result);
  return result;
}
