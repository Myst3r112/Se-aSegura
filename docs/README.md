# SeñaSegura · Landing Page Institucional y Simulador Interactivo

> **Curso:** UPC – HCI for UX Design (TB2)  
> **Propósito:** Plataforma web de demostración accesible para la atención presencial de personas sordas usuarias de Lengua de Señas Peruana (LSP) en bancos, comisarías, centros de salud y municipalidades.

---

## 1. Arquitectura y Estructura de Directorios

El proyecto está implementado con **HTML5 semántico**, **CSS3 puro** (variables `:root`) y **JavaScript estándar (ES6+)** sin frameworks de UI ni bundlers (con `@mediapipe/tasks-vision` y `@tensorflow/tfjs@4.22.0` + GraphModels `float16` en `./models/` precargados silenciosamente en segundo plano sin bloquear el arranque y codificación ISO/IEC 18004 local para el QR SVG), 100 % compatible con **GitHub Pages**.

```text
SeñaSegura/
├── index.html                  # Redirección automática a pages/index.html (GitHub Pages)
├── favicon.ico                 # Icono institucional de SeñaSegura
├── .gitignore                  # Reglas de exclusión para control de versiones
├── AGENTS.md                   # Reglas permanentes de arquitectura, seguridad DOM y accesibilidad
├── pages/
│   ├── index.html              # Landing Page institucional (P12) con acceso directo y simulador
│   └── app.html                # Plataforma operativa en pantalla completa (P1–P10, Modo Ventanilla)
├── css/
│   └── styles.css              # Tokens oficiales, layout responsive, Alto Contraste y @media print
├── js/
│   ├── main.js                 # Lógica modular compartida en Vanilla JS (ES6+) para index.html y app.html (incluye QR SVG V1–V6 URL verificable)
│   ├── gemini-lsp.js           # Capa híbrida opcional (gemini-3.8-flash) para refinar glosas/deletreo únicamente en LSP peruana (solo texto; fallback 100 % offline)
│   └── vision-ai.js            # Cámara IA unificada LSP: precarga silenciosa + árbitro neuronal 60 FPS en TensorFlow.js (118 señas dinámicas + MLP 90D Zero-Ambiguity + Micro-GRU trayectorias J, Ñ, Z) sobre MediaPipe + respaldo geométrico
├── workers/
│   └── gemini-lsp-proxy.js     # Plantilla Cloudflare Worker gratuita con CORS seguro para GitHub Pages sin exponer GEMINI_API_KEY
├── models/
│   ├── senas_dinamicas/           # GraphModel TF.js [1, 30, 159] (118 señas dinámicas PUCP LSP) + metadata.json
│   ├── model_alfabeto_lsp_3d/     # GraphModel TF.js MLP 90D Zero-Ambiguity [1, 90] (A–Z + ESPACIO) + metadata.json
│   └── model_alfabeto_dinamico_3d/ # GraphModel TF.js Micro-GRU [1, 16, 12] (ESTATICA, J, Ñ, Z) + metadata.json
├── assets/
│   ├── fonts/                  # Atkinson Hyperlegible (400 y 700 woff2)
│   ├── icons/                  # Iconografía SVG oficial exportada desde Figma
│   ├── images/                 # Recursos visuales y QR base de Figma
│   └── videos/                 # Directorio reservado para clips de respuesta en LSP
└── docs/
    └── README.md               # Documentación técnica y créditos del equipo
```

---

## 2. Tokens Oficiales de Diseño (`:root`)

Extraídos del sistema de diseño de SeñaSegura en Figma (`Atkinson Hyperlegible`):

