'use strict';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.chatgpt;
const OPENAI_MODEL   = 'gpt-4o-mini';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Geocoding Nominatim (OpenStreetMap) ───────────────────────────────────
const geocodeCache = new Map();

// Centroïdes de repli pour les régions/pays souvent mal géocodés
const REGION_CENTROIDS = {
  'iran':            { lat: 32.4,  lon: 53.7  },
  'iraq':            { lat: 33.2,  lon: 43.7  },
  'gulf states':     { lat: 24.5,  lon: 54.4  },
  'persian gulf':    { lat: 26.5,  lon: 52.0  },
  'saudi arabia':    { lat: 23.9,  lon: 45.1  },
  'yemen':           { lat: 15.6,  lon: 48.5  },
  'syria':           { lat: 34.8,  lon: 38.9  },
  'lebanon':         { lat: 33.9,  lon: 35.5  },
  'russia':          { lat: 61.5,  lon: 90.0  },
  'ukraine':         { lat: 49.0,  lon: 32.0  },
  'china':           { lat: 35.9,  lon: 104.2 },
  'north korea':     { lat: 40.3,  lon: 127.5 },
  'south korea':     { lat: 36.5,  lon: 127.8 },
  'taiwan':          { lat: 23.7,  lon: 121.0 },
  'israel':          { lat: 31.5,  lon: 34.9  },
  'gaza':            { lat: 31.4,  lon: 34.3  },
  'west bank':       { lat: 31.9,  lon: 35.2  },
  'pakistan':        { lat: 30.4,  lon: 69.3  },
  'afghanistan':     { lat: 33.9,  lon: 67.7  },
  'sudan':           { lat: 15.6,  lon: 32.5  },
  'ethiopia':        { lat: 9.1,   lon: 40.5  },
  'somalia':         { lat: 5.2,   lon: 46.2  },
  'libya':           { lat: 26.3,  lon: 17.2  },
};

// Boîtes englobantes régionales — valide que Nominatim n'a pas dérivé
const REGION_BOUNDS = [
  { keys: ['iran','iraq','persian gulf','gulf states','saudi','kuwait','bahrain','qatar','uae','oman','yemen'],
    latMin: 12, latMax: 42, lonMin: 35, lonMax: 65 },
  { keys: ['russia','moscow','kremlin'],
    latMin: 41, latMax: 82, lonMin: 19, lonMax: 180 },
  { keys: ['ukraine','kyiv','kharkiv','zaporizhzhia','donbas','crimea'],
    latMin: 44, latMax: 53, lonMin: 22, lonMax: 41 },
  { keys: ['china','beijing','taiwan','hong kong','south china sea'],
    latMin: 15, latMax: 55, lonMin: 70, lonMax: 138 },
  { keys: ['north korea','pyongyang','dprk'],
    latMin: 37, latMax: 43, lonMin: 124, lonMax: 131 },
  { keys: ['israel','gaza','west bank','palestine','tel aviv','jerusalem'],
    latMin: 29, latMax: 34, lonMin: 33, lonMax: 36 },
  { keys: ['syria','damascus','aleppo','idlib'],
    latMin: 32, latMax: 38, lonMin: 35, lonMax: 43 },
  { keys: ['afghanistan','kabul'],
    latMin: 29, latMax: 39, lonMin: 60, lonMax: 75 },
  { keys: ['somalia','ethiopia','sudan','libya','sahel','mali','niger'],
    latMin: -5, latMax: 25, lonMin: -5, lonMax: 52 },
];

function getCentroid(location) {
  const loc = location.toLowerCase();
  for (const [key, coords] of Object.entries(REGION_CENTROIDS)) {
    if (loc.includes(key)) return coords;
  }
  return null;
}

function isCoordsPlausible(location, lat, lon) {
  const loc = location.toLowerCase();
  for (const bound of REGION_BOUNDS) {
    if (bound.keys.some(k => loc.includes(k))) {
      return lat >= bound.latMin && lat <= bound.latMax &&
             lon >= bound.lonMin && lon <= bound.lonMax;
    }
  }
  return true; // pas de règle connue → on accepte
}

