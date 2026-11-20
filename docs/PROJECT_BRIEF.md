# Project Brief: SOS Animal (Plataforma LegalTech)

## 1. Contexto y Alcance Institucional
**SOS Animal** es una plataforma digital de orientación jurídica, generación de denuncias en PDF, directorio veterinario geolocalizado y educación preventiva para la protección de animales en situación de vulnerabilidad (perros y gatos en abandono, maltrato o riesgo en la vía pública) en el municipio de Sucre, Bolivia.

### Estrategia de Despliegue por Fases
* **Fase 1 (Web + API REST):** Despliegue en el servidor de la Universidad mediante contenedores Docker de la API central en FastAPI y la aplicación Web unificada en Astro + React Islands.
* **Fase 2 (Mobile Android):** Desarrollo de la aplicación móvil en React Native (Expo) consumiendo la misma API REST.

### Delimitación Operativa e Institucional
* **Administración Exclusiva por la Universidad (`admin`):** La plataforma web es mantenida y administrada únicamente por la Universidad. El Centro Municipal de Zoonosis (CEMZOO), SEDES Chuquisaca, el Gobierno Autónomo Municipal de Sucre, la Facultad de Veterinaria de la USFX, el Ministerio Público (Fiscalía) y la Policía Boliviana (POFOMA) colaboran proporcionando información de referencia o reciben las denuncias físicas, pero **no poseen usuarios ni operan dentro del sistema**.
* **Emisión de Documento de Denuncia en PDF con Anexo Fotográfico:** Para hechos tipificados en el Código Penal (Art. 350 bis y Art. 350 ter), la Ley N.° 700/2015 y la Ley Municipal N.° 252/2022, el sistema guía al ciudadano en **4 pasos interactivos** y genera automáticamente un **Documento de Denuncia** formal en formato PDF con sustento legal, código correlativo (`SOS-XXXXXX-2026`) y un **Anexo Fotográfico** (de 1 a 3 imágenes incrustadas en la última página del PDF), listo para imprimir y presentar ante Fiscalía, POFOMA o CEMZOO. No existe seguimiento de estados posteriores dentro de la plataforma.

---

## 2. Stack Tecnológico (Monorepo)

* **Backend (`apps/api`):**
  * **Lenguaje y Gestor:** Python 3.12+ gestionado estrictamente con `uv`.
  * **Framework:** FastAPI con validación estricta mediante Pydantic v2.
  * **ORM y Migraciones:** SQLModel (SQLAlchemy 2.0) + Alembic.
  * **Autenticación:** Nativa con `fastapi.security` (`OAuth2PasswordBearer`), tokens JWT y hashing de contraseñas con `pwdlib` (Argon2). Roles: `ciudadano` y `admin`.
  * **Generación de PDFs:** `WeasyPrint` (renderizado de plantillas HTML/CSS jurídicas a PDF incluyendo Anexo Fotográfico).
* **Frontend Web (`apps/web`):**
  * **Framework y Gestor:** Astro gestionado estrictamente con `pnpm`, configurado con TypeScript estricto y TailwindCSS.
  * **Interactividad (Astro Islands):** Componentes de React 18/19 (`@astrojs/react`) hidratados selectivamente (`client:load` o `client:only="react"`).
  * **Mapas:** Leaflet + `react-leaflet` para ubicación de incidentes, geolocalización de veterinarias y cálculo de distancias en kilómetros.
* **Base de Datos y Almacenamiento:**
  * **Relacional:** PostgreSQL 16 (esquema depurado de **5 tablas**).
  * **Objetos (Archivos de Denuncias):** Almacenamiento compatible con AWS S3 (`pgsty/silo` / MinIO en Docker) para almacenar las fotografías de evidencia (`sos-evidences`, máx. 3 fotos por denuncia) y los PDFs emitidos de denuncias (`sos-documents`).
  * **Documentos Estáticos Públicos:** Los PDFs oficiales de leyes y los folletos educativos se sirven estáticamente desde `apps/web/public/docs/`.
* **Infraestructura:** Docker y Docker Compose (`web`, `api`, `db`, `storage`, `storage-init`).

---

## 3. Estructura de Directorios del Monorepo

