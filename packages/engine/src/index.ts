import { RULES_SHARED_VERSION, RULES_VERSION } from "@finance-game/rules";
import { SHARED_VERSION } from "@finance-game/shared";

export * from "./finance/account";
export * from "./finance/economy";
export * from "./finance/journal";
export * from "./finance/markets";
export * from "./finance/money";
export * from "./finance/ownership";
export * from "./finance/settlement";
export * from "./game/actions";
export * from "./game/createGame";
export * from "./game/deterministicIds";
export * from "./game/setup";
export * from "./invariants/assertGameState";
export * from "./model/gameState";
export * from "./opportunities/model";
export * from "./opportunities/privateBusinessPurchase";
export * from "./opportunities/view";
export * from "./random/prng";
export * from "./transactions/cashBusinessPurchase";
export * from "./transactions/model";
export * from "./transactions/reservations";

export const ENGINE_VERSION = "0.0.1";

export const WORKSPACE_COMPATIBILITY = {
  engine: ENGINE_VERSION,
  rules: RULES_VERSION,
  shared: SHARED_VERSION,
  rulesShared: RULES_SHARED_VERSION,
} as const;
