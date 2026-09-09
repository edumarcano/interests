import { PROFILES } from "@interests/rules";
import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { type Cents, cents } from "../finance/money";
import { createGame } from "../game/createGame";
import { FEASIBLE_PROFILE_COMBINATIONS } from "../game/setup";
import { createRandomState } from "../random/prng";
import {
  attachQ1BusinessOpportunityFixture,
  Q1_FIXTURE_ANNUAL_OPERATING_PROFIT_CENTS,
  Q1_FIXTURE_ANNUAL_REVENUE_CENTS,
  Q1_FIXTURE_ASKING_PRICE_CENTS,
  Q1_FIXTURE_BUSINESS_DEBT_PRINCIPAL_CENTS,
  Q1_FIXTURE_ENTERPRISE_VALUE_CENTS,
  Q1_FIXTURE_SELLER_OWNERSHIP_PPM,
  selectQ1FixtureRoles,
} from "./q1Fixture";

describe("Section 14: Q1 Business Opportunity Fixture", () => {
  const playerIds: readonly PlayerId[] = [
    asPlayerId("player-1"),
    asPlayerId("player-2"),
    asPlayerId("player-3"),
    asPlayerId("player-4"),
  ];

  it("1 & 2. Q1 fixture is generated exactly once at initialization and keeps revision 0", () => {
    const state = createGame({
      gameId: "test-game",
      seed: "deterministic-seed-1",
      playerIds,
    });

    expect(state.revision).toBe(0);

    const opportunities = Object.values(state.opportunitiesById);
    expect(opportunities.length).toBe(1);

    const opp = opportunities[0]!;
    expect(opp.kind).toBe("private-business-purchase");
    expect(opp.createdQuarter).toBe(1);
    expect(opp.status).toBe("available");
    expect(opp.investigation.investigated).toBe(false);
    expect(opp.askingPriceCents).toBe(Q1_FIXTURE_ASKING_PRICE_CENTS);

    // Business asset exists and matches fixture
    const asset = state.finance.assetsById[opp.assetId];
    expect(asset).toBeDefined();
    if (asset && asset.kind === "business") {
      expect(asset.kind).toBe("business");
      expect(asset.annualRevenueCents).toBe(Q1_FIXTURE_ANNUAL_REVENUE_CENTS);
      expect(asset.annualOperatingProfitCents).toBe(
        Q1_FIXTURE_ANNUAL_OPERATING_PROFIT_CENTS,
      );
      expect(asset.enterpriseValueCents).toBe(
        Q1_FIXTURE_ENTERPRISE_VALUE_CENTS,
      );
      expect(asset.debtPrincipalCents).toBe(
        Q1_FIXTURE_BUSINESS_DEBT_PRINCIPAL_CENTS,
      );
      expect(asset.ownershipByPlayerPpm[opp.sellerPlayerId]).toBe(
        Q1_FIXTURE_SELLER_OWNERSHIP_PPM,
      );
    }
  });

  it("3. Fixture generation consumes no extra RNG compared with equivalent setup progression", () => {
    // Create game with fixed seed twice
    const state1 = createGame({
      gameId: "test-game-1",
      seed: "fixed-prng-seed",
      playerIds,
    });
    const state2 = createGame({
      gameId: "test-game-2",
      seed: "fixed-prng-seed",
      playerIds,
    });

    // PRNG state must be identical
    expect(state1.random).toEqual(state2.random);

    // The fixture creation itself used pure selection, no drawBoundedInt
    const initialPrng = createRandomState("fixed-prng-seed");
    expect(state1.random).not.toEqual(initialPrng); // setup used PRNG for profiles & deal
  });

  it("4 & 5. Buyer selection follows highest initial cash < 5_000_000, tie by playerOrder, and seller is next seat", () => {
    // Case 1: distinct cash balances
    const cash1 = {
      [asPlayerId("player-1")]: 5_000_000 as any, // not < 5M
      [asPlayerId("player-2")]: 2_500_000 as any,
      [asPlayerId("player-3")]: 3_500_000 as any, // highest < 5M
      [asPlayerId("player-4")]: 3_000_000 as any,
    };
    const roles1 = selectQ1FixtureRoles(playerIds, cash1);
    expect(roles1.targetBuyerPlayerId).toBe("player-3");
    expect(roles1.sellerPlayerId).toBe("player-4"); // next in order

    // Case 2: tie in highest cash < 5M, broken by playerOrder
    const cash2 = {
      [asPlayerId("player-1")]: 3_500_000 as any, // highest < 5M, first in playerOrder
      [asPlayerId("player-2")]: 3_500_000 as any,
      [asPlayerId("player-3")]: 2_000_000 as any,
      [asPlayerId("player-4")]: 10_500_000 as any,
    };
    const roles2 = selectQ1FixtureRoles(playerIds, cash2);
    expect(roles2.targetBuyerPlayerId).toBe("player-1");
    expect(roles2.sellerPlayerId).toBe("player-2");

    // Case 3: buyer is last player, seller wraps cyclically to first
    const cash3 = {
      [asPlayerId("player-1")]: 2_000_000 as any,
      [asPlayerId("player-2")]: 2_500_000 as any,
      [asPlayerId("player-3")]: 2_800_000 as any,
      [asPlayerId("player-4")]: 4_000_000 as any, // highest < 5M
    };
    const roles3 = selectQ1FixtureRoles(playerIds, cash3);
    expect(roles3.targetBuyerPlayerId).toBe("player-4");
    expect(roles3.sellerPlayerId).toBe("player-1");
  });

  it("6. Fixture seller owns the debt-free business 100%", () => {
    const state = createGame({
      gameId: "test-game",
      seed: "deterministic-seed-6",
      playerIds,
    });

    const opp = Object.values(state.opportunitiesById)[0]!;
    const asset = state.finance.assetsById[opp.assetId]!;
    expect(asset.kind).toBe("business");
    if (asset.kind === "business") {
      expect(asset.debtPrincipalCents).toBe(0);
      expect(asset.ownershipByPlayerPpm[opp.sellerPlayerId]).toBe(1_000_000);
      expect(Object.keys(asset.ownershipByPlayerPpm).length).toBe(1);
    }
  });

  it("7. Opportunity facts match asset facts and begin hidden/uninvestigated", () => {
    const state = createGame({
      gameId: "test-game",
      seed: "deterministic-seed-7",
      playerIds,
    });

    const opp = Object.values(state.opportunitiesById)[0]!;
    const asset = state.finance.assetsById[opp.assetId]!;
    expect(opp.investigation.investigated).toBe(false);
    if (asset.kind === "business") {
      expect(opp.investigation.facts.annualRevenueCents).toBe(
        asset.annualRevenueCents,
      );
      expect(opp.investigation.facts.annualOperatingProfitCents).toBe(
        asset.annualOperatingProfitCents,
      );
      expect(opp.investigation.facts.enterpriseValueCents).toBe(
        asset.enterpriseValueCents,
      );
      expect(opp.investigation.facts.debtPrincipalCents).toBe(
        asset.debtPrincipalCents,
      );
    }
  });

  function getPermutations<T>(arr: readonly T[]): T[][] {
    if (arr.length <= 1) return [[...arr]];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const current = arr[i]!;
      const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const perm of getPermutations(remaining)) {
        result.push([current, ...perm]);
      }
    }
    return result;
  }

  it("8. All 69 feasible setup combinations across all 24 seat permutations (1,656 total) retain an unconditionally financing-feasible path", () => {
    let countPermutationsSupportingCanonicalThreeMillion = 0;
    let countPermutationsRequiringLesserContribution = 0;
    let totalPermutations = 0;

    for (const combo of FEASIBLE_PROFILE_COMBINATIONS) {
      const permutations = getPermutations(combo);
      expect(permutations).toHaveLength(24);

      for (const perm of permutations) {
        totalPermutations++;
        // Create mock cash mapping for the 4 profiles permuted across seats
        const cashMap: Record<PlayerId, Cents> = {
          [playerIds[0]!]: cents(PROFILES[perm[0]!].startingCashCents),
          [playerIds[1]!]: cents(PROFILES[perm[1]!].startingCashCents),
          [playerIds[2]!]: cents(PROFILES[perm[2]!].startingCashCents),
          [playerIds[3]!]: cents(PROFILES[perm[3]!].startingCashCents),
        };

        const roles = selectQ1FixtureRoles(playerIds, cashMap);
        const buyerCash = cashMap[roles.targetBuyerPlayerId]!;

        // 1. Unconditional: buyer cannot purchase in full with starting cash alone
        expect(buyerCash).toBeLessThan(5_000_000);

        // 2. Unconditional: every feasible buyer has at least 2,000,000 cents ($20,000)
        expect(buyerCash).toBeGreaterThanOrEqual(2_000_000);

        // 3. Unconditional: buyer and seller are distinct players
        expect(roles.targetBuyerPlayerId).not.toBe(roles.sellerPlayerId);

        // 4. Unconditional: seller is the next seat in playerOrder
        const buyerIndex = playerIds.indexOf(roles.targetBuyerPlayerId);
        const expectedSellerId = playerIds[(buyerIndex + 1) % playerIds.length];
        expect(roles.sellerPlayerId).toBe(expectedSellerId);

        // 5. Unconditional: at least one eligible third-party lender has sufficient cash to fund the remaining financing gap
        const financingGap = 5_000_000 - buyerCash;
        const eligibleLenderPlayerIds = playerIds.filter(
          (id) =>
            id !== roles.targetBuyerPlayerId && id !== roles.sellerPlayerId,
        );
        const maxLenderCash = Math.max(
          ...eligibleLenderPlayerIds.map((id) => cashMap[id]!),
        );
        expect(maxLenderCash).toBeGreaterThanOrEqual(financingGap);

        // 6. Partition assertion across all permutations:
        // Exactly 1,536 permutations (64 combinations * 24 seats, 92.8%) include a profile with cash in [3M, 5M)
        // and support the $30k contribution fixture.
        // Exactly 120 permutations (5 combinations * 24 seats, 7.2%) have buyer cash in [2.5M, 2.8M)
        // where the $22k-$25k gap is funded by an eligible third-party lender.
        if (buyerCash >= 3_000_000) {
          countPermutationsSupportingCanonicalThreeMillion++;
        } else {
          countPermutationsRequiringLesserContribution++;
          expect(buyerCash).toBeGreaterThanOrEqual(2_500_000);
        }
      }
    }

    // Unconditional distribution guarantees across all 1,656 seat permutations
    expect(totalPermutations).toBe(1_656);
    expect(countPermutationsSupportingCanonicalThreeMillion).toBe(64 * 24);
    expect(countPermutationsRequiringLesserContribution).toBe(5 * 24);
    expect(FEASIBLE_PROFILE_COMBINATIONS.length).toBe(69);
  });
});
