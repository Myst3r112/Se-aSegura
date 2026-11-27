/**
 * SeñaSegura · Capa Híbrida Opcional Gemini LSP (gemini-3.8-flash)
 * Refina oraciones de Lengua de Señas Peruana (LSP, Ley N.° 29535) únicamente a partir de
 * glosas y letras detectadas localmente (texto puro; jamás video ni imágenes, Ley N.° 29733).
 *
 * Modos soportados:
 *   a) Proxy URL (producción GitHub Pages / Cloudflare Worker): window.SENASEGURA_GEMINI_PROXY_URL
 *      o localStorage.getItem('senasegura_gemini_proxy').
 *   b) Clave de sesión temporal (demo / prueba local): sessionStorage.getItem('senasegura_gemini_key'),
 *      borrada automáticamente al cerrar pestaña o disparar el evento 'senasegura:purge'.
 */
(function () {
  'use strict';

  const DEFAULT_MODEL = 'gemini-3.8-flash';
  const DEFAULT_PROXY_URL = 'https://senasegura-gemini-lsp.jhostynvilchez2606.workers.dev';
  const PROXY_STORAGE_KEY = 'senasegura_gemini_proxy';
  const SESSION_KEY_STORAGE_KEY = 'senasegura_gemini_key';
  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const DEFAULT_TIMEOUT_MS = 4500;
  const MAX_OUTPUT_CHARS = 240;

  const LSP_SYSTEM_INSTRUCTION = [
    'Eres el corrector gramatical y dactilológico oficial de SeñaSegura, especializado EXCLUSIVAMENTE en Lengua de Señas Peruana (LSP, Ley N.° 29535) y en español peruano claro, formal y respetuoso para atención presencial en ventanilla (bancos, comisarías, centros de salud y municipalidades).',
    'REGLAS ESTRICTAS:',
    '1. Usa únicamente gramática y léxico de la Lengua de Señas Peruana (LSP). PROHIBIDO aplicar convenciones de ASL (EE. UU.), LSE (España) o LSM (México).',
    '2. PROHIBIDO inventar, asumir o agregar datos que el ciudadano no haya señado (montos, números de DNI, fechas, nombres o trámites nuevos).',
    '3. Las glosas llegan a menudo en orden LSP (Tema-Comentario / SOV o interrogativo al final). Redáctalas en una sola oración natural, breve y fiel en primera persona ("Necesito...", "Quiero consultar...", "Por favor...").',
    '4. Para palabras deletreadas (`kind: "letter"`), revisa las alternativas Top-3 (`alts`) y el contexto de sede/trámite únicamente para corregir errores evidentes del reconocedor entre señas dactilológicas similares en LSP (U/V/R, P/K/Q, M/N, D/Z, I/J, C/O/E). Preserva intactas las siglas peruanas como DNI, RENIEC, SIS, RUC, SUNAT, BCP o AFP.',
    '5. Devuelve SOLO la oración final lista para leer al funcionario, sin comillas, sin listas y sin explicaciones.'
  ].join('\n');

  function safeStorageGet(storage, key) {
    try {
      return storage && typeof storage.getItem === 'function' ? storage.getItem(key) || '' : '';
    } catch (_) {
      return '';
    }
  }

  function safeStorageSet(storage, key, val) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return;
      if (val) storage.setItem(key, val);
      else storage.removeItem(key);
    } catch (_) {
      /* Almacenamiento restringido */
    }
  }

  function safeStorageRemove(storage, key) {
    try {
      if (storage && typeof storage.removeItem === 'function') storage.removeItem(key);
    } catch (_) {
      /* Ignorar error */
    }
  }

  function isValidHttpUrl(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  function isConfiguredProxyUrl(value) {
    return isValidHttpUrl(value) && !/REEMPLAZA-CON-TU-WORKER/i.test(value);
  }

  function getConfig() {
    const windowProxy =
      typeof window.SENASEGURA_GEMINI_PROXY_URL === 'string' ? window.SENASEGURA_GEMINI_PROXY_URL.trim() : '';
    if (isConfiguredProxyUrl(windowProxy)) {
      return Object.freeze({
        active: true,
        mode: 'proxy',
        source: 'window',
        proxyUrl: windowProxy,
        hasSessionKey: false,
        model: DEFAULT_MODEL
      });
    }

    const defaultProxy = typeof DEFAULT_PROXY_URL === 'string' ? DEFAULT_PROXY_URL.trim() : '';
    if (isConfiguredProxyUrl(defaultProxy)) {
      return Object.freeze({
        active: true,
        mode: 'proxy',
        source: 'default',
        proxyUrl: defaultProxy,
        hasSessionKey: false,
        model: DEFAULT_MODEL
      });
    }

    const storedProxy = safeStorageGet(window.localStorage, PROXY_STORAGE_KEY).trim();
    if (isConfiguredProxyUrl(storedProxy)) {
      return Object.freeze({
        active: true,
        mode: 'proxy',
        source: 'localStorage',
        proxyUrl: storedProxy,
        hasSessionKey: Boolean(safeStorageGet(window.sessionStorage, SESSION_KEY_STORAGE_KEY).trim()),
        model: DEFAULT_MODEL
      });
    }

    const sessionKey = safeStorageGet(window.sessionStorage, SESSION_KEY_STORAGE_KEY).trim();
    if (sessionKey) {
      return Object.freeze({
        active: true,
        mode: 'sessionKey',
        source: 'sessionStorage',
        proxyUrl: '',
        hasSessionKey: true,
        model: DEFAULT_MODEL
      });
    }

    return Object.freeze({
      active: false,
      mode: 'none',
      source: 'none',
      proxyUrl: '',
      hasSessionKey: false,
      model: DEFAULT_MODEL
    });
  }

  function isConfigured() {
    return Boolean(getConfig().active);
  }

  function emitConfigChange() {
    document.dispatchEvent(new CustomEvent('senasegura:geminichange', { detail: getConfig() }));
  }

  function saveConfig({ proxyUrl = '', apiKey = '' } = {}) {
    const cleanProxy = String(proxyUrl || '').trim();
    const cleanKey = String(apiKey || '').trim();

    if (cleanProxy && !isValidHttpUrl(cleanProxy)) {
      throw new Error('La URL del proxy debe empezar con https:// o http://.');
    }

    safeStorageSet(window.localStorage, PROXY_STORAGE_KEY, cleanProxy);
    if (cleanKey) {
      safeStorageSet(window.sessionStorage, SESSION_KEY_STORAGE_KEY, cleanKey);
    } else {
      safeStorageRemove(window.sessionStorage, SESSION_KEY_STORAGE_KEY);
    }
    emitConfigChange();
    return getConfig();
  }

  function disconnect() {
    safeStorageRemove(window.localStorage, PROXY_STORAGE_KEY);
    safeStorageRemove(window.sessionStorage, SESSION_KEY_STORAGE_KEY);
    emitConfigChange();
    return getConfig();
  }

  function purgeSession() {
    safeStorageRemove(window.sessionStorage, SESSION_KEY_STORAGE_KEY);
    emitConfigChange();
    return getConfig();
  }

  /** Garantiza envío estricto de texto (tokens + contexto), bloqueando cualquier dato biométrico o visual. */
  function sanitizeTokens(tokens) {
    if (!Array.isArray(tokens)) return [];
    const out = [];
    for (let i = 0; i < Math.min(tokens.length, 48); i += 1) {
      const tok = tokens[i];
      if (!tok || typeof tok !== 'object') continue;
      const kind = tok.kind === 'letter' || tok.kind === 'space' ? tok.kind : 'word';
      const text = String(tok.text || '').slice(0, 64);
      const item = { kind, text };
      if (Array.isArray(tok.alts) && tok.alts.length > 0) {
        item.alts = tok.alts
          .slice(0, 3)
          .filter((a) => a && typeof a.label === 'string' && a.label.trim())
          .map((a) => ({
            label: a.label.trim().slice(0, 32),
            score: Number.isFinite(a.score) ? Number(a.score.toFixed(3)) : undefined
          }));
      }
      out.push(item);
    }
    return out;
  }

  function buildUserPrompt({ tokens, rawText, sector, procedure }) {
    const payload = {
      contexto: {
        sede: String(sector || 'Atención general').slice(0, 80),
        tramite: String(procedure || 'Comunicación libre LSP').slice(0, 120)
      },
      textoLocal: rawText,
      tokens
    };
    return (
      'Refina la siguiente secuencia detectada en Lengua de Señas Peruana (LSP) usando solo la información presente:\n' +
      JSON.stringify(payload)
    );
  }

  function cleanModelOutput(text) {
    if (typeof text !== 'string') return '';
    const cleaned = text
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[«"'“”]+|[»"'“”]+$/g, '')
      .trim();
    if (!cleaned) return '';
    return cleaned.slice(0, MAX_OUTPUT_CHARS);
  }

  function extractGeminiText(data) {
    const candidates = data && Array.isArray(data.candidates) ? data.candidates : [];
    const parts = candidates[0] && candidates[0].content && Array.isArray(candidates[0].content.parts)
      ? candidates[0].content.parts
      : [];
    const nonThought = parts.find((p) => p && !p.thought && typeof p.text === 'string' && p.text.trim());
    if (nonThought) return nonThought.text;
    const anyText = parts.find((p) => p && typeof p.text === 'string' && p.text.trim());
    return anyText ? anyText.text : '';
  }

  async function refineLspSentence({ tokens = [], rawText = '', sector = '', procedure = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const fallback = String(rawText || '').trim();
    const cfg = getConfig();
    if (!fallback || !cfg.active) {
      return { text: fallback, corrected: false, source: 'local' };
    }

    const safeTokens = sanitizeTokens(tokens);
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), ms) : null;

    try {
      let candidateText = '';
      if (cfg.mode === 'proxy') {
        const res = await fetch(cfg.proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            tokens: safeTokens,
            rawText: fallback,
            sector: String(sector || '').slice(0, 80),
            procedure: String(procedure || '').slice(0, 120)
          }),
          signal: controller ? controller.signal : undefined
        });
        if (!res.ok) {
          return { text: fallback, corrected: false, source: 'local' };
        }
        const json = await res.json();
        candidateText = json && typeof json.text === 'string' ? json.text : '';
      } else if (cfg.mode === 'sessionKey') {
        const sessionKey = safeStorageGet(window.sessionStorage, SESSION_KEY_STORAGE_KEY).trim();
        if (!sessionKey) {
          return { text: fallback, corrected: false, source: 'local' };
        }
        const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(DEFAULT_MODEL)}:generateContent`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': sessionKey
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: LSP_SYSTEM_INSTRUCTION }] },
            contents: [
              {
                role: 'user',
                parts: [{ text: buildUserPrompt({ tokens: safeTokens, rawText: fallback, sector, procedure }) }]
              }
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 120
            }
          }),
          signal: controller ? controller.signal : undefined
        });
        if (!res.ok) {
          return { text: fallback, corrected: false, source: 'local' };
        }
        const json = await res.json();
        candidateText = extractGeminiText(json);
      }

      const cleaned = cleanModelOutput(candidateText);
      if (!cleaned) {
        return { text: fallback, corrected: false, source: 'local' };
      }
      return {
        text: cleaned,
        corrected: cleaned !== fallback,
        source: DEFAULT_MODEL
      };
    } catch (_) {
      return { text: fallback, corrected: false, source: 'local' };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  document.addEventListener('senasegura:purge', () => {
    purgeSession();
  });

  window.SenaSeguraGemini = Object.freeze({
    DEFAULT_MODEL,
    DEFAULT_PROXY_URL,
    getConfig,
    isConfigured,
    saveConfig,
    disconnect,
    purgeSession,
    refineLspSentence
  });
})();
