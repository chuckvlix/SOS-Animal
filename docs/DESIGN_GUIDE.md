# Sistema de Diseño y Especificación UX/UI — SOS Animal

> **Propósito del documento:** Guía técnica de diseño de interfaz y experiencia de usuario (UX/UI) para el desarrollo de la aplicación multiplataforma (Web y Móvil) **SOS Animal**, una herramienta *LegalTech* de orientación jurídica, atención veterinaria y denuncia ciudadana contra el maltrato animal (implementación inicial: **Sucre, Bolivia**).

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
| `--color-primary` | Púrpura Profundo | `#5B21B6` | Identidad de marca, botones primarios (`Siguiente`, `Enviar`), bordes de selección activa e íconos activos. |
| `--color-primary-hover` | Púrpura Oscuro | `#4C1D95` | Estado `:hover` y `:active` de botones primarios. |
| `--color-primary-soft` | Lavanda Pálido | `#F3E8FF` | Fondos de tarjetas informativas legales (*Sustento Legal Detectado*), badges de artículos y estados *hover* suaves. |
| `--color-sos` | Rojo Carmesí | `#E11D48` | **Uso exclusivo:** Botón/acceso directo a `Denunciar SOS`, indicadores de urgencia crítica y alertas de biocidio. |
| `--color-sos-soft` | Rosa Pálido | `#FFE4E6` | Fondo de alertas críticas o etiquetas de advertencia urgente. |
| `--color-secondary` | Verde Azulado (*Teal*) | `#0D9488` | Módulo de salud/veterinarias/Zoonosis, pasos completados en el *stepper* y estados de confirmación (`Denuncia enviada`). |
| `--color-secondary-soft`| Menta Pálido | `#CCFBF1` | Fondo de píldoras de estado completado (`1. Inicio`, `2. Tipo`) y badges de atención veterinaria disponible. |
| `--color-bg-canvas` | Gris Alabastro | `#F8FAFC` | Fondo base de toda la aplicación (lienzo principal). |
| `--color-bg-surface` | Blanco Puro | `#FFFFFF` | Fondo de tarjetas (*cards*), barra lateral, barra de navegación inferior, modales e *inputs*. |
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
* **Números y Códigos de Seguimiento:** Aplicar `font-variant-numeric: tabular-nums;` en códigos de caso (ej. `SOS-000458-2026`), cédulas de identidad, fechas y distancias.

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

## 4. Arquitectura de Navegación y Layout Multiplataforma

La aplicación debe operar bajo una estructura unificada de **5 módulos principales**, evitando cambiar los íconos de navegación entre pantallas.

### 4.1 Destinos de Navegación Global
1. **Inicio** (`Home`): Resumen rápido, botón de emergencia SOS, accesos directos y campañas activas.
2. **Denunciar SOS** (`AlertMegaphone` / `ShieldAlert`): Flujo guiado en 7 pasos para denuncias de maltrato o biocidio. Destacado visualmente con acento `--color-sos` (`#E11D48`).
3. **Zoonosis y Veterinarias** (`MapPin` / `PawPrint`): Mapa interactivo con filtros (CEMZOO, clínicas 24h, urgencias) y cálculo de distancia.
4. **Salud y Vacunas** (`Syringe` / `HeartPulse`): Calendario de vacunación, campañas de esterilización y guías de cuidado preventivo.
5. **Normativa Legal** (`Scale`): Buscador y lectura simplificada de leyes nacionales y municipales vigentes.
6. **Mis Denuncias** (`FileText` — en sidebar web o perfil móvil): Historial de casos enviados, descarga de PDF y consulta de estado por código.

### 4.2 Adaptación por Dispositivo

#### Vista Web / Escritorio (`>= 1024px`)
* **Sidebar Izquierda Fija (`260px`):** Contiene el logotipo `SOS Animal`, los 5 enlaces de navegación + `Mis Denuncias`, y al pie el botón `Cerrar sesión` junto al indicador de ubicación (`Sucre, Bolivia`).
* **Área Principal de Trabajo (`1fr`):**
  * **En el Flujo de Denuncia (Layout de 2 Columnas `60% / 40%`):**
    * *Columna Izquierda:* Formulario paso a paso dentro de una tarjeta blanca (`#FFFFFF`).
    * *Columna Derecha (Sticky):* Panel superior con **Sustento Legal Detectado** (fondo `#F3E8FF`) y panel inferior con **Vista Previa en Vivo del PDF** (*"Generando PDF automáticamente..."*) que actualiza el Documento de Denuncia en tiempo real conforme el usuario completa los campos.

#### Vista Móvil (`< 768px`)
* **Header Superior (`56px`):** Isotipo + nombre `SOS Animal` a la izquierda; badge de ubicación (`Sucre`) o botón de retroceso (`←`) en subpáginas.
* **Bottom Navigation Bar Fija (`64px`):** 5 ítems fijos (`Inicio`, `Mapa`, botón central elevado `SOS`, `Salud`, `Leyes`).
* **Ergonomía:** Todas las áreas táctiles deben medir mínimo `48px x 48px`. Los botones principales de avance (`Siguiente`) se ubican en la zona inferior accesible con el pulgar.

