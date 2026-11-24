export interface AnimalRight {
  title: string;
}

export interface LegalDownload {
  title: string;
  href: string | null;
  status: "available" | "pending";
}

export const ANIMAL_RIGHTS: readonly AnimalRight[] = [
  { title: "Vivir libre de maltrato, abandono y sufrimiento innecesario." },
  { title: "Recibir alimento, agua limpia, refugio digno y atención veterinaria oportuna." },
  { title: "No ser sometido a trabajos excesivos, carga pesada ni espectáculos violentos." },
  { title: "Contar con la protección y vigilancia del Estado y del Gobierno Municipal." },
] as const;

export const RESPONSIBLE_TUTOR_OBLIGATIONS: readonly string[] = [
  "Registrar a su mascota y mantener sus vacunas al día, en especial la vacuna antirrábica.",
  "Pasearla con correa (y bozal en caso de razas de manejo especial) y recoger siempre sus desechos.",
  "Garantizar su bienestar físico y emocional, evitando que permanezca amarrada o en la calle sin agua ni sombra.",
] as const;

export const EDUCATIONAL_DOWNLOADS: readonly LegalDownload[] = [
  {
    title: "Descargar Fichas Jurídicas en PDF",
    href: "/docs/derechos/fichas-juridicas.pdf",
    status: "available",
  },
  {
    title: "Cartilla para niños en PDF",
    href: "/docs/derechos/cartilla-ninos.pdf",
    status: "available",
  },
] as const;

export const OFFICIAL_NORMS: readonly LegalDownload[] = [
  {
    title: "Ley N.º 700: Ley para la Defensa de los Animales contra Actos de Crueldad y Maltrato",
    href: "/docs/derechos/ley-700.pdf",
    status: "available",
  },
  {
    title: "Decreto Supremo N.º 4341: Reglamento Operativo de la Ley N.º 700 y Coordinación con POFOMA",
    href: null,
    status: "pending",
  },
  {
    title: "Ley Municipal Autonómica N.º 252/2022 (Sucre): Tenencia Responsable y Bienestar Animal",
    href: "/docs/derechos/ley-municipal-252-2022.pdf",
    status: "available",
  },
  {
    title: "Decreto Municipal N.º 073/2022: Reglamento de Trámites Administrativos ante CEMZOO",
    href: null,
    status: "pending",
  },
] as const;
