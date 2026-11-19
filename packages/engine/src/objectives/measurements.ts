import {
  OBJECTIVE_MEASUREMENT_RULES,
  OBJECTIVE_QUALIFICATION_RULES,
  PUBLIC_MARKET_INSTRUMENT_IDS,
} from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import { isAssetBorrower } from "../finance/bank";
import { calculateBusinessEquity } from "../finance/business";
import { FinanceDecimal } from "../finance/decimal";
import { type Cents, cents } from "../finance/money";
import { allocateProportionalCents } from "../finance/ownership";
import type { QuarterObservation } from "../model/completionState";
import type { GameState } from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";
import { combineObjectiveEvidence } from "./evidence";
import type {
  ObjectiveEvidence,
  ObjectiveHolding,
  ObjectiveIncomeSource,
  ObjectiveMeasurements,
} from "./model";

const sum = (values: readonly number[]): Cents =>
  cents(
    values
      .reduce((result, value) => result.plus(value), new FinanceDecimal(0))
      .toNumber(),
  );
const nonnegative = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid objective evidence money");
};
const unique = (ids: readonly string[]) => {
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate objective evidence");
};
function actualQuarters(
  state: GameState,
  playerId: PlayerId,
): readonly QuarterObservation[] {
  const quarters = state.progress.byPlayer[playerId]!.quarters;
  if (
    quarters.length !==
      Math.min(
        state.lastSettledQuarter,
        OBJECTIVE_MEASUREMENT_RULES.lookbackQuarters,
      ) ||
    quarters.some(
      (quarter, index) =>
        quarter.quarter !==
        state.lastSettledQuarter - quarters.length + index + 1,
    )
  )
    throw new Error("Missing or nonconsecutive objective observations");
  return quarters;
}

