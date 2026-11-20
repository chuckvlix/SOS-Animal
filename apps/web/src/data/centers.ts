import type { AttentionCenterItem } from "../types/centers";

export const ATTENTION_CENTERS: readonly AttentionCenterItem[] = [
  // SECCIÓN 1: CEMZOO Y CENTROS DE ATENCIÓN VETERINARIA
  {
    id: "cemzoo-sucre",
    name: "CEMZOO · Centro Municipal de Zoonosis Sucre",
    section: "CEMZOO_Y_VETERINARIAS",
    categoryLabel: "Zoonosis Municipal",
    badge: "Centro Municipal Oficial",
    address: "Av. Navarra s/n (Zona Exaeropuerto Juana Azurduy de Padilla)",
    reference: "Ingreso principal zona Juana Azurduy, frente a hangares cívicos",
    latitude: -19.016268,
    longitude: -65.292971,
    phones: ["64-32525", "72886022"],
    openingHours: "Lunes a viernes 08:00 – 16:00 (Horario continuo)",
    is24Hours: false,
    services: [
      "Vacunación antirrábica obligatoria y gratuita",
      "Campañas municipales de esterilización a bajo costo",
      "Desparasitación canina y felina",
      "Rescate de animales en vía pública y estado crítico",
      "Observación epidemiológica por sospecha de rabia",
    ],
    photoUrl: "/images/centers/cemzoo.webp",
    photoAlt: "Fachada oficial de las instalaciones del Centro Municipal de Zoonosis Sucre (CEMZOO)",
    specialNote: "Entidad municipal pública del GAM Sucre encargada de zoonosis y salud pública animal.",
  },
  {
    id: "vet-navarro",
    name: "Clínica Veterinaria Navarro",
    section: "CEMZOO_Y_VETERINARIAS",
    categoryLabel: "Clínica Veterinaria",
    badge: "Urgencias 24h previa llamada",
    address: "Av. Jaime Mendoza esq. Pisagua, N.º 711",
    reference: "Frente a Plaza Tréveris",
    latitude: -19.045505,
    longitude: -65.249667,
    phones: ["64-44111", "71155999"],
    openingHours: "Lunes a sábado 08:30 – 20:00 (Urgencias 24h)",
    is24Hours: true,
    services: [
      "Cirugías veterinarias especializadas y traumatología",
      "Diagnóstico por imagen (Ecografía y Rayos X digitales)",
      "Internación clínica supervisada",
      "Laboratorio clínico y hemogramas completos",
      "Farmacia veterinaria surtida",
      "Atención médica de urgencias las 24 horas",
    ],
    photoUrl: "/images/centers/vet-navarro.webp",
    photoAlt: "Instalaciones de la Clínica Veterinaria Navarro frente a Plaza Tréveris en Sucre",
    specialNote: "Disponibilidad de atención médica quirúrgica y urgencias las 24 horas llamando al 71155999.",
  },
  {
    id: "vet-super-can",
    name: "Veterinaria Super Can",
    section: "CEMZOO_Y_VETERINARIAS",
    categoryLabel: "Clínica Veterinaria",
    badge: "Atención de lunes a domingo",
    address: "Calle Mejillones N.º 102",
    reference: "Zona Mercado Campesino",
    latitude: -19.047238,
    longitude: -65.251146,
    phones: ["64-55888", "73422111"],
    email: "jhonfloresrisco211270@gmail.com",
    openingHours: "Lunes a domingo 08:00 – 21:00 (Turnos de guardia)",
    is24Hours: true,
    services: [
      "Medicina preventiva y consulta clínica general",
      "Traumatología y curaciones de emergencia",
      "Plan de vacunación y desparasitación para cachorros y adultos",
      "Ecografía veterinaria básica",
      "Peluquería canina estética y medicada",
      "Alimentos balanceados y accesorios especializados",
    ],
    photoUrl: "/images/centers/vet-super-can.webp",
    photoAlt: "Consultorio y atención al público de Veterinaria Super Can en Calle Mejillones",
    specialNote: "Atención continua todos los días de la semana en zona comercial estratégica.",
  },
  {
    id: "vet-huesos",
    name: "Clínica Veterinaria Huesos",
    section: "CEMZOO_Y_VETERINARIAS",
    categoryLabel: "Clínica Veterinaria",
    badge: "Consultas Gratuitas · Emergencias 24H",
    address: "Av. Jaime Mendoza #2174 casi esq. Germán Busch",
    reference: "A media cuadra de Av. Germán Busch",
    latitude: -19.037774,
    longitude: -65.258853,
    phones: ["64-66222", "75788333"],
    openingHours: "Atención 24 Horas ininterrumpida (365 días al año)",
    is24Hours: true,
    services: [
      "Consultas médicas veterinarias generales totalmente gratuitas",
      "Emergencias clínicas y quirúrgicas 24 horas",
      "Cirugías de urgencia por atropello o agresión",
      "Terapia intensiva veterinaria y monitoreo",
      "Oxigenoterapia y soporte vital",
      "Internación y aislamiento infeccioso",
    ],
    photoUrl: "/images/centers/vet-huesos.webp",
    photoAlt: "Fachada y letrero de la Clínica Veterinaria Huesos en Av. Jaime Mendoza",
    specialNote: "¡Beneficio a la comunidad! Consultas generales gratuitas y atención de emergencias las 24 horas.",
  },
  {
    id: "vet-puper",
    name: "Veterinaria Púper",
    section: "CEMZOO_Y_VETERINARIAS",
    categoryLabel: "Clínica Veterinaria",
    badge: "50% Descuento Animales de Calle",
    address: "Calle Manuel Villar N.º 45",
    reference: "Zona San Matías / Alto Delicias",
    latitude: -19.047419,
    longitude: -65.269946,
    phones: ["64-33444", "76122555"],
    openingHours: "Lunes a sábado 09:00 – 19:30",
    is24Hours: false,
    services: [
      "Tratamiento médico integral para animales menores",
      "Protocolos de vacunación y desparasitación responsable",
      "Cirugías electivas y esterilizaciones programadas",
      "Atención preferencial a animales rescatados de la calle",
      "Compromiso social: 50% de descuento en animales callejeros víctimas de atropello o maltrato",
    ],
    photoUrl: "/images/centers/vet-puper.webp",
    photoAlt: "Instalaciones de la Veterinaria Púper en Calle Manuel Villar",
    specialNote: "Compromiso de bienestar animal: Aplica 50% de descuento en gastos médicos para rescatistas y animales comunitarios.",
  },

  // SECCIÓN 2: CENTROS EN LOS QUE PUEDES DENUNCIAR EL MALTRATO ANIMAL
  {
    id: "fiscalia-chuquisaca",
    name: "Fiscalía Departamental de Chuquisaca",
    section: "INSTITUCIONES_DENUNCIA",
    categoryLabel: "Ministerio Público",
    badge: "Denuncia Penal por Biocidio y Maltrato",
    address: "Calle Km. 7 N.º 282",
    reference: "Frente al Parque Bolívar",
    latitude: -19.042115,
    longitude: -65.263964,
    phones: ["64-51200", "64-51201"],
    openingHours: "Lunes a viernes 08:00 – 12:00 y 14:30 – 18:30 (Plataforma de Atención al Usuario)",
    is24Hours: false,
    services: [
      "Recepción formal de denuncias penales por delito de Biocidio (Art. 350 ter C.P.)",
      "Investigación penal por Tratos Crueles y Maltrato Animal (Art. 350 bis C.P.)",
      "Emisión de requerimientos fiscales para peritajes veterinarios forenses",
      "Asignación de fiscal de materia y fiscalía corporativa",
      "Coordinación interinstitucional de medidas de protección para animales en riesgo",
    ],
    photoUrl: "/images/centers/fiscalia-chuquisaca.webp",
    photoAlt: "Edificio central de la Fiscalía Departamental de Chuquisaca frente al Parque Bolívar",
    specialNote: "Órgano judicial competente para sanciones con pena privativa de libertad (2 a 5 años de cárcel en casos de Biocidio).",
    actionGuide: "Presenta el Documento de Denuncia generado en SOS Animal (con el Anexo Fotográfico impreso), fotocopia de tu Cédula de Identidad y datos de testigos o ubicación del agresor.",
  },
  {
    id: "felceda-pofoma",
    name: "FELCEDA — POFOMA (Policía Boliviana)",
    section: "INSTITUCIONES_DENUNCIA",
    categoryLabel: "Policía Nacional · Unidad Especializada",
    badge: "Auxilio Inmediato y Flagrancia 24H",
    address: "Calle Destacamento 111 esq. Av. Jaime Mendoza",
    reference: "Plaza 2 de Agosto (EPI / Estación Policial)",
    latitude: -19.020489,
    longitude: -65.285609,
    phones: ["110", "911"],
    openingHours: "Atención continua 24 horas (Recepción e intervención en flagrancia)",
    is24Hours: true,
    services: [
      "Intervención policial inmediata ante actos de crueldad y biocidio en flagrancia",
      "Rescate y auxilio de urgencia a animales en peligro inminente de muerte",
      "Aprehensión de agresores en situación de flagrancia conforme a ley",
      "Recepción de denuncias policiales y remisión de actuados al Ministerio Público",
      "Coordinación de decomiso preventivo y traslado con CEMZOO",
    ],
    photoUrl: "/images/centers/felceda-pofoma.webp",
    photoAlt: "Frontis y oficina de atención de FELCEDA - POFOMA en la Estación Policial de Sucre",
    specialNote: "Policía Forestal y Preservación del Medio Ambiente. Acude o llama al 110 si el hecho violento está ocurriendo en este momento.",
    actionGuide: "En casos de flagrancia o agresión activa, llama de inmediato al 110. Si el hecho ya ocurrió, acude a la oficina con tu Documento de Denuncia impreso.",
  },
];

export const SUCRE_DEFAULT_COORDINATES: [number, number] = [-19.0425, -65.2595]; // Centro Histórico de Sucre

/**
 * Calculates distance in kilometers between two geographic points using Haversine formula.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}
