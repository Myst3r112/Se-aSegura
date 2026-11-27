/**
 * SeñaSegura · Módulo puro de matemática 3D, biomecánica LSP y post-procesamiento
 * Cero dependencias del DOM; exportado en window.SenaSeguraVisionMath y reexpuesto en window.SenaSeguraVision.
 */
(() => {
  'use strict';

  const HAND_EMA_ALPHA = 0.65;
  const POSE_EMA_ALPHA = 0.45;
  const HAND_FEATURES_90 = 90;
  const TRAJ_SEQ_LEN = 16;
  const TRAJ_NUM_FEATURES = 12;
  const TRAJ_DYNAMIC_LABELS = new Set(['J', 'Ñ', 'Z']);
  const TRAJ_STATIC_LABEL = 'ESTATICA';
  const TRAJ_HISTORY_MAX_MS = 1600;
  const TRAJ_HISTORY_MAX_FRAMES = 50;
  const TRAJ_RESAMPLE_MIN_MS = 450;
  const TRAJ_RESAMPLE_MAX_MS = 1400;
  const DYNAMIC_SEQ_LEN = 30;
  const DYNAMIC_NUM_FEATURES = 159;
  const VOTE_WINDOW = 6;

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

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

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

    if (
      type === 'quieto' &&
      ((tipStats.spanX >= 0.44 && tipStats.spanX > tipStats.spanY * 1.1 && tipStats.reversals >= 2) ||
        (wristStats.spanX >= 0.44 && wristStats.spanX > wristStats.spanY * 1.1 && wristStats.reversals >= 2))
    ) {
      type = 'oscilacion_h';
    }

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

    if (
      type === 'quieto' &&
      tipStats.reversals <= 1 &&
      (netZ <= -0.22 || palmScaleRatio >= 1.15 || (netTipDy >= 0.28 && startZone === 'boca_menton'))
    ) {
      type = 'hacia_adelante';
    }

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

    const palm = options.palmOrientation || computePalmOrientation3D(W, options.handedness || 'Right');
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
      const avgGap = (rel(8, 12) + rel(12, 16) + rel(16, 20)) / 3;
      const thumbAcrossPalm = thumbToRingMcp < 0.70 || thumbToMiddleMcp < 0.60 || thumbToIndexMcp < 0.56;
      id = thumbAcrossPalm && avgGap < 0.30 ? 'letra_b' : 'palma';
    } else if (I && M && !R && !K) {
      const tipGapIM = rel(8, 12);
      const latDot =
        ((W[9].x - W[5].x) * (W[12].x - W[8].x) +
          (W[9].y - W[5].y) * (W[12].y - W[8].y) +
          ((W[9].z || 0) - (W[5].z || 0)) * ((W[12].z || 0) - (W[8].z || 0))) /
        (palmW * palmW);
      const zCross = Math.abs((W[8].z || 0) - (W[12].z || 0)) / palmW > 0.14 && tipGapIM < 0.22;
      if (latDot <= 0 || zCross) id = 'letra_r';
      else if (tipGapIM >= 0.28 && thumbToMiddlePip < 0.50 && thumbToMiddleMcp < 0.56) id = 'letra_k';
      else if (tipGapIM < 0.28) id = 'letra_u';
      else id = 'letra_v';
    } else if (I && M && R && !K) {
      id = 'letra_w';
    } else if (I && !M && !R && !K) {
      const lAngle = angleDeg(W[4], W[2], W[5]);
      if (thumbSpread && lAngle >= 45 && thumbToIndexMcp > 0.70) id = 'letra_l';
      else if (midInfo.reachTip >= 1.04 && rel(4, 12) < 0.42 && rel(4, 16) < 0.54 && !thumbSpread) id = 'letra_d';
      else id = 'indice';
    } else if (!I && !M && !R && K) {
      id = thumbToIndexMcp > 0.72 && thumbToPinkyMcp > 0.85 ? 'letra_y' : 'letra_i';
    } else if (!I && !M && !R && !K) {
      const avgPipCurl = (idxInfo.pipAngle + midInfo.pipAngle) / 2;
      const sideFistOrientation = palm.orientation === 'lateral' || palm.orientation === 'abajo';
      if (thumbUpHigh) {
        id = 'pulgar';
      } else if (pinchThumbIndex < 0.36 && rel(4, 12) < 0.50 && idxInfo.reachTip > 1.06 && avgPipCurl >= 70 && avgPipCurl <= 148) {
        id = 'letra_o';
      } else if (pinchThumbIndex >= 0.42 && pinchThumbIndex <= 1.35 && idxInfo.reachTip > 1.12 && midInfo.reachTip > 1.12 && rel(8, 12) < 0.46 && rel(4, 0) > 1.02) {
        id = 'letra_c';
      } else if (idxInfo.reachTip > 0.96 && midInfo.reachTip > 0.96 && rel(8, 4) < 0.54 && rel(12, 4) < 0.54 && thumbToMiddlePip > 0.30) {
        id = 'letra_e';
      } else if ((thumbToMiddlePip < 0.42 || thumbToRingPip < 0.44) && idxInfo.reachTip < 1.12 && thumbToIndexPip < 0.60 && !sideFistOrientation) {
        id = 'letra_s';
      } else if (thumbStraight && thumbToIndexPip < 0.62 && thumbToMiddlePip >= 0.44 && thumbToIndexMcp > 0.28 && !sideFistOrientation) {
        id = 'letra_a';
      } else {
        id = 'puno';
      }
    }

    return { id, fingers, palm };
  }

  function resolveMultiHandGesture(handEntries, currentId = null, context = null) {
    if (!Array.isArray(handEntries) || handEntries.length === 0) return null;

    const spatial = context && context.spatial ? context.spatial : null;
    const nonManual = context && context.nonManual ? context.nonManual : null;
    const trajectory = context && context.trajectory ? context.trajectory : null;
    const valid = handEntries.filter((entry) => entry && entry.id);
    if (valid.length === 0) return null;

    if (valid.length >= 2) {
      const [h0, h1] = valid;
      const avgScore = ((h0.score || 0.9) + (h1.score || 0.9)) / 2;
      if (h0.id === 'palma' && h1.id === 'palma') return { id: 'dos_palmas', score: avgScore };
      if (h0.id === 'pulgar' && h1.id === 'pulgar') return { id: 'dos_pulgares', score: avgScore };
      if ((h0.id === 'letra_l' && h1.id === 'letra_l') || (h0.id === 'letra_c' && h1.id === 'letra_c')) {
        return { id: 'dni', score: avgScore };
      }
    }

    const primary = handEntries[0] && handEntries[0].id ? handEntries[0] : valid[0];
    const score = typeof primary.score === 'number' ? primary.score : 0.9;
    const pid = primary.id;
    const palmOrient = (primary.palm && primary.palm.orientation) || 'frente';
    const trajType = trajectory ? trajectory.type : 'quieto';
    const zone = spatial ? spatial.zone : 'espacio_neutro';
    const startZone = trajectory && trajectory.startZone ? trajectory.startZone : zone;
    const expr = nonManual ? nonManual.expression : 'neutro';
    const isOpen = pid === 'palma' || pid === 'letra_b';

    if (zone === 'pecho' && (expr === 'urgencia_dolor' || ((pid === 'letra_e' || pid === 'puno') && spatial && spatial.contact && spatial.contact.manoCuerpo))) {
      return { id: 'dolor', score };
    }
    if (isOpen && zone === 'pecho' && trajType === 'circular') {
      return { id: 'por_favor', score };
    }
    if (
      isOpen &&
      (zone === 'boca_menton' || startZone === 'boca_menton') &&
      trajType === 'hacia_adelante' &&
      (palmOrient === 'cuerpo' || palmOrient === 'arriba' || palmOrient === 'frente')
    ) {
      return { id: 'gracias', score };
    }
    if (
      spatial &&
      spatial.poseActive &&
      zone === 'frente' &&
      (pid === 'indice' || pid === 'pulgar' || pid === 'letra_l' || pid === 'palma') &&
      trajType !== 'oscilacion_h'
    ) {
      return { id: 'entiendo', score };
    }
    if (pid === 'letra_i' && trajType === 'trazo_j') return { id: 'letra_j', score };
    if ((pid === 'letra_u' || pid === 'letra_v') && trajType === 'oscilacion_h') return { id: 'letra_enie', score };
    if (pid === 'indice' && trajType === 'trazo_z') return { id: 'letra_z', score };
    if (pid === 'indice' && trajType === 'oscilacion_h') return { id: 'negar_mov', score };

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

  function humanizeGloss(gloss) {
    const raw = String(gloss || '').trim();
    if (!raw || IGNORED_GLOSSES.has(raw)) return '';
    if (Object.prototype.hasOwnProperty.call(GLOSS_SPANISH_MAP, raw)) {
      return GLOSS_SPANISH_MAP[raw];
    }
    return raw.replace(/_/g, ' ');
  }

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

  function smoothLandmarksEMA(prevPts, nextPts, alpha = HAND_EMA_ALPHA, jumpResetDist = 0.35) {
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

  function computePalmNormalUnit(pts) {
    const a = { x: pts[5].x - pts[0].x, y: pts[5].y - pts[0].y, z: pts[5].z - pts[0].z };
    const b = { x: pts[17].x - pts[0].x, y: pts[17].y - pts[0].y, z: pts[17].z - pts[0].z };
    const nx = a.y * b.z - a.z * b.y;
    const ny = a.z * b.x - a.x * b.z;
    const nz = a.x * b.y - a.y * b.x;
    const norm = Math.hypot(nx, ny, nz) || 1e-6;
    return { x: nx / norm, y: ny / norm, z: nz / norm };
  }

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

  function standardizeTrajectorySequence(frames, scalerMean, scalerStd) {
    const out = new Float32Array(frames.length * TRAJ_NUM_FEATURES);
    for (let t = 0; t < frames.length; t += 1) {
      const std = standardizeFeatures(frames[t], scalerMean, scalerStd);
      out.set(std, t * TRAJ_NUM_FEATURES);
    }
    return out;
  }

  function resampleTrajectorySequence(history, targetLen = TRAJ_SEQ_LEN, nowMs = null, options = null) {
    if (!Array.isArray(history) || history.length < 2) return null;
    const newest = history[history.length - 1];
    const refNow = Number.isFinite(nowMs) ? nowMs : newest.at;
    const minWindow = (options && Number.isFinite(options.minMs)) ? options.minMs : TRAJ_RESAMPLE_MIN_MS;
    const maxWindow = (options && Number.isFinite(options.maxMs)) ? options.maxMs : TRAJ_RESAMPLE_MAX_MS;

    const recent = history.filter((item) => item && (refNow - item.at) <= maxWindow);
    if (recent.length < 2) return null;

    const totalSpan = recent[recent.length - 1].at - recent[0].at;
    if (totalSpan < minWindow) return null;

    let startIdx = 0;
    for (let i = 1; i < recent.length; i += 1) {
      const prev = recent[i - 1];
      const cur = recent[i];
      const palm = Math.max(1e-4, cur.palm || 0.08);
      const stepMag = (
        Math.hypot(cur.index[0] - prev.index[0], cur.index[1] - prev.index[1]) +
        Math.hypot(cur.pinky[0] - prev.pinky[0], cur.pinky[1] - prev.pinky[1]) +
        Math.hypot(cur.wrist[0] - prev.wrist[0], cur.wrist[1] - prev.wrist[1]) * 0.5
      ) / palm;
      if (stepMag >= 0.025) {
        startIdx = Math.max(0, i - 1);
        break;
      }
    }

    let active = recent.slice(startIdx);
    if (active.length < 2 || (active[active.length - 1].at - active[0].at) < minWindow) {
      active = recent;
    }

    const t0 = active[0].at;
    const t1 = active[active.length - 1].at;
    if ((t1 - t0) < minWindow) return null;

    const sampled = [];
    for (let s = 0; s < targetLen; s += 1) {
      const targetT = t0 + ((t1 - t0) * s) / Math.max(1, targetLen - 1);
      let hi = active.length - 1;
      for (let i = 1; i < active.length; i += 1) {
        if (active[i].at >= targetT) {
          hi = i;
          break;
        }
      }
      const lo = Math.max(0, hi - 1);
      const a = active[lo];
      const b = active[hi];
      const dt = Math.max(1e-6, b.at - a.at);
      const alpha = a === b ? 0 : clamp((targetT - a.at) / dt, 0, 1);
      const lerp3 = (p, q) => [
        p[0] + (q[0] - p[0]) * alpha,
        p[1] + (q[1] - p[1]) * alpha,
        (p[2] || 0) + ((q[2] || 0) - (p[2] || 0)) * alpha
      ];
      sampled.push({
        wrist: lerp3(a.wrist, b.wrist),
        index: lerp3(a.index, b.index),
        pinky: lerp3(a.pinky, b.pinky),
        worldWrist: a.worldWrist && b.worldWrist ? lerp3(a.worldWrist, b.worldWrist) : null,
        worldIndex: a.worldIndex && b.worldIndex ? lerp3(a.worldIndex, b.worldIndex) : null,
        worldPinky: a.worldPinky && b.worldPinky ? lerp3(a.worldPinky, b.worldPinky) : null,
        palm: a.palm + (b.palm - a.palm) * alpha,
        worldPalm: (a.worldPalm || a.palm) + ((b.worldPalm || b.palm) - (a.worldPalm || a.palm)) * alpha,
        normal: lerp3(a.normal || [0, 0, 1], b.normal || [0, 0, 1]),
        flip: b.flip || 1,
        mirrorSign: b.mirrorSign || 1,
        aspect: a.aspect + (b.aspect - a.aspect) * alpha
      });
    }

    const frames = [];
    const dzDamping = options && Number.isFinite(options.dzDamping) ? options.dzDamping : 0.35;
    for (let s = 0; s < targetLen; s += 1) {
      const cur = sampled[s];
      const prev = s > 0 ? sampled[s - 1] : sampled[0];
      const palm = Math.max(1e-4, cur.palm);
      const worldPalm = Math.max(1e-4, cur.worldPalm || palm);
      const out = new Float32Array(TRAJ_NUM_FEATURES);
      const keys = ['wrist', 'index', 'pinky'];
      const wKeys = ['worldWrist', 'worldIndex', 'worldPinky'];
      for (let k = 0; k < 3; k += 1) {
        const pPrev = prev[keys[k]];
        const pCur = cur[keys[k]];
        out[k * 3] = (cur.flip * cur.mirrorSign * (pCur[0] - pPrev[0]) * cur.aspect) / palm;
        out[k * 3 + 1] = (pCur[1] - pPrev[1]) / palm;
        let rawDz = cur[wKeys[k]] && prev[wKeys[k]]
          ? ((cur[wKeys[k]][2] || 0) - (prev[wKeys[k]][2] || 0)) / worldPalm
          : (((pCur[2] || 0) - (pPrev[2] || 0)) * cur.aspect) / palm;
        if (Math.abs(rawDz) < 0.015) rawDz = 0;
        out[k * 3 + 2] = rawDz * dzDamping;
      }
      out[9] = cur.normal[0];
      out[10] = cur.normal[1];
      out[11] = cur.normal[2];
      for (let i = 0; i < out.length; i += 1) {
        if (!Number.isFinite(out[i])) out[i] = 0;
      }
      frames.push(out);
    }
    return frames;
  }

  function detectCanonicalHandPostures(pts) {
    if (!Array.isArray(pts) || pts.length < 21) {
      return {
        indexExt: false,
        middleExt: false,
        ringExt: false,
        pinkyExt: false,
        indexOnlyExtended: false,
        pinkyOnlyExtended: false,
        ringPinkyCurled: false,
        middleStrictCurled: false,
        middleFoldedWithRing: false,
        pointingDownTwoFingers: false,
        pointingDownIndexThumb: false,
        enieFoldedPosture: false,
        middleToRingDist: 0,
        middleBelowRingY: 0,
        twoFingerSpan: 0,
        knuckleSpan: 0,
        latDot: 0
      };
    }
    const idxAng = angleDeg(pts[5], pts[6], pts[8]);
    const idxDistalAng = angleDeg(pts[6], pts[7], pts[8]);
    const midAng = angleDeg(pts[9], pts[10], pts[12]);
    const ringAng = angleDeg(pts[13], pts[14], pts[16]);
    const pinkyAng = angleDeg(pts[17], pts[18], pts[20]);

    const indexExt = idxAng >= 132 || dist3(pts[8], pts[0]) > dist3(pts[6], pts[0]) * 1.12;
    const middleExt = midAng >= 130 || dist3(pts[12], pts[0]) > dist3(pts[10], pts[0]) * 1.12;
    const ringExt = ringAng >= 130 || dist3(pts[16], pts[0]) > dist3(pts[14], pts[0]) * 1.15;
    const pinkyExt = pinkyAng >= 130 || dist3(pts[20], pts[0]) > dist3(pts[18], pts[0]) * 1.15;

    const indexExtendedStraight = idxAng >= 142 && dist3(pts[8], pts[0]) > dist3(pts[6], pts[0]) * 1.14;
    const middleExtendedStraight = midAng >= 142 && dist3(pts[12], pts[0]) > dist3(pts[10], pts[0]) * 1.14;

    const ringCurled = ringAng <= 125 && dist3(pts[16], pts[0]) <= dist3(pts[14], pts[0]) * 1.08;
    const pinkyCurled = pinkyAng <= 125 && dist3(pts[20], pts[0]) <= dist3(pts[18], pts[0]) * 1.08;
    const middleStrictCurled = midAng <= 108 && dist3(pts[12], pts[0]) <= dist3(pts[10], pts[0]) * 1.07;
    const indexCurled = idxAng <= 125 && dist3(pts[8], pts[0]) <= dist3(pts[6], pts[0]) * 1.08;
    const indexOnlyExtended = (
      idxAng >= 145 &&
      idxDistalAng >= 140 &&
      dist3(pts[4], pts[5]) < 0.72 &&
      midAng <= 120 &&
      ringAng <= 120 &&
      pinkyAng <= 120
    );

    const knuckleSpan = Math.max(1e-4, dist3(pts[5], pts[9]));
    const twoFingerSpan = dist3(pts[8], pts[12]);
    const latDot = (pts[12].x - pts[8].x) * (pts[9].x - pts[5].x) + (pts[12].y - pts[8].y) * (pts[9].y - pts[5].y);
    const middleToRingDist = dist3(pts[12], pts[16]);
    const middleBelowRingY = pts[12].y - pts[16].y;

    const pointingDownTwoFingers = (
      idxAng >= 112 &&
      midAng >= 102 &&
      pts[12].y > pts[9].y + 0.05 &&
      ringAng <= 130 &&
      pinkyAng <= 130 &&
      (middleToRingDist >= 0.24 || middleBelowRingY >= 0.12)
    );

    const middleFoldedWithRing =
      middleStrictCurled || (midAng <= 115 && middleToRingDist < 0.24 && middleBelowRingY < 0.10);
    const pointingDownIndexThumb = (
      idxAng >= 120 &&
      pts[8].y > pts[5].y + 0.08 &&
      pts[4].y > pts[2].y + 0.03 &&
      ringAng <= 130 &&
      pinkyAng <= 130 &&
      middleFoldedWithRing
    );

    const enieFoldedPosture = ringCurled && pinkyCurled && !indexExtendedStraight && !middleExtendedStraight;

    return {
      indexExt,
      middleExt,
      ringExt,
      pinkyExt,
      indexOnlyExtended,
      pinkyOnlyExtended: pinkyExt && indexCurled && middleCurledCheck(midAng, pts) && ringCurled,
      ringPinkyCurled: ringCurled && pinkyCurled,
      middleStrictCurled,
      middleFoldedWithRing,
      pointingDownTwoFingers,
      pointingDownIndexThumb,
      enieFoldedPosture,
      middleToRingDist,
      middleBelowRingY,
      twoFingerSpan,
      knuckleSpan,
      latDot
    };
  }

  function middleCurledCheck(midAng, pts) {
    return midAng <= 125 && dist3(pts[12], pts[0]) <= dist3(pts[10], pts[0]) * 1.08;
  }

  function refineStatic3DLabel(topCandidates, pts, postures = null) {
    if (!Array.isArray(topCandidates) || !topCandidates.length || !Array.isArray(pts) || pts.length < 21) {
      return topCandidates && topCandidates[0]
        ? { label: topCandidates[0].label, score: Math.min(0.99, topCandidates[0].score), refined: false }
        : null;
    }
    const probMap = Object.create(null);
    topCandidates.forEach((item) => {
      if (item && item.label) probMap[item.label] = item.score;
    });
    const geom = postures || detectCanonicalHandPostures(pts);
    const best = topCandidates[0];

    const pU = probMap.U || 0;
    const pV = probMap.V || 0;
    const pR = probMap.R || 0;
    const sumUVR = pU + pV + pR;
    if (sumUVR >= 0.55 && geom.indexExt && geom.middleExt) {
      const tipDist = geom.twoFingerSpan;
      const uLimit = Math.max(0.36, geom.knuckleSpan * 1.48);
      if (geom.latDot > 0.0 && tipDist <= uLimit) {
        return {
          label: 'U',
          score: Math.min(0.99, Math.max(best.score, pU + 0.20, sumUVR * 0.88, 0.74)),
          refined: best.label !== 'U'
        };
      }
      if (best.label === 'U' || best.label === 'V' || best.label === 'R') {
        if (geom.latDot <= 0.0) {
          return {
            label: 'R',
            score: Math.min(0.99, Math.max(best.score, pR + 0.15, sumUVR * 0.85, 0.74)),
            refined: best.label !== 'R'
          };
        }
        if (tipDist > 0.38) {
          return {
            label: 'V',
            score: Math.min(0.99, Math.max(best.score, pV + 0.12, sumUVR * 0.82)),
            refined: best.label !== 'V'
          };
        }
      }
    }

    const pCluster = ['P', 'K', 'Q', 'H', 'G'];
    const sumPKQHG = pCluster.reduce((acc, lbl) => acc + (probMap[lbl] || 0), 0);
    if (geom.pointingDownTwoFingers && !geom.pointingDownIndexThumb && sumPKQHG >= 0.40) {
      return {
        label: 'P',
        score: Math.min(0.99, Math.max(best.score, 0.78)),
        refined: best.label !== 'P'
      };
    }

    const qCluster = ['Q', 'G', 'P', 'D', 'X'];
    const qInTop3 = topCandidates.slice(0, 3).some((c) => c && c.label === 'Q');
    const sumQGPDX = qCluster.reduce((acc, lbl) => acc + (probMap[lbl] || 0), 0);
    if (!geom.pointingDownTwoFingers && geom.pointingDownIndexThumb && (qInTop3 || sumQGPDX >= 0.45)) {
      return {
        label: 'Q',
        score: Math.min(0.99, Math.max(best.score, (probMap.Q || 0) + 0.24, sumQGPDX * 0.88, 0.74)),
        refined: best.label !== 'Q'
      };
    }

    return { label: best.label, score: Math.min(0.99, best.score), refined: false };
  }

  function analyzeTrajectoryMotion(history, nowMs = null) {
    const empty = {
      enieMotionOk: false,
      zMotionOk: false,
      jMotionOk: false,
      spanX: 0,
      spanY: 0,
      zSpanX: 0,
      zSpanY: 0,
      reversals: 0,
      dropY: 0,
      hookDx: 0
    };
    if (!Array.isArray(history) || history.length < 4) return empty;
    const newest = history[history.length - 1];
    const refNow = Number.isFinite(nowMs) ? nowMs : newest.at;
    const recent = history.filter((item) => item && (refNow - item.at) >= 0 && (refNow - item.at) <= 1350);
    if (recent.length < 4) return empty;
    const spanMs = recent[recent.length - 1].at - recent[0].at;
    if (spanMs < 300) return empty;

    let palmSum = 0;
    for (let i = 0; i < recent.length; i += 1) {
      palmSum += Math.max(1e-4, recent[i].palm || 0.08);
    }
    const avgPalm = palmSum / recent.length;

    const enieWindow = recent.filter((item) => (refNow - item.at) >= 0 && (refNow - item.at) <= 1300);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const dirSequence = [];
    for (let i = 0; i < enieWindow.length; i += 1) {
      const p = enieWindow[i];
      const ax = p.aspect || 1;
      const cx = p.index[0] * ax;
      const cy = p.index[1];
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (i > 0) {
        const prev = enieWindow[i - 1];
        const prevAx = prev.aspect || ax;
        const prevCx = prev.index[0] * prevAx;
        const dx = cx - prevCx;
        if (Math.abs(dx) >= avgPalm * 0.025) {
          const s = dx > 0 ? 1 : -1;
          if (!dirSequence.length || dirSequence[dirSequence.length - 1] !== s) {
            dirSequence.push(s);
          }
        }
      }
    }
    const reversals = Math.max(0, dirSequence.length - 1);
    const spanX = Number.isFinite(maxX - minX) ? (maxX - minX) : 0;
    const spanY = Number.isFinite(maxY - minY) ? (maxY - minY) : 0;
    const enieDuration = enieWindow.length >= 2 ? (enieWindow[enieWindow.length - 1].at - enieWindow[0].at) : 0;
    const enieMotionOk = (
      enieDuration >= 320 &&
      spanX >= 0.20 * avgPalm &&
      spanX > spanY * 1.10 &&
      reversals >= 2
    );

    const zPts = [];
    let zMinX = Infinity;
    let zMaxX = -Infinity;
    let zMinY = Infinity;
    let zMaxY = -Infinity;
    for (let i = 0; i < recent.length; i += 1) {
      const item = recent[i];
      const ax = item.aspect || 1;
      const px = item.index[0] * ax;
      const py = item.index[1];
      if (px < zMinX) zMinX = px;
      if (px > zMaxX) zMaxX = px;
      if (py < zMinY) zMinY = py;
      if (py > zMaxY) zMaxY = py;
      zPts.push({ x: px, y: py, at: item.at });
    }
    const zSpanX = Number.isFinite(zMaxX - zMinX) ? (zMaxX - zMinX) : 0;
    const zSpanY = Number.isFinite(zMaxY - zMinY) ? (zMaxY - zMinY) : 0;

    const stepThr = 0.14 * avgPalm;
    const anchors = [];
    let anchorDir = 0;
    let minAnchorPt = zPts[0];
    let maxAnchorPt = zPts[0];
    let extremeAnchorPt = zPts[0];
    for (let i = 1; i < zPts.length; i += 1) {
      const pt = zPts[i];
      if (anchorDir === 0) {
        if (pt.x < minAnchorPt.x) minAnchorPt = pt;
        if (pt.x > maxAnchorPt.x) maxAnchorPt = pt;
        if (pt.x - minAnchorPt.x >= stepThr) {
          anchors.push(minAnchorPt);
          anchorDir = 1;
          extremeAnchorPt = pt;
        } else if (maxAnchorPt.x - pt.x >= stepThr) {
          anchors.push(maxAnchorPt);
          anchorDir = -1;
          extremeAnchorPt = pt;
        }
      } else if (anchorDir === 1) {
        if (pt.x >= extremeAnchorPt.x) extremeAnchorPt = pt;
        else if (extremeAnchorPt.x - pt.x >= stepThr) {
          anchors.push(extremeAnchorPt);
          anchorDir = -1;
          extremeAnchorPt = pt;
        }
      } else if (pt.x <= extremeAnchorPt.x) {
        extremeAnchorPt = pt;
      } else if (pt.x - extremeAnchorPt.x >= stepThr) {
        anchors.push(extremeAnchorPt);
        anchorDir = 1;
        extremeAnchorPt = pt;
      }
    }
    if (anchors.length >= 1) {
      const prevAnchor = anchors[anchors.length - 1];
      if (extremeAnchorPt !== prevAnchor) anchors.push(extremeAnchorPt);
    }

    let zMotionOk = false;
    if (anchors.length >= 4 && zSpanX >= 0.36 * avgPalm && zSpanY >= 0.28 * avgPalm) {
      for (let i = 0; i <= anchors.length - 4; i += 1) {
        const [a0, a1, a2, a3] = [anchors[i], anchors[i + 1], anchors[i + 2], anchors[i + 3]];
        if ((a3.at - a0.at) < 420) continue;
        const dx1 = a1.x - a0.x;
        const dy1 = a1.y - a0.y;
        const leg1Ok = Math.abs(dx1) >= 0.22 * avgPalm && Math.abs(dy1) <= Math.abs(dx1) * 0.65;
        const dx2 = a2.x - a1.x;
        const dy2 = a2.y - a1.y;
        const leg2Ok = (dx1 * dx2) < 0 && Math.abs(dx2) >= 0.20 * avgPalm && dy2 >= 0.18 * avgPalm;
        const dx3 = a3.x - a2.x;
        const dy3 = a3.y - a2.y;
        const leg3Ok = (dx1 * dx3) > 0 && Math.abs(dx3) >= 0.20 * avgPalm && Math.abs(dy3) <= Math.abs(dx3) * 0.65;
        if (leg1Ok && leg2Ok && leg3Ok) {
          const segSpanX = Math.max(a0.x, a1.x, a2.x, a3.x) - Math.min(a0.x, a1.x, a2.x, a3.x);
          const segSpanY = Math.max(a0.y, a1.y, a2.y, a3.y) - Math.min(a0.y, a1.y, a2.y, a3.y);
          if (segSpanX >= 0.36 * avgPalm && segSpanY >= 0.28 * avgPalm) {
            zMotionOk = true;
            break;
          }
        }
      }
    }

    let lowestY = -Infinity;
    let maxDropY = 0;
    let hookDx = 0;
    const pFirst = recent[0].pinky;
    let minPinkyYIdx = 0;
    for (let i = 0; i < recent.length; i += 1) {
      if (recent[i].pinky[1] < recent[minPinkyYIdx].pinky[1]) minPinkyYIdx = i;
      if (recent[i].pinky[1] > lowestY) lowestY = recent[i].pinky[1];
    }
    const peakStart = recent[minPinkyYIdx].pinky;
    let bottomIdx = minPinkyYIdx;
    for (let i = minPinkyYIdx; i < recent.length; i += 1) {
      if (recent[i].pinky[1] > recent[bottomIdx].pinky[1]) bottomIdx = i;
    }
    maxDropY = Math.max(lowestY - pFirst[1], recent[bottomIdx].pinky[1] - peakStart[1]);
    if (bottomIdx < recent.length - 1) {
      const bottomItem = recent[bottomIdx];
      const bottomX = bottomItem.pinky[0] * (bottomItem.aspect || 1);
      for (let i = bottomIdx + 1; i < recent.length; i += 1) {
        const dx = recent[i].pinky[0] * (recent[i].aspect || 1) - bottomX;
        if (Math.abs(dx) > Math.abs(hookDx)) hookDx = dx;
      }
    } else if (recent.length >= 4) {
      const split = Math.floor(recent.length * 0.65);
      const lastItem = recent[recent.length - 1];
      const splitItem = recent[split];
      hookDx = lastItem.pinky[0] * (lastItem.aspect || 1) - splitItem.pinky[0] * (splitItem.aspect || 1);
    }
    const jMotionOk = maxDropY >= 0.28 * avgPalm && Math.abs(hookDx) >= 0.16 * avgPalm;

    return {
      enieMotionOk,
      zMotionOk,
      jMotionOk,
      spanX,
      spanY,
      zSpanX,
      zSpanY,
      reversals,
      dropY: maxDropY,
      hookDx
    };
  }

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

    let inRestZone = false;
    let avgWristElevation = 0;
    if (handCount > 0) {
      const torsoHeight = Math.max(0.18, hipLineY - shMidY);
      let restCount = 0;
      let elevSum = 0;
      for (let i = 0; i < handCount; i += 1) {
        const hand = hands[i];
        const w = hand && hand[0];
        if (!w) continue;
        const elev = (hipLineY - w.y) / torsoHeight;
        elevSum += elev;
        const pointingDown = Boolean(
          (hand[12] && hand[12].y > w.y + 0.04) ||
          (hand[8] && hand[8].y > w.y + 0.04)
        );
        if (pointingDown ? (w.y >= 0.92 || elev < 0.05) : (w.y >= 0.89 || elev < 0.12)) {
          restCount += 1;
        }
      }
      avgWristElevation = Number((elevSum / handCount).toFixed(2));
      inRestZone = restCount === handCount;
    }

    let activity = 'reposo';
    if (handCount === 0 || (inRestZone && wristSteady)) activity = 'reposo';
    else if (handCount >= 2 || !wristSteady) activity = 'dinamico';
    else activity = 'estatico';

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

  window.SenaSeguraVisionMath = Object.freeze({
    HAND_EMA_ALPHA,
    POSE_EMA_ALPHA,
    HAND_FEATURES_90,
    TRAJ_SEQ_LEN,
    TRAJ_NUM_FEATURES,
    TRAJ_DYNAMIC_LABELS,
    TRAJ_STATIC_LABEL,
    TRAJ_HISTORY_MAX_MS,
    TRAJ_HISTORY_MAX_FRAMES,
    TRAJ_RESAMPLE_MIN_MS,
    TRAJ_RESAMPLE_MAX_MS,
    DYNAMIC_SEQ_LEN,
    DYNAMIC_NUM_FEATURES,
    VOTE_WINDOW,
    IGNORED_GLOSSES,
    SPACE_TOKEN_LABEL,
    DYNAMIC_POSE_INDICES,
    ALPHABET_JOINT_TRIPLETS,
    GLOSS_SPANISH_MAP,
    PALM_LABEL,
    ZONE_LABEL,
    EXPRESSION_LABEL,
    GESTURES,
    GESTURE_BY_ID,
    HAND_CONNECTIONS_FALLBACK,
    clamp,
    dist3,
    angleDeg,
    normalizeHandedness,
    computePalmOrientation3D,
    computeSpatialContext,
    analyzeNonManualExpressions,
    analyzeTrajectory3D,
    classifyHand,
    resolveMultiHandGesture,
    majorityVoteGesture,
    humanizeGloss,
    assignAnatomicalHands,
    extractDynamicFrameFeatures,
    smoothLandmarksEMA,
    canonicalizeHand3D,
    computePalmNormalUnit,
    extractHand90Features,
    standardizeFeatures,
    standardizeTrajectorySequence,
    resampleTrajectorySequence,
    detectCanonicalHandPostures,
    refineStatic3DLabel,
    analyzeTrajectoryMotion,
    analyzeBiomechanics,
    isWristSteady,
    detectWideArmMotion,
    composeSentence
  });
})();
