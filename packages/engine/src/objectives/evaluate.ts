import {
  OBJECTIVE_IDS,
  type ObjectiveId,
  OBJECTIVE_MEASUREMENT_RULES as rules,
  OBJECTIVE_TARGETS as targets,
} from "@interests/rules";
import { FinanceDecimal } from "../finance/decimal";
import { cents } from "../finance/money";
import type {
  ObjectiveCheck,
  ObjectiveEvaluation,
  ObjectiveMeasurements,
} from "./model";

function sum(values: readonly number[]) {
  return cents(
    values
      .reduce((result, value) => result.plus(value), new FinanceDecimal(0))
      .toNumber(),
  );
}
const minimum = (
  id: string,
  actual: number,
  target: number,
): ObjectiveCheck => ({
  id,
  actual,
  target,
  comparison: "minimum",
  met: actual >= target,
});
const required = (id: string, met: boolean): ObjectiveCheck => ({
  id,
  actual: met ? 1 : 0,
  target: 1,
  comparison: "required",
  met,
});
function maximumRatio(
  id: string,
  numerator: number,
  denominator: number,
  target: number,
): ObjectiveCheck {
  const met =
    denominator > 0 &&
    new FinanceDecimal(numerator)
      .times(10000)
      .lessThanOrEqualTo(new FinanceDecimal(denominator).times(target));
  const actual =
    denominator > 0
      ? new FinanceDecimal(numerator)
          .times(10000)
          .div(denominator)
          .ceil()
          .toNumber()
      : 0;
  return {
    id,
    actual: Number.isSafeInteger(actual) ? actual : Number.MAX_SAFE_INTEGER,
    target,
    comparison: "maximum",
    met,
  };
}

