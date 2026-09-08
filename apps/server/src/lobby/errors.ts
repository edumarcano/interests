export type LobbyErrorCode =
  | "INVALID_INPUT"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_OPEN"
  | "ROOM_FULL"
  | "NICKNAME_TAKEN"
  | "ALREADY_MEMBER"
  | "UNAUTHENTICATED"
  | "NOT_A_ROOM_MEMBER"
  | "INVALID_RECOVERY_CREDENTIAL"
  | "ROOM_CODE_EXHAUSTED"
  | "RATE_LIMITED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

export class LobbyError extends Error {
  readonly code: LobbyErrorCode;
  readonly statusCode: number;

  constructor(code: LobbyErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "LobbyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
