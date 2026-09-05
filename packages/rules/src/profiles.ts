export const PROFILE_IDS = [
  "high-income-professional",
  "corporate-climber",
  "disciplined-saver",
  "small-business-owner",
  "property-starter",
  "market-investor",
  "self-employed-operator",
  "early-stage-entrepreneur",
] as const;

export type ProfileId = (typeof PROFILE_IDS)[number];

export interface ProfileDefinition {
  readonly id: ProfileId;
  readonly name: string;
  readonly startingCashCents: number;
}

export const PROFILES: Readonly<Record<ProfileId, ProfileDefinition>> = {
  "high-income-professional": {
    id: "high-income-professional",
    name: "High-Income Professional",
    startingCashCents: 5_000_000,
  },
  "corporate-climber": {
    id: "corporate-climber",
    name: "Corporate Climber",
    startingCashCents: 3_500_000,
  },
  "disciplined-saver": {
    id: "disciplined-saver",
    name: "Disciplined Saver",
    startingCashCents: 10_500_000,
  },
  "small-business-owner": {
    id: "small-business-owner",
    name: "Small Business Owner",
    startingCashCents: 3_000_000,
  },
  "property-starter": {
    id: "property-starter",
    name: "Property Starter",
    startingCashCents: 2_800_000,
  },
  "market-investor": {
    id: "market-investor",
    name: "Market Investor",
    startingCashCents: 2_500_000,
  },
  "self-employed-operator": {
    id: "self-employed-operator",
    name: "Self-Employed Operator",
    startingCashCents: 4_000_000,
  },
  "early-stage-entrepreneur": {
    id: "early-stage-entrepreneur",
    name: "Early-Stage Entrepreneur",
    startingCashCents: 2_000_000,
  },
};

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && PROFILE_IDS.includes(value as ProfileId);
}
