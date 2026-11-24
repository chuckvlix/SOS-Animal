# SOS Animal — Plataforma LegalTech de Protección Animal (Sucre, Bolivia)

Monorepo de **SOS Animal**, plataforma ciudadana mantenida por la Universidad para la orientación jurídica, generación de denuncias de maltrato y biocidio en PDF (con Anexo Fotográfico), catálogo y mapa interactivo de Centros de Atención (veterinarias e instituciones donde denunciar) y difusión estática de salud preventiva, normativa y educación ciudadana en el municipio de Sucre.

---

## Documentación de Referencia

Antes de implementar funcionalidades o abrir un Pull Request, revisa:

* [`AGENTS.md`](./AGENTS.md): Reglas obligatorias de arquitectura, seguridad, tipado, ramas y flujo de trabajo.
* [`docs/PROJECT_BRIEF.md`](./docs/PROJECT_BRIEF.md): Alcance funcional, modelo de datos (4 tablas) y reglas de negocio.
* [`docs/DESIGN_GUIDE.md`](./docs/DESIGN_GUIDE.md): Sistema de diseño, *design tokens*, tipografía y lineamientos UX/UI.

---

## Estructura del Monorepo

```text
SOS-Animal/
├── apps/
│   ├── api/                 # Backend REST en FastAPI (Python 3.12+ / uv)
│   │   ├── app/
│   │   │   ├── core/        # Config, DB (SQLModel), JWT/Argon2, RBAC (ciudadano/admin) y Presigned URLs
│   │   │   ├── modules/     # Dominios en BD: auth, complaints
│   │   │   └── templates/   # Plantilla HTML/CSS del Documento de Denuncia + Anexo Fotográfico (WeasyPrint)
│   │   ├── migrations/      # Migraciones de esquema con Alembic
│   │   └── tests/           # Suite pytest
│   └── web/                 # Frontend en Astro 7 + React Islands + Tailwind v4 (pnpm)
│       ├── public/
│       │   └── docs/        # PDFs estáticos descargables: normativa/ y folletos/ (escolares, colegiales, general)
│       └── src/
│           ├── layouts/     # MainLayout (Portal Ciudadano) y PanelLayout (Sidebar izquierdo Admin)
│           ├── pages/       # /, /mapa, /campanas, /derechos, /login, /registro, /denunciar, /mis-denuncias, /panel/*
│           ├── islands/     # Islas interactivas de React (Wizard 4 pasos, Mapa Leaflet, Panel Admin)
│           ├── services/    # Cliente HTTP hacia la API y subida de fotografías a MinIO
│           └── types/       # Contratos TypeScript alineados con los modelos del backend
├── packages/                # Reservado para tipos o constantes compartidas
├── docs/                    # Documentación de producto y diseño
├── docker-compose.yml       # PostgreSQL 16, Storage S3 (pgsty/silo), inicialización de buckets, API y Web
└── .env.example             # Plantilla base de variables de entorno
```

---

## Requisitos Previos y Gestores Permitidos

Para mantener entornos reproducibles en todo el equipo, respeta estrictamente estas herramientas:

| Componente | Requisito | Gestor obligatorio | Prohibido |
| :--- | :--- | :--- | :--- |
| **Backend (`apps/api`)** | Python `3.12+` | `uv` | `pip`, `poetry`, venvs manuales |
| **Frontend (`apps/web`)** | Node.js `26 LTS` (mínimo `>= 22.23.4`) | `pnpm` (`11.17.0`) | `npm`, `yarn`, `bun` |
| **Infraestructura** | Docker + Docker Compose | `docker compose` | — |

> **Nota sobre WeasyPrint en local:** Al ejecutar el backend con Docker, las librerías nativas (`libpango`, `harfbuzz`, `gdk-pixbuf`, fuentes) ya vienen instaladas. Si ejecutas generación de PDF directamente en macOS o Linux fuera de Docker, necesitarás instalar dichas librerías del sistema para que `weasyprint` pueda cargar `libgobject-2.0`.

---

## Cómo Ejecutar el Proyecto en Local

### 1. Configurar variables de entorno

Copia la plantilla base en la raíz del repositorio:

```bash
cp .env.example .env
```

### Opción A: Stack completo con Docker Compose

Ideal para levantar todo el entorno (PostgreSQL 16, Storage S3, creación automática de buckets `sos-evidences` y `sos-documents`, FastAPI con migraciones Alembic y Astro):

```bash
docker compose up --build
```

Servicios disponibles:

* **Frontend Web:** `http://localhost:4321`
* **API Docs (Swagger):** `http://localhost:8000/docs`
* **API Health / Readiness:** `http://localhost:8000/api/v1/health` y `http://localhost:8000/api/v1/ready`
* **Storage S3 API / Consola Web:** `http://localhost:9000` / `http://localhost:9001`
* **PostgreSQL 16:** `localhost:5432`

