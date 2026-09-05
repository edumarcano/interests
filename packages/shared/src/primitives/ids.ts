declare const brand: unique symbol;

export type BrandedId<Name extends string> = string & {
  readonly [brand]: Name;
};

export type GameId = BrandedId<"GameId">;
export type PlayerId = BrandedId<"PlayerId">;
export type AssetId = BrandedId<"AssetId">;
export type LoanId = BrandedId<"LoanId">;
export type OpportunityId = BrandedId<"OpportunityId">;
export type ContractId = BrandedId<"ContractId">;

export function asGameId(value: string): GameId {
  return value as GameId;
}

export function asPlayerId(value: string): PlayerId {
  return value as PlayerId;
}

export function asAssetId(value: string): AssetId {
  return value as AssetId;
}

export function asLoanId(value: string): LoanId {
  return value as LoanId;
}

export function asOpportunityId(value: string): OpportunityId {
  return value as OpportunityId;
}

export function asContractId(value: string): ContractId {
  return value as ContractId;
}
