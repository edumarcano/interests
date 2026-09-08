import { assertGameState, type GameState } from "@finance-game/engine";
import { MatchError } from "./types.js";
import { isVersionCompatible, type MatchVersionMetadata } from "./versions.js";

/**
 * Validates and parses raw persisted snapshot JSON into authoritative GameState.
 *
 * Enforces the trust boundary between persisted JSON and memory state.
 * Throws MatchError if structural checks, assertGameState invariants, or version
 * compatibility checks fail.
 */
export function loadAndValidateSnapshot(
  rawJson: string,
  versionMeta?: MatchVersionMetadata,
): GameState {
  if (versionMeta && !isVersionCompatible(versionMeta)) {
    throw new MatchError(
      "MATCH_INCOMPATIBLE",
      `Incompatible match version metadata: engine=${versionMeta.engineVersion}, rules=${versionMeta.rulesVersion}, shared=${versionMeta.sharedVersion}, persistence=${versionMeta.persistenceFormatVersion}`,
      500,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new MatchError(
      "INVALID_SNAPSHOT",
      `Snapshot JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MatchError(
      "INVALID_SNAPSHOT",
      "Snapshot root must be a non-null object",
      500,
    );
  }

  const candidate = parsed as Record<string, unknown>;

  // Structural checks
  const requiredFields = [
    "gameId",
    "modeId",
    "revision",
    "phase",
    "currentQuarter",
    "playerOrder",
    "players",
    "finance",
    "economy",
    "random",
    "counters",
    "opportunitiesById",
  ];

  for (const field of requiredFields) {
    if (!(field in candidate) || candidate[field] === undefined) {
      throw new MatchError(
        "INVALID_SNAPSHOT",
        `Snapshot missing required structural field '${field}'`,
        500,
      );
    }
  }

  if (
    typeof candidate.gameId !== "string" ||
    typeof candidate.modeId !== "string" ||
    typeof candidate.revision !== "number" ||
    typeof candidate.phase !== "string" ||
    typeof candidate.currentQuarter !== "number" ||
    !Array.isArray(candidate.playerOrder) ||
    typeof candidate.players !== "object" ||
    candidate.players === null ||
    typeof candidate.finance !== "object" ||
    candidate.finance === null ||
    typeof candidate.economy !== "object" ||
    candidate.economy === null ||
    typeof candidate.random !== "object" ||
    candidate.random === null ||
    typeof candidate.counters !== "object" ||
    candidate.counters === null
  ) {
    throw new MatchError(
      "INVALID_SNAPSHOT",
      "Snapshot structural type assertion failed on core fields",
      500,
    );
  }

  const gameState = candidate as unknown as GameState;

  try {
    assertGameState(gameState);
  } catch (err) {
    throw new MatchError(
      "INVALID_SNAPSHOT",
      `GameState invariant assertion failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }

  return gameState;
}
