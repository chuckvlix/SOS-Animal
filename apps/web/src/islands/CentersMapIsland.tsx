import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Locate,
  MapPin,
  Navigation,
  Phone,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import {
  ATTENTION_CENTERS,
  calculateHaversineDistanceKm,
  SUCRE_DEFAULT_COORDINATES,
} from "../data/centers";
import type { AttentionCenterItem, CenterSectionType } from "../types/centers";

type FilterTab = "ALL" | CenterSectionType;

interface UserCoordinates {
  latitude: number;
  longitude: number;
}

// Custom Leaflet Icons to prevent broken standard asset images
function createCustomPin(
  color: string,
  symbolType: "vet" | "institution" | "selected",
): L.DivIcon {
  const isSelected = symbolType === "selected";
  const size = isSelected ? 42 : 34;
  const height = isSelected ? 50 : 42;

  let innerSvg = "";
  if (symbolType === "institution") {
    // Shield icon for legal/police
    innerSvg = `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#FFFFFF"/>`;
  } else if (symbolType === "selected") {
    // Star/pulse icon
    innerSvg = `<circle cx="12" cy="12" r="5" fill="#FFFFFF"/>`;
  } else {
    // Cross/vet icon
    innerSvg = `<path d="M12 7v10M7 12h10" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>`;
  }

  return L.divIcon({
    className: "sos-center-pin",
    iconSize: [size, height],
    iconAnchor: [size / 2, height],
    popupAnchor: [0, -height + 6],
    html: `
      <div style="position:relative; width:${size}px; height:${height}px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">
        <svg width="${size}" height="${height}" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 2C8.82 2 3 7.82 3 15c0 9.6 13 23 13 23s13-13.4 13-23c0-7.18-5.82-13-13-13Z" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>
        </svg>
        <div style="position:absolute; top:${isSelected ? 9 : 7}px; left:${isSelected ? 11 : 7}px; width:18px; height:18px; display:flex; align-items:center; justify-content:center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            ${innerSvg}
          </svg>
        </div>
      </div>
    `,
  });
}

function createUserLocationPin(): L.DivIcon {
  return L.divIcon({
    className: "sos-user-location-pin",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `
      <div style="position:relative; width:24px; height:24px;">
        <span style="position:absolute; inset:0; border-radius:9999px; background-color:#3B82F6; opacity:0.6; animation:ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        <span style="position:absolute; inset:3px; border-radius:9999px; background-color:#1D4ED8; border:2.5px solid #FFFFFF; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></span>
      </div>
    `,
  });
}

const vetPinIcon = createCustomPin("#0D9488", "vet"); // Teal
const institutionPinIcon = createCustomPin("#E11D48", "institution"); // Rose/Red
const selectedPinIcon = createCustomPin("#5B21B6", "selected"); // Violet
const userPinIcon = createUserLocationPin();

// Controller to fly the map when a center is selected or user requests center view
interface MapControllerProps {
  selectedCenter: AttentionCenterItem | null;
  userCoords: UserCoordinates | null;
  flyTrigger: number;
}

function MapController({
  selectedCenter,
  userCoords,
  flyTrigger,
}: MapControllerProps) {
  const map = useMap();

  useEffect(() => {
    if (selectedCenter) {
      map.flyTo([selectedCenter.latitude, selectedCenter.longitude], 16, {
        duration: 0.8,
      });
    }
  }, [selectedCenter, flyTrigger, map]);

  useEffect(() => {
    if (userCoords && !selectedCenter) {
      map.flyTo([userCoords.latitude, userCoords.longitude], 15, {
        duration: 0.8,
      });
    }
  }, [userCoords, map, selectedCenter]);

  return null;
}

function MapResizeController() {
  const map = useMap();

  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    });

    observer.observe(map.getContainer());

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [map]);

  return null;
}