async function geocode(location) {
  if (!location) return null;
  if (geocodeCache.has(location)) return geocodeCache.get(location);

  // Centroïde connu ? → on bypasse Nominatim pour les régions à risque
  const centroid = getCentroid(location);
  if (centroid) {
    geocodeCache.set(location, centroid);
    return centroid;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'WorldMonitor/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.[0]) return null;

    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);

    // Valide que les coords sont géographiquement cohérentes
    if (!isCoordsPlausible(location, lat, lon)) {
      console.warn(`[enrich] geocode drift detected for "${location}" → (${lat},${lon}) rejected`);
      return null;
    }

    const coords = { lat, lon };
    geocodeCache.set(location, coords);
    return coords;
  } catch {
    return null;
  }
}

// ── Appel Groq pour un batch d'événements ────────────────────────────────
const SYSTEM_PROMPT = `You are a strict intelligence analyst filtering news events for a geopolitical security monitoring dashboard.

Your task: classify each event as KEEP or REJECT based on direct operational relevance to national security and geopolitical intelligence.

KEEP events ONLY if they involve:
- Military operations, deployments, exercises, strikes, airstrikes, bombardments, frontline movements
- Armed conflicts, combat, clashes between armed groups
- Terrorism, counterterrorism, IED attacks, suicide bombings, mass hostage situations, beheadings
- Coups, attempted coups, seizure of power, armed uprisings, mutinies
- Cyberattacks, electronic warfare, sabotage of critical infrastructure (power grid, pipelines, government systems)
- Interstate border tensions, military standoffs, naval incidents, coercive state actions
- Sanctions with direct security or military implications (arms embargo, asset freeze on military entities)
- Nuclear weapons, ballistic missiles, WMD, hypersonic weapons, space defense activities
- Major geopolitical crises: state of emergency, martial law, diplomatic ruptures with military escalation
- Attacks on critical infrastructure (dams, ports, refineries, hospitals in war zones)

REJECT events that involve:
- Local or street crime (shootings, stabbings, robberies, carjacking, domestic violence, gang activity)
- Individual accidents (traffic, aviation, industrial, construction, workplace)
- Natural disasters, unless they trigger a military response or major political instability
- Court cases, trials, legal verdicts, indictments, sentencing, bail hearings
- Business, economy, markets, company earnings, trade deals, IPOs (unless a direct security sanction)
- Culture, arts, sports, entertainment, celebrity news
- Generic political speeches, press conferences, elections, routine diplomacy
- Opinion pieces, editorials, analysis articles, retrospectives, anniversaries
- Health, lifestyle, science discoveries, technology without security relevance
- Human interest stories, community events, social issues

STRICT RULE: When in doubt → REJECT. Only keep events an intelligence officer on watch duty would actively monitor. False positives are worse than false negatives. A relevance below 65 should mean keep=false.`;

