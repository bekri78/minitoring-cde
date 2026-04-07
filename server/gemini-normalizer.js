'use strict';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_LIMIT   = Number(process.env.GEMINI_NORMALIZE_LIMIT || 80);
const GEMINI_BATCH   = Number(process.env.GEMINI_NORMALIZE_BATCH || 20);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.chatgpt;
const OPENAI_MODEL   = process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4o-mini';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

const VALID_CATEGORIES = new Set([
  'terrorism', 'military', 'conflict', 'protest',
  'cyber', 'strategic', 'crisis', 'incident', 'discard',
]);

const ROMANIZED_HINTS = [
  // Greeklish / romanized Greek.
  'kai', 'toy', 'tou', 'tis', 'horis', 'xoris', 'anoigma', 'ormoyz', 'ormouz',
  'sygkroysi', 'sigkrousi', 'diplomatiki', 'lysi', 'ellada', 'vretania',
  // Arabizi / romanized Arabic common OSINT forms.
  'houthis', 'ansarallah', 'hezbollah', 'al quds', 'shahed',
  // Russian/Ukrainian transliteration fragments often seen in slugs.
  'rossiya', 'ukraina', 'voenn', 'raket', 'udar', 'oboron',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasNonLatin(text) {
  return /[^\u0000-\u024f]/.test(String(text || ''));
}

function isLikelyRomanized(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return ROMANIZED_HINTS.some(hint => normalized.includes(hint));
}

function needsGemini(event) {
  const title = event?.title || '';
  if (!title || title.length < 8) return true;
  if (hasNonLatin(title)) return true;
  if (isLikelyRomanized(title)) return true;
  if (['incident', 'crisis', 'strategic'].includes(event.category) && Number(event.score || 0) < 130) return true;
  if (/^[a-z0-9-_/]+$/i.test(title) && title.includes('-')) return true;
  return false;
}

function extractJsonArray(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {}

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
}

function buildPrompt(events) {
  return `Normalize and translate OSINT event titles for a geopolitical monitoring dashboard.

Handle romanized languages such as greeklish, arabizi, Russian/Ukrainian transliteration, and normal non-English scripts.
Use CAMEO fields only as supporting context. Always translate the requested title. Use category "discard" only when the title has no meaningful news/security content.

Return ONLY a valid JSON array. One object per input:
{
  "id": "same id",
  "keep": true,
  "language": "english|french|greek|arabic|russian|...",
  "is_romanized": true,
  "native_text": "native script when useful, else original",
  "fr": "French title, <= 16 words",
  "en": "English title, <= 16 words",
  "notes": "brief operational summary in French, <= 22 words",
  "category": "terrorism|military|conflict|protest|cyber|strategic|crisis|incident|discard",
  "relevance": 0
}

Events:
${events.map(e => JSON.stringify({
    id: e.id,
    title: e.title,
    url: e.url,
    domain: e.domain,
    country: e.country,
    countryCode: e.countryCode,
    actor1: e.actor1,
    actor2: e.actor2,
    eventCode: e.eventCode,
    rootCode: e.rootCode,
    subEventType: e.subEventType,
    localCategory: e.category,
  })).join('\n')}`;
}

async function normalizeBatch(events) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: buildPrompt(events) }] },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const err = new Error(`HTTP_${resp.status}${body ? ` ${body.slice(0, 180)}` : ''}`);
    err.status = resp.status >= 500 ? 502 : 503;
    throw err;
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
  return extractJsonArray(text);
}

function mergeResult(event, result) {
  if (!result || result.keep === false || result.category === 'discard') return null;
  const category = VALID_CATEGORIES.has(result.category) ? result.category : event.category;
  const relevance = Math.max(0, Math.min(100, Number(result.relevance || event.relevance || 0)));

  return {
    ...event,
    originalTitle: event.originalTitle || event.title,
    title: result.fr || event.title,
    headline: result.en || event.headline || null,
    notes: result.notes || event.notes || null,
    category,
    relevance,
    language: result.language || event.language || null,
    isRomanized: Boolean(result.is_romanized),
    nativeTitle: result.native_text || event.nativeTitle || null,
    score: Number(event.score || 0) + Math.round(relevance / 5),
  };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {}

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

async function translateTitleWithOpenAI(event) {
  if (!OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY missing');
    err.status = 503;
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let resp;
  try {
    resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Translate OSINT/geopolitical article titles into concise French. Return JSON only.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              title: event.title,
              domain: event.domain || '',
              country: event.country || '',
              category: event.category || 'incident',
              eventCode: event.eventCode || '',
              rootCode: event.rootCode || '',
              subEventType: event.subEventType || '',
              output: {
                fr: 'French title, <= 16 words',
                en: 'English title, <= 16 words',
                notes: 'brief operational summary in French, <= 22 words',
                language: 'detected language',
              },
            }),
          },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const err = new Error(`OpenAI HTTP_${resp.status}${body ? ` ${body.slice(0, 180)}` : ''}`);
    err.status = resp.status >= 500 ? 502 : 503;
    throw err;
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  const result = extractJsonObject(text) || {};
  return {
    id: event.id,
    keep: true,
    originalTitle: event.title,
    title: result.fr || event.title,
    fr: result.fr || event.title,
    headline: result.en || null,
    notes: result.notes || null,
    category: VALID_CATEGORIES.has(event.category) ? event.category : 'incident',
    relevance: Number(event.relevance || 0),
    language: result.language || null,
    isRomanized: false,
    nativeTitle: null,
    provider: 'openai',
  };
}

