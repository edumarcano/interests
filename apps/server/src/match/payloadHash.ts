import crypto from "node:crypto";
import type { ValidatedPlayerCommandEnvelope } from "./schema.js";

/**
 * Deterministically serializes a JSON-compatible value by sorting object keys recursively.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`,
  );
  return `{${entries.join(",")}}`;
}

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
