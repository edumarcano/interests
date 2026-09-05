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
}

export const PROFILES: Readonly<Record<ProfileId, ProfileDefinition>> = {
  "high-income-professional": {
    id: "high-income-professional",
    name: "High-Income Professional",
  },
  "corporate-climber": {
    id: "corporate-climber",
    name: "Corporate Climber",
  },
  "disciplined-saver": {
    id: "disciplined-saver",
    name: "Disciplined Saver",
  },
  "small-business-owner": {
    id: "small-business-owner",
    name: "Small Business Owner",
  },
  "property-starter": {
    id: "property-starter",
    name: "Property Starter",
  },
  "market-investor": {
    id: "market-investor",
    name: "Market Investor",
  },
  "self-employed-operator": {
    id: "self-employed-operator",
    name: "Self-Employed Operator",
  },
  "early-stage-entrepreneur": {
    id: "early-stage-entrepreneur",
    name: "Early-Stage Entrepreneur",
  },
};

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && PROFILE_IDS.includes(value as ProfileId);
}
