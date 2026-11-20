# Sistema de Diseño y Especificación UX/UI — SOS Animal

> **Propósito del documento:** Guía técnica de diseño de interfaz y experiencia de usuario (UX/UI) para el desarrollo de la aplicación multiplataforma (Web y Móvil) **SOS Animal**, una herramienta *LegalTech* de orientación jurídica, directorio veterinario, educación preventiva y generación de denuncias ciudadanas en PDF contra el maltrato animal (implementación inicial: **Sucre, Bolivia**, administrada por la Universidad).

---

## 1. Identidad de Marca y Nomenclatura

* **Nombre oficial de la aplicación:** `SOS Animal`
* **Subtítulo / Descriptor contextual:** *Plataforma de orientación jurídica y protección animal*
* **Selector de jurisdicción:** Badge o selector desacoplado del logotipo (`Sucre, Bolivia`) para permitir futura escalabilidad a otros municipios o departamentos sin modificar la marca.
* **Reglas del Logotipo:**
  * **Isotipo:** Exclusivamente el símbolo combinado de **corazón + huella animal** en color primario (`#5B21B6`).
  * **Logotipo (Lockup):** El isotipo puede acompañarse del texto `SOS Animal` en tipografía *Plus Jakarta Sans Bold*, pero el isotipo debe funcionar de forma autónoma (favicons, ícono de app móvil, avatares y marca de agua en PDF).

---

## 2. Sistema de Color (Design Tokens)

La interfaz utiliza un **Modo Claro (Light Mode)** limpio y de alto contraste para reducir la fatiga visual y transmitir calma y autoridad legal en situaciones de emergencia. Se prohíbe el uso de fondos con degradados saturados en las pantallas operativas.

### 2.1 Paleta Semántica

| Token CSS | Nombre | HEX | Uso Principal y Reglas |
| :--- | :--- | :--- | :--- |
| `--color-primary` | Púrpura Profundo | `#5B21B6` | Identidad de marca, botones primarios (`Siguiente`, `Emitir PDF`), bordes de selección activa e íconos activos. |
| `--color-primary-hover` | Púrpura Oscuro | `#4C1D95` | Estado `:hover` y `:active` de botones primarios. |
| `--color-primary-soft` | Lavanda Pálido | `#F3E8FF` | Fondos de tarjetas informativas legales (*Sustento Legal Detectado*), badges de artículos y estados *hover* suaves. |
| `--color-sos` | Rojo Carmesí | `#E11D48` | **Uso exclusivo:** Botón/acceso directo a `Denunciar SOS`, indicadores de urgencia crítica y alertas de biocidio. |
| `--color-sos-soft` | Rosa Pálido | `#FFE4E6` | Fondo de alertas críticas o etiquetas de advertencia urgente. |
| `--color-secondary` | Verde Azulado (*Teal*) | `#0D9488` | Módulo de salud/veterinarias/Zoonosis, pasos completados en el *stepper* y estados de confirmación (`PDF generado`). |
| `--color-secondary-soft`| Menta Pálido | `#CCFBF1` | Fondo de píldoras de estado completado (`1. Tipificación`, `2. Hechos`) y badges de atención veterinaria disponible. |
| `--color-bg-canvas` | Gris Alabastro | `#F8FAFC` | Fondo base de toda la aplicación (lienzo principal). |
| `--color-bg-surface` | Blanco Puro | `#FFFFFF` | Fondo de tarjetas (*cards*), barra lateral del panel, barra de navegación inferior, modales e *inputs*. |
| `--color-text-primary` | Pizarra Oscuro | `#0F172A` | Títulos (H1-H3), etiquetas de formulario y texto legal principal. |
| `--color-text-secondary`| Gris Pizarra | `#475569` | Subtítulos, descripciones de apoyo, distancias (`2,1 km`) y metadatos. |
| `--color-border` | Gris Borde | `#E2E8F0` | Bordes estructurales (`1px solid`) de tarjetas, divisores e *inputs* en reposo. |

### 2.2 Variables CSS Listas para Implementar

