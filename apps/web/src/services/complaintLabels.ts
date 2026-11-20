import type { ComplaintStatus, OffenseMainType, UserRole } from "../types";

export interface BadgeMeta {
  readonly label: string;
  readonly badgeClass: string;
}

export const COMPLAINT_STATUS_META: Record<ComplaintStatus, BadgeMeta & { readonly description: string }> = {
  BORRADOR: {
    label: "Borrador editable",
    badgeClass: "border-border bg-bg-canvas text-text-secondary",
    description: "Puedes editar los hechos, las fotografías y tus datos antes de emitir el Documento de Denuncia.",
  },
  ENVIADA: {
    label: "Documento emitido",
    badgeClass: "border-primary/25 bg-primary-soft text-primary",
    description: "Documento de Denuncia emitido e inmutable con Anexo Fotográfico, listo para descargar e imprimir en PDF.",
  },
};

export const OFFENSE_MAIN_TYPE_META: Record<
  OffenseMainType,
  BadgeMeta & { readonly article: string; readonly summary: string }
> = {
  MALTRATO: {
    label: "Maltrato animal",
    article: "Código Penal Art. 350 bis (Tratos crueles)",
    badgeClass: "border-primary/25 bg-primary-soft text-primary",
    summary: "Agresiones físicas, negligencia, abandono, explotación, confinamiento o falta de atención médica.",
  },
  BIOCIDIO: {
    label: "Biocidio",
    article: "Código Penal Art. 350 ter (Biocidio)",
    badgeClass: "border-sos/25 bg-sos-soft text-sos-text",
    summary: "Muerte intencional o derivada de crueldad, ensañamiento o motivos fútiles contra uno o más animales.",
  },
};

export const USER_ROLE_META: Record<UserRole, BadgeMeta> = {
  ciudadano: {
    label: "Ciudadano",
    badgeClass: "border-border bg-bg-canvas text-text-secondary",
  },
  admin: {
    label: "Administrador",
    badgeClass: "border-primary/25 bg-primary-soft text-primary",
  },
};

export function formatDateTimeDisplay(isoString: string | null | undefined): string {
  if (!isoString) {
    return "Pendiente";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat("es-BO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDateOnlyDisplay(isoString: string | null | undefined): string {
  if (!isoString) {
    return "Pendiente";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat("es-BO", {
    dateStyle: "medium",
  }).format(date);
}

export function toLocalDateTimeInputValue(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function getCurrentLocalDateTimeInputValue(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function formatLocalDateTimeInputDisplay(localInput: string | null | undefined): string {
  if (!localInput || !localInput.trim()) {
    return "Pendiente";
  }
  const parsed = new Date(localInput);
  if (Number.isNaN(parsed.getTime())) {
    return "Fecha pendiente";
  }
  return formatDateTimeDisplay(parsed.toISOString());
}

export function openPresignedPdfDownload(downloadUrl: string): void {
  const opened = window.open(downloadUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}
