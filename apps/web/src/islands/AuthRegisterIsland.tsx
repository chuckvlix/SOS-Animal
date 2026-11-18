import { CheckCircle2, Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../services/api";
import {
  clearStoredAccessToken,
  fetchCurrentUser,
  isUserAuthenticated,
  loginWithPassword,
  registerCitizen,
  resolvePostAuthDestination,
  sanitizeNextPath,
  setStoredAccessToken,
} from "../services/auth";

export default function AuthRegisterIsland() {
  const [rawNext, setRawNext] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [registeredPendingLogin, setRegisteredPendingLogin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
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
      .catch(() => {
        if (cancelled) {
          return;
        }
        clearStoredAccessToken();
        setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const validateName = (value: string): string | null => {
    const cleaned = value.trim();
    if (cleaned.length < 2 || cleaned.length > 150) {
      return "Ingresa tu nombre completo (entre 2 y 150 caracteres).";
    }
    if (cleaned.includes("<") || cleaned.includes(">")) {
      return "El nombre no debe contener los caracteres '<' o '>'.";
    }
    return null;
  };

  const validateEmail = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Ingresa tu correo electrónico.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return "Ingresa un correo electrónico válido (ejemplo: nombre@correo.com).";
    }
    return null;
  };

  const validatePassword = (value: string): string | null => {
    if (value.length < 8) {
      return "La contraseña debe tener al menos 8 caracteres.";
    }
    if (value.length > 128) {
      return "La contraseña no debe superar los 128 caracteres.";
    }
    if (!value.trim()) {
      return "La contraseña no puede consistir únicamente en espacios.";
    }
    return null;
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const nextNameError = validateName(fullName);
    const nextEmailError = validateEmail(email);
    const nextPasswordError = validatePassword(password);
    setNameError(nextNameError);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);

    if (nextNameError) {
      nameRef.current?.focus();
      return;
    }
    if (nextEmailError) {
      emailRef.current?.focus();
      return;
    }
    if (nextPasswordError) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    let accountCreated = registeredPendingLogin;
    try {
      if (!accountCreated) {
        await registerCitizen({
          full_name: fullName.trim(),
          email: email.trim(),
          password,
        });
        accountCreated = true;
        setRegisteredPendingLogin(true);
      }
      const token = await loginWithPassword(email, password);
      setStoredAccessToken(token.access_token);
      if (!isUserAuthenticated()) {
        throw new Error(
          "Tu cuenta fue creada, pero no pudimos guardar la sesión local. Intenta iniciar sesión manualmente.",
        );
      }
      window.location.assign(resolvePostAuthDestination("ciudadano", rawNext));
    } catch (error) {
      clearStoredAccessToken();
      if (accountCreated) {
        setSubmitError(
          "Tu cuenta fue creada correctamente, pero falló el inicio de sesión automático. Puedes reintentar o ingresar desde Iniciar sesión.",
        );
      } else if (error instanceof ApiError && error.status === 409) {
        setSubmitError(
          "Ya existe una cuenta registrada con este correo electrónico. Intenta iniciar sesión.",
        );
      } else if (error instanceof Error && error.message.trim()) {
        setSubmitError(error.message);
      } else {
        setSubmitError("No pudimos completar tu registro. Inténtalo nuevamente.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const sanitizedNext = rawNext ? sanitizeNextPath(rawNext, "") : "";
  const loginHref = sanitizedNext
    ? `/login?next=${encodeURIComponent(sanitizedNext)}`
    : "/login";

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
          <p className="m-0 inline-flex items-center gap-1.5 rounded-full bg-secondary-soft px-3 py-1 text-xs font-semibold text-secondary-text">
            <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Registro ciudadano rápido</span>
          </p>
          <h1
            id="register-heading"
            className="mt-3 font-display text-2xl font-bold text-text-primary sm:text-3xl"
          >
            Crea tu cuenta en SOS Animal
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Solo necesitas tu nombre, correo y contraseña para comenzar. Tu C.I., teléfono y
            domicilio únicamente se solicitarán en el Paso 5 al formalizar una denuncia.
          </p>
        </div>

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
          aria-labelledby="register-heading"
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="register-full-name"
              className="mb-1.5 block text-sm font-semibold text-text-primary"
            >
              Nombre completo <span aria-hidden="true" className="text-sos">*</span>
            </label>
            <input
              ref={nameRef}
              id="register-full-name"
              name="full_name"
              type="text"
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                if (nameError) {
                  setNameError(null);
                }
              }}
              onBlur={() => {
                if (fullName.trim().length > 0) {
                  setNameError(validateName(fullName));
                }
              }}
              autoComplete="name"
              minLength={2}
              maxLength={150}
              enterKeyHint="next"
              required
              aria-invalid={nameError ? "true" : undefined}
              aria-describedby={nameError ? "register-name-error" : undefined}
              className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-3 text-base text-text-primary placeholder:text-text-muted focus:border-primary"
              placeholder="Ej. Ana María Pérez Quispe"
            />
            {nameError && (
              <p id="register-name-error" className="mt-1.5 mb-0 text-xs font-medium text-sos-text">
                {nameError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="register-email"
              className="mb-1.5 block text-sm font-semibold text-text-primary"
            >
              Correo electrónico <span aria-hidden="true" className="text-sos">*</span>
            </label>
            <input
              ref={emailRef}
              id="register-email"
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
                  setEmailError(validateEmail(email));
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
              aria-describedby={emailError ? "register-email-error" : undefined}
              className="w-full rounded-xl border border-border bg-bg-surface px-3.5 py-3 text-base text-text-primary placeholder:text-text-muted focus:border-primary"
              placeholder="nombre@correo.com"
            />
            {emailError && (
              <p id="register-email-error" className="mt-1.5 mb-0 text-xs font-medium text-sos-text">
                {emailError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="register-password"
              className="mb-1 block text-sm font-semibold text-text-primary"
            >
              Contraseña <span aria-hidden="true" className="text-sos">*</span>
            </label>
            <p id="register-password-hint" className="mt-0 mb-1.5 text-xs text-text-secondary">
              Mínimo 8 caracteres. Puedes pegar una clave desde tu gestor de contraseñas.
            </p>
            <div className="relative">
              <input
                ref={passwordRef}
                id="register-password"
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
                    setPasswordError(validatePassword(password));
                  }
                }}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                enterKeyHint="done"
                required
                aria-invalid={passwordError ? "true" : undefined}
                aria-describedby={
                  passwordError
                    ? "register-password-hint register-password-error"
                    : "register-password-hint"
                }
                className="w-full rounded-xl border border-border bg-bg-surface py-3 pl-3.5 pr-12 text-base text-text-primary placeholder:text-text-muted focus:border-primary"
                placeholder="Al menos 8 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-describedby="register-toggle-warning"
                className="absolute inset-y-1.5 right-1.5 inline-flex min-w-[40px] cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-bg-canvas hover:text-text-primary"
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </div>
            <span id="register-toggle-warning" className="visually-hidden">
              Advertencia: al activar esta opción se mostrará tu contraseña en pantalla.
            </span>
            {passwordError && (
              <p
                id="register-password-error"
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
            {submitting ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-5 text-sm text-text-secondary">
          ¿Ya tienes una cuenta registrada?{" "}
          <a
            href={loginHref}
            className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:text-primary-hover"
          >
            Iniciar sesión
          </a>
        </div>
      </section>

      <aside className="min-w-0 space-y-4 lg:col-span-5">
        <div className="rounded-3xl border border-border bg-bg-surface p-6 shadow-xs">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary-soft text-secondary-text">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">
            Perfilamiento progresivo para actuar rápido
          </h2>
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0 text-sm text-text-secondary">
            <li className="flex items-start gap-2">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
              <span>Registro inicial ligero con solo 3 datos.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
              <span>
                Tu C.I., teléfono y domicilio real se piden únicamente en el Paso 5 antes de emitir
                el Documento de Denuncia.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
              <span>Puedes guardar borradores y descargar tus PDFs cuando los necesites.</span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
