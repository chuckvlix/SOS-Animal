import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../services/api";
import { clearStoredAccessToken, fetchCurrentUser, isUserAuthenticated } from "../services/auth";
import { createCampaign, deleteCampaign, fetchCampaigns, replaceCampaign } from "../services/campaigns";
import {
  CAMPAIGN_STATUS_META,
  CAMPAIGN_TYPE_META,
  formatCampaignDateRange,
  getCampaignStatus,
} from "../services/campaignLabels";
import type { CampaignCreate, CampaignRead, CampaignType, UserRead } from "../types";
import IncidentLocationPicker from "./IncidentLocationPicker";

type TypeFilter = "" | CampaignType;
type StatusFilter = "ALL" | "CURRENT" | "PAST";

const PAGE_SIZE = 12;
const MAX_CAMPAIGNS = 100;

const CAMPAIGN_TYPE_OPTIONS: readonly CampaignType[] = [
  "CALENDARIO_VACUNACION",
  "CAMPANA_ESTERILIZACION",
  "ATENCION_EMERGENCIA",
  "PROXIMA_JORNADA",
];

const INPUT_CLASS =
  "w-full rounded-xl border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted";
const LABEL_CLASS = "mb-1 block text-xs font-semibold text-text-primary";

interface CampaignFormState {
  title: string;
  campaign_type: CampaignType;
  description: string;
  requirements: string;
  location_address: string;
  latitude: string;
  longitude: string;
  start_date: string;
  end_date: string;
  institution: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function toDayStartInputValue(date: Date): string {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  return toDateTimeInputValue(dayStart);
}

function parseCoordinate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCampaignDate(isoString: string): Date {
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoString);
  return new Date(hasTimeZone ? isoString : `${isoString}Z`);
}

