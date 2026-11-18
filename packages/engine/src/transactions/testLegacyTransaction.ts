import type { GameState } from "../model/gameState";

export function legacy(state: GameState) {
  const tx = state.activeTransaction;
  return tx?.kind === "cash-business-purchase" ? tx : null;
}
