import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, MapPin, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

export interface CoordinatesPair {
  latitude: number | null;
  longitude: number | null;
}

interface IncidentLocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onChange: (coords: CoordinatesPair) => void;
  disabled?: boolean;
}

const SUCRE_CENTER: [number, number] = [-19.0333, -65.2627];
const DEFAULT_ZOOM = 14;

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

function createPinIcon(): L.DivIcon {
  return L.divIcon({
    className: "sos-leaflet-pin",
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    html: `<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 2C8.82 2 3 7.82 3 15c0 9.6 13 23 13 23s13-13.4 13-23c0-7.18-5.82-13-13-13Z" fill="#E11D48" stroke="#FFFFFF" stroke-width="2.5"/>
      <circle cx="16" cy="15" r="5" fill="#FFFFFF"/>
    </svg>`,
  });
}

interface MapInteractionProps {
  latitude: number | null;
  longitude: number | null;
  disabled: boolean;
  onSelect: (lat: number, lng: number) => void;
}

function MapClickAndCenterController({
  latitude,
  longitude,
  disabled,
  onSelect,
}: MapInteractionProps) {
  const map = useMap();

  useMapEvents({
    click(event) {
      if (disabled) {
        return;
      }
      onSelect(roundCoord(event.latlng.lat), roundCoord(event.latlng.lng));
    },
  });

  useEffect(() => {
    if (
      latitude !== null &&
      longitude !== null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      map.flyTo([latitude, longitude], Math.max(map.getZoom(), 15), {
        duration: 0.4,
      });
    }
  }, [latitude, longitude, map]);

  return null;
}

function MapResizeController() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default function IncidentLocationPicker({
  latitude,
  longitude,
  onChange,
  disabled = false,
}: IncidentLocationPickerProps) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const pinIcon = useMemo(() => createPinIcon(), []);

  const hasCoords = latitude !== null && longitude !== null;
  const center: [number, number] = hasCoords ? [latitude, longitude] : SUCRE_CENTER;

  const handleSelectCoords = (lat: number, lng: number) => {
    setGeoError(null);
    onChange({ latitude: lat, longitude: lng });
  };

  const handleUseCurrentLocation = () => {
    if (disabled) {
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoError("Tu navegador no admite geolocalización automática. Marca el punto en el mapa.");
      return;
    }

    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChange({
          latitude: roundCoord(position.coords.latitude),
          longitude: roundCoord(position.coords.longitude),
        });
      },
      (error) => {
        setLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGeoError(
            "Permiso de ubicación denegado. Puedes marcar el lugar haciendo clic directamente en el mapa.",
          );
          return;
        }
        if (error.code === error.TIMEOUT) {
          setGeoError("Tiempo de espera agotado al obtener GPS. Inténtalo de nuevo o haz clic en el mapa.");
          return;
        }
        setGeoError("No pudimos obtener tu ubicación GPS. Marca el punto directamente en el mapa.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  };

  const handleClearCoords = () => {
    if (disabled) {
      return;
    }
    setGeoError(null);
    onChange({ latitude: null, longitude: null });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-bg-canvas p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-text-primary">
            <MapPin aria-hidden="true" className="h-4 w-4 text-primary" />
            <span>Ubicación aproximada en mapa (opcional)</span>
          </p>
          <p className="mt-0.5 mb-0 text-xs text-text-secondary">
            Haz clic o toca el mapa de Sucre para fijar el punto exacto o arrastrar el marcador.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || locating}
            onClick={handleUseCurrentLocation}
            className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Crosshair aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{locating ? "Ubicando..." : "Usar mi ubicación actual"}</span>
          </button>

          {hasCoords && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleClearCoords}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-slate-100 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Quitar coordenadas del mapa</span>
            </button>
          )}
        </div>
      </div>

      <div className="isolate relative z-0 overflow-hidden rounded-xl border border-border bg-bg-surface">
        <MapContainer
          center={center}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={false}
          className="h-64 w-full sm:h-72"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickAndCenterController
            latitude={latitude}
            longitude={longitude}
            disabled={disabled}
            onSelect={handleSelectCoords}
          />
          <MapResizeController />
          {hasCoords && (
            <Marker
              position={[latitude, longitude]}
              icon={pinIcon}
              draggable={!disabled}
              eventHandlers={{
                dragend: (event) => {
                  const marker = event.target as L.Marker;
                  const nextLatLng = marker.getLatLng();
                  handleSelectCoords(roundCoord(nextLatLng.lat), roundCoord(nextLatLng.lng));
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {hasCoords ? (
          <p className="m-0 font-medium text-text-primary">
            Coordenadas seleccionadas:{" "}
            <span className="tabular-nums rounded bg-secondary-soft px-2 py-0.5 font-semibold text-secondary-text">
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </span>
          </p>
        ) : (
          <p className="m-0 text-text-secondary">
            Sin coordenadas GPS marcadas (se enviará solo la dirección escrita).
          </p>
        )}
      </div>

      {geoError && (
        <p role="status" className="m-0 text-xs font-medium text-sos-text">
          {geoError}
        </p>
      )}
    </div>
  );
}
