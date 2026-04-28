'use strict';

const OpenAI = require('openai');

// ── Configuration ─────────────────────────────────────────────────────────────
const OPENAI_API_KEY   = ((process.env.OPENAI_API_KEY || process.env.chatgpt) || '').trim().replace(/^=+/, '') || undefined;
const OPENAI_MODEL     = process.env.OPENAI_TRANSLATE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim().replace(/^=+/, '') || undefined;
const DEEPSEEK_MODEL   = 'deepseek-v4-flash';

const AI_FILTER_ENABLED        = process.env.AI_FILTER_ENABLED !== 'false';
const AI_FILTER_BATCH          = Number(process.env.AI_FILTER_BATCH || 50);
const AI_FILTER_LIMIT          = Number(process.env.AI_FILTER_LIMIT || 1500);
const AI_FILTER_DELAY          = Number(process.env.AI_FILTER_DELAY || 1200);
const AI_FILTER_TIMEOUT_MS     = Number(process.env.AI_FILTER_TIMEOUT_MS || 60000);
const AI_FILTER_MAX_RETRIES    = Math.max(1, Number(process.env.AI_FILTER_MAX_RETRIES || 4));
const AI_FILTER_RETRY_DELAY_MS = Number(process.env.AI_FILTER_RETRY_DELAY_MS || 20000);

const openaiClient = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' })
  : null;

const deepseekClient = DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1' })
  : null;

// Startup diagnostics
console.log('[normalizer] DEEPSEEK_API_KEY set:', !!DEEPSEEK_API_KEY);
console.log('[normalizer] DEEPSEEK_MODEL:      ', DEEPSEEK_MODEL);
console.log('[normalizer] OPENAI_API_KEY set:  ', !!OPENAI_API_KEY);

// ── Cache inter-refresh (clé = event.id) ─────────────────────────────────────
// filterCache: id → { keep, fr, en, notes, category, countryCode } | null (discard)
const filterCache = new Map();
const CACHE_MAX_SIZE = 5000;

