import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertCircle,
  Building2,
  Clock,
  Compass,
  Crosshair,
  ExternalLink,
  HeartPulse,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { fetchAttentionCenters } from "../services/directory";
import type { AttentionCenterRead, CenterCategory } from "../types";

const SUCRE_CENTER: [number, number] = [-19.0333, -65.2627];
const DEFAULT_ZOOM = 14;

// Default demo seed centers in Sucre in case the local database is fresh/empty
const FALLBACK_CENTERS: AttentionCenterRead[] = [
  {
    id: 1,
    name: "Centro Municipal de Zoonosis Sucre (CEMZOO)",
    category: "ZOONOSIS",
    address: "Zona Mesa Verde, frente al Regimiento Chichas",
    latitude: -19.0192,
    longitude: -65.2755,
    phone: "4-6451000",
    opening_hours: "Lun - Vie 08:00 a 16:00",
    is_24_hours: false,
    services:
      "Vacunación antirrábica obligatoria gratuita, esterilización quirúrgica a bajo costo, observación antirrábica y rescate de animales en vía pública.",
    is_active: true,
  },
  {
    id: 2,
    name: "Hospital Veterinario Universitario USFX",
    category: "VETERINARIA",
    address: "Facultad de Ciencias Agrarias, Zona Garcilazo",
    latitude: -19.0498,
    longitude: -65.2452,
    phone: "4-6442033",
    opening_hours: "Lun - Dom 24 horas",
    is_24_hours: true,
    services:
      "Atención médica integral, urgencias 24h, traumatología, cirugía general, ecografía, rayos X y hospitalización.",
    is_active: true,
  },
  {
    id: 3,
    name: "Clínica Veterinaria San Roque - Urgencias 24h",
    category: "VETERINARIA",
    address: "Av. Jaime Mendoza #842, frente a Parque Bolívar",
    latitude: -19.0435,
    longitude: -65.2578,
    phone: "71158920",
    opening_hours: "Abierto 24 horas continuas",
    is_24_hours: true,
    services:
      "Terapia intensiva veterinaria, emergencias nocturnas, cirugías de urgencia, farmacia veterinaria 24h.",
    is_active: true,
  },
  {
    id: 4,
    name: "Veterinaria y Pet Shop Huellitas Sucre",
    category: "VETERINARIA",
    address: "Calle Calvo #350, Zona Central",
    latitude: -19.0465,
    longitude: -65.2592,
    phone: "72890123",
    opening_hours: "Lun - Sáb 08:30 a 19:30",
    is_24_hours: false,
    services:
      "Consultas clínicas, vacunación, desparasitación, ecografía básica, farmacia y alimentos balanceados.",
    is_active: true,
  },
  {
    id: 5,
    name: "Centro Veterinario del Sur",
    category: "VETERINARIA",
    address: "Av. Marcelo Quiroga Santa Cruz #120",
    latitude: -19.0285,
    longitude: -65.2635,
    phone: "4-6435678",
    opening_hours: "Lun - Sáb 08:00 a 20:00",
    is_24_hours: false,
    services:
      "Esterilizaciones programadas, curaciones, análisis de sangre, desparasitación y medicina preventiva.",
    is_active: true,
  },
];

function createCenterIcon(
  category: CenterCategory,
  is24Hours: boolean,
  isSelected: boolean,
): L.DivIcon {
  const isZoonosis = category === "ZOONOSIS";
  const bgFill = isZoonosis ? "#5B21B6" : is24Hours ? "#E11D48" : "#0D9488";
  const strokeColor = isSelected ? "#FBBF24" : "#FFFFFF";
  const strokeWidth = isSelected ? "3.5" : "2";
  const scale = isSelected ? "scale(1.15)" : "scale(1)";

  const badgeHtml = isZoonosis
    ? `<span style="position: absolute; top: -6px; right: -6px; background: #5B21B6; color: white; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 9999px; border: 1.5px solid white;">ZOO</span>`
    : is24Hours
      ? `<span style="position: absolute; top: -6px; right: -8px; background: #E11D48; color: white; font-size: 8px; font-weight: 800; padding: 1px 3px; border-radius: 9999px; border: 1.5px solid white; animation: pulse 2s infinite;">24h</span>`
      : "";

  const svgInner = isZoonosis
    ? `<path d="M16 6 L26 10 L26 18 C26 23.5 21.7 28.5 16 30 C10.3 28.5 6 23.5 6 18 L6 10 Z" fill="none" stroke="white" stroke-width="2"/>`
    : `<path d="M13 14 L19 14 M16 11 L16 17" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`;

  return L.divIcon({
    className: "sos-center-pin",
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    popupAnchor: [0, -42],
    html: `
      <div style="position: relative; width: 36px; height: 46px; transform: ${scale}; transition: transform 0.2s ease;">
        <svg width="36" height="46" viewBox="0 0 36 46" fill="none" xmlns="http://www.w3.org/2000/svg">
          <filter id="shadow" x="0" y="0" width="36" height="46" filterUnits="userSpaceOnUse">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.3"/>
          </filter>
          <path d="M18 2 C9.16 2 2 9.16 2 18 C2 29.5 18 44 18 44 C18 44 34 29.5 34 18 C34 9.16 26.84 2 18 2 Z"
                fill="${bgFill}"
                stroke="${strokeColor}"
                stroke-width="${strokeWidth}"
                filter="url(#shadow)"/>
          <circle cx="18" cy="18" r="10" fill="rgba(255,255,255,0.2)"/>
          ${svgInner}
        </svg>
        ${badgeHtml}
      </div>
    `,
  });
}

