# SOS Animal — Plataforma LegalTech de Protección Animal (Sucre, Bolivia)

Monorepo de **SOS Animal**, plataforma ciudadana de orientación jurídica, denuncia de maltrato y biocidio, trazabilidad de casos, directorio geoespacial de Zoonosis/veterinarias y difusión de campañas preventivas en el municipio de Sucre.

---

## Documentación de Referencia

Antes de implementar funcionalidades o abrir un Pull Request, revisa:

* [`AGENTS.md`](./AGENTS.md): Reglas obligatorias de arquitectura, seguridad, tipado, ramas y flujo de trabajo.
* [`docs/PROJECT_BRIEF.md`](./docs/PROJECT_BRIEF.md): Alcance funcional, modelo de datos (7 tablas) y reglas de negocio.
* [`docs/DESIGN_GUIDE.md`](./docs/DESIGN_GUIDE.md): Sistema de diseño, *design tokens*, tipografía y lineamientos UX/UI.

---

## Estructura del Monorepo

```text
SOS-Animal/
├── apps/
│   ├── api/                 # Backend REST en FastAPI (Python 3.12+ / uv)
│   │   ├── app/
│   │   │   ├── core/        # Config, DB (SQLModel), JWT/Argon2, RBAC y MinIO Presigned URLs
│   │   │   ├── modules/     # Dominios aislados: auth, complaints, directory, campaigns, norms
│   │   │   └── templates/   # Plantilla HTML/CSS del Documento de Denuncia (WeasyPrint)
│   │   ├── migrations/      # Migraciones de esquema con Alembic
│   │   └── tests/           # Suite pytest
│   └── web/                 # Frontend en Astro + React Islands + Tailwind v4 (pnpm)
│       └── src/
│           ├── layouts/     # Shell responsivo (sidebar escritorio + barra inferior móvil)
│           ├── pages/       # Rutas Astro públicas y protegidas
│           ├── islands/     # Islas interactivas de React
│           ├── services/    # Cliente HTTP hacia la API
│           └── types/       # Contratos TypeScript alineados con los modelos del backend
├── packages/                # Reservado para tipos o constantes compartidas
├── docs/                    # Documentación de producto y diseño
├── docker-compose.yml       # PostgreSQL 16, MinIO, inicialización de buckets, API y Web
└── .env.example             # Plantilla base de variables de entorno
```

---

## Requisitos Previos y Gestores Permitidos

Para mantener entornos reproducibles en todo el equipo, respeta estrictamente estas herramientas:

| Componente | Requisito | Gestor obligatorio | Prohibido |
| :--- | :--- | :--- | :--- |
| **Backend (`apps/api`)** | Python `3.12+` | `uv` | `pip`, `poetry`, venvs manuales |
| **Frontend (`apps/web`)** | Node.js `22+` | `pnpm` (`11.17.0`) | `npm`, `yarn`, `bun` |
| **Infraestructura** | Docker + Docker Compose | `docker compose` | — |

> **Nota sobre WeasyPrint en local:** Al ejecutar el backend con Docker, las librerías nativas (`libpango`, `harfbuzz`, `gdk-pixbuf`, fuentes) ya vienen instaladas. Si ejecutas generación de PDF directamente en macOS o Linux fuera de Docker, necesitarás instalar dichas librerías del sistema para que `weasyprint` pueda cargar `libgobject-2.0`.

---

## Cómo Ejecutar el Proyecto en Local

### 1. Configurar variables de entorno

Copia la plantilla base en la raíz del repositorio:

```bash
cp .env.example .env
```

> Si vas a correr el backend fuera de Docker y quieres personalizar variables locales, copia o enlaza también el archivo dentro de `apps/api/.env` (ya que `pydantic-settings` busca `.env` en el directorio de trabajo desde donde se lanza FastAPI). Para desarrollo local con los valores por defecto de `.env.example`, no hace falta cambiar nada adicional.

### Opción A: Stack completo con Docker Compose

Ideal para levantar todo el entorno (PostgreSQL 16, MinIO, creación automática de buckets `sos-evidences` y `sos-documents`, FastAPI con migraciones Alembic y Astro):

