import type { LobbyRepository } from "../lobby/types.js";
import { loadAndValidatePersistedMatch } from "./snapshotLoader.js";
import type { MatchRepository } from "./types.js";

/**
 * Validates and recovers persisted ACTIVE matches on server process startup.
 *
 * For each active match:
 * - If the match envelope and snapshot validate against current runtime constants,
 *   sets the operational SERVER_RESTART pause reason.
 * - If validation fails or versions are incompatible, sets the SYSTEM_FAULT
 *   pause reason, preserving stored data and blocking gameplay.
 *
 * GameState is never modified, regenerated, or incremented by this procedure.
 */
export function recoverActiveMatchesOnStartup(
  matchRepository: MatchRepository,
  lobbyRepository: LobbyRepository,
): void {
  const activeMatches = matchRepository.listActiveMatches();

  for (const item of activeMatches) {
    const { match, roomCode } = item;
    try {
      const matchWithMembers = matchRepository.findMatchById(match.id);
      if (!matchWithMembers) {
        throw new Error("Match not found");
      }
      const roomInfo = matchRepository.findRoomWithMembers(roomCode);
      loadAndValidatePersistedMatch(matchWithMembers, roomInfo?.members);

      lobbyRepository.addPauseReason({
        roomCode,
        reason: "SERVER_RESTART",
      });
    } catch {
      lobbyRepository.addPauseReason({
        roomCode,
        reason: "SYSTEM_FAULT",
      });
    }
  }
}
