import type {
  CommandAckResult,
  PlayerCommand,
  PlayerCommandEnvelope,
} from "@interests/shared";

/**
 * Generates a cryptographically strong RFC4122 UUIDv4 that works in both secure contexts (HTTPS, localhost)
 * and insecure plain-HTTP LAN contexts (e.g. mobile browser connecting to LAN IP http://192.168.x.x:5173).
 * crypto.randomUUID() is restricted to secure contexts, whereas crypto.getRandomValues() is available across all contexts.
 * Throws an explicit error if Web Crypto is unavailable; never falls back to Math.random().
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      try {
        return crypto.randomUUID();
      } catch {
        // Fall back to crypto.getRandomValues if randomUUID is restricted by environment/context
      }
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Set version 4: bits 12-15 of time_hi_and_version to 0100
      const b6 = bytes[6] ?? 0;
      bytes[6] = (b6 & 0x0f) | 0x40;
      // Set variant RFC4122: bits 6-7 of clock_seq_hi_and_reserved to 10
      const b8 = bytes[8] ?? 0;
      bytes[8] = (b8 & 0x3f) | 0x80;
      const hex: string[] = [];
      for (let i = 0; i < 16; i++) {
        const val = bytes[i] ?? 0;
        hex.push(val.toString(16).padStart(2, "0"));
      }
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }
  }
  throw new Error(
    "Cryptographically secure random number generation (Web Crypto API) is required for command IDs",
  );
}

export function isSameLogicalCommand(
  a: PlayerCommand,
  b: PlayerCommand,
): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "CHOOSE_OBJECTIVE" && b.type === "CHOOSE_OBJECTIVE") {
    return a.objectiveId === b.objectiveId;
  }
  return true;
}

export function createCommandEnvelope(
  command: PlayerCommand,
  expectedRevision: number,
  commandId: string = generateUUID(),
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
  commandId: string = generateUUID(),
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
