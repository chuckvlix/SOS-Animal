import {
  ArrowLeft,
  ClipboardList,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { isActiveRoute } from "../data/navigation";
import { ApiError } from "../services/api";
import {
  clearStoredAccessToken,
  fetchCurrentUser,
  isUserAuthenticated,
} from "../services/auth";
import type { UserRead } from "../types";

interface PanelHeaderIslandProps {
  currentPath: string;
  requireAdmin?: boolean;
}

function BrandMarkSvg({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 120"
      fill="none"
      className={className ?? "h-8 w-8 shrink-0 text-primary"}
    >
      <path
        d="M83.45 84.5C81.82 85.42 78.2 87.74 75.44 89.43C71.68 91.78 67.8 93.95 63.94 96.13C62.43 96.98 60.92 97.81 59.39 98.63C58.32 99.21 57.38 99.85 56.19 100.12C54.09 99.65 51.72 97.8 49.94 96.58C46.26 94.07 42.65 91.47 39.22 88.63C29.37 80.48 18.43 69.86 18.35 56.12C18.33 52.89 18.84 49.61 20.12 46.62C21.24 44.01 22.64 41.61 24.43 39.4C26.99 36.25 30.07 33.74 33.36 31.43C30.48 32.02 25.43 34.16 22.68 35.82C11.68 42.46 4.21 53.53 6.86 66.75C8.7 75.97 15.39 83.78 22.67 89.38C25.08 91.23 27.61 92.88 30.18 94.51C33.79 96.79 37.78 98.59 41.68 100.31C44.8 101.69 47.97 102.97 51.19 104.09C52.87 104.68 54.6 105.55 56.44 105.36C58.95 105.11 62.61 101.96 64.69 100.46C71.38 95.64 77.75 90.42 83.45 84.5Z"
        fill="currentColor"
      />
      <path
        d="M40.81 32.85C36.18 33.46 34.31 38.09 34.73 42.25C35.3 47.92 40.46 53.96 46.56 53.29C51.29 52.78 53.26 48.09 52.86 43.87C52.32 38.08 47.03 32.03 40.81 32.85Z"
        fill="currentColor"
      />
      <path
        d="M60.06 14.61C55.68 14.9 53.07 18.87 52.46 22.87C51.46 29.37 55.81 38.47 63.31 38.18C67.66 38.01 70.34 34.04 71.04 30.12C72.22 23.45 67.78 14.1 60.06 14.61Z"
        fill="currentColor"
      />
      <path
        d="M87.44 14.61C83.19 14.83 79.62 18.26 78.17 22.12C77.68 23.43 77.4 24.75 77.17 26.12C76.96 27.38 77.13 28.62 77.25 29.87C77.67 34.16 81.24 38.45 85.82 38.16C90.39 37.87 94.14 33.72 95.34 29.49C95.97 27.28 96.16 25.03 95.87 22.74C95.34 18.46 92.05 14.37 87.44 14.61Z"
        fill="currentColor"
      />
      <path
        d="M105.2 32.72C99.77 33.51 95.58 39.04 95.39 44.37C95.21 49.35 98.54 53.97 103.94 53.09C109.18 52.23 113.13 47.14 113.6 42.0C114.07 36.79 110.94 31.87 105.2 32.72Z"
        fill="currentColor"
      />
      <path
        d="M71.94 41.73C69.11 42.09 66.49 43.3 64.19 44.96C62.19 46.4 60.56 48.33 58.89 50.12C57.82 51.27 56.77 52.44 55.73 53.62C50.89 59.13 45.01 66.05 48.88 73.75C49.47 74.93 50.39 76.06 51.42 76.88C52.95 78.1 54.78 78.79 56.69 79.07C63.4 80.05 68.99 74.62 75.69 75.31C81.33 75.89 86.36 79.42 92.19 78.2C93.39 77.95 94.64 77.53 95.69 76.88C101.54 73.32 101.44 66.13 98.46 60.75C96.54 57.28 93.57 54.37 90.82 51.57C85.29 45.94 80.6 40.65 71.94 41.73Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface SidebarNavContentProps {
  isAdmin: boolean;
  complaintsActive: boolean;
  usersActive: boolean;
  user: UserRead;
  onNavigate?: () => void;
  onLogout: () => void;
}

function SidebarNavContent({
  isAdmin,
  complaintsActive,
  usersActive,
  user,
  onNavigate,
  onLogout,
}: SidebarNavContentProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <a
          href="/panel/denuncias"
          onClick={onNavigate}
          className="flex items-center gap-2.5 no-underline"
        >
          <BrandMarkSvg className="h-8 w-8 shrink-0 text-primary" />
          <div className="min-w-0">
            <span className="block font-display text-base font-bold leading-tight text-text-primary">
              SOS Animal
            </span>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-secondary-text">
              Panel Institucional
            </span>
          </div>
        </a>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            Sucre, Bolivia
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-0.5 text-[11px] font-semibold text-secondary-text">
            <ShieldCheck aria-hidden="true" className="h-3 w-3" />
            <span>{isAdmin ? "Superusuario" : "Gestor CEMZOO"}</span>
          </span>
        </div>
      </div>

      <nav aria-label="Menú institucional" className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mt-0 mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Gestión Operativa
        </p>
        <ul className="m-0 list-none space-y-1 p-0">
          <li>
            <a
              href="/panel/denuncias"
              onClick={onNavigate}
              aria-current={complaintsActive ? "page" : undefined}
              className={[
                "flex min-h-[44px] items-center gap-2.5 rounded-xl border-l-4 px-3 py-2.5 text-sm font-semibold no-underline transition-colors",
                complaintsActive
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-transparent text-text-secondary hover:bg-bg-canvas hover:text-text-primary",
              ].join(" ")}
            >
              <ClipboardList aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Bandeja de Denuncias</span>
            </a>
          </li>

          {isAdmin && (
            <li>
              <a
                href="/panel/usuarios"
                onClick={onNavigate}
                aria-current={usersActive ? "page" : undefined}
                className={[
                  "flex min-h-[44px] items-center gap-2.5 rounded-xl border-l-4 px-3 py-2.5 text-sm font-semibold no-underline transition-colors",
                  usersActive
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-transparent text-text-secondary hover:bg-bg-canvas hover:text-text-primary",
                ].join(" ")}
              >
                <Users aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>Gestión de Usuarios</span>
              </a>
            </li>
          )}
        </ul>

        <div className="mt-6 border-t border-border pt-4">
          <p className="mt-0 mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Accesos Externos
          </p>
          <a
            href="/"
            onClick={onNavigate}
            className="flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary no-underline transition-colors hover:bg-bg-canvas hover:text-text-primary"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Volver al Portal Ciudadano</span>
          </a>
        </div>
      </nav>

      <div className="border-t border-border bg-bg-canvas/70 p-4">
        <div className="rounded-2xl border border-border bg-bg-surface p-3">
          <p className="m-0 truncate text-xs font-bold text-text-primary">{user.full_name}</p>
          <p className="mt-0.5 mb-0 truncate text-[11px] text-text-secondary">{user.email}</p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="mt-3 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-bg-surface px-3.5 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-sos/30 hover:bg-sos-soft hover:text-sos-text"
        >
          <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  );
}

export default function PanelHeaderIsland({
  currentPath,
  requireAdmin = false,
}: PanelHeaderIslandProps) {
  const [user, setUser] = useState<UserRead | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const drawerSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loginNext = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

    if (!isUserAuthenticated()) {
      window.location.replace(loginNext);
      return;
    }

    let cancelled = false;
    fetchCurrentUser()
      .then((me) => {
        if (cancelled) {
          return;
        }
        if (me.role === "ciudadano") {
          window.location.replace("/");
          return;
        }
        if (requireAdmin && me.role !== "admin") {
          window.location.replace("/panel/denuncias");
          return;
        }
        setUser(me);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          clearStoredAccessToken();
        }
        window.location.replace(loginNext);
      });

    return () => {
      cancelled = true;
    };
  }, [requireAdmin]);

  const openDrawer = () => {
    const dialog = drawerRef.current;
    if (!dialog || dialog.open) {
      return;
    }
    setDrawerOpen(true);
    dialog.showModal();
  };

  const closeDrawer = () => {
    const dialog = drawerRef.current;
    if (dialog && dialog.open) {
      dialog.returnValue = "";
      dialog.close();
    }
    setDrawerOpen(false);
  };

  const handleLogout = () => {
    closeDrawer();
    clearStoredAccessToken();
    window.location.assign("/");
  };

  if (!user) {
    return (
      <>
        <aside className="hidden border-r border-border bg-bg-surface lg:col-start-1 lg:row-span-2 lg:block lg:h-dvh lg:sticky lg:top-0">
          <div className="p-5">
            <span className="font-display text-sm font-semibold text-text-secondary">
              Cargando menú...
            </span>
          </div>
        </aside>
        <header className="border-b border-border bg-bg-surface lg:col-start-2 lg:row-start-1">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
            <span className="font-display text-sm font-semibold text-text-secondary">
              Verificando acceso institucional...
            </span>
          </div>
        </header>
      </>
    );
  }

  const isAdmin = user.role === "admin";
  const complaintsActive = isActiveRoute(currentPath, "/panel/denuncias");
  const usersActive = isActiveRoute(currentPath, "/panel/usuarios");
  const activeSectionTitle = usersActive ? "Gestión de Usuarios y Roles" : "Bandeja de Denuncias";

  return (
    <>
      <aside
        aria-label="Barra lateral del panel"
        className="hidden border-r border-border bg-bg-surface lg:sticky lg:top-0 lg:col-start-1 lg:row-span-2 lg:flex lg:h-dvh lg:flex-col"
      >
        <SidebarNavContent
          isAdmin={isAdmin}
          complaintsActive={complaintsActive}
          usersActive={usersActive}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      <header className="sticky top-0 z-30 border-b border-border bg-bg-surface/95 backdrop-blur-sm lg:col-start-2 lg:row-start-1">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={openDrawer}
              aria-expanded={drawerOpen}
              aria-controls={drawerId}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-canvas px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary lg:hidden"
            >
              <Menu aria-hidden="true" className="h-4 w-4" />
              <span>Menú</span>
            </button>

            <a
              href="/panel/denuncias"
              className="flex items-center gap-2 no-underline lg:hidden"
            >
              <BrandMarkSvg className="h-7 w-7 shrink-0 text-primary" />
              <span className="font-display text-sm font-bold text-text-primary sm:text-base">
                SOS Animal
              </span>
            </a>

            <div className="hidden items-center gap-2.5 lg:flex">
              <span className="font-display text-base font-bold text-text-primary">
                {activeSectionTitle}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-0.5 text-xs font-semibold text-secondary-text">
                <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
                <span>{isAdmin ? "Superusuario (Admin)" : "Gestor CEMZOO"}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-medium text-text-secondary sm:inline">
              {user.full_name}
            </span>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-bg-surface px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-sos/30 hover:bg-sos-soft hover:text-sos-text sm:text-sm"
            >
              <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </header>

      <dialog
        ref={drawerRef}
        id={drawerId}
        aria-label="Menú institucional"
        onClick={(event) => {
          if (!drawerSheetRef.current?.contains(event.target as Node)) {
            closeDrawer();
          }
        }}
        onClose={() => {
          if (drawerRef.current) {
            drawerRef.current.returnValue = "";
          }
          setDrawerOpen(false);
        }}
        className="panel-drawer lg:hidden"
      >
        <div
          ref={drawerSheetRef}
          className="panel-drawer-sheet relative flex flex-col border-r border-border bg-bg-surface text-text-primary shadow-xl"
        >
          <button
            type="button"
            autoFocus
            onClick={closeDrawer}
            aria-label="Cerrar menú institucional"
            className="absolute top-3.5 right-3.5 inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-border bg-bg-canvas text-text-secondary hover:bg-slate-200 hover:text-text-primary"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>

          <SidebarNavContent
            isAdmin={isAdmin}
            complaintsActive={complaintsActive}
            usersActive={usersActive}
            user={user}
            onNavigate={closeDrawer}
            onLogout={handleLogout}
          />
        </div>
      </dialog>
    </>
  );
}
