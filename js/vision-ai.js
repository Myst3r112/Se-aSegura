/**
 * SeñaSegura · Módulo "Cámara IA (LSP · TensorFlow.js + MediaPipe)" (Vanilla JS ES6+)
 *
 * - Precarga silenciosa en segundo plano al iniciar (requestIdleCallback / setTimeout 800 ms, sin bloquear arranque)
 *   reutilizando las mismas promesas al pulsar "Activar Cámara" sin descargas duplicadas ni alertas prematuras.
 * - Motor continuo con pose_landmarker_full en escritorio (pose_landmarker_lite en dispositivos ligeros),
 *   suavizado temporal EMA, tolerancia a micro-pérdidas (5 frames / ~160 ms) y capa biomecánica (Smart Gating).
 * - Overlay visual legible ("Ver enfoque IA" / "Espejo") + HUD humano con encuadre, actividad y Top-2 en vivo.
 * - Compatible 100 % con GitHub Pages (rutas relativas sin '/' inicial) y sin bloqueo del hilo principal (outTensor.data()).
 *
 * Integración con js/main.js mediante:
 *   - window.SenaSegura (puente: setChannel, appendChatMessage, activateEmergency)
 *   - eventos 'senasegura:channelchange' y 'senasegura:purge'
 */
(() => {
  'use strict';

  /* =========================================================
     1. CONSTANTES Y CATÁLOGO LSP
     ========================================================= */
  const TASKS_VISION_VERSION = '0.10.14';
  const VISION_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/vision_bundle.mjs`;
  const VISION_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
  const TFJS_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const HAND_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const POSE_MODEL_FULL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
  const POSE_MODEL_LITE_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const FACE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  const LEGACY_HANDS_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
  const LEGACY_HANDS_SCRIPT_URL = `${LEGACY_HANDS_BASE_URL}hands.js`;

  const CONFIRM_MS = 320; // confirmación ágil tras voto por mayoría (respaldo geométrico)
  const CONFIRM_FAST_MS = 210; // saludo activo / emergencia inmediata
  const CONFIRM_INDEX_MS = 520; // espera breve para distinguir quieto vs trayectoria
  const CONFIRM_SPELL_MS = 500; // estabilización de letra estática (~0.5 s)
  const COOLDOWN_MS = 1200; // pausa antes de aceptar nuevamente la misma seña (~1.2 s)
  const SPELL_COOLDOWN_MS = 750; // pausa breve tras confirmar una letra
  const GRACE_MS = 180; // tolerancia a micro-parpadeos
  const HAND_DROPOUT_GRACE_FRAMES = 5; // tolerancia ~160 ms sin vaciar ventana deslizante
  const HAND_EMA_ALPHA = 0.55; // suavizado ligero EMA de landmarks de manos
  const POSE_EMA_ALPHA = 0.45; // suavizado ligero EMA de landmarks de torso
  const HAND_FEATURES_90 = 90; // Modelo Estático 3D: 63 coords + 15 ángulos + 3 normal + 9 desambiguación
  const TRAJ_SEQ_LEN = 16; // Micro-GRU dinámica [1, 16, 12]
  const TRAJ_NUM_FEATURES = 12; // v_muñeca(3) + v_índice(3) + v_meñique(3) + normal de palma(3)
  const TRAJ_DYNAMIC_LABELS = new Set(['J', 'Ñ', 'Z']);
  const TRAJ_STATIC_LABEL = 'ESTATICA';
  const TRAJ_STATE_MAX_AGE_MS = 300; // vigencia de la última predicción de la Micro-GRU
  const DYNAMIC_EMIT_LOCK_MS = 900; // evita re-disparar la letra dinámica o confirmar la postura base tras emitirla
  const STATIC_SPACE_LABEL = 'ESPACIO';
  const SPELL_SESSION_HOLD_MS = 2800; // protege sesión de deletreo activa frente al motor de 118 señas
  const MAX_TRAIL_POINTS = 14; // estela visual de trazos J, Ñ, Z y señas dinámicas
  const HUD_TOP2_THROTTLE_MS = 140; // lectura fluida del Top-2 sin parpadeo excesivo
  const MIN_FRAME_INTERVAL_MS = 16; // ~60 fps máx. (omite frames repetidos por video.currentTime)
  const AUX_DETECT_STRIDE = 3; // Face auxiliar solo en modo geométrico
  const MOTION_WINDOW = 24; // ventana deslizante para trayectorias J / Ñ / Z
  const DYNAMIC_SEQ_LEN = 30; // [1, 30, 159] para Motor 1
  const DYNAMIC_NUM_FEATURES = 159;
  const DYNAMIC_STREAK_REQUIRED = 2; // 2 ventanas consecutivas (>= threshold) antes de confirmar
  const VOTE_WINDOW = 6; // suavizado temporal por mayoría
  const AUTO_SEND_PAUSE_MS = 6500; // pausa larga (>=6 s) solo para señas de palabra; deletreo espera envío manual
  const LOAD_TIMEOUT_MS = 30000;
  const SCRIPT_TIMEOUT_MS = 15000;

  const IGNORED_GLOSSES = new Set(['ix', 'g_r']);
  const SPACE_TOKEN_LABEL = '__space__';

  const DYNAMIC_POSE_INDICES = [0, 11, 12, 13, 14, 15, 16];
  const ALPHABET_JOINT_TRIPLETS = [
    [0, 1, 2], [1, 2, 3], [2, 3, 4],
    [0, 5, 6], [5, 6, 7], [6, 7, 8],
    [0, 9, 10], [9, 10, 11], [10, 11, 12],
    [0, 13, 14], [13, 14, 15], [14, 15, 16],
    [0, 17, 18], [17, 18, 19], [18, 19, 20]
  ];

  const GLOSS_SPANISH_MAP = {
    ahi: 'ahí',
    alla: 'allá',
    caminar_persona: 'caminar',
    como: 'cómo',
    cuanto: 'cuánto',
    despues: 'después',
    dificil: 'difícil',
    donde: 'dónde',
    el: 'él',
    emocion: 'emoción',
    frio: 'frío',
    mama: 'mamá',
    otra_vez: 'otra vez',
    proteina: 'proteína',
    que: 'qué',
    que_paso: 'qué pasó',
    se_fue: 'se fue',
    si: 'sí',
    tu: 'tú'
  };

  const CHAT_SENDER = 'Ciudadano (Cámara IA)';

  const STATUS_TEXT = {
    idle: 'Cámara inactiva',
    loading: 'Cargando modelo…',
    live: 'En vivo',
    simulation: 'Modo prueba'
  };

  const PLACEHOLDER_TEXT = {
    idle: 'Pulsa “Activar Cámara” y muestra una o ambas manos. El video se procesa en tu dispositivo: no se graba ni se envía.',
    loading: 'Cargando percepción 3D de señas, orientación y expresión... Permite el acceso a la cámara si el navegador lo solicita.',
    simulation: 'Modo prueba: la cámara no está en uso. Elige una seña rápida o letra LSP para probar la traducción.'
  };

  const PALM_LABEL = {
    frente: 'Frente',
    cuerpo: 'Cuerpo',
    arriba: 'Arriba',
    abajo: 'Abajo',
    lateral: 'Lateral'
  };

  const ZONE_LABEL = {
    frente: 'Frente',
    boca_menton: 'Mentón',
    pecho: 'Pecho',
    espacio_neutro: 'Neutro'
  };

  const EXPRESSION_LABEL = {
    pregunta: 'Pregunta',
    negacion_enfasis: 'Énfasis',
    urgencia_dolor: 'Urgencia/Dolor',
    neutro: ''
  };

  /**
   * Catálogo único de señas y letras LSP (acciones de ventanilla + 19 letras A–Z).
   */
  const GESTURES = [
    { id: 'palma', emoji: '\u{270B}', label: 'Palma abierta / saludo', phrase: 'Hola,', hands: '1 mano' },
    { id: 'gracias', emoji: '\u{1F64F}', label: 'Gracias', phrase: 'muchas gracias', hands: 'Mentón hacia adelante' },
    { id: 'por_favor', emoji: '\u{1F932}', label: 'Por favor', phrase: 'por favor', hands: 'Pecho circular' },
    { id: 'entiendo', emoji: '\u{1F4A1}', label: 'Entiendo / Claro', phrase: 'entiendo, está claro', hands: '1 mano · Frente' },
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
      id: 'dolor',
      emoji: '\u{1FA7A}',
      label: 'Dolor / Malestar médico',
      phrase: 'siento dolor, necesito atención médica',
      hands: 'Pecho + expresión'
    },
    {
      id: 'auxilio',
      emoji: '\u{1F91F}',
      label: 'Seña de auxilio (ILY / mano-mano)',
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
    { id: 'letra_g', kind: 'letter', letter: 'G', emoji: 'G', label: 'Letra G', hands: '1 mano', hint: 'índice y pulgar extendidos lateralmente en paralelo' },
    { id: 'letra_h', kind: 'letter', letter: 'H', emoji: 'H', label: 'Letra H', hands: '1 mano', hint: 'índice y medio extendidos lateralmente juntos' },
    { id: 'letra_i', kind: 'letter', letter: 'I', emoji: 'I', label: 'Letra I', hands: '1 mano', hint: 'solo meñique extendido con pulgar recogido' },
    { id: 'letra_j', kind: 'letter', letter: 'J', emoji: 'J', label: 'Letra J', hands: '1 mano en movimiento', hint: 'meñique trazando una curva en J' },
    { id: 'letra_k', kind: 'letter', letter: 'K', emoji: 'K', label: 'Letra K', hands: '1 mano', hint: 'índice y medio abiertos con pulgar apoyado entre ambos' },
    { id: 'letra_l', kind: 'letter', letter: 'L', emoji: 'L', label: 'Letra L', hands: '1 mano', hint: 'pulgar e índice en ángulo recto' },
    { id: 'letra_m', kind: 'letter', letter: 'M', emoji: 'M', label: 'Letra M', hands: '1 mano', hint: 'tres dedos flexionados sobre el pulgar' },
    { id: 'letra_n', kind: 'letter', letter: 'N', emoji: 'N', label: 'Letra N', hands: '1 mano', hint: 'dos dedos flexionados sobre el pulgar' },
    { id: 'letra_enie', kind: 'letter', letter: 'Ñ', emoji: 'Ñ', label: 'Letra Ñ', hands: '1 mano con movimiento', hint: 'configuración de N agitada horizontalmente' },
    { id: 'letra_o', kind: 'letter', letter: 'O', emoji: 'O', label: 'Letra O', hands: '1 mano', hint: 'todas las puntas curvadas tocando el pulgar en O' },
    { id: 'letra_p', kind: 'letter', letter: 'P', emoji: 'P', label: 'Letra P', hands: '1 mano', hint: 'configuración K orientada hacia abajo' },
    { id: 'letra_q', kind: 'letter', letter: 'Q', emoji: 'Q', label: 'Letra Q', hands: '1 mano', hint: 'configuración G orientada hacia abajo' },
    { id: 'letra_r', kind: 'letter', letter: 'R', emoji: 'R', label: 'Letra R', hands: '1 mano', hint: 'dedo medio cruzado sobre el índice' },
    { id: 'letra_s', kind: 'letter', letter: 'S', emoji: 'S', label: 'Letra S', hands: '1 mano', hint: 'palma al frente con pulgar cruzado sobre los dedos' },
    { id: 'letra_t', kind: 'letter', letter: 'T', emoji: 'T', label: 'Letra T', hands: '1 mano', hint: 'pulgar entre índice y medio cerrados en puño' },
    { id: 'letra_u', kind: 'letter', letter: 'U', emoji: 'U', label: 'Letra U', hands: '1 mano', hint: 'índice y medio extendidos juntos en paralelo' },
    { id: 'letra_v', kind: 'letter', letter: 'V', emoji: 'V', label: 'Letra V', hands: '1 mano', hint: 'índice y medio extendidos separados en V' },
    { id: 'letra_w', kind: 'letter', letter: 'W', emoji: 'W', label: 'Letra W', hands: '1 mano', hint: 'índice, medio y anular extendidos en abanico' },
    { id: 'letra_x', kind: 'letter', letter: 'X', emoji: 'X', label: 'Letra X', hands: '1 mano', hint: 'índice flexionado en gancho' },
    { id: 'letra_y', kind: 'letter', letter: 'Y', emoji: 'Y', label: 'Letra Y', hands: '1 mano', hint: 'pulgar y meñique abiertos lateralmente' },
    { id: 'letra_z', kind: 'letter', letter: 'Z', emoji: 'Z', label: 'Letra Z', hands: '1 mano en movimiento', hint: 'índice trazando zig-zag en Z' },
    { id: 'letra_space', kind: 'space', letter: 'Espacio', emoji: '␣', label: 'Espacio entre palabras', hands: 'Postura neutra', hint: 'separa palabras al deletrear' }
  ];
  const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));

  const HAND_CONNECTIONS_FALLBACK = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
  ];

  /* =========================================================
     2. EXTRACTORES DE LOS 7 PARÁMETROS LSP (FUNCIONES PURAS)
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

  function normalizeHandedness(handedness) {
    if (!handedness) return 'Right';
    if (typeof handedness === 'string') return /left/i.test(handedness) ? 'Left' : 'Right';
    const raw = handedness.categoryName || handedness.displayName || handedness.label || 'Right';
    return /left/i.test(raw) ? 'Left' : 'Right';
  }

  /**
   * Parámetro 2: Orientación real de la palma en 3D mediante producto cruz (P[5]-P[0]) × (P[17]-P[0]).
   * @param {Array<{x:number,y:number,z?:number}>} worldLandmarks 21 puntos 3D métricos o normalizados
   * @param {string|object} [handedness='Right'] mano detectada ('Left' | 'Right')
   * @returns {{orientation:string, nx:number, ny:number, nz:number, dir:{dx:number,dy:number,dz:number}, handedness:string}}
   */
  function computePalmOrientation3D(worldLandmarks, handedness = 'Right') {
    const label = normalizeHandedness(handedness);
    if (!Array.isArray(worldLandmarks) || worldLandmarks.length < 18) {
      return { orientation: 'frente', nx: 0, ny: 0, nz: -1, dir: { dx: 0, dy: -1, dz: 0 }, handedness: label };
    }
    const p0 = worldLandmarks[0];
    const p5 = worldLandmarks[5];
    const p9 = worldLandmarks[9];
    const p17 = worldLandmarks[17];

    const v1x = p5.x - p0.x;
    const v1y = p5.y - p0.y;
    const v1z = (p5.z || 0) - (p0.z || 0);
    const v2x = p17.x - p0.x;
    const v2y = p17.y - p0.y;
    const v2z = (p17.z || 0) - (p0.z || 0);

    // En cámara MediaPipe (+z hacia adentro), mano izquierda y derecha invierten el signo del producto cruz
    const sign = label === 'Left' ? 1 : -1;
    let nx = sign * (v1y * v2z - v1z * v2y);
    let ny = sign * (v1z * v2x - v1x * v2z);
    let nz = sign * (v1x * v2y - v1y * v2x);
    const norm = Math.hypot(nx, ny, nz) || 1e-6;
    nx /= norm;
    ny /= norm;
    nz /= norm;

    const dxRaw = p9.x - p0.x;
    const dyRaw = p9.y - p0.y;
    const dzRaw = (p9.z || 0) - (p0.z || 0);
    const dNorm = Math.hypot(dxRaw, dyRaw, dzRaw) || 1e-6;

    let orientation = 'lateral';
    if (nz <= -0.48) orientation = 'frente';
    else if (nz >= 0.48) orientation = 'cuerpo';
    else if (ny <= -0.52) orientation = 'arriba';
    else if (ny >= 0.52) orientation = 'abajo';

    return {
      orientation,
      nx,
      ny,
      nz,
      dir: { dx: dxRaw / dNorm, dy: dyRaw / dNorm, dz: dzRaw / dNorm },
      handedness: label
    };
  }

  /**
   * Parámetros 3, 4 y 6: Profundidad/plano espacial, lugar de articulación anatómico y contacto.
   * Normalizado por ancho de hombros (pose[11], pose[12]) cuando PoseLandmarker está activo.
   */
  function computeSpatialContext(handLandmarks, handWorldLandmarks = null, poseLandmarks = null, allHandLandmarks = null) {
    let minHandDist = Infinity;
    let manoMano = false;

    if (Array.isArray(allHandLandmarks) && allHandLandmarks.length >= 2) {
      const h0 = allHandLandmarks[0];
      const h1 = allHandLandmarks[1];
      if (h0 && h0.length >= 21 && h1 && h1.length >= 21) {
        const palmRef = (Math.hypot(h0[9].x - h0[0].x, h0[9].y - h0[0].y) +
          Math.hypot(h1[9].x - h1[0].x, h1[9].y - h1[0].y)) / 2 || 0.08;
        const samplePtsA = [h0[0], h0[4], h0[8], h0[9], h0[12]];
        const samplePtsB = [h1[0], h1[4], h1[8], h1[9], h1[12], h1[17]];
        for (let i = 0; i < samplePtsA.length; i += 1) {
          for (let j = 0; j < samplePtsB.length; j += 1) {
            const d = Math.hypot(samplePtsA[i].x - samplePtsB[j].x, samplePtsA[i].y - samplePtsB[j].y) / palmRef;
            if (d < minHandDist) minHandDist = d;
          }
        }
        manoMano = minHandDist < 1.15;
      }
    }

    if (!Array.isArray(handLandmarks) || handLandmarks.length < 21) {
      return {
        depthPlane: 'neutro',
        depthZ: 0,
        zone: 'espacio_neutro',
        contact: { manoMano, manoCuerpo: false, minHandDist: Number.isFinite(minHandDist) ? minHandDist : null },
        shoulderWidth: null,
        poseActive: false
      };
    }

    const handRef = handLandmarks[9] || handLandmarks[0];
    const palm2D = Math.hypot(handLandmarks[9].x - handLandmarks[0].x, handLandmarks[9].y - handLandmarks[0].y) || 0.08;
    const poseActive = Array.isArray(poseLandmarks) && poseLandmarks.length >= 17 && Boolean(poseLandmarks[11] && poseLandmarks[12]);

    let shoulderWidth = null;
    let depthZ = 0;
    let depthPlane = 'neutro';
    let zone = 'espacio_neutro';

    if (poseActive) {
      const ls = poseLandmarks[11];
      const rs = poseLandmarks[12];
      shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y) || 0.25;
      const shMidX = (ls.x + rs.x) / 2;
      const shMidY = (ls.y + rs.y) / 2;
      const shMidZ = ((ls.z || 0) + (rs.z || 0)) / 2;

      const nose = poseLandmarks[0] || { x: shMidX, y: shMidY - 0.35 * shoulderWidth, z: shMidZ };
      const eyeY = poseLandmarks[2] ? poseLandmarks[2].y : nose.y - 0.1 * shoulderWidth;

      // Profundidad normalizada comparando tamaño de palma vs ancho de hombros + z de muñeca pose
      const palmShoulderRatio = palm2D / shoulderWidth;
      const poseWristL = poseLandmarks[15];
      const poseWristR = poseLandmarks[16];
      let nearestPoseWrist = null;
      if (poseWristL && poseWristR) {
        const dL = Math.hypot(poseWristL.x - handLandmarks[0].x, poseWristL.y - handLandmarks[0].y);
        const dR = Math.hypot(poseWristR.x - handLandmarks[0].x, poseWristR.y - handLandmarks[0].y);
        nearestPoseWrist = dL <= dR ? poseWristL : poseWristR;
      } else {
        nearestPoseWrist = poseWristL || poseWristR;
      }
      const zDelta = nearestPoseWrist ? ((nearestPoseWrist.z || 0) - shMidZ) / shoulderWidth : 0;
      const worldDepth =
        Array.isArray(handWorldLandmarks) && handWorldLandmarks[0] ? (handWorldLandmarks[0].z || 0) : 0;
      depthZ = nearestPoseWrist ? zDelta : worldDepth;

      if (palmShoulderRatio >= 0.44 || depthZ <= -0.55) depthPlane = 'adelante';
      else if (palmShoulderRatio <= 0.25 && Math.abs(handRef.x - shMidX) < shoulderWidth * 0.65) depthPlane = 'cuerpo';
      else if (palmShoulderRatio <= 0.34) depthPlane = 'cercano';
      else depthPlane = 'neutro';

      if (handRef.y <= eyeY + 0.06 * shoulderWidth && Math.abs(handRef.x - nose.x) < shoulderWidth * 0.72) {
        zone = 'frente';
      } else if (
        handRef.y > eyeY + 0.06 * shoulderWidth &&
        handRef.y <= shMidY - 0.04 * shoulderWidth &&
        Math.abs(handRef.x - nose.x) < shoulderWidth * 0.68
      ) {
        zone = 'boca_menton';
      } else if (
        handRef.y > shMidY - 0.04 * shoulderWidth &&
        handRef.y <= shMidY + shoulderWidth * 0.75 &&
        Math.abs(handRef.x - shMidX) < shoulderWidth * 0.66
      ) {
        zone = 'pecho';
      } else {
        zone = 'espacio_neutro';
      }
    } else {
      // Respaldo geométrico sin PoseLandmarker (aproximación por bandas de encuadre)
      depthZ = Array.isArray(handWorldLandmarks) && handWorldLandmarks[0] ? (handWorldLandmarks[0].z || 0) : 0;
      depthPlane = palm2D >= 0.22 ? 'adelante' : palm2D <= 0.11 ? 'cercano' : 'neutro';
      if (handRef.y < 0.24) zone = 'frente';
      else if (handRef.y < 0.43 && Math.abs(handRef.x - 0.5) < 0.28) zone = 'boca_menton';
      else if (handRef.y < 0.72 && Math.abs(handRef.x - 0.5) < 0.28) zone = 'pecho';
      else zone = 'espacio_neutro';
    }

    const manoCuerpo = zone !== 'espacio_neutro' && (depthPlane === 'cuerpo' || depthPlane === 'cercano');
    return {
      depthPlane,
      depthZ: Number(depthZ.toFixed(3)),
      zone,
      contact: {
        manoMano,
        manoCuerpo,
        minHandDist: Number.isFinite(minHandDist) ? Number(minHandDist.toFixed(2)) : null
      },
      shoulderWidth,
      poseActive
    };
  }

  /**
   * Parámetro 7: Componente no manual (cejas, ceño, boca e inclinación de cabeza).
   */
  function analyzeNonManualExpressions(faceBlendshapes = null, faceLandmarks = null) {
    let scoreMap = null;
    if (faceBlendshapes) {
      const categories = Array.isArray(faceBlendshapes)
        ? (faceBlendshapes[0] && faceBlendshapes[0].categories) || faceBlendshapes
        : faceBlendshapes.categories;
      if (Array.isArray(categories)) {
        scoreMap = Object.create(null);
        for (let i = 0; i < categories.length; i += 1) {
          const cat = categories[i];
          if (cat && cat.categoryName) scoreMap[cat.categoryName] = cat.score || 0;
        }
      } else if (typeof faceBlendshapes === 'object') {
        scoreMap = faceBlendshapes;
      }
    }

    const get = (name) => (scoreMap && typeof scoreMap[name] === 'number' ? scoreMap[name] : 0);
    const browUp = Math.max(get('browInnerUp'), (get('browOuterUpLeft') + get('browOuterUpRight')) / 2);
    const browDown = (get('browDownLeft') + get('browDownRight')) / 2;
    const jawOpen = get('jawOpen');
    const mouthFrown = (get('mouthFrownLeft') + get('mouthFrownRight')) / 2;

    let headTilt = 0;
    let headYaw = 0;
    if (Array.isArray(faceLandmarks) && faceLandmarks.length >= 455) {
      const forehead = faceLandmarks[10];
      const chin = faceLandmarks[152];
      const noseTip = faceLandmarks[1];
      const leftCheek = faceLandmarks[234];
      const rightCheek = faceLandmarks[454];
      if (forehead && chin) {
        headTilt = Number((forehead.x - chin.x).toFixed(3));
      }
      if (noseTip && leftCheek && rightCheek) {
        const span = Math.abs(rightCheek.x - leftCheek.x) || 1e-6;
        const midX = (leftCheek.x + rightCheek.x) / 2;
        headYaw = Number(((noseTip.x - midX) / span).toFixed(3));
      }
    }

    let expression = 'neutro';
    if (browDown >= 0.34 && (jawOpen >= 0.25 || mouthFrown >= 0.28)) {
      expression = 'urgencia_dolor';
    } else if (browUp >= 0.38 && browDown < 0.28) {
      expression = 'pregunta';
    } else if (browDown >= 0.38 || Math.abs(headYaw) >= 0.24) {
      expression = 'negacion_enfasis';
    }

    return {
      expression,
      browUp: Number(browUp.toFixed(2)),
      browDown: Number(browDown.toFixed(2)),
      jawOpen: Number(jawOpen.toFixed(2)),
      headTilt,
      headYaw
    };
  }

  /**
   * Parámetro 5: Movimiento y trayectoria 3D sobre ventana deslizante (20–24 frames).
   * Detecta: 'oscilacion_h' | 'hacia_adelante' | 'circular' | 'trazo_j' | 'trazo_z' | 'recto' | 'quieto'.
   */
  function analyzeTrajectory3D(motionBuffer) {
    if (!Array.isArray(motionBuffer) || motionBuffer.length < 7) {
      return { type: 'quieto', netDist: 0, spanX: 0, spanY: 0, spanZ: 0, startZone: null };
    }
    const latestT = motionBuffer[motionBuffer.length - 1].t;
    const recent = motionBuffer.filter((f) => latestT - f.t <= 1700);
    if (recent.length < 7) {
      return { type: 'quieto', netDist: 0, spanX: 0, spanY: 0, spanZ: 0, startZone: null };
    }

    const avgPalm = recent.reduce((acc, f) => acc + (f.palmSize || 0.1), 0) / recent.length || 1e-6;
    const startZone = recent[0].zone || null;

    const bounds = (xKey, yKey) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let reversals = 0;
      let dir = 0;
      let anchorX = recent[0][xKey];
      const stepThr = 0.04 * avgPalm;
      for (let i = 0; i < recent.length; i += 1) {
        const x = recent[i][xKey];
        const y = recent[i][yKey];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (i > 0) {
          const dx = x - anchorX;
          if (Math.abs(dx) >= stepThr) {
            const nextDir = dx > 0 ? 1 : -1;
            if (dir !== 0 && nextDir !== dir) reversals += 1;
            dir = nextDir;
            anchorX = x;
          }
        }
      }
      return {
        spanX: (maxX - minX) / avgPalm,
        spanY: (maxY - minY) / avgPalm,
        reversals
      };
    };

    const tipStats = bounds('tipX', 'tipY');
    const wristStats = bounds('wristX', 'wristY');

    const first = recent[0];
    const last = recent[recent.length - 1];
    const netTipDx = (last.tipX - first.tipX) / avgPalm;
    const netTipDy = (last.tipY - first.tipY) / avgPalm;
    const netZ = (last.z !== undefined && first.z !== undefined) ? (last.z - first.z) / avgPalm : 0;
    const palmScaleRatio = (last.palmSize || avgPalm) / (first.palmSize || avgPalm);
    const netDist = Math.hypot(last.wristX - first.wristX, last.wristY - first.wristY) / avgPalm;

    let type = 'quieto';

    // 1. Trazo Z con punta del índice (derecha -> diagonal abajo-izquierda -> derecha)
    if (tipStats.spanX >= 0.42 && tipStats.spanY >= 0.32 && tipStats.reversals >= 2) {
      let seenRight1 = false;
      let seenDiagDownLeft = false;
      let seenRight2 = false;
      for (let i = 2; i < recent.length; i += 1) {
        const dx = (recent[i].tipX - recent[i - 2].tipX) / avgPalm;
        const dy = (recent[i].tipY - recent[i - 2].tipY) / avgPalm;
        if (!seenRight1 && dx > 0.08 && Math.abs(dy) < 0.14) seenRight1 = true;
        else if (seenRight1 && !seenDiagDownLeft && dx < -0.08 && dy > 0.07) seenDiagDownLeft = true;
        else if (seenDiagDownLeft && !seenRight2 && dx > 0.08 && Math.abs(dy) < 0.14) seenRight2 = true;
      }
      if (seenRight1 && seenDiagDownLeft && seenRight2) {
        type = 'trazo_z';
      }
    }

    // 2. Oscilación horizontal sostenida (saludo / negación / Ñ)
    if (
      type === 'quieto' &&
      ((tipStats.spanX >= 0.44 && tipStats.spanX > tipStats.spanY * 1.1 && tipStats.reversals >= 2) ||
        (wristStats.spanX >= 0.44 && wristStats.spanX > wristStats.spanY * 1.1 && wristStats.reversals >= 2))
    ) {
      type = 'oscilacion_h';
    }

    // 3. Trazo J con el meñique (baja verticalmente y gira lateral/arriba en gancho)
    if (type === 'quieto' && recent.length >= 8 && recent[0].pinkyX !== undefined) {
      const split = Math.floor(recent.length * 0.6);
      const pFirst = recent[0];
      const pMid = recent[split];
      const pLast = recent[recent.length - 1];
      const dropY = (pMid.pinkyY - pFirst.pinkyY) / avgPalm;
      const hookDx = Math.abs(pLast.pinkyX - pMid.pinkyX) / avgPalm;
      const hookUpY = (pMid.pinkyY - pLast.pinkyY) / avgPalm;
      if (dropY >= 0.35 && hookDx >= 0.22 && hookUpY >= -0.05) {
        type = 'trazo_j';
      }
    }

    // 4. Movimiento circular (pecho / Por favor): barrido angular >= 220° alrededor del centroide
    if (type === 'quieto' && wristStats.spanX >= 0.28 && wristStats.spanY >= 0.26) {
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < recent.length; i += 1) {
        cx += recent[i].wristX;
        cy += recent[i].wristY;
      }
      cx /= recent.length;
      cy /= recent.length;
      let totalAngle = 0;
      for (let i = 1; i < recent.length; i += 1) {
        const a0 = Math.atan2(recent[i - 1].wristY - cy, recent[i - 1].wristX - cx);
        const a1 = Math.atan2(recent[i].wristY - cy, recent[i].wristX - cx);
        let diff = a1 - a0;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        totalAngle += diff;
      }
      if (Math.abs(totalAngle) >= 3.84) {
        type = 'circular';
      }
    }

    // 5. Avance hacia adelante (ej. Gracias desde boca/mentón hacia el funcionario)
    if (
      type === 'quieto' &&
      tipStats.reversals <= 1 &&
      (netZ <= -0.22 || palmScaleRatio >= 1.15 || (netTipDy >= 0.28 && startZone === 'boca_menton'))
    ) {
      type = 'hacia_adelante';
    }

    // 6. Trazo recto genérico
    if (type === 'quieto' && (netDist >= 0.38 || Math.hypot(netTipDx, netTipDy) >= 0.48)) {
      type = 'recto';
    }

    return {
      type,
      netDist: Number(netDist.toFixed(2)),
      spanX: Number(Math.max(tipStats.spanX, wristStats.spanX).toFixed(2)),
      spanY: Number(Math.max(tipStats.spanY, wristStats.spanY).toFixed(2)),
      spanZ: Number(Math.abs(netZ).toFixed(2)),
      startZone
    };
  }

  function detectHorizontalOscillation(motionBuffer) {
    return analyzeTrajectory3D(motionBuffer).type === 'oscilacion_h';
  }

  /**
   * Parámetro 1: Clasifica la configuración manual 3D y orientación de una mano.
   * Separa con precisión Puño cerrado vs A vs S vs E usando normal de palma y pulgar.
   */
  function classifyHand(landmarks, aspect = 4 / 3, worldLandmarks = null, options = {}) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) {
      return { id: null, fingers: null, palm: null };
    }

    const P2 = landmarks.map((p) => ({
      x: p.x * aspect,
      y: p.y,
      z: typeof p.z === 'number' ? p.z * aspect : 0
    }));
    const hasWorld = Array.isArray(worldLandmarks) && worldLandmarks.length >= 21;
    const W = hasWorld ? worldLandmarks : P2;

    const palm =
      options.palmOrientation || computePalmOrientation3D(W, options.handedness || 'Right');

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
      const sideFistOrientation = palm.orientation === 'lateral' || palm.orientation === 'abajo';
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
        thumbToIndexPip < 0.60 &&
        !sideFistOrientation
      ) {
        id = 'letra_s';
      } else if (
        thumbStraight &&
        thumbToIndexPip < 0.62 &&
        thumbToMiddlePip >= 0.44 &&
        thumbToIndexMcp > 0.28 &&
        !sideFistOrientation
      ) {
        id = 'letra_a';
      } else {
        id = 'puno';
      }
    }

    return { id, fingers, palm };
  }

  /**
   * Resuelve la seña final integrando los 7 parámetros LSP (2 manos, zona, palma, trayectoria y expresión).
   * Mantiene retrocompatibilidad completa cuando `context` es omitido.
   */
  function resolveMultiHandGesture(handEntries, currentId = null, context = null) {
    if (!Array.isArray(handEntries) || handEntries.length === 0) return null;

    const spatial = context && context.spatial ? context.spatial : null;
    const nonManual = context && context.nonManual ? context.nonManual : null;
    const trajectory = context && context.trajectory ? context.trajectory : null;
    const valid = handEntries.filter((entry) => entry && entry.id);
    if (valid.length === 0) return null;

    // 1. Seguridad prioritaria: ILY en cualquier mano O contacto mano-mano (puño sobre palma)
    const auxHands = valid.filter((entry) => entry.id === 'auxilio');
    if (auxHands.length > 0) {
      const bestAux = auxHands.reduce((best, cur) => ((cur.score || 0) > (best.score || 0) ? cur : best));
      return { id: 'auxilio', score: typeof bestAux.score === 'number' ? bestAux.score : 0.9 };
    }

    if (valid.length >= 2) {
      const [h0, h1] = valid;
      const avgScore = ((h0.score || 0.9) + (h1.score || 0.9)) / 2;
      const isFist = (id) => id === 'puno' || id === 'letra_s' || id === 'letra_a';
      const isFlatPalm = (id) => id === 'palma' || id === 'letra_b';
      if (
        spatial &&
        spatial.contact &&
        spatial.contact.manoMano &&
        ((isFist(h0.id) && isFlatPalm(h1.id)) || (isFlatPalm(h0.id) && isFist(h1.id)))
      ) {
        return { id: 'auxilio', score: avgScore };
      }
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

    // 2. Resolución contextual de 7 parámetros sobre la mano dominante detectada
    const primary = handEntries[0] && handEntries[0].id ? handEntries[0] : valid[0];
    const score = typeof primary.score === 'number' ? primary.score : 0.9;
    const pid = primary.id;
    const palmOrient = (primary.palm && primary.palm.orientation) || 'frente';
    const trajType = trajectory ? trajectory.type : 'quieto';
    const zone = spatial ? spatial.zone : 'espacio_neutro';
    const startZone = trajectory && trajectory.startZone ? trajectory.startZone : zone;
    const expr = nonManual ? nonManual.expression : 'neutro';
    const isOpen = pid === 'palma' || pid === 'letra_b';

    // Dolor / Malestar médico en pecho
    if (
      zone === 'pecho' &&
      (expr === 'urgencia_dolor' ||
        ((pid === 'letra_e' || pid === 'puno') && spatial && spatial.contact && spatial.contact.manoCuerpo))
    ) {
      return { id: 'dolor', score };
    }

    // Por favor real en LSP (palma abierta sobre pecho en círculo)
    if (isOpen && zone === 'pecho' && trajType === 'circular') {
      return { id: 'por_favor', score };
    }

    // Gracias real en LSP (palma desde mentón hacia adelante)
    if (
      isOpen &&
      (zone === 'boca_menton' || startZone === 'boca_menton') &&
      trajType === 'hacia_adelante' &&
      (palmOrient === 'cuerpo' || palmOrient === 'arriba' || palmOrient === 'frente')
    ) {
      return { id: 'gracias', score };
    }

    // Entiendo / Claro (zona frente activa con pose)
    if (
      spatial &&
      spatial.poseActive &&
      zone === 'frente' &&
      (pid === 'indice' || pid === 'pulgar' || pid === 'letra_l' || pid === 'palma') &&
      trajType !== 'oscilacion_h'
    ) {
      return { id: 'entiendo', score };
    }

    // Letras dinámicas J, Ñ, Z y señas oscilatorias
    if (pid === 'letra_i' && trajType === 'trazo_j') {
      return { id: 'letra_j', score };
    }
    if ((pid === 'letra_u' || pid === 'letra_v') && trajType === 'oscilacion_h') {
      return { id: 'letra_enie', score };
    }
    if (pid === 'indice' && trajType === 'trazo_z') {
      return { id: 'letra_z', score };
    }
    if (pid === 'indice' && trajType === 'oscilacion_h') {
      return { id: 'negar_mov', score };
    }

    // 3. Desempate estable cuando ambas manos muestran gestos independientes
    if (valid.length >= 2 && currentId) {
      const steady = valid.find((entry) => entry.id === currentId);
      if (steady) {
        return { id: steady.id, score: typeof steady.score === 'number' ? steady.score : 0.9 };
      }
    }
    if (valid.length === 1) {
      return { id: valid[0].id, score: typeof valid[0].score === 'number' ? valid[0].score : 0.9 };
    }
    const top = valid.reduce((best, cur) => ((cur.score || 0) > (best.score || 0) ? cur : best));
    return { id: top.id, score: typeof top.score === 'number' ? top.score : 0.9 };
  }

  /**
   * Voto por mayoría sobre una ventana deslizante de frames para eliminar parpadeos.
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
   * Convierte una glosa del modelo de 118 señas a español legible para el ciudadano.
   * Las glosas técnicas ('ix', 'g_r') devuelven '' para filtrarse fuera de la UI.
   */
  function humanizeGloss(gloss) {
    const raw = String(gloss || '').trim();
    if (!raw || IGNORED_GLOSSES.has(raw)) return '';
    if (Object.prototype.hasOwnProperty.call(GLOSS_SPANISH_MAP, raw)) {
      return GLOSS_SPANISH_MAP[raw];
    }
    return raw.replace(/_/g, ' ');
  }

  /**
   * Resuelve qué mano corresponde a la ranura anatómica izquierda vs derecha del tensor de 159 características.
   */
  function assignAnatomicalHands(allLandmarks, allHandedness, poseLandmarks) {
    const slots = { Left: null, Right: null };
    if (!Array.isArray(allLandmarks) || allLandmarks.length === 0) return slots;

    const hasPoseWrists =
      Array.isArray(poseLandmarks) &&
      poseLandmarks.length >= 17 &&
      Boolean(poseLandmarks[15] && poseLandmarks[16]);

    const sideForHand = (idx) => {
      const entry = Array.isArray(allHandedness) && allHandedness[idx] ? allHandedness[idx][0] : null;
      const mpLabel = normalizeHandedness(entry);
      // En frame sin espejo, la etiqueta cruda de HandLandmarker está invertida respecto al cuerpo
      return mpLabel === 'Left' ? 'Right' : 'Left';
    };

    if (allLandmarks.length === 1) {
      const h0 = allLandmarks[0];
      if (!Array.isArray(h0) || h0.length < 21) return slots;
      let side = sideForHand(0);
      if (hasPoseWrists) {
        const dL = Math.hypot(h0[0].x - poseLandmarks[15].x, h0[0].y - poseLandmarks[15].y);
        const dR = Math.hypot(h0[0].x - poseLandmarks[16].x, h0[0].y - poseLandmarks[16].y);
        side = dL <= dR ? 'Left' : 'Right';
      }
      slots[side] = h0;
      return slots;
    }

    const h0 = allLandmarks[0];
    const h1 = allLandmarks[1];
    if (hasPoseWrists && h0 && h0.length >= 21 && h1 && h1.length >= 21) {
      const cost0L1R =
        Math.hypot(h0[0].x - poseLandmarks[15].x, h0[0].y - poseLandmarks[15].y) +
        Math.hypot(h1[0].x - poseLandmarks[16].x, h1[0].y - poseLandmarks[16].y);
      const cost0R1L =
        Math.hypot(h0[0].x - poseLandmarks[16].x, h0[0].y - poseLandmarks[16].y) +
        Math.hypot(h1[0].x - poseLandmarks[15].x, h1[0].y - poseLandmarks[15].y);
      if (cost0L1R <= cost0R1L) {
        slots.Left = h0;
        slots.Right = h1;
      } else {
        slots.Right = h0;
        slots.Left = h1;
      }
      return slots;
    }

    const s0 = sideForHand(0);
    if (h0 && h0.length >= 21) slots[s0] = h0;
    if (h1 && h1.length >= 21) {
      const s1 = s0 === 'Left' ? 'Right' : 'Left';
      slots[s1] = h1;
    }
    return slots;
  }

  /**
   * Motor 1 (Vocabulario Dinámico · ./models/senas_dinamicas/):
   * Construye el vector de 159 parámetros para un frame:
   *   - 0..20   (21): 7 landmarks de torso superior [0, 11, 12, 13, 14, 15, 16] normalizados por hombros
   *   - 21..89  (69): Mano Izquierda (63 pts muñeca/palma + 3 muñeca rel hombros + 3 normal de palma)
   *   - 90..158 (69): Mano Derecha (63 pts muñeca/palma + 3 muñeca rel hombros + 3 normal de palma)
   */
  function extractDynamicFrameFeatures(poseLandmarks = null, handResults = null) {
    const out = new Float32Array(DYNAMIC_NUM_FEATURES);
    const hasShoulders =
      Array.isArray(poseLandmarks) &&
      poseLandmarks.length >= 17 &&
      Boolean(poseLandmarks[11] && poseLandmarks[12]);

    let midX = 0;
    let midY = 0;
    let midZ = 0;
    let shoulderWidth = 1;

    if (hasShoulders) {
      const ls = poseLandmarks[11];
      const rs = poseLandmarks[12];
      midX = (ls.x + rs.x) / 2;
      midY = (ls.y + rs.y) / 2;
      midZ = ((ls.z || 0) + (rs.z || 0)) / 2;
      shoulderWidth = dist3(ls, rs) || 1e-6;

      for (let i = 0; i < DYNAMIC_POSE_INDICES.length; i += 1) {
        const pt = poseLandmarks[DYNAMIC_POSE_INDICES[i]];
        if (!pt) continue;
        out[i * 3] = (pt.x - midX) / shoulderWidth;
        out[i * 3 + 1] = (pt.y - midY) / shoulderWidth;
        out[i * 3 + 2] = ((pt.z || 0) - midZ) / shoulderWidth;
      }
    }

    const allLandmarks = handResults && Array.isArray(handResults.landmarks) ? handResults.landmarks : [];
    const allHandedness = handResults && Array.isArray(handResults.handedness) ? handResults.handedness : [];
    const slots = assignAnatomicalHands(allLandmarks, allHandedness, poseLandmarks);

    const fillHandSlot = (lm, side, baseOffset) => {
      if (!Array.isArray(lm) || lm.length < 21) return;
      const wrist = lm[0];
      const middleMcp = lm[9];
      const palmSize = dist3(wrist, middleMcp) || 1e-6;

      for (let j = 0; j < 21; j += 1) {
        const p = lm[j];
        out[baseOffset + j * 3] = (p.x - wrist.x) / palmSize;
        out[baseOffset + j * 3 + 1] = (p.y - wrist.y) / palmSize;
        out[baseOffset + j * 3 + 2] = ((p.z || 0) - (wrist.z || 0)) / palmSize;
      }

      if (hasShoulders) {
        out[baseOffset + 63] = (wrist.x - midX) / shoulderWidth;
        out[baseOffset + 64] = (wrist.y - midY) / shoulderWidth;
        out[baseOffset + 65] = ((wrist.z || 0) - midZ) / shoulderWidth;
      }

      const palm = computePalmOrientation3D(lm, side);
      out[baseOffset + 66] = palm.nx;
      out[baseOffset + 67] = palm.ny;
      out[baseOffset + 68] = palm.nz;
    };

    fillHandSlot(slots.Left, 'Left', 21);
    fillHandSlot(slots.Right, 'Right', 90);

    for (let k = 0; k < out.length; k += 1) {
      if (!Number.isFinite(out[k])) out[k] = 0;
    }
    return out;
  }

  /**
   * Atajo ligero de emergencia (Prioridad 1): detecta la seña ILY ('auxilio': índice y meñique
   * extendidos, medio y anular cerrados) sin ejecutar el clasificador geométrico completo.
   */
  function detectIlyEmergency(landmarks, worldLandmarks = null, aspect = 1) {
    const hasWorld = Array.isArray(worldLandmarks) && worldLandmarks.length >= 21;
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    let pts = null;
    if (hasWorld) {
      pts = worldLandmarks;
    } else if (Array.isArray(landmarks) && landmarks.length >= 21) {
      pts = landmarks.map((p) => ({
        x: p.x * safeAspect,
        y: p.y,
        z: typeof p.z === 'number' ? p.z * safeAspect : 0
      }));
    } else {
      return false;
    }

    const palm = dist3(pts[0], pts[9]) || 1e-6;
    const indexExtended =
      angleDeg(pts[5], pts[6], pts[7]) >= 142 &&
      angleDeg(pts[6], pts[7], pts[8]) >= 130 &&
      dist3(pts[0], pts[8]) > dist3(pts[0], pts[6]) + 0.12 * palm;
    const pinkyExtended =
      angleDeg(pts[17], pts[18], pts[19]) >= 138 &&
      angleDeg(pts[18], pts[19], pts[20]) >= 128 &&
      dist3(pts[0], pts[20]) > dist3(pts[0], pts[18]) + 0.10 * palm;
    if (!indexExtended || !pinkyExtended) return false;

    const middleCurled =
      angleDeg(pts[9], pts[10], pts[11]) <= 122 ||
      dist3(pts[0], pts[12]) < dist3(pts[0], pts[10]) + 0.05 * palm;
    const ringCurled =
      angleDeg(pts[13], pts[14], pts[15]) <= 122 ||
      dist3(pts[0], pts[16]) < dist3(pts[0], pts[14]) + 0.05 * palm;

    return middleCurled && ringCurled && dist3(pts[8], pts[12]) > 0.25 * palm;
  }

  /**
   * Suavizado exponencial ligero (EMA) sobre landmarks de MediaPipe (manos ~0.55, torso ~0.45)
   * reduciendo el temblor de cámara web sin añadir latencia y reseteando en entradas nuevas.
   */
  function smoothLandmarksEMA(prevPts, nextPts, alpha = 0.55, jumpResetDist = 0.35) {
    if (!Array.isArray(nextPts) || nextPts.length === 0) return null;
    const clonePts = (pts) =>
      pts.map((p) => ({
        x: p.x,
        y: p.y,
        z: typeof p.z === 'number' ? p.z : 0,
        visibility: typeof p.visibility === 'number' ? p.visibility : 1
      }));

    if (!Array.isArray(prevPts) || prevPts.length !== nextPts.length) {
      return clonePts(nextPts);
    }

    const anchorIdx = nextPts.length >= 23 && nextPts[11] && prevPts[11] ? 11 : 0;
    const anchorJump = Math.hypot(
      nextPts[anchorIdx].x - prevPts[anchorIdx].x,
      nextPts[anchorIdx].y - prevPts[anchorIdx].y
    );
    if (anchorJump > jumpResetDist) {
      return clonePts(nextPts);
    }

    const out = new Array(nextPts.length);
    for (let i = 0; i < nextPts.length; i += 1) {
      const prev = prevPts[i];
      const cur = nextPts[i];
      const pz = typeof prev.z === 'number' ? prev.z : 0;
      const cz = typeof cur.z === 'number' ? cur.z : 0;
      const pv = typeof prev.visibility === 'number' ? prev.visibility : 1;
      const cv = typeof cur.visibility === 'number' ? cur.visibility : 1;
      out[i] = {
        x: prev.x + alpha * (cur.x - prev.x),
        y: prev.y + alpha * (cur.y - prev.y),
        z: pz + alpha * (cz - pz),
        visibility: pv + alpha * (cv - pv)
      };
    }
    return out;
  }

  /**
   * Canonicaliza los 21 puntos 3D métricos de una mano (Modelo Estático 90D):
   * resta la muñeca P0, divide entre ||P9 - P0|| y, si la mano es izquierda, invierte el eje X (x = -x).
   * Toda mano queda así en forma canónica (palma hacia la cámara con el pulgar en +x), igual que en el entrenamiento.
   * @returns {Array<{x:number,y:number,z:number}>|null}
   */
  function canonicalizeHand3D(points, handedness = 'Right') {
    if (!Array.isArray(points) || points.length < 21 || !points[0] || !points[9]) return null;
    const w = points[0];
    const wz = typeof w.z === 'number' ? w.z : 0;
    const scale = Math.hypot(
      points[9].x - w.x,
      points[9].y - w.y,
      (typeof points[9].z === 'number' ? points[9].z : 0) - wz
    );
    if (!(scale > 1e-6)) return null;
    const flip = normalizeHandedness(handedness) === 'Left' ? -1 : 1;
    const out = new Array(21);
    for (let i = 0; i < 21; i += 1) {
      const p = points[i];
      out[i] = {
        x: (flip * (p.x - w.x)) / scale,
        y: (p.y - w.y) / scale,
        z: ((typeof p.z === 'number' ? p.z : 0) - wz) / scale
      };
    }
    return out;
  }

  /** Normal unitaria de la palma: (P5 - P0) × (P17 - P0) sobre puntos canónicos. */
  function computePalmNormalUnit(pts) {
    const a = { x: pts[5].x - pts[0].x, y: pts[5].y - pts[0].y, z: pts[5].z - pts[0].z };
    const b = { x: pts[17].x - pts[0].x, y: pts[17].y - pts[0].y, z: pts[17].z - pts[0].z };
    const nx = a.y * b.z - a.z * b.y;
    const ny = a.z * b.x - a.x * b.z;
    const nz = a.x * b.y - a.y * b.x;
    const norm = Math.hypot(nx, ny, nz) || 1e-6;
    return { x: nx / norm, y: ny / norm, z: nz / norm };
  }

  /**
   * Extractor 90D Zero-Ambiguity (Modelo Estático · ./models/alfabeto_lsp_3d/):
   *   63 coordenadas canónicas (21 × 3) + 15 ángulos de falanges (/180°) + 3 de la normal de la palma
   *   + 9 métricas de desambiguación: distancias pulgar(P4)→puntas 8, 12, 16, 20; distancias entre puntas
   *   consecutivas 8-12, 12-16, 16-20; proyección escalar del pulgar sobre el eje de nudillos P5→P17 y ΔZ índice-medio.
   * @param {Array<{x:number,y:number,z?:number}>} worldLandmarks 21 puntos métricos 3D (hand_world_landmarks)
   * @param {string|object} handedness lado anatómico de la mano ('Left' invierte el eje X)
   * @returns {Float32Array} vector crudo de 90 valores (sin estandarizar)
   */
  function extractHand90Features(worldLandmarks, handedness = 'Right') {
    const out = new Float32Array(HAND_FEATURES_90);
    const pts = canonicalizeHand3D(worldLandmarks, handedness);
    if (!pts) return out;

    let o = 0;
    for (let i = 0; i < 21; i += 1) {
      out[o] = pts[i].x;
      out[o + 1] = pts[i].y;
      out[o + 2] = pts[i].z;
      o += 3;
    }
    for (let i = 0; i < ALPHABET_JOINT_TRIPLETS.length; i += 1) {
      const [a, b, c] = ALPHABET_JOINT_TRIPLETS[i];
      out[o] = angleDeg(pts[a], pts[b], pts[c]) / 180;
      o += 1;
    }
    const normal = computePalmNormalUnit(pts);
    out[o] = normal.x;
    out[o + 1] = normal.y;
    out[o + 2] = normal.z;
    o += 3;

    [8, 12, 16, 20].forEach((tip) => {
      out[o] = dist3(pts[4], pts[tip]);
      o += 1;
    });
    [[8, 12], [12, 16], [16, 20]].forEach(([a, b]) => {
      out[o] = dist3(pts[a], pts[b]);
      o += 1;
    });
    const ax = pts[17].x - pts[5].x;
    const ay = pts[17].y - pts[5].y;
    const az = pts[17].z - pts[5].z;
    const axisLenSq = ax * ax + ay * ay + az * az || 1e-6;
    out[o] =
      ((pts[4].x - pts[5].x) * ax + (pts[4].y - pts[5].y) * ay + (pts[4].z - pts[5].z) * az) / axisLenSq;
    o += 1;
    out[o] = pts[8].z - pts[12].z;

    for (let k = 0; k < out.length; k += 1) {
      if (!Number.isFinite(out[k])) out[k] = 0;
    }
    return out;
  }

  /** Estandariza un vector crudo con (x - scalerMean[i]) / scalerStd[i] (metadata.json del modelo). */
  function standardizeFeatures(raw, scalerMean, scalerStd) {
    const out = new Float32Array(raw.length);
    const hasScaler =
      Array.isArray(scalerMean) && Array.isArray(scalerStd) &&
      scalerMean.length >= raw.length && scalerStd.length >= raw.length;
    for (let i = 0; i < raw.length; i += 1) {
      const std = hasScaler ? scalerStd[i] || 1 : 1;
      const mean = hasScaler ? scalerMean[i] : 0;
      const v = (raw[i] - mean) / std;
      out[i] = Number.isFinite(v) ? v : 0;
    }
    return out;
  }

  /**
   * Un frame de 12 valores para la Micro-GRU dinámica: velocidades relativas (dx, dy, dz) de la muñeca [0],
   * punta de índice [8] y punta de meñique [20] entre dos frames consecutivos (normalizadas por ||P9 - P0||,
   * x invertido en manos izquierdas) más los 3 valores de la normal unitaria de la palma.
   * Con `prevLandmarks` nulo devuelve velocidades 0 (primer frame de la mano).
   */
  function extractTrajectoryFrame(prevLandmarks, curLandmarks, handedness = 'Right', aspect = 1, palmNormal = null) {
    if (!Array.isArray(curLandmarks) || curLandmarks.length < 21) return null;
    const prev = Array.isArray(prevLandmarks) && prevLandmarks.length >= 21 ? prevLandmarks : curLandmarks;
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    const flip = normalizeHandedness(handedness) === 'Left' ? -1 : 1;
    const palm = Math.hypot(
      (curLandmarks[9].x - curLandmarks[0].x) * safeAspect,
      curLandmarks[9].y - curLandmarks[0].y,
      ((curLandmarks[9].z || 0) - (curLandmarks[0].z || 0)) * safeAspect
    );
    if (!(palm > 1e-6)) return null;

    const out = new Float32Array(TRAJ_NUM_FEATURES);
    [0, 8, 20].forEach((lm, k) => {
      out[k * 3] = (flip * (curLandmarks[lm].x - prev[lm].x) * safeAspect) / palm;
      out[k * 3 + 1] = (curLandmarks[lm].y - prev[lm].y) / palm;
      out[k * 3 + 2] = (((curLandmarks[lm].z || 0) - (prev[lm].z || 0)) * safeAspect) / palm;
    });
    if (palmNormal && palmNormal.length >= 3) {
      out[9] = palmNormal[0];
      out[10] = palmNormal[1];
      out[11] = palmNormal[2];
    }
    for (let i = 0; i < out.length; i += 1) {
      if (!Number.isFinite(out[i])) out[i] = 0;
    }
    return out;
  }

  /** Aplana y estandariza la secuencia [16, 12] de la Micro-GRU con scalerMean / scalerStd (12 valores por frame). */
  function standardizeTrajectorySequence(frames, scalerMean, scalerStd) {
    const out = new Float32Array(frames.length * TRAJ_NUM_FEATURES);
    for (let t = 0; t < frames.length; t += 1) {
      const std = standardizeFeatures(frames[t], scalerMean, scalerStd);
      out.set(std, t * TRAJ_NUM_FEATURES);
    }
    return out;
  }

  /**
   * Bloque 1.3 · Capa biomecánica de cuerpo completo (Smart Gating + diagnóstico):
   * Evalúa encuadre de hombros/codos, distancia al frame, apertura de codos, elevación sobre torso/caderas
   * e inclinación/rotación de hombros para distinguir `reposo`, `dinamico` y `estatico`.
   */
  function analyzeBiomechanics(poseLandmarks, handLandmarksList = [], wristSteady = true, aspect = 4 / 3) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
    const hands = Array.isArray(handLandmarksList) ? handLandmarksList : [];
    const handCount = hands.length;

    const vis = (pt) => (pt && typeof pt.visibility === 'number' ? pt.visibility : 1);
    const hasPose = Array.isArray(poseLandmarks) && poseLandmarks.length >= 17;
    const p11 = hasPose ? poseLandmarks[11] : null;
    const p12 = hasPose ? poseLandmarks[12] : null;
    const p13 = hasPose ? poseLandmarks[13] : null;
    const p14 = hasPose ? poseLandmarks[14] : null;
    const p15 = hasPose ? poseLandmarks[15] : null;
    const p16 = hasPose ? poseLandmarks[16] : null;
    const p23 = hasPose && poseLandmarks.length > 23 ? poseLandmarks[23] : null;
    const p24 = hasPose && poseLandmarks.length > 24 ? poseLandmarks[24] : null;

    const shouldersPresent = Boolean(
      p11 && p12 && vis(p11) >= 0.35 && vis(p12) >= 0.35 &&
      p11.x >= 0.02 && p11.x <= 0.98 && p12.x >= 0.02 && p12.x <= 0.98 &&
      p11.y >= 0.02 && p11.y <= 0.94 && p12.y >= 0.02 && p12.y <= 0.94
    );

    const elbowsVisible = Boolean(
      p13 && p14 && vis(p13) >= 0.3 && vis(p14) >= 0.3 &&
      p13.x >= 0.01 && p13.x <= 0.99 && p14.x >= 0.01 && p14.x <= 0.99
    );

    const shoulderSpanX = p11 && p12 ? Math.abs(p11.x - p12.x) : 0.35;
    const shMidY = p11 && p12 ? (p11.y + p12.y) / 2 : 0.38;

    let hipLineY = Math.min(0.95, shMidY + Math.max(0.24, shoulderSpanX * 1.35));
    if (p23 && p24 && vis(p23) >= 0.3 && vis(p24) >= 0.3) {
      hipLineY = (p23.y + p24.y) / 2;
    }

    let framing = 'optimo';
    let framingLabel = 'Encuadre óptimo';
    let framingTone = 'ok';

    if (shouldersPresent && (shoulderSpanX > 0.62 || (p11.y < 0.07 && p12.y < 0.07))) {
      framing = 'muy_cerca';
      framingLabel = 'Aléjate un poco';
      framingTone = 'warn';
    } else if (hasPose && !shouldersPresent) {
      framing = 'hombros_cortados';
      framingLabel = 'Muestra tus hombros';
      framingTone = 'warn';
    } else if (handCount === 0) {
      framing = 'sin_manos';
      framingLabel = 'Muestra una o ambas manos';
      framingTone = 'idle';
    }

    const toAspectPt = (p) => (p ? { x: p.x * safeAspect, y: p.y, z: (p.z || 0) * safeAspect } : null);
    const leftElbowDeg = p11 && p13 && p15 ? Math.round(angleDeg(toAspectPt(p11), toAspectPt(p13), toAspectPt(p15))) : null;
    const rightElbowDeg = p12 && p14 && p16 ? Math.round(angleDeg(toAspectPt(p12), toAspectPt(p14), toAspectPt(p16))) : null;

    const shoulderTiltDeg = p11 && p12
      ? Math.round((Math.atan2(p12.y - p11.y, Math.abs(p12.x - p11.x) || 1e-6) * 180) / Math.PI)
      : 0;
    const shoulderYaw = p11 && p12
      ? Number((Math.abs((p12.z || 0) - (p11.z || 0)) / (shoulderSpanX || 1e-6)).toFixed(2))
      : 0;

    // Elevación de muñecas: detecta manos descansando abajo fuera de la zona de señado
    let inRestZone = false;
    let avgWristElevation = 0;
    if (handCount > 0) {
      const torsoHeight = Math.max(0.18, hipLineY - shMidY);
      let restCount = 0;
      let elevSum = 0;
      for (let i = 0; i < handCount; i += 1) {
        const w = hands[i] && hands[i][0];
        if (!w) continue;
        const elev = (hipLineY - w.y) / torsoHeight;
        elevSum += elev;
        if (w.y >= 0.89 || elev < 0.12) restCount += 1;
      }
      avgWristElevation = Number((elevSum / handCount).toFixed(2));
      inRestZone = restCount === handCount;
    }

    let activity = 'reposo';
    if (handCount === 0 || (inRestZone && wristSteady)) {
      activity = 'reposo';
    } else if (handCount >= 2 || !wristSteady) {
      activity = 'dinamico';
    } else {
      activity = 'estatico';
    }

    return {
      framing,
      framingLabel,
      framingTone,
      activity,
      elbowsVisible,
      shoulderSpanX: Number(shoulderSpanX.toFixed(3)),
      shoulderTiltDeg,
      shoulderYaw,
      leftElbowDeg,
      rightElbowDeg,
      avgWristElevation,
      inRestZone
    };
  }

  /**
   * Estabilidad rápida de muñeca sobre los últimos N frames (~150 ms) para responder de inmediato
   * al detener la mano en letras estáticas (C, M, N, etc.) sin esperar 1.7 s.
   */
  function isWristSteady(trackBuffer, windowFrames = 5) {
    if (!Array.isArray(trackBuffer) || trackBuffer.length < 2) return true;
    const count = Math.min(Math.max(2, windowFrames), trackBuffer.length);
    const start = trackBuffer.length - count;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxStep = 0;
    let palmSum = 0;
    let prevX = null;
    let prevY = null;

    for (let i = start; i < trackBuffer.length; i += 1) {
      const f = trackBuffer[i];
      const wrist = f && Array.isArray(f.landmarks) ? f.landmarks[0] : null;
      if (!wrist) continue;
      palmSum += f.palmSize || 0.1;
      if (wrist.x < minX) minX = wrist.x;
      if (wrist.x > maxX) maxX = wrist.x;
      if (wrist.y < minY) minY = wrist.y;
      if (wrist.y > maxY) maxY = wrist.y;
      if (prevX !== null) {
        const step = Math.hypot(wrist.x - prevX, wrist.y - prevY);
        if (step > maxStep) maxStep = step;
      }
      prevX = wrist.x;
      prevY = wrist.y;
    }

    if (prevX === null || !Number.isFinite(minX)) return true;
    const avgPalm = palmSum / count || 0.1;
    const span = Math.hypot(maxX - minX, maxY - minY) / avgPalm;
    return span <= 0.18 && maxStep / avgPalm <= 0.09;
  }

  /**
   * Detecta movimiento amplio de brazo/codo propio de una seña dinámica (118 señas),
   * diferenciándolo de los micro-ajustes o trazos cortos J/Ñ/Z de una sesión de deletreo.
   */
  function detectWideArmMotion(macroBuffer) {
    if (!Array.isArray(macroBuffer) || macroBuffer.length < 4) return false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let palmSum = 0;
    let minElbow = Infinity;
    let maxElbow = -Infinity;

    for (let i = 0; i < macroBuffer.length; i += 1) {
      const f = macroBuffer[i];
      if (!f) continue;
      if (f.x < minX) minX = f.x;
      if (f.x > maxX) maxX = f.x;
      if (f.y < minY) minY = f.y;
      if (f.y > maxY) maxY = f.y;
      palmSum += f.palmSize || 0.1;
      if (typeof f.elbowDeg === 'number' && Number.isFinite(f.elbowDeg)) {
        if (f.elbowDeg < minElbow) minElbow = f.elbowDeg;
        if (f.elbowDeg > maxElbow) maxElbow = f.elbowDeg;
      }
    }
    if (!Number.isFinite(minX)) return false;
    const avgPalm = palmSum / macroBuffer.length || 0.1;
    const wristDispNorm = Math.hypot(maxX - minX, maxY - minY);
    const wristDispPalms = wristDispNorm / avgPalm;
    const elbowDelta = minElbow !== Infinity && maxElbow !== -Infinity ? maxElbow - minElbow : 0;
    return wristDispPalms >= 0.90 || wristDispNorm >= 0.24 || elbowDelta >= 28;
  }

  /**
   * Encadena las señas y letras confirmadas en español legible integrando espacios de deletreo y ¿...?.
   * @param {Array<{id?:string,kind:'word'|'letter'|'space', text:string}>} tokens
   * @param {string} [expression='neutro'] 'pregunta' | 'negacion_enfasis' | 'urgencia_dolor' | 'neutro'
   * @returns {string}
   */
  function composeSentence(tokens, expression = 'neutro') {
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
      } else if (token.kind === 'space') {
        flushLetters();
      } else {
        flushLetters();
        parts.push({ text: token.text, kind: 'word' });
      }
    });
    flushLetters();

    if (parts.length === 0) return '';
    let sentence = parts.map((p) => p.text).join(' ');
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    if (parts[parts.length - 1].kind === 'word') {
      sentence = sentence.replace(/[,;:]$/, '');
      if (!/[.!?]$/.test(sentence)) sentence += '.';
    }

    const hasQueryIntent =
      /\b(consulta|ayuda|necesito|dni|monto|por favor|entiendo|corregir|espera|cómo|cuándo|dónde|cuánto|qué)\b/i.test(sentence) ||
      tokens.some((t) => t.id === 'indice' || t.id === 'por_favor' || t.kind === 'letter');

    if (expression === 'pregunta' && hasQueryIntent) {
      const core = sentence.replace(/^[¿]/, '').replace(/[.!?]+$/, '');
      sentence = `¿${core}?`;
    }

    return sentence;
  }

  let latestDescriptorSnapshot = null;
  const TF_STATUS_IDLE = Object.freeze({
    ready: false,
    loading: false,
    dynamicReady: false,
    alphabetReady: false,
    trajectoryReady: false,
    error: null
  });
  let activeTfStatusSnapshot = { ...TF_STATUS_IDLE };

  function getLastDescriptor() {
    return latestDescriptorSnapshot;
  }

  function getTfEngineStatus() {
    return Object.freeze({ ...activeTfStatusSnapshot });
  }

  // API pública para pruebas unitarias, telemetría y verificación (sin alterar DOM)
  window.SenaSeguraVision = Object.freeze({
    classifyHand,
    resolveMultiHandGesture,
    majorityVoteGesture,
    detectHorizontalOscillation,
    computePalmOrientation3D,
    computeSpatialContext,
    analyzeNonManualExpressions,
    analyzeTrajectory3D,
    extractDynamicFrameFeatures,
    canonicalizeHand3D,
    extractHand90Features,
    standardizeFeatures,
    extractTrajectoryFrame,
    standardizeTrajectorySequence,
    smoothLandmarksEMA,
    analyzeBiomechanics,
    detectWideArmMotion,
    detectIlyEmergency,
    isWristSteady,
    humanizeGloss,
    composeSentence,
    loadTfModels,
    getLastDescriptor,
    getTfEngineStatus,
    GESTURES
  });

  /* =========================================================
     3. PRECARGA SILENCIOSA Y MOTORES DE VISIÓN + TENSORFLOW.JS
     ========================================================= */
  let visionModulePromise = null;
  let loadedHandConnections = HAND_CONNECTIONS_FALLBACK;
  const scriptPromises = new Map();
  let tfModelsPromise = null;
  let loadedTfModels = null;
  let tfProgressCallback = null;

  /**
   * Calcula el prefijo relativo hacia ./models sin usar rutas absolutas con '/' inicial,
   * garantizando compatibilidad 100 % con GitHub Pages (/repositorio/pages/... o /pages/...).
   */
  function resolveRelativeModelsRoot() {
    const pathname = String(window.location && window.location.pathname ? window.location.pathname : '');
    return /\/pages(?:\/[^/]*)?$/.test(pathname) ? '../models' : './models';
  }

  async function loadGraphModelWithFallback(candidateDirs, expectedMetadataName) {
    let lastErr = null;
    for (let i = 0; i < candidateDirs.length; i += 1) {
      const dir = candidateDirs[i];
      try {
        const metaRes = await withTimeout(fetch(`${dir}/metadata.json`, { cache: 'default' }), LOAD_TIMEOUT_MS);
        if (!metaRes.ok) throw new Error(`metadata-http-${metaRes.status}`);
        const metadata = await metaRes.json();
        const model = await withTimeout(window.tf.loadGraphModel(`${dir}/model.json`), LOAD_TIMEOUT_MS);
        return { dir, metadata, model, name: expectedMetadataName };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error(`graph-model-load-failed:${expectedMetadataName}`);
  }

  function warmupTfModel(entry, shape) {
    if (!entry || !entry.model || !window.tf) return;
    window.tf.tidy(() => {
      const dummy = window.tf.zeros(shape, 'float32');
      const out = entry.model.predict(dummy);
      if (Array.isArray(out)) out.forEach((t) => t.dataSync());
      else if (out && typeof out.dataSync === 'function') out.dataSync();
    });
  }

  function loadTfModels({ onProgress } = {}) {
    if (typeof onProgress === 'function') {
      tfProgressCallback = onProgress;
    }
    if (loadedTfModels) return Promise.resolve(loadedTfModels);
    if (tfModelsPromise) return tfModelsPromise;
    if (window.location.protocol === 'file:') {
      const err = new Error('file-protocol');
      activeTfStatusSnapshot = { ...TF_STATUS_IDLE, error: err.message };
      return Promise.reject(err);
    }

    activeTfStatusSnapshot = { ...TF_STATUS_IDLE, loading: true };
    const report = (msg) => {
      if (typeof tfProgressCallback === 'function') tfProgressCallback(msg);
    };

    tfModelsPromise = (async () => {
      try {
        report('Descargando motor TensorFlow.js…');
        await loadLegacyScript(TFJS_SCRIPT_URL);
        if (!window.tf || typeof window.tf.loadGraphModel !== 'function') {
          throw new Error('tfjs-unavailable');
        }
        await window.tf.ready();

        const root = resolveRelativeModelsRoot();
        report('Descargando modelos IA LSP (vocabulario, alfabeto 3D y trayectorias)…');
        // Carpetas reales del repositorio primero (sin 404 en consola); la ruta documentada queda como alternativa.
        const [dynamic, alphabet, trajectory] = await Promise.all([
          loadGraphModelWithFallback([`${root}/senas_dinamicas`, `${root}/model_senas_3enlaces`], 'senas_dinamicas'),
          loadGraphModelWithFallback([`${root}/model_alfabeto_lsp_3d`, `${root}/alfabeto_lsp_3d`], 'alfabeto_lsp_3d'),
          loadGraphModelWithFallback([`${root}/model_alfabeto_dinamico_3d`, `${root}/alfabeto_dinamico_3d`], 'alfabeto_dinamico_3d')
        ]);

        if ((alphabet.metadata.numFeatures || HAND_FEATURES_90) !== HAND_FEATURES_90) {
          throw new Error('alfabeto-3d-features-mismatch');
        }
        if (
          (trajectory.metadata.sequenceLength || TRAJ_SEQ_LEN) !== TRAJ_SEQ_LEN ||
          (trajectory.metadata.numFeatures || TRAJ_NUM_FEATURES) !== TRAJ_NUM_FEATURES
        ) {
          throw new Error('trayectoria-3d-shape-mismatch');
        }

        report('Preparando redes neuronales en tu navegador…');
        warmupTfModel(dynamic, [1, dynamic.metadata.sequenceLength || DYNAMIC_SEQ_LEN, dynamic.metadata.numFeatures || DYNAMIC_NUM_FEATURES]);
        warmupTfModel(alphabet, [1, HAND_FEATURES_90]);
        warmupTfModel(trajectory, [1, TRAJ_SEQ_LEN, TRAJ_NUM_FEATURES]);

        loadedTfModels = { dynamic, alphabet, trajectory };
        activeTfStatusSnapshot = {
          ready: true,
          loading: false,
          dynamicReady: Boolean(dynamic && dynamic.model),
          alphabetReady: Boolean(alphabet && alphabet.model),
          trajectoryReady: Boolean(trajectory && trajectory.model),
          error: null
        };
        return loadedTfModels;
      } catch (err) {
        tfModelsPromise = null;
        activeTfStatusSnapshot = {
          ...TF_STATUS_IDLE,
          error: err ? String(err.message || err) : 'tfjs-load-error'
        };
        throw err;
      }
    })();

    return tfModelsPromise;
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
    const aiReadyEl = $('vision-ai-ready');
    const btnOverlay = $('btn-vision-overlay');
    const btnMirror = $('btn-vision-mirror');
    const btnExpand = $('btn-vision-expand');
    const simMainGrid = $('sim-main-grid');
    const hudEl = $('vision-hud');
    const hudFramingEl = $('vision-hud-framing');
    const hudActivityEl = $('vision-hud-activity');
    const hudTop2El = $('vision-hud-top2');
    const handsCountEl = $('vision-hands-count');
    const notice = $('vision-notice');
    const placeholder = $('vision-placeholder');
    const placeholderText = $('vision-placeholder-text');
    const btnStart = $('btn-vision-start');
    const btnSimulate = $('btn-vision-simulate');
    const btnSpeak = $('btn-vision-speak');
    const btnSpace = $('btn-vision-space');
    const btnUndo = $('btn-vision-undo');
    const btnClear = $('btn-vision-clear');
    const btnEscalate = $('btn-vision-escalate');
    const simBox = $('vision-simulation');
    const simGrid = $('vision-gesture-grid');
    const lettersBar = $('vision-letters-bar');
    const guideList = $('vision-guide-list');
    const letterRefBox = $('vision-letter-ref');
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
      return;
    }

    const ctx = canvas.getContext('2d');
    const btnStartLabel = btnStart.querySelector('span') || btnStart;
    const btnSimulateLabel = btnSimulate.querySelector('span') || btnSimulate;
    const DEFAULT_SENTENCE = 'Muestra una seña y mantenla un instante para empezar la oración.';
    const DEFAULT_LAST_DETECT = 'Última seña: — · Confianza: —';
    const DEFAULT_PROGRESS_LABEL = 'Reconocimiento unificado LSP (118 señas + alfabeto)';
    const lowPowerDevice =
      window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 4) <= 2;

    let mode = 'idle'; // idle | loading | live | simulation
    let sessionToken = 0;
    let stream = null;
    // visionEngine: { type: 'tasks', level: 1|2, handLandmarker, poseLandmarker, faceLandmarker } | { type: 'legacy', level: 3, hands }
    let visionEngine = null;
    let enginePromise = null;
    let tfModels = null;
    let preloadHandle = null;
    let preloadUsingIdle = false;
    let overlayEnabled = true;
    let mirrorEnabled = true;
    let visionExpanded = false;
    let running = false;
    let rafId = 0;
    let frameCounter = 0;
    let isLegacyProcessing = false;
    let lastVideoTime = -1;
    let lastSendAt = 0;
    let lastDetectTs = 0;
    let lastAuxDetectTs = 0;
    let latestPoseLandmarks = null;
    let smoothedPoseLandmarks = null;
    let latestFaceLandmarks = null;
    let latestFaceBlendshapes = null;
    let prevPalmOrientation = null;
    let activeSentenceExpression = 'neutro';
    let lastConfirmed = null;
    let lastProgressPct = -1;
    let handsDownSince = null;
    let lastLetterConfirmedAt = 0;
    let missingHandFrames = 0;
    let speechTimer = null;
    let sentenceTokens = [];
    let dynamicEvalCounter = 0;
    let isDynamicInferring = false;
    let isAlphabetInferring = false;
    let isTrajectoryInferring = false;
    let prevTrajLandmarks = null;
    let trajEpoch = 0;
    let lastDynamicEmitAt = 0;
    let lastHudTop2At = 0;
    let lastHudTop2Text = '';
    const dynamicFlatInput = new Float32Array(DYNAMIC_SEQ_LEN * DYNAMIC_NUM_FEATURES);
    const smoothedHandSlots = { Left: null, Right: null };
    const smoothedWorldSlots = { Left: null, Right: null };
    const trajectoryBuffer = [];
    const trajectoryState = { label: null, prob: 0, at: 0 };
    const trailPoints = [];
    const wristMacroBuffer = [];
    const MAX_WRIST_MACRO = 10;
    const lastAddedAt = {};
    const motionBuffer = [];
    const voteBuffer = [];
    const dynamicSeqBuffer = [];
    const spellTrackBuffer = [];
    const detection = { id: null, since: 0, lastSeen: 0, confirmed: false, scoreSum: 0, scoreN: 0, meta: null };
    const dynCandidate = { id: null, streak: 0, lastProb: 0, since: 0 };
    const spellCandidate = { label: null, since: 0, lastSeen: 0, confirmed: false, scoreSum: 0, scoreN: 0 };

    function setAiReadyState(state) {
      if (!aiReadyEl) return;
      aiReadyEl.setAttribute('data-ready', state);
      if (state === 'ready') {
        aiReadyEl.textContent = 'IA lista';
      } else if (state === 'fallback') {
        aiReadyEl.textContent = 'IA básica';
      } else {
        aiReadyEl.textContent = 'Preparando IA…';
      }
    }

    function syncHudVisibility() {
      if (!hudEl) return;
      const shouldShow = mode === 'live' && overlayEnabled;
      hudEl.hidden = !shouldShow;
      hudEl.setAttribute('aria-hidden', String(!shouldShow));
    }

    function updateHud({ framingText, framingTone, activityText, activityTone, top2Text } = {}, now = performance.now()) {
      syncHudVisibility();
      if (!hudEl || hudEl.hidden) return;
      if (hudFramingEl && framingText) {
        hudFramingEl.textContent = framingText;
        hudFramingEl.setAttribute('data-tone', framingTone || 'ok');
      }
      if (hudActivityEl && activityText) {
        hudActivityEl.textContent = activityText;
        hudActivityEl.setAttribute('data-tone', activityTone || 'idle');
      }
      if (hudTop2El && typeof top2Text === 'string' && top2Text !== lastHudTop2Text) {
        if (now - lastHudTop2At >= HUD_TOP2_THROTTLE_MS || top2Text === 'Enfoque: esperando seña…' || top2Text.includes('Emergencia')) {
          lastHudTop2Text = top2Text;
          lastHudTop2At = now;
          hudTop2El.textContent = top2Text;
        }
      }
    }

    function setVisionExpanded(nextExpanded) {
      visionExpanded = Boolean(nextExpanded);
      if (simMainGrid) simMainGrid.classList.toggle('is-vision-expanded', visionExpanded);
      if (btnExpand) {
        btnExpand.classList.toggle('is-active', visionExpanded);
        btnExpand.setAttribute('aria-pressed', String(visionExpanded));
        btnExpand.textContent = visionExpanded ? 'Vista normal' : 'Ampliar vista';
      }
    }

    function resetSpellCandidate() {
      spellCandidate.label = null;
      spellCandidate.since = 0;
      spellCandidate.lastSeen = 0;
      spellCandidate.confirmed = false;
      spellCandidate.scoreSum = 0;
      spellCandidate.scoreN = 0;
    }

    /** Reinicia el buffer de la Micro-GRU (se re-cebará con velocidades 0 al reaparecer la mano). */
    function resetTrajectory() {
      trajEpoch += 1;
      trajectoryBuffer.length = 0;
      prevTrajLandmarks = null;
      trajectoryState.label = null;
      trajectoryState.prob = 0;
      trajectoryState.at = 0;
    }

    function resetDynamicCandidate() {
      dynCandidate.id = null;
      dynCandidate.streak = 0;
      dynCandidate.lastProb = 0;
      dynCandidate.since = 0;
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
      const cameraOn = nextMode === 'loading' || nextMode === 'live';
      btnStartLabel.textContent = cameraOn ? 'Detener Cámara' : 'Activar Cámara';
      btnSimulateLabel.textContent = nextMode === 'simulation' ? 'Salir de simulación' : 'Probar sin cámara';
      simBox.hidden = nextMode !== 'simulation';
      syncHudVisibility();
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
      const text = composeSentence(sentenceTokens, activeSentenceExpression);
      const hasTrailingSpace = sentenceTokens.length > 0 && sentenceTokens[sentenceTokens.length - 1].kind === 'space';
      sentenceEl.textContent = text ? (hasTrailingSpace ? `${text} ␣` : text) : DEFAULT_SENTENCE;
      sentenceEl.classList.toggle('is-empty', !text);
      const hasTokens = sentenceTokens.length > 0;
      const canReset = hasTokens || Boolean(lastConfirmed);
      btnSpeak.disabled = !hasTokens;
      if (btnSpace) btnSpace.disabled = !hasTokens || hasTrailingSpace;
      btnUndo.disabled = !canReset;
      if (btnClear) btnClear.disabled = !canReset;
    }

    function resetOutput() {
      lastConfirmed = null;
      sentenceTokens = [];
      activeSentenceExpression = 'neutro';
      latestDescriptorSnapshot = null;
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
      detection.meta = null;
      resetDynamicCandidate();
      resetSpellCandidate();
      dynamicEvalCounter = 0;
      isDynamicInferring = false;
      isAlphabetInferring = false;
      isTrajectoryInferring = false;
      lastDynamicEmitAt = 0;
      resetTrajectory();
      missingHandFrames = 0;
      lastLetterConfirmedAt = 0;
      smoothedHandSlots.Left = null;
      smoothedHandSlots.Right = null;
      smoothedWorldSlots.Left = null;
      smoothedWorldSlots.Right = null;
      trailPoints.length = 0;
      wristMacroBuffer.length = 0;
      lastHudTop2At = 0;
      lastHudTop2Text = '';
      if (hudTop2El) hudTop2El.textContent = 'Enfoque: esperando seña…';
      motionBuffer.length = 0;
      voteBuffer.length = 0;
      dynamicSeqBuffer.length = 0;
      spellTrackBuffer.length = 0;
      prevPalmOrientation = null;
      latestPoseLandmarks = null;
      smoothedPoseLandmarks = null;
      latestFaceLandmarks = null;
      latestFaceBlendshapes = null;
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
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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

    async function createTaskWithCpuFallback(TaskClass, vision, options) {
      if (!TaskClass) return null;
      try {
        return await withTimeout(
          TaskClass.createFromOptions(vision, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: 'GPU' }
          }),
          LOAD_TIMEOUT_MS
        );
      } catch (gpuErr) {
        console.warn('[Cámara IA]', gpuErr);
        return withTimeout(
          TaskClass.createFromOptions(vision, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: 'CPU' }
          }),
          LOAD_TIMEOUT_MS
        );
      }
    }

    async function createTasksEngine({ forceCpu = false } = {}) {
      const { FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker } = await loadTasksVision();
      const vision = await withTimeout(FilesetResolver.forVisionTasks(VISION_WASM_URL), LOAD_TIMEOUT_MS);

      const makeTask = (TaskClass, opts) => {
        if (!TaskClass) return Promise.resolve(null);
        if (forceCpu) {
          return withTimeout(
            TaskClass.createFromOptions(vision, {
              ...opts,
              baseOptions: { ...opts.baseOptions, delegate: 'CPU' }
            }),
            LOAD_TIMEOUT_MS
          );
        }
        return createTaskWithCpuFallback(TaskClass, vision, opts);
      };

      // PoseLandmarker Full en escritorio/laptop y Lite en dispositivos ligeros (fallback automático a Lite)
      const createPoseLandmarker = () => {
        if (!PoseLandmarker) return Promise.resolve(null);
        const preferredPoseUrl = lowPowerDevice ? POSE_MODEL_LITE_URL : POSE_MODEL_FULL_URL;
        const poseOpts = (url) => ({
          baseOptions: { modelAssetPath: url },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minTrackingConfidence: 0.45
        });
        return makeTask(PoseLandmarker, poseOpts(preferredPoseUrl))
          .catch((fullErr) => {
            if (preferredPoseUrl === POSE_MODEL_FULL_URL) {
              console.warn('[Cámara IA · Pose Full fallback]', fullErr);
              return makeTask(PoseLandmarker, poseOpts(POSE_MODEL_LITE_URL));
            }
            throw fullErr;
          })
          .catch((err) => {
            console.warn('[Cámara IA]', err);
            return null;
          });
      };

      const [handLandmarker, poseRes] = await Promise.all([
        makeTask(HandLandmarker, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        }),
        createPoseLandmarker()
      ]);

      const poseLandmarker = poseRes || null;

      if (tfModelsPromise && !loadedTfModels) {
        await tfModelsPromise.catch(() => null);
      }
      const tfAvailable = Boolean(loadedTfModels || tfModels);

      let faceLandmarker = null;
      if (!tfAvailable && !lowPowerDevice && FaceLandmarker) {
        try {
          faceLandmarker = await makeTask(FaceLandmarker, {
            baseOptions: { modelAssetPath: FACE_MODEL_URL },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            minFaceDetectionConfidence: 0.45,
            minTrackingConfidence: 0.45
          });
        } catch (faceErr) {
          console.warn('[Cámara IA]', faceErr);
        }
      }

      const level = poseLandmarker || faceLandmarker ? 1 : 2;
      return { type: 'tasks', level, handLandmarker, poseLandmarker, faceLandmarker, cpuFallbackUsed: forceCpu };
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
      return { type: 'legacy', level: 3, hands: instance };
    }

    function getVisionEngine({ silent = false } = {}) {
      if (visionEngine) return Promise.resolve(visionEngine);
      if (enginePromise) return enginePromise;
      if (navigator.onLine === false || window.location.protocol === 'file:') {
        return Promise.reject(new Error(navigator.onLine === false ? 'offline' : 'file-protocol'));
      }
      enginePromise = createTasksEngine()
        .then((eng) => {
          visionEngine = eng;
          return eng;
        })
        .catch((tasksErr) => {
          if (!silent) console.warn('[Cámara IA]', tasksErr);
          return createLegacyEngine().then((legacyEng) => {
            visionEngine = legacyEng;
            return legacyEng;
          });
        })
        .catch((fallbackErr) => {
          if (!silent) console.warn('[Cámara IA]', fallbackErr);
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

      const readyModels = tfModels || loadedTfModels;
      const preloadedReady = Boolean(visionEngine && readyModels);
      if (preloadedReady) {
        tfModels = readyModels;
        statusText.textContent = 'Abriendo cámara…';
        placeholderText.textContent = 'Modelos IA listos. Permite el acceso a la cámara si el navegador lo solicita.';
      } else {
        statusText.textContent = 'Descargando modelos IA…';
        placeholderText.textContent = 'Cargando motor MediaPipe y redes neuronales LSP (118 señas y alfabeto)… Permite el acceso a la cámara si el navegador lo solicita.';
      }
      btnStart.focus();

      const updateProgressMsg = (msg) => {
        if (token !== sessionToken || mode !== 'loading' || preloadedReady) return;
        statusText.textContent = 'Descargando modelos IA…';
        placeholderText.textContent = `${msg} Permite el acceso a la cámara si el navegador lo solicita.`;
      };

      const [tfResult, libResult, camResult] = await Promise.allSettled([
        loadTfModels({ onProgress: updateProgressMsg }),
        getVisionEngine({ silent: false }),
        openCamera()
      ]);

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

      if (tfResult.status === 'fulfilled') {
        tfModels = tfResult.value;
        setAiReadyState('ready');
      } else {
        tfModels = null;
        setAiReadyState('fallback');
        console.warn('[Cámara IA · TF.js]', tfResult.reason);
        showNotice('Modelos neuronales TF.js no disponibles en esta red: operando con reconocimiento geométrico base.');
      }

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

        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        canvas.width = vw;
        canvas.height = vh;
        if (stage) stage.style.aspectRatio = `${vw} / ${vh}`;
        running = true;
        frameCounter = 0;
        isLegacyProcessing = false;
        lastVideoTime = -1;
        lastSendAt = 0;
        setStatus('live');
        if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        console.warn('[Cámara IA]', err);
        if (token !== sessionToken) return;
        enterSimulation('No se pudo mostrar el video de la cámara. Usa la prueba sin cámara para continuar.');
      }
    }

    /** Bucle de video ~30 fps: Manos cada frame; Pose cada 2 frames; Face omitido si TF.js activo. */
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
          const handRes = visionEngine.handLandmarker.detectForVideo(video, ts);

          const tfActive = Boolean(tfModels || loadedTfModels);
          const runPoseNow = Boolean(visionEngine.poseLandmarker) && frameCounter % 2 === 0;
          const runFaceNow = !tfActive && Boolean(visionEngine.faceLandmarker) && frameCounter % AUX_DETECT_STRIDE === 0;

          if (runPoseNow || runFaceNow) {
            const auxTs = Math.max(lastAuxDetectTs + 1, ts);
            lastAuxDetectTs = auxTs;
            if (runPoseNow) {
              try {
                const poseRes = visionEngine.poseLandmarker.detectForVideo(video, auxTs);
                const rawPose =
                  poseRes && Array.isArray(poseRes.landmarks) && poseRes.landmarks[0] ? poseRes.landmarks[0] : null;
                latestPoseLandmarks = rawPose;
                smoothedPoseLandmarks = rawPose
                  ? smoothLandmarksEMA(smoothedPoseLandmarks, rawPose, POSE_EMA_ALPHA, 0.4)
                  : null;
              } catch (poseErr) {
                console.warn('[Cámara IA]', poseErr);
                visionEngine.poseLandmarker = null;
              }
            }
            if (runFaceNow) {
              try {
                const faceRes = visionEngine.faceLandmarker.detectForVideo(video, auxTs);
                latestFaceLandmarks =
                  faceRes && Array.isArray(faceRes.landmarks) && faceRes.landmarks[0] ? faceRes.landmarks[0] : null;
                latestFaceBlendshapes =
                  faceRes && Array.isArray(faceRes.faceBlendshapes) && faceRes.faceBlendshapes[0]
                    ? faceRes.faceBlendshapes[0]
                    : null;
              } catch (faceErr) {
                console.warn('[Cámara IA]', faceErr);
                visionEngine.faceLandmarker = null;
              }
            }
          }
          frameCounter += 1;
          handleResults(handRes, ts);
        } catch (err) {
          console.warn('[Cámara IA]', err);
          if (running && visionEngine && !visionEngine.cpuFallbackUsed) {
            const tokenAtFail = sessionToken;
            visionEngine.cpuFallbackUsed = true;
            running = false;
            createTasksEngine({ forceCpu: true })
              .catch(() => createLegacyEngine())
              .then((cpuEngine) => {
                if (tokenAtFail !== sessionToken) return;
                visionEngine = cpuEngine;
                enginePromise = Promise.resolve(cpuEngine);
                running = true;
                lastVideoTime = -1;
                rafId = requestAnimationFrame(loop);
              })
              .catch(() => {
                if (tokenAtFail !== sessionToken) return;
                enterSimulation('Ocurrió un error al analizar la cámara. Usa la prueba sin cámara para continuar.');
              });
            return;
          }
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

    /* ---------- Overlay biomecánico y visual legible (#vision-canvas) ---------- */
    const POSE_UPPER_EDGES = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
      [11, 23], [12, 24], [23, 24]
    ];

    function drawUpperBodySkeleton(poseLandmarks, framing = 'optimo') {
      if (!overlayEnabled || !Array.isArray(poseLandmarks) || poseLandmarks.length < 17) return;
      const w = canvas.width;
      const h = canvas.height;
      const high = document.documentElement.getAttribute('data-contrast') === 'high';
      const warn = framing === 'muy_cerca' || framing === 'hombros_cortados';
      const vis = (pt) => (pt && typeof pt.visibility === 'number' ? pt.visibility : 1);

      const halo = high ? '#121820' : '#FFFFFF';
      const stroke = high ? '#F59E0B' : (warn ? '#D97706' : '#0284C7');
      const nodeFill = high ? '#FFFFFF' : (warn ? '#FEF3C7' : '#38BDF8');

      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const drawSegmentList = (color, lineW) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        ctx.beginPath();

        // Línea cervical: cabeza/nariz [0] -> centro de hombros [11, 12]
        const nose = poseLandmarks[0];
        const ls = poseLandmarks[11];
        const rs = poseLandmarks[12];
        if (nose && ls && rs && vis(nose) >= 0.3 && vis(ls) >= 0.3 && vis(rs) >= 0.3) {
          ctx.moveTo(nose.x * w, nose.y * h);
          ctx.lineTo(((ls.x + rs.x) / 2) * w, ((ls.y + rs.y) / 2) * h);
        }

        POSE_UPPER_EDGES.forEach(([a, b]) => {
          const pa = poseLandmarks[a];
          const pb = poseLandmarks[b];
          if (!pa || !pb || vis(pa) < 0.28 || vis(pb) < 0.28) return;
          ctx.moveTo(pa.x * w, pa.y * h);
          ctx.lineTo(pb.x * w, pb.y * h);
        });
        ctx.stroke();
      };

      drawSegmentList(halo, 6);
      drawSegmentList(stroke, 3);

      [0, 11, 12, 13, 14, 15, 16, 23, 24].forEach((idx) => {
        const pt = poseLandmarks[idx];
        if (!pt || vis(pt) < 0.3) return;
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, idx === 0 ? 5.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = nodeFill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = halo;
        ctx.stroke();
      });
      ctx.restore();
    }

    function drawHandEnhanced(landmarks, anatomicalSide = 'Right', palm = null) {
      if (!overlayEnabled || !Array.isArray(landmarks) || landmarks.length < 21) return;
      const high = document.documentElement.getAttribute('data-contrast') === 'high';
      const isLeft = anatomicalSide === 'Left';
      const haloColor = high ? '#121820' : '#FFFFFF';
      const lineColor = high ? (isLeft ? '#FFFFFF' : '#F59E0B') : (isLeft ? '#15803D' : '#0F4C81');
      const dotColor = high ? (isLeft ? '#F59E0B' : '#FFFFFF') : (isLeft ? '#86EFAC' : '#F59E0B');

      const w = canvas.width;
      const h = canvas.height;
      ctx.save();
      [[haloColor, 7], [lineColor, 3.5]].forEach(([color, width]) => {
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
      ctx.lineWidth = 1.8;
      landmarks.forEach((p, idx) => {
        const radius = idx === 0 || idx === 4 || idx === 8 || idx === 20 ? 5 : 3.8;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // Indicador visual discreto de orientación de palma en centro de palma
      if (palm) {
        const cx = ((landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4) * w;
        const cy = ((landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4) * h;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        if (palm.orientation === 'frente') {
          ctx.fillStyle = lineColor;
          ctx.fill();
        } else {
          ctx.fillStyle = haloColor;
          ctx.fill();
        }
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = lineColor;
        ctx.stroke();

        if (palm.dir) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + palm.dir.dx * 16, cy + palm.dir.dy * 16);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = dotColor;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    function pushTrailPoint(primaryHand, now) {
      if (!Array.isArray(primaryHand) || primaryHand.length < 21) return;
      const pinkyUp =
        angleDeg(primaryHand[17], primaryHand[18], primaryHand[19]) > 142 &&
        angleDeg(primaryHand[13], primaryHand[14], primaryHand[15]) < 125;
      const indexUp =
        angleDeg(primaryHand[5], primaryHand[6], primaryHand[7]) > 142 &&
        angleDeg(primaryHand[9], primaryHand[10], primaryHand[11]) < 125;
      const trackedIdx = pinkyUp ? 20 : (indexUp ? 8 : 0);
      const pt = primaryHand[trackedIdx];
      if (!pt) return;

      if (trailPoints.length >= MAX_TRAIL_POINTS) trailPoints.shift();
      trailPoints.push({ x: pt.x * canvas.width, y: pt.y * canvas.height, t: now, idx: trackedIdx });
    }

    function drawMotionTrail() {
      if (!overlayEnabled || trailPoints.length < 3) return;
      let totalMove = 0;
      for (let i = 1; i < trailPoints.length; i += 1) {
        totalMove += Math.hypot(trailPoints[i].x - trailPoints[i - 1].x, trailPoints[i].y - trailPoints[i - 1].y);
      }
      if (totalMove < 12) return;

      const high = document.documentElement.getAttribute('data-contrast') === 'high';
      const trailColor = high ? '#F59E0B' : '#38BDF8';

      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < trailPoints.length; i += 1) {
        const frac = i / trailPoints.length;
        ctx.globalAlpha = 0.14 + frac * 0.72;
        ctx.strokeStyle = trailColor;
        ctx.lineWidth = 2 + frac * 4;
        ctx.beginPath();
        ctx.moveTo(trailPoints[i - 1].x, trailPoints[i - 1].y);
        ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
        ctx.stroke();
      }
      const tip = trailPoints[trailPoints.length - 1];
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = trailColor;
      ctx.fill();
      ctx.restore();
    }

    function drawHand(landmarks, handIndex = 0) {
      drawHandEnhanced(landmarks, handIndex > 0 ? 'Left' : 'Right', null);
    }

    function pushMotionFrame(landmarks, worldPts, spatial, aspect, now) {
      const wristX = landmarks[0].x * aspect;
      const wristY = landmarks[0].y;
      const palmSize = Math.hypot(landmarks[9].x * aspect - wristX, landmarks[9].y - wristY) || 1e-6;
      const wristZ =
        Array.isArray(worldPts) && worldPts[0]
          ? worldPts[0].z || 0
          : typeof landmarks[0].z === 'number'
            ? landmarks[0].z * aspect
            : 0;

      if (motionBuffer.length >= MOTION_WINDOW) motionBuffer.shift();
      motionBuffer.push({
        t: now,
        palmSize,
        wristX,
        wristY,
        z: wristZ,
        tipX: landmarks[8].x * aspect,
        tipY: landmarks[8].y,
        pinkyX: landmarks[20].x * aspect,
        pinkyY: landmarks[20].y,
        zone: spatial ? spatial.zone : 'espacio_neutro'
      });
    }

    function formatTop2Text(label1, prob1, label2 = '', prob2 = 0) {
      const p1 = Math.round((prob1 || 0) * 100);
      const p2 = Math.round((prob2 || 0) * 100);
      if (label2 && p2 >= 5) {
        return `Enfoque: “${label1}” (${p1}%) · sig: “${label2}” (${p2}%)`;
      }
      return `Enfoque: “${label1}” (${p1}%)`;
    }

    /**
     * Prioridad 2 · Vocabulario Dinámico (118 señas · ./models/senas_dinamicas/).
     * Alimenta [1, 30, 159] con landmarks suavizados y evalúa sin bloqueo (outTensor.data()).
     */
    function evaluateDynamicWordsTf(results, now, handCount, bio, options = {}) {
      const dynEntry = tfModels && tfModels.dynamic;
      if (!dynEntry || !dynEntry.model || !window.tf) return;

      const { pauseWordDispatch = false } = options;
      const meta = dynEntry.metadata || {};
      const seqLen = meta.sequenceLength || DYNAMIC_SEQ_LEN;
      const numFeat = meta.numFeatures || DYNAMIC_NUM_FEATURES;
      const threshold = typeof meta.confidenceThreshold === 'number' ? meta.confidenceThreshold : 0.7;
      const labels = Array.isArray(meta.labels) ? meta.labels : [];
      const spellPossible = Boolean(tfModels && tfModels.alphabet && handCount === 1 && bio.activity === 'estatico');

      const vec = extractDynamicFrameFeatures(smoothedPoseLandmarks || latestPoseLandmarks, results);
      if (dynamicSeqBuffer.length >= seqLen) dynamicSeqBuffer.shift();
      dynamicSeqBuffer.push(vec);

      if (pauseWordDispatch) {
        resetDynamicCandidate();
        return;
      }

      if (dynamicSeqBuffer.length < seqLen) {
        if (!spellPossible || (!spellCandidate.label && handCount >= 2)) {
          setProgress((dynamicSeqBuffer.length / seqLen) * 0.4);
          if (progressLabel) {
            progressLabel.textContent = `Analizando contexto LSP (${dynamicSeqBuffer.length}/${seqLen})…`;
          }
        }
        return;
      }

      if (isDynamicInferring) return;
      dynamicEvalCounter += 1;
      const evalStride = dynCandidate.streak > 0 ? 2 : 3;
      if (dynamicEvalCounter % evalStride !== 0) return;

      const tokenAtCall = sessionToken;
      isDynamicInferring = true;

      const total = seqLen * numFeat;
      const flat = total === dynamicFlatInput.length ? dynamicFlatInput : new Float32Array(total);
      for (let t = 0; t < seqLen; t += 1) {
        flat.set(dynamicSeqBuffer[t], t * numFeat);
      }

      let outTensor = null;
      try {
        outTensor = window.tf.tidy(() => {
          const input = window.tf.tensor3d(flat, [1, seqLen, numFeat], 'float32');
          const out = dynEntry.model.predict(input);
          return Array.isArray(out) ? out[0] : out;
        });
      } catch (err) {
        isDynamicInferring = false;
        console.warn('[Cámara IA · Dinámico]', err);
        return;
      }

      outTensor
        .data()
        .then((probs) => {
          if (tokenAtCall !== sessionToken || !running) return;
          const evalNow = performance.now();

          let rawBestIdx = -1;
          let rawBestProb = -1;
          let bestIdx = -1;
          let bestProb = -1;
          let secondIdx = -1;
          let secondProb = -1;

          for (let i = 0; i < probs.length; i += 1) {
            const p = probs[i];
            if (p > rawBestProb) {
              rawBestProb = p;
              rawBestIdx = i;
            }
            const lbl = labels[i];
            if (lbl && !IGNORED_GLOSSES.has(lbl)) {
              if (p > bestProb) {
                secondProb = bestProb;
                secondIdx = bestIdx;
                bestProb = p;
                bestIdx = i;
              } else if (p > secondProb) {
                secondProb = p;
                secondIdx = i;
              }
            }
          }

          const topRawLabel = rawBestIdx >= 0 ? labels[rawBestIdx] : '';
          const gloss = bestIdx >= 0 ? labels[bestIdx] : '';
          const word = humanizeGloss(gloss);
          const secondWord = secondIdx >= 0 ? humanizeGloss(labels[secondIdx]) : '';

          if (word && (!spellPossible || bestProb >= 0.4)) {
            updateHud(
              { top2Text: formatTop2Text(word, bestProb, secondWord, secondProb) },
              evalNow
            );
          }

          if (IGNORED_GLOSSES.has(topRawLabel) || !word || bestProb < threshold) {
            resetDynamicCandidate();
            if (!spellPossible) {
              setProgress(0);
              if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
            }
            return;
          }

          const pct = Math.round(bestProb * 100);
          if (dynCandidate.id === gloss) {
            dynCandidate.streak += 1;
            dynCandidate.lastProb = bestProb;
          } else {
            dynCandidate.id = gloss;
            dynCandidate.streak = 1;
            dynCandidate.lastProb = bestProb;
            dynCandidate.since = evalNow;
          }

          setProgress(Math.min(1, 0.45 + (dynCandidate.streak / DYNAMIC_STREAK_REQUIRED) * 0.55));
          if (progressLabel) progressLabel.textContent = `Confirmando seña: ${word}…`;
          lastDetectEl.textContent = `Seña detectada: ${word} · Confianza: ${pct}%`;

          latestDescriptorSnapshot = Object.freeze({
            level: visionEngine ? visionEngine.level : 2,
            source: 'dynamic_118',
            gestureId: `dyn:${gloss}`,
            gloss,
            word,
            confidence: bestProb,
            timestamp: evalNow
          });

          if (dynCandidate.streak >= DYNAMIC_STREAK_REQUIRED) {
            const tokenId = `dyn:${gloss}`;
            const last = lastAddedAt[tokenId];
            if (typeof last !== 'number' || evalNow - last >= COOLDOWN_MS) {
              lastAddedAt[tokenId] = evalNow;
              const confirmedToken = { id: tokenId, kind: 'word', text: word, phrase: word, label: word };
              lastConfirmed = confirmedToken;
              sentenceTokens.push({ id: tokenId, kind: 'word', text: word });
              lastDetectEl.textContent = `Última seña: ${word} · Confianza: ${pct}%`;
              renderSentence();
              sentNote.textContent = 'Pausa ~6 s sin manos para enviar o pulsa “Enviar y leer al funcionario”.';
              sentNote.hidden = false;
            }
            dynamicSeqBuffer.splice(0, 12);
            resetDynamicCandidate();
            resetSpellCandidate();
            resetTrajectory();
            spellTrackBuffer.length = 0;
          }
        })
        .catch((err) => {
          console.warn('[Cámara IA · Dinámico]', err);
        })
        .finally(() => {
          isDynamicInferring = false;
          if (outTensor && typeof outTensor.dispose === 'function') {
            outTensor.dispose();
          }
        });
    }

    function feedSpellLetter(label, score, now) {
      if (label && label === spellCandidate.label) {
        spellCandidate.lastSeen = now;
        spellCandidate.scoreSum += score;
        spellCandidate.scoreN += 1;
      } else if (spellCandidate.label && now - spellCandidate.lastSeen < GRACE_MS) {
        // Mantiene progreso ante micro-parpadeos
      } else {
        spellCandidate.label = label;
        spellCandidate.since = now;
        spellCandidate.lastSeen = now;
        spellCandidate.confirmed = false;
        spellCandidate.scoreSum = label ? score : 0;
        spellCandidate.scoreN = label ? 1 : 0;
      }

      if (!spellCandidate.label) {
        setProgress(0);
        if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
        return;
      }

      const displayChar = spellCandidate.label === SPACE_TOKEN_LABEL ? 'Espacio' : `Letra ${spellCandidate.label}`;
      const avgProb = spellCandidate.scoreN ? spellCandidate.scoreSum / spellCandidate.scoreN : score;
      const pct = Math.round(avgProb * 100);
      const progress = Math.min(1, (now - spellCandidate.since) / CONFIRM_SPELL_MS);
      setProgress(progress);

      if (progressLabel) progressLabel.textContent = `Estabilizando: ${displayChar} (${CONFIRM_SPELL_MS} ms)`;
      lastDetectEl.textContent = `Deletreo en vivo: ${displayChar} · Confianza: ${pct}%`;

      if (progress >= 1 && !spellCandidate.confirmed) {
        spellCandidate.confirmed = true;
        const isSpace = spellCandidate.label === SPACE_TOKEN_LABEL;
        const tokenId = `spell:${spellCandidate.label}`;
        const last = lastAddedAt[tokenId];
        const canSpace =
          !isSpace || (sentenceTokens.length > 0 && sentenceTokens[sentenceTokens.length - 1].kind !== 'space');

        if (canSpace && (typeof last !== 'number' || now - last >= SPELL_COOLDOWN_MS)) {
          lastAddedAt[tokenId] = now;
          lastLetterConfirmedAt = now;
          const token = {
            id: tokenId,
            kind: isSpace ? 'space' : 'letter',
            text: isSpace ? ' ' : spellCandidate.label,
            label: displayChar
          };
          lastConfirmed = token;
          sentenceTokens.push({ id: token.id, kind: token.kind, text: token.text });
          renderSentence();
          lastDetectEl.textContent = `Última letra: ${displayChar} · Confianza: ${pct}%`;
          sentNote.textContent = 'Letra confirmada. Sigue deletreando, pulsa “Espacio” o “Enviar y leer al funcionario”.';
          sentNote.hidden = false;
          resetDynamicCandidate();
        }
      }
    }

    /** Etiqueta del modelo -> texto legible para el HUD (ESPACIO -> Espacio). */
    function displaySpellLabel(label) {
      return label === STATIC_SPACE_LABEL || label === '' ? 'Espacio' : label;
    }

    /**
     * Cebado del buffer de la Micro-GRU y avance de un frame: mantiene 16 frames [dx, dy, dz de muñeca,
     * índice y meñique + normal de palma]. Al aparecer la mano se rellena con velocidades 0.
     */
    function pushTrajectoryFrame(rawHand, side, aspect, palmNormal) {
      const cur = rawHand.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
      if (!prevTrajLandmarks) {
        const zeroFrame = extractTrajectoryFrame(null, cur, side, aspect, palmNormal);
        if (!zeroFrame) return;
        trajectoryBuffer.length = 0;
        for (let i = 0; i < TRAJ_SEQ_LEN - 1; i += 1) trajectoryBuffer.push(zeroFrame);
        prevTrajLandmarks = cur;
      }
      const frame = extractTrajectoryFrame(prevTrajLandmarks, cur, side, aspect, palmNormal);
      prevTrajLandmarks = cur;
      if (!frame) return;
      if (trajectoryBuffer.length >= TRAJ_SEQ_LEN) trajectoryBuffer.shift();
      trajectoryBuffer.push(frame);
    }

    /** Emite al instante una letra dinámica (J, Ñ, Z) predicha por la Micro-GRU y reinicia el buffer de deletreo. */
    function emitDynamicLetter(label, score, now) {
      const pct = Math.round(score * 100);
      const tokenId = `spell:${label}`;
      lastDynamicEmitAt = now;
      lastLetterConfirmedAt = now;
      lastAddedAt[tokenId] = now;

      lastConfirmed = { id: tokenId, kind: 'letter', text: label, label: `Letra ${label}` };
      sentenceTokens.push({ id: tokenId, kind: 'letter', text: label });
      renderSentence();
      lastDetectEl.textContent = `Última letra: Letra ${label} · Confianza: ${pct}%`;
      sentNote.textContent = 'Letra con trazo confirmada. Sigue deletreando, pulsa “Espacio” o “Enviar y leer al funcionario”.';
      sentNote.hidden = false;
      updateHud({ top2Text: formatTop2Text(label, score) }, now);

      latestDescriptorSnapshot = Object.freeze({
        level: visionEngine ? visionEngine.level : 2,
        source: 'alphabet_trajectory_gru',
        gestureId: tokenId,
        confidence: score,
        timestamp: now
      });

      resetDynamicCandidate();
      resetSpellCandidate();
      spellTrackBuffer.length = 0;
      dynamicSeqBuffer.length = 0;
      resetTrajectory();
      setProgress(0);
      if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
    }

    /**
     * Micro-GRU dinámica (./models/alfabeto_dinamico_3d/): secuencia estandarizada [1, 16, 12].
     * Si predice J, Ñ o Z con confianza >= umbral (0.78) emite esa letra; si predice ESTATICA,
     * el modelo estático 90D puede confirmar la letra sostenida.
     */
    function evaluateTrajectoryGru() {
      const entry = tfModels && tfModels.trajectory;
      if (!entry || !entry.model || !window.tf || isTrajectoryInferring) return;
      if (trajectoryBuffer.length < TRAJ_SEQ_LEN) return;

      const meta = entry.metadata || {};
      const labels = Array.isArray(meta.labels) ? meta.labels : [];
      const threshold = typeof meta.confidenceThreshold === 'number' ? meta.confidenceThreshold : 0.78;
      const flat = standardizeTrajectorySequence(trajectoryBuffer, meta.scalerMean, meta.scalerStd);
      const tokenAtCall = sessionToken;
      const epochAtCall = trajEpoch;
      isTrajectoryInferring = true;

      let outTensor = null;
      try {
        outTensor = window.tf.tidy(() => {
          const input = window.tf.tensor3d(flat, [1, TRAJ_SEQ_LEN, TRAJ_NUM_FEATURES], 'float32');
          const out = entry.model.predict(input);
          return Array.isArray(out) ? out[0] : out;
        });
      } catch (err) {
        isTrajectoryInferring = false;
        console.warn('[Cámara IA · Trayectorias]', err);
        return;
      }

      outTensor
        .data()
        .then((probs) => {
          if (tokenAtCall !== sessionToken || epochAtCall !== trajEpoch || !running) return;
          let bestIdx = 0;
          let bestProb = -1;
          for (let i = 0; i < probs.length; i += 1) {
            if (probs[i] > bestProb) {
              bestProb = probs[i];
              bestIdx = i;
            }
          }
          const label = bestIdx < labels.length ? labels[bestIdx] : TRAJ_STATIC_LABEL;
          const evalNow = performance.now();
          trajectoryState.label = label;
          trajectoryState.prob = bestProb;
          trajectoryState.at = evalNow;

          if (
            TRAJ_DYNAMIC_LABELS.has(label) &&
            bestProb >= threshold &&
            evalNow - lastDynamicEmitAt >= DYNAMIC_EMIT_LOCK_MS
          ) {
            emitDynamicLetter(label, bestProb, evalNow);
          }
        })
        .catch((err) => {
          console.warn('[Cámara IA · Trayectorias]', err);
        })
        .finally(() => {
          isTrajectoryInferring = false;
          if (outTensor && typeof outTensor.dispose === 'function') {
            outTensor.dispose();
          }
        });
    }

    /**
     * Prioridad 3 · Alfabeto estático 3D (./models/alfabeto_lsp_3d/): MLP sobre el vector 90D canónico
     * estandarizado [1, 90]. Solo confirma la letra sostenida cuando la Micro-GRU reporta ESTATICA.
     */
    function evaluateAlphabetTf(raw90, now) {
      const alphaEntry = tfModels && tfModels.alphabet;
      if (!alphaEntry || !alphaEntry.model || !window.tf || isAlphabetInferring) return;

      const meta = alphaEntry.metadata || {};
      const threshold = typeof meta.confidenceThreshold === 'number' ? meta.confidenceThreshold : 0.72;
      const labels = Array.isArray(meta.labels) ? meta.labels : [];
      const features = standardizeFeatures(raw90, meta.scalerMean, meta.scalerStd);
      const tokenAtCall = sessionToken;
      const epochAtCall = trajEpoch;
      isAlphabetInferring = true;

      let outTensor = null;
      try {
        outTensor = window.tf.tidy(() => {
          const input = window.tf.tensor2d(features, [1, HAND_FEATURES_90], 'float32');
          const out = alphaEntry.model.predict(input);
          return Array.isArray(out) ? out[0] : out;
        });
      } catch (err) {
        isAlphabetInferring = false;
        console.warn('[Cámara IA · Alfabeto 3D]', err);
        return;
      }

      outTensor
        .data()
        .then((probs) => {
          if (tokenAtCall !== sessionToken || epochAtCall !== trajEpoch || !running || dynCandidate.streak > 0) return;
          const evalNow = performance.now();

          let bestIdx = 0;
          let bestProb = -1;
          let secondIdx = -1;
          let secondProb = -1;
          for (let i = 0; i < probs.length; i += 1) {
            const p = probs[i];
            if (p > bestProb) {
              secondProb = bestProb;
              secondIdx = bestIdx;
              bestProb = p;
              bestIdx = i;
            } else if (p > secondProb) {
              secondProb = p;
              secondIdx = i;
            }
          }

          const rawLabel = bestIdx < labels.length ? labels[bestIdx] : '';
          const secondLabelRaw = secondIdx >= 0 && secondIdx < labels.length ? labels[secondIdx] : '';

          const gruModelLoaded = Boolean(tfModels && tfModels.trajectory);
          const gruFresh = trajectoryState.at > 0 && evalNow - trajectoryState.at <= TRAJ_STATE_MAX_AGE_MS;
          const staticAllowed =
            !gruModelLoaded ||
            (gruFresh &&
              trajectoryState.label === TRAJ_STATIC_LABEL &&
              evalNow - lastDynamicEmitAt >= DYNAMIC_EMIT_LOCK_MS);

          let resolvedLabel = null;
          let resolvedScore = 0;
          if (staticAllowed && bestProb >= threshold) {
            if (rawLabel === STATIC_SPACE_LABEL || rawLabel === '') {
              const canInsertSpace =
                sentenceTokens.length > 0 && sentenceTokens[sentenceTokens.length - 1].kind !== 'space';
              if (canInsertSpace) {
                resolvedLabel = SPACE_TOKEN_LABEL;
                resolvedScore = bestProb;
              }
            } else {
              resolvedLabel = rawLabel;
              resolvedScore = bestProb;
            }
          }

          updateHud(
            {
              top2Text: formatTop2Text(
                displaySpellLabel(rawLabel),
                bestProb,
                displaySpellLabel(secondLabelRaw),
                secondProb
              )
            },
            evalNow
          );

          latestDescriptorSnapshot = Object.freeze({
            level: visionEngine ? visionEngine.level : 2,
            source: 'alphabet_lsp_3d',
            gestureId: resolvedLabel ? `spell:${resolvedLabel}` : null,
            trajectory: trajectoryState.label,
            confidence: resolvedScore || bestProb,
            timestamp: evalNow
          });

          feedSpellLetter(resolvedLabel, resolvedScore, evalNow);
        })
        .catch((err) => {
          console.warn('[Cámara IA · Alfabeto 3D]', err);
        })
        .finally(() => {
          isAlphabetInferring = false;
          if (outTensor && typeof outTensor.dispose === 'function') {
            outTensor.dispose();
          }
        });
    }

    function handleResults(results, now = performance.now()) {
      if (!running || !results) return;
      clearCanvas();
      const rawLandmarks = Array.isArray(results.landmarks) ? results.landmarks : [];
      const allWorldLandmarks = Array.isArray(results.worldLandmarks) ? results.worldLandmarks : [];
      const allHandedness = Array.isArray(results.handedness) ? results.handedness : [];
      const aspect = canvas.width / canvas.height;
      const poseForFrame = smoothedPoseLandmarks || latestPoseLandmarks;

      updateHandsCount(rawLandmarks.length);

      if (rawLandmarks.length === 0) {
        missingHandFrames += 1;
        const bioNoHands = analyzeBiomechanics(poseForFrame, [], true, aspect);
        drawUpperBodySkeleton(poseForFrame, bioNoHands.framing);
        updateHud(
          {
            framingText: bioNoHands.framingLabel,
            framingTone: bioNoHands.framingTone,
            activityText: 'En reposo',
            activityTone: 'idle',
            top2Text: missingHandFrames > HAND_DROPOUT_GRACE_FRAMES ? 'Enfoque: esperando seña…' : undefined
          },
          now
        );

        if (missingHandFrames <= HAND_DROPOUT_GRACE_FRAMES) {
          drawMotionTrail();
          return;
        }

        smoothedHandSlots.Left = null;
        smoothedHandSlots.Right = null;
        smoothedWorldSlots.Left = null;
        smoothedWorldSlots.Right = null;
        trailPoints.length = 0;
        wristMacroBuffer.length = 0;
        motionBuffer.length = 0;
        voteBuffer.length = 0;
        dynamicSeqBuffer.length = 0;
        spellTrackBuffer.length = 0;
        resetDynamicCandidate();
        resetSpellCandidate();
        resetTrajectory();
        prevPalmOrientation = null;
        feedGesture(null, 0, now);
        if (sentenceTokens.length > 0) {
          const hasSpelledLetters = sentenceTokens.some((t) => t.kind === 'letter' || t.kind === 'space');
          if (hasSpelledLetters) {
            handsDownSince = null;
            sentNote.textContent = 'Pausa en deletreo: tus letras se conservan. Usa “Espacio” o “Enviar y leer al funcionario” cuando termines.';
            sentNote.hidden = false;
          } else {
            if (handsDownSince === null) handsDownSince = now;
            const elapsed = now - handsDownSince;
            const remainingSec = Math.max(1, Math.ceil((AUTO_SEND_PAUSE_MS - elapsed) / 1000));
            sentNote.textContent = `Enviando en ${remainingSec} s… Levanta la mano para continuar o pulsa “Enviar y leer al funcionario”.`;
            sentNote.hidden = false;
            if (elapsed >= AUTO_SEND_PAUSE_MS) {
              sendSentence({ auto: true });
            }
          }
        }
        return;
      }

      missingHandFrames = 0;
      if (handsDownSince !== null) {
        handsDownSince = null;
        if (sentenceTokens.length > 0) {
          sentNote.textContent = 'Mano detectada: continuando la oración.';
          sentNote.hidden = false;
        }
      }

      // Suavizado EMA temporal por ranura anatómica (Left / Right) manteniendo correspondencia
      const assigned = assignAnatomicalHands(rawLandmarks, allHandedness, poseForFrame);
      smoothedHandSlots.Left = assigned.Left
        ? smoothLandmarksEMA(smoothedHandSlots.Left, assigned.Left, HAND_EMA_ALPHA)
        : null;
      smoothedHandSlots.Right = assigned.Right
        ? smoothLandmarksEMA(smoothedHandSlots.Right, assigned.Right, HAND_EMA_ALPHA)
        : null;

      if (rawLandmarks.length === 1 && Array.isArray(allWorldLandmarks[0]) && allWorldLandmarks[0].length >= 21) {
        const primaryWorldSide = assigned.Right ? 'Right' : 'Left';
        const otherSide = primaryWorldSide === 'Right' ? 'Left' : 'Right';
        smoothedWorldSlots[primaryWorldSide] = smoothLandmarksEMA(
          smoothedWorldSlots[primaryWorldSide],
          allWorldLandmarks[0],
          HAND_EMA_ALPHA,
          0.5
        );
        smoothedWorldSlots[otherSide] = null;
      } else {
        smoothedWorldSlots.Left = null;
        smoothedWorldSlots.Right = null;
      }

      const smoothedHands = [];
      const smoothedHandedness = [];
      ['Right', 'Left'].forEach((side) => {
        if (smoothedHandSlots[side]) {
          smoothedHands.push(smoothedHandSlots[side]);
          // Preserva convención cruda (invertida respecto al cuerpo en cámara sin espejo)
          smoothedHandedness.push([{ categoryName: side === 'Left' ? 'Right' : 'Left', score: 0.92 }]);
        }
      });

      const handsForFrame = smoothedHands.length ? smoothedHands : rawLandmarks;
      if (handsForFrame.length === 1) {
        const h0 = handsForFrame[0];
        const h0Aspect = h0.map((p) => ({ x: p.x * aspect, y: p.y }));
        const palm0 = Math.hypot(h0Aspect[9].x - h0Aspect[0].x, h0Aspect[9].y - h0Aspect[0].y) || 0.1;
        if (spellTrackBuffer.length >= 6) spellTrackBuffer.shift();
        spellTrackBuffer.push({ palmSize: palm0, landmarks: h0Aspect });
      }
      const quickSteady = isWristSteady(spellTrackBuffer, 5);
      const bio = analyzeBiomechanics(poseForFrame, handsForFrame, quickSteady, aspect);

      pushTrailPoint(handsForFrame[0], now);
      drawUpperBodySkeleton(poseForFrame, bio.framing);
      drawMotionTrail();

      handsForFrame.forEach((lm, idx) => {
        const side = smoothedHandSlots.Right && idx === 0 ? 'Right' : 'Left';
        const palm = computePalmOrientation3D(
          lm.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect })),
          side
        );
        drawHandEnhanced(lm, side, palm);
      });

      const activeTf = tfModels || loadedTfModels;
      if (activeTf && (activeTf.dynamic || activeTf.alphabet || activeTf.trajectory)) {
        tfModels = activeTf;

        // Prioridad 1 (Emergencia): detección ILY ligera sin ejecutar el clasificador geométrico completo
        let ilyDetected = false;
        for (let i = 0; i < rawLandmarks.length; i += 1) {
          if (detectIlyEmergency(handsForFrame[i] || rawLandmarks[i], allWorldLandmarks[i] || null, aspect)) {
            ilyDetected = true;
            break;
          }
        }
        if (ilyDetected) {
          updateHud(
            {
              framingText: bio.framingLabel,
              framingTone: bio.framingTone,
              activityText: 'Prioridad urgente',
              activityTone: 'urgent',
              top2Text: 'Enfoque: “Auxilio (Emergencia)”'
            },
            now
          );
          feedGesture('auxilio', 0.94, now, { fastConfirm: true, meta: null });
          return;
        }
        if (detection.id === 'auxilio') {
          feedGesture(null, 0, now);
        }

        // Smart Gating biomecánico: ignora manos descansando abajo fuera de zona de señado
        if (bio.activity === 'reposo') {
          resetDynamicCandidate();
          resetSpellCandidate();
          resetTrajectory();
          setProgress(0);
          if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
          updateHud(
            {
              framingText: bio.framingLabel,
              framingTone: bio.framingTone,
              activityText: 'En reposo',
              activityTone: 'idle',
              top2Text: 'Enfoque: manos en reposo'
            },
            now
          );
          return;
        }

        let spellingSessionActive = false;
        if (handsForFrame.length >= 2) {
          lastLetterConfirmedAt = 0;
          wristMacroBuffer.length = 0;
          resetTrajectory();
          if (spellCandidate.label || spellTrackBuffer.length > 0) {
            resetSpellCandidate();
            spellTrackBuffer.length = 0;
          }
        } else {
          const h0 = handsForFrame[0];
          const palmSize0 =
            Math.hypot((h0[9].x - h0[0].x) * aspect, h0[9].y - h0[0].y) || 0.1;
          if (wristMacroBuffer.length >= MAX_WRIST_MACRO) wristMacroBuffer.shift();
          wristMacroBuffer.push({
            x: h0[0].x,
            y: h0[0].y,
            palmSize: palmSize0,
            elbowDeg: bio.rightElbowDeg !== null ? bio.rightElbowDeg : bio.leftElbowDeg
          });
          const wideArmMotion = detectWideArmMotion(wristMacroBuffer);
          if (wideArmMotion) lastLetterConfirmedAt = 0;
          const recentSpell = lastLetterConfirmedAt > 0 && now - lastLetterConfirmedAt <= SPELL_SESSION_HOLD_MS;
          const steadySingleHand = bio.activity === 'estatico' || quickSteady || Boolean(spellCandidate.label);
          spellingSessionActive = !wideArmMotion && (recentSpell || steadySingleHand);
          if (spellingSessionActive && dynCandidate.streak > 0) {
            resetDynamicCandidate();
          }
        }

        updateHud(
          {
            framingText: bio.framingLabel,
            framingTone: bio.framingTone,
            activityText: spellingSessionActive ? 'Deletreo activo' : 'Escuchando seña',
            activityTone: spellingSessionActive ? 'spell' : 'active'
          },
          now
        );

        const smoothedResults = { landmarks: handsForFrame, handedness: smoothedHandedness };
        // Prioridad 2 (Vocabulario dinámico · 118 señas) + Prioridad 3 (Micro-GRU trayectorias + MLP 90D)
        evaluateDynamicWordsTf(smoothedResults, now, handsForFrame.length, bio, {
          pauseWordDispatch: spellingSessionActive
        });
        if (handsForFrame.length === 1 && dynCandidate.streak === 0 && (activeTf.alphabet || activeTf.trajectory)) {
          const primarySide = smoothedHandSlots.Right ? 'Right' : 'Left';
          const worldFor90 =
            smoothedWorldSlots[primarySide] ||
            handsForFrame[0].map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect }));
          const raw90 = extractHand90Features(worldFor90, primarySide);
          const palmNormal3d = [raw90[78], raw90[79], raw90[80]];
          if (activeTf.trajectory) {
            pushTrajectoryFrame(handsForFrame[0], primarySide, aspect, palmNormal3d);
            evaluateTrajectoryGru();
          }
          if (activeTf.alphabet) {
            evaluateAlphabetTf(raw90, now);
          }
        }
        return;
      }

      // Respaldo geométrico estricto (7 parámetros LSP) SOLO cuando TF.js no está disponible
      const spatial = computeSpatialContext(handsForFrame[0], allWorldLandmarks[0] || null, poseForFrame, handsForFrame);
      const nonManual = analyzeNonManualExpressions(latestFaceBlendshapes, latestFaceLandmarks);

      pushMotionFrame(handsForFrame[0], allWorldLandmarks[0] || null, spatial, aspect, now);
      const trajectory = analyzeTrajectory3D(motionBuffer);

      const handEntries = [];
      handsForFrame.forEach((landmarks, idx) => {
        const worldPts = allWorldLandmarks[idx] || null;
        const handedEntry = allHandedness[idx] && allHandedness[idx][0];
        const handedLabel = normalizeHandedness(handedEntry);
        const score = handedEntry && typeof handedEntry.score === 'number' ? handedEntry.score : 0.9;
        const palm = computePalmOrientation3D(worldPts || landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect })), handedLabel);
        const { id: staticId } = classifyHand(landmarks, aspect, worldPts, {
          handedness: handedLabel,
          palmOrientation: palm
        });
        handEntries.push({ id: staticId, score, palm });
      });

      const resolved = resolveMultiHandGesture(handEntries, detection.id, { spatial, nonManual, trajectory });

      const primaryPalm = (handEntries[0] && handEntries[0].palm) || null;
      const palmOrientation = primaryPalm ? primaryPalm.orientation : 'frente';
      const palmChanged = prevPalmOrientation && prevPalmOrientation !== palmOrientation;
      const palmText = palmChanged
        ? `${PALM_LABEL[prevPalmOrientation] || prevPalmOrientation}→${PALM_LABEL[palmOrientation] || palmOrientation}`
        : PALM_LABEL[palmOrientation] || 'Frente';
      if (!prevPalmOrientation || trajectory.type === 'quieto') {
        prevPalmOrientation = palmOrientation;
      }

      const frameMeta = {
        level: visionEngine ? visionEngine.level : 2,
        palm: primaryPalm,
        palmText,
        spatial,
        nonManual,
        trajectory
      };

      if (resolved && resolved.id === 'auxilio') {
        feedGesture('auxilio', resolved.score, now, { fastConfirm: true, meta: frameMeta });
        return;
      }

      if (voteBuffer.length >= VOTE_WINDOW) voteBuffer.shift();
      voteBuffer.push(resolved ? { id: resolved.id, score: resolved.score } : { id: null, score: 0 });
      const smoothed = majorityVoteGesture(voteBuffer);

      const fallbackGesture = smoothed.id && GESTURE_BY_ID[smoothed.id];
      updateHud(
        {
          framingText: bio.framingLabel,
          framingTone: bio.framingTone,
          activityText: fallbackGesture ? (fallbackGesture.kind === 'letter' ? 'Leyendo letra' : 'Escuchando seña') : 'En reposo',
          activityTone: fallbackGesture ? 'active' : 'idle',
          top2Text: fallbackGesture ? formatTop2Text(fallbackGesture.label, smoothed.score || 0.9) : 'Enfoque: esperando seña…'
        },
        now
      );

      latestDescriptorSnapshot = Object.freeze({
        level: frameMeta.level,
        source: 'geometric_fallback',
        gestureId: smoothed.id,
        palm: primaryPalm,
        spatial,
        nonManual,
        trajectory,
        confidence: smoothed.score,
        timestamp: now
      });

      const fastConfirm = resolved && resolved.id === 'palma' && trajectory.type === 'oscilacion_h';
      feedGesture(smoothed.id, smoothed.score, now, { fastConfirm, meta: frameMeta });
    }

    function feedGesture(id, score, now, { fastConfirm = false, meta = null } = {}) {
      if (id && id === detection.id) {
        detection.lastSeen = now;
        detection.scoreSum += score;
        detection.scoreN += 1;
        if (meta) detection.meta = meta;
      } else if (detection.id && now - detection.lastSeen < GRACE_MS) {
        // Tolera micro-cortes sin reiniciar temporizador
      } else {
        detection.id = id;
        detection.since = now;
        detection.lastSeen = now;
        detection.confirmed = false;
        detection.scoreSum = id ? score : 0;
        detection.scoreN = id ? 1 : 0;
        detection.meta = meta;
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
      if (fastConfirm || detection.id === 'auxilio') targetMs = CONFIRM_FAST_MS;
      else if (detection.id === 'indice') targetMs = CONFIRM_INDEX_MS;
      const progress = Math.min(1, (now - detection.since) / targetMs);
      setProgress(progress);

      if (progress >= 1 && !detection.confirmed) {
        detection.confirmed = true;
        const avg = detection.scoreN ? detection.scoreSum / detection.scoreN : 0.9;
        confirmGesture(detection.id, Math.round(avg * 100), 'camera', detection.meta);
      }
    }

    function formatLastDetectLine(gesture, confidencePct, source, meta) {
      const isSimulated = source === 'simulation';
      if (isSimulated || !meta) {
        return `Última seña: ${gesture.label} · Confianza: ${confidencePct}%${isSimulated ? ' (simulada)' : ''}`;
      }
      const zoneText = (meta.spatial && ZONE_LABEL[meta.spatial.zone]) || 'Neutro';
      const exprCode = meta.nonManual ? meta.nonManual.expression : 'neutro';
      const exprTag = EXPRESSION_LABEL[exprCode] ? ` · Modo: ${EXPRESSION_LABEL[exprCode]}` : '';
      return `Última seña: ${gesture.label} · Palma: ${meta.palmText} · Zona: ${zoneText} · Confianza: ${confidencePct}%${exprTag}`;
    }

    /** Flujo único (cámara y prueba): encadena la seña e integra expresión no manual en la oración. */
    function confirmGesture(id, confidencePct, source, meta = null) {
      const gesture = GESTURE_BY_ID[id];
      if (!gesture) return;
      lastConfirmed = gesture;

      const isSimulated = source === 'simulation';
      if (meta && meta.nonManual && meta.nonManual.expression && meta.nonManual.expression !== 'neutro') {
        activeSentenceExpression = meta.nonManual.expression;
      }

      lastDetectEl.textContent = formatLastDetectLine(gesture, confidencePct, source, meta);
      setUrgent(Boolean(gesture.urgent));

      const now = performance.now();
      const last = lastAddedAt[id];
      const canAdd = isSimulated || typeof last !== 'number' || now - last >= COOLDOWN_MS;
      if (canAdd) {
        lastAddedAt[id] = now;
        const isLetter = gesture.kind === 'letter';
        const isSpace = gesture.kind === 'space';
        sentenceTokens.push({
          id,
          kind: isSpace ? 'space' : (isLetter ? 'letter' : 'word'),
          text: isSpace ? ' ' : (isLetter ? gesture.letter : gesture.phrase)
        });
        renderSentence();
        sentNote.textContent = isSimulated
          ? 'Pulsa “Enviar y leer al funcionario” cuando la oración esté lista.'
          : (isLetter || isSpace)
            ? 'Letra añadida. Sigue deletreando, pulsa “Espacio” o “Enviar y leer al funcionario”.'
            : 'Baja las manos ~6 s para enviar o pulsa “Enviar y leer al funcionario”.';
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

    function sendSentence({ auto = false } = {}) {
      if (sentenceTokens.length === 0) return;
      const text = composeSentence(sentenceTokens, activeSentenceExpression);
      sentenceTokens = [];
      activeSentenceExpression = 'neutro';
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

    function insertSpace() {
      if (sentenceTokens.length === 0 || sentenceTokens[sentenceTokens.length - 1].kind === 'space') return;
      sentenceTokens.push({ id: `spell:${SPACE_TOKEN_LABEL}`, kind: 'space', text: ' ' });
      lastLetterConfirmedAt = performance.now();
      resetSpellCandidate();
      resetTrajectory();
      renderSentence();
      sentNote.textContent = 'Espacio insertado. Continúa deletreando la siguiente palabra.';
      sentNote.hidden = false;
    }

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

    function clearAllOutput() {
      resetOutput();
      dynamicSeqBuffer.length = 0;
      spellTrackBuffer.length = 0;
      resetDynamicCandidate();
      resetSpellCandidate();
      resetTrajectory();
      sentNote.textContent = 'Texto borrado. Listo para una nueva seña o deletreo.';
      sentNote.hidden = false;
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

    /* ---------- Cuadrícula de prueba sin cámara (A–Z + Ñ) y guía neuronal limpia ---------- */
    const NEURAL_GUIDE_ITEMS = [
      {
        emoji: '\u{1F91F}',
        title: 'Emergencia inmediata (Auxilio):',
        detail: ' muestra índice y meñique extendidos (seña ILY) para activar prioridad e intérprete humano en <30 s.'
      },
      {
        emoji: '\u{1F590}\u{FE0F}',
        title: 'Vocabulario dinámico LSP (118 señas):',
        detail: ' realiza señas fluidas con 1 o 2 manos (hola, ayudar, enferma, dinero, comprar, preguntar, qué pasó, cómo, dónde, cuánto, sí, no, esperar).'
      },
      {
        emoji: '\u{1F524}',
        title: 'Deletreo estático (A–Y, 1 mano):',
        detail: ' forma una letra con una sola mano y detén la muñeca ~0.5 s para confirmarla (incluye C, M, N, P, Q, T, X).'
      },
      {
        emoji: '\u{270D}\u{FE0F}',
        title: 'Letras con trazo (J, Ñ, Z):',
        detail: ' J (meñique en I bajando en gancho), Ñ (N agitando la muñeca horizontalmente) y Z (D trazando zig-zag con el índice).'
      },
      {
        emoji: '\u{2423}',
        title: 'Espacio y envío sin apuros:',
        detail: ' pulsa “Espacio” o sostén postura neutra para separar palabras. Al deletrear no se envía a los 2 s: pulsa “Enviar y leer al funcionario” al terminar.'
      }
    ];

    const LETTER_CONFUSION_GUIDE = [
      { letter: 'D', tip: 'Índice vertical arriba; pulgar y dedo medio forman un círculo al frente.' },
      { letter: 'M', tip: 'Tres dedos (índice, medio y anular) doblados cubriendo el pulgar.' },
      { letter: 'N', tip: 'Solo dos dedos (índice y medio) doblados sobre el pulgar.' },
      { letter: 'Ñ', tip: 'Forma la N y agita o gira suavemente la muñeca de lado a lado.' },
      { letter: 'J', tip: 'Meñique extendido (como I) trazando una curva hacia abajo y adentro.' },
      { letter: 'Z', tip: 'Índice extendido (como D) dibujando un zig-zag: lado, diagonal y lado.' }
    ];

    GESTURES.forEach((gesture) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-gesture', gesture.id);

      if ((gesture.kind === 'letter' || gesture.kind === 'space') && lettersBar) {
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
    });

    if (guideList) {
      NEURAL_GUIDE_ITEMS.forEach((item) => {
        const li = document.createElement('li');
        const guideEmoji = document.createElement('span');
        guideEmoji.className = 'vision-guide-emoji';
        guideEmoji.setAttribute('aria-hidden', 'true');
        guideEmoji.textContent = item.emoji;

        const descWrap = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = item.title;
        descWrap.append(strong, item.detail);

        li.append(guideEmoji, descWrap);
        guideList.appendChild(li);
      });
    }

    if (letterRefBox) {
      const refTitle = document.createElement('p');
      refTitle.className = 'vision-letter-ref-title';
      refTitle.textContent = 'Posición rápida para letras que suelen confundirse (D, M, N, Ñ, J, Z)';

      const refGrid = document.createElement('div');
      refGrid.className = 'vision-letter-ref-grid';

      LETTER_CONFUSION_GUIDE.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'vision-letter-ref-card';

        const badge = document.createElement('span');
        badge.className = 'vision-letter-ref-badge';
        badge.textContent = item.letter;

        const txt = document.createElement('span');
        txt.textContent = item.tip;

        card.append(badge, txt);
        refGrid.appendChild(card);
      });

      letterRefBox.replaceChildren(refTitle, refGrid);
    }

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
      const first = (simBox || simGrid).querySelector('.vision-gesture-btn');
      if (first) first.focus();
    });

    btnSpeak.addEventListener('click', () => sendSentence({ auto: false }));
    if (btnSpace) btnSpace.addEventListener('click', insertSpace);
    btnUndo.addEventListener('click', undoLast);
    if (btnClear) btnClear.addEventListener('click', clearAllOutput);
    btnEscalate.addEventListener('click', escalate);

    if (btnOverlay) {
      btnOverlay.addEventListener('click', () => {
        overlayEnabled = !overlayEnabled;
        btnOverlay.classList.toggle('is-active', overlayEnabled);
        btnOverlay.setAttribute('aria-pressed', String(overlayEnabled));
        if (!overlayEnabled) clearCanvas();
        syncHudVisibility();
      });
    }

    if (btnMirror && stage) {
      btnMirror.addEventListener('click', () => {
        mirrorEnabled = !mirrorEnabled;
        btnMirror.classList.toggle('is-active', mirrorEnabled);
        btnMirror.setAttribute('aria-pressed', String(mirrorEnabled));
        stage.classList.toggle('is-unmirrored', !mirrorEnabled);
      });
    }

    if (btnExpand) {
      btnExpand.addEventListener('click', () => {
        setVisionExpanded(!visionExpanded);
      });
    }

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mode !== 'idle') {
        e.preventDefault();
        resetToIdle();
        btnStart.focus();
      }
    });

    document.addEventListener('senasegura:channelchange', (e) => {
      if (!e.detail || e.detail.channel !== 'camara') {
        setVisionExpanded(false);
        resetToIdle();
      }
    });

    document.addEventListener('senasegura:purge', () => {
      setVisionExpanded(false);
      resetToIdle();
      cancelSpeech();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (mode === 'loading' || mode === 'live')) {
        stopCamera();
        showNotice('La cámara se detuvo al salir de la pestaña. Pulsa “Activar Cámara” para reanudar.');
      }
    });

    const releaseOnExit = () => {
      if (preloadHandle !== null) {
        if (preloadUsingIdle && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(preloadHandle);
        } else {
          clearTimeout(preloadHandle);
        }
        preloadHandle = null;
      }
      stopCamera({ keepStatus: true });
      cancelSpeech();
      if (visionEngine) {
        [visionEngine.handLandmarker, visionEngine.poseLandmarker, visionEngine.faceLandmarker, visionEngine.hands].forEach(
          (instance) => {
            if (instance && typeof instance.close === 'function') {
              try {
                instance.close();
              } catch (_) {
                /* instancia ya liberada */
              }
            }
          }
        );
      }
      visionEngine = null;
      enginePromise = null;
      if (loadedTfModels) {
        [loadedTfModels.dynamic, loadedTfModels.alphabet, loadedTfModels.trajectory].forEach((entry) => {
          if (entry && entry.model && typeof entry.model.dispose === 'function') {
            try {
              entry.model.dispose();
            } catch (_) {
              /* grafo TF.js ya liberado */
            }
          }
        });
      }
      tfModels = null;
      loadedTfModels = null;
      tfModelsPromise = null;
      tfProgressCallback = null;
    };
    window.addEventListener('beforeunload', releaseOnExit);
    window.addEventListener('pagehide', releaseOnExit);

    if ('speechSynthesis' in window && typeof window.speechSynthesis.getVoices === 'function') {
      window.speechSynthesis.getVoices();
    }

    function scheduleSilentPreload() {
      if (window.location.protocol === 'file:' || navigator.onLine === false) {
        setAiReadyState('fallback');
        return;
      }
      setAiReadyState('loading');
      const runPreload = () => {
        preloadHandle = null;
        if (window.location.protocol === 'file:' || navigator.onLine === false) {
          setAiReadyState('fallback');
          return;
        }
        loadTfModels()
          .then((models) => {
            if (!tfModels) tfModels = models;
            setAiReadyState('ready');
          })
          .catch(() => {
            setAiReadyState('fallback');
          });
        getVisionEngine({ silent: true }).catch(() => {});
      };
      if (typeof window.requestIdleCallback === 'function') {
        preloadUsingIdle = true;
        preloadHandle = window.requestIdleCallback(runPreload, { timeout: 1500 });
      } else {
        preloadUsingIdle = false;
        preloadHandle = setTimeout(runPreload, 800);
      }
    }

    resetOutput();
    setStatus('idle');
    scheduleSilentPreload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
