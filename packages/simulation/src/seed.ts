export const DEFAULT_SIMULATION_SEED_PREFIX = "baseline-v1";

/**
 * Creates a deterministic indexed seed string for simulation batches.
 *
 * Requirements:
 * - seedPrefix must be a non-empty string;
 * - gameIndex must be a non-negative safe integer;
 * - zero-based gameIndex is padded with leading zeros to at least 6 digits;
 * - indices with 7 or more digits are never truncated.
 *
 * Format: `<seedPrefix>:<formattedIndex>`
 */
export function createSimulationSeed(
  seedPrefix: string,
  gameIndex: number,
): string {
  if (typeof seedPrefix !== "string" || seedPrefix.trim() === "") {
    throw new TypeError(
      `Simulation seedPrefix must be a non-empty string, got ${JSON.stringify(seedPrefix)}`,
    );
  }

  if (
    typeof gameIndex !== "number" ||
    !Number.isSafeInteger(gameIndex) ||
    gameIndex < 0
  ) {
    throw new RangeError(
      `Simulation gameIndex must be a non-negative safe integer, got ${String(gameIndex)}`,
    );
  }

  const formattedIndex = String(gameIndex).padStart(6, "0");
  return `${seedPrefix}:${formattedIndex}`;
}
