/**
 * SeñaSegura · Interactividad modular en Vanilla JS (ES6+)
 * Cubre las 30 Historias de Usuario Core (accesibilidad global, simulador bimodal,
 * modo emergencia <30s, microcorte, cierre con QR/purga, verificador, FAQ LSP y demo B2G/B2B).
 */
(() => {
  'use strict';

  /* =========================================================
     1. DATOS DE REFERENCIA (SECTORES, TRÁMITES Y COMPROBANTES)
     ========================================================= */
  const SECTOR_CASES = {
    bancos: {
      title: 'Agencias Bancarias',
      subtitle: 'Operaciones claras, decisiones informadas.',
      desc: 'Consulta de saldo, apertura de cuentas y explicación de montos con Mensajería Asistida. Un intérprete LSP acompaña las situaciones que necesitan mayor precisión.',
      steps: [
        'Inicia con un toque',
        'Elige LSP, Cámara IA o Texto/Lectura',
        'Finaliza con tu comprobante'
      ]
    },
    comisarias: {
      title: 'Comisarías',
      subtitle: 'Denuncias y orientación con respaldo inmediato.',
      desc: 'Registro de denuncias, constataciones y toma de declaración sin barreras ni intermediarios. El Modo Emergencia prioriza la conexión LSP en menos de 30 segundos.',
      steps: [
        'Activa Atención o Emergencia',
        'Selecciona el pictograma o trámite',
        'Obtén tu código de trazabilidad'
      ]
    },
    salud: {
      title: 'Centros de Salud',
      subtitle: 'Triaje y consentimiento informado sin malentendidos.',
      desc: 'Explicación clara de síntomas, recetas, dosis y procedimientos médicos con apoyo visual y enlace prioritario a intérprete LSP en urgencias.',
      steps: [
        'Indica síntoma o urgencia',
        'Confirma indicaciones en texto claro',
        'Cierra con purga local garantizada'
      ]
    }
  };

  const SIM_SECTORS = {
    Banco: {
      subtitle: 'Banco · Datos de ejemplo',
      prompt: 'Por favor, confirma tu DNI y el monto de la operación.',
      editBtnLabel: 'Editar DNI y Monto',
      dataFields: [
        { label: 'DNI', value: '00000000' },
        { label: 'Monto', value: 'S/ 150.00' }
      ],
      procedures: [
        'Consulta de saldo y retiro',
        'Apertura de cuenta',
        'Bloqueo o reposición de tarjeta'
      ],
      templates: [
        {
          label: 'Confirmar DNI y monto',
          getText: (fields) => `Confirmo mi ${fields[0].label}: ${fields[0].value} y ${fields[1].label.toLowerCase()} ${fields[1].value}.`
        },
        { label: 'Repetir en LSP', text: 'Por favor, repite en Lengua de Señas Peruana.' },
        { label: 'Pedir constancia', text: 'Necesito constancia impresa de la operación.' }
      ],
      dictationSample: 'Operación bancaria validada por S/ 150.00 en ventanilla.'
    },
    Comisaría: {
      subtitle: 'Comisaría · Datos de ejemplo',
      prompt: 'Indícanos el motivo de tu denuncia o constancia policial.',
      editBtnLabel: 'Editar datos',
      dataFields: [
        { label: 'DNI', value: '00000000' },
        { label: 'Referencia', value: 'Parte N.° 2026-041' }
      ],
      procedures: [
        'Registro de denuncia policial',
        'Constancia por pérdida de documentos',
        'Orientación sobre medidas de protección'
      ],
      templates: [
        {
          label: 'Registrar denuncia',
          getText: (fields) => `Deseo registrar una denuncia con intérprete LSP (${fields[0].label}: ${fields[0].value} · ${fields[1].label}: ${fields[1].value}).`
        },
        { label: 'Constancia por pérdida', text: 'Necesito constancia por pérdida de DNI.' },
        { label: 'Atención prioritaria', text: 'Solicito atención prioritaria por emergencia.' }
      ],
      dictationSample: 'Se toma registro de ocurrencia con apoyo de intérprete LSP.'
    },
    Salud: {
      subtitle: 'Centro de Salud · Datos de ejemplo',
      prompt: 'Confirma tus síntomas principales y si presentas alergias.',
      editBtnLabel: 'Editar datos',
      dataFields: [
        { label: 'DNI', value: '00000000' },
        { label: 'Área', value: 'Triaje · Prioridad II' }
      ],
      procedures: [
        'Triaje y consulta médica general',
        'Explicación de receta y dosis',
        'Consentimiento informado de procedimiento'
      ],
      templates: [
        {
          label: 'Solicitar intérprete LSP',
          getText: (fields) => `Tengo dolor agudo y necesito intérprete LSP (${fields[0].label}: ${fields[0].value} · ${fields[1].label}: ${fields[1].value}).`
        },
        { label: 'Sin alergias', text: 'No presento alergias conocidas a medicamentos.' },
        { label: 'Escribir horarios', text: 'Por favor, escribe los horarios de la receta.' }
      ],
      dictationSample: 'Indicaciones médicas registradas: tomar 1 tableta cada 8 horas.'
    },
    Municipal: {
      subtitle: 'Municipalidad · Datos de ejemplo',
      prompt: 'Indica el número de expediente o trámite municipal.',
      editBtnLabel: 'Editar datos',
      dataFields: [
        { label: 'DNI', value: '00000000' },
        { label: 'Expediente', value: '00412-2026' }
      ],
      procedures: [
        'Mesa de partes y seguimiento',
        'Licencia de funcionamiento',
        'Pago de arbitrios y fraccionamiento'
      ],
      templates: [
        {
          label: 'Consultar expediente',
          getText: (fields) => `Consulto el estado de mi ${fields[1].label.toLowerCase()} ${fields[1].value} (${fields[0].label}: ${fields[0].value}).`
        },
        { label: 'Ayuda en texto claro', text: 'Necesito ayuda con el formulario en texto claro.' },
        {
          label: 'Confirmar datos',
          getText: (fields) => `Confirmo mis datos (${fields[0].label}: ${fields[0].value} · ${fields[1].label}: ${fields[1].value}) para mesa de partes.`
        }
      ],
      dictationSample: 'Expediente 00412-2026 verificado en mesa de partes accesible.'
    }
  };

  /* Términos del Glosario Técnico LSP (Figma P10) */
  const GLOSSARY_TERMS = [
    {
      id: 'medida-cautelar',
      term: 'Medida Cautelar',
      category: 'Legal/Policial',
      definition: 'Disposición urgente emitida para proteger a la persona denunciante o asegurar un derecho antes de la resolución final.'
    },
    {
      id: 'denuncia',
      term: 'Denuncia',
      category: 'Legal/Policial',
      definition: 'Declaración formal ante comisaría o fiscalía sobre un delito, agresión o pérdida de documentos para iniciar atención oficial.'
    },
    {
      id: 'consentimiento',
      term: 'Consentimiento',
      category: 'Legal/Policial',
      definition: 'Autorización libre e informada de la persona usuaria, explicada en LSP o texto claro, antes de ejecutar un trámite o acto médico.'
    },
    {
      id: 'cci',
      term: 'CCI',
      category: 'Bancario/Financiero',
      definition: 'Código de Cuenta Interbancario de 20 dígitos usado para enviar o recibir transferencias entre distintas entidades financieras del Perú.'
    },
    {
      id: 'amortizacion',
      term: 'Amortización',
      category: 'Bancario/Financiero',
      definition: 'Pago parcial o total destinado a reducir el capital pendiente de un crédito o préstamo bancario.'
    },
    {
      id: 'bloqueo-tarjeta',
      term: 'Bloqueo de Tarjeta',
      category: 'Bancario/Financiero',
      definition: 'Suspensión inmediata de una tarjeta de débito o crédito por pérdida, robo o consumo no reconocido.'
    }
  ];

  /* Canales de comunicación del simulador (HU-035) */
  const CHANNEL_INFO = {
    lsp: { badge: 'Intérprete LSP', meta: 'LSP HD', receipt: 'Lengua de Señas Peruana', oneTap: 'Lengua de Señas Peruana' },
    camara: { badge: 'Cámara IA (Gestos)', meta: 'Cámara IA', receipt: 'Cámara IA (Gestos)', oneTap: 'Cámara IA (Gestos)' },
    texto: { badge: 'Texto / Lectura', meta: 'Texto/Lectura', receipt: 'Texto / Lectura', oneTap: 'Texto / Lectura' }
  };

  /* Registro de comprobantes verificables en sesión + ejemplo oficial SEG-84920 */
  const receiptRegistry = new Map([
    [
      'SEG-84920',
      {
        code: 'SEG-84920',
        sector: 'Banco',
        procedure: 'Consulta de saldo y retiro',
        channel: 'Lengua de Señas Peruana',
        status: 'Atención finalizada · Cierre confirmado',
        timestamp: 'Ejemplo institucional',
        isDemoBase: true
      }
    ]
  ]);

  /* =========================================================
     2. ESTADO GLOBAL DE LA APLICACIÓN
     ========================================================= */
  const state = {
    contrast: 'normal',
    fontScale: '100',
    simView: 'ventanilla',
    sessionActive: false,
    connecting: false,
    channel: 'lsp',
    sector: 'Banco',
    procedure: 'Consulta de saldo y retiro',
    emergencyActive: false,
    emergencyType: null,
    selectedCrisis: null,
    turnDirection: 'lsp', // 'lsp' | 'funcionario'
    micMuted: false,
    cameraOff: false,
    cameraAngle: 'Frontal · Intérprete LSP',
    outageActive: false,
    dictating: false,
    sensitiveFields: [
      { label: 'DNI', value: '00000000' },
      { label: 'Monto', value: 'S/ 150.00' }
    ],
    interpreterStatus: 'Disponible',
    criticalAlertActive: false,
    criticalAccepted: false,
    criticalFromConsoleSim: false,
    glossaryCategory: 'Todos',
    glossaryQuery: '',
    glossaryFavorites: new Set(),
    chatMessages: [
      {
        sender: 'Personal de ventanilla',
        type: 'staff',
        text: 'Por favor, confirma tu DNI y el monto de la operación.'
      }
    ],
    lastReceiptCode: 'SEG-84920'
  };

  /* =========================================================
     3. UTILIDADES DE ACCESIBILIDAD Y MODALES
     ========================================================= */
  const htmlEl = document.documentElement;
  let lastTriggerElement = null;

  function openDialog(dialogId, triggerEl) {
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    lastTriggerElement = triggerEl || document.activeElement;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
  }

  function closeDialog(dialogId, { restoreFocus = true } = {}) {
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    if (restoreFocus && lastTriggerElement && typeof lastTriggerElement.focus === 'function') {
      lastTriggerElement.focus();
    }
    lastTriggerElement = null;
  }

  function bindTablistArrows(tabs, onSelect) {
    if (!tabs || !tabs.length) return;
    tabs.forEach((tab, index) => {
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = tabs[(index + 1) % tabs.length];
          next.focus();
          onSelect(next);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const prev = tabs[(index - 1 + tabs.length) % tabs.length];
          prev.focus();
          onSelect(prev);
        }
      });
    });
  }

  function initAccessibilityControls() {
    const contrastBtn = document.getElementById('btn-contrast-toggle');
    const decreaseBtn = document.getElementById('btn-font-decrease');
    const increaseBtn = document.getElementById('btn-font-increase');
    const presetBtns = document.querySelectorAll('.btn-scale-preset, .btn-scale-preset-mobile');
    const statusText = document.getElementById('a11y-status-text');
    const mobileStatusText = document.getElementById('mobile-a11y-status');

    const SCALES = ['100', '125', '150'];

    function updateA11yStatus() {
      const label = state.contrast === 'high'
        ? `Alto contraste: Sí · ${state.fontScale}%`
        : `Alto contraste: No · ${state.fontScale}%`;
      if (statusText) statusText.textContent = label;
      if (mobileStatusText) mobileStatusText.textContent = label;
    }

    function applyContrast(mode) {
      state.contrast = mode === 'high' ? 'high' : 'normal';
      htmlEl.setAttribute('data-contrast', state.contrast);
      if (contrastBtn) {
        contrastBtn.setAttribute('aria-checked', String(state.contrast === 'high'));
      }
      updateA11yStatus();
      try {
        localStorage.setItem('ss_contrast', state.contrast);
      } catch (_) {}
    }

    function applyFontScale(scale) {
      if (!SCALES.includes(scale)) return;
      state.fontScale = scale;
      htmlEl.setAttribute('data-font-scale', scale);
      presetBtns.forEach((btn) => {
        const active = btn.dataset.scale === scale;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      updateA11yStatus();
      try {
        localStorage.setItem('ss_font_scale', scale);
      } catch (_) {}
    }

    if (contrastBtn) {
      contrastBtn.addEventListener('click', () => {
        applyContrast(state.contrast === 'high' ? 'normal' : 'high');
      });
    }

    if (decreaseBtn) {
      decreaseBtn.addEventListener('click', () => {
        const idx = SCALES.indexOf(state.fontScale);
        if (idx > 0) applyFontScale(SCALES[idx - 1]);
      });
    }

    if (increaseBtn) {
      increaseBtn.addEventListener('click', () => {
        const idx = SCALES.indexOf(state.fontScale);
        if (idx < SCALES.length - 1) applyFontScale(SCALES[idx + 1]);
      });
    }

    presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => applyFontScale(btn.dataset.scale));
    });

    // Restaurar preferencias previas si existen
    try {
      const savedContrast = localStorage.getItem('ss_contrast');
      const savedScale = localStorage.getItem('ss_font_scale');
      if (savedContrast === 'high') applyContrast('high');
      if (savedScale && SCALES.includes(savedScale)) applyFontScale(savedScale);
    } catch (_) {}
  }

  /* =========================================================
     4. MENÚ HAMBURGUESA MÓVIL (<768px)
     ========================================================= */
  function initMobileDrawer() {
    const openBtn = document.getElementById('btn-mobile-menu');
    const closeBtn = document.getElementById('btn-close-mobile-menu');
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!openBtn || !closeBtn || !drawer) return;

    function toggleDrawer(open) {
      drawer.hidden = !open;
      openBtn.setAttribute('aria-expanded', String(open));
      if (open) {
        closeBtn.focus();
      } else {
        openBtn.focus();
      }
    }

    openBtn.addEventListener('click', () => toggleDrawer(true));
    closeBtn.addEventListener('click', () => toggleDrawer(false));

    drawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        drawer.hidden = true;
        openBtn.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('keydown', (e) => {
      if (drawer.hidden) return;
      if (e.key === 'Escape') {
        toggleDrawer(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = Array.from(
          drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
        ).filter((el) => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !drawer.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last || !drawer.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  /* =========================================================
     5. KPIs DINÁMICOS ANIMADOS Y PESTAÑAS POR SECTOR
     ========================================================= */
  function initImpactSection() {
    const kpiValues = document.querySelectorAll('.kpi-value[data-kpi-type]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function animateKpis() {
      if (prefersReducedMotion) return;
      kpiValues.forEach((el) => {
        const type = el.dataset.kpiType;
        const duration = 1100;
        const startTime = performance.now();

        function frame(now) {
          const progress = Math.min((now - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);

          if (type === 'count') {
            const target = Number(el.dataset.target);
            const current = Math.round(target * eased);
            const formatted = el.dataset.separator ? current.toLocaleString('en-US') : String(current);
            el.textContent = `${el.dataset.prefix || ''}${formatted}${el.dataset.suffix || ''}`;
          } else if (type === 'countdown') {
            const target = Number(el.dataset.target);
            const current = Math.max(target, Math.round(60 - 30 * eased));
            el.textContent = `${el.dataset.prefix || ''}${current}${el.dataset.suffix || ''}`;
          } else if (type === 'minutes') {
            const start = Number(el.dataset.start);
            const end = Number(el.dataset.end);
            const current = Math.round(start - (start - end) * eased);
            el.textContent = `20 → ${current} min`;
          }

          if (progress < 1) {
            requestAnimationFrame(frame);
          }
        }
        requestAnimationFrame(frame);
      });
    }

    const kpiGrid = document.getElementById('kpi-grid');
    if (kpiGrid && 'IntersectionObserver' in window) {
      let played = false;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting) && !played) {
            played = true;
            animateKpis();
            observer.disconnect();
          }
        },
        { threshold: 0.3 }
      );
      observer.observe(kpiGrid);
    }

    // Pestañas por sector
    const sectorTabs = document.querySelectorAll('.sector-tab[data-sector-key]');
    const panelTitle = document.getElementById('sector-panel-title');
    const panelSubtitle = document.getElementById('sector-panel-subtitle');
    const panelDesc = document.getElementById('sector-panel-desc');
    const panelSteps = document.getElementById('sector-panel-steps');
    const panel = document.getElementById('panel-sector');

    function selectSectorTab(tab) {
      const key = tab.dataset.sectorKey;
      const data = SECTOR_CASES[key];
      if (!data) return;

      sectorTabs.forEach((btn) => {
        const active = btn === tab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', String(active));
      });

      if (panel) panel.setAttribute('aria-labelledby', tab.id);
      if (panelTitle) panelTitle.textContent = data.title;
      if (panelSubtitle) panelSubtitle.textContent = data.subtitle;
      if (panelDesc) panelDesc.textContent = data.desc;
      if (panelSteps) {
        panelSteps.textContent = '';
        data.steps.forEach((step, i) => {
          const li = document.createElement('li');
          const num = document.createElement('span');
          num.className = 'step-num';
          num.textContent = `0${i + 1}`;
          li.append(num, ` ${step}`);
          panelSteps.appendChild(li);
        });
      }
    }

    sectorTabs.forEach((tab) => {
      tab.addEventListener('click', () => selectSectorTab(tab));
    });
    bindTablistArrows(sectorTabs, selectSectorTab);
  }

  /* =========================================================
     6. SIMULADOR INTERACTIVO CORE + CONTINGENCIA + CONSOLA
     ========================================================= */
  function playEmergencyTone() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.14);
        gain.gain.setValueAtTime(0.08, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 0.14);
      });
      setTimeout(() => {
        if (typeof ctx.close === 'function' && ctx.state !== 'closed') {
          ctx.close().catch(() => {});
        }
      }, 450);
    } catch (_) {
      // Silencio seguro si el navegador restringe Web Audio
    }
  }

  function generate8DigitCode() {
    const randomPart = Math.floor(10000000 + Math.random() * 89999999);
    return `SEG-${randomPart}`;
  }

  /**
   * Genera un código QR determinista en nodo SVG para códigos dinámicos de 8 dígitos.
   */
  function buildDynamicQrSvg(code) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const size = 21;
    const cell = 6;
    const margin = 11;
    const total = size * cell + margin * 2;
    let seed = 0;
    for (let i = 0; i < code.length; i += 1) {
      seed = (seed * 31 + code.charCodeAt(i)) >>> 0;
    }

    function isFinder(r, c) {
      const inTopLeft = r < 7 && c < 7;
      const inTopRight = r < 7 && c >= size - 7;
      const inBottomLeft = r >= size - 7 && c < 7;
      return inTopLeft || inTopRight || inBottomLeft;
    }

    function finderFilled(r, c) {
      const lr = r < 7 ? r : r - (size - 7);
      const lc = c < 7 ? c : c - (size - 7);
      if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return true;
      if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return true;
      return false;
    }

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '148');
    svg.setAttribute('height', '148');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Código QR ${code}`);

    const bg = document.createElementNS(svgNs, 'rect');
    bg.setAttribute('width', String(total));
    bg.setAttribute('height', String(total));
    bg.setAttribute('fill', '#FFFFFF');
    svg.appendChild(bg);

    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        let dark = false;
        if (isFinder(r, c)) {
          dark = finderFilled(r, c);
        } else {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          dark = (seed & 3) !== 0;
        }
        if (dark) {
          const rect = document.createElementNS(svgNs, 'rect');
          rect.setAttribute('x', String(margin + c * cell));
          rect.setAttribute('y', String(margin + r * cell));
          rect.setAttribute('width', String(cell));
          rect.setAttribute('height', String(cell));
          rect.setAttribute('fill', '#0A2540');
          svg.appendChild(rect);
        }
      }
    }

    return svg;
  }

  function initSimulator() {
    const viewTabs = document.querySelectorAll('.sim-view-tab[data-sim-view]');
    const viewVentanilla = document.getElementById('sim-view-ventanilla');
    const viewConsola = document.getElementById('sim-view-consola');
    const btnConsoleBack = document.getElementById('btn-console-back');

    const stepsGuide = document.getElementById('sim-steps-guide');
    const stepItems = stepsGuide ? stepsGuide.querySelectorAll('.sim-step-item[data-sim-step]') : [];

    const sessionMeta = document.getElementById('sim-session-meta');
    const btnOneTap = document.getElementById('btn-one-tap-start');
    const btnOneTapLabel = document.getElementById('btn-one-tap-label');
    const btnEmergency = document.getElementById('btn-emergency-mode');
    const btnExitEmergency = document.getElementById('btn-exit-emergency');
    const emergencyPanel = document.getElementById('emergency-panel');
    const emergencyQueueTimer = document.getElementById('emergency-queue-timer');
    const emergencyTypeBtns = document.querySelectorAll('.emergency-type-btn[data-emergency-type]');
    const crisisCards = document.querySelectorAll('.crisis-card[data-crisis]');

    const channelChips = document.querySelectorAll('.pref-chip[data-channel]');
    const sectorChips = document.querySelectorAll('.pref-chip[data-sim-sector]');
    const procedureSelect = document.getElementById('sim-procedure-select');

    const textModeCard = document.getElementById('sim-textmode-card');
    const textSwitchBtns = document.querySelectorAll('[data-switch-channel]');
    const videoStage = document.getElementById('sim-video-stage');
    const videoBadgesRow = document.getElementById('sim-video-badges');
    const callControls = document.getElementById('sim-call-controls');
    const connectingOverlay = document.getElementById('sim-connecting-overlay');
    const connectingCountdown = document.getElementById('sim-connecting-countdown');
    const btnCancelConnect = document.getElementById('btn-cancel-connect');
    const btnEscalateConnect = document.getElementById('btn-escalate-connect');
    const visionPanel = document.getElementById('vision-panel');
    const channelBadge = document.getElementById('sim-channel-badge');
    const channelBadgeText = document.getElementById('sim-channel-badge-text');
    const cameraOffOverlay = document.getElementById('sim-camera-off-overlay');
    const cameraAngleLabel = document.getElementById('sim-camera-angle');
    const liveBadge = document.getElementById('sim-live-badge');

    const btnToggleTurn = document.getElementById('btn-toggle-turn');
    const simTurnLabel = document.getElementById('sim-turn-label');
    const consoleTurnStatus = document.getElementById('console-turn-status');
    const fullscreenTurnLabel = document.getElementById('fullscreen-turn-label');
    const btnConsoleToLsp = document.getElementById('btn-console-to-lsp');
    const btnConsoleToEs = document.getElementById('btn-console-to-es');

    const btnMic = document.getElementById('btn-call-mic');
    const btnCamera = document.getElementById('btn-call-camera');
    const btnSwitch = document.getElementById('btn-call-switch');
    const btnFullscreen = document.getElementById('btn-call-fullscreen');
    const btnHangup = document.getElementById('btn-call-hangup');
    const btnFinishSession = document.getElementById('btn-finish-session');

    const btnOutage = document.getElementById('btn-simulate-outage');
    const contingencyBanner = document.getElementById('contingency-banner');
    const contingencyMsg = document.getElementById('contingency-message');
    const simNetworkStatus = document.getElementById('sim-network-status');
    const simNetworkLabel = document.getElementById('sim-network-label');
    const consoleNetworkLabel = document.getElementById('console-network-label');
    const headerNetworkPill = document.getElementById('header-network-pill');

    const chatSectorLabel = document.getElementById('sim-chat-sector-label');
    const consoleSectorLabel = document.getElementById('console-sector-label');
    const sensitiveDataBox = document.getElementById('sim-sensitive-data');
    const consoleDataBox = document.getElementById('console-data-block');
    const consolePriorityVal = document.getElementById('console-priority-value');
    const consoleProcedureVal = document.getElementById('console-procedure-value');
    const chatMessagesBox = document.getElementById('sim-chat-messages');
    const consoleChatFeed = document.getElementById('console-chat-feed');
    const quickTemplatesBox = document.getElementById('sim-quick-templates');
    const btnCopyData = document.getElementById('btn-copy-data');
    const btnEditData = document.getElementById('btn-edit-data');
    const sensitiveEditForm = document.getElementById('sensitive-edit-form');
    const editLabel1 = document.getElementById('edit-label-1');
    const editLabel2 = document.getElementById('edit-label-2');
    const editField1 = document.getElementById('edit-field-1');
    const editField2 = document.getElementById('edit-field-2');
    const sensitiveEditError = document.getElementById('sensitive-edit-error');
    const btnCancelEditData = document.getElementById('btn-cancel-edit-data');
    const chatForm = document.getElementById('sim-chat-form');
    const chatInput = document.getElementById('sim-chat-input');
    const btnVoiceDictation = document.getElementById('btn-voice-dictation');

    // Consola del Intérprete (P8, P9, P10)
    const interpreterStatusChips = document.querySelectorAll('.console-status-chip[data-interpreter-status]');
    const consoleInterpreterState = document.getElementById('console-interpreter-state');
    const btnConsoleSimAlert = document.getElementById('btn-console-sim-alert');
    const consoleCriticalBanner = document.getElementById('console-critical-banner');
    const consoleCriticalTitle = document.getElementById('console-critical-title');
    const consoleCriticalSub = document.getElementById('console-critical-sub');
    const btnAcceptCritical = document.getElementById('btn-accept-critical-emergency');
    const btnDismissCriticalSim = document.getElementById('btn-dismiss-critical-sim');
    const consolePipBox = document.getElementById('console-pip-box');
    const consolePipPreview = document.getElementById('console-pip-preview');
    const btnTogglePip = document.getElementById('btn-toggle-pip');
    const btnConsoleSupport = document.getElementById('btn-console-support');
    const consoleSupportNotice = document.getElementById('console-support-notice');
    const consolePrivateNotes = document.getElementById('console-private-notes');
    const btnOpenGlossary = document.getElementById('btn-open-glossary');

    // Glosario LSP (P10)
    const glossarySearch = document.getElementById('glossary-search');
    const glossaryFilterBtns = document.querySelectorAll('.glossary-filter-btn[data-glossary-filter]');
    const glossaryList = document.getElementById('glossary-list');
    const glossaryEmpty = document.getElementById('glossary-empty');

    // Calificación de cierre (P6)
    const closureRatingBtns = document.querySelectorAll('.closure-rating-btn[data-rating]');
    const closureRatingFeedback = document.getElementById('closure-rating-feedback');

    let emergencyInterval = null;
    let connectingTimer = null;
    let connectingStepTimer = null;
    let dictTimer = null;
    let chatEpoch = 0;

    function switchSimulatorView(viewName) {
      state.simView = viewName;
      const isVentanilla = viewName === 'ventanilla';
      if (viewVentanilla) viewVentanilla.hidden = !isVentanilla;
      if (viewConsola) viewConsola.hidden = isVentanilla;
      viewTabs.forEach((tab) => {
        const active = tab.dataset.simView === viewName;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
    }

    viewTabs.forEach((tab) => {
      tab.addEventListener('click', () => switchSimulatorView(tab.dataset.simView));
    });
    bindTablistArrows(viewTabs, (tab) => switchSimulatorView(tab.dataset.simView));

    if (btnConsoleBack) {
      btnConsoleBack.addEventListener('click', () => switchSimulatorView('ventanilla'));
    }

    function renderChat() {
      [chatMessagesBox, consoleChatFeed].forEach((container) => {
        if (!container) return;
        container.textContent = '';
        state.chatMessages.forEach((msg) => {
          const bubble = document.createElement('div');
          bubble.className = `chat-bubble${msg.type === 'user' ? ' chat-bubble-user' : ''}`;

          const senderEl = document.createElement('span');
          senderEl.className = 'chat-sender';
          senderEl.textContent = msg.sender;

          const textEl = document.createElement('p');
          textEl.textContent = msg.text;

          bubble.append(senderEl, textEl);
          container.appendChild(bubble);
        });
        container.scrollTop = container.scrollHeight;
      });
    }

    function appendMessage(sender, text, type = 'staff') {
      state.chatMessages.push({ sender, text, type });
      renderChat();
    }

    function updateStepsGuide() {
      if (!stepItems.length) return;
      let currentStep = 1;
      if (state.connecting || state.sessionActive || state.emergencyActive) {
        currentStep = state.chatMessages.length > 1 ? 3 : 2;
      }

      stepItems.forEach((item) => {
        const num = Number(item.dataset.simStep);
        item.classList.toggle('is-done', num < currentStep);
        item.classList.toggle('is-current', num === currentStep);
      });
    }

    function updateOneTapButton() {
      if (!btnOneTap) return;
      const labelEl = btnOneTapLabel || btnOneTap.querySelector('span');
      btnOneTap.classList.remove('is-active-session', 'is-connecting');

      if (state.connecting) {
        btnOneTap.disabled = true;
        btnOneTap.classList.add('is-connecting');
        if (labelEl) labelEl.textContent = 'Conectando intérprete (<30 s)…';
      } else if (state.sessionActive) {
        btnOneTap.disabled = false;
        btnOneTap.classList.add('is-active-session');
        if (labelEl) labelEl.textContent = 'Atención en curso (En línea)';
      } else {
        btnOneTap.disabled = false;
        if (labelEl) labelEl.textContent = 'Iniciar Atención (One-Tap)';
      }
    }

    function scrollToActiveChannel(focusInput = false) {
      if (state.channel === 'camara') {
        if (visionPanel) visionPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (focusInput) {
          const btnVisionStart = document.getElementById('btn-vision-start');
          if (btnVisionStart && !btnVisionStart.disabled) btnVisionStart.focus({ preventScroll: true });
        }
      } else if (state.channel === 'texto') {
        if (textModeCard) textModeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (focusInput && chatInput) chatInput.focus({ preventScroll: true });
      } else if (videoStage) {
        videoStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function updateLiveBadge() {
      if (!liveBadge) return;
      liveBadge.classList.remove('is-emergency', 'is-ready', 'is-connecting');
      if (state.emergencyActive) {
        liveBadge.textContent = 'EMERGENCIA · HD';
        liveBadge.classList.add('is-emergency');
      } else if (state.connecting) {
        liveBadge.textContent = 'CONECTANDO…';
        liveBadge.classList.add('is-connecting');
      } else if (state.sessionActive) {
        liveBadge.textContent = 'EN VIVO · HD';
      } else {
        liveBadge.textContent = 'LISTO PARA INICIAR';
        liveBadge.classList.add('is-ready');
      }
    }

    function updateTurnLabels() {
      const isLsp = state.turnDirection === 'lsp';
      const label = isLsp ? 'Interpretando a LSP' : 'Voz a funcionario';
      if (simTurnLabel) simTurnLabel.textContent = label;
      if (consoleTurnStatus) consoleTurnStatus.textContent = label;
      if (fullscreenTurnLabel) fullscreenTurnLabel.textContent = label;
      if (btnConsoleToLsp) {
        btnConsoleToLsp.classList.toggle('btn-primary', isLsp);
        btnConsoleToLsp.classList.toggle('btn-secondary', !isLsp);
        btnConsoleToLsp.setAttribute('aria-pressed', String(isLsp));
      }
      if (btnConsoleToEs) {
        btnConsoleToEs.classList.toggle('btn-primary', !isLsp);
        btnConsoleToEs.classList.toggle('btn-secondary', isLsp);
        btnConsoleToEs.setAttribute('aria-pressed', String(!isLsp));
      }
    }

    function updateSessionMeta() {
      if (!sessionMeta) return;
      const channelLabel = (CHANNEL_INFO[state.channel] || CHANNEL_INFO.lsp).meta;
      const statusLabel = state.emergencyActive
        ? 'EMERGENCIA PRIORITARIA (<30 s)'
        : state.connecting
          ? 'Conectando intérprete LSP (<30 s)…'
          : state.sessionActive
            ? 'Atención en curso'
            : 'Sesión lista para iniciar';
      sessionMeta.textContent = `Sin login · ${statusLabel} · ${state.sector} (${channelLabel})`;
    }

    function renderSensitiveData() {
      const fields = state.sensitiveFields;
      [sensitiveDataBox, consoleDataBox].forEach((container) => {
        if (!container) return;
        container.textContent = '';
        fields.forEach((field) => {
          const p = document.createElement('p');
          p.textContent = `${field.label}: ${field.value}`;
          container.appendChild(p);
        });
      });

      const config = SIM_SECTORS[state.sector];
      if (btnEditData && config) {
        btnEditData.textContent = config.editBtnLabel || 'Editar datos';
      }
    }

    function closeSensitiveEditForm(restoreFocus = false) {
      if (!sensitiveEditForm) return;
      sensitiveEditForm.hidden = true;
      if (sensitiveEditError) {
        sensitiveEditError.hidden = true;
        sensitiveEditError.textContent = '';
      }
      if (btnEditData) {
        btnEditData.setAttribute('aria-expanded', 'false');
        if (restoreFocus) btnEditData.focus();
      }
    }

    function updateConsolePriorityContext() {
      if (!consolePriorityVal) return;
      if (!state.emergencyActive) {
        consolePriorityVal.textContent = 'Atención de prueba';
        return;
      }
      const parts = [state.emergencyType, state.selectedCrisis].filter(Boolean);
      consolePriorityVal.textContent = parts.length
        ? `EMERGENCIA (<30 s) · ${parts.join(' / ')}`
        : 'EMERGENCIA PRIORITARIA (<30 s)';
    }

    function updateCriticalBanner() {
      if (!consoleCriticalBanner) return;
      const active = state.criticalAlertActive || state.emergencyActive;
      consoleCriticalBanner.hidden = !active;
      if (!active) return;

      const detail = [state.emergencyType, state.selectedCrisis].filter(Boolean).join(' · ');
      if (state.criticalAccepted) {
        consoleCriticalBanner.classList.add('is-accepted');
        if (consoleCriticalTitle) {
          consoleCriticalTitle.textContent = detail
            ? `EMERGENCIA ACEPTADA · ${detail} (<30 s)`
            : 'EMERGENCIA ACEPTADA · Comisaría Alfonso Ugarte — Denuncia Policial (<30 s)';
        }
        if (consoleCriticalSub) {
          consoleCriticalSub.textContent = 'Intérprete en sala prioritaria · Atención en vivo sin grabación.';
        }
        if (btnAcceptCritical) {
          btnAcceptCritical.textContent = 'Emergencia aceptada';
          btnAcceptCritical.disabled = true;
        }
        if (btnDismissCriticalSim) btnDismissCriticalSim.hidden = true;
      } else {
        consoleCriticalBanner.classList.remove('is-accepted');
        if (consoleCriticalTitle) {
          consoleCriticalTitle.textContent = detail
            ? `EMERGENCIA CRÍTICA · ${detail} — Atención Prioritaria (<30 s)`
            : 'EMERGENCIA CRÍTICA · Comisaría Alfonso Ugarte — Denuncia Policial (<30 s)';
        }
        if (consoleCriticalSub) {
          consoleCriticalSub.textContent = 'Prioridad máxima en cola · Sin grabación de video';
        }
        if (btnAcceptCritical) {
          btnAcceptCritical.textContent = 'Aceptar Emergencia Ahora';
          btnAcceptCritical.disabled = false;
        }
        if (btnDismissCriticalSim) {
          btnDismissCriticalSim.hidden = !state.criticalFromConsoleSim;
        }
      }
    }

    function setInterpreterStatus(statusLabel) {
      state.interpreterStatus = statusLabel;
      interpreterStatusChips.forEach((chip) => {
        const active = chip.dataset.interpreterStatus === statusLabel;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
      });
      if (consoleInterpreterState) {
        consoleInterpreterState.textContent = statusLabel;
      }
    }

    function stopDictation() {
      if (dictTimer) {
        clearInterval(dictTimer);
        dictTimer = null;
      }
      state.dictating = false;
      if (btnVoiceDictation) {
        btnVoiceDictation.setAttribute('aria-pressed', 'false');
        const btnLabel = btnVoiceDictation.querySelector('span');
        if (btnLabel) btnLabel.textContent = 'Dictado de voz';
      }
    }

    function updateSectorContext(sectorName) {
      chatEpoch += 1;
      stopDictation();
      state.sector = sectorName;
      const config = SIM_SECTORS[sectorName];
      if (!config) return;

      state.sensitiveFields = config.dataFields.map((f) => ({ ...f }));
      closeSensitiveEditForm(false);
      renderSensitiveData();

      if (chatSectorLabel) chatSectorLabel.textContent = config.subtitle;
      if (consoleSectorLabel) consoleSectorLabel.textContent = config.subtitle;
      if (procedureSelect) {
        procedureSelect.textContent = '';
        config.procedures.forEach((proc) => {
          const option = document.createElement('option');
          option.value = proc;
          option.textContent = proc;
          procedureSelect.appendChild(option);
        });
        state.procedure = config.procedures[0];
        if (consoleProcedureVal) consoleProcedureVal.textContent = state.procedure;
      }
      if (quickTemplatesBox) {
        quickTemplatesBox.textContent = '';
        config.templates.forEach((tpl, idx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'template-chip';
          btn.dataset.templateIndex = String(idx);
          btn.textContent = tpl.label;
          quickTemplatesBox.appendChild(btn);
        });
      }

      state.chatMessages = [
        {
          sender: 'Personal de ventanilla',
          type: 'staff',
          text: config.prompt
        }
      ];
      renderChat();
      updateSessionMeta();
      updateLiveBadge();
      updateOneTapButton();
      updateStepsGuide();
    }

    // Delegación para plantillas rápidas (sincronizadas con valores editados en vivo)
    if (quickTemplatesBox) {
      quickTemplatesBox.addEventListener('click', (e) => {
        const chip = e.target.closest('.template-chip');
        if (!chip) return;
        const config = SIM_SECTORS[state.sector];
        const idx = Number(chip.dataset.templateIndex);
        const tpl = config && Number.isInteger(idx) ? config.templates[idx] : null;
        if (!tpl) return;
        const text = typeof tpl.getText === 'function' ? tpl.getText(state.sensitiveFields) : tpl.text;
        if (!text) return;

        state.sessionActive = true;
        updateOneTapButton();
        updateLiveBadge();
        updateSessionMeta();
        appendMessage('Ciudadano (Plantilla)', text, 'user');
        updateStepsGuide();
        const epoch = chatEpoch;
        setTimeout(() => {
          if (epoch !== chatEpoch) return;
          appendMessage('Intérprete LSP / Ventanilla', `Recibido para ${state.procedure}. Continuamos con tu atención.`, 'staff');
        }, 450);
      });
    }

    function cancelConnecting() {
      if (connectingTimer) {
        clearTimeout(connectingTimer);
        connectingTimer = null;
      }
      if (connectingStepTimer) {
        clearTimeout(connectingStepTimer);
        connectingStepTimer = null;
      }
      state.connecting = false;
      if (connectingOverlay) connectingOverlay.hidden = true;
      updateOneTapButton();
      updateLiveBadge();
      updateStepsGuide();
      updateSessionMeta();
    }

    // Inicio One-Tap (HU-001 a HU-005): feedback real, cuenta regresiva y scroll suave
    if (btnOneTap) {
      btnOneTap.addEventListener('click', () => {
        if (state.connecting) return;

        if (state.sessionActive) {
          scrollToActiveChannel(true);
          return;
        }

        if (state.channel !== 'lsp') {
          state.sessionActive = true;
          updateOneTapButton();
          updateLiveBadge();
          updateSessionMeta();
          appendMessage(
            'Sistema SeñaSegura',
            `Atención iniciada de forma inmediata (${state.sector} · ${state.procedure}). Canal: ${(CHANNEL_INFO[state.channel] || CHANNEL_INFO.lsp).oneTap}.`,
            'staff'
          );
          updateStepsGuide();
          scrollToActiveChannel(true);
          return;
        }

        state.connecting = true;
        if (connectingCountdown) connectingCountdown.textContent = 'Conectando en 2 s…';
        if (connectingOverlay) connectingOverlay.hidden = false;
        updateOneTapButton();
        updateLiveBadge();
        updateStepsGuide();
        updateSessionMeta();
        scrollToActiveChannel(false);

        connectingStepTimer = setTimeout(() => {
          connectingStepTimer = null;
          if (state.connecting && connectingCountdown) {
            connectingCountdown.textContent = 'Conectando en 1 s…';
          }
        }, 900);

        connectingTimer = setTimeout(() => {
          connectingTimer = null;
          connectingStepTimer = null;
          state.connecting = false;
          state.sessionActive = true;
          if (connectingOverlay) connectingOverlay.hidden = true;
          updateOneTapButton();
          updateLiveBadge();
          updateSessionMeta();
          appendMessage(
            'Sistema SeñaSegura',
            `Intérprete LSP en línea (${state.sector} · ${state.procedure}). Atención iniciada en 1 toque.`,
            'staff'
          );
          updateStepsGuide();
        }, 1800);
      });
    }

    if (btnCancelConnect) {
      btnCancelConnect.addEventListener('click', () => {
        cancelConnecting();
        if (btnOneTap) btnOneTap.focus();
      });
    }

    if (btnEscalateConnect) {
      btnEscalateConnect.addEventListener('click', () => {
        cancelConnecting();
        activateEmergency();
      });
    }

    // Modo Emergencia <30 s (HU-009, HU-011, HU-014, HU-015, Figma P2)
    function activateEmergency() {
      if (state.connecting) cancelConnecting();
      if (state.channel !== 'lsp') {
        setChannel('lsp');
      }
      state.emergencyActive = true;
      state.sessionActive = true;
      state.criticalAlertActive = true;
      state.criticalAccepted = false;

      if (emergencyPanel) emergencyPanel.hidden = false;
      if (btnEmergency) btnEmergency.setAttribute('aria-pressed', 'true');
      updateOneTapButton();
      updateLiveBadge();
      updateStepsGuide();
      updateConsolePriorityContext();
      updateCriticalBanner();
      playEmergencyTone();
      updateSessionMeta();

      let secondsLeft = 3;
      if (emergencyInterval) clearInterval(emergencyInterval);
      if (emergencyQueueTimer) {
        emergencyQueueTimer.textContent = `Saltando cola general · Conectando intérprete LSP prioritario (${secondsLeft} s de simulación)…`;
      }

      emergencyInterval = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
          if (emergencyQueueTimer) {
            emergencyQueueTimer.textContent = `Saltando cola general · Conectando intérprete LSP prioritario (${secondsLeft} s)…`;
          }
        } else {
          clearInterval(emergencyInterval);
          emergencyInterval = null;
          if (emergencyQueueTimer) {
            emergencyQueueTimer.textContent = '¡Intérprete LSP conectado en <30 s! Canal HD prioritario listo.';
          }
          appendMessage(
            'Intérprete LSP (Emergencia)',
            'Conexión prioritaria establecida en menos de 30 segundos. Indica el tipo de emergencia o toca un símbolo rápido.',
            'staff'
          );
        }
      }, 900);
    }

    function deactivateEmergency() {
      state.emergencyActive = false;
      state.emergencyType = null;
      state.selectedCrisis = null;
      state.criticalAlertActive = false;
      state.criticalAccepted = false;
      state.criticalFromConsoleSim = false;
      if (emergencyInterval) {
        clearInterval(emergencyInterval);
        emergencyInterval = null;
      }
      if (emergencyPanel) emergencyPanel.hidden = true;
      if (btnEmergency) btnEmergency.setAttribute('aria-pressed', 'false');
      emergencyTypeBtns.forEach((btn) => {
        btn.classList.remove('is-selected');
        btn.setAttribute('aria-pressed', 'false');
      });
      crisisCards.forEach((card) => {
        card.classList.remove('is-selected');
        card.setAttribute('aria-pressed', 'false');
      });
      updateConsolePriorityContext();
      updateCriticalBanner();
      updateOneTapButton();
      updateLiveBadge();
      updateStepsGuide();
      updateSessionMeta();
    }

    if (btnEmergency) {
      btnEmergency.addEventListener('click', () => {
        if (state.emergencyActive) {
          deactivateEmergency();
        } else {
          activateEmergency();
        }
      });
    }

    if (btnExitEmergency) {
      btnExitEmergency.addEventListener('click', deactivateEmergency);
    }

    emergencyTypeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        emergencyTypeBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-selected', active);
          b.setAttribute('aria-pressed', String(active));
        });
        state.emergencyType = btn.dataset.emergencyType;
        state.criticalAlertActive = true;
        if (state.channel !== 'lsp') setChannel('lsp');

        updateConsolePriorityContext();
        updateCriticalBanner();
        updateSessionMeta();

        appendMessage(
          'Alerta de Emergencia',
          `Tipo seleccionado: ${state.emergencyType}. Prioridad máxima asignada en Consola del Intérprete (<30 s).`,
          'user'
        );
      });
    });

    crisisCards.forEach((card) => {
      card.addEventListener('click', () => {
        crisisCards.forEach((c) => {
          const active = c === card;
          c.classList.toggle('is-selected', active);
          c.setAttribute('aria-pressed', String(active));
        });
        state.selectedCrisis = card.dataset.crisis;
        state.criticalAlertActive = true;
        if (state.channel !== 'lsp') setChannel('lsp');

        updateConsolePriorityContext();
        updateCriticalBanner();
        updateSessionMeta();

        appendMessage(
          'Alerta de Crisis',
          `Símbolo rápido activado: ${state.selectedCrisis}. Videollamada HD >30 fps enlazada con prioridad.`,
          'user'
        );
      });
    });

    // Canal de comunicación: Intérprete LSP | Cámara IA (Gestos) | Texto / Lectura (HU-035)
    function setChannel(ch) {
      if (!CHANNEL_INFO[ch]) return;
      const previous = state.channel;
      if (ch !== 'lsp' && state.connecting) {
        cancelConnecting();
      }
      state.channel = ch;

      channelChips.forEach((btn) => {
        const active = btn.dataset.channel === ch;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });

      const isLsp = ch === 'lsp';
      const isCamera = ch === 'camara';
      const isText = ch === 'texto';

      if (videoStage) videoStage.hidden = !isLsp;
      if (videoBadgesRow) videoBadgesRow.hidden = !isLsp;
      if (callControls) callControls.hidden = !isLsp;
      if (visionPanel) visionPanel.hidden = !isCamera;
      if (textModeCard) textModeCard.hidden = !isText;

      // Insignia visible de canal activo (color + ícono + texto)
      if (channelBadge) channelBadge.setAttribute('data-channel-active', ch);
      if (channelBadgeText) channelBadgeText.textContent = `Canal activo: ${CHANNEL_INFO[ch].badge}`;

      updateSessionMeta();

      // Avisa al módulo de visión (detiene la cámara al salir de "Cámara IA (Gestos)")
      document.dispatchEvent(new CustomEvent('senasegura:channelchange', {
        detail: { channel: ch, previous }
      }));
    }

    channelChips.forEach((chip) => {
      chip.addEventListener('click', () => setChannel(chip.dataset.channel));
    });

    textSwitchBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.switchChannel;
        if (target) setChannel(target);
      });
    });

    // Sectores del simulador
    sectorChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        sectorChips.forEach((btn) => {
          const active = btn === chip;
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-pressed', String(active));
        });
        updateSectorContext(chip.dataset.simSector);
      });
    });

    if (procedureSelect) {
      procedureSelect.addEventListener('change', () => {
        state.procedure = procedureSelect.value;
        if (consoleProcedureVal) consoleProcedureVal.textContent = state.procedure;
        updateSessionMeta();
      });
    }

    // Turnos de interpretación
    if (btnToggleTurn) {
      btnToggleTurn.addEventListener('click', () => {
        state.turnDirection = state.turnDirection === 'lsp' ? 'funcionario' : 'lsp';
        updateTurnLabels();
      });
    }

    if (btnConsoleToLsp) {
      btnConsoleToLsp.addEventListener('click', () => {
        state.turnDirection = 'lsp';
        updateTurnLabels();
      });
    }

    if (btnConsoleToEs) {
      btnConsoleToEs.addEventListener('click', () => {
        state.turnDirection = 'funcionario';
        updateTurnLabels();
      });
    }

    // Controles de videollamada (Mute, Cámara, Switch, Fullscreen)
    if (btnMic) {
      btnMic.addEventListener('click', () => {
        state.micMuted = !state.micMuted;
        btnMic.setAttribute('aria-pressed', String(state.micMuted));
        btnMic.title = state.micMuted ? 'Micrófono silenciado' : 'Micrófono activo';
      });
    }

    if (btnCamera) {
      btnCamera.addEventListener('click', () => {
        state.cameraOff = !state.cameraOff;
        btnCamera.setAttribute('aria-pressed', String(state.cameraOff));
        if (cameraOffOverlay) cameraOffOverlay.hidden = !state.cameraOff;
      });
    }

    if (btnSwitch) {
      btnSwitch.addEventListener('click', () => {
        state.cameraAngle =
          state.cameraAngle === 'Frontal · Intérprete LSP'
            ? 'Ventanilla · Documentos'
            : 'Frontal · Intérprete LSP';
        if (cameraAngleLabel) cameraAngleLabel.textContent = `Cámara: ${state.cameraAngle}`;
      });
    }

    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', () => {
        openDialog('modal-fullscreen', btnFullscreen);
      });
    }

    // Simulación de contingencia / microcorte de red
    if (btnOutage) {
      btnOutage.addEventListener('click', () => {
        if (state.outageActive) return;
        state.outageActive = true;
        btnOutage.disabled = true;

        if (simNetworkStatus) simNetworkStatus.classList.add('is-offline');
        if (simNetworkLabel) simNetworkLabel.textContent = 'Reconectando…';
        if (consoleNetworkLabel) consoleNetworkLabel.textContent = 'Reconectando…';
        if (headerNetworkPill) {
          headerNetworkPill.classList.add('is-offline');
          const span = headerNetworkPill.querySelector('span');
          if (span) span.textContent = 'Reconectando…';
        }
        if (contingencyBanner) contingencyBanner.hidden = false;
        if (contingencyMsg) {
          contingencyMsg.textContent = 'Microcorte de red detectado. Reconectando canal seguro sin perder el historial…';
        }

        setTimeout(() => {
          state.outageActive = false;
          btnOutage.disabled = false;
          if (simNetworkStatus) simNetworkStatus.classList.remove('is-offline');
          if (simNetworkLabel) simNetworkLabel.textContent = 'Red Operativa';
          if (consoleNetworkLabel) consoleNetworkLabel.textContent = 'Red Operativa';
          if (headerNetworkPill) {
            headerNetworkPill.classList.remove('is-offline');
            const span = headerNetworkPill.querySelector('span');
            if (span) span.textContent = 'Red Operativa';
          }
          if (contingencyMsg) {
            contingencyMsg.textContent = 'Conexión restablecida en modo operativo. Historial intacto.';
          }
          setTimeout(() => {
            if (contingencyBanner) contingencyBanner.hidden = true;
          }, 2200);
        }, 2800);
      });
    }

    // Copiar y Editar en vivo DNI / Monto (Figma P4 y P5)
    if (btnCopyData) {
      btnCopyData.addEventListener('click', () => {
        const textToCopy = state.sensitiveFields.map((f) => `${f.label}: ${f.value}`).join(' | ');
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(textToCopy).catch(() => {});
        }
        const original = btnCopyData.textContent;
        btnCopyData.textContent = '¡Datos copiados!';
        setTimeout(() => {
          btnCopyData.textContent = original;
        }, 1800);
      });
    }

    if (btnEditData && sensitiveEditForm && editField1 && editField2) {
      let editOpenedAt = 0;

      function placeholderForField(label) {
        if (label === 'DNI') return 'Ej. 00000000';
        if (label === 'Monto') return 'Ej. 150.00';
        if (label === 'Referencia') return 'Ej. Parte N.° 2026-041';
        if (label === 'Área') return 'Ej. Triaje · Prioridad II';
        if (label === 'Expediente') return 'Ej. 00412-2026';
        return '';
      }

      btnEditData.addEventListener('click', () => {
        const willOpen = sensitiveEditForm.hidden;
        if (!willOpen) {
          closeSensitiveEditForm(false);
          return;
        }
        const [f1, f2] = state.sensitiveFields;
        if (editLabel1 && f1) editLabel1.textContent = f1.label;
        if (editLabel2 && f2) editLabel2.textContent = f2.label;
        editField1.placeholder = f1 ? placeholderForField(f1.label) : '';
        editField2.placeholder = f2 ? placeholderForField(f2.label) : '';
        editField1.value = f1 ? f1.value : '';
        editField2.value = f2 ? f2.value : '';
        if (sensitiveEditError) {
          sensitiveEditError.hidden = true;
          sensitiveEditError.textContent = '';
        }
        editOpenedAt = performance.now();
        sensitiveEditForm.hidden = false;
        btnEditData.setAttribute('aria-expanded', 'true');
        setTimeout(() => {
          if (!sensitiveEditForm.hidden) editField1.focus();
        }, 60);
      });

      sensitiveEditForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (performance.now() - editOpenedAt < 150) return;

        const inputs = [editField1, editField2];
        const errors = [];
        let firstInvalidEl = null;

        state.sensitiveFields.forEach((field, idx) => {
          const inputEl = inputs[idx];
          if (!inputEl) return;
          const raw = inputEl.value.trim();

          if (field.label === 'DNI') {
            if (!raw) return; // conserva el valor anterior
            const digits = raw.replace(/\D/g, '').slice(0, 8);
            if (!digits) {
              errors.push('Ingresa solo números para el DNI (hasta 8 dígitos).');
              if (!firstInvalidEl) firstInvalidEl = inputEl;
            } else {
              field.value = digits;
            }
          } else if (field.label === 'Monto') {
            if (!raw) return; // conserva el valor anterior
            const cleaned = raw.replace(/^\s*s\s*\/?\s*/i, '').replace(/\s+/g, '').replace(',', '.');
            const num = Number(cleaned);
            if (!/^\d+(\.\d+)?$/.test(cleaned) || !Number.isFinite(num) || num < 0) {
              errors.push('Ingresa un monto numérico válido (ej. 150.00).');
              if (!firstInvalidEl) firstInvalidEl = inputEl;
            } else {
              field.value = `S/ ${num.toFixed(2)}`;
            }
          } else if (raw) {
            field.value = raw;
          }
        });

        renderSensitiveData();

        if (errors.length && sensitiveEditError) {
          sensitiveEditError.textContent = `${errors[0]} Se conservó el formato válido.`;
          sensitiveEditError.hidden = false;
          if (firstInvalidEl) firstInvalidEl.focus();
          return;
        }

        closeSensitiveEditForm(true);
        appendMessage('Sistema SeñaSegura', 'Datos actualizados para verificación visual.', 'staff');
      });

      sensitiveEditForm.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeSensitiveEditForm(true);
        }
      });
    }

    if (btnCancelEditData) {
      btnCancelEditData.addEventListener('click', () => closeSensitiveEditForm(true));
    }

    // Consola del Intérprete: estado, alerta crítica, PiP, apoyo y bloc de notas (Figma P8, P9)
    interpreterStatusChips.forEach((chip) => {
      chip.addEventListener('click', () => setInterpreterStatus(chip.dataset.interpreterStatus));
    });

    if (btnConsoleSimAlert) {
      btnConsoleSimAlert.addEventListener('click', () => {
        state.criticalAlertActive = true;
        state.criticalAccepted = false;
        state.criticalFromConsoleSim = !state.emergencyActive;
        updateCriticalBanner();
        if (btnAcceptCritical) btnAcceptCritical.focus();
      });
    }

    if (btnAcceptCritical) {
      btnAcceptCritical.addEventListener('click', () => {
        state.emergencyActive = true;
        state.criticalAlertActive = true;
        state.criticalAccepted = true;
        state.criticalFromConsoleSim = false;
        state.sessionActive = true;
        if (state.channel !== 'lsp') setChannel('lsp');
        if (emergencyPanel) emergencyPanel.hidden = false;
        if (btnEmergency) btnEmergency.setAttribute('aria-pressed', 'true');
        if (emergencyQueueTimer) {
          emergencyQueueTimer.textContent = '¡Intérprete LSP conectado en <30 s! Emergencia aceptada desde Consola.';
        }
        setInterpreterStatus('Ocupado');
        updateConsolePriorityContext();
        updateCriticalBanner();
        updateOneTapButton();
        updateLiveBadge();
        updateStepsGuide();
        updateSessionMeta();
        appendMessage(
          'Intérprete LSP (Consola)',
          'Emergencia crítica aceptada en consola (<30 s). Atención prioritaria en curso.',
          'staff'
        );
      });
    }

    if (btnDismissCriticalSim) {
      btnDismissCriticalSim.addEventListener('click', () => {
        state.criticalAlertActive = false;
        state.criticalAccepted = false;
        state.criticalFromConsoleSim = false;
        updateCriticalBanner();
        if (btnConsoleSimAlert) btnConsoleSimAlert.focus();
      });
    }

    if (btnTogglePip && consolePipBox && consolePipPreview) {
      btnTogglePip.addEventListener('click', () => {
        const willMinimize = !consolePipBox.classList.contains('is-minimized');
        consolePipBox.classList.toggle('is-minimized', willMinimize);
        consolePipPreview.hidden = willMinimize;
        btnTogglePip.setAttribute('aria-expanded', String(!willMinimize));
        btnTogglePip.textContent = willMinimize ? 'Mostrar' : 'Minimizar';
      });
    }

    if (btnConsoleSupport && consoleSupportNotice) {
      btnConsoleSupport.addEventListener('click', () => {
        consoleSupportNotice.textContent =
          'Respaldo solicitado: supervisor LSP notificado para apoyo o transferencia. La sesión actual continúa sin cortar el video.';
        consoleSupportNotice.hidden = false;
      });
    }

    // Glosario Técnico LSP (Figma P10)
    function renderGlossary() {
      if (!glossaryList) return;
      const query = state.glossaryQuery.trim().toLowerCase();
      const cat = state.glossaryCategory;

      const filtered = GLOSSARY_TERMS.filter((item) => {
        const catMatch = cat === 'Todos' || item.category === cat;
        const textMatch =
          !query ||
          item.term.toLowerCase().includes(query) ||
          item.definition.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query);
        return catMatch && textMatch;
      });

      glossaryList.textContent = '';
      if (glossaryEmpty) glossaryEmpty.hidden = filtered.length > 0;

      filtered.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'glossary-item';

        const head = document.createElement('div');
        head.className = 'glossary-item-head';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'glossary-item-title-wrap';

        const title = document.createElement('h3');
        title.className = 'glossary-term';
        title.textContent = item.term;

        const badge = document.createElement('span');
        badge.className = 'glossary-category-pill';
        badge.textContent = item.category;

        titleWrap.append(title, badge);

        const isFav = state.glossaryFavorites.has(item.id);
        const favBtn = document.createElement('button');
        favBtn.type = 'button';
        favBtn.className = `glossary-fav-btn${isFav ? ' is-fav' : ''}`;
        favBtn.setAttribute('aria-pressed', String(isFav));
        favBtn.setAttribute('aria-label', `${isFav ? 'Quitar' : 'Marcar'} ${item.term} como favorito`);
        favBtn.textContent = isFav ? '\u{2605}' : '\u{2606}';
        favBtn.addEventListener('click', () => {
          if (state.glossaryFavorites.has(item.id)) state.glossaryFavorites.delete(item.id);
          else state.glossaryFavorites.add(item.id);
          renderGlossary();
        });

        head.append(titleWrap, favBtn);

        const def = document.createElement('p');
        def.className = 'glossary-definition';
        def.textContent = item.definition;

        li.append(head, def);
        glossaryList.appendChild(li);
      });
    }

    if (btnOpenGlossary) {
      btnOpenGlossary.addEventListener('click', () => {
        renderGlossary();
        openDialog('modal-glossary', btnOpenGlossary);
      });
    }

    if (glossarySearch) {
      glossarySearch.addEventListener('input', () => {
        state.glossaryQuery = glossarySearch.value;
        renderGlossary();
      });
    }

    glossaryFilterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.glossaryCategory = btn.dataset.glossaryFilter || 'Todos';
        glossaryFilterBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        renderGlossary();
      });
    });

    // Dictado de voz simulado (o Web Speech API si está disponible)
    if (btnVoiceDictation && chatInput) {
      btnVoiceDictation.addEventListener('click', () => {
        if (state.dictating) return;
        state.dictating = true;
        btnVoiceDictation.setAttribute('aria-pressed', 'true');
        const btnLabel = btnVoiceDictation.querySelector('span');
        if (btnLabel) btnLabel.textContent = 'Escuchando…';

        const config = SIM_SECTORS[state.sector];
        let sample = config ? config.dictationSample : 'Atención validada en ventanilla.';
        if (state.sector === 'Banco' && state.sensitiveFields[1] && state.sensitiveFields[1].value) {
          sample = `Operación bancaria validada por ${state.sensitiveFields[1].value} en ventanilla.`;
        }
        const words = sample.split(' ');
        let i = 0;
        chatInput.value = '';

        dictTimer = setInterval(() => {
          if (i < words.length) {
            chatInput.value = `${chatInput.value}${i === 0 ? '' : ' '}${words[i]}`;
            i += 1;
          } else {
            stopDictation();
            chatInput.focus();
          }
        }, 130);
      });
    }

    // Envío de mensaje en chat
    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        state.sessionActive = true;
        appendMessage('Ciudadano / Usuario', text, 'user');
        chatInput.value = '';
        updateOneTapButton();
        updateLiveBadge();
        updateStepsGuide();
        updateSessionMeta();

        const epoch = chatEpoch;
        setTimeout(() => {
          if (epoch !== chatEpoch) return;
          appendMessage(
            'Personal de ventanilla',
            `Mensaje confirmado en ${state.sector}. Puedes finalizar cuando estés listo para recibir tu código.`,
            'staff'
          );
        }, 500);
      });
    }

    // Calificación de experiencia en modal de cierre (Figma P6 / HU-029)
    function resetClosureRating() {
      closureRatingBtns.forEach((btn) => {
        btn.classList.remove('is-selected');
        btn.setAttribute('aria-pressed', 'false');
      });
      if (closureRatingFeedback) {
        closureRatingFeedback.hidden = true;
        closureRatingFeedback.textContent = '';
      }
    }

    closureRatingBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        closureRatingBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-selected', active);
          b.setAttribute('aria-pressed', String(active));
        });
        if (closureRatingFeedback) {
          closureRatingFeedback.textContent = `¡Gracias por tu calificación! (${btn.dataset.rating})`;
          closureRatingFeedback.hidden = false;
        }
      });
    });

    // Cierre de atención, código de 8 dígitos, QR dinámico y purga local (HU-025, HU-026, HU-031)
    function finishAttentionAndPurge(triggerEl) {
      const code = generate8DigitCode();
      state.lastReceiptCode = code;

      const channelName = (CHANNEL_INFO[state.channel] || CHANNEL_INFO.lsp).receipt;
      const nowStr = new Date().toLocaleString('es-PE', {
        dateStyle: 'short',
        timeStyle: 'short'
      });

      receiptRegistry.set(code, {
        code,
        sector: state.sector,
        procedure: state.procedure,
        channel: channelName,
        status: state.emergencyActive
          ? 'Atención prioritaria finalizada (<30 s)'
          : 'Atención finalizada · Cierre confirmado',
        timestamp: nowStr,
        isDemoBase: false
      });

      // Purga inmediata del chat local, bloc de notas y restablecimiento de datos ficticios
      const finishedProcedure = state.procedure;
      chatEpoch += 1;
      stopDictation();
      if (state.connecting) cancelConnecting();
      state.chatMessages = [];
      state.sessionActive = false;
      state.micMuted = false;
      state.cameraOff = false;
      state.cameraAngle = 'Frontal · Intérprete LSP';
      state.turnDirection = 'lsp';
      if (cameraOffOverlay) cameraOffOverlay.hidden = true;
      if (btnMic) {
        btnMic.setAttribute('aria-pressed', 'false');
        btnMic.title = 'Micrófono activo';
      }
      if (btnCamera) btnCamera.setAttribute('aria-pressed', 'false');
      if (cameraAngleLabel) cameraAngleLabel.textContent = `Cámara: ${state.cameraAngle}`;
      updateTurnLabels();
      if (state.emergencyActive || state.criticalAlertActive) deactivateEmergency();
      if (chatInput) chatInput.value = '';
      if (consolePrivateNotes) consolePrivateNotes.value = '';
      if (consoleSupportNotice) {
        consoleSupportNotice.hidden = true;
        consoleSupportNotice.textContent = '';
      }
      setInterpreterStatus('Disponible');
      updateSectorContext(state.sector);
      updateOneTapButton();
      // Purga local: el módulo de Cámara IA libera la cámara y limpia su salida
      document.dispatchEvent(new CustomEvent('senasegura:purge'));

      // Actualizar UI del modal de cierre y vista previa PDF
      const codeEl = document.getElementById('closure-code-display');
      const qrBox = document.getElementById('closure-qr-container');
      const qrCaption = document.getElementById('closure-qr-caption');
      const pdfCode = document.getElementById('pdf-preview-code');
      const pdfSector = document.getElementById('pdf-preview-sector');
      const pdfChannel = document.getElementById('pdf-preview-channel');
      const pdfQr = document.getElementById('pdf-preview-qr');

      const qrSvgNode = buildDynamicQrSvg(code);
      if (codeEl) codeEl.textContent = code;
      if (qrBox) qrBox.replaceChildren(qrSvgNode);
      if (qrCaption) {
        qrCaption.textContent = '';
        qrCaption.append(code, document.createElement('br'), 'QR verificable');
      }
      if (pdfCode) pdfCode.textContent = code;
      if (pdfSector) pdfSector.textContent = `Atención finalizada · Sector: ${state.sector} (${finishedProcedure})`;
      if (pdfChannel) pdfChannel.textContent = `Canal: ${channelName}`;
      if (pdfQr) pdfQr.replaceChildren(qrSvgNode.cloneNode(true));

      // Precargar el código generado en el verificador web para prueba inmediata
      const verifierInput = document.getElementById('verifier-code-input');
      if (verifierInput) verifierInput.value = code;

      resetClosureRating();
      openDialog('modal-closure', triggerEl);
    }

    if (btnHangup) {
      btnHangup.addEventListener('click', () => finishAttentionAndPurge(btnHangup));
    }
    if (btnFinishSession) {
      btnFinishSession.addEventListener('click', () => finishAttentionAndPurge(btnFinishSession));
    }

    // Descargar constancia + Imprimir ticket + Copiar código + Vista previa PDF
    const btnDownloadReceipt = document.getElementById('btn-download-receipt');
    const btnPrintTicket = document.getElementById('btn-print-ticket');
    const btnCopyClosureCode = document.getElementById('btn-copy-closure-code');
    const btnPreviewPdf = document.getElementById('btn-preview-pdf');
    const btnPdfDownload = document.getElementById('btn-pdf-download');
    const btnPdfPrint = document.getElementById('btn-pdf-print');
    const btnClosePdfPreview = document.getElementById('btn-close-pdf-preview');
    let copyCodeTimer = null;

    function downloadReceiptFile() {
      const record = receiptRegistry.get(state.lastReceiptCode);
      const content = [
        'SEÑASEGURA · CONSTANCIA DE ATENCIÓN ACCESIBLE',
        '==============================================',
        `Código único : ${record ? record.code : state.lastReceiptCode}`,
        `Sector       : ${record ? record.sector : state.sector}`,
        `Trámite      : ${record ? record.procedure : state.procedure}`,
        `Canal        : ${record ? record.channel : 'Lengua de Señas Peruana'}`,
        `Estado       : ${record ? record.status : 'Cierre confirmado'}`,
        `Fecha/Hora   : ${record ? record.timestamp : new Date().toLocaleString('es-PE')}`,
        '----------------------------------------------',
        'Privacidad   : Sin grabación de video.',
        'Purga local  : Chat eliminado del dispositivo (Ley N.° 29733).',
        'Marco legal  : Ley N.° 29535 (Lengua de Señas Peruana).'
      ].join('\n');

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `constancia-${state.lastReceiptCode}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    if (btnDownloadReceipt) {
      btnDownloadReceipt.addEventListener('click', downloadReceiptFile);
    }

    if (btnPdfDownload) {
      btnPdfDownload.addEventListener('click', downloadReceiptFile);
    }

    if (btnPrintTicket) {
      btnPrintTicket.addEventListener('click', () => {
        window.print();
      });
    }

    if (btnPdfPrint) {
      btnPdfPrint.addEventListener('click', () => {
        window.print();
      });
    }

    if (btnCopyClosureCode) {
      btnCopyClosureCode.addEventListener('click', () => {
        const codeText = state.lastReceiptCode || '';
        const confirmCopied = () => {
          btnCopyClosureCode.textContent = '¡Código copiado!';
          if (copyCodeTimer) clearTimeout(copyCodeTimer);
          copyCodeTimer = setTimeout(() => {
            btnCopyClosureCode.textContent = 'Copiar código';
            copyCodeTimer = null;
          }, 1800);
        };
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(codeText).then(confirmCopied).catch(confirmCopied);
        } else {
          confirmCopied();
        }
      });
    }

    if (btnPreviewPdf) {
      btnPreviewPdf.addEventListener('click', () => {
        closeDialog('modal-closure', { restoreFocus: false });
        openDialog('modal-pdf-preview', btnPreviewPdf);
      });
    }

    if (btnClosePdfPreview) {
      btnClosePdfPreview.addEventListener('click', () => {
        closeDialog('modal-pdf-preview', { restoreFocus: false });
        openDialog('modal-closure', btnFinishSession);
        if (btnPreviewPdf) btnPreviewPdf.focus();
      });
    }

    // Purga externa (por si algún evento dispara senasegura:purge)
    document.addEventListener('senasegura:purge', () => {
      if (consolePrivateNotes) consolePrivateNotes.value = '';
    });

    // Inicializar estado por defecto
    updateSectorContext('Banco');
    updateTurnLabels();
    setInterpreterStatus('Disponible');
    setChannel(state.channel);
    updateLiveBadge();
    updateStepsGuide();

    /**
     * Puente público hacia el módulo opcional de Cámara IA (js/vision-ai.js).
     * Expone solo lo necesario; no revela el estado interno del simulador.
     */
    window.SenaSegura = Object.freeze({
      getChannel: () => state.channel,
      setChannel,
      appendChatMessage(sender, text, type = 'user') {
        state.sessionActive = true;
        appendMessage(sender, text, type);
        updateOneTapButton();
        updateLiveBadge();
        updateStepsGuide();
        updateSessionMeta();
      },
      activateEmergency() {
        if (!state.emergencyActive) activateEmergency();
        if (emergencyPanel) {
          emergencyPanel.setAttribute('tabindex', '-1');
          emergencyPanel.focus({ preventScroll: false });
        }
      },
      isEmergencyActive: () => state.emergencyActive
    });
  }

  /* =========================================================
     7. VERIFICADOR WEB DE COMPROBANTES (HU-032)
     ========================================================= */
  function initVerifier() {
    const form = document.getElementById('verifier-form');
    const input = document.getElementById('verifier-code-input');
    const resultBox = document.getElementById('verifier-result');
    const badgeIcon = document.getElementById('verifier-badge-icon');
    const badgeText = document.getElementById('verifier-badge-text');
    const resultTitle = document.getElementById('verifier-result-title');
    const resultDetails = document.getElementById('verifier-result-details');
    const resultFooter = document.getElementById('verifier-result-footer');

    if (!form || !input || !resultBox) return;

    function createSvgPath(d) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      return path;
    }

    function setVerifierIcon(isValid) {
      if (!badgeIcon) return;
      if (isValid) {
        badgeIcon.setAttribute('viewBox', '0 0 20 20');
        badgeIcon.replaceChildren(createSvgPath('M4.16667 10L7.5 13.3333L15.8333 5'));
      } else {
        badgeIcon.setAttribute('viewBox', '0 0 24 24');
        badgeIcon.replaceChildren(
          createSvgPath('M12 3L22 21H2L12 3Z'),
          createSvgPath('M12 9V14M12 17V17.1')
        );
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let raw = input.value.trim().toUpperCase();
      if (/^\d{8}$/.test(raw) || raw === '84920') {
        raw = `SEG-${raw}`;
      }

      const stored = receiptRegistry.get(raw);
      const isEightDigitPattern = /^SEG-\d{8}$/.test(raw);

      if (stored || isEightDigitPattern) {
        const record = stored || {
          code: raw,
          sector: 'Atención institucional',
          channel: 'Lengua de Señas Peruana / Texto',
          status: 'Cierre confirmado · Sin grabación de video',
          timestamp: 'Registro verificado (formato 8 dígitos)',
          isDemoBase: false
        };

        resultBox.classList.remove('is-error');
        resultBox.classList.add('is-valid');
        setVerifierIcon(true);
        if (badgeText) badgeText.textContent = 'Comprobante válido';
        if (resultTitle) resultTitle.textContent = 'Comprobante verificado';
        if (resultDetails) {
          const p1 = document.createElement('p');
          const codeStrong = document.createElement('strong');
          codeStrong.textContent = record.code;
          p1.append(codeStrong, ` · ${record.status}`);

          const p2 = document.createElement('p');
          p2.textContent = `Sector: ${record.sector} · Canal: ${record.channel}`;

          const p3 = document.createElement('p');
          p3.textContent = `Fecha: ${record.timestamp} · Purga local aplicada`;

          resultDetails.replaceChildren(p1, p2, p3);
        }
        if (resultFooter) {
          resultFooter.textContent = record.isDemoBase
            ? 'DEMOSTRACIÓN · Ejemplo base SEG-84920'
            : 'VERIFICACIÓN ACTIVA · Ley N.° 29733 y Ley N.° 29535';
        }
      } else {
        resultBox.classList.remove('is-valid');
        resultBox.classList.add('is-error');
        setVerifierIcon(false);
        if (badgeText) badgeText.textContent = 'Código no reconocido';
        if (resultTitle) resultTitle.textContent = 'No se encontró la constancia';
        if (resultDetails) {
          const p1 = document.createElement('p');
          p1.textContent = 'Ingresa un código de 8 dígitos (ej. SEG-84920418) o el ejemplo SEG-84920.';
          const p2 = document.createElement('p');
          p2.textContent = 'Puedes generar un nuevo código cerrando una atención en el Simulador.';
          resultDetails.replaceChildren(p1, p2);
        }
        if (resultFooter) resultFooter.textContent = 'Formato esperado: SEG-XXXXXXXX';
      }
    });
  }

  /* =========================================================
     8. FAQ ACCESIBLES CON FILTRO Y MODAL LSP (HU-044)
     ========================================================= */
  function initFaq() {
    const filterBtns = document.querySelectorAll('.faq-filter-btn[data-faq-filter]');
    const faqItems = document.querySelectorAll('.faq-item[data-faq-category]');
    const faqTriggers = document.querySelectorAll('.faq-trigger');
    const lspButtons = document.querySelectorAll('.btn-lsp-modal');
    const modalLspQuestion = document.getElementById('modal-lsp-question');

    function selectFaqFilter(btn) {
      const category = btn.dataset.faqFilter;
      filterBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });

      let firstVisible = true;
      faqItems.forEach((item) => {
        const match = category === 'todas' || item.dataset.faqCategory === category;
        item.hidden = !match;
        const trigger = item.querySelector('.faq-trigger');
        const panel = item.querySelector('.faq-panel');
        const icon = item.querySelector('.faq-icon');
        if (match && firstVisible && trigger && panel) {
          trigger.setAttribute('aria-expanded', 'true');
          panel.hidden = false;
          if (icon) icon.textContent = '−';
          firstVisible = false;
        } else if (trigger && panel) {
          trigger.setAttribute('aria-expanded', 'false');
          panel.hidden = true;
          if (icon) icon.textContent = '+';
        }
      });
    }

    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => selectFaqFilter(btn));
    });
    bindTablistArrows(filterBtns, selectFaqFilter);

    faqTriggers.forEach((trigger) => {
      trigger.addEventListener('click', () => {
        const expanded = trigger.getAttribute('aria-expanded') === 'true';
        const panel = document.getElementById(trigger.getAttribute('aria-controls'));
        const icon = trigger.querySelector('.faq-icon');
        trigger.setAttribute('aria-expanded', String(!expanded));
        if (panel) panel.hidden = expanded;
        if (icon) icon.textContent = expanded ? '+' : '−';
      });
    });

    lspButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (modalLspQuestion) {
          modalLspQuestion.textContent = btn.dataset.lspQuestion || 'Respuesta en Lengua de Señas Peruana';
        }
        openDialog('modal-lsp', btn);
      });
    });
  }

  /* =========================================================
     9. FORMULARIO B2G/B2B CON VALIDACIÓN EN TIEMPO REAL (HU-042)
     ========================================================= */
  function initDemoForm() {
    const form = document.getElementById('demo-form');
    if (!form) return;

    const fields = {
      fullname: {
        el: document.getElementById('field-fullname'),
        err: document.getElementById('err-fullname'),
        validate: (v) => (v.trim().length >= 3 ? '' : 'Ingresa tu nombre y apellido (mínimo 3 caracteres).')
      },
      organization: {
        el: document.getElementById('field-org'),
        err: document.getElementById('err-org'),
        validate: (v) => (v.trim().length >= 2 ? '' : 'Indica el nombre de tu institución o empresa.')
      },
      role: {
        el: document.getElementById('field-role'),
        err: document.getElementById('err-role'),
        validate: (v) => (v.trim().length >= 2 ? '' : 'Indica tu cargo o función.')
      },
      email: {
        el: document.getElementById('field-email'),
        err: document.getElementById('err-email'),
        validate: (v) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
            ? ''
            : 'Ingresa un correo corporativo válido (ej. nombre@institucion.gob.pe).'
      },
      phone: {
        el: document.getElementById('field-phone'),
        err: document.getElementById('err-phone'),
        validate: (v) => {
          const trimmed = v.trim();
          const digits = trimmed.replace(/\D/g, '');
          return digits.length >= 7 && digits.length <= 15 && /^[+\d\s()-]+$/.test(trimmed)
            ? ''
            : 'Ingresa un número telefónico válido (7 a 15 dígitos).';
        }
      },
      windows: {
        el: document.getElementById('field-windows'),
        err: document.getElementById('err-windows'),
        validate: (v) => {
          const num = Number(v);
          return Number.isInteger(num) && num >= 1 ? '' : 'Ingresa un número entero mayor o igual a 1.';
        }
      }
    };

    const consentEl = document.getElementById('field-consent');
    const consentErr = document.getElementById('err-consent');

    function validateField(key) {
      const f = fields[key];
      if (!f || !f.el || !f.err) return true;
      const msg = f.validate(f.el.value);
      f.err.textContent = msg;
      f.el.setAttribute('aria-invalid', String(Boolean(msg)));
      return !msg;
    }

    function validateConsent() {
      if (!consentEl || !consentErr) return true;
      const valid = consentEl.checked;
      consentErr.textContent = valid ? '' : 'Debes aceptar la Política de Privacidad para continuar.';
      consentEl.setAttribute('aria-invalid', String(!valid));
      return valid;
    }

    Object.keys(fields).forEach((key) => {
      const { el } = fields[key];
      if (!el) return;
      el.addEventListener('input', () => validateField(key));
      el.addEventListener('blur', () => validateField(key));
    });

    if (consentEl) {
      consentEl.addEventListener('change', validateConsent);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const results = Object.keys(fields).map((key) => validateField(key));
      const consentOk = validateConsent();

      if (results.every(Boolean) && consentOk) {
        const orgName = fields.organization.el.value.trim();
        const winCount = fields.windows.el.value.trim();
        const summary = document.getElementById('demo-success-summary');
        if (summary) {
          summary.textContent = `Hemos preparado la solicitud para ${orgName} (${winCount} ventanillas). En la plataforma implementada, nuestro equipo institucional se pondrá en contacto.`;
        }
        form.reset();
        Object.keys(fields).forEach((key) => {
          fields[key].el.setAttribute('aria-invalid', 'false');
          fields[key].err.textContent = '';
        });
        openDialog('modal-demo-success', document.getElementById('btn-submit-demo'));
      } else {
        const firstInvalid = form.querySelector('[aria-invalid="true"]');
        if (firstInvalid) firstInvalid.focus();
      }
    });
  }

  /* =========================================================
     10. MODALES INSTITUCIONALES Y CIERRES
     ========================================================= */
  function initModals() {
    const openConformity = document.getElementById('btn-open-conformity');
    const openPrivacy = document.getElementById('btn-open-privacy');
    const openSupportFloating = document.getElementById('btn-floating-support');
    const openSupportFooter = document.getElementById('btn-footer-support');

    if (openConformity) {
      openConformity.addEventListener('click', () => openDialog('modal-conformity', openConformity));
    }
    if (openPrivacy) {
      openPrivacy.addEventListener('click', () => openDialog('modal-privacy', openPrivacy));
    }
    if (openSupportFloating) {
      openSupportFloating.addEventListener('click', () => openDialog('modal-support', openSupportFloating));
    }
    if (openSupportFooter) {
      openSupportFooter.addEventListener('click', () => openDialog('modal-support', openSupportFooter));
    }

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetHref = btn.tagName === 'A' ? btn.getAttribute('href') : '';
        if (targetHref && targetHref.startsWith('#')) {
          e.preventDefault();
          closeDialog(btn.dataset.closeModal, { restoreFocus: false });
          const targetEl = document.querySelector(targetHref);
          const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
          }
          const firstField = document.getElementById('field-fullname');
          if (firstField) {
            setTimeout(() => {
              firstField.focus({ preventScroll: true });
            }, 150);
          }
          return;
        }
        closeDialog(btn.dataset.closeModal);
      });
    });

    document.querySelectorAll('dialog.app-modal').forEach((dialog) => {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog(dialog.id);
      });
    });
  }

  /* =========================================================
     11. BOTÓN FLOTANTE DE SOPORTE: NUNCA TAPA CTAs NI FORMULARIOS (HU-046)
     Se oculta temporalmente solo mientras su área en pantalla coincide con
     un elemento marcado con [data-support-avoid] (CTAs del Hero, formulario
     demo y panel de Cámara IA). Siempre queda disponible "Soporte Técnico" en el footer.
     ========================================================= */
  function initFloatingSupport() {
    const btn = document.getElementById('btn-floating-support');
    const targets = document.querySelectorAll('[data-support-avoid]');
    if (!btn || !targets.length || !('IntersectionObserver' in window)) return;

    const overlapping = new Set();
    let observer = null;

    function refresh() {
      btn.classList.toggle('is-avoiding', overlapping.size > 0);
    }

    function observe() {
      if (observer) observer.disconnect();
      overlapping.clear();
      refresh();

      // El área raíz de observación es exactamente el rectángulo del botón (+8px de margen)
      const rect = btn.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const top = Math.max(0, Math.round(rect.top - 8));
      const left = Math.max(0, Math.round(rect.left - 8));
      const right = Math.max(0, Math.round(vw - rect.right - 8));
      const bottom = Math.max(0, Math.round(vh - rect.bottom - 8));

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) overlapping.add(entry.target);
            else overlapping.delete(entry.target);
          });
          refresh();
        },
        { rootMargin: `-${top}px -${right}px -${bottom}px -${left}px`, threshold: 0 }
      );
      targets.forEach((el) => observer.observe(el));
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(observe, 150);
    });
    // El escalado tipográfico y el contraste pueden ajustar dimensiones del botón
    new MutationObserver(() => setTimeout(observe, 50)).observe(htmlEl, {
      attributes: true,
      attributeFilter: ['data-font-scale', 'data-contrast']
    });
    observe();
    // La tipografía web puede cambiar el tamaño del botón tras cargar
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(observe).catch(() => {});
    }
  }

  /* =========================================================
     INICIALIZACIÓN
     ========================================================= */
  document.addEventListener('DOMContentLoaded', () => {
    initAccessibilityControls();
    initMobileDrawer();
    initImpactSection();
    initSimulator();
    initVerifier();
    initFaq();
    initDemoForm();
    initModals();
    initFloatingSupport();
  });
})();
