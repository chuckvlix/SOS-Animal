import type {
  TokenResponse,
  UserProfileUpdate,
  UserRead,
  UserRegisterRequest,
  UserRole,
  UserRoleUpdate,
} from "../types";
import { apiRequest } from "./api";

export const PRIMARY_AUTH_STORAGE_KEY = "sos_animal_access_token";

export const AUTH_STORAGE_KEYS = [
  PRIMARY_AUTH_STORAGE_KEY,
  "sos_animal_token",
  "access_token",
] as const;

export const AUTH_CHANGE_EVENT = "sos-auth-change";

let inFlightCurrentUser: Promise<UserRead> | null = null;

function isValidUserRole(value: unknown): value is UserRole {
  return value === "ciudadano" || value === "gestor_cemzoo" || value === "admin";
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isValidActiveJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (payload === null) {
    return false;
  }

  const sub = payload.sub;
  const exp = payload.exp;
  if (typeof sub !== "string" || !sub.trim()) {
    return false;
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return false;
  }
  return exp * 1000 > Date.now();
}

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    for (const key of AUTH_STORAGE_KEYS) {
      const raw = window.localStorage.getItem(key)?.trim();
      if (raw && isValidActiveJwt(raw)) {
        return raw;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function setStoredAccessToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const trimmed = token.trim();
  if (!trimmed || !isValidActiveJwt(trimmed)) {
    return;
  }

  try {
    for (const key of AUTH_STORAGE_KEYS) {
      if (key !== PRIMARY_AUTH_STORAGE_KEY) {
        window.localStorage.removeItem(key);
      }
    }
    window.localStorage.setItem(PRIMARY_AUTH_STORAGE_KEY, trimmed);
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT));
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

export function clearStoredAccessToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  inFlightCurrentUser = null;
  try {
    for (const key of AUTH_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT));
  } catch {
    // Ignore storage restrictions.
  }
}

export function getStoredUserRole(): UserRole | null {
  const token = getStoredAccessToken();
  if (!token) {
    return null;
  }
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }
  return isValidUserRole(payload.role) ? payload.role : null;
}

export function isUserAuthenticated(): boolean {
  return getStoredAccessToken() !== null;
}

export function sanitizeNextPath(rawNext: string | null, fallback = "/denunciar"): string {
  if (!rawNext) {
    return fallback;
  }

  const trimmed = rawNext.trim();
  if (
    !trimmed ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, "https://sos-animal.local");
    if (
      parsed.origin !== "https://sos-animal.local" ||
      !parsed.pathname.startsWith("/") ||
      parsed.pathname.startsWith("//")
    ) {
      return fallback;
    }
    const cleanPathname = parsed.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    if (cleanPathname === "/login" || cleanPathname === "/registro") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function resolvePostAuthDestination(role: UserRole, rawNext: string | null): string {
  const defaultTarget = role === "ciudadano" ? "/denunciar" : "/panel/denuncias";
  const sanitized = sanitizeNextPath(rawNext, defaultTarget);
  const rawPathname = sanitized.split(/[?#]/, 1)[0] ?? "";
  const normalizedPathname = rawPathname.replace(/\/+$/, "").toLowerCase() || "/";

  if (
    role === "ciudadano" &&
    (normalizedPathname === "/panel" || normalizedPathname.startsWith("/panel/"))
  ) {
    return "/denunciar";
  }

  if (normalizedPathname === "/panel") {
    return "/panel/denuncias";
  }

  if (
    role === "gestor_cemzoo" &&
    (normalizedPathname === "/panel/usuarios" || normalizedPathname.startsWith("/panel/usuarios/"))
  ) {
    return "/panel/denuncias";
  }

  return sanitized;
}

export function loginWithPassword(email: string, password: string): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set("username", email.trim());
  body.set("password", password);

  return apiRequest<TokenResponse>("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
}

export function registerCitizen(payload: UserRegisterRequest): Promise<UserRead> {
  return apiRequest<UserRead>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCurrentUser(): Promise<UserRead> {
  if (inFlightCurrentUser) {
    return inFlightCurrentUser;
  }
  const request = apiRequest<UserRead>("/auth/me").finally(() => {
    inFlightCurrentUser = null;
  });
  inFlightCurrentUser = request;
  return request;
}

export function updateMyProfile(payload: UserProfileUpdate): Promise<UserRead> {
  return apiRequest<UserRead>("/auth/me/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export interface ListUsersParams {
  role?: UserRole;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listUsersForAdmin(params: ListUsersParams = {}): Promise<UserRead[]> {
  const query = new URLSearchParams();
  if (params.role) {
    query.set("role", params.role);
  }
  if (params.search && params.search.trim()) {
    query.set("search", params.search.trim());
  }
  if (typeof params.limit === "number") {
    query.set("limit", String(params.limit));
  }
  if (typeof params.offset === "number") {
    query.set("offset", String(params.offset));
  }
  const qs = query.toString();
  return apiRequest<UserRead[]>(qs ? `/auth/users?${qs}` : "/auth/users");
}

export function updateUserRole(userId: string, payload: UserRoleUpdate): Promise<UserRead> {
  return apiRequest<UserRead>(`/auth/users/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
