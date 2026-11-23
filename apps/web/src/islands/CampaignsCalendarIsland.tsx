import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ClipboardList,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCampaigns } from "../services/campaigns";
import {
  CAMPAIGN_STATUS_META,
  CAMPAIGN_TYPE_META,
  formatCampaignDateRange,
  getCampaignStatus,
  type CampaignStatus,
} from "../services/campaignLabels";
import type { CampaignRead, CampaignType } from "../types";

type TypeFilter = "" | CampaignType;
type StatusFilter = "ALL" | "CURRENT" | "PAST";

const MAX_CAMPAIGNS = 100;

const TYPE_FILTERS: readonly { readonly value: TypeFilter; readonly label: string }[] = [
  { value: "", label: "Todas" },
  { value: "CALENDARIO_VACUNACION", label: "Vacunación" },
  { value: "CAMPANA_ESTERILIZACION", label: "Esterilización" },
  { value: "ATENCION_EMERGENCIA", label: "Emergencia" },
  { value: "PROXIMA_JORNADA", label: "Próxima jornada" },
];

const STATUS_ORDER: Record<CampaignStatus, number> = {
  EN_CURSO: 0,
  PROXIMA: 1,
  FINALIZADA: 2,
};

function buildOpenStreetMapUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

export default function CampaignsCalendarIsland() {
  const [campaigns, setCampaigns] = useState<CampaignRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const list = await fetchCampaigns({ limit: MAX_CAMPAIGNS });
      setCampaigns(list);
    } catch (err) {
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos cargar las jornadas publicadas.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const visibleCampaigns = useMemo(() => {
    const now = new Date();
    const filtered = campaigns.filter((campaign) => {
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
      return true;
    });

    return [...filtered].sort((a, b) => {
      const statusA = getCampaignStatus(a, now);
      const statusB = getCampaignStatus(b, now);
      if (statusA !== statusB) {
        return STATUS_ORDER[statusA] - STATUS_ORDER[statusB];
      }
      const startA = new Date(a.start_date).getTime();
      const startB = new Date(b.start_date).getTime();
      return statusA === "FINALIZADA" ? startB - startA : startA - startB;
    });
  }, [campaigns, statusFilter, typeFilter]);

  return (
    <section aria-labelledby="campaigns-list-title" className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-secondary-text">
            Agenda pública de salud veterinaria
          </p>
          <h2
            id="campaigns-list-title"
            className="mt-1 mb-0 font-display text-2xl font-bold text-text-primary"
          >
            Jornadas y campañas publicadas
          </h2>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            Vacunación antirrábica, esterilización y atención prioritaria organizadas en Sucre.
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadCampaigns()}
          className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 self-start rounded-xl border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-60 sm:self-auto sm:text-sm"
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span>Actualizar</span>
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Filtrar jornadas por tipo de campaña"
          className="flex flex-wrap gap-1.5"
        >
          {TYPE_FILTERS.map((filter) => {
            const isActive = typeFilter === filter.value;
            return (
              <button
                key={filter.value || "all"}
                type="button"
                aria-pressed={isActive}
                onClick={() => setTypeFilter(filter.value)}
                className={[
                  "inline-flex min-h-[38px] cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  isActive
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-bg-canvas text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="campaigns-status-filter" className="text-xs font-semibold text-text-secondary">
            Estado
          </label>
          <select
            id="campaigns-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="min-h-[38px] rounded-xl border border-border bg-bg-surface px-3 py-1.5 text-xs font-medium text-text-primary"
          >
            <option value="ALL">Todas</option>
            <option value="CURRENT">Vigentes y próximas</option>
            <option value="PAST">Finalizadas</option>
          </select>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm text-sos-text"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="m-0 font-semibold">No pudimos cargar la agenda de campañas</p>
            <p className="mt-1 mb-0">{errorMessage}</p>
            <button
              type="button"
              onClick={() => void loadCampaigns()}
              className="mt-3 inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl bg-sos-text px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Reintentar</span>
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              aria-hidden="true"
              className="h-64 animate-pulse rounded-3xl border border-border bg-bg-surface p-5"
            >
              <div className="h-5 w-28 rounded-full bg-bg-canvas" />
              <div className="mt-4 h-6 w-3/4 rounded bg-bg-canvas" />
              <div className="mt-3 h-4 w-full rounded bg-bg-canvas" />
              <div className="mt-2 h-4 w-5/6 rounded bg-bg-canvas" />
              <div className="mt-6 h-10 w-full rounded-xl bg-bg-canvas" />
            </div>
          ))}
        </div>
      ) : visibleCampaigns.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
          <p className="m-0 font-display text-base font-bold text-text-primary">
            {campaigns.length === 0
              ? "Aún no hay jornadas publicadas"
              : "No hay jornadas con los filtros seleccionados"}
          </p>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            {campaigns.length === 0
              ? "La Universidad publicará aquí las próximas campañas de vacunación y esterilización."
              : "Prueba con otro tipo de campaña o revisa las jornadas finalizadas."}
          </p>
        </div>
      ) : (
        <>
          <p className="tabular-nums mt-4 mb-0 text-xs font-medium text-text-secondary">
            {visibleCampaigns.length} jornada{visibleCampaigns.length === 1 ? "" : "s"} en la agenda
          </p>

          <ul className="m-0 mt-3 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
            {visibleCampaigns.map((campaign) => {
              const typeMeta = CAMPAIGN_TYPE_META[campaign.campaign_type];
              const statusMeta = CAMPAIGN_STATUS_META[getCampaignStatus(campaign)];

              return (
                <li key={campaign.id} className="flex">
                  <article className="flex w-full flex-col rounded-3xl border border-border bg-bg-surface p-5 shadow-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${typeMeta.badgeClass}`}
                      >
                        {typeMeta.label}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <h3 className="mt-3 mb-0 font-display text-lg font-bold leading-snug text-text-primary">
                      {campaign.title}
                    </h3>

                    <dl className="mt-3 mb-0 space-y-1.5 text-xs text-text-secondary">
                      <div className="flex items-start gap-2">
                        <dt className="mt-0.5 shrink-0">
                          <CalendarDays aria-hidden="true" className="h-4 w-4 text-primary" />
                          <span className="visually-hidden">Fecha y hora</span>
                        </dt>
                        <dd className="m-0">
                          {formatCampaignDateRange(campaign.start_date, campaign.end_date)}
                        </dd>
                      </div>
                      <div className="flex items-start gap-2">
                        <dt className="mt-0.5 shrink-0">
                          <MapPin aria-hidden="true" className="h-4 w-4 text-primary" />
                          <span className="visually-hidden">Lugar</span>
                        </dt>
                        <dd className="m-0">{campaign.location_address}</dd>
                      </div>
                      <div className="flex items-start gap-2">
                        <dt className="mt-0.5 shrink-0">
                          <Building2 aria-hidden="true" className="h-4 w-4 text-primary" />
                          <span className="visually-hidden">Institución organizadora</span>
                        </dt>
                        <dd className="m-0">{campaign.institution}</dd>
                      </div>
                    </dl>

                    <p className="mt-3 mb-0 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                      {campaign.description}
                    </p>

                    {campaign.requirements && (
                      <div className="mt-3 rounded-2xl border border-border bg-bg-canvas p-3">
                        <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                          <ClipboardList aria-hidden="true" className="h-3.5 w-3.5 text-secondary-text" />
                          <span>Requisitos de asistencia</span>
                        </p>
                        <p className="mt-1 mb-0 whitespace-pre-line text-xs leading-relaxed text-text-secondary">
                          {campaign.requirements}
                        </p>
                      </div>
                    )}

                    {campaign.latitude !== null && campaign.longitude !== null && (
                      <a
                        href={buildOpenStreetMapUrl(campaign.latitude, campaign.longitude)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-auto inline-flex min-h-[40px] items-center gap-1.5 self-start pt-3 text-xs font-semibold text-primary no-underline hover:text-primary-hover"
                      >
                        <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                        <span>Ver ubicación en el mapa</span>
                      </a>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
