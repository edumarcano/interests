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

export interface PendingCommandState {
  readonly envelope: PlayerCommandEnvelope;
  readonly createdAt: number;
  attempts: number;
}

export function createPendingCommand(
  command: PlayerCommand,
  expectedRevision: number,
  commandId: string = crypto.randomUUID(),
): PendingCommandState {
  return {
    envelope: createCommandEnvelope(command, expectedRevision, commandId),
    createdAt: Date.now(),
    attempts: 1,
  };
}

export type CommandSender = (
  envelope: PlayerCommandEnvelope,
) => Promise<CommandAckResult>;