---

## 5. Reglas de Componentes UI

1. **Tarjetas (Cards):**
   * Fondo: `#FFFFFF`
   * Borde: `1px solid #E2E8F0`
   * Radio de esquina: `12px` (`rounded-xl`)
   * Padding interno: `20px` (móvil) / `24px` (escritorio).
   * Sombra: Sutil o nula (`0 1px 2px rgba(15, 23, 42, 0.04)`). Evitar sombras oscuras pronunciadas.
2. **Botones y Controles de Selección:**
   * Radio de esquina: `8px` (`rounded-lg`).
   * **Botón Primario:** Fondo `#5B21B6`, texto `#FFFFFF`, peso `600`.
   * **Botón Secundario / Anterior:** Fondo `#F1F5F9` o `#FFFFFF` con borde `#E2E8F0`, texto `#0F172A`.
   * **Píldoras de Selección (Chips / Radio Cards):** En reposo llevan borde `1px solid #E2E8F0` y fondo `#FFFFFF`. Al seleccionarse, aplican borde `2px solid #5B21B6`, fondo `#F3E8FF` (o `#FFFFFF` con check `#5B21B6`) y texto en `#5B21B6`.
3. **Stepper de Progreso (Flujo Anti-Estrés de 7 Pasos):**
   * Dividir el proceso de denuncia en **7 pasos guiados** para reducir la carga cognitiva bajo estrés y asegurar la completitud jurídica:
     1. `1. Inicio` (Selección de "Denunciar maltrato o biocidio")
     2. `2. Tipo de Denuncia` (Selección entre `MALTRATO` o `BIOCIDIO`)
     3. `3. Modalidad` (Selección de la modalidad específica según el Código Penal)
     4. `4. Fundamento Legal` (Visualización automática de la base normativa aplicable)
     5. `5. Datos y Evidencias` (Datos obligatorios del denunciante —CI, teléfono y domicilio—, datos del hecho y carga de pruebas; guardado en `BORRADOR`)
     6. `6. Previsualización` (Revisión del Documento de Denuncia preliminar)
     7. `7. Envío Definitivo` (Confirmación inmutable `ENVIADA`, generación del PDF final en MinIO y emisión del código `SOS-XXXXXX-2026`)
   * Estados del *Stepper*:
     * *Completado:* Fondo `#CCFBF1`, texto `#0F172A`, ícono check `#0D9488`.
     * *Activo:* Fondo `#5B21B6`, texto `#FFFFFF`.
     * *Pendiente:* Fondo `#E2E8F0` / `#F1F5F9`, texto `#475569`.
4. **Iconografía:**
   * Usar exclusivamente una librería vectorial limpia con grosor de trazo uniforme de `1.75px` o `2px` (**Lucide Icons** o **Phosphor Icons**).
   * Contorno (*outline*) para estados inactivos; relleno (*solid* o acento de color) únicamente para estados activos.
5. **Accesibilidad (WCAG AA):**
   * Ratio de contraste mínimo de `4.5:1` en todo texto funcional.
   * Nunca transmitir información solo mediante color: acompañar pines de mapa o estados con etiquetas textuales explícitas (ej. `Abierto 24h`, `Zoonosis Municipal`, `Urgencias`).

---

## 6. Estructura de Datos del Módulo LegalTech (Referencia para Backend/Frontend)

Para alimentar la lógica dinámica del formulario y la generación automática del Documento de Denuncia en PDF:

### 6.1 Categorías de Denuncia y Tipificación (Bolivia / Sucre)
* **Categoría A: Maltrato Animal (`Código Penal Art. 350 bis - Tratos crueles`)**
  * Subtipos: `Maltrato físico`, `Abandono`, `Maltrato psicológico`, `Negligencia`, `Explotación`, `Maltrato por confinamiento`, `Maltrato sanitario (falta de atención médica)`, `Maltrato sexual`.
* **Categoría B: Biocidio (`Código Penal Art. 350 ter - Biocidio`)**
  * Subtipos: `Biocidio por ensañamiento`, `Biocidio por motivos fútiles`, `Biocidio múltiple (varios animales)`, `Biocidio como consecuencia de maltrato`, `Biocidio por crueldad`.

### 6.2 Base Normativa Inyectada en el PDF
* **Constitución Política del Estado (CPE):** Arts. 33 y 405.
* **Ley N.º 700/2015:** *Para la Defensa de los Animales Contra Actos de Crueldad y Maltrato*.
* **Código Penal Boliviano:** Art. 350 bis (Tratos crueles) y Art. 350 ter (Biocidio).
* **Decreto Supremo N.º 4341/2020:** Reglamento de la Ley N.º 700.
* **Ley Municipal Autonómica N.º 252/2022 (GAM Sucre):** *Tenencia responsable y bienestar animal*.

### 6.3 Instituciones Destinatarias (Derivación)
* Ministerio Público (Fiscalía de Materia)
* Policía Boliviana — POFOMA (Policía Forestal y de Preservación del Medio Ambiente)
* Centro Municipal de Zoonosis de Sucre (CEMZOO)
* Gobierno Autónomo Municipal de Sucre (GAM Sucre)