# Project Brief: SOS Animal (Plataforma LegalTech)

## 1. Contexto y Alcance Institucional
**SOS Animal** es una plataforma digital de orientación jurídica, denuncia, seguimiento de casos y bienestar para la protección de animales en situación de vulnerabilidad (perros y gatos en abandono, maltrato o riesgo en la vía pública) en el municipio de Sucre, Bolivia[cite: 1, 2, 3].

### Estrategia de Despliegue por Fases
* **Fase 1 (Web + API REST):** Despliegue en el servidor de la universidad mediante contenedores Docker de la API central en FastAPI y la aplicación Web unificada en Astro + React Islands.
* **Fase 2 (Mobile Android):** Desarrollo de la aplicación móvil en React Native (Expo) consumiendo la misma API REST.

### Delimitación Operativa e Interinstitucional
* **Gestión Interna en Plataforma (CEMZOO):** El Centro Municipal de Zoonosis (CEMZOO) contará con el rol `gestor_cemzoo` para administrar campañas (en coordinación con SEDES Chuquisaca, el Gobierno Autónomo Municipal de Sucre y la Facultad de Veterinaria de la USFX)[cite: 1], actualizar el directorio veterinario y gestionar el estado de las denuncias de competencia municipal[cite: 2, 3].
* **Intervención Mediante Documento de Denuncia en PDF (Fiscalía y POFOMA):** Dado que el Ministerio Público (Fiscalía) y la Policía Boliviana (POFOMA) operan sistemas internos cerrados, no tendrán usuarios en la plataforma[cite: 2]. Para delitos tipificados en el Código Penal (Art. 350 bis y Art. 350 ter) y la Ley N.° 700/2015, el sistema genera automáticamente un **Documento de Denuncia** formal en formato PDF con sustento legal y pruebas para que el ciudadano lo presente ante dichas instancias, asignando un código de seguimiento (`SOS-XXXXXX-2026`)[cite: 2].

---

## 2. Stack Tecnológico (Monorepo)

* **Backend (`apps/api`):**
  * **Lenguaje y Gestor:** Python 3.12+ gestionado estrictamente con `uv`.
  * **Framework:** FastAPI con validación estricta mediante Pydantic v2.
  * **ORM y Migraciones:** SQLModel (SQLAlchemy 2.0) + Alembic.
  * **Autenticación:** Nativa con `fastapi.security` (`OAuth2PasswordBearer`), tokens JWT y hashing de contraseñas con `pwdlib` (Argon2).
  * **Generación de PDFs:** `WeasyPrint` (renderizado de plantillas HTML/CSS jurídicas a PDF).
* **Frontend Web (`apps/web`):**
  * **Framework y Gestor:** Astro gestionado estrictamente con `pnpm`, configurado con TypeScript estricto y TailwindCSS.
  * **Interactividad (Astro Islands):** Componentes de React 18+ (`@astrojs/react`) hidratados selectivamente (`client:load` o `client:only="react"`).
  * **Mapas:** Leaflet + `react-leaflet` para geolocalización y cálculo de distancias en kilómetros[cite: 3].
* **Base de Datos y Almacenamiento Multimedia:**
  * **Relacional:** PostgreSQL 16.
  * **Objetos (Archivos):** MinIO (compatible con AWS S3) mediante contenedor Docker para almacenar fotos, videos, documentos probatorios, PDFs de denuncias y PDFs de normativas[cite: 2, 3].
* **Infraestructura:** Docker y Docker Compose (`reverse-proxy`, `web`, `api`, `db`, `storage`).

---

## 3. Estructura de Directorios del Monorepo

