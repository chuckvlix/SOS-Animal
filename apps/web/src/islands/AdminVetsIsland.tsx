import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertCircle,
  Building2,
  Check,
  Clock,
  Crosshair,
  Edit2,
  HeartPulse,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  createAttentionCenter,
  deleteAttentionCenter,
  fetchAttentionCenters,
  updateAttentionCenter,
} from "../services/directory";
import type {
  AttentionCenterCreateRequest,
  AttentionCenterRead,
  AttentionCenterUpdateRequest,
  CenterCategory,
} from "../types";

const SUCRE_CENTER: [number, number] = [-19.0333, -65.2627];

function createModalPinIcon(): L.DivIcon {
  return L.divIcon({
    className: "sos-admin-picker-pin",
    iconSize: [32, 42],
    iconAnchor: [16, 40],
    html: `
      <svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 2 C8.27 2 2 8.27 2 16 C2 26.5 16 40 16 40 C16 40 30 26.5 30 16 C30 8.27 23.73 2 16 2 Z"
              fill="#5B21B6" stroke="#FFFFFF" stroke-width="2.5"/>
        <circle cx="16" cy="16" r="5" fill="#FFFFFF"/>
      </svg>
    `,
  });
}

interface MapClickProps {
  onPick: (lat: number, lng: number) => void;
  coords: [number, number] | null;
}

function MapClickController({ onPick, coords }: MapClickProps) {
  const map = useMap();

  useMapEvents({
    click(event) {
      onPick(Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6)));
    },
  });

  useEffect(() => {
    if (coords) {
      map.flyTo(coords, Math.max(map.getZoom(), 15), { duration: 0.3 });
    }
  }, [coords, map]);

  return null;
}

interface CenterFormData {
  name: string;
  category: CenterCategory;
  address: string;
  latitude: number | "";
  longitude: number | "";
  phone: string;
  opening_hours: string;
  is_24_hours: boolean;
  services: string;
  is_active: boolean;
}

const INITIAL_FORM: CenterFormData = {
  name: "",
  category: "VETERINARIA",
  address: "",
  latitude: SUCRE_CENTER[0],
  longitude: SUCRE_CENTER[1],
  phone: "",
  opening_hours: "Lun - Vie 08:30 a 18:30",
  is_24_hours: false,
  services: "",
  is_active: true,
};

