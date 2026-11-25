# AGENTS.md — Protocolo de Ingeniería y Colaboración IA (SOS Animal)

Este archivo define las reglas obligatorias de arquitectura, seguridad, tipado y flujo de trabajo para todos los agentes de codificación que operen en el monorepo **SOS Animal**. Antes de escribir o modificar código, consulta la documentación de referencia según tu tarea:

* `docs/PROJECT_BRIEF.md`: Definiciones funcionales, institucionales, modelo de datos (4 tablas) y alcance por fases.
* `docs/DESIGN_GUIDE.md`: Sistema de diseño UX/UI, *design tokens* de color, tipografía y especificaciones de componentes (consultar antes de tocar `apps/web` o `apps/mobile`).

---

## 1. Metodología de Trabajo para Agentes (Spec-Driven & Socrático)

1. **Contrato Primero (Spec-Driven Development):**
   * Nunca implementes una vista o isla de React que consuma la API sin que exista previamente su contrato de datos (`schemas.py` y ruta documentada en `router.py`) en `apps/api`.
   * Las vistas informativas estáticas (`/salud-y-vacunas`, `/normativa`) se alimentan de datos tipados locales en `apps/web/src/data/` y archivos PDF estáticos en `apps/web/public/docs/`.
   * Antes de codificar un nuevo endpoint, presenta brevemente los esquemas Pydantic de entrada (`Request`) y salida (`Response`) junto con los códigos de estado HTTP esperados.
2. **Aclaración Socrática ante Ambigüedades:**
   * Si una instrucción del desarrollador presenta ambigüedades de negocio, validación jurídica o flujo de interfaz, formula **1 o 2 preguntas concretas** antes de generar bloques extensos de código.
3. **Pruebas Automatizadas (TDD / Verificación):**
   * Toda lógica crítica de negocio en `apps/api` (generación y bloqueo de inmutabilidad de denuncias, límite de 1 a 3 fotografías, validación de roles RBAC y generación de URLs pre-firmadas) debe incluir pruebas unitarias o de integración en `apps/api/tests/` ejecutables con `pytest`.

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
Cada dominio funcional con persistencia en base de datos vive aislado dentro de `apps/api/app/modules/<dominio>/` para evitar conflictos de fusión (*merge conflicts*) entre los integrantes del equipo:

```text
apps/api/app/
├── core/
│   ├── config.py          # Variables de entorno con pydantic-settings
│   ├── database.py        # Engine y sesión de PostgreSQL (SQLModel)
│   ├── security.py        # Creación/verificación de JWT y hashing con pwdlib (Argon2)
│   ├── dependencies.py    # get_current_user y require_role(["admin"])
│   └── storage.py         # Cliente boto3/MinIO y generador de Presigned URLs
├── modules/
│   ├── auth/              # Registro ligero, login OAuth2, perfilamiento progresivo y gestión de usuarios
│   └── complaints/        # Catálogo penal/municipal, borrador/emisión inmutable, anexo fotográfico y PDF
└── templates/
    └── complaint_pdf.html # Plantilla HTML/CSS (con Anexo Fotográfico) renderizada por WeasyPrint
```

Cada carpeta de módulo debe contener exactamente:
* `models.py`: Tablas SQLModel (`table=True`).
* `schemas.py`: Esquemas Pydantic v2 (`Create`, `Update`, `Read`) sin lógica de persistencia.
* `service.py`: Lógica de negocio, validaciones de estado e interacción con base de datos/MinIO.
* `router.py`: Endpoints `APIRouter` delgados que delegan la lógica a `service.py`.

### 3.2. Reglas de Seguridad y Dominio Inquebrantables
* **Tipado Estricto:** Todas las funciones, métodos y endpoints en Python deben declarar *type hints* completos en parámetros y valores de retorno.
* **Control de Roles (RBAC):**
  * La plataforma es administrada únicamente por la Universidad.
  * Roles válidos: `ciudadano`, `admin` (superadministrador). No existen roles para instituciones externas.
  * Todo endpoint administrativo (listado/estadísticas institucionales de `complaints` y gestión de usuarios en `auth`) debe protegerse mediante `Depends(require_role(["admin"]))`.
* **Terminología Jurídica:** El documento generado en PDF debe titularse y tratarse siempre como **"Documento de Denuncia"** (nunca como *"Memorial"*, dado que los memoriales requieren firma de abogado).
* **Ciclo e Inmutabilidad de Denuncias (Sin Seguimiento de Estados):**
  * Estados válidos de una denuncia: `BORRADOR` y `ENVIADA` (emitida con PDF definitivo). No existe flujo de seguimiento ni transición de estados posteriores en plataforma.
  * Mientras `complaint.status == "BORRADOR"` y `complaint.is_immutable is False`, el ciudadano propietario puede actualizar datos y adjuntar o quitar entre **1 y 3 fotografías**.
  * Al confirmar la emisión (`POST /complaints/{id}/submit`), el servicio debe verificar que el perfil del usuario tenga completos `full_name`, `ci_number`, `phone` y `address`, asignar el código correlativo único (`SOS-XXXXXX-2026`), renderizar el PDF definitivo en MinIO (incrustando las fotografías en la última página como **Anexo Fotográfico**) y establecer `status = "ENVIADA"` e `is_immutable = True`.
  * Cualquier intento posterior de modificar o eliminar una denuncia con `is_immutable == True` debe rechazar la petición con `HTTP 409 Conflict`.
