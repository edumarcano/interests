import type {
  AcquireRecurringCommand,
  AssetId,
  PlayerId,
  RecurringAcquisitionQuote,
  RecurringAcquisitionRoute,
  RecurringPlayerLoanTerms,
  TransactionId,
} from "@interests/shared";
import {
  businessCashAccount,
  externalCashAccount,
  playerCashAccount,
  propertyCashAccount,
} from "../finance/account";
import { quoteAssetBankLoan, roundedRatio } from "../finance/bank";
import {
  type BusinessAcquisitionBankTerms,
  draftBusinessAcquisitionBankLoan,
  quoteBusinessAcquisitionBankLoan,
} from "../finance/businessBankOrigination";
import type { JournalEntry } from "../finance/journal";
import { originateConfirmedPlayerLoan } from "../finance/loans";
import { basisPoints, cents } from "../finance/money";
import {
  allocateProportionalCents,
  type OwnershipPpm,
  ownershipPpm,
} from "../finance/ownership";
import { type CashPostingRequest, postCash } from "../finance/posting";
import { calculatePropertyCashFlow } from "../finance/property";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type { Asset, AssetBankLoan, GameState } from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";
import {
  getRecurringAcquisitionTerms,
  type RecurringAcquisitionTerms,
} from "./recurringAcquisition";

function acquisitionAsset(
  terms: RecurringAcquisitionTerms,
  id: AssetId,
): Asset {
  const common = {
    id,
    cashCents: cents(0),
    ownershipByPlayerPpm: {
      [terms.recipientPlayerId]: ownershipPpm(1_000_000),
    },
  };
  return terms.kind === "business"
    ? {
        ...common,
        kind: "business",
        cashPolicyId: "retained-profit-v1",
        operatingModel: terms.operatingModel,
        operatingArrearsCents: cents(0),
        annualRevenueCents: cents(terms.facts.annualRevenueCents),
        annualOperatingProfitCents: cents(
          terms.facts.annualOperatingProfitCents,
        ),
        enterpriseValueCents: cents(terms.facts.enterpriseValueCents),
        debtPrincipalCents: cents(0),
      }
    : {
        ...common,
        kind: "property",
        marketKind: terms.marketKind,
        marketValueCents: cents(terms.facts.marketValueCents),
        scheduledQuarterlyRentCents: cents(
          terms.facts.scheduledQuarterlyRentCents,
        ),
        occupancyBps: basisPoints(terms.facts.occupancyBps),
        operatingExpenseRatioBps: basisPoints(
          terms.facts.operatingExpenseRatioBps,
        ),
        debtServiceReserveCents: cents(0),
      };
}
function companyBankTerms(
  state: GameState,
  terms: RecurringAcquisitionTerms,
  assetId: AssetId,
  principal: number,
  transactionId = nextDeterministicId("transaction", state.counters).id,
): BusinessAcquisitionBankTerms {
  return {
    transactionId,
    borrowerAssetId: assetId,
    leadPlayerId: terms.recipientPlayerId,
    principalCents: principal,
    acquisitionConsiderationCents: terms.askingPriceCents,
    remainingCompanyClosingOutflowCents: terms.totalCashRequiredCents,
  };
}

type RecurringCoFunding =
  | {
      readonly playerId: PlayerId;
      readonly ownershipPpm: number;
      readonly playerLoan?: never;
    }
  | {
      readonly playerId: PlayerId;
      readonly playerLoan: RecurringPlayerLoanTerms;
      readonly ownershipPpm?: never;
    };
interface RecurringAcquisitionFundingQuote {
  readonly leadCashCents: number;
  readonly closingTransactionId?: TransactionId;
  readonly partner?: RecurringCoFunding;
}

function withProjectedPlayerLoan(
  state: GameState,
  loan: Parameters<typeof originateConfirmedPlayerLoan>[2],
): GameState | null {
  // A quote tests contract arithmetic only. Named lenders' actual funds are checked on confirmation.
  const proposed = originateConfirmedPlayerLoan(
    {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [loan.lenderPlayerId]: cents(loan.principalCents),
      },
    },
    state.counters,
    loan,
  );
  return proposed.ok
    ? {
        ...state,
        counters: proposed.counters,
        finance: { ...state.finance, loansById: proposed.finance.loansById },
      }
    : null;
}

