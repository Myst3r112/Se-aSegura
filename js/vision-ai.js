/**
 * SeñaSegura · Módulo "Cámara IA (LSP)" (Vanilla JS ES6+)
 *
 * - MediaPipe Hands se inyecta dinámicamente SOLO cuando la persona pulsa "Activar Cámara".
 *   No existe ninguna etiqueta <script> de MediaPipe en el HTML (Lighthouse intacto en la carga inicial).
 * - Todo el procesamiento de video ocurre en el dispositivo: no se graba ni se envía video.
 * - Un único motor interno pre-entrenado (sin botones de modo) evalúa en cada frame:
 *   señas de ventanilla (1 y 2 manos + movimiento en 18 frames) y letras distintivas del alfabeto LSP.
 *   Cada seña confirmada se encadena en una oración legible (LSP → Español).
 * - Si no hay cámara, se deniega el permiso o falla el CDN, se activa una cuadrícula de respaldo
 *   que ejecuta exactamente el mismo flujo de traducción.
 *
 * Integración con js/main.js mediante:
 *   - window.SenaSegura (puente: setChannel, appendChatMessage, activateEmergency)
 *   - eventos 'senasegura:channelchange' y 'senasegura:purge'
 */
(() => {
  'use strict';

  /* =========================================================
     1. CONSTANTES
     ========================================================= */
  const HANDS_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
  const MP_SCRIPTS = [
    HANDS_BASE_URL + 'hands.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js'
  ];

  const CONFIRM_MS = 350; // ritmo ágil: la seña debe mantenerse estable este tiempo
  const CONFIRM_FAST_MS = 220; // saludo activo (palma en movimiento) se confirma más rápido
  const CONFIRM_INDEX_MS = 560; // el índice espera un instante para distinguir "quieto" de "negación en movimiento"
  const COOLDOWN_MS = 1200; // antes de encadenar de nuevo la misma seña
  const GRACE_MS = 150; // parpadeos de detección tolerados sin reiniciar el temporizador
  const MIN_FRAME_INTERVAL_MS = 33; // máx. ~30 inferencias/s
  const MOTION_WINDOW = 18; // frames de trayectoria para detectar señas dinámicas
  const AUTO_SEND_PAUSE_MS = 2000; // manos abajo este tiempo → envío y voz automáticos
  const LOAD_TIMEOUT_MS = 25000;
  const SCRIPT_TIMEOUT_MS = 15000;

  const CHAT_SENDER = 'Ciudadano (Cámara IA)';

  const STATUS_TEXT = {
    idle: 'Cámara inactiva',
    loading: 'Cargando modelo…',
    live: 'En vivo',
    simulation: 'Modo prueba'
  };

  const PLACEHOLDER_TEXT = {
    idle: 'Pulsa “Activar Cámara” y muestra una o ambas manos. El video se procesa en tu dispositivo: no se graba ni se envía.',
    loading: 'Cargando modelo de visión... Si el navegador lo solicita, permite el acceso a la cámara.',
    simulation: 'Modo prueba: la cámara no está en uso. Elige una seña de la cuadrícula para probar la traducción.'
  };

  /**
   * Catálogo único de señas (fuente de verdad para detección, cuadrícula sin cámara y guía).
   * `phrase` es el fragmento que se encadena en la oración; en letras es `letter`.
   */
  const GESTURES = [
    { id: 'palma', emoji: '\u{270B}', label: 'Palma abierta / saludo', phrase: 'Hola,', hands: '1 mano' },
    { id: 'indice', emoji: '\u{261D}\u{FE0F}', label: 'Solo índice arriba', phrase: 'necesito una consulta', hands: '1 mano' },
    {
      id: 'negar_mov',
      emoji: '\u{1F645}',
      label: 'Índice de lado a lado',
      phrase: 'no, corregir por favor',
      hands: '1 mano con movimiento'
    },
    { id: 'pulgar', emoji: '\u{1F44D}', label: 'Pulgar arriba', phrase: 'sí, confirmo', hands: '1 mano' },
    { id: 'puno', emoji: '\u{270A}', label: 'Puño cerrado', phrase: 'detener operación', hands: '1 mano' },
    { id: 'v', emoji: '\u{270C}\u{FE0F}', label: 'Dos dedos en V', phrase: 'aquí tengo mi DNI', hands: '1 mano' },
    {
      id: 'dos_palmas',
      emoji: '\u{1F64C}',
      label: 'Dos palmas abiertas',
      phrase: 'espera un momento',
      hands: '2 manos',
      twoHands: true
    },
    {
      id: 'dos_pulgares',
      emoji: '\u{1F44D}\u{1F44D}',
      label: 'Dos pulgares arriba',
      phrase: 'muchas gracias, todo conforme',
      hands: '2 manos',
      twoHands: true
    },
    {
      id: 'auxilio',
      emoji: '\u{1F91F}',
      label: 'Seña de auxilio (ILY)',
      phrase: 'necesito ayuda urgente',
      hands: '1 o 2 manos',
      urgent: true
    },
    { id: 'letra_l', kind: 'letter', letter: 'L', emoji: 'L', label: 'Letra L', hands: '1 mano', hint: 'pulgar e índice en ángulo recto' },
    { id: 'letra_y', kind: 'letter', letter: 'Y', emoji: 'Y', label: 'Letra Y', hands: '1 mano', hint: 'pulgar y meñique abiertos' },
    { id: 'letra_f', kind: 'letter', letter: 'F', emoji: 'F', label: 'Letra F', hands: '1 mano', hint: 'pulgar e índice en círculo, otros tres arriba' },
    { id: 'letra_o', kind: 'letter', letter: 'O', emoji: 'O', label: 'Letra O', hands: '1 mano', hint: 'dedos curvados tocando el pulgar' },
    { id: 'letra_c', kind: 'letter', letter: 'C', emoji: 'C', label: 'Letra C', hands: '1 mano', hint: 'mano curvada como una C' },
    { id: 'letra_w', kind: 'letter', letter: 'W', emoji: 'W', label: 'Letra W', hands: '1 mano', hint: 'índice, medio y anular arriba' }
  ];
  const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));

  // Conexiones de la mano (respaldo si HAND_CONNECTIONS no estuviera disponible)
  const HAND_CONNECTIONS_FALLBACK = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
  ];

  /* =========================================================
     2. MOTOR DE CLASIFICACIÓN (funciones puras, sin DOM)
     Independiente de mano izquierda/derecha y de la rotación de la mano.
     ========================================================= */
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Clasifica la postura estática de UNA mano (señas de ventanilla + letras LSP).
   * @param {Array<{x:number,y:number,z?:number}>} landmarks 21 puntos normalizados de MediaPipe
   * @param {number} aspect ancho/alto del video (corrige la distorsión de coordenadas normalizadas)
   * @returns {{id: string|null, fingers: object}}
   */
  function classifyHand(landmarks, aspect = 4 / 3) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) {
      return { id: null, fingers: null };
    }
    const P = landmarks.map((p) => ({ x: p.x * aspect, y: p.y }));
    const palmSize = dist(P[0], P[9]) || 1e-6; // muñeca → nudillo del medio
    const rel = (a, b) => dist(P[a], P[b]) / palmSize;

    // Dedo extendido: punta más lejos de la muñeca que PIP (+ margen) y que su nudillo MCP
    const isExtended = (tip, pip, mcp) => {
      const tipDist = dist(P[tip], P[0]);
      return tipDist > dist(P[pip], P[0]) + 0.08 * palmSize && tipDist > dist(P[mcp], P[0]);
    };

    // Pulgar abierto lateralmente
    const thumbTipToPinkyBase = dist(P[4], P[17]);
    const thumbSpread = thumbTipToPinkyBase > dist(P[3], P[17]) * 1.04 && thumbTipToPinkyBase > 0.85 * palmSize;

    // Pulgar vertical hacia arriba: tolerante a inclinación natural sin confundirse con puño
    const dx = Math.abs(P[4].x - P[2].x);
    const dy = P[2].y - P[4].y;
    const thumbUp = P[4].y < P[3].y && P[3].y < P[2].y && dy > dx * 0.7 && P[5].y - P[4].y > 0.14 * palmSize;

    const thumbOpen = rel(4, 5) > 0.8; // pulgar claramente separado de la palma (letras L, Y, C)
    const pinch = rel(4, 8); // distancia pulgar-índice normalizada (letras F, O)
    const reach = (tip) => rel(tip, 0); // ≈1.0 puño cerrado · ≈2.0 dedo extendido · ≈1.5 dedo curvado

    const fingers = {
      thumb: thumbSpread || thumbUp,
      index: isExtended(8, 6, 5),
      middle: isExtended(12, 10, 9),
      ring: isExtended(16, 14, 13),
      pinky: isExtended(20, 18, 17)
    };
    const { index: I, middle: M, ring: R, pinky: K } = fingers;

    let id = null;
    if (pinch < 0.32 && M && R && K) id = 'letra_f';
    else if (I && M && R && K) id = 'palma';
    else if (I && !M && !R && K) id = 'auxilio';
    else if (I && M && R && !K) id = 'letra_w';
    else if (I && M && !R && !K) id = 'v';
    else if (I && !M && !R && !K) id = thumbOpen ? 'letra_l' : 'indice';
    else if (!I && !M && !R && K && thumbOpen) id = 'letra_y';
    else if (!I && !M && !R && !K) {
      if (thumbUp) id = 'pulgar';
      else if (pinch < 0.3 && rel(4, 12) < 0.55 && reach(8) > 1.2) id = 'letra_o';
      else if (thumbOpen && pinch >= 0.5 && pinch <= 1.2 && reach(8) > 1.25 && reach(12) > 1.25) id = 'letra_c';
      else id = 'puno';
    }

    return { id, fingers };
  }

  /**
   * Combina las manos detectadas (0, 1 o 2) en un único gesto activo sin parpadeos.
   * @param {Array<{id: string|null, score: number}>} handEntries
   * @param {string|null} currentId gesto en seguimiento actual para desempate estable
   * @returns {{id: string, score: number}|null}
   */
  function resolveMultiHandGesture(handEntries, currentId = null) {
    if (!Array.isArray(handEntries) || handEntries.length === 0) return null;

    if (handEntries.length === 1) {
      const single = handEntries[0];
      return single && single.id ? { id: single.id, score: typeof single.score === 'number' ? single.score : 0.9 } : null;
    }

    const valid = handEntries.filter((entry) => entry && entry.id);
    if (valid.length === 0) return null;

    // 1. Prioridad máxima de seguridad: auxilio en cualquiera de las 2 manos
    const auxHands = valid.filter((entry) => entry.id === 'auxilio');
    if (auxHands.length > 0) {
      const bestAux = auxHands.reduce((best, cur) => ((cur.score || 0) > (best.score || 0) ? cur : best));
      return { id: 'auxilio', score: typeof bestAux.score === 'number' ? bestAux.score : 0.9 };
    }

    // 2 y 3. Gestos bimanuales combinados cuando hay 2 manos activas
    if (valid.length >= 2) {
      const [h0, h1] = valid;
      const avgScore = ((h0.score || 0.9) + (h1.score || 0.9)) / 2;
      if (h0.id === 'palma' && h1.id === 'palma') {
        return { id: 'dos_palmas', score: avgScore };
      }
      if (h0.id === 'pulgar' && h1.id === 'pulgar') {
        return { id: 'dos_pulgares', score: avgScore };
      }
    }

    // 4. Solo una mano hace un gesto válido (la otra está relajada)
    if (valid.length === 1) {
      const active = valid[0];
      return { id: active.id, score: typeof active.score === 'number' ? active.score : 0.9 };
    }

    // 5. Ambas manos con gestos distintos: prioriza el gesto ya en progreso o el de mayor confianza
    if (currentId) {
      const steady = valid.find((entry) => entry.id === currentId);
      if (steady) {
        return { id: steady.id, score: typeof steady.score === 'number' ? steady.score : 0.9 };
      }
    }
    const top = valid.reduce((best, cur) => ((cur.score || 0) > (best.score || 0) ? cur : best));
    return { id: top.id, score: typeof top.score === 'number' ? top.score : 0.9 };
  }

  /**
   * Detecta oscilación horizontal en la ventana deslizante de trayectoria (muñeca o punta del índice).
   * @param {Array<{t:number,palmSize:number,wristX:number,wristY:number,tipX:number,tipY:number}>} motionBuffer
   * @returns {boolean}
   */
  function detectHorizontalOscillation(motionBuffer) {
    if (!Array.isArray(motionBuffer) || motionBuffer.length < 8) return false;
    const latestT = motionBuffer[motionBuffer.length - 1].t;
    const recent = motionBuffer.filter((f) => latestT - f.t <= 1400);
    if (recent.length < 8) return false;

    const avgPalm = recent.reduce((acc, f) => acc + (f.palmSize || 0.1), 0) / recent.length || 1e-6;

    function axisOscillates(xKey, yKey) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < recent.length; i += 1) {
        const x = recent[i][xKey];
        const y = recent[i][yKey];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const spanX = (maxX - minX) / avgPalm;
      const spanY = (maxY - minY) / avgPalm;
      if (spanX < 0.45 || spanX <= spanY * 1.1) return false;

      let dir = 0;
      let reversals = 0;
      let anchorX = recent[0][xKey];
      const stepThreshold = 0.04 * avgPalm;
      for (let i = 1; i < recent.length; i += 1) {
        const dxStep = recent[i][xKey] - anchorX;
        if (Math.abs(dxStep) >= stepThreshold) {
          const nextDir = dxStep > 0 ? 1 : -1;
          if (dir !== 0 && nextDir !== dir) reversals += 1;
          dir = nextDir;
          anchorX = recent[i][xKey];
        }
      }
      return reversals >= 2;
    }

    return axisOscillates('tipX', 'tipY') || axisOscillates('wristX', 'wristY');
  }

  /**
   * Encadena las señas confirmadas en una oración legible (capitalización, espacios y punto final).
   * Las letras consecutivas se unen en un código (ej. "L" + "Y" → "LY").
   * @param {Array<{kind:'word'|'letter', text:string}>} tokens
   * @returns {string}
   */
  function composeSentence(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return '';
    const parts = [];
    let letterRun = '';
    const flushLetters = () => {
      if (letterRun) {
        parts.push({ text: letterRun, kind: 'letters' });
        letterRun = '';
      }
    };
    tokens.forEach((token) => {
      if (token.kind === 'letter') {
        letterRun += token.text;
      } else {
        flushLetters();
        parts.push({ text: token.text, kind: 'word' });
      }
    });
    flushLetters();

    let sentence = parts.map((p) => p.text).join(' ');
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    if (parts[parts.length - 1].kind === 'word') {
      sentence = sentence.replace(/[,;:]$/, '');
      if (!/[.!?]$/.test(sentence)) sentence += '.';
    }
    return sentence;
  }

  // Disponible para pruebas manuales en consola; no altera el estado de la app.
  window.SenaSeguraVision = Object.freeze({
    classifyHand,
    resolveMultiHandGesture,
    detectHorizontalOscillation,
    composeSentence,
    GESTURES
  });

  /* =========================================================
     3. CARGA DINÁMICA DE MEDIAPIPE (sin duplicados)
     ========================================================= */
  const scriptPromises = new Map();

  function loadScript(src) {
    if (scriptPromises.has(src)) return scriptPromises.get(src);

    const promise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      const timer = setTimeout(() => fail(new Error('timeout')), SCRIPT_TIMEOUT_MS);

      function fail(err) {
        clearTimeout(timer);
        el.remove();
        scriptPromises.delete(src); // permite reintentar
        reject(err);
      }

      el.src = src;
      el.async = true;
      el.crossOrigin = 'anonymous';
      el.setAttribute('data-vision-src', src);
      el.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      el.onerror = () => fail(new Error('network'));
      document.head.appendChild(el);
    });

    scriptPromises.set(src, promise);
    return promise;
  }

  async function loadMediaPipe() {
    await Promise.all([
      loadScript(MP_SCRIPTS[0]),
      loadScript(MP_SCRIPTS[1]).catch(() => null) // el dibujo tiene respaldo propio
    ]);
    if (typeof window.Hands !== 'function') {
      throw new Error('hands-unavailable');
    }
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  /* =========================================================
     4. MÓDULO DE INTERFAZ Y CÁMARA
     ========================================================= */
  function init() {
    const $ = (id) => document.getElementById(id);
    const panel = $('vision-panel');
    const stage = $('vision-stage');
    const video = $('vision-video');
    const canvas = $('vision-canvas');
    const statusBox = $('vision-status');
    const statusText = $('vision-status-text');
    const handsCountEl = $('vision-hands-count');
    const notice = $('vision-notice');
    const placeholder = $('vision-placeholder');
    const placeholderText = $('vision-placeholder-text');
    const btnStart = $('btn-vision-start');
    const btnSimulate = $('btn-vision-simulate');
    const btnSpeak = $('btn-vision-speak');
    const btnUndo = $('btn-vision-undo');
    const btnEscalate = $('btn-vision-escalate');
    const simBox = $('vision-simulation');
    const simGrid = $('vision-gesture-grid');
    const guideList = $('vision-guide-list');
    const sentenceEl = $('vision-sentence');
    const lastDetectEl = $('vision-last-detect');
    const sentNote = $('vision-sent-note');
    const urgentHint = $('vision-urgent-hint');
    const progressBar = $('vision-progress');
    const progressFill = $('vision-progress-fill');
    const progressLabel = $('vision-progress-label');
    const progressValue = $('vision-progress-value');

    if (
      !panel || !video || !canvas || !btnStart || !btnSimulate || !btnSpeak || !btnUndo || !btnEscalate ||
      !sentenceEl || !lastDetectEl
    ) {
      return; // el panel no existe en esta página
    }

    const ctx = canvas.getContext('2d');
    const btnStartLabel = btnStart.querySelector('span') || btnStart;
    const btnSimulateLabel = btnSimulate.querySelector('span') || btnSimulate;
    const DEFAULT_SENTENCE = 'Muestra una seña y mantenla un instante para empezar la oración.';
    const DEFAULT_LAST_DETECT = 'Última seña: — · Confianza: —';
    const DEFAULT_PROGRESS_LABEL = `Estabilidad de la seña (${CONFIRM_MS} ms)`;

    let mode = 'idle'; // idle | loading | live | simulation
    let sessionToken = 0;
    let stream = null;
    let hands = null;
    let handsPromise = null;
    let running = false;
    let rafId = 0;
    let isProcessing = false;
    let lastVideoTime = -1;
    let lastSendAt = 0;
    let lastConfirmed = null;
    let lastProgressPct = -1;
    let handsDownSince = null;
    let sentenceTokens = [];
    const lastAddedAt = {};
    const motionBuffer = [];
    const detection = { id: null, since: 0, lastSeen: 0, confirmed: false, scoreSum: 0, scoreN: 0 };

    /* ---------- UI helpers ---------- */
    function updateHandsCount(count) {
      if (!handsCountEl) return;
      const safeCount = Math.max(0, Math.min(2, Number(count) || 0));
      handsCountEl.textContent = `Manos: ${safeCount} / 2`;
      handsCountEl.setAttribute('aria-label', `Manos detectadas: ${safeCount} de 2`);
      handsCountEl.setAttribute('data-count', String(safeCount));
    }

    function setStatus(nextMode) {
      mode = nextMode;
      statusBox.setAttribute('data-state', nextMode);
      statusText.textContent = STATUS_TEXT[nextMode];
      if (handsCountEl) {
        handsCountEl.hidden = nextMode !== 'live';
        if (nextMode !== 'live') updateHandsCount(0);
      }
      placeholder.hidden = nextMode === 'live';
      if (nextMode !== 'live') {
        placeholderText.textContent = PLACEHOLDER_TEXT[nextMode];
      }
      const cameraOn = nextMode === 'loading' || nextMode === 'live';
      btnStartLabel.textContent = cameraOn ? 'Detener Cámara' : 'Activar Cámara';
      btnSimulateLabel.textContent = nextMode === 'simulation' ? 'Salir de simulación' : 'Probar sin cámara';
      simBox.hidden = nextMode !== 'simulation';
    }

    function showNotice(message) {
      if (!message) {
        notice.hidden = true;
        notice.textContent = '';
        return;
      }
      notice.textContent = message;
      notice.hidden = false;
    }

    function setProgress(fraction) {
      const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      if (pct === lastProgressPct) return;
      lastProgressPct = pct;
      progressFill.style.transform = `scaleX(${pct / 100})`;
      progressValue.textContent = `${pct}%`;
      progressBar.setAttribute('aria-valuenow', String(pct));
    }

    function setUrgent(isUrgent) {
      btnEscalate.classList.toggle('is-highlighted', isUrgent);
      urgentHint.hidden = !isUrgent;
    }

    function renderSentence() {
      const text = composeSentence(sentenceTokens);
      sentenceEl.textContent = text || DEFAULT_SENTENCE;
      sentenceEl.classList.toggle('is-empty', !text);
      const hasTokens = sentenceTokens.length > 0;
      btnSpeak.disabled = !hasTokens;
      btnUndo.disabled = !hasTokens && !lastConfirmed;
    }

    function resetOutput() {
      lastConfirmed = null;
      sentenceTokens = [];
      Object.keys(lastAddedAt).forEach((key) => delete lastAddedAt[key]);
      lastDetectEl.textContent = DEFAULT_LAST_DETECT;
      sentNote.hidden = true;
      sentNote.textContent = '';
      setUrgent(false);
      setProgress(0);
      if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
      renderSentence();
    }

    function resetDetection() {
      detection.id = null;
      detection.since = 0;
      detection.lastSeen = 0;
      detection.confirmed = false;
      detection.scoreSum = 0;
      detection.scoreN = 0;
      motionBuffer.length = 0;
      handsDownSince = null;
      setProgress(0);
      if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
    }

    /* ---------- Cámara ---------- */
    function releaseStream() {
      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {
            /* pista ya detenida */
          }
        });
        stream = null;
      }
      try {
        video.pause();
      } catch (_) {
        /* sin reproducción activa */
      }
      video.srcObject = null;
    }

    function clearCanvas() {
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    /** Detiene bucle, libera todas las pistas y cancela cualquier arranque pendiente. */
    function stopCamera({ keepStatus = false } = {}) {
      sessionToken += 1;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      isProcessing = false;
      releaseStream();
      clearCanvas();
      if (stage) stage.style.removeProperty('aspect-ratio');
      updateHandsCount(0);
      resetDetection();
      setUrgent(false);
      if (!keepStatus) setStatus('idle');
    }

    function resetToIdle() {
      stopCamera();
      showNotice('');
      resetOutput();
    }

    function openCamera() {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        const err = new Error('unsupported');
        err.name = 'UnsupportedError';
        return Promise.reject(err);
      }
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } },
        audio: false
      });
    }

    function cameraErrorMessage(err) {
      switch (err && err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
        case 'SecurityError':
          return 'Se denegó el permiso de cámara.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
        case 'OverconstrainedError':
          return 'No se encontró una cámara disponible en este dispositivo.';
        case 'NotReadableError':
        case 'TrackStartError':
        case 'AbortError':
          return 'La cámara está en uso por otra aplicación o no responde.';
        case 'UnsupportedError':
          return 'Este navegador o conexión no permite usar la cámara (se requiere HTTPS o localhost).';
        default:
          return 'No se pudo iniciar la cámara.';
      }
    }

    function modelErrorMessage() {
      return navigator.onLine === false
        ? 'Sin conexión a internet: no se pudo descargar el modelo de visión.'
        : 'No se pudo descargar el modelo de visión. Revisa tu conexión.';
    }

    function getHands() {
      if (handsPromise) return handsPromise;
      handsPromise = (async () => {
        await loadMediaPipe();
        const instance = new window.Hands({ locateFile: (file) => HANDS_BASE_URL + file });
        const lowPower = window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 4) <= 2;
        instance.setOptions({
          maxNumHands: 2,
          modelComplexity: lowPower ? 0 : 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        instance.onResults(handleResults);
        await withTimeout(instance.initialize(), LOAD_TIMEOUT_MS);
        return instance;
      })().catch((err) => {
        handsPromise = null; // permite reintentar
        throw err;
      });
      return handsPromise;
    }

    function waitForVideoReady() {
      return new Promise((resolve, reject) => {
        if (video.readyState >= 2 && video.videoWidth) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          video.removeEventListener('loadeddata', onReady);
          reject(new Error('video-timeout'));
        }, 8000);
        function onReady() {
          clearTimeout(timer);
          resolve();
        }
        video.addEventListener('loadeddata', onReady, { once: true });
      });
    }

    /** Activa el modo respaldo con aviso claro (sin errores en consola). */
    function enterSimulation(message) {
      stopCamera({ keepStatus: true });
      resetOutput();
      showNotice(message || '');
      setStatus('simulation');
    }

    async function startCamera() {
      if (mode === 'loading' || mode === 'live') return;
      stopCamera({ keepStatus: true });
      const token = sessionToken;
      showNotice('');
      resetOutput();
      setStatus('loading');
      btnStart.focus();

      // Permiso de cámara y descarga del modelo en paralelo
      const [camResult, libResult] = await Promise.allSettled([openCamera(), getHands()]);

      if (token !== sessionToken) {
        // La persona detuvo o cambió de canal mientras cargaba
        if (camResult.status === 'fulfilled') {
          camResult.value.getTracks().forEach((t) => t.stop());
        }
        return;
      }

      if (camResult.status === 'rejected') {
        enterSimulation(`${cameraErrorMessage(camResult.reason)} Usa la prueba sin cámara para continuar.`);
        return;
      }
      stream = camResult.value;

      if (libResult.status === 'rejected') {
        enterSimulation(`${modelErrorMessage()} Usa la prueba sin cámara para continuar.`);
        return;
      }
      hands = libResult.value;

      try {
        video.srcObject = stream;
        video.muted = true;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
        await waitForVideoReady();
        if (token !== sessionToken) return;

        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        canvas.width = vw;
        canvas.height = vh;
        if (stage) stage.style.aspectRatio = `${vw} / ${vh}`;
        running = true;
        lastVideoTime = -1;
        lastSendAt = 0;
        isProcessing = false;
        setStatus('live');
        rafId = requestAnimationFrame(loop);
      } catch (_) {
        if (token !== sessionToken) return;
        enterSimulation('No se pudo mostrar el video de la cámara. Usa la prueba sin cámara para continuar.');
      }
    }

    /** Bucle propio con requestAnimationFrame y bandera isProcessing (sin camera_utils). */
    function loop() {
      if (!running) return;
      rafId = requestAnimationFrame(loop);
      if (isProcessing) return;
      if (video.readyState < 2 || video.paused || video.ended) return;

      const now = performance.now();
      if (now - lastSendAt < MIN_FRAME_INTERVAL_MS) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      lastSendAt = now;

      isProcessing = true;
      hands
        .send({ image: video })
        .catch(() => {
          if (running) {
            enterSimulation('Ocurrió un error al analizar la cámara. Usa la prueba sin cámara para continuar.');
          }
        })
        .then(() => {
          isProcessing = false;
        });
    }

    /* ---------- Resultados, dibujo y filtro anti-ruido ---------- */
    function drawHand(landmarks, handIndex = 0) {
      const high = document.documentElement.getAttribute('data-contrast') === 'high';
      const isSecond = handIndex > 0;
      const haloColor = high ? '#121820' : '#FFFFFF';
      const lineColor = high ? (isSecond ? '#FFFFFF' : '#F59E0B') : (isSecond ? '#15803D' : '#0F4C81');
      const dotColor = high ? (isSecond ? '#F59E0B' : '#FFFFFF') : (isSecond ? '#FFFFFF' : '#F59E0B');
      const connections = window.HAND_CONNECTIONS || HAND_CONNECTIONS_FALLBACK;

      if (typeof window.drawConnectors === 'function' && typeof window.drawLandmarks === 'function') {
        window.drawConnectors(ctx, landmarks, connections, { color: haloColor, lineWidth: 8 });
        window.drawConnectors(ctx, landmarks, connections, { color: lineColor, lineWidth: 4 });
        window.drawLandmarks(ctx, landmarks, { color: '#121820', fillColor: dotColor, lineWidth: 2, radius: 5 });
        return;
      }

      // Respaldo manual si drawing_utils no cargó
      const w = canvas.width;
      const h = canvas.height;
      [[haloColor, 8], [lineColor, 4]].forEach(([color, width]) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        connections.forEach(([a, b]) => {
          ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
          ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
        });
        ctx.stroke();
      });
      ctx.fillStyle = dotColor;
      ctx.strokeStyle = '#121820';
      ctx.lineWidth = 2;
      landmarks.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    function pushMotionFrame(landmarks, aspect, now) {
      const wristX = landmarks[0].x * aspect;
      const wristY = landmarks[0].y;
      const palmSize = Math.hypot(landmarks[9].x * aspect - wristX, landmarks[9].y - wristY) || 1e-6;
      if (motionBuffer.length >= MOTION_WINDOW) motionBuffer.shift();
      motionBuffer.push({
        t: now,
        palmSize,
        wristX,
        wristY,
        tipX: landmarks[8].x * aspect,
        tipY: landmarks[8].y
      });
    }

    function handleResults(results) {
      if (!running) return;
      clearCanvas();
      const allLandmarks = Array.isArray(results.multiHandLandmarks) ? results.multiHandLandmarks : [];
      const now = performance.now();
      updateHandsCount(allLandmarks.length);

      if (allLandmarks.length === 0) {
        motionBuffer.length = 0;
        feedGesture(null, 0, now);
        if (handsDownSince === null) handsDownSince = now;
        if (sentenceTokens.length > 0 && now - handsDownSince >= AUTO_SEND_PAUSE_MS) {
          sendSentence({ auto: true });
        }
        return;
      }
      handsDownSince = null;

      const aspect = canvas.width / canvas.height;
      pushMotionFrame(allLandmarks[0], aspect, now);
      const hasOscillation = detectHorizontalOscillation(motionBuffer);

      let fastConfirm = false;
      const handEntries = [];
      allLandmarks.forEach((landmarks, idx) => {
        drawHand(landmarks, idx);
        const handedness = results.multiHandedness && results.multiHandedness[idx];
        const score = handedness && typeof handedness.score === 'number' ? handedness.score : 0.9;
        const { id: staticId } = classifyHand(landmarks, aspect);
        let effectiveId = staticId;

        if (idx === 0 && hasOscillation) {
          if (staticId === 'palma') fastConfirm = true; // saludo activo
          else if (staticId === 'indice') effectiveId = 'negar_mov'; // negación con índice
        }
        handEntries.push({ id: effectiveId, score });
      });

      const resolved = resolveMultiHandGesture(handEntries, detection.id);
      feedGesture(resolved ? resolved.id : null, resolved ? resolved.score : 0, now, { fastConfirm });
    }

    /** Exige estabilidad breve antes de confirmar una seña (ritmo ágil, adaptado a cada tipo de seña). */
    function feedGesture(id, score, now, { fastConfirm = false } = {}) {
      if (id && id === detection.id) {
        detection.lastSeen = now;
        detection.scoreSum += score;
        detection.scoreN += 1;
      } else if (detection.id && now - detection.lastSeen < GRACE_MS) {
        // Ruido breve: se tolera sin reiniciar el temporizador
      } else {
        detection.id = id;
        detection.since = now;
        detection.lastSeen = now;
        detection.confirmed = false;
        detection.scoreSum = id ? score : 0;
        detection.scoreN = id ? 1 : 0;
      }

      if (!detection.id) {
        setProgress(0);
        if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
        return;
      }

      const activeGesture = GESTURE_BY_ID[detection.id];
      if (progressLabel && activeGesture) {
        progressLabel.textContent = `Confirmando: ${activeGesture.label}…`;
      }

      let targetMs = CONFIRM_MS;
      if (fastConfirm) targetMs = CONFIRM_FAST_MS;
      else if (detection.id === 'indice') targetMs = CONFIRM_INDEX_MS;
      const progress = Math.min(1, (now - detection.since) / targetMs);
      setProgress(progress);

      if (progress >= 1 && !detection.confirmed) {
        detection.confirmed = true;
        const avg = detection.scoreN ? detection.scoreSum / detection.scoreN : 0.9;
        confirmGesture(detection.id, Math.round(avg * 100), 'camera');
      }
    }

    /** Flujo único (cámara y prueba): encadena la seña en la oración traducida en vivo. */
    function confirmGesture(id, confidencePct, source) {
      const gesture = GESTURE_BY_ID[id];
      if (!gesture) return;
      lastConfirmed = gesture;

      const isSimulated = source === 'simulation';
      lastDetectEl.textContent = `Última seña: ${gesture.label} · Confianza: ${confidencePct}%${isSimulated ? ' (simulada)' : ''}`;
      setUrgent(Boolean(gesture.urgent));

      const now = performance.now();
      const last = lastAddedAt[id];
      const canAdd = isSimulated || typeof last !== 'number' || now - last >= COOLDOWN_MS;
      if (canAdd) {
        lastAddedAt[id] = now;
        const isLetter = gesture.kind === 'letter';
        sentenceTokens.push({
          id,
          kind: isLetter ? 'letter' : 'word',
          text: isLetter ? gesture.letter : gesture.phrase
        });
        renderSentence();
        sentNote.textContent = isSimulated
          ? 'Pulsa “Enviar y leer al funcionario” cuando la oración esté lista.'
          : 'Baja las manos 2 s para enviar y leer automáticamente.';
        sentNote.hidden = false;
        // Seguridad: la seña de auxilio se envía de inmediato, sin esperar la pausa
        if (gesture.urgent) sendSentence({ auto: true });
      } else {
        renderSentence();
      }
    }

    /* ---------- Voz y envío al funcionario ---------- */
    function pickSpanishVoice() {
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      const norm = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
      return (
        voices.find((v) => norm(v) === 'es-pe') ||
        voices.find((v) => norm(v) === 'es-es') ||
        voices.find((v) => norm(v).startsWith('es')) ||
        null
      );
    }

    /** @returns {boolean} true si el navegador pudo iniciar la síntesis de voz. */
    function speakText(text) {
      if (!text) return false;
      if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
        return false;
      }
      const synth = window.speechSynthesis;
      synth.cancel(); // evita colas trabadas
      const utterance = new window.SpeechSynthesisUtterance(text);
      const voice = pickSpanishVoice();
      utterance.voice = voice;
      utterance.lang = voice ? voice.lang : 'es-PE';
      if (!voice && synth.getVoices && synth.getVoices().length) utterance.lang = 'es-ES';
      utterance.rate = 0.95;
      setTimeout(() => synth.speak(utterance), 60);
      return true;
    }

    function cancelSpeech() {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    /** Envía la oración al chat de Mensajería Asistida y la lee en voz alta al funcionario. */
    function sendSentence({ auto = false } = {}) {
      if (sentenceTokens.length === 0) return;
      const text = composeSentence(sentenceTokens);
      sentenceTokens = [];
      renderSentence();

      const bridge = window.SenaSegura;
      if (bridge && typeof bridge.appendChatMessage === 'function') {
        bridge.appendChatMessage(CHAT_SENDER, text, 'user');
      }
      const spoke = speakText(text);
      const prefix = auto ? 'Enviado automáticamente' : 'Enviado';
      sentNote.textContent = spoke
        ? `${prefix} al chat y leído al funcionario: “${text}”`
        : `${prefix} al chat: “${text}”. Tu navegador no admite síntesis de voz.`;
      sentNote.hidden = false;
    }

    /** Deshacer: quita la última seña de la oración; si ya no hay señas, limpia la salida. */
    function undoLast() {
      if (sentenceTokens.length > 0) {
        const removed = sentenceTokens.pop();
        delete lastAddedAt[removed.id];
        const removedGesture = GESTURE_BY_ID[removed.id];
        if (removedGesture && removedGesture.urgent) setUrgent(false);
        renderSentence();
        sentNote.textContent = 'Última seña eliminada de la oración.';
        sentNote.hidden = false;
      } else {
        resetOutput();
      }
    }

    /* ---------- Escalar a intérprete humano ---------- */
    function escalate() {
      stopCamera();
      cancelSpeech();
      const bridge = window.SenaSegura;
      if (bridge && typeof bridge.setChannel === 'function') {
        const wasUrgentGesture = lastConfirmed && lastConfirmed.id === 'auxilio';
        bridge.setChannel('lsp'); // oculta este panel
        if (!wasUrgentGesture && typeof bridge.appendChatMessage === 'function') {
          bridge.appendChatMessage(CHAT_SENDER, 'Solicito un intérprete humano (escalado desde Cámara IA).', 'user');
        }
        bridge.activateEmergency();
      } else {
        const emergencyBtn = document.getElementById('btn-emergency-mode');
        if (emergencyBtn) emergencyBtn.click();
      }
    }

    /* ---------- Cuadrícula de respaldo y guía (única fuente: GESTURES) ---------- */
    GESTURES.forEach((gesture) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vision-gesture-btn${gesture.urgent ? ' is-urgent' : ''}`;
      btn.setAttribute('data-gesture', gesture.id);

      const emoji = document.createElement('span');
      emoji.className = 'vision-gesture-emoji';
      emoji.setAttribute('aria-hidden', 'true');
      emoji.textContent = gesture.emoji;

      const label = document.createElement('span');
      label.className = 'vision-gesture-label';
      label.textContent = gesture.label;

      const text = document.createElement('span');
      text.className = 'vision-gesture-text';
      text.textContent = gesture.kind === 'letter' ? `Añade “${gesture.letter}”` : gesture.phrase;

      btn.append(emoji, label, text);
      simGrid.appendChild(btn);

      if (guideList) {
        const li = document.createElement('li');
        const guideEmoji = document.createElement('span');
        guideEmoji.className = 'vision-guide-emoji';
        guideEmoji.setAttribute('aria-hidden', 'true');
        guideEmoji.textContent = gesture.emoji;

        const descWrap = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = `${gesture.label} (${gesture.hands}):`;
        const detail = gesture.kind === 'letter'
          ? ` añade “${gesture.letter}” · ${gesture.hint}`
          : ` “${gesture.phrase}”`;
        descWrap.append(strong, detail);

        li.append(guideEmoji, descWrap);
        guideList.appendChild(li);
      }
    });

    /* ---------- Eventos ---------- */
    simGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.vision-gesture-btn[data-gesture]');
      if (!btn) return;
      const confidence = Math.round(90 + Math.random() * 8);
      setProgress(1);
      confirmGesture(btn.getAttribute('data-gesture'), confidence, 'simulation');
    });

    btnStart.addEventListener('click', () => {
      if (mode === 'loading' || mode === 'live') {
        resetToIdle();
        btnStart.focus();
        return;
      }
      startCamera();
    });

    btnSimulate.addEventListener('click', () => {
      if (mode === 'simulation') {
        resetToIdle();
        btnSimulate.focus();
        return;
      }
      enterSimulation('');
      const first = simGrid.querySelector('.vision-gesture-btn');
      if (first) first.focus();
    });

    btnSpeak.addEventListener('click', () => sendSentence({ auto: false }));
    btnUndo.addEventListener('click', undoLast);
    btnEscalate.addEventListener('click', escalate);

    // Esc detiene la cámara / simulación cuando el foco está dentro del panel
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mode !== 'idle') {
        e.preventDefault();
        resetToIdle();
        btnStart.focus();
      }
    });

    // Salir de "Cámara IA (LSP)" detiene la cámara automáticamente
    document.addEventListener('senasegura:channelchange', (e) => {
      if (!e.detail || e.detail.channel !== 'camara') {
        resetToIdle();
      }
    });

    // Purga local al cerrar la atención (Ley N.° 29733)
    document.addEventListener('senasegura:purge', () => {
      resetToIdle();
      cancelSpeech();
    });

    // Libera la cámara al cambiar de pestaña o cerrar la página
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (mode === 'loading' || mode === 'live')) {
        stopCamera();
        showNotice('La cámara se detuvo al salir de la pestaña. Pulsa “Activar Cámara” para reanudar.');
      }
    });
    const releaseOnExit = () => {
      stopCamera({ keepStatus: true });
      cancelSpeech();
    };
    window.addEventListener('beforeunload', releaseOnExit);
    window.addEventListener('pagehide', releaseOnExit);

    // Precarga la lista de voces (algunos navegadores la cargan de forma asíncrona)
    if ('speechSynthesis' in window && typeof window.speechSynthesis.getVoices === 'function') {
      window.speechSynthesis.getVoices();
    }

    resetOutput();
    setStatus('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
