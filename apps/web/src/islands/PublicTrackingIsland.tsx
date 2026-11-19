import { CheckCircle2, Clock, FileCheck2, Scale, Search, ShieldCheck } from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import { ApiError } from "../services/api";
import {
  COMPLAINT_STATUS_META,
  OFFENSE_MAIN_TYPE_META,
  formatDateTimeDisplay,
} from "../services/complaintLabels";
import { fetchPublicTracking } from "../services/complaints";
import type { ComplaintPublicTrackingRead, ComplaintStatus } from "../types";

const TRACKING_CODE_REGEX = /^SOS-[0-9]{6}-[0-9]{4}$/;

const TIMELINE_STEPS: readonly {
  status: ComplaintStatus;
  title: string;
  description: string;
}[] = [
  {
    status: "ENVIADA",
    title: "1. Denuncia registrada",
    description: "Documento de Denuncia emitido e inmutable con código correlativo oficial.",
  },
  {
    status: "EN_ATENCION_CEMZOO",
    title: "2. En atención CEMZOO",
    description: "Personal institucional revisa los antecedentes y coordina la atención.",
  },
  {
    status: "CERRADA",
    title: "3. Caso cerrado",
    description: "El expediente concluyó su gestión operativa en plataforma.",
  },
];

function getStepOrder(status: ComplaintStatus): number {
  if (status === "ENVIADA") return 1;
  if (status === "EN_ATENCION_CEMZOO") return 2;
  if (status === "CERRADA") return 3;
  return 0;
}