/** Exact private eligibility. Terminal pre/post checks and finale execution are separate. */
export function evaluateObjective(
  measured: ObjectiveMeasurements,
  objectiveId: ObjectiveId,
): ObjectiveEvaluation {
  const holdings = measured.holdings.filter(
    (holding) => holding.equityCents > 0,
  );
  const productiveEquity = sum(
    measured.holdings.map((holding) => holding.equityCents),
  );
  const material = holdings.filter(
    (holding) => holding.equityCents >= rules.materialEquityCents,
  );
  const categories = new Set(material.map((holding) => holding.category)).size;
  const meaningfulMinimum = Math.max(
    rules.meaningfulAnnualIncomeMinimumCents,
    cents(
      new FinanceDecimal(measured.protectedAnnualLivingCostCents)
        .times(rules.meaningfulIncomeLivingExpenseBps)
        .div(10000)
        .ceil()
        .toNumber(),
    ),
  );
  const meaningful = measured.incomeSources.filter(
    (source) => source.annualReceivedCents >= meaningfulMinimum,
  );
  const incomeCategories = new Set(
    meaningful
      .filter((source) => source.category !== "cash")
      .map((source) => source.category),
  ).size;
  const checks: ObjectiveCheck[] = [
    required("no-overdue-obligations", !measured.overdue),
  ];
  switch (objectiveId) {
    case "founder": {
      const t = targets.founder;
      const candidates = measured.companies.map((company) => [
        required("performing-qualifying-company", !company.overdue),
        required(
          "majority-control",
          company.ownershipPpm > rules.controlExclusiveMinimumPpm,
        ),
        minimum(
          "business-equity",
          company.attributableEquityCents,
          t.businessEquityCents,
        ),
        minimum(
          "actual-annual-company-profit",
          company.annualOperatingProfitCents,
          t.annualOperatingProfitCents,
        ),
        maximumRatio(
          "company-debt-to-enterprise-value",
          company.principalCents,
          company.enterpriseValueCents,
          t.maxDebtToEnterpriseValueBps,
        ),
        minimum(
          "consecutive-positive-company-quarters",
          company.consecutivePositiveQuarters,
          rules.founderPositiveProfitQuarters,
        ),
      ]);
      const chosen =
        candidates.find((candidate) => candidate.every((check) => check.met)) ??
        candidates.sort(
          (left, right) =>
            right.filter((check) => check.met).length -
            left.filter((check) => check.met).length,
        )[0];
      checks.push(
        ...(chosen ?? [required("qualifying-operating-company", false)]),
      );
      break;
    }
    case "property-magnate": {
      const t = targets[objectiveId];
      checks.push(
        required("performing-property-portfolio", !measured.propertyOverdue),
        minimum(
          "attributable-property-value",
          measured.propertyValueCents,
          t.attributableValueCents,
        ),
        minimum("property-equity", measured.propertyEquityCents, t.equityCents),
        minimum(
          "actual-annual-property-net-cashflow",
          measured.annualPropertyNetCashFlowCents,
          t.annualNetCashFlowCents,
        ),
        maximumRatio(
          "property-ltv",
          measured.propertyPrincipalCents,
          measured.propertyValueCents,
          t.maxLtvBps,
        ),
        minimum(
          "material-controlled-properties",
          measured.controlledProperties,
          t.controlledProperties,
        ),
      );
      break;
    }
    case "independent": {
      const t = targets.independent;
      const requiredIncome = cents(
        new FinanceDecimal(measured.protectedAnnualLivingCostCents)
          .times(t.incomeToLivingExpenseBps)
          .div(10000)
          .ceil()
          .toNumber(),
      );
      const requiredReserve = cents(
        new FinanceDecimal(measured.protectedAnnualLivingCostCents)
          .times(t.reserveMonths)
          .div(12)
          .ceil()
          .toNumber(),
      );
      checks.push(
        minimum(
          "nonlabor-cashflow-after-personal-debt",
          measured.annualInvestmentAfterPersonalDebtServiceCents,
          requiredIncome,
        ),
        minimum(
          "meaningful-income-sources",
          meaningful.length,
          t.meaningfulSources,
        ),
        minimum("income-categories", incomeCategories, t.categories),
        minimum(
          "liquid-reserves",
          measured.liquidCapitalCents,
          requiredReserve,
        ),
        maximumRatio(
          "largest-income-source",
          Math.max(
            0,
            ...measured.incomeSources.map(
              (source) => source.annualReceivedCents,
            ),
          ),
          measured.annualInvestmentIncomeCents,
          t.maxSourceIncomeBps,
        ),
      );
      break;
    }
    case "capital-allocator": {
      const t = targets[objectiveId];
      checks.push(
        minimum("invested-equity", productiveEquity, t.investedEquityCents),
        minimum("material-holdings", material.length, t.materialHoldings),
        minimum("productive-categories", categories, t.categories),
        maximumRatio(
          "largest-invested-holding",
          Math.max(0, ...holdings.map((holding) => holding.equityCents)),
          productiveEquity,
          t.maxHoldingBps,
        ),
        minimum(
          "actual-annual-investment-income",
          measured.annualInvestmentIncomeCents,
          t.annualInvestmentIncomeCents,
        ),
      );
      break;
    }
    case "financier": {
      const t = targets[objectiveId];
      checks.push(
        minimum(
          "performing-financing-book",
          measured.performingFinancingBookCents,
          t.performingBookCents,
        ),
        minimum(
          "earned-received-financing-profit",
          measured.earnedFinancingProfitCents,
          t.earnedProfitCents,
        ),
        minimum(
          "distinct-material-funded-deals",
          measured.distinctFundedTransactions,
          t.meaningfulContracts,
        ),
        minimum(
          "distinct-performing-borrowers",
          measured.distinctPerformingBorrowers,
          t.borrowers,
        ),
        minimum(
          "liquid-capital",
          measured.liquidCapitalCents,
          t.liquidityCents,
        ),
      );
      break;
    }
    case "deal-maker": {
      const t = targets[objectiveId];
      checks.push(
        minimum("net-worth", measured.netWorthCents, t.netWorthCents),
        minimum(
          "seasoned-reference-bounded-gains",
          measured.creditedDealGainsCents,
          t.realizedGainsCents,
        ),
        minimum(
          "material-profitable-disposals",
          measured.profitableDisposals,
          t.profitableTransactions,
        ),
        required(
          "disposal-category-or-counterparty-diversity",
          measured.profitableDisposalCategories > 1 ||
            measured.profitableDisposalCounterparties > 1,
        ),
      );
      break;
    }
    case "executive-owner": {
      const t = targets[objectiveId];
      checks.push(
        required("executive-career-tier", measured.executiveRole),
        minimum(
          "actual-annual-employment-income",
          measured.annualEmploymentIncomeCents,
          t.annualEmploymentIncomeCents,
        ),
        minimum(
          "productive-ownership-equity",
          productiveEquity,
          t.productiveEquityCents,
        ),
        minimum(
          "actual-annual-nonsalary-income",
          measured.annualInvestmentIncomeCents,
          t.annualNonSalaryIncomeCents,
        ),
        minimum(
          "liquid-capital",
          measured.liquidCapitalCents,
          t.liquidityCents,
        ),
      );
      break;
    }
    case "wealth-architect": {
      const t = targets[objectiveId];
      checks.push(
        minimum("net-worth", measured.netWorthCents, t.netWorthCents),
        minimum(
          "liquid-capital",
          measured.liquidCapitalCents,
          t.liquidCapitalCents,
        ),
        minimum(
          "actual-annual-recurring-surplus",
          measured.annualRecurringSurplusCents,
          t.annualSurplusCents,
        ),
        minimum(
          "material-productive-categories",
          categories,
          t.productiveCategories,
        ),
        maximumRatio(
          "liabilities-to-assets",
          measured.totalLiabilitiesCents,
          measured.grossAssetValueCents,
          t.maxDebtToAssetsBps,
        ),
        maximumRatio(
          "largest-holding-to-net-worth",
          Math.max(
            measured.cashCents,
            0,
            ...holdings.map((holding) => holding.equityCents),
          ),
          measured.netWorthCents,
          t.maxHoldingToNetWorthBps,
        ),
      );
      break;
    }
    default: {
      const unreachable: never = objectiveId;
      throw new Error(`Unknown objective ${unreachable}`);
    }
  }
  return {
    objectiveId,
    status: checks.every((check) => check.met) ? "eligible" : "ineligible",
    checks,
  };
}
export function evaluateAllObjectives(
  measured: ObjectiveMeasurements,
): readonly ObjectiveEvaluation[] {
  return OBJECTIVE_IDS.map((id) => evaluateObjective(measured, id));
}
