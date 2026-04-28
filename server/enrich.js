'use strict';

const crypto = require('crypto');
const OpenAI = require('openai');

const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim().replace(/^=+/, '') || undefined;
const OPENAI_API_KEY   = (process.env.OPENAI_API_KEY || '').trim().replace(/^=+/, '') || undefined;
const LLM_PROVIDER     = (process.env.LLM_PROVIDER || (DEEPSEEK_API_KEY ? 'deepseek' : 'openai')).toLowerCase();
const ENRICH_MODEL     = process.env.ENRICH_MODEL || (LLM_PROVIDER === 'deepseek' ? 'deepseek-v4-flash' : 'gpt-4o');

const openaiClient = LLM_PROVIDER === 'deepseek'
  ? new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1' })
  : new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' });

// Compat interne
const OPENAI_MODEL   = ENRICH_MODEL;
const AI_FILTER_ENABLED = process.env.AI_FILTER_ENABLED !== 'false';

const TARGET_EVENTS = Number(process.env.GDELT_FINAL_EVENTS || 600);
const MAX_AI_CANDIDATES = Number(process.env.GDELT_AI_CANDIDATES || 900);
const BATCH_SIZE = Number(process.env.GDELT_AI_BATCH || 25);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_FILTER_TIMEOUT_MS || 120000);

const REGION_QUOTAS = {
  france: 40,
  europe: 70,
  russia_ukraine: 80,
  east_asia: 75,
  south_central_asia: 55,
  middle_east: 90,
  africa: 95,
  south_america: 55,
  north_america: 25,
  oceania: 15,
  other: 20,
};

const VALID_CATEGORIES = new Set([
  'terrorism', 'military', 'conflict', 'protest',
  'cyber', 'strategic', 'crisis', 'incident',
]);

const VALID_OSINT_DOMAINS = new Set(['spatial', 'aviation', 'maritime']);

const BUSINESS_NOISE_TERMS = [
  'stock', 'market', 'earnings', 'revenue', 'profit', 'loss', 'shares',
  'share price', 'analyst forecast', 'quarterly results', 'investing',
  'investment', 'samsung', 'semiconductor', 'semiconductors', 'memory chips',
  'chip demand', 'artificial intelligence demand',
  'acciones', 'bolsa', 'inversion', 'inversión', 'resultados', 'beneficio',
  'crece', 'crecimiento', 'esperado', 'demanda', 'chips de memoria',
  'inteligencia artificial',
  // Aviation civile — certifications, équipements cockpit, avions de lutte contre les incendies
  'waterbomber', 'water bomber', 'flight deck certified', 'avionics certified',
  'certified for', 'faa certified', 'easa certified', 'type certificate',
  'air tanker', 'fire bomber', 'firefighting aircraft', 'cl-415', 'cl415',
  'insight flight deck', 'cockpit upgrade', 'avionics upgrade',
];

const MEDICAL_NOISE_TERMS = [
  'hospital', 'birth', 'delivery', 'delivered', 'triplets', 'twins',
  'pregnant', 'pregnancy', 'mother', 'mothers', 'maternity', 'obstetric',
  'high risk mother', 'high-risk mother',
  '\uc774\ub300\ubaa9\ub3d9\ubcd1\uc6d0', '\ubcd1\uc6d0', '\uc138\uc30d\ub465\uc774',
  '\ucd9c\uc0b0', '\uc0b0\ubaa8', '\uace0\uc704\ud5d8',
];

const SECURITY_TERMS = [
  'war', 'attack', 'airstrike', 'strike', 'missile', 'drone', 'military',
  'army', 'navy', 'troops', 'terror', 'terrorism', 'hostage', 'bomb',
  'explosion', 'coup', 'riot', 'protest', 'sanction', 'border', 'cyberattack',
  'ransomware', 'hack', 'espionage', 'export ban', 'arms embargo',
];

