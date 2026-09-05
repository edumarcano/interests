import type { CashAccount } from "./account";
import type { Cents } from "./money";

declare const journalEntryIdBrand: unique symbol;

export type JournalEntryId = string & {
  readonly [journalEntryIdBrand]: "JournalEntryId";
};

export function asJournalEntryId(value: string): JournalEntryId {
  return value as JournalEntryId;
}

export interface JournalEntry {
  readonly id: JournalEntryId;
  readonly source: CashAccount;
  readonly destination: CashAccount;
  readonly amountCents: Cents;
  readonly reason: string;
  readonly quarter: number;
  readonly relatedEntityId?: string;
}