/** Only authored cash / maximum-bank alternatives are exposed; no principal-probing API. */
export function getRecurringAcquisitionQuotes(
  state: GameState,
  player: PlayerId,
  opportunityId: string,
  funding?: RecurringAcquisitionFundingQuote,
): readonly RecurringAcquisitionQuote[] {
  const { leadCashCents, closingTransactionId, partner } = funding ?? {};
  const resolved = getRecurringAcquisitionTerms(state, player, opportunityId);
  if (!resolved.ok || state.activeTransaction) return [];
  try {
    const terms = resolved.terms;
    const assetId = nextDeterministicId("asset", state.counters).id;
    if (state.finance.assetsById[assetId]) return [];
    const asset = {
      ...acquisitionAsset(terms, assetId),
      ownershipByPlayerPpm: partner?.ownershipPpm
        ? {
            [player]: ownershipPpm(1_000_000 - partner.ownershipPpm),
            [partner.playerId]: ownershipPpm(partner.ownershipPpm),
          }
        : { [player]: ownershipPpm(1_000_000) },
    };
    const shared = leadCashCents !== undefined;
    const available = getAvailableCashCents(state, player);
    const operatingCash =
      asset.kind === "business"
        ? roundedRatio(asset.annualOperatingProfitCents, 1, 4)
        : calculatePropertyCashFlow(asset).netOperatingIncomeCents;
    const withAsset: GameState = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: { ...state.finance.assetsById, [assetId]: asset },
      },
    };
    const calculate = (principal: number, route: RecurringAcquisitionRoute) => {
      const pricingState = terms.kind === "business" ? withAsset : state;
      const bankTerms = {
        purpose:
          terms.kind === "business"
            ? "business-acquisition"
            : "property-mortgage",
        qualifyingValueCents:
          terms.kind === "business"
            ? terms.askingPriceCents
            : terms.facts.marketValueCents,
        quarterlyOperatingIncomeCents: operatingCash,
        principalCents: principal,
        rateKind: route === "bank-variable" ? "variable" : "fixed",
      } as const;
      let funded = pricingState;
      let bank = quoteAssetBankLoan(funded, player, bankTerms);
      let fundingStable = true;
      // The cash requirement includes the bank payment, which affects the loan bridge's schedule.
      // Run the quote on the same post-contribution balance and installment as the actual close.
      if ((terms.kind === "business" && principal > 0) || partner?.playerLoan) {
        fundingStable = false;
        for (let step = 0; step < 8; step++) {
          const payment = principal ? bank.scheduledQuarterlyPaymentCents : 0;
          const contribution = cents(
            terms.totalCashRequiredCents + payment - principal,
          );
          funded =
            terms.kind === "business" && principal
              ? {
                  ...withAsset,
                  finance: {
                    ...withAsset.finance,
                    cashByPlayer: {
                      ...withAsset.finance.cashByPlayer,
                      [player]: cents(
                        Math.max(
                          0,
                          available - (leadCashCents ?? contribution),
                        ),
                      ),
                    },
                    assetsById: {
                      ...withAsset.finance.assetsById,
                      [assetId]: { ...asset, cashCents: contribution },
                    },
                  },
                }
              : pricingState;
          if (partner?.playerLoan) {
            const staged = withProjectedPlayerLoan(funded, {
              ...partner.playerLoan,
              principalCents: contribution - leadCashCents!,
              lenderPlayerId: partner.playerId,
              borrowerPlayerId: player,
              quarter: state.currentQuarter,
            });
            if (!staged) break;
            funded = staged;
          }
          const next = quoteAssetBankLoan(funded, player, bankTerms);
          const stable = next.annualRateBps === bank.annualRateBps;
          bank = next;
          if (stable) {
            fundingStable = true;
            break;
          }
        }
      }
      const reserve = principal ? bank.scheduledQuarterlyPaymentCents : 0;
      const grossFunding = cents(terms.totalCashRequiredCents + reserve);
      const required = cents(grossFunding - principal);
      const personal =
        principal || terms.kind === "property"
          ? bank.personalQuarterlyObligationsCents
          : 0;
      let canClose =
        fundingStable &&
        (!principal || bank.approved) &&
        available - (leadCashCents ?? required) >= personal &&
        (!shared || (leadCashCents > 0 && leadCashCents < required)) &&
        state.counters.journal <=
          Number.MAX_SAFE_INTEGER - ((principal ? 4 : 3) + (shared ? 1 : 0)) &&
        (closingTransactionId !== undefined ||
          state.counters.transaction < Number.MAX_SAFE_INTEGER) &&
        (!principal ||
          (state.counters.loan < Number.MAX_SAFE_INTEGER &&
            !state.finance.loansById[
              nextDeterministicId("loan", state.counters).id
            ]));
      if (canClose && principal && terms.kind === "business") {
        const verified = quoteBusinessAcquisitionBankLoan(
          funded,
          companyBankTerms(
            state,
            terms,
            assetId,
            principal,
            closingTransactionId,
          ),
        );
        canClose =
          verified.ok &&
          verified.quote.annualRateBps === bank.annualRateBps &&
          verified.quote.scheduledQuarterlyPaymentCents === reserve;
      }
      const quote: RecurringAcquisitionQuote = {
        id: [
          opportunityId,
          route,
          terms.askingPriceCents,
          terms.purchaseFeeCents,
          principal,
          bank.annualRateBps,
          reserve,
          required,
          personal,
        ].join(":"),
        opportunityId: terms.opportunityId,
        kind: terms.kind,
        ...(terms.kind === "property"
          ? { propertyMarketKind: terms.marketKind }
          : {}),
        route,
        askingPriceCents: terms.askingPriceCents,
        purchaseFeeCents: terms.purchaseFeeCents,
        principalCents: principal,
        annualRateBps: principal ? bank.annualRateBps : 0,
        termQuarters: principal ? bank.termQuarters : 0,
        quarterlyPaymentCents: reserve,
        assetReserveCents: reserve,
        personalReserveCents: personal,
        cashRequiredCents: required,
        canClose,
      };
      return { quote, approved: bank.approved, maxShareBps: bank.maxShareBps };
    };
    const quotes = [calculate(0, "cash").quote];
    for (const route of terms.kind === "business"
      ? (["bank-fixed"] as const)
      : (["bank-fixed", "bank-variable"] as const)) {
      let low = 0;
      let high = Math.min(
        terms.askingPriceCents,
        roundedRatio(
          terms.kind === "business"
            ? terms.askingPriceCents
            : terms.facts.marketValueCents,
          calculate(0, route).maxShareBps,
        ),
      );
      const maximum = calculate(high, route);
      if (high > 0 && maximum.approved) {
        quotes.push(maximum.quote);
        continue;
      }
      while (low < high) {
        const mid = low + Math.ceil((high - low) / 2);
        if (calculate(mid, route).approved) low = mid;
        else high = mid - 1;
      }
      if (low > 0) quotes.push(calculate(low, route).quote);
    }
    return quotes;
  } catch (error) {
    if (error instanceof RangeError) return [];
    throw error;
  }
}

