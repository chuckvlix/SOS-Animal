# AGENTS.md — Protocolo de Ingeniería y Colaboración IA (SOS Animal)

Este archivo define las reglas obligatorias de arquitectura, seguridad, tipado y flujo de trabajo para todos los agentes de codificación que operen en el monorepo **SOS Animal**. Antes de escribir o modificar código, consulta la documentación de referencia según tu tarea:

* `docs/PROJECT_BRIEF.md`: Definiciones funcionales, institucionales, modelo de datos y alcance por fases.
* `docs/DESIGN_GUIDE.md`: Sistema de diseño UX/UI, *design tokens* de color, tipografía y especificaciones de componentes (consultar antes de tocar `apps/web` o `apps/mobile`).

---

## 1. Metodología de Trabajo para Agentes (Spec-Driven & Socrático)

1. **Contrato Primero (Spec-Driven Development):**
   * Nunca implementes una vista o isla de React sin que exista previamente su contrato de datos (`schemas.py` y ruta documentada en `router.py`) en `apps/api`.
   * Antes de codificar un nuevo endpoint, presenta brevemente los esquemas Pydantic de entrada (`Request`) y salida (`Response`) junto con los códigos de estado HTTP esperados.
2. **Aclaración Socrática ante Ambigüedades:**
   * Si una instrucción del desarrollador presenta ambigüedades de negocio, validación jurídica o flujo de interfaz, formula **1 o 2 preguntas concretas** antes de generar bloques extensos de código.
3. **Pruebas Automatizadas (TDD / Verificación):**
   * Toda lógica crítica de negocio en `apps/api` (transición de estado de denuncias, bloqueo de inmutabilidad, validación de roles RBAC y generación de URLs pre-firmadas) debe incluir pruebas unitarias o de integración en `apps/api/tests/` ejecutables con `pytest`.

---

## 2. Gestores de Paquetes y Comandos Permitidos

El incumplimiento de estas herramientas rompe la reproducibilidad de los entornos del equipo:

* **Backend (`apps/api` — Python 3.12+):**
  * Usar exclusivamente **`uv`** (`uv add`, `uv sync`, `uv run pytest`, `uv run alembic`, `uv run fastapi dev`).
  * **Prohibido:** `pip install`, `poetry`, o crear entornos virtuales manuales fuera de `uv`.
* **Frontend (`apps/web` — Node/TypeScript):**
  * Usar exclusivamente **`pnpm`** (`pnpm install`, `pnpm add`, `pnpm dev`, `pnpm build`).
  * **Prohibido:** `npm`, `yarn` o `bun`.

---

## 3. Arquitectura y Reglas del Backend (`apps/api`)

### 3.1. Estructura Modular por Dominio
Cada dominio funcional vive aislado dentro de `apps/api/app/modules/<dominio>/` para evitar conflictos de fusión (*merge conflicts*) entre los integrantes del equipo:

```text
apps/api/app/
├── core/
│   ├── config.py          # Variables de entorno con pydantic-settings
│   ├── database.py        # Engine y sesión de PostgreSQL (SQLModel)
│   ├── security.py        # Creación/verificación de JWT y hashing con pwdlib (Argon2)
│   ├── dependencies.py    # get_current_user y require_role(["admin", "gestor_cemzoo"])
│   └── storage.py         # Cliente boto3/MinIO y generador de Presigned URLs
├── modules/
│   ├── auth/              # Registro ligero, login OAuth2 y perfilamiento progresivo
│   ├── complaints/        # Catálogo penal/municipal, borrador/envío, PDF y seguimiento
│   ├── directory/         # Zoonosis y veterinarias (CRUD + cálculo de distancia)
│   ├── campaigns/         # Calendario de vacunación, esterilización y jornadas
│   └── norms/             # Biblioteca normativa con PDFs y material educativo
└── templates/
    └── complaint_pdf.html # Plantilla HTML/CSS renderizada por WeasyPrint
```

Cada carpeta de módulo debe contener exactamente:
* `models.py`: Tablas SQLModel (`table=True`).
* `schemas.py`: Esquemas Pydantic v2 (`Create`, `Update`, `Read`) sin lógica de persistencia.
* `service.py`: Lógica de negocio, validaciones de estado e interacción con base de datos/MinIO.
* `router.py`: Endpoints `APIRouter` delgados que delegan la lógica a `service.py`.

