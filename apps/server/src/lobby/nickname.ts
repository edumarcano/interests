import { LobbyError } from "./errors.js";

export interface NormalizedNickname {
  nickname: string;
  nicknameKey: string;
}

// Allowed: Unicode letters, Unicode numbers, space, -, _, '
const VALID_NICKNAME_PATTERN = /^[\p{L}\p{N} \-_']+$/u;
// Reject control characters and invisible/bidi formatting characters explicitly
const CONTROL_OR_FORMAT_PATTERN = /[\p{C}]/u;

export function normalizeAndValidateNickname(
  input: string,
): NormalizedNickname {
  if (typeof input !== "string") {
    throw new LobbyError("INVALID_INPUT", "Nickname must be a string", 400);
  }

  // 1. Unicode NFKC normalization
  const nfkc = input.normalize("NFKC");

  // 2. Reject control characters and invisible/bidi formatting characters
  if (CONTROL_OR_FORMAT_PATTERN.test(nfkc)) {
    throw new LobbyError(
      "INVALID_INPUT",
      "Nickname contains unsupported control or formatting characters",
      400,
    );
  }

  // 3. Trim leading/trailing whitespace
  const trimmed = nfkc.trim();

  // 4. Collapse runs of ordinary whitespace to one space
  const collapsed = trimmed.replace(/\s+/gu, " ");

  // 5. Validate length: 1 through 24 characters
  if (collapsed.length < 1 || collapsed.length > 24) {
    throw new LobbyError(
      "INVALID_INPUT",
      "Nickname must be between 1 and 24 characters",
      400,
    );
  }

  // 6. Validate allowed character set
  if (!VALID_NICKNAME_PATTERN.test(collapsed)) {
    throw new LobbyError(
      "INVALID_INPUT",
      "Nickname may only contain letters, numbers, spaces, hyphens, underscores, and apostrophes",
      400,
    );
  }

  // 7. Canonical nickname_key for case-insensitive room uniqueness
  const nicknameKey = collapsed.toLowerCase();

  return {
    nickname: collapsed,
    nicknameKey,
  };
}
