export const SOCKET_PROTOCOL_VERSION = "1";
export const SESSION_COOKIE_NAME = "finance_game_session";

export const SOCKET_CLIENT_EVENTS = {
  SYNCHRONIZE: "session:synchronized",
  RESUME: "room:resume",
} as const;

export const SOCKET_SERVER_EVENTS = {
  BOOTSTRAP: "session:bootstrap",
  REPLACED: "session:replaced",
  PRESENCE: "room:presence",
} as const;

export const SOCKET_ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  NOT_A_ROOM_MEMBER: "NOT_A_ROOM_MEMBER",
  INCOMPATIBLE_PROTOCOL: "INCOMPATIBLE_PROTOCOL",
  INVALID_INPUT: "INVALID_INPUT",
  NOT_CURRENT_CONTROLLER: "NOT_CURRENT_CONTROLLER",
  NOT_ROOM_HOST: "NOT_ROOM_HOST",
  ROOM_NOT_READY: "ROOM_NOT_READY",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type SocketErrorCode =
  (typeof SOCKET_ERROR_CODES)[keyof typeof SOCKET_ERROR_CODES];
