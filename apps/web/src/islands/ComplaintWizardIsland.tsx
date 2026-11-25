import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Info,
  Lock,
  MapPin,
  Save,
  Scale,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../services/api";
import {
  clearStoredAccessToken,
  fetchCurrentUser,
  isUserAuthenticated,
  updateMyProfile,
} from "../services/auth";
import {
  COMPLAINT_STATUS_META,
  OFFENSE_MAIN_TYPE_META,
  formatLocalDateTimeInputDisplay,
  getCurrentLocalDateTimeInputValue,
  openPresignedPdfDownload,
  toLocalDateTimeInputValue,
} from "../services/complaintLabels";
import {
  attachComplaintEvidence,
  createDraftComplaint,
  fetchComplaintById,
  fetchComplaintPdfDownloadUrl,
  fetchComplaintPreview,
  fetchOffenseCategories,
  removeComplaintEvidence,
  submitComplaint,
  updateDraftComplaint,
} from "../services/complaints";
import {
  MAX_PHOTOS_PER_COMPLAINT,
  MIN_PHOTOS_PER_COMPLAINT,
  formatFileSize,
  inferEvidenceType,
  requestPresignedUpload,
  uploadFileToPresignedUrl,
  validateEvidenceFile,
} from "../services/storage";
import type {
  ComplaintEvidenceRead,
  ComplaintPreviewResponse,
  ComplaintRead,
  OffenseCategoryRead,
  OffenseMainType,
  UserRead,
} from "../types";
import IncidentLocationPicker from "./IncidentLocationPicker";

interface UploadItemState {
  localId: string;
  fileName: string;
  fileSizeBytes: number;
  progress: number;
  status: "uploading" | "error";
  errorMessage?: string;
}

type FactFieldKey = "incidentDateLocal" | "incidentAddress" | "description";
type ProfileFieldKey = "fullName" | "ciNumber" | "phone" | "domicileAddress";
type WizardFieldKey = FactFieldKey | ProfileFieldKey;
type WizardFieldErrors = Partial<Record<WizardFieldKey, string>>;

const STEP_LABELS = [
  "1. Tipificación",
  "2. Hechos y Fotos",
  "3. Tus Datos y Revisión",
  "4. Descarga de PDF",
] as const;

const CI_REGEX = /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/;
const PHONE_REGEX = /^\+?[0-9]+(?:[ -][0-9]+)*$/;

const RECEIVER_INSTITUTIONS = [
  "Ministerio Público (Fiscalía de Materia)",
  "Policía Boliviana — POFOMA",
  "Centro Municipal de Zoonosis de Sucre (CEMZOO)",
  "Gobierno Autónomo Municipal de Sucre (GAM Sucre)",
] as const;

function countDigits(value: string): number {
  let count = 0;
  for (const ch of value) {
    if (ch >= "0" && ch <= "9") {
      count += 1;
    }
  }
  return count;
}

function redirectToLoginWithNext(): void {
  const nextPath = window.location.pathname + window.location.search;
  window.location.replace(`/login?next=${encodeURIComponent(nextPath)}`);
}

function validateFieldValue(field: WizardFieldKey, rawValue: string): string | undefined {
  switch (field) {
    case "incidentDateLocal": {
      if (!rawValue) {
        return "Indica la fecha y hora aproximada en que ocurrió el hecho.";
      }
      const parsedDate = new Date(rawValue);
      if (Number.isNaN(parsedDate.getTime())) {
        return "La fecha y hora del hecho no es válida.";
      }
      if (parsedDate.getTime() > Date.now()) {
        return "La fecha y hora del hecho no puede estar en el futuro.";
      }
      return undefined;
    }
    case "incidentAddress": {
      const cleanIncidentAddress = rawValue.trim();
      const meaningfulAddress = cleanIncidentAddress.replace(/\s+/g, " ");
      if (
        meaningfulAddress.length < 5 ||
        cleanIncidentAddress.length > 255 ||
        cleanIncidentAddress.includes("<") ||
        cleanIncidentAddress.includes(">")
      ) {
        return "Describe el lugar del hecho (entre 5 y 255 caracteres sin '<' ni '>').";
      }
      return undefined;
    }
    case "description": {
      const cleanDescription = rawValue.trim();
      const meaningfulDescription = cleanDescription.replace(/\s+/g, " ");
      if (
        meaningfulDescription.length < 10 ||
        cleanDescription.length > 5000 ||
        cleanDescription.includes("<") ||
        cleanDescription.includes(">")
      ) {
        return "El relato de los hechos debe tener al menos 10 caracteres útiles (máximo 5000) y sin '<' ni '>'.";
      }
      return undefined;
    }
    case "fullName": {
      const cleanName = rawValue.trim();
      if (
        cleanName.length < 2 ||
        cleanName.length > 150 ||
        cleanName.includes("<") ||
        cleanName.includes(">")
      ) {
        return "El nombre completo debe tener entre 2 y 150 caracteres y no incluir '<' ni '>'.";
      }
      return undefined;
    }
    case "ciNumber": {
      const cleanCi = rawValue.trim();
      if (
        cleanCi.length < 4 ||
        cleanCi.length > 30 ||
        !CI_REGEX.test(cleanCi) ||
        countDigits(cleanCi) < 4
      ) {
        return "Ingresa un C.I. válido (mínimo 4 dígitos, ejemplo: 7482910 CH).";
      }
      return undefined;
    }
    case "phone": {
      const cleanPhone = rawValue.trim();
      if (
        cleanPhone.length < 6 ||
        cleanPhone.length > 30 ||
        !PHONE_REGEX.test(cleanPhone) ||
        countDigits(cleanPhone) < 6
      ) {
        return "Ingresa un teléfono válido (mínimo 6 dígitos, ejemplo: +591 71234567).";
      }
      return undefined;
    }
    case "domicileAddress": {
      const cleanDomicile = rawValue.trim();
      if (
        cleanDomicile.length < 5 ||
        cleanDomicile.length > 255 ||
        cleanDomicile.includes("<") ||
        cleanDomicile.includes(">")
      ) {
        return "Ingresa tu domicilio real completo (entre 5 y 255 caracteres).";
      }
      return undefined;
    }
  }
}

