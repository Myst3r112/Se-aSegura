# AGENTS.md · Reglas permanentes de desarrollo para SeñaSegura

Toda persona o agente que modifique este repositorio debe cumplir obligatoriamente con las siguientes directrices:

## 1. Arquitectura Vanilla y Dos Vistas (Sin Frameworks de UI ni Bundlers)
- Mantener **HTML5 semántico**, **CSS3 modular** con variables en `:root` (`css/styles.css`) y **JavaScript estándar ES6+** en modo `'use strict'` (`js/main.js`, `js/vision-ai.js`), compatibles entre sí en ambas páginas del producto:
  - `pages/index.html`: Landing Page institucional (P12) con acceso destacado al modo operativo y simulador integrado.
  - `pages/app.html`: Plataforma operativa en pantalla completa (P1–P10, Modo Ventanilla) sin marketing ni verificador/FAQ, compartiendo exactamente `css/styles.css`, `js/main.js` y `js/vision-ai.js` (verificando existencia en el DOM antes de enlazar eventos).
- **Librerías open-source y compatibilidad GitHub Pages:** Se permite integrar librerías open-source ligeras y probadas desde CDN estático con versión fijada (p. ej. `@mediapipe/tasks-vision` vía ES module `import()` bajo demanda) siempre que funcionen 100 % en navegador sin servidor backend, sin paso de compilación/bundler (`Vite`, `Webpack`), sin frameworks de UI (`React`, `Vue`, `Tailwind`) y sin requerir `node_modules` en producción.

## 2. Carga de Scripts y Rendimiento (Lighthouse 100/100)
- Cargar los scripts locales exclusivamente en `<head>` usando `defer` y respetando el orden:
  1. `<script src="../js/main.js?v=N" defer></script>`
  2. `<script src="../js/vision-ai.js?v=N" defer></script>`
- **Carga bajo demanda obligatoria:** librerías externas pesadas de IA/visión (como `@mediapipe/tasks-vision` para `HandLandmarker`) **NUNCA** deben agregarse como `<script>` en HTML ni cargarse al iniciar la página; solo pueden importarse dinámicamente cuando el usuario activa *"Activar Cámara"* en `js/vision-ai.js`. Los códigos QR de cierre se generan localmente con codificación ISO/IEC 18004 en SVG puro sin llamadas de red.
- Mantener `<link rel="preload">` para las fuentes locales `woff2`, `fetchpriority="high"` únicamente en la imagen principal del Hero y `loading="lazy" decoding="async"` en las imágenes debajo del pliegue y modales.

## 3. Seguridad Frontend y Manipulación del DOM
- **Prohibido usar `innerHTML`, `outerHTML` o `insertAdjacentHTML`** con cadenas interpoladas, datos dinámicos o entradas de usuario.
- Construir todo nodo HTML o SVG dinámico mediante `document.createElement`, `document.createElementNS('http://www.w3.org/2000/svg', ...)`, `textContent` y `replaceChildren()`.

## 4. Calidad de Código, UX (Heurísticas Nielsen) y Control de Recursos
- Aplicar principio **DRY**: mantener una única fuente de verdad para catálogos/gestos (p. ej. `GESTURES` en `js/vision-ai.js`, `SIM_SECTORS` en `js/main.js`) y reutilizar utilidades existentes como `bindTablistArrows()` y `closeDialog()`.
- Separar funciones puras del acceso al DOM (`classifyHand`, `resolveMultiHandGesture`, `detectHorizontalOscillation`, `composeSentence`) manteniendo una interfaz mínima (H8, sin selectores técnicos ni entrenamiento en vivo para el usuario final).
- Preservar claridad de roles (H2: *DNI del ciudadano* editable por el ciudadano en Ventanilla; *Monto / Operación* estrictamente de solo lectura en la vista ciudadana y editable únicamente desde la **Consola del Intérprete / Personal**) y visibilidad de estado (H1: subtítulo en vivo `#sim-interpreter-caption`).
- Liberar obligatoriamente recursos temporales al cambiar contexto, salir o purgar sesión: cancelar `setTimeout`/`setInterval` (usando tokens/épocas para evitar respuestas tardías en el chat), detener pistas `MediaStream` de cámara, cancelar `speechSynthesis` y cerrar instancias de `AudioContext` tras emitir alertas.
- Mantener cero errores/advertencias en consola y eliminar cualquier regla CSS o código JS muerto.

## 5. Accesibilidad WCAG 2.1 AAA y Diseño Visual
- Respetar estrictamente los tokens de diseño de SeñaSegura:
  - Azul Seña `#0F4C81` (`--color-primary`), Navy `#0A2540` (`--color-navy`), Rojo Emergencia `#D92626` (`--color-emergency`), Verde Activo `#15803D` (`--color-success`), Ámbar `#D97706` (`--color-warning`), Fondo `#F8FAFC`, Superficie `#FFFFFF`, Texto `#0F172A` y tipografía `Atkinson Hyperlegible`.
  - Modo Alto Contraste (`html[data-contrast="high"]`): `#121820` / `#F59E0B` / `#FFFFFF` con variables semánticas (`--color-bg`, `--color-border`, `--color-focus`, `--color-text`).
- **CLS = 0 al alternar Alto Contraste:** todo elemento que muestre borde de `2px` en Alto Contraste debe reservar siempre `border: 2px` (transparente o con `--color-border`) en modo normal.
- Garantizar escalado tipográfico `100% / 125% / 150%` sin desbordamiento horizontal en `360px`, `768px`, `1280px` y `1440px`, foco visible de `3px` (`--color-focus`), `scroll-margin-top` adecuado en secciones ancla, focus traps en diálogos/drawer móvil y navegación completa por teclado.

## 6. Sincronización de Caché y Documentación
- Incrementar el parámetro `?v=N` simultáneamente en `pages/index.html` y `pages/app.html` (`styles.css?v=N`, `main.js?v=N`, `vision-ai.js?v=N`) ante cada paquete de cambios desplegado.
- Mantener `docs/README.md` y este archivo `AGENTS.md` actualizados cuando cambie la arquitectura, canales de atención o flujos públicos.
