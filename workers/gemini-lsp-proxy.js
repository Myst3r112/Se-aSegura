/**
 * Cloudflare Worker Proxy para SeñaSegura · Gemini LSP (gemini-3.8-flash)
 * Plantilla gratuita compatible con GitHub Pages (protege env.GEMINI_API_KEY en el servidor).
 *
 * Variables requeridas en Cloudflare Workers:
 *   - Secret: env.GEMINI_API_KEY
 *   - Var:    env.ALLOWED_ORIGIN  (ej. "https://tu-usuario.github.io" o lista separada por comas)
 *
 * Privacidad (Ley N.° 29733): solo recibe glosas/letras textuales y contexto de ventanilla.
 * Jamás acepta ni procesa video, imágenes ni landmarks biométricos.
 */

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_BODY_BYTES = 16384;

const LSP_SYSTEM_INSTRUCTION = [
  'Eres el corrector gramatical y dactilológico oficial de SeñaSegura, especializado EXCLUSIVAMENTE en Lengua de Señas Peruana (LSP, Ley N.° 29535) y en español peruano claro, formal y respetuoso para atención presencial en ventanilla (bancos, comisarías, centros de salud y municipalidades).',
  'REGLAS ESTRICTAS:',
  '1. Usa únicamente gramática y léxico de la Lengua de Señas Peruana (LSP). PROHIBIDO aplicar convenciones de ASL (EE. UU.), LSE (España) o LSM (México).',
  '2. PROHIBIDO inventar, asumir o agregar datos que el ciudadano no haya señado (montos, números de DNI, fechas, nombres o trámites nuevos).',
  '3. Las glosas llegan a menudo en orden LSP (Tema-Comentario / SOV o interrogativo al final). Redáctalas en una sola oración natural, breve y fiel en primera persona ("Necesito...", "Quiero consultar...", "Por favor...").',
  '4. Para palabras deletreadas (`kind: "letter"`), revisa las alternativas Top-3 (`alts`) y el contexto de sede/trámite únicamente para corregir errores evidentes del reconocedor entre señas dactilológicas similares en LSP (U/V/R, P/K/Q, M/N, D/Z, I/J, C/O/E). Preserva intactas las siglas peruanas como DNI, RENIEC, SIS, RUC, SUNAT, BCP o AFP.',
  '5. Devuelve SOLO la oración final lista para leer al funcionario, sin comillas, sin listas y sin explicaciones.'
].join('\n');

function isLocalDevOrigin(origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch (_) {
    return false;
  }
}

function matchesConfiguredOrigin(reqOrigin, entry) {
  if (!reqOrigin || !entry) return false;
  if (entry === '*') return true;
  if (reqOrigin === entry) return true;
  if ((entry === 'http://localhost' || entry === 'http://127.0.0.1') && isLocalDevOrigin(reqOrigin)) {
    return true;
  }
  return false;
}

function resolveAllowedOrigin(request, env) {
  const reqOrigin = request.headers.get('Origin') || '';
  const configured = String(env.ALLOWED_ORIGIN || '').trim();
  if (!configured) {
    return isLocalDevOrigin(reqOrigin) ? reqOrigin : '';
  }
  const list = configured.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  if (!reqOrigin) return list[0] || '';
  const matched = list.find((entry) => matchesConfiguredOrigin(reqOrigin, entry));
  return matched ? reqOrigin : '';
}

function buildCorsHeaders(allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin'
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders
    }
  });
}

function sanitizeTokens(tokens) {
  if (!Array.isArray(tokens)) return [];
  const safe = [];
  for (let i = 0; i < Math.min(tokens.length, 48); i += 1) {
    const tok = tokens[i];
    if (!tok || typeof tok !== 'object') continue;
    const kind = tok.kind === 'letter' || tok.kind === 'space' ? tok.kind : 'word';
    const text = String(tok.text || '').slice(0, 64);
    const clean = { kind, text };
    if (Array.isArray(tok.alts) && tok.alts.length > 0) {
      clean.alts = tok.alts
        .slice(0, 3)
        .filter((a) => a && typeof a.label === 'string' && a.label.trim())
        .map((a) => ({
          label: a.label.trim().slice(0, 32),
          score: Number.isFinite(a.score) ? Number(a.score.toFixed(3)) : undefined
        }));
    }
    safe.push(clean);
  }
  return safe;
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

export default {
  async fetch(request, env) {
    const allowedOrigin = resolveAllowedOrigin(request, env);
    const corsHeaders = buildCorsHeaders(allowedOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: 'Proxy misconfigured' }, 500, corsHeaders);
    }

    const reqOrigin = request.headers.get('Origin');
    if (reqOrigin && !allowedOrigin) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, corsHeaders);
    }

    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return jsonResponse({ error: 'JSON body required' }, 415, corsHeaders);
    }

    let rawBody = '';
    try {
      rawBody = await request.text();
    } catch (_) {
      return jsonResponse({ error: 'Unable to read body' }, 400, corsHeaders);
    }
    if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Payload too large' }, 413, corsHeaders);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (_) {
      return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
    }

    const rawText = String((payload && payload.rawText) || '').trim().slice(0, 320);
    if (!rawText) {
      return jsonResponse({ error: 'rawText is required' }, 400, corsHeaders);
    }

    const sanitizedInput = {
      contexto: {
        sede: String((payload && payload.sector) || 'Atención general').slice(0, 80),
        tramite: String((payload && payload.procedure) || 'Comunicación libre LSP').slice(0, 120)
      },
      textoLocal: rawText,
      tokens: sanitizeTokens(payload && payload.tokens)
    };

    try {
      const upstream = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: LSP_SYSTEM_INSTRUCTION }] },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'Refina la siguiente secuencia detectada en Lengua de Señas Peruana (LSP) usando solo la información presente:\n' +
                    JSON.stringify(sanitizedInput)
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 120
          }
        })
      });

      if (!upstream.ok) {
        return jsonResponse({ error: 'Upstream Gemini error', status: upstream.status }, 502, corsHeaders);
      }

      const data = await upstream.json();
      const text = extractGeminiText(data)
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[«"'“”]+|[»"'“”]+$/g, '')
        .trim()
        .slice(0, 240);

      if (!text) {
        return jsonResponse({ text: rawText, model: GEMINI_MODEL }, 200, corsHeaders);
      }

      return jsonResponse({ text, model: GEMINI_MODEL }, 200, corsHeaders);
    } catch (_) {
      return jsonResponse({ error: 'Upstream request failed' }, 502, corsHeaders);
    }
  }
};
