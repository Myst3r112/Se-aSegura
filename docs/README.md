# SeñaSegura · Landing Page Institucional y Simulador Interactivo

> **Curso:** UPC – HCI for UX Design (TB2)  
> **Propósito:** Plataforma web de demostración accesible para la atención presencial de personas sordas usuarias de Lengua de Señas Peruana (LSP) en bancos, comisarías, centros de salud y municipalidades.

---

## 1. Arquitectura y Estructura de Directorios

El proyecto está implementado con **HTML5 semántico**, **CSS3 puro** (variables `:root`) y **JavaScript estándar (ES6+)** sin frameworks de UI ni bundlers (con `@mediapipe/tasks-vision` y `@tensorflow/tfjs@4.22.0` + GraphModels `float16` en `./models/` cargados bajo demanda al activar cámara, además de codificación ISO/IEC 18004 local para el QR SVG), 100 % compatible con **GitHub Pages**.

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
│   └── vision-ai.js            # Cámara IA dual LSP: TensorFlow.js GraphModels bajo demanda (118 señas dinámicas + Alfabeto A–Z + Ñ) sobre MediaPipe + respaldo geométrico
├── models/
│   ├── senas_dinamicas/        # GraphModel TF.js float16 [1, 30, 159] (118 señas dinámicas PUCP LSP) + metadata.json
│   └── alfabeto_lsp/           # GraphModel TF.js float16 [1, 16] (Alfabeto A–Z + reglas dinámicas J, Ñ, Z) + metadata.json
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
  - **Tres canales de comunicación (HU-035):** **Intérprete LSP** (videollamada humana en vivo con transición *Listo → Conectando → En vivo* y **subtítulo en vivo `#sim-interpreter-caption`** sincronizado con turno, chat y emergencias), **Cámara IA (LSP · TensorFlow.js + MediaPipe)** (motor dual cargado bajo demanda con `tf.loadGraphModel` y liberación por frame en `tf.tidy()`: **Modo Señas** sobre `models/senas_dinamicas/` con ventana `[1, 30, 159]` de Pose + 2 Manos para 118 señas dinámicas filtrando `ix`/`g_r` y pausa de `1.2 s`, y **Modo Deletreo** sobre `models/alfabeto_lsp/` con tensor `[1, 16]` estandarizado para el alfabeto A–Z + Ñ con trayectorias dinámicas `J`, `Ñ`, `Z`, estabilización de `0.5 s` y botón `Limpiar` + cambio de modo sin reiniciar cámara; con respaldo geométrico y vista simulada completa `A–Z + Ñ`) y **Texto / Lectura** (chat asistido y dictado de voz).
  - **Roles reales en datos de ventanilla (Heurística H2):** Separación estricta entre **`DNI del ciudadano`** (editable por el ciudadano con *Editar mi DNI* en Ventanilla) y **`Monto / Operación (Ventanilla)`** (mostrado como *Registrado por ventanilla* en la vista ciudadana sin botón de edición, y modificable únicamente por personal/intérprete desde la **Consola del Intérprete** con formato automático `S/ 0.00`).
  - **Modo Emergencia (HU-009, HU-011, HU-014, HU-015):** Acceso permanente en 1 toque con salto de cola `<30 s`, alerta sonora con cierre limpio de `AudioContext`, vibración háptica (`80 ms`) y anillo verde de confirmación en pictogramas, selección única mutuamente excluyente entre los 3 tipos de prioridad y 4 pictogramas de crisis, y sincronización directa con Consola (incluyendo tono de alerta en prueba simulada HU-010).
  - **Consola del Intérprete (P8–P10):** Banner de alerta crítica con aceptación/descarte, ajuste exclusivo del personal para el campo operativo de ventanilla (`Monto`, `Referencia`, `Área` o `Expediente`), turnos sincronizados, **feed en vivo de Mensajes de Ventanilla**, autovista PiP minimizable, bloc de notas, respaldo y **Glosario Técnico LSP (P10)** buscable con favoritos.
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
