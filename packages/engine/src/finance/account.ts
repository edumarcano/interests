import type { PlayerId } from "@interests/shared";

export const EXTERNAL_ACCOUNTS = [
  "employer",
  "bank",
  "market",
  "living-expense-sink",
  "property-operating-cashflow",
  "personal-earned-income",
] as const;

export type ExternalAccount = (typeof EXTERNAL_ACCOUNTS)[number];

export type CashAccount =
  | { readonly kind: "player"; readonly playerId: PlayerId }
  | { readonly kind: "external"; readonly account: ExternalAccount };

export function isExternalAccount(value: unknown): value is ExternalAccount {
  return (
    typeof value === "string" &&
    EXTERNAL_ACCOUNTS.includes(value as ExternalAccount)
  );
}

export function playerCashAccount(playerId: PlayerId): CashAccount {
  return { kind: "player", playerId };
}

export function externalCashAccount(account: ExternalAccount): CashAccount {
  return { kind: "external", account };
}

export function isSameCashAccount(a: CashAccount, b: CashAccount): boolean {
  if (a.kind === "player" && b.kind === "player") {
    return a.playerId === b.playerId;
  }
  if (a.kind === "external" && b.kind === "external") {
    return a.account === b.account;
  }
  return false;
}