export default function CentersMapIsland() {
  const [activeTab, setActiveTab] = useState<FilterTab>("ALL");
  const [only24h, setOnly24h] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCenterId, setSelectedCenterId] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<UserCoordinates | null>(null);
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [flyTrigger, setFlyTrigger] = useState<number>(0);
  const [showMobileMap, setShowMobileMap] = useState<boolean>(false);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabRefs = useRef<Record<FilterTab, HTMLButtonElement | null>>({
    ALL: null,
    CEMZOO_Y_VETERINARIAS: null,
    INSTITUCIONES_DENUNCIA: null,
  });

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs: FilterTab[] = [
      "ALL",
      "CEMZOO_Y_VETERINARIAS",
      "INSTITUCIONES_DENUNCIA",
    ];
    const currentIndex = tabs.indexOf(activeTab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    }
  };

  // Geolocation handler
  const handleRequestGeolocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Tu navegador no soporta geolocalización.");
      return;
    }

    setGeoLoading(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setGeoLoading(false);
      },
      (error) => {
        setGeoLoading(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGeoError(
            "Permiso de ubicación denegado. Puedes seguir explorando el mapa normalmente.",
          );
        } else {
          setGeoError("No se pudo obtener la ubicación actual.");
        }
      },
      { timeout: 10000, enableHighAccuracy: true },
    );
  };

  // Filtered centers
  const filteredCenters = useMemo(() => {
    return ATTENTION_CENTERS.filter((center) => {
      // Tab filter
      if (activeTab !== "ALL" && center.section !== activeTab) {
        return false;
      }
      // 24h filter
      if (only24h && !center.is24Hours) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matches24Hours =
          center.is24Hours &&
          /(?:\b24\s*h\b|\b24\s*horas?\b|\bturnos? de guardia\b)/.test(
            query,
          );
        const matchesName = center.name.toLowerCase().includes(query);
        const matchesAddress = center.address.toLowerCase().includes(query);
        const matchesCategory = center.categoryLabel
          .toLowerCase()
          .includes(query);
        const matchesOpeningHours = center.openingHours
          .toLowerCase()
          .includes(query);
        const matchesServices = center.services.some((s) =>
          s.toLowerCase().includes(query),
        );
        const matchesSpecial = center.specialNote
          ?.toLowerCase()
          .includes(query);

        if (
          !matchesName &&
          !matchesAddress &&
          !matchesCategory &&
          !matchesOpeningHours &&
          !matchesServices &&
          !matchesSpecial &&
          !matches24Hours
        ) {
          return false;
        }
      }
      return true;
    });
  }, [activeTab, only24h, searchQuery]);

  // Centers with distance if user coordinates available
  const centersWithDistance = useMemo(() => {
    if (!userCoords) {
      return filteredCenters.map((c) => ({ ...c, distanceKm: null }));
    }
    return filteredCenters.map((c) => ({
      ...c,
      distanceKm: calculateHaversineDistanceKm(
        userCoords.latitude,
        userCoords.longitude,
        c.latitude,
        c.longitude,
      ),
    }));
  }, [filteredCenters, userCoords]);

  // Split into Section 1 and Section 2 for organized layout
  const veterinaryCenters = useMemo(
    () =>
      centersWithDistance.filter(
        (c) => c.section === "CEMZOO_Y_VETERINARIAS",
      ),
    [centersWithDistance],
  );

  const institutionCenters = useMemo(
    () =>
      centersWithDistance.filter(
        (c) => c.section === "INSTITUCIONES_DENUNCIA",
      ),
    [centersWithDistance],
  );

  const selectedCenter = useMemo(
    () =>
      ATTENTION_CENTERS.find((c) => c.id === selectedCenterId) ?? null,
    [selectedCenterId],
  );

  const handleSelectCenter = (center: AttentionCenterItem, scrollToCard = false) => {
    setSelectedCenterId(center.id);
    setFlyTrigger((prev) => prev + 1);

    if (scrollToCard) {
      const el = cardRefs.current[center.id];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  return (
    <div className="space-y-8">
      {/* Search & Filter Header Toolbar */}
      <section
        aria-label="Filtros de Centros de Atención"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, zona, vacunas, urgencias..."
              aria-label="Buscar centros de atención"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-11 pr-10 text-sm text-slate-800 placeholder-slate-400 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Action Tools: Geolocation & 24h filter */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={handleRequestGeolocation}
              disabled={geoLoading}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                userCoords
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Locate
                className={`h-4 w-4 ${geoLoading ? "animate-spin text-primary" : ""}`}
                aria-hidden="true"
              />
              {geoLoading
                ? "Localizando..."
                : userCoords
                  ? "Distancia calculada"
                  : "Calcular distancia"}
            </button>

            <button
              type="button"
              onClick={() => setOnly24h(!only24h)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
                only24h
                  ? "border-rose-300 bg-rose-50 text-rose-700 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              aria-pressed={only24h}
            >
              <Clock className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
              Solo Urgencias 24h
            </button>

            {/* Mobile Toggle Map Button */}
            <button
              type="button"
              onClick={() => setShowMobileMap(!showMobileMap)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs font-semibold text-slate-700 lg:hidden"
            >
              <MapPin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {showMobileMap ? "Ocultar mapa" : "Ver mapa"}
            </button>
          </div>
        </div>

        {geoError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3.5 py-2 text-xs text-amber-800">
            <Info className="h-4 w-4 shrink-0 text-amber-600" />
            <span>{geoError}</span>
          </div>
        )}

        {/* Section Tabs */}
        <div
          role="tablist"
          aria-label="Secciones de Centros de Atención"
          onKeyDown={handleTabKeyDown}
          className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4"
        >
          <button
            ref={(element) => {
              tabRefs.current.ALL = element;
            }}
            type="button"
            role="tab"
            id="centers-tab-all"
            aria-controls="centers-tabpanel"
            aria-selected={activeTab === "ALL"}
            tabIndex={activeTab === "ALL" ? 0 : -1}
            onClick={() => setActiveTab("ALL")}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition sm:text-sm ${
              activeTab === "ALL"
                ? "bg-primary text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Todos los centros (7)
          </button>

          <button
            ref={(element) => {
              tabRefs.current.CEMZOO_Y_VETERINARIAS = element;
            }}
            type="button"
            role="tab"
            id="centers-tab-veterinary"
            aria-controls="centers-tabpanel"
            aria-selected={activeTab === "CEMZOO_Y_VETERINARIAS"}
            tabIndex={activeTab === "CEMZOO_Y_VETERINARIAS" ? 0 : -1}
            onClick={() => setActiveTab("CEMZOO_Y_VETERINARIAS")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition sm:text-sm ${
              activeTab === "CEMZOO_Y_VETERINARIAS"
                ? "bg-secondary-text text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
            CEMZOO y Atención Veterinaria (5)
          </button>

          <button
            ref={(element) => {
              tabRefs.current.INSTITUCIONES_DENUNCIA = element;
            }}
            type="button"
            role="tab"
            id="centers-tab-institutions"
            aria-controls="centers-tabpanel"
            aria-selected={activeTab === "INSTITUCIONES_DENUNCIA"}
            tabIndex={activeTab === "INSTITUCIONES_DENUNCIA" ? 0 : -1}
            onClick={() => setActiveTab("INSTITUCIONES_DENUNCIA")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition sm:text-sm ${
              activeTab === "INSTITUCIONES_DENUNCIA"
                ? "bg-sos-text text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Instituciones donde Denunciar (2)
          </button>
        </div>
      </section>

      {/* Main Grid: Cards on the Left, Sticky Map on the Right */}
      <div
        id="centers-tabpanel"
        role="tabpanel"
        aria-labelledby={
          activeTab === "ALL"
            ? "centers-tab-all"
            : activeTab === "CEMZOO_Y_VETERINARIAS"
              ? "centers-tab-veterinary"
              : "centers-tab-institutions"
        }
        tabIndex={0}
        className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-12"
      >
        {/* Left Column: Cards List */}
        <div className="min-w-0 space-y-10 lg:col-span-7 xl:col-span-7">
          {centersWithDistance.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <Info className="mx-auto h-10 w-10 text-slate-400" />
              <h3 className="mt-3 text-base font-bold text-slate-800">
                No se encontraron centros
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Prueba ajustando los términos de búsqueda o quitando el filtro de
                urgencias 24h.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setOnly24h(false);
                  setActiveTab("ALL");
                }}
                className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Restablecer filtros
              </button>
            </div>
          ) : (
            <>
              {/* SECTION 1: CEMZOO Y CENTROS DE ATENCIÓN VETERINARIA */}
              {(activeTab === "ALL" || activeTab === "CEMZOO_Y_VETERINARIAS") &&
                veterinaryCenters.length > 0 && (
                  <section
                    aria-labelledby="heading-veterinarias"
                    className="space-y-5"
                  >
                    <div className="border-b border-teal-100 pb-3">
                      <div className="inline-flex items-center gap-2 rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">
                        <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
                        Sección 1
                      </div>
                      <h2
                        id="heading-veterinarias"
                        className="mt-2 text-xl font-extrabold text-slate-900 sm:text-2xl"
                      >
                        CEMZOO y Centros de Atención Veterinaria
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        La salud y el bienestar de nuestros animales también son
                        una responsabilidad. Si tu mascota o un animal
                        rescatado necesita atención médica, esterilización o
                        vacunas, puedes acudir a los siguientes lugares:
                      </p>
                    </div>

                    <div className="space-y-6">
                      {veterinaryCenters.map((center) => (
                        <CenterCard
                          key={center.id}
                          center={center}
                          isSelected={selectedCenterId === center.id}
                          onSelect={() => handleSelectCenter(center, false)}
                          refCallback={(el) => {
                            cardRefs.current[center.id] = el;
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )}

              {/* SECTION 2: INSTITUCIONES EN LAS QUE PUEDES DENUNCIAR */}
              {(activeTab === "ALL" || activeTab === "INSTITUCIONES_DENUNCIA") &&
                institutionCenters.length > 0 && (
                  <section
                    aria-labelledby="heading-instituciones"
                    className="space-y-5"
                  >
                    <div className="border-b border-rose-100 pb-3">
                      <div className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800">
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        Sección 2
                      </div>
                      <h2
                        id="heading-instituciones"
                        className="mt-2 text-xl font-extrabold text-slate-900 sm:text-2xl"
                      >
                        Centros en los que puedes Denunciar
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        ¿Conoces algún caso de maltrato, abandono, crueldad o
                        biocidio animal? No te quedes en silencio. Tu denuncia
                        puede salvar una vida. En Sucre, existen instituciones
                        donde puedes acudir de manera formal:
                      </p>
                    </div>

                    <div className="space-y-6">
                      {institutionCenters.map((center) => (
                        <CenterCard
                          key={center.id}
                          center={center}
                          isSelected={selectedCenterId === center.id}
                          onSelect={() => handleSelectCenter(center, false)}
                          refCallback={(el) => {
                            cardRefs.current[center.id] = el;
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )}
            </>
          )}
        </div>

        {/* Right Column: Interactive Map */}
        <div
          className={`min-w-0 lg:col-span-5 xl:col-span-5 ${
            showMobileMap ? "block" : "hidden lg:block"
          }`}
        >
          <div className="sticky top-24 space-y-3">
            <div className="flex items-center justify-between px-1 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                Mapa georreferenciado de Sucre
              </span>
              <span className="text-[11px] text-slate-400">
                {filteredCenters.length} centros mostrados
              </span>
            </div>

            <div className="h-[480px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm lg:h-[calc(100vh-10rem)]">
              <MapContainer
                center={SUCRE_DEFAULT_COORDINATES}
                zoom={14}
                scrollWheelZoom={true}
                className="h-full w-full"
              >
                <MapResizeController />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapController
                  selectedCenter={selectedCenter}
                  userCoords={userCoords}
                  flyTrigger={flyTrigger}
                />

                {/* User location pin */}
                {userCoords && (
                  <Marker
                    position={[userCoords.latitude, userCoords.longitude]}
                    icon={userPinIcon}
                  >
                    <Popup>
                      <div className="text-xs">
                        <strong className="block font-bold text-blue-700">
                          Tu ubicación actual
                        </strong>
                        <span>Calculando distancia a centros de Sucre</span>
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* Center Pins */}
                {filteredCenters.map((center) => {
                  const isSelected = selectedCenterId === center.id;
                  let icon =
                    center.section === "INSTITUCIONES_DENUNCIA"
                      ? institutionPinIcon
                      : vetPinIcon;
                  if (isSelected) {
                    icon = selectedPinIcon;
                  }

                  return (
                    <Marker
                      key={center.id}
                      position={[center.latitude, center.longitude]}
                      icon={icon}
                      eventHandlers={{
                        click: () => handleSelectCenter(center, true),
                      }}
                    >
                      <Popup>
                        <div className="max-w-[220px] space-y-1.5 p-1 text-xs">
                          <img
                            src={center.photoUrl}
                            alt={center.photoAlt}
                            className="h-20 w-full rounded object-cover"
                            loading="lazy"
                          />
                          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                            {center.badge}
                          </span>
                          <strong className="block font-bold text-slate-900 leading-snug">
                            {center.name}
                          </strong>
                          <p className="text-[11px] text-slate-600 line-clamp-2">
                            {center.address}
                          </p>
                          <div className="flex items-center justify-between pt-1">
                            <button
                              type="button"
                              onClick={() => handleSelectCenter(center, true)}
                              className="text-[11px] font-bold text-primary underline"
                            >
                              Ver detalles
                            </button>
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${center.latitude},${center.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-800 hover:bg-slate-200"
                            >
                              Ruta <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3.5 py-2 text-[11px] text-slate-600 border border-slate-200/60">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                CEMZOO / Clínicas
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-600" />
                Fiscalía / FELCEDA
              </span>
              {userCoords && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                  Tu posición
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface CenterCardProps {
  center: AttentionCenterItem & { distanceKm?: number | null };
  isSelected: boolean;
  onSelect: () => void;
  refCallback: (el: HTMLDivElement | null) => void;
}

function CenterCard({
  center,
  isSelected,
  onSelect,
  refCallback,
}: CenterCardProps) {
  const isInstitution = center.section === "INSTITUCIONES_DENUNCIA";
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${center.latitude},${center.longitude}`;

  return (
    <article
      ref={refCallback}
      onClick={onSelect}
      className={`group relative min-w-0 overflow-hidden rounded-2xl border transition-all duration-200 ${
        isSelected
          ? "border-primary bg-white shadow-md ring-2 ring-primary/20"
          : "border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md"
      }`}
    >
      <div className="grid min-w-0 grid-cols-1 md:grid-cols-12">
        {/* Card Image */}
        <div className="relative min-w-0 bg-slate-100 md:col-span-5 min-h-[200px] md:min-h-full">
          <img
            src={center.photoUrl}
            alt={center.photoAlt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent md:hidden" />

          {/* Badge over image on mobile */}
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
            <span
              className={`rounded-lg px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white shadow-sm ${
                isInstitution ? "bg-rose-600" : "bg-teal-700"
              }`}
            >
              {center.categoryLabel}
            </span>

            {center.is24Hours && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-extrabold text-white shadow-sm">
                <Clock className="h-3 w-3" />
                24H
              </span>
            )}
          </div>
        </div>

        {/* Card Content */}
        <div className="flex min-w-0 flex-col justify-between p-5 md:col-span-7 sm:p-6">
          <div className="space-y-3">
            {/* Badges & Distance */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`rounded-full px-3 py-0.5 text-xs font-bold ${
                  isInstitution
                    ? "bg-rose-50 text-rose-800 border border-rose-200"
                    : "bg-teal-50 text-teal-800 border border-teal-200"
                }`}
              >
                {center.badge}
              </span>

              {center.distanceKm !== undefined && center.distanceKm !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 border border-blue-200">
                  <Navigation className="h-3 w-3" />
                  {center.distanceKm} km
                </span>
              )}
            </div>

            {/* Name */}
            <h3 className="min-w-0 text-lg font-black text-slate-900 leading-snug sm:text-xl">
              {center.name}
            </h3>

            {/* Address */}
            <div className="space-y-1 text-xs text-slate-600">
              <p className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span>
                  <strong>Dirección:</strong> {center.address}
                </span>
              </p>
              {center.reference && (
                <p className="ml-5 text-[11px] text-slate-500">
                  <em>Ref: {center.reference}</em>
                </p>
              )}
            </div>

            {/* Hours */}
            <p className="flex items-start gap-1.5 text-xs text-slate-600">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>
                <strong>Horario:</strong> {center.openingHours}
              </span>
            </p>

            {/* Telephones */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                <Phone className="h-3.5 w-3.5 text-primary" />
                Teléfonos:
              </span>
              {center.phones.map((phone) => (
                <a
                  key={phone}
                  href={`tel:${phone.replace(/[^0-9]/g, "")}`}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-primary transition hover:bg-primary hover:text-white"
                >
                  {phone}
                </a>
              ))}
              {center.email && (
                <span className="min-w-0 truncate text-[11px] text-slate-500">
                  ({center.email})
                </span>
              )}
            </div>

            {/* Services List */}
            <div className="border-t border-slate-100 pt-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {isInstitution ? "Competencias y recepción:" : "Servicios disponibles:"}
              </h4>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-700">
                {center.services.map((service, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <CheckCircle2
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        isInstitution ? "text-rose-600" : "text-teal-600"
                      }`}
                    />
                    <span className="leading-tight">{service}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Special Note Callout */}
            {center.specialNote && (
              <div
                className={`flex items-start gap-2 rounded-xl p-3 text-xs leading-relaxed ${
                  isInstitution
                    ? "bg-rose-50 text-rose-900 border border-rose-200/60"
                    : "bg-teal-50 text-teal-900 border border-teal-200/60"
                }`}
              >
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{center.specialNote}</span>
              </div>
            )}

            {/* Action Guide for Institutions */}
            {center.actionGuide && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
                <div className="flex items-center gap-1.5 font-bold text-amber-900">
                  <Info className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>¿Cómo presentar tu denuncia aquí?</span>
                </div>
                <p className="mt-1 text-amber-900">{center.actionGuide}</p>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onSelect}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <MapPin className="h-3.5 w-3.5 text-primary" />
              {isSelected ? "Centrado en mapa" : "Ver en el mapa"}
            </button>

            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary-hover"
            >
              Cómo llegar
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