```text
sos-animal-sucre/
├── AGENTS.md                  # Fuente de verdad de reglas para agentes IA (Antigravity, Codex, etc.)
├── CLAUDE.md                  # Puente de reglas para Claude Code (@AGENTS.md)
├── pnpm-workspace.yaml        # Definición de workspaces del monorepo (apps/*, packages/*)
├── docker-compose.yml         # Orquestación de contenedores (Postgres, MinIO, FastAPI, Astro, Nginx)
├── .env.example               # Plantilla de variables de entorno
├── docs/
│   ├── PROJECT_BRIEF.md       # Contexto general, alcance y arquitectura del proyecto
│   └── DESIGN_GUIDE.md        # Sistema de diseño UX/UI, tokens y especificaciones visuales
├── apps/
│   ├── api/                   # Backend en FastAPI (Python + uv)
│   │   ├── Dockerfile
│   │   ├── pyproject.toml
│   │   ├── migrations/        # Versionado de esquemas con Alembic
│   │   └── app/
│   │       ├── core/          # Config, JWT, RBAC, conexión DB y cliente MinIO (Presigned URLs)
│   │       ├── modules/
│   │       │   ├── auth/      # Login, registro ligero y perfilamiento progresivo
│   │       │   ├── complaints/# Árbol de tipificación, borrador/envío, PDF y seguimiento
│   │       │   ├── directory/ # CRUD y consultas geoespaciales de Zoonosis y veterinarias
│   │       │   ├── campaigns/ # CRUD de vacunación, esterilización y jornadas
│   │       │   └── norms/     # CRUD de normativa vigente (con PDFs) y educación ciudadana
│   │       └── templates/     # Plantillas HTML/CSS para el Documento de Denuncia en PDF
│   ├── web/                   # Proyecto Web unificado en Astro + React Islands (pnpm)
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │       ├── layouts/       # Layouts públicos y protegidos
│   │       ├── pages/         # /, /mapa, /campanas, /normativa, /educacion, /seguimiento, /denunciar, /panel/*
│   │       ├── islands/       # Componentes React: VetMap, ComplaintWizard, AdminCRUDs, AuthForms
│   │       └── services/      # Cliente API, interceptores JWT y subida a URLs pre-firmadas
│   └── mobile/                # (Fase 2) Aplicación React Native + Expo
└── packages/                  # Constantes o tipos compartidos
```

---

## 4. Modelo de Datos (Esquema en PostgreSQL)

1. **`users` (Usuarios y Perfilamiento Progresivo):**
   * Campos iniciales: `id` (UUID), `full_name`, `email` (Unique), `password_hash`, `role` (`ciudadano`, `gestor_cemzoo`, `admin`), `created_at`.
   * Campos de completitud legal (Nullables al registrarse, obligatorios en el Paso 5 de denuncia): `ci_number` (C.I.), `phone`, `address` (domicilio real)[cite: 2].
2. **`offense_categories` (Catálogo de Tipificación Legal):**
   * `id`, `main_type` (`MALTRATO`, `BIOCIDIO`)[cite: 2].
   * `subtype_name`:
     * 8 modalidades de Maltrato (Art. 350 bis C.P.): *Maltrato físico*, *Maltrato psicológico*, *Maltrato por negligencia*, *Abandono*, *Explotación*, *Maltrato por confinamiento*, *Maltrato sanitario (falta de atención médica)*, *Maltrato sexual*[cite: 2].
     * 5 modalidades de Biocidio (Art. 350 ter C.P.): *Biocidio por ensañamiento*, *Biocidio por motivos fútiles*, *Biocidio múltiple (varios animales)*, *Biocidio como consecuencia de maltrato*, *Biocidio por crueldad*[cite: 2].
   * `legal_basis`: Referencia a CPE (arts. 33 y 405), Ley N.° 700/2015, Código Penal (arts. 350 bis y 350 ter), D.S. N.° 4341/2020 y Ley Municipal N.° 252/2022 de Sucre[cite: 2, 3].
3. **`complaints` (Denuncias y Trazabilidad):**
   * `id` (UUID), `tracking_code` (Unique, formato `SOS-000458-2026`, generado solo al enviar)[cite: 2], `user_id` (FK), `offense_category_id` (FK), `incident_date`[cite: 2], `incident_address`[cite: 2], `latitude`, `longitude`[cite: 3], `description` (relato de los hechos)[cite: 2], `status` (`BORRADOR`, `ENVIADA`, `EN_ATENCION_CEMZOO`, `CERRADA`), `is_immutable` (Boolean), `pdf_url` (Key en MinIO)[cite: 2], `created_at`, `submitted_at`.
