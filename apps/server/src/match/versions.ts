import { ENGINE_VERSION } from "@interests/engine";
import { RULES_VERSION } from "@interests/rules";
import { SHARED_VERSION } from "@interests/shared";

export const PERSISTENCE_FORMAT_VERSION = "0.0.14";

export interface MatchVersionMetadata {
  readonly engineVersion: string;
  readonly rulesVersion: string;
  readonly sharedVersion: string;
  readonly persistenceFormatVersion: string;
}

export function getCurrentVersionMetadata(): MatchVersionMetadata {
  return {
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    sharedVersion: SHARED_VERSION,
    persistenceFormatVersion: PERSISTENCE_FORMAT_VERSION,
  };
}

export function isVersionCompatible(metadata: MatchVersionMetadata): boolean {
  return (
    metadata.engineVersion === ENGINE_VERSION &&
    metadata.rulesVersion === RULES_VERSION &&
    metadata.sharedVersion === SHARED_VERSION &&
    metadata.persistenceFormatVersion === PERSISTENCE_FORMAT_VERSION
  );
}