```bash
docker compose up --build
```

Servicios disponibles:

* **Frontend Web:** `http://localhost:4321`
* **API Docs (Swagger):** `http://localhost:8000/docs`
* **API Health / Readiness:** `http://localhost:8000/api/v1/health` y `http://localhost:8000/api/v1/ready`
* **MinIO API / Consola Web:** `http://localhost:9000` / `http://localhost:9001` (usuario/clave por defecto en `.env.example`)
* **PostgreSQL 16:** `localhost:5432`

### Opción B: Desarrollo local rápido (BD y MinIO en Docker + API/Web con recarga en vivo)

Recomendado durante el desarrollo diario para tener *hot-reload* inmediato en FastAPI y Astro:

1. **Levantar únicamente base de datos y almacenamiento:**

   ```bash
   docker compose up -d db storage storage-init
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

Cada módulo de negocio vive aislado en `apps/api/app/modules/<modulo>/` con 4 archivos obligatorios: `models.py`, `schemas.py`, `service.py` y `router.py`.

| Integrante | Rol | Módulos / Carpetas asignadas | Ramas de trabajo | Responsabilidades principales |
| :--- | :--- | :--- | :--- | :--- |
| **Integrante 1 (Tech Lead)** | Backend & LegalTech | `core/`, `templates/`, `modules/auth/`, `modules/complaints/` | `feat/api-core-and-complaints`<br>`feat/web-legal-catalog` | Autenticación JWT + Argon2, perfilamiento progresivo (`ci_number`, `phone`, `address`), Presigned URLs hacia MinIO, catálogo penal/municipal (Art. 350 bis y 350 ter C.P.), bloqueo de inmutabilidad (`BORRADOR` → `ENVIADA`), código `SOS-XXXXXX-2026` y PDF **Documento de Denuncia**. |
| **Integrante 2** | Fullstack Dev | `modules/directory/`, `/mapa`, `/panel/veterinarias` | `feat/api-geo-directory`<br>`feat/web-map-and-vets` | CRUD de `attention_centers` (CEMZOO y clínicas veterinarias), filtrado por urgencias 24h, cálculo de distancia en kilómetros e isla interactiva Leaflet (`VetMapIsland`). |
| **Integrante 3** | Fullstack Dev | `modules/campaigns/`, `modules/norms/`, `/campanas`, `/normativa`, `/educacion`, `/panel/campanas`, `/panel/normativa` | `feat/api-campaigns-norms`<br>`feat/web-campaigns-education` | CRUD de `campaigns` y `legal_norms` (con PDFs oficiales almacenados en MinIO), calendario de vacunación/esterilización, biblioteca normativa descargable y guías educativas. |
| **Integrante 4** | Frontend & UI Dev | Consumo de `auth`/`complaints`, `/denunciar`, `/seguimiento`, `/panel/denuncias` | `feat/api-tracking-public`<br>`feat/web-complaint-wizard` | Flujos de registro/login, asistente de denuncia en 7 pasos (`ComplaintWizardIsland`) con subida directa a URLs pre-firmadas, consulta pública por código `SOS-XXXXXX-2026` y bandeja de gestión CEMZOO. |

---

## Flujo de Git y Convenciones

1. **Ramas protegidas:** Prohibido hacer *commits* directos a `main` o `develop`.
2. **Punto de partida:** Crea siempre tu rama desde `develop` actualizada (`git checkout develop && git pull origin develop`).
3. **Contrato Primero (*Spec-Driven*):** Define y documenta los esquemas Pydantic (`schemas.py`) y rutas (`router.py`) en `apps/api` antes de construir vistas o islas React en `apps/web`.
4. **Conventional Commits:** Usa mensajes en formato `<tipo>(<alcance>): <descripción breve en imperativo>` (ej. `feat(directory): add geospatial distance filter for attention centers`).
5. **Pull Requests:** Todo cambio se integra mediante PR hacia **`develop`** con revisión cruzada del equipo (y aprobación del Tech Lead en archivos bajo `.github/CODEOWNERS`).