/** Pure, private measurement from canonical state and trusted engine transaction evidence. */
export function measurePlayerObjectives(
  state: GameState,
  playerId: PlayerId,
  additionalEvidence: ObjectiveEvidence = {},
): ObjectiveMeasurements {
  const evidence = combineObjectiveEvidence(
    state,
    playerId,
    additionalEvidence,
  );
  const progress = state.progress.byPlayer[playerId];
  if (!progress || !state.players[playerId])
    throw new Error("Unknown objective player");
  const quarters = actualQuarters(state, playerId);
  const gaps: string[] = [];
  const holdings: ObjectiveHolding[] = [];
  const companies: ObjectiveMeasurements["companies"][number][] = [];
  const activeSources = new Set<string>(["cash"]);
  let grossAssets = state.finance.cashByPlayer[playerId]!;
  let liabilities = state.finance.livingArrearsByPlayer[playerId]!;
  let propertyValue = 0,
    propertyEquity = 0,
    propertyPrincipal = 0,
    controlledProperties = 0;
  let propertyOverdue = false;
  let overdue = liabilities > 0;
  const claims = evidence.propertyClaims ?? [];
  unique(claims.map((claim) => claim.assetId));
  for (const claim of claims) {
    if (state.finance.assetsById[claim.assetId]?.kind !== "property")
      throw new Error("Unknown objective property claim");
    Object.entries(claim)
      .filter(([key]) => key !== "assetId")
      .forEach(([, value]) => {
        nonnegative(value as number);
      });
    if (claim.pastDuePrincipalCents > claim.principalCents)
      throw new Error("Invalid objective property arrears");
  }
  const share = (total: number, owners: Readonly<Record<PlayerId, number>>) => {
    const absolute =
      allocateProportionalCents(
        cents(Math.abs(total)),
        owners as GameState["finance"]["assetsById"][AssetId]["ownershipByPlayerPpm"],
      )[playerId] ?? 0;
    return total < 0 ? -absolute : absolute;
  };
  for (const id of PUBLIC_MARKET_INSTRUMENT_IDS) {
    const value = state.finance.publicMarketsByPlayer[playerId]![id];
    grossAssets = sum([grossAssets, value]);
    if (value > 0) {
      holdings.push({
        id: `fund:${id}`,
        category: "public-markets",
        equityCents: value,
      });
      activeSources.add(`fund:${id}`);
    }
  }
  for (const asset of Object.values(state.finance.assetsById)) {
    const ownership = asset.ownershipByPlayerPpm[playerId] ?? 0;
    if (
      ownership <= 0 ||
      (asset.kind === "property" && asset.disposition === "sold")
    )
      continue;
    activeSources.add(`asset:${asset.id}`);
    if (asset.kind === "business") {
      const result = calculateBusinessEquity(asset, state.finance.loansById);
      const gross = sum([asset.enterpriseValueCents, asset.cashCents]);
      const companyLiabilities = sum([gross, -result.equityValueCents]);
      const equity = share(result.equityValueCents, asset.ownershipByPlayerPpm);
      grossAssets = sum([
        grossAssets,
        share(gross, asset.ownershipByPlayerPpm),
      ]);
      liabilities = sum([
        liabilities,
        share(companyLiabilities, asset.ownershipByPlayerPpm),
      ]);
      holdings.push({
        id: `asset:${asset.id}`,
        category: "business",
        equityCents: cents(equity),
      });
      const companyQuarterProfits = quarters.map((quarter) => {
        const observed = state.playerOrder.flatMap((id) =>
          state.progress.byPlayer[id]!.quarters.filter(
            (other) =>
              other.quarter === quarter.quarter &&
              other.companyOperatingProfitById[asset.id] !== undefined,
          ).map((other) => other.companyOperatingProfitById[asset.id]!),
        );
        if (new Set(observed).size > 1)
          throw new Error("Inconsistent actual company profit history");
        return observed[0] ?? 0;
      });
      const operatingProfit = sum(companyQuarterProfits);
      let positive = 0;
      for (const profit of [...companyQuarterProfits].reverse()) {
        if (profit <= 0) break;
        positive++;
      }
      const companyOverdue =
        asset.operatingArrearsCents > 0 ||
        (asset.workCompensation?.arrearsCents ?? 0) > 0 ||
        Object.values(state.finance.loansById).some(
          (loan) =>
            isAssetBorrower(loan) &&
            loan.borrowerAssetId === asset.id &&
            (loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0),
        );
      if (companyOverdue) activeSources.delete(`asset:${asset.id}`);
      companies.push({
        overdue: companyOverdue,
        assetId: asset.id,
        ownershipPpm: ownership,
        attributableEquityCents: cents(equity),
        enterpriseValueCents: asset.enterpriseValueCents,
        principalCents: result.debtPrincipalCents,
        annualOperatingProfitCents: operatingProfit,
        consecutivePositiveQuarters: positive,
      });
    } else {
      const extra = claims.find((claim) => claim.assetId === asset.id);
      const attributableValue = share(
        asset.marketValueCents,
        asset.ownershipByPlayerPpm,
      );
      const assetLiabilities = extra
        ? sum([
            extra.principalCents,
            extra.unpaidInterestCents,
            extra.operatingArrearsCents,
          ])
        : 0;
      const reserve = extra?.cashReserveCents ?? 0;
      const personalMortgage = sum(
        Object.values(state.finance.loansById)
          .filter(
            (loan) =>
              loan.kind === "legacy-bank-loan" &&
              loan.borrowerPlayerId === playerId &&
              loan.relatedAssetId === asset.id,
          )
          .map((loan) =>
            sum([loan.outstandingPrincipalCents, loan.unpaidInterestCents]),
          ),
      );
      const personalMortgagePrincipal = sum(
        Object.values(state.finance.loansById)
          .filter(
            (loan) =>
              loan.kind === "legacy-bank-loan" &&
              loan.borrowerPlayerId === playerId &&
              loan.relatedAssetId === asset.id,
          )
          .map((loan) => loan.outstandingPrincipalCents),
      );
      const equity = sum([
        attributableValue,
        share(reserve - assetLiabilities, asset.ownershipByPlayerPpm),
        -personalMortgage,
      ]);
      propertyValue = sum([propertyValue, attributableValue]);
      propertyEquity = sum([propertyEquity, equity]);
      propertyPrincipal = sum([
        propertyPrincipal,
        share(extra?.principalCents ?? 0, asset.ownershipByPlayerPpm),
        personalMortgagePrincipal,
      ]);
      grossAssets = sum([
        grossAssets,
        attributableValue,
        share(reserve, asset.ownershipByPlayerPpm),
      ]);
      liabilities = sum([
        liabilities,
        share(assetLiabilities, asset.ownershipByPlayerPpm),
      ]);
      holdings.push({
        id: `asset:${asset.id}`,
        category: "property",
        equityCents: equity,
      });
      if (
        ownership > OBJECTIVE_MEASUREMENT_RULES.controlExclusiveMinimumPpm &&
        equity >= OBJECTIVE_MEASUREMENT_RULES.materialEquityCents
      )
        controlledProperties++;
      const assetOverdue =
        (!!extra &&
          (extra.operatingArrearsCents > 0 ||
            extra.unpaidInterestCents > 0 ||
            extra.pastDuePrincipalCents > 0)) ||
        Object.values(state.finance.loansById).some(
          (loan) =>
            loan.kind === "legacy-bank-loan" &&
            loan.relatedAssetId === asset.id &&
            loan.borrowerPlayerId === playerId &&
            (loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0),
        );
      propertyOverdue ||= assetOverdue;
      if (assetOverdue) activeSources.delete(`asset:${asset.id}`);
    }
  }
  for (const loan of Object.values(state.finance.loansById)) {
    if (!isAssetBorrower(loan) && loan.borrowerPlayerId === playerId) {
      liabilities = sum([
        liabilities,
        loan.outstandingPrincipalCents,
        loan.unpaidInterestCents,
      ]);
      overdue ||=
        loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0;
    }
  }
  const financing = evidence.financing ?? [];
  unique(financing.map((loan) => loan.loanId));
  const knownLoanIds = new Set<string>();
  const financingByBorrower = new Map<string, number>();
  let book = 0,
    financingProfit = 0;
  const fundedTransactions = new Set<string>(),
    performingBorrowers = new Set<string>();
  const fundedDeals = new Map<
    string,
    {
      supplied: number;
      outstanding: number;
      current: boolean;
      borrowerId: string;
    }
  >();
  for (const loan of financing) {
    if (
      loan.lenderPlayerId !== playerId ||
      !loan.loanId ||
      !loan.beneficialBorrowerId ||
      !loan.fundedTransactionId ||
      !Number.isSafeInteger(loan.originatedQuarter) ||
      loan.originatedQuarter < 1 ||
      loan.originatedQuarter > state.currentQuarter
    )
      throw new Error("Invalid objective financing evidence");
    [
      loan.fundedPrincipalCents,
      loan.outstandingPrincipalCents,
      loan.unpaidInterestCents,
      loan.pastDuePrincipalCents,
      loan.feesPaidCents,
      loan.realizedLossesCents,
    ].forEach(nonnegative);
    if (
      loan.fundedPrincipalCents <= 0 ||
      loan.outstandingPrincipalCents > loan.fundedPrincipalCents ||
      loan.pastDuePrincipalCents > loan.outstandingPrincipalCents
    )
      throw new Error("Invalid objective financing balance");
    const canonical =
      state.finance.loansById[
        loan.loanId as keyof typeof state.finance.loansById
      ];
    if (
      canonical &&
      (canonical.kind !== "player-loan" ||
        canonical.lenderPlayerId !== playerId ||
        canonical.borrowerPlayerId !== loan.beneficialBorrowerId ||
        canonical.originalPrincipalCents !== loan.fundedPrincipalCents ||
        canonical.outstandingPrincipalCents !==
          loan.outstandingPrincipalCents ||
        canonical.unpaidInterestCents !== loan.unpaidInterestCents ||
        canonical.pastDuePrincipalCents !== loan.pastDuePrincipalCents)
    )
      throw new Error("Objective financing differs from canonical loan");
    knownLoanIds.add(loan.loanId);
    unique(loan.interestReceipts.map((receipt) => String(receipt.quarter)));
    for (const receipt of loan.interestReceipts) {
      [receipt.receivedCents, receipt.currentEarnedCents].forEach(nonnegative);
      if (
        !Number.isSafeInteger(receipt.quarter) ||
        receipt.quarter <= loan.originatedQuarter ||
        receipt.quarter > state.lastSettledQuarter ||
        receipt.currentEarnedCents > receipt.receivedCents
      )
        throw new Error("Unsettled objective interest evidence");
    }
    const current =
      loan.pastDuePrincipalCents === 0 && loan.unpaidInterestCents === 0;
    const collectible = current ? loan.outstandingPrincipalCents : 0;
    grossAssets = sum([grossAssets, collectible]);
    if (collectible > 0 && loan.funding === "non-circular")
      holdings.push({
        id: `borrower:${loan.beneficialBorrowerId}`,
        category: "financing",
        equityCents: cents(collectible),
      });
    if (loan.funding !== "non-circular") continue;
    financingProfit = sum([
      financingProfit,
      ...loan.interestReceipts.map((receipt) => receipt.receivedCents),
      -loan.feesPaidCents,
      -loan.realizedLossesCents,
    ]);
    const deal = fundedDeals.get(loan.fundedTransactionId);
    if (deal && deal.borrowerId !== loan.beneficialBorrowerId)
      throw new Error("Funded deal borrower mismatch");
    fundedDeals.set(loan.fundedTransactionId, {
      supplied: sum([deal?.supplied ?? 0, loan.fundedPrincipalCents]),
      outstanding: sum([deal?.outstanding ?? 0, collectible]),
      current: (deal?.current ?? true) && current,
      borrowerId: loan.beneficialBorrowerId,
    });
    if (!current || collectible === 0) continue;
    book = sum([book, collectible]);
    const recent = sum(
      loan.interestReceipts
        .filter(
          (receipt) =>
            receipt.quarter >
            state.lastSettledQuarter -
              OBJECTIVE_MEASUREMENT_RULES.lookbackQuarters,
        )
        .map((receipt) => receipt.currentEarnedCents),
    );
    financingByBorrower.set(
      `borrower:${loan.beneficialBorrowerId}`,
      sum([
        financingByBorrower.get(`borrower:${loan.beneficialBorrowerId}`) ?? 0,
        recent,
      ]),
    );
  }
  for (const [id, deal] of fundedDeals)
    if (
      deal.current &&
      deal.outstanding > 0 &&
      deal.supplied >=
        OBJECTIVE_QUALIFICATION_RULES.financierDealMinimumFundedCents
    ) {
      fundedTransactions.add(id);
      performingBorrowers.add(deal.borrowerId);
    }
  for (const loan of Object.values(state.finance.loansById))
    if (
      loan.kind === "player-loan" &&
      loan.lenderPlayerId === playerId &&
      !knownLoanIds.has(loan.id)
    ) {
      if (
        loan.outstandingPrincipalCents > 0 &&
        loan.pastDuePrincipalCents === 0 &&
        loan.unpaidInterestCents === 0
      ) {
        grossAssets = sum([grossAssets, loan.outstandingPrincipalCents]);
      }
      if (loan.originalPrincipalCents > 0)
        gaps.push(`financing-evidence:${loan.id}`);
    }
  const groupedHoldings = new Map<string, ObjectiveHolding>();
  for (const holding of holdings) {
    const old = groupedHoldings.get(holding.id);
    groupedHoldings.set(holding.id, {
      ...holding,
      equityCents: sum([old?.equityCents ?? 0, holding.equityCents]),
    });
  }
  const sources = new Map<string, ObjectiveIncomeSource>();
  let personalDebtAlreadyDeducted = 0;
  for (const quarter of quarters)
    for (const [id, source] of Object.entries(quarter.sourcesById)) {
      if (
        source.category === "financing" ||
        !activeSources.has(id) ||
        (id === "cash" && state.finance.cashByPlayer[playerId] === 0)
      )
        continue;
      personalDebtAlreadyDeducted = sum([
        personalDebtAlreadyDeducted,
        source.personalDebtServiceOwedCents ?? 0,
      ]);
      const expectedCategory =
        id === "cash"
          ? "cash"
          : id.startsWith("fund:")
            ? "public-markets"
            : state.finance.assetsById[id.slice(6) as AssetId]?.kind;
      if (source.category !== expectedCategory)
        throw new Error("Objective source differs from its canonical position");
      const old = sources.get(id);
      if (old && old.category !== source.category)
        throw new Error("Objective source changed category");
      sources.set(id, {
        id,
        category: source.category,
        annualReceivedCents: sum([
          old?.annualReceivedCents ?? 0,
          source.recurringReceivedCents,
          -source.debtServiceOwedCents,
        ]),
      });
    }
  for (const [id, amount] of financingByBorrower)
    sources.set(id, {
      id,
      category: "financing",
      annualReceivedCents: cents(amount),
    });
  let creditedGains = 0;
  const profitableTransactions = new Set<string>(),
    profitableCategories = new Set<string>(),
    profitableCounterparties = new Set<string>();
  const ledger = evidence.disposalLedger;
  if (ledger) {
    if (ledger.throughRevision !== state.revision)
      throw new Error("Stale objective disposal ledger");
    unique(
      ledger.entries.map((entry) => entry.disposalId ?? entry.transactionId),
    );
    const transactions = new Map<
      string,
      {
        credit: number;
        gross: number;
        categories: Set<string>;
        counterparties: Set<string>;
      }
    >();
    for (const entry of ledger.entries) {
      [
        entry.proceedsCents,
        entry.saleFeesCents,
        entry.acquisitionBasisCents,
        entry.assetCashReleasedCents ?? 0,
        entry.financingCostsCents ?? 0,
      ].forEach(nonnegative);
      if (
        !entry.transactionId ||
        !entry.underlyingAssetId ||
        !entry.counterparty.id ||
        !Number.isSafeInteger(entry.acquiredQuarter) ||
        entry.acquiredQuarter < 0 ||
        !Number.isSafeInteger(entry.soldQuarter) ||
        entry.soldQuarter < 1 ||
        entry.soldQuarter > state.currentQuarter ||
        entry.soldQuarter < entry.acquiredQuarter ||
        !Number.isSafeInteger(entry.settledExposureThroughQuarter) ||
        entry.settledExposureThroughQuarter < 0 ||
        entry.settledExposureThroughQuarter > state.lastSettledQuarter ||
        entry.settledExposureThroughQuarter >= entry.soldQuarter
      )
        throw new Error("Invalid objective disposal dates");
      const actualGain = sum([
        entry.proceedsCents,
        -entry.saleFeesCents,
        -entry.acquisitionBasisCents,
        entry.assetCashReleasedCents ?? 0,
        -(entry.financingCostsCents ?? 0),
      ]);
      let credited = Math.min(0, actualGain);
      const seasoned =
        entry.settledExposureThroughQuarter >=
        Math.max(1, entry.acquiredQuarter);
      if (actualGain > 0 && seasoned && entry.economicSubstance === "genuine") {
        if (entry.counterparty.kind === "player") {
          if (entry.referenceProceedsCents === null)
            gaps.push(`disposal-reference:${entry.transactionId}`);
          else {
            nonnegative(entry.referenceProceedsCents);
            credited = Math.max(
              0,
              sum([
                Math.min(entry.proceedsCents, entry.referenceProceedsCents),
                -entry.saleFeesCents,
                -entry.acquisitionBasisCents,
                entry.assetCashReleasedCents ?? 0,
                -(entry.financingCostsCents ?? 0),
              ]),
            );
          }
        } else credited = actualGain;
      }
      creditedGains = sum([creditedGains, credited]);
      const transaction = transactions.get(entry.transactionId) ?? {
        credit: 0,
        gross: 0,
        categories: new Set<string>(),
        counterparties: new Set<string>(),
      };
      transaction.credit = sum([transaction.credit, credited]);
      if (seasoned && entry.economicSubstance === "genuine") {
        const qualifiedGross =
          entry.counterparty.kind === "player"
            ? Math.min(entry.proceedsCents, entry.referenceProceedsCents ?? 0)
            : entry.proceedsCents;
        transaction.gross = sum([transaction.gross, qualifiedGross]);
      }
      if (credited > 0) {
        transaction.categories.add(entry.category);
        transaction.counterparties.add(
          `${entry.counterparty.kind}:${entry.counterparty.id}`,
        );
      }
      transactions.set(entry.transactionId, transaction);
    }
    for (const [id, transaction] of transactions)
      if (
        transaction.credit > 0 &&
        transaction.gross >=
          OBJECTIVE_QUALIFICATION_RULES.dealMakerDisposalMinimumGrossCents
      ) {
        profitableTransactions.add(id);
        for (const category of transaction.categories)
          profitableCategories.add(category);
        for (const counterparty of transaction.counterparties)
          profitableCounterparties.add(counterparty);
      }
  } else if (progress.disposals.length || progress.publicMarketDisposals.length)
    gaps.push("disposal-history-evidence");
  const annualEmployment =
    progress.labor.kind === "employment"
      ? sum(quarters.map((quarter) => quarter.employmentIncomeCents))
      : cents(0);
  const annualInvestment = sum(
    [...sources.values()].map((source) => source.annualReceivedCents),
  );
  const requiredPersonalDebt = sum(
    quarters.map((quarter) => quarter.debtServiceOwedCents),
  );
  const personalDebtNotYetDeducted = Math.max(
    0,
    requiredPersonalDebt - personalDebtAlreadyDeducted,
  );
  const currentOwnerWork =
    progress.labor.kind === "owner-work"
      ? sum(quarters.map((quarter) => quarter.recurringWorkIncomeCents))
      : 0;
  const living = sum(quarters.map((quarter) => quarter.livingCostOwedCents));
  const currentAnnualLiving = sum(
    Array(4).fill(
      state.finance.recurringByPlayer[playerId]!.quarterlyLivingExpenseCents,
    ),
  );
  return {
    playerId,
    completedQuarters: quarters.length,
    protectedAnnualLivingCostCents: cents(
      Math.max(currentAnnualLiving, living),
    ),
    liquidCapitalCents: sum([
      getAvailableCashCents(state, playerId),
      ...Object.values(state.finance.publicMarketsByPlayer[playerId]!),
    ]),
    cashCents: state.finance.cashByPlayer[playerId]!,
    grossAssetValueCents: cents(grossAssets),
    totalLiabilitiesCents: cents(liabilities),
    netWorthCents: sum([grossAssets, -liabilities]),
    annualEmploymentIncomeCents: annualEmployment,
    annualInvestmentIncomeCents: annualInvestment,
    annualInvestmentAfterPersonalDebtServiceCents: sum([
      annualInvestment,
      -personalDebtNotYetDeducted,
    ]),
    annualRequiredPersonalDebtServiceCents: requiredPersonalDebt,
    annualRecurringSurplusCents: sum([
      annualEmployment,
      currentOwnerWork,
      annualInvestment,
      -Math.max(currentAnnualLiving, living),
      -personalDebtNotYetDeducted,
    ]),
    propertyValueCents: cents(propertyValue),
    propertyEquityCents: cents(propertyEquity),
    propertyPrincipalCents: cents(propertyPrincipal),
    annualPropertyNetCashFlowCents: sum(
      [...sources.values()]
        .filter((source) => source.category === "property")
        .map((source) => source.annualReceivedCents),
    ),
    controlledProperties,
    propertyOverdue,
    holdings: [...groupedHoldings.values()],
    incomeSources: [...sources.values()],
    companies,
    performingFinancingBookCents: cents(book),
    earnedFinancingProfitCents: cents(financingProfit),
    distinctFundedTransactions: fundedTransactions.size,
    distinctPerformingBorrowers: performingBorrowers.size,
    creditedDealGainsCents: cents(creditedGains),
    profitableDisposals: profitableTransactions.size,
    profitableDisposalCategories: profitableCategories.size,
    profitableDisposalCounterparties: profitableCounterparties.size,
    executiveRole:
      progress.labor.kind === "employment" &&
      progress.labor.role === "executive",
    overdue,
    evidenceGaps: gaps,
  };
}
