import type { ObjectiveId } from "./objectives";
import type { ProfileId } from "./profiles";

export type CompatibilityRating = "S" | "V" | "T";

export const COMPATIBILITY_MATRIX: Readonly<
  Record<ProfileId, Readonly<Record<ObjectiveId, CompatibilityRating>>>
> = {
  "high-income-professional": {
    founder: "V",
    "property-magnate": "S",
    independent: "V",
    "capital-allocator": "S",
    financier: "V",
    "deal-maker": "V",
    "executive-owner": "S",
    "wealth-architect": "S",
  },
  "corporate-climber": {
    founder: "V",
    "property-magnate": "V",
    independent: "V",
    "capital-allocator": "S",
    financier: "V",
    "deal-maker": "V",
    "executive-owner": "S",
    "wealth-architect": "S",
  },
  "disciplined-saver": {
    founder: "V",
    "property-magnate": "S",
    independent: "S",
    "capital-allocator": "S",
    financier: "S",
    "deal-maker": "V",
    "executive-owner": "T",
    "wealth-architect": "S",
  },
  "small-business-owner": {
    founder: "S",
    "property-magnate": "V",
    independent: "S",
    "capital-allocator": "V",
    financier: "V",
    "deal-maker": "S",
    "executive-owner": "T",
    "wealth-architect": "V",
  },
  "property-starter": {
    founder: "V",
    "property-magnate": "S",
    independent: "S",
    "capital-allocator": "V",
    financier: "V",
    "deal-maker": "S",
    "executive-owner": "T",
    "wealth-architect": "V",
  },
  "market-investor": {
    founder: "V",
    "property-magnate": "V",
    independent: "S",
    "capital-allocator": "S",
    financier: "S",
    "deal-maker": "V",
    "executive-owner": "V",
    "wealth-architect": "S",
  },
  "self-employed-operator": {
    founder: "S",
    "property-magnate": "V",
    independent: "S",
    "capital-allocator": "V",
    financier: "V",
    "deal-maker": "V",
    "executive-owner": "V",
    "wealth-architect": "S",
  },
  "early-stage-entrepreneur": {
    founder: "S",
    "property-magnate": "T",
    independent: "V",
    "capital-allocator": "V",
    financier: "T",
    "deal-maker": "S",
    "executive-owner": "T",
    "wealth-architect": "V",
  },
};

export function getCompatibility(
  profileId: ProfileId,
  objectiveId: ObjectiveId,
): CompatibilityRating {
  return COMPATIBILITY_MATRIX[profileId][objectiveId];
}

export function isObjectiveCompatible(
  profileId: ProfileId,
  objectiveId: ObjectiveId,
): boolean {
  return getCompatibility(profileId, objectiveId) !== "T";
}

export function isPairValid(
  profileId: ProfileId,
  firstObjectiveId: ObjectiveId,
  secondObjectiveId: ObjectiveId,
): boolean {
  if (firstObjectiveId === secondObjectiveId) {
    return false;
  }
  const first = getCompatibility(profileId, firstObjectiveId);
  const second = getCompatibility(profileId, secondObjectiveId);
  if (first === "T" || second === "T") {
    return false;
  }
  return first === "S" || second === "S";
}
