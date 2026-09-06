import {
  asAssetId,
  asLoanId,
  asPlayerId,
  type PlayerId,
} from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import type {
  DeterministicCounters,
  FinanceState,
  RecurringPersonalFinance,
} from "../model/gameState";
import {
  externalCashAccount,
  isExternalAccount,
  isSameCashAccount,
  playerCashAccount,
} from "./account";
import { createZeroPublicMarketPortfolio } from "./markets";
import {
  addCents,
  basisPoints,
  cents,
  isNonNegativeCents,
  isSafeCents,
  nonNegativeCents,
  subtractCents,
} from "./money";
import { ownershipPpm } from "./ownership";
import { postCash } from "./posting";

const aliceId = asPlayerId("player-alice");
const bobId = asPlayerId("player-bob");
const charlieId = asPlayerId("player-charlie");
const danaId = asPlayerId("player-dana");

function createInitialRecurring(): Record<PlayerId, RecurringPersonalFinance> {
  return {
    [aliceId]: {
      quarterlyIncomeCents: cents(25_000_00),
      quarterlyLivingExpenseCents: cents(13_800_00),
    },
    [bobId]: {
      quarterlyIncomeCents: cents(18_000_00),
      quarterlyLivingExpenseCents: cents(10_200_00),
    },
    [charlieId]: {
      quarterlyIncomeCents: cents(17_000_00),
      quarterlyLivingExpenseCents: cents(12_000_00),
    },
    [danaId]: {
      quarterlyIncomeCents: cents(11_250_00),
      quarterlyLivingExpenseCents: cents(9_600_00),
    },
  };
}

function createInitialFinance(): FinanceState {
  const cashByPlayer = {
    [aliceId]: cents(2_000_000), // $20,000
    [bobId]: cents(1_000_000), // $10,000
    [charlieId]: cents(500_000), // $5,000
    [danaId]: cents(300_000), // $3,000
  };
  const zero = createZeroPublicMarketPortfolio();
  const publicMarketsByPlayer = {
    [aliceId]: zero,
    [bobId]: zero,
    [charlieId]: zero,
    [danaId]: zero,
  };
  return {
    cashByPlayer,
    recurringByPlayer: createInitialRecurring(),
    loansById: {},
    assetsById: {},
    publicMarketsByPlayer,
    quarterStartBasis: {
      quarter: 1,
      cashByPlayer: { ...cashByPlayer },
      publicMarketsByPlayer: { ...publicMarketsByPlayer },
    },
  };
}

function createInitialCounters(): DeterministicCounters {
  return {
    asset: 0,
    contract: 0,
    loan: 0,
    opportunity: 0,
    journal: 0,
    settlement: 0,
  };
}