```css
:root {
  /* Marca */
  --color-primary: #5B21B6;
  --color-primary-hover: #4C1D95;
  --color-primary-soft: #F3E8FF;

  /* Semánticos */
  --color-sos: #E11D48;
  --color-sos-soft: #FFE4E6;
  --color-secondary: #0D9488;
  --color-secondary-soft: #CCFBF1;

  /* Superficies y Bordes */
  --color-bg-canvas: #F8FAFC;
  --color-bg-surface: #FFFFFF;
  --color-border: #E2E8F0;

  /* Tipografía */
  --color-text-primary: #0F172A;
  --color-text-secondary: #475569;
  --color-text-muted: #94A3B8;
}
```

---

## 3. Sistema Tipográfico

Se combinan dos familias tipográficas gratuitas de Google Fonts para equilibrar calidez humana con rigor jurídico y legibilidad en pantallas pequeñas.

* **Títulos y Navegación (`--font-display`):** `Plus Jakarta Sans` (Pesos: `600 SemiBold`, `700 Bold`).
* **Cuerpo, Formularios y Textos Legales (`--font-body`):** `Inter` (Pesos: `400 Regular`, `500 Medium`, `600 SemiBold`).
* **Números y Códigos de Referencia:** Aplicar `font-variant-numeric: tabular-nums;` en códigos de documento (ej. `SOS-000458-2026`), cédulas de identidad, fechas y distancias.

### Escala Tipográfica Responsiva

| Nivel | Elemento | Familia | Tamaño (Móvil / Web) | Peso | Line Height |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **H1** | Título de Pantalla | `Plus Jakarta Sans` | `22px` / `24px` | `700 Bold` | `1.25` |
| **H2** | Título de Tarjeta / Sección | `Plus Jakarta Sans` | `18px` / `20px` | `600 SemiBold` | `1.3` |
| **H3** | Subtítulo / Encabezado de Bloque | `Inter` | `16px` / `16px` | `600 SemiBold` | `1.4` |
| **Body** | Texto general e *Inputs* | `Inter` | `16px` / `15px` | `400 Regular` | `1.5` |
| **Label**| Etiquetas de formulario y botones | `Inter` | `14px` / `14px` | `500 Medium` | `1.4` |
| **Caption**| Citas legales, badges y metadatos | `Inter` | `12px` / `13px` | `500 Medium` | `1.4` |

> **Nota de UX Móvil:** Mantener los `<input>` y `<textarea>` en mínimo `16px` en dispositivos móviles evita el zoom automático forzado en Safari/iOS y Chrome Android.

---

## 4. Arquitectura de Navegación y Layouts (Portal Ciudadano vs. Panel Universitario)

La plataforma separa claramente la experiencia del **Portal Ciudadano** (`MainLayout.astro`, sin sidebar lateral) del **Panel Universitario de Administración** (`PanelLayout.astro`, con sidebar fijo a la izquierda exclusivo para el superadministrador `admin`).

### 4.1 Destinos de Navegación Global (Portal Ciudadano)
1. **Inicio** (`Home` -> `/`): Portada informativa con acceso directo SOS, ruta digital de 4 pasos, servicios ciudadanos y marco jurídico.
2. **Zoonosis y Veterinarias** (`MapPin` -> `/mapa`): Mapa interactivo con filtros (CEMZOO, clínicas 24h, urgencias) y cálculo de distancia.
3. **Salud y Vacunas** (`Heart` -> `/campanas`): Página estática con calendario de vacunación recomendado para mascotas, importancia de controles de salud y fechas aproximadas de campañas municipales gratuitas de vacunación antirrábica y esterilización.
4. **Normativa Legal** (`Scale` -> `/normativa`): Página estática con resumen ciudadano de leyes nacionales y municipales vigentes y descarga directa de PDFs oficiales (`public/docs/normativa/`).
5. **Educación y Prevención** (`BookOpen` -> `/educacion`): Página estática con guías de tenencia responsable y sección de descarga de folletos informativos en PDF por público (**Escolares**, **Colegiales** y **Público general**, en `public/docs/folletos/`).
6. **Denunciar SOS** (`ShieldAlert` -> `/denunciar`): Asistente interactivo en **4 pasos** para generar el **Documento de Denuncia** en PDF con Anexo Fotográfico. Destacado con acento `--color-sos` (`#E11D48`).
7. **Mis Denuncias** (`FileText` -> `/mis-denuncias`): Visible cuando el ciudadano cuenta con sesión autenticada activa; permite retomar borradores y descargar los PDFs generados.

