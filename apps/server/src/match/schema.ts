import { PUBLIC_MARKET_INSTRUMENT_IDS } from "@interests/rules";
import { z } from "zod";

export const ChooseObjectivePayloadSchema = z
  .object({
    type: z.literal("CHOOSE_OBJECTIVE"),
    objectiveId: z.string().min(1).max(64),
  })
  .strict();

export const BeginRoundPayloadSchema = z
  .object({
    type: z.literal("BEGIN_ROUND"),
  })
  .strict();

export const PassSpotlightPayloadSchema = z
  .object({
    type: z.literal("PASS_SPOTLIGHT"),
  })
  .strict();

export const InvestigateOpportunityPayloadSchema = z
  .object({
    type: z.literal("INVESTIGATE_OPPORTUNITY"),
    opportunityId: z.string().min(1).max(64),
  })
  .strict();

export const PursueBusinessCashPayloadSchema = z
  .object({
    type: z.literal("PURSUE_BUSINESS_CASH"),
    opportunityId: z.string().min(1).max(64),
  })
  .strict();

export const PursueBusinessWithPlayerLoanPayloadSchema = z
  .object({
    type: z.literal("PURSUE_BUSINESS_WITH_PLAYER_LOAN"),
    opportunityId: z.string().min(1).max(64),
    buyerCashContributionCents: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    requestedPrincipalCents: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const SubmitPlayerLoanOfferPayloadSchema = z
  .object({
    type: z.literal("SUBMIT_PLAYER_LOAN_OFFER"),
    transactionId: z.string().min(1).max(64),
    annualRateBps: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    termQuarters: z.number().int().min(2).max(8),
  })
  .strict();

export const AcceptPlayerLoanOfferPayloadSchema = z
  .object({
    type: z.literal("ACCEPT_PLAYER_LOAN_OFFER"),
    transactionId: z.string().min(1).max(64),
    expectedTermsRevision: z.number().int().positive(),
  })
  .strict();

export const CloseBusinessPurchasePayloadSchema = z
  .object({
    type: z.literal("CLOSE_BUSINESS_PURCHASE"),
    transactionId: z.string().min(1).max(64),
  })
  .strict();

export const CancelActiveTransactionPayloadSchema = z
  .object({
    type: z.literal("CANCEL_ACTIVE_TRANSACTION"),
    transactionId: z.string().min(1).max(64),
  })
  .strict();

export const PublicMarketTradesSchema = z
  .array(
    z
      .object({
        instrumentId: z.enum(PUBLIC_MARKET_INSTRUMENT_IDS),
        buyCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        sellCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
  )
  .min(1)
  .max(3);
export const PublicMarketPreviewSchema = z
  .object({ trades: PublicMarketTradesSchema })
  .strict();
export const TradePublicMarketsPayloadSchema = z
  .object({
    type: z.literal("TRADE_PUBLIC_MARKETS"),
    trades: PublicMarketTradesSchema,
  })
  .strict();

export const AcceptCareerOfferPayloadSchema = z
  .object({
    type: z.literal("ACCEPT_CAREER_OFFER"),
    offerId: z.string().min(1).max(200),
  })
  .strict();
export const ResignLaborPayloadSchema = z
  .object({ type: z.literal("RESIGN_LABOR") })
  .strict();

export const PursueFinalePayloadSchema = z
  .object({
    type: z.literal("PURSUE_FINALE"),
    action: z.discriminatedUnion("type", [
      ResignLaborPayloadSchema,
      AcceptCareerOfferPayloadSchema,
      z.object({ type: z.literal("CONFIRM_INDEPENDENCE") }).strict(),
    ]),
  })
  .strict();

const transactionKey = z.string().min(1).max(128);
const positiveCents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ownershipUnits = z.number().int().min(1).max(1_000_000);
const loanSlot = z.number().int().min(0).max(3);
const termsBinding = {
  transactionId: transactionKey,
  expectedTermsRevision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
};
const BusinessCapitalTermsSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("request-equity"),
      requests: z
        .array(
          z
            .object({
              amountCents: positiveCents,
              invitedInvestorId: transactionKey.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
  z
    .object({
      kind: z.literal("company-expansion"),
      investmentCents: positiveCents,
    })
    .strict(),
  z
    .object({
      kind: z.literal("secondary-stake-sale"),
      buyerPlayerId: transactionKey,
      sellerPlayerId: transactionKey,
      priceCents: positiveCents,
      ownershipPpm: ownershipUnits,
      loanRequests: z
        .array(
          z
            .object({
              principalCents: positiveCents,
              invitedLenderId: transactionKey.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(4)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("primary-issuance"),
      contributions: z
        .array(
          z
            .object({
              playerId: transactionKey,
              amountCents: positiveCents,
              postMoneyOwnershipPpm: ownershipUnits,
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
]);
export const SetFocusPayloadSchema = z
  .object({
    type: z.literal("SET_FOCUS"),
    focus: z.enum([
      "general",
      "business",
      "property",
      "career",
      "markets",
      "financing",
    ]),
  })
  .strict();

const JointPropertyTermsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sale") }).strict(),
  z.object({ kind: z.literal("renovation") }).strict(),
  z
    .object({
      kind: z.literal("refinance"),
      rateKind: z.enum(["fixed", "variable"]),
    })
    .strict(),
]);
const JointPropertyOpenSchema = z
  .object({
    type: z.literal("OPEN_JOINT_PROPERTY"),
    assetId: z.string().min(1).max(64),
    terms: JointPropertyTermsSchema,
  })
  .strict();
const JointPropertyReviseSchema = z
  .object({
    type: z.literal("REVISE_JOINT_PROPERTY"),
    transactionId: z.string().min(1).max(64),
    expectedTermsRevision: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    terms: JointPropertyTermsSchema,
  })
  .strict();
const JointPropertyBoundFields = {
  transactionId: z.string().min(1).max(64),
  expectedTermsRevision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
};
const PropertyAcquisitionTermsSchema = z
  .object({
    catalogueId: z.string().min(1).max(64),
    principalCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    rateKind: z.enum(["fixed", "variable"]),
    buyers: z
      .array(
        z
          .object({
            playerId: z.string().min(1).max(64),
            cashContributionCents: z
              .number()
              .int()
              .positive()
              .max(Number.MAX_SAFE_INTEGER),
            ownershipPpm: z.number().int().positive().max(1_000_000),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();

export const RecurringAcquisitionPreviewSchema = z
  .object({ opportunityId: z.string().min(1).max(128) })
  .strict();
export const PlayerCommandPayloadSchema = z.discriminatedUnion("type", [
  PursueFinalePayloadSchema,
  z
    .object({
      type: z.literal("SELL_RECURRING_BUSINESS"),
      opportunityId: z.string().min(1).max(64),
      quoteId: z.string().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal("OPEN_PROPERTY_ACQUISITION"),
      terms: PropertyAcquisitionTermsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("REVISE_PROPERTY_ACQUISITION"),
      ...JointPropertyBoundFields,
      terms: PropertyAcquisitionTermsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("CONFIRM_PROPERTY_ACQUISITION"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("WITHDRAW_PROPERTY_ACQUISITION"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("CLOSE_PROPERTY_ACQUISITION"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL_PROPERTY_ACQUISITION"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  JointPropertyOpenSchema,
  JointPropertyReviseSchema,
  z
    .object({
      type: z.literal("CONFIRM_JOINT_PROPERTY"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("WITHDRAW_JOINT_PROPERTY"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("CLOSE_JOINT_PROPERTY"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL_JOINT_PROPERTY"),
      ...JointPropertyBoundFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("OFFER_BUSINESS_EQUITY"),
      ...termsBinding,
      slot: loanSlot,
      postMoneyOwnershipPpm: ownershipUnits,
    })
    .strict(),
  z
    .object({
      type: z.literal("SELECT_BUSINESS_EQUITY"),
      ...termsBinding,
      slot: loanSlot,
      investorPlayerId: transactionKey,
    })
    .strict(),
  z
    .object({
      type: z.literal("WITHDRAW_BUSINESS_EQUITY"),
      ...termsBinding,
      slot: loanSlot,
      investorPlayerId: transactionKey,
    })
    .strict(),
  z
    .object({
      type: z.literal("ACQUIRE_RECURRING_OPPORTUNITY"),
      opportunityId: z.string().min(1).max(128),
      quoteId: z.string().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal("FUND_RECURRING_LOAN"),
      opportunityId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal("OPEN_BUSINESS_AUCTION"),
      assetId: transactionKey,
      ownershipPpm: ownershipUnits,
      minimumBidCents: positiveCents,
    })
    .strict(),
  z
    .object({
      type: z.literal("RESPOND_BUSINESS_AUCTION"),
      transactionId: transactionKey,
      bidCents: positiveCents.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("OFFER_BUSINESS_LOAN"),
      ...termsBinding,
      slot: loanSlot,
      annualRateBps: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
      termQuarters: z.number().int().min(2).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal("SELECT_BUSINESS_LOAN"),
      ...termsBinding,
      slot: loanSlot,
      lenderPlayerId: transactionKey,
    })
    .strict(),
  z
    .object({
      type: z.literal("WITHDRAW_BUSINESS_LOAN"),
      ...termsBinding,
      slot: loanSlot,
      lenderPlayerId: transactionKey,
    })
    .strict(),
  z
    .object({
      type: z.literal("OPEN_BUSINESS_CAPITAL"),
      assetId: transactionKey,
      terms: BusinessCapitalTermsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("REVISE_BUSINESS_CAPITAL"),
      ...termsBinding,
      terms: BusinessCapitalTermsSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("CONFIRM_BUSINESS_CAPITAL"), ...termsBinding })
    .strict(),
  z
    .object({ type: z.literal("WITHDRAW_BUSINESS_CAPITAL"), ...termsBinding })
    .strict(),
  z
    .object({ type: z.literal("CLOSE_BUSINESS_CAPITAL"), ...termsBinding })
    .strict(),
  z
    .object({
      type: z.literal("EXPAND_BUSINESS"),
      assetId: z.string().min(1).max(128),
      investmentCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      ownerContributionCents: positiveCents.optional(),
    })
    .strict(),
  TradePublicMarketsPayloadSchema,
  AcceptCareerOfferPayloadSchema,
  ResignLaborPayloadSchema,
  z
    .object({
      type: z.literal("BUY_PROPERTY"),
      catalogueId: z.string().min(1).max(64),
      principalCents: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
      rateKind: z.enum(["fixed", "variable"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("SELL_PROPERTY"),
      assetId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal("RENOVATE_PROPERTY"),
      assetId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal("REFINANCE_PROPERTY"),
      assetId: z.string().min(1).max(64),
      rateKind: z.enum(["fixed", "variable"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("FUND_PROPERTY_RESERVE"),
      assetId: z.string().min(1).max(64),
      amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  SetFocusPayloadSchema,
  ChooseObjectivePayloadSchema,
  BeginRoundPayloadSchema,
  PassSpotlightPayloadSchema,
  InvestigateOpportunityPayloadSchema,
  PursueBusinessCashPayloadSchema,
  PursueBusinessWithPlayerLoanPayloadSchema,
  SubmitPlayerLoanOfferPayloadSchema,
  AcceptPlayerLoanOfferPayloadSchema,
  CloseBusinessPurchasePayloadSchema,
  CancelActiveTransactionPayloadSchema,
]);

export const PlayerCommandEnvelopeSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    command: PlayerCommandPayloadSchema,
  })
  .strict();

export type ValidatedPlayerCommandEnvelope = z.infer<
  typeof PlayerCommandEnvelopeSchema
>;
