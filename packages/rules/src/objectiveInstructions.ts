import { OBJECTIVE_MEASUREMENT_RULES as measurement } from "./completion";
import type { ObjectiveId } from "./objectives";

/** Section 18 instructions, projected only to the objective's owner. */
export const OBJECTIVE_INSTRUCTIONS_VERSION =
  "standard-v1-objective-instructions-v1";
export const OBJECTIVE_COMMON_INSTRUCTIONS = Object.freeze([
  `Recurring income and surplus use ${measurement.lookbackQuarters} completed quarters; missing quarters count as zero. Current assets, ownership, debt and liquidity use the current position. Future projected returns cannot qualify.`,
  "Protected annual living costs are the greater of current annual living costs and total living costs owed in the last four completed quarters. A last-second expense reduction cannot manufacture qualification.",
  `A material holding requires at least $${measurement.materialEquityCents / 100} of attributable equity. Group split interests in the same underlying asset; token splits do not add holdings.`,
  `A meaningful income source contributes at least the greater of $${measurement.meaningfulAnnualIncomeMinimumCents / 100} annually or ${measurement.meaningfulIncomeLivingExpenseBps / 100}% of protected annual living costs. Group sources by underlying asset or borrower.`,
  "Productive categories are real estate, operating/private businesses, public markets and financing. Cash alone supplies no productive category.",
  "Investment income excludes labor, returned principal, unpaid interest, capital/sale proceeds and circular transactions. Overdue lending has zero objective asset value until cured; claims and borrower liabilities remain collectible.",
  "Finales require no overdue obligations for the relevant borrower. Only your explicitly pursued finale can win. Recheck eligibility after closing costs, accrued interest and all immediate effects; ordinary eligibility or an ordinary transaction never automatically wins.",
]);
export const OBJECTIVE_INSTRUCTIONS: Readonly<
  Record<ObjectiveId, readonly string[]>
> = Object.freeze({
  founder: Object.freeze([
    `Control more than ${measurement.controlExclusiveMinimumPpm / 10000}% of the qualifying operating company. It must have positive operating profit in ${measurement.founderPositiveProfitQuarters} consecutive completed quarters.`,
    "Meet the business equity, operating profit and debt limits below. Expansion/acquisition must retain eligibility; alternatively sell the entire qualifying stake for at least the net exit amount below after related debt and fees, with a clean resulting balance sheet. This exit replaces continued ownership tests.",
  ]),
  "property-magnate": Object.freeze([
    `Control more than ${measurement.controlExclusiveMinimumPpm / 10000}% of each of the required qualifying properties. Use attributable property value/equity and net property cash flow after debt service.`,
    "Complete the landmark acquisition minimum below while retaining the portfolio requirements. Development is not required.",
  ]),
  independent: Object.freeze([
    "Meet the trailing non-employment income, meaningful-source/category, reserve and concentration requirements below. Maintain sustainable debt service and resilience; one-period income spikes and artificial expense cuts cannot qualify.",
    "Leave employment or owner work and remain qualified without labor-dependent income. Equal-cost replacement management remains an expense. Already-not-working players explicitly confirm independence under the same no-labor income, debt and reserve checks.",
  ]),
  "capital-allocator": Object.freeze([
    "Meet the invested-equity, material-holding, category, concentration and investment-income requirements below. No dominant owner-operated asset may substitute for diversification.",
    "Complete the strategic investment minimum below while retaining strength and diversification after the investment.",
  ]),
  financier: Object.freeze([
    "Use meaningful performing contracts across the required distinct borrowers. Financing profit counts earned interest actually received, with controlled default exposure; gross lending volume and reciprocal loans without genuine exposure/returns do not create progress.",
    "Fund a genuine transaction for at least the finale principal below, then retain performing-book and liquidity requirements.",
  ]),
  "deal-maker": Object.freeze([
    `Profitable transactions must be material and span more than one category/counterparty. A disposal requires at least ${measurement.minimumDisposalExposureQuarters} settled quarter of exposure. Acquisition basis includes fees; net losses reduce progress. Bound player-to-player credited gains by external reference quotes; genuine non-player bargains retain actual cost.`,
    "Complete a transformative transaction for at least the consideration below, retaining current wealth, gains and history. Repeated low-value or circular trades do not qualify.",
  ]),
  "executive-owner": Object.freeze([
    "Executive career tier required. Meet all employment, productive-equity, non-salary income and liquidity requirements below; salary alone is insufficient.",
    "Take a major ownership-linked leadership position with at least the funded equity exposure below, retaining the career and financial requirements after closing.",
  ]),
  "wealth-architect": Object.freeze([
    "Meet the simultaneous net-worth, liquid-capital, recurring-surplus, productive-category, leverage and concentration requirements below.",
    "Deploy or reallocate at least the finale amount below, counting each dollar once and retaining eligibility after the transaction.",
  ]),
});
