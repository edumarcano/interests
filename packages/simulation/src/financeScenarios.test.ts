import {
  applyPlayerCommand,
  calculateBusinessEquity,
  createGame,
} from "@interests/engine";
import { describe, expect, it } from "vitest";
import {
  completePassiveBaselineSetup,
  STANDARD_SIMULATION_PLAYER_IDS,
  simulateReadyGame,
} from "./baseline";
import { FINANCE_SCENARIO_NAMES, runFinanceScenario } from "./financeScenarios";
import { aggregateBatchReport } from "./metrics";

describe("financial acceptance scenarios", () => {
  it("aggregates observed company balances and actual bank payments without mixing them into liquid position", () => {
    const state = completePassiveBaselineSetup(
      createGame({
        gameId: "report-proof",
        seed: "m7-planning-1",
        playerIds: STANDARD_SIMULATION_PLAYER_IDS,
      }),
    );
    const result = simulateReadyGame(state, 4);
    const report = aggregateBatchReport(
      { gameCount: 1, quarterCount: 4, seedPrefix: "report-proof" },
      [result],
    );
    let direct = state;
    for (let quarter = 1; quarter <= 4; quarter++) {
      const begin = applyPlayerCommand(direct, direct.playerOrder[0]!, {
        type: "BEGIN_ROUND",
      });
      if (!begin.ok) throw new Error(begin.code);
      direct = begin.state;
      while (direct.currentQuarter === quarter) {
        const id =
          direct.playerOrder[
            (quarter - 1 + direct.round!.spotlightsCompleted) % 4
          ]!;
        const pass = applyPlayerCommand(direct, id, { type: "PASS_SPOTLIGHT" });
        if (!pass.ok) throw new Error(pass.code);
        direct = pass.state;
      }
    }
    const companies = Object.values(direct.finance.assetsById).filter(
      (a) => a.kind === "business",
    );
    expect(report.finance.endingBalances.companyCashCents).toBe(
      companies.reduce((sum, a) => sum + a.cashCents, 0),
    );
    expect(report.finance.endingBalances.companyEquityCents).toBe(
      companies.reduce(
        (sum, a) =>
          sum +
          calculateBusinessEquity(a, direct.finance.loansById).equityValueCents,
        0,
      ),
    );
    expect(report.finance.bankPrincipalPaidCents).toBe(
      Object.values(direct.finance.loansById).reduce(
        (sum, l) => sum + l.principalRepaidCents,
        0,
      ),
    );
    expect(report.finance.bankInterestPaidCents).toBeGreaterThan(0);
    expect(report.finance.retainedFromSurplusCents).toBe(
      report.finance.endingBalances.companyCashCents -
        Object.values(state.finance.assetsById).reduce(
          (sum, a) => sum + (a.kind === "business" ? a.cashCents : 0),
          0,
        ),
    );
    expect(report.finance).toMatchObject({
      missedLoanPayments: 0,
      curedClaims: 0,
    });
  });
  it.each(FINANCE_SCENARIO_NAMES)(
    "replays %s deterministically through the real command boundary",
    (name) => {
      const result = runFinanceScenario(name);
      expect(runFinanceScenario(name)).toEqual(result);
      expect(result.finalQuarter).toBe(5);
      expect(result.checkpoints.map((c) => c.quarter)).toEqual([1, 2, 3, 4]);
      for (const checkpoint of result.checkpoints) {
        expect(checkpoint.outcome?.quarter).toBe(checkpoint.quarter);
        for (const payment of checkpoint.outcome!.loanPayments) {
          expect(payment.paidCents).toBe(
            payment.principalPaidCents + payment.interestPaidCents,
          );
          expect(payment.dueCents - payment.paidCents).toBe(
            payment.closingPastDuePrincipalCents +
              payment.closingUnpaidInterestCents,
          );
        }
      }
      expect(result.journal.every((e) => e.amountCents > 0)).toBe(true);
      for (const id of result.finalState.playerOrder) {
        let cash: number = result.openingState.finance.cashByPlayer[id]!;
        for (const injection of result.injections)
          if (injection.playerId === id) cash += injection.cashCents;
        for (const entry of result.journal) {
          if (entry.source.kind === "player" && entry.source.playerId === id)
            cash -= entry.amountCents;
          if (
            entry.destination.kind === "player" &&
            entry.destination.playerId === id
          )
            cash += entry.amountCents;
        }
        expect(result.finalState.finance.cashByPlayer[id]).toBe(cash);
      }
      for (const asset of Object.values(
        result.openingState.finance.assetsById,
      )) {
        if (asset.kind !== "business") continue;
        let cash: number = asset.cashCents;
        for (const entry of result.journal) {
          if (
            entry.source.kind === "business" &&
            entry.source.assetId === asset.id
          )
            cash -= entry.amountCents;
          if (
            entry.destination.kind === "business" &&
            entry.destination.assetId === asset.id
          )
            cash += entry.amountCents;
        }
        expect(result.finalState.finance.assetsById[asset.id]).toMatchObject({
          cashCents: cash,
        });
      }
    },
  );

  it("continues the original financed purchase with actual work pay and separate loan receipts", () => {
    const result = runFinanceScenario("financed-acquisition");
    expect(result.initialization).toBe("q1-business-diagnostic");
    expect(
      result.checkpoints.every((c) => c.finance.missedLoanPayments === 0),
    ).toBe(true);
    const totals = Object.values(result.cashFlows);
    expect(
      totals.reduce((sum, f) => sum + f.playerLoanPrincipalReceivedCents, 0),
    ).toBe(2_000_000);
    expect(
      totals.reduce((sum, f) => sum + f.playerLoanPrincipalPaidCents, 0),
    ).toBe(2_000_000);
    expect(
      totals.reduce((sum, f) => sum + f.playerLoanInterestReceivedCents, 0),
    ).toBe(totals.reduce((sum, f) => sum + f.playerLoanInterestPaidCents, 0));
    expect(
      totals.reduce((sum, f) => sum + f.workCompensationReceivedCents, 0),
    ).toBe(6_000_000);
  });

  it("records living claims without any personal loan and cannot circulate zero-cash loan funding", () => {
    const living = runFinanceScenario("living-shortfall");
    expect(
      living.checkpoints.map((c) => c.finance.balances.livingArrearsCents),
    ).toEqual([1_000, 2_006, 3_023, 4_051]);
    expect(Object.keys(living.finalState.finance.loansById)).toHaveLength(0);
    const cyclic = runFinanceScenario("cyclic-loans");
    expect(cyclic.checkpoints.map((c) => c.finance.missedLoanPayments)).toEqual(
      [0, 2, 2, 2],
    );
    expect(
      cyclic.journal.filter((e) => e.reason === "loan-payment"),
    ).toHaveLength(0);
    expect(cyclic.checkpoints.at(-1)?.finance.balances).toMatchObject({
      pastDuePrincipalCents: 40_000,
      unpaidInterestCents: 3_000,
    });
  });

  it("preserves mortgage debt and company operating/work obligations through losses", () => {
    const mortgage = runFinanceScenario("mortgage-shortfall");
    expect(
      mortgage.checkpoints.every((c) => c.finance.missedLoanPayments === 1),
    ).toBe(true);
    const loan = Object.values(mortgage.finalState.finance.loansById)[0]!;
    expect(loan.outstandingPrincipalCents).toBe(loan.originalPrincipalCents);
    expect(loan.unpaidInterestCents).toBeGreaterThan(0);
    const loss = runFinanceScenario("company-loss");
    expect(
      loss.checkpoints.map((c) => c.finance.balances.operatingArrearsCents),
    ).toEqual([100_000, 200_000, 300_000, 400_000]);
    expect(
      loss.checkpoints.at(-1)!.finance.balances.workArrearsCents,
    ).toBeGreaterThan(0);
    expect(
      loss.journal.some(
        (e) => e.source.kind === "player" && e.destination.kind === "business",
      ),
    ).toBe(false);
  });

  it("recovers a matured loan with ordinary principal interest and counts its cure once", () => {
    const result = runFinanceScenario("post-maturity-recovery");
    expect(result.initialization).toBe("synthetic-diagnostic");
    expect(result.injections).toHaveLength(1);
    expect(result.checkpoints[2]!.finance.balances).toMatchObject({
      pastDuePrincipalCents: 20_000,
      unpaidInterestCents: 1_000,
    });
    expect(result.checkpoints[3]!.outcome?.loanPayments[0]).toMatchObject({
      paidCents: 21_500,
      principalPaidCents: 20_000,
      interestPaidCents: 1_500,
    });
    expect(result.checkpoints.map((c) => c.finance.curedClaims)).toEqual([
      0, 0, 0, 1,
    ]);
    expect(result.checkpoints[3]!.finance.balances).toMatchObject({
      pastDuePrincipalCents: 0,
      unpaidInterestCents: 0,
    });
  });
});
