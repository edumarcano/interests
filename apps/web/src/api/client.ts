import type {
  ApiErrorResponse,
  CreateRoomResponse,
  GetMatchResponse,
  GetRoomResponse,
  JoinRoomResponse,
  PublicMarketTradeLeg,
  PublicMarketTradePreview,
  RecoverRoomResponse,
  RotateRecoveryCodeResponse,
  RuntimeInfoResponse,
  SessionBootstrapResponse,
  StartMatchResponse,
} from "@interests/shared";

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let code = "UNKNOWN_ERROR";
    let message = `Request failed with status ${response.status}`;
    try {
      const data = (await response.json()) as ApiErrorResponse;
      if (data?.error) {
        code = data.error.code || code;
        message = data.error.message || message;
      }
    } catch {
      // response wasn't JSON
    }
    throw new ApiClientError(code, message, response.status);
  }

  return response.json() as Promise<T>;
}

export async function createRoom(
  nickname: string,
): Promise<CreateRoomResponse> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nickname }),
  });
  return handleResponse<CreateRoomResponse>(res);
}

export async function joinRoom(
  roomCode: string,
  nickname: string,
): Promise<JoinRoomResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nickname }),
  });
  return handleResponse<JoinRoomResponse>(res);
}

export async function recoverRoom(
  roomCode: string,
  recoveryCode: string,
): Promise<RecoverRoomResponse> {
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(roomCode)}/recover`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ recoveryCode }),
    },
  );
  return handleResponse<RecoverRoomResponse>(res);
}

export async function getRoom(roomCode: string): Promise<GetRoomResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}`, {
    method: "GET",
    credentials: "include",
  });
  return handleResponse<GetRoomResponse>(res);
}

export async function getSession(): Promise<SessionBootstrapResponse> {
  const res = await fetch("/api/session", {
    method: "GET",
    credentials: "include",
  });
  return handleResponse<SessionBootstrapResponse>(res);
}

export async function rotateRecoveryCode(
  roomCode: string,
): Promise<RotateRecoveryCodeResponse> {
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(roomCode)}/recovery-code`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  return handleResponse<RotateRecoveryCodeResponse>(res);
}

export async function startMatch(
  roomCode: string,
): Promise<StartMatchResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
    method: "POST",
    credentials: "include",
  });
  return handleResponse<StartMatchResponse>(res);
}

export async function getMatch(roomCode: string): Promise<GetMatchResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/match`, {
    method: "GET",
    credentials: "include",
  });
  return handleResponse<GetMatchResponse>(res);
}

export async function getRuntimeInfo(): Promise<RuntimeInfoResponse> {
  const res = await fetch("/api/runtime-info", {
    method: "GET",
    credentials: "include",
  });
  return handleResponse<RuntimeInfoResponse>(res);
}

export async function previewPublicMarkets(
  roomCode: string,
  trades: readonly PublicMarketTradeLeg[],
): Promise<PublicMarketTradePreview> {
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(roomCode)}/public-market-preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ trades }),
    },
  );
  return (await handleResponse<{ preview: PublicMarketTradePreview }>(res))
    .preview;
}
