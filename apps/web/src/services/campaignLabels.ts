import type { CampaignRead, CampaignType } from "../types";
import type { BadgeMeta } from "./complaintLabels";

export type CampaignStatus = "EN_CURSO" | "PROXIMA" | "FINALIZADA";

export const CAMPAIGN_TYPE_META: Record<
  CampaignType,
  BadgeMeta & { readonly description: string }
> = {
  CALENDARIO_VACUNACION: {
    label: "Vacunación",
    badgeClass: "border-primary/25 bg-primary-soft text-primary",
    description: "Jornadas de vacunación antirrábica y refuerzos de calendario.",
  },
  CAMPANA_ESTERILIZACION: {
    label: "Esterilización",
    badgeClass: "border-secondary/25 bg-secondary-soft text-secondary-text",
    description: "Campañas gratuitas o subsidiadas de esterilización responsable.",
  },
  ATENCION_EMERGENCIA: {
    label: "Atención de emergencia",
    badgeClass: "border-sos/25 bg-sos-soft text-sos-text",
    description: "Puntos de atención prioritaria para animales en riesgo.",
  },
  PROXIMA_JORNADA: {
    label: "Próxima jornada",
    badgeClass: "border-border bg-bg-canvas text-text-secondary",
    description: "Actividades anunciadas por la Universidad y aliados municipales.",
  },
};

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, BadgeMeta> = {
  EN_CURSO: {
    label: "En curso",
    badgeClass: "border-secondary/25 bg-secondary-soft text-secondary-text",
  },
  PROXIMA: {
    label: "Próxima",
    badgeClass: "border-primary/25 bg-primary-soft text-primary",
  },
  FINALIZADA: {
    label: "Finalizada",
    badgeClass: "border-border bg-bg-canvas text-text-muted",
  },
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium" });
const TIME_FORMATTER = new Intl.DateTimeFormat("es-BO", { timeStyle: "short" });

function parseCampaignDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getCampaignStatus(
  campaign: Pick<CampaignRead, "start_date" | "end_date">,
  now: Date = new Date(),
): CampaignStatus {
  const start = parseCampaignDate(campaign.start_date);
  const end = parseCampaignDate(campaign.end_date);
  if (!start || !end) {
    return "FINALIZADA";
  }
  if (end.getTime() < now.getTime()) {
    return "FINALIZADA";
  }
  if (start.getTime() > now.getTime()) {
    return "PROXIMA";
  }
  return "EN_CURSO";
}

export function formatCampaignDateRange(startIso: string, endIso: string): string {
  const start = parseCampaignDate(startIso);
  const end = parseCampaignDate(endIso);
  if (!start || !end) {
    return `${startIso} — ${endIso}`;
  }

  const startDate = DATE_FORMATTER.format(start);
  const endDate = DATE_FORMATTER.format(end);
  if (startDate === endDate) {
    return `${startDate} · ${TIME_FORMATTER.format(start)} a ${TIME_FORMATTER.format(end)}`;
  }
  return `${startDate}, ${TIME_FORMATTER.format(start)} — ${endDate}, ${TIME_FORMATTER.format(end)}`;
}
