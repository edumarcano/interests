import type {
  CommandAckResult,
  PlayerCommand,
  PlayerCommandEnvelope,
} from "@interests/shared";

export function createCommandEnvelope(
  command: PlayerCommand,
  expectedRevision: number,
  commandId: string = crypto.randomUUID(),
): PlayerCommandEnvelope {
  return {
    commandId,
    expectedRevision,
    command,
  };
}

export type CommandSender = (
  envelope: PlayerCommandEnvelope,
) => Promise<CommandAckResult>;
