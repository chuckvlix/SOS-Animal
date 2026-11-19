import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Download,
  FileText,
  Lock,
  MapPin,
  PlusCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  deleteDraftComplaint,
  fetchComplaintPdfDownloadUrl,
  fetchMyComplaints,
} from "../services/complaints";
import type { ComplaintRead, UserRead } from "../types";

type HistoryFilter = "ALL" | "DRAFTS" | "SUBMITTED";

const PAGE_SIZE = 50;

function redirectToLogin(): void {
  window.location.replace(`/login?next=${encodeURIComponent("/mis-denuncias")}`);
}

export default function CitizenComplaintsIsland() {
  const [loading, setLoading] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [user, setUser] = useState<UserRead | null>(null);
  const [complaints, setComplaints] = useState<ComplaintRead[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("ALL");

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<ComplaintRead | null>(null);
  const [deletingDraft, setDeletingDraft] = useState(false);

  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const cancelDeleteButtonRef = useRef<HTMLButtonElement>(null);

  const loadComplaintsPage = useCallback(async (page = 0) => {
    setLoadingPage(true);
    setErrorMessage(null);
    try {
      const myList = await fetchMyComplaints(PAGE_SIZE + 1, page * PAGE_SIZE);
      setHasNextPage(myList.length > PAGE_SIZE);
      setComplaints(myList.slice(0, PAGE_SIZE));
      setPageIndex(page);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLogin();
        return;
      }
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos cargar tu historial de denuncias.",
      );
    } finally {
      setLoadingPage(false);
    }
  }, []);

  const loadInitialHistory = useCallback((isCancelled?: () => boolean) => {
    if (!isUserAuthenticated()) {
      redirectToLogin();
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    Promise.all([fetchCurrentUser(), fetchMyComplaints(PAGE_SIZE + 1, 0)])
      .then(([me, myList]) => {
        if (isCancelled?.()) {
          return;
        }
        setUser(me);
        setHasNextPage(myList.length > PAGE_SIZE);
        setComplaints(myList.slice(0, PAGE_SIZE));
        setPageIndex(0);
        setLoading(false);
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
        setErrorMessage(
          err instanceof Error && err.message
            ? err.message
            : "No pudimos cargar tu historial de denuncias.",
        );
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadInitialHistory(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadInitialHistory]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!draftToDelete || !dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      cancelDeleteButtonRef.current?.focus();
    }
  }, [draftToDelete]);

  const counts = useMemo(() => {
    const drafts = complaints.filter(
      (item) => !item.is_immutable && item.status === "BORRADOR",
    ).length;
    const submitted = complaints.length - drafts;
    return {
      all: complaints.length,
      drafts,
      submitted,
    };
  }, [complaints]);

  const visibleComplaints = useMemo(() => {
    if (filter === "DRAFTS") {
      return complaints.filter(
        (item) => !item.is_immutable && item.status === "BORRADOR",
      );
    }
    if (filter === "SUBMITTED") {
      return complaints.filter(
        (item) => item.is_immutable || item.status !== "BORRADOR",
      );
    }
    return complaints;
  }, [complaints, filter]);

  const handleOpenDeleteDialog = (draft: ComplaintRead) => {
    setErrorMessage(null);
    setDraftToDelete(draft);
  };

  const handleCloseDeleteDialog = () => {
    if (deleteDialogRef.current) {
      deleteDialogRef.current.returnValue = "";
      deleteDialogRef.current.close();
    }
    setDraftToDelete(null);
  };

  const handleConfirmDeleteDraft = async () => {
    if (!draftToDelete) {
      return;
    }
    setDeletingDraft(true);
    setErrorMessage(null);
    try {
      await deleteDraftComplaint(draftToDelete.id);
      const shouldStepBack = complaints.length === 1 && pageIndex > 0;
      handleCloseDeleteDialog();
      setStatusMessage("Borrador eliminado correctamente.");
      await loadComplaintsPage(shouldStepBack ? pageIndex - 1 : pageIndex);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLogin();
        return;
      }
      handleCloseDeleteDialog();
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos eliminar el borrador.",
      );
    } finally {
      setDeletingDraft(false);
    }
  };

  const handleDownloadPdf = async (complaintId: string) => {
    setDownloadingId(complaintId);
    setErrorMessage(null);
    try {
      const result = await fetchComplaintPdfDownloadUrl(complaintId);
      openPresignedPdfDownload(result.download_url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLogin();
        return;
      }
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos obtener el enlace de descarga del Documento de Denuncia.",
      );
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
        <p className="m-0 text-sm font-medium text-text-secondary">
          Cargando tus denuncias...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-primary">
              Historial ciudadano
            </p>
            <h1 className="mt-1 mb-0 font-display text-2xl font-bold text-text-primary sm:text-3xl">
              Mis Denuncias
            </h1>
            {user && (
              <p className="mt-1.5 mb-0 text-sm text-text-secondary">
                Cuenta activa: <strong className="text-text-primary">{user.full_name}</strong> ·{" "}
                {user.email}
              </p>
            )}
          </div>

          <a
            href="/denunciar"
            className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-sos px-5 py-3 text-sm font-semibold text-white no-underline transition-opacity hover:opacity-95"
          >
            <PlusCircle aria-hidden="true" className="h-4 w-4" />
            <span>Nueva Denuncia SOS</span>
          </a>
        </div>

        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filtrar mis denuncias">
          {(
            [
              { key: "ALL", label: "Todas", count: counts.all },
              { key: "DRAFTS", label: "En Borrador", count: counts.drafts },
              { key: "SUBMITTED", label: "Enviadas / En Atención", count: counts.submitted },
            ] as const
          ).map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item.key)}
                className={[
                  "inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors sm:text-sm",
                  active
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-bg-canvas text-text-secondary hover:bg-slate-100 hover:text-text-primary",
                ].join(" ")}
              >
                <span>{item.label}</span>
                <span className="tabular-nums rounded-full bg-bg-surface px-2 py-0.5 text-xs text-text-primary">
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {errorMessage && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm font-medium text-sos-text"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            disabled={loadingPage}
            onClick={() => (user ? void loadComplaintsPage(pageIndex) : loadInitialHistory())}
            className="inline-flex min-h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-sos/30 bg-bg-surface px-3 py-1.5 text-xs font-semibold text-sos-text hover:bg-bg-canvas disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${loadingPage ? "animate-spin" : ""}`} />
            <span>Reintentar</span>
          </button>
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-secondary/30 bg-secondary-soft p-4 text-sm font-medium text-secondary-text"
        >
          {statusMessage}
        </div>
      )}

      {visibleComplaints.length === 0 ? (
        <section className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <FileText aria-hidden="true" className="mx-auto h-10 w-10 text-text-muted" />
          <h2 className="mt-3 font-display text-lg font-bold text-text-primary">
            {complaints.length === 0
              ? "Aún no registraste ninguna denuncia"
              : "No hay denuncias en esta categoría"}
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-text-secondary">
            {complaints.length === 0
              ? "Cuando inicies una denuncia guiada, tus borradores y documentos PDF enviados aparecerán aquí."
              : "Cambia el filtro superior o inicia una nueva denuncia cuando lo necesites."}
          </p>
          <a
            href="/denunciar"
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white no-underline hover:bg-primary-hover"
          >
            <span>Iniciar asistente de denuncia</span>
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
        </section>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0">
          {visibleComplaints.map((complaint) => {
            const isDraft = !complaint.is_immutable && complaint.status === "BORRADOR";
            const statusMeta = COMPLAINT_STATUS_META[complaint.status];
            const mainType = complaint.offense_category?.main_type;
            const mainTypeMeta = mainType ? OFFENSE_MAIN_TYPE_META[mainType] : null;

            return (
              <li key={complaint.id}>
                <article className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                        >
                          {!isDraft && <Lock aria-hidden="true" className="h-3 w-3" />}
                          <span>{statusMeta.label}</span>
                        </span>

                        {mainTypeMeta && (
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${mainTypeMeta.badgeClass}`}
                          >
                            {mainType}
                          </span>
                        )}

                        {complaint.tracking_code && (
                          <span className="tabular-nums rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-bold text-primary">
                            {complaint.tracking_code}
                          </span>
                        )}
                      </div>

                      <h2 className="m-0 font-display text-lg font-bold text-text-primary">
                        {complaint.offense_category?.subtype_name ?? "Tipificación registrada"}
                      </h2>
                    </div>

                    <span className="tabular-nums text-xs text-text-secondary">
                      {complaint.evidences.length} evidencia(s)
                    </span>
                  </div>

                  <p className="mt-2.5 mb-0 line-clamp-2 text-sm text-text-secondary">
                    {complaint.description}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-secondary">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
                      <span>{complaint.incident_address}</span>
                    </span>
                    <span className="tabular-nums inline-flex items-center gap-1.5">
                      <Calendar aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
                      <span>
                        {isDraft
                          ? `Hecho: ${formatDateTimeDisplay(complaint.incident_date)}`
                          : `Enviada: ${formatDateTimeDisplay(complaint.submitted_at)}`}
                      </span>
                    </span>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-border pt-4">
                    {isDraft ? (
                      <>
                        <a
                          href={`/denunciar?draft=${encodeURIComponent(complaint.id)}`}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white no-underline hover:bg-primary-hover sm:text-sm"
                        >
                          <span>Continuar denuncia</span>
                          <ArrowRight aria-hidden="true" className="h-4 w-4" />
                        </a>

                        <button
                          type="button"
                          onClick={() => handleOpenDeleteDialog(complaint)}
                          className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-sos/30 bg-bg-surface px-4 py-2 text-xs font-semibold text-sos-text hover:bg-sos-soft sm:text-sm"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                          <span>Eliminar borrador</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={downloadingId === complaint.id}
                          onClick={() => handleDownloadPdf(complaint.id)}
                          className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60 sm:text-sm"
                        >
                          <Download aria-hidden="true" className="h-4 w-4" />
                          <span>
                            {downloadingId === complaint.id
                              ? "Generando enlace..."
                              : "Descargar Documento de Denuncia (PDF)"}
                          </span>
                        </button>

                        {complaint.tracking_code && (
                          <a
                            href={`/seguimiento?code=${encodeURIComponent(complaint.tracking_code)}`}
                            className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary no-underline hover:bg-primary-soft hover:text-primary sm:text-sm"
                          >
                            Ver seguimiento público
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {(pageIndex > 0 || hasNextPage) && !loading && (
        <nav
          aria-label="Paginación de mis denuncias"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-bg-surface px-4 py-3 text-xs font-semibold"
        >
          <span className="tabular-nums text-text-secondary">Página {pageIndex + 1}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pageIndex === 0 || loadingPage}
              onClick={() => void loadComplaintsPage(pageIndex - 1)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={!hasNextPage || loadingPage}
              onClick={() => void loadComplaintsPage(pageIndex + 1)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Siguiente
            </button>
          </div>
        </nav>
      )}

      <dialog
        ref={deleteDialogRef}
        aria-labelledby="delete-draft-title"
        onCancel={(event) => {
          if (deletingDraft) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          if (deleteDialogRef.current) {
            deleteDialogRef.current.returnValue = "";
          }
          setDraftToDelete(null);
        }}
        className="w-full max-w-md rounded-3xl border border-border bg-bg-surface p-6 text-text-primary shadow-xl"
      >
        <h2 id="delete-draft-title" className="m-0 font-display text-lg font-bold text-text-primary">
          ¿Eliminar borrador de denuncia?
        </h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-text-secondary">
          Se eliminará este borrador{" "}
          {draftToDelete ? (
            <>
              ubicado en <strong>{draftToDelete.incident_address}</strong>
            </>
          ) : null}{" "}
          junto con sus evidencias adjuntas. Esta acción no se puede deshacer.
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            ref={cancelDeleteButtonRef}
            type="button"
            autoFocus
            disabled={deletingDraft}
            onClick={handleCloseDeleteDialog}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-canvas disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={deletingDraft}
            onClick={handleConfirmDeleteDraft}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-sos px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            <span>{deletingDraft ? "Eliminando..." : "Sí, eliminar borrador"}</span>
          </button>
        </div>
      </dialog>
    </div>
  );
}
