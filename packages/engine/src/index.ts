import { RULES_SHARED_VERSION, RULES_VERSION } from "@finance-game/rules";
import { SHARED_VERSION } from "@finance-game/shared";

export const ENGINE_VERSION = "0.0.1";

export const WORKSPACE_COMPATIBILITY = {
  engine: ENGINE_VERSION,
  rules: RULES_VERSION,
  shared: SHARED_VERSION,
  rulesShared: RULES_SHARED_VERSION,
} as const;