### 3.2. Reglas de Seguridad y Dominio Inquebrantables
* **Tipado Estricto:** Todas las funciones, métodos y endpoints en Python deben declarar *type hints* completos en parámetros y valores de retorno.
* **Control de Roles (RBAC):**
  * Roles válidos: `ciudadano`, `gestor_cemzoo`, `admin`.
  * Todo endpoint administrativo (`POST`, `PUT`, `PATCH`, `DELETE`) en `directory`, `campaigns` y `norms` debe protegerse mediante `Depends(require_role(["admin", "gestor_cemzoo"]))` (o solo `["admin"]` para gestión de usuarios y normas oficiales).
* **Terminología Jurídica:** El documento generado en PDF debe titularse y tratarse siempre como **"Documento de Denuncia"** (nunca como *"Memorial"*, dado que los memoriales requieren firma de abogado).
* **Inmutabilidad de Denuncias:**
  * Mientras `complaint.status == "BORRADOR"` y `complaint.is_immutable is False`, el ciudadano propietario puede actualizar datos y evidencias.
  * Al confirmar el envío (`POST /complaints/{id}/submit`), el servicio debe verificar que el perfil del usuario tenga completos `full_name`, `ci_number`, `phone` y `address`, asignar el código correlativo único (`SOS-XXXXXX-2026`), generar el PDF definitivo en MinIO y establecer `status = "ENVIADA"` e `is_immutable = True`.
  * Cualquier intento posterior de modificar o eliminar una denuncia con `is_immutable == True` debe rechazar la petición con `HTTP 409 Conflict`.
* **Subida Segura de Archivos (Presigned URLs):**
  * Nunca recibir binarios (`UploadFile`) pesados directamente en FastAPI.
  * El endpoint `POST /storage/presigned-upload` debe validar el token JWT, verificar el tipo MIME contra lista blanca (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `application/pdf`), validar el tamaño máximo permitido y generar un `object_key` basado en `uuid4()` con expiración de **180 segundos**.

---

## 4. Arquitectura y Reglas del Frontend (`apps/web`)

### 4.1. Filosofía Astro + React Islands
* **Páginas Públicas en Astro (`src/pages/`):** Las rutas informativas (`/`, `/mapa`, `/campanas`, `/normativa`, `/educacion`, `/seguimiento`) deben renderizarse como páginas Astro ligeras, cargando islas de React únicamente donde exista interactividad compleja.
* **Islas de React (`src/islands/`):**
  * Usar `client:only="react"` para componentes dependientes del navegador como el mapa de Leaflet (`VetMapIsland`), el asistente de 7 pasos (`ComplaintWizardIsland`) y las tablas CRUD protegidas (`AdminPanelIsland`).
  * Usar `client:load` para componentes interactivos ligeros como buscadores o filtros.
* **TypeScript Estricto:** Está prohibido el uso de `any` o `@ts-ignore`. Define interfaces explícitas en `src/types/` espejando los esquemas Pydantic del backend.
* **Estilos:** Utilizar clases utilitarias de **TailwindCSS** y los *design tokens* definidos en `docs/DESIGN_GUIDE.md` (`#5B21B6`, `#E11D48`, `#0D9488`, tipografías `Plus Jakarta Sans` e `Inter`). No crear archivos CSS personalizados salvo las variables globales del sistema de diseño, fuentes y estilos base de Leaflet.

---

## 5. Flujo de Git y Colaboración del Equipo

* **Ramas Protegidas:** Prohibido hacer *commits* directos a `main` o `develop`.
* **Ramas de Trabajo por Módulo:**
  * Setup inicial: `feat/initial-setup`
  * Integrante 1: `feat/api-core-and-complaints` | `feat/web-legal-catalog`
  * Integrante 2: `feat/api-geo-directory` | `feat/web-map-and-vets`
  * Integrante 3: `feat/api-campaigns-norms` | `feat/web-campaigns-education`
  * Integrante 4: `feat/api-tracking-public` | `feat/web-complaint-wizard`
* **Convención de Commits (Conventional Commits):**
  * Formato: `<tipo>(<alcance>): <descripción breve en imperativo>`
  * Ejemplos válidos: `feat(complaints): add immutable submit transition and pdf generation`, `fix(auth): validate ci_number before complaint submission`, `test(storage): verify mime whitelist on presigned url`.
* **Higiene del Repositorio:** Nunca incluir archivos `.env`, credenciales de MinIO/PostgreSQL, archivos `.pdf` de prueba ni carpetas `__pycache__` o `node_modules` en el control de versiones.