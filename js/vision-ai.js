/**
 * SeñaSegura · Módulo "Cámara IA (LSP · TensorFlow.js + MediaPipe)" (Vanilla JS ES6+)
 *
 * - Depende de window.SenaSeguraVisionMath (`js/vision-math.js`) y se integra con `js/main.js` y `js/gemini-lsp.js`.
 * - Precarga silenciosa en segundo plano al iniciar (requestIdleCallback / setTimeout 800 ms, sin bloquear arranque).
 * - Motor continuo responsive con pose_landmarker_full en escritorio (pose_landmarker_lite en dispositivos ligeros),
 *   sincronización dinámica de video/rotación, escalado proporcional de trazos, tolerancia a micro-cortes (8 frames),
 *   auto-pulido LSP silencioso y compatibilidad 100 % con GitHub Pages (rutas relativas sin '/' inicial).
 */
(() => {
  'use strict';

  const M = window.SenaSeguraVisionMath;
  if (!M) return;

  const {
    HAND_EMA_ALPHA,
    POSE_EMA_ALPHA,
    HAND_FEATURES_90,
    TRAJ_SEQ_LEN,
    TRAJ_NUM_FEATURES,
    TRAJ_DYNAMIC_LABELS,
    TRAJ_STATIC_LABEL,
    TRAJ_HISTORY_MAX_MS,
    TRAJ_HISTORY_MAX_FRAMES,
    DYNAMIC_SEQ_LEN,
    DYNAMIC_NUM_FEATURES,
    VOTE_WINDOW,
    IGNORED_GLOSSES,
    SPACE_TOKEN_LABEL,
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
  } = M;

  /* =========================================================
     1. CONSTANTES DE EJECUCIÓN, UMBRALES Y TEXTOS DE UI
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

  const CONFIRM_MS = 320;
  const CONFIRM_FAST_MS = 210;
  const CONFIRM_INDEX_MS = 520;
  const CONFIRM_SPELL_MS = 330;
  const COOLDOWN_MS = 900;
  const SPELL_COOLDOWN_MS = 450;
  const SAME_LETTER_COOLDOWN_MS = 1350;
  const GRACE_MS = 180;
  const HAND_DROPOUT_GRACE_FRAMES = 8;
  const POSE_DROPOUT_GRACE_FRAMES = 8;
  const STATIC_HISTORY_MAX_MS = 900;
  const DYNAMIC_EMIT_LOCK_MS = 1200;
  const DYNAMIC_REPLACE_WINDOW_MS = 1200;
  const ENIE_GRU_MIN_CONF = 0.72;
  const ENIE_STREAK_REQUIRED = 2;
  const ZJ_GRU_MIN_CONF = 0.72;
  const ZJ_STREAK_REQUIRED = 2;
  const ENIE_COMPATIBLE_LABELS = new Set(['N', 'M']);
  const ENIE_INCOMPATIBLE_LABELS = new Set([
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L',
    'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y', 'X'
  ]);
  const Z_INCOMPATIBLE_LABELS = new Set([
    'X', 'Y', 'W', 'V', 'U', 'L', 'B', 'C', 'O', 'A', 'S', 'E', 'M', 'N', 'P', 'Q'
  ]);
  const J_INCOMPATIBLE_LABELS = new Set([
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Z'
  ]);
  const STATIC_SPACE_LABEL = 'ESPACIO';
  const SPELL_SESSION_HOLD_MS = 2800;
  const MAX_TRAIL_POINTS = 14;
  const HUD_TOP2_THROTTLE_MS = 140;
  const MIN_FRAME_INTERVAL_MS = 16;
  const AUX_DETECT_STRIDE = 3;
  const MOTION_WINDOW = 24;
  const DYNAMIC_STREAK_REQUIRED = 2;
  const AUTO_SEND_PAUSE_MS = 3200;
  const AUTO_POLISH_DEBOUNCE_MS = 800;
  const LOAD_TIMEOUT_MS = 30000;
  const SCRIPT_TIMEOUT_MS = 15000;

  const CHAT_SENDER = 'Ciudadano (Cámara IA)';
  const DEFAULT_SENTENCE = 'Muestra una seña y mantenla un instante para empezar la oración.';
  const DEFAULT_LAST_DETECT = 'Última seña: — · Confianza: —';
  const DEFAULT_PROGRESS_LABEL = 'Reconocimiento unificado LSP (118 señas + alfabeto)';

  const STATUS_TEXT = {
    idle: 'Cámara inactiva',
    loading: 'Cargando modelo…',
    live: 'En vivo'
  };

  const PLACEHOLDER_TEXT = {
    idle: 'Pulsa “Activar Cámara” y muestra una o ambas manos. El video se procesa en tu dispositivo: no se graba ni se envía.',
    loading: 'Cargando percepción 3D de señas, orientación y expresión... Permite el acceso a la cámara si el navegador lo solicita.'
  };

  const POSE_UPPER_EDGES = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24]
  ];

  /* =========================================================
     2. ESTADO COMPARTIDO Y PRECARGA DE MODELOS TF.JS + MEDIAPIPE
     ========================================================= */
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

  let visionModulePromise = null;
  let loadedHandConnections = HAND_CONNECTIONS_FALLBACK;
  const scriptPromises = new Map();
  let tfModelsPromise = null;
  let loadedTfModels = null;
  let tfProgressCallback = null;

  function resolveRelativeModelsRoot() {
    const pathname = String(window.location && window.location.pathname ? window.location.pathname : '');
    return /\/pages(?:\/[^/]*)?$/.test(pathname) ? '../models' : './models';
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

  function normalizeKeras3WeightName(rawName, layerClassMap) {
    const slashIdx = typeof rawName === 'string' ? rawName.lastIndexOf('/') : -1;
    if (slashIdx <= 0) return rawName;
    const layerName = rawName.slice(0, slashIdx);
    const slot = rawName.slice(slashIdx + 1);
    const layerClass = layerClassMap.get(layerName);
    if (layerClass === 'Dense') {
      if (slot === 'w_0') return `${layerName}/kernel`;
      if (slot === 'w_1') return `${layerName}/bias`;
    } else if (layerClass === 'BatchNormalization') {
      if (slot === 'w_0') return `${layerName}/gamma`;
      if (slot === 'w_1') return `${layerName}/beta`;
      if (slot === 'w_2') return `${layerName}/moving_mean`;
      if (slot === 'w_3') return `${layerName}/moving_variance`;
    }
    return rawName;
  }

  function normalizeKeras3Dtype(dtypeVal) {
    if (typeof dtypeVal === 'string') return dtypeVal;
    if (dtypeVal && typeof dtypeVal === 'object' && dtypeVal.config && typeof dtypeVal.config.name === 'string') {
      return dtypeVal.config.name;
    }
    return 'float32';
  }

  function normalizeKeras3LayersTopology(topo) {
    const normalizeRefList = (refs) => {
      if (!Array.isArray(refs) || refs.length === 0) return refs;
      return typeof refs[0] === 'string' ? [refs] : refs;
    };
    const layers = Array.isArray(topo.layers)
      ? topo.layers.map((layer) => {
          const cfg = { ...(layer.config || {}) };
          if (Object.prototype.hasOwnProperty.call(cfg, 'dtype')) {
            cfg.dtype = normalizeKeras3Dtype(cfg.dtype);
          }
          if (layer.class_name === 'InputLayer' && Array.isArray(cfg.batch_shape)) {
            cfg.batch_input_shape = cfg.batch_shape;
            delete cfg.batch_shape;
          }
          const inboundNodes = Array.isArray(layer.inbound_nodes)
            ? layer.inbound_nodes.map((node) => {
                if (Array.isArray(node)) return node;
                const args = node && Array.isArray(node.args) ? node.args : [];
                const kwargs = node && node.kwargs && typeof node.kwargs === 'object' ? node.kwargs : {};
                return args
                  .filter((arg) => arg && arg.config && Array.isArray(arg.config.keras_history))
                  .map((arg) => {
                    const h = arg.config.keras_history;
                    return [h[0], h[1] || 0, h[2] || 0, kwargs];
                  });
              })
            : [];
          return {
            class_name: layer.class_name,
            name: layer.name || cfg.name,
            config: cfg,
            inbound_nodes: inboundNodes
          };
        })
      : [];

    return {
      class_name: 'Model',
      config: {
        name: topo.name || 'layers_model',
        layers,
        input_layers: normalizeRefList(topo.input_layers),
        output_layers: normalizeRefList(topo.output_layers)
      },
      keras_version: '2.15.0',
      backend: 'tensorflow'
    };
  }

  function createKeras3LayersIOHandler(dir, modelJson) {
    return {
      async load() {
        const topo = modelJson.modelTopology || {};
        const layerClassMap = new Map();
        if (Array.isArray(topo.layers)) {
          topo.layers.forEach((layer) => {
            if (layer && layer.name) layerClassMap.set(layer.name, layer.class_name);
          });
        }

        const manifests = Array.isArray(modelJson.weightsManifest) ? modelJson.weightsManifest : [];
        const weightSpecs = [];
        const shardBuffers = [];
        let totalBytes = 0;

        for (let g = 0; g < manifests.length; g += 1) {
          const group = manifests[g];
          const groupWeights = Array.isArray(group.weights) ? group.weights : [];
          groupWeights.forEach((w) => {
            weightSpecs.push({
              ...w,
              name: normalizeKeras3WeightName(w.name, layerClassMap)
            });
          });
          const paths = Array.isArray(group.paths) ? group.paths : [];
          for (let p = 0; p < paths.length; p += 1) {
            const shardRes = await withTimeout(fetch(`${dir}/${paths[p]}`, { cache: 'default' }), LOAD_TIMEOUT_MS);
            if (!shardRes.ok) throw new Error(`weights-http-${shardRes.status}`);
            const ab = await shardRes.arrayBuffer();
            shardBuffers.push(new Uint8Array(ab));
            totalBytes += ab.byteLength;
          }
        }

        const merged = new Uint8Array(totalBytes);
        let byteOffset = 0;
        for (let i = 0; i < shardBuffers.length; i += 1) {
          merged.set(shardBuffers[i], byteOffset);
          byteOffset += shardBuffers[i].byteLength;
        }

        return {
          modelTopology: normalizeKeras3LayersTopology(topo),
          format: 'layers-model',
          generatedBy: modelJson.generatedBy,
          convertedBy: modelJson.convertedBy,
          weightSpecs,
          weightData: merged.buffer
        };
      }
    };
  }

  async function loadGraphModelAtDir(dir, expectedMetadataName) {
    const metaRes = await withTimeout(fetch(`${dir}/metadata.json`, { cache: 'default' }), LOAD_TIMEOUT_MS);
    if (!metaRes.ok) throw new Error(`metadata-http-${metaRes.status}`);
    const metadata = await metaRes.json();
    const model = await withTimeout(window.tf.loadGraphModel(`${dir}/model.json`), LOAD_TIMEOUT_MS);
    return { dir, metadata, model, modelFormat: 'graph-model', name: expectedMetadataName };
  }

  async function loadAdaptiveStaticModel(dir, expectedMetadataName) {
    const [metaRes, modelRes] = await Promise.all([
      withTimeout(fetch(`${dir}/metadata.json`, { cache: 'default' }), LOAD_TIMEOUT_MS),
      withTimeout(fetch(`${dir}/model.json`, { cache: 'default' }), LOAD_TIMEOUT_MS)
    ]);
    if (!metaRes.ok) throw new Error(`metadata-http-${metaRes.status}`);
    if (!modelRes.ok) throw new Error(`model-http-${modelRes.status}`);

    const [metadata, modelJson] = await Promise.all([metaRes.json(), modelRes.json()]);
    const declaredFormat = modelJson && typeof modelJson.format === 'string'
      ? modelJson.format.toLowerCase()
      : 'graph-model';

    let model = null;
    if (declaredFormat === 'layers-model') {
      if (typeof window.tf.loadLayersModel !== 'function') {
        throw new Error('tfjs-layers-loader-unavailable');
      }
      const topo = modelJson.modelTopology;
      if (topo && !topo.class_name && Array.isArray(topo.layers)) {
        model = await withTimeout(
          window.tf.loadLayersModel(createKeras3LayersIOHandler(dir, modelJson)),
          LOAD_TIMEOUT_MS
        );
      } else {
        model = await withTimeout(window.tf.loadLayersModel(`${dir}/model.json`), LOAD_TIMEOUT_MS);
      }
    } else {
      model = await withTimeout(window.tf.loadGraphModel(`${dir}/model.json`), LOAD_TIMEOUT_MS);
    }

    return { dir, metadata, model, modelFormat: declaredFormat, name: expectedMetadataName };
  }

  function warmupTfModel(entry, shape) {
    if (!entry || !entry.model || !window.tf) return;
    const dummy = window.tf.zeros(shape, 'float32');
    try {
      const out = window.tf.tidy(() => entry.model.predict(dummy));
      if (Array.isArray(out)) {
        out.forEach((t) => {
          if (t && typeof t.dataSync === 'function') t.dataSync();
          if (t && typeof t.dispose === 'function') t.dispose();
        });
      } else if (out) {
        if (typeof out.dataSync === 'function') out.dataSync();
        if (typeof out.dispose === 'function') out.dispose();
      }
    } finally {
      if (dummy && typeof dummy.dispose === 'function') dummy.dispose();
    }
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
        const [dynamic, alphabet, trajectory] = await Promise.all([
          loadGraphModelAtDir(`${root}/model_palabras_lsp_pucp118`, 'model_palabras_lsp_pucp118'),
          loadAdaptiveStaticModel(`${root}/model_alfabeto_estatico_lsp`, 'model_alfabeto_estatico_lsp'),
          loadGraphModelAtDir(`${root}/model_alfabeto_lsp_dinamico`, 'model_alfabeto_lsp_dinamico')
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

  window.SenaSeguraVision = Object.freeze({
    clamp,
    classifyHand,
    resolveMultiHandGesture,
    majorityVoteGesture,
    computePalmOrientation3D,
    computeSpatialContext,
    analyzeNonManualExpressions,
    analyzeTrajectory3D,
    extractDynamicFrameFeatures,
    canonicalizeHand3D,
    extractHand90Features,
    standardizeFeatures,
    standardizeTrajectorySequence,
    resampleTrajectorySequence,
    detectCanonicalHandPostures,
    refineStatic3DLabel,
    analyzeTrajectoryMotion,
    smoothLandmarksEMA,
    analyzeBiomechanics,
    detectWideArmMotion,
    isWristSteady,
    humanizeGloss,
    composeSentence,
    loadTfModels,
    getLastDescriptor,
    getTfEngineStatus,
    GESTURES
  });

  /* =========================================================
     3. MÓDULO DE INTERFAZ Y CÁMARA
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
    const btnSpeak = $('btn-vision-speak');
    const btnSpace = $('btn-vision-space');
    const btnUndo = $('btn-vision-undo');
    const btnClear = $('btn-vision-clear');
    const sentenceEl = $('vision-sentence');
    const lastDetectEl = $('vision-last-detect');
    const sentNote = $('vision-sent-note');
    const progressBar = $('vision-progress');
    const progressFill = $('vision-progress-fill');
    const progressLabel = $('vision-progress-label');
    const progressValue = $('vision-progress-value');

    if (
      !panel || !video || !canvas || !btnStart || !btnSpeak || !btnUndo ||
      !sentenceEl || !lastDetectEl
    ) {
      return;
    }

    const ctx = canvas.getContext('2d');
    const btnStartLabel = btnStart.querySelector('span') || btnStart;
    const lowPowerDevice =
      window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 4) <= 2;

    let mode = 'idle'; // idle | loading | live
    let sessionToken = 0;
    let stream = null;
    let visionEngine = null;
    let enginePromise = null;
    let tfModels = null;
    let preloadHandle = null;
    let preloadUsingIdle = false;
    let viewportSyncTimer = 0;
    let viewportResizeListener = null;
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
    let missingPoseFrames = 0;
    let speechTimer = null;
    let autoPolishTimer = 0;
    let polishRequestId = 0;
    let sentenceTokens = [];
    let polishedSentenceText = '';
    let polishedTokensSignature = '';
    let dynamicEvalCounter = 0;
    let isDynamicInferring = false;
    let isAlphabetInferring = false;
    let isTrajectoryInferring = false;
    let trajEpoch = 0;
    let lastDynamicEmitAt = 0;
    let lastHudTop2At = 0;
    let lastHudTop2Text = '';
    const dynamicFlatInput = new Float32Array(DYNAMIC_SEQ_LEN * DYNAMIC_NUM_FEATURES);
    const smoothedHandSlots = { Left: null, Right: null };
    const smoothedWorldSlots = { Left: null, Right: null };
    const trajHistory = [];
    const recentStaticHistory = [];
    const trajectoryState = { label: null, prob: 0, at: 0 };
    const trajStreak = { label: null, count: 0 };
    const lastStaticConfirmed = { label: null, at: 0 };
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
    const spellCandidate = { label: null, since: 0, lastSeen: 0, confirmed: false, scoreSum: 0, scoreN: 0, alts: null };

    function setAiReadyState(state) {
      if (!aiReadyEl) return;
      aiReadyEl.setAttribute('data-ready', state);
      if (state === 'ready') aiReadyEl.textContent = 'IA lista';
      else if (state === 'fallback') aiReadyEl.textContent = 'IA básica';
      else aiReadyEl.textContent = 'Preparando IA…';
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
        if (now - lastHudTop2At >= HUD_TOP2_THROTTLE_MS || top2Text === 'Enfoque: esperando seña…') {
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
      spellCandidate.alts = null;
    }

    function resetTrajectory() {
      trajEpoch += 1;
      trajHistory.length = 0;
      trajectoryState.label = null;
      trajectoryState.prob = 0;
      trajectoryState.at = 0;
      trajStreak.label = null;
      trajStreak.count = 0;
    }

    function resetDynamicCandidate() {
      dynCandidate.id = null;
      dynCandidate.streak = 0;
      dynCandidate.lastProb = 0;
      dynCandidate.since = 0;
    }

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
      syncHudVisibility();
    }

    function showNotice(message, { showFallbackAction = false } = {}) {
      if (!notice) return;
      if (!message) {
        notice.hidden = true;
        notice.replaceChildren();
        return;
      }
      if (!showFallbackAction) {
        notice.textContent = message;
        notice.hidden = false;
        return;
      }
      const textSpan = document.createElement('span');
      textSpan.className = 'vision-notice-text';
      textSpan.textContent = message;

      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'btn btn-secondary btn-sm vision-notice-action';
      switchBtn.textContent = 'Cambiar a Texto / Lectura';
      switchBtn.addEventListener('click', () => {
        showNotice('');
        stopCamera();
        if (window.SenaSegura && typeof window.SenaSegura.setChannel === 'function') {
          window.SenaSegura.setChannel('texto');
        }
      });

      notice.replaceChildren(textSpan, switchBtn);
      notice.hidden = false;
    }

    function failCameraToNotice(message) {
      stopCamera({ keepStatus: true });
      setStatus('idle');
      showNotice(message || 'No se pudo acceder a la cámara.', { showFallbackAction: true });
    }

    function setProgress(fraction) {
      const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      if (pct === lastProgressPct) return;
      lastProgressPct = pct;
      progressFill.style.transform = `scaleX(${pct / 100})`;
      progressValue.textContent = `${pct}%`;
      progressBar.setAttribute('aria-valuenow', String(pct));
    }

    function getTokensSignature(tokens) {
      if (!Array.isArray(tokens) || !tokens.length) return '';
      return tokens.map((token) => `${token.kind}:${token.text || ''}`).join('|');
    }

    function countTrailingSpelledLetters(tokens) {
      if (!Array.isArray(tokens) || !tokens.length) return 0;
      let count = 0;
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        if (tokens[i].kind !== 'letter') break;
        count += 1;
      }
      return count;
    }

    function cancelAutoPolish() {
      if (autoPolishTimer) {
        clearTimeout(autoPolishTimer);
        autoPolishTimer = 0;
      }
      polishRequestId += 1;
    }

    function runAutoPolish(reason) {
      autoPolishTimer = 0;
      const geminiApi = window.SenaSeguraGemini;
      if (!geminiApi || typeof geminiApi.isConfigured !== 'function' || !geminiApi.isConfigured()) return;
      if (sentenceTokens.length < 2) return;
      if (reason === 'spell' && countTrailingSpelledLetters(sentenceTokens) < 3) return;
      const snapshotTokens = sentenceTokens.slice();
      const targetSignature = getTokensSignature(snapshotTokens);
      if (!targetSignature || polishedTokensSignature === targetSignature) return;
      const baseText = composeSentence(snapshotTokens, activeSentenceExpression);
      if (!baseText) return;
      const reqId = ++polishRequestId;
      const sessionAtCall = sessionToken;
      const bridge = window.SenaSegura;
      const ctxInfo = bridge && typeof bridge.getContext === 'function' ? bridge.getContext() : {};
      geminiApi.refineLspSentence({
        tokens: snapshotTokens,
        rawText: baseText,
        sector: ctxInfo.sector || '',
        procedure: ctxInfo.procedure || '',
        timeoutMs: 2200
      }).then((result) => {
        if (reqId !== polishRequestId || sessionAtCall !== sessionToken) return;
        if (getTokensSignature(sentenceTokens) !== targetSignature) return;
        if (result && result.text && result.text.trim()) {
          polishedSentenceText = result.text.trim();
          polishedTokensSignature = targetSignature;
          renderSentence();
        }
      }).catch(() => {});
    }

    function scheduleAutoPolish(reason) {
      cancelAutoPolish();
      const geminiApi = window.SenaSeguraGemini;
      if (!geminiApi || typeof geminiApi.isConfigured !== 'function' || !geminiApi.isConfigured()) return;
      if (sentenceTokens.length < 2) return;
      if (reason === 'spell' && countTrailingSpelledLetters(sentenceTokens) < 3) return;
      autoPolishTimer = setTimeout(() => {
        runAutoPolish(reason);
      }, AUTO_POLISH_DEBOUNCE_MS);
    }

    function renderSentence() {
      const text = composeSentence(sentenceTokens, activeSentenceExpression);
      const shownText = (polishedSentenceText && sentenceTokens.length > 0) ? polishedSentenceText : text;
      const hasTrailingSpace = !polishedSentenceText && sentenceTokens.length > 0 && sentenceTokens[sentenceTokens.length - 1].kind === 'space';
      sentenceEl.textContent = shownText ? (hasTrailingSpace ? `${shownText} ␣` : shownText) : DEFAULT_SENTENCE;
      sentenceEl.classList.toggle('is-empty', !shownText);
      const hasTokens = sentenceTokens.length > 0;
      const canReset = hasTokens || Boolean(lastConfirmed);
      btnSpeak.disabled = !hasTokens;
      if (btnSpace) btnSpace.disabled = !hasTokens || hasTrailingSpace;
      btnUndo.disabled = !canReset;
      if (btnClear) btnClear.disabled = !canReset;
    }

    function resetOutput() {
      cancelAutoPolish();
      lastConfirmed = null;
      sentenceTokens = [];
      polishedSentenceText = '';
      polishedTokensSignature = '';
      activeSentenceExpression = 'neutro';
      latestDescriptorSnapshot = null;
      lastStaticConfirmed.label = null;
      lastStaticConfirmed.at = 0;
      Object.keys(lastAddedAt).forEach((key) => delete lastAddedAt[key]);
      lastDetectEl.textContent = DEFAULT_LAST_DETECT;
      sentNote.hidden = true;
      sentNote.textContent = '';
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
      missingPoseFrames = 0;
      lastLetterConfirmedAt = 0;
      recentStaticHistory.length = 0;
      lastStaticConfirmed.label = null;
      lastStaticConfirmed.at = 0;
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

    /* ---------- Cámara, sincronización responsive y ciclo de vida ---------- */
    function syncCanvasToVideo() {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      if (vw <= 0 || vh <= 0) return;
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width = vw;
        canvas.height = vh;
        trailPoints.length = 0;
      }
      if (stage) stage.style.aspectRatio = `${vw} / ${vh}`;
    }

    function scheduleViewportSync() {
      if (viewportSyncTimer) clearTimeout(viewportSyncTimer);
      viewportSyncTimer = setTimeout(() => {
        viewportSyncTimer = 0;
        if (running) syncCanvasToVideo();
      }, 120);
    }

    function bindViewportSyncListeners() {
      if (viewportResizeListener) return;
      viewportResizeListener = scheduleViewportSync;
      video.addEventListener('resize', viewportResizeListener);
      window.addEventListener('orientationchange', viewportResizeListener);
      window.addEventListener('resize', viewportResizeListener);
    }

    function unbindViewportSyncListeners() {
      if (viewportSyncTimer) {
        clearTimeout(viewportSyncTimer);
        viewportSyncTimer = 0;
      }
      if (!viewportResizeListener) return;
      video.removeEventListener('resize', viewportResizeListener);
      window.removeEventListener('orientationchange', viewportResizeListener);
      window.removeEventListener('resize', viewportResizeListener);
      viewportResizeListener = null;
    }

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
      if (video) {
        try {
          video.pause();
        } catch (_) {
          /* ignore */
        }
        video.srcObject = null;
      }
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
      unbindViewportSyncListeners();
      releaseStream();
      clearCanvas();
      if (stage) stage.style.removeProperty('aspect-ratio');
      updateHandsCount(0);
      resetDetection();
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
      const isPortraitMobile = window.innerHeight > window.innerWidth && window.innerWidth <= 1024;
      const idealWidth = isPortraitMobile ? 480 : 640;
      const idealHeight = isPortraitMobile ? 640 : 480;
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: idealWidth }, height: { ideal: idealHeight } },
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
        console.warn('[Cámara IA · CPU fallback]', gpuErr);
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

      const createPoseLandmarker = () => {
        if (!PoseLandmarker) return Promise.resolve(null);
        const preferredPoseUrl = lowPowerDevice ? POSE_MODEL_LITE_URL : POSE_MODEL_FULL_URL;
        const poseOpts = (url) => ({
          baseOptions: { modelAssetPath: url },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.35,
          minPosePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35
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
          minHandDetectionConfidence: 0.35,
          minHandPresenceConfidence: 0.35,
          minTrackingConfidence: 0.35
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
      instance.setOptions({
        maxNumHands: 2,
        modelComplexity: lowPowerDevice ? 0 : 1,
        minDetectionConfidence: 0.35,
        minTrackingConfidence: 0.35
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
        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('video-timeout'));
        }, 6000);
        function onReady() {
          if (video.videoWidth > 0) {
            cleanup();
            resolve();
          }
        }
        function cleanup() {
          clearTimeout(timer);
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('loadedmetadata', onReady);
        }
        video.addEventListener('loadeddata', onReady);
        video.addEventListener('loadedmetadata', onReady);
      });
    }

    function scheduleNextFrame() {
      if (running && mode === 'live') {
        rafId = requestAnimationFrame(loop);
      }
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
        failCameraToNotice(cameraErrorMessage(camResult.reason));
        return;
      }
      stream = camResult.value;

      if (libResult.status === 'rejected') {
        console.warn('[Cámara IA]', libResult.reason);
        failCameraToNotice(modelErrorMessage(libResult.reason));
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

        syncCanvasToVideo();
        bindViewportSyncListeners();
        running = true;
        frameCounter = 0;
        isLegacyProcessing = false;
        lastVideoTime = -1;
        lastSendAt = 0;
        setStatus('live');
        if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
        scheduleNextFrame();
      } catch (err) {
        console.warn('[Cámara IA]', err);
        if (token !== sessionToken) return;
        failCameraToNotice('No se pudo mostrar el video de la cámara.');
      }
    }

    /** Bucle de video ~60 fps: Manos cada frame; Pose cada 2 frames; Face omitido si TF.js activo. */
    function loop() {
      rafId = 0;
      if (!running || !visionEngine || mode !== 'live') return;
      if (video.readyState < 2 || video.paused || video.ended) {
        scheduleNextFrame();
        return;
      }

      const now = performance.now();
      if (now - lastSendAt < MIN_FRAME_INTERVAL_MS || video.currentTime === lastVideoTime) {
        scheduleNextFrame();
        return;
      }
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
                if (rawPose) {
                  missingPoseFrames = 0;
                  latestPoseLandmarks = rawPose;
                  smoothedPoseLandmarks = smoothLandmarksEMA(smoothedPoseLandmarks, rawPose, POSE_EMA_ALPHA, 0.4);
                } else {
                  missingPoseFrames += 1;
                  if (missingPoseFrames > POSE_DROPOUT_GRACE_FRAMES) {
                    latestPoseLandmarks = null;
                    smoothedPoseLandmarks = null;
                  }
                }
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
          scheduleNextFrame();
        } catch (err) {
          console.warn('[Cámara IA]', err);
          if (running && visionEngine && !visionEngine.cpuFallbackUsed) {
            const tokenAtFail = sessionToken;
            visionEngine.cpuFallbackUsed = true;
            running = false;
            createTasksEngine({ forceCpu: true })
              .catch(() => createLegacyEngine())
              .then((cpuEngine) => {
                if (tokenAtFail !== sessionToken || mode !== 'live') return;
                visionEngine = cpuEngine;
                enginePromise = Promise.resolve(cpuEngine);
                running = true;
                lastVideoTime = -1;
                scheduleNextFrame();
              })
              .catch(() => {
                if (tokenAtFail !== sessionToken) return;
                failCameraToNotice('Ocurrió un error al analizar la cámara.');
              });
            return;
          }
          if (running) {
            failCameraToNotice('Ocurrió un error al analizar la cámara.');
          }
        }
      } else if (visionEngine.type === 'legacy') {
        if (!isLegacyProcessing) {
          isLegacyProcessing = true;
          visionEngine.hands
            .send({ image: video })
            .catch((err) => {
              console.warn('[Cámara IA]', err);
              if (running) {
                failCameraToNotice('Ocurrió un error al analizar la cámara.');
              }
            })
            .then(() => {
              isLegacyProcessing = false;
            });
        }
        scheduleNextFrame();
      }
    }

    /* ---------- Overlay biomecánico escalable (#vision-canvas) ---------- */
    function getCanvasUiScale() {
      const minDim = Math.min(canvas.width || 640, canvas.height || 480);
      return clamp(minDim / 480, 0.75, 1.8);
    }

    function drawUpperBodySkeleton(poseLandmarks, framing = 'optimo') {
      if (!overlayEnabled || !Array.isArray(poseLandmarks) || poseLandmarks.length < 17) return;
      const w = canvas.width;
      const h = canvas.height;
      const uiScale = getCanvasUiScale();
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
        ctx.lineWidth = lineW * uiScale;
        ctx.beginPath();

        const nose = poseLandmarks[0];
        const ls = poseLandmarks[11];
        const rs = poseLandmarks[12];
        if (nose && ls && rs && vis(nose) >= 0.20 && vis(ls) >= 0.20 && vis(rs) >= 0.20) {
          ctx.moveTo(nose.x * w, nose.y * h);
          ctx.lineTo(((ls.x + rs.x) / 2) * w, ((ls.y + rs.y) / 2) * h);
        }

        POSE_UPPER_EDGES.forEach(([a, b]) => {
          const pa = poseLandmarks[a];
          const pb = poseLandmarks[b];
          if (!pa || !pb || vis(pa) < 0.20 || vis(pb) < 0.20) return;
          ctx.moveTo(pa.x * w, pa.y * h);
          ctx.lineTo(pb.x * w, pb.y * h);
        });
        ctx.stroke();
      };

      drawSegmentList(halo, 6);
      drawSegmentList(stroke, 3);

      [0, 11, 12, 13, 14, 15, 16, 23, 24].forEach((idx) => {
        const pt = poseLandmarks[idx];
        if (!pt || vis(pt) < 0.20) return;
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, (idx === 0 ? 5.5 : 4.5) * uiScale, 0, Math.PI * 2);
        ctx.fillStyle = nodeFill;
        ctx.fill();
        ctx.lineWidth = 2 * uiScale;
        ctx.strokeStyle = halo;
        ctx.stroke();
      });
      ctx.restore();
    }

    function drawHandEnhanced(landmarks, anatomicalSide = 'Right', palm = null) {
      if (!overlayEnabled || !Array.isArray(landmarks) || landmarks.length < 21) return;
      const uiScale = getCanvasUiScale();
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
        ctx.lineWidth = width * uiScale;
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
      ctx.lineWidth = 1.8 * uiScale;
      landmarks.forEach((p, idx) => {
        const radius = (idx === 0 || idx === 4 || idx === 8 || idx === 20 ? 5 : 3.8) * uiScale;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      if (palm) {
        const cx = ((landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4) * w;
        const cy = ((landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4) * h;
        ctx.beginPath();
        ctx.arc(cx, cy, 8 * uiScale, 0, Math.PI * 2);
        ctx.fillStyle = palm.orientation === 'frente' ? lineColor : haloColor;
        ctx.fill();
        ctx.lineWidth = 2.5 * uiScale;
        ctx.strokeStyle = lineColor;
        ctx.stroke();

        if (palm.dir) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + palm.dir.dx * 16 * uiScale, cy + palm.dir.dy * 16 * uiScale);
          ctx.lineWidth = 2.5 * uiScale;
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
      const uiScale = getCanvasUiScale();
      let totalMove = 0;
      for (let i = 1; i < trailPoints.length; i += 1) {
        totalMove += Math.hypot(trailPoints[i].x - trailPoints[i - 1].x, trailPoints[i].y - trailPoints[i - 1].y);
      }
      if (totalMove < 12 * uiScale) return;

      const high = document.documentElement.getAttribute('data-contrast') === 'high';
      const trailColor = high ? '#F59E0B' : '#38BDF8';

      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < trailPoints.length; i += 1) {
        const frac = i / trailPoints.length;
        ctx.globalAlpha = 0.14 + frac * 0.72;
        ctx.strokeStyle = trailColor;
        ctx.lineWidth = (2 + frac * 4) * uiScale;
        ctx.beginPath();
        ctx.moveTo(trailPoints[i - 1].x, trailPoints[i - 1].y);
        ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
        ctx.stroke();
      }
      const tip = trailPoints[trailPoints.length - 1];
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4.5 * uiScale, 0, Math.PI * 2);
      ctx.fillStyle = trailColor;
      ctx.fill();
      ctx.restore();
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

    /* ---------- Inferencia TensorFlow.js (118 señas + Micro-GRU + Alfabeto 90D) ---------- */
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
      const evalStride = dynCandidate.streak > 0 ? 1 : 2;
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
              const wordAlts = [{ label: word, score: Number(bestProb.toFixed(3)) }];
              if (secondWord && secondWord !== word && secondProb >= 0.08) {
                wordAlts.push({ label: secondWord, score: Number(secondProb.toFixed(3)) });
              }
              cancelAutoPolish();
              polishedSentenceText = '';
              polishedTokensSignature = '';
              sentenceTokens.push({ id: tokenId, kind: 'word', text: word, alts: wordAlts });
              lastDetectEl.textContent = `Última seña: ${word} · Confianza: ${pct}%`;
              renderSentence();
              sentNote.textContent = 'Pausa ~3 s sin manos para enviar o pulsa “Enviar y leer al funcionario”.';
              sentNote.hidden = false;
              scheduleAutoPolish('word');
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

    function feedSpellLetter(label, score, now, alts = null) {
      if (label && label === spellCandidate.label) {
        spellCandidate.lastSeen = now;
        spellCandidate.scoreSum += score;
        spellCandidate.scoreN += 1;
        if (Array.isArray(alts) && alts.length > 0) spellCandidate.alts = alts;
      } else if (spellCandidate.label && now - spellCandidate.lastSeen < GRACE_MS) {
        // Mantiene progreso ante micro-parpadeos
      } else {
        spellCandidate.label = label;
        spellCandidate.since = now;
        spellCandidate.lastSeen = now;
        spellCandidate.confirmed = false;
        spellCandidate.scoreSum = label ? score : 0;
        spellCandidate.scoreN = label ? 1 : 0;
        spellCandidate.alts = label && Array.isArray(alts) && alts.length > 0 ? alts : null;
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
        const prevTok = sentenceTokens.length > 0 ? sentenceTokens[sentenceTokens.length - 1] : null;
        const isSameAsLastToken = Boolean(prevTok && prevTok.id === tokenId);
        const requiredCooldownMs = isSameAsLastToken ? SAME_LETTER_COOLDOWN_MS : SPELL_COOLDOWN_MS;
        const canSpace =
          !isSpace || (sentenceTokens.length > 0 && sentenceTokens[sentenceTokens.length - 1].kind !== 'space');

        if (canSpace && (typeof last !== 'number' || now - last >= requiredCooldownMs)) {
          lastAddedAt[tokenId] = now;
          lastLetterConfirmedAt = now;
          if (isSpace) {
            lastStaticConfirmed.label = null;
            lastStaticConfirmed.at = 0;
          } else {
            lastStaticConfirmed.label = spellCandidate.label;
            lastStaticConfirmed.at = now;
          }
          const token = {
            id: tokenId,
            kind: isSpace ? 'space' : 'letter',
            text: isSpace ? ' ' : spellCandidate.label,
            label: displayChar
          };
          cancelAutoPolish();
          lastConfirmed = token;
          polishedSentenceText = '';
          polishedTokensSignature = '';
          const pushedToken = { id: token.id, kind: token.kind, text: token.text };
          if (!isSpace && Array.isArray(spellCandidate.alts) && spellCandidate.alts.length > 0) {
            pushedToken.alts = spellCandidate.alts.slice(0, 3);
          }
          sentenceTokens.push(pushedToken);
          renderSentence();
          lastDetectEl.textContent = `Última letra: ${displayChar} · Confianza: ${pct}%`;
          sentNote.textContent = 'Letra confirmada. Sigue deletreando, pulsa “Espacio” o “Enviar y leer al funcionario”.';
          sentNote.hidden = false;
          scheduleAutoPolish(isSpace ? 'space' : 'spell');
          resetDynamicCandidate();
        }
      }
    }

    function displaySpellLabel(label) {
      return label === STATIC_SPACE_LABEL || label === '' ? 'Espacio' : label;
    }

    /** Registra la trayectoria timestamped para remuestreo activo [450–1400 ms]. */
    function pushTrajectoryFrame(rawHand, side, aspect, palmNormal, now = performance.now(), worldHand = null) {
      const cur = rawHand.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
      const curW = Array.isArray(worldHand) && worldHand.length >= 21
        ? worldHand.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }))
        : null;
      const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
      const palm = Math.hypot(
        (cur[9].x - cur[0].x) * safeAspect,
        cur[9].y - cur[0].y,
        ((cur[9].z || 0) - (cur[0].z || 0)) * safeAspect
      );
      if (!(palm > 1e-6)) return;

      const worldPalm = curW ? Math.max(1e-4, dist3(curW[9], curW[0])) : palm;
      trajHistory.push({
        at: now,
        wrist: [cur[0].x, cur[0].y, cur[0].z || 0],
        index: [cur[8].x, cur[8].y, cur[8].z || 0],
        pinky: [cur[20].x, cur[20].y, cur[20].z || 0],
        worldWrist: curW ? [curW[0].x, curW[0].y, curW[0].z || 0] : null,
        worldIndex: curW ? [curW[8].x, curW[8].y, curW[8].z || 0] : null,
        worldPinky: curW ? [curW[20].x, curW[20].y, curW[20].z || 0] : null,
        palm,
        worldPalm,
        normal: palmNormal && palmNormal.length >= 3 ? [palmNormal[0], palmNormal[1], palmNormal[2]] : [0, 0, 1],
        flip: normalizeHandedness(side) === 'Left' ? -1 : 1,
        mirrorSign: 1,
        aspect: safeAspect
      });
      while (
        trajHistory.length > TRAJ_HISTORY_MAX_FRAMES ||
        (trajHistory.length > 0 && now - trajHistory[0].at > TRAJ_HISTORY_MAX_MS)
      ) {
        trajHistory.shift();
      }
    }

    function emitDynamicLetter(label, score, now) {
      const pct = Math.round(score * 100);
      const tokenId = `spell:${label}`;
      lastDynamicEmitAt = now;
      lastLetterConfirmedAt = now;
      lastAddedAt[tokenId] = now;

      const lastTok = sentenceTokens.length > 0 ? sentenceTokens[sentenceTokens.length - 1] : null;
      const replaceBase =
        lastTok &&
        lastTok.kind === 'letter' &&
        lastStaticConfirmed.at > 0 &&
        now - lastStaticConfirmed.at <= DYNAMIC_REPLACE_WINDOW_MS &&
        ((label === 'Z' && lastStaticConfirmed.label === 'D' && lastTok.text === 'D') ||
         (label === 'J' && lastStaticConfirmed.label === 'I' && lastTok.text === 'I') ||
         (label === 'Ñ' && lastStaticConfirmed.label === 'N' && lastTok.text === 'N'));

      if (replaceBase) {
        delete lastAddedAt[`spell:${lastStaticConfirmed.label}`];
        const dynAlts = [{ label, score: Number(score.toFixed(3)) }];
        if (lastStaticConfirmed.label && lastStaticConfirmed.label !== label) {
          dynAlts.push({ label: lastStaticConfirmed.label, score: 0.45 });
        }
        sentenceTokens[sentenceTokens.length - 1] = { id: tokenId, kind: 'letter', text: label, alts: dynAlts };
      } else {
        sentenceTokens.push({
          id: tokenId,
          kind: 'letter',
          text: label,
          alts: [{ label, score: Number(score.toFixed(3)) }]
        });
      }
      cancelAutoPolish();
      polishedSentenceText = '';
      polishedTokensSignature = '';
      lastStaticConfirmed.label = null;
      lastStaticConfirmed.at = 0;

      lastConfirmed = { id: tokenId, kind: 'letter', text: label, label: `Letra ${label}` };
      renderSentence();
      lastDetectEl.textContent = `Última letra: Letra ${label} · Confianza: ${pct}%`;
      sentNote.textContent = replaceBase
        ? `Letra ${label} confirmada (reemplazó postura base previa). Sigue deletreando.`
        : 'Letra con trazo confirmada. Sigue deletreando, pulsa “Espacio” o “Enviar y leer al funcionario”.';
      sentNote.hidden = false;
      updateHud({ top2Text: formatTop2Text(label, score) }, now);
      scheduleAutoPolish('spell');

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
      recentStaticHistory.length = 0;
      resetTrajectory();
      setProgress(0);
      if (progressLabel) progressLabel.textContent = DEFAULT_PROGRESS_LABEL;
    }

    function resolveDynamicPostureEmission(probs, labels, motion, postures, evalNow) {
      const probMap = Object.create(null);
      let bestIdx = 0;
      let bestProb = -1;
      for (let i = 0; i < probs.length; i += 1) {
        const lbl = i < labels.length ? labels[i] : TRAJ_STATIC_LABEL;
        probMap[lbl] = probs[i];
        if (probs[i] > bestProb) {
          bestProb = probs[i];
          bestIdx = i;
        }
      }
      const label = bestIdx < labels.length ? labels[bestIdx] : TRAJ_STATIC_LABEL;
      const pJ = probMap.J || 0;
      const pZ = probMap.Z || 0;
      const pEnie = probMap['Ñ'] || 0;
      const pStatic = probMap[TRAJ_STATIC_LABEL] || 0;

      const freshStatic = recentStaticHistory.filter((item) => item && evalNow - item.at <= STATIC_HISTORY_MAX_MS);
      const latestStatic = freshStatic.length > 0 ? freshStatic[freshStatic.length - 1] : null;
      const hasStaticCandidate = (targetSet, minTopScore = 0.20) => freshStatic.some((entry) => {
        if (entry.top1 && targetSet.has(entry.top1) && entry.top1Prob >= 0.45) return true;
        return Array.isArray(entry.top3) && entry.top3.some((c) => c && targetSet.has(c.label) && c.score >= minTopScore);
      });

      let matchedDyn = null;
      const lastPalmNow = trajHistory.length ? (trajHistory[trajHistory.length - 1].palm || 0.08) : 0.08;
      const alphaLabels =
        tfModels &&
        tfModels.alphabet &&
        tfModels.alphabet.metadata &&
        Array.isArray(tfModels.alphabet.metadata.labels)
          ? tfModels.alphabet.metadata.labels
          : [];
      const staticHasFullAlphabet = alphaLabels.length >= 15;
      const staticHasNM = alphaLabels.includes('N') || alphaLabels.includes('M');

      const activeIncompatible =
        latestStatic &&
        evalNow - latestStatic.at <= 500 &&
        (staticHasFullAlphabet || latestStatic.refinedByGeom) &&
        ENIE_INCOMPATIBLE_LABELS.has(latestStatic.top1) &&
        latestStatic.top1Prob >= 0.48;
      const foldedNMPosture = Boolean(postures && postures.enieFoldedPosture);
      const compatibleEnieHistory = !staticHasNM
        ? !postures || !postures.lspUHornsPosture
        : (
            hasStaticCandidate(ENIE_COMPATIBLE_LABELS, 0.28) ||
            (ENIE_COMPATIBLE_LABELS.has(lastStaticConfirmed.label) && evalNow - lastStaticConfirmed.at <= DYNAMIC_REPLACE_WINDOW_MS)
          );
      const eniePostureOk = foldedNMPosture && compatibleEnieHistory && !activeIncompatible;
      const enieGruStrong = pEnie >= ENIE_GRU_MIN_CONF && motion.spanX >= 0.18 * lastPalmNow;
      const enieHybridConsensus = motion.enieMotionOk && pEnie >= 0.32;

      if (eniePostureOk && pStatic < 0.75 && (enieGruStrong || enieHybridConsensus)) {
        const enieScore = Math.min(0.99, Math.max(pEnie, enieGruStrong ? ENIE_GRU_MIN_CONF : 0.72));
        matchedDyn = {
          label: 'Ñ',
          score: enieScore,
          rawProb: Math.max(bestProb, pEnie),
          streakReq: ENIE_STREAK_REQUIRED
        };
      }

      if (!matchedDyn && postures) {
        const zActiveIncompatible = Boolean(
          latestStatic &&
          evalNow - latestStatic.at <= 500 &&
          (staticHasFullAlphabet || latestStatic.refinedByGeom) &&
          Z_INCOMPATIBLE_LABELS.has(latestStatic.top1) &&
          latestStatic.top1Prob >= 0.45
        );
        const zPostureOk = Boolean(postures.indexOnlyExtended && !postures.pinkyExt && !zActiveIncompatible);
        const zGruStrong = pZ >= 0.80 && motion.zSpanX >= 0.30 * lastPalmNow && motion.zSpanY >= 0.22 * lastPalmNow;
        const zHybridConsensus = motion.zMotionOk && pZ >= 0.35 && pStatic < 0.70;
        if (zPostureOk && (zGruStrong || zHybridConsensus)) {
          const zScore = Math.max(pZ, zGruStrong ? 0.80 : 0.72);
          matchedDyn = {
            label: 'Z',
            score: zScore,
            rawProb: Math.max(bestProb, pZ),
            streakReq: ZJ_STREAK_REQUIRED
          };
        }
      }

      if (!matchedDyn && postures) {
        const jActiveIncompatible = Boolean(
          latestStatic &&
          evalNow - latestStatic.at <= 500 &&
          (staticHasFullAlphabet || latestStatic.refinedByGeom) &&
          J_INCOMPATIBLE_LABELS.has(latestStatic.top1) &&
          latestStatic.top1Prob >= 0.48
        );
        const jPostureOk = Boolean(
          !postures.indexExt &&
          !postures.lspUHornsPosture &&
          !jActiveIncompatible &&
          (postures.pinkyOnlyExtended ||
            (hasStaticCandidate(new Set(['I']), 0.30) && !postures.middleExt && !postures.ringExt) ||
            (lastStaticConfirmed.label === 'I' && evalNow - lastStaticConfirmed.at <= DYNAMIC_REPLACE_WINDOW_MS))
        );
        const jGruStrong = pJ >= ZJ_GRU_MIN_CONF && motion.dropY >= 0.18 * lastPalmNow;
        const jHybridConsensus = motion.jMotionOk && pJ >= 0.30;
        if (jPostureOk && pStatic < 0.70 && (jGruStrong || jHybridConsensus)) {
          const jScore = Math.max(pJ, jGruStrong ? ZJ_GRU_MIN_CONF : 0.72);
          matchedDyn = {
            label: 'J',
            score: jScore,
            rawProb: Math.max(bestProb, pJ),
            streakReq: ZJ_STREAK_REQUIRED
          };
        }
      }

      if (matchedDyn) {
        if (trajStreak.label === matchedDyn.label) {
          trajStreak.count += 1;
        } else {
          trajStreak.label = matchedDyn.label;
          trajStreak.count = 1;
        }
        if (trajStreak.count >= matchedDyn.streakReq) {
          return {
            emit: true,
            label: matchedDyn.label,
            score: matchedDyn.score,
            rawLabel: matchedDyn.label,
            rawProb: matchedDyn.rawProb
          };
        }
        return {
          emit: false,
          label: matchedDyn.label,
          score: matchedDyn.rawProb,
          rawLabel: label,
          rawProb: bestProb
        };
      }

      trajStreak.label = null;
      trajStreak.count = 0;
      return { emit: false, label, score: bestProb, rawLabel: label, rawProb: bestProb };
    }

    function evaluateTrajectoryGru(side, aspect, postures, now = performance.now()) {
      const entry = tfModels && tfModels.trajectory;
      if (!entry || !entry.model || !window.tf || isTrajectoryInferring) return;
      const resampled = resampleTrajectorySequence(trajHistory, TRAJ_SEQ_LEN, now, { dzDamping: 0.35 });
      if (!resampled || resampled.length < TRAJ_SEQ_LEN) return;

      const meta = entry.metadata || {};
      const labels = Array.isArray(meta.labels) ? meta.labels : [];
      const flat = standardizeTrajectorySequence(resampled, meta.scalerMean, meta.scalerStd);
      const tokenAtCall = sessionToken;
      const epochAtCall = trajEpoch;
      const postureSnapshot = postures ? { ...postures } : null;
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
          const evalNow = performance.now();
          const motion = analyzeTrajectoryMotion(trajHistory, evalNow);
          const decision = resolveDynamicPostureEmission(probs, labels, motion, postureSnapshot || {}, evalNow);

          trajectoryState.label = decision.rawLabel;
          trajectoryState.prob = decision.rawProb;
          trajectoryState.at = evalNow;

          if (decision.emit && evalNow - lastDynamicEmitAt >= DYNAMIC_EMIT_LOCK_MS) {
            emitDynamicLetter(decision.label, decision.score, evalNow);
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

    function evaluateAlphabetTf(raw90, pts, quickSteady, now, singleHandCtx = null, aspect = 4 / 3) {
      const alphaEntry = tfModels && tfModels.alphabet;
      if (!alphaEntry || !alphaEntry.model || !window.tf || isAlphabetInferring) return;

      const meta = alphaEntry.metadata || {};
      const threshold = typeof meta.confidenceThreshold === 'number' ? meta.confidenceThreshold : 0.72;
      const labels = Array.isArray(meta.labels) ? meta.labels : [];
      const features = standardizeFeatures(raw90, meta.scalerMean, meta.scalerStd);
      const tokenAtCall = sessionToken;
      const epochAtCall = trajEpoch;
      const ptsSnapshot = Array.isArray(pts) ? pts.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
      const posturesSnapshot = detectCanonicalHandPostures(ptsSnapshot);
      const geometricId = singleHandCtx
        ? classifyHand(singleHandCtx.primaryHand, aspect, singleHandCtx.worldFor90, { handedness: singleHandCtx.rawMpSide }).id
        : null;
      const steadyAtCall = Boolean(quickSteady);
      isAlphabetInferring = true;

      let inputTensor = null;
      let outTensor = null;
      try {
        inputTensor = window.tf.tensor2d(features, [1, HAND_FEATURES_90], 'float32');
        outTensor = window.tf.tidy(() => {
          const out = alphaEntry.model.predict(inputTensor);
          if (Array.isArray(out)) {
            for (let i = 1; i < out.length; i += 1) {
              if (out[i] && typeof out[i].dispose === 'function') out[i].dispose();
            }
            return out[0];
          }
          return out;
        });
      } catch (err) {
        isAlphabetInferring = false;
        console.warn('[Cámara IA · Alfabeto 3D]', err);
        return;
      } finally {
        if (inputTensor && typeof inputTensor.dispose === 'function') {
          inputTensor.dispose();
        }
      }

      if (!outTensor || typeof outTensor.data !== 'function') {
        isAlphabetInferring = false;
        return;
      }

      outTensor
        .data()
        .then((probs) => {
          if (tokenAtCall !== sessionToken || epochAtCall !== trajEpoch || !running || dynCandidate.streak > 0) return;
          const evalNow = performance.now();

          const ranked = [];
          for (let i = 0; i < probs.length; i += 1) {
            ranked.push({ label: i < labels.length ? labels[i] : '', score: probs[i] });
          }
          ranked.sort((a, b) => b.score - a.score);
          const top3 = ranked.slice(0, 3);
          const refined = refineStatic3DLabel(top3, ptsSnapshot, posturesSnapshot, {
            knownLabels: labels,
            geometricId
          });

          const rawLabel = refined ? refined.label : (top3[0] ? top3[0].label : '');
          const bestProb = refined ? refined.score : (top3[0] ? top3[0].score : 0);
          const secondCandidate = top3.find((c) => c && c.label !== rawLabel) || top3[1];
          const secondLabelRaw = secondCandidate ? secondCandidate.label : '';
          const secondProb = secondCandidate ? secondCandidate.score : 0;

          recentStaticHistory.push({
            at: evalNow,
            top1: rawLabel,
            top1Prob: bestProb,
            top3,
            postures: posturesSnapshot,
            refinedByGeom: Boolean(refined && refined.refined)
          });
          while (
            recentStaticHistory.length > 0 &&
            (evalNow - recentStaticHistory[0].at > STATIC_HISTORY_MAX_MS || recentStaticHistory.length > 24)
          ) {
            recentStaticHistory.shift();
          }

          const staticAllowed = steadyAtCall && evalNow - lastDynamicEmitAt >= DYNAMIC_EMIT_LOCK_MS;

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

          const spellAlts = [];
          if (rawLabel && rawLabel !== STATIC_SPACE_LABEL) {
            spellAlts.push({ label: rawLabel, score: Number(bestProb.toFixed(3)) });
          }
          top3.forEach((cand) => {
            if (
              cand &&
              cand.label &&
              cand.label !== STATIC_SPACE_LABEL &&
              cand.label !== rawLabel &&
              cand.score >= 0.05 &&
              spellAlts.length < 3
            ) {
              spellAlts.push({ label: cand.label, score: Number(cand.score.toFixed(3)) });
            }
          });
          feedSpellLetter(resolvedLabel, resolvedScore, evalNow, spellAlts);
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

    /* ---------- Procesamiento de resultados MediaPipe (helpers desacoplados) ---------- */
    function handleNoHandsFrame(poseForFrame, aspect, now) {
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
        ctx.save();
        ctx.globalAlpha = 0.72;
        ['Right', 'Left'].forEach((side) => {
          const cachedLm = smoothedHandSlots[side];
          if (cachedLm) {
            const palm = computePalmOrientation3D(
              cachedLm.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect })),
              side
            );
            drawHandEnhanced(cachedLm, side, palm);
          }
        });
        ctx.restore();
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
    }

    function buildSmoothedHandEntries(rawLandmarks, allHandedness, allWorldLandmarks, poseForFrame) {
      const assigned = assignAnatomicalHands(rawLandmarks, allHandedness, poseForFrame);
      smoothedHandSlots.Left = assigned.Left
        ? smoothLandmarksEMA(smoothedHandSlots.Left, assigned.Left, HAND_EMA_ALPHA)
        : null;
      smoothedHandSlots.Right = assigned.Right
        ? smoothLandmarksEMA(smoothedHandSlots.Right, assigned.Right, HAND_EMA_ALPHA)
        : null;

      const rawMpPrimarySide = rawLandmarks.length === 1
        ? normalizeHandedness(allHandedness[0] && allHandedness[0][0])
        : null;

      if (rawLandmarks.length === 1 && Array.isArray(allWorldLandmarks[0]) && allWorldLandmarks[0].length >= 21) {
        const otherSide = rawMpPrimarySide === 'Right' ? 'Left' : 'Right';
        smoothedWorldSlots[rawMpPrimarySide] = smoothLandmarksEMA(
          smoothedWorldSlots[rawMpPrimarySide],
          allWorldLandmarks[0],
          HAND_EMA_ALPHA,
          0.5
        );
        smoothedWorldSlots[otherSide] = null;
      } else {
        smoothedWorldSlots.Left = null;
        smoothedWorldSlots.Right = null;
      }

      const handEntries = [];
      ['Right', 'Left'].forEach((side) => {
        if (smoothedHandSlots[side]) {
          const defaultRawSide = side === 'Left' ? 'Right' : 'Left';
          handEntries.push({
            side,
            landmarks: smoothedHandSlots[side],
            rawMpSide: rawLandmarks.length === 1 && rawMpPrimarySide ? rawMpPrimarySide : defaultRawSide
          });
        }
      });

      if (!handEntries.length) {
        rawLandmarks.forEach((lm, idx) => {
          const rawMpSide = normalizeHandedness(allHandedness[idx] && allHandedness[idx][0]);
          const side = rawMpSide === 'Left' ? 'Right' : 'Left';
          handEntries.push({ side, landmarks: lm, rawMpSide });
        });
      }
      return handEntries;
    }

    function renderVisionOverlay(handEntries, poseForFrame, bio, aspect, now) {
      pushTrailPoint(handEntries[0].landmarks, now);
      drawUpperBodySkeleton(poseForFrame, bio.framing);
      drawMotionTrail();

      handEntries.forEach(({ side, landmarks }) => {
        const palm = computePalmOrientation3D(
          landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect })),
          side
        );
        drawHandEnhanced(landmarks, side, palm);
      });
    }

    function runNeuralVisionFlow(activeTf, handEntries, quickSteady, bio, aspect, now) {
      tfModels = activeTf;

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
      let singleHandCtx = null;
      if (handEntries.length >= 2) {
        lastLetterConfirmedAt = 0;
        wristMacroBuffer.length = 0;
        recentStaticHistory.length = 0;
        resetTrajectory();
        if (spellCandidate.label || spellTrackBuffer.length > 0) {
          resetSpellCandidate();
          spellTrackBuffer.length = 0;
        }
      } else {
        const primaryEntry = handEntries[0];
        const h0 = primaryEntry.landmarks;
        const rawMpSide = primaryEntry.rawMpSide;
        const worldFor90 =
          smoothedWorldSlots[rawMpSide] ||
          h0.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect }));
        const pts3d = canonicalizeHand3D(worldFor90, rawMpSide);
        const curPostures = detectCanonicalHandPostures(pts3d);
        singleHandCtx = { primaryHand: h0, rawMpSide, worldFor90, pts3d, curPostures };

        const palmSize0 = Math.hypot((h0[9].x - h0[0].x) * aspect, h0[9].y - h0[0].y) || 0.1;
        if (wristMacroBuffer.length >= MAX_WRIST_MACRO) wristMacroBuffer.shift();
        wristMacroBuffer.push({
          x: h0[0].x,
          y: h0[0].y,
          palmSize: palmSize0,
          elbowDeg: bio.rightElbowDeg !== null ? bio.rightElbowDeg : bio.leftElbowDeg
        });
        const wideArmMotion = detectWideArmMotion(wristMacroBuffer);
        const tracingDynamicLetter = Boolean(
          curPostures.pinkyOnlyExtended ||
          curPostures.indexOnlyExtended ||
          curPostures.enieFoldedPosture ||
          (lastStaticConfirmed.at > 0 &&
            now - lastStaticConfirmed.at <= DYNAMIC_REPLACE_WINDOW_MS &&
            (lastStaticConfirmed.label === 'I' ||
              lastStaticConfirmed.label === 'D' ||
              lastStaticConfirmed.label === 'N' ||
              lastStaticConfirmed.label === 'M')) ||
          recentStaticHistory.some(
            (h) =>
              h &&
              ((now - h.at <= 700 && (h.top1 === 'I' || h.top1 === 'D')) ||
                (now - h.at <= 800 && (h.top1 === 'N' || h.top1 === 'M')))
          )
        );
        if (wideArmMotion && !tracingDynamicLetter) lastLetterConfirmedAt = 0;
        const recentSpell = lastLetterConfirmedAt > 0 && now - lastLetterConfirmedAt <= SPELL_SESSION_HOLD_MS;
        const steadySingleHand = bio.activity === 'estatico' || quickSteady || Boolean(spellCandidate.label) || tracingDynamicLetter;
        spellingSessionActive = (!wideArmMotion || tracingDynamicLetter) && (recentSpell || steadySingleHand);
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

      const smoothedResults = {
        landmarks: handEntries.map((entry) => entry.landmarks),
        handedness: handEntries.map((entry) => [
          { categoryName: entry.side === 'Left' ? 'Right' : 'Left', score: 0.92 }
        ])
      };

      evaluateDynamicWordsTf(smoothedResults, now, handEntries.length, bio, {
        pauseWordDispatch: spellingSessionActive
      });

      if (handEntries.length === 1 && singleHandCtx && dynCandidate.streak === 0 && (activeTf.alphabet || activeTf.trajectory)) {
        const { primaryHand, rawMpSide, worldFor90, pts3d, curPostures } = singleHandCtx;
        const raw90 = extractHand90Features(worldFor90, rawMpSide);
        const palmNormal3d = [raw90[78], raw90[79], raw90[80]];
        if (activeTf.trajectory) {
          pushTrajectoryFrame(primaryHand, rawMpSide, aspect, palmNormal3d, now, worldFor90);
          evaluateTrajectoryGru(rawMpSide, aspect, curPostures, now);
        }
        if (activeTf.alphabet) {
          evaluateAlphabetTf(raw90, pts3d, quickSteady, now, singleHandCtx, aspect);
        }
      }
    }

    function runGeometricFallbackFlow(handEntries, allWorldLandmarks, allHandedness, poseForFrame, bio, aspect, now) {
      const handsForFrame = handEntries.map((entry) => entry.landmarks);
      const spatial = computeSpatialContext(handsForFrame[0], allWorldLandmarks[0] || null, poseForFrame, handsForFrame);
      const nonManual = analyzeNonManualExpressions(latestFaceBlendshapes, latestFaceLandmarks);

      pushMotionFrame(handsForFrame[0], allWorldLandmarks[0] || null, spatial, aspect, now);
      const trajectory = analyzeTrajectory3D(motionBuffer);

      const classifiedHands = handEntries.map((entry, idx) => {
        const worldPts = allWorldLandmarks[idx] || null;
        const handedEntry = allHandedness[idx] && allHandedness[idx][0];
        const score = handedEntry && typeof handedEntry.score === 'number' ? handedEntry.score : 0.9;
        const palm = computePalmOrientation3D(
          worldPts || entry.landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect })),
          entry.rawMpSide
        );
        const { id: staticId } = classifyHand(entry.landmarks, aspect, worldPts, {
          handedness: entry.rawMpSide,
          palmOrientation: palm
        });
        return { id: staticId, score, palm };
      });

      const resolved = resolveMultiHandGesture(classifiedHands, detection.id, { spatial, nonManual, trajectory });
      const primaryPalm = (classifiedHands[0] && classifiedHands[0].palm) || null;
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
        handleNoHandsFrame(poseForFrame, aspect, now);
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

      const handEntries = buildSmoothedHandEntries(rawLandmarks, allHandedness, allWorldLandmarks, poseForFrame);
      const handsForFrame = handEntries.map((entry) => entry.landmarks);

      if (handsForFrame.length === 1) {
        const h0 = handsForFrame[0];
        const h0Aspect = h0.map((p) => ({ x: p.x * aspect, y: p.y }));
        const palm0 = Math.hypot(h0Aspect[9].x - h0Aspect[0].x, h0Aspect[9].y - h0Aspect[0].y) || 0.1;
        if (spellTrackBuffer.length >= 6) spellTrackBuffer.shift();
        spellTrackBuffer.push({ palmSize: palm0, landmarks: h0Aspect });
      }
      const quickSteady = isWristSteady(spellTrackBuffer, 5);
      const bio = analyzeBiomechanics(poseForFrame, handsForFrame, quickSteady, aspect);

      renderVisionOverlay(handEntries, poseForFrame, bio, aspect, now);

      const activeTf = tfModels || loadedTfModels;
      if (activeTf && (activeTf.dynamic || activeTf.alphabet || activeTf.trajectory)) {
        runNeuralVisionFlow(activeTf, handEntries, quickSteady, bio, aspect, now);
        return;
      }

      runGeometricFallbackFlow(handEntries, allWorldLandmarks, allHandedness, poseForFrame, bio, aspect, now);
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
      if (fastConfirm) targetMs = CONFIRM_FAST_MS;
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
      if (!meta) {
        return `Última seña: ${gesture.label} · Confianza: ${confidencePct}%`;
      }
      const zoneText = (meta.spatial && ZONE_LABEL[meta.spatial.zone]) || 'Neutro';
      const exprCode = meta.nonManual ? meta.nonManual.expression : 'neutro';
      const exprTag = EXPRESSION_LABEL[exprCode] ? ` · Modo: ${EXPRESSION_LABEL[exprCode]}` : '';
      return `Última seña: ${gesture.label} · Palma: ${meta.palmText} · Zona: ${zoneText} · Confianza: ${confidencePct}%${exprTag}`;
    }

    function confirmGesture(id, confidencePct, source, meta = null) {
      const gesture = GESTURE_BY_ID[id];
      if (!gesture) return;
      lastConfirmed = gesture;

      if (meta && meta.nonManual && meta.nonManual.expression && meta.nonManual.expression !== 'neutro') {
        activeSentenceExpression = meta.nonManual.expression;
      }

      lastDetectEl.textContent = formatLastDetectLine(gesture, confidencePct, source, meta);

      const now = performance.now();
      const last = lastAddedAt[id];
      const canAdd = typeof last !== 'number' || now - last >= COOLDOWN_MS;
      if (canAdd) {
        lastAddedAt[id] = now;
        const isLetter = gesture.kind === 'letter';
        const isSpace = gesture.kind === 'space';
        cancelAutoPolish();
        polishedSentenceText = '';
        polishedTokensSignature = '';
        sentenceTokens.push({
          id,
          kind: isSpace ? 'space' : (isLetter ? 'letter' : 'word'),
          text: isSpace ? ' ' : (isLetter ? gesture.letter : gesture.phrase)
        });
        renderSentence();
        sentNote.textContent = (isLetter || isSpace)
          ? 'Letra añadida. Sigue deletreando, pulsa “Espacio” o “Enviar y leer al funcionario”.'
          : 'Baja las manos ~3 s para enviar o pulsa “Enviar y leer al funcionario”.';
        sentNote.hidden = false;
        scheduleAutoPolish(isSpace ? 'space' : (isLetter ? 'spell' : 'word'));
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

    function finalizeAndDispatchSentence(text, auto) {
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

    async function sendSentence({ auto = false } = {}) {
      if (sentenceTokens.length === 0) return;
      const tokensSnapshot = sentenceTokens.slice();
      const baseText = composeSentence(tokensSnapshot, activeSentenceExpression);
      const currentSignature = getTokensSignature(tokensSnapshot);
      const alreadyPolished = Boolean(polishedSentenceText && polishedTokensSignature === currentSignature);
      const textBeforeSend = alreadyPolished ? polishedSentenceText : baseText;
      cancelAutoPolish();

      sentenceTokens = [];
      polishedSentenceText = '';
      polishedTokensSignature = '';
      activeSentenceExpression = 'neutro';
      renderSentence();

      const hasPolishableContent =
        tokensSnapshot.length >= 2 || (tokensSnapshot.length === 1 && tokensSnapshot[0].kind === 'word');
      const geminiApi = window.SenaSeguraGemini;
      const canUseGemini =
        !alreadyPolished &&
        hasPolishableContent &&
        geminiApi &&
        typeof geminiApi.isConfigured === 'function' &&
        geminiApi.isConfigured() &&
        typeof geminiApi.refineLspSentence === 'function';

      if (!canUseGemini) {
        finalizeAndDispatchSentence(textBeforeSend, auto);
        return;
      }

      const tokenAtSend = sessionToken;
      const bridge = window.SenaSegura;
      const ctxInfo = bridge && typeof bridge.getContext === 'function' ? bridge.getContext() : {};
      sentNote.textContent = 'Refinando oración LSP con Gemini…';
      sentNote.hidden = false;

      try {
        const result = await geminiApi.refineLspSentence({
          tokens: tokensSnapshot,
          rawText: textBeforeSend,
          sector: ctxInfo.sector || '',
          procedure: ctxInfo.procedure || '',
          timeoutMs: 2200
        });
        if (tokenAtSend !== sessionToken) return;
        const finalText = result && result.text ? result.text : textBeforeSend;
        finalizeAndDispatchSentence(finalText, auto);
      } catch (_) {
        if (tokenAtSend !== sessionToken) return;
        finalizeAndDispatchSentence(textBeforeSend, auto);
      }
    }

    function insertSpace() {
      if (sentenceTokens.length === 0 || sentenceTokens[sentenceTokens.length - 1].kind === 'space') return;
      cancelAutoPolish();
      polishedSentenceText = '';
      polishedTokensSignature = '';
      sentenceTokens.push({ id: `spell:${SPACE_TOKEN_LABEL}`, kind: 'space', text: ' ' });
      lastLetterConfirmedAt = performance.now();
      resetSpellCandidate();
      resetTrajectory();
      renderSentence();
      sentNote.textContent = 'Espacio insertado. Continúa deletreando la siguiente palabra.';
      sentNote.hidden = false;
      scheduleAutoPolish('space');
    }

    function undoLast() {
      if (sentenceTokens.length > 0) {
        cancelAutoPolish();
        polishedSentenceText = '';
        polishedTokensSignature = '';
        const removed = sentenceTokens.pop();
        delete lastAddedAt[removed.id];
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
      recentStaticHistory.length = 0;
      resetDynamicCandidate();
      resetSpellCandidate();
      resetTrajectory();
      sentNote.textContent = 'Texto borrado. Listo para una nueva seña o deletreo.';
      sentNote.hidden = false;
    }

    function releaseOnExit() {
      cancelAutoPolish();
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
    }

    function bindVisionEvents() {
      btnStart.addEventListener('click', () => {
        if (mode === 'loading' || mode === 'live') {
          resetToIdle();
          btnStart.focus();
          return;
        }
        startCamera();
      });

      btnSpeak.addEventListener('click', () => sendSentence({ auto: false }));
      if (btnSpace) btnSpace.addEventListener('click', insertSpace);
      btnUndo.addEventListener('click', undoLast);
      if (btnClear) btnClear.addEventListener('click', clearAllOutput);

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

      window.addEventListener('beforeunload', releaseOnExit);
      window.addEventListener('pagehide', releaseOnExit);
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

    bindVisionEvents();

    if ('speechSynthesis' in window && typeof window.speechSynthesis.getVoices === 'function') {
      window.speechSynthesis.getVoices();
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
