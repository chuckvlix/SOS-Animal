import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../services/api";
import {
  clearStoredAccessToken,
  fetchCurrentUser,
  isUserAuthenticated,
  listUsersForAdmin,
  updateUserRole,
} from "../services/auth";
import {
  USER_ROLE_META,
  formatDateOnlyDisplay,
} from "../services/complaintLabels";
import type { UserRead, UserRole } from "../types";

type RoleFilter = "" | UserRole;

const PAGE_SIZE = 50;

interface PendingRoleChange {
  user: UserRead;
  targetRole: UserRole;
}

function redirectToLogin(): void {
  window.location.replace(`/login?next=${encodeURIComponent("/panel/usuarios")}`);
}

export default function AdminUsersIsland() {
  const [authorizedAdmin, setAuthorizedAdmin] = useState<UserRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRead[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedRole, setAppliedRole] = useState<RoleFilter>("");
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  const [pendingChange, setPendingChange] = useState<PendingRoleChange | null>(null);
  const [updatingRole, setUpdatingRole] = useState(false);

  const confirmRoleDialogRef = useRef<HTMLDialogElement>(null);

  const loadUsers = useCallback(async (searchTerm: string, roleVal: RoleFilter, page = 0) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const list = await listUsersForAdmin({
        search: searchTerm.trim() || undefined,
        role: roleVal || undefined,
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
      });
      const sliced = list.slice(0, PAGE_SIZE);
      setHasNextPage(list.length > PAGE_SIZE);
      setUsers(sliced);
      setPageIndex(page);
      const initialMap: Record<string, UserRole> = {};
      for (const item of sliced) {
        initialMap[item.id] = item.role;
      }
      setRoleDrafts(initialMap);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLogin();
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        window.location.replace("/panel/denuncias");
        return;
      }
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos cargar el listado de usuarios.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isUserAuthenticated()) {
      redirectToLogin();
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
        if (me.role !== "admin") {
          window.location.replace("/panel/denuncias");
          return;
        }
        setAuthorizedAdmin(me);
        void loadUsers("", "", 0);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          clearStoredAccessToken();
        }
        redirectToLogin();
      });

    return () => {
      cancelled = true;
    };
  }, [loadUsers]);

  const handleFilterSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(searchInput);
    setAppliedRole(roleFilter);
    setStatusMessage(null);
    void loadUsers(searchInput, roleFilter, 0);
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setRoleFilter("");
    setAppliedSearch("");
    setAppliedRole("");
    setStatusMessage(null);
    void loadUsers("", "", 0);
  };

  const openRoleDialog = (targetUser: UserRead) => {
    const nextRole = roleDrafts[targetUser.id] ?? targetUser.role;
    if (nextRole === targetUser.role) {
      return;
    }
    setErrorMessage(null);
    setPendingChange({ user: targetUser, targetRole: nextRole });
    confirmRoleDialogRef.current?.showModal();
  };

  const closeRoleDialog = () => {
    if (confirmRoleDialogRef.current) {
      confirmRoleDialogRef.current.returnValue = "";
      confirmRoleDialogRef.current.close();
    }
    setPendingChange(null);
  };

  const handleConfirmRoleChange = async () => {
    if (!pendingChange) {
      return;
    }
    setUpdatingRole(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const updated = await updateUserRole(pendingChange.user.id, {
        role: pendingChange.targetRole,
      });
      setUsers((prev) =>
        prev
          .map((item) => (item.id === updated.id ? updated : item))
          .filter((item) => (!appliedRole ? true : item.role === appliedRole)),
      );
      setRoleDrafts((prev) => ({ ...prev, [updated.id]: updated.role }));
      setStatusMessage(
        `Rol actualizado: ${updated.full_name} ahora es ${USER_ROLE_META[updated.role].label}.`,
      );
      closeRoleDialog();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLogin();
        return;
      }
      closeRoleDialog();
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo actualizar el rol del usuario.",
      );
    } finally {
      setUpdatingRole(false);
    }
  };

  if (!authorizedAdmin) {
    return (
      <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
        <p className="m-0 text-sm font-medium text-text-secondary">
          Verificando permisos de superusuario...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="m-0 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Acceso exclusivo de superusuario</span>
            </p>
            <h1 className="mt-1 mb-0 font-display text-2xl font-bold text-text-primary sm:text-3xl">
              Gestión de Usuarios y Roles
            </h1>
            <p className="mt-1.5 mb-0 text-sm text-text-secondary">
              Busca cuentas registradas y asigna o revoca permisos de{" "}
              <strong>Gestor CEMZOO</strong> o <strong>Administrador</strong>.
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadUsers(appliedSearch, appliedRole, pageIndex)}
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-60 sm:text-sm"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>Actualizar lista</span>
          </button>
        </div>

        <search className="mt-6 border-t border-border pt-5">
          <form onSubmit={handleFilterSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <div className="lg:col-span-2">
              <label
                htmlFor="users-search-input"
                className="mb-1 block text-xs font-semibold text-text-primary"
              >
                Buscar por nombre o correo electrónico
              </label>
              <input
                id="users-search-input"
                name="search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Ej. María o nombre@correo.com"
                maxLength={150}
                spellCheck={false}
                enterKeyHint="search"
                className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>

            <div>
              <label
                htmlFor="users-role-filter"
                className="mb-1 block text-xs font-semibold text-text-primary"
              >
                Filtrar por rol
              </label>
              <select
                id="users-role-filter"
                name="role"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
                className="w-full rounded-xl border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary"
              >
                <option value="">Todos los roles</option>
                <option value="ciudadano">Ciudadano</option>
                <option value="gestor_cemzoo">Gestor CEMZOO</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                <Search aria-hidden="true" className="h-4 w-4" />
                <span>Buscar</span>
              </button>

              {(appliedSearch || appliedRole || searchInput || roleFilter) && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-bg-canvas px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-slate-100 hover:text-text-primary"
                >
                  Limpiar
                </button>
              )}
            </div>
          </form>
        </search>
      </section>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm font-medium text-sos-text"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2.5 rounded-2xl border border-secondary/30 bg-secondary-soft p-4 text-sm font-medium text-secondary-text"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 text-sm font-medium text-text-secondary">
            Cargando usuarios registrados...
          </p>
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 font-display text-base font-bold text-text-primary">
            No se encontraron usuarios con esos criterios
          </p>
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="admin-users-caption"
          className="sos-table-wrapper"
        >
          <table className="sos-responsive-table text-sm">
            <caption id="admin-users-caption" className="visually-hidden">
              Cuentas registradas y administración de roles
            </caption>
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <th scope="col" className="px-4 py-3.5">
                  Usuario
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Correo
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Rol actual
                </th>
                <th scope="col" className="px-4 py-3.5">
                  C.I. / Teléfono
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Registro
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Asignación de rol
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => {
                const isSelf = item.id === authorizedAdmin.id;
                const roleMeta = USER_ROLE_META[item.role];
                const selectedDraft = roleDrafts[item.id] ?? item.role;
                const hasPendingDiff = selectedDraft !== item.role;

                return (
                  <tr key={item.id} className="hover:bg-bg-canvas/70">
                    <th scope="row" className="px-4 py-3.5 font-semibold text-text-primary">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{item.full_name}</span>
                        {isSelf && (
                          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">
                            Tú
                          </span>
                        )}
                      </div>
                    </th>

                    <td data-label="Correo" className="px-4 py-3.5 text-xs text-text-secondary lg:max-w-xs">
                      <span className="truncate-single-line">{item.email}</span>
                    </td>

                    <td data-label="Rol actual" className="whitespace-nowrap px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${roleMeta.badgeClass}`}
                      >
                        {roleMeta.label}
                      </span>
                    </td>

                    <td data-label="C.I. / Teléfono" className="tabular-nums whitespace-nowrap px-4 py-3.5 text-xs text-text-secondary">
                      {item.ci_number || item.phone ? (
                        <span>
                          {item.ci_number ?? "Sin C.I."} · {item.phone ?? "Sin tel."}
                        </span>
                      ) : (
                        <span className="text-text-muted">Perfil pendiente</span>
                      )}
                    </td>

                    <td data-label="Registro" className="tabular-nums whitespace-nowrap px-4 py-3.5 text-xs text-text-secondary">
                      {formatDateOnlyDisplay(item.created_at)}
                    </td>

                    <td data-label="Asignación de rol" className="whitespace-nowrap px-4 py-3.5">
                      {isSelf ? (
                        <span className="text-xs font-medium text-text-muted">
                          Auto-revocación bloqueada
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Nuevo rol para ${item.full_name}`}
                            value={selectedDraft}
                            onChange={(e) => {
                              const nextVal = e.target.value as UserRole;
                              setRoleDrafts((prev) => ({ ...prev, [item.id]: nextVal }));
                            }}
                            className="rounded-lg border border-border bg-bg-surface px-2.5 py-1.5 text-xs font-medium text-text-primary"
                          >
                            <option value="ciudadano">Ciudadano</option>
                            <option value="gestor_cemzoo">Gestor CEMZOO</option>
                            <option value="admin">Administrador</option>
                          </select>

                          <button
                            type="button"
                            disabled={!hasPendingDiff}
                            onClick={() => openRoleDialog(item)}
                            className="inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <UserCheck aria-hidden="true" className="h-3.5 w-3.5" />
                            <span>Aplicar</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(pageIndex > 0 || hasNextPage) && !loading && (
        <nav
          aria-label="Paginación de usuarios"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-bg-surface px-4 py-3 text-xs font-semibold"
        >
          <span className="tabular-nums text-text-secondary">Página {pageIndex + 1}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={() => void loadUsers(appliedSearch, appliedRole, pageIndex - 1)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={!hasNextPage}
              onClick={() => void loadUsers(appliedSearch, appliedRole, pageIndex + 1)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Siguiente
            </button>
          </div>
        </nav>
      )}

      <dialog
        ref={confirmRoleDialogRef}
        aria-labelledby="confirm-role-title"
        onCancel={(event) => {
          if (updatingRole) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          if (confirmRoleDialogRef.current) {
            confirmRoleDialogRef.current.returnValue = "";
          }
          setPendingChange(null);
        }}
        className="w-full max-w-md rounded-3xl border border-border bg-bg-surface p-6 text-text-primary shadow-xl"
      >
        <h2 id="confirm-role-title" className="m-0 font-display text-lg font-bold text-text-primary">
          ¿Confirmar cambio de rol institucional?
        </h2>
        {pendingChange && (
          <p className="mt-2 mb-0 text-sm leading-relaxed text-text-secondary">
            Vas a cambiar el rol de <strong>{pendingChange.user.full_name}</strong> (
            {pendingChange.user.email}) de{" "}
            <strong>{USER_ROLE_META[pendingChange.user.role].label}</strong> a{" "}
            <strong className="text-primary">
              {USER_ROLE_META[pendingChange.targetRole].label}
            </strong>
            .
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            type="button"
            autoFocus
            disabled={updatingRole}
            onClick={closeRoleDialog}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-canvas disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={updatingRole}
            onClick={handleConfirmRoleChange}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            <UserCheck aria-hidden="true" className="h-4 w-4" />
            <span>{updatingRole ? "Guardando..." : "Confirmar rol"}</span>
          </button>
        </div>
      </dialog>
    </div>
  );
}
