import { describe, expect, it } from "vitest";
import { RECURRING_CONTENT_RULES } from "./completion";
import { RECURRING_CONTENT_TEMPLATES } from "./recurringContent";

const largerIds = [
  "residential-income-court",
  "commercial-service-center",
  "established-service-group",
];
describe("authored larger recurring acquisitions", () => {
  it("keeps residential landmark consideration above $600k at every existing price variation", () => {
    const listing = RECURRING_CONTENT_TEMPLATES.find(
      (item) => item.id === "residential-income-court",
    )!;
    const minimum =
      (listing.askingPriceCents *
        (10_000 - RECURRING_CONTENT_RULES.askingPriceVariationBps)) /
      10_000;
    const maximum =
      (listing.askingPriceCents *
        (10_000 + RECURRING_CONTENT_RULES.askingPriceVariationBps)) /
      10_000;
    expect(minimum).toBe(63_375_000);
    expect(minimum).toBeGreaterThanOrEqual(60_000_000);
    expect(maximum).toBeLessThanOrEqual(90_000_000);
    expect(listing.propertyMarketKind).toBe("residential");
  });
  it("keeps property rent, occupancy, costs and bounded prices in their accepted type/scale bands", () => {
    for (const id of largerIds.slice(0, 2)) {
      const listing = RECURRING_CONTENT_TEMPLATES.find(
        (item) => item.id === id,
      )!;
      if (listing.facts?.kind !== "property")
        throw new Error("Expected property template");
      const commercial = listing.propertyMarketKind === "commercial";
      const facts = listing.facts;
      const annualRentBps =
        (facts.scheduledQuarterlyRentCents * 4 * 10_000) /
        facts.marketValueCents;
      expect(annualRentBps).toBeGreaterThanOrEqual(commercial ? 1000 : 900);
      expect(annualRentBps).toBeLessThanOrEqual(commercial ? 1350 : 1200);
      expect(facts.occupancyBps).toBeGreaterThanOrEqual(
        commercial ? 8000 : 8800,
      );
      expect(facts.occupancyBps).toBeLessThanOrEqual(10_000);
      expect(facts.operatingExpenseRatioBps).toBeGreaterThanOrEqual(3000);
      expect(facts.operatingExpenseRatioBps).toBeLessThanOrEqual(
        commercial ? 4800 : 4500,
      );
      const lowPrice =
        (listing.askingPriceCents *
          (10_000 - RECURRING_CONTENT_RULES.askingPriceVariationBps)) /
        10_000;
      const highPrice =
        (listing.askingPriceCents *
          (10_000 + RECURRING_CONTENT_RULES.askingPriceVariationBps)) /
        10_000;
      expect(lowPrice).toBeGreaterThanOrEqual(
        commercial ? 90_000_000 : 35_000_000,
      );
      expect(highPrice).toBeLessThanOrEqual(
        commercial ? 250_000_000 : 90_000_000,
      );
    }
    expect(
      RECURRING_CONTENT_TEMPLATES.filter(
        (item) => item.facts?.kind === "property",
      ).every((item) => item.propertyMarketKind),
    ).toBe(true);
  });
  it("keeps the managed group above $250k after-labor profit and within mature-company margin/multiple bands", () => {
    const listing = RECURRING_CONTENT_TEMPLATES.find(
      (item) => item.id === "established-service-group",
    )!;
    if (listing.facts?.kind !== "business")
      throw new Error("Expected business template");
    const facts = listing.facts;
    for (const direction of [-1, 1]) {
      const profit =
        (facts.annualOperatingProfitCents *
          (10_000 +
            direction * RECURRING_CONTENT_RULES.businessProfitVariationBps)) /
        10_000;
      expect(profit).toBeGreaterThanOrEqual(25_000_000);
      expect(profit * 10_000).toBeGreaterThanOrEqual(
        facts.annualRevenueCents * 1000,
      );
      expect(profit * 10_000).toBeLessThanOrEqual(
        facts.annualRevenueCents * 2200,
      );
      expect(facts.enterpriseValueCents).toBeGreaterThanOrEqual(profit * 3);
      expect(facts.enterpriseValueCents).toBeLessThanOrEqual(profit * 5);
    }
    expect(listing.askingPriceCents).toBeGreaterThanOrEqual(90_000_000);
    expect(listing.askingPriceCents).toBeLessThanOrEqual(125_000_000);
    expect(listing.propertyMarketKind).toBeUndefined();
  });
  it("authors use and tradeoffs without naming hidden objectives or pretending to establish balance", () => {
    for (const id of largerIds) {
      const listing = RECURRING_CONTENT_TEMPLATES.find(
        (item) => item.id === id,
      )!;
      expect(listing.summary).not.toMatch(
        /founder|magnate|objective|finale|win|balanced/i,
      );
      expect(Object.isFrozen(listing)).toBe(true);
      expect(Object.isFrozen(listing.facts)).toBe(true);
      expect(listing.baseWeight).toBe(1);
    }
  });
});