async function normalizeEventsWithGemini(events) {
  if (!GEMINI_API_KEY) {
    console.log('[gemini] skipped: GEMINI_API_KEY missing');
    return events;
  }

  const candidates = events.filter(needsGemini).slice(0, GEMINI_LIMIT);
  if (!candidates.length) {
    console.log('[gemini] skipped: no ambiguous titles');
    return events;
  }

  const byId = new Map();
  const rejectedIds = new Set();
  let rejected = 0;

  for (let i = 0; i < candidates.length; i += GEMINI_BATCH) {
    const batch = candidates.slice(i, i + GEMINI_BATCH);
    try {
      const results = await normalizeBatch(batch);
      for (const result of results) {
        const original = batch.find(e => e.id === result.id);
        if (!original) continue;
        const merged = mergeResult(original, result);
        if (merged) byId.set(original.id, merged);
        else {
          rejectedIds.add(original.id);
          rejected++;
        }
      }
      console.log(`[gemini] normalized batch ${Math.floor(i / GEMINI_BATCH) + 1}: ${results.length}/${batch.length}`);
    } catch (err) {
      console.warn('[gemini] batch failed:', err.message);
    }

    if (i + GEMINI_BATCH < candidates.length) await sleep(350);
  }

  const normalized = events
    .map(event => byId.get(event.id) || event)
    .filter(event => !rejectedIds.has(event.id));

  console.log(`[gemini] done: ${byId.size} normalized, ${rejected} rejected, ${candidates.length} checked`);
  return normalized;
}

async function normalizeTitleWithGemini(event) {
  if (!GEMINI_API_KEY) {
    if (OPENAI_API_KEY) {
      console.warn('[translate-title] Gemini API key missing; falling back to OpenAI');
      const title = String(event?.title || '').trim();
      if (!title) {
        const err = new Error('title required');
        err.status = 400;
        throw err;
      }
      return translateTitleWithOpenAI({
        ...event,
        id: event?.id || `title_${Date.now()}`,
        title,
        category: event?.category || 'incident',
      });
    }
    const err = new Error('GEMINI_API_KEY missing');
    err.status = 503;
    throw err;
  }

  const title = String(event?.title || '').trim();
  if (!title) {
    const err = new Error('title required');
    err.status = 400;
    throw err;
  }

  const id = event.id || `title_${Date.now()}`;
  const baseEvent = {
    ...event,
    id,
    title,
    category: event.category || 'incident',
  };
  let result;
  try {
    [result] = await normalizeBatch([baseEvent]);
  } catch (err) {
    if (OPENAI_API_KEY) {
      console.warn(`[translate-title] Gemini failed (${err.message}); falling back to OpenAI`);
      return translateTitleWithOpenAI(baseEvent);
    }
    throw err;
  }
  const merged = mergeResult(baseEvent, result);

  if (!merged) {
    return {
      id,
      keep: result?.keep !== false,
      originalTitle: title,
      title: result?.fr || title,
      fr: result?.fr || title,
      headline: result?.en || null,
      notes: result?.notes || null,
      category: VALID_CATEGORIES.has(result?.category) ? result.category : 'incident',
      relevance: Number(result?.relevance || 0),
      language: result?.language || null,
      isRomanized: Boolean(result?.is_romanized),
      nativeTitle: result?.native_text || null,
    };
  }

  return {
    id,
    keep: true,
    originalTitle: merged.originalTitle || title,
    title: merged.title,
    fr: merged.title,
    headline: merged.headline,
    notes: merged.notes,
    category: merged.category,
    relevance: merged.relevance,
    language: merged.language,
    isRomanized: merged.isRomanized,
    nativeTitle: merged.nativeTitle,
  };
}

module.exports = { normalizeEventsWithGemini, normalizeTitleWithGemini };
