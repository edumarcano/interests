import {
  getCompatibility,
  isPairValid,
  OBJECTIVE_IDS,
  OBJECTIVES,
  type ObjectiveId,
  PROFILE_IDS,
  type ProfileId,
} from "@interests/rules";
import type { PlayerId } from "@interests/shared";
import { drawBoundedInt, type RandomState } from "../random/prng";

export type ProfileCombination = readonly [
  ProfileId,
  ProfileId,
  ProfileId,
  ProfileId,
];

export type ObjectivePair = readonly [ObjectiveId, ObjectiveId];

export type DealAllocation = readonly [
  ObjectivePair,
  ObjectivePair,
  ObjectivePair,
  ObjectivePair,
];

export interface ScoredDeal {
  readonly allocation: DealAllocation;
  readonly score: number;
}

export interface SetupResult {
  readonly profileAssignments: Readonly<Record<PlayerId, ProfileId>>;
  readonly objectiveOffers: Readonly<Record<PlayerId, ObjectivePair>>;
  readonly random: RandomState;
}

/**
 * Score a valid pair of objectives for an assigned profile.
 * - +1 if the two objectives belong to different strategic families.
 * - +1 if the pair offers contrast (one Strong fit and one Viable alternative).
 */
export function scoreObjectivePair(
  profileId: ProfileId,
  firstObjectiveId: ObjectiveId,
  secondObjectiveId: ObjectiveId,
): number {
  let score = 0;
  if (
    OBJECTIVES[firstObjectiveId].family !== OBJECTIVES[secondObjectiveId].family
  ) {
    score += 1;
  }
  const firstFit = getCompatibility(profileId, firstObjectiveId);
  const secondFit = getCompatibility(profileId, secondObjectiveId);
  if (
    (firstFit === "S" && secondFit === "V") ||
    (firstFit === "V" && secondFit === "S")
  ) {
    score += 1;
  }
  return score;
}

/**
 * Generate all pairs of objectives valid for a given profile.
 * A pair is valid iff neither objective is Stretch ('T') and at least one is Strong ('S').
 */
export function getValidPairsForProfile(
  profileId: ProfileId,
): readonly ObjectivePair[] {
  const validPairs: ObjectivePair[] = [];
  for (let i = 0; i < OBJECTIVE_IDS.length; i += 1) {
    for (let j = i + 1; j < OBJECTIVE_IDS.length; j += 1) {
      const first = OBJECTIVE_IDS[i];
      const second = OBJECTIVE_IDS[j];
      if (first !== undefined && second !== undefined) {
        if (isPairValid(profileId, first, second)) {
          validPairs.push([first, second]);
        }
      }
    }
  }
  return validPairs;
}

/**
 * Find all valid 8-objective partitions across 4 assigned profiles and score them.
 */
export function generateValidDeals(
  assignedProfiles: readonly [ProfileId, ProfileId, ProfileId, ProfileId],
): readonly ScoredDeal[] {
  const [prof0, prof1, prof2, prof3] = assignedProfiles;
  const pairs0 = getValidPairsForProfile(prof0);
  const pairs1 = getValidPairsForProfile(prof1);
  const pairs2 = getValidPairsForProfile(prof2);

  const deals: ScoredDeal[] = [];

  for (const p0 of pairs0) {
    const rem0 = OBJECTIVE_IDS.filter((o) => !p0.includes(o));

    for (const p1 of pairs1) {
      if (!rem0.includes(p1[0]) || !rem0.includes(p1[1])) {
        continue;
      }
      const rem1 = rem0.filter((o) => !p1.includes(o));

      for (const p2 of pairs2) {
        if (!rem1.includes(p2[0]) || !rem1.includes(p2[1])) {
          continue;
        }
        const rem2 = rem1.filter((o) => !p2.includes(o));
        if (rem2.length !== 2) {
          continue;
        }
        const rem2First = rem2[0];
        const rem2Second = rem2[1];
        if (rem2First === undefined || rem2Second === undefined) {
          continue;
        }
        const p3: ObjectivePair = [rem2First, rem2Second];

        if (isPairValid(prof3, p3[0], p3[1])) {
          const allocation: DealAllocation = [p0, p1, p2, p3];
          const score =
            scoreObjectivePair(prof0, p0[0], p0[1]) +
            scoreObjectivePair(prof1, p1[0], p1[1]) +
            scoreObjectivePair(prof2, p2[0], p2[1]) +
            scoreObjectivePair(prof3, p3[0], p3[1]);
          deals.push({ allocation, score });
        }
      }
    }
  }

  return deals;
}

/**
 * Check if a 4-profile combination can support at least one valid objective deal.
 */
export function isProfileCombinationFeasible(
  combination: ProfileCombination,
): boolean {
  return generateValidDeals(combination).length > 0;
}

function computeFeasibleProfileCombinations(): readonly ProfileCombination[] {
  const feasible: ProfileCombination[] = [];
  const total = PROFILE_IDS.length;
  for (let i = 0; i < total; i += 1) {
    for (let j = i + 1; j < total; j += 1) {
      for (let k = j + 1; k < total; k += 1) {
        for (let l = k + 1; l < total; l += 1) {
          const p0 = PROFILE_IDS[i];
          const p1 = PROFILE_IDS[j];
          const p2 = PROFILE_IDS[k];
          const p3 = PROFILE_IDS[l];
          if (
            p0 !== undefined &&
            p1 !== undefined &&
            p2 !== undefined &&
            p3 !== undefined
          ) {
            const combo: ProfileCombination = [p0, p1, p2, p3];
            if (isProfileCombinationFeasible(combo)) {
              feasible.push(combo);
            }
          }
        }
      }
    }
  }
  return feasible;
}