| Token CSS | Valor | Uso principal |
|---|---|---|
| `--color-primary` | `#0F4C81` | Acciones primarias, identidad institucional y foco estándar |
| `--color-navy` | `#0A2540` | Marcos de tablet, bloque normativo y footer institucional |
| `--color-emergency` | `#D92626` | Botón y panel de Modo Emergencia prioritaria (`<30 s`) |
| `--color-success` | `#15803D` | Indicador `Red Operativa` y verificación de comprobante |
| `--color-warning` | `#D97706` | Alerta de microcorte de red y reconexión automática |
| `--color-bg` | `#F8FAFC` | Fondo general |
| `--color-surface` | `#FFFFFF` | Superficies de tarjetas, formularios y modales |
| `--color-text` | `#0F172A` | Texto principal |
| `--color-muted` | `#475569` | Texto secundario |
| `--color-border` | `#CBD5E1` | Bordes suaves de contención |
| `--font-main` | `'Atkinson Hyperlegible', 'Inter', system-ui, sans-serif` | Tipografía de alta legibilidad |

### Modo Alto Contraste (`html[data-contrast="high"]`)
- Fondo: `#121820`
- Acento y bordes activos: `#F59E0B`
- Texto: `#FFFFFF`

---

## 3. Cobertura de las 30 Historias de Usuario Core (MUST HAVE)

- **Accesibilidad Global (HU-033, HU-034, HU-036):**
  - Interruptor de Alto Contraste (`#121820` / `#F59E0B` / `#FFFFFF`) persistido en `localStorage`.
  - Escalado tipográfico `A−` / `A+` y accesos directos (`100%`, `125%`, `150%`) mediante `data-font-scale` en `<html>`.
  - Foco visible de `3px` con `Tab`/`Enter`, enlace de salto al contenido y atributos ARIA completos (`role="switch"`, `role="tablist"`, `aria-live`, `aria-expanded`, `<dialog>`).
- **Hero e Impacto (HU-041, HU-045):**
  - Menú hamburguesa accesible en dispositivos móviles (`<768px`).
  - Titular bimodal, tarjeta explicativa y vista previa en tablet.
  - KPIs animados al entrar en pantalla (`+232,000`, `<30 s`, `20 → 7 min`, `100%`) y pestañas por sector (*Agencias Bancarias*, *Comisarías*, *Centros de Salud*).
- **Arquitectura de Dos Vistas (Figma P1–P12):**
  - **Landing Institucional (`pages/index.html` · P12):** Hero, propuesta bimodal, casos de uso por sector, simulador incrustado, verificador web, marco normativo, FAQ en LSP y formulario demo B2G/B2B, con CTA principal **"Abrir Plataforma Completa (Modo Ventanilla)"**.
  - **Plataforma Operativa (`pages/app.html` · P1–P10):** Flujo guiado sin marketing en pantalla completa para tablet de ventanilla y pruebas de usabilidad SUS: pantalla de bienvenida (*Intérprete LSP*, *Cámara IA*, *Texto / Lectura*, selector de sede y *Modo Emergencia*), transición directa a la atención operativa en 2 columnas con control `← Cambiar sede` (H3) y alternancia a la **Consola del Intérprete (P8–P10)** desde cabecera.
