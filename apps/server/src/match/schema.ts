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
        instrumentId: z.enum([
          "broad-market-fund",
          "growth-fund",
          "income-defensive-fund",
        ]),
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

export const PlayerCommandPayloadSchema = z.discriminatedUnion("type", [
  TradePublicMarketsPayloadSchema,
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