function pruneCache(cache, currentIds) {
  if (cache.size <= CACHE_MAX_SIZE) return;
  for (const key of cache.keys()) {
    if (!currentIds.has(key)) cache.delete(key);
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_CATEGORIES = new Set([
  'terrorism', 'military', 'conflict', 'protest',
  'cyber', 'strategic', 'crisis', 'incident', 'discard',
]);

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

// ── Prompt fusionné : filtre + traduction FR/EN en un seul appel ─────────────
function buildFilterPrompt(events) {
  const lines = events.map(e => JSON.stringify({
    id: e.id,
    title: e.title,
    url: e.url || null,
    domain: e.domain || null,
    score: Math.round(Number(e.score || 0)),
    category: e.category || null,
    country: e.country || null,
    countryCode: e.countryCode || null,
    actor1: e.actor1 || null,
    actor2: e.actor2 || null,
    eventCode: e.eventCode || null,
    rootCode: e.rootCode || null,
    fallback_title: Boolean(e.isFallbackTitle),
  })).join('\n');

  return `You are an OSINT military intelligence analyst. For each event, decide keep/discard AND translate the title.

KEEP if the event is about:
- Armed conflict, airstrikes, shelling, military operations
- Naval / aviation / space activity in a military or strategic context
- Terrorism, hostage situations, IED/bombing attacks
- Sanctions, coups, diplomatic crises, geopolitical tensions
- Cyber attacks on infrastructure or state actors
- Weapons programs, nuclear, ballistic or hypersonic missiles
- Significant protests turning violent or with geopolitical impact

When fallback_title=true, the title is a GDELT CAMEO code description (not the real article headline). Treat it as an unreliable signal and DISCARD unless actor1/actor2/domain provide strong independent military/security evidence.

DISCARD if the event is about:
- Lifestyle, sports, entertainment, celebrity, music, food, tourism
- Viral or human-interest stories (even if they mention NASA, military, police)
- Business, finance, stock markets, earnings, IPO, real estate
- Local crime, road accidents, natural disasters unrelated to conflict
- Domestic murder, homicide, family crime, police blotter
- Elections, parliament, routine diplomacy with no security dimension
- Humanitarian aid, health, education with no conflict context
- Labor disputes, strikes, wage negotiations, union actions (even if "violent")
- Hotel, hospitality, or consumer safety incidents
- Routine police operations, drug busts, local arrests unrelated to terrorism
- Accidents: industrial, construction, factory, workplace

Reply ONLY with a JSON object {"events":[...]} — one object per input:
{"id":"<same id>","keep":true,"fr":"French title <= 16 words","en":"English headline <= 16 words","notes":"French operational summary <= 22 words","category":"terrorism|military|conflict|protest|cyber|strategic|crisis|incident","countryCode":"ISO 3166-1 alpha-2 of the country the article is ABOUT (ignore the source domain/TLD), null if unclear"}

For discarded events, only return: {"id":"<same id>","keep":false}

Events:
${lines}`;
}

function mergeFilterResult(event, result) {
  if (!result || result.keep === false) return null;
  const category = VALID_CATEGORIES.has(result.category) ? result.category : event.category;
  if (category === 'discard') return null;
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
    countryCode,
  };
}

// ── API clients ──────────────────────────────────────────────────────────────
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

async function requestJsonArrayFromDeepSeek(messages) {
  if (!deepseekClient) {
    const err = new Error('DEEPSEEK_API_KEY missing');
    err.status = 503;
    throw err;
  }
  let completion;
  try {
    completion = await deepseekClient.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    }, { timeout: 45000 });
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const err = new Error(`DeepSeek HTTP_${status} ${(e?.message || '').slice(0, 180)}`);
    err.status = status >= 500 ? 502 : 503;
    throw err;
  }
  const text = parseChatTextContent(completion.choices?.[0]?.message?.content);
  const parsed = extractJsonObject(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.events)) return parsed.events;
  if (Array.isArray(parsed?.results)) return parsed.results;
  return extractJsonArray(text);
}

// ── Traduction unitaire (endpoint /translate-title — Google News RSS seulement)
async function translateTitleSingle(event) {
  const title = String(event?.title || '').trim();
  if (!title) {
    const err = new Error('title required');
    err.status = 400;
    throw err;
  }
  const client = deepseekClient || openaiClient;
  const model  = deepseekClient ? DEEPSEEK_MODEL : OPENAI_MODEL;
  if (!client) {
    const err = new Error('No API key available (DEEPSEEK_API_KEY or OPENAI_API_KEY required)');
    err.status = 503;
    throw err;
  }

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Translate OSINT/geopolitical article titles into concise French. Return JSON only.' },
        {
          role: 'user',
          content: JSON.stringify({
            title: event.title,
            domain: event.domain || '',
            country: event.country || '',
            category: event.category || 'incident',
            output: { fr: 'French title <= 16 words', en: 'English title <= 16 words', notes: 'French summary <= 22 words', language: 'detected language' },
          }),
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }, { timeout: 45000 });
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const err = new Error(`${deepseekClient ? 'DeepSeek' : 'OpenAI'} HTTP_${status} ${(e?.message || '').slice(0, 180)}`);
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
    provider: deepseekClient ? 'deepseek' : 'openai',
  };
}