function toCampaignDateTimeInputValue(isoString: string): string {
  const date = parseCampaignDate(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return toDateTimeInputValue(date);
}

function createEmptyForm(): CampaignFormState {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(15, 0, 0, 0);

  return {
    title: "",
    campaign_type: "CALENDARIO_VACUNACION",
    description: "",
    requirements: "",
    location_address: "",
    latitude: "",
    longitude: "",
    start_date: toDateTimeInputValue(start),
    end_date: toDateTimeInputValue(end),
    institution: "",
  };
}

function campaignToForm(campaign: CampaignRead): CampaignFormState {
  return {
    title: campaign.title,
    campaign_type: campaign.campaign_type,
    description: campaign.description,
    requirements: campaign.requirements ?? "",
    location_address: campaign.location_address,
    latitude: campaign.latitude !== null ? String(campaign.latitude) : "",
    longitude: campaign.longitude !== null ? String(campaign.longitude) : "",
    start_date: toCampaignDateTimeInputValue(campaign.start_date),
    end_date: toCampaignDateTimeInputValue(campaign.end_date),
    institution: campaign.institution,
  };
}

function buildCampaignPayload(form: CampaignFormState): CampaignCreate {
  const title = form.title.trim();
  const description = form.description.trim();
  const locationAddress = form.location_address.trim();
  const institution = form.institution.trim();
  if (!title || !description || !locationAddress || !institution) {
    throw new Error("Completa el título, la descripción, el lugar y la institución.");
  }

  const latitudeText = form.latitude.trim();
  const longitudeText = form.longitude.trim();
  if ((latitudeText === "") !== (longitudeText === "")) {
    throw new Error("Ingresa latitud y longitud juntas, o deja ambas vacías.");
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (latitudeText !== "" && longitudeText !== "") {
    latitude = Number(latitudeText);
    longitude = Number(longitudeText);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error("La latitud debe ser un número entre -90 y 90.");
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("La longitud debe ser un número entre -180 y 180.");
    }
  }

  const start = new Date(form.start_date);
  const end = new Date(form.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Selecciona la fecha y hora de inicio y de fin.");
  }
  if (end.getTime() < start.getTime()) {
    throw new Error("La fecha de fin no puede ser anterior a la fecha de inicio.");
  }

  return {
    title,
    campaign_type: form.campaign_type,
    description,
    requirements: form.requirements.trim() ? form.requirements.trim() : null,
    location_address: locationAddress,
    latitude,
    longitude,
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    institution,
  };
}

function redirectToLogin(): void {
  window.location.replace(`/login?next=${encodeURIComponent("/panel/campanas")}`);
}

export default function AdminCampaignsIsland() {
  const [authorizedAdmin, setAuthorizedAdmin] = useState<UserRead | null>(null);
  const [verifyingSession, setVerifyingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignRead[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [pageIndex, setPageIndex] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [formDialogReady, setFormDialogReady] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignRead | null>(null);
  const [form, setForm] = useState<CampaignFormState>(createEmptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<CampaignRead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const formDialogRef = useRef<HTMLDialogElement>(null);
  const formTitleInputRef = useRef<HTMLInputElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);

  const todayStartValue = useMemo(() => toDayStartInputValue(new Date()), []);
  const minimumStartValue = useMemo(() => {
    if (!editingCampaign) {
      return todayStartValue;
    }
    const originalStart = parseCampaignDate(editingCampaign.start_date);
    return toDateTimeInputValue(originalStart) < todayStartValue
      ? toDayStartInputValue(originalStart)
      : todayStartValue;
  }, [editingCampaign, todayStartValue]);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const list = await fetchCampaigns({ limit: MAX_CAMPAIGNS });
      setCampaigns(list);
      setPageIndex(0);
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
          : "No pudimos cargar las campañas registradas.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

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
          setAuthorizedAdmin(me);
          setVerifyingSession(false);
          void loadCampaigns();
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
            window.location.replace("/panel/denuncias");
            return;
          }
          setSessionError(
            err instanceof Error && err.message
              ? err.message
              : "No pudimos verificar tus permisos de administrador con el servidor.",
          );
          setVerifyingSession(false);
        });
    },
    [loadCampaigns],
  );

  useEffect(() => {
    let cancelled = false;
    verifyAndInitialize(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [verifyAndInitialize]);

  useEffect(() => {
    const dialog = formDialogRef.current;
    if (!formOpen || !dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      formTitleInputRef.current?.focus();
    }
    setFormDialogReady(true);
  }, [formOpen]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!pendingDelete || !dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      deleteCancelButtonRef.current?.focus();
    }
  }, [pendingDelete]);

  const stats = useMemo(() => {
    const now = new Date();
    let current = 0;
    let upcoming = 0;
    for (const campaign of campaigns) {
      const status = getCampaignStatus(campaign, now);
      if (status === "EN_CURSO") {
        current += 1;
      } else if (status === "PROXIMA") {
        upcoming += 1;
      }
    }
    return { total: campaigns.length, current, upcoming };
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const now = new Date();
    const term = searchInput.trim().toLocaleLowerCase("es");
    return campaigns.filter((campaign) => {
      if (typeFilter && campaign.campaign_type !== typeFilter) {
        return false;
      }
      const status = getCampaignStatus(campaign, now);
      if (statusFilter === "CURRENT" && status === "FINALIZADA") {
        return false;
      }
      if (statusFilter === "PAST" && status !== "FINALIZADA") {
        return false;
      }
      if (!term) {
        return true;
      }
      return [campaign.title, campaign.institution, campaign.location_address].some((value) =>
        value.toLocaleLowerCase("es").includes(term),
      );
    });
  }, [campaigns, searchInput, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredCampaigns.length / PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pagedCampaigns = filteredCampaigns.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  );

  function updateForm<K extends keyof CampaignFormState>(
    field: K,
    value: CampaignFormState[K],
  ): void {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  const openCreateForm = () => {
    setEditingCampaign(null);
    setForm(createEmptyForm());
    setFormError(null);
    setStatusMessage(null);
    setFormOpen(true);
  };

  const openEditForm = (campaign: CampaignRead) => {
    setEditingCampaign(campaign);
    setForm(campaignToForm(campaign));
    setFormError(null);
    setStatusMessage(null);
    setFormOpen(true);
  };

  const closeFormDialog = () => {
    if (saving) {
      return;
    }
    formDialogRef.current?.close();
  };

  const handleFormSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    let payload: CampaignCreate;
    try {
      payload = buildCampaignPayload(form);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Revisa los datos del formulario.");
      return;
    }

    if (
      !editingCampaign &&
      new Date(payload.start_date).getTime() < new Date(todayStartValue).getTime()
    ) {
      setFormError("La fecha de inicio no puede ser anterior a hoy.");
      return;
    }

    setSaving(true);
    try {
      if (editingCampaign) {
        const updated = await replaceCampaign(editingCampaign.id, payload);
        setStatusMessage(`La campaña "${updated.title}" fue actualizada correctamente.`);
      } else {
        const created = await createCampaign(payload);
        setStatusMessage(`La campaña "${created.title}" fue publicada correctamente.`);
      }
      formDialogRef.current?.close();
      await loadCampaigns();
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
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos guardar la campaña. Intenta nuevamente.",
      );
    } finally {
      setSaving(false);
    }
  };

  const closeDeleteDialog = () => {
    if (deleting) {
      return;
    }
    deleteDialogRef.current?.close();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCampaign(pendingDelete.id);
      setStatusMessage(`La campaña "${pendingDelete.title}" fue eliminada.`);
      deleteDialogRef.current?.close();
      await loadCampaigns();
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
      setDeleteError(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos eliminar la campaña. Intenta nuevamente.",
      );
    } finally {
      setDeleting(false);
    }
  };

  if (!authorizedAdmin) {
    if (sessionError && !verifyingSession) {
      return (
        <div role="alert" className="rounded-3xl border border-sos/30 bg-sos-soft p-6 shadow-xs">
          <h1 className="m-0 font-display text-lg font-bold text-sos-text">
            No pudimos validar el acceso a las campañas
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

  const filtersActive = searchInput.trim() !== "" || typeFilter !== "" || statusFilter !== "ALL";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-secondary-text">
              Panel Universitario · Salud veterinaria
            </p>
            <h1 className="mt-1 mb-0 font-display text-2xl font-bold text-text-primary sm:text-3xl">
              Campañas y Jornadas
            </h1>
            <p className="mt-1.5 mb-0 text-sm text-text-secondary">
              Publica y administra las jornadas de vacunación, esterilización y atención de
              emergencia que se muestran en el portal ciudadano.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadCampaigns()}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-60 sm:text-sm"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Actualizar</span>
            </button>

            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-hover sm:text-sm"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              <span>Nueva campaña</span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-bg-canvas p-4">
            <p className="m-0 text-xs font-medium text-text-secondary">Campañas registradas</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-text-primary">
              {stats.total}
            </p>
            <p className="mt-1 mb-0 text-[11px] text-text-secondary">Agenda completa</p>
          </div>

          <div className="rounded-2xl border border-secondary/25 bg-secondary-soft/60 p-4">
            <p className="m-0 text-xs font-medium text-secondary-text">En curso</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-secondary-text">
              {stats.current}
            </p>
            <p className="mt-1 mb-0 text-[11px] text-text-secondary">Visibles hoy en el portal</p>
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary-soft/50 p-4">
            <p className="m-0 text-xs font-medium text-primary">Próximas</p>
            <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-primary">
              {stats.upcoming}
            </p>
            <p className="mt-1 mb-0 text-[11px] text-text-secondary">Programadas a futuro</p>
          </div>
        </div>
      </section>

      {statusMessage && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-secondary/30 bg-secondary-soft p-4 text-sm text-secondary-text"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm text-sos-text"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <section className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end">
          <div className="md:col-span-5">
            <label htmlFor="campaign-admin-search" className={LABEL_CLASS}>
              Buscar por título, institución o lugar
            </label>
            <input
              id="campaign-admin-search"
              type="search"
              maxLength={120}
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPageIndex(0);
              }}
              placeholder="Ej. Vacunación antirrábica o CEMZOO"
              className={INPUT_CLASS}
            />
          </div>

          <div className="md:col-span-3">
            <label htmlFor="campaign-admin-type-filter" className={LABEL_CLASS}>
              Tipo de campaña
            </label>
            <select
              id="campaign-admin-type-filter"
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value as TypeFilter);
                setPageIndex(0);
              }}
              className={INPUT_CLASS}
            >
              <option value="">Todos los tipos</option>
              {CAMPAIGN_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {CAMPAIGN_TYPE_META[type].label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="campaign-admin-status-filter" className={LABEL_CLASS}>
              Estado
            </label>
            <select
              id="campaign-admin-status-filter"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter);
                setPageIndex(0);
              }}
              className={INPUT_CLASS}
            >
              <option value="ALL">Todos</option>
              <option value="CURRENT">Vigentes y próximas</option>
              <option value="PAST">Finalizadas</option>
            </select>
          </div>

          <div className="md:col-span-2 md:justify-self-end">
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setTypeFilter("");
                  setStatusFilter("ALL");
                  setPageIndex(0);
                }}
                className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-xl border border-border bg-bg-canvas px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-slate-100 hover:text-text-primary md:w-auto"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 text-sm font-medium text-text-secondary">
            Cargando campañas registradas...
          </p>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 font-display text-base font-bold text-text-primary">
            {campaigns.length === 0
              ? "Todavía no hay campañas registradas"
              : "No hay campañas con los filtros actuales"}
          </p>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            {campaigns.length === 0
              ? "Usa el botón «Nueva campaña» para publicar la primera jornada en el portal ciudadano."
              : "Prueba con otro tipo, estado o término de búsqueda."}
          </p>
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="admin-campaigns-caption"
          className="sos-table-wrapper"
        >
          <table className="sos-responsive-table text-sm">
            <caption id="admin-campaigns-caption" className="visually-hidden">
              Campañas y jornadas de salud veterinaria registradas
            </caption>
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <th scope="col" className="px-4 py-3.5">
                  Campaña
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Fechas
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Lugar
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Institución
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedCampaigns.map((campaign) => {
                const typeMeta = CAMPAIGN_TYPE_META[campaign.campaign_type];
                const statusMeta = CAMPAIGN_STATUS_META[getCampaignStatus(campaign)];
                const hasCoordinates =
                  campaign.latitude !== null && campaign.longitude !== null;

                return (
                  <tr key={campaign.id} className="hover:bg-bg-canvas/70">
                    <th
                      scope="row"
                      className="px-4 py-3.5 font-semibold text-text-primary lg:max-w-[280px]"
                    >
                      <div className="flex flex-col items-end gap-1 lg:items-start">
                        <span className="line-clamp-2 text-left">{campaign.title}</span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${typeMeta.badgeClass}`}
                        >
                          {typeMeta.label}
                        </span>
                      </div>
                    </th>

                    <td
                      data-label="Fechas"
                      className="tabular-nums px-4 py-3.5 text-xs text-text-secondary lg:max-w-[240px]"
                    >
                      <div className="flex flex-col items-end gap-1 lg:items-start">
                        <span className="text-right lg:text-left">
                          {formatCampaignDateRange(campaign.start_date, campaign.end_date)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>
                      </div>
                    </td>

                    <td
                      data-label="Lugar"
                      className="px-4 py-3.5 text-xs text-text-primary lg:max-w-[220px]"
                    >
                      <div className="flex flex-col items-end gap-1 lg:items-start">
                        <span className="text-right lg:text-left">{campaign.location_address}</span>
                        {hasCoordinates && (
                          <span className="tabular-nums inline-flex items-center gap-1 rounded bg-secondary-soft px-1.5 py-0.5 text-[11px] font-semibold text-secondary-text">
                            <MapPin aria-hidden="true" className="h-3 w-3" />
                            GPS registrado
                          </span>
                        )}
                      </div>
                    </td>

                    <td
                      data-label="Institución"
                      className="px-4 py-3.5 text-xs text-text-secondary lg:max-w-[200px]"
                    >
                      <span className="inline-flex items-start gap-1.5">
                        <Building2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="text-right lg:text-left">{campaign.institution}</span>
                      </span>
                    </td>

                    <td data-label="Acciones" className="whitespace-nowrap px-4 py-3.5">
                      <div className="flex flex-wrap items-center justify-end gap-2 lg:justify-start">
                        <button
                          type="button"
                          onClick={() => openEditForm(campaign)}
                          className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-canvas px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary"
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                          <span>Editar</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(campaign);
                          }}
                          className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-sos/25 bg-sos-soft px-3 py-1.5 text-xs font-semibold text-sos-text transition-colors hover:bg-sos-soft/70"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                          <span>Eliminar</span>
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

      {pageCount > 1 && !loading && (
        <nav
          aria-label="Paginación de campañas"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-bg-surface px-4 py-3 text-xs font-semibold"
        >
          <span className="tabular-nums text-text-secondary">
            Página {currentPage + 1} de {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPageIndex(currentPage - 1)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPageIndex(currentPage + 1)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-border bg-bg-canvas px-3 py-1.5 text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Siguiente
            </button>
          </div>
        </nav>
      )}

      <dialog
        ref={formDialogRef}
        aria-labelledby="campaign-form-title"
        onCancel={(event) => {
          if (saving) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          if (formDialogRef.current) {
            formDialogRef.current.returnValue = "";
          }
          setFormOpen(false);
          setFormDialogReady(false);
          setEditingCampaign(null);
          setFormError(null);
        }}
        className="w-full max-w-2xl rounded-3xl border border-border bg-bg-surface p-0 text-text-primary shadow-xl"
      >
        <form onSubmit={handleFormSubmit} className="flex max-h-[88dvh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-secondary-text">
                Panel Universitario
              </p>
              <h2
                id="campaign-form-title"
                className="mt-1 mb-0 font-display text-lg font-bold text-text-primary"
              >
                {editingCampaign ? "Editar campaña" : "Nueva campaña"}
              </h2>
            </div>

            <button
              type="button"
              onClick={closeFormDialog}
              aria-label="Cerrar formulario de campaña"
              className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-border bg-bg-canvas text-text-secondary hover:bg-slate-100 hover:text-text-primary"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="campaign-title" className={LABEL_CLASS}>
                Título de la campaña *
              </label>
              <input
                ref={formTitleInputRef}
                id="campaign-title"
                type="text"
                required
                maxLength={200}
                value={form.title}
                onChange={(event) => updateForm("title", event.target.value)}
                placeholder="Ej. Jornada gratuita de vacunación antirrábica"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="campaign-type" className={LABEL_CLASS}>
                Tipo de campaña *
              </label>
              <select
                id="campaign-type"
                required
                value={form.campaign_type}
                onChange={(event) => updateForm("campaign_type", event.target.value as CampaignType)}
                className={INPUT_CLASS}
              >
                {CAMPAIGN_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {CAMPAIGN_TYPE_META[type].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="campaign-institution" className={LABEL_CLASS}>
                Institución organizadora *
              </label>
              <input
                id="campaign-institution"
                type="text"
                required
                maxLength={150}
                value={form.institution}
                onChange={(event) => updateForm("institution", event.target.value)}
                placeholder="Ej. Centro Municipal de Zoonosis"
                className={INPUT_CLASS}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="campaign-description" className={LABEL_CLASS}>
                Descripción *
              </label>
              <textarea
                id="campaign-description"
                required
                rows={4}
                maxLength={5000}
                value={form.description}
                onChange={(event) => updateForm("description", event.target.value)}
                placeholder="Describe los servicios disponibles, horarios y a quién está dirigida la jornada."
                className={INPUT_CLASS}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="campaign-requirements" className={LABEL_CLASS}>
                Requisitos de asistencia (opcional)
              </label>
              <textarea
                id="campaign-requirements"
                rows={3}
                maxLength={2000}
                value={form.requirements}
                onChange={(event) => updateForm("requirements", event.target.value)}
                placeholder="Ej. Llevar carnet de identidad, correa y bozal si es necesario."
                className={INPUT_CLASS}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="campaign-location" className={LABEL_CLASS}>
                Lugar o dirección *
              </label>
              <input
                id="campaign-location"
                type="text"
                required
                maxLength={255}
                value={form.location_address}
                onChange={(event) => updateForm("location_address", event.target.value)}
                placeholder="Ej. Plaza principal de Sucre, ingreso por la calle Bolívar"
                className={INPUT_CLASS}
              />
            </div>

            {formDialogReady && (
              <div className="sm:col-span-2">
                <IncidentLocationPicker
                  latitude={parseCoordinate(form.latitude)}
                  longitude={parseCoordinate(form.longitude)}
                  onChange={({ latitude, longitude }) => {
                    updateForm("latitude", latitude === null ? "" : String(latitude));
                    updateForm("longitude", longitude === null ? "" : String(longitude));
                  }}
                />
              </div>
            )}

            <div>
              <label htmlFor="campaign-start" className={LABEL_CLASS}>
                Inicio *
              </label>
              <input
                id="campaign-start"
                type="datetime-local"
                required
                min={minimumStartValue}
                value={form.start_date}
                onChange={(event) => updateForm("start_date", event.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="campaign-end" className={LABEL_CLASS}>
                Fin *
              </label>
              <input
                id="campaign-end"
                type="datetime-local"
                required
                min={form.start_date || minimumStartValue}
                value={form.end_date}
                onChange={(event) => updateForm("end_date", event.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <p className="m-0 text-[11px] leading-relaxed text-text-secondary sm:col-span-2">
              Marca en el mapa el punto donde se realizará la campaña para que la ciudadanía pueda
              ubicarlo. El horario se interpreta en la zona local del navegador y se guarda en UTC.
            </p>

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-sos/30 bg-sos-soft p-3 text-xs text-sos-text sm:col-span-2"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2.5 border-t border-border px-6 py-4">
            <button
              type="button"
              disabled={saving}
              onClick={closeFormDialog}
              className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-canvas disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              <CalendarDays aria-hidden="true" className="h-4 w-4" />
              <span>
                {saving
                  ? "Guardando..."
                  : editingCampaign
                    ? "Guardar cambios"
                    : "Publicar campaña"}
              </span>
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialogRef}
        aria-labelledby="delete-campaign-title"
        onCancel={(event) => {
          if (deleting) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          if (deleteDialogRef.current) {
            deleteDialogRef.current.returnValue = "";
          }
          setPendingDelete(null);
          setDeleteError(null);
        }}
        className="w-full max-w-md rounded-3xl border border-border bg-bg-surface p-6 text-text-primary shadow-xl"
      >
        <h2
          id="delete-campaign-title"
          className="m-0 font-display text-lg font-bold text-text-primary"
        >
          ¿Eliminar esta campaña?
        </h2>
        {pendingDelete && (
          <p className="mt-2 mb-0 text-sm leading-relaxed text-text-secondary">
            La campaña <strong className="text-text-primary">{pendingDelete.title}</strong> dejará
            de mostrarse en el portal ciudadano. Esta acción no se puede deshacer.
          </p>
        )}

        {deleteError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-sos/30 bg-sos-soft p-3 text-xs text-sos-text"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{deleteError}</span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            ref={deleteCancelButtonRef}
            type="button"
            disabled={deleting}
            onClick={closeDeleteDialog}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-canvas disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleConfirmDelete()}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-sos-text px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            <span>{deleting ? "Eliminando..." : "Eliminar campaña"}</span>
          </button>
        </div>
      </dialog>
    </div>
  );
}