- **Simulador Interactivo Core:**
  - Dos vistas sincronizadas: **Ventanilla (Ciudadano/Personal)** y **Consola del Intérprete (P8–P10)**.
  - **Tres canales de comunicación (HU-035):** **Intérprete LSP** (videollamada humana en vivo con transición *Listo → Conectando → En vivo* y **subtítulo en vivo `#sim-interpreter-caption`** sincronizado con turno, chat y emergencias), **Cámara IA (LSP · TensorFlow.js + MediaPipe)** (escenario amplio `clamp(380px, 60vh, 620px)` con protagonismo horizontal y botón `Ampliar vista`, bucle a ~60 FPS con precarga silenciosa `Preparando IA…` → `IA lista`, `pose_landmarker_full` en escritorio con suavizado EMA y tolerancia de 5 frames a micro-pérdidas, capa biomecánica Smart Gating, sesión de deletreo protegida que pausa el vocabulario de 118 señas mientras se deletrea, extractor canónico 90D sobre `hand_world_landmarks` para MLP (`model_alfabeto_lsp_3d`) + Micro-GRU temporal `[1, 16, 12]` (`model_alfabeto_dinamico_3d`) para `J`, `Ñ`, `Z` y compuerta `ESTATICA`, botón `Espacio`, envío sin cortes al deletrear, mini-guía rápida desplegable, overlay anatómico `Ver enfoque IA` / `Espejo` y HUD Top-2) y **Texto / Lectura** (chat asistido y dictado de voz).
  - **Visibilidad contextual y opción "Otros" (H2 / H8):** En `Cámara IA` se ocultan los selectores de Sede/Trámite y las tarjetas de datos ficticios (registrando `Atención general` / `Comunicación libre LSP`); en `Intérprete LSP` y `Texto / Lectura` se incluyen `Otra sede / General` y `Otro trámite / Consulta general` con campo breve opcional (`Consulta general` si queda vacío). Separación estricta entre `DNI del ciudadano` editable por el ciudadano en Ventanilla y el campo de ventanilla modificable solo desde Consola.
  - **Modo Emergencia (HU-009, HU-011, HU-014, HU-015):** Acceso en 1 toque sin formularios previos ni selectores de trámite, manteniendo los 3 tipos prioritarios (`105`, `106`, `100`), botón grande **`Otra emergencia`** y 4 pictogramas rápidos `>= 80×80 px`.
  - **Consola del Intérprete (P8–P10):** Banner de alerta crítica, ajuste exclusivo del personal (`Monto`, `Referencia`, `Área`, `Expediente`), **edición en vivo del motivo o trámite real atendido** sincronizado con el cierre (PDF/TXT/QR), feed en vivo de Mensajes de Ventanilla, autovista PiP, bloc de notas y Glosario Técnico LSP.
  - **Videollamada HD y Contingencia (HU-017, HU-018, HU-021, HU-023, HU-040):** Controles de micrófono, cámara, ángulo, pantalla completa con subtítulo en vivo y botón discreto `Simular microcorte` en la barra inferior.
- **Cierre, Calificación, Trazabilidad y Verificador Web (P6 · HU-025, HU-026, HU-029, HU-031, HU-032):**
  - Generación de código único de 8 dígitos (`SEG-XXXXXXXX`) con botón de copiado rápido, código QR ISO/IEC 18004 (V1–V6 Nivel M) escaneable en SVG puro local (`document.createElementNS`) que codifica la URL directa `?verificar=SEG-XXXXXXXX#marco-legal` sin peticiones de red, descarga real en **PDF (`constancia-SEG-XXXXXXXX.pdf`)** mediante `jspdf@2.5.2` cargado bajo demanda con QR vectorial e ID `INT-LSP-042` (con respaldo `.txt` offline), vista previa PDF con impresión directa (`@media print`), **calificación opcional de la experiencia en cierre (P6)** y purga local inmediata (incluyendo detención y limpieza de Cámara IA).
  - Verificador web con auto-verificación por URL (`?verificar=SEG-XXXXXXXX`) capaz de validar el ejemplo base (`SEG-84920` o `84920`) y los códigos generados en sesión con estado visual diferenciado.
- **Respaldo Normativo, FAQ y Formulario B2G/B2B (HU-042, HU-043, HU-044, HU-048):**
  - Respaldo explícito a la **Ley N.° 29535** (Lengua de Señas Peruana), **Ley N.° 29733** (Protección de Datos Personales) y política de **No grabación de video**, con modal de *Ficha de Conformidad*.
  - Acordeón de FAQ filtrable por categoría con modal de apoyo visual en LSP.
  - Formulario B2G/B2B con validación JavaScript en tiempo real, enlace directo accesible a *Política de Privacidad* (con botón *Imprimir / Guardar PDF*) sin alternar el checkbox y modal de confirmación.

---

## 4. Créditos del Equipo (UPC · HCI for UX Design)

- **Proyecto:** SeñaSegura – TB2
- **Equipo de Diseño UX/UI y Desarrollo Frontend:** *Integrantes del equipo SeñaSegura (UPC)*
- **Sistema de Diseño Fuente:** Figma (`SeñaSegura - Diseño UX/UI TB2`)
