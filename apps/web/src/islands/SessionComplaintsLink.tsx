import { FileText, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AUTH_COMPLAINTS_NAV_ITEM, isActiveRoute } from "../data/navigation";
import {
  AUTH_CHANGE_EVENT,
  clearStoredAccessToken,
  getStoredUserRole,
  isUserAuthenticated,
} from "../services/auth";
import type { UserRole } from "../types";

interface SessionComplaintsLinkProps {
  currentPath: string;
  variant?: "desktop" | "compact";
}

const PROTECTED_PREFIXES = ["/denunciar", "/mis-denuncias", "/panel"];

export default function SessionComplaintsLink({
  currentPath,
  variant = "desktop",
}: SessionComplaintsLinkProps) {
  const [hydrated, setHydrated] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const syncAuth = () => {
      const hasSession = isUserAuthenticated();
      setAuthenticated(hasSession);
      setRole(hasSession ? getStoredUserRole() : null);
      setHydrated(true);
    };

    syncAuth();
    window.addEventListener("storage", syncAuth);
    window.addEventListener(AUTH_CHANGE_EVENT, syncAuth);

    return () => {
      window.removeEventListener("storage", syncAuth);
      window.removeEventListener(AUTH_CHANGE_EVENT, syncAuth);
    };
  }, []);

  if (!hydrated) {
    return null;
  }

  const isCompact = variant === "compact";

  const handleLogout = () => {
    clearStoredAccessToken();
    const pathname = window.location.pathname;
    if (PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      window.location.assign("/");
    }
  };

  if (!authenticated) {
    const loginActive = isActiveRoute(currentPath, "/login");
    return (
      <a
        href="/login"
        aria-current={loginActive ? "page" : undefined}
        className={[
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border font-semibold no-underline transition-colors",
          isCompact ? "min-h-[40px] px-2.5 py-1.5 text-xs" : "min-h-[40px] px-3 py-2 text-xs xl:text-sm",
          loginActive
            ? "border-primary bg-primary-soft text-primary"
            : "border-border bg-bg-surface text-text-primary hover:bg-bg-canvas",
        ].join(" ")}
      >
        <LogIn aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>Ingresar</span>
      </a>
    );
  }

  const complaintsActive = isActiveRoute(currentPath, AUTH_COMPLAINTS_NAV_ITEM.href);
  const panelActive = isActiveRoute(currentPath, "/panel");
  const isStaff = role === "gestor_cemzoo" || role === "admin";
  const panelLabel = role === "admin" ? "Panel Admin" : "Panel CEMZOO";

  return (
    <div className="flex items-center gap-1.5">
      <a
        href={AUTH_COMPLAINTS_NAV_ITEM.href}
        aria-current={complaintsActive ? "page" : undefined}
        className={[
          "inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border font-semibold no-underline transition-colors",
          isCompact ? "px-2.5 py-1.5 text-xs" : "px-2.5 py-2 text-xs xl:px-3 xl:text-sm",
          complaintsActive
            ? "border-primary bg-primary-soft text-primary"
            : "border-border bg-bg-surface text-text-primary hover:bg-bg-canvas",
        ].join(" ")}
      >
        <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
        {isCompact ? (
          <>
            <span className="sm:hidden">Casos</span>
            <span className="hidden sm:inline">{AUTH_COMPLAINTS_NAV_ITEM.desktopLabel}</span>
          </>
        ) : (
          <span>{AUTH_COMPLAINTS_NAV_ITEM.desktopLabel ?? AUTH_COMPLAINTS_NAV_ITEM.label}</span>
        )}
      </a>

      {isStaff && (
        <a
          href="/panel/denuncias"
          aria-current={panelActive ? "page" : undefined}
          className={[
            "inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border font-semibold no-underline transition-colors",
            isCompact ? "px-2.5 py-1.5 text-xs" : "px-2.5 py-2 text-xs xl:px-3 xl:text-sm",
            panelActive
              ? "border-secondary bg-secondary-soft text-secondary-text"
              : "border-secondary/30 bg-secondary-soft/60 text-secondary-text hover:bg-secondary-soft",
          ].join(" ")}
        >
          <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="2xl:hidden">Panel</span>
          <span className="hidden 2xl:inline">{panelLabel}</span>
        </a>
      )}

      <button
        type="button"
        onClick={handleLogout}
        className={[
          "inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-bg-surface font-semibold text-text-secondary transition-colors hover:border-sos/30 hover:bg-sos-soft hover:text-sos-text",
          isCompact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-xs xl:text-sm",
        ].join(" ")}
      >
        <LogOut aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>Cerrar sesión</span>
      </button>
    </div>
  );
}