describe("finance arithmetic hardening", () => {
  it("constructs valid cents and rejects non-integers and unsafe numbers", () => {
    expect(cents(100)).toBe(100);
    expect(cents(0)).toBe(0);
    expect(cents(-50)).toBe(-50);
    expect(() => cents(10.5)).toThrow(RangeError);
    expect(() => cents(Number.NaN)).toThrow(RangeError);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("validates non-negative cents correctly", () => {
    expect(nonNegativeCents(0)).toBe(0);
    expect(nonNegativeCents(500)).toBe(500);
    expect(() => nonNegativeCents(-1)).toThrow(RangeError);
    expect(isNonNegativeCents(0)).toBe(true);
    expect(isNonNegativeCents(100)).toBe(true);
    expect(isNonNegativeCents(-1)).toBe(false);
    expect(isNonNegativeCents(1.5)).toBe(false);
    expect(isSafeCents(100)).toBe(true);
    expect(isSafeCents(-100)).toBe(true);
    expect(isSafeCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it("adds and subtracts cents with safe-integer overflow protection", () => {
    expect(addCents(cents(100), cents(250))).toBe(350);
    expect(subtractCents(cents(500), cents(200))).toBe(300);

    expect(() => addCents(cents(Number.MAX_SAFE_INTEGER), cents(1))).toThrow(
      RangeError,
    );

    expect(() =>
      subtractCents(cents(Number.MIN_SAFE_INTEGER), cents(1)),
    ).toThrow(RangeError);
  });
});

describe("cash accounts", () => {
  it("identifies external accounts and compares account endpoints", () => {
    expect(isExternalAccount("employer")).toBe(true);
    expect(isExternalAccount("bank")).toBe(true);
    expect(isExternalAccount("market")).toBe(true);
    expect(isExternalAccount("living-expense-sink")).toBe(true);
    expect(isExternalAccount("system")).toBe(false);

    const aliceAcc = playerCashAccount(aliceId);
    const bobAcc = playerCashAccount(bobId);
    const bankAcc = externalCashAccount("bank");
    const employerAcc = externalCashAccount("employer");

    expect(isSameCashAccount(aliceAcc, aliceAcc)).toBe(true);
    expect(isSameCashAccount(aliceAcc, playerCashAccount(aliceId))).toBe(true);
    expect(isSameCashAccount(aliceAcc, bobAcc)).toBe(false);
    expect(isSameCashAccount(aliceAcc, bankAcc)).toBe(false);
    expect(isSameCashAccount(bankAcc, bankAcc)).toBe(true);
    expect(isSameCashAccount(bankAcc, employerAcc)).toBe(false);
  });
});

describe("player-to-player cash posting", () => {
  it("conserves total cash, updates balances, and emits deterministic journal entry", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    // Alice: $20,000 (2_000_000 cents), Bob: $10,000 (1_000_000 cents)
    // Alice pays Bob $5,000 (500_000 cents)
    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 500_000,
      reason: "partnership-contribution",
      quarter: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Alice: $15,000, Bob: $15,000
    expect(result.finance.cashByPlayer[aliceId]).toBe(1_500_000);
    expect(result.finance.cashByPlayer[bobId]).toBe(1_500_000);

    // Total tracked player cash is conserved exactly ($38,000 total across all 4 players)
    const initialTotal = Object.values(finance.cashByPlayer).reduce(
      (acc, val) => acc + val,
      0,
    );
    const resultTotal = Object.values(result.finance.cashByPlayer).reduce(
      (acc, val) => acc + val,
      0,
    );
    expect(resultTotal).toBe(initialTotal);
    const aliceBalance = result.finance.cashByPlayer[aliceId] ?? 0;
    const bobBalance = result.finance.cashByPlayer[bobId] ?? 0;
    expect(aliceBalance + bobBalance).toBe(3_000_000);

    // One journal entry exists
    expect(result.entry).toBeDefined();
    expect(result.entry.id).toBe("journal-1");
    expect(result.entry.amountCents).toBe(500_000);
    expect(result.entry.source).toEqual(playerCashAccount(aliceId));
    expect(result.entry.destination).toEqual(playerCashAccount(bobId));
    expect(result.entry.reason).toBe("partnership-contribution");
    expect(result.entry.quarter).toBe(1);

    // Journal counter advances once
    expect(result.counters.journal).toBe(1);
    expect(result.counters.asset).toBe(0);
    expect(result.counters.loan).toBe(0);
  });
});

describe("external inflow and outflow posting", () => {
  it("processes external inflow (employer -> player) correctly", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const result = postCash(finance, counters, {
      source: externalCashAccount("employer"),
      destination: playerCashAccount(aliceId),
      amountCents: 250_000,
      reason: "salary",
      quarter: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.finance.cashByPlayer[aliceId]).toBe(2_250_000);
    expect(result.entry.source).toEqual(externalCashAccount("employer"));
    expect(result.entry.destination).toEqual(playerCashAccount(aliceId));
    expect(result.entry.amountCents).toBe(250_000);
    expect(result.entry.id).toBe("journal-1");
    expect(result.counters.journal).toBe(1);
  });

  it("processes external outflow (player -> living-expense-sink) correctly", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: externalCashAccount("living-expense-sink"),
      amountCents: 150_000,
      reason: "living-expenses",
      quarter: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.finance.cashByPlayer[aliceId]).toBe(1_850_000);
    expect(result.entry.source).toEqual(playerCashAccount(aliceId));
    expect(result.entry.destination).toEqual(
      externalCashAccount("living-expense-sink"),
    );
    expect(result.entry.amountCents).toBe(150_000);
    expect(result.entry.id).toBe("journal-1");
    expect(result.counters.journal).toBe(1);
  });
});

describe("financial rejection rules and immutability", () => {
  it("rejects zero amount", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();
    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 0,
      reason: "zero-transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_AMOUNT");
    expect(result.finance).toBe(finance);
    expect(result.counters).toBe(counters);
  });

  it("rejects negative amount", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();
    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: -500,
      reason: "negative-transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_AMOUNT");
    expect(result.finance).toBe(finance);
    expect(result.counters).toBe(counters);
  });

  it("rejects fractional cents", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();
    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 50.75,
      reason: "fractional-transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_AMOUNT");
    expect(result.finance).toBe(finance);
    expect(result.counters).toBe(counters);
  });

  it("rejects unsafe amount exceeding Number.MAX_SAFE_INTEGER", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();
    const result = postCash(finance, counters, {
      source: externalCashAccount("bank"),
      destination: playerCashAccount(aliceId),
      amountCents: Number.MAX_SAFE_INTEGER + 10,
      reason: "unsafe-transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_AMOUNT");
    expect(result.finance).toBe(finance);
    expect(result.counters).toBe(counters);
  });

  it("rejects unknown player source and destination", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();
    const unknownId = asPlayerId("ghost-player");

    const unknownSource = postCash(finance, counters, {
      source: playerCashAccount(unknownId),
      destination: playerCashAccount(bobId),
      amountCents: 100_000,
      reason: "from-ghost",
      quarter: 1,
    });
    expect(unknownSource.ok).toBe(false);
    if (unknownSource.ok) return;
    expect(unknownSource.code).toBe("UNKNOWN_PLAYER");
    expect(unknownSource.finance).toBe(finance);

    const unknownDest = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(unknownId),
      amountCents: 100_000,
      reason: "to-ghost",
      quarter: 1,
    });
    expect(unknownDest.ok).toBe(false);
    if (unknownDest.ok) return;
    expect(unknownDest.code).toBe("UNKNOWN_PLAYER");
    expect(unknownDest.finance).toBe(finance);
  });

  it("rejects player source with insufficient cash without overdraft", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    // Alice has $20,000 (2_000_000 cents); attempts to send $20,001 (2_000_100 cents)
    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 2_000_100,
      reason: "overdraft-attempt",
      quarter: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_FUNDS");
    expect(result.finance).toBe(finance);
    expect(result.counters).toBe(counters);
    expect(finance.cashByPlayer[aliceId]).toBe(2_000_000);
  });

  it("rejects same source and destination", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const playerToSame = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(aliceId),
      amountCents: 50_000,
      reason: "self-transfer",
      quarter: 1,
    });
    expect(playerToSame.ok).toBe(false);
    if (playerToSame.ok) return;
    expect(playerToSame.code).toBe("SAME_ACCOUNT");

    const externalToSame = postCash(finance, counters, {
      source: externalCashAccount("bank"),
      destination: externalCashAccount("bank"),
      amountCents: 50_000,
      reason: "bank-to-bank",
      quarter: 1,
    });
    expect(externalToSame.ok).toBe(false);
    if (externalToSame.ok) return;
    expect(externalToSame.code).toBe("SAME_ACCOUNT");
  });

  it("rejects external to external posting", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const result = postCash(finance, counters, {
      source: externalCashAccount("employer"),
      destination: externalCashAccount("bank"),
      amountCents: 50_000,
      reason: "external-to-external",
      quarter: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_ENDPOINT");
    expect(result.finance).toBe(finance);
    expect(result.counters).toBe(counters);
  });

  it("rejects destination balance overflow", () => {
    const finance: FinanceState = {
      ...createInitialFinance(),
      cashByPlayer: {
        [aliceId]: cents(100),
        [bobId]: cents(Number.MAX_SAFE_INTEGER - 50),
        [charlieId]: cents(0),
        [danaId]: cents(0),
      },
    };
    const counters = createInitialCounters();

    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 60, // would exceed Number.MAX_SAFE_INTEGER for Bob
      reason: "overflow-transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DESTINATION_OVERFLOW");
    expect(result.finance).toBe(finance);
    expect(result.counters).toBe(counters);
  });
});

