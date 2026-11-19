import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Info,
  Lock,
  Save,
  Scale,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
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

type Step5FieldKey =
  | "fullName"
  | "ciNumber"
  | "phone"
  | "domicileAddress"
  | "incidentDateLocal"
  | "incidentAddress"
  | "description";

type Step5FieldErrors = Partial<Record<Step5FieldKey, string>>;

const STEP_LABELS = [
  "1. Inicio",
  "2. Tipo",
  "3. Modalidad",
  "4. Fundamento",
  "5. Datos",
  "6. Revisión",
  "7. Envío",
] as const;

const CI_REGEX = /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/;
const PHONE_REGEX = /^\+?[0-9]+(?:[ -][0-9]+)*$/;

const DESTINATARIO_INSTITUTIONS = [
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
  const current = `${window.location.pathname}${window.location.search}`;
  const safeNext = current.startsWith("/denunciar") ? current : "/denunciar";
  window.location.replace(`/login?next=${encodeURIComponent(safeNext)}`);
}

export default function ComplaintWizardIsland() {
  const [initializing, setInitializing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserRead | null>(null);
  const [categories, setCategories] = useState<OffenseCategoryRead[]>([]);
  const [alreadySubmittedView, setAlreadySubmittedView] = useState<ComplaintRead | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  const [step, setStep] = useState<number>(1);
  const [confirmedStart, setConfirmedStart] = useState<boolean>(true);
  const [selectedMainType, setSelectedMainType] = useState<OffenseMainType | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const [fullName, setFullName] = useState("");
  const [ciNumber, setCiNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [domicileAddress, setDomicileAddress] = useState("");

  const [incidentDateLocal, setIncidentDateLocal] = useState(() =>
    getCurrentLocalDateTimeInputValue(),
  );
  const [incidentAddress, setIncidentAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [description, setDescription] = useState("");

  const [draftComplaint, setDraftComplaint] = useState<ComplaintRead | null>(null);
  const [evidences, setEvidences] = useState<ComplaintEvidenceRead[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadItemState[]>([]);
  const [removingEvidenceId, setRemovingEvidenceId] = useState<string | null>(null);

  const [stepError, setStepError] = useState<string | null>(null);
  const [step5FieldErrors, setStep5FieldErrors] = useState<Step5FieldErrors>({});
  const [stepStatusMessage, setStepStatusMessage] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<ComplaintPreviewResponse | null>(null);
  const [submittingFinal, setSubmittingFinal] = useState(false);
  const [submittedComplaint, setSubmittedComplaint] = useState<ComplaintRead | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepErrorRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const hasMovedStepRef = useRef(false);
  const draftSavePromiseRef = useRef<Promise<ComplaintRead | null> | null>(null);

  const fullNameInputRef = useRef<HTMLInputElement>(null);
  const ciInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const domicileInputRef = useRef<HTMLInputElement>(null);
  const incidentDateInputRef = useRef<HTMLInputElement>(null);
  const incidentAddressInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

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
            setDescription(loaded.description);
            setConfirmedStart(true);
            setStep(5);
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

  const goToStep = (nextStep: number) => {
    setStepError(null);
    setStep5FieldErrors({});
    setStepStatusMessage(null);
    setStep(nextStep);
  };

  const focusStepError = () => {
    window.requestAnimationFrame(() => {
      stepErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      stepErrorRef.current?.focus({ preventScroll: true });
    });
  };

  const validateSingleStep5Field = (field: Step5FieldKey, rawValue: string): string | undefined => {
    switch (field) {
      case "fullName": {
        const cleanName = rawValue.trim();
        if (cleanName.length < 2 || cleanName.length > 150 || cleanName.includes("<") || cleanName.includes(">")) {
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
    }
  };

  const clearStep5FieldError = (field: Step5FieldKey) => {
    setStep5FieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const focusStep5Field = (field: Step5FieldKey) => {
    const refMap: Record<Step5FieldKey, HTMLElement | null> = {
      fullName: fullNameInputRef.current,
      ciNumber: ciInputRef.current,
      phone: phoneInputRef.current,
      domicileAddress: domicileInputRef.current,
      incidentDateLocal: incidentDateInputRef.current,
      incidentAddress: incidentAddressInputRef.current,
      description: descriptionInputRef.current,
    };
    const target = refMap[field];
    target?.focus();
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const validateProfileAndFactInputs = (): {
    message: string | null;
    firstInvalidField: Step5FieldKey | null;
  } => {
    const fieldsToCheck: [Step5FieldKey, string][] = [
      ["fullName", fullName],
      ["ciNumber", ciNumber],
      ["phone", phone],
      ["domicileAddress", domicileAddress],
      ["incidentDateLocal", incidentDateLocal],
      ["incidentAddress", incidentAddress],
      ["description", description],
    ];

    const errors: Step5FieldErrors = {};
    let firstInvalidField: Step5FieldKey | null = null;
    let firstMessage: string | null = null;

    for (const [key, value] of fieldsToCheck) {
      const error = validateSingleStep5Field(key, value);
      if (error) {
        errors[key] = error;
        if (!firstInvalidField) {
          firstInvalidField = key;
          firstMessage = error;
        }
      }
    }

    setStep5FieldErrors(errors);

    if (firstMessage) {
      return { message: firstMessage, firstInvalidField };
    }

    if (!selectedCategoryId) {
      return {
        message: "Selecciona una tipificación y modalidad válida antes de guardar.",
        firstInvalidField: null,
      };
    }

    if ((latitude === null) !== (longitude === null)) {
      return {
        message: "Las coordenadas GPS deben estar completas o vacías en conjunto.",
        firstInvalidField: null,
      };
    }

    return { message: null, firstInvalidField: null };
  };

  const persistProfileAndDraft = async (): Promise<ComplaintRead | null> => {
    if (draftSavePromiseRef.current) {
      return draftSavePromiseRef.current;
    }

    const { message: validationMsg, firstInvalidField } = validateProfileAndFactInputs();
    if (validationMsg) {
      setStepError(validationMsg);
      if (firstInvalidField) {
        focusStep5Field(firstInvalidField);
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
        const nextFullName = fullName.trim();
        const nextCi = ciNumber.trim();
        const nextPhone = phone.trim();
        const nextDomicile = domicileAddress.trim();

        const profileNeedsUpdate =
          !currentUser ||
          currentUser.full_name !== nextFullName ||
          currentUser.ci_number !== nextCi ||
          currentUser.phone !== nextPhone ||
          currentUser.address !== nextDomicile;

        if (profileNeedsUpdate) {
          const updatedUser = await updateMyProfile({
            full_name: nextFullName,
            ci_number: nextCi,
            phone: nextPhone,
            address: nextDomicile,
          });
          setCurrentUser(updatedUser);
        }

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

  const handleSaveDraftClick = async () => {
    const saved = await persistProfileAndDraft();
    if (saved) {
      setStepStatusMessage("Borrador guardado correctamente. Puedes continuar o retomar luego desde Mis Denuncias.");
    }
  };

  const handleContinueToPreview = async () => {
    const saved = await persistProfileAndDraft();
    if (!saved) {
      return;
    }

    setStep(6);
    setLoadingPreview(true);
    setPreviewData(null);
    setStepError(null);
    try {
      const preview = await fetchComplaintPreview(saved.id);
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
      focusStepError();
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleReloadPreview = async () => {
    if (!draftComplaint) {
      return;
    }
    setLoadingPreview(true);
    setStepError(null);
    try {
      const preview = await fetchComplaintPreview(draftComplaint.id);
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
          : "No pudimos recargar la vista previa.",
      );
      focusStepError();
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleEvidenceFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setStepError(null);
    setStepStatusMessage(null);

    let activeDraft = draftComplaint;
    if (!activeDraft) {
      activeDraft = await persistProfileAndDraft();
      if (!activeDraft) {
        setStepError((prev) =>
          prev
            ? `Antes de subir evidencias: ${prev}`
            : "Completa los datos obligatorios del denunciante y el relato antes de adjuntar archivos.",
        );
        return;
      }
    }

    for (const file of files) {
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
            errorMessage: err instanceof Error ? err.message : "Archivo no válido.",
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
          purpose: "evidence",
        });

        await uploadFileToPresignedUrl(presigned.upload_url, file, validated.mimeType, (percent) => {
          setUploadQueue((prev) =>
            prev.map((item) =>
              item.localId === localId ? { ...item, progress: Math.max(5, percent) } : item,
            ),
          );
        });

        const attached = await attachComplaintEvidence(activeDraft.id, {
          evidence_type: inferEvidenceType(validated.mimeType),
          object_key: presigned.object_key,
          mime_type: validated.mimeType,
          file_size_bytes: validated.sizeBytes,
        });

        setEvidences((prev) => [...prev, attached]);
        setUploadQueue((prev) => prev.filter((item) => item.localId !== localId));
        setStepStatusMessage(`Evidencia "${file.name}" adjuntada al borrador.`);
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
                      : "Error al subir el archivo.",
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
      setEvidences((prev) => prev.filter((item) => item.id !== evidenceId));
      setStepStatusMessage("Evidencia eliminada del borrador.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredAccessToken();
        redirectToLoginWithNext();
        return;
      }
      setStepError(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo eliminar la evidencia.",
      );
      focusStepError();
    } finally {
      setRemovingEvidenceId(null);
    }
  };

  const openSubmitDialog = () => {
    setStepError(null);
    confirmDialogRef.current?.showModal();
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
      setStep(7);
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
          : "No pudimos confirmar el envío definitivo de la denuncia.",
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

  const handleCopyTrackingCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      setCopiedCode(false);
    }
  };

  const handleStartNewComplaint = () => {
    setAlreadySubmittedView(null);
    setSubmittedComplaint(null);
    setDraftComplaint(null);
    setPreviewData(null);
    setEvidences([]);
    setUploadQueue([]);
    setSelectedMainType(null);
    setSelectedCategoryId(null);
    setIncidentDateLocal(getCurrentLocalDateTimeInputValue());
    setIncidentAddress("");
    setLatitude(null);
    setLongitude(null);
    setDescription("");
    setStepError(null);
    setStepStatusMessage(null);
    window.history.replaceState(null, "", "/denunciar");
    setStep(1);
  };

  if (initializing) {
    return (
      <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
        <p className="m-0 text-sm font-medium text-text-secondary">
          Preparando asistente guiado de denuncia...
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-3xl border border-sos/30 bg-sos-soft p-6">
        <h1 className="m-0 font-display text-xl font-bold text-sos-text">
          No se pudo cargar el asistente de denuncia
        </h1>
        <p className="mt-2 mb-4 text-sm text-text-primary">{loadError}</p>
        <a
          href="/denunciar"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white no-underline"
        >
          Reintentar
        </a>
      </div>
    );
  }

  if (alreadySubmittedView) {
    const statusMeta = COMPLAINT_STATUS_META[alreadySubmittedView.status];
    return (
      <section className="rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-secondary-soft px-3 py-1 text-xs font-semibold text-secondary-text">
          <Lock aria-hidden="true" className="h-3.5 w-3.5" />
          <span>Denuncia ya enviada e inmutable</span>
        </div>
        <h1 className="mt-3 font-display text-2xl font-bold text-text-primary">
          Este caso ya cuenta con Documento de Denuncia oficial
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Código correlativo:{" "}
          <strong className="tabular-nums text-text-primary">
            {alreadySubmittedView.tracking_code ?? "Asignado"}
          </strong>{" "}
          · Estado actual:{" "}
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
          >
            {statusMeta.label}
          </span>
        </p>

        {stepError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm font-medium text-sos-text"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{stepError}</span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={downloadingPdf}
            onClick={() => handleDownloadPdf(alreadySubmittedView.id)}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            <span>{downloadingPdf ? "Generando enlace..." : "Descargar Documento de Denuncia (PDF)"}</span>
          </button>

          <a
            href="/mis-denuncias"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-bg-canvas px-4 py-2.5 text-sm font-semibold text-text-primary no-underline hover:bg-slate-100"
          >
            Ir a Mis Denuncias
          </a>

          <button
            type="button"
            onClick={handleStartNewComplaint}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-primary/30 bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            Iniciar nueva denuncia
          </button>
        </div>
      </section>
    );
  }

  const isUploadingAny = uploadQueue.some((item) => item.status === "uploading");

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="m-0 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sos-text">
              <ShieldAlert aria-hidden="true" className="h-4 w-4" />
              <span>Ruta Digital Anti-Estrés · 7 Pasos</span>
            </p>
            <p className="mt-1 mb-0 text-sm text-text-secondary">
              Prepara tu <strong>Documento de Denuncia</strong> en Sucre con respaldo normativo y
              pruebas seguras.
            </p>
          </div>
          {draftComplaint && step < 7 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-secondary/30 bg-secondary-soft px-3 py-1 text-xs font-semibold text-secondary-text">
              <Save aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Borrador guardado</span>
            </span>
          )}
        </div>

        <nav aria-label="Progreso de la denuncia" className="mt-5">
          <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-7">
            {STEP_LABELS.map((label, idx) => {
              const stepNum = idx + 1;
              const isCompleted = step > stepNum || (step === 7 && stepNum === 7);
              const isCurrent = step === stepNum && step < 7;
              return (
                <li
                  key={label}
                  aria-current={isCurrent ? "step" : undefined}
                  className={[
                    "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                    isCompleted
                      ? "border-secondary/30 bg-secondary-soft text-text-primary"
                      : isCurrent
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-slate-100 text-text-secondary",
                  ].join(" ")}
                >
                  {isCompleted ? (
                    <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-secondary" />
                  ) : (
                    <span className="tabular-nums shrink-0">{stepNum}.</span>
                  )}
                  <span className="truncate">{label.replace(/^\d+\.\s*/, "")}</span>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {draftWarning && (
        <div
          role="status"
          className="rounded-2xl border border-primary/25 bg-primary-soft p-4 text-sm text-text-primary"
        >
          {draftWarning}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <section className="min-w-0 rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-7">
          {stepError && (
            <div
              ref={stepErrorRef}
              tabIndex={-1}
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm font-medium text-sos-text"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{stepError}</span>
            </div>
          )}

          {stepStatusMessage && step !== 5 && (
            <div
              role="status"
              aria-live="polite"
              className="mb-5 flex items-start gap-2.5 rounded-2xl border border-secondary/30 bg-secondary-soft p-4 text-sm font-medium text-secondary-text"
            >
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{stepStatusMessage}</span>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h1
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary sm:text-2xl"
                >
                  1. Inicio de denuncia ciudadana
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  Este asistente genera un <strong>Documento de Denuncia</strong> estructurado (sin
                  necesidad de firma de abogado) para presentarlo ante Fiscalía, POFOMA, CEMZOO o
                  el GAM Sucre.
                </p>
              </div>

              <div className="rounded-2xl border-2 border-primary bg-primary-soft/50 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={confirmedStart}
                    onChange={(event) => setConfirmedStart(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">
                      Denunciar maltrato animal o biocidio
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
                      Confirmo que los hechos que reportaré corresponden a un caso real en defensa
                      de animales en situación de crueldad, abandono o riesgo.
                    </span>
                  </span>
                </label>
              </div>

              <div className="rounded-2xl border border-sos/25 bg-sos-soft p-4 text-xs leading-relaxed text-text-primary">
                <p className="m-0 font-semibold text-sos-text">
                  ¿El animal necesita atención veterinaria inmediata?
                </p>
                <p className="mt-1 mb-0 text-text-secondary">
                  Si existe riesgo vital en curso, puedes ubicar una veterinaria de urgencia o
                  CEMZOO en el{" "}
                  <a href="/mapa" className="font-semibold text-primary underline">
                    mapa de centros veterinarios
                  </a>{" "}
                  mientras registras tu denuncia.
                </p>
              </div>

              {draftComplaint && (
                <div className="rounded-2xl border border-secondary/30 bg-secondary-soft p-4">
                  <p className="m-0 text-sm font-semibold text-secondary-text">
                    Borrador activo retomado
                  </p>
                  <p className="mt-1 mb-3 text-xs text-text-primary">
                    {draftComplaint.incident_address} · {evidences.length} evidencia(s) adjunta(s).
                  </p>
                  <button
                    type="button"
                    onClick={() => goToStep(5)}
                    className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg bg-secondary px-3.5 py-2 text-xs font-semibold text-white hover:opacity-95"
                  >
                    <span>Ir directo al Paso 5 (Datos y Evidencias)</span>
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmedStart) {
                      setStepError("Marca la confirmación para continuar con la denuncia.");
                      focusStepError();
                      return;
                    }
                    goToStep(2);
                  }}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                >
                  <span>Siguiente: Tipo de hecho</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h1
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary sm:text-2xl"
                >
                  2. Tipo de denuncia
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Selecciona la calificación jurídica principal que describe el hecho presenciado.
                </p>
              </div>

              <fieldset className="m-0 border-0 p-0">
                <legend className="visually-hidden">Selecciona el tipo principal de delito o infracción</legend>
                <div className="grid gap-4">
                  {(["MALTRATO", "BIOCIDIO"] as const).map((typeKey) => {
                    const meta = OFFENSE_MAIN_TYPE_META[typeKey];
                    const selected = selectedMainType === typeKey;
                    const isBiocidio = typeKey === "BIOCIDIO";
                    return (
                      <label
                        key={typeKey}
                        className={[
                          "flex cursor-pointer items-start gap-3.5 rounded-2xl border p-4 transition-colors",
                          selected
                            ? isBiocidio
                              ? "border-2 border-sos bg-sos-soft/50"
                              : "border-2 border-primary bg-primary-soft/60"
                            : "border-border bg-bg-surface hover:bg-bg-canvas",
                        ].join(" ")}
                      >
                        <input
                          type="radio"
                          name="offense_main_type"
                          value={typeKey}
                          checked={selected}
                          onChange={() => {
                            setSelectedMainType(typeKey);
                            const currentCatMatches = categories.some(
                              (cat) => cat.id === selectedCategoryId && cat.main_type === typeKey,
                            );
                            if (!currentCatMatches) {
                              setSelectedCategoryId(null);
                            }
                            setStepError(null);
                          }}
                          className={`mt-1 h-4 w-4 ${isBiocidio ? "accent-sos" : "accent-primary"}`}
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-display text-base font-bold text-text-primary">
                              {meta.label}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                            >
                              {meta.article}
                            </span>
                          </span>
                          <span className="mt-1.5 block text-sm leading-relaxed text-text-secondary">
                            {meta.summary}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-canvas"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  <span>Anterior</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedMainType) {
                      setStepError("Selecciona Maltrato animal o Biocidio para continuar.");
                      focusStepError();
                      return;
                    }
                    goToStep(3);
                  }}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover"
                >
                  <span>Siguiente: Modalidad</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h1
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary sm:text-2xl"
                >
                  3. Modalidad específica
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Elige la modalidad que mejor corresponde al hecho dentro de{" "}
                  <strong>
                    {selectedMainType ? OFFENSE_MAIN_TYPE_META[selectedMainType].label : ""}
                  </strong>
                  .
                </p>
              </div>

              <fieldset className="m-0 border-0 p-0">
                <legend className="visually-hidden">Modalidades tipificadas</legend>
                <div className="grid gap-3">
                  {filteredCategories.map((category) => {
                    const selected = selectedCategoryId === category.id;
                    return (
                      <label
                        key={category.id}
                        className={[
                          "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors",
                          selected
                            ? "border-2 border-primary bg-primary-soft/60"
                            : "border-border bg-bg-surface hover:bg-bg-canvas",
                        ].join(" ")}
                      >
                        <input
                          type="radio"
                          name="offense_category_id"
                          value={category.id}
                          checked={selected}
                          onChange={() => {
                            setSelectedCategoryId(category.id);
                            setStepError(null);
                          }}
                          className="mt-1 h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-text-primary">
                            {category.subtype_name}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-canvas"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  <span>Anterior</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedCategoryId) {
                      setStepError("Elige una modalidad específica del catálogo para continuar.");
                      focusStepError();
                      return;
                    }
                    goToStep(4);
                  }}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover"
                >
                  <span>Siguiente: Fundamento legal</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h1
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary sm:text-2xl"
                >
                  4. Fundamento legal aplicable
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Tu <strong>Documento de Denuncia</strong> incorporará automáticamente la base
                  normativa vigente para el caso seleccionado.
                </p>
              </div>

              {selectedCategory && (
                <div className="rounded-2xl border border-primary/25 bg-primary-soft p-5">
                  <p className="m-0 text-xs font-semibold uppercase tracking-wide text-primary">
                    Tipificación elegida
                  </p>
                  <h2 className="mt-1 mb-0 font-display text-lg font-bold text-text-primary">
                    {selectedCategory.main_type} — {selectedCategory.subtype_name}
                  </h2>
                  <p className="mt-3 mb-0 text-sm leading-relaxed text-text-primary">
                    {selectedCategory.legal_basis}
                  </p>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-bg-canvas p-5">
                <h2 className="m-0 font-display text-base font-semibold text-text-primary">
                  Autoridades competentes receptoras
                </h2>
                <p className="mt-1.5 text-xs text-text-secondary">
                  Podrás descargar el PDF definitivo y presentarlo ante las siguientes instancias en
                  Sucre:
                </p>
                <ul className="m-0 mt-3 list-none space-y-2 p-0">
                  {DESTINATARIO_INSTITUTIONS.map((inst) => (
                    <li key={inst} className="flex items-center gap-2 text-sm text-text-primary">
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" />
                      <span>{inst}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => goToStep(3)}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-canvas"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  <span>Anterior</span>
                </button>
                <button
                  type="button"
                  onClick={() => goToStep(5)}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover"
                >
                  <span>Siguiente: Datos y evidencias</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <form
              method="post"
              noValidate
              aria-labelledby="step5-heading"
              onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
                event.preventDefault();
                void handleContinueToPreview();
              }}
              className="space-y-6"
            >
              <div>
                <h1
                  id="step5-heading"
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary sm:text-2xl"
                >
                  5. Datos del denunciante, hechos y evidencias
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Completa tus datos de respaldo legal, describe el hecho, marca opcionalmente la
                  ubicación en el mapa y adjunta tus pruebas.
                </p>
              </div>

              <fieldset className="space-y-4 rounded-2xl border border-border bg-bg-canvas p-4 sm:p-5">
                <legend className="px-1.5 font-display text-sm font-bold text-text-primary">
                  Identidad del denunciante (Perfilamiento Progresivo)
                </legend>
                <p className="m-0 text-xs text-text-secondary">
                  Obligatorio para emitir el Documento de Denuncia oficial. Estos datos no se
                  muestran en la consulta pública por código.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="wizard-full-name"
                      className="mb-1 block text-sm font-semibold text-text-primary"
                    >
                      Nombre completo <span aria-hidden="true" className="text-sos">*</span>
                    </label>
                    <input
                      ref={fullNameInputRef}
                      id="wizard-full-name"
                      name="full_name"
                      type="text"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        clearStep5FieldError("fullName");
                      }}
                      onBlur={() => {
                        if (fullName.trim().length > 0) {
                          const err = validateSingleStep5Field("fullName", fullName);
                          if (err) {
                            setStep5FieldErrors((prev) => ({ ...prev, fullName: err }));
                          }
                        }
                      }}
                      autoComplete="name"
                      required
                      maxLength={150}
                      aria-invalid={step5FieldErrors.fullName ? "true" : undefined}
                      aria-describedby={step5FieldErrors.fullName ? "wizard-full-name-error" : undefined}
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-base text-text-primary"
                    />
                    {step5FieldErrors.fullName && (
                      <p id="wizard-full-name-error" className="mt-1 mb-0 text-xs font-medium text-sos-text">
                        {step5FieldErrors.fullName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="wizard-ci"
                      className="mb-1 block text-sm font-semibold text-text-primary"
                    >
                      Cédula de Identidad (C.I.) <span aria-hidden="true" className="text-sos">*</span>
                    </label>
                    <input
                      ref={ciInputRef}
                      id="wizard-ci"
                      name="ci_number"
                      type="text"
                      value={ciNumber}
                      onChange={(e) => {
                        setCiNumber(e.target.value);
                        clearStep5FieldError("ciNumber");
                      }}
                      onBlur={() => {
                        if (ciNumber.trim().length > 0) {
                          const err = validateSingleStep5Field("ciNumber", ciNumber);
                          if (err) {
                            setStep5FieldErrors((prev) => ({ ...prev, ciNumber: err }));
                          }
                        }
                      }}
                      required
                      maxLength={30}
                      spellCheck={false}
                      autoCapitalize="characters"
                      placeholder="Ej. 7482910 CH"
                      aria-invalid={step5FieldErrors.ciNumber ? "true" : undefined}
                      aria-describedby={step5FieldErrors.ciNumber ? "wizard-ci-error" : undefined}
                      className="tabular-nums w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-base text-text-primary"
                    />
                    {step5FieldErrors.ciNumber && (
                      <p id="wizard-ci-error" className="mt-1 mb-0 text-xs font-medium text-sos-text">
                        {step5FieldErrors.ciNumber}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="wizard-phone"
                      className="mb-1 block text-sm font-semibold text-text-primary"
                    >
                      Teléfono / Celular <span aria-hidden="true" className="text-sos">*</span>
                    </label>
                    <input
                      ref={phoneInputRef}
                      id="wizard-phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        clearStep5FieldError("phone");
                      }}
                      onBlur={() => {
                        if (phone.trim().length > 0) {
                          const err = validateSingleStep5Field("phone", phone);
                          if (err) {
                            setStep5FieldErrors((prev) => ({ ...prev, phone: err }));
                          }
                        }
                      }}
                      required
                      maxLength={30}
                      placeholder="Ej. +591 71234567"
                      aria-invalid={step5FieldErrors.phone ? "true" : undefined}
                      aria-describedby={step5FieldErrors.phone ? "wizard-phone-error" : undefined}
                      className="tabular-nums w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-base text-text-primary"
                    />
                    {step5FieldErrors.phone && (
                      <p id="wizard-phone-error" className="mt-1 mb-0 text-xs font-medium text-sos-text">
                        {step5FieldErrors.phone}
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      htmlFor="wizard-domicile"
                      className="mb-1 block text-sm font-semibold text-text-primary"
                    >
                      Domicilio real del denunciante{" "}
                      <span aria-hidden="true" className="text-sos">*</span>
                    </label>
                    <input
                      ref={domicileInputRef}
                      id="wizard-domicile"
                      name="address"
                      type="text"
                      autoComplete="street-address"
                      value={domicileAddress}
                      onChange={(e) => {
                        setDomicileAddress(e.target.value);
                        clearStep5FieldError("domicileAddress");
                      }}
                      onBlur={() => {
                        if (domicileAddress.trim().length > 0) {
                          const err = validateSingleStep5Field("domicileAddress", domicileAddress);
                          if (err) {
                            setStep5FieldErrors((prev) => ({ ...prev, domicileAddress: err }));
                          }
                        }
                      }}
                      required
                      maxLength={255}
                      placeholder="Ej. Av. Hernando Siles N.º 410, Sucre"
                      aria-invalid={step5FieldErrors.domicileAddress ? "true" : undefined}
                      aria-describedby={
                        step5FieldErrors.domicileAddress ? "wizard-domicile-error" : undefined
                      }
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-base text-text-primary"
                    />
                    {step5FieldErrors.domicileAddress && (
                      <p id="wizard-domicile-error" className="mt-1 mb-0 text-xs font-medium text-sos-text">
                        {step5FieldErrors.domicileAddress}
                      </p>
                    )}
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-4 rounded-2xl border border-border bg-bg-surface p-4 sm:p-5">
                <legend className="px-1.5 font-display text-sm font-bold text-text-primary">
                  Circunstancias del hecho
                </legend>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="wizard-incident-date"
                      className="mb-1 block text-sm font-semibold text-text-primary"
                    >
                      Fecha y hora del hecho <span aria-hidden="true" className="text-sos">*</span>
                    </label>
                    <input
                      ref={incidentDateInputRef}
                      id="wizard-incident-date"
                      name="incident_date"
                      type="datetime-local"
                      value={incidentDateLocal}
                      max={getCurrentLocalDateTimeInputValue()}
                      onChange={(e) => {
                        setIncidentDateLocal(e.target.value);
                        clearStep5FieldError("incidentDateLocal");
                      }}
                      onBlur={() => {
                        if (incidentDateLocal) {
                          const err = validateSingleStep5Field("incidentDateLocal", incidentDateLocal);
                          if (err) {
                            setStep5FieldErrors((prev) => ({ ...prev, incidentDateLocal: err }));
                          }
                        }
                      }}
                      required
                      aria-invalid={step5FieldErrors.incidentDateLocal ? "true" : undefined}
                      aria-describedby={
                        step5FieldErrors.incidentDateLocal ? "wizard-incident-date-error" : undefined
                      }
                      className="tabular-nums w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-base text-text-primary"
                    />
                    {step5FieldErrors.incidentDateLocal && (
                      <p
                        id="wizard-incident-date-error"
                        className="mt-1 mb-0 text-xs font-medium text-sos-text"
                      >
                        {step5FieldErrors.incidentDateLocal}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="wizard-incident-address"
                      className="mb-1 block text-sm font-semibold text-text-primary"
                    >
                      Dirección o referencia del hecho{" "}
                      <span aria-hidden="true" className="text-sos">*</span>
                    </label>
                    <input
                      ref={incidentAddressInputRef}
                      id="wizard-incident-address"
                      name="incident_address"
                      type="text"
                      value={incidentAddress}
                      onChange={(e) => {
                        setIncidentAddress(e.target.value);
                        clearStep5FieldError("incidentAddress");
                      }}
                      onBlur={() => {
                        if (incidentAddress.trim().length > 0) {
                          const err = validateSingleStep5Field("incidentAddress", incidentAddress);
                          if (err) {
                            setStep5FieldErrors((prev) => ({ ...prev, incidentAddress: err }));
                          }
                        }
                      }}
                      required
                      maxLength={255}
                      placeholder="Ej. Calle Loa N.º 450, Zona Central, Sucre"
                      aria-invalid={step5FieldErrors.incidentAddress ? "true" : undefined}
                      aria-describedby={
                        step5FieldErrors.incidentAddress ? "wizard-incident-address-error" : undefined
                      }
                      className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-base text-text-primary"
                    />
                    {step5FieldErrors.incidentAddress && (
                      <p
                        id="wizard-incident-address-error"
                        className="mt-1 mb-0 text-xs font-medium text-sos-text"
                      >
                        {step5FieldErrors.incidentAddress}
                      </p>
                    )}
                  </div>
                </div>

                <IncidentLocationPicker
                  latitude={latitude}
                  longitude={longitude}
                  disabled={savingDraft}
                  onChange={({ latitude: nextLat, longitude: nextLng }) => {
                    setLatitude(nextLat);
                    setLongitude(nextLng);
                  }}
                />

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label
                      htmlFor="wizard-description"
                      className="block text-sm font-semibold text-text-primary"
                    >
                      Relato circunstanciado de los hechos{" "}
                      <span aria-hidden="true" className="text-sos">*</span>
                    </label>
                    <span className="tabular-nums text-xs text-text-secondary">
                      {description.trim().length} / 5000
                    </span>
                  </div>
                  <p id="wizard-description-hint" className="mt-0 mb-1.5 text-xs text-text-secondary">
                    Describe qué ocurrió, cuántos animales están afectados, estado aparente y si hay
                    personas responsables identificables.
                  </p>
                  <textarea
                    ref={descriptionInputRef}
                    id="wizard-description"
                    name="description"
                    rows={5}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      clearStep5FieldError("description");
                    }}
                    onBlur={() => {
                      if (description.trim().length > 0) {
                        const err = validateSingleStep5Field("description", description);
                        if (err) {
                          setStep5FieldErrors((prev) => ({ ...prev, description: err }));
                        }
                      }
                    }}
                    minLength={10}
                    maxLength={5000}
                    required
                    aria-invalid={step5FieldErrors.description ? "true" : undefined}
                    aria-describedby={
                      step5FieldErrors.description
                        ? "wizard-description-hint wizard-description-error"
                        : "wizard-description-hint"
                    }
                    placeholder="Describe detalladamente los hechos observados..."
                    className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-2.5 text-base leading-relaxed text-text-primary"
                  />
                  {step5FieldErrors.description && (
                    <p
                      id="wizard-description-error"
                      className="mt-1 mb-0 text-xs font-medium text-sos-text"
                    >
                      {step5FieldErrors.description}
                    </p>
                  )}
                </div>
              </fieldset>

              <section className="space-y-4 rounded-2xl border border-border bg-bg-canvas p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="m-0 font-display text-sm font-bold text-text-primary">
                      Evidencias adjuntas (opcional, recomendado)
                    </h2>
                    <p className="mt-0.5 mb-0 text-xs text-text-secondary">
                      Formatos permitidos: JPG, PNG, WEBP, MP4 o PDF (máximo 25 MB por archivo).
                    </p>
                  </div>

                  <div>
                    <input
                      id="wizard-evidence-upload"
                      type="file"
                      multiple
                      disabled={savingDraft}
                      accept=".jpg,.jpeg,.png,.webp,.mp4,.pdf,image/jpeg,image/png,image/webp,video/mp4,application/pdf"
                      onChange={handleEvidenceFileSelection}
                      className="peer sr-only"
                    />
                    <label
                      htmlFor="wizard-evidence-upload"
                      className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-primary/30 bg-bg-surface px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
                    >
                      <Upload aria-hidden="true" className="h-4 w-4" />
                      <span>Adjuntar archivos</span>
                    </label>
                  </div>
                </div>

                {uploadQueue.length > 0 && (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {uploadQueue.map((item) => (
                      <li
                        key={item.localId}
                        className="rounded-xl border border-border bg-bg-surface p-3"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate-single-line font-semibold text-text-primary">
                            {item.fileName}
                          </span>
                          <span className="tabular-nums shrink-0 text-text-secondary">
                            {item.status === "uploading" ? `${item.progress}%` : "Error"}
                          </span>
                        </div>
                        {item.status === "uploading" ? (
                          <progress
                            value={item.progress}
                            max={100}
                            aria-label={`Progreso de subida de ${item.fileName}`}
                            className="mt-2 h-2 w-full accent-primary"
                          />
                        ) : (
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <p className="m-0 text-xs font-medium text-sos-text">
                              {item.errorMessage}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                setUploadQueue((prev) =>
                                  prev.filter((queued) => queued.localId !== item.localId),
                                )
                              }
                              className="cursor-pointer text-xs font-semibold text-text-secondary underline hover:text-text-primary"
                            >
                              Quitar aviso
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {evidences.length > 0 ? (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {evidences.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-surface px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="m-0 flex items-center gap-2 text-xs font-semibold text-text-primary">
                            <span className="rounded bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">
                              {ev.evidence_type}
                            </span>
                            <span className="truncate-single-line">{ev.object_key}</span>
                          </p>
                          <p className="tabular-nums mt-0.5 mb-0 text-[11px] text-text-secondary">
                            {ev.mime_type} · {formatFileSize(ev.file_size_bytes)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={removingEvidenceId === ev.id}
                          onClick={() => handleRemoveEvidence(ev.id)}
                          aria-label={`Eliminar evidencia ${ev.object_key}`}
                          className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-sos-text hover:bg-sos-soft disabled:opacity-60"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                          <span>Quitar</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-xs text-text-secondary">
                    Aún no hay archivos adjuntos. Si tienes fotos, videos o informes, súbelos aquí.
                  </p>
                )}
              </section>

              {stepStatusMessage && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-start gap-2.5 rounded-2xl border border-secondary/30 bg-secondary-soft p-4 text-sm font-medium text-secondary-text"
                >
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{stepStatusMessage}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  disabled={savingDraft || isUploadingAny}
                  onClick={() => goToStep(4)}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  <span>Anterior</span>
                </button>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={savingDraft || isUploadingAny}
                    onClick={handleSaveDraftClick}
                    className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Save aria-hidden="true" className="h-4 w-4" />
                    <span>{savingDraft ? "Guardando..." : "Guardar borrador"}</span>
                  </button>

                  <button
                    type="submit"
                    disabled={savingDraft || isUploadingAny}
                    className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>
                      {isUploadingAny
                        ? "Esperando subida..."
                        : savingDraft
                          ? "Guardando..."
                          : "Siguiente: Previsualizar documento"}
                    </span>
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </form>
          )}

          {step === 6 && (
            <div className="space-y-6">
              <div>
                <h1
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="m-0 font-display text-xl font-bold text-text-primary sm:text-2xl"
                >
                  6. Previsualización del Documento de Denuncia
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Revisa el contenido completo antes de confirmar el envío definitivo. Mientras no
                  confirmes, tu caso sigue en estado <strong>BORRADOR</strong> y puedes volver a
                  editarlo.
                </p>
              </div>

              {loadingPreview ? (
                <div className="rounded-2xl border border-border bg-bg-canvas p-8 text-center">
                  <p className="m-0 text-sm font-medium text-text-secondary">
                    Generando vista previa oficial del Documento de Denuncia...
                  </p>
                </div>
              ) : previewData ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                    <span className="font-semibold text-text-primary">{previewData.title}</span>
                    <button
                      type="button"
                      onClick={handleReloadPreview}
                      className="cursor-pointer font-semibold text-primary underline"
                    >
                      Actualizar vista previa
                    </button>
                  </div>
                  <iframe
                    sandbox=""
                    srcDoc={previewData.html_preview}
                    title="Vista previa del Documento de Denuncia"
                    className="h-[520px] w-full rounded-2xl border border-border bg-white shadow-xs"
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-bg-canvas p-6 text-center">
                  <button
                    type="button"
                    onClick={handleReloadPreview}
                    className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    Cargar vista previa
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => goToStep(5)}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-canvas"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  <span>Volver a editar datos</span>
                </button>

                <button
                  type="button"
                  disabled={!draftComplaint || loadingPreview}
                  onClick={openSubmitDialog}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-sos px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Lock aria-hidden="true" className="h-4 w-4" />
                  <span>Confirmar y enviar denuncia definitiva</span>
                </button>
              </div>
            </div>
          )}

          {step === 7 && submittedComplaint && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-secondary/30 bg-secondary-soft p-6">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-white">
                    <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
                  </span>
                  <div>
                    <h1
                      ref={stepHeadingRef}
                      tabIndex={-1}
                      className="m-0 font-display text-xl font-bold text-text-primary sm:text-2xl"
                    >
                      7. Denuncia enviada y bloqueada jurídicamente
                    </h1>
                    <p className="mt-1.5 mb-0 text-sm text-text-primary">
                      Tu <strong>Documento de Denuncia</strong> en PDF ha sido generado, congelado
                      como inmutable y registrado con éxito.
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary/30 bg-bg-surface p-4">
                  <div>
                    <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      Código correlativo de seguimiento
                    </p>
                    <p className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-primary">
                      {submittedComplaint.tracking_code}
                    </p>
                  </div>
                  {submittedComplaint.tracking_code && (
                    <button
                      type="button"
                      onClick={() => handleCopyTrackingCode(submittedComplaint.tracking_code ?? "")}
                      className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-bg-canvas px-4 py-2 text-xs font-semibold text-text-primary hover:bg-primary-soft hover:text-primary"
                    >
                      <Copy aria-hidden="true" className="h-4 w-4" />
                      <span>{copiedCode ? "Código copiado" : "Copiar código"}</span>
                    </button>
                  )}
                </div>
                <p role="status" aria-live="polite" className="visually-hidden">
                  {copiedCode ? "Código de seguimiento copiado al portapapeles." : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={downloadingPdf}
                  onClick={() => handleDownloadPdf(submittedComplaint.id)}
                  className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                  <span>
                    {downloadingPdf
                      ? "Generando enlace seguro..."
                      : "Descargar Documento de Denuncia (PDF)"}
                  </span>
                </button>

                {submittedComplaint.tracking_code && (
                  <a
                    href={`/seguimiento?code=${encodeURIComponent(submittedComplaint.tracking_code)}`}
                    className="inline-flex min-h-[48px] items-center rounded-xl border border-border bg-bg-surface px-4 py-3 text-sm font-semibold text-text-primary no-underline hover:bg-bg-canvas"
                  >
                    Ver seguimiento público
                  </a>
                )}

                <a
                  href="/mis-denuncias"
                  className="inline-flex min-h-[48px] items-center rounded-xl border border-border bg-bg-surface px-4 py-3 text-sm font-semibold text-text-primary no-underline hover:bg-bg-canvas"
                >
                  Ir a Mis Denuncias
                </a>

                <button
                  type="button"
                  onClick={handleStartNewComplaint}
                  className="inline-flex min-h-[48px] cursor-pointer items-center rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/15"
                >
                  Iniciar otra denuncia
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
          <div className="rounded-3xl border border-primary/20 bg-primary-soft p-5">
            <div className="flex items-center gap-2 text-primary">
              <Scale aria-hidden="true" className="h-5 w-5" />
              <h2 className="m-0 font-display text-base font-bold text-text-primary">
                Sustento Legal Detectado
              </h2>
            </div>

            {selectedCategory ? (
              <div className="mt-3 space-y-2.5 text-sm">
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
              <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-text-primary">
                <p className="m-0 font-semibold text-primary">
                  {OFFENSE_MAIN_TYPE_META[selectedMainType].article}
                </p>
                <p className="m-0 text-text-secondary">
                  Selecciona la modalidad específica en el Paso 3 para completar la tipificación.
                </p>
              </div>
            ) : (
              <p className="mt-3 mb-0 text-xs leading-relaxed text-text-secondary">
                Conforme avances por los pasos 2 y 3, aquí se vincularán los artículos de la Ley N.º
                700/2015, el Código Penal (Arts. 350 bis y 350 ter) y la Ley Municipal N.º 252/2022.
              </p>
            )}
          </div>

          <div className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <FileText aria-hidden="true" className="h-4 w-4 text-primary" />
                <h2 className="m-0 font-display text-sm font-bold text-text-primary">
                  Vista Previa en Vivo · Documento de Denuncia
                </h2>
              </div>
              <span className="rounded-full bg-bg-canvas px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
                {submittedComplaint ? "INMUTABLE" : "BORRADOR"}
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
                <dt className="font-semibold text-text-secondary">Fecha y lugar del hecho</dt>
                <dd className="tabular-nums m-0 mt-0.5 text-text-primary">
                  {formatLocalDateTimeInputDisplay(incidentDateLocal)}
                  {" · "}
                  {incidentAddress.trim() || "Dirección por completar"}
                </dd>
                {latitude !== null && longitude !== null && (
                  <dd className="tabular-nums m-0 mt-0.5 text-[11px] text-secondary-text">
                    GPS: {latitude.toFixed(6)}, {longitude.toFixed(6)}
                  </dd>
                )}
              </div>

              <div>
                <dt className="font-semibold text-text-secondary">Relato</dt>
                <dd className="m-0 mt-0.5 line-clamp-4 whitespace-pre-wrap text-text-primary">
                  {description.trim() || "El relato aparecerá aquí conforme lo redactes en el Paso 5."}
                </dd>
              </div>

              <div>
                <dt className="font-semibold text-text-secondary">Evidencias registradas</dt>
                <dd className="tabular-nums m-0 mt-0.5 text-text-primary">
                  {evidences.length} archivo(s) adjunto(s)
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
              ¿Confirmar envío definitivo de la denuncia?
            </h2>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-text-secondary">
              Al confirmar, la denuncia pasará a estado <strong>ENVIADA</strong>, se generará el{" "}
              <strong>Documento de Denuncia</strong> en PDF con código correlativo único y el caso
              quedará <strong>inmutable</strong> (ya no podrá modificarse ni eliminarse).
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            type="button"
            autoFocus
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
            <span>{submittingFinal ? "Enviando denuncia..." : "Sí, enviar denuncia definitiva"}</span>
          </button>
        </div>
      </dialog>
    </div>
  );
}