```text
sos-animal-sucre/
├── AGENTS.md                  # Fuente de verdad de reglas para agentes IA (Antigravity, Codex, etc.)
├── CLAUDE.md                  # Puente de reglas para Claude Code (@AGENTS.md)
├── pnpm-workspace.yaml        # Definición de workspaces del monorepo (apps/*, packages/*)
├── docker-compose.yml         # Orquestación de contenedores (Postgres, Storage S3, FastAPI, Astro)
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
│   │       ├── core/          # Config, JWT, RBAC (ciudadano/admin), conexión DB y cliente S3/MinIO
│   │       ├── modules/
│   │       │   ├── auth/      # Login, registro ligero, perfilamiento progresivo y gestión de usuarios
│   │       │   ├── complaints/# Catálogo legal, borrador/emisión inmutable, anexo fotográfico y PDF
│   │       │   └── directory/ # CRUD y consultas geoespaciales de Zoonosis y clínicas veterinarias
│   │       └── templates/     # Plantilla HTML/CSS para el Documento de Denuncia en PDF + Anexo Fotográfico
│   ├── web/                   # Proyecto Web unificado en Astro + React Islands (pnpm)
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── public/
│   │   │   └── docs/          # PDFs estáticos: leyes (normativa/) y folletos por público (folletos/)
│   │   └── src/
│   │       ├── layouts/       # MainLayout (Portal Ciudadano) y PanelLayout (Sidebar izquierdo Admin)
│   │       ├── pages/         # /, /mapa, /campanas, /normativa, /educacion, /login, /registro, /denunciar, /mis-denuncias, /panel/*
│   │       ├── islands/       # Componentes React: VetMap, ComplaintWizard (4 pasos), AdminPanel, AuthForms
│   │       └── services/      # Cliente API, interceptores JWT y subida de fotografías a URLs pre-firmadas
│   └── mobile/                # (Fase 2) Aplicación React Native + Expo
└── packages/                  # Constantes o tipos compartidos
```

---

## 4. Modelo de Datos (Esquema de 5 Tablas en PostgreSQL)

1. **`users` (Usuarios y Perfilamiento Progresivo):**
   * Campos iniciales: `id` (UUID), `full_name`, `email` (Unique), `password_hash`, `role` (`ciudadano`, `admin`), `is_active`, `created_at`.
   * Campos de completitud legal (Nullables al registrarse, obligatorios antes de emitir el PDF de denuncia): `ci_number` (C.I.), `phone`, `address` (domicilio real).
2. **`offense_categories` (Catálogo de Tipificación Legal):**
   * `id`, `main_type` (`MALTRATO`, `BIOCIDIO`).
   * `subtype_name`:
     * 8 modalidades de Maltrato (Art. 350 bis C.P.): *Maltrato físico*, *Maltrato psicológico*, *Maltrato por negligencia*, *Abandono*, *Explotación*, *Maltrato por confinamiento*, *Maltrato sanitario (falta de atención médica)*, *Maltrato sexual*.
     * 5 modalidades de Biocidio (Art. 350 ter C.P.): *Biocidio por ensañamiento*, *Biocidio por motivos fútiles*, *Biocidio múltiple (varios animales)*, *Biocidio como consecuencia de maltrato*, *Biocidio por crueldad*.
   * `legal_basis`: Referencia a CPE (arts. 33 y 405), Ley N.° 700/2015, Código Penal (arts. 350 bis y 350 ter), D.S. N.° 4341/2020 y Ley Municipal N.° 252/2022 de Sucre.
3. **`complaints` (Denuncias Generadas e Historial):**
   * `id` (UUID), `tracking_code` (Unique, formato `SOS-000458-2026`, código de referencia documental generado al emitir el PDF), `user_id` (FK), `offense_category_id` (FK), `incident_date`, `incident_address`, `latitude`, `longitude`, `description` (relato de los hechos), `status` (`BORRADOR`, `ENVIADA`), `is_immutable` (Boolean), `pdf_url` (Key en MinIO), `created_at`, `submitted_at`.
4. **`complaint_evidences` (Anexo Fotográfico — Máximo 3 Fotos por Denuncia):**
   * `id` (UUID), `complaint_id` (FK), `evidence_type` (`FOTO`), `object_key` (ruta en MinIO), `mime_type` (`image/jpeg`, `image/png`, `image/webp`), `file_size_bytes`, `created_at`.
5. **`attention_centers` (Directorio de Zoonosis y Centros Veterinarios):**
   * `id`, `name` (ej. CEMZOO, Veterinaria San Francisco, Veterinaria SucreVet), `category` (`ZOONOSIS`, `VETERINARIA`), `address`, `latitude`, `longitude`, `phone`, `opening_hours`, `is_24_hours` (Boolean), `services` (consultas, emergencias, etc.), `is_active`.

---

## 5. Reglas Críticas de Negocio y Seguridad

