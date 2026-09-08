import { z } from "zod";

export const ChooseObjectivePayloadSchema = z
  .object({
    type: z.literal("CHOOSE_OBJECTIVE"),
    objectiveId: z.string().min(1).max(64),
  })
  .strict();

export const PlayerCommandEnvelopeSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    command: ChooseObjectivePayloadSchema,
  })
  .strict();

export type ValidatedPlayerCommandEnvelope = z.infer<
  typeof PlayerCommandEnvelopeSchema
>;
