export const AUTH_STORAGE_KEYS = [
  "sos_animal_access_token",
  "sos_animal_token",
  "access_token",
] as const;

export const AUTH_CHANGE_EVENT = "sos-auth-change";

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

export function isUserAuthenticated(): boolean {
  return getStoredAccessToken() !== null;
}
