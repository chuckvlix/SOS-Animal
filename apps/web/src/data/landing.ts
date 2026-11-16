import type { CitizenService, HeroContent } from "../types/ui";

export const HERO_CONTENT: HeroContent = {
  badge: "Plataforma de Orientación Jurídica y Protección Animal",
  title: "Protege y defiende a los animales en Sucre",
  description:
    "Genera un Documento de Denuncia formal con respaldo en el Código Penal y la Ley N.º 700/2015 para presentar ante Fiscalía o POFOMA, o localiza atención veterinaria de urgencia.",
  primaryCta: {
    label: "Denunciar Maltrato o Biocidio (SOS)",
    href: "/denunciar",
  },
  secondaryCta: {
    label: "Consultar Código",
    href: "/seguimiento",
  },
};

export const CITIZEN_SERVICES: readonly CitizenService[] = [
  {
    title: "Zoonosis y Veterinarias",
    description:
      "Ubica al CEMZOO y clínicas veterinarias cercanas en Sucre con horarios de emergencia 24h y distancia estimada.",
    href: "/mapa",
    badge: "Directorio Geoespacial",
    accent: "secondary",
    icon: "map",
  },
  {
    title: "Salud, Vacunas y Educación",
    description:
      "Consulta calendarios de vacunación antirrábica, esterilización y guías de tenencia responsable.",
    href: "/campanas",
    badge: "Prevención y Bienestar",
    accent: "secondary",
    icon: "health",
  },
  {
    title: "Normativa Legal Vigente",
    description:
      "Accede al resumen ciudadano y PDF oficial de la Ley N.º 700/2015, Código Penal y Ley Municipal N.º 252/2022.",
    href: "/normativa",
    badge: "Marco Jurídico",
    accent: "primary",
    icon: "legal",
  },
  {
    title: "Seguimiento de Denuncia",
    description:
      "Verifica el estado de tu trámite usando tu código correlativo (ej. SOS-000458-2026) o descarga tu Documento de Denuncia.",
    href: "/seguimiento",
    badge: "Trazabilidad",
    accent: "primary",
    icon: "cases",
  },
];
