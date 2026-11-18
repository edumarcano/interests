import { RULES_SHARED_VERSION, RULES_VERSION } from "@interests/rules";
import { SHARED_VERSION } from "@interests/shared";

export * from "./finance/account";
export * from "./finance/amortization";
export * from "./finance/business";
export * from "./finance/businessPerformance";
export * from "./finance/businessSettlement";
export * from "./finance/economy";
export * from "./finance/journal";
export * from "./finance/markets";
export * from "./finance/money";
export * from "./finance/operatingEconomy";
export * from "./finance/ownership";
export * from "./finance/settlement";
export * from "./game/actions.js";
export * from "./game/createGame.js";
export * from "./game/deterministicIds.js";
export * from "./game/playerCommand.js";
export * from "./game/playerView.js";
export * from "./game/round.js";
export * from "./game/setup.js";
export * from "./invariants/assertGameState.js";

export * from "./model/gameState";
export * from "./opportunities/model";
export * from "./opportunities/privateBusinessPurchase";
export * from "./opportunities/q1Fixture";
export * from "./opportunities/recurring";
export * from "./opportunities/recurringAcquisition";
export * from "./opportunities/view";
export * from "./random/prng";
export * from "./transactions/cashBusinessPurchase";
export * from "./transactions/model";
export * from "./transactions/reservations";

export const ENGINE_VERSION = "0.0.11";

export const WORKSPACE_COMPATIBILITY = {
  engine: ENGINE_VERSION,
  rules: RULES_VERSION,
  shared: SHARED_VERSION,
  rulesShared: RULES_SHARED_VERSION,
} as const;

export * from "./finance/bank";
export type {
  LoanPaymentOutcome,
  SettlementOutcome,
} from "./finance/obligations";
export * from "./finance/progress";
export * from "./finance/propertyActions";
export * from "./finance/publicMarketTrading";
export * from "./game/career";
export * from "./model/completionState";
