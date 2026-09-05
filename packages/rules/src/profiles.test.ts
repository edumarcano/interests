import { describe, expect, it } from "vitest";
import { PROFILE_IDS, PROFILES, type ProfileId } from "./profiles";

const EXPECTED_SECTION_15_2_STARTING_CASH: Record<ProfileId, number> = {
  "high-income-professional": 5_000_000,
  "corporate-climber": 3_500_000,
  "disciplined-saver": 10_500_000,
  "small-business-owner": 3_000_000,
  "property-starter": 2_800_000,
  "market-investor": 2_500_000,
  "self-employed-operator": 4_000_000,
  "early-stage-entrepreneur": 2_000_000,
};

describe("profile starting cash rule data", () => {
  it("defines starting cash for all eight standard profiles", () => {
    expect(PROFILE_IDS).toHaveLength(8);
    for (const profileId of PROFILE_IDS) {
      const profile = PROFILES[profileId];
      expect(profile).toBeDefined();
      expect(profile.startingCashCents).toBeDefined();
    }
  });

  it("ensures each starting cash value is a non-negative safe integer", () => {
    for (const profileId of PROFILE_IDS) {
      const { startingCashCents } = PROFILES[profileId];
      expect(Number.isSafeInteger(startingCashCents)).toBe(true);
      expect(startingCashCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("matches GAME_DESIGN.md Section 15.2 opening balance sheet values exactly", () => {
    for (const profileId of PROFILE_IDS) {
      const { startingCashCents } = PROFILES[profileId];
      expect(startingCashCents).toBe(
        EXPECTED_SECTION_15_2_STARTING_CASH[profileId],
      );
    }
  });
});
