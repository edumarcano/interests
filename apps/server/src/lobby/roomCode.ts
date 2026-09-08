import crypto from "node:crypto";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

/**
 * Generates a 6-character uppercase room code using cryptographically secure randomness.
 * The approved alphabet excludes ambiguous characters (I, O, 0, 1) and has length 32 (2^5).
 * Masking with 0x1f provides an unbiased uniform distribution over the alphabet.
 */
export function generateRoomCode(): string {
  const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = (bytes[i] as number) & 0x1f;
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/**
 * Normalizes user-entered room codes case-insensitively.
 */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Validates that a normalized room code conforms to the 6-character approved alphabet.
 */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) {
    return false;
  }
  for (let i = 0; i < code.length; i++) {
    if (!ROOM_CODE_ALPHABET.includes(code[i] as string)) {
      return false;
    }
  }
  return true;
}
