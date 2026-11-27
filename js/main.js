/**
 * SeñaSegura · Interactividad modular en Vanilla JS (ES6+)
 * Depende de `js/qr-iso.js` (`window.SenaSeguraQR`) para la generación QR SVG/PDF local.
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
      staffBtnLabel: 'Ajustar monto (Personal)',
      dataFields: [
        { label: 'DNI del ciudadano', shortLabel: 'DNI', value: '00000000' },
        {
          label: 'Monto / Operación (Ventanilla)',
          shortLabel: 'Monto',
          value: 'S/ 150.00',
          roleNote: 'Registrado por ventanilla',
          isAmount: true
        }
      ],
      procedures: [
        'Consulta de saldo y retiro',
        'Apertura de cuenta',
        'Bloqueo o reposición de tarjeta'
      ],
      templates: [
        {
          label: 'Confirmar DNI y monto',
          getText: (fields) => `Confirmo mi DNI: ${fields[0].value} y monto ${fields[1].value}.`
        },
        { label: 'Repetir en LSP', text: 'Por favor, repite en Lengua de Señas Peruana.' },
        { label: 'Pedir constancia', text: 'Necesito constancia impresa de la operación.' }
      ],
      dictationSample: 'Operación bancaria validada por S/ 150.00 en ventanilla.'
    },
    Comisaría: {
      subtitle: 'Comisaría · Datos de ejemplo',
      prompt: 'Indícanos el motivo de tu denuncia o constancia policial.',
      staffBtnLabel: 'Ajustar referencia (Personal)',
      dataFields: [
        { label: 'DNI del ciudadano', shortLabel: 'DNI', value: '00000000' },
        {
          label: 'Referencia (Ventanilla)',
          shortLabel: 'Referencia',
          value: 'Parte N.° 2026-041',
          roleNote: 'Registrado por ventanilla'
        }
      ],
      procedures: [
        'Registro de denuncia policial',
        'Constancia por pérdida de documentos',
        'Orientación sobre medidas de protección'
      ],
      templates: [
        {
          label: 'Registrar denuncia',
          getText: (fields) => `Deseo registrar una denuncia con intérprete LSP (DNI: ${fields[0].value} · ${fields[1].shortLabel}: ${fields[1].value}).`
        },
        { label: 'Constancia por pérdida', text: 'Necesito constancia por pérdida de DNI.' },
        { label: 'Atención prioritaria', text: 'Solicito atención prioritaria por emergencia.' }
      ],
      dictationSample: 'Se toma registro de ocurrencia con apoyo de intérprete LSP.'
    },
    Salud: {
      subtitle: 'Centro de Salud · Datos de ejemplo',
      prompt: 'Confirma tus síntomas principales y si presentas alergias.',
      staffBtnLabel: 'Ajustar área (Personal)',
      dataFields: [
        { label: 'DNI del ciudadano', shortLabel: 'DNI', value: '00000000' },
        {
          label: 'Área / Triaje (Ventanilla)',
          shortLabel: 'Área',
          value: 'Triaje · Prioridad II',
          roleNote: 'Registrado por ventanilla'
        }
      ],
      procedures: [
        'Triaje y consulta médica general',
        'Explicación de receta y dosis',
        'Consentimiento informado de procedimiento'
      ],
      templates: [
        {
          label: 'Solicitar intérprete LSP',
          getText: (fields) => `Tengo dolor agudo y necesito intérprete LSP (DNI: ${fields[0].value} · ${fields[1].shortLabel}: ${fields[1].value}).`
        },
        { label: 'Sin alergias', text: 'No presento alergias conocidas a medicamentos.' },
        { label: 'Escribir horarios', text: 'Por favor, escribe los horarios de la receta.' }
      ],
      dictationSample: 'Indicaciones médicas registradas: tomar 1 tableta cada 8 horas.'
    },
    Municipal: {
      subtitle: 'Municipalidad · Datos de ejemplo',
      prompt: 'Indica el número de expediente o trámite municipal.',
      staffBtnLabel: 'Ajustar expediente (Personal)',
      dataFields: [
        { label: 'DNI del ciudadano', shortLabel: 'DNI', value: '00000000' },
        {
          label: 'Expediente (Ventanilla)',
          shortLabel: 'Expediente',
          value: '00412-2026',
          roleNote: 'Registrado por ventanilla'
        }
      ],
      procedures: [
        'Mesa de partes y seguimiento',
        'Licencia de funcionamiento',
        'Pago de arbitrios y fraccionamiento'
      ],
      templates: [
        {
          label: 'Consultar expediente',
          getText: (fields) => `Consulto el estado de mi expediente ${fields[1].value} (DNI: ${fields[0].value}).`
        },
        { label: 'Ayuda en texto claro', text: 'Necesito ayuda con el formulario en texto claro.' },
        {
          label: 'Confirmar datos',
          getText: (fields) => `Confirmo mis datos (DNI: ${fields[0].value} · ${fields[1].shortLabel}: ${fields[1].value}) para mesa de partes.`
        }
      ],
      dictationSample: 'Expediente 00412-2026 verificado en mesa de partes accesible.'
    },
    'Otra sede / General': {
      subtitle: 'Otra sede / Atención general',
      prompt: 'Indícanos brevemente tu consulta o gestión para orientarte.',
      staffBtnLabel: 'Ajustar referencia (Personal)',
      dataFields: [
        { label: 'DNI del ciudadano', shortLabel: 'DNI', value: '00000000' },
        {
          label: 'Referencia (Ventanilla)',
          shortLabel: 'Referencia',
          value: 'Atención general',
          roleNote: 'Registrado por ventanilla'
        }
      ],
      procedures: [
        'Orientación e información general',
        'Mesa de partes y recepción documental',
        'Reclamo o libro de reclamaciones'
      ],
      templates: [
        {
          label: 'Confirmar DNI',
          getText: (fields) => `Confirmo mi DNI: ${fields[0].value} para atención general.`
        },
        { label: 'Repetir en LSP', text: 'Por favor, repite en Lengua de Señas Peruana.' },
        { label: 'Pedir constancia', text: 'Necesito constancia de mi atención.' }
      ],
      dictationSample: 'Consulta general atendida en ventanilla accesible.'
    }
  };

  const OTHER_PROCEDURE_OPTION = 'Otro trámite / Consulta general';

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

  const CHANNEL_INFO = {
    lsp: { badge: 'Intérprete LSP', meta: 'LSP HD', receipt: 'Lengua de Señas Peruana', oneTap: 'Lengua de Señas Peruana' },
    camara: { badge: 'Cámara IA (Gestos)', meta: 'Cámara IA', receipt: 'Cámara IA (Gestos)', oneTap: 'Cámara IA (Gestos)' },
    texto: { badge: 'Texto / Lectura', meta: 'Texto/Lectura', receipt: 'Texto / Lectura', oneTap: 'Texto / Lectura' }
  };

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
    customProcedure: '',
    consoleProcedureOverride: null,
    emergencyActive: false,
    emergencyType: null,
    selectedCrisis: null,
    turnDirection: 'lsp',
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
     3. UTILIDADES DE ACCESIBILIDAD, PRIVACIDAD Y MODALES
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

  function purgeTransientInputs() {
    [
      'console-private-notes',
      'sim-chat-input',
      'edit-field-1',
      'edit-field-2',
      'console-procedure-input',
      'sim-procedure-custom'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  function initAccessibilityControls() {
    const contrastBtn = document.getElementById('btn-contrast-toggle');
    const decreaseBtn = document.getElementById('btn-font-decrease');
    const increaseBtn = document.getElementById('btn-font-increase');
    const presetBtns = document.querySelectorAll('.btn-scale-preset, .btn-scale-preset-mobile');
    const resetBtns = document.querySelectorAll('.btn-a11y-reset');
    const statusText = document.getElementById('a11y-status-text');
    const mobileStatusText = document.getElementById('mobile-a11y-status');
    const appScaleBadge = document.getElementById('app-font-scale-value');

    const SCALES = ['100', '125', '150'];

    function updateA11yStatus() {
      const label = state.contrast === 'high'
        ? `Alto contraste: Sí · ${state.fontScale}%`
        : `Alto contraste: No · ${state.fontScale}%`;
      if (statusText) statusText.textContent = label;
      if (mobileStatusText) mobileStatusText.textContent = label;
      if (appScaleBadge) appScaleBadge.textContent = `${state.fontScale}%`;
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

    resetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyContrast('normal');
        applyFontScale('100');
      });
    });

    try {
      const savedContrast = localStorage.getItem('ss_contrast');
      const savedScale = localStorage.getItem('ss_font_scale');
      if (savedContrast === 'high') applyContrast('high');
      if (savedScale && SCALES.includes(savedScale)) applyFontScale(savedScale);
    } catch (_) {}
    updateA11yStatus();
  }

  /* =========================================================
     4. MENÚ HAMBURGUESA MÓVIL / ZOOM ALTO
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

          if (progress < 1) requestAnimationFrame(frame);
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
    } catch (_) {}
  }

  function generate8DigitCode() {
    const randomPart = Math.floor(10000000 + Math.random() * 89999999);
    return `SEG-${randomPart}`;
  }

  function placeholderForField(field) {
    if (!field) return '';
    const name = (field.shortLabel || field.label || '').toLowerCase();
    if (name.includes('dni')) return 'Ej. 00000000';
    if (name.includes('monto') || field.isAmount) return 'Ej. 150.00';
    if (name.includes('referencia')) return 'Ej. Parte N.° 2026-041';
    if (name.includes('área')) return 'Ej. Triaje · Prioridad II';
    if (name.includes('expediente')) return 'Ej. 00412-2026';
    return '';
  }

  function initSimulator() {
    const $ = (id) => document.getElementById(id);
    const viewTabs = document.querySelectorAll('.sim-view-tab[data-sim-view]');
    const viewVentanilla = $('sim-view-ventanilla');
    const viewConsola = $('sim-view-consola');
    const btnConsoleBack = $('btn-console-back');
    const btnAppConsole = $('btn-app-console');
    const btnChangeSector = $('btn-change-sector');
    const appWelcome = $('app-welcome');
    const appOperate = $('app-operate');
    const btnWelcomeEmergency = $('btn-welcome-emergency');

    const stepsGuide = $('sim-steps-guide');
    const stepItems = stepsGuide ? stepsGuide.querySelectorAll('.sim-step-item[data-sim-step]') : [];

    const sessionMeta = $('sim-session-meta');
    const btnOneTap = $('btn-one-tap-start');
    const btnOneTapLabel = $('btn-one-tap-label');
    const idleOneTapText = (btnOneTapLabel && btnOneTapLabel.textContent.trim()) || 'Iniciar Atención';
    const btnEmergency = $('btn-emergency-mode');
    const btnExitEmergency = $('btn-exit-emergency');
    const emergencyPanel = $('emergency-panel');
    const emergencyQueueTimer = $('emergency-queue-timer');
    const emergencyTypeBtns = document.querySelectorAll('.emergency-type-btn[data-emergency-type]');
    const crisisCards = document.querySelectorAll('.crisis-card[data-crisis]');

    const channelChips = document.querySelectorAll('.pref-chip[data-channel]');
    const sectorChips = document.querySelectorAll('.pref-chip[data-sim-sector]');
    const simSectorRow = $('sim-sector-row');
    const procedureSelect = $('sim-procedure-select');
    const procedureCustomWrap = $('sim-procedure-custom-wrap');
    const procedureCustomInput = $('sim-procedure-custom');
    const simMainGrid = $('sim-main-grid');

    const textModeCard = $('sim-textmode-card');
    const textSwitchBtns = document.querySelectorAll('[data-switch-channel]');
    const videoStage = $('sim-video-stage');
    const videoBadgesRow = $('sim-video-badges');
    const callControls = $('sim-call-controls');
    const controlsNote = $('sim-controls-note');
    const connectingOverlay = $('sim-connecting-overlay');
    const connectingCountdown = $('sim-connecting-countdown');
    const btnCancelConnect = $('btn-cancel-connect');
    const btnEscalateConnect = $('btn-escalate-connect');
    const visionPanel = $('vision-panel');
    const channelBadge = $('sim-channel-badge');
    const channelBadgeText = $('sim-channel-badge-text');
    const cameraOffOverlay = $('sim-camera-off-overlay');
    const cameraAngleLabel = $('sim-camera-angle');
    const liveBadge = $('sim-live-badge');
    const interpreterCaption = $('sim-interpreter-caption');
    const fullscreenCaption = $('fullscreen-interpreter-caption');

    const btnToggleTurn = $('btn-toggle-turn');
    const simTurnLabel = $('sim-turn-label');
    const consoleTurnStatus = $('console-turn-status');
    const fullscreenTurnLabel = $('fullscreen-turn-label');
    const btnConsoleToLsp = $('btn-console-to-lsp');
    const btnConsoleToEs = $('btn-console-to-es');

    const btnMic = $('btn-call-mic');
    const btnCamera = $('btn-call-camera');
    const btnSwitch = $('btn-call-switch');
    const btnFullscreen = $('btn-call-fullscreen');
    const btnHangup = $('btn-call-hangup');
    const btnFinishSession = $('btn-finish-session');

    const btnOutage = $('btn-simulate-outage');
    const contingencyBanner = $('contingency-banner');
    const contingencyMsg = $('contingency-message');
    const simNetworkStatus = $('sim-network-status');
    const simNetworkLabel = $('sim-network-label');
    const consoleNetworkLabel = $('console-network-label');
    const headerNetworkPill = $('header-network-pill');

    const chatSectorLabel = $('sim-chat-sector-label');
    const consoleSectorLabel = $('console-sector-label');
    const sensitiveCard = $('sim-sensitive-card');
    const chatDisclaimer = $('sim-chat-disclaimer');
    const sensitiveDataBox = $('sim-sensitive-data');
    const consoleDataBox = $('console-data-block');
    const consoleStaffEditWrap = $('console-staff-edit-wrap');
    const consolePriorityVal = $('console-priority-value');
    const consoleProcedureVal = $('console-procedure-value');
    const btnEditProcedure = $('btn-edit-procedure');
    const consoleProcedureEditForm = $('console-procedure-edit-form');
    const consoleProcedureInput = $('console-procedure-input');
    const btnCancelProcedure = $('btn-cancel-procedure');
    const chatMessagesBox = $('sim-chat-messages');
    const consoleChatFeed = $('console-chat-feed');
    const quickTemplatesBox = $('sim-quick-templates');
    const btnCopyData = $('btn-copy-data');
    const btnEditDni = $('btn-edit-dni');
    const btnEditAmount = $('btn-edit-amount');
    const sensitiveEditForm = $('sensitive-edit-form');
    const editLabel1 = $('edit-label-1');
    const editField1 = $('edit-field-1');
    const sensitiveEditError = $('sensitive-edit-error');
    const btnCancelEditData = $('btn-cancel-edit-data');
    const consoleStaffEditForm = $('console-staff-edit-form');
    const editLabel2 = $('edit-label-2');
    const editField2 = $('edit-field-2');
    const consoleStaffEditError = $('console-staff-edit-error');
    const btnCancelStaffData = $('btn-cancel-staff-data');
    const chatForm = $('sim-chat-form');
    const chatInput = $('sim-chat-input');
    const btnVoiceDictation = $('btn-voice-dictation');

    const interpreterStatusChips = document.querySelectorAll('.console-status-chip[data-interpreter-status]');
    const consoleInterpreterState = $('console-interpreter-state');
    const btnConsoleSimAlert = $('btn-console-sim-alert');
    const consoleCriticalBanner = $('console-critical-banner');
    const consoleCriticalTitle = $('console-critical-title');
    const consoleCriticalSub = $('console-critical-sub');
    const btnAcceptCritical = $('btn-accept-critical-emergency');
    const btnDismissCriticalSim = $('btn-dismiss-critical-sim');
    const consolePipBox = $('console-pip-box');
    const consolePipPreview = $('console-pip-preview');
    const btnTogglePip = $('btn-toggle-pip');
    const btnConsoleSupport = $('btn-console-support');
    const consoleSupportNotice = $('console-support-notice');
    const consolePrivateNotes = $('console-private-notes');
    const btnOpenGlossary = $('btn-open-glossary');

    const glossarySearch = $('glossary-search');
    const glossaryFilterBtns = document.querySelectorAll('.glossary-filter-btn[data-glossary-filter]');
    const glossaryList = $('glossary-list');
    const glossaryEmpty = $('glossary-empty');

    const closureRatingBtns = document.querySelectorAll('.closure-rating-btn[data-rating]');
    const closureRatingFeedback = $('closure-rating-feedback');
    const btnDownloadReceipt = $('btn-download-receipt');
    const btnPrintTicket = $('btn-print-ticket');
    const btnCopyClosureCode = $('btn-copy-closure-code');
    const btnPreviewPdf = $('btn-preview-pdf');
    const btnPdfDownload = $('btn-pdf-download');
    const btnPdfPrint = $('btn-pdf-print');
    const btnClosePdfPreview = $('btn-close-pdf-preview');

    const timers = {
      emergencyInterval: null,
      connectingTimer: null,
      connectingStepTimer: null,
      dictTimer: null,
      outageTimer1: null,
      outageTimer2: null,
      copyDataTimer: null,
      copyCodeTimer: null,
      chatReplyTimer: null,
      dniFocusTimer: null,
      staffFocusTimer: null
    };
    let chatEpoch = 0;

    function stopDictation() {
      if (timers.dictTimer) {
        clearInterval(timers.dictTimer);
        timers.dictTimer = null;
      }
      state.dictating = false;
      if (btnVoiceDictation) {
        btnVoiceDictation.setAttribute('aria-pressed', 'false');
        const btnLabel = btnVoiceDictation.querySelector('span');
        if (btnLabel) btnLabel.textContent = 'Dictado de voz';
      }
    }

    function restoreNetworkIndicators() {
      state.outageActive = false;
      if (btnOutage) btnOutage.disabled = false;
      if (simNetworkStatus) simNetworkStatus.classList.remove('is-offline');
      if (simNetworkLabel) simNetworkLabel.textContent = 'Red Operativa';
      if (consoleNetworkLabel) consoleNetworkLabel.textContent = 'Red Operativa';
      if (headerNetworkPill) {
        headerNetworkPill.classList.remove('is-offline');
        const span = headerNetworkPill.querySelector('span');
        if (span) span.textContent = 'Red Operativa';
      }
      if (contingencyBanner) contingencyBanner.hidden = true;
    }

    function clearAllSessionTimers() {
      if (timers.emergencyInterval) {
        clearInterval(timers.emergencyInterval);
        timers.emergencyInterval = null;
      }
      [
        'connectingTimer',
        'connectingStepTimer',
        'outageTimer1',
        'outageTimer2',
        'copyDataTimer',
        'copyCodeTimer',
        'chatReplyTimer',
        'dniFocusTimer',
        'staffFocusTimer'
      ].forEach((key) => {
        if (timers[key]) {
          clearTimeout(timers[key]);
          timers[key] = null;
        }
      });
      stopDictation();
      if (btnCopyData) btnCopyData.textContent = 'Copiar datos';
      if (btnCopyClosureCode) btnCopyClosureCode.textContent = 'Copiar código';
      if (state.outageActive) restoreNetworkIndicators();
    }

    function enterOperateScreen({ focusTarget = true } = {}) {
      if (appWelcome) appWelcome.hidden = true;
      if (appOperate) {
        appOperate.hidden = false;
        if (focusTarget) appOperate.focus({ preventScroll: true });
      }
    }

    function enterWelcomeScreen() {
      if (appOperate) appOperate.hidden = true;
      if (appWelcome) appWelcome.hidden = false;
    }

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
      if (btnAppConsole) {
        btnAppConsole.setAttribute('aria-pressed', String(!isVentanilla));
        btnAppConsole.textContent = isVentanilla ? 'Consola Intérprete' : 'Volver a Ventanilla';
      }
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

    function updateInterpreterCaption() {
      let captionText = 'Intérprete LSP · En espera. Pulsa “Iniciar Atención” para conectar.';
      if (state.emergencyActive) {
        const parts = [state.emergencyType, state.selectedCrisis].filter(Boolean).join(' · ');
        captionText = parts
          ? `Intérprete LSP → Ciudadano (EMERGENCIA): “Canal prioritario activo (${parts}). Atención en vivo (<30 s).”`
          : 'Intérprete LSP → Ciudadano (EMERGENCIA): “Prioridad máxima activa (<30 s). Indica tu urgencia o toca un símbolo.”';
      } else if (state.connecting) {
        captionText = 'Intérprete LSP · Conectando intérprete humano prioritario (<30 s)…';
      } else if (state.sessionActive) {
        if (state.turnDirection === 'lsp') {
          const staffMsgs = state.chatMessages.filter((m) => m.type !== 'user');
          const lastStaff = staffMsgs.length ? staffMsgs[staffMsgs.length - 1].text : '';
          if (staffMsgs.length <= 2 && state.sector === 'Banco' && state.sensitiveFields[1]) {
            captionText = `Intérprete LSP → Ciudadano: “Hola, el personal solicita confirmar tu DNI y el monto de ${state.sensitiveFields[1].value}.”`;
          } else {
            captionText = `Intérprete LSP → Ciudadano: “${lastStaff || 'Interpretando en vivo para ti.'}”`;
          }
        } else {
          const userMsgs = state.chatMessages.filter((m) => m.type === 'user');
          const lastUser = userMsgs.length ? userMsgs[userMsgs.length - 1].text : '';
          captionText = `Ciudadano → Funcionario (${state.sector}): “${lastUser || 'Interpretando tu respuesta a voz en tiempo real.'}”`;
        }
      }

      if (interpreterCaption) interpreterCaption.textContent = captionText;
      if (fullscreenCaption) fullscreenCaption.textContent = captionText;
    }

    function appendMessage(sender, text, type = 'staff') {
      state.chatMessages.push({ sender, text, type });
      renderChat();
      updateInterpreterCaption();
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
        if (labelEl) labelEl.textContent = idleOneTapText;
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
      updateInterpreterCaption();
    }

    function syncMicControlsUI() {
      if (btnMic) {
        btnMic.setAttribute('aria-pressed', String(state.micMuted));
        if (state.micMuted) btnMic.setAttribute('data-muted', 'true');
        else btnMic.removeAttribute('data-muted');
        btnMic.title = state.micMuted ? 'Micrófono silenciado' : 'Micrófono activo';
      }
      if (controlsNote) {
        controlsNote.textContent = state.micMuted
          ? 'Micrófono silenciado · Audio pausado'
          : 'Vista demostrativa · No se graba video';
        controlsNote.classList.toggle('is-muted', state.micMuted);
      }
    }

    function getEffectiveSector() {
      if (state.channel === 'camara' && !state.emergencyActive) return 'Atención general';
      return state.sector;
    }

    function getEffectiveProcedure() {
      if (state.consoleProcedureOverride) return state.consoleProcedureOverride;
      if (state.emergencyActive) {
        return (
          [state.emergencyType, state.selectedCrisis].filter(Boolean).join(' · ') ||
          'Atención prioritaria de emergencia (<30 s)'
        );
      }
      if (state.channel === 'camara') return 'Comunicación libre LSP';
      if (state.procedure === OTHER_PROCEDURE_OPTION) return state.customProcedure.trim() || 'Consulta general';
      return state.procedure;
    }

    function closeCitizenDniForm(restoreFocus = false) {
      if (!sensitiveEditForm) return;
      sensitiveEditForm.hidden = true;
      if (sensitiveEditError) {
        sensitiveEditError.hidden = true;
        sensitiveEditError.textContent = '';
      }
      if (btnEditDni) {
        btnEditDni.setAttribute('aria-expanded', 'false');
        if (restoreFocus) btnEditDni.focus();
      }
    }

    function closeConsoleStaffForm(restoreFocus = false) {
      if (!consoleStaffEditForm) return;
      consoleStaffEditForm.hidden = true;
      if (consoleStaffEditError) {
        consoleStaffEditError.hidden = true;
        consoleStaffEditError.textContent = '';
      }
      if (btnEditAmount) {
        btnEditAmount.setAttribute('aria-expanded', 'false');
        if (restoreFocus) btnEditAmount.focus();
      }
    }

    function closeSensitiveEditForm(restoreFocus = false) {
      closeCitizenDniForm(restoreFocus);
      closeConsoleStaffForm(false);
    }

    function closeConsoleProcedureForm(restoreFocus = false) {
      if (!consoleProcedureEditForm) return;
      consoleProcedureEditForm.hidden = true;
      if (btnEditProcedure) {
        btnEditProcedure.setAttribute('aria-expanded', 'false');
        if (restoreFocus) btnEditProcedure.focus();
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
      sessionMeta.textContent = `Sin login · ${statusLabel} · ${getEffectiveSector()} (${channelLabel})`;
    }

    function syncChannelContextUI() {
      const isCamera = state.channel === 'camara' && !state.emergencyActive;
      if (simMainGrid) {
        simMainGrid.setAttribute('data-active-channel', state.channel);
        if (!isCamera) simMainGrid.classList.remove('is-vision-expanded');
      }
      if (simSectorRow) simSectorRow.hidden = isCamera || state.emergencyActive;
      if (sensitiveCard) {
        sensitiveCard.hidden = isCamera;
        if (isCamera) closeCitizenDniForm(false);
      }
      if (chatDisclaimer) chatDisclaimer.hidden = isCamera;
      if (quickTemplatesBox) quickTemplatesBox.hidden = isCamera;
      if (consoleDataBox) consoleDataBox.hidden = isCamera;
      if (consoleStaffEditWrap) consoleStaffEditWrap.hidden = isCamera;
      if (btnChangeSector) btnChangeSector.textContent = isCamera ? '← Volver al inicio' : '← Cambiar sede';

      const config = SIM_SECTORS[state.sector] || SIM_SECTORS.Banco;
      const sectorSubtitle = isCamera ? 'Atención general · Comunicación libre LSP' : config.subtitle;
      if (chatSectorLabel) chatSectorLabel.textContent = sectorSubtitle;
      if (consoleSectorLabel) consoleSectorLabel.textContent = sectorSubtitle;
      if (consoleProcedureVal) consoleProcedureVal.textContent = getEffectiveProcedure();

      if (
        state.chatMessages.length === 1 &&
        state.chatMessages[0] &&
        state.chatMessages[0].type === 'staff'
      ) {
        state.chatMessages[0].text = isCamera
          ? 'Canal Cámara IA activo. Seña o deletrea libremente en LSP sin formularios previos.'
          : config.prompt;
        renderChat();
      }
      updateSessionMeta();
    }

    function renderSensitiveData() {
      const fields = state.sensitiveFields;
      if (sensitiveDataBox) {
        sensitiveDataBox.textContent = '';
        fields.forEach((field) => {
          const row = document.createElement('div');
          row.className = 'sensitive-row';

          const roleEl = document.createElement('span');
          roleEl.className = 'sensitive-role';
          roleEl.textContent = field.label;

          const valEl = document.createElement('p');
          valEl.className = 'sensitive-value';
          valEl.textContent = field.value;

          row.append(roleEl, valEl);
          if (field.roleNote) {
            const noteEl = document.createElement('span');
            noteEl.className = 'sensitive-note';
            noteEl.textContent = field.roleNote;
            row.appendChild(noteEl);
          }
          sensitiveDataBox.appendChild(row);
        });
      }

      if (consoleDataBox) {
        consoleDataBox.textContent = '';
        fields.forEach((field) => {
          const p = document.createElement('p');
          p.textContent = `${field.shortLabel || field.label}: ${field.value}`;
          consoleDataBox.appendChild(p);
        });
      }

      const config = SIM_SECTORS[state.sector];
      if (btnEditAmount && config) {
        btnEditAmount.textContent = config.staffBtnLabel || 'Ajustar monto (Personal)';
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
      if (consoleInterpreterState) consoleInterpreterState.textContent = statusLabel;
    }

    function cancelConnecting() {
      if (timers.connectingTimer) {
        clearTimeout(timers.connectingTimer);
        timers.connectingTimer = null;
      }
      if (timers.connectingStepTimer) {
        clearTimeout(timers.connectingStepTimer);
        timers.connectingStepTimer = null;
      }
      state.connecting = false;
      if (connectingOverlay) connectingOverlay.hidden = true;
      updateOneTapButton();
      updateLiveBadge();
      updateStepsGuide();
      syncChannelContextUI();
      updateInterpreterCaption();
    }

    function scrollToActiveChannel(focusInput = false) {
      if (appOperate) {
        if (focusInput && state.channel === 'camara') {
          const btnVisionStart = $('btn-vision-start');
          if (btnVisionStart && !btnVisionStart.disabled) btnVisionStart.focus({ preventScroll: true });
        } else if (focusInput && state.channel === 'texto' && chatInput) {
          chatInput.focus({ preventScroll: true });
        }
        return;
      }
      if (state.channel === 'camara') {
        if (visionPanel) visionPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (focusInput) {
          const btnVisionStart = $('btn-vision-start');
          if (btnVisionStart && !btnVisionStart.disabled) btnVisionStart.focus({ preventScroll: true });
        }
      } else if (state.channel === 'texto') {
        if (textModeCard) textModeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (focusInput && chatInput) chatInput.focus({ preventScroll: true });
      } else if (videoStage) {
        videoStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function setChannel(ch) {
      if (!CHANNEL_INFO[ch]) return;
      const previous = state.channel;
      if (ch !== 'lsp' && state.connecting) cancelConnecting();
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
      if (interpreterCaption) interpreterCaption.hidden = !isLsp;
      if (videoBadgesRow) videoBadgesRow.hidden = !isLsp;
      if (callControls) callControls.hidden = !isLsp;
      if (visionPanel) visionPanel.hidden = !isCamera;
      if (textModeCard) textModeCard.hidden = !isText;

      if (channelBadge) channelBadge.setAttribute('data-channel-active', ch);
      if (channelBadgeText) channelBadgeText.textContent = `Canal activo: ${CHANNEL_INFO[ch].badge}`;

      syncChannelContextUI();
      updateInterpreterCaption();

      document.dispatchEvent(new CustomEvent('senasegura:channelchange', {
        detail: { channel: ch, previous }
      }));
    }

    function updateSectorContext(sectorName) {
      chatEpoch += 1;
      clearAllSessionTimers();
      state.sector = sectorName;
      state.customProcedure = '';
      state.consoleProcedureOverride = null;
      const config = SIM_SECTORS[sectorName];
      if (!config) return;

      state.sensitiveFields = config.dataFields.map((f) => ({ ...f }));
      closeSensitiveEditForm(false);
      closeConsoleProcedureForm(false);
      renderSensitiveData();

      if (procedureCustomWrap) procedureCustomWrap.hidden = true;
      if (procedureCustomInput) procedureCustomInput.value = '';
      if (procedureSelect) {
        procedureSelect.textContent = '';
        config.procedures.concat(OTHER_PROCEDURE_OPTION).forEach((proc) => {
          const option = document.createElement('option');
          option.value = proc;
          option.textContent = proc;
          procedureSelect.appendChild(option);
        });
        state.procedure = config.procedures[0];
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
      syncChannelContextUI();
      updateLiveBadge();
      updateOneTapButton();
      updateStepsGuide();
      updateInterpreterCaption();
    }

    function deactivateEmergency() {
      state.emergencyActive = false;
      state.emergencyType = null;
      state.selectedCrisis = null;
      state.criticalAlertActive = false;
      state.criticalAccepted = false;
      state.criticalFromConsoleSim = false;
      if (timers.emergencyInterval) {
        clearInterval(timers.emergencyInterval);
        timers.emergencyInterval = null;
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
      syncChannelContextUI();
      updateInterpreterCaption();
    }

    function activateEmergency() {
      if (state.connecting) cancelConnecting();
      if (state.simView === 'consola') switchSimulatorView('ventanilla');
      enterOperateScreen({ focusTarget: false });
      if (state.channel !== 'lsp') setChannel('lsp');

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
      syncChannelContextUI();
      updateInterpreterCaption();

      let secondsLeft = 3;
      if (timers.emergencyInterval) clearInterval(timers.emergencyInterval);
      if (emergencyQueueTimer) {
        emergencyQueueTimer.textContent = `Saltando cola general · Conectando intérprete LSP prioritario (${secondsLeft} s de simulación)…`;
      }

      timers.emergencyInterval = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
          if (emergencyQueueTimer) {
            emergencyQueueTimer.textContent = `Saltando cola general · Conectando intérprete LSP prioritario (${secondsLeft} s)…`;
          }
        } else {
          clearInterval(timers.emergencyInterval);
          timers.emergencyInterval = null;
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

    function initEmergencyFlow() {
      function selectEmergencyOption({ type = null, crisis = null }) {
        emergencyTypeBtns.forEach((b) => {
          const active = Boolean(type) && b.dataset.emergencyType === type;
          b.classList.toggle('is-selected', active);
          b.setAttribute('aria-pressed', String(active));
        });
        crisisCards.forEach((c) => {
          const active = Boolean(crisis) && c.dataset.crisis === crisis;
          c.classList.toggle('is-selected', active);
          c.setAttribute('aria-pressed', String(active));
        });

        state.emergencyType = type || null;
        state.selectedCrisis = crisis || null;
        state.criticalAlertActive = true;
        if (state.channel !== 'lsp') setChannel('lsp');

        updateConsolePriorityContext();
        updateCriticalBanner();
        syncChannelContextUI();
        updateInterpreterCaption();
      }

      if (btnEmergency) {
        btnEmergency.addEventListener('click', () => {
          if (state.emergencyActive) deactivateEmergency();
          else activateEmergency();
        });
      }
      if (btnWelcomeEmergency) {
        btnWelcomeEmergency.addEventListener('click', activateEmergency);
      }
      if (btnExitEmergency) {
        btnExitEmergency.addEventListener('click', deactivateEmergency);
      }

      emergencyTypeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.emergencyType;
          selectEmergencyOption({ type });
          appendMessage(
            'Alerta de Emergencia',
            `Tipo seleccionado: ${type}. Prioridad máxima asignada en Consola del Intérprete (<30 s).`,
            'user'
          );
        });
      });

      crisisCards.forEach((card) => {
        card.addEventListener('click', () => {
          const crisis = card.dataset.crisis;
          if (typeof navigator.vibrate === 'function') {
            try {
              navigator.vibrate(80);
            } catch (_) {}
          }
          selectEmergencyOption({ crisis });
          appendMessage(
            'Alerta de Crisis',
            `Símbolo rápido activado: ${crisis}. Videollamada HD >30 fps enlazada con prioridad.`,
            'user'
          );
        });
      });
    }

    function initChannelAndSector() {
      viewTabs.forEach((tab) => {
        tab.addEventListener('click', () => switchSimulatorView(tab.dataset.simView));
      });
      bindTablistArrows(viewTabs, (tab) => switchSimulatorView(tab.dataset.simView));

      if (btnAppConsole) {
        btnAppConsole.addEventListener('click', () => {
          switchSimulatorView(state.simView === 'consola' ? 'ventanilla' : 'consola');
        });
      }
      if (btnConsoleBack) {
        btnConsoleBack.addEventListener('click', () => switchSimulatorView('ventanilla'));
      }

      if (btnChangeSector) {
        btnChangeSector.addEventListener('click', () => {
          chatEpoch += 1;
          clearAllSessionTimers();
          if (state.connecting) cancelConnecting();
          state.sessionActive = false;
          if (state.emergencyActive || state.criticalAlertActive) deactivateEmergency();
          closeSensitiveEditForm(false);
          switchSimulatorView('ventanilla');
          document.dispatchEvent(new CustomEvent('senasegura:purge'));
          updateOneTapButton();
          updateLiveBadge();
          updateStepsGuide();
          updateSessionMeta();
          enterWelcomeScreen();
          const activeSectorBtn = appWelcome
            ? appWelcome.querySelector('.pref-chip[data-sim-sector].is-active') || btnOneTap
            : btnOneTap;
          if (activeSectorBtn) activeSectorBtn.focus();
        });
      }

      if (btnOneTap) {
        btnOneTap.addEventListener('click', () => {
          if (state.connecting) return;
          enterOperateScreen({ focusTarget: false });

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
              `Atención iniciada de forma inmediata (${getEffectiveSector()} · ${getEffectiveProcedure()}). Canal: ${(CHANNEL_INFO[state.channel] || CHANNEL_INFO.lsp).oneTap}.`,
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
          updateInterpreterCaption();
          scrollToActiveChannel(false);

          timers.connectingStepTimer = setTimeout(() => {
            timers.connectingStepTimer = null;
            if (state.connecting && connectingCountdown) {
              connectingCountdown.textContent = 'Conectando en 1 s…';
            }
          }, 900);

          timers.connectingTimer = setTimeout(() => {
            timers.connectingTimer = null;
            timers.connectingStepTimer = null;
            state.connecting = false;
            state.sessionActive = true;
            if (connectingOverlay) connectingOverlay.hidden = true;
            updateOneTapButton();
            updateLiveBadge();
            updateSessionMeta();
            appendMessage(
              'Sistema SeñaSegura',
              `Intérprete LSP en línea (${getEffectiveSector()} · ${getEffectiveProcedure()}). Atención iniciada en 1 toque.`,
              'staff'
            );
            updateStepsGuide();
          }, 1800);
        });
      }

      if (btnCancelConnect) {
        btnCancelConnect.addEventListener('click', () => {
          cancelConnecting();
          if (appWelcome && !state.sessionActive && !state.emergencyActive) enterWelcomeScreen();
          if (btnOneTap) btnOneTap.focus();
        });
      }
      if (btnEscalateConnect) {
        btnEscalateConnect.addEventListener('click', () => {
          cancelConnecting();
          activateEmergency();
        });
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
          state.consoleProcedureOverride = null;
          const isOther = state.procedure === OTHER_PROCEDURE_OPTION;
          if (procedureCustomWrap) procedureCustomWrap.hidden = !isOther;
          if (isOther && procedureCustomInput) {
            procedureCustomInput.focus({ preventScroll: true });
          } else if (procedureCustomInput) {
            state.customProcedure = '';
            procedureCustomInput.value = '';
          }
          if (consoleProcedureVal) consoleProcedureVal.textContent = getEffectiveProcedure();
          updateSessionMeta();
        });
      }

      if (procedureCustomInput) {
        procedureCustomInput.addEventListener('input', () => {
          state.customProcedure = procedureCustomInput.value;
          state.consoleProcedureOverride = null;
          if (consoleProcedureVal) consoleProcedureVal.textContent = getEffectiveProcedure();
          updateSessionMeta();
        });
      }

      if (btnToggleTurn) {
        btnToggleTurn.addEventListener('click', () => {
          state.turnDirection = state.turnDirection === 'lsp' ? 'funcionario' : 'lsp';
          updateTurnLabels();
        });
      }
      if (btnMic) {
        btnMic.addEventListener('click', () => {
          state.micMuted = !state.micMuted;
          syncMicControlsUI();
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
        btnFullscreen.addEventListener('click', () => openDialog('modal-fullscreen', btnFullscreen));
      }

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

          timers.outageTimer1 = setTimeout(() => {
            timers.outageTimer1 = null;
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
            timers.outageTimer2 = setTimeout(() => {
              timers.outageTimer2 = null;
              if (contingencyBanner) contingencyBanner.hidden = true;
            }, 2200);
          }, 2800);
        });
      }
    }

    function initChatAndSensitiveData() {
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
          if (timers.chatReplyTimer) clearTimeout(timers.chatReplyTimer);
          timers.chatReplyTimer = setTimeout(() => {
            timers.chatReplyTimer = null;
            if (epoch !== chatEpoch) return;
            appendMessage('Intérprete LSP / Ventanilla', `Recibido para ${getEffectiveProcedure()}. Continuamos con tu atención.`, 'staff');
          }, 450);
        });
      }

      if (btnCopyData) {
        btnCopyData.addEventListener('click', () => {
          const textToCopy = state.sensitiveFields.map((f) => `${f.label}: ${f.value}`).join(' | ');
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(textToCopy).catch(() => {});
          }
          btnCopyData.textContent = '¡Datos copiados!';
          if (timers.copyDataTimer) clearTimeout(timers.copyDataTimer);
          timers.copyDataTimer = setTimeout(() => {
            timers.copyDataTimer = null;
            btnCopyData.textContent = 'Copiar datos';
          }, 1800);
        });
      }

      if (sensitiveEditForm && editField1) {
        let dniEditOpenedAt = 0;

        if (btnEditDni) {
          btnEditDni.addEventListener('click', () => {
            if (!sensitiveEditForm.hidden) {
              closeCitizenDniForm(false);
              return;
            }
            const field = state.sensitiveFields[0];
            if (!field) return;
            if (editLabel1) editLabel1.textContent = field.label;
            editField1.placeholder = placeholderForField(field);
            editField1.value = field.value;
            if (sensitiveEditError) {
              sensitiveEditError.hidden = true;
              sensitiveEditError.textContent = '';
            }
            dniEditOpenedAt = performance.now();
            sensitiveEditForm.hidden = false;
            btnEditDni.setAttribute('aria-expanded', 'true');
            if (timers.dniFocusTimer) clearTimeout(timers.dniFocusTimer);
            timers.dniFocusTimer = setTimeout(() => {
              timers.dniFocusTimer = null;
              if (!sensitiveEditForm.hidden) editField1.focus();
            }, 60);
          });
        }

        sensitiveEditForm.addEventListener('submit', (e) => {
          e.preventDefault();
          if (performance.now() - dniEditOpenedAt < 150) return;
          const field = state.sensitiveFields[0];
          if (!field) return;

          const raw = editField1.value.trim();
          let errorMsg = '';
          if (raw) {
            const digits = raw.replace(/\D/g, '').slice(0, 8);
            if (!digits) errorMsg = 'Ingresa solo números para el DNI (hasta 8 dígitos).';
            else field.value = digits;
          }

          renderSensitiveData();

          if (errorMsg && sensitiveEditError) {
            sensitiveEditError.textContent = `${errorMsg} Se conservó el formato válido.`;
            sensitiveEditError.hidden = false;
            editField1.focus();
            return;
          }

          closeCitizenDniForm(true);
          appendMessage('Sistema SeñaSegura', `DNI del ciudadano actualizado (${field.value}).`, 'staff');
        });

        sensitiveEditForm.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeCitizenDniForm(true);
          }
        });
      }

      if (btnCancelEditData) {
        btnCancelEditData.addEventListener('click', () => closeCitizenDniForm(true));
      }

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

          timers.dictTimer = setInterval(() => {
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
          if (timers.chatReplyTimer) clearTimeout(timers.chatReplyTimer);
          timers.chatReplyTimer = setTimeout(() => {
            timers.chatReplyTimer = null;
            if (epoch !== chatEpoch) return;
            appendMessage(
              'Personal de ventanilla',
              `Mensaje confirmado en ${getEffectiveSector()}. Puedes finalizar cuando estés listo para recibir tu código.`,
              'staff'
            );
          }, 500);
        });
      }
    }

    function initInterpreterConsole() {
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

      if (consoleProcedureEditForm && consoleProcedureInput) {
        if (btnEditProcedure) {
          btnEditProcedure.addEventListener('click', () => {
            if (!consoleProcedureEditForm.hidden) {
              closeConsoleProcedureForm(false);
              return;
            }
            consoleProcedureInput.value = getEffectiveProcedure();
            consoleProcedureEditForm.hidden = false;
            btnEditProcedure.setAttribute('aria-expanded', 'true');
            consoleProcedureInput.focus({ preventScroll: true });
          });
        }

        consoleProcedureEditForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const fallbackProc = state.channel === 'camara' ? 'Comunicación libre LSP' : 'Consulta general';
          const val = consoleProcedureInput.value.trim() || fallbackProc;
          state.consoleProcedureOverride = val;
          if (consoleProcedureVal) consoleProcedureVal.textContent = val;
          updateSessionMeta();
          closeConsoleProcedureForm(true);
          appendMessage('Intérprete LSP (Consola)', `Motivo / trámite actualizado en vivo: ${val}.`, 'staff');
        });

        consoleProcedureEditForm.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeConsoleProcedureForm(true);
          }
        });
      }

      if (btnCancelProcedure) {
        btnCancelProcedure.addEventListener('click', () => closeConsoleProcedureForm(true));
      }

      if (consoleStaffEditForm && editField2) {
        let staffEditOpenedAt = 0;

        if (btnEditAmount) {
          btnEditAmount.addEventListener('click', () => {
            if (!consoleStaffEditForm.hidden) {
              closeConsoleStaffForm(false);
              return;
            }
            const field = state.sensitiveFields[1];
            if (!field) return;
            if (editLabel2) editLabel2.textContent = field.label;
            editField2.placeholder = placeholderForField(field);
            editField2.value = field.value;
            if (consoleStaffEditError) {
              consoleStaffEditError.hidden = true;
              consoleStaffEditError.textContent = '';
            }
            staffEditOpenedAt = performance.now();
            consoleStaffEditForm.hidden = false;
            btnEditAmount.setAttribute('aria-expanded', 'true');
            if (timers.staffFocusTimer) clearTimeout(timers.staffFocusTimer);
            timers.staffFocusTimer = setTimeout(() => {
              timers.staffFocusTimer = null;
              if (!consoleStaffEditForm.hidden) editField2.focus();
            }, 60);
          });
        }

        consoleStaffEditForm.addEventListener('submit', (e) => {
          e.preventDefault();
          if (performance.now() - staffEditOpenedAt < 150) return;
          const field = state.sensitiveFields[1];
          if (!field) return;

          const raw = editField2.value.trim();
          let errorMsg = '';
          if (field.isAmount) {
            if (raw) {
              const cleaned = raw.replace(/^\s*s\s*\/?\s*/i, '').replace(/\s+/g, '').replace(',', '.');
              const num = Number(cleaned);
              if (!/^\d+(\.\d+)?$/.test(cleaned) || !Number.isFinite(num) || num < 0) {
                errorMsg = 'Ingresa un monto numérico válido (ej. 150.00).';
              } else {
                field.value = `S/ ${num.toFixed(2)}`;
              }
            }
          } else if (raw) {
            field.value = raw;
          }

          renderSensitiveData();

          if (errorMsg && consoleStaffEditError) {
            consoleStaffEditError.textContent = `${errorMsg} Se conservó el formato válido.`;
            consoleStaffEditError.hidden = false;
            editField2.focus();
            return;
          }

          closeConsoleStaffForm(true);
          appendMessage(
            'Personal de ventanilla (Consola)',
            `${field.label} actualizado en ventanilla (${field.value}).`,
            'staff'
          );
        });

        consoleStaffEditForm.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeConsoleStaffForm(true);
          }
        });
      }

      if (btnCancelStaffData) {
        btnCancelStaffData.addEventListener('click', () => closeConsoleStaffForm(true));
      }

      interpreterStatusChips.forEach((chip) => {
        chip.addEventListener('click', () => setInterpreterStatus(chip.dataset.interpreterStatus));
      });

      if (btnConsoleSimAlert) {
        btnConsoleSimAlert.addEventListener('click', () => {
          state.criticalAlertActive = true;
          state.criticalAccepted = false;
          state.criticalFromConsoleSim = !state.emergencyActive;
          updateCriticalBanner();
          playEmergencyTone();
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
          enterOperateScreen({ focusTarget: false });
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
    }

    function initClosureAndReceipt() {
      const qrApi = window.SenaSeguraQR || {};
      const buildReceiptVerifyUrl = qrApi.buildReceiptVerifyUrl || ((code) => code);
      const encodeIsoQrMatrix = qrApi.encodeIsoQrMatrix || (() => null);
      const buildDynamicQrSvg = qrApi.buildDynamicQrSvg || (() => document.createElementNS('http://www.w3.org/2000/svg', 'svg'));

      const JSPDF_CDN_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
      let jspdfLoadPromise = null;
      let downloadingReceipt = false;

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

      function finishAttentionAndPurge(triggerEl) {
        const code = generate8DigitCode();
        state.lastReceiptCode = code;

        const channelName = (CHANNEL_INFO[state.channel] || CHANNEL_INFO.lsp).receipt;
        const finishedSector = getEffectiveSector();
        const finishedProcedure = getEffectiveProcedure();
        const nowStr = new Date().toLocaleString('es-PE', {
          dateStyle: 'short',
          timeStyle: 'short'
        });

        receiptRegistry.set(code, {
          code,
          sector: finishedSector,
          procedure: finishedProcedure,
          channel: channelName,
          status: state.emergencyActive
            ? 'Atención prioritaria finalizada (<30 s)'
            : 'Atención finalizada · Cierre confirmado',
          timestamp: nowStr,
          isDemoBase: false
        });

        chatEpoch += 1;
        clearAllSessionTimers();
        if (state.connecting) cancelConnecting();
        state.chatMessages = [];
        state.sessionActive = false;
        state.micMuted = false;
        state.cameraOff = false;
        state.cameraAngle = 'Frontal · Intérprete LSP';
        state.turnDirection = 'lsp';
        if (cameraOffOverlay) cameraOffOverlay.hidden = true;
        syncMicControlsUI();
        if (btnCamera) btnCamera.setAttribute('aria-pressed', 'false');
        if (cameraAngleLabel) cameraAngleLabel.textContent = `Cámara: ${state.cameraAngle}`;
        updateTurnLabels();
        if (state.emergencyActive || state.criticalAlertActive) deactivateEmergency();
        purgeTransientInputs();
        if (consoleSupportNotice) {
          consoleSupportNotice.hidden = true;
          consoleSupportNotice.textContent = '';
        }
        setInterpreterStatus('Disponible');
        updateSectorContext(state.sector);
        updateOneTapButton();
        enterWelcomeScreen();
        switchSimulatorView('ventanilla');
        document.dispatchEvent(new CustomEvent('senasegura:purge'));

        const codeEl = $('closure-code-display');
        const procedureMetaEl = $('closure-procedure-meta');
        const qrBox = $('closure-qr-container');
        const qrCaption = $('closure-qr-caption');
        const pdfCode = $('pdf-preview-code');
        const pdfSector = $('pdf-preview-sector');
        const pdfChannel = $('pdf-preview-channel');
        const pdfQr = $('pdf-preview-qr');

        const verifyUrl = buildReceiptVerifyUrl(code, finishedSector, finishedProcedure);
        const qrSvgNode = buildDynamicQrSvg(verifyUrl, code);
        if (codeEl) codeEl.textContent = code;
        if (procedureMetaEl) procedureMetaEl.textContent = `Sede: ${finishedSector} · Trámite: ${finishedProcedure}`;
        if (qrBox) qrBox.replaceChildren(qrSvgNode);
        if (qrCaption) {
          qrCaption.textContent = '';
          qrCaption.append(code, document.createElement('br'), 'QR verificable');
        }
        if (pdfCode) pdfCode.textContent = code;
        if (pdfSector) pdfSector.textContent = `Atención finalizada · Sede: ${finishedSector} (${finishedProcedure})`;
        if (pdfChannel) pdfChannel.textContent = `Canal: ${channelName}`;
        if (pdfQr) pdfQr.replaceChildren(qrSvgNode.cloneNode(true));

        const verifierInput = $('verifier-code-input');
        if (verifierInput) verifierInput.value = code;

        resetClosureRating();
        openDialog('modal-closure', triggerEl);
      }

      if (btnHangup) btnHangup.addEventListener('click', () => finishAttentionAndPurge(btnHangup));
      if (btnFinishSession) btnFinishSession.addEventListener('click', () => finishAttentionAndPurge(btnFinishSession));

      function ensureJsPdf() {
        if (window.jspdf && typeof window.jspdf.jsPDF === 'function') return Promise.resolve(true);
        if (navigator.onLine === false) return Promise.resolve(false);
        if (jspdfLoadPromise) return jspdfLoadPromise;

        jspdfLoadPromise = new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = JSPDF_CDN_URL;
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.addEventListener('load', () => {
            resolve(Boolean(window.jspdf && typeof window.jspdf.jsPDF === 'function'));
          }, { once: true });
          script.addEventListener('error', () => {
            jspdfLoadPromise = null;
            resolve(false);
          }, { once: true });
          document.head.appendChild(script);
        });
        return jspdfLoadPromise;
      }

      function downloadReceiptTxt(code, record) {
        const content = [
          'SEÑASEGURA · CONSTANCIA DE ATENCIÓN ACCESIBLE',
          '==============================================',
          `Código único   : ${code}`,
          `Sector / Sede  : ${record ? record.sector : state.sector}`,
          `Trámite        : ${record ? record.procedure : state.procedure}`,
          `Canal          : ${record ? record.channel : 'Lengua de Señas Peruana'}`,
          'ID Intérprete  : INT-LSP-042',
          `Estado         : ${record ? record.status : 'Cierre confirmado'}`,
          `Fecha/Hora     : ${record ? record.timestamp : new Date().toLocaleString('es-PE')}`,
          '----------------------------------------------',
          'Privacidad     : Sin grabación de video.',
          'Purga local    : Chat eliminado del dispositivo (Ley N.° 29733).',
          'Marco legal    : Ley N.° 29535 (Lengua de Señas Peruana).'
        ].join('\n');

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `constancia-${code}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      async function downloadReceiptFile() {
        if (downloadingReceipt) return;
        downloadingReceipt = true;
        const code = state.lastReceiptCode || 'SEG-84920418';
        const record = receiptRegistry.get(code);

        try {
          const pdfReady = await ensureJsPdf();
          if (pdfReady && window.jspdf && typeof window.jspdf.jsPDF === 'function') {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            doc.setFillColor(10, 37, 64);
            doc.rect(0, 0, 210, 34, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.text('SeñaSegura · Constancia de Atención', 16, 17);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.text('Plataforma accesible en Lengua de Señas Peruana (Ley N.° 29535)', 16, 25);

            doc.setTextColor(15, 23, 42);
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(203, 213, 225);
            doc.roundedRect(16, 44, 178, 22, 3, 3, 'FD');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text('CÓDIGO ÚNICO DE VERIFICACIÓN', 22, 52);
            doc.setTextColor(15, 76, 129);
            doc.setFontSize(18);
            doc.text(code, 22, 61);

            const sectorVal = record ? record.sector : state.sector;
            const procVal = record ? record.procedure : state.procedure;
            const chanVal = record ? record.channel : 'Lengua de Señas Peruana';
            const statusVal = record ? record.status : 'Cierre confirmado';
            const timeVal = record ? record.timestamp : new Date().toLocaleString('es-PE');

            doc.setTextColor(15, 23, 42);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            const rows = [
              ['Fecha y hora:', timeVal],
              ['Sede / Sector:', sectorVal],
              ['Trámite:', procVal],
              ['Canal de atención:', chanVal],
              ['ID de intérprete:', 'INT-LSP-042'],
              ['Estado de cierre:', statusVal]
            ];
            let y = 78;
            rows.forEach(([k, v]) => {
              doc.setFont('helvetica', 'bold');
              doc.text(k, 16, y);
              doc.setFont('helvetica', 'normal');
              doc.text(doc.splitTextToSize(String(v), 78), 60, y);
              y += 10;
            });

            const verifyUrl = buildReceiptVerifyUrl(code, sectorVal, procVal);
            const qrMatrix = encodeIsoQrMatrix(verifyUrl);
            if (qrMatrix) {
              const qSize = qrMatrix.length;
              const qrOriginX = 148;
              const qrOriginY = 74;
              const boxMm = 46;
              const padMm = 3;
              const modMm = (boxMm - padMm * 2) / qSize;
              doc.setFillColor(255, 255, 255);
              doc.setDrawColor(203, 213, 225);
              doc.rect(qrOriginX, qrOriginY, boxMm, boxMm, 'FD');
              doc.setFillColor(10, 37, 64);
              for (let r = 0; r < qSize; r += 1) {
                for (let c = 0; c < qSize; c += 1) {
                  if (qrMatrix[r][c]) {
                    doc.rect(qrOriginX + padMm + c * modMm, qrOriginY + padMm + r * modMm, modMm, modMm, 'F');
                  }
                }
              }
              doc.setTextColor(71, 85, 105);
              doc.setFontSize(8.5);
              doc.text('Escanea para verificar (ISO 18004)', qrOriginX, qrOriginY + boxMm + 5);
            }

            doc.setDrawColor(21, 128, 61);
            doc.setFillColor(240, 253, 244);
            doc.roundedRect(16, 146, 178, 28, 3, 3, 'FD');
            doc.setTextColor(21, 128, 61);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text('PRIVACIDAD Y PROTECCIÓN DE DATOS', 22, 154);
            doc.setTextColor(15, 23, 42);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.text(
              'Sin grabación de video ni almacenamiento de chat en el navegador. Purga local aplicada al cierre conforme a la Ley N.° 29733 y la Ley N.° 29535.',
              22,
              161,
              { maxWidth: 166 }
            );

            doc.save(`constancia-${code}.pdf`);
            return;
          }
        } catch (err) {
          console.warn('[Constancia PDF]', err);
        } finally {
          downloadingReceipt = false;
        }

        downloadReceiptTxt(code, record);
      }

      if (btnDownloadReceipt) btnDownloadReceipt.addEventListener('click', downloadReceiptFile);
      if (btnPdfDownload) btnPdfDownload.addEventListener('click', downloadReceiptFile);
      if (btnPrintTicket) btnPrintTicket.addEventListener('click', () => window.print());
      if (btnPdfPrint) btnPdfPrint.addEventListener('click', () => window.print());

      if (btnCopyClosureCode) {
        btnCopyClosureCode.addEventListener('click', () => {
          const codeText = state.lastReceiptCode || '';
          const confirmCopied = () => {
            btnCopyClosureCode.textContent = '¡Código copiado!';
            if (timers.copyCodeTimer) clearTimeout(timers.copyCodeTimer);
            timers.copyCodeTimer = setTimeout(() => {
              btnCopyClosureCode.textContent = 'Copiar código';
              timers.copyCodeTimer = null;
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
    }

    initEmergencyFlow();
    initChannelAndSector();
    initChatAndSensitiveData();
    initInterpreterConsole();
    initClosureAndReceipt();

    document.addEventListener('senasegura:purge', () => {
      clearAllSessionTimers();
      purgeTransientInputs();
    });
    window.addEventListener('pagehide', clearAllSessionTimers);

    updateSectorContext('Banco');
    updateTurnLabels();
    syncMicControlsUI();
    setInterpreterStatus('Disponible');
    setChannel(state.channel);
    updateLiveBadge();
    updateStepsGuide();

    window.SenaSegura = Object.freeze({
      getChannel: () => state.channel,
      getContext: () => ({ sector: getEffectiveSector(), procedure: getEffectiveProcedure() }),
      setChannel,
      appendChatMessage(sender, text, type = 'user') {
        state.sessionActive = true;
        enterOperateScreen({ focusTarget: false });
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

    function verifyReceiptCode(rawInput, urlParams = null) {
      let raw = String(rawInput || '').trim().toUpperCase();
      if (/^\d{8}$/.test(raw) || raw === '84920') raw = `SEG-${raw}`;

      const stored = receiptRegistry.get(raw);
      const isEightDigitPattern = /^SEG-\d{8}$/.test(raw);
      const urlSector = urlParams ? String(urlParams.get('s') || '').trim() : '';
      const urlProc = urlParams ? String(urlParams.get('m') || '').trim() : '';

      if (stored || isEightDigitPattern) {
        const record = stored || {
          code: raw,
          sector: urlSector || 'Atención institucional',
          procedure: urlProc || '',
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
          p2.textContent = `Sede: ${record.sector} · Canal: ${record.channel}`;

          const nodes = [p1, p2];
          if (record.procedure) {
            const pProc = document.createElement('p');
            pProc.textContent = `Trámite: ${record.procedure}`;
            nodes.push(pProc);
          }

          const p3 = document.createElement('p');
          p3.textContent = `Fecha: ${record.timestamp} · Purga local aplicada`;
          nodes.push(p3);

          resultDetails.replaceChildren(...nodes);
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
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      verifyReceiptCode(input.value);
    });

    const queryParams = new URLSearchParams(window.location.search);
    const queryCode = queryParams.get('verificar');
    if (queryCode && queryCode.trim()) {
      let normalizedQuery = queryCode.trim().toUpperCase();
      if (/^\d{8}$/.test(normalizedQuery) || normalizedQuery === '84920') {
        normalizedQuery = `SEG-${normalizedQuery}`;
      }
      if (receiptRegistry.has(normalizedQuery) || /^SEG-\d{8}$/.test(normalizedQuery)) {
        input.value = normalizedQuery;
        verifyReceiptCode(normalizedQuery, queryParams);
      }
    }
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

    if (consentEl) consentEl.addEventListener('change', validateConsent);

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
    const openDemoPrivacy = document.getElementById('btn-demo-privacy');
    const btnPrintPrivacy = document.getElementById('btn-print-privacy');
    const openSupportFloating = document.getElementById('btn-floating-support');
    const openSupportFooter = document.getElementById('btn-footer-support');

    if (openConformity) openConformity.addEventListener('click', () => openDialog('modal-conformity', openConformity));
    if (openPrivacy) openPrivacy.addEventListener('click', () => openDialog('modal-privacy', openPrivacy));
    if (openDemoPrivacy) {
      openDemoPrivacy.addEventListener('click', (e) => {
        e.preventDefault();
        openDialog('modal-privacy', openDemoPrivacy);
      });
    }
    if (btnPrintPrivacy) btnPrintPrivacy.addEventListener('click', () => window.print());
    if (openSupportFloating) openSupportFloating.addEventListener('click', () => openDialog('modal-support', openSupportFloating));
    if (openSupportFooter) openSupportFooter.addEventListener('click', () => openDialog('modal-support', openSupportFooter));

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
     ========================================================= */
  function initFloatingSupport() {
    const btn = document.getElementById('btn-floating-support');
    const targets = document.querySelectorAll('[data-support-avoid]');
    if (!btn || !targets.length || !('IntersectionObserver' in window)) return;

    const overlapping = new Set();
    let intersectionObserver = null;
    let resizeTimer = 0;
    let mutationTimer = 0;

    function refresh() {
      btn.classList.toggle('is-avoiding', overlapping.size > 0);
    }

    function observe() {
      if (intersectionObserver) intersectionObserver.disconnect();
      overlapping.clear();
      refresh();

      const rect = btn.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const top = Math.max(0, Math.round(rect.top - 8));
      const left = Math.max(0, Math.round(rect.left - 8));
      const right = Math.max(0, Math.round(vw - rect.right - 8));
      const bottom = Math.max(0, Math.round(vh - rect.bottom - 8));

      intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) overlapping.add(entry.target);
            else overlapping.delete(entry.target);
          });
          refresh();
        },
        { rootMargin: `-${top}px -${right}px -${bottom}px -${left}px`, threshold: 0 }
      );
      targets.forEach((el) => intersectionObserver.observe(el));
    }

    const scheduleResizeObserve = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(observe, 150);
    };

    const scheduleMutationObserve = () => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(observe, 80);
    };

    window.addEventListener('resize', scheduleResizeObserve);
    const mutationObserver = new MutationObserver(scheduleMutationObserve);
    mutationObserver.observe(htmlEl, {
      attributes: true,
      attributeFilter: ['data-font-scale', 'data-contrast']
    });

    window.addEventListener('pagehide', () => {
      clearTimeout(resizeTimer);
      clearTimeout(mutationTimer);
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
      mutationObserver.disconnect();
    });

    observe();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(observe).catch(() => {});
    }
  }

  /* =========================================================
     INICIALIZACIÓN Y PROTECCIÓN BFCACHE
     ========================================================= */
  document.addEventListener('DOMContentLoaded', () => {
    purgeTransientInputs();
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

  window.addEventListener('pageshow', (e) => {
    purgeTransientInputs();
    if (e.persisted) {
      document.dispatchEvent(new CustomEvent('senasegura:purge'));
    }
  });
})();
