import crypto from "node:crypto";

/**
 * Generates a high-entropy 32-byte random bearer token, base64url encoded.
 * Suitable for browser session credentials and private member recovery credentials.
 */
export function generateBearerToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Computes a SHA-256 hex digest of a bearer credential token.
 * Plaintext credentials must never be stored in persistent storage or logged.
 */
export function digestCredential(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
