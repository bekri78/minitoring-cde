'use strict';

const OpenAI = require('openai');

// ── Configuration ─────────────────────────────────────────────────────────────
const GEMINI_LIMIT   = Number(process.env.GEMINI_NORMALIZE_LIMIT || 80);
const GEMINI_BATCH   = Number(process.env.GEMINI_NORMALIZE_BATCH || 20);

const OPENAI_API_KEY   = ((process.env.OPENAI_API_KEY || process.env.chatgpt) || '').trim().replace(/^=+/, '') || undefined;
const OPENAI_MODEL     = process.env.OPENAI_TRANSLATE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const FINETUNE_MODEL   = process.env.FINETUNE_MODEL || null; // ft:gpt-4o-mini-...:osint-classifier

const GROQ_API_KEY  = (process.env.groq || process.env.GROQ_API_KEY || '').trim();
const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL    = process.env.GROQ_NORMALIZE_MODEL || 'llama-3.1-8b-instant';

const AI_FILTER_ENABLED        = process.env.AI_FILTER_ENABLED !== 'false';
const AI_FILTER_BATCH          = Number(process.env.AI_FILTER_BATCH || 20);
const AI_FILTER_LIMIT          = Number(process.env.AI_FILTER_LIMIT || 1500);
const AI_FILTER_DELAY          = Number(process.env.AI_FILTER_DELAY || 1200);
const AI_FILTER_TIMEOUT_MS     = Number(process.env.AI_FILTER_TIMEOUT_MS || 60000);
const AI_FILTER_MAX_RETRIES    = Math.max(1, Number(process.env.AI_FILTER_MAX_RETRIES || 4));
const AI_FILTER_RETRY_DELAY_MS = Number(process.env.AI_FILTER_RETRY_DELAY_MS || 20000);
const AI_FILTER_ALWAYS_KEEP_SCORE = Number(process.env.AI_FILTER_ALWAYS_KEEP_SCORE || 88);

const openaiClient = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' })
  : null;

// Startup diagnostics
console.log('[normalizer] OPENAI_API_KEY set:  ', !!OPENAI_API_KEY);
console.log('[normalizer] GROQ_API_KEY set:    ', !!GROQ_API_KEY);
console.log('[normalizer] OPENAI_MODEL:        ', OPENAI_MODEL);
console.log('[normalizer] FINETUNE_MODEL:      ', FINETUNE_MODEL || '(none)');

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_CATEGORIES = new Set([
  'terrorism', 'military', 'conflict', 'protest',
  'cyber', 'strategic', 'crisis', 'incident', 'discard',
]);

