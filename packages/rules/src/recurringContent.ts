import type { RecurringOpportunityFacts } from "@interests/shared";
import { RECURRING_CONTENT_RULES } from "./completion";
import { MARKET_BORROWER_TEMPLATES } from "./npcLending";
import type {
  BusinessSensitivity,
  PropertyMarketKind,
} from "./operatingEconomy";
export const RECURRING_CATEGORIES = [
  "business",
  "property",
  "career",
  "markets",
  "financing",
] as const;
export type RecurringCategory = (typeof RECURRING_CATEGORIES)[number];
export interface RecurringContentTemplate {
  readonly id: string;
  readonly name: string;
  readonly category: RecurringCategory;
  readonly intensity: "quick" | "standard" | "major";
  readonly baseWeight: number;
  readonly askingPriceCents: number;
  readonly minimumCashCents: number;
  readonly requiredOwnership?: "business" | "property";
  readonly propertyMarketKind?: PropertyMarketKind;
  readonly businessOperating?: {
    readonly sensitivity: BusinessSensitivity;
    readonly fixedAnnualLaborCostsCents: number;
  };
  readonly action:
    | "career"
    | "markets"
    | "business-management"
    | "property-management"
    | "npc-business-purchase"
    | "npc-property-purchase"
    | "npc-financing"
    | "npc-business-exit";
  readonly summary: string;
  readonly facts: RecurringOpportunityFacts | null;
}

