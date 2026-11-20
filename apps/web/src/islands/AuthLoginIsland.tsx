import { Eye, EyeOff, Lock, Scale, ShieldCheck } from "lucide-react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../services/api";
import {
  clearStoredAccessToken,
  fetchCurrentUser,
  isUserAuthenticated,
  loginWithPassword,
  resolvePostAuthDestination,
  sanitizeNextPath,
  setStoredAccessToken,
} from "../services/auth";

export default function AuthLoginIsland() {
  const [rawNext, setRawNext] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextParam = params.get("next");
    setRawNext(nextParam);

    if (!isUserAuthenticated()) {
      setCheckingSession(false);
      return;
    }

    let cancelled = false;
    fetchCurrentUser()
      .then((user) => {
        if (cancelled) {
          return;
        }
        window.location.replace(resolvePostAuthDestination(user.role, nextParam));
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          clearStoredAccessToken();
        }
        setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const validateEmailField = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Ingresa tu correo electrónico.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return "Ingresa un correo electrónico válido (ejemplo: nombre@correo.com).";
    }
    return null;
  };

  const validatePasswordField = (value: string): string | null => {
    if (!value) {
      return "Ingresa tu contraseña.";
    }
    return null;
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const nextEmailError = validateEmailField(email);
    const nextPasswordError = validatePasswordField(password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);

    if (nextEmailError) {
      emailRef.current?.focus();
      return;
    }
    if (nextPasswordError) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const token = await loginWithPassword(email, password);
      setStoredAccessToken(token.access_token);
      if (!isUserAuthenticated()) {
        throw new Error(
          "No se pudo guardar tu sesión local (verifica el reloj del dispositivo o almacenamiento del navegador).",
        );
      }
      const user = await fetchCurrentUser();
      window.location.assign(resolvePostAuthDestination(user.role, rawNext));
    } catch (error) {
      clearStoredAccessToken();
      if (error instanceof ApiError && error.status === 401) {
        setSubmitError("Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.");
      } else if (error instanceof Error && error.message.trim()) {
        setSubmitError(error.message);
      } else {
        setSubmitError("No pudimos iniciar sesión en este momento. Inténtalo nuevamente.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const sanitizedNext = rawNext ? sanitizeNextPath(rawNext, "") : "";
  const registerHref = sanitizedNext
    ? `/registro?next=${encodeURIComponent(sanitizedNext)}`
    : "/registro";
  const redirectedFromWizard =
    sanitizedNext === "/denunciar" || sanitizedNext.startsWith("/denunciar?");
  const redirectedFromProtected = Boolean(sanitizedNext);

  if (checkingSession) {
    return (
      <div className="rounded-3xl border border-border bg-bg-surface p-8 text-center shadow-xs">
        <p className="m-0 text-sm font-medium text-text-secondary">
          Verificando sesión activa...
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
      <section className="min-w-0 rounded-3xl border border-border bg-bg-surface p-6 shadow-xs sm:p-8 lg:col-span-7">
        <div className="mb-6">
          <p className="m-0 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
            <Lock aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Acceso ciudadano e institucional</span>
          </p>
          <h1
            id="login-heading"
            className="mt-3 font-display text-2xl font-bold text-text-primary sm:text-3xl"
          >
            Inicia sesión en SOS Animal
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Ingresa con tu correo y contraseña para continuar tu denuncia, guardar borradores o
            acceder al panel institucional.
          </p>
        </div>

        {redirectedFromProtected && (
          <div
            role="status"
            className="mb-5 rounded-2xl border border-primary/20 bg-primary-soft p-4 text-sm text-text-primary"
          >
            <p className="m-0 font-semibold text-primary">
              {redirectedFromWizard
                ? "Necesitas iniciar sesión para iniciar o retomar una denuncia"
                : "Inicia sesión para acceder a esta sección"}
            </p>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-text-secondary">
              Tus datos personales se resguardan de forma confidencial y respaldan legalmente la
              emisión de tu <strong>Documento de Denuncia</strong> en PDF.
            </p>
          </div>
        )}

        {submitError && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-sos/30 bg-sos-soft p-3.5 text-sm font-medium text-sos-text"
          >
            {submitError}
          </div>
        )}

        <form
          method="post"
          onSubmit={handleSubmit}
          noValidate
          aria-labelledby="login-heading"
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="login-email"
              className="mb-1.5 block text-sm font-semibold text-text-primary"
            >
              Correo electrónico <span aria-hidden="true" className="text-sos">*</span>
            </label>
            <input
              ref={emailRef}
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailError) {
                  setEmailError(null);
                }
              }}
              onBlur={() => {
                if (email.trim().length > 0) {
                  setEmailError(validateEmailField(email));
                }
              }}
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              enterKeyHint="next"
              maxLength={255}
              required
              aria-invalid={emailError ? "true" : undefined}
              aria-describedby={emailError ? "login-email-error" : undefined}
              className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-3 text-base text-text-primary placeholder:text-text-muted focus:border-primary"
              placeholder="nombre@correo.com"
            />
            {emailError && (
              <p id="login-email-error" className="mt-1.5 mb-0 text-xs font-medium text-sos-text">
                {emailError}
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="login-password"
                className="block text-sm font-semibold text-text-primary"
              >
                Contraseña <span aria-hidden="true" className="text-sos">*</span>
              </label>
            </div>
            <div className="relative">
              <input
                ref={passwordRef}
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (passwordError) {
                    setPasswordError(null);
                  }
                }}
                onBlur={() => {
                  if (password.length > 0) {
                    setPasswordError(validatePasswordField(password));
                  }
                }}
                autoComplete="current-password"
                enterKeyHint="done"
                required
                aria-invalid={passwordError ? "true" : undefined}
                aria-describedby={passwordError ? "login-password-error" : undefined}
                className="w-full rounded-xl border border-border bg-bg-surface py-3 pl-3.5 pr-12 text-base text-text-primary placeholder:text-text-muted focus:border-primary"
                placeholder="Ingresa tu contraseña"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-describedby="login-toggle-warning"
                className="absolute inset-y-1.5 right-1.5 inline-flex min-w-[40px] cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-bg-canvas hover:text-text-primary"
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </div>
            <span id="login-toggle-warning" className="visually-hidden">
              Advertencia: al activar esta opción se mostrará tu contraseña en pantalla.
            </span>
            {passwordError && (
              <p
                id="login-password-error"
                className="mt-1.5 mb-0 text-xs font-medium text-sos-text"
              >
                {passwordError}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Ingresando..." : "Iniciar sesión"}
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-5 text-sm text-text-secondary">
          ¿Aún no tienes una cuenta ciudadana?{" "}
          <a
            href={registerHref}
            className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:text-primary-hover"
          >
            Crear cuenta gratuita
          </a>
        </div>
      </section>

      <aside className="min-w-0 space-y-4 lg:col-span-5">
        <div className="rounded-3xl border border-border bg-primary-soft p-6">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-bg-surface text-primary shadow-xs">
            <Scale aria-hidden="true" className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">
            Denuncia ciudadana con respaldo jurídico
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            En pocos pasos podrás tipificar hechos de maltrato animal (Art. 350 bis) o biocidio
            (Art. 350 ter), adjuntar pruebas y generar tu <strong>Documento de Denuncia</strong> en
            PDF para Fiscalía, POFOMA o CEMZOO.
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-bg-surface p-6 shadow-xs">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary-soft text-secondary-text">
              <ShieldCheck aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <h2 className="m-0 font-display text-base font-semibold text-text-primary">
                ¿Necesitas atención veterinaria inmediata?
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                No necesitas iniciar sesión para consultar Zoonosis y clínicas veterinarias cercanas en Sucre.
              </p>
              <a
                href="/mapa"
                className="mt-3 inline-flex min-h-[40px] items-center rounded-lg border border-border bg-bg-canvas px-3.5 py-2 text-xs font-semibold text-text-primary no-underline transition-colors hover:bg-primary-soft hover:text-primary"
              >
                Explorar mapa veterinario
              </a>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
