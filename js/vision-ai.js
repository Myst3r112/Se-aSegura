/**
 * SeñaSegura · Módulo "Cámara IA (Gestos)" (Vanilla JS ES6+)
 *
 * - MediaPipe Hands se inyecta dinámicamente SOLO cuando la persona pulsa "Activar Cámara IA".
 *   No existe ninguna etiqueta <script> de MediaPipe en el HTML (Lighthouse intacto en la carga inicial).
 * - Todo el procesamiento de video ocurre en el dispositivo: no se graba ni se envía video.
 * - Si no hay cámara, se deniega el permiso o falla el CDN, se activa un modo de respaldo
 *   (cuadrícula de 6 gestos) que ejecuta exactamente el mismo flujo de traducción.
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
  const COOLDOWN_MS = 2500; // antes de reenviar la misma frase al chat
  const GRACE_MS = 150; // parpadeos de detección tolerados sin reiniciar el temporizador
  const MIN_FRAME_INTERVAL_MS = 33; // máx. ~30 inferencias/s
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
    idle: 'Pulsa “Activar Cámara IA” y muestra tu mano frente a la cámara.',
    loading: 'Cargando modelo de visión... Si el navegador lo solicita, permite el acceso a la cámara.',
    simulation: 'Modo simulación: la cámara no está en uso. Elige un gesto de la cuadrícula para probar la traducción.'
  };

  const GESTURES = [
    { id: 'palma', emoji: '✋', label: 'Palma abierta', phrase: 'Hola, necesito atención en ventanilla' },
    { id: 'pulgar', emoji: '👍', label: 'Pulgar arriba', phrase: 'Sí, confirmo los datos' },
    { id: 'puno', emoji: '✊', label: 'Puño cerrado', phrase: 'No / Detener operación' },
    { id: 'indice', emoji: '☝️', label: 'Solo índice arriba', phrase: 'Quiero realizar una consulta o trámite' },
    { id: 'v', emoji: '✌️', label: 'Dos dedos en V', phrase: 'Aquí tengo mi DNI / documento' },
    {
      id: 'auxilio',
      emoji: '🤟',
      label: 'Seña de auxilio (ILY)',
      phrase: 'Necesito ayuda urgente — Escalar a Intérprete',
      urgent: true
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

    // Dedo extendido: la punta está más lejos de la muñeca que su articulación PIP (8vs6, 12vs10, 16vs14, 20vs18)
    const isExtended = (tip, pip) => dist(P[tip], P[0]) - dist(P[pip], P[0]) > 0.1 * palmSize;

    // Pulgar (4, 3, 2): punta [4] vs articulación [3] medidas contra el nudillo del meñique [17].
    // Si la punta se aleja del meñique más que la articulación, el pulgar está abierto.
    // No depende de qué mano sea (izquierda/derecha): solo de que el pulgar se aleje de la palma.
    const thumbTipToPinkyBase = dist(P[4], P[17]);
    const thumbSpread = thumbTipToPinkyBase > dist(P[3], P[17]) * 1.04 && thumbTipToPinkyBase > 0.85 * palmSize;

    // Pulgar vertical hacia arriba: orientación dominante vertical y bien por encima del nudillo del índice
    const dx = Math.abs(P[4].x - P[2].x);
    const dy = P[2].y - P[4].y;
    const thumbUp = P[4].y < P[3].y && P[3].y < P[2].y && dy > dx && P[5].y - P[4].y > 0.25 * palmSize;

    const thumbExtended = thumbSpread || thumbUp;

    const fingers = {
      thumb: thumbExtended,
      index: isExtended(8, 6),
      middle: isExtended(12, 10),
      ring: isExtended(16, 14),
      pinky: isExtended(20, 18)
    };
    const { thumb: T, index: I, middle: M, ring: R, pinky: K } = fingers;

    let id = null;
    if (T && I && M && R && K) id = 'palma';
    else if (!T && !I && !M && !R && !K) id = 'puno';
    else if (T && !I && !M && !R && !K && thumbUp) id = 'pulgar';
    else if (!T && I && !M && !R && !K) id = 'indice';
    else if (!T && I && M && !R && !K) id = 'v';
    else if (T && I && !M && !R && K) id = 'auxilio';

    return { id, fingers };
  }

  // Disponible para pruebas manuales en consola; no altera el estado de la app.
  window.SenaSeguraVision = Object.freeze({ classifyHand, GESTURES });

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
    const video = $('vision-video');
    const canvas = $('vision-canvas');
    const statusBox = $('vision-status');
    const statusText = $('vision-status-text');
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
    const gestureName = $('vision-gesture-name');
    const phraseEl = $('vision-phrase');
    const confidenceEl = $('vision-confidence');
    const sentNote = $('vision-sent-note');
    const urgentHint = $('vision-urgent-hint');
    const progressBar = $('vision-progress');
    const progressFill = $('vision-progress-fill');
    const progressValue = $('vision-progress-value');

    if (!panel || !video || !canvas || !btnStart || !btnStop || !btnSimulate || !btnSpeak || !btnEscalate) {
      return; // el panel no existe en esta página
    }

    const ctx = canvas.getContext('2d');
    const DEFAULT_PHRASE = 'Muestra un gesto y mantenlo 0,6 s para traducirlo.';

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
    const detection = { id: null, since: 0, lastSeen: 0, confirmed: false, scoreSum: 0, scoreN: 0 };

    /* ---------- UI helpers ---------- */
    function setStatus(nextMode) {
      mode = nextMode;
      statusBox.setAttribute('data-state', nextMode);
      statusText.textContent = STATUS_TEXT[nextMode];
      placeholder.hidden = nextMode === 'live';
      if (nextMode !== 'live') {
        placeholderText.textContent = PLACEHOLDER_TEXT[nextMode];
      }
      const busy = nextMode === 'loading' || nextMode === 'live';
      btnStart.disabled = busy;
      btnStop.disabled = nextMode === 'idle';
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
    }

    function resetDetection() {
      detection.id = null;
      detection.since = 0;
      detection.lastSeen = 0;
      detection.confirmed = false;
      detection.scoreSum = 0;
      detection.scoreN = 0;
      setProgress(0);
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
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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
        const lowPower = (navigator.hardwareConcurrency || 4) <= 4 || window.matchMedia('(max-width: 767px)').matches;
        instance.setOptions({
          maxNumHands: 1,
          modelComplexity: lowPower ? 0 : 1,
          minDetectionConfidence: 0.6,
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

        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
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
    function drawHand(landmarks) {
      const high = document.documentElement.getAttribute('data-contrast') === 'high';
      const lineColor = high ? '#F59E0B' : '#0F4C81';
      const dotColor = high ? '#FFFFFF' : '#F59E0B';
      const connections = window.HAND_CONNECTIONS || HAND_CONNECTIONS_FALLBACK;

      if (typeof window.drawConnectors === 'function' && typeof window.drawLandmarks === 'function') {
        window.drawConnectors(ctx, landmarks, connections, { color: high ? '#121820' : '#FFFFFF', lineWidth: 8 });
        window.drawConnectors(ctx, landmarks, connections, { color: lineColor, lineWidth: 4 });
        window.drawLandmarks(ctx, landmarks, { color: '#121820', fillColor: dotColor, lineWidth: 2, radius: 5 });
        return;
      }

      // Respaldo manual si drawing_utils no cargó
      const w = canvas.width;
      const h = canvas.height;
      [[high ? '#121820' : '#FFFFFF', 8], [lineColor, 4]].forEach(([color, width]) => {
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

    function handleResults(results) {
      if (!running) return;
      clearCanvas();
      const landmarks = results.multiHandLandmarks && results.multiHandLandmarks[0];
      const now = performance.now();

      if (!landmarks) {
        feedGesture(null, 0, now);
        return;
      }
      drawHand(landmarks);
      const handedness = results.multiHandedness && results.multiHandedness[0];
      const score = handedness && typeof handedness.score === 'number' ? handedness.score : 0.9;
      const { id } = classifyHand(landmarks, canvas.width / canvas.height);
      feedGesture(id, score, now);
    }

    /** Exige 600 ms de estabilidad antes de confirmar un gesto. */
    function feedGesture(id, score, now) {
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
        return;
      }

      const progress = Math.min(1, (now - detection.since) / CONFIRM_MS);
      setProgress(progress);

      if (progress >= 1 && !detection.confirmed) {
        detection.confirmed = true;
        const avg = detection.scoreN ? detection.scoreSum / detection.scoreN : 0.9;
        confirmGesture(detection.id, Math.round(avg * 100), 'camera');
      }
    }

    /** Flujo único (cámara y simulación): caja de traducción + chat + voz. */
    function confirmGesture(id, confidencePct, source) {
      const gesture = GESTURE_BY_ID[id];
      if (!gesture) return;
      lastConfirmed = gesture;

      gestureName.textContent = `${gesture.label}`;
      phraseEl.textContent = gesture.phrase;
      confidenceEl.textContent = `Confianza: ${confidencePct}%${source === 'simulation' ? ' (simulada)' : ''}`;
      btnSpeak.disabled = false;
      setUrgent(Boolean(gesture.urgent));

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
