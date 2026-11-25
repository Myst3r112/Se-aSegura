/**
 * SeñaSegura · Módulo "Cámara IA (LSP)" (Vanilla JS ES6+)
 *
 * - Motor dual resiliente cargado ESTRICTAMENTE bajo demanda al pulsar "Activar Cámara" (0 peticiones
 *   externas en la carga inicial para mantener Lighthouse intacto):
 *   · Motor A (principal): @mediapipe/tasks-vision@0.10.14 (FilesetResolver + HandLandmarker GPU/CPU).
 *   · Motor B (respaldo automático): @mediapipe/hands@0.4.1675469240 si falla ESM/WASM/WebGL/CDN.
 * - Todo el procesamiento de video ocurre en el dispositivo: no se graba ni se envía video.
 * - Motor interno 3D basado en `worldLandmarks`, ángulos entre falanges, distancias normalizadas,
 *   suavizado temporal por mayoría (ventana deslizante) y trayectoria en 18 frames:
 *   señas de ventanilla (1 y 2 manos) + alfabeto dactilológico LSP (A, B, C, D, E, F, I, K, L, O, R, S, U, V, W, Y).
 * - Si no hay cámara, se deniega el permiso o fallan ambos motores, se activa la vista compacta de prueba.
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
  const TASKS_VISION_VERSION = '0.10.14';
  const VISION_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/vision_bundle.mjs`;
  const VISION_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
  const HAND_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const LEGACY_HANDS_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
  const LEGACY_HANDS_SCRIPT_URL = `${LEGACY_HANDS_BASE_URL}hands.js`;

  const CONFIRM_MS = 320; // confirmación ágil tras estabilizarse por mayoría
  const CONFIRM_FAST_MS = 210; // saludo activo (palma en movimiento)
  const CONFIRM_INDEX_MS = 520; // espera breve para distinguir índice quieto vs negación en movimiento
  const COOLDOWN_MS = 1200; // antes de encadenar de nuevo la misma seña
  const GRACE_MS = 160; // tolerancia a parpadeos sin reiniciar temporizador
  const MIN_FRAME_INTERVAL_MS = 33; // máx. ~30 inferencias/s
  const MOTION_WINDOW = 18; // frames de trayectoria para señas dinámicas
  const VOTE_WINDOW = 6; // ventana deslizante (5-7 frames) para voto por mayoría
  const AUTO_SEND_PAUSE_MS = 2000; // manos abajo este tiempo -> envío y voz automáticos
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
    loading: 'Cargando modelo 3D de visión... Si el navegador lo solicita, permite el acceso a la cámara.',
    simulation: 'Modo prueba: la cámara no está en uso. Elige una seña o letra de la cuadrícula para probar la traducción.'
  };

  /**
   * Catálogo único de señas (fuente de verdad para detección, cuadrícula sin cámara y guía).
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
    {
      id: 'dni',
      emoji: '\u{1FAA7}',
      label: 'Presentar DNI / carnet',
      phrase: 'aquí tengo mi DNI',
      hands: '2 manos en marco L/C',
      twoHands: true
    },
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
    { id: 'letra_a', kind: 'letter', letter: 'A', emoji: 'A', label: 'Letra A', hands: '1 mano', hint: 'puño cerrado con pulgar recto al costado del índice' },
    { id: 'letra_b', kind: 'letter', letter: 'B', emoji: 'B', label: 'Letra B', hands: '1 mano', hint: 'cuatro dedos rectos unidos y pulgar cruzado en la palma' },
    { id: 'letra_c', kind: 'letter', letter: 'C', emoji: 'C', label: 'Letra C', hands: '1 mano', hint: 'mano arqueada formando una C abierta' },
    { id: 'letra_d', kind: 'letter', letter: 'D', emoji: 'D', label: 'Letra D', hands: '1 mano', hint: 'índice arriba mientras pulgar y dedos medios forman círculo' },
    { id: 'letra_e', kind: 'letter', letter: 'E', emoji: 'E', label: 'Letra E', hands: '1 mano', hint: 'dedos curvados en garra sobre el pulgar doblado' },
    { id: 'letra_f', kind: 'letter', letter: 'F', emoji: 'F', label: 'Letra F', hands: '1 mano', hint: 'pulgar e índice en pinza, otros tres dedos extendidos' },
    { id: 'letra_i', kind: 'letter', letter: 'I', emoji: 'I', label: 'Letra I', hands: '1 mano', hint: 'solo meñique extendido con pulgar recogido' },
    { id: 'letra_k', kind: 'letter', letter: 'K', emoji: 'K', label: 'Letra K', hands: '1 mano', hint: 'índice y medio abiertos con pulgar apoyado entre ambos' },
    { id: 'letra_l', kind: 'letter', letter: 'L', emoji: 'L', label: 'Letra L', hands: '1 mano', hint: 'pulgar e índice en ángulo recto' },
    { id: 'letra_o', kind: 'letter', letter: 'O', emoji: 'O', label: 'Letra O', hands: '1 mano', hint: 'todas las puntas curvadas tocando el pulgar en O' },
    { id: 'letra_r', kind: 'letter', letter: 'R', emoji: 'R', label: 'Letra R', hands: '1 mano', hint: 'dedo medio cruzado sobre el índice' },
    { id: 'letra_s', kind: 'letter', letter: 'S', emoji: 'S', label: 'Letra S', hands: '1 mano', hint: 'puño cerrado con pulgar cruzado al frente de los dedos' },
    { id: 'letra_u', kind: 'letter', letter: 'U', emoji: 'U', label: 'Letra U', hands: '1 mano', hint: 'índice y medio extendidos juntos en paralelo' },
    { id: 'letra_v', kind: 'letter', letter: 'V', emoji: 'V', label: 'Letra V', hands: '1 mano', hint: 'índice y medio extendidos separados en V' },
    { id: 'letra_w', kind: 'letter', letter: 'W', emoji: 'W', label: 'Letra W', hands: '1 mano', hint: 'índice, medio y anular extendidos en abanico' },
    { id: 'letra_y', kind: 'letter', letter: 'Y', emoji: 'Y', label: 'Letra Y', hands: '1 mano', hint: 'pulgar y meñique abiertos lateralmente' }
  ];
  const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));

  // Conexiones anatómicas estándar (respaldo si HAND_CONNECTIONS no estuviera disponible)
  const HAND_CONNECTIONS_FALLBACK = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
  ];

  /* =========================================================
     2. MOTOR DE CLASIFICACIÓN 3D + SUAVIZADO (funciones puras)
     ========================================================= */
  function dist3(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  }

  function angleDeg(a, b, c) {
    const bax = a.x - b.x;
    const bay = a.y - b.y;
    const baz = (a.z || 0) - (b.z || 0);
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const bcz = (c.z || 0) - (b.z || 0);
    const mag = Math.hypot(bax, bay, baz) * Math.hypot(bcx, bcy, bcz);
    if (!mag) return 180;
    const cos = Math.max(-1, Math.min(1, (bax * bcx + bay * bcy + baz * bcz) / mag));
    return (Math.acos(cos) * 180) / Math.PI;
  }

  /**
   * Clasifica la postura estática de UNA mano usando landmarks 3D (`worldLandmarks`),
   * ángulos entre falanges y distancias normalizadas por tamaño de palma.
   * @param {Array<{x:number,y:number,z?:number}>} landmarks 21 puntos normalizados de MediaPipe
   * @param {number} aspect relación ancho/alto del video para fallback 2D
   * @param {Array<{x:number,y:number,z:number}>} [worldLandmarks] 21 puntos métricos 3D opcionales
   * @returns {{id: string|null, fingers: object}}
   */
  function classifyHand(landmarks, aspect = 4 / 3, worldLandmarks = null) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) {
      return { id: null, fingers: null };
    }

    const P2 = landmarks.map((p) => ({
      x: p.x * aspect,
      y: p.y,
      z: typeof p.z === 'number' ? p.z * aspect : 0
    }));
    const hasWorld = Array.isArray(worldLandmarks) && worldLandmarks.length >= 21;
    const W = hasWorld ? worldLandmarks : P2;

    const palm2D = Math.hypot(P2[9].x - P2[0].x, P2[9].y - P2[0].y) || 1e-6;
    const palmW = dist3(W[0], W[9]) || 1e-6;
    const rel = (a, b) => dist3(W[a], W[b]) / palmW;

    const analyzeFinger = (mcp, pip, dip, tip) => {
      const pipAngle = angleDeg(W[mcp], W[pip], W[dip]);
      const dipAngle = angleDeg(W[pip], W[dip], W[tip]);
      const reachTip = rel(0, tip);
      const reachPip = rel(0, pip);
      const reachMcp = rel(0, mcp);
      const extended =
        pipAngle >= 142 &&
        dipAngle >= 132 &&
        reachTip > reachPip + 0.08 &&
        reachTip > reachMcp + 0.14;
      return { extended, pipAngle, dipAngle, reachTip, reachPip };
    };

    const idxInfo = analyzeFinger(5, 6, 7, 8);
    const midInfo = analyzeFinger(9, 10, 11, 12);
    const rngInfo = analyzeFinger(13, 14, 15, 16);
    const pnkInfo = analyzeFinger(17, 18, 19, 20);

    const thumbPipAngle = angleDeg(W[1], W[2], W[3]);
    const thumbTipAngle = angleDeg(W[2], W[3], W[4]);
    const thumbStraight = thumbPipAngle >= 136 && thumbTipAngle >= 134;

    const thumbToIndexMcp = rel(4, 5);
    const thumbToIndexPip = rel(4, 6);
    const thumbToMiddleMcp = rel(4, 9);
    const thumbToMiddlePip = rel(4, 10);
    const thumbToRingMcp = rel(4, 13);
    const thumbToRingPip = rel(4, 14);
    const thumbToPinkyMcp = rel(4, 17);

    const thumbSpread =
      thumbToPinkyMcp > rel(3, 17) * 1.03 &&
      thumbToPinkyMcp > 0.84 &&
      thumbToIndexMcp > 0.68;

    // Orientación vertical hacia arriba en cámara para distinguir "Pulgar arriba (Sí)" de "Letra A"
    const dxThumb2D = Math.abs(P2[4].x - P2[2].x);
    const dyThumb2D = P2[2].y - P2[4].y;
    const thumbUpHigh =
      P2[4].y < P2[3].y &&
      P2[3].y < P2[2].y &&
      dyThumb2D > dxThumb2D * 0.7 &&
      P2[5].y - P2[4].y > 0.30 * palm2D &&
      thumbToIndexPip > 0.56 &&
      thumbToPinkyMcp > 0.85;

    const pinchThumbIndex = rel(4, 8);
    const fingers = {
      thumb: thumbSpread || thumbUpHigh || thumbToIndexMcp > 0.65,
      index: idxInfo.extended,
      middle: midInfo.extended,
      ring: rngInfo.extended,
      pinky: pnkInfo.extended
    };

    const { index: I, middle: M, ring: R, pinky: K } = fingers;
    let id = null;

    // 1. Letra F antes de Palma para no confundir pinza pulgar-índice con 4 dedos abiertos
    if (M && R && K && !I && pinchThumbIndex < 0.38) {
      id = 'letra_f';
    } else if (I && M && R && K) {
      const gapIM = rel(8, 12);
      const gapMR = rel(12, 16);
      const gapRK = rel(16, 20);
      const avgGap = (gapIM + gapMR + gapRK) / 3;
      const thumbAcrossPalm =
        thumbToRingMcp < 0.70 ||
        thumbToMiddleMcp < 0.60 ||
        thumbToIndexMcp < 0.56;
      id = thumbAcrossPalm && avgGap < 0.30 ? 'letra_b' : 'palma';
    } else if (I && !M && !R && K) {
      id = 'auxilio';
    } else if (I && M && R && !K) {
      id = 'letra_w';
    } else if (I && M && !R && !K) {
      const tipGapIM = rel(8, 12);
      // Producto punto lateral (5->9 vs 8->12) para detectar cruce real en R frente a U paralela
      const latDot =
        ((W[9].x - W[5].x) * (W[12].x - W[8].x) +
          (W[9].y - W[5].y) * (W[12].y - W[8].y) +
          ((W[9].z || 0) - (W[5].z || 0)) * ((W[12].z || 0) - (W[8].z || 0))) /
        (palmW * palmW);
      const zCross = Math.abs((W[8].z || 0) - (W[12].z || 0)) / palmW > 0.14 && tipGapIM < 0.22;
      if (latDot <= 0 || zCross) {
        id = 'letra_r';
      } else if (tipGapIM >= 0.28 && thumbToMiddlePip < 0.50 && thumbToMiddleMcp < 0.56) {
        id = 'letra_k';
      } else if (tipGapIM < 0.28) {
        id = 'letra_u';
      } else {
        id = 'letra_v';
      }
    } else if (I && !M && !R && !K) {
      const lAngle = angleDeg(W[4], W[2], W[5]);
      if (thumbSpread && lAngle >= 45 && thumbToIndexMcp > 0.70) {
        id = 'letra_l';
      } else if (midInfo.reachTip >= 1.04 && rel(4, 12) < 0.42 && rel(4, 16) < 0.54 && !thumbSpread) {
        id = 'letra_d';
      } else {
        id = 'indice';
      }
    } else if (!I && !M && !R && K) {
      id = thumbToIndexMcp > 0.72 && thumbToPinkyMcp > 0.85 ? 'letra_y' : 'letra_i';
    } else if (!I && !M && !R && !K) {
      const avgPipCurl = (idxInfo.pipAngle + midInfo.pipAngle) / 2;
      if (thumbUpHigh) {
        id = 'pulgar';
      } else if (
        pinchThumbIndex < 0.36 &&
        rel(4, 12) < 0.50 &&
        idxInfo.reachTip > 1.06 &&
        avgPipCurl >= 70 &&
        avgPipCurl <= 148
      ) {
        id = 'letra_o';
      } else if (
        pinchThumbIndex >= 0.42 &&
        pinchThumbIndex <= 1.35 &&
        idxInfo.reachTip > 1.12 &&
        midInfo.reachTip > 1.12 &&
        rel(8, 12) < 0.46 &&
        rel(4, 0) > 1.02
      ) {
        id = 'letra_c';
      } else if (
        idxInfo.reachTip > 0.96 &&
        midInfo.reachTip > 0.96 &&
        rel(8, 4) < 0.54 &&
        rel(12, 4) < 0.54 &&
        thumbToMiddlePip > 0.30
      ) {
        id = 'letra_e';
      } else if (
        (thumbToMiddlePip < 0.42 || thumbToRingPip < 0.44) &&
        idxInfo.reachTip < 1.12 &&
        thumbToIndexPip < 0.60
      ) {
        id = 'letra_s';
      } else if (
        thumbStraight &&
        thumbToIndexPip < 0.62 &&
        thumbToMiddlePip >= 0.44 &&
        thumbToIndexMcp > 0.28
      ) {
        id = 'letra_a';
      } else {
        id = 'puno';
      }
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

    // 2. Gestos bimanuales combinados cuando ambas manos muestran la seña
    if (valid.length >= 2) {
      const [h0, h1] = valid;
      const avgScore = ((h0.score || 0.9) + (h1.score || 0.9)) / 2;
      if (h0.id === 'palma' && h1.id === 'palma') {
        return { id: 'dos_palmas', score: avgScore };
      }
      if (h0.id === 'pulgar' && h1.id === 'pulgar') {
        return { id: 'dos_pulgares', score: avgScore };
      }
      if (
        (h0.id === 'letra_l' && h1.id === 'letra_l') ||
        (h0.id === 'letra_c' && h1.id === 'letra_c')
      ) {
        return { id: 'dni', score: avgScore };
      }
    }

    // 3. Solo una mano hace un gesto válido (la otra está relajada)
    if (valid.length === 1) {
      const active = valid[0];
      return { id: active.id, score: typeof active.score === 'number' ? active.score : 0.9 };
    }

    // 4. Desempate estable con el gesto ya en progreso o el de mayor confianza
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
   * Voto por mayoría sobre una ventana deslizante de frames para eliminar parpadeos.
   * @param {Array<{id: string|null, score: number}>} voteBuffer
   * @returns {{id: string|null, score: number}}
   */
  function majorityVoteGesture(voteBuffer) {
    if (!Array.isArray(voteBuffer) || voteBuffer.length === 0) {
      return { id: null, score: 0 };
    }
    const counts = new Map();
    const scoreSums = new Map();
    let nonNullCount = 0;

    for (let i = 0; i < voteBuffer.length; i += 1) {
      const item = voteBuffer[i];
      if (!item || !item.id) continue;
      nonNullCount += 1;
      counts.set(item.id, (counts.get(item.id) || 0) + 1);
      scoreSums.set(item.id, (scoreSums.get(item.id) || 0) + (item.score || 0.9));
    }

    if (nonNullCount === 0) return { id: null, score: 0 };

    let bestId = null;
    let bestCount = 0;
    counts.forEach((cnt, id) => {
      if (cnt > bestCount) {
        bestCount = cnt;
        bestId = id;
      }
    });

    const minVotes = Math.max(2, Math.ceil(voteBuffer.length * 0.55));
    if (bestCount < minVotes && !(voteBuffer.length < 3 && bestCount === voteBuffer.length)) {
      return { id: null, score: 0 };
    }
    return { id: bestId, score: scoreSums.get(bestId) / bestCount };
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
   * Las letras consecutivas se unen en un código (ej. "D" + "N" + "I" -> "DNI").
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

  // Disponible para pruebas unitarias en consola; no altera el estado de la app.
  window.SenaSeguraVision = Object.freeze({
    classifyHand,
    resolveMultiHandGesture,
    majorityVoteGesture,
    detectHorizontalOscillation,
    composeSentence,
    GESTURES
  });

  /* =========================================================
     3. CARGA DINÁMICA DE MOTORES DE VISIÓN (BAJO DEMANDA)
     ========================================================= */
  let visionModulePromise = null;
  let loadedHandConnections = HAND_CONNECTIONS_FALLBACK;
  const scriptPromises = new Map();

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

  function loadLegacyScript(src) {
    if (scriptPromises.has(src)) return scriptPromises.get(src);

    const promise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      const timer = setTimeout(() => fail(new Error(`script-timeout: ${src}`)), SCRIPT_TIMEOUT_MS);

      function fail(err) {
        clearTimeout(timer);
        el.remove();
        scriptPromises.delete(src);
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
      el.onerror = () => fail(new Error(`script-network: ${src}`));
      document.head.appendChild(el);
    });

    scriptPromises.set(src, promise);
    return promise;
  }

  async function loadTasksVision() {
    if (!visionModulePromise) {
      visionModulePromise = withTimeout(import(VISION_BUNDLE_URL), LOAD_TIMEOUT_MS).catch((err) => {
        visionModulePromise = null;
        throw err;
      });
    }
    const mod = await visionModulePromise;
    if (!mod || !mod.FilesetResolver || !mod.HandLandmarker) {
      visionModulePromise = null;
      throw new Error('tasks-vision-unavailable');
    }
    if (Array.isArray(mod.HandLandmarker.HAND_CONNECTIONS)) {
      loadedHandConnections = mod.HandLandmarker.HAND_CONNECTIONS;
    }
    return mod;
  }

  async function loadLegacyHandsModule() {
    await loadLegacyScript(LEGACY_HANDS_SCRIPT_URL);
    if (typeof window.Hands !== 'function') {
      throw new Error('legacy-hands-unavailable');
    }
    if (Array.isArray(window.HAND_CONNECTIONS)) {
      loadedHandConnections = window.HAND_CONNECTIONS;
    }
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
    const lettersBar = $('vision-letters-bar');
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
    let visionEngine = null; // { type: 'tasks', landmarker } | { type: 'legacy', hands }
    let enginePromise = null;
    let running = false;
    let rafId = 0;
    let isLegacyProcessing = false;
    let lastVideoTime = -1;
    let lastSendAt = 0;
    let lastDetectTs = 0;
    let lastConfirmed = null;
    let lastProgressPct = -1;
    let handsDownSince = null;
    let speechTimer = null;
    let sentenceTokens = [];
    const lastAddedAt = {};
    const motionBuffer = [];
    const voteBuffer = [];
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
      voteBuffer.length = 0;
      handsDownSince = null;
      setProgress(0);
      if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
    }

    /* ---------- Cámara y ciclo de vida ---------- */
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
      isLegacyProcessing = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
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

    async function openCamera() {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        const err = new Error('unsupported');
        err.name = 'UnsupportedError';
        throw err;
      }
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      } catch (err) {
        const retryable =
          err &&
          (err.name === 'OverconstrainedError' ||
            err.name === 'ConstraintNotSatisfiedError' ||
            err.name === 'NotFoundError' ||
            err.name === 'DevicesNotFoundError');
        if (retryable) {
          console.warn('[Cámara IA]', err);
          return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        throw err;
      }
    }

    function cameraErrorMessage(err) {
      if (window.location.protocol === 'file:' || (!window.isSecureContext && err && err.name === 'UnsupportedError')) {
        return 'No se puede usar la cámara desde archivo local (file://). Abre SeñaSegura mediante HTTPS o localhost.';
      }
      switch (err && err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
        case 'SecurityError':
          return 'Permiso de cámara denegado. Habilita el acceso a la cámara en tu navegador.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
          return 'No se encontró una cámara disponible o compatible en este dispositivo.';
        case 'NotReadableError':
        case 'TrackStartError':
        case 'AbortError':
          return 'La cámara está en uso por otra aplicación o no responde.';
        case 'UnsupportedError':
          return 'Este navegador o protocolo no permite usar la cámara (se requiere HTTPS o localhost).';
        default:
          return 'No se pudo iniciar la cámara.';
      }
    }

    function modelErrorMessage(err) {
      if (navigator.onLine === false) {
        return 'Sin conexión a internet (red): no se pudo descargar el modelo de visión.';
      }
      if (window.location.protocol === 'file:') {
        return 'Protocolo file:// bloquea el motor de IA. Sirve el proyecto en HTTPS o localhost.';
      }
      if (err && String(err.message || '').includes('timeout')) {
        return 'Tiempo de espera agotado al descargar el modelo de visión por red lenta.';
      }
      return 'No se pudo inicializar el modelo de visión por red o navegador.';
    }

    async function createTasksEngine() {
      const { FilesetResolver, HandLandmarker } = await loadTasksVision();
      const vision = await withTimeout(FilesetResolver.forVisionTasks(VISION_WASM_URL), LOAD_TIMEOUT_MS);
      const options = {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      };

      try {
        const landmarker = await withTimeout(HandLandmarker.createFromOptions(vision, options), LOAD_TIMEOUT_MS);
        return { type: 'tasks', landmarker };
      } catch (gpuErr) {
        console.warn('[Cámara IA]', gpuErr);
        const landmarker = await withTimeout(
          HandLandmarker.createFromOptions(vision, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: 'CPU' }
          }),
          LOAD_TIMEOUT_MS
        );
        return { type: 'tasks', landmarker };
      }
    }

    async function createLegacyEngine() {
      await loadLegacyHandsModule();
      const instance = new window.Hands({
        locateFile: (file) => LEGACY_HANDS_BASE_URL + file
      });
      const lowPower =
        window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 4) <= 2;
      instance.setOptions({
        maxNumHands: 2,
        modelComplexity: lowPower ? 0 : 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      instance.onResults((legacyRes) => {
        if (!running || !legacyRes) return;
        const adapted = {
          landmarks: Array.isArray(legacyRes.multiHandLandmarks) ? legacyRes.multiHandLandmarks : [],
          worldLandmarks: [],
          handedness: Array.isArray(legacyRes.multiHandedness)
            ? legacyRes.multiHandedness.map((entry) => [entry])
            : []
        };
        handleResults(adapted, performance.now());
      });
      await withTimeout(instance.initialize(), LOAD_TIMEOUT_MS);
      return { type: 'legacy', hands: instance };
    }

    function getVisionEngine() {
      if (enginePromise) return enginePromise;
      if (navigator.onLine === false) {
        return Promise.reject(new Error('offline'));
      }
      enginePromise = createTasksEngine()
        .catch((tasksErr) => {
          console.warn('[Cámara IA]', tasksErr);
          return createLegacyEngine();
        })
        .catch((fallbackErr) => {
          console.warn('[Cámara IA]', fallbackErr);
          enginePromise = null;
          throw fallbackErr;
        });
      return enginePromise;
    }

    function waitForVideoReady() {
      return new Promise((resolve, reject) => {
        if (video.readyState >= 1 && video.videoWidth > 0) {
          resolve();
          return;
        }
        const events = ['loadedmetadata', 'loadeddata', 'canplay'];
        let settled = false;
        const cleanup = () => {
          events.forEach((ev) => video.removeEventListener(ev, onReady));
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('video-timeout'));
        }, 8000);
        function onReady() {
          if (settled || !video.videoWidth) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve();
        }
        events.forEach((ev) => video.addEventListener(ev, onReady));
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

      // Permiso de cámara y descarga bajo demanda del motor dual en paralelo
      const [camResult, libResult] = await Promise.allSettled([openCamera(), getVisionEngine()]);

      if (token !== sessionToken) {
        if (camResult.status === 'fulfilled') {
          camResult.value.getTracks().forEach((t) => t.stop());
        }
        return;
      }

      if (camResult.status === 'rejected') {
        console.warn('[Cámara IA]', camResult.reason);
        enterSimulation(`${cameraErrorMessage(camResult.reason)} Usa la prueba sin cámara para continuar.`);
        return;
      }
      stream = camResult.value;

      if (libResult.status === 'rejected') {
        console.warn('[Cámara IA]', libResult.reason);
        enterSimulation(`${modelErrorMessage(libResult.reason)} Usa la prueba sin cámara para continuar.`);
        return;
      }
      visionEngine = libResult.value;

      try {
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        const readyPromise = waitForVideoReady();
        await video.play().catch((playErr) => {
          console.warn('[Cámara IA]', playErr);
        });
        await readyPromise;
        if (token !== sessionToken) return;

        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        canvas.width = vw;
        canvas.height = vh;
        if (stage) stage.style.aspectRatio = `${vw} / ${vh}`;
        running = true;
        isLegacyProcessing = false;
        lastVideoTime = -1;
        lastSendAt = 0;
        setStatus('live');
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        console.warn('[Cámara IA]', err);
        if (token !== sessionToken) return;
        enterSimulation('No se pudo mostrar el video de la cámara. Usa la prueba sin cámara para continuar.');
      }
    }

    /** Bucle resiliente para Motor A (detectForVideo con timestamp entero creciente) y Motor B. */
    function loop() {
      if (!running || !visionEngine) return;
      rafId = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.paused || video.ended) return;

      const now = performance.now();
      if (now - lastSendAt < MIN_FRAME_INTERVAL_MS) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      lastSendAt = now;

      if (visionEngine.type === 'tasks') {
        try {
          const ts = Math.max(lastDetectTs + 1, Math.round(now));
          lastDetectTs = ts;
          const results = visionEngine.landmarker.detectForVideo(video, ts);
          handleResults(results, ts);
        } catch (err) {
          console.warn('[Cámara IA]', err);
          if (running) {
            enterSimulation('Ocurrió un error al analizar la cámara. Usa la prueba sin cámara para continuar.');
          }
        }
      } else if (visionEngine.type === 'legacy' && !isLegacyProcessing) {
        isLegacyProcessing = true;
        visionEngine.hands
          .send({ image: video })
          .catch((err) => {
            console.warn('[Cámara IA]', err);
            if (running) {
              enterSimulation('Ocurrió un error al analizar la cámara. Usa la prueba sin cámara para continuar.');
            }
          })
          .then(() => {
            isLegacyProcessing = false;
          });
      }
    }

    /* ---------- Resultados, dibujo y filtro anti-ruido ---------- */
    function drawHand(landmarks, handIndex = 0) {
      const high = document.documentElement.getAttribute('data-contrast') === 'high';
      const isSecond = handIndex > 0;
      const haloColor = high ? '#121820' : '#FFFFFF';
      const lineColor = high ? (isSecond ? '#FFFFFF' : '#F59E0B') : (isSecond ? '#15803D' : '#0F4C81');
      const dotColor = high ? (isSecond ? '#F59E0B' : '#FFFFFF') : (isSecond ? '#FFFFFF' : '#F59E0B');

      const w = canvas.width;
      const h = canvas.height;
      [[haloColor, 8], [lineColor, 4]].forEach(([color, width]) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        loadedHandConnections.forEach((conn) => {
          const a = Array.isArray(conn) ? conn[0] : conn.start;
          const b = Array.isArray(conn) ? conn[1] : conn.end;
          if (!landmarks[a] || !landmarks[b]) return;
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

    function handleResults(results, now = performance.now()) {
      if (!running || !results) return;
      clearCanvas();
      const allLandmarks = Array.isArray(results.landmarks) ? results.landmarks : [];
      const allWorldLandmarks = Array.isArray(results.worldLandmarks) ? results.worldLandmarks : [];
      const allHandedness = Array.isArray(results.handedness) ? results.handedness : [];

      updateHandsCount(allLandmarks.length);

      if (allLandmarks.length === 0) {
        motionBuffer.length = 0;
        voteBuffer.length = 0;
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
        const worldPts = allWorldLandmarks[idx] || null;
        const handedEntry = allHandedness[idx] && allHandedness[idx][0];
        const score = handedEntry && typeof handedEntry.score === 'number' ? handedEntry.score : 0.9;
        const { id: staticId } = classifyHand(landmarks, aspect, worldPts);
        let effectiveId = staticId;

        if (idx === 0 && hasOscillation) {
          if (staticId === 'palma') fastConfirm = true; // saludo activo
          else if (staticId === 'indice') effectiveId = 'negar_mov'; // negación con índice
        }
        handEntries.push({ id: effectiveId, score });
      });

      const resolved = resolveMultiHandGesture(handEntries, detection.id);
      if (voteBuffer.length >= VOTE_WINDOW) voteBuffer.shift();
      voteBuffer.push(resolved ? { id: resolved.id, score: resolved.score } : { id: null, score: 0 });
      const smoothed = majorityVoteGesture(voteBuffer);

      feedGesture(smoothed.id, smoothed.score, now, { fastConfirm });
    }

    /** Exige estabilidad breve (~320 ms tras voto por mayoría) antes de confirmar la seña. */
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
      if (speechTimer) {
        clearTimeout(speechTimer);
        speechTimer = null;
      }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new window.SpeechSynthesisUtterance(text);
      const voice = pickSpanishVoice();
      utterance.voice = voice;
      utterance.lang = voice ? voice.lang : 'es-PE';
      if (!voice && synth.getVoices && synth.getVoices().length) utterance.lang = 'es-ES';
      utterance.rate = 0.95;
      speechTimer = setTimeout(() => {
        speechTimer = null;
        synth.speak(utterance);
      }, 60);
      return true;
    }

    function cancelSpeech() {
      if (speechTimer) {
        clearTimeout(speechTimer);
        speechTimer = null;
      }
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
        bridge.setChannel('lsp');
        if (!wasUrgentGesture && typeof bridge.appendChatMessage === 'function') {
          bridge.appendChatMessage(CHAT_SENDER, 'Solicito un intérprete humano (escalado desde Cámara IA).', 'user');
        }
        bridge.activateEmergency();
      } else {
        const emergencyBtn = document.getElementById('btn-emergency-mode');
        if (emergencyBtn) emergencyBtn.click();
      }
    }

    /* ---------- Cuadrícula compacta (ventanilla + teclado A–Y) y guía (única fuente: GESTURES) ---------- */
    GESTURES.forEach((gesture) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-gesture', gesture.id);

      if (gesture.kind === 'letter' && lettersBar) {
        btn.className = 'vision-gesture-btn vision-letter-chip';
        btn.setAttribute('aria-label', gesture.label);
        btn.title = `${gesture.label}: ${gesture.hint}`;
        btn.textContent = gesture.letter;
        lettersBar.appendChild(btn);
      } else {
        btn.className = `vision-gesture-btn${gesture.urgent ? ' is-urgent' : ''}`;

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
      }

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
    (simBox || simGrid).addEventListener('click', (e) => {
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
      if (visionEngine && visionEngine.landmarker && typeof visionEngine.landmarker.close === 'function') {
        try {
          visionEngine.landmarker.close();
        } catch (_) {
          /* instancia ya liberada */
        }
      } else if (visionEngine && visionEngine.hands && typeof visionEngine.hands.close === 'function') {
        try {
          visionEngine.hands.close();
        } catch (_) {
          /* instancia ya liberada */
        }
      }
      visionEngine = null;
      enginePromise = null;
    };
    window.addEventListener('beforeunload', releaseOnExit);
    window.addEventListener('pagehide', releaseOnExit);

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
