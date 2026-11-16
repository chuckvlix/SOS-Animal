export const AUTH_STORAGE_KEYS = [
  "sos_animal_access_token",
  "sos_animal_token",
  "access_token",
] as const;

export const AUTH_CHANGE_EVENT = "sos-auth-change";

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  for (const key of AUTH_STORAGE_KEYS) {
    const raw = window.localStorage.getItem(key)?.trim();
    if (raw) {
      return raw;
    }
  }

  return null;
}

export function isUserAuthenticated(): boolean {
  return getStoredAccessToken() !== null;
}
