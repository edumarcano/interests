import { captureBusinessBasis } from "../src/finance/businessSettlement";
import {
  capturePropertyBasis,
  captureRecurringBasis,
  createProgress,
} from "../src/finance/progress";
import type { GameState } from "../src/model/gameState";

/** Stage explicit synthetic opening finances, preserving any actual settled history. */
export function stageOpeningFixture(state: GameState): GameState {
  const opening = createProgress(state.finance, state.playerOrder);
  return {
    ...state,
    finance: {
      ...state.finance,
      quarterStartBasis: {
        ...state.finance.quarterStartBasis,
        propertiesById: capturePropertyBasis(state.finance.assetsById),
        businessesById: captureBusinessBasis(state.finance.assetsById),
        recurringByPlayer: captureRecurringBasis(
          state.finance.recurringByPlayer,
        ),
      },
    },
    progress: {
      byPlayer: Object.fromEntries(
        state.playerOrder.map((id) => [
          id,
          {
            ...opening.byPlayer[id]!,
            quarters: state.progress.byPlayer[id]!.quarters,
          },
        ]),
      ),
    },
  };
}
