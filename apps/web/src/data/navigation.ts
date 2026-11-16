import type { NavItem } from "../types/ui";

export const BRAND_NAME = "SOS Animal";
export const BRAND_TAGLINE = "Protección LegalTech";
export const JURISDICTION_LABEL = "Sucre, Bolivia";

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: "Inicio",
    mobileLabel: "Inicio",
    href: "/",
    icon: "home",
  },
  {
    label: "Denunciar SOS",
    mobileLabel: "SOS",
    href: "/denunciar",
    icon: "sos",
    isSos: true,
  },
  {
    label: "Zoonosis y Veterinarias",
    mobileLabel: "Mapa",
    href: "/mapa",
    icon: "map",
  },
  {
    label: "Salud y Vacunas",
    mobileLabel: "Salud",
    href: "/campanas",
    icon: "health",
  },
  {
    label: "Normativa Legal",
    mobileLabel: "Leyes",
    href: "/normativa",
    icon: "legal",
  },
  {
    label: "Mis Denuncias",
    mobileLabel: "Casos",
    href: "/seguimiento",
    icon: "cases",
  },
];

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