1. **Vistas Públicas Estáticas/Informativas vs. Vistas Protegidas:**
   * **Público (Sin Login — Portal Ciudadano con Navbar Superior):**
     * **Portada (`/`)**: Orientación jurídica, ruta digital de 4 pasos y accesos rápidos.
     * **Zoonosis y Veterinarias (`/mapa`)**: Mapa interactivo en Leaflet con filtros y cálculo de distancia desde el usuario.
     * **Salud y Campañas (`/campanas` — Estática)**: Calendario de vacunación recomendado para mascotas, importancia de sus controles veterinarios y salud general, y fechas aproximadas de las campañas gratuitas municipales de vacunación antirrábica y esterilización.
     * **Normativa (`/normativa` — Estática)**: Resumen ciudadano de las leyes y normas que protegen a los animales con botón para descargarlas directamente en PDF (`public/docs/normativa/`).
     * **Educación (`/educacion` — Estática)**: Guías de tenencia responsable y sección de descarga de folletos informativos en PDF elaborados para distintos públicos (**Escolares**, **Colegiales** y **Público general**, en `public/docs/folletos/`).
   * **Protegido Ciudadano (Requiere JWT, `MainLayout.astro`):**
     * Asistente interactivo de denuncia en **4 pasos** (`/denunciar`) con Guard inmediato hacia `/login?next=/denunciar`.
     * Historial personal (`/mis-denuncias`) para continuar borradores o volver a descargar el PDF de denuncias emitidas.
   * **Protegido Superadministrador (Exclusivo rol `admin`, `PanelLayout.astro` con Sidebar Izquierdo):**
     * `/panel/denuncias`: Registro histórico y estadístico de las denuncias generadas en la plataforma (conteo por tipo/modalidad, consulta de casos y descarga de PDFs).
     * `/panel/veterinarias`: CRUD del directorio de clínicas veterinarias y Zoonosis con selector de coordenadas en mapa.
     * `/panel/usuarios`: Listado de usuarios registrados y asignación del rol `admin`.
2. **Flujo Interactivo e Inmutable de la Denuncia (4 Pasos Ágiles):**
   * **Paso 1 (Tipificación del Hecho):** Selección interactiva de Tipo (`MALTRATO` o `BIOCIDIO`) y Modalidad específica en una misma vista ligera, mostrando automáticamente el fundamento legal aplicable.
   * **Paso 2 (Hechos, Ubicación y Anexo Fotográfico):** Fecha/hora, dirección, marcador opcional en mini-mapa Leaflet centrado en Sucre (+ botón GPS), relato del hecho y carga opcional de **1 a 3 fotografías** (`JPG/PNG/WEBP`). Se guarda en estado `BORRADOR` (`is_immutable = False`).
   * **Paso 3 (Datos del Denunciante y Previsualización):** Confirmación de datos del denunciante (`full_name`, `ci_number`, `phone`, `address` autocompletados desde su perfil) y vista previa del **Documento de Denuncia** (con su Anexo Fotográfico).
   * **Paso 4 (Emisión Definitiva y Descarga del PDF):** Al confirmar, pasa a `ENVIADA`, activa `is_immutable = True`, congela el PDF final en MinIO con las fotografías incrustadas en la última hoja y habilita la descarga inmediata junto con las instrucciones para presentarlo ante Fiscalía, POFOMA o CEMZOO.
3. **Subida de Fotografías mediante Presigned URLs:**
   * Los archivos de imagen nunca transitan por la memoria RAM de FastAPI durante la carga del usuario.
   * El cliente envía metadatos (MIME type, tamaño en bytes) a FastAPI -> FastAPI valida JWT, lista blanca de imágenes (`image/jpeg`, `image/png`, `image/webp`) y límite de peso -> FastAPI responde con una URL pre-firmada de MinIO con expiración de 180 segundos y `object_key` basado en UUID. Al generar el PDF definitivo en el Paso 4, el backend recupera las imágenes (máx. 3) de MinIO y las incrusta en la última página del PDF.

---

## 6. División de Módulos y Ramas por Integrante

| Integrante | Rol | Módulo Asignado | Rama Backend (`apps/api`) | Rama Frontend (`apps/web`) |
| :--- | :--- | :--- | :--- | :--- |
| **Integrante 1 (Tech Lead)** | Backend & LegalTech | Core, Auth (`ciudadano`/`admin`), Motor de Denuncias y PDF con Anexo Fotográfico | `feat/api-core-and-complaints` | `feat/web-legal-catalog` |
| **Integrante 2** | Fullstack Dev | Geolocalización, Mapa Público (`/mapa`) y CRUD de Veterinarias (`/panel/veterinarias`) | `feat/api-geo-directory` | `feat/web-map-and-vets` |
| **Integrante 3** | Frontend & UI Dev | Páginas Estáticas: Salud y Campañas (`/campanas`), Normativa en PDF (`/normativa`) y Educación con Folletos (`/educacion`) | *(Sin backend CRUD — limpieza de `campaigns`/`norms`)* | `feat/web-static-campaigns-norms-education` |
| **Integrante 4** | Frontend & UI Dev | Auth UI (`/login`, `/registro`), Asistente de 4 Pasos (`/denunciar`), `/mis-denuncias` y Panel Universitario (`/panel/denuncias`, `/panel/usuarios`) | `feat/auth-complaints-panel` | `feat/web-complaint-wizard-4steps` |

