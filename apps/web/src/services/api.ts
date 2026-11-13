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
  return import.meta.env.PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
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
      if (
        typeof errorBody === "object" &&
        errorBody !== null &&
        "detail" in errorBody &&
        typeof errorBody.detail === "string"
      ) {
        errorDetail = errorBody.detail;
      }
    } catch {
      // Keep status message when response body is not JSON.
    }
    throw new ApiError(errorDetail, response.status);
  }

  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/health");
}