const ROMANIZED_HINTS = [
  'kai', 'toy', 'tou', 'tis', 'horis', 'xoris', 'anoigma', 'ormoyz', 'ormouz',
  'sygkroysi', 'sigkrousi', 'diplomatiki', 'lysi', 'ellada', 'vretania',
  'houthis', 'ansarallah', 'hezbollah', 'al quds', 'shahed',
  'rossiya', 'ukraina', 'voenn', 'raket', 'udar', 'oboron',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getAiFilterRetryDelay(attempt) {
  return AI_FILTER_RETRY_DELAY_MS * Math.max(1, attempt);
}

function parseChatTextContent(content) {
  if (Array.isArray(content)) return content.map(part => part?.text || part?.content || '').join('\n');
  return String(content || '');
}

function getRetryableStatus(status) {
  return status === 429 || status === 503;
}

function isRetryableNetworkError(err) {
  const msg = err?.message || '';
  return msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('socket hang up');
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

function isLikelyEnglish(text) {
  if (/\b(the|and|for|with|in|of|to|is|are|was|were|has|have|been|will|from|that|this|after|before|over|into|its|their|says|said|as|on|at|by|an|it|he|she|we|us|a|no|not|but|or|amid|against|between)\b/i.test(String(text || ''))) return true;
  if (/\b(attack|strike|strikes|struck|killed|kills|forces|troops|army|navy|military|police|government|minister|president|official|war|conflict|crisis|sanctions|missile|missiles|drone|drones|fire|fires|fired|launch|launches|launched|deploy|deployed|arrest|arrested|protest|protests|explosion|bomb|bombing|dead|wounded|injured|civilian|civilians|report|reports|says|said|warns|warning|claims|confirms|threatens|threat|ceasefire|talks|deal|accord|agreement|offensive|operation|soldiers|rebels|militia|nuclear|ballistic|hypersonic|rocket|rockets|airstrike|airstrikes|naval|submarine|warship|frigate|fighter|bomber|satellite|spacecraft)\b/i.test(String(text || ''))) return true;
  return false;
}

function needsMistral(event) {
  const title = event?.title || '';
  if (!title || title.length < 8) return false;
  if (hasNonLatin(title)) return true;
  if (isLikelyRomanized(title)) return true;
  if (/^[A-Z\s]+\s—\s/.test(title)) return true;
  if (/^[a-z0-9-]+(?:-[a-z0-9]+){3,}$/.test(title)) return true;
  if (/[À-ÖØ-öø-ÿ]/.test(title) && !isLikelyEnglish(title)) return true;
  if (!isLikelyEnglish(title) && (title.match(/\b[a-z]{4,}\b/gi) || []).length >= 2) return true;
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

function shouldBypassAiFilter(event) {
  if (!event) return false;
  if (event.osintDomain) return true;
  if (event.domain_bucket === 'spatial' && event.spatial_anchor_flag) return true;
  if (event.domain_bucket === 'aviation' && event.aviation_anchor_flag) return true;
  if (event.domain_bucket === 'maritime' && event.maritime_anchor_flag) return true;
  if (event.is_strategic && Number(event.score || 0) >= AI_FILTER_ALWAYS_KEEP_SCORE + 8) return true;
  if (Number(event.score || 0) >= AI_FILTER_ALWAYS_KEEP_SCORE + 18) return true;
  if (['terrorism', 'cyber'].includes(String(event.category || ''))) return true;
  return false;
}

function mergeResult(event, result) {
  if (!result || result.keep === false || result.category === 'discard') return null;
  const category = VALID_CATEGORIES.has(result.category) ? result.category : event.category;
  const relevance = Math.max(0, Math.min(100, Number(result.relevance || event.relevance || 0)));
  const countryCode = typeof result.countryCode === 'string' && result.countryCode.length === 2
    ? result.countryCode.toUpperCase()
    : event.countryCode;
  return {
    ...event,
    originalTitle: event.originalTitle || event.title,
    title: result.fr || event.title,
    headline: result.en || event.headline || null,
    notes: result.notes || event.notes || null,
    category,
    relevance,
    countryCode,
    language: result.language || event.language || null,
    isRomanized: Boolean(result.is_romanized),
    nativeTitle: result.native_text || event.nativeTitle || null,
    score: Number(event.score || 0) + Math.round(relevance / 5),
  };
}

// ── Prompts ───────────────────────────────────────────────────────────────────
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
  "countryCode": "ISO 3166-1 alpha-2 of the country the article is ABOUT (ignore the source domain/TLD), null if unclear or multiple",
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

function buildFilterPrompt(events) {
  const lines = events.map(e => JSON.stringify({
    id: e.id,
    title: e.title,
    domain: e.domain || null,
    score: Math.round(Number(e.score || 0)),
    category: e.category || null,
    domain_bucket: e.domain_bucket || 'general',
    is_strategic: Boolean(e.is_strategic),
    actor1: e.actor1 || null,
    actor2: e.actor2 || null,
  })).join('\n');

  return `You are an OSINT military intelligence analyst reviewing news events for a geopolitical security dashboard.

KEEP if the event is about:
- Armed conflict, airstrikes, shelling, military operations
- Naval / aviation / space activity in a military or strategic context
- Terrorism, hostage situations, IED/bombing attacks
- Sanctions, coups, diplomatic crises, geopolitical tensions
- Cyber attacks on infrastructure or state actors
- Weapons programs, nuclear, ballistic or hypersonic missiles
- Significant protests turning violent or with geopolitical impact

DISCARD if the event is about:
- Lifestyle, sports, entertainment, celebrity, music, food, tourism
- Viral or human-interest stories (even if they mention NASA, military, police)
- Business, finance, stock markets, earnings, IPO, real estate
- Local crime, road accidents, natural disasters unrelated to conflict
- Domestic murder, homicide, family crime, police blotter
- Elections, parliament, diplomacy with no security dimension
- Humanitarian aid, health, education with no conflict context

Reply ONLY with a valid JSON array, one object per input, in the same order:
[{"id":"<same id>","keep":true},{"id":"<same id>","keep":false},...]

Events:
${lines}`;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function requestJsonArrayFromOpenAI(messages, model, timeoutMs = 45000) {
  if (!openaiClient) {
    const err = new Error('OPENAI_API_KEY missing');
    err.status = 503;
    throw err;
  }
  let completion;
  try {
    completion = await openaiClient.chat.completions.create({
      model: model || OPENAI_MODEL,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    }, { timeout: timeoutMs });
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const err = new Error(`OpenAI HTTP_${status} ${(e?.message || '').slice(0, 180)}`);
    err.status = status;
    throw err;
  }
  const text = parseChatTextContent(completion.choices?.[0]?.message?.content);
  const parsed = extractJsonObject(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.events)) return parsed.events;
  if (Array.isArray(parsed?.results)) return parsed.results;
  return extractJsonArray(text);
}

async function translateTitleWithOpenAI(event) {
  if (!openaiClient) {
    const err = new Error('OPENAI_API_KEY missing');
    err.status = 503;
    throw err;
  }
  let completion;
  try {
    completion = await openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'Translate OSINT/geopolitical article titles into concise French. Return JSON only.' },
        {
          role: 'user',
          content: JSON.stringify({
            title: event.title,
            domain: event.domain || '',
            country: event.country || '',
            category: event.category || 'incident',
            eventCode: event.eventCode || '',
            rootCode: event.rootCode || '',
            output: { fr: 'French title <= 16 words', en: 'English title <= 16 words', notes: 'French summary <= 22 words', language: 'detected language' },
          }),
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }, { timeout: 45000 });
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const err = new Error(`OpenAI HTTP_${status} ${(e?.message || '').slice(0, 180)}`);
    err.status = status >= 500 ? 502 : 503;
    throw err;
  }
  const text = completion.choices?.[0]?.message?.content || '';
  const result = extractJsonObject(text) || {};
  const output = result.output && typeof result.output === 'object' ? result.output : {};
  const fr = result.fr || result.title_fr || result.french || result.translation || output.fr || output.french || output.translation;
  const en = result.en || result.headline || result.english || output.en || output.headline;
  const notes = result.notes || result.summary || output.notes || output.summary;
  const language = result.language || result.detected_language || output.language;
  return {
    id: event.id, keep: true,
    originalTitle: event.title, title: fr || event.title,
    fr: fr || event.title, headline: en || null, notes: notes || null,
    category: VALID_CATEGORIES.has(event.category) ? event.category : 'incident',
    relevance: Number(event.relevance || 0),
    language: language || null, isRomanized: false, nativeTitle: null,
    provider: 'openai',
  };
}

// ── Groq (traduction / normalisation — gratuit) ───────────────────────────────
async function callGroq(messages, timeoutMs = 30000) {
  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0, max_tokens: 2048, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const err = new Error(`Groq HTTP_${resp.status} ${body.slice(0, 120)}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function normalizeBatchWithGroq(events) {
  const text = await callGroq([
    { role: 'system', content: 'You are an OSINT geopolitical analyst. Return ONLY a valid JSON object with an "events" array.' },
    { role: 'user', content: buildPrompt(events) },
  ]);
  const parsed = extractJsonObject(text);
  if (Array.isArray(parsed?.events)) return parsed.events;
  return extractJsonArray(text);
}

async function translateTitleWithGroq(event) {
  const text = await callGroq([
    { role: 'system', content: 'Translate OSINT/geopolitical article titles into concise French. Return JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        title: event.title,
        country: event.country || '',
        category: event.category || 'incident',
        output: { fr: 'French title <= 16 words', en: 'English title <= 16 words', notes: 'French summary <= 22 words', language: 'detected language' },
      }),
    },
  ]);
  const result = extractJsonObject(text) || {};
  const output = result.output && typeof result.output === 'object' ? result.output : {};
  const fr = result.fr || result.title_fr || result.french || result.translation || output.fr || output.french || output.translation;
  const en = result.en || result.headline || result.english || output.en || output.headline;
  const notes = result.notes || result.summary || output.notes || output.summary;
  const language = result.language || result.detected_language || output.language;
  return {
    id: event.id, keep: true,
    originalTitle: event.title, title: fr || event.title,
    fr: fr || event.title, headline: en || null, notes: notes || null,
    category: VALID_CATEGORIES.has(event.category) ? event.category : 'incident',
    relevance: Number(event.relevance || 0),
    language: language || null, isRomanized: false, nativeTitle: null,
    provider: 'groq',
  };
}

// ── Filtre IA (OpenAI gpt-4o-mini, batch) ─────────────────────────────────────
async function filterEventsWithMistral(events) {
  if (!AI_FILTER_ENABLED) {
    console.log('[ai-filter] disabled via AI_FILTER_ENABLED=false');
    return events;
  }
  if (!OPENAI_API_KEY) {
    console.log('[ai-filter] skipped: OPENAI_API_KEY missing');
    return events;
  }

  const guaranteedIds = new Set(events.filter(shouldBypassAiFilter).map(e => String(e.id)));
  const candidates = events.filter(e => !guaranteedIds.has(String(e.id))).slice(0, AI_FILTER_LIMIT);
  const discardedIds = new Set();
  let aiProcessed = 0;

  if (!candidates.length) {
    console.log(`[ai-filter] skipped: ${events.length} events kept locally`);
    return events;
  }

  const filterModel = FINETUNE_MODEL || OPENAI_MODEL;

  for (let i = 0; i < candidates.length; i += AI_FILTER_BATCH) {
    const batch = candidates.slice(i, i + AI_FILTER_BATCH);
    const batchNum = Math.floor(i / AI_FILTER_BATCH) + 1;
    let success = false;

    for (let attempt = 1; attempt <= AI_FILTER_MAX_RETRIES; attempt++) {
      try {
        const results = await requestJsonArrayFromOpenAI([
          { role: 'system', content: 'You are an OSINT analyst. Return JSON only.' },
          { role: 'user', content: `Return a JSON object with an "events" array.\n${buildFilterPrompt(batch)}` },
        ], filterModel, AI_FILTER_TIMEOUT_MS);

        let kept = 0;
        for (const result of results) {
          if (!result?.id) continue;
          if (result.keep === false) discardedIds.add(String(result.id));
          else kept++;
        }
        aiProcessed += batch.length;
        console.log(`[ai-filter] batch ${batchNum}: ${kept}/${batch.length} kept`);
        success = true;
        break;
      } catch (err) {
        if ((getRetryableStatus(err?.status) || isRetryableNetworkError(err)) && attempt < AI_FILTER_MAX_RETRIES) {
          const retryDelay = getAiFilterRetryDelay(attempt);
          console.warn(`[ai-filter] batch ${batchNum} error (${err.message.slice(0, 60)}), retrying in ${Math.round(retryDelay / 1000)}s...`);
          await sleep(retryDelay);
          continue;
        }
        if (attempt === AI_FILTER_MAX_RETRIES) {
          console.warn(`[ai-filter] batch ${batchNum} failed (fail-open):`, err.message);
        }
      }
    }

    if (!success) aiProcessed += batch.length;
    if (i + AI_FILTER_BATCH < candidates.length) await sleep(AI_FILTER_DELAY);
  }

  const filtered = events.filter(e => guaranteedIds.has(String(e.id)) || !discardedIds.has(String(e.id)));
  console.log(`[ai-filter] done: ${discardedIds.size} discarded, ${filtered.length}/${events.length} kept (${aiProcessed} AI-checked, ${guaranteedIds.size} bypassed) [model: ${filterModel}]`);
  return filtered;
}

// ── Normalisation / Traduction (Groq gratuit, fallback OpenAI) ────────────────
async function normalizeEventsWithMistral(events) {
  if (!GROQ_API_KEY && !OPENAI_API_KEY) {
    console.log('[normalize] skipped: no API key available');
    return events;
  }

  const candidates = events.filter(needsMistral).slice(0, GEMINI_LIMIT);
  if (!candidates.length) {
    console.log('[normalize] skipped: no ambiguous titles');
    return events;
  }

  const byId = new Map();
  const rejectedIds = new Set();
  let rejected = 0;

  for (let i = 0; i < candidates.length; i += GEMINI_BATCH) {
    const batch = candidates.slice(i, i + GEMINI_BATCH);
    try {
      let results;
      if (GROQ_API_KEY) {
        results = await normalizeBatchWithGroq(batch);
      } else {
        results = await requestJsonArrayFromOpenAI([
          { role: 'system', content: 'You are an OSINT geopolitical analyst. Return JSON only.' },
          { role: 'user', content: `Return a JSON object with an "events" array.\n${buildPrompt(batch)}` },
        ], OPENAI_MODEL);
      }
      for (const result of results) {
        const original = batch.find(e => e.id === result.id);
        if (!original) continue;
        const merged = mergeResult(original, result);
        if (merged) byId.set(original.id, merged);
        else { rejectedIds.add(original.id); rejected++; }
      }
      const provider = GROQ_API_KEY ? 'groq' : 'openai';
      console.log(`[normalize:${provider}] batch ${Math.floor(i / GEMINI_BATCH) + 1}: ${results.length}/${batch.length}`);
    } catch (err) {
      console.warn('[normalize] batch failed:', err.message);
      // Fallback OpenAI si Groq échoue
      if (GROQ_API_KEY && OPENAI_API_KEY) {
        try {
          const results = await requestJsonArrayFromOpenAI([
            { role: 'system', content: 'You are an OSINT geopolitical analyst. Return JSON only.' },
            { role: 'user', content: `Return a JSON object with an "events" array.\n${buildPrompt(batch)}` },
          ], OPENAI_MODEL);
          for (const result of results) {
            const original = batch.find(e => e.id === result.id);
            if (!original) continue;
            const merged = mergeResult(original, result);
            if (merged) byId.set(original.id, merged);
            else { rejectedIds.add(original.id); rejected++; }
          }
        } catch (fallbackErr) {
          console.warn('[normalize] OpenAI fallback also failed:', fallbackErr.message);
        }
      }
    }

    if (i + GEMINI_BATCH < candidates.length) await sleep(350);
  }

  const normalized = events
    .map(event => byId.get(event.id) || event)
    .filter(event => !rejectedIds.has(event.id));

  const provider = GROQ_API_KEY ? 'groq' : 'openai';
  console.log(`[normalize:${provider}] done: ${byId.size} normalized, ${rejected} rejected, ${candidates.length} checked`);
  return normalized;
}

// ── Traduction unitaire (Groq, fallback OpenAI) ───────────────────────────────
async function normalizeTitleWithGemini(event) {
  const title = String(event?.title || '').trim();
  if (!title) {
    const err = new Error('title required');
    err.status = 400;
    throw err;
  }
  const id = event?.id || `title_${Date.now()}`;
  const baseEvent = { ...event, id, title, category: event?.category || 'incident' };

  if (GROQ_API_KEY) {
    try {
      return await translateTitleWithGroq(baseEvent);
    } catch (err) {
      console.warn('[normalize] Groq title translation failed, trying OpenAI:', err.message);
    }
  }
  if (OPENAI_API_KEY) {
    return translateTitleWithOpenAI(baseEvent);
  }
  const err = new Error('GROQ_API_KEY or OPENAI_API_KEY missing');
  err.status = 503;
  throw err;
}

module.exports = { normalizeEventsWithMistral, normalizeTitleWithGemini, filterEventsWithMistral };