### 4.2 Adaptación por Dispositivo y Rol

#### Portal Ciudadano (`MainLayout.astro`)
* **Vista Web / Escritorio (`>= 1024px`):**
  * **Barra Superior Fija (`sticky top-0`):** Contiene el logotipo `SOS Animal`, los enlaces informativos principales (`Inicio`, `Veterinarias`, `Salud y Vacunas`, `Normativa`, `Educación`), el acceso condicional `Mis Denuncias` (con sesión activa), el botón explícito **`Cerrar sesión`** (con texto visible) y el botón destacado `Denunciar SOS`.
  * **Pie de Página Web (`WebFooter`):** Visible en escritorio (`>= 1024px`) con identidad de marca, insignia de jurisdicción (`Sucre, Bolivia`), enlaces de servicio público e instituciones receptoras.
  * **En el Flujo de Denuncia (`/denunciar`, Layout de 2 Columnas `60% / 40%` en escritorio):**
    * *Columna Izquierda:* Formulario interactivo paso a paso (4 pasos) dentro de una tarjeta blanca (`#FFFFFF`).
    * *Columna Derecha (Sticky):* Panel superior con **Sustento Legal Detectado** (fondo `#F3E8FF`) y panel inferior con **Vista Previa en Vivo del Documento de Denuncia** (incluyendo miniaturas/conteo del Anexo Fotográfico).
* **Vista Móvil y Tablet (`< 1024px`):**
  * **Header Superior (`sticky top-0`):** Isotipo + nombre `SOS Animal` a la izquierda; controles de sesión (`Casos`, **`Cerrar sesión`**) a la derecha.
  * **Bottom Navigation Bar Fija:** 5 ítems fijos (`Inicio`, `Mapa`, botón central elevado `SOS`, `Salud`, `Leyes`).
  * **Ergonomía y No Saturación en Móvil:** En `/denunciar`, usar divulgación progresiva (tarjetas interactivas colapsables para el mini-mapa opcional y resumen legal compacto) para que ningún paso requiera scroll excesivo.

#### Panel Universitario (`PanelLayout.astro` — Exclusivo Superadministrador `admin`)
* **Sidebar Izquierdo Fijo en Escritorio (`>= 1024px`) / Drawer `<dialog>` en Móvil (`< 1024px`):**
  * Identidad `SOS Animal · Panel Institucional` + badge `Sucre, Bolivia`.
  * Menú vertical:
    * **Registro de Denuncias (`/panel/denuncias`)**: Observatorio histórico y estadístico de denuncias generadas (métricas por tipo/modalidad y descarga de PDFs).
    * **Gestión de Usuarios (`/panel/usuarios`)**: Listado de cuentas y asignación del rol `admin`.
  * Acceso `Volver al Portal Ciudadano` (`/`) y botón explícito **`Cerrar sesión`** con texto visible tanto en la barra superior del panel como en el pie del sidebar.

---

## 5. Reglas de Componentes UI

1. **Tarjetas (Cards):**
   * Fondo: `#FFFFFF`
   * Borde: `1px solid #E2E8F0`
   * Radio de esquina: `12px` (`rounded-xl`) a `24px` (`rounded-3xl`) según jerarquía.
   * Padding interno: `20px` (móvil) / `24px` (escritorio).
   * Sombra: Sutil o nula (`0 1px 2px rgba(15, 23, 42, 0.04)`).
2. **Botones y Controles de Selección:**
   * Radio de esquina: `8px` (`rounded-lg`) a `12px` (`rounded-xl`).
   * **Botón Primario:** Fondo `#5B21B6`, texto `#FFFFFF`, peso `600`.
   * **Botón Secundario / Anterior:** Fondo `#F1F5F9` o `#FFFFFF` con borde `#E2E8F0`, texto `#0F172A`.
   * **Tarjetas de Selección Interactivas (Radio Cards):** En reposo llevan borde `1px solid #E2E8F0` y fondo `#FFFFFF`. Al seleccionarse, aplican borde `2px solid #5B21B6`, fondo `#F3E8FF` (o `#FFE4E6` / `#E11D48` para alertas de Biocidio).