async function enrichBatch(events, attempt = 0) {
  const userContent = `Classify these events. Return ONLY a valid JSON array, no markdown, no explanation.

CRITICAL: The "source_country" field is GDELT's automated extraction of the NEWS ARTICLE'S PUBLICATION LOCATION — it is NOT the event location and is frequently wrong (e.g., an Australian newspaper reporting on Ukraine will show Australia). You MUST infer the true event location exclusively from the "title" content. Ignore source_country for location purposes.

IMPORTANT: The "domain" field indicates the news source. State media domains (tass.ru, ria.ru, xinhuanet.com, news.cn, kcna.kp, presstv.ir, irna.ir, yonhapnews.co.kr, aljazeera.net) often have non-English URL slugs so the "title" may be a numeric ID or transliterated text. In these cases, use the domain + actor fields + subEventType to infer the event content and location. Do NOT reject events solely because the title is a numeric slug.

Events:
${events.map(e => `{"id":"${e.id}","title":"${e.title}","domain":"${e.domain||''}","source_country":"${e.country}","actor1":${JSON.stringify(e.actor1||null)},"actor2":${JSON.stringify(e.actor2||null)},"subEventType":${JSON.stringify(e.subEventType||null)}}`).join('\n')}

Required output format for each event:
{"id":"...","keep":true/false,"relevance":0-100,"title_fr":"titre français ≤12 mots","headline":"English headline ≤15 words","notes":"brief operational summary ≤20 words (what happened, where, who)","location":"Ville ou Pays réel de l'événement (inféré du titre uniquement)","category":"military|conflict|terrorism|protest|cyber|strategic|crisis|critical_incident|discard"}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  let resp;
  try {
    resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userContent }
        ],
        temperature: 0,
        max_tokens: 5000
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (resp.status === 429) {
    if (attempt < 2) {
      const wait = (attempt + 1) * 10000; // 10s, 20s max
      console.warn(`[enrich] 429 rate limit — retry in ${wait/1000}s (attempt ${attempt+1}/2)`);
      await sleep(wait);
      return enrichBatch(events, attempt + 1);
    }
    // Quota épuisé — signaler via exception pour court-circuiter les batches restants
    throw new Error('QUOTA_EXHAUSTED');
  }

  if (!resp.ok) throw new Error(`HTTP_${resp.status}`);

  const data  = await resp.json();
  const text  = data.choices?.[0]?.message?.content || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('NO_JSON');

  const results = JSON.parse(match[0]);
  const byId    = Object.fromEntries(results.map(r => [r.id, r]));

  // Filtre GPT désactivé — tous les événements passent, on garde uniquement l'enrichissement
  const kept = events;

  // Geocode corrected locations in parallel (max 1 req/s Nominatim policy)
  const geocoded = await Promise.all(
    kept.map(async (e, i) => {
      const r = byId[e.id]; // peut être undefined si GPT n'a pas retourné cet id
      if (!r) return e;     // pas d'enrichissement → on garde l'événement brut

      const aiLocation = r.location;
      let lat = e.lat, lon = e.lon;

      // Only geocode if AI returned a location different from GDELT's country
      if (aiLocation && aiLocation.toLowerCase() !== (e.country || '').toLowerCase()) {
        await sleep(i * 1100); // stagger requests — Nominatim: 1 req/s
        const coords = await geocode(aiLocation);
        if (coords) { lat = coords.lat; lon = coords.lon; }
      }

      return {
        ...e,
        title:        r.title_fr  || e.title,
        headline:     r.headline  || null,
        notes:        r.notes     || null,
        country:      aiLocation  || e.country,
        category:     r.category  || e.category,
        relevance:    r.relevance || 0,
        lat, lon,
        rawLat: lat, rawLon: lon
      };
    })
  );

  return geocoded;
}

// ── Enrichissement complet par batches de 20 ─────────────────────────────
async function enrichEvents(events) {
  // GPT step désactivé — retour direct sans filtre ni appel OpenAI
  console.log(`[enrich] GPT step SKIPPED — returning ${events.length} raw events`);
  return events;

  // eslint-disable-next-line no-unreachable
  console.log(`[enrich] API key present: ${!!OPENAI_API_KEY}`);
  if (!OPENAI_API_KEY || !events.length) return events;

  const BATCH_SIZE = 20;
  const enriched   = [];
  let kept = 0, rejected = 0, batchesDone = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    console.log(`[enrich] batch ${Math.floor(i/BATCH_SIZE)+1} — calling OpenAI...`);
    try {
      const result = await enrichBatch(batch);
      enriched.push(...result);
      kept     += result.length;
      rejected += batch.length - result.length;
      batchesDone++;
    } catch (err) {
      if (err.message === 'QUOTA_EXHAUSTED') {
        console.warn(`[enrich] quota épuisé après ${batchesDone} batches — abandon des batches restants`);
        // Ne pas injecter les événements bruts non filtrés dans le cache
        rejected += events.slice(i).length;
        break;
      }
      console.warn(`[enrich] batch ${batchesDone + 1} failed: ${err.message} — dropping (no raw passthrough)`);
      rejected += batch.length;
    }

    if (i + BATCH_SIZE < events.length) {
      await sleep(1000); // OpenAI a des rate limits bien plus généreux
    }
  }

  console.log(`[enrich] done — kept: ${kept} / rejected: ${rejected} / total: ${events.length}`);
  return enriched;
}

module.exports = { enrichEvents };