describe("deterministic repeatability", () => {
  it("produces identical results for identical inputs", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();
    const request = {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 450_000,
      reason: "consulting-fee",
      quarter: 2,
    };

    const run1 = postCash(finance, counters, request);
    const run2 = postCash(finance, counters, request);

    expect(run1).toEqual(run2);
    expect(run1.ok).toBe(true);
    if (!run1.ok || !run2.ok) return;
    expect(run1.entry.id).toBe("journal-1");
    expect(run2.entry.id).toBe("journal-1");
    expect(run1.finance.cashByPlayer).toEqual(run2.finance.cashByPlayer);
  });

  it("increments journal ID monotonically across sequential postings", () => {
    let finance = createInitialFinance();
    let counters = createInitialCounters();

    const res1 = postCash(finance, counters, {
      source: externalCashAccount("employer"),
      destination: playerCashAccount(aliceId),
      amountCents: 100_000,
      reason: "salary",
      quarter: 1,
    });
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    expect(res1.entry.id).toBe("journal-1");
    finance = res1.finance;
    counters = res1.counters;

    const res2 = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 50_000,
      reason: "loan",
      quarter: 1,
    });
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.entry.id).toBe("journal-2");
    expect(res2.counters.journal).toBe(2);
  });

  it("throws invariant RangeError when journal counter is exhausted at MAX_SAFE_INTEGER", () => {
    const finance = createInitialFinance();
    const exhaustedCounters: DeterministicCounters = {
      asset: 0,
      contract: 0,
      loan: 0,
      opportunity: 0,
      journal: Number.MAX_SAFE_INTEGER,
      settlement: 0,
    };

    expect(() =>
      postCash(finance, exhaustedCounters, {
        source: playerCashAccount(aliceId),
        destination: playerCashAccount(bobId),
        amountCents: 10_000,
        reason: "transfer",
        quarter: 1,
      }),
    ).toThrow(RangeError);
  });

  it("preserves loansById registry during cash posting", () => {
    const sampleLoan = {
      id: asLoanId("loan-1"),
      kind: "player-loan" as const,
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      originalPrincipalCents: cents(100_000),
      outstandingPrincipalCents: cents(100_000),
      annualRateBps: basisPoints(500),
      termQuarters: 4,
      installmentsPaid: 0,
    };
    const finance: FinanceState = {
      ...createInitialFinance(),
      loansById: {
        [sampleLoan.id]: sampleLoan,
      },
    };
    const counters = createInitialCounters();

    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 50_000,
      reason: "transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finance.loansById).toBe(finance.loansById);
    expect(result.finance.loansById[sampleLoan.id]).toBe(sampleLoan);
  });

  it("preserves assetsById across cash postings", () => {
    const sampleProperty = {
      id: asAssetId("asset-1"),
      kind: "property" as const,
      marketValueCents: cents(30_000_000),
      scheduledQuarterlyRentCents: cents(300_000),
      occupancyBps: basisPoints(9_500),
      operatingExpenseRatioBps: basisPoints(3_500),
      ownershipByPlayerPpm: {
        [aliceId]: ownershipPpm(1_000_000),
      },
    };

    const finance: FinanceState = {
      ...createInitialFinance(),
      assetsById: {
        [sampleProperty.id]: sampleProperty,
      },
    };
    const counters = createInitialCounters();

    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 10_000,
      reason: "transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finance.assetsById).toBe(finance.assetsById);
    expect(result.finance.assetsById[sampleProperty.id]).toBe(sampleProperty);
  });

  it("preserves recurringByPlayer across cash postings", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const result = postCash(finance, counters, {
      source: playerCashAccount(aliceId),
      destination: playerCashAccount(bobId),
      amountCents: 10_000,
      reason: "transfer",
      quarter: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finance.recurringByPlayer).toBe(finance.recurringByPlayer);
  });
});
