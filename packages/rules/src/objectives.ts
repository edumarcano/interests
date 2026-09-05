export const OBJECTIVE_FAMILIES = [
  "builders",
  "capital",
  "life-career",
  "transactions-generalist",
] as const;

export type ObjectiveFamily = (typeof OBJECTIVE_FAMILIES)[number];

export const OBJECTIVE_IDS = [
  "founder",
  "property-magnate",
  "independent",
  "capital-allocator",
  "financier",
  "deal-maker",
  "executive-owner",
  "wealth-architect",
] as const;

export type ObjectiveId = (typeof OBJECTIVE_IDS)[number];

export interface ObjectiveDefinition {
  readonly id: ObjectiveId;
  readonly name: string;
  readonly family: ObjectiveFamily;
}

export const OBJECTIVES: Readonly<Record<ObjectiveId, ObjectiveDefinition>> = {
  founder: {
    id: "founder",
    name: "Founder",
    family: "builders",
  },
  "property-magnate": {
    id: "property-magnate",
    name: "Property Magnate",
    family: "builders",
  },
  independent: {
    id: "independent",
    name: "Independent",
    family: "life-career",
  },
  "capital-allocator": {
    id: "capital-allocator",
    name: "Capital Allocator",
    family: "capital",
  },
  financier: {
    id: "financier",
    name: "Financier",
    family: "capital",
  },
  "deal-maker": {
    id: "deal-maker",
    name: "Deal Maker",
    family: "transactions-generalist",
  },
  "executive-owner": {
    id: "executive-owner",
    name: "Executive Owner",
    family: "life-career",
  },
  "wealth-architect": {
    id: "wealth-architect",
    name: "Wealth Architect",
    family: "transactions-generalist",
  },
};

export function isObjectiveId(value: unknown): value is ObjectiveId {
  return (
    typeof value === "string" && OBJECTIVE_IDS.includes(value as ObjectiveId)
  );
}

export function isObjectiveFamily(value: unknown): value is ObjectiveFamily {
  return (
    typeof value === "string" &&
    OBJECTIVE_FAMILIES.includes(value as ObjectiveFamily)
  );
}