### Alcance Detallado por Integrante

* **Integrante 1 (Core, Seguridad y Motor LegalTech):**
  * Autenticación JWT, control de roles (`ciudadano`, `admin`), gestión de usuarios para superadministrador (`GET /auth/users`, `PATCH /auth/users/{id}/role`) y perfilamiento progresivo (`ci_number`, `phone`, `address`).
  * Endpoint generador de *Presigned URLs* hacia MinIO restringido a fotografías (`image/jpeg`, `image/png`, `image/webp`, máx. 3 por denuncia).
  * Endpoints del catálogo penal/municipal, creación/edición de denuncias en `BORRADOR`, congelamiento inmutable al emitir (`ENVIADA`), código `SOS-XXXXXX-2026` y renderizado del **Documento de Denuncia en PDF** con `WeasyPrint` incluyendo el **Anexo Fotográfico** en la última hoja.
* **Integrante 2 (Geolocalización y Directorio Veterinario):**
  * Endpoints CRUD en FastAPI (`/api/v1/directory`) para `attention_centers` (consulta pública con cálculo de distancia y CRUD protegido para `admin`).
  * Página pública `/mapa` en Astro con isla de React en Leaflet (`VetMapIsland`), mostrando ubicación de CEMZOO y clínicas veterinarias, distancia en km (`2,1 km`), horarios, filtro de atención 24h y rutas de llegada.
  * Interfaz CRUD en `/panel/veterinarias` (dentro de `PanelLayout.astro`) con selector de coordenadas en mapa para el superadministrador (`admin`).
* **Integrante 3 (Páginas Estáticas de Salud, Biblioteca Normativa y Educación por Público):**
  * Página estática `/campanas` en Astro: calendario de vacunación recomendado para perros y gatos, guía sobre la importancia del cuidado y controles veterinarios, y fechas aproximadas de las campañas gratuitas municipales de vacunación antirrábica y esterilización.
  * Página estática `/normativa` en Astro: tarjetas con resumen ciudadano de leyes de protección animal (CPE, Ley N.º 700/2015, Código Penal arts. 350 bis y 350 ter, D.S. N.º 4341/2020, Ley Municipal N.º 252/2022) y botón de descarga directa de cada PDF oficial desde `public/docs/normativa/`.
  * Página estática `/educacion` en Astro: guías de tenencia responsable y prevención del maltrato + sección de descarga de **folletos informativos en PDF** segmentados para **Escolares**, **Colegiales** y **Público general** desde `public/docs/folletos/`.
* **Integrante 4 (Asistente Interactivo de 4 Pasos, Auth UI y Panel Universitario):**
  * Pantallas de Login (`/login`), Registro ligero (`/registro`), `MainLayout.astro` (con botón explícito `Cerrar sesión`) y `PanelLayout.astro` (con **sidebar izquierdo** exclusivo para `/panel/*`).
  * Isla de React para el **Asistente de Denuncia en 4 pasos (`/denunciar`)**, optimizado para móvil (interactivo y sin saturación visual): tipificación unificada, mini-mapa Leaflet en Sucre, carga de 1 a 3 fotos para el Anexo Fotográfico, previsualización y descarga del PDF.
  * Historial ciudadano (`/mis-denuncias`) y vistas del Panel Universitario para `admin`: registro histórico y estadístico de denuncias (`/panel/denuncias`) y gestión de usuarios (`/panel/usuarios`).

---

## 7. Metodología Kanban (Trello) y Flujo Git

* **Regla Spec-Driven (Contrato Primero):** Ninguna tarjeta que consuma la API pasa a *In Progress* en Frontend sin que su esquema Pydantic de entrada/salida esté definido y documentado en Swagger (`/docs`).
* **Listas del Tablero Trello:**
  1. `Contratos API / Specs`
  2. `To Do (Sprint)`
  3. `In Progress` (Máximo 2 tarjetas por desarrollador)
  4. `Code Review (Pull Request)` (Revisión cruzada obligatoria hacia la rama `develop`)
  5. `QA / Testing en Docker`
  6. `Done`