export default function AdminVetsIsland() {
  const [centers, setCenters] = useState<AttentionCenterRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CenterCategory | "ALL">("ALL");

  // Modal form states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCenter, setEditingCenter] = useState<AttentionCenterRead | null>(null);
  const [formData, setFormData] = useState<CenterFormData>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete dialog state
  const [deletingCenter, setDeletingCenter] = useState<AttentionCenterRead | null>(null);
  const [deleting, setDeleting] = useState(false);

  const modalId = useId();
  const deleteModalId = useId();

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pass is_active undefined to fetch all centers (active & inactive) for admin
      const data = await fetchAttentionCenters({});
      setCenters(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al cargar el directorio de centros de atención.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleOpenCreateModal = () => {
    setEditingCenter(null);
    setFormData(INITIAL_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (center: AttentionCenterRead) => {
    setEditingCenter(center);
    setFormData({
      name: center.name,
      category: center.category,
      address: center.address,
      latitude: center.latitude,
      longitude: center.longitude,
      phone: center.phone || "",
      opening_hours: center.opening_hours,
      is_24_hours: center.is_24_hours,
      services: center.services,
      is_active: center.is_active,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingCenter(null);
  };

  const handlePickCoords = (lat: number, lng: number) => {
    setFormData((prev) => ({
      ...prev,
      latitude: lat,
      longitude: lng,
    }));
  };

  const handleUseCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      setFormError("Geolocalización no compatible con tu navegador.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData((prev) => ({
          ...prev,
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        }));
      },
      () => {
        setFormError("No se pudo obtener la ubicación actual.");
      },
      { timeout: 8000 },
    );
  };

  const handleSubmitForm = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError("El nombre del centro es obligatorio.");
      return;
    }
    if (!formData.address.trim()) {
      setFormError("La dirección física es obligatoria.");
      return;
    }
    if (typeof formData.latitude !== "number" || typeof formData.longitude !== "number") {
      setFormError("Debes seleccionar una coordenada válida en el mapa.");
      return;
    }
    if (!formData.opening_hours.trim()) {
      setFormError("El horario de atención es obligatorio.");
      return;
    }
    if (!formData.services.trim()) {
      setFormError("La descripción de servicios es obligatoria.");
      return;
    }

    setSaving(true);
    try {
      if (editingCenter) {
        const updatePayload: AttentionCenterUpdateRequest = {
          name: formData.name.trim(),
          category: formData.category,
          address: formData.address.trim(),
          latitude: formData.latitude,
          longitude: formData.longitude,
          phone: formData.phone.trim() || null,
          opening_hours: formData.opening_hours.trim(),
          is_24_hours: formData.is_24_hours,
          services: formData.services.trim(),
          is_active: formData.is_active,
        };
        await updateAttentionCenter(editingCenter.id, updatePayload);
        showToast("Centro de atención actualizado exitosamente.");
      } else {
        const createPayload: AttentionCenterCreateRequest = {
          name: formData.name.trim(),
          category: formData.category,
          address: formData.address.trim(),
          latitude: formData.latitude,
          longitude: formData.longitude,
          phone: formData.phone.trim() || null,
          opening_hours: formData.opening_hours.trim(),
          is_24_hours: formData.is_24_hours,
          services: formData.services.trim(),
          is_active: formData.is_active,
        };
        await createAttentionCenter(createPayload);
        showToast("Nuevo centro de atención registrado exitosamente.");
      }
      setModalOpen(false);
      await loadDirectory();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Error al guardar el centro en la base de datos.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingCenter) return;
    setDeleting(true);
    try {
      await deleteAttentionCenter(deletingCenter.id);
      showToast("Centro eliminado correctamente del directorio.");
      setDeletingCenter(null);
      await loadDirectory();
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : "No se pudo eliminar el centro de atención.",
      );
    } finally {
      setDeleting(false);
    }
  };

  const filteredCenters = useMemo(() => {
    return centers.filter((center) => {
      if (categoryFilter !== "ALL" && center.category !== categoryFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inName = center.name.toLowerCase().includes(q);
        const inAddr = center.address.toLowerCase().includes(q);
        const inPhone = center.phone ? center.phone.toLowerCase().includes(q) : false;
        if (!inName && !inAddr && !inPhone) return false;
      }
      return true;
    });
  }, [centers, categoryFilter, searchQuery]);

  const modalPinIcon = useMemo(() => createModalPinIcon(), []);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-2xl bg-text-primary px-4 py-3 text-sm font-semibold text-white shadow-xl animate-in fade-in slide-in-from-bottom-3">
          <Check aria-hidden="true" className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-0.5 text-xs font-semibold text-primary">
              <Building2 aria-hidden="true" className="h-3.5 w-3.5" />
              Gestión Universitaria
            </span>
            <span className="text-xs text-text-muted">Directorio Zoonosis & Veterinarias</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Directorio Veterinario y Zoonosis
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Administra el catálogo de centros de atención, horarios, urgencias 24h y coordenadas georreferenciadas.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreateModal}
          className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          <span>Nuevo Centro</span>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre, dirección o teléfono..."
            className="w-full rounded-xl border border-border bg-bg-canvas py-2 pr-4 pl-10 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

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
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              categoryFilter === "ZOONOSIS"
                ? "bg-primary text-white shadow-xs"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            CEMZOO
          </button>
          <button
            type="button"
            onClick={() => setCategoryFilter("VETERINARIA")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              categoryFilter === "VETERINARIA"
                ? "bg-secondary text-white shadow-xs"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Veterinarias
          </button>
        </div>
      </div>

      {/* Table view */}
      <div className="overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-xs">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-text-secondary">
            <RefreshCw aria-hidden="true" className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 text-sm">Cargando centros...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sos-text">
            <AlertCircle aria-hidden="true" className="mx-auto h-8 w-8" />
            <p className="mt-2 text-sm font-semibold">{error}</p>
            <button
              type="button"
              onClick={loadDirectory}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border bg-bg-canvas px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Reintentar
            </button>
          </div>
        ) : filteredCenters.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">
            <Building2 aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
            <p className="mt-2 text-sm font-semibold text-text-primary">
              No hay centros registrados que coincidan
            </p>
            <p className="mt-1 text-xs">Puedes crear un nuevo centro con el botón superior.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-bg-canvas text-xs font-bold uppercase tracking-wider text-text-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3.5 sm:px-6">Centro</th>
                  <th scope="col" className="px-4 py-3.5">Categoría</th>
                  <th scope="col" className="px-4 py-3.5">Horario & Urgencias</th>
                  <th scope="col" className="px-4 py-3.5">Contacto</th>
                  <th scope="col" className="px-4 py-3.5">Ubicación</th>
                  <th scope="col" className="px-4 py-3.5">Estado</th>
                  <th scope="col" className="px-4 py-3.5 text-right sm:px-6">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCenters.map((center) => (
                  <tr key={center.id} className="transition-colors hover:bg-bg-canvas/50">
                    <td className="px-4 py-4 sm:px-6">
                      <div className="font-bold text-text-primary">{center.name}</div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-text-secondary">
                        {center.address}
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      {center.category === "ZOONOSIS" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-bold text-primary">
                          <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                          CEMZOO
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-0.5 text-xs font-semibold text-secondary-text">
                          <Stethoscope aria-hidden="true" className="h-3 w-3" />
                          Veterinaria
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1 text-xs text-text-primary">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
                        <span>{center.opening_hours}</span>
                      </div>
                      {center.is_24_hours && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-sos-soft px-2 py-0.5 text-[11px] font-bold text-sos-text">
                          <HeartPulse aria-hidden="true" className="h-3 w-3" />
                          24 Horas
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-4 text-xs">
                      {center.phone ? (
                        <a
                          href={`tel:${center.phone}`}
                          className="flex items-center gap-1 text-primary hover:underline"
                        >
                          <Phone aria-hidden="true" className="h-3.5 w-3.5" />
                          <span>{center.phone}</span>
                        </a>
                      ) : (
                        <span className="text-text-muted">Sin teléfono</span>
                      )}
                    </td>

                    <td className="px-4 py-4 text-xs font-mono text-text-secondary">
                      <div>Lat: {center.latitude.toFixed(4)}</div>
                      <div>Lng: {center.longitude.toFixed(4)}</div>
                    </td>

                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          center.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {center.is_active ? "Activo" : "Inactivo"}
                      </span>
                    </td>

                    <td className="px-4 py-4 text-right sm:px-6">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(center)}
                          title="Editar centro"
                          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-surface text-text-secondary hover:border-primary hover:text-primary"
                        >
                          <Edit2 aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeletingCenter(center)}
                          title="Eliminar centro"
                          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-surface text-text-secondary hover:border-sos hover:text-sos-text"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Modal Dialog */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalId}
            className="w-full max-w-2xl rounded-3xl border border-border bg-bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 sm:p-8"
          >
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h2 id={modalId} className="font-display text-xl font-bold text-text-primary">
                  {editingCenter ? "Editar Centro de Atención" : "Registrar Nuevo Centro"}
                </h2>
                <p className="text-xs text-text-secondary">
                  Ingresa los datos y marca las coordenadas en el mapa interactivo.
                </p>
              </div>

              <button
                type="button"
                onClick={handleCloseModal}
                disabled={saving}
                className="rounded-xl p-1.5 text-text-muted hover:bg-bg-canvas hover:text-text-primary"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-sos-soft p-3 text-xs text-sos-text">
                <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitForm} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-text-primary">
                    Nombre comercial u oficial *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ej: Clínica Veterinaria San Roque"
                    className="mt-1 w-full rounded-xl border border-border bg-bg-canvas px-3.5 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-text-primary">
                    Categoría *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        category: e.target.value as CenterCategory,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-bg-canvas px-3.5 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  >
                    <option value="VETERINARIA">Veterinaria Privada / Universitaria</option>
                    <option value="ZOONOSIS">Zoonosis Municipal (CEMZOO)</option>
                  </select>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-bold text-text-primary">
                    Teléfono / Celular de contacto
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="Ej: 4-6451234 o 71122334"
                    className="mt-1 w-full rounded-xl border border-border bg-bg-canvas px-3.5 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Address */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-text-primary">
                    Dirección física *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Ej: Av. Jaime Mendoza #842, frente al Parque Bolívar"
                    className="mt-1 w-full rounded-xl border border-border bg-bg-canvas px-3.5 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Opening Hours */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-text-primary">
                    Horario de atención *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.opening_hours}
                    onChange={(e) =>
                      setFormData({ ...formData, opening_hours: e.target.value })
                    }
                    placeholder="Ej: Lun - Vie 08:30 a 19:30 o 24 Horas"
                    className="mt-1 w-full rounded-xl border border-border bg-bg-canvas px-3.5 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              {/* Map Coordinates Picker */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-bold text-text-primary">
                      Coordenadas en Sucre (Haz clic en el mapa para marcar el punto) *
                    </label>
                    <span className="text-[11px] text-text-secondary">
                      Lat: {typeof formData.latitude === "number" ? formData.latitude.toFixed(6) : "--"} | Lng: {typeof formData.longitude === "number" ? formData.longitude.toFixed(6) : "--"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleUseCurrentLocation}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-canvas px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                  >
                    <Crosshair aria-hidden="true" className="h-3 w-3" />
                    <span>Mi ubicación</span>
                  </button>
                </div>

                <div className="h-48 w-full overflow-hidden rounded-xl border border-border sm:h-56">
                  <MapContainer
                    center={
                      typeof formData.latitude === "number" && typeof formData.longitude === "number"
                        ? [formData.latitude, formData.longitude]
                        : SUCRE_CENTER
                    }
                    zoom={15}
                    scrollWheelZoom={false}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapClickController
                      onPick={handlePickCoords}
                      coords={
                        typeof formData.latitude === "number" && typeof formData.longitude === "number"
                          ? [formData.latitude, formData.longitude]
                          : null
                      }
                    />
                    {typeof formData.latitude === "number" && typeof formData.longitude === "number" && (
                      <Marker
                        position={[formData.latitude, formData.longitude]}
                        icon={modalPinIcon}
                      />
                    )}
                  </MapContainer>
                </div>
              </div>

              {/* Services */}
              <div>
                <label className="block text-xs font-bold text-text-primary">
                  Servicios ofrecidos *
                </label>
                <textarea
                  rows={2}
                  required
                  value={formData.services}
                  onChange={(e) => setFormData({ ...formData, services: e.target.value })}
                  placeholder="Ej: Consultas veterinarias, vacunación antirrábica, cirugía menor, ecografía y esterilizaciones."
                  className="mt-1 w-full rounded-xl border border-border bg-bg-canvas px-3.5 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                />
              </div>

              {/* Toggles */}
              <div className="flex flex-wrap items-center gap-6 border-t border-border pt-3">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_24_hours}
                    onChange={(e) =>
                      setFormData({ ...formData, is_24_hours: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-xs font-semibold text-text-primary">
                    Atención de Urgencias 24 Horas
                  </span>
                </label>

                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) =>
                      setFormData({ ...formData, is_active: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-xs font-semibold text-text-primary">
                    Centro Activo y Visible en el Mapa Ciudadano
                  </span>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={saving}
                  className="rounded-xl border border-border bg-bg-canvas px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-surface"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover active:scale-[0.98]"
                >
                  {saving && <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />}
                  <span>{editingCenter ? "Guardar Cambios" : "Crear Centro"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingCenter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={deleteModalId}
            className="w-full max-w-md rounded-3xl border border-border bg-bg-surface p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3 text-sos">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sos-soft">
                <Trash2 aria-hidden="true" className="h-5 w-5" />
              </div>
              <h2 id={deleteModalId} className="font-display text-lg font-bold text-text-primary">
                ¿Eliminar centro de atención?
              </h2>
            </div>

            <p className="mt-3 text-sm text-text-secondary">
              Estás a punto de eliminar permanentemente a{" "}
              <strong className="text-text-primary">{deletingCenter.name}</strong> del directorio
              georreferenciado. Esta acción no se puede deshacer.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingCenter(null)}
                disabled={deleting}
                className="rounded-xl border border-border bg-bg-canvas px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-surface"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-xl bg-sos px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sos-hover"
              >
                {deleting && <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />}
                <span>Eliminar Definitivamente</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
