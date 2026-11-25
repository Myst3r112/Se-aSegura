/**
 * SeñaSegura · Módulo "Cámara IA (LSP · 7 Parámetros Formativos)" (Vanilla JS ES6+)
 *
 * - Carga ESTRICTAMENTE bajo demanda al pulsar "Activar Cámara" (0 peticiones externas en carga inicial).
 * - Cadena resiliente de degradación progresiva:
 *     Nivel 1: Motor Completo LSP 7 Parámetros (@mediapipe/tasks-vision@0.10.14):
 *              HandLandmarker (2 manos 3D) + PoseLandmarker Lite (torso/profundidad cada 3 frames) +
 *              FaceLandmarker (blendshapes/intención no manual cada 3 frames).
 *     Nivel 2: HandLandmarker 3D solo (móviles de bajos recursos o fallo parcial de Pose/Face).
 *     Nivel 3: @mediapipe/hands@0.4.1675469240 clásico (respaldo si falla ESM/WASM/WebGL).
 *     Nivel 4: Vista compacta de prueba sin cámara (13 señas de ventanilla + 19 letras A–Z).
 * - Todo el procesamiento de video ocurre en el dispositivo: no se graba ni se envía video.
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
  const HAND_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const POSE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const FACE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  const LEGACY_HANDS_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
  const LEGACY_HANDS_SCRIPT_URL = `${LEGACY_HANDS_BASE_URL}hands.js`;

  const CONFIRM_MS = 320; // confirmación ágil tras voto por mayoría
  const CONFIRM_FAST_MS = 210; // saludo activo / respuesta inmediata
  const CONFIRM_INDEX_MS = 520; // breve espera para distinguir quieto vs trayectoria dinámica (Z/negación)
  const COOLDOWN_MS = 1200; // antes de encadenar nuevamente la misma seña
  const GRACE_MS = 160; // tolerancia a micro-parpadeos
  const MIN_FRAME_INTERVAL_MS = 33; // ~30 fps máx.
  const AUX_DETECT_STRIDE = 3; // Pose + Face cada 3 frames (~10 Hz) para mantener 24–30 fps
  const MOTION_WINDOW = 22; // ventana de 20–24 frames para trayectorias 3D
  const VOTE_WINDOW = 6; // suavizado temporal por mayoría
  const AUTO_SEND_PAUSE_MS = 2000;
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
    { id: 'letra_i', kind: 'letter', letter: 'I', emoji: 'I', label: 'Letra I', hands: '1 mano', hint: 'solo meñique extendido con pulgar recogido' },
    { id: 'letra_j', kind: 'letter', letter: 'J', emoji: 'J', label: 'Letra J', hands: '1 mano en movimiento', hint: 'meñique trazando una curva en J' },
    { id: 'letra_k', kind: 'letter', letter: 'K', emoji: 'K', label: 'Letra K', hands: '1 mano', hint: 'índice y medio abiertos con pulgar apoyado entre ambos' },
    { id: 'letra_l', kind: 'letter', letter: 'L', emoji: 'L', label: 'Letra L', hands: '1 mano', hint: 'pulgar e índice en ángulo recto' },
    { id: 'letra_enie', kind: 'letter', letter: 'Ñ', emoji: 'Ñ', label: 'Letra Ñ', hands: '1 mano con movimiento', hint: 'dedos U/V agitados horizontalmente' },
    { id: 'letra_o', kind: 'letter', letter: 'O', emoji: 'O', label: 'Letra O', hands: '1 mano', hint: 'todas las puntas curvadas tocando el pulgar en O' },
    { id: 'letra_r', kind: 'letter', letter: 'R', emoji: 'R', label: 'Letra R', hands: '1 mano', hint: 'dedo medio cruzado sobre el índice' },
    { id: 'letra_s', kind: 'letter', letter: 'S', emoji: 'S', label: 'Letra S', hands: '1 mano', hint: 'palma al frente con pulgar cruzado sobre los dedos' },
    { id: 'letra_u', kind: 'letter', letter: 'U', emoji: 'U', label: 'Letra U', hands: '1 mano', hint: 'índice y medio extendidos juntos en paralelo' },
    { id: 'letra_v', kind: 'letter', letter: 'V', emoji: 'V', label: 'Letra V', hands: '1 mano', hint: 'índice y medio extendidos separados en V' },
    { id: 'letra_w', kind: 'letter', letter: 'W', emoji: 'W', label: 'Letra W', hands: '1 mano', hint: 'índice, medio y anular extendidos en abanico' },
    { id: 'letra_y', kind: 'letter', letter: 'Y', emoji: 'Y', label: 'Letra Y', hands: '1 mano', hint: 'pulgar y meñique abiertos lateralmente' },
    { id: 'letra_z', kind: 'letter', letter: 'Z', emoji: 'Z', label: 'Letra Z', hands: '1 mano en movimiento', hint: 'índice trazando zig-zag en Z' }
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
   * Encadena las señas confirmadas en español legible integrando intención no manual (¿...?).
   * @param {Array<{id?:string,kind:'word'|'letter', text:string}>} tokens
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

    const hasQueryIntent =
      /\b(consulta|ayuda|necesito|dni|monto|por favor|entiendo|corregir|espera)\b/i.test(sentence) ||
      tokens.some((t) => t.id === 'indice' || t.id === 'por_favor' || t.kind === 'letter');

    if (expression === 'pregunta' && hasQueryIntent) {
      const core = sentence.replace(/^[¿]/, '').replace(/[.!?]+$/, '');
      sentence = `¿${core}?`;
    }

    return sentence;
  }

  let latestDescriptorSnapshot = null;

  function getLastDescriptor() {
    return latestDescriptorSnapshot;
  }

  // API pública para pruebas unitarias, telemetría y entrenamiento futuro (sin alterar DOM)
  window.SenaSeguraVision = Object.freeze({
    classifyHand,
    resolveMultiHandGesture,
    majorityVoteGesture,
    detectHorizontalOscillation,
    computePalmOrientation3D,
    computeSpatialContext,
    analyzeNonManualExpressions,
    analyzeTrajectory3D,
    composeSentence,
    getLastDescriptor,
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
      return;
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
    // visionEngine: { type: 'tasks', level: 1|2, landmarker, poseLandmarker, faceLandmarker } | { type: 'legacy', level: 3, hands }
    let visionEngine = null;
    let enginePromise = null;
    let running = false;
    let rafId = 0;
    let frameCounter = 0;
    let isLegacyProcessing = false;
    let lastVideoTime = -1;
    let lastSendAt = 0;
    let lastDetectTs = 0;
    let lastAuxDetectTs = 0;
    let latestPoseLandmarks = null;
    let latestFaceLandmarks = null;
    let latestFaceBlendshapes = null;
    let prevPalmOrientation = null;
    let activeSentenceExpression = 'neutro';
    let lastConfirmed = null;
    let lastProgressPct = -1;
    let handsDownSince = null;
    let speechTimer = null;
    let sentenceTokens = [];
    const lastAddedAt = {};
    const motionBuffer = [];
    const voteBuffer = [];
    const detection = { id: null, since: 0, lastSeen: 0, confirmed: false, scoreSum: 0, scoreN: 0, meta: null };

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
      const text = composeSentence(sentenceTokens, activeSentenceExpression);
      sentenceEl.textContent = text || DEFAULT_SENTENCE;
      sentenceEl.classList.toggle('is-empty', !text);
      const hasTokens = sentenceTokens.length > 0;
      btnSpeak.disabled = !hasTokens;
      btnUndo.disabled = !hasTokens && !lastConfirmed;
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
      motionBuffer.length = 0;
      voteBuffer.length = 0;
      prevPalmOrientation = null;
      latestPoseLandmarks = null;
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

    async function createTasksEngine() {
      const { FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker } = await loadTasksVision();
      const vision = await withTimeout(FilesetResolver.forVisionTasks(VISION_WASM_URL), LOAD_TIMEOUT_MS);

      const handLandmarker = await createTaskWithCpuFallback(HandLandmarker, vision, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      // Nivel 1 completo solo en equipos con recursos suficientes; en móviles ligeros conserva Nivel 2
      const lowPower =
        window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 4) <= 2;

      let poseLandmarker = null;
      let faceLandmarker = null;

      if (!lowPower) {
        const [poseRes, faceRes] = await Promise.allSettled([
          PoseLandmarker
            ? createTaskWithCpuFallback(PoseLandmarker, vision, {
              baseOptions: { modelAssetPath: POSE_MODEL_URL },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.45,
              minTrackingConfidence: 0.45
            })
            : Promise.resolve(null),
          FaceLandmarker
            ? createTaskWithCpuFallback(FaceLandmarker, vision, {
              baseOptions: { modelAssetPath: FACE_MODEL_URL },
              runningMode: 'VIDEO',
              numFaces: 1,
              outputFaceBlendshapes: true,
              minFaceDetectionConfidence: 0.45,
              minTrackingConfidence: 0.45
            })
            : Promise.resolve(null)
        ]);

        if (poseRes.status === 'fulfilled' && poseRes.value) {
          poseLandmarker = poseRes.value;
        } else if (poseRes.status === 'rejected') {
          console.warn('[Cámara IA]', poseRes.reason);
        }

        if (faceRes.status === 'fulfilled' && faceRes.value) {
          faceLandmarker = faceRes.value;
        } else if (faceRes.status === 'rejected') {
          console.warn('[Cámara IA]', faceRes.reason);
        }
      }

      const level = poseLandmarker || faceLandmarker ? 1 : 2;
      return { type: 'tasks', level, handLandmarker, poseLandmarker, faceLandmarker };
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
        frameCounter = 0;
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

    /** Bucle de video ~30 fps: Manos en cada frame; Pose + Face cada 3 frames cuando Nivel 1 activo. */
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

          if (visionEngine.level === 1 && frameCounter % AUX_DETECT_STRIDE === 0) {
            const auxTs = Math.max(lastAuxDetectTs + 1, ts);
            lastAuxDetectTs = auxTs;
            if (visionEngine.poseLandmarker) {
              try {
                const poseRes = visionEngine.poseLandmarker.detectForVideo(video, auxTs);
                latestPoseLandmarks =
                  poseRes && Array.isArray(poseRes.landmarks) && poseRes.landmarks[0] ? poseRes.landmarks[0] : null;
              } catch (poseErr) {
                console.warn('[Cámara IA]', poseErr);
                visionEngine.poseLandmarker = null;
              }
            }
            if (visionEngine.faceLandmarker) {
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

    /* ---------- Dibujo sutil + Resultados 7 parámetros ---------- */
    function drawShoulderReference(poseLandmarks) {
      if (!Array.isArray(poseLandmarks) || !poseLandmarks[11] || !poseLandmarks[12]) return;
      const w = canvas.width;
      const h = canvas.height;
      const high = document.documentElement.getAttribute('data-contrast') === 'high';

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = high ? '#F59E0B' : '#0F4C81';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(poseLandmarks[11].x * w, poseLandmarks[11].y * h);
      ctx.lineTo(poseLandmarks[12].x * w, poseLandmarks[12].y * h);
      ctx.stroke();

      [poseLandmarks[11], poseLandmarks[12]].forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, 4, 0, Math.PI * 2);
        ctx.fillStyle = high ? '#FFFFFF' : '#0F4C81';
        ctx.fill();
      });
      ctx.restore();
    }

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

    function handleResults(results, now = performance.now()) {
      if (!running || !results) return;
      clearCanvas();
      const allLandmarks = Array.isArray(results.landmarks) ? results.landmarks : [];
      const allWorldLandmarks = Array.isArray(results.worldLandmarks) ? results.worldLandmarks : [];
      const allHandedness = Array.isArray(results.handedness) ? results.handedness : [];

      if (visionEngine && visionEngine.level === 1 && latestPoseLandmarks) {
        drawShoulderReference(latestPoseLandmarks);
      }
      updateHandsCount(allLandmarks.length);

      if (allLandmarks.length === 0) {
        motionBuffer.length = 0;
        voteBuffer.length = 0;
        prevPalmOrientation = null;
        feedGesture(null, 0, now);
        if (handsDownSince === null) handsDownSince = now;
        if (sentenceTokens.length > 0 && now - handsDownSince >= AUTO_SEND_PAUSE_MS) {
          sendSentence({ auto: true });
        }
        return;
      }
      handsDownSince = null;

      const aspect = canvas.width / canvas.height;
      const spatial = computeSpatialContext(allLandmarks[0], allWorldLandmarks[0] || null, latestPoseLandmarks, allLandmarks);
      const nonManual = analyzeNonManualExpressions(latestFaceBlendshapes, latestFaceLandmarks);

      pushMotionFrame(allLandmarks[0], allWorldLandmarks[0] || null, spatial, aspect, now);
      const trajectory = analyzeTrajectory3D(motionBuffer);

      const handEntries = [];
      allLandmarks.forEach((landmarks, idx) => {
        drawHand(landmarks, idx);
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
      if (voteBuffer.length >= VOTE_WINDOW) voteBuffer.shift();
      voteBuffer.push(resolved ? { id: resolved.id, score: resolved.score } : { id: null, score: 0 });
      const smoothed = majorityVoteGesture(voteBuffer);

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
      latestDescriptorSnapshot = Object.freeze({
        level: frameMeta.level,
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

    /* ---------- Cuadrícula compacta (ventanilla + teclado A–Z) y guía ---------- */
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
      const first = (simBox || simGrid).querySelector('.vision-gesture-btn');
      if (first) first.focus();
    });

    btnSpeak.addEventListener('click', () => sendSentence({ auto: false }));
    btnUndo.addEventListener('click', undoLast);
    btnEscalate.addEventListener('click', escalate);

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mode !== 'idle') {
        e.preventDefault();
        resetToIdle();
        btnStart.focus();
      }
    });

    document.addEventListener('senasegura:channelchange', (e) => {
      if (!e.detail || e.detail.channel !== 'camara') {
        resetToIdle();
      }
    });

    document.addEventListener('senasegura:purge', () => {
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
