import type { FooterLinkGroup, NavItem } from "../types/ui";

export const BRAND_NAME = "SOS Animal";
export const BRAND_TAGLINE = "Protección LegalTech";
export const JURISDICTION_LABEL = "Sucre, Bolivia";

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: "Inicio",
    desktopLabel: "Inicio",
    mobileLabel: "Inicio",
    href: "/",
    icon: "home",
  },
  {
    label: "Denunciar SOS",
    desktopLabel: "Denunciar SOS",
    mobileLabel: "SOS",
    href: "/denunciar",
    icon: "sos",
    isSos: true,
  },
  {
    label: "Zoonosis y Veterinarias",
    desktopLabel: "Veterinarias",
    mobileLabel: "Mapa",
    href: "/mapa",
    icon: "map",
  },
  {
    label: "Salud y Vacunas",
    desktopLabel: "Salud y Vacunas",
    mobileLabel: "Salud",
    href: "/campanas",
    icon: "health",
  },
  {
    label: "Normativa Legal",
    desktopLabel: "Normativa",
    mobileLabel: "Leyes",
    href: "/normativa",
    icon: "legal",
  },
  {
    label: "Educación y Prevención",
    desktopLabel: "Educación y Prevención",
    mobileLabel: "Educación",
    href: "/educacion",
    icon: "education",
  },
];

export const DESKTOP_NAV_ITEMS: readonly NavItem[] = NAV_ITEMS.filter(
  (item) => !item.isSos,
);

export const SOS_NAV_ITEM: NavItem = {
  label: "Denunciar SOS",
  desktopLabel: "Denunciar SOS",
  mobileLabel: "SOS",
  href: "/denunciar",
  icon: "sos",
  isSos: true,
};

export const AUTH_COMPLAINTS_NAV_ITEM: NavItem = {
  label: "Mis Denuncias",
  desktopLabel: "Mis Denuncias",
  mobileLabel: "Casos",
  href: "/mis-denuncias",
  icon: "cases",
};

// Mobile bottom bar displays the 5 primary destinations with SOS elevated in the center.
const MOBILE_NAV_ORDER: readonly string[] = [
  "/",
  "/mapa",
  "/denunciar",
  "/campanas",
  "/normativa",
];

export const MOBILE_NAV_ITEMS: readonly NavItem[] = MOBILE_NAV_ORDER
  .map((href) => NAV_ITEMS.find((item) => item.href === href))
  .filter((item): item is NavItem => item !== undefined);

export const FOOTER_LINK_GROUPS: readonly FooterLinkGroup[] = [
  {
    title: "Servicios Públicos",
    links: [
      { label: "Inicio", href: "/" },
      { label: "Zoonosis y Veterinarias", href: "/mapa" },
      { label: "Salud y Vacunas", href: "/campanas" },
      { label: "Educación y Prevención", href: "/educacion" },
    ],
  },
  {
    title: "Denuncias y Marco Legal",
    links: [
      { label: "Denunciar Maltrato o Biocidio", href: "/denunciar" },
      { label: "Seguimiento por Código", href: "/seguimiento" },
      { label: "Normativa Legal Vigente", href: "/normativa" },
    ],
  },
];

export const REFERENCE_INSTITUTIONS: readonly string[] = [
  "Centro Municipal de Zoonosis (CEMZOO)",
  "Policía Boliviana — POFOMA",
  "Ministerio Público (Fiscalía)",
];

function normalizePath(path: string): string {
  const pathname = path.trim().split(/[?#]/, 1)[0] ?? "";
  if (!pathname || pathname === "/") {
    return "/";
  }
  return pathname.replace(/\/+$/, "") || "/";
}

export function isActiveRoute(currentPath: string, href: string): boolean {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);
  if (target === "/") {
    return current === "/";
  }
  return current === target || current.startsWith(`${target}/`);
}
