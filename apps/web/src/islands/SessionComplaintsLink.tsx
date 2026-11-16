import { useEffect, useState } from "react";
import { AUTH_COMPLAINTS_NAV_ITEM, isActiveRoute } from "../data/navigation";
import { AUTH_CHANGE_EVENT, isUserAuthenticated } from "../services/auth";

interface SessionComplaintsLinkProps {
  currentPath: string;
}

export default function SessionComplaintsLink({
  currentPath,
}: SessionComplaintsLinkProps) {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const syncAuth = () => {
      setAuthenticated(isUserAuthenticated());
    };

    syncAuth();
    window.addEventListener("storage", syncAuth);
    window.addEventListener(AUTH_CHANGE_EVENT, syncAuth);

    return () => {
      window.removeEventListener("storage", syncAuth);
      window.removeEventListener(AUTH_CHANGE_EVENT, syncAuth);
    };
  }, []);

  if (!authenticated) {
    return null;
  }

  const active = isActiveRoute(currentPath, AUTH_COMPLAINTS_NAV_ITEM.href);

  return (
    <a
      href={AUTH_COMPLAINTS_NAV_ITEM.href}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold no-underline transition-colors xl:text-sm",
        active
          ? "border-primary bg-primary-soft text-primary"
          : "border-border bg-bg-surface text-text-primary hover:bg-bg-canvas",
      ].join(" ")}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0"
      >
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h4" />
      </svg>
      <span>{AUTH_COMPLAINTS_NAV_ITEM.desktopLabel ?? AUTH_COMPLAINTS_NAV_ITEM.label}</span>
    </a>
  );
}
