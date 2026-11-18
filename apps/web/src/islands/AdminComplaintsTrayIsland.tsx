import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Lock,
  MapPin,
  RefreshCw,
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
  fetchInstitutionalComplaints,
  updateInstitutionalComplaintStatus,
} from "../services/complaints";
import { formatFileSize } from "../services/storage";
import type { ComplaintRead, OffenseMainType } from "../types";

type StatusFilter = "" | "ENVIADA" | "EN_ATENCION_CEMZOO" | "CERRADA";
type MainTypeFilter = "" | OffenseMainType;

const PAGE_SIZE = 50;

function redirectToLogin(): void {
  window.location.replace(`/login?next=${encodeURIComponent("/panel/denuncias")}`);
}

export default function AdminComplaintsTrayIsland() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [complaints, setComplaints] = useState<ComplaintRead[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [mainTypeFilter, setMainTypeFilter] = useState<MainTypeFilter>("");
  const [appliedStatus, setAppliedStatus] = useState<StatusFilter>("");
  const [appliedMainType, setAppliedMainType] = useState<MainTypeFilter>("");
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  const [selectedComplaint, setSelectedComplaint] = useState<ComplaintRead | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const detailDialogRef = useRef<HTMLDialogElement>(null);

  const loadComplaints = useCallback(
    async (nextStatus: StatusFilter, nextMainType: MainTypeFilter, page = 0) => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const list = await fetchInstitutionalComplaints({
          status: nextStatus || undefined,
          main_type: nextMainType || undefined,
          limit: PAGE_SIZE + 1,
          offset: page * PAGE_SIZE,
        });
        setHasNextPage(list.length > PAGE_SIZE);
        setComplaints(list.slice(0, PAGE_SIZE));
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
            : "No se pudo cargar la bandeja de denuncias.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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
        setAuthorized(true);
        void loadComplaints("", "", 0);
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
  }, [loadComplaints]);

  const metrics = useMemo(() => {
    const counts: Record<"ENVIADA" | "EN_ATENCION_CEMZOO" | "CERRADA", number> = {
      ENVIADA: 0,
      EN_ATENCION_CEMZOO: 0,
      CERRADA: 0,
    };
    for (const item of complaints) {
      if (item.status === "ENVIADA" || item.status === "EN_ATENCION_CEMZOO" || item.status === "CERRADA") {
        counts[item.status] += 1;
      }
    }
    return counts;
  }, [complaints]);

  const handleFilterSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedStatus(statusFilter);
    setAppliedMainType(mainTypeFilter);
    setStatusNotice(null);
    void loadComplaints(statusFilter, mainTypeFilter, 0);
  };

  const handleClearFilters = () => {
    setStatusFilter("");
    setMainTypeFilter("");
    setAppliedStatus("");
    setAppliedMainType("");
    setStatusNotice(null);
    void loadComplaints("", "", 0);
  };

  const openDetailModal = (complaint: ComplaintRead) => {
    setErrorMessage(null);
    setModalError(null);
    setModalNotice(null);
    setSelectedComplaint(complaint);
    detailDialogRef.current?.showModal();
  };

  const closeDetailModal = () => {
    if (detailDialogRef.current) {
      detailDialogRef.current.returnValue = "";
      detailDialogRef.current.close();
    }
    setModalError(null);
    setModalNotice(null);
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

  const handleTransitionStatus = async (
    complaint: ComplaintRead,
    targetStatus: "EN_ATENCION_CEMZOO" | "CERRADA",
  ) => {
    setUpdatingStatus(true);
    setErrorMessage(null);
    setStatusNotice(null);
    setModalError(null);
    setModalNotice(null);
    try {
      const updated = await updateInstitutionalComplaintStatus(complaint.id, {
        status: targetStatus,
      });
      setSelectedComplaint(updated);
      setComplaints((prev) => {
        const replaced = prev.map((item) => (item.id === updated.id ? updated : item));
        if (appliedStatus && updated.status !== appliedStatus) {
          return replaced.filter((item) => item.id !== updated.id);
        }
        return replaced;
      });
      const updatedNotice = `Caso ${updated.tracking_code ?? ""} actualizado a "${COMPLAINT_STATUS_META[updated.status].label}".`;
      setModalNotice(updatedNotice);
      setStatusNotice(updatedNotice);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLogin();
        return;
      }
      setModalError(
        err instanceof Error && err.message
          ? err.message
          : "No fue posible actualizar el estado de la denuncia.",
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (!authorized) {
    return (
      <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
        <p className="m-0 text-sm font-medium text-text-secondary">
          Validando credenciales institucionales...
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
              Gestión de casos enviados
            </p>
            <h1 className="mt-1 mb-0 font-display text-2xl font-bold text-text-primary sm:text-3xl">
              Bandeja Institucional de Denuncias
            </h1>
            <p className="mt-1.5 mb-0 text-sm text-text-secondary">
              Revisa expedientes recibidos, descarga el <strong>Documento de Denuncia</strong> en
              PDF y gestiona la transición de atención CEMZOO.
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadComplaints(appliedStatus, appliedMainType, pageIndex)}
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-60 sm:text-sm"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>Actualizar bandeja</span>
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-border bg-bg-canvas p-4">
            <p className="m-0 text-xs font-medium text-text-secondary">Total en vista</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-text-primary">
              {complaints.length}
            </p>
          </div>
          <div className="rounded-2xl border border-primary/20 bg-primary-soft/50 p-4">
            <p className="m-0 text-xs font-medium text-primary">Recibidas (Enviada)</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-primary">
              {metrics.ENVIADA}
            </p>
          </div>
          <div className="rounded-2xl border border-secondary/25 bg-secondary-soft/60 p-4">
            <p className="m-0 text-xs font-medium text-secondary-text">En atención CEMZOO</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-secondary-text">
              {metrics.EN_ATENCION_CEMZOO}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-slate-100 p-4">
            <p className="m-0 text-xs font-medium text-text-secondary">Cerradas</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-text-primary">
              {metrics.CERRADA}
            </p>
          </div>
        </div>

        <search className="mt-6 border-t border-border pt-5">
          <form onSubmit={handleFilterSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <div>
              <label
                htmlFor="tray-status-filter"
                className="mb-1 block text-xs font-semibold text-text-primary"
              >
                Estado del caso
              </label>
              <select
                id="tray-status-filter"
                name="status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full rounded-xl border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary"
              >
                <option value="">Todos los estados</option>
                <option value="ENVIADA">Enviada</option>
                <option value="EN_ATENCION_CEMZOO">En atención CEMZOO</option>
                <option value="CERRADA">Cerrada</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="tray-type-filter"
                className="mb-1 block text-xs font-semibold text-text-primary"
              >
                Tipo penal
              </label>
              <select
                id="tray-type-filter"
                name="main_type"
                value={mainTypeFilter}
                onChange={(e) => setMainTypeFilter(e.target.value as MainTypeFilter)}
                className="w-full rounded-xl border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary"
              >
                <option value="">Todos los tipos</option>
                <option value="MALTRATO">Maltrato (Art. 350 bis)</option>
                <option value="BIOCIDIO">Biocidio (Art. 350 ter)</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                <Filter aria-hidden="true" className="h-4 w-4" />
                <span>Aplicar filtros</span>
              </button>

              {(appliedStatus || appliedMainType || statusFilter || mainTypeFilter) && (
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

      {statusNotice && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2.5 rounded-2xl border border-secondary/30 bg-secondary-soft p-4 text-sm font-medium text-secondary-text"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 text-sm font-medium text-text-secondary">
            Cargando denuncias recibidas...
          </p>
        </div>
      ) : complaints.length === 0 ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 font-display text-base font-bold text-text-primary">
            No se encontraron denuncias con los filtros seleccionados
          </p>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            Solo se listan denuncias enviadas e inmutables (los borradores ciudadanos permanecen
            privados).
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
              Listado institucional de denuncias enviadas
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
                  Estado
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Envío
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Ubicación
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Pruebas
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((complaint) => {
                const statusMeta = COMPLAINT_STATUS_META[complaint.status];
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

                    <td data-label="Estado" className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                    </td>

                    <td data-label="Envío" className="tabular-nums whitespace-nowrap px-4 py-3.5 text-xs text-text-secondary">
                      {formatDateTimeDisplay(complaint.submitted_at)}
                    </td>

                    <td data-label="Ubicación" className="px-4 py-3.5 text-xs text-text-primary lg:max-w-xs">
                      <span className="truncate-single-line">{complaint.incident_address}</span>
                    </td>

                    <td data-label="Pruebas" className="tabular-nums whitespace-nowrap px-4 py-3.5 text-xs font-semibold text-text-secondary">
                      {complaint.evidences.length}
                    </td>

                    <td data-label="Acciones" className="whitespace-nowrap px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => openDetailModal(complaint)}
                        className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-white"
                      >
                        <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                        <span>Gestionar caso</span>
                      </button>
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
          aria-label="Paginación de denuncias"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-bg-surface px-4 py-3 text-xs font-semibold"
        >
          <span className="tabular-nums text-text-secondary">Página {pageIndex + 1}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={() => void loadComplaints(appliedStatus, appliedMainType, pageIndex - 1)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={!hasNextPage}
              onClick={() => void loadComplaints(appliedStatus, appliedMainType, pageIndex + 1)}
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
        onCancel={(event) => {
          if (updatingStatus) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          if (detailDialogRef.current) {
            detailDialogRef.current.returnValue = "";
          }
          setModalError(null);
          setModalNotice(null);
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
                    : "Detalle de Denuncia"}
                </h2>
              </div>

              <button
                type="button"
                autoFocus
                disabled={updatingStatus}
                onClick={closeDetailModal}
                aria-label="Cerrar detalle del caso"
                className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-border bg-bg-canvas text-text-secondary hover:bg-slate-200 hover:text-text-primary disabled:opacity-60"
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

              {modalNotice && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-start gap-2.5 rounded-2xl border border-secondary/30 bg-secondary-soft p-3.5 text-xs font-medium text-secondary-text sm:text-sm"
                >
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{modalNotice}</span>
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
                  <dt className="font-semibold text-text-secondary">Fecha de envío</dt>
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
                  Evidencias registradas ({selectedComplaint.evidences.length})
                </h3>
                {selectedComplaint.evidences.length > 0 ? (
                  <ul className="m-0 mt-2 list-none space-y-2 p-0">
                    {selectedComplaint.evidences.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex flex-col gap-1.5 rounded-xl border border-border bg-bg-canvas px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                      >
                        <div className="min-w-0">
                          <span className="mr-2 rounded bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">
                            {ev.evidence_type}
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
                    No se adjuntaron archivos digitales en este expediente.
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
                      Incluye los datos completos del denunciante y sustento jurídico.
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

              <div className="rounded-2xl border border-border bg-bg-surface p-4">
                <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                  Transición de estado institucional
                </h3>
                {selectedComplaint.status === "CERRADA" ? (
                  <p className="mt-2 mb-0 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                    <Lock aria-hidden="true" className="h-4 w-4 text-secondary" />
                    <span>Este caso ya fue cerrado y no admite nuevas transiciones.</span>
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {selectedComplaint.status === "ENVIADA" && (
                      <button
                        type="button"
                        disabled={updatingStatus}
                        onClick={() =>
                          handleTransitionStatus(selectedComplaint, "EN_ATENCION_CEMZOO")
                        }
                        className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-60"
                      >
                        <span>
                          {updatingStatus
                            ? "Actualizando..."
                            : "Marcar En atención CEMZOO"}
                        </span>
                      </button>
                    )}
                    {(selectedComplaint.status === "ENVIADA" ||
                      selectedComplaint.status === "EN_ATENCION_CEMZOO") && (
                      <button
                        type="button"
                        disabled={updatingStatus}
                        onClick={() => handleTransitionStatus(selectedComplaint, "CERRADA")}
                        className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary hover:bg-slate-200 disabled:opacity-60"
                      >
                        <span>{updatingStatus ? "Actualizando..." : "Cerrar caso"}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t border-border px-6 py-3.5">
              <button
                type="button"
                disabled={updatingStatus}
                onClick={closeDetailModal}
                className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary hover:bg-slate-200 disabled:opacity-60"
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