/** Authored prototype choices; actual closing always requires its own authoritative quote. */
const templates: readonly RecurringContentTemplate[] = [
  {
    id: "independent-business-buyer",
    name: "Independent buyer for your company",
    category: "business",
    intensity: "standard",
    baseWeight: 2,
    askingPriceCents: 0,
    minimumCashCents: 0,
    requiredOwnership: "business",
    action: "npc-business-exit",
    summary:
      "A matched independent buyer makes one fixed operating-business bid. Review the exact cash, claims, sale fee and seller proceeds before accepting.",
    facts: null,
  },
  {
    id: "career-review",
    name: "Review your career options",
    category: "career",
    intensity: "quick",
    baseWeight: 12,
    askingPriceCents: 0,
    minimumCashCents: 0,
    action: "career",
    summary:
      "Compare a steady raise, promotion or a return to employment with your current role.",
    facts: null,
  },
  {
    id: "fund-allocation",
    name: "Review your fund allocation",
    category: "markets",
    intensity: "quick",
    baseWeight: 12,
    askingPriceCents: 0,
    minimumCashCents: 100,
    action: "markets",
    summary:
      "Compare cash reserves with the three public funds, their dividends and price risk.",
    facts: null,
  },
  {
    id: "company-review",
    name: "Review your company",
    category: "business",
    intensity: "quick",
    baseWeight: 8,
    askingPriceCents: 0,
    minimumCashCents: 0,
    requiredOwnership: "business",
    action: "business-management",
    summary:
      "Compare company reserves, expansion, ownership and necessary labor costs.",
    facts: null,
  },
  {
    id: "property-review",
    name: "Review your property",
    category: "property",
    intensity: "quick",
    baseWeight: 8,
    askingPriceCents: 0,
    minimumCashCents: 0,
    requiredOwnership: "property",
    action: "property-management",
    summary:
      "Compare rents, occupancy, debt service and the costs of an asset decision.",
    facts: null,
  },
  {
    id: "local-service-company",
    businessOperating: {
      sensitivity: "low",
      fixedAnnualLaborCostsCents: 6_000_000,
    },
    name: "Local service company",
    category: "business",
    intensity: "standard",
    baseWeight: 2,
    askingPriceCents: 10_000_000,
    minimumCashCents: 10_455_000,
    action: "npc-business-purchase",
    summary:
      "A managed service company is offered by an independent seller. Investigate its operating figures before committing.",
    facts: {
      kind: "business",
      annualRevenueCents: 25_000_000,
      annualOperatingProfitCents: 3_000_000,
      enterpriseValueCents: 12_000_000,
      debtPrincipalCents: 0,
    },
  },
  {
    id: "residential-rental",
    propertyMarketKind: "residential",
    name: "Residential rental",
    category: "property",
    intensity: "standard",
    baseWeight: 2,
    askingPriceCents: 15_000_000,
    minimumCashCents: 15_682_500,
    action: "npc-property-purchase",
    summary:
      "An independent seller offers a rental property. Rent, occupancy and operating costs matter alongside price.",
    facts: {
      kind: "property",
      marketValueCents: 15_500_000,
      scheduledQuarterlyRentCents: 450_000,
      occupancyBps: 9500,
      operatingExpenseRatioBps: 3500,
    },
  },
  {
    id: "residential-income-court",
    name: "Residential income court",
    category: "property",
    propertyMarketKind: "residential",
    intensity: "standard",
    baseWeight: 1,
    askingPriceCents: 65_000_000,
    minimumCashCents: 67_957_500,
    action: "npc-property-purchase",
    summary:
      "A managed residential court offers rent across multiple homes in one property. Compare its larger cash commitment with vacancy, operating costs and mortgage payments.",
    facts: {
      kind: "property",
      marketValueCents: 67_000_000,
      scheduledQuarterlyRentCents: 1_800_000,
      occupancyBps: 9500,
      operatingExpenseRatioBps: 3500,
    },
  },
  {
    id: "commercial-service-center",
    name: "Commercial service center",
    category: "property",
    propertyMarketKind: "commercial",
    intensity: "major",
    baseWeight: 1,
    askingPriceCents: 110_000_000,
    minimumCashCents: 115_005_000,
    action: "npc-property-purchase",
    summary:
      "An established commercial center concentrates several tenants in a larger property. Its rent supports a substantial financing decision, with commercial occupancy and rate exposure.",
    facts: {
      kind: "property",
      marketValueCents: 112_000_000,
      scheduledQuarterlyRentCents: 3_300_000,
      occupancyBps: 9200,
      operatingExpenseRatioBps: 3500,
    },
  },
  {
    id: "established-service-group",
    businessOperating: {
      sensitivity: "medium",
      fixedAnnualLaborCostsCents: 36_000_000,
    },
    name: "Established service group",
    category: "business",
    intensity: "standard",
    baseWeight: 1,
    askingPriceCents: 100_000_000,
    minimumCashCents: 104_550_000,
    action: "npc-business-purchase",
    summary:
      "A mature managed service group brings a larger operating income stream. Compare its after-labor profit and debt-service capacity with the capital concentrated in one company.",
    facts: {
      kind: "business",
      annualRevenueCents: 180_000_000,
      annualOperatingProfitCents: 27_000_000,
      enterpriseValueCents: 108_000_000,
      debtPrincipalCents: 0,
    },
  },
  ...MARKET_BORROWER_TEMPLATES.map(
    (borrower): RecurringContentTemplate => ({
      id: borrower.cardTemplateId,
      name: `Lend to ${borrower.name.toLowerCase()}`,
      category: "financing",
      intensity: borrower.size === "large" ? "major" : "standard",
      baseWeight: borrower.size === "small" ? 2 : 1,
      askingPriceCents: borrower.principalCents,
      minimumCashCents: Math.ceil(
        (borrower.principalCents *
          (10_000 + RECURRING_CONTENT_RULES.askingPriceVariationBps)) /
          10_000,
      ),
      action: "npc-financing",
      summary:
        "Compare fixed interest, repayment risk and how long your cash will be tied up.",
      facts: null,
    }),
  ),
  {
    id: "regional-company",
    businessOperating: {
      sensitivity: "medium",
      fixedAnnualLaborCostsCents: 18_000_000,
    },
    name: "Regional operating company",
    category: "business",
    intensity: "major",
    baseWeight: 1,
    askingPriceCents: 40_000_000,
    minimumCashCents: 41_820_000,
    action: "npc-business-purchase",
    summary:
      "A larger managed company brings operating scale and a concentrated capital commitment.",
    facts: {
      kind: "business",
      annualRevenueCents: 90_000_000,
      annualOperatingProfitCents: 10_000_000,
      enterpriseValueCents: 45_000_000,
      debtPrincipalCents: 0,
    },
  },
];

export const RECURRING_CONTENT_TEMPLATES: readonly RecurringContentTemplate[] =
  Object.freeze(
    templates.map((template) =>
      Object.freeze({
        ...template,
        ...(template.businessOperating
          ? {
              businessOperating: Object.freeze({
                ...template.businessOperating,
              }),
            }
          : {}),
        facts:
          template.facts === null ? null : Object.freeze({ ...template.facts }),
      }),
    ),
  );