export const FEASIBLE_PROFILE_COMBINATIONS: readonly ProfileCombination[] =
  computeFeasibleProfileCombinations();

/**
 * Perform deterministic setup generation for 4 players:
 * 1. Randomly select 4 unique starting profiles from feasible combinations using unbiased bounded draw.
 * 2. Assign the 4 profiles to player seats using deterministic Fisher-Yates shuffle with unbiased bounded draw.
 * 3. Generate candidate objective allocations, score them, and filter to the high-quality subset (score >= maxScore - 1).
 * 4. Randomly choose 1 deal from the high-quality subset using unbiased bounded draw.
 */
export function generateDeterministicSetup(
  playerOrder: readonly PlayerId[],
  initialRandom: RandomState,
): SetupResult {
  if (playerOrder.length !== 4) {
    throw new RangeError(
      `Standard V1 requires exactly 4 players, got ${playerOrder.length}`,
    );
  }

  let currentRandom = initialRandom;

  // 1. Select 1 of the 69 feasible 4-profile combinations via unbiased rejection sampling
  const comboDraw = drawBoundedInt(
    currentRandom,
    FEASIBLE_PROFILE_COMBINATIONS.length,
  );
  currentRandom = comboDraw.nextState;
  const selectedCombo = FEASIBLE_PROFILE_COMBINATIONS[comboDraw.value];
  if (selectedCombo === undefined) {
    throw new Error("Setup failed: unable to select profile combination");
  }

  // 2. Deterministically shuffle profile assignments across the 4 player seats via Fisher-Yates
  const profilesToAssign: ProfileId[] = [...selectedCombo];
  for (let i = profilesToAssign.length - 1; i > 0; i -= 1) {
    const shuffleDraw = drawBoundedInt(currentRandom, i + 1);
    currentRandom = shuffleDraw.nextState;
    const j = shuffleDraw.value;
    const currentProfile = profilesToAssign[i];
    const targetProfile = profilesToAssign[j];
    if (currentProfile === undefined || targetProfile === undefined) {
      throw new Error("Setup failed: profile shuffle index out of bounds");
    }
    profilesToAssign[i] = targetProfile;
    profilesToAssign[j] = currentProfile;
  }

  const p0 = profilesToAssign[0];
  const p1 = profilesToAssign[1];
  const p2 = profilesToAssign[2];
  const p3 = profilesToAssign[3];
  if (
    p0 === undefined ||
    p1 === undefined ||
    p2 === undefined ||
    p3 === undefined
  ) {
    throw new Error("Setup failed: missing assigned profile");
  }
  const assignedProfilesTuple: readonly [
    ProfileId,
    ProfileId,
    ProfileId,
    ProfileId,
  ] = [p0, p1, p2, p3];

  // 3. Generate candidate deals and identify the high-quality subset (deal.score >= maxScore - 1)
  const validDeals = generateValidDeals(assignedProfilesTuple);
  if (validDeals.length === 0) {
    throw new Error(
      "Setup failed: no valid objective deals for feasible profile combination",
    );
  }

  let maxScore = -1;
  for (const deal of validDeals) {
    if (deal.score > maxScore) {
      maxScore = deal.score;
    }
  }

  const highQualitySubset = validDeals.filter(
    (deal) => deal.score >= maxScore - 1,
  );

  // 4. Randomly choose one deal from the high-quality subset via unbiased rejection sampling
  const dealDraw = drawBoundedInt(currentRandom, highQualitySubset.length);
  currentRandom = dealDraw.nextState;
  const chosenDeal = highQualitySubset[dealDraw.value];
  if (chosenDeal === undefined) {
    throw new Error(
      "Setup failed: unable to select deal from high-quality subset",
    );
  }

  const profileAssignments: Record<PlayerId, ProfileId> = {} as Record<
    PlayerId,
    ProfileId
  >;
  const objectiveOffers: Record<PlayerId, ObjectivePair> = {} as Record<
    PlayerId,
    ObjectivePair
  >;

  for (let p = 0; p < 4; p += 1) {
    const playerId = playerOrder[p];
    const assignedProfile = assignedProfilesTuple[p];
    const rawPair = chosenDeal.allocation[p];

    if (
      playerId === undefined ||
      assignedProfile === undefined ||
      rawPair === undefined
    ) {
      throw new Error(
        "Setup invariant violated: missing player, profile, or deal allocation",
      );
    }

    profileAssignments[playerId] = assignedProfile;

    // Canonicalize pair order by index in OBJECTIVE_IDS for clean deterministic presentation
    const sortedPair: ObjectivePair =
      OBJECTIVE_IDS.indexOf(rawPair[0]) <= OBJECTIVE_IDS.indexOf(rawPair[1])
        ? [rawPair[0], rawPair[1]]
        : [rawPair[1], rawPair[0]];

    objectiveOffers[playerId] = sortedPair;
  }

  return {
    profileAssignments,
    objectiveOffers,
    random: currentRandom,
  };
}