4. **`complaint_evidences` (Pruebas Adjuntas):**
   * `id` (UUID), `complaint_id` (FK), `evidence_type` (`FOTO`, `VIDEO`, `DOCUMENTO`)[cite: 2], `object_key` (ruta en MinIO), `mime_type`, `file_size_bytes`, `created_at`.
5. **`attention_centers` (Directorio de Zoonosis y Centros Veterinarios):**
   * `id`, `name` (ej. CEMZOO, Veterinaria San Francisco, Veterinaria SucreVet)[cite: 3], `category` (`ZOONOSIS`, `VETERINARIA`), `address`[cite: 3], `latitude`, `longitude`, `phone`, `opening_hours`, `is_24_hours` (Boolean)[cite: 3], `services` (consultas, emergencias, etc.)[cite: 3], `is_active`.
6. **`campaigns` (Calendario de Vacunación, Esterilización y Atención):**
   * `id`, `title`, `campaign_type` (`CALENDARIO_VACUNACION`, `CAMPANA_ESTERILIZACION`, `ATENCION_EMERGENCIA`, `PROXIMA_JORNADA`)[cite: 3], `description`, `requirements`[cite: 3], `location_address`, `latitude`, `longitude`, `start_date`, `end_date`, `institution`[cite: 1], `created_by` (FK).
7. **`legal_norms` (Biblioteca Normativa y PDFs Descargables):**
   * `id`, `title` (ej. CPE, Ley N.° 700/2015, Código Penal, D.S. N.° 4341/2020, Ley Municipal N.° 252/2022)[cite: 2, 3], `summary_text` (resumen ciudadano de artículos, derechos y sanciones)[cite: 3], `pdf_object_key` (archivo PDF oficial en MinIO para descarga directa), `is_active`, `updated_at`.

---

## 5. Reglas Críticas de Negocio y Seguridad

1. **Vistas Públicas vs. Vistas Protegidas:**
   * **Público (Sin Login):** Landing informativa, Ubicación de Zoonosis y centros veterinarios en mapa interactivo, Información de vacunación/esterilización/atención, Normativa vigente (con descarga de PDFs), Educación/prevención del maltrato animal y consulta de seguimiento por código[cite: 2, 3].
   * **Protegido (Requiere JWT):** Asistente de 7 pasos de denuncia (`ciudadano`)[cite: 2] y Panel de Administración CRUD (`gestor_cemzoo` y `admin`).
2. **Flujo Inmutable de la Denuncia (7 Pasos):**
   * **Pasos 1 al 5:** Selección de "Denunciar maltrato o biocidio" -> Tipo de denuncia -> Modalidad específica -> Visualización automática del fundamento legal -> Formulario de datos del denunciante (completando CI, teléfono y domicilio si no existían en su perfil), datos del hecho y carga de evidencias[cite: 2]. Se guarda en estado `BORRADOR` (`is_immutable = False`).
   * **Paso 6 (Previsualización):** Generación de vista previa del Documento de Denuncia para revisión del usuario[cite: 2].
   * **Paso 7 (Envío definitivo):** Al confirmar el envío, el estado pasa a `ENVIADA`, se activa `is_immutable = True` (prohibiendo cualquier `PUT`/`PATCH` posterior sobre el relato o pruebas), se congela el PDF final en MinIO y se emite el código `SOS-XXXXXX-2026`[cite: 2].
3. **Subida Multimedia mediante Presigned URLs:**
   * Los archivos multimedia nunca transitan por la memoria RAM de FastAPI.
   * El cliente envía metadatos (nombre, MIME type, tamaño en bytes) a FastAPI -> FastAPI valida JWT, lista blanca de formatos (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `application/pdf`) y límite de peso -> FastAPI responde con una URL pre-firmada de MinIO con expiración de 180 segundos y `object_key` basado en UUID.

---

## 6. División de Módulos y Ramas por Integrante

