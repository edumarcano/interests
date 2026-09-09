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

export const PlayerCommandPayloadSchema = z.discriminatedUnion("type", [
  ChooseObjectivePayloadSchema,
  BeginRoundPayloadSchema,
  PassSpotlightPayloadSchema,
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