/** Atomic secondary NPC purchase: actual cash, canonical debt, ownership and one spotlight. */
export function acquireRecurringOpportunity(
  state: GameState,
  player: PlayerId,
  command: AcquireRecurringCommand,
  shared?: {
    readonly transactionId: TransactionId;
    readonly leadCashCents: number;
    readonly partnerPlayerId: PlayerId;
  } & (
    | { readonly partnerOwnershipPpm: number; readonly playerLoan?: never }
    | {
        readonly playerLoan: RecurringPlayerLoanTerms;
        readonly partnerOwnershipPpm?: never;
      }
  ),
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (getActiveSpotlightPlayerId(state) !== player)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
  const resolved = getRecurringAcquisitionTerms(
    state,
    player,
    command.opportunityId,
  );
  if (!resolved.ok) return reject(resolved.code);
  const quote = getRecurringAcquisitionQuotes(
    state,
    player,
    command.opportunityId,
    shared
      ? {
          leadCashCents: shared.leadCashCents,
          closingTransactionId: shared.transactionId,
          partner: shared.playerLoan
            ? {
                playerId: shared.partnerPlayerId,
                playerLoan: shared.playerLoan,
              }
            : {
                playerId: shared.partnerPlayerId,
                ownershipPpm: shared.partnerOwnershipPpm,
              },
        }
      : undefined,
  ).find((item) => item.id === command.quoteId);
  if (!quote) return reject("INVALID_ACTION");
  if (!quote.canClose) return reject("INSUFFICIENT_FUNDS");
  try {
    const terms = resolved.terms;
    const next = nextDeterministicId("asset", state.counters);
    const closeId = shared
      ? { id: shared.transactionId, counters: next.counters }
      : nextDeterministicId("transaction", next.counters);
    const ownership: Readonly<Record<PlayerId, OwnershipPpm>> =
      shared?.partnerOwnershipPpm
        ? {
            [player]: ownershipPpm(1_000_000 - shared.partnerOwnershipPpm),
            [shared.partnerPlayerId]: ownershipPpm(shared.partnerOwnershipPpm),
          }
        : { [player]: ownershipPpm(1_000_000) };
    const contributions: Readonly<Record<PlayerId, number>> =
      shared?.partnerOwnershipPpm
        ? {
            [player]: shared.leadCashCents,
            [shared.partnerPlayerId]:
              quote.cashRequiredCents - shared.leadCashCents,
          }
        : { [player]: quote.cashRequiredCents };
    const initialAsset = {
      ...acquisitionAsset(terms, next.id),
      ownershipByPlayerPpm: ownership,
    };
    const asset: Asset =
      initialAsset.kind === "property"
        ? {
            ...initialAsset,
            debtServiceReserveCents: cents(quote.assetReserveCents),
          }
        : initialAsset;
    let draft: GameState = {
      ...state,
      counters: closeId.counters,
      finance: {
        ...state.finance,
        assetsById: { ...state.finance.assetsById, [asset.id]: asset },
      },
    };
    const journals: JournalEntry[] = [];
    if (shared?.playerLoan) {
      const loan = originateConfirmedPlayerLoan(draft.finance, draft.counters, {
        ...shared.playerLoan,
        principalCents: quote.cashRequiredCents - shared.leadCashCents,
        lenderPlayerId: shared.partnerPlayerId,
        borrowerPlayerId: player,
        quarter: state.currentQuarter,
        relatedTransactionId: closeId.id,
      });
      if (!loan.ok)
        return reject(
          loan.code === "LOAN_ID_EXHAUSTED"
            ? "COUNTER_EXHAUSTED"
            : "INSUFFICIENT_FUNDS",
        );
      draft = { ...draft, finance: loan.finance, counters: loan.counters };
      journals.push({
        ...loan.entry,
        relatedOpportunityId: terms.opportunityId,
        relatedAssetId: asset.id,
      });
    }
    const post = (input: Omit<CashPostingRequest, "quarter">) => {
      if (!input.amountCents) return;
      const result = postCash(draft.finance, draft.counters, {
        ...input,
        quarter: state.currentQuarter,
        relatedOpportunityId: terms.opportunityId,
        relatedTransactionId: closeId.id,
        relatedAssetId: asset.id,
      });
      if (!result.ok) throw new RangeError(result.code);
      draft = { ...draft, finance: result.finance, counters: result.counters };
      journals.push(result.entry);
    };
    const account =
      asset.kind === "business"
        ? businessCashAccount(asset.id)
        : propertyCashAccount(asset.id);
    for (const buyer of state.playerOrder) {
      const contribution = contributions[buyer];
      if (!contribution) continue;
      post({
        source: playerCashAccount(buyer),
        destination: account,
        amountCents: contribution,
        reason: "recurring-acquisition-equity",
      });
    }
    if (quote.principalCents) {
      if (asset.kind === "business") {
        const funded = draftBusinessAcquisitionBankLoan(draft, {
          ...companyBankTerms(
            state,
            terms,
            asset.id,
            quote.principalCents,
            closeId.id,
          ),
        });
        if (!funded.ok)
          return reject(
            funded.code === "DESTINATION_OVERFLOW" ||
              funded.code === "COUNTER_EXHAUSTED"
              ? funded.code
              : "BANK_UNDERWRITING_FAILED",
          );
        if (
          funded.quote.annualRateBps !== quote.annualRateBps ||
          funded.quote.scheduledQuarterlyPaymentCents !==
            quote.quarterlyPaymentCents
        )
          return reject("BANK_UNDERWRITING_FAILED");
        draft = funded.state;
        journals.push(...funded.journalEntries);
      } else {
        const nextLoan = nextDeterministicId("loan", draft.counters);
        const loan: AssetBankLoan = {
          id: nextLoan.id,
          kind: "asset-bank-loan",
          borrowerAssetId: asset.id,
          leadPlayerId: player,
          purpose: "property-mortgage",
          originalPrincipalCents: cents(quote.principalCents),
          outstandingPrincipalCents: cents(quote.principalCents),
          annualRateBps: basisPoints(quote.annualRateBps),
          pricing:
            quote.route === "bank-variable"
              ? {
                  kind: "variable",
                  spreadBps: quote.annualRateBps - state.economy.baseRateBps,
                }
              : { kind: "fixed" },
          scheduledQuarterlyPaymentCents: cents(quote.quarterlyPaymentCents),
          firstDueQuarter: state.currentQuarter + 1,
          maturityQuarter: state.currentQuarter + quote.termQuarters,
          termQuarters: quote.termQuarters,
          periodsProcessed: 0,
          interestPaidThroughQuarter: state.currentQuarter,
          paymentResetQuarter: state.currentQuarter + 1,
          paymentBasisPrincipalCents: cents(quote.principalCents),
          principalRepaidCents: cents(0),
          pastDuePrincipalCents: cents(0),
          unpaidInterestCents: cents(0),
          lastProcessedQuarter: 0,
        };
        if (draft.finance.loansById[loan.id])
          return reject("COUNTER_EXHAUSTED");
        draft = {
          ...draft,
          counters: nextLoan.counters,
          finance: {
            ...draft.finance,
            loansById: { ...draft.finance.loansById, [loan.id]: loan },
          },
        };
        post({
          source: externalCashAccount("bank"),
          destination: account,
          amountCents: quote.principalCents,
          reason: "asset-bank-loan-origination",
          relatedLoanId: loan.id,
        });
      }
    }
    post({
      source: account,
      destination: externalCashAccount("market"),
      amountCents: terms.askingPriceCents,
      reason: "recurring-acquisition-purchase",
    });
    post({
      source: account,
      destination: externalCashAccount("market"),
      amountCents: terms.purchaseFeeCents,
      reason: "recurring-acquisition-purchase-fee",
    });

    if (asset.kind === "business")
      draft = {
        ...draft,
        finance: {
          ...draft.finance,
          quarterStartBasis: {
            ...draft.finance.quarterStartBasis,
            businessesById: {
              ...draft.finance.quarterStartBasis.businessesById,
              [asset.id]: {
                cashPolicyId: asset.cashPolicyId,
                annualOperatingProfitCents: cents(0),
                ownershipByPlayerPpm: asset.ownershipByPlayerPpm,
              },
            },
          },
        },
      };
    const principalByPlayer = allocateProportionalCents(
      cents(quote.principalCents),
      ownership,
    );
    const progressByPlayer = { ...draft.progress.byPlayer };
    for (const buyer of state.playerOrder) {
      const contribution = contributions[buyer];
      if (!contribution) continue;
      const progress = progressByPlayer[buyer]!;
      progressByPlayer[buyer] = {
        ...progress,
        assetsById: {
          ...progress.assetsById,
          [asset.id]: {
            costCents: cents(
              contribution +
                (asset.kind === "property" ? principalByPlayer[buyer]! : 0),
            ),
            acquiredQuarter: state.currentQuarter,
            ownershipPpm: ownership[buyer]!,
            acquisition: {
              kind: "recurring-npc",
              opportunityId: terms.opportunityId,
              templateId: terms.templateId,
              transactionId: closeId.id,
              considerationCents: terms.askingPriceCents,
              feeCents: terms.purchaseFeeCents,
              bankPrincipalCents: quote.principalCents,
              reserveCents: quote.assetReserveCents,
              buyerCashCents: quote.cashRequiredCents,
              ...(shared?.partnerOwnershipPpm
                ? { buyerCashByPlayer: contributions }
                : {}),
            },
          },
        },
      };
    }
    draft = { ...draft, progress: { byPlayer: progressByPlayer } };
    const card = draft.content.cardsByPlayer[player]!;
    draft = {
      ...draft,
      content: {
        ...draft.content,
        cardsByPlayer: {
          ...draft.content.cardsByPlayer,
          [player]: { ...card, status: "acquired", acquiredAssetId: asset.id },
        },
      },
    };
    const advanced = advanceSpotlight(draft, player);
    if (!advanced.ok) return reject(advanced.code);
    return {
      ...advanced,
      journalEntries: [...journals, ...advanced.journalEntries],
    };
  } catch (error) {
    if (error instanceof RangeError) return reject("DESTINATION_OVERFLOW");
    throw error;
  }
}
