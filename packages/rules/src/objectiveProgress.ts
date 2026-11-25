/** Owner-private labels for canonical engine checks. Targets stay in completion.ts. */
export const OBJECTIVE_PROGRESS_LABELS = Object.freeze({
  "no-overdue-obligations": "Your required obligations are current",
  "performing-qualifying-company": "The qualifying company is performing",
  "majority-control": "Majority control of the qualifying company",
  "business-equity": "Equity in the qualifying company",
  "actual-annual-company-profit":
    "Actual annual profit from the qualifying company",
  "company-debt-to-enterprise-value": "The qualifying company's debt limit",
  "consecutive-positive-company-quarters":
    "Consecutive positive-profit quarters in that company",
  "qualifying-operating-company": "A qualifying operating company",
  "performing-property-portfolio":
    "The required property portfolio is performing",
  "attributable-property-value": "Attributable property value",
  "property-equity": "Property equity",
  "actual-annual-property-net-cashflow":
    "Actual property cash flow after debt service",
  "property-ltv": "The property loan-to-value limit",
  "material-controlled-properties": "Material properties under your control",
  "nonlabor-cashflow-after-personal-debt":
    "Non-employment cash flow after required personal debt service",
  "meaningful-income-sources": "Meaningful sources of income",
  "income-categories": "Different categories of income",
  "liquid-reserves": "Liquid reserves",
  "largest-income-source": "The largest income-source limit",
  "invested-equity": "Invested equity",
  "material-holdings": "Material investment holdings",
  "productive-categories": "Different productive investment categories",
  "largest-invested-holding": "The largest invested-holding limit",
  "actual-annual-investment-income": "Actual annual investment income",
  "performing-financing-book": "Performing financing capital",
  "earned-received-financing-profit": "Financing profit actually received",
  "distinct-material-funded-deals":
    "Distinct material deals funded with your capital",
  "distinct-performing-borrowers": "Different performing borrowers",
  "liquid-capital": "Liquid capital",
  "net-worth": "Current net worth",
  "seasoned-reference-bounded-gains": "Qualified net disposal gains",
  "material-profitable-disposals": "Material profitable disposals",
  "disposal-category-or-counterparty-diversity":
    "Profitable disposals span categories or counterparties",
  "executive-career-tier": "An executive career role",
  "actual-annual-employment-income": "Actual annual employment income",
  "productive-ownership-equity": "Productive ownership equity",
  "actual-annual-nonsalary-income": "Actual annual non-salary income",
  "actual-annual-recurring-surplus": "Actual annual recurring surplus",
  "material-productive-categories": "Material productive categories",
  "liabilities-to-assets": "The liabilities-to-assets limit",
  "largest-holding-to-net-worth": "The largest holding-to-net-worth limit",
});

export type ObjectiveProgressCheckId = keyof typeof OBJECTIVE_PROGRESS_LABELS;
