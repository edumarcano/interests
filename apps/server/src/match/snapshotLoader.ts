import { assertGameState, type GameState } from "@interests/engine";
import type { RoomMemberId } from "@interests/shared";
import { MatchError, type MatchWithMembers } from "./types.js";
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

/**
 * Validates a persisted match envelope in full:
 * 1. Version metadata compatibility;
 * 2. Snapshot JSON parse, structural checks, and assertGameState;
 * 3. Cross-record envelope invariants (snapshot.gameId === match.id, snapshot.modeId === match.modeId, snapshot.revision === match.revision);
 * 4. match_members invariants: exactly 4 members, mapped to snapshot.playerOrder by playerOrder 0..3, unique member IDs,
 *    and matching room members if provided.
 */
export function loadAndValidatePersistedMatch(
  matchWithMembers: MatchWithMembers,
  roomMembers?: readonly { id: RoomMemberId; joinOrder: number }[],
): GameState {
  const versions: MatchVersionMetadata = {
    engineVersion: matchWithMembers.match.engineVersion,
    rulesVersion: matchWithMembers.match.rulesVersion,
    sharedVersion: matchWithMembers.match.sharedVersion,
    persistenceFormatVersion: matchWithMembers.match.persistenceFormatVersion,
  };

  const gameState = loadAndValidateSnapshot(
    matchWithMembers.match.snapshotJson,
    versions,
  );

  // Cross-record invariants
  if ((gameState.gameId as string) !== (matchWithMembers.match.id as string)) {
    throw new MatchError(
      "INVALID_MATCH_ENVELOPE",
      `Snapshot gameId '${gameState.gameId}' does not match match record id '${matchWithMembers.match.id}'`,
      500,
    );
  }

  if (gameState.modeId !== matchWithMembers.match.modeId) {
    throw new MatchError(
      "INVALID_MATCH_ENVELOPE",
      `Snapshot modeId '${gameState.modeId}' does not match match record modeId '${matchWithMembers.match.modeId}'`,
      500,
    );
  }

  if (gameState.revision !== matchWithMembers.match.revision) {
    throw new MatchError(
      "INVALID_MATCH_ENVELOPE",
      `Snapshot revision ${gameState.revision} does not match match record revision ${matchWithMembers.match.revision}`,
      500,
    );
  }

  // match_members invariants
  if (matchWithMembers.members.length !== 4) {
    throw new MatchError(
      "INVALID_MATCH_MEMBERS",
      `Persisted match has ${matchWithMembers.members.length} members; exactly 4 required`,
      500,
    );
  }

  if (gameState.playerOrder.length !== 4) {
    throw new MatchError(
      "INVALID_MATCH_MEMBERS",
      `Snapshot playerOrder has ${gameState.playerOrder.length} players; exactly 4 required`,
      500,
    );
  }

  if (roomMembers?.length !== 4) {
    throw new MatchError(
      "INVALID_MATCH_MEMBERS",
      `Room has ${roomMembers?.length ?? 0} members; exactly 4 required for match`,
      500,
    );
  }

  const sortedRoomMembers = [...roomMembers].sort(
    (a, b) => a.joinOrder - b.joinOrder,
  );
  const sortedMatchMembers = [...matchWithMembers.members].sort(
    (a, b) => a.playerOrder - b.playerOrder,
  );

  const seenRoomMembers = new Set<string>();
  const seenPlayerIds = new Set<string>();

  for (let idx = 0; idx < 4; idx++) {
    const rm = sortedRoomMembers[idx];
    const mm = sortedMatchMembers[idx];

    if (!rm || rm.joinOrder !== idx) {
      throw new MatchError(
        "INVALID_MATCH_MEMBERS",
        `Invalid room member join order mapping at index ${idx}`,
        500,
      );
    }

    if (!mm || mm.playerOrder !== idx) {
      throw new MatchError(
        "INVALID_MATCH_MEMBERS",
        `Invalid match member player order mapping at index ${idx}`,
        500,
      );
    }

    // Exact one-to-one mapping: (room member joinOrder N) -> (match member playerOrder N) -> GameState.playerOrder[N]
    if (mm.roomMemberId !== rm.id) {
      throw new MatchError(
        "INVALID_MATCH_MEMBERS",
        `Room member with joinOrder ${idx} ('${rm.id}') does not match match member with playerOrder ${idx} ('${mm.roomMemberId}')`,
        500,
      );
    }

    if (mm.playerId !== gameState.playerOrder[idx]) {
      throw new MatchError(
        "INVALID_MATCH_MEMBERS",
        `Member at order ${idx} maps to player '${mm.playerId}', but snapshot playerOrder has '${gameState.playerOrder[idx]}'`,
        500,
      );
    }

    if (seenRoomMembers.has(rm.id)) {
      throw new MatchError(
        "INVALID_MATCH_MEMBERS",
        `Duplicate room member '${rm.id}' in room members`,
        500,
      );
    }
    seenRoomMembers.add(rm.id);

    if (seenPlayerIds.has(mm.playerId)) {
      throw new MatchError(
        "INVALID_MATCH_MEMBERS",
        `Duplicate player id '${mm.playerId}' in match members`,
        500,
      );
    }
    seenPlayerIds.add(mm.playerId);
  }

  return gameState;
}
