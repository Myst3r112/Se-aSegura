/**
 * SeñaSegura · Capa Híbrida Opcional Gemini LSP (gemini-3.8-flash)
 * Refina oraciones de Lengua de Señas Peruana (LSP, Ley N.° 29535) únicamente a partir de
 * glosas y letras detectadas localmente mediante Cloudflare Worker proxy (texto puro, Ley N.° 29733).
 */
(function () {
  'use strict';

  const DEFAULT_MODEL = 'gemini-3.8-flash';
  const DEFAULT_PROXY_URL = 'https://senasegura-gemini-lsp.jhostynvilchez2606.workers.dev';
  const DEFAULT_TIMEOUT_MS = 4500;
  const MAX_OUTPUT_CHARS = 240;

  let lastCache = { signature: '', result: null };

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
        model: DEFAULT_MODEL
      });
    }

    return Object.freeze({
      active: false,
      mode: 'none',
      source: 'none',
      proxyUrl: '',
      model: DEFAULT_MODEL
    });
  }

  function isConfigured() {
    return Boolean(getConfig().active);
  }

  function purgeSession() {
    lastCache = { signature: '', result: null };
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

  async function refineLspSentence({ tokens = [], rawText = '', sector = '', procedure = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const fallback = String(rawText || '').trim();
    const cfg = getConfig();
    if (!fallback || !cfg.active || window.location.protocol === 'file:' || navigator.onLine === false) {
      return { text: fallback, corrected: false, source: 'local' };
    }

    const safeTokens = sanitizeTokens(tokens);
    const cleanSector = String(sector || '').slice(0, 80);
    const cleanProcedure = String(procedure || '').slice(0, 120);
    const signature = JSON.stringify({ tokens: safeTokens, rawText: fallback, sector: cleanSector, procedure: cleanProcedure });

    if (lastCache.signature === signature && lastCache.result) {
      return { ...lastCache.result };
    }

    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), ms) : null;

    try {
      const res = await fetch(cfg.proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          tokens: safeTokens,
          rawText: fallback,
          sector: cleanSector,
          procedure: cleanProcedure
        }),
        signal: controller ? controller.signal : undefined
      });

      if (!res.ok) {
        console.warn('[SeñaSegura · Gemini LSP] Fallback local:', `HTTP ${res.status}`);
        return { text: fallback, corrected: false, source: 'local' };
      }

      const json = await res.json();
      const candidateText = json && typeof json.text === 'string' ? json.text : '';
      const cleaned = cleanModelOutput(candidateText);
      if (!cleaned) {
        console.warn('[SeñaSegura · Gemini LSP] Fallback local:', 'respuesta JSON sin texto válido');
        return { text: fallback, corrected: false, source: 'local' };
      }

      const resolved = {
        text: cleaned,
        corrected: cleaned !== fallback,
        source: DEFAULT_MODEL
      };
      lastCache = { signature, result: resolved };
      console.info('[SeñaSegura · Gemini LSP] Refinado con gemini-3.8-flash');
      return { ...resolved };
    } catch (err) {
      const reason = err && err.name === 'AbortError'
        ? 'timeout'
        : (err && err.message ? err.message : String(err));
      console.warn('[SeñaSegura · Gemini LSP] Fallback local:', reason);
      return { text: fallback, corrected: false, source: 'local' };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  document.addEventListener('senasegura:purge', purgeSession);

  window.SenaSeguraGemini = Object.freeze({
    DEFAULT_MODEL,
    DEFAULT_PROXY_URL,
    getConfig,
    isConfigured,
    purgeSession,
    refineLspSentence
  });
})();