3. **Stepper de Progreso (Flujo Interactivo de 4 Pasos):**
   * Dividir el proceso de denuncia en **4 pasos claros y ligeros** para evitar fatiga en el ciudadano:
     1. `1. Tipificación` (Selección interactiva de `MALTRATO` o `BIOCIDIO` + Modalidad específica + visualización inmediata del fundamento legal)
     2. `2. Hechos y Fotos` (Fecha/hora, dirección, pin opcional en mini-mapa Leaflet en Sucre, relato y subida de **1 a 3 fotografías** para el Anexo Fotográfico; guardado en `BORRADOR`)
     3. `3. Denunciante y Revisión` (Datos obligatorios del denunciante —CI, teléfono y domicilio— y vista previa del Documento de Denuncia)
     4. `4. Descarga de PDF` (Emisión inmutable `ENVIADA`, generación del PDF final con Anexo Fotográfico en la última hoja y descarga inmediata)
   * Estados del *Stepper*:
     * *Completado:* Fondo `#CCFBF1`, texto `#0F172A`, ícono check `#0D9488`.
     * *Activo:* Fondo `#5B21B6`, texto `#FFFFFF`.
     * *Pendiente:* Fondo `#E2E8F0` / `#F1F5F9`, texto `#475569`.
4. **Iconografía:**
   * Usar exclusivamente una librería vectorial limpia con grosor de trazo uniforme de `1.75px` o `2px` (**Lucide Icons**).
5. **Accesibilidad (WCAG AA):**
   * Ratio de contraste mínimo de `4.5:1` en todo texto funcional.
   * Nunca transmitir información solo mediante color: acompañar pines de mapa o estados activos con etiquetas textuales explícitas y bordes diferenciados.

---

## 6. Estructura de Datos del Módulo LegalTech (Referencia para Backend/Frontend)

Para alimentar la lógica dinámica del formulario y la generación automática del **Documento de Denuncia** en PDF con su **Anexo Fotográfico**:

### 6.1 Categorías de Denuncia y Tipificación (Bolivia / Sucre)
* **Categoría A: Maltrato Animal (`Código Penal Art. 350 bis - Tratos crueles`)**
  * Subtipos: `Maltrato físico`, `Abandono`, `Maltrato psicológico`, `Maltrato por negligencia`, `Explotación`, `Maltrato por confinamiento`, `Maltrato sanitario (falta de atención médica)`, `Maltrato sexual`.
* **Categoría B: Biocidio (`Código Penal Art. 350 ter - Biocidio`)**
  * Subtipos: `Biocidio por ensañamiento`, `Biocidio por motivos fútiles`, `Biocidio múltiple (varios animales)`, `Biocidio como consecuencia de maltrato`, `Biocidio por crueldad`.

### 6.2 Base Normativa Inyectada en el PDF y Disponible en `/normativa`
* **Constitución Política del Estado (CPE):** Arts. 33 y 405.
* **Ley N.º 700/2015:** *Para la Defensa de los Animales Contra Actos de Crueldad y Maltrato*.
* **Código Penal Boliviano:** Art. 350 bis (Tratos crueles) y Art. 350 ter (Biocidio).
* **Decreto Supremo N.º 4341/2020:** Reglamento de la Ley N.º 700.
* **Ley Municipal Autonómica N.º 252/2022 (GAM Sucre):** *Tenencia responsable y bienestar animal*.

### 6.3 Instituciones Destinatarias (Presentación Física del PDF)
* Ministerio Público (Fiscalía de Materia)
* Policía Boliviana — POFOMA (Policía Forestal y de Preservación del Medio Ambiente)
* Centro Municipal de Zoonosis de Sucre (CEMZOO)
* Gobierno Autónomo Municipal de Sucre (GAM Sucre)
