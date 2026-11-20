import {
  AlertTriangle,
  BarChart3,
  Camera,
  Download,
  ExternalLink,
  Eye,
  Filter,
  MapPin,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../services/api";
import {
  clearStoredAccessToken,
  fetchCurrentUser,
  isUserAuthenticated,
} from "../services/auth";
import {
  COMPLAINT_STATUS_META,
  OFFENSE_MAIN_TYPE_META,
  formatDateTimeDisplay,
  openPresignedPdfDownload,
} from "../services/complaintLabels";
import {
  fetchComplaintPdfDownloadUrl,
  fetchInstitutionalComplaintStats,
  fetchInstitutionalComplaints,
  fetchOffenseCategories,
} from "../services/complaints";
import { formatFileSize } from "../services/storage";
import type {
  ComplaintRead,
  ComplaintStatsRead,
  OffenseCategoryRead,
  OffenseMainType,
} from "../types";

type MainTypeFilter = "" | OffenseMainType;

const PAGE_SIZE = 50;

function redirectToLogin(): void {
  window.location.replace(`/login?next=${encodeURIComponent("/panel/denuncias")}`);
}

function formatSharePercent(part: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((part / total) * 100)}%`;
}

export default function AdminComplaintsTrayIsland() {
  const [authorized, setAuthorized] = useState(false);
  const [verifyingSession, setVerifyingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [stats, setStats] = useState<ComplaintStatsRead | null>(null);
  const [categories, setCategories] = useState<OffenseCategoryRead[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRead[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [mainTypeFilter, setMainTypeFilter] = useState<MainTypeFilter>("");
  const [categoryIdFilter, setCategoryIdFilter] = useState<string>("");

  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedMainType, setAppliedMainType] = useState<MainTypeFilter>("");
  const [appliedCategoryId, setAppliedCategoryId] = useState<number | undefined>(undefined);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  const [selectedComplaint, setSelectedComplaint] = useState<ComplaintRead | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const detailCloseButtonRef = useRef<HTMLButtonElement>(null);

  const loadRegistry = useCallback(
    async (
      nextMainType: MainTypeFilter,
      nextCategoryId: number | undefined,
      nextSearch: string,
      page = 0,
      refreshStats = false,
    ) => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const listPromise = fetchInstitutionalComplaints({
          main_type: nextMainType || undefined,
          category_id: nextCategoryId,
          search: nextSearch.trim() || undefined,
          limit: PAGE_SIZE + 1,
          offset: page * PAGE_SIZE,
        });

        if (refreshStats) {
          const [nextStats, list] = await Promise.all([
            fetchInstitutionalComplaintStats(),
            listPromise,
          ]);
          setStats(nextStats);
          setHasNextPage(list.length > PAGE_SIZE);
          setComplaints(list.slice(0, PAGE_SIZE));
        } else {
          const list = await listPromise;
          setHasNextPage(list.length > PAGE_SIZE);
          setComplaints(list.slice(0, PAGE_SIZE));
        }
        setPageIndex(page);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredAccessToken();
          redirectToLogin();
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          window.location.replace("/");
          return;
        }
        setErrorMessage(
          err instanceof Error && err.message
            ? err.message
            : "No se pudo cargar el registro histórico de denuncias.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const verifyAndInitialize = useCallback(
    (isCancelled?: () => boolean) => {
      if (!isUserAuthenticated()) {
        redirectToLogin();
        return;
      }

      setVerifyingSession(true);
      setSessionError(null);

      fetchCurrentUser()
        .then((me) => {
          if (isCancelled?.()) {
            return;
          }
          if (me.role !== "admin") {
            window.location.replace("/");
            return;
          }
          setAuthorized(true);
          setVerifyingSession(false);
          void fetchOffenseCategories()
            .then((catalog) => {
              if (!isCancelled?.()) {
                setCategories(catalog);
              }
            })
            .catch(() => {
              // Non-blocking: table and stats remain usable without dropdown categories.
            });
          void loadRegistry("", undefined, "", 0, true);
        })
        .catch((err) => {
          if (isCancelled?.()) {
            return;
          }
          if (err instanceof ApiError && err.status === 401) {
            clearStoredAccessToken();
            redirectToLogin();
            return;
          }
          if (err instanceof ApiError && err.status === 403) {
            window.location.replace("/");
            return;
          }
          setSessionError(
            err instanceof Error && err.message
              ? err.message
              : "No pudimos verificar tu sesión administrativa con el servidor.",
          );
          setVerifyingSession(false);
        });
    },
    [loadRegistry],
  );

  useEffect(() => {
    let cancelled = false;
    verifyAndInitialize(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [verifyAndInitialize]);

  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!selectedComplaint || !dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      detailCloseButtonRef.current?.focus();
    }
  }, [selectedComplaint]);

  const filterableCategories = useMemo(() => {
    if (!mainTypeFilter) {
      return categories;
    }
    return categories.filter((item) => item.main_type === mainTypeFilter);
  }, [categories, mainTypeFilter]);

  const maxCategoryCount = useMemo(() => {
    if (!stats || stats.by_category.length === 0) {
      return 1;
    }
    return Math.max(1, ...stats.by_category.map((item) => item.count));
  }, [stats]);

  const handleMainTypeFilterChange = (nextType: MainTypeFilter) => {
    setMainTypeFilter(nextType);
    if (nextType && categoryIdFilter) {
      const selectedCat = categories.find((cat) => String(cat.id) === categoryIdFilter);
      if (selectedCat && selectedCat.main_type !== nextType) {
        setCategoryIdFilter("");
      }
    }
  };

  const handleFilterSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedCat = categoryIdFilter ? Number(categoryIdFilter) : undefined;
    const validCat = parsedCat && Number.isInteger(parsedCat) ? parsedCat : undefined;
    setAppliedMainType(mainTypeFilter);
    setAppliedCategoryId(validCat);
    setAppliedSearch(searchInput.trim());
    void loadRegistry(mainTypeFilter, validCat, searchInput.trim(), 0, false);
  };

  const handleClearFilters = () => {
    setMainTypeFilter("");
    setCategoryIdFilter("");
    setSearchInput("");
    setAppliedMainType("");
    setAppliedCategoryId(undefined);
    setAppliedSearch("");
    void loadRegistry("", undefined, "", 0, false);
  };

  const openDetailModal = (complaint: ComplaintRead) => {
    setErrorMessage(null);
    setModalError(null);
    setSelectedComplaint(complaint);
  };

  const closeDetailModal = () => {
    if (detailDialogRef.current) {
      detailDialogRef.current.returnValue = "";
      detailDialogRef.current.close();
    }
    setModalError(null);
    setSelectedComplaint(null);
  };

  const handleDownloadPdf = async (complaintId: string) => {
    setDownloadingPdfId(complaintId);
    setErrorMessage(null);
    setModalError(null);
    try {
      const result = await fetchComplaintPdfDownloadUrl(complaintId);
      openPresignedPdfDownload(result.download_url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLogin();
        return;
      }
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "No pudimos generar el enlace de descarga del Documento de Denuncia.";
      if (selectedComplaint) {
        setModalError(msg);
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setDownloadingPdfId(null);
    }
  };

  if (!authorized) {
    if (sessionError && !verifyingSession) {
      return (
        <div role="alert" className="rounded-3xl border border-sos/30 bg-sos-soft p-6 shadow-xs">
          <h1 className="m-0 font-display text-lg font-bold text-sos-text">
            No pudimos validar el acceso al observatorio
          </h1>
          <p className="mt-2 mb-4 text-sm text-text-primary">{sessionError}</p>
          <button
            type="button"
            onClick={() => verifyAndInitialize()}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            <span>Reintentar verificación</span>
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
        <p className="m-0 text-sm font-medium text-text-secondary">
          Validando credenciales administrativas...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-secondary-text">
              Observatorio Universitario · Archivo de Consulta
            </p>
            <h1 className="mt-1 mb-0 font-display text-2xl font-bold text-text-primary sm:text-3xl">
              Registro Histórico y Estadístico
            </h1>
            <p className="mt-1.5 mb-0 text-sm text-text-secondary">
              Consulta indicadores acumulados, distribución por modalidad legal y descarga el{" "}
              <strong>Documento de Denuncia</strong> en PDF con su Anexo Fotográfico.
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() =>
              void loadRegistry(
                appliedMainType,
                appliedCategoryId,
                appliedSearch,
                pageIndex,
                true,
              )
            }
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-60 sm:text-sm"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>Actualizar datos</span>
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-border bg-bg-canvas p-4">
            <p className="m-0 text-xs font-medium text-text-secondary">Documentos emitidos</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-text-primary">
              {stats ? stats.total_submitted : "—"}
            </p>
            <p className="mt-1 mb-0 text-[11px] text-text-secondary">
              Registro histórico inmutable
            </p>
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary-soft/50 p-4">
            <p className="m-0 text-xs font-medium text-primary">Maltrato (Art. 350 bis)</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-primary">
              {stats ? stats.total_maltrato : "—"}
            </p>
            <p className="tabular-nums mt-1 mb-0 text-[11px] text-text-secondary">
              {stats ? formatSharePercent(stats.total_maltrato, stats.total_submitted) : "—"} del
              total emitido
            </p>
          </div>

          <div className="rounded-2xl border border-sos/25 bg-sos-soft/70 p-4">
            <p className="m-0 text-xs font-medium text-sos-text">Biocidio (Art. 350 ter)</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-sos-text">
              {stats ? stats.total_biocidio : "—"}
            </p>
            <p className="tabular-nums mt-1 mb-0 text-[11px] text-text-secondary">
              {stats ? formatSharePercent(stats.total_biocidio, stats.total_submitted) : "—"} del
              total emitido
            </p>
          </div>

          <div className="rounded-2xl border border-secondary/25 bg-secondary-soft/60 p-4">
            <p className="m-0 text-xs font-medium text-secondary-text">Anexos y Geolocalización</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-secondary-text">
              {stats ? stats.total_photos : "—"}
            </p>
            <p className="tabular-nums mt-1 mb-0 text-[11px] text-text-secondary">
              {stats
                ? `fotos · ${stats.total_with_coordinates} con GPS`
                : "Fotografías registradas"}
            </p>
          </div>
        </div>
      </section>

      {stats && stats.by_category.length > 0 && (
        <section className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-6">
          <div className="flex items-center gap-2">
            <BarChart3 aria-hidden="true" className="h-5 w-5 text-primary" />
            <h2 className="m-0 font-display text-base font-bold text-text-primary sm:text-lg">
              Distribución por Modalidad Tipificada
            </h2>
          </div>

          <ul className="m-0 mt-4 list-none space-y-3 p-0">
            {stats.by_category.map((row) => {
              const mainMeta = OFFENSE_MAIN_TYPE_META[row.main_type];
              return (
                <li key={row.category_id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${mainMeta.badgeClass}`}
                      >
                        {row.main_type}
                      </span>
                      <span className="truncate font-semibold text-text-primary">
                        {row.subtype_name}
                      </span>
                    </div>
                    <span className="tabular-nums shrink-0 font-bold text-text-primary">
                      {row.count} ({formatSharePercent(row.count, stats.total_submitted)})
                    </span>
                  </div>
                  <progress
                    aria-label={`${row.subtype_name}: ${row.count} casos`}
                    value={row.count}
                    max={maxCategoryCount}
                    className={`h-2.5 w-full ${
                      row.main_type === "BIOCIDIO" ? "accent-sos" : "accent-primary"
                    }`}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-6">
        <form
          onSubmit={handleFilterSubmit}
          className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end"
        >
          <div className="md:col-span-4">
            <label
              htmlFor="tray-search-filter"
              className="mb-1 block text-xs font-semibold text-text-primary"
            >
              Buscar por código o dirección
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              />
              <input
                id="tray-search-filter"
                type="search"
                maxLength={120}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Ej. SOS-000001 o Av. Hernando Siles"
                className="w-full rounded-xl border border-border bg-bg-surface py-2.5 pr-3 pl-9 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="tray-type-filter"
              className="mb-1 block text-xs font-semibold text-text-primary"
            >
              Tipo de hecho
            </label>
            <select
              id="tray-type-filter"
              value={mainTypeFilter}
              onChange={(e) => handleMainTypeFilterChange(e.target.value as MainTypeFilter)}
              className="w-full rounded-xl border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary"
            >
              <option value="">Todos los tipos</option>
              <option value="MALTRATO">MALTRATO (Art. 350 bis)</option>
              <option value="BIOCIDIO">BIOCIDIO (Art. 350 ter)</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="tray-category-filter"
              className="mb-1 block text-xs font-semibold text-text-primary"
            >
              Modalidad específica
            </label>
            <select
              id="tray-category-filter"
              value={categoryIdFilter}
              onChange={(e) => setCategoryIdFilter(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary"
            >
              <option value="">Todas las modalidades</option>
              {filterableCategories.map((cat) => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.subtype_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 md:col-span-2 md:justify-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              <Filter aria-hidden="true" className="h-4 w-4" />
              <span>Filtrar</span>
            </button>

            {(appliedMainType ||
              appliedCategoryId !== undefined ||
              appliedSearch ||
              mainTypeFilter ||
              categoryIdFilter ||
              searchInput) && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-bg-canvas px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-slate-100 hover:text-text-primary"
              >
                Limpiar
              </button>
            )}
          </div>
        </form>
      </section>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm text-sos-text"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 text-sm font-medium text-text-secondary">
            Cargando registro histórico...
          </p>
        </div>
      ) : complaints.length === 0 ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 font-display text-base font-bold text-text-primary">
            No hay documentos emitidos con los filtros actuales
          </p>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            Solo se incluyen Documentos de Denuncia emitidos e inmutables (los borradores ciudadanos
            permanecen privados).
          </p>
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="complaints-tray-caption"
          className="sos-table-wrapper"
        >
          <table className="sos-responsive-table text-sm">
            <caption id="complaints-tray-caption" className="visually-hidden">
              Archivo histórico de Documentos de Denuncia emitidos
            </caption>
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <th scope="col" className="px-4 py-3.5">
                  Código
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Tipificación
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Emisión
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Ubicación
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Anexo
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((complaint) => {
                const mainType = complaint.offense_category?.main_type;
                const mainMeta = mainType ? OFFENSE_MAIN_TYPE_META[mainType] : null;
                return (
                  <tr key={complaint.id} className="hover:bg-bg-canvas/70">
                    <th scope="row" className="tabular-nums whitespace-nowrap px-4 py-3.5 font-bold text-primary">
                      {complaint.tracking_code ?? "Sin código"}
                    </th>

                    <td data-label="Tipificación" className="px-4 py-3.5">
                      <div className="flex flex-col items-end gap-1 lg:items-start">
                        {mainMeta && (
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${mainMeta.badgeClass}`}
                          >
                            {mainType}
                          </span>
                        )}
                        <span className="text-xs font-medium text-text-primary">
                          {complaint.offense_category?.subtype_name ?? "Categoría"}
                        </span>
                      </div>
                    </td>

                    <td data-label="Emisión" className="tabular-nums whitespace-nowrap px-4 py-3.5 text-xs text-text-secondary">
                      {formatDateTimeDisplay(complaint.submitted_at)}
                    </td>

                    <td data-label="Ubicación" className="px-4 py-3.5 text-xs text-text-primary lg:max-w-[230px]">
                      <div className="flex flex-col items-end gap-1 lg:items-start">
                        <span className="line-clamp-2">{complaint.incident_address}</span>
                        {complaint.latitude !== null && complaint.longitude !== null && (
                          <span className="tabular-nums inline-flex items-center gap-1 rounded bg-secondary-soft px-1.5 py-0.5 text-[11px] font-semibold text-secondary-text">
                            <MapPin aria-hidden="true" className="h-3 w-3" />
                            GPS registrado
                          </span>
                        )}
                      </div>
                    </td>

                    <td data-label="Anexo" className="tabular-nums whitespace-nowrap px-4 py-3.5 text-xs text-text-secondary">
                      <span className="inline-flex items-center gap-1">
                        <Camera aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
                        <span>{complaint.evidences.length} foto(s)</span>
                      </span>
                    </td>

                    <td data-label="Acciones" className="whitespace-nowrap px-4 py-3.5">
                      <div className="flex flex-wrap items-center justify-end gap-2 lg:justify-start">
                        <button
                          type="button"
                          onClick={() => openDetailModal(complaint)}
                          className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-canvas px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary"
                        >
                          <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                          <span>Ver detalle</span>
                        </button>

                        <button
                          type="button"
                          disabled={downloadingPdfId === complaint.id}
                          onClick={() => handleDownloadPdf(complaint.id)}
                          className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
                        >
                          <Download aria-hidden="true" className="h-3.5 w-3.5" />
                          <span>{downloadingPdfId === complaint.id ? "..." : "PDF"}</span>
                        </button>
                      </div>
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
          aria-label="Paginación del registro histórico"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-bg-surface px-4 py-3 text-xs font-semibold"
        >
          <span className="tabular-nums text-text-secondary">Página {pageIndex + 1}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={() =>
                void loadRegistry(
                  appliedMainType,
                  appliedCategoryId,
                  appliedSearch,
                  pageIndex - 1,
                  false,
                )
              }
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={!hasNextPage}
              onClick={() =>
                void loadRegistry(
                  appliedMainType,
                  appliedCategoryId,
                  appliedSearch,
                  pageIndex + 1,
                  false,
                )
              }
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Siguiente
            </button>
          </div>
        </nav>
      )}

      <dialog
        ref={detailDialogRef}
        aria-labelledby="case-modal-title"
        onClose={() => {
          if (detailDialogRef.current) {
            detailDialogRef.current.returnValue = "";
          }
          setModalError(null);
          setSelectedComplaint(null);
        }}
        className="w-full max-w-2xl rounded-3xl border border-border bg-bg-surface p-0 text-text-primary shadow-xl"
      >
        {selectedComplaint && (
          <div className="flex max-h-[88dvh] flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-bold text-primary">
                    {selectedComplaint.tracking_code ?? "Sin código"}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      COMPLAINT_STATUS_META[selectedComplaint.status].badgeClass
                    }`}
                  >
                    {COMPLAINT_STATUS_META[selectedComplaint.status].label}
                  </span>
                </div>
                <h2 id="case-modal-title" className="mt-2 mb-0 font-display text-lg font-bold text-text-primary">
                  {selectedComplaint.offense_category
                    ? `${selectedComplaint.offense_category.main_type} — ${selectedComplaint.offense_category.subtype_name}`
                    : "Detalle del Documento de Denuncia"}
                </h2>
              </div>

              <button
                ref={detailCloseButtonRef}
                type="button"
                autoFocus
                onClick={closeDetailModal}
                aria-label="Cerrar detalle del caso"
                className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-border bg-bg-canvas text-text-secondary hover:bg-slate-200 hover:text-text-primary"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-sm">
              {modalError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-2xl border border-sos/30 bg-sos-soft p-3.5 text-xs font-medium text-sos-text sm:text-sm"
                >
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {selectedComplaint.offense_category && (
                <div className="rounded-2xl border border-primary/20 bg-primary-soft/60 p-4">
                  <p className="m-0 text-xs font-semibold uppercase tracking-wide text-primary">
                    Fundamento legal aplicable
                  </p>
                  <p className="mt-1 mb-0 text-xs leading-relaxed text-text-primary">
                    {selectedComplaint.offense_category.legal_basis}
                  </p>
                </div>
              )}

              <dl className="m-0 grid gap-3 rounded-2xl border border-border bg-bg-canvas p-4 text-xs sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-text-secondary">Fecha del hecho</dt>
                  <dd className="tabular-nums m-0 mt-0.5 font-medium text-text-primary">
                    {formatDateTimeDisplay(selectedComplaint.incident_date)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-text-secondary">Fecha de emisión</dt>
                  <dd className="tabular-nums m-0 mt-0.5 font-medium text-text-primary">
                    {formatDateTimeDisplay(selectedComplaint.submitted_at)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold text-text-secondary">Ubicación del hecho</dt>
                  <dd className="m-0 mt-0.5 font-medium text-text-primary">
                    {selectedComplaint.incident_address}
                  </dd>
                </div>
                {selectedComplaint.latitude !== null && selectedComplaint.longitude !== null && (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-text-secondary">Coordenadas GPS</dt>
                    <dd className="m-0 mt-1 flex flex-wrap items-center gap-2">
                      <span className="tabular-nums inline-flex items-center gap-1 rounded bg-secondary-soft px-2 py-0.5 font-semibold text-secondary-text">
                        <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                        {selectedComplaint.latitude.toFixed(6)}, {selectedComplaint.longitude.toFixed(6)}
                      </span>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${selectedComplaint.latitude}&mlon=${selectedComplaint.longitude}#map=17/${selectedComplaint.latitude}/${selectedComplaint.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-primary underline"
                      >
                        <span>Ver en OpenStreetMap</span>
                        <ExternalLink aria-hidden="true" className="h-3 w-3" />
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              <div>
                <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                  Relato de los hechos
                </h3>
                <p className="mt-2 mb-0 whitespace-pre-wrap rounded-2xl border border-border bg-bg-canvas p-4 text-xs leading-relaxed text-text-primary">
                  {selectedComplaint.description}
                </p>
              </div>

              <div>
                <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                  Anexo Fotográfico ({selectedComplaint.evidences.length})
                </h3>
                {selectedComplaint.evidences.length > 0 ? (
                  <ul className="m-0 mt-2 list-none space-y-2 p-0">
                    {selectedComplaint.evidences.map((ev, idx) => (
                      <li
                        key={ev.id}
                        className="flex flex-col gap-1.5 rounded-xl border border-border bg-bg-canvas px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                      >
                        <div className="min-w-0">
                          <span className="mr-2 rounded bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">
                            Fotografía {idx + 1}
                          </span>
                          <span className="truncate-single-line mt-1 max-w-full font-medium text-text-primary sm:mt-0">
                            {ev.object_key}
                          </span>
                        </div>
                        <span className="tabular-nums shrink-0 text-text-secondary">
                          {ev.mime_type} · {formatFileSize(ev.file_size_bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 mb-0 text-xs text-text-secondary">
                    Sin fotografías adjuntas registradas.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-bg-canvas p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                      Documento de Denuncia Oficial
                    </h3>
                    <p className="mt-0.5 mb-0 text-xs text-text-secondary">
                      Incluye identificación completa del denunciante, sustento jurídico y Anexo Fotográfico.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={downloadingPdfId === selectedComplaint.id}
                    onClick={() => handleDownloadPdf(selectedComplaint.id)}
                    className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                  >
                    <Download aria-hidden="true" className="h-4 w-4" />
                    <span>
                      {downloadingPdfId === selectedComplaint.id
                        ? "Generando enlace..."
                        : "Descargar PDF"}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-border px-6 py-3.5">
              <button
                type="button"
                onClick={closeDetailModal}
                className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary hover:bg-slate-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