function createUserIcon(): L.DivIcon {
  return L.divIcon({
    className: "sos-user-pin",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `
      <div style="position: relative; width: 28px; height: 28px;">
        <span style="position: absolute; inset: -4px; border-radius: 9999px; background: rgba(37,99,235,0.3); animation: ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></span>
        <div style="width: 28px; height: 28px; border-radius: 9999px; background: #2563EB; border: 3px solid #FFFFFF; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
          <div style="width: 8px; height: 8px; border-radius: 9999px; background: #FFFFFF;"></div>
        </div>
      </div>
    `,
  });
}

interface MapFlyToHandlerProps {
  targetCoords: [number, number] | null;
  zoom?: number;
}

function MapFlyToHandler({ targetCoords, zoom = 16 }: MapFlyToHandlerProps) {
  const map = useMap();

  useEffect(() => {
    if (targetCoords) {
      map.flyTo(targetCoords, zoom, {
        duration: 0.6,
      });
    }
  }, [targetCoords, zoom, map]);

  return null;
}

export default function VetMapIsland() {
  const [centers, setCenters] = useState<AttentionCenterRead[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CenterCategory | "ALL">("ALL");
  const [only24Hours, setOnly24Hours] = useState(false);

  // User geolocation state
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Selected center state
  const [selectedCenterId, setSelectedCenterId] = useState<number | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);

  const loadCenters = useCallback(async (lat?: number, lng?: number) => {
    setLoading(true);
    try {
      const data = await fetchAttentionCenters({
        user_lat: lat,
        user_lng: lng,
        is_active: true,
      });
      if (data && data.length > 0) {
        setCenters(data);
      } else {
        // Fallback to local catalog if database table is not seeded yet
        setCenters(FALLBACK_CENTERS);
      }
    } catch {
      // In case of local network issue, gracefully show preconfigured catalog
      setCenters(FALLBACK_CENTERS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCenters();
  }, [loadCenters]);

  const handleLocateUser = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("Tu navegador no soporta geolocalización.");
      return;
    }

    setLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserCoords([lat, lng]);
        setLocating(false);
        setFlyTarget([lat, lng]);
        loadCenters(lat, lng);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError("Permiso de ubicación denegado. Puedes buscar en el mapa directamente.");
        } else {
          setGeoError("No se pudo obtener tu ubicación precisa.");
        }
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const filteredCenters = useMemo(() => {
    return centers.filter((center) => {
      if (categoryFilter !== "ALL" && center.category !== categoryFilter) {
        return false;
      }
      if (only24Hours && !center.is_24_hours) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inName = center.name.toLowerCase().includes(q);
        const inAddr = center.address.toLowerCase().includes(q);
        const inServ = center.services.toLowerCase().includes(q);
        if (!inName && !inAddr && !inServ) {
          return false;
        }
      }
      return true;
    });
  }, [centers, categoryFilter, only24Hours, searchQuery]);

  const handleSelectCenter = (center: AttentionCenterRead) => {
    setSelectedCenterId(center.id);
    setFlyTarget([center.latitude, center.longitude]);
  };

  const userIcon = useMemo(() => createUserIcon(), []);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner / Hero description */}
      <div className="rounded-3xl border border-border bg-bg-surface p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                <Building2 aria-hidden="true" className="h-3.5 w-3.5" />
                Municipio de Sucre
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sos-soft px-3 py-1 text-xs font-semibold text-sos-text">
                <HeartPulse aria-hidden="true" className="h-3.5 w-3.5" />
                Urgencias y Salud Animal
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
              Directorio Geolocalizado de Zoonosis y Veterinarias
            </h1>
            <p className="max-w-3xl text-sm text-text-secondary sm:text-base">
              Ubica el Centro Municipal de Zoonosis (CEMZOO) para campañas gratuitas y centros veterinarios privados con servicio de urgencias 24 horas. Calcula tu distancia y obtén la ruta directa de llegada.
            </p>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleLocateUser}
              disabled={locating}
              className="inline-flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover active:scale-[0.98] sm:w-auto"
            >
              {locating ? (
                <>
                  <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />
                  <span>Obteniendo ubicación...</span>
                </>
              ) : (
                <>
                  <Crosshair aria-hidden="true" className="h-4 w-4" />
                  <span>Calcular desde mi ubicación</span>
                </>
              )}
            </button>
          </div>
        </div>

        {geoError && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-sos-soft p-3 text-xs text-sos-text">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{geoError}</span>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre, barrio, calle o servicio..."
            className="w-full rounded-xl border border-border bg-bg-canvas py-2 pr-4 pl-10 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-border bg-bg-canvas p-1">
            <button
              type="button"
              onClick={() => setCategoryFilter("ALL")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                categoryFilter === "ALL"
                  ? "bg-bg-surface text-primary shadow-xs"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Todos ({centers.length})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter("ZOONOSIS")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                categoryFilter === "ZOONOSIS"
                  ? "bg-primary text-white shadow-xs"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <ShieldCheck aria-hidden="true" className="h-3 w-3" />
              Zoonosis Municipal
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter("VETERINARIA")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                categoryFilter === "VETERINARIA"
                  ? "bg-secondary text-white shadow-xs"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <Stethoscope aria-hidden="true" className="h-3 w-3" />
              Veterinarias
            </button>
          </div>

          {/* Toggle 24h */}
          <button
            type="button"
            onClick={() => setOnly24Hours(!only24Hours)}
            className={`inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition ${
              only24Hours
                ? "border-sos bg-sos text-white shadow-xs"
                : "border-border bg-bg-canvas text-text-secondary hover:border-sos/30 hover:text-sos-text"
            }`}
          >
            <HeartPulse aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Abierto 24 Horas / Urgencias</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Centers List (Left) + Leaflet Map (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Centers Cards List */}
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-5 xl:col-span-4">
          <div className="flex items-center justify-between text-xs font-medium text-text-secondary">
            <span>
              Mostrando {filteredCenters.length} centro{filteredCenters.length === 1 ? "" : "s"}
            </span>
            {userCoords && (
              <span className="flex items-center gap-1 font-semibold text-primary">
                <Compass aria-hidden="true" className="h-3.5 w-3.5" />
                Ordenado por cercanía
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-bg-surface p-12 text-center text-text-secondary">
              <RefreshCw aria-hidden="true" className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm">Cargando directorio de centros...</p>
            </div>
          ) : filteredCenters.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-bg-surface p-8 text-center text-text-secondary">
              <Building2 aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
              <p className="mt-2 text-sm font-semibold text-text-primary">
                No se encontraron centros
              </p>
              <p className="mt-1 text-xs">
                Prueba ajustando el texto de búsqueda o desactivando los filtros de categoría.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setCategoryFilter("ALL");
                  setOnly24Hours(false);
                }}
                className="mt-4 inline-flex items-center gap-1 rounded-xl border border-border bg-bg-canvas px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft"
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="max-h-[680px] space-y-3 overflow-y-auto pr-1">
              {filteredCenters.map((center) => {
                const isSelected = selectedCenterId === center.id;
                const isZoonosis = center.category === "ZOONOSIS";

                return (
                  <article
                    key={center.id}
                    onClick={() => handleSelectCenter(center)}
                    className={`cursor-pointer rounded-2xl border p-4.5 transition-all ${
                      isSelected
                        ? "border-primary bg-primary-soft/30 shadow-md ring-2 ring-primary/30"
                        : "border-border bg-bg-surface hover:border-primary/40 hover:shadow-xs"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isZoonosis ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold text-primary">
                              <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                              Zoonosis Municipal
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-0.5 text-[11px] font-semibold text-secondary-text">
                              <Stethoscope aria-hidden="true" className="h-3 w-3" />
                              Veterinaria
                            </span>
                          )}

                          {center.is_24_hours && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sos-soft px-2.5 py-0.5 text-[11px] font-bold text-sos-text">
                              <HeartPulse aria-hidden="true" className="h-3 w-3" />
                              Abierto 24h
                            </span>
                          )}

                          {typeof center.distance_km === "number" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                              <Navigation aria-hidden="true" className="h-2.5 w-2.5" />
                              a {center.distance_km} km
                            </span>
                          )}
                        </div>

                        <h3 className="mt-2 text-base font-bold text-text-primary">
                          {center.name}
                        </h3>

                        <div className="mt-2 space-y-1 text-xs text-text-secondary">
                          <p className="flex items-start gap-1.5">
                            <MapPin aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                            <span>{center.address}</span>
                          </p>

                          <p className="flex items-center gap-1.5">
                            <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                            <span>{center.opening_hours}</span>
                          </p>

                          {center.phone && (
                            <p className="flex items-center gap-1.5 font-semibold text-text-primary">
                              <Phone aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
                              <a
                                href={`tel:${center.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-primary hover:underline"
                              >
                                {center.phone}
                              </a>
                            </p>
                          )}
                        </div>

                        <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                          {center.services}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3.5 flex items-center justify-between border-t border-border pt-3">
                      <span className="text-[11px] font-semibold text-primary">
                        {isSelected ? "Seleccionado en el mapa" : "Ver en el mapa"}
                      </span>

                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${center.latitude},${center.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-secondary-text hover:text-secondary hover:underline"
                      >
                        <span>Cómo llegar</span>
                        <ExternalLink aria-hidden="true" className="h-3 w-3" />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Leaflet Interactive Map View */}
        <div className="order-1 lg:order-2 lg:col-span-7 xl:col-span-8">
          <div className="sticky top-6 overflow-hidden rounded-3xl border border-border bg-bg-surface shadow-md">
            <div className="relative h-[480px] w-full sm:h-[620px]">
              <MapContainer
                center={SUCRE_CENTER}
                zoom={DEFAULT_ZOOM}
                scrollWheelZoom={false}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapFlyToHandler targetCoords={flyTarget} />

                {/* User position marker */}
                {userCoords && (
                  <Marker position={userCoords} icon={userIcon}>
                    <Popup>
                      <div className="p-1 text-xs font-semibold text-blue-700">
                        📍 Tu ubicación actual aproximada
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* Attention Center Markers */}
                {filteredCenters.map((center) => {
                  const isSelected = selectedCenterId === center.id;
                  const icon = createCenterIcon(
                    center.category,
                    center.is_24_hours,
                    isSelected,
                  );

                  return (
                    <Marker
                      key={center.id}
                      position={[center.latitude, center.longitude]}
                      icon={icon}
                      eventHandlers={{
                        click: () => handleSelectCenter(center),
                      }}
                    >
                      <Popup>
                        <div className="min-w-[220px] max-w-[280px] p-1 text-xs">
                          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                            {center.category === "ZOONOSIS" ? (
                              <span>Zoonosis Municipal</span>
                            ) : (
                              <span>Clínica Veterinaria</span>
                            )}
                            {center.is_24_hours && (
                              <span className="rounded bg-rose-100 px-1 text-rose-700">
                                24 Horas
                              </span>
                            )}
                          </div>

                          <h4 className="mt-1 text-sm font-bold text-gray-900">
                            {center.name}
                          </h4>

                          <p className="mt-1 text-gray-600">
                            📍 {center.address}
                          </p>

                          <p className="mt-0.5 text-gray-600">
                            🕒 {center.opening_hours}
                          </p>

                          {center.phone && (
                            <p className="mt-0.5 font-semibold text-purple-800">
                              📞 {center.phone}
                            </p>
                          )}

                          {typeof center.distance_km === "number" && (
                            <p className="mt-1 font-bold text-blue-600">
                              🧭 Distancia: {center.distance_km} km
                            </p>
                          )}

                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${center.latitude},${center.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded bg-purple-700 px-2 py-1 text-[11px] font-semibold text-white no-underline hover:bg-purple-800"
                          >
                            <span>Iniciar ruta en Google Maps</span>
                            <ExternalLink aria-hidden="true" className="h-3 w-3" />
                          </a>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>

              {/* Map Floating Legend */}
              <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] hidden rounded-2xl border border-border/80 bg-bg-surface/95 p-3 text-[11px] shadow-lg backdrop-blur-md sm:block">
                <p className="mb-1.5 font-bold text-text-primary">Simbología del Mapa</p>
                <div className="space-y-1 text-text-secondary">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-primary"></span>
                    <span>CEMZOO (Zoonosis Municipal)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-sos"></span>
                    <span>Urgencias 24 Horas</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-secondary"></span>
                    <span>Clínicas Veterinarias</span>
                  </div>
                  {userCoords && (
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-blue-600"></span>
                      <span>Tu ubicación</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
