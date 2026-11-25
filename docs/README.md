# SeñaSegura · Landing Page Institucional y Simulador Interactivo

> **Curso:** UPC – HCI for UX Design (TB2)  
> **Propósito:** Plataforma web de demostración accesible para la atención presencial de personas sordas usuarias de Lengua de Señas Peruana (LSP) en bancos, comisarías, centros de salud y municipalidades.

---

## 1. Arquitectura y Estructura de Directorios

El proyecto está implementado exclusivamente con **HTML5 semántico**, **CSS3 puro** (variables `:root`) y **JavaScript estándar (ES6+)** sin frameworks ni bundlers externos, compatible de forma directa con **GitHub Pages**.

```text
SeñaSegura/
├── index.html                  # Redirección automática a pages/index.html (GitHub Pages)
├── favicon.ico                 # Icono institucional de SeñaSegura
├── .gitignore                  # Reglas de exclusión para control de versiones
├── pages/
│   └── index.html              # Landing Page completa y Simulador Interactivo
├── css/
│   └── styles.css              # Tokens oficiales, layout responsive, Alto Contraste y @media print
├── js/
│   ├── main.js                 # Lógica modular en Vanilla JS (ES6+)
│   └── vision-ai.js            # Cámara IA (Gestos): MediaPipe Hands cargado bajo demanda (jsDelivr, versión fijada)
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
- **Simulador Interactivo Core:**
  - Dos vistas sincronizadas: **Ventanilla (Ciudadano/Personal)** y **Consola del Intérprete (P8–P10)**.
  - **Tres canales de comunicación (HU-035):** **Intérprete LSP** (videollamada humana en vivo con transición *Listo → Conectando → En vivo*), **Cámara IA (Gestos)** (carga bajo demanda de MediaPipe Hands con soporte de **2 manos / 42 landmarks**, gestos estáticos y dinámicos por trayectoria, **entrenador local k-NN Few-Shot de señas personalizadas** sin servidor, voz automática opcional al funcionario, barra de progreso en tiempo real y cuadrícula de simulación sin cámara) y **Texto / Lectura** (chat asistido y dictado de voz).
  - **Edición en vivo de datos y contexto sectorial:** Selección de sector (*Banco*, *Comisaría*, *Salud*, *Municipal*) y trámite, con **edición en vivo de DNI / Monto** (y campos del sector) sincronizada instantáneamente con plantillas rápidas, dictado y la Consola del Intérprete.
  - **Modo Emergencia (HU-009, HU-011, HU-014, HU-015):** Botón rojo `#D92626` con salto de cola `<30 s`, alerta sonora/visual, tipos de emergencia, 4 pictogramas de crisis y sincronización directa con la alerta crítica en Consola.
  - **Consola del Intérprete (P8–P10):** Banner de alerta crítica prioritaria con aceptación en tiempo real (o descarte en modo simulación), indicador interactivo de turnos (`Interpretando a LSP` / `Voz a funcionario`), **feed sincronizado en vivo de Mensajes de Ventanilla**, vista PiP minimizable, bloc de notas con purga local, solicitud de respaldo y **Glosario Técnico LSP (P10)** buscable por categoría y con favoritos.
  - **Videollamada HD, Controles y Contingencia (HU-017, HU-018, HU-021, HU-023, HU-040):** Controles de micrófono, cámara, cambio de ángulo y pantalla completa centrada, además del botón `Simular microcorte` con reconexión automática sin pérdida del historial.
- **Cierre, Calificación, Trazabilidad y Verificador Web (P6 · HU-025, HU-026, HU-029, HU-031, HU-032):**
  - Generación de código único de 8 dígitos (`SEG-XXXXXXXX`) con botón de copiado rápido, código QR dinámico en SVG, descarga de constancia, vista previa PDF con descarga e impresión directa (`@media print`), **calificación opcional de la experiencia en cierre (P6)** y purga local inmediata (incluyendo detención y limpieza de Cámara IA).
  - Verificador web capaz de validar el ejemplo base (`SEG-84920` o `84920`) y los códigos generados en sesión con estado visual diferenciado.
- **Respaldo Normativo, FAQ y Formulario B2G/B2B (HU-042, HU-043, HU-044, HU-048):**
  - Respaldo explícito a la **Ley N.° 29535** (Lengua de Señas Peruana), **Ley N.° 29733** (Protección de Datos Personales) y política de **No grabación de video**, con modal de *Ficha de Conformidad*.
  - Acordeón de FAQ filtrable por categoría con modal de apoyo visual en LSP.
  - Formulario B2G/B2B con validación JavaScript en tiempo real y modal de confirmación.

---

## 4. Créditos del Equipo (UPC · HCI for UX Design)

- **Proyecto:** SeñaSegura – TB2
- **Equipo de Diseño UX/UI y Desarrollo Frontend:** *Integrantes del equipo SeñaSegura (UPC)*
- **Sistema de Diseño Fuente:** Figma (`SeñaSegura - Diseño UX/UI TB2`)
