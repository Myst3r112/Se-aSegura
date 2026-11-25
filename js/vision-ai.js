/**
 * SeñaSegura · Módulo "Cámara IA (Gestos)" (Vanilla JS ES6+)
 *
 * - MediaPipe Hands se inyecta dinámicamente SOLO cuando la persona pulsa "Activar Cámara IA".
 *   No existe ninguna etiqueta <script> de MediaPipe en el HTML (Lighthouse intacto en la carga inicial).
 * - Todo el procesamiento de video ocurre en el dispositivo: no se graba ni se envía video.
 * - Si no hay cámara, se deniega el permiso o falla el CDN, se activa un modo de respaldo
 *   (cuadrícula de 8 gestos: 1 y 2 manos) que ejecuta exactamente el mismo flujo de traducción.
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

  const CONFIRM_MS = 600; // el gesto debe mantenerse estable este tiempo
  const CONFIRM_FAST_MS = 280; // confirmación ágil ante saludo activo en movimiento
  const COOLDOWN_MS = 2500; // antes de reenviar la misma frase al chat
  const GRACE_MS = 150; // parpadeos de detección tolerados sin reiniciar el temporizador
  const MIN_FRAME_INTERVAL_MS = 33; // máx. ~30 inferencias/s
  const MOTION_WINDOW = 18; // ventana deslizante para detección dinámica
  const CUSTOM_TARGET_SAMPLES = 12;
  const CUSTOM_SIMILARITY_THRESHOLD = 0.94;
  const LOAD_TIMEOUT_MS = 25000;
  const SCRIPT_TIMEOUT_MS = 15000;

  const CHAT_SENDER = 'Ciudadano (Cámara IA)';

  const STATUS_TEXT = {
    idle: 'Cámara inactiva',
    loading: 'Cargando modelo de visión...',
    live: 'Detectando señas en vivo',
    simulation: 'Modo simulación activo'
  };

  const PLACEHOLDER_TEXT = {
    idle: 'Pulsa “Activar Cámara IA” y muestra una o ambas manos frente a la cámara.',
    loading: 'Cargando modelo de visión... Si el navegador lo solicita, permite el acceso a la cámara.',
    simulation: 'Modo simulación: la cámara no está en uso. Elige un gesto de la cuadrícula para probar la traducción.'
  };

  const GESTURES = [
    { id: 'palma', emoji: '\u{270B}', label: 'Palma abierta', phrase: 'Hola, necesito atención en ventanilla' },
    { id: 'pulgar', emoji: '\u{1F44D}', label: 'Pulgar arriba', phrase: 'Sí, confirmo los datos' },
    { id: 'puno', emoji: '\u{270A}', label: 'Puño cerrado', phrase: 'No / Detener operación' },
    { id: 'indice', emoji: '\u{261D}\u{FE0F}', label: 'Solo índice arriba', phrase: 'Quiero realizar una consulta o trámite' },
    { id: 'v', emoji: '\u{270C}\u{FE0F}', label: 'Dos dedos en V', phrase: 'Aquí tengo mi DNI / documento' },
    {
      id: 'negar_mov',
      emoji: '\u{1F645}',
      label: 'Negación con índice',
      phrase: 'No estoy de acuerdo / Por favor corregir'
    },
    {
      id: 'auxilio',
      emoji: '\u{1F91F}',
      label: 'Seña de auxilio (ILY)',
      phrase: 'Necesito ayuda urgente — Escalar a Intérprete',
      urgent: true
    },
    {
      id: 'dos_palmas',
      emoji: '\u{1F64C}',
      label: 'Dos palmas abiertas',
      phrase: 'Por favor, espera un momento',
      twoHands: true
    },
    {
      id: 'dos_pulgares',
      emoji: '\u{1F44D}\u{1F44D}',
      label: 'Dos pulgares arriba',
      phrase: 'Todo conforme, muchas gracias',
      twoHands: true
    }
  ];
  const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));

  // Conexiones de la mano (respaldo si HAND_CONNECTIONS no estuviera disponible)
  const HAND_CONNECTIONS_FALLBACK = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
  ];

  /* =========================================================
     2. CLASIFICADOR GEOMÉTRICO (puro, sin DOM)
     Independiente de mano izquierda/derecha y de la rotación de la mano.
     ========================================================= */
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
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

    const thumbExtended = thumbSpread || thumbUp;

    const fingers = {
      thumb: thumbExtended,
      index: isExtended(8, 6, 5),
      middle: isExtended(12, 10, 9),
      ring: isExtended(16, 14, 13),
      pinky: isExtended(20, 18, 17)
    };
    const { index: I, middle: M, ring: R, pinky: K } = fingers;

    let id = null;
    if (I && M && R && K) id = 'palma';
    else if (!I && !M && !R && !K && thumbUp) id = 'pulgar';
    else if (!I && !M && !R && !K && !thumbUp) id = 'puno';
    else if (I && !M && !R && K) id = 'auxilio';
    else if (I && M && !R && !K) id = 'v';
    else if (I && !M && !R && !K) id = 'indice';

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
   * Normaliza los 21 landmarks de una mano en un vector invariante de 42 valores (x, y)
   * centrado en la muñeca [0] y escalado por palmSize.
   * @param {Array<{x:number,y:number,z?:number}>} landmarks
   * @param {number} aspect
   * @returns {number[]|null}
   */
  function extractHandFeatureVector(landmarks, aspect = 4 / 3) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
    const ox = landmarks[0].x * aspect;
    const oy = landmarks[0].y;
    const mx = landmarks[9].x * aspect;
    const my = landmarks[9].y;
    const palmSize = Math.hypot(mx - ox, my - oy) || 1e-6;
    const vec = new Array(42);
    for (let i = 0; i < 21; i += 1) {
      vec[i * 2] = (landmarks[i].x * aspect - ox) / palmSize;
      vec[i * 2 + 1] = (landmarks[i].y - oy) / palmSize;
    }
    return vec;
  }

  /**
   * Similitud coseno entre dos vectores de características.
   * @param {number[]} vecA
   * @param {number[]} vecB
   * @returns {number}
   */
  function cosineSimilarity(vecA, vecB) {
    if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
      return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i += 1) {
      const a = vecA[i];
      const b = vecB[i];
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  /**
   * Detecta oscilación horizontal en la ventana deslizante de trayectoria (muñeca o punta índice).
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
        const dx = recent[i][xKey] - anchorX;
        if (Math.abs(dx) >= stepThreshold) {
          const nextDir = dx > 0 ? 1 : -1;
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
   * Clasificador Few-Shot k-NN (k=3) sobre señas personalizadas guardadas en sesión.
   * @param {number[]} featureVec
   * @param {Array<{id:string,label:string,phrase:string,samples:number[][]}>} customList
   * @param {number} threshold
   * @returns {{id:string,score:number,gesture:object}|null}
   */
  function matchCustomGesture(featureVec, customList, threshold = CUSTOM_SIMILARITY_THRESHOLD) {
    if (!featureVec || !Array.isArray(customList) || customList.length === 0) return null;
    let bestGesture = null;
    let bestScore = -1;

    customList.forEach((gesture) => {
      if (!gesture || !Array.isArray(gesture.samples) || gesture.samples.length === 0) return;
      const sims = gesture.samples
        .map((sample) => cosineSimilarity(featureVec, sample))
        .sort((a, b) => b - a);
      const topK = sims.slice(0, Math.min(3, sims.length));
      const meanScore = topK.reduce((sum, val) => sum + val, 0) / topK.length;
      if (meanScore > bestScore) {
        bestScore = meanScore;
        bestGesture = gesture;
      }
    });

    if (bestGesture && bestScore >= threshold) {
      return { id: bestGesture.id, score: bestScore, gesture: bestGesture };
    }
    return null;
  }

  // Disponible para pruebas manuales en consola; no altera el estado de la app.
  window.SenaSeguraVision = Object.freeze({
    classifyHand,
    resolveMultiHandGesture,
    extractHandFeatureVector,
    cosineSimilarity,
    detectHorizontalOscillation,
    matchCustomGesture,
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
    const btnStop = $('btn-vision-stop');
    const btnSimulate = $('btn-vision-simulate');
    const btnSpeak = $('btn-vision-speak');
    const btnEscalate = $('btn-vision-escalate');
    const simBox = $('vision-simulation');
    const simGrid = $('vision-gesture-grid');
    const guideList = $('vision-guide-list');
    const customLabelInput = $('vision-custom-label');
    const btnCapture = $('btn-vision-capture');
    const btnClearCustom = $('btn-vision-clear-custom');
    const trainerProgressWrap = $('vision-trainer-progress-wrap');
    const trainerProgress = $('vision-trainer-progress');
    const trainerProgressFill = $('vision-trainer-progress-fill');
    const trainerStatus = $('vision-trainer-status');
    const customListEl = $('vision-custom-list');
    const autoSpeakToggle = $('vision-autospeak');
    const gestureName = $('vision-gesture-name');
    const phraseEl = $('vision-phrase');
    const confidenceEl = $('vision-confidence');
    const sentNote = $('vision-sent-note');
    const urgentHint = $('vision-urgent-hint');
    const progressBar = $('vision-progress');
    const progressFill = $('vision-progress-fill');
    const progressLabel = $('vision-progress-label');
    const progressValue = $('vision-progress-value');

    if (!panel || !video || !canvas || !btnStart || !btnStop || !btnSimulate || !btnSpeak || !btnEscalate) {
      return; // el panel no existe en esta página
    }

    const ctx = canvas.getContext('2d');
    const DEFAULT_PHRASE = 'Muestra un gesto y mantenlo 0,6 s para traducirlo.';
    const DEFAULT_PROGRESS_LABEL = 'Estabilidad del gesto (600 ms)';

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
    const lastSentAt = {};
    const motionBuffer = [];
    let customGestures = [];
    let customSeq = 0;
    let captureState = null;
    const detection = { id: null, since: 0, lastSeen: 0, confirmed: false, scoreSum: 0, scoreN: 0 };

    function resolveGestureMeta(id) {
      if (!id) return null;
      return GESTURE_BY_ID[id] || customGestures.find((g) => g.id === id) || null;
    }

    function updateCaptureProgress(count) {
      const safe = Math.max(0, Math.min(CUSTOM_TARGET_SAMPLES, count));
      if (trainerProgressWrap) trainerProgressWrap.hidden = !captureState;
      if (trainerProgress) trainerProgress.setAttribute('aria-valuenow', String(safe));
      if (trainerProgressFill) trainerProgressFill.style.transform = `scaleX(${safe / CUSTOM_TARGET_SAMPLES})`;
    }

    function renderCustomGestures() {
      if (btnClearCustom) btnClearCustom.hidden = customGestures.length === 0;
      if (!customListEl) return;
      customListEl.textContent = '';

      customGestures.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'vision-custom-item';

        const meta = document.createElement('div');
        meta.className = 'vision-custom-meta';

        const nameEl = document.createElement('strong');
        nameEl.textContent = item.label;

        const samplesEl = document.createElement('span');
        samplesEl.className = 'vision-custom-samples';
        samplesEl.textContent = `${item.samples.length} muestras · IA local`;

        meta.append(nameEl, samplesEl);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-soft';
        removeBtn.dataset.removeCustom = item.id;
        removeBtn.textContent = 'Eliminar';
        removeBtn.setAttribute('aria-label', `Eliminar seña ${item.label}`);

        li.append(meta, removeBtn);
        customListEl.appendChild(li);
      });
    }

    function clearCustomGestures(statusMessage) {
      customGestures = [];
      captureState = null;
      updateCaptureProgress(0);
      renderCustomGestures();
      if (btnCapture) btnCapture.disabled = mode !== 'live';
      if (trainerStatus) {
        trainerStatus.textContent =
          statusMessage || 'Activa la cámara en vivo para entrenar una seña con 12 muestras locales.';
      }
    }

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
      const busy = nextMode === 'loading' || nextMode === 'live';
      btnStart.disabled = busy;
      btnStop.disabled = nextMode === 'idle';
      if (btnCapture) btnCapture.disabled = nextMode !== 'live' || Boolean(captureState);
      const btnStopLabel = btnStop.querySelector('span') || btnStop;
      btnStopLabel.textContent = nextMode === 'simulation' ? 'Salir de simulación' : 'Detener Cámara';
      btnSimulate.disabled = nextMode === 'simulation';
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

    function resetOutput() {
      lastConfirmed = null;
      gestureName.textContent = 'Sin gesto confirmado';
      phraseEl.textContent = DEFAULT_PHRASE;
      confidenceEl.textContent = 'Confianza: —';
      sentNote.hidden = true;
      sentNote.textContent = '';
      btnSpeak.disabled = true;
      setUrgent(false);
      setProgress(0);
      if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
    }

    function resetDetection() {
      detection.id = null;
      detection.since = 0;
      detection.lastSeen = 0;
      detection.confirmed = false;
      detection.scoreSum = 0;
      detection.scoreN = 0;
      motionBuffer.length = 0;
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
      captureState = null;
      updateCaptureProgress(0);
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
      btnStop.focus();

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
        enterSimulation(`${cameraErrorMessage(camResult.reason)} Usa los gestos de prueba para continuar.`);
        return;
      }
      stream = camResult.value;

      if (libResult.status === 'rejected') {
        enterSimulation(`${modelErrorMessage()} Usa los gestos de prueba para continuar.`);
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
        enterSimulation('No se pudo mostrar el video de la cámara. Usa los gestos de prueba para continuar.');
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
            enterSimulation('Ocurrió un error al analizar la cámara. Usa los gestos de prueba para continuar.');
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

    function finalizeCapturedGesture() {
      if (!captureState) return;
      const { label, samples } = captureState;
      const existingIdx = customGestures.findIndex((g) => g.label.toLowerCase() === label.toLowerCase());
      const entry = {
        id: existingIdx >= 0 ? customGestures[existingIdx].id : `custom_${++customSeq}`,
        emoji: '\u{2728}',
        label,
        phrase: label,
        samples: samples.slice()
      };
      if (existingIdx >= 0) {
        customGestures[existingIdx] = entry;
      } else {
        customGestures.push(entry);
      }
      captureState = null;
      updateCaptureProgress(0);
      if (customLabelInput) customLabelInput.value = '';
      if (btnCapture) btnCapture.disabled = mode !== 'live';
      renderCustomGestures();
      if (trainerStatus) {
        trainerStatus.textContent = `¡Seña "${label}" entrenada con ${CUSTOM_TARGET_SAMPLES} muestras! Mantén la seña 0,6 s para probarla.`;
      }
    }

    function handleResults(results) {
      if (!running) return;
      clearCanvas();
      const allLandmarks = Array.isArray(results.multiHandLandmarks) ? results.multiHandLandmarks : [];
      const now = performance.now();
      updateHandsCount(allLandmarks.length);

      const aspect = canvas.width / canvas.height;

      if (captureState) {
        if (allLandmarks.length === 0) {
          if (trainerStatus) {
            trainerStatus.textContent = `Muestra una mano frente a la cámara para capturar (${captureState.samples.length} / ${CUSTOM_TARGET_SAMPLES})…`;
          }
          return;
        }
        allLandmarks.forEach((landmarks, idx) => drawHand(landmarks, idx));
        const vec = extractHandFeatureVector(allLandmarks[0], aspect);
        if (vec) {
          captureState.samples.push(vec);
          const count = captureState.samples.length;
          updateCaptureProgress(count);
          if (count >= CUSTOM_TARGET_SAMPLES) {
            finalizeCapturedGesture();
          } else if (trainerStatus) {
            trainerStatus.textContent = `Capturando muestras: ${count} / ${CUSTOM_TARGET_SAMPLES}…`;
          }
        }
        return;
      }

      if (allLandmarks.length === 0) {
        motionBuffer.length = 0;
        feedGesture(null, 0, now);
        return;
      }

      pushMotionFrame(allLandmarks[0], aspect, now);
      const hasOscillation = detectHorizontalOscillation(motionBuffer);

      let customMatch = null;
      let fastConfirm = false;
      const handEntries = [];

      allLandmarks.forEach((landmarks, idx) => {
        drawHand(landmarks, idx);
        const handedness = results.multiHandedness && results.multiHandedness[idx];
        const score = handedness && typeof handedness.score === 'number' ? handedness.score : 0.9;
        const { id: staticId } = classifyHand(landmarks, aspect);
        let effectiveId = staticId;

        if (idx === 0 && hasOscillation) {
          if (staticId === 'palma') fastConfirm = true;
          else if (staticId === 'indice') effectiveId = 'negar_mov';
        }

        handEntries.push({ id: effectiveId, score });

        if (!customMatch && customGestures.length > 0 && staticId !== 'auxilio') {
          const vec = extractHandFeatureVector(landmarks, aspect);
          const match = matchCustomGesture(vec, customGestures, CUSTOM_SIMILARITY_THRESHOLD);
          if (match) customMatch = match;
        }
      });

      const hasAuxilio = handEntries.some((entry) => entry.id === 'auxilio');
      if (customMatch && !hasAuxilio) {
        feedGesture(customMatch.id, customMatch.score, now);
        return;
      }

      const resolved = resolveMultiHandGesture(handEntries, detection.id);
      feedGesture(resolved ? resolved.id : null, resolved ? resolved.score : 0, now, { fastConfirm });
    }

    /** Exige estabilidad (600 ms o 280 ms en saludo activo) antes de confirmar un gesto. */
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

      const activeGesture = resolveGestureMeta(detection.id);
      if (progressLabel && activeGesture) {
        progressLabel.textContent = `Confirmando: ${activeGesture.label}…`;
      }

      const targetMs = fastConfirm ? CONFIRM_FAST_MS : CONFIRM_MS;
      const progress = Math.min(1, (now - detection.since) / targetMs);
      setProgress(progress);

      if (progress >= 1 && !detection.confirmed) {
        detection.confirmed = true;
        const avg = detection.scoreN ? detection.scoreSum / detection.scoreN : 0.9;
        confirmGesture(detection.id, Math.round(avg * 100), 'camera');
      }
    }

    /** Flujo único (cámara y simulación): caja de traducción + chat + voz. */
    function confirmGesture(id, confidencePct, source) {
      const gesture = resolveGestureMeta(id);
      if (!gesture) return;
      lastConfirmed = gesture;

      gestureName.textContent = `${gesture.label}`;
      phraseEl.textContent = gesture.phrase;
      confidenceEl.textContent = `Confianza: ${confidencePct}%${source === 'simulation' ? ' (simulada)' : ''}`;
      btnSpeak.disabled = false;
      setUrgent(Boolean(gesture.urgent));
      if (autoSpeakToggle && autoSpeakToggle.checked) {
        speakLast();
      }

      const now = performance.now();
      const last = lastSentAt[id];
      const canSend = typeof last !== 'number' || now - last >= COOLDOWN_MS;
      if (canSend) {
        lastSentAt[id] = now;
        const bridge = window.SenaSegura;
        if (bridge && typeof bridge.appendChatMessage === 'function') {
          bridge.appendChatMessage(CHAT_SENDER, gesture.phrase, 'user');
        }
        sentNote.textContent = 'Enviado al chat de Mensajería Asistida.';
      } else {
        sentNote.textContent = 'No se reenvió al chat: la misma frase se envió hace menos de 2,5 s.';
      }
      sentNote.hidden = false;
    }

    /* ---------- Voz al funcionario ---------- */
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

    function speakLast() {
      if (!lastConfirmed) return;
      if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
        sentNote.textContent = 'Tu navegador no admite síntesis de voz.';
        sentNote.hidden = false;
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel(); // evita colas trabadas
      const utterance = new window.SpeechSynthesisUtterance(lastConfirmed.phrase);
      const voice = pickSpanishVoice();
      utterance.voice = voice;
      utterance.lang = voice ? voice.lang : 'es-PE';
      if (!voice && synth.getVoices && synth.getVoices().length) utterance.lang = 'es-ES';
      utterance.rate = 0.95;
      setTimeout(() => synth.speak(utterance), 60);
    }

    function cancelSpeech() {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
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

    /* ---------- Eventos ---------- */
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
      text.textContent = gesture.phrase;

      btn.append(emoji, label, text);
      simGrid.appendChild(btn);

      if (guideList) {
        const li = document.createElement('li');
        const guideEmoji = document.createElement('span');
        guideEmoji.className = 'vision-guide-emoji';
        guideEmoji.setAttribute('aria-hidden', 'true');
        guideEmoji.textContent = gesture.emoji;

        const descWrap = document.createElement('span');
        const modality = gesture.id === 'auxilio' ? '1 o 2 manos' : gesture.twoHands ? '2 manos' : '1 mano';
        const strong = document.createElement('strong');
        strong.textContent = `${gesture.label} (${modality}):`;
        descWrap.append(strong, ` ${gesture.phrase}`);

        li.append(guideEmoji, descWrap);
        guideList.appendChild(li);
      }
    });

    simGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.vision-gesture-btn[data-gesture]');
      if (!btn) return;
      const confidence = Math.round(90 + Math.random() * 8);
      setProgress(1);
      confirmGesture(btn.getAttribute('data-gesture'), confidence, 'simulation');
    });

    btnStart.addEventListener('click', startCamera);

    btnStop.addEventListener('click', () => {
      resetToIdle();
      btnStart.focus();
    });

    btnSimulate.addEventListener('click', () => {
      enterSimulation('');
      const first = simGrid.querySelector('.vision-gesture-btn');
      if (first) first.focus();
    });

    btnSpeak.addEventListener('click', speakLast);
    btnEscalate.addEventListener('click', escalate);

    if (btnCapture) {
      btnCapture.addEventListener('click', () => {
        if (mode !== 'live' || captureState) return;
        const rawLabel = customLabelInput ? customLabelInput.value.trim() : '';
        if (rawLabel.length < 2) {
          if (trainerStatus) {
            trainerStatus.textContent = 'Escribe un nombre o frase de al menos 2 caracteres antes de capturar.';
          }
          if (customLabelInput) customLabelInput.focus();
          return;
        }
        captureState = { label: rawLabel, samples: [] };
        btnCapture.disabled = true;
        updateCaptureProgress(0);
        if (trainerStatus) {
          trainerStatus.textContent = `Capturando muestras: 0 / ${CUSTOM_TARGET_SAMPLES}… Muestra tu seña frente a la cámara.`;
        }
      });
    }

    if (customListEl) {
      customListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-remove-custom]');
        if (!btn) return;
        const targetId = btn.dataset.removeCustom;
        customGestures = customGestures.filter((g) => g.id !== targetId);
        if (lastConfirmed && lastConfirmed.id === targetId) {
          resetOutput();
        }
        renderCustomGestures();
        if (trainerStatus) {
          trainerStatus.textContent = customGestures.length
            ? 'Seña eliminada de la sesión local.'
            : 'Activa la cámara en vivo para entrenar una seña con 12 muestras locales.';
        }
      });
    }

    if (btnClearCustom) {
      btnClearCustom.addEventListener('click', () => {
        clearCustomGestures('Todas las señas personalizadas fueron eliminadas de la memoria local.');
      });
    }

    // Esc detiene la cámara / simulación cuando el foco está dentro del panel
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mode !== 'idle') {
        e.preventDefault();
        resetToIdle();
        btnStart.focus();
      }
    });

    // Salir de "Cámara IA (Gestos)" detiene la cámara automáticamente
    document.addEventListener('senasegura:channelchange', (e) => {
      if (!e.detail || e.detail.channel !== 'camara') {
        resetToIdle();
      }
    });

    // Purga local al cerrar la atención
    document.addEventListener('senasegura:purge', () => {
      clearCustomGestures('Señas personalizadas eliminadas tras cerrar sesión.');
      resetToIdle();
      cancelSpeech();
    });

    // Libera la cámara al cambiar de pestaña o cerrar la página
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (mode === 'loading' || mode === 'live')) {
        stopCamera();
        showNotice('La cámara se detuvo al salir de la pestaña. Pulsa “Activar Cámara IA” para reanudar.');
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