### Opción B: Desarrollo local rápido (BD y Storage en Docker + API/Web con recarga en vivo)

Recomendado durante el desarrollo diario para tener *hot-reload* inmediato en FastAPI y Astro (asegúrate de detener `api` y `web` en Docker primero para no duplicar los puertos `8000` y `4321`):

1. **Levantar únicamente base de datos y almacenamiento:**

   ```bash
   docker compose up -d db storage storage-init
   docker compose stop api web
   ```

2. **Ejecutar el backend (`apps/api`):**

   ```bash
   cd apps/api
   uv sync
   uv run alembic upgrade head
   uv run fastapi dev app/main.py
   ```

3. **Ejecutar el frontend (`apps/web`):** desde la raíz del repositorio, en otra terminal:

   ```bash
   pnpm install
   pnpm dev:web
   ```

---

## Comandos de Verificación (antes de abrir un Pull Request)

Ejecuta siempre estas comprobaciones antes de subir cambios a tu rama:

```bash
# Backend (desde apps/api/)
cd apps/api
uv run ruff check .
uv run pytest -v

# Frontend (desde la raíz del repositorio)
pnpm check:web
pnpm build:web
```

---

## Módulos del Equipo y División de Trabajo

Cada módulo de negocio en el backend vive aislado en `apps/api/app/modules/<modulo>/` con 4 archivos obligatorios: `models.py`, `schemas.py`, `service.py` y `router.py`.

| Integrante | Rol | Módulos / Carpetas asignadas | Ramas de trabajo | Responsabilidades principales |
| :--- | :--- | :--- | :--- | :--- |
| **Integrante 1 (Tech Lead)** | Backend & LegalTech | `core/`, `templates/`, `modules/auth/`, `modules/complaints/` | `feat/api-core-and-complaints`<br>`feat/web-legal-catalog` | Autenticación JWT + Argon2, roles (`ciudadano`, `admin`), perfilamiento progresivo (`ci_number`, `phone`, `address`), Presigned URLs para 1–3 fotografías, catálogo penal/municipal, emisión inmutable (`BORRADOR` → `ENVIADA`) y PDF **Documento de Denuncia** con **Anexo Fotográfico** en la última hoja. |
| **Integrante 2** | Fullstack Dev | `/mapa`, `apps/web/src/data/centers.ts` | `feat/web-map-and-vets` | Catálogo tipado estático verificado de Centros de Atención (5 centros de atención veterinaria/CEMZOO y 2 instituciones públicas receptoras de denuncias), cálculo de distancia geolocalizada en kilómetros e isla interactiva Leaflet (`CentersMapIsland`). |
| **Integrante 3** | Frontend & UI Dev | `/campanas`, `/derechos`, `public/docs/` | `feat/web-static-campaigns-norms-education` | Páginas estáticas en Astro: calendario de vacunación recomendado, importancia de controles de salud y fechas aproximadas de campañas municipales gratuitas (`/campanas`) y derechos de los animales con normativa, tenencia responsable y descargas educativas (`/derechos`). |
| **Integrante 4** | Frontend & UI Dev | `/login`, `/registro`, `/denunciar`, `/mis-denuncias`, `/panel/denuncias`, `/panel/usuarios` | `feat/auth-complaints-panel`<br>`feat/web-complaint-wizard-4steps` | Flujos de registro/login, asistente interactivo de denuncia en **4 pasos** (`ComplaintWizardIsland`) con mini-mapa Leaflet y carga de 1–3 fotos, historial ciudadano (`/mis-denuncias`) y Panel Universitario con sidebar izquierdo (`/panel/denuncias` como registro histórico/estadístico y `/panel/usuarios`). |

---

## Flujo de Git y Convenciones

1. **Ramas protegidas:** Prohibido hacer *commits* directos a `main` o `develop`.
2. **Punto de partida:** Crea siempre tu rama desde `develop` actualizada (`git checkout develop && git pull origin develop`).
3. **Contrato Primero (*Spec-Driven*):** Define y documenta los esquemas Pydantic (`schemas.py`) y rutas (`router.py`) en `apps/api` antes de construir vistas o islas React que consuman la API en `apps/web`.
4. **Conventional Commits:** Usa mensajes en formato `<tipo>(<alcance>): <descripción breve en imperativo>` (ej. `feat(web): build attention centers map with static catalog`).
5. **Pull Requests:** Todo cambio se integra mediante PR hacia **`develop`** con revisión cruzada del equipo (y aprobación del Tech Lead en archivos bajo `.github/CODEOWNERS`).
