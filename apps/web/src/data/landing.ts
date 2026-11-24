import type {
  AboutMissionContent,
  CommunityHighlight,
  HeroContent,
  LegalNormHighlight,
  ProcessStep,
} from "../types/ui";

export const HERO_CONTENT: HeroContent = {
  badge: "Plataforma pública de protección animal y orientación jurídica",
  titleStart: "Protege y defiende a",
  titleHighlight: "los animales",
  description:
    "¿Presenciaste un caso de maltrato animal o biocidio? Actúa ahora e inicia tu denuncia en pocos pasos.",
  primaryCta: {
    label: "Denunciar Maltrato (SOS)",
    href: "/denunciar",
  },
  secondaryCta: {
    label: "Ver Veterinarias y Zoonosis",
    href: "/mapa",
  },
  image: {
    src: "/images/hero-pets.webp",
    alt: "Perro dorado sonriente junto a un gato atigrado mirando al frente",
    width: 860,
    height: 813,
  }
};

export const ABOUT_MISSION_CONTENT: AboutMissionContent = {
  eyebrow: "Nuestra Misión Ciudadana",
  titleStart: "Porque cada vida merece",
  titleHighlight: "respeto y justicia",
  description:
    "SOS Animal reúne orientación jurídica, educación preventiva en un espacio claro y un directorio georreferenciado de Zoonosis y centros veterinarios accesibles para toda la población.",
  points: [
    "Acceso inmediato a normativa, mapas y educación",
    "Ruta guiada en 4 pasos para generar tu Documento de Denuncia",
    "Red de Zoonosis (CEMZOO) y clínicas veterinarias",
    "Información sobre campañas de vacunación y esterilización",
  ],
  cta: {
    label: "Conocer marco legal",
    href: "/derechos",
  },
  image: {
    src: "/images/about-mission-960.webp",
    srcSet: "/images/about-mission-640.webp 640w, /images/about-mission-960.webp 960w",
    sizes: "(max-width: 1023px) 100vw, 460px",
    alt: "Perro y gato descansando juntos sobre césped verde bajo protección y cuidado responsable",
    width: 960,
    height: 640,
  },
};

export const COMPLAINT_PROCESS_STEPS: readonly ProcessStep[] = [
  {
    stepNumber: "01",
    title: "Tipifica el caso",
    description:
      "Elige entre Maltrato (Art. 350 bis) o Biocidio (Art. 350 ter) y vincula el sustento de la Ley N.º 700/2015.",
    tag: "Paso 1",
    icon: "sos",
    accent: "sos",
  },
  {
    stepNumber: "02",
    title: "Hechos y 1–3 fotos",
    description:
      "Registra lugar, fecha, relato y adjunta entre 1 y 3 fotografías que formarán el Anexo Fotográfico.",
    tag: "Paso 2",
    icon: "shield",
    accent: "secondary",
  },
  {
    stepNumber: "03",
    title: "Tus datos y revisión",
    description:
      "Completa tu identidad legal y revisa la vista previa oficial del Documento de Denuncia.",
    tag: "Paso 3",
    icon: "legal",
    accent: "primary",
  },
  {
    stepNumber: "04",
    title: "Descarga tu PDF",
    description:
      "Emite tu Documento de Denuncia con código correlativo y descárgalo listo para presentar ante autoridades.",
    tag: "Paso 4",
    icon: "cases",
    accent: "primary",
  },
];

export const COMMUNITY_HIGHLIGHTS: readonly CommunityHighlight[] = [
  {
    category: "Centros de Atención",
    title: "Centros de atención veterinaria y dónde denunciar",
    description:
      "Consulta el mapa interactivo con CEMZOO, clínicas veterinarias con urgencias e instituciones públicas receptoras de denuncias en Sucre.",
    href: "/mapa",
    ctaLabel: "Explorar centros de atención",
    accent: "secondary",
    image: {
      src: "/images/community-vet.webp",
      alt: "Médico veterinario examinando a un cachorro sobre una mesa clínica",
      width: 640,
      height: 420,
    },
  },
  {
    category: "Salud y Vacunas",
    title: "Vacunación antirrábica y esterilización",
    description:
      "Revisa fechas, requisitos y puntos de atención de campañas preventivas junto a CEMZOO e instituciones locales.",
    href: "/campanas",
    ctaLabel: "Ver calendario de campañas",
    accent: "secondary",
    image: {
      src: "/images/community-campaigns.webp",
      alt: "Perro pequeño atendido sobre camilla en consultorio veterinario",
      width: 640,
      height: 420,
    },
  },
  {
    category: "Derechos de los Animales",
    title: "Derechos, responsabilidades y normativa vigente",
    description:
      "Conoce los derechos reconocidos por ley, las obligaciones de tenencia responsable y los documentos oficiales disponibles.",
    href: "/derechos",
    ctaLabel: "Conocer derechos y normativa",
    accent: "primary",
    image: {
      src: "/images/community-education.webp",
      alt: "Persona abrazando con afecto a un perro feliz al aire libre",
      width: 640,
      height: 420,
    },
  },
];

export const LEGAL_NORM_HIGHLIGHTS: readonly LegalNormHighlight[] = [
  {
    code: "Ley N.º 700/2015",
    title: "Defensa de los Animales Contra Actos de Crueldad y Maltrato",
    summary:
      "Establece deberes de cuidado, prohibiciones contra la violencia animal y bases de protección en todo el Estado.",
  },
  {
    code: "Código Penal · Arts. 350 bis y 350 ter",
    title: "Tipificación penal de Tratos Crueles y Biocidio",
    summary:
      "Sanciona penalmente agresiones graves, abandono, explotación y la muerte intencional o por crueldad.",
  },
  {
    code: "D.S. N.º 4341/2020 y Ley Municipal N.º 252/2022",
    title: "Reglamento nacional y normativa autónoma de Sucre",
    summary:
      "Define competencias del GAM Sucre y CEMZOO para control sanitario, tenencia responsable y derivación institucional.",
  },
];
