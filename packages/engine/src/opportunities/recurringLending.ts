import type { LoanId, PlayerId } from "@interests/shared";
import type { Cents } from "../finance/money";
import { draftFundNpcLoan } from "../finance/npcLending";
import type { ActionErrorCode, ActionResult } from "../game/actions";
import type { EconomicActionFinalizer } from "../game/finalization";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type { GameState } from "../model/gameState";

export interface RecurringLendingRealizedFacts {
  readonly kind: "market-lending";
  readonly loanId: LoanId;
  readonly fundedPrincipalCents: Cents;
}

/** Only the matched recipient can close the server-owned quote during their spotlight. */
export function fundRecurringLoan(
  state: GameState,
  player: PlayerId,
  opportunityId: string,
  finalize?: EconomicActionFinalizer<RecurringLendingRealizedFacts>,
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
  const draft: GameState = {
    ...funded.state,
    content: {
      ...funded.state.content,
      cardsByPlayer: {
        ...funded.state.content.cardsByPlayer,
        [player]: { ...card, status: "funded", fundedLoanId },
      },
    },
  };
  if (finalize) {
    const loan = draft.finance.loansById[fundedLoanId];
    if (loan?.kind !== "npc-loan")
      throw new Error("Missing canonical funded market loan");
    const result = finalize({
      before: state,
      draft,
      actorPlayerId: player,
      journalEntries: funded.journalEntries,
      facts: {
        kind: "market-lending",
        loanId: loan.id,
        fundedPrincipalCents: loan.originalPrincipalCents,
      },
    });
    return result.ok ? result : reject(result.code);
  }
  const advanced = advanceSpotlight(draft, player);
  if (!advanced.ok) return reject(advanced.code);
  return {
    ...advanced,
    journalEntries: [...funded.journalEntries, ...advanced.journalEntries],
  };
}
