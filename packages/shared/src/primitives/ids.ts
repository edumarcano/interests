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
export type SettlementId = BrandedId<"SettlementId">;
export type TransactionId = BrandedId<"TransactionId">;
export type RoomId = BrandedId<"RoomId">;
export type RoomMemberId = BrandedId<"RoomMemberId">;
export type BrowserSessionId = BrandedId<"BrowserSessionId">;
export type MatchId = BrandedId<"MatchId">;
export type CommandId = BrandedId<"CommandId">;

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

export function asSettlementId(value: string): SettlementId {
  return value as SettlementId;
}

export function asTransactionId(value: string): TransactionId {
  return value as TransactionId;
}

export function asRoomId(value: string): RoomId {
  return value as RoomId;
}

export function asRoomMemberId(value: string): RoomMemberId {
  return value as RoomMemberId;
}

export function asBrowserSessionId(value: string): BrowserSessionId {
  return value as BrowserSessionId;
}

export function asMatchId(value: string): MatchId {
  return value as MatchId;
}

export function asCommandId(value: string): CommandId {
  return value as CommandId;
}