export default function PublicTrackingIsland() {
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ComplaintPublicTrackingRead | null>(null);

  const performLookup = async (rawCode: string, updateUrl: boolean) => {
    const normalized = rawCode.trim().toUpperCase();
    setCodeInput(normalized);
    setErrorMessage(null);

    if (!TRACKING_CODE_REGEX.test(normalized)) {
      setResult(null);
      setErrorMessage(
        "El código debe seguir el formato SOS-000001-2026 (SOS, 6 dígitos, guion y 4 dígitos del año).",
      );
      return;
    }

    if (updateUrl) {
      const nextUrl = `/seguimiento?code=${encodeURIComponent(normalized)}`;
      window.history.replaceState(null, "", nextUrl);
    }

    setLoading(true);
    try {
      const data = await fetchPublicTracking(normalized);
      setResult(data);
    } catch (err) {
      setResult(null);
      if (err instanceof ApiError && err.status === 404) {
        setErrorMessage(
          `No encontramos ninguna denuncia enviada con el código ${normalized}. Verifica que esté bien escrito.`,
        );
      } else if (err instanceof Error && err.message) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("No pudimos consultar el seguimiento en este momento.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get("code")?.trim();
    if (codeParam) {
      void performLookup(codeParam, false);
    }
  }, []);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void performLookup(codeInput, true);
  };

  const activeOrder = result ? getStepOrder(result.status) : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-bg-surface p-5 shadow-xs sm:p-8">
        <p className="m-0 inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
          <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>Consulta pública sin inicio de sesión</span>
        </p>
        <h1 className="mt-2.5 font-display text-2xl font-bold text-text-primary sm:mt-3 sm:text-3xl">
          Seguimiento de Denuncia por Código SOS
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary sm:mt-2">
          Ingresa el código correlativo asignado al finalizar tu denuncia (por ejemplo{" "}
          <span className="tabular-nums font-semibold text-text-primary">SOS-000001-2026</span>)
          para consultar el estado de atención institucional.
        </p>

        <search>
          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-4 flex flex-col gap-3 sm:mt-5 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1">
              <label
                htmlFor="tracking-code-input"
                className="mb-1.5 block text-sm font-semibold text-text-primary"
              >
                Código de seguimiento
              </label>
              <input
                id="tracking-code-input"
                name="code"
                type="search"
                value={codeInput}
                onChange={(e) => {
                  setCodeInput(e.target.value.toUpperCase());
                  if (errorMessage) {
                    setErrorMessage(null);
                  }
                }}
                placeholder="Ej. SOS-000001-2026"
                spellCheck={false}
                autoCapitalize="characters"
                autoCorrect="off"
                enterKeyHint="search"
                required
                aria-invalid={errorMessage ? "true" : undefined}
                aria-describedby={errorMessage ? "tracking-code-error" : undefined}
                className="tabular-nums w-full rounded-xl border border-border bg-bg-surface px-4 py-3 text-base font-medium uppercase text-text-primary placeholder:normal-case placeholder:text-text-muted focus:border-primary"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-[48px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Search aria-hidden="true" className="h-4 w-4" />
              <span>{loading ? "Consultando..." : "Consultar estado"}</span>
            </button>
          </form>
        </search>

        {errorMessage && (
          <div
            id="tracking-code-error"
            role="alert"
            className="mt-5 rounded-2xl border border-sos/30 bg-sos-soft p-4 text-sm font-medium text-sos-text"
          >
            {errorMessage}
          </div>
        )}
      </section>

      {result && (
        <section className="space-y-6 rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Expediente verificado
              </p>
              <h2 className="tabular-nums mt-1 mb-0 font-display text-2xl font-bold text-primary">
                {result.tracking_code}
              </h2>
            </div>

            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-semibold ${
                COMPLAINT_STATUS_META[result.status].badgeClass
              }`}
            >
              <FileCheck2 aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{COMPLAINT_STATUS_META[result.status].label}</span>
            </span>
          </div>

          <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-3">
            {TIMELINE_STEPS.map((stage, index) => {
              const stageOrder = index + 1;
              const completed = activeOrder >= stageOrder;
              const isCurrent = activeOrder === stageOrder;
              return (
                <li
                  key={stage.status}
                  className={[
                    "rounded-2xl border p-4",
                    isCurrent
                      ? "border-primary bg-primary-soft/60"
                      : completed
                        ? "border-secondary/30 bg-secondary-soft/60"
                        : "border-border bg-bg-canvas opacity-75",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    {completed ? (
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" />
                    ) : (
                      <Clock aria-hidden="true" className="h-4 w-4 shrink-0 text-text-secondary" />
                    )}
                    <h3 className="m-0 font-display text-sm font-bold text-text-primary">
                      {stage.title}
                    </h3>
                  </div>
                  <p className="mt-1.5 mb-0 text-xs leading-relaxed text-text-secondary">
                    {stage.description}
                  </p>
                </li>
              );
            })}
          </ol>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-bg-canvas p-4">
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <Scale aria-hidden="true" className="h-4 w-4" />
                <span>Tipificación registrada</span>
              </p>
              <p className="mt-2 mb-1 text-sm font-bold text-text-primary">
                {OFFENSE_MAIN_TYPE_META[result.main_type].label} — {result.subtype_name}
              </p>
              <p className="m-0 text-xs leading-relaxed text-text-secondary">
                {result.legal_basis}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-bg-canvas p-4">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Fechas registradas
              </p>
              <dl className="m-0 mt-2 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-text-secondary">Fecha del hecho:</dt>
                  <dd className="tabular-nums m-0 font-semibold text-text-primary">
                    {formatDateTimeDisplay(result.incident_date)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-text-secondary">Fecha de envío:</dt>
                  <dd className="tabular-nums m-0 font-semibold text-text-primary">
                    {formatDateTimeDisplay(result.submitted_at)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-2xl border border-secondary/25 bg-secondary-soft/60 p-4 text-xs text-text-primary">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
            <p className="m-0 leading-relaxed">
              <strong>Protección de privacidad:</strong> Esta consulta pública omite datos
              personales del denunciante, dirección exacta y archivos probatorios. Si eres la
              persona denunciante, puedes descargar tu PDF desde{" "}
              <a href="/mis-denuncias" className="font-semibold text-primary underline">
                Mis Denuncias
              </a>
              .
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