const cache = new Map();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cacheKey(event) {
  const raw = `${event.id || ''}|${event.title || ''}|${event.url || ''}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function regionForEvent(event) {
  const code = String(event.countryCode || '').toUpperCase();
  const country = String(event.country || '').toLowerCase();
  const lat = Number(event.lat);
  const lon = Number(event.lon);

  if (code === 'FR' || country.includes('france')) return 'france';
  if (['RS','UP'].includes(code) || country.includes('russia') || country.includes('ukraine')) return 'russia_ukraine';
  if (['CH','TW','KN','KS','JA','VM'].includes(code) || (lat > 15 && lat < 55 && lon > 95 && lon < 150)) return 'east_asia';
  if (['IN','PK','AF','BG','NP','CE','KZ','KG','TI','TX','UZ'].includes(code) || (lat > 5 && lat < 55 && lon > 60 && lon <= 95)) return 'south_central_asia';
  if (['IR','IZ','IS','WE','GZ','JO','LE','SY','SA','YM','AE','QA','KU','BA','MU','TU'].includes(code) || (lat > 12 && lat < 43 && lon > 25 && lon < 65)) return 'middle_east';
  if ((lat > -35 && lat < 38 && lon > -20 && lon < 55)) return 'africa';
  if ((lat > -60 && lat < 15 && lon > -90 && lon < -30)) return 'south_america';
  if ((lat >= 15 && lat < 75 && lon > -170 && lon < -50)) return 'north_america';
  if ((lat > -50 && lat < 5 && lon > 110 && lon < 180)) return 'oceania';
  if ((lat > 34 && lat < 72 && lon > -25 && lon < 45)) return 'europe';
  return 'other';
}

function sortByScore(events) {
  return [...events].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function normalizeText(value) {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\u0600-\u06ff\u0400-\u04ffa-z0-9\s:/._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function hasAnyTerm(text, terms) {
  const decoded = decodeHtmlEntities(text).toLowerCase();
  const normalized = normalizeText(decoded);
  return terms.some(term => decoded.includes(decodeHtmlEntities(term).toLowerCase()) || normalized.includes(normalizeText(term)));
}

function isBusinessNoise(event) {
  const text = `${event.title || ''} ${event.url || ''} ${event.domain || ''} ${event.actor1 || ''} ${event.actor2 || ''}`;
  return hasAnyTerm(text, BUSINESS_NOISE_TERMS) && !hasAnyTerm(text, SECURITY_TERMS);
}

function isMedicalNoise(event) {
  const text = `${event.title || ''} ${event.url || ''} ${event.domain || ''} ${event.actor1 || ''} ${event.actor2 || ''}`;
  return hasAnyTerm(text, MEDICAL_NOISE_TERMS) && !hasAnyTerm(text, SECURITY_TERMS);
}

function isCivilianNoise(event) {
  return isBusinessNoise(event) || isMedicalNoise(event);
}

function pickRegionalCandidates(events, totalLimit = MAX_AI_CANDIDATES) {
  const sorted = sortByScore(events);
  const selected = [];
  const seen = new Set();

  function take(list, limit) {
    for (const event of list) {
      if (selected.length >= totalLimit || limit <= 0) break;
      if (seen.has(event.id)) continue;
      selected.push(event);
      seen.add(event.id);
      limit--;
    }
  }

  for (const [region, finalQuota] of Object.entries(REGION_QUOTAS)) {
    take(sorted.filter(event => regionForEvent(event) === region), Math.ceil(finalQuota * 1.4));
  }

  take(sorted, totalLimit - selected.length);
  return sortByScore(selected);
}

function compactEvent(event) {
  return {
    id: event.id,
    title: decodeHtmlEntities(event.title || '').slice(0, 220),
    domain: event.domain || '',
    country: event.country || '',
    countryCode: event.countryCode || '',
    actor1: event.actor1 || '',
    actor2: event.actor2 || '',
    eventCode: event.eventCode || '',
    rootCode: event.rootCode || '',
    subEventType: event.subEventType || event.subType || '',
    goldstein: Number(event.tone || 0),
    localCategory: event.category || 'incident',
    localScore: Math.round(Number(event.score || 0)),
    region: regionForEvent(event),
  };
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
  return `You are filtering OSINT/GDELT events for a world monitor map.

Goal: keep globally relevant security/geopolitical events while preserving regional coverage.

Keep:
- war, armed conflict, military activity, troop or naval movements, missiles, drones, airstrikes, border incidents
- terrorism, coups, violent unrest, major protests, state repression
- cyberattacks, sanctions with security impact, diplomatic ruptures, strategic crises
- major infrastructure attacks or emergencies with political/security impact

For each kept event, set osintDomain:
- "spatial": event is DIRECTLY about space (orbital launches, satellites, ICBMs/hypersonic missiles, space stations, space agency operations, GPS/GNSS jamming). NOT generic airstrikes, ceasefire talks, or ground conflict even if the article mentions a country like Ukraine.
- "aviation": event is DIRECTLY about military air operations (airstrikes, combat drones attack, fighter jet intercept, air defense engagement, military aircraft incursion). NOT civilian aviation.
- "maritime": event is DIRECTLY about naval operations (warship movement, naval battle, submarine activity, maritime blockade, coast guard military action).
- null: none of the above (default).

Reject:
- sports, entertainment, lifestyle, routine business, ordinary crime, local accidents, courts-only procedural stories, weather-only events
- duplicate-looking weak items, vague non-events, opinion/explainer pieces unless they contain a concrete new event
- business/stock/earnings/chip-demand stories such as Samsung growth or AI memory-chip demand unless they mention sanctions, export bans, cyberattack, military use, or national-security action
- medical/hospital/birth stories such as safe delivery of triplets unless they mention attack, war, terrorism, or a security incident
- civilian aviation news: aircraft certifications, flight deck upgrades, commercial airline routes, airport infrastructure, unless linked to a military operation or attack
- firefighting aircraft, waterbombers, air tankers used for civilian purposes (e.g. CL-415, air tractor)

Return ONLY a JSON object:
{"events":[{"id":"same id","keep":true,"priority":0,"category":"military|conflict|terrorism|protest|cyber|strategic|crisis|incident|discard","title_fr":"French title <= 14 words","headline":"English headline <= 14 words","notes":"French operational summary <= 18 words","osintDomain":"spatial|aviation|maritime|null"}]}

Events:
${events.map(event => JSON.stringify(compactEvent(event))).join('\n')}`;
}

async function classifyBatch(events, attempt = 0) {
  try {
    const completion = await openaiClient.chat.completions.create({
      model: ENRICH_MODEL,
      messages: [{ role: 'user', content: buildPrompt(events) }],
      temperature: 0,
      max_tokens: Math.max(2000, events.length * 150),
      response_format: { type: 'json_object' },
    }, { timeout: OPENAI_TIMEOUT_MS });
    const text = completion.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.events)) return parsed.events;
    if (Array.isArray(parsed.results)) return parsed.results;
    return extractJsonArray(text);
  } catch (e) {
    if (e?.status === 429 && attempt < 2) {
      const wait = (attempt + 1) * 8000;
      console.warn(`[enrich] 429; retry in ${wait / 1000}s`);
      await sleep(wait);
      return classifyBatch(events, attempt + 1);
    }
    throw new Error(`OpenAI HTTP_${e?.status || 500} ${(e?.message || '').slice(0, 160)}`);
  }
}

function mergeAiResult(event, result) {
  if (isCivilianNoise(event)) return null;

  const keep = result?.keep !== false && result?.category !== 'discard';
  if (!keep) return null;

  const category = VALID_CATEGORIES.has(result?.category) ? result.category : event.category;
  const aiPriority = Math.max(0, Math.min(100, Number(result?.priority || 0)));
  const score = Number(event.score || 0) + aiPriority;

  // Domaine OSINT : l'AI prime toujours sur le seed keyword dès qu'elle a répondu.
  // - result défini + osintDomain = 'spatial'|'aviation'|'maritime' → on garde
  // - result défini + osintDomain absent/null/autre → on force null (pas de fallback keyword)
  // - result undefined (batch en erreur, event non trouvé) → on garde le seed keyword
  const aiDomain = result?.osintDomain;
  const osintDomain = (result !== undefined)
    ? (VALID_OSINT_DOMAINS.has(aiDomain) ? aiDomain : null)
    : (event.osintDomain || null);

  return {
    ...event,
    originalTitle: event.originalTitle || event.title,
    nativeTitle: event.nativeTitle || event.title,
    title: event.title,
    titleFr: result?.title_fr || event.titleFr || null,
    headline: result?.headline || event.headline || null,
    notes: result?.notes || event.notes || null,
    category,
    relevance: aiPriority,
    score,
    aiProvider: 'openai',
    aiModel: OPENAI_MODEL,
    region: regionForEvent(event),
    osintDomain,
  };
}

function selectFinalEvents(events, totalLimit = TARGET_EVENTS) {
  const sorted = sortByScore(events.filter(event => !isCivilianNoise(event)));
  const selected = [];
  const seen = new Set();

  function take(list, limit) {
    for (const event of list) {
      if (selected.length >= totalLimit || limit <= 0) break;
      if (seen.has(event.id)) continue;
      selected.push(event);
      seen.add(event.id);
      limit--;
    }
  }

  for (const [region, quota] of Object.entries(REGION_QUOTAS)) {
    take(sorted.filter(event => regionForEvent(event) === region), quota);
  }

  take(sorted, totalLimit - selected.length);
  return sortByScore(selected);
}

async function enrichEvents(events) {
  if (!events?.length) return [];

  const cleaned = events.filter(event => !isCivilianNoise(event));
  const candidates = pickRegionalCandidates(cleaned);
  console.log(`[enrich] OpenAI filter ${AI_FILTER_ENABLED ? 'enabled' : 'disabled'} — ${candidates.length}/${events.length} candidates, target ${TARGET_EVENTS} (${events.length - cleaned.length} civilian noise removed)`);

  if (!AI_FILTER_ENABLED || (!DEEPSEEK_API_KEY && !OPENAI_API_KEY)) {
    if (!DEEPSEEK_API_KEY && !OPENAI_API_KEY) console.warn('[enrich] no AI API key; using local regional selection');
    return selectFinalEvents(candidates);
  }

  const enriched = [];
  const uncached = [];

  for (const event of candidates) {
    const key = cacheKey(event);
    if (cache.has(key)) {
      const cached = cache.get(key);
      if (cached) enriched.push(cached);
    } else {
      uncached.push(event);
    }
  }

  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    console.log(`[enrich] batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uncached.length / BATCH_SIZE)} — ${batch.length} events`);
    try {
      const results = await classifyBatch(batch);
      const byId = new Map(results.map(result => [String(result.id), result]));
      for (const event of batch) {
        const merged = mergeAiResult(event, byId.get(String(event.id)));
        cache.set(cacheKey(event), merged);
        if (merged) enriched.push(merged);
      }
    } catch (err) {
      console.warn(`[enrich] batch failed: ${err.message}; keeping local candidates`);
      for (const event of batch) {
        cache.set(cacheKey(event), event);
        enriched.push(event);
      }
    }
    if (i + BATCH_SIZE < uncached.length) await sleep(250);
  }

  const finalEvents = selectFinalEvents(enriched);
  console.log(`[enrich] done — ${finalEvents.length}/${events.length} events selected (${enriched.length} kept after AI)`);
  return finalEvents;
}

module.exports = { enrichEvents, regionForEvent, selectFinalEvents };