// ── Filtre + traduction fusionnés (une seule passe IA) — avec cache inter-refresh
async function filterEventsWithAI(events) {
  if (!AI_FILTER_ENABLED) {
    console.log('[ai-filter] disabled via AI_FILTER_ENABLED=false');
    return events;
  }
  if (!DEEPSEEK_API_KEY && !OPENAI_API_KEY) {
    console.log('[ai-filter] skipped: no API key available');
    return events;
  }

  const allIds = new Set(events.map(e => String(e.id)));
  pruneCache(filterCache, allIds);

  // Séparer events déjà cachés vs nouveaux
  const enrichedById = new Map();
  const discardedIds = new Set();
  const uncached = [];
  let cacheHits = 0;

  for (const e of events) {
    const id = String(e.id);
    if (filterCache.has(id)) {
      cacheHits++;
      const cached = filterCache.get(id);
      if (cached) {
        enrichedById.set(e.id, {
          ...e,
          originalTitle: e.originalTitle || e.title,
          title: cached.fr || e.title,
          headline: cached.en || e.headline || null,
          notes: cached.notes || e.notes || null,
          category: cached.category || e.category,
          countryCode: cached.countryCode || e.countryCode,
        });
      } else {
        discardedIds.add(id);
      }
    } else {
      uncached.push(e);
    }
  }

  const candidates = uncached.slice(0, AI_FILTER_LIMIT);

  if (!candidates.length) {
    const filtered = events
      .map(e => enrichedById.get(e.id) || e)
      .filter(e => !discardedIds.has(String(e.id)));
    console.log(`[ai-filter] all cached — ${filtered.length}/${events.length} kept (${cacheHits} cache hits)`);
    return filtered;
  }

  const filterModel = DEEPSEEK_API_KEY ? DEEPSEEK_MODEL : OPENAI_MODEL;
  const provider    = DEEPSEEK_API_KEY ? 'deepseek' : 'openai';
  let aiProcessed = 0;

  for (let i = 0; i < candidates.length; i += AI_FILTER_BATCH) {
    const batch = candidates.slice(i, i + AI_FILTER_BATCH);
    const batchNum = Math.floor(i / AI_FILTER_BATCH) + 1;
    let success = false;

    for (let attempt = 1; attempt <= AI_FILTER_MAX_RETRIES; attempt++) {
      try {
        const messages = [
          { role: 'system', content: 'You are an OSINT military intelligence analyst. Return JSON only.' },
          { role: 'user', content: `Return a JSON object with an "events" array.\n${buildFilterPrompt(batch)}` },
        ];
        const results = DEEPSEEK_API_KEY
          ? await requestJsonArrayFromDeepSeek(messages)
          : await requestJsonArrayFromOpenAI(messages, filterModel, AI_FILTER_TIMEOUT_MS);

        let kept = 0;
        for (const result of results) {
          if (!result?.id) continue;
          const id = String(result.id);
          const original = batch.find(e => String(e.id) === id);
          if (!original) continue;

          if (result.keep === false) {
            filterCache.set(id, null);
            discardedIds.add(id);
          } else {
            const cacheEntry = {
              fr: result.fr || null,
              en: result.en || null,
              notes: result.notes || null,
              category: VALID_CATEGORIES.has(result.category) ? result.category : null,
              countryCode: typeof result.countryCode === 'string' && result.countryCode.length === 2
                ? result.countryCode.toUpperCase() : null,
            };
            filterCache.set(id, cacheEntry);
            const merged = mergeFilterResult(original, result);
            if (merged) enrichedById.set(original.id, merged);
            else { filterCache.set(id, null); discardedIds.add(id); }
            kept++;
          }
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

    // fail-open : événements non classés gardés tels quels
    if (!success) {
      for (const e of batch) filterCache.set(String(e.id), { fr: null, en: null, notes: null, category: null, countryCode: null });
      aiProcessed += batch.length;
    }
    if (i + AI_FILTER_BATCH < candidates.length) await sleep(AI_FILTER_DELAY);
  }

  const filtered = events
    .map(e => enrichedById.get(e.id) || e)
    .filter(e => !discardedIds.has(String(e.id)));
  console.log(`[ai-filter] done: ${discardedIds.size} discarded, ${filtered.length}/${events.length} kept (${aiProcessed} AI-sent, ${cacheHits} cached) [model: ${filterModel}, provider: ${provider}]`);
  return filtered;
}

module.exports = { normalizeTitleWithGemini: translateTitleSingle, filterEventsWithAI };
