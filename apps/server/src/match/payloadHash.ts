import crypto from "node:crypto";
import { canonicalJsonStringify } from "@interests/shared";
import type { ValidatedPlayerCommandEnvelope } from "./schema.js";

/**
 * Computes SHA-256 digest of canonical economic command context for idempotency.
 */
export function computeCommandPayloadHash(
  envelope: ValidatedPlayerCommandEnvelope,
): string {
  const canonicalContext = {
    expectedRevision: envelope.expectedRevision,
    command: envelope.command,
  };

  const serialized = canonicalJsonStringify(canonicalContext);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}