* **Subida Segura de Fotografías (Presigned URLs):**
  * Nunca recibir binarios (`UploadFile`) pesados directamente en FastAPI.
  * El endpoint `POST /storage/presigned-upload` debe validar el token JWT, verificar el tipo MIME contra la lista blanca exclusiva de imágenes (`image/jpeg`, `image/png`, `image/webp`), validar el tamaño máximo permitido y generar un `object_key` basado en `uuid4()` con expiración de **180 segundos**. No se admiten videos (`video/mp4`).
  * Cada denuncia acepta un máximo de **3 fotografías** para su Anexo Fotográfico en PDF.

---

## 4. Arquitectura y Reglas del Frontend (`apps/web`)

### 4.1. Filosofía Astro + React Islands
* **Páginas Públicas en Astro (`src/pages/`):**
  * `/`: Portada informativa con acceso directo SOS, ruta digital de 4 pasos, servicios ciudadanos, marco jurídico y espacio proyectado para destacar campañas institucionales de la UPDS (y opcionalmente el bloque "Sobre nosotros" si el responsable decide integrarlo al final de la landing).
  * `/centros-de-atencion`: Página **Centros de Atención** alimentada desde datos tipados verificados (`src/data/centers.ts`), dividida en 2 secciones (*CEMZOO y Centros de Atención Veterinaria* e *Instituciones Públicas donde Denunciar*) con mapa interactivo Leaflet (`CentersMapIsland`).
  * `/salud-y-vacunas`: Página **estática** con calendario de vacunación recomendado para mascotas, importancia de controles de salud y fechas aproximadas de campañas gratuitas municipales de vacunación antirrábica y esterilización.
  * `/normativa`: Página **estática** (`Normativa`) que unifica los derechos reconocidos, el marco jurídico, las obligaciones de tenencia responsable y la descarga de fichas educativas y normativa oficial desde `public/docs/derechos/`.
  * **Lineamientos abiertos para siguientes iteraciones (libertad creativa por módulo):**
    * **Módulo de Identidad e Institucionalidad UPDS:** Agrupa la incorporación del logotipo de la **UPDS** en un lugar visible del header o footer, junto con el espacio institucional ("Sobre nosotros" / iniciativa de la UPDS + nombres o contactos del equipo desarrollador), quedando **a criterio del responsable** si conviene crear una pestaña/página dedicada o agregarlo como sección al final de la landing principal.
    * Incorporar en la landing una sección de **campañas impulsadas por la UPDS** (carrusel, galería u otro formato visual) respaldada por un **CRUD de campañas** en el Panel Universitario (`/panel/*`) para usuarios `admin`.
    * Evolucionar el módulo de denuncias para incluir tarjetas informativas por cada subcategoría de delito y ajustar el formato del **Documento de Denuncia** tras un análisis normativo más profundo.
    * Aplicar mejoras estéticas, de contenido y coherencia UX/UI transversal en todas las páginas.
* **Layouts Diferenciados por Rol:**
  * **Portal Ciudadano (`MainLayout.astro`):** Barra de navegación superior en escritorio (con los mismos íconos que la barra móvil) y barra inferior en móvil (sin sidebar lateral). Incluye botón explícito **`Cerrar sesión`** cuando hay sesión activa.
  * **Panel Universitario (`PanelLayout.astro`):** Acceso exclusivo para el rol `admin` (los usuarios `ciudadano` tienen prohibido el acceso y son redirigidos a `/`). Implementa un **sidebar fijo a la izquierda** en escritorio y un *drawer* lateral en `<dialog>` para móvil, con vistas `/panel/denuncias` (registro histórico y estadístico), `/panel/usuarios` (gestión de usuarios) y futuro módulo de gestión de campañas UPDS.
* **Islas de React (`src/islands/`):**
  * Usar `client:only="react"` para componentes dependientes del navegador como el mapa de Leaflet (`CentersMapIsland`), el asistente interactivo de **4 pasos** (`ComplaintWizardIsland`) y las vistas protegidas del panel (`AdminComplaintsTrayIsland`, `AdminUsersIsland`).
  * Usar `client:load` para componentes interactivos ligeros.
* **TypeScript Estricto:** Está prohibido el uso de `any` o `@ts-ignore`. Define interfaces explícitas en `src/types/` espejando los esquemas Pydantic del backend.
* **Estilos:** Utilizar clases utilitarias de **TailwindCSS** y los *design tokens* definidos en `docs/DESIGN_GUIDE.md` (`#5B21B6`, `#E11D48`, `#0D9488`, tipografías `Plus Jakarta Sans` e `Inter`).

---

## 5. Flujo de Git y Colaboración del Equipo

* **Ramas Protegidas:** Prohibido hacer *commits* directos a `main` o `develop`.
* **Ramas de Trabajo por Módulo:**
  * Setup inicial: `feat/initial-setup`
  * Integrante 1: `feat/api-core-and-complaints` | `feat/web-legal-catalog`
  * Integrante 2: `feat/web-map-and-vets` (Centros de Atención en `/centros-de-atencion`)
  * Integrante 3: `feat/web-static-campaigns-norms-education`
  * Integrante 4: `feat/auth-complaints-panel` | `feat/web-complaint-wizard-4steps`
* **Convención de Commits (Conventional Commits):**
  * Formato: `<tipo>(<alcance>): <descripción breve en imperativo>`
  * Ejemplos válidos: `feat(complaints): embed photo annex in generated complaint pdf`, `feat(web): build attention centers map with static catalog`, `feat(web): build static campaigns, norms, and education pages`.
* **Higiene del Repositorio:** Nunca incluir archivos `.env`, credenciales de MinIO/PostgreSQL, archivos `.pdf` de prueba generados por tests ni carpetas `__pycache__` o `node_modules` en el control de versiones.