| Integrante | Rol | Módulo Asignado | Rama Backend (`apps/api`) | Rama Frontend (`apps/web`) |
| :--- | :--- | :--- | :--- | :--- |
| **Integrante 1 (Tech Lead)** | Backend & LegalTech | Core, Auth, Motor de Denuncias, Presigned URLs y PDF | `feat/api-core-and-complaints` | `feat/web-legal-catalog` |
| **Integrante 2** | Fullstack Dev | Geolocalización y Directorio Veterinario / Zoonosis | `feat/api-geo-directory` | `feat/web-map-and-vets` |
| **Integrante 3** | Fullstack Dev | Campañas, Normativa en PDF y Educación Ciudadana | `feat/api-campaigns-norms` | `feat/web-campaigns-education` |
| **Integrante 4** | Frontend & UI Dev | Wizard de Denuncia (7 pasos), Auth UI, Seguimiento y Panel | `feat/api-tracking-public` | `feat/web-complaint-wizard` |

### Alcance Detallado por Integrante

* **Setup Inicial (Rama `feat/initial-setup` - Integrante 1):**
  * Configuración del monorepo, `docker-compose.yml`, conexión PostgreSQL + SQLModel + Alembic, cliente MinIO, estructura base de Astro + TailwindCSS y archivo `AGENTS.md`.
* **Integrante 1 (Core, Seguridad y Motor LegalTech):**
  * Autenticación JWT, control de roles (`ciudadano`, `gestor_cemzoo`, `admin`) y actualización progresiva del perfil con CI, teléfono y domicilio[cite: 2].
  * Endpoint generador de *Presigned URLs* hacia MinIO con validación estricta de MIME y tamaño.
  * Endpoints del catálogo de tipificación penal/municipal, creación/edición de denuncias en `BORRADOR`, congelamiento al pasar a `ENVIADA`, generación del código `SOS-XXXXXX-2026` y renderizado del Documento de Denuncia en PDF con `WeasyPrint`[cite: 2].
* **Integrante 2 (Geolocalización y Centros de Atención):**
  * Endpoints CRUD en FastAPI para `attention_centers`[cite: 3].
  * Página pública `/mapa` en Astro con Isla de React en Leaflet, mostrando ubicación de CEMZOO y veterinarias, cálculo de distancia en km desde el usuario (`2,1 km`, `1,8 km`), horarios, filtro de atención 24h y rutas de llegada[cite: 3].
  * Interfaz CRUD en `/panel/veterinarias` con selector de coordenadas en mapa para `admin` y `gestor_cemzoo`.
* **Integrante 3 (Campañas, Biblioteca Normativa y Educación):**
  * Endpoints CRUD en FastAPI para `campaigns` y `legal_norms` (incluyendo asociación de PDFs subidos a MinIO)[cite: 3].
  * Páginas públicas en Astro para `/campanas` (calendario de vacunación, esterilización, atención básica y próximas jornadas)[cite: 3], `/normativa` (consulta de leyes y botón de descarga de PDFs oficiales)[cite: 2, 3] y `/educacion` (tenencia responsable, cuidados básicos, bienestar animal, prevención y videos)[cite: 3].
  * Interfaces CRUD en `/panel/campanas` y `/panel/normativa`.
* **Integrante 4 (Asistente de Denuncia, Auth UI y Bandeja CEMZOO):**
  * Pantallas de Login, Registro ligero y Layout del portal y del `/panel`.
  * Isla de React para la **Ruta Digital de la Denuncia (Wizard de 7 pasos)** en `/denunciar`: selección interactiva de tipo y modalidad, visualización de base legal, formulario con autocompletado de perfil, subida directa de fotos/videos con barra de progreso, previsualización del borrador y pantalla final con descarga del PDF[cite: 2].
  * Página pública `/seguimiento` para consultar el estado mediante el código `SOS-XXXXXX-2026` y tabla de gestión de casos para CEMZOO en `/panel/denuncias`[cite: 2].

---

## 7. Metodología Kanban (Trello) y Flujo Git

* **Regla Spec-Driven (Contrato Primero):** Ninguna tarjeta pasa a *In Progress* en Frontend sin que su esquema Pydantic de entrada/salida esté definido y documentado en Swagger (`/docs`).
* **Listas del Tablero Trello:**
  1. `Contratos API / Specs`
  2. `To Do (Sprint)`
  3. `In Progress` (Máximo 2 tarjetas por desarrollador)
  4. `Code Review (Pull Request)` (Revisión cruzada obligatoria hacia la rama `develop`)
  5. `QA / Testing en Docker`
  6. `Done`