export default function ComplaintWizardIsland() {
  const [initializing, setInitializing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<UserRead | null>(null);
  const [categories, setCategories] = useState<OffenseCategoryRead[]>([]);

  const [step, setStep] = useState(1);
  const [selectedMainType, setSelectedMainType] = useState<OffenseMainType | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const [incidentDateLocal, setIncidentDateLocal] = useState(getCurrentLocalDateTimeInputValue);
  const [incidentAddress, setIncidentAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [description, setDescription] = useState("");

  const [fullName, setFullName] = useState("");
  const [ciNumber, setCiNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [domicileAddress, setDomicileAddress] = useState("");

  const [draftComplaint, setDraftComplaint] = useState<ComplaintRead | null>(null);
  const [alreadySubmittedView, setAlreadySubmittedView] = useState<ComplaintRead | null>(null);
  const [evidences, setEvidences] = useState<ComplaintEvidenceRead[]>([]);
  const [localThumbnails, setLocalThumbnails] = useState<Record<string, string>>({});
  const [uploadQueue, setUploadQueue] = useState<UploadItemState[]>([]);
  const [removingEvidenceId, setRemovingEvidenceId] = useState<string | null>(null);

  const [stepError, setStepError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<WizardFieldErrors>({});
  const [stepStatusMessage, setStepStatusMessage] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<ComplaintPreviewResponse | null>(null);
  const [submittingFinal, setSubmittingFinal] = useState(false);
  const [submittedComplaint, setSubmittedComplaint] = useState<ComplaintRead | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepErrorRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const cancelConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const hasMovedStepRef = useRef(false);
  const draftSavePromiseRef = useRef<Promise<ComplaintRead | null> | null>(null);
  const createdObjectUrlsRef = useRef<Set<string>>(new Set());

  const incidentDateInputRef = useRef<HTMLInputElement>(null);
  const incidentAddressInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const fullNameInputRef = useRef<HTMLInputElement>(null);
  const ciInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const domicileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const objectUrls = createdObjectUrlsRef.current;
    return () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
    };
  }, []);

  useEffect(() => {
    if (!isUserAuthenticated()) {
      redirectToLoginWithNext();
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const draftParam = params.get("draft")?.trim() || null;

    let cancelled = false;
    (async () => {
      try {
        const [user, catalog] = await Promise.all([
          fetchCurrentUser(),
          fetchOffenseCategories(),
        ]);
        if (cancelled) {
          return;
        }

        setCurrentUser(user);
        setCategories(catalog);
        setFullName(user.full_name ?? "");
        setCiNumber(user.ci_number ?? "");
        setPhone(user.phone ?? "");
        setDomicileAddress(user.address ?? "");

        if (draftParam) {
          try {
            const loaded = await fetchComplaintById(draftParam);
            if (cancelled) {
              return;
            }
            if (loaded.is_immutable || loaded.status !== "BORRADOR") {
              setAlreadySubmittedView(loaded);
              setInitializing(false);
              return;
            }
            setDraftComplaint(loaded);
            setEvidences(loaded.evidences ?? []);
            const matchedCat = catalog.find((item) => item.id === loaded.offense_category_id);
            if (matchedCat) {
              setSelectedMainType(matchedCat.main_type);
              setSelectedCategoryId(matchedCat.id);
            } else if (loaded.offense_category) {
              setSelectedMainType(loaded.offense_category.main_type);
              setSelectedCategoryId(loaded.offense_category.id);
            }
            setIncidentDateLocal(toLocalDateTimeInputValue(loaded.incident_date));
            setIncidentAddress(loaded.incident_address);
            setLatitude(loaded.latitude);
            setLongitude(loaded.longitude);
            setMapExpanded(loaded.latitude !== null && loaded.longitude !== null);
            setDescription(loaded.description);
            setStep(loaded.evidences.length >= MIN_PHOTOS_PER_COMPLAINT ? 3 : 2);
            setDraftWarning("Borrador recuperado. Revisa los datos antes de emitir el Documento de Denuncia.");
          } catch (draftErr) {
            if (cancelled) {
              return;
            }
            if (draftErr instanceof ApiError && draftErr.status === 401) {
              clearStoredAccessToken();
              redirectToLoginWithNext();
              return;
            }
            setDraftWarning(
              "No pudimos cargar el borrador solicitado. Puedes iniciar una nueva denuncia desde el Paso 1.",
            );
          }
        }

        setInitializing(false);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          clearStoredAccessToken();
          redirectToLoginWithNext();
          return;
        }
        setLoadError(
          err instanceof Error && err.message
            ? err.message
            : "No pudimos cargar el asistente de denuncias.",
        );
        setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasMovedStepRef.current) {
      hasMovedStepRef.current = true;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  const loadHtmlPreview = useCallback(async (complaintId: string): Promise<void> => {
    setLoadingPreview(true);
    setStepError(null);
    try {
      const preview = await fetchComplaintPreview(complaintId);
      setPreviewData(preview);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLoginWithNext();
        return;
      }
      setStepError(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos generar la vista previa del Documento de Denuncia.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    if (step === 3 && draftComplaint && !previewData && !loadingPreview) {
      void loadHtmlPreview(draftComplaint.id);
    }
  }, [step, draftComplaint, previewData, loadingPreview, loadHtmlPreview]);

  const filteredCategories = useMemo(() => {
    if (!selectedMainType) {
      return [];
    }
    return categories.filter((item) => item.main_type === selectedMainType);
  }, [categories, selectedMainType]);

  const selectedCategory = useMemo(() => {
    if (selectedCategoryId === null) {
      return null;
    }
    return categories.find((item) => item.id === selectedCategoryId) ?? null;
  }, [categories, selectedCategoryId]);

  const isProfileComplete = useMemo(() => {
    return (
      !validateFieldValue("fullName", fullName) &&
      !validateFieldValue("ciNumber", ciNumber) &&
      !validateFieldValue("phone", phone) &&
      !validateFieldValue("domicileAddress", domicileAddress)
    );
  }, [fullName, ciNumber, phone, domicileAddress]);

  const clearFieldError = (field: WizardFieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const focusWizardField = (field: WizardFieldKey) => {
    const refMap: Record<WizardFieldKey, HTMLElement | null> = {
      incidentDateLocal: incidentDateInputRef.current,
      incidentAddress: incidentAddressInputRef.current,
      description: descriptionInputRef.current,
      fullName: fullNameInputRef.current,
      ciNumber: ciInputRef.current,
      phone: phoneInputRef.current,
      domicileAddress: domicileInputRef.current,
    };
    const target = refMap[field];
    target?.focus();
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const focusStepError = () => {
    window.requestAnimationFrame(() => {
      stepErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      stepErrorRef.current?.focus({ preventScroll: true });
    });
  };

  const goToStep = (nextStep: number) => {
    setStepError(null);
    setFieldErrors({});
    setStepStatusMessage(null);
    setStep(nextStep);
  };

  const validateFactInputs = (): {
    message: string | null;
    firstInvalidField: FactFieldKey | null;
  } => {
    const fieldsToCheck: [FactFieldKey, string][] = [
      ["incidentDateLocal", incidentDateLocal],
      ["incidentAddress", incidentAddress],
      ["description", description],
    ];

    const errors: WizardFieldErrors = {};
    let firstInvalidField: FactFieldKey | null = null;
    let firstMessage: string | null = null;

    for (const [key, value] of fieldsToCheck) {
      const error = validateFieldValue(key, value);
      if (error) {
        errors[key] = error;
        if (!firstInvalidField) {
          firstInvalidField = key;
          firstMessage = error;
        }
      }
    }

    setFieldErrors((prev) => ({
      ...prev,
      incidentDateLocal: errors.incidentDateLocal,
      incidentAddress: errors.incidentAddress,
      description: errors.description,
    }));

    if (firstMessage) {
      return { message: firstMessage, firstInvalidField };
    }

    if (!selectedCategoryId) {
      return {
        message: "Selecciona una tipificación y modalidad válida en el Paso 1 antes de guardar.",
        firstInvalidField: null,
      };
    }

    if ((latitude === null) !== (longitude === null)) {
      return {
        message: "Las coordenadas GPS deben completarse o limpiarse en conjunto.",
        firstInvalidField: null,
      };
    }

    return { message: null, firstInvalidField: null };
  };

  const validateProfileInputs = (): {
    message: string | null;
    firstInvalidField: ProfileFieldKey | null;
  } => {
    const fieldsToCheck: [ProfileFieldKey, string][] = [
      ["fullName", fullName],
      ["ciNumber", ciNumber],
      ["phone", phone],
      ["domicileAddress", domicileAddress],
    ];

    const errors: WizardFieldErrors = {};
    let firstInvalidField: ProfileFieldKey | null = null;
    let firstMessage: string | null = null;

    for (const [key, value] of fieldsToCheck) {
      const error = validateFieldValue(key, value);
      if (error) {
        errors[key] = error;
        if (!firstInvalidField) {
          firstInvalidField = key;
          firstMessage = error;
        }
      }
    }

    setFieldErrors((prev) => ({
      ...prev,
      fullName: errors.fullName,
      ciNumber: errors.ciNumber,
      phone: errors.phone,
      domicileAddress: errors.domicileAddress,
    }));

    return { message: firstMessage, firstInvalidField };
  };

  const persistDraftFacts = async (): Promise<ComplaintRead | null> => {
    if (draftSavePromiseRef.current) {
      return draftSavePromiseRef.current;
    }

    const { message: validationMsg, firstInvalidField } = validateFactInputs();
    if (validationMsg) {
      setStepError(validationMsg);
      if (firstInvalidField) {
        focusWizardField(firstInvalidField);
      } else {
        focusStepError();
      }
      return null;
    }
    if (!selectedCategoryId) {
      return null;
    }

    const task = (async (): Promise<ComplaintRead | null> => {
      setSavingDraft(true);
      setStepError(null);
      setStepStatusMessage(null);

      try {
        const isoIncidentDate = new Date(incidentDateLocal).toISOString();
        const payload = {
          offense_category_id: selectedCategoryId,
          incident_date: isoIncidentDate,
          incident_address: incidentAddress.trim(),
          latitude,
          longitude,
          description: description.trim(),
        };

        const saved = draftComplaint
          ? await updateDraftComplaint(draftComplaint.id, payload)
          : await createDraftComplaint(payload);

        setDraftComplaint(saved);
        setEvidences(saved.evidences ?? evidences);
        setPreviewData(null);

        const nextUrl = `/denunciar?draft=${encodeURIComponent(saved.id)}`;
        if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
          window.history.replaceState(null, "", nextUrl);
        }

        return saved;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredAccessToken();
          redirectToLoginWithNext();
          return null;
        }
        setStepError(
          err instanceof Error && err.message
            ? err.message
            : "No se pudo guardar el borrador de la denuncia.",
        );
        focusStepError();
        return null;
      } finally {
        setSavingDraft(false);
        draftSavePromiseRef.current = null;
      }
    })();

    draftSavePromiseRef.current = task;
    return task;
  };

  const persistProfileUpdate = async (): Promise<UserRead | null> => {
    const { message: validationMsg, firstInvalidField } = validateProfileInputs();
    if (validationMsg) {
      setStepError(validationMsg);
      if (firstInvalidField) {
        focusWizardField(firstInvalidField);
      } else {
        focusStepError();
      }
      return null;
    }

    const nextFullName = fullName.trim();
    const nextCi = ciNumber.trim();
    const nextPhone = phone.trim();
    const nextDomicile = domicileAddress.trim();

    const needsUpdate =
      !currentUser ||
      currentUser.full_name !== nextFullName ||
      currentUser.ci_number !== nextCi ||
      currentUser.phone !== nextPhone ||
      currentUser.address !== nextDomicile;

    if (!needsUpdate && currentUser) {
      return currentUser;
    }

    setSavingProfile(true);
    setStepError(null);
    try {
      const updatedUser = await updateMyProfile({
        full_name: nextFullName,
        ci_number: nextCi,
        phone: nextPhone,
        address: nextDomicile,
      });
      setCurrentUser(updatedUser);
      setPreviewData(null);
      return updatedUser;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLoginWithNext();
        return null;
      }
      setStepError(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos actualizar tus datos personales.",
      );
      focusStepError();
      return null;
    } finally {
      setSavingProfile(false);
    }
  };

  const handleContinueFromStep1 = () => {
    if (!selectedMainType || !selectedCategoryId) {
      setStepError("Selecciona si se trata de Maltrato o Biocidio y elige la modalidad específica.");
      focusStepError();
      return;
    }
    goToStep(2);
  };

  const handleSaveDraftClick = async () => {
    const saved = await persistDraftFacts();
    if (saved) {
      setStepStatusMessage(
        "Borrador guardado. Puedes adjuntar fotografías, editarlo luego desde Mis Denuncias o continuar al Paso 3.",
      );
    }
  };

  const handlePhotoSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setStepError(null);
    setStepStatusMessage(null);

    const remainingSlots = MAX_PHOTOS_PER_COMPLAINT - evidences.length;
    if (remainingSlots <= 0) {
      setStepError(
        `Ya adjuntaste el máximo de ${MAX_PHOTOS_PER_COMPLAINT} fotografías para el Anexo Fotográfico.`,
      );
      focusStepError();
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      setStepError(
        `Solo puedes adjuntar ${remainingSlots} fotografía(s) más (máximo ${MAX_PHOTOS_PER_COMPLAINT} en total). Se procesarán las primeras ${remainingSlots}.`,
      );
    }

    let activeDraft = draftComplaint;
    if (!activeDraft) {
      activeDraft = await persistDraftFacts();
      if (!activeDraft) {
        setStepError((prev) =>
          prev
            ? `Antes de adjuntar fotografías: ${prev}`
            : "Completa la fecha, dirección y relato del hecho antes de subir fotografías.",
        );
        return;
      }
    }

    for (const file of filesToProcess) {
      const localId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let validated: ReturnType<typeof validateEvidenceFile>;
      try {
        validated = validateEvidenceFile(file);
      } catch (err) {
        setUploadQueue((prev) => [
          ...prev,
          {
            localId,
            fileName: file.name,
            fileSizeBytes: file.size,
            progress: 0,
            status: "error",
            errorMessage: err instanceof Error ? err.message : "Fotografía no válida.",
          },
        ]);
        continue;
      }

      setUploadQueue((prev) => [
        ...prev,
        {
          localId,
          fileName: file.name,
          fileSizeBytes: validated.sizeBytes,
          progress: 5,
          status: "uploading",
        },
      ]);

      try {
        const presigned = await requestPresignedUpload({
          mime_type: validated.mimeType,
          file_size_bytes: validated.sizeBytes,
        });

        await uploadFileToPresignedUrl(presigned.upload_url, file, validated.mimeType, (percent) => {
          setUploadQueue((prev) =>
            prev.map((item) =>
              item.localId === localId ? { ...item, progress: Math.max(5, percent) } : item,
            ),
          );
        });

        const attached = await attachComplaintEvidence(activeDraft.id, {
          evidence_type: inferEvidenceType(),
          object_key: presigned.object_key,
          mime_type: validated.mimeType,
          file_size_bytes: validated.sizeBytes,
        });

        const previewObjectUrl = URL.createObjectURL(file);
        createdObjectUrlsRef.current.add(previewObjectUrl);
        setLocalThumbnails((prev) => ({ ...prev, [attached.id]: previewObjectUrl }));
        setEvidences((prev) => [...prev, attached]);
        setPreviewData(null);
        setUploadQueue((prev) => prev.filter((item) => item.localId !== localId));
        setStepStatusMessage(`Fotografía "${file.name}" agregada al Anexo Fotográfico.`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearStoredAccessToken();
          redirectToLoginWithNext();
          return;
        }
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  status: "error",
                  errorMessage:
                    err instanceof Error && err.message
                      ? err.message
                      : "Error al subir la fotografía.",
                }
              : item,
          ),
        );
      }
    }
  };

  const handleRemoveEvidence = async (evidenceId: string) => {
    if (!draftComplaint) {
      return;
    }
    setRemovingEvidenceId(evidenceId);
    setStepError(null);
    try {
      await removeComplaintEvidence(draftComplaint.id, evidenceId);
      const oldThumb = localThumbnails[evidenceId];
      if (oldThumb) {
        URL.revokeObjectURL(oldThumb);
        createdObjectUrlsRef.current.delete(oldThumb);
      }
      setLocalThumbnails((prev) => {
        const next = { ...prev };
        delete next[evidenceId];
        return next;
      });
      setEvidences((prev) => prev.filter((item) => item.id !== evidenceId));
      setPreviewData(null);
      setStepStatusMessage("Fotografía quitada del borrador.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLoginWithNext();
        return;
      }
      setStepError(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo quitar la fotografía.",
      );
      focusStepError();
    } finally {
      setRemovingEvidenceId(null);
    }
  };

  const handleContinueToStep3 = async () => {
    const activeUploads = uploadQueue.some((item) => item.status === "uploading");
    if (activeUploads) {
      setStepError("Espera a que termine la subida de fotografías antes de continuar.");
      focusStepError();
      return;
    }

    const saved = await persistDraftFacts();
    if (!saved) {
      return;
    }

    if (evidences.length < MIN_PHOTOS_PER_COMPLAINT || evidences.length > MAX_PHOTOS_PER_COMPLAINT) {
      setStepError(
        `Debes adjuntar entre ${MIN_PHOTOS_PER_COMPLAINT} y ${MAX_PHOTOS_PER_COMPLAINT} fotografías para generar el Anexo Fotográfico del PDF.`,
      );
      focusStepError();
      return;
    }

    setPreviewData(null);
    goToStep(3);
  };

  const handleRefreshProfileAndPreview = async (event?: SyntheticEvent<HTMLFormElement>) => {
    if (event) {
      event.preventDefault();
    }
    if (!draftComplaint) {
      return;
    }
    const updated = await persistProfileUpdate();
    if (!updated) {
      return;
    }
    await loadHtmlPreview(draftComplaint.id);
    setStepStatusMessage("Datos personales guardados y vista previa del Documento de Denuncia actualizada.");
  };

  const handleRequestSubmitDialog = async () => {
    if (!draftComplaint) {
      setStepError("Guarda primero los hechos y fotografías en el Paso 2.");
      focusStepError();
      return;
    }

    if (evidences.length < MIN_PHOTOS_PER_COMPLAINT || evidences.length > MAX_PHOTOS_PER_COMPLAINT) {
      setStepError(
        `Debes tener entre ${MIN_PHOTOS_PER_COMPLAINT} y ${MAX_PHOTOS_PER_COMPLAINT} fotografías adjuntas antes de emitir el Documento de Denuncia.`,
      );
      focusStepError();
      return;
    }

    const updatedUser = await persistProfileUpdate();
    if (!updatedUser) {
      return;
    }

    setStepError(null);
    confirmDialogRef.current?.showModal();
    cancelConfirmButtonRef.current?.focus();
  };

  const closeSubmitDialog = () => {
    if (confirmDialogRef.current) {
      confirmDialogRef.current.returnValue = "";
      confirmDialogRef.current.close();
    }
  };

  const handleFinalSubmit = async () => {
    if (!draftComplaint) {
      return;
    }
    setSubmittingFinal(true);
    setStepError(null);
    try {
      const finalized = await submitComplaint(draftComplaint.id);
      closeSubmitDialog();
      setSubmittedComplaint(finalized);
      setDraftComplaint(finalized);
      setEvidences(finalized.evidences ?? evidences);
      window.history.replaceState(null, "", "/denunciar");
      setStep(4);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLoginWithNext();
        return;
      }
      closeSubmitDialog();
      setStepError(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos emitir el Documento de Denuncia definitivo.",
      );
      focusStepError();
    } finally {
      setSubmittingFinal(false);
    }
  };

  const handleDownloadPdf = async (complaintId: string) => {
    setDownloadingPdf(true);
    setStepError(null);
    try {
      const result = await fetchComplaintPdfDownloadUrl(complaintId);
      openPresignedPdfDownload(result.download_url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLoginWithNext();
        return;
      }
      setStepError(
        err instanceof Error && err.message
          ? err.message
          : "No pudimos generar el enlace de descarga del PDF.",
      );
      focusStepError();
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2400);
    } catch {
      setCopiedCode(false);
    }
  };

  const handleStartAnother = () => {
    for (const url of createdObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    createdObjectUrlsRef.current.clear();
    setLocalThumbnails({});
    setDraftComplaint(null);
    setSubmittedComplaint(null);
    setAlreadySubmittedView(null);
    setSelectedMainType(null);
    setSelectedCategoryId(null);
    setIncidentDateLocal(getCurrentLocalDateTimeInputValue());
    setIncidentAddress("");
    setLatitude(null);
    setLongitude(null);
    setMapExpanded(false);
    setDescription("");
    setEvidences([]);
    setUploadQueue([]);
    setPreviewData(null);
    setDraftWarning(null);
    window.history.replaceState(null, "", "/denunciar");
    goToStep(1);
  };

  if (initializing) {
    return (
      <div className="mx-auto max-w-4xl rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
        <p className="m-0 font-display text-lg font-semibold text-text-primary">
          Preparando asistente ciudadano de denuncia...
        </p>
        <p className="mt-2 mb-0 text-sm text-text-secondary">
          Cargando catálogo legal vigente y tu sesión verificada.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-3xl rounded-3xl border border-sos/30 bg-sos-soft p-6 text-sos-text"
      >
        <h1 className="m-0 font-display text-xl font-bold">
          No pudimos iniciar el asistente de denuncia
        </h1>
        <p className="mt-2 text-sm">{loadError}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            Reintentar carga
          </button>
          <a
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary no-underline hover:bg-bg-canvas"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    );
  }

  if (alreadySubmittedView) {
    const statusMeta = COMPLAINT_STATUS_META[alreadySubmittedView.status];
    return (
      <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}>
            <Lock aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{statusMeta.label}</span>
          </span>
          {alreadySubmittedView.tracking_code && (
            <span className="tabular-nums text-xs font-bold text-text-primary">
              {alreadySubmittedView.tracking_code}
            </span>
          )}
        </div>

        <h1 className="mt-4 font-display text-2xl font-bold text-text-primary">
          Este Documento de Denuncia ya fue emitido
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          El documento es inmutable y conserva su código correlativo junto con su Anexo Fotográfico en PDF.
        </p>

        {stepError && (
          <div role="alert" className="mt-4 rounded-xl border border-sos/30 bg-sos-soft px-4 py-3 text-sm text-sos-text">
            {stepError}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={downloadingPdf}
            onClick={() => handleDownloadPdf(alreadySubmittedView.id)}
            className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            <span>{downloadingPdf ? "Generando enlace..." : "Descargar Documento de Denuncia (PDF)"}</span>
          </button>

          <a
            href="/mis-denuncias"
            className="inline-flex min-h-[48px] items-center rounded-xl border border-border bg-bg-canvas px-4 py-2.5 text-sm font-semibold text-text-primary no-underline hover:bg-primary-soft hover:text-primary"
          >
            Ir a Mis Denuncias
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border bg-bg-surface p-4 shadow-xs sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-primary">
              Ruta guiada en 4 pasos · Sucre, Bolivia
            </p>
            <h1 className="mt-0.5 mb-0 font-display text-xl font-bold text-text-primary sm:text-2xl">
              Asistente para Documento de Denuncia
            </h1>
          </div>

          <span className="tabular-nums inline-flex w-fit items-center rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary">
            Paso {step} de {STEP_LABELS.length}
          </span>
        </div>

        <nav aria-label="Progreso del asistente" className="mt-4">
          <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
            {STEP_LABELS.map((label, idx) => {
              const stepNum = idx + 1;
              const isCurrent = stepNum === step;
              const isDone = stepNum < step || step === 4;
              const canJump =
                step < 4 &&
                ((stepNum === 1) ||
                  (stepNum === 2 && Boolean(selectedCategoryId)) ||
                  (stepNum === 3 &&
                    Boolean(draftComplaint) &&
                    evidences.length >= MIN_PHOTOS_PER_COMPLAINT));

              return (
                <li key={label} className="min-w-0">
                  <button
                    type="button"
                    disabled={!canJump && !isCurrent}
                    aria-current={isCurrent ? "step" : undefined}
                    onClick={() => {
                      if (canJump && stepNum !== step) {
                        goToStep(stepNum);
                      }
                    }}
                    className={[
                      "flex min-h-[42px] w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors",
                      isCurrent
                        ? "border-primary bg-primary text-white shadow-xs"
                        : isDone
                          ? "cursor-pointer border-secondary/35 bg-secondary-soft text-secondary-text hover:bg-secondary/15"
                          : canJump
                            ? "cursor-pointer border-border bg-bg-canvas text-text-primary hover:bg-primary-soft hover:text-primary"
                            : "cursor-not-allowed border-border bg-bg-canvas/70 text-text-muted",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "tabular-nums inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        isCurrent
                          ? "bg-white/20 text-white"
                          : isDone
                            ? "bg-secondary text-white"
                            : "bg-bg-surface text-text-secondary",
                      ].join(" ")}
                    >
                      {isDone && !isCurrent ? <Check aria-hidden="true" className="h-3 w-3" /> : stepNum}
                    </span>
                    <span className="truncate">{label.replace(/^\d+\.\s*/, "")}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {draftWarning && (
        <div
          role="status"
          className="rounded-2xl border border-secondary/30 bg-secondary-soft px-4 py-3 text-sm text-secondary-text"
        >
          {draftWarning}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 space-y-5 lg:col-span-7 xl:col-span-8">
          {stepError && (
            <div
              ref={stepErrorRef}
              tabIndex={-1}
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-sos/35 bg-sos-soft p-4 text-sm text-sos-text"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="m-0 font-medium leading-relaxed">{stepError}</p>
            </div>
          )}

          {stepStatusMessage && !stepError && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2.5 rounded-2xl border border-secondary/30 bg-secondary-soft p-4 text-sm text-secondary-text"
            >
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="m-0 font-medium leading-relaxed">{stepStatusMessage}</p>
            </div>
          )}

          {step === 1 && (
            <section className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary focus:outline-none sm:text-2xl"
                >
                  1. Tipifica el caso y su sustento legal
                </h2>
                <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                  Código Penal · Ley N.º 700
                </span>
              </div>

              <details className="mt-3 rounded-2xl border border-border bg-bg-canvas px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-text-primary">
                  <span className="inline-flex items-center gap-2">
                    <Info aria-hidden="true" className="h-4 w-4 text-primary" />
                    <span>¿Cómo funciona este asistente ciudadano?</span>
                  </span>
                  <ChevronDown aria-hidden="true" className="h-4 w-4 text-text-secondary" />
                </summary>
                <p className="mt-2.5 mb-0 text-xs leading-relaxed text-text-secondary">
                  Generarás un <strong>Documento de Denuncia</strong> en PDF con base legal automática y un{" "}
                  <strong>Anexo Fotográfico</strong> (de 1 a 3 fotos) listo para presentar ante Fiscalía,
                  POFOMA o CEMZOO.
                </p>
              </details>

              <fieldset className="mt-6 border-0 p-0">
                <legend className="text-sm font-semibold text-text-primary">
                  Paso A: Selecciona el tipo principal de hecho
                </legend>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(["MALTRATO", "BIOCIDIO"] as const).map((typeKey) => {
                    const meta = OFFENSE_MAIN_TYPE_META[typeKey];
                    const selected = selectedMainType === typeKey;
                    return (
                      <button
                        key={typeKey}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedMainType(typeKey);
                          if (selectedCategory && selectedCategory.main_type !== typeKey) {
                            setSelectedCategoryId(null);
                          }
                          setStepError(null);
                        }}
                        className={[
                          "flex min-h-[104px] cursor-pointer flex-col justify-between rounded-2xl border-2 p-4 text-left transition-all",
                          selected
                            ? typeKey === "BIOCIDIO"
                              ? "border-sos bg-sos-soft/70 shadow-xs"
                              : "border-primary bg-primary-soft/70 shadow-xs"
                            : "border-border bg-bg-canvas hover:border-primary/40 hover:bg-bg-surface",
                        ].join(" ")}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="font-display text-base font-bold text-text-primary">
                            {meta.label}
                          </span>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}>
                            {typeKey === "BIOCIDIO" ? "Art. 350 ter" : "Art. 350 bis"}
                          </span>
                        </div>
                        <p className="mt-2 mb-0 text-xs leading-relaxed text-text-secondary">
                          {meta.summary}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {selectedMainType && (
                <fieldset className="mt-6 border-0 p-0">
                  <legend className="text-sm font-semibold text-text-primary">
                    Paso B: Elige la modalidad específica ({filteredCategories.length} opciones)
                  </legend>

                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {filteredCategories.map((cat) => {
                      const active = selectedCategoryId === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setSelectedCategoryId(cat.id);
                            setStepError(null);
                          }}
                          className={[
                            "flex min-h-[54px] cursor-pointer items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition-colors sm:text-sm",
                            active
                              ? "border-primary bg-primary text-white shadow-xs"
                              : "border-border bg-bg-surface text-text-primary hover:bg-primary-soft/60",
                          ].join(" ")}
                        >
                          <span className="leading-snug">{cat.subtype_name}</span>
                          {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              {selectedCategory && (
                <div className="mt-6 rounded-2xl border border-primary/25 bg-primary-soft/50 p-4">
                  <div className="flex items-start gap-2.5">
                    <Scale aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-bold uppercase tracking-wide text-primary">
                        Fundamento Jurídico Automático
                      </p>
                      <p className="mt-1 mb-0 text-xs leading-relaxed text-text-primary sm:text-sm">
                        {selectedCategory.legal_basis}
                      </p>

                      <details className="mt-2.5">
                        <summary className="cursor-pointer text-xs font-semibold text-primary">
                          Ver autoridades competentes receptoras
                        </summary>
                        <ul className="mt-2 mb-0 list-disc space-y-1 pl-4 text-xs text-text-secondary">
                          {RECEIVER_INSTITUTIONS.map((inst) => (
                            <li key={inst}>{inst}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-border pt-5">
                <button
                  type="button"
                  onClick={handleContinueFromStep1}
                  className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover sm:w-auto"
                >
                  <span>Continuar a Hechos y Fotos</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary focus:outline-none sm:text-2xl"
                >
                  2. Hechos, Ubicación y Fotografías
                </h2>
                <span className="tabular-nums rounded-full bg-secondary-soft px-3 py-1 text-xs font-bold text-secondary-text">
                  {evidences.length}/{MAX_PHOTOS_PER_COMPLAINT} fotos
                </span>
              </div>

              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label htmlFor="wizard-incident-date" className="text-xs font-semibold text-text-primary">
                        Fecha y hora aproximada *
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setIncidentDateLocal(getCurrentLocalDateTimeInputValue());
                          clearFieldError("incidentDateLocal");
                        }}
                        className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-semibold text-primary underline"
                      >
                        Usar fecha actual
                      </button>
                    </div>
                    <input
                      ref={incidentDateInputRef}
                      id="wizard-incident-date"
                      type="datetime-local"
                      value={incidentDateLocal}
                      onChange={(e) => {
                        setIncidentDateLocal(e.target.value);
                        clearFieldError("incidentDateLocal");
                      }}
                      aria-invalid={fieldErrors.incidentDateLocal ? "true" : undefined}
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary"
                    />
                    {fieldErrors.incidentDateLocal && (
                      <p className="mt-1 mb-0 text-xs font-medium text-sos-text">
                        {fieldErrors.incidentDateLocal}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="wizard-incident-address"
                      className="mb-1.5 block text-xs font-semibold text-text-primary"
                    >
                      Dirección o referencia exacta del hecho *
                    </label>
                    <input
                      ref={incidentAddressInputRef}
                      id="wizard-incident-address"
                      type="text"
                      maxLength={255}
                      value={incidentAddress}
                      onChange={(e) => {
                        setIncidentAddress(e.target.value);
                        clearFieldError("incidentAddress");
                      }}
                      placeholder="Ej. Calle Loa N.º 420, frente al mercado"
                      aria-invalid={fieldErrors.incidentAddress ? "true" : undefined}
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted"
                    />
                    {fieldErrors.incidentAddress && (
                      <p className="mt-1 mb-0 text-xs font-medium text-sos-text">
                        {fieldErrors.incidentAddress}
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-bg-canvas p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MapPin aria-hidden="true" className="h-4 w-4 text-primary" />
                      <div>
                        <p className="m-0 text-xs font-semibold text-text-primary">
                          Ubicación GPS en mapa (Opcional)
                        </p>
                        <p className="tabular-nums m-0 text-[11px] text-text-secondary">
                          {latitude !== null && longitude !== null
                            ? `Pin fijado: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                            : "Ayuda a localizar el punto exacto en Sucre si la dirección no es precisa."}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-expanded={mapExpanded}
                      onClick={() => setMapExpanded((prev) => !prev)}
                      className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft"
                    >
                      <span>{mapExpanded ? "Ocultar mapa" : "Abrir mapa GPS"}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`h-4 w-4 transition-transform ${mapExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>

                  {mapExpanded && (
                    <div className="mt-3">
                      <IncidentLocationPicker
                        latitude={latitude}
                        longitude={longitude}
                        onChange={({ latitude: lat, longitude: lng }) => {
                          setLatitude(lat);
                          setLongitude(lng);
                        }}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      htmlFor="wizard-description"
                      className="text-xs font-semibold text-text-primary"
                    >
                      Relato objetivo de los hechos *
                    </label>
                    <span className="tabular-nums text-[11px] text-text-secondary">
                      {description.trim().length}/5000
                    </span>
                  </div>
                  <textarea
                    ref={descriptionInputRef}
                    id="wizard-description"
                    rows={4}
                    maxLength={5000}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      clearFieldError("description");
                    }}
                    placeholder="Describe qué ocurrió, cuántos animales están afectados, situación actual de riesgo y cualquier detalle verificable."
                    aria-invalid={fieldErrors.description ? "true" : undefined}
                    className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-text-primary placeholder:text-text-muted"
                  />
                  {fieldErrors.description && (
                    <p className="mt-1 mb-0 text-xs font-medium text-sos-text">
                      {fieldErrors.description}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-bg-canvas p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Camera aria-hidden="true" className="h-4 w-4 text-primary" />
                        <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                          Anexo Fotográfico ({MIN_PHOTOS_PER_COMPLAINT} a {MAX_PHOTOS_PER_COMPLAINT} fotografías) *
                        </h3>
                      </div>
                      <p className="mt-1 mb-0 text-xs leading-relaxed text-text-secondary">
                        Se incrustarán en la última página de tu Documento de Denuncia en PDF. Solo
                        se permiten imágenes <strong>JPG, PNG o WEBP</strong> (máx. 25 MB c/u).
                      </p>
                    </div>

                    <span
                      className={`tabular-nums inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                        evidences.length >= MIN_PHOTOS_PER_COMPLAINT
                          ? "bg-secondary-soft text-secondary-text"
                          : "bg-sos-soft text-sos-text"
                      }`}
                    >
                      {evidences.length} / {MAX_PHOTOS_PER_COMPLAINT} listas
                    </span>
                  </div>

                  <div className="mt-4">
                    <label
                      htmlFor="photo-annex-input"
                      className={[
                        "flex min-h-[76px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed p-4 text-center transition-colors",
                        evidences.length >= MAX_PHOTOS_PER_COMPLAINT || savingDraft
                          ? "cursor-not-allowed border-border bg-bg-surface/60 text-text-muted"
                          : "cursor-pointer border-primary/40 bg-bg-surface text-text-primary hover:border-primary hover:bg-primary-soft/30",
                      ].join(" ")}
                    >
                      <Upload aria-hidden="true" className="h-5 w-5 text-primary" />
                      <span className="text-xs font-semibold sm:text-sm">
                        {evidences.length >= MAX_PHOTOS_PER_COMPLAINT
                          ? "Cupo completo (3 de 3 fotografías)"
                          : "Seleccionar o tomar fotografías (JPG, PNG, WEBP)"}
                      </span>
                      <span className="text-[11px] text-text-secondary">
                        Al adjuntar la primera foto, tu borrador se guarda automáticamente.
                      </span>
                      <input
                        id="photo-annex-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        disabled={evidences.length >= MAX_PHOTOS_PER_COMPLAINT || savingDraft}
                        onChange={handlePhotoSelection}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {uploadQueue.length > 0 && (
                    <ul className="m-0 mt-3 list-none space-y-2 p-0">
                      {uploadQueue.map((item) => (
                        <li
                          key={item.localId}
                          className="rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold text-text-primary">
                              {item.fileName}
                            </span>
                            {item.status === "uploading" ? (
                              <span className="tabular-nums font-bold text-primary">
                                {item.progress}%
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setUploadQueue((prev) =>
                                    prev.filter((row) => row.localId !== item.localId),
                                  )
                                }
                                className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-sos-text underline"
                              >
                                Descartar
                              </button>
                            )}
                          </div>
                          {item.status === "uploading" ? (
                            <progress
                              aria-label={`Subiendo ${item.fileName}`}
                              value={item.progress}
                              max={100}
                              className="mt-2 h-2 w-full accent-primary"
                            />
                          ) : (
                            <p className="mt-1 mb-0 text-xs font-medium text-sos-text">
                              {item.errorMessage}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {evidences.length > 0 && (
                    <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
                      {evidences.map((ev, idx) => {
                        const thumbUrl = localThumbnails[ev.id];
                        return (
                          <li
                            key={ev.id}
                            className="flex flex-col justify-between rounded-2xl border border-border bg-bg-surface p-3 shadow-xs"
                          >
                            {thumbUrl ? (
                              <img
                                src={thumbUrl}
                                alt={`Fotografía adjunta ${idx + 1}`}
                                className="h-28 w-full rounded-xl bg-bg-canvas object-cover"
                              />
                            ) : (
                              <div className="flex h-28 w-full flex-col items-center justify-center rounded-xl bg-bg-canvas text-text-secondary">
                                <Camera aria-hidden="true" className="h-6 w-6 text-primary" />
                                <span className="mt-1 text-[11px] font-semibold">
                                  Foto {idx + 1} guardada
                                </span>
                              </div>
                            )}

                            <div className="mt-2.5 flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="m-0 truncate text-xs font-bold text-text-primary">
                                  Fotografía {idx + 1}
                                </p>
                                <p className="tabular-nums m-0 text-[11px] text-text-secondary">
                                  {ev.mime_type.replace("image/", "").toUpperCase()} ·{" "}
                                  {formatFileSize(ev.file_size_bytes)}
                                </p>
                              </div>

                              <button
                                type="button"
                                aria-label={`Quitar fotografía ${idx + 1}`}
                                disabled={removingEvidenceId === ev.id}
                                onClick={() => handleRemoveEvidence(ev.id)}
                                className="inline-flex min-h-[36px] min-w-[36px] cursor-pointer items-center justify-center rounded-lg border border-sos/30 bg-bg-surface text-sos-text hover:bg-sos-soft disabled:opacity-50"
                              >
                                <Trash2 aria-hidden="true" className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="mt-7 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => goToStep(1)}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-canvas"
                  >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    <span>Atrás</span>
                  </button>

                  <button
                    type="button"
                    disabled={savingDraft}
                    onClick={handleSaveDraftClick}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-canvas px-4 py-2 text-sm font-semibold text-text-primary hover:bg-primary-soft hover:text-primary disabled:opacity-60"
                  >
                    <Save aria-hidden="true" className="h-4 w-4" />
                    <span>{savingDraft ? "Guardando..." : "Guardar borrador"}</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={savingDraft}
                  onClick={handleContinueToStep3}
                  className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  <span>Continuar a Revisión</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary focus:outline-none sm:text-2xl"
                >
                  3. Tus Datos Legales y Vista Previa
                </h2>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
                    isProfileComplete
                      ? "bg-secondary-soft text-secondary-text"
                      : "bg-sos-soft text-sos-text"
                  }`}
                >
                  {isProfileComplete ? "Identidad completa" : "Completa tu identidad"}
                </span>
              </div>

              <form onSubmit={handleRefreshProfileAndPreview} className="mt-5 rounded-2xl border border-border bg-bg-canvas p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                      Identificación del Denunciante
                    </h3>
                    <p className="mt-0.5 mb-0 text-xs text-text-secondary">
                      Requerida por la Ley N.º 700/2015 para emitir el Documento de Denuncia en PDF.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="wizard-full-name" className="mb-1 block text-xs font-semibold text-text-primary">
                      Nombre completo *
                    </label>
                    <input
                      ref={fullNameInputRef}
                      id="wizard-full-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        clearFieldError("fullName");
                      }}
                      aria-invalid={fieldErrors.fullName ? "true" : undefined}
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary"
                    />
                    {fieldErrors.fullName && (
                      <p className="mt-1 mb-0 text-xs font-medium text-sos-text">{fieldErrors.fullName}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="wizard-ci" className="mb-1 block text-xs font-semibold text-text-primary">
                      Cédula de Identidad (C.I.) *
                    </label>
                    <input
                      ref={ciInputRef}
                      id="wizard-ci"
                      type="text"
                      value={ciNumber}
                      placeholder="Ej. 7482910 CH"
                      onChange={(e) => {
                        setCiNumber(e.target.value);
                        clearFieldError("ciNumber");
                      }}
                      aria-invalid={fieldErrors.ciNumber ? "true" : undefined}
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted"
                    />
                    {fieldErrors.ciNumber && (
                      <p className="mt-1 mb-0 text-xs font-medium text-sos-text">{fieldErrors.ciNumber}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="wizard-phone" className="mb-1 block text-xs font-semibold text-text-primary">
                      Teléfono / WhatsApp *
                    </label>
                    <input
                      ref={phoneInputRef}
                      id="wizard-phone"
                      type="tel"
                      value={phone}
                      placeholder="Ej. +591 71234567"
                      onChange={(e) => {
                        setPhone(e.target.value);
                        clearFieldError("phone");
                      }}
                      aria-invalid={fieldErrors.phone ? "true" : undefined}
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted"
                    />
                    {fieldErrors.phone && (
                      <p className="mt-1 mb-0 text-xs font-medium text-sos-text">{fieldErrors.phone}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="wizard-domicile" className="mb-1 block text-xs font-semibold text-text-primary">
                      Domicilio actual en Sucre *
                    </label>
                    <input
                      ref={domicileInputRef}
                      id="wizard-domicile"
                      type="text"
                      value={domicileAddress}
                      placeholder="Ej. Av. Hernando Siles 350, Zona Central"
                      onChange={(e) => {
                        setDomicileAddress(e.target.value);
                        clearFieldError("domicileAddress");
                      }}
                      aria-invalid={fieldErrors.domicileAddress ? "true" : undefined}
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted"
                    />
                    {fieldErrors.domicileAddress && (
                      <p className="mt-1 mb-0 text-xs font-medium text-sos-text">
                        {fieldErrors.domicileAddress}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingProfile || loadingPreview}
                    className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl border border-primary/30 bg-bg-surface px-4 py-2 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-60"
                  >
                    <Save aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>
                      {savingProfile || loadingPreview
                        ? "Actualizando vista previa..."
                        : "Guardar datos y actualizar vista previa"}
                    </span>
                  </button>
                </div>
              </form>

              <div className="mt-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                    Vista Previa Oficial (incluye Anexo Fotográfico)
                  </h3>
                  <span className="tabular-nums text-xs text-text-secondary">
                    {evidences.length} fotografía(s) incrustadas
                  </span>
                </div>

                {loadingPreview ? (
                  <div className="flex min-h-[340px] items-center justify-center rounded-2xl border border-border bg-bg-canvas p-6 text-sm text-text-secondary">
                    Generando vista previa del Documento de Denuncia con tus fotografías...
                  </div>
                ) : previewData ? (
                  <iframe
                    title="Vista previa oficial del Documento de Denuncia"
                    srcDoc={previewData.html_preview}
                    sandbox=""
                    className="h-[460px] w-full rounded-2xl border border-border bg-white shadow-inner sm:h-[540px]"
                  />
                ) : (
                  <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-bg-canvas p-6 text-center">
                    <p className="m-0 text-sm text-text-secondary">
                      Actualiza tus datos para renderizar el Documento de Denuncia.
                    </p>
                    {draftComplaint && (
                      <button
                        type="button"
                        onClick={() => void loadHtmlPreview(draftComplaint.id)}
                        className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
                      >
                        Cargar vista previa
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-7 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-canvas"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  <span>Editar hechos o fotos</span>
                </button>

                <button
                  type="button"
                  disabled={savingProfile || submittingFinal}
                  onClick={handleRequestSubmitDialog}
                  className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-sos px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-60"
                >
                  <ShieldAlert aria-hidden="true" className="h-4 w-4" />
                  <span>Emitir Documento de Denuncia (PDF)</span>
                </button>
              </div>
            </section>
          )}

          {step === 4 && submittedComplaint && (
            <section className="rounded-3xl border border-secondary/35 bg-bg-surface p-5 shadow-xs sm:p-8">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary-soft text-secondary-text">
                  <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
                </span>
                <div>
                  <p className="m-0 text-xs font-bold uppercase tracking-wide text-secondary-text">
                    Documento Emitido e Inmutable
                  </p>
                  <h2
                    ref={stepHeadingRef}
                    tabIndex={-1}
                    className="mt-0.5 mb-0 font-display text-2xl font-bold text-text-primary focus:outline-none"
                  >
                    Tu Documento de Denuncia está listo
                  </h2>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-bg-canvas p-5">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Código correlativo de referencia del documento
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="tabular-nums font-display text-2xl font-extrabold tracking-tight text-primary">
                    {submittedComplaint.tracking_code ?? "Emitido"}
                  </span>
                  {submittedComplaint.tracking_code && (
                    <button
                      type="button"
                      onClick={() => handleCopyCode(submittedComplaint.tracking_code ?? "")}
                      className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-primary-soft hover:text-primary"
                    >
                      <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>{copiedCode ? "Copiado" : "Copiar código"}</span>
                    </button>
                  )}
                </div>
                <p className="mt-2 mb-0 text-xs text-text-secondary">
                  Incluye el cuerpo formal con sustento jurídico y{" "}
                  <strong className="tabular-nums">{evidences.length} fotografía(s)</strong> en la
                  página final de Anexo Fotográfico.
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  disabled={downloadingPdf}
                  onClick={() => handleDownloadPdf(submittedComplaint.id)}
                  className="inline-flex min-h-[50px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  <Download aria-hidden="true" className="h-5 w-5" />
                  <span>
                    {downloadingPdf
                      ? "Generando descarga..."
                      : "Descargar Documento de Denuncia (PDF)"}
                  </span>
                </button>

                <a
                  href="/mis-denuncias"
                  className="inline-flex min-h-[50px] items-center justify-center rounded-xl border border-border bg-bg-surface px-5 py-3 text-sm font-semibold text-text-primary no-underline hover:bg-bg-canvas"
                >
                  Ver en Mis Denuncias
                </a>
              </div>

              <div className="mt-6 rounded-2xl border border-primary/20 bg-primary-soft/45 p-5">
                <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                  ¿Cómo presentar este PDF ante las autoridades en Sucre?
                </h3>
                <ol className="mt-2.5 mb-0 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-text-secondary">
                  <li>
                    Descarga e imprime el <strong>Documento de Denuncia</strong> completo (incluye el Anexo Fotográfico al final).
                  </li>
                  <li>
                    Firma el documento al pie de página junto con tu Cédula de Identidad antes de entregarlo.
                  </li>
                  <li>
                    Preséntalo directamente ante <strong>POFOMA</strong>, el{" "}
                    <strong>Ministerio Público (Fiscalía)</strong> o <strong>CEMZOO Sucre</strong>.
                    SOS Animal no realiza seguimiento procesal posterior dentro de la plataforma.
                  </li>
                </ol>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <a
                  href="/centros-de-atencion"
                  className="text-xs font-semibold text-secondary-text no-underline hover:underline"
                >
                  Ver Veterinarias y Zoonosis cercanas →
                </a>
                <button
                  type="button"
                  onClick={handleStartAnother}
                  className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary hover:bg-primary-soft hover:text-primary"
                >
                  Redactar nueva denuncia
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="hidden space-y-4 lg:sticky lg:top-24 lg:col-span-5 lg:block xl:col-span-4">
          <div className="rounded-3xl border border-primary/20 bg-primary-soft/60 p-5">
            <div className="flex items-center gap-2 text-primary">
              <Scale aria-hidden="true" className="h-4 w-4 shrink-0" />
              <h2 className="m-0 font-display text-sm font-bold">
                Sustento Legal Aplicable
              </h2>
            </div>

            {selectedCategory ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      OFFENSE_MAIN_TYPE_META[selectedCategory.main_type].badgeClass
                    }`}
                  >
                    {selectedCategory.main_type}
                  </span>
                  <span className="font-semibold text-text-primary">
                    {selectedCategory.subtype_name}
                  </span>
                </div>
                <p className="m-0 text-xs leading-relaxed text-text-primary">
                  {selectedCategory.legal_basis}
                </p>
              </div>
            ) : selectedMainType ? (
              <div className="mt-3 space-y-1 text-xs">
                <p className="m-0 font-semibold text-primary">
                  {OFFENSE_MAIN_TYPE_META[selectedMainType].article}
                </p>
                <p className="m-0 text-text-secondary">
                  Elige la modalidad específica para completar el encuadre legal.
                </p>
              </div>
            ) : (
              <p className="mt-3 mb-0 text-xs leading-relaxed text-text-secondary">
                Selecciona el tipo de hecho en el Paso 1 para vincular Ley N.º 700/2015, Código
                Penal Arts. 350 bis / 350 ter y Ley Municipal N.º 252/2022.
              </p>
            )}
          </div>

          <div className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <FileText aria-hidden="true" className="h-4 w-4 text-primary" />
                <h2 className="m-0 font-display text-sm font-bold text-text-primary">
                  Resumen · Documento de Denuncia
                </h2>
              </div>
              <span className="rounded-full bg-bg-canvas px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
                {submittedComplaint ? "EMITIDO" : "BORRADOR"}
              </span>
            </div>

            <dl className="m-0 mt-3 space-y-2.5 text-xs">
              <div>
                <dt className="font-semibold text-text-secondary">Denunciante</dt>
                <dd className="m-0 mt-0.5 text-text-primary">
                  {fullName.trim() || currentUser?.full_name || "Pendiente"}
                  {ciNumber.trim() ? (
                    <span className="tabular-nums text-text-secondary"> · C.I. {ciNumber.trim()}</span>
                  ) : null}
                </dd>
              </div>

              <div>
                <dt className="font-semibold text-text-secondary">Tipificación</dt>
                <dd className="m-0 mt-0.5 text-text-primary">
                  {selectedCategory
                    ? `${selectedCategory.main_type} — ${selectedCategory.subtype_name}`
                    : selectedMainType ?? "Por seleccionar"}
                </dd>
              </div>

              <div>
                <dt className="font-semibold text-text-secondary">Fecha y lugar</dt>
                <dd className="tabular-nums m-0 mt-0.5 text-text-primary">
                  {formatLocalDateTimeInputDisplay(incidentDateLocal)} ·{" "}
                  {incidentAddress.trim() || "Por completar"}
                </dd>
                {latitude !== null && longitude !== null && (
                  <dd className="tabular-nums m-0 mt-0.5 text-[11px] text-secondary-text">
                    GPS: {latitude.toFixed(5)}, {longitude.toFixed(5)}
                  </dd>
                )}
              </div>

              <div>
                <dt className="font-semibold text-text-secondary">Anexo Fotográfico</dt>
                <dd className="tabular-nums m-0 mt-0.5 text-text-primary">
                  {evidences.length} / {MAX_PHOTOS_PER_COMPLAINT} fotografía(s)
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <dialog
        ref={confirmDialogRef}
        aria-labelledby="confirm-submit-title"
        onCancel={(event) => {
          if (submittingFinal) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          if (confirmDialogRef.current) {
            confirmDialogRef.current.returnValue = "";
          }
        }}
        className="w-full max-w-lg rounded-3xl border border-border bg-bg-surface p-6 text-text-primary shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sos-soft text-sos-text">
            <Info aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 id="confirm-submit-title" className="m-0 font-display text-lg font-bold text-text-primary">
              ¿Emitir el Documento de Denuncia definitivo?
            </h2>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-text-secondary">
              Se generará el PDF oficial de tu <strong>Documento de Denuncia</strong> con código
              correlativo único y tus <strong>{evidences.length} fotografía(s)</strong> incrustadas en
              el Anexo Fotográfico. Luego no podrá modificarse ni eliminarse.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            ref={cancelConfirmButtonRef}
            type="button"
            disabled={submittingFinal}
            onClick={closeSubmitDialog}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-canvas disabled:opacity-60"
          >
            Cancelar y revisar
          </button>

          <button
            type="button"
            disabled={submittingFinal}
            onClick={handleFinalSubmit}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-sos px-5 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            <Lock aria-hidden="true" className="h-4 w-4" />
            <span>{submittingFinal ? "Generando PDF..." : "Sí, emitir Documento de Denuncia"}</span>
          </button>
        </div>
      </dialog>
    </div>
  );
}
