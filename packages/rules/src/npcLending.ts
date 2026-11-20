import { type BANK_CREDIT_GRADES, OBJECTIVE_TARGETS } from "./completion";

type MarketCreditGrade = (typeof BANK_CREDIT_GRADES)[number]["id"];
interface MarketBorrowerTemplate {
  readonly cardTemplateId: string;
  readonly borrowerId: string;
  readonly name: string;
  readonly principalCents: number;
  readonly creditGrade: MarketCreditGrade;
  readonly termQuarters: number;
  readonly quarterlyRepaymentCapacityCents: number;
  readonly size: "small" | "medium" | "large";
}

/** Standing purchase-order borrower offered privately only as a qualified finale. */
export const FINANCIER_FINALE_BORROWER = Object.freeze({
  cardTemplateId: "equipment-renewal-finale",
  borrowerId: "equipment-renewal-project",
  name: "Equipment renewal project",
  principalCents: OBJECTIVE_TARGETS.financier.finalePrincipalCents,
  creditGrade: "good",
  termQuarters: 6,
  quarterlyRepaymentCapacityCents: 3_000_000,
  size: "large",
} as const satisfies MarketBorrowerTemplate);

/** Prototype borrowers within the authored financing bands; these are not balance findings. */
export const MARKET_BORROWER_TEMPLATES: readonly MarketBorrowerTemplate[] =
  Object.freeze(
    (
      [
        {
          cardTemplateId: "working-capital-loan",
          borrowerId: "local-supplier",
          name: "Local supplier",
          principalCents: 1_000_000,
          creditGrade: "excellent",
          termQuarters: 4,
          quarterlyRepaymentCapacityCents: 300_000,
          size: "small",
        },
        {
          cardTemplateId: "supplier-equipment-loan",
          borrowerId: "equipment-supplier",
          name: "Equipment supplier",
          principalCents: 6_000_000,
          creditGrade: "good",
          termQuarters: 6,
          quarterlyRepaymentCapacityCents: 1_300_000,
          size: "medium",
        },
        {
          cardTemplateId: "seasonal-freight-loan",
          borrowerId: "freight-operator",
          name: "Seasonal freight operator",
          principalCents: 12_000_000,
          creditGrade: "limited",
          termQuarters: 6,
          quarterlyRepaymentCapacityCents: 2_100_000,
          size: "medium",
        },
        {
          cardTemplateId: "regional-distribution-loan",
          borrowerId: "regional-distributor",
          name: "Regional distributor",
          principalCents: 18_000_000,
          creditGrade: "moderate",
          termQuarters: 8,
          quarterlyRepaymentCapacityCents: 2_800_000,
          size: "large",
        },
        {
          cardTemplateId: "commercial-service-loan",
          borrowerId: "commercial-services",
          name: "Commercial services company",
          principalCents: 30_000_000,
          creditGrade: "moderate",
          termQuarters: 8,
          quarterlyRepaymentCapacityCents: 4_500_000,
          size: "large",
        },
      ] as const satisfies readonly MarketBorrowerTemplate[]
    ).map((template) => Object.freeze(template)),
  );
