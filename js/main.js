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
      dataLines: ['DNI: 00000000', 'Monto: S/ 150.00'],
      procedures: [
        'Consulta de saldo y retiro',
        'Apertura de cuenta',
        'Bloqueo o reposición de tarjeta'
      ],
      templates: [
        'Confirmo mi DNI: 00000000 y monto S/ 150.00.',
        'Por favor, repite en Lengua de Señas Peruana.',
        'Necesito constancia impresa de la operación.'
      ],
      dictationSample: 'Operación bancaria validada por S/ 150.00 en ventanilla.'
    },
    Comisaría: {
      subtitle: 'Comisaría · Datos de ejemplo',
      prompt: 'Indícanos el motivo de tu denuncia o constancia policial.',
      dataLines: ['DNI: 00000000', 'Referencia: Parte N.° 2026-041'],
      procedures: [
        'Registro de denuncia policial',
        'Constancia por pérdida de documentos',
        'Orientación sobre medidas de protección'
      ],
      templates: [
        'Deseo registrar una denuncia con intérprete LSP.',
        'Necesito constancia por pérdida de DNI.',
        'Solicito atención prioritaria por emergencia.'
      ],
      dictationSample: 'Se toma registro de ocurrencia con apoyo de intérprete LSP.'
    },
    Salud: {
      subtitle: 'Centro de Salud · Datos de ejemplo',
      prompt: 'Confirma tus síntomas principales y si presentas alergias.',
      dataLines: ['DNI: 00000000', 'Área: Triaje · Prioridad II'],
      procedures: [
        'Triaje y consulta médica general',
        'Explicación de receta y dosis',
        'Consentimiento informado de procedimiento'
      ],
      templates: [
        'Tengo dolor agudo y necesito intérprete LSP.',
        'No presento alergias conocidas a medicamentos.',
        'Por favor, escribe los horarios de la receta.'
      ],
      dictationSample: 'Indicaciones médicas registradas: tomar 1 tableta cada 8 horas.'
    },
    Municipal: {
      subtitle: 'Municipalidad · Datos de ejemplo',
      prompt: 'Indica el número de expediente o trámite municipal.',
      dataLines: ['DNI: 00000000', 'Expediente: 00412-2026'],
      procedures: [
        'Mesa de partes y seguimiento',
        'Licencia de funcionamiento',
        'Pago de arbitrios y fraccionamiento'
      ],
      templates: [
        'Consulto el estado de mi expediente 00412-2026.',
        'Necesito ayuda con el formulario en texto claro.',
        'Confirmo mis datos para mesa de partes.'
      ],
      dictationSample: 'Expediente 00412-2026 verificado en mesa de partes accesible.'
    }
  };

  /* Canales de comunicación del simulador (HU-035) */
  const CHANNEL_INFO = {
    lsp: { badge: 'Intérprete LSP', meta: 'LSP HD', receipt: 'Lengua de Señas Peruana', oneTap: 'Lengua de Señas Peruana' },
    camara: { badge: 'Cámara IA (Gestos)', meta: 'Cámara IA', receipt: 'Cámara IA (Gestos)', oneTap: 'Cámara IA (Gestos)' },
    texto: { badge: 'Texto / Lectura', meta: 'Texto/Lectura', receipt: 'Texto / Lectura', oneTap: 'Texto/Lectura' }
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
    channel: 'lsp',
    sector: 'Banco',
    procedure: 'Consulta de saldo y retiro',
    emergencyActive: false,
    selectedCrisis: null,
    turnDirection: 'lsp', // 'lsp' | 'funcionario'
    micMuted: false,
    cameraOff: false,
    cameraAngle: 'Frontal · Intérprete LSP',
    outageActive: false,
    dictating: false,
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

  function closeDialog(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    if (lastTriggerElement && typeof lastTriggerElement.focus === 'function') {
      lastTriggerElement.focus();
      lastTriggerElement = null;
    }
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
        ? `Alto contraste activado · Texto al ${state.fontScale}%`
        : `Texto al ${state.fontScale}%`;
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
      if (e.key === 'Escape' && !drawer.hidden) {
        toggleDrawer(false);
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
        panelSteps.innerHTML = data.steps
          .map((step, i) => `<li><span class="step-num">0${i + 1}</span> ${step}</li>`)
          .join('');
      }
    }

    sectorTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectSectorTab(tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          const next = sectorTabs[(index + 1) % sectorTabs.length];
          next.focus();
          selectSectorTab(next);
        } else if (e.key === 'ArrowLeft') {
          const prev = sectorTabs[(index - 1 + sectorTabs.length) % sectorTabs.length];
          prev.focus();
          selectSectorTab(prev);
        }
      });
    });
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
    } catch (_) {
      // Silencio seguro si el navegador restringe Web Audio
    }
  }

  function generate8DigitCode() {
    const randomPart = Math.floor(10000000 + Math.random() * 89999999);
    return `SEG-${randomPart}`;
  }

  /**
   * Genera un código QR determinista en SVG para códigos dinámicos de 8 dígitos.
   */
  function buildDynamicQrSvg(code) {
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

    const rects = [];
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
          rects.push(
            `<rect x="${margin + c * cell}" y="${margin + r * cell}" width="${cell}" height="${cell}" fill="#0A2540"/>`
          );
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="148" height="148" viewBox="0 0 ${total} ${total}" role="img" aria-label="Código QR ${code}"><rect width="${total}" height="${total}" fill="#FFFFFF"/>${rects.join('')}</svg>`;
  }

  function initSimulator() {
    const viewTabs = document.querySelectorAll('.sim-view-tab[data-sim-view]');
    const viewVentanilla = document.getElementById('sim-view-ventanilla');
    const viewConsola = document.getElementById('sim-view-consola');
    const btnConsoleBack = document.getElementById('btn-console-back');

    const sessionMeta = document.getElementById('sim-session-meta');
    const btnOneTap = document.getElementById('btn-one-tap-start');
    const btnEmergency = document.getElementById('btn-emergency-mode');
    const btnExitEmergency = document.getElementById('btn-exit-emergency');
    const emergencyPanel = document.getElementById('emergency-panel');
    const emergencyQueueTimer = document.getElementById('emergency-queue-timer');
    const crisisCards = document.querySelectorAll('.crisis-card[data-crisis]');

    const channelChips = document.querySelectorAll('.pref-chip[data-channel]');
    const sectorChips = document.querySelectorAll('.pref-chip[data-sim-sector]');
    const procedureSelect = document.getElementById('sim-procedure-select');

    const textModeOverlay = document.getElementById('sim-textmode-overlay');
    const videoStage = document.getElementById('sim-video-stage');
    const videoBadgesRow = document.getElementById('sim-video-badges');
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
    const quickTemplatesBox = document.getElementById('sim-quick-templates');
    const btnCopyData = document.getElementById('btn-copy-data');
    const chatForm = document.getElementById('sim-chat-form');
    const chatInput = document.getElementById('sim-chat-input');
    const btnVoiceDictation = document.getElementById('btn-voice-dictation');

    let emergencyInterval = null;

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

    if (btnConsoleBack) {
      btnConsoleBack.addEventListener('click', () => switchSimulatorView('ventanilla'));
    }

    function renderChat() {
      if (!chatMessagesBox) return;
      chatMessagesBox.innerHTML = state.chatMessages
        .map(
          (msg) => `
          <div class="chat-bubble ${msg.type === 'user' ? 'chat-bubble-user' : ''}">
            <span class="chat-sender">${msg.sender}</span>
            <p>${msg.text}</p>
          </div>`
        )
        .join('');
      chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
    }

    function appendMessage(sender, text, type = 'staff') {
      state.chatMessages.push({ sender, text, type });
      renderChat();
    }

    function updateTurnLabels() {
      const label = state.turnDirection === 'lsp' ? 'Interpretando a LSP' : 'Voz a funcionario';
      if (simTurnLabel) simTurnLabel.textContent = label;
      if (consoleTurnStatus) consoleTurnStatus.textContent = label;
      if (fullscreenTurnLabel) fullscreenTurnLabel.textContent = label;
    }

    function updateSessionMeta() {
      if (!sessionMeta) return;
      const channelLabel = (CHANNEL_INFO[state.channel] || CHANNEL_INFO.lsp).meta;
      const statusLabel = state.emergencyActive
        ? 'EMERGENCIA PRIORITARIA (<30 s)'
        : state.sessionActive
          ? 'Atención en curso'
          : 'Sesión lista para iniciar';
      sessionMeta.textContent = `Sin login · ${statusLabel} · ${state.sector} (${channelLabel})`;
    }

    function updateSectorContext(sectorName) {
      state.sector = sectorName;
      const config = SIM_SECTORS[sectorName];
      if (!config) return;

      if (chatSectorLabel) chatSectorLabel.textContent = config.subtitle;
      if (consoleSectorLabel) consoleSectorLabel.textContent = config.subtitle;
      if (sensitiveDataBox) {
        sensitiveDataBox.innerHTML = config.dataLines.map((line) => `<p>${line}</p>`).join('');
      }
      if (consoleDataBox) {
        consoleDataBox.innerHTML = config.dataLines.map((line) => `<p>${line}</p>`).join('');
      }
      if (procedureSelect) {
        procedureSelect.innerHTML = config.procedures
          .map((proc) => `<option value="${proc}">${proc}</option>`)
          .join('');
        state.procedure = config.procedures[0];
        if (consoleProcedureVal) consoleProcedureVal.textContent = state.procedure;
      }
      if (quickTemplatesBox) {
        quickTemplatesBox.innerHTML = config.templates
          .map(
            (tpl, idx) =>
              `<button type="button" class="template-chip" data-template="${tpl}">${tpl.slice(0, 26)}${tpl.length > 26 ? '…' : ''}</button>`
          )
          .join('');
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
    }

    // Delegación para plantillas rápidas
    if (quickTemplatesBox) {
      quickTemplatesBox.addEventListener('click', (e) => {
        const chip = e.target.closest('.template-chip');
        if (!chip) return;
        const text = chip.dataset.template;
        if (!text) return;
        state.sessionActive = true;
        appendMessage('Ciudadano (Plantilla)', text, 'user');
        setTimeout(() => {
          appendMessage('Intérprete LSP / Ventanilla', `Recibido para ${state.procedure}. Continuamos con tu atención.`, 'staff');
        }, 450);
      });
    }

    // Inicio One-Tap (HU-001 a HU-005)
    if (btnOneTap) {
      btnOneTap.addEventListener('click', () => {
        state.sessionActive = true;
        updateSessionMeta();
        appendMessage(
          'Sistema SeñaSegura',
          `Atención iniciada en 1 toque (${state.sector} · ${state.procedure}). Canal: ${(CHANNEL_INFO[state.channel] || CHANNEL_INFO.lsp).oneTap}.`,
          'staff'
        );
      });
    }

    // Modo Emergencia <30 s (HU-009, HU-011, HU-014, HU-015)
    function activateEmergency() {
      state.emergencyActive = true;
      state.sessionActive = true;
      if (emergencyPanel) emergencyPanel.hidden = false;
      if (btnEmergency) btnEmergency.setAttribute('aria-pressed', 'true');
      if (liveBadge) {
        liveBadge.textContent = 'EMERGENCIA · HD';
        liveBadge.classList.add('is-emergency');
      }
      if (consolePriorityVal) consolePriorityVal.textContent = 'EMERGENCIA PRIORITARIA (<30 s)';
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
            'Conexión prioritaria establecida en menos de 30 segundos. Indica tu emergencia o selecciona un pictograma.',
            'staff'
          );
        }
      }, 900);
    }

    function deactivateEmergency() {
      state.emergencyActive = false;
      state.selectedCrisis = null;
      if (emergencyInterval) clearInterval(emergencyInterval);
      if (emergencyPanel) emergencyPanel.hidden = true;
      if (btnEmergency) btnEmergency.setAttribute('aria-pressed', 'false');
      if (liveBadge) {
        liveBadge.textContent = 'EN VIVO · HD';
        liveBadge.classList.remove('is-emergency');
      }
      if (consolePriorityVal) consolePriorityVal.textContent = 'Atención de prueba';
      crisisCards.forEach((card) => card.classList.remove('is-selected'));
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

    crisisCards.forEach((card) => {
      card.addEventListener('click', () => {
        crisisCards.forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        state.selectedCrisis = card.dataset.crisis;
        // Activar automáticamente canal LSP HD para enlace directo (detiene la Cámara IA si estaba activa)
        setChannel('lsp');

        appendMessage(
          'Alerta de Crisis',
          `Pictograma activado: ${state.selectedCrisis}. Videollamada HD >30 fps enlazada con prioridad.`,
          'user'
        );
      });
    });

    // Canal de comunicación: Intérprete LSP | Cámara IA (Gestos) | Texto / Lectura (HU-035)
    function setChannel(ch) {
      if (!CHANNEL_INFO[ch]) return;
      const previous = state.channel;
      state.channel = ch;

      channelChips.forEach((btn) => {
        const active = btn.dataset.channel === ch;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });

      // Vistas según canal: video LSP / panel Cámara IA / overlay de texto
      const isCamera = ch === 'camara';
      if (videoStage) videoStage.hidden = isCamera;
      if (videoBadgesRow) videoBadgesRow.hidden = isCamera;
      if (visionPanel) visionPanel.hidden = !isCamera;
      if (textModeOverlay) textModeOverlay.hidden = ch !== 'texto';

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

    // Copiar datos sensibles
    if (btnCopyData) {
      btnCopyData.addEventListener('click', () => {
        const config = SIM_SECTORS[state.sector];
        const textToCopy = config ? config.dataLines.join(' | ') : 'DNI: 00000000 | Monto: S/ 150.00';
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

    // Dictado de voz simulado (o Web Speech API si está disponible)
    if (btnVoiceDictation && chatInput) {
      btnVoiceDictation.addEventListener('click', () => {
        if (state.dictating) return;
        state.dictating = true;
        btnVoiceDictation.setAttribute('aria-pressed', 'true');
        const btnLabel = btnVoiceDictation.querySelector('span');
        if (btnLabel) btnLabel.textContent = 'Escuchando…';

        const config = SIM_SECTORS[state.sector];
        const sample = config ? config.dictationSample : 'Atención validada en ventanilla.';
        const words = sample.split(' ');
        let i = 0;
        chatInput.value = '';

        const dictTimer = setInterval(() => {
          if (i < words.length) {
            chatInput.value = `${chatInput.value}${i === 0 ? '' : ' '}${words[i]}`;
            i += 1;
          } else {
            clearInterval(dictTimer);
            state.dictating = false;
            btnVoiceDictation.setAttribute('aria-pressed', 'false');
            if (btnLabel) btnLabel.textContent = 'Dictado de voz';
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
        updateSessionMeta();

        setTimeout(() => {
          appendMessage(
            'Personal de ventanilla',
            `Mensaje confirmado en ${state.sector}. Puedes finalizar cuando estés listo para recibir tu código.`,
            'staff'
          );
        }, 500);
      });
    }

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

      // Purga inmediata del chat local
      state.chatMessages = [];
      state.sessionActive = false;
      if (state.emergencyActive) deactivateEmergency();
      if (chatInput) chatInput.value = '';
      updateSectorContext(state.sector);
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

      const qrSvg = buildDynamicQrSvg(code);
      if (codeEl) codeEl.textContent = code;
      if (qrBox) qrBox.innerHTML = qrSvg;
      if (qrCaption) qrCaption.innerHTML = `${code}<br>QR verificable`;
      if (pdfCode) pdfCode.textContent = code;
      if (pdfSector) pdfSector.textContent = `Atención finalizada · Sector: ${state.sector} (${state.procedure})`;
      if (pdfChannel) pdfChannel.textContent = `Canal: ${channelName}`;
      if (pdfQr) pdfQr.innerHTML = qrSvg;

      // Precargar el código generado en el verificador web para prueba inmediata
      const verifierInput = document.getElementById('verifier-code-input');
      if (verifierInput) verifierInput.value = code;

      openDialog('modal-closure', triggerEl);
    }

    if (btnHangup) {
      btnHangup.addEventListener('click', () => finishAttentionAndPurge(btnHangup));
    }
    if (btnFinishSession) {
      btnFinishSession.addEventListener('click', () => finishAttentionAndPurge(btnFinishSession));
    }

    // Descargar constancia + Imprimir ticket + Vista previa PDF
    const btnDownloadReceipt = document.getElementById('btn-download-receipt');
    const btnPrintTicket = document.getElementById('btn-print-ticket');
    const btnPreviewPdf = document.getElementById('btn-preview-pdf');

    if (btnDownloadReceipt) {
      btnDownloadReceipt.addEventListener('click', () => {
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
      });
    }

    if (btnPrintTicket) {
      btnPrintTicket.addEventListener('click', () => {
        window.print();
      });
    }

    if (btnPreviewPdf) {
      btnPreviewPdf.addEventListener('click', () => {
        closeDialog('modal-closure');
        openDialog('modal-pdf-preview', btnFinishSession);
      });
    }

    // Inicializar estado por defecto
    updateSectorContext('Banco');
    updateTurnLabels();
    setChannel(state.channel);

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
    const badgeText = document.getElementById('verifier-badge-text');
    const resultTitle = document.getElementById('verifier-result-title');
    const resultDetails = document.getElementById('verifier-result-details');
    const resultFooter = document.getElementById('verifier-result-footer');

    if (!form || !input || !resultBox) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let raw = input.value.trim().toUpperCase();
      if (/^\d{8}$/.test(raw)) {
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
        if (badgeText) badgeText.textContent = 'Comprobante válido';
        if (resultTitle) resultTitle.textContent = 'Comprobante verificado';
        if (resultDetails) {
          resultDetails.innerHTML = `
            <p><strong>${record.code}</strong> · ${record.status}</p>
            <p>Sector: ${record.sector} · Canal: ${record.channel}</p>
            <p>Fecha: ${record.timestamp} · Purga local aplicada</p>
          `;
        }
        if (resultFooter) {
          resultFooter.textContent = record.isDemoBase
            ? 'DEMOSTRACIÓN · Ejemplo base SEG-84920'
            : 'VERIFICACIÓN ACTIVA · Ley N.° 29733 y Ley N.° 29535';
        }
      } else {
        resultBox.classList.remove('is-valid');
        resultBox.classList.add('is-error');
        if (badgeText) badgeText.textContent = 'Código no reconocido';
        if (resultTitle) resultTitle.textContent = 'No se encontró la constancia';
        if (resultDetails) {
          resultDetails.innerHTML = `
            <p>Ingresa un código de 8 dígitos (ej. SEG-84920418) o el ejemplo SEG-84920.</p>
            <p>Puedes generar un nuevo código cerrando una atención en el Simulador.</p>
          `;
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

    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.faqFilter;
        filterBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });

        let firstVisible = true;
        faqItems.forEach((item) => {
          const match = item.dataset.faqCategory === category;
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
      });
    });

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
        validate: (v) =>
          /^[+\d\s()-]{7,18}$/.test(v.trim())
            ? ''
            : 'Ingresa un número telefónico válido (7 a 15 dígitos).'
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
      btn.addEventListener('click', () => {
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
    // El escalado tipográfico cambia el ancho del botón
    new MutationObserver(() => setTimeout(observe, 50)).observe(htmlEl, {
      attributes: true,
      attributeFilter: ['data-font-scale']
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
