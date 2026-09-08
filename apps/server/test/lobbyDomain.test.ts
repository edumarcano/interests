import { describe, expect, it } from "vitest";
import {
  digestCredential,
  generateBearerToken,
} from "../src/lobby/credentials.js";
import { LobbyError } from "../src/lobby/errors.js";
import { normalizeAndValidateNickname } from "../src/lobby/nickname.js";
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
} from "../src/lobby/roomCode.js";

describe("Room Code Domain", () => {
  it("generates a 6-character code from the approved alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);

      // Verify ambiguous characters are excluded: I, O, 0, 1
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("normalizes lowercase and whitespace in room codes to uppercase", () => {
    expect(normalizeRoomCode("  abc234  ")).toBe("ABC234");
    expect(normalizeRoomCode("xy789z")).toBe("XY789Z");
  });

  it("validates room code format correctly", () => {
    expect(isValidRoomCode("ABC234")).toBe(true);
    expect(isValidRoomCode("ABC23")).toBe(false); // too short
    expect(isValidRoomCode("ABC2345")).toBe(false); // too long
    expect(isValidRoomCode("ABC23I")).toBe(false); // contains excluded 'I'
    expect(isValidRoomCode("ABC230")).toBe(false); // contains excluded '0'
    expect(isValidRoomCode("ABC231")).toBe(false); // contains excluded '1'
    expect(isValidRoomCode("ABC23O")).toBe(false); // contains excluded 'O'
  });
});

describe("Nickname Domain", () => {
  it("normalizes and validates clean nicknames", () => {
    const res = normalizeAndValidateNickname("Maya");
    expect(res.nickname).toBe("Maya");
    expect(res.nicknameKey).toBe("maya");
  });

  it("applies Unicode NFKC normalization and trims whitespace", () => {
    // NFKC turns fullwidth letters into standard ASCII letters
    const res = normalizeAndValidateNickname("  Ｍａｙａ  ");
    expect(res.nickname).toBe("Maya");
    expect(res.nicknameKey).toBe("maya");
  });

  it("collapses runs of whitespace into a single space", () => {
    const res = normalizeAndValidateNickname("Alice   Bob   Charlie");
    expect(res.nickname).toBe("Alice Bob Charlie");
    expect(res.nicknameKey).toBe("alice bob charlie");
  });

  it("allows supported punctuation: hyphen, underscore, apostrophe", () => {
    const res = normalizeAndValidateNickname("O'Connor_Smith-Jones");
    expect(res.nickname).toBe("O'Connor_Smith-Jones");
    expect(res.nicknameKey).toBe("o'connor_smith-jones");
  });

  it("allows Unicode letters and numbers", () => {
    const res = normalizeAndValidateNickname("Renée 42");
    expect(res.nickname).toBe("Renée 42");
    expect(res.nicknameKey).toBe("renée 42");
  });

  it("rejects nicknames with length less than 1 character", () => {
    expect(() => normalizeAndValidateNickname("")).toThrow(LobbyError);
    expect(() => normalizeAndValidateNickname("   ")).toThrow(LobbyError);
  });

  it("rejects nicknames exceeding 24 characters", () => {
    const longName = "A".repeat(25);
    expect(() => normalizeAndValidateNickname(longName)).toThrow(LobbyError);

    const validName = "A".repeat(24);
    expect(normalizeAndValidateNickname(validName).nickname).toHaveLength(24);
  });

  it("rejects control characters", () => {
    expect(() => normalizeAndValidateNickname("Maya\u0000")).toThrow(
      LobbyError,
    );
    expect(() => normalizeAndValidateNickname("Maya\u001F")).toThrow(
      LobbyError,
    );
    expect(() => normalizeAndValidateNickname("Maya\n")).toThrow(LobbyError);
  });

  it("rejects bidi and invisible formatting characters", () => {
    // \u200B is zero-width space (Cf category)
    expect(() => normalizeAndValidateNickname("Maya\u200B")).toThrow(
      LobbyError,
    );
    // \u202E is right-to-left override (Cf category)
    expect(() => normalizeAndValidateNickname("Maya\u202E")).toThrow(
      LobbyError,
    );
  });

  it("rejects unsupported punctuation, symbols, and HTML markup", () => {
    expect(() => normalizeAndValidateNickname("<script>")).toThrow(LobbyError);
    expect(() => normalizeAndValidateNickname("Maya@home")).toThrow(LobbyError);
    expect(() => normalizeAndValidateNickname("Maya$100")).toThrow(LobbyError);
    expect(() => normalizeAndValidateNickname("Maya#1")).toThrow(LobbyError);
    expect(() => normalizeAndValidateNickname("Maya/Admin")).toThrow(
      LobbyError,
    );
  });
});

describe("Credentials Domain", () => {
  it("generates 32-byte base64url random bearer tokens", () => {
    const token1 = generateBearerToken();
    const token2 = generateBearerToken();
    expect(token1).not.toBe(token2);
    // 32 bytes base64url is 43 characters
    expect(token1.length).toBe(43);
    expect(token1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("calculates deterministic SHA-256 digests", () => {
    const token = generateBearerToken();
    const digest1 = digestCredential(token);
    const digest2 = digestCredential(token);
    expect(digest1).toBe(digest2);
    // SHA-256 hex is 64 characters
    expect(digest1).toHaveLength(64);
    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
  });
});
