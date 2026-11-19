import type { PlayerId } from "@interests/shared";
import { draftFundNpcLoan } from "../finance/npcLending";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type { GameState } from "../model/gameState";

/** Only the matched recipient can close the server-owned quote during their spotlight. */
export function fundRecurringLoan(
  state: GameState,
  player: PlayerId,
  opportunityId: string,
): ActionResult {
  const reject = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    code,
    state,
    journalEntries: [],
  });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (getActiveSpotlightPlayerId(state) !== player)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  const card = state.content.cardsByPlayer[player];
  if (!card || card.id !== opportunityId || card.targetPlayerId !== player)
    return reject("NOT_FOUND_OR_NOT_VISIBLE");
  if (
    card.status !== "available" ||
    card.createdQuarter !== state.currentQuarter
  )
    return reject("OPPORTUNITY_NOT_AVAILABLE");
  if (!card.npcFundingTerms) return reject("INVALID_ACTION");

  const funded = draftFundNpcLoan(state, player, card.npcFundingTerms, card.id);
  if (!funded.ok) return funded;
  const fundedLoanId = funded.journalEntries[0]?.relatedLoanId;
  if (!fundedLoanId) throw new Error("Missing funded market loan");
  const advanced = advanceSpotlight(
    {
      ...funded.state,
      content: {
        ...funded.state.content,
        cardsByPlayer: {
          ...funded.state.content.cardsByPlayer,
          [player]: { ...card, status: "funded", fundedLoanId },
        },
      },
    },
    player,
  );
  if (!advanced.ok) return reject(advanced.code);
  return {
    ...advanced,
    journalEntries: [...funded.journalEntries, ...advanced.journalEntries],
  };
}
