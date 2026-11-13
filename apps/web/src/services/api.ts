import type { HealthResponse } from "../types";

export class ApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.PUBLIC_API_URL?.trim();
  return configured ? configured : "http://localhost:8000/api/v1";
}

function extractErrorDetail(errorBody: unknown, fallback: string): string {
  if (typeof errorBody !== "object" || errorBody === null || !("detail" in errorBody)) {
    return fallback;
  }

  const { detail } = errorBody;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item): string | null => {
        if (typeof item === "object" && item !== null && "msg" in item && typeof item.msg === "string") {
          return item.msg;
        }
        return null;
      })
      .filter((msg): msg is string => msg !== null && msg.length > 0);
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }

  return fallback;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const baseUrl = getApiBaseUrl().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl}${normalizedPath}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errorBody: unknown = await response.json();
      errorDetail = extractErrorDetail(errorBody, errorDetail);
    } catch {
      // Keep status message when response body is not JSON.
    }
    throw new ApiError(errorDetail, response.status);
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const rawBody = await response.text();
  if (!rawBody) {
    return undefined as T;
  }

  return JSON.parse(rawBody) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/health");
}
