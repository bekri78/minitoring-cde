'use strict';

/**
 * google-news-rss.js — Google News RSS multi-domain OSINT feed
 *
 * Architecture :
 *   1. Fetch RSS (toutes les 3h)
 *   2. Dédup immédiate (titre, source, date)
 *   3. Classification regex (domaine déjà connu via le flux + mots-clés)
 *   4. Extraction géo par regex + dictionnaire pays/villes connus
 *   5. Géocodage Nominatim (gratuit)
 *   6. IA uniquement sur les articles ambigus (lieu non détecté + domaine incertain)
 *
 * Coût IA : quasi nul — seuls ~5-10% des articles passent par l'IA.
 */

const fs   = require('fs');
const path = require('path');

// ── Configuration ─────────────────────────────────────────────────────────────

const OpenAI = require('openai');
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim().replace(/^=+/, '') || undefined;
const OPENAI_API_KEY   = ((process.env.OPENAI_API_KEY || process.env.chatgpt) || '').trim().replace(/^=+/, '') || undefined;
const LLM_PROVIDER     = (process.env.LLM_PROVIDER || (DEEPSEEK_API_KEY ? 'deepseek' : OPENAI_API_KEY ? 'openai' : 'none')).toLowerCase();
const OPENAI_MODEL     = process.env.OPENAI_TRANSLATE_MODEL || process.env.OPENAI_MODEL || (LLM_PROVIDER === 'deepseek' ? 'deepseek-v4-flash' : 'gpt-4o');
const openaiClient     = LLM_PROVIDER === 'deepseek'
  ? new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1' })
  : LLM_PROVIDER === 'openai'
  ? new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' })
  : null;

const CACHE_DIR      = process.env.CACHE_DIR || '/data';
const DISK_PATH      = path.join(CACHE_DIR, 'google-news-events.json');
const CACHE_TTL_MS   = 3 * 60 * 60 * 1000; // 3h
const MAX_EVENTS     = 500;
const DEDUP_HOURS    = 72;
const DEDUP_GEO_KM   = 100;
const MAX_ITEM_AGE_HOURS = Number(process.env.GNEWS_MAX_AGE_HOURS || 48);

const NOMINATIM_URL  = 'https://nominatim.openstreetmap.org/search';
const GEOCODE_DELAY  = 1100; // 1 req/s Nominatim

// ── RSS Feed definitions ──────────────────────────────────────────────────────
// Flux globaux par type d'activité

const RSS_FEEDS = [
  // ── GLOBAL par domaine (pas de hintLocation — mondial) ──────────────
  { domain: 'spatial',  label: 'Space & Satellites',
    query: '("satellite launch" OR "military satellite" OR "spy satellite" OR "rocket launch" OR "space launch" OR "space force" OR "space weapon" OR "anti-satellite")' },
  { domain: 'spatial',  label: 'Space Ops & Launches',
    query: '(Vandenberg OR "Cape Canaveral" OR Wallops OR Baikonur OR "Rocket Lab" OR Ariane OR "space station" OR "ISS cargo" OR orbit) (launch OR satellite OR military OR weapon)' },
  { domain: 'missile',  label: 'Missile Activity',
    query: '("missile test" OR "ballistic missile" OR "hypersonic missile" OR "rocket test")' },
  { domain: 'naval',    label: 'Naval Military',
    query: '("naval exercise" OR "warship deployment" OR "carrier strike group" OR "submarine patrol")' },
  { domain: 'aviation', label: 'Military Aviation',
    query: '("fighter jet" OR "airstrike" OR "military aircraft" OR "drone strike")' },
  { domain: 'military', label: 'Military Crises',
    query: '("military escalation" OR "troop deployment" OR "border clashes" OR "armed conflict")' },

  // ── PUISSANCES MAJEURES ─────────────────────────────────────────────
  { domain: 'military', label: 'China Military', hintLocation: 'china',
    query: '(China OR Chinese) (military OR missile OR naval OR satellite OR "South China Sea" OR Taiwan)' },
  { domain: 'military', label: 'Russia Military', hintLocation: 'russia',
    query: '(Russia OR Russian) (military OR missile OR nuclear OR Arctic OR Ukraine OR "Black Sea")' },
  { domain: 'military', label: 'USA Military', hintLocation: 'united states',
    query: '(Pentagon OR "US military" OR "US Navy" OR "US Air Force" OR CENTCOM OR INDOPACOM)' },

  // ── SPATIAL PAR PAYS ────────────────────────────────────────────────
  { domain: 'spatial', label: 'Ukraine Satellite', hintLocation: 'ukraine',
    query: '(Ukraine OR Ukrainian) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR Starlink OR "communication satellite" OR "electronic warfare" OR terminal)' },
  { domain: 'spatial', label: 'Russia Space', hintLocation: 'russia',
    query: '(Russia OR Russian) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR Roscosmos OR Soyuz OR "space weapon" OR ASAT OR Yamal OR Glonass OR cosmodrome)' },
  { domain: 'spatial', label: 'China Space', hintLocation: 'china',
    query: '(China OR Chinese) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR "Long March" OR Tiangong OR Beidou OR "space station" OR Jiuquan OR Xichang OR Wenchang)' },
  { domain: 'spatial', label: 'USA Space', hintLocation: 'united states',
    query: '(USA OR American OR "United States") ("Space Force" OR "spy satellite" OR NRO OR "space command" OR "space weapon" OR "military satellite" OR ASAT OR "anti-satellite" OR "satellite launch" OR "rocket launch")' },
  { domain: 'spatial', label: 'India Space', hintLocation: 'india',
    query: '(India OR Indian OR ISRO) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR ASAT OR Chandrayaan OR Gaganyaan OR PSLV OR GSLV)' },
  { domain: 'spatial', label: 'Europe Space', hintLocation: 'france',
    query: '(ESA OR Ariane OR "European Space" OR Copernicus OR Galileo OR CNES) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR launch)' },
  { domain: 'spatial', label: 'Iran Space', hintLocation: 'iran',
    query: '(Iran OR Iranian) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR Simorgh OR Safir OR "space program")' },
  { domain: 'spatial', label: 'North Korea Space', hintLocation: 'north korea',
    query: '("North Korea" OR DPRK) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR "spy satellite" OR reconnaissance)' },
  { domain: 'spatial', label: 'Japan Space', hintLocation: 'japan',
    query: '(Japan OR JAXA) (satellite OR "space launch" OR "rocket launch" OR orbit OR space OR "H3 rocket" OR "space debris" OR Hayabusa)' },

  // ── PROLIFÉRATION / MENACES NUCLÉAIRES ──────────────────────────────
  { domain: 'missile',  label: 'North Korea', hintLocation: 'north korea',
    query: '("North Korea" OR DPRK OR Pyongyang) (missile OR nuclear OR launch OR test OR military)' },
  { domain: 'military', label: 'Iran Military', hintLocation: 'iran',
    query: '(Iran OR Iranian OR IRGC) (military OR nuclear OR missile OR naval OR drone OR Hormuz)' },
  { domain: 'missile',  label: 'Pakistan Military', hintLocation: 'pakistan',
    query: '(Pakistan OR Pakistani) (military OR nuclear OR missile OR "border clash" OR India)' },

  // ── ZONES DE CONFLIT ACTIF ──────────────────────────────────────────
  { domain: 'military', label: 'Ukraine Conflict', hintLocation: 'ukraine',
    query: '(Ukraine OR Ukrainian) (military OR frontline OR offensive OR drone OR missile OR Crimea)' },
  { domain: 'military', label: 'Israel Conflict', hintLocation: 'israel',
    query: '(Israel OR IDF OR Gaza OR Hezbollah OR Lebanon) (military OR strike OR airstrike OR operation)' },
  { domain: 'military', label: 'Syria Conflict', hintLocation: 'syria',
    query: '(Syria OR Syrian) (military OR airstrike OR Russia OR Turkey OR drone OR "Islamic State")' },
  { domain: 'military', label: 'Yemen / Red Sea', hintLocation: 'yemen',
    query: '(Yemen OR Houthi OR "Red Sea") (military OR missile OR drone OR ship OR attack OR naval)' },

  // ── POINTS CHAUDS RÉGIONAUX ─────────────────────────────────────────
  { domain: 'naval',    label: 'Taiwan Strait', hintLocation: 'taiwan strait',
    query: '("Taiwan Strait" OR "Taiwan military" OR "Chinese military" Taiwan) (exercise OR warship OR tension OR escalation)' },
  { domain: 'military', label: 'India Military', hintLocation: 'india',
    query: '(India OR Indian) (military OR missile OR naval OR border OR China OR Pakistan OR satellite)' },
  { domain: 'missile',  label: 'South Korea Defense', hintLocation: 'south korea',
    query: '("South Korea" OR Seoul) (military OR missile OR defense OR THAAD OR "North Korea")' },
  { domain: 'military', label: 'Turkey Military', hintLocation: 'turkey',
    query: '(Turkey OR Turkish) (military OR drone OR Syria OR Mediterranean OR Libya OR NATO)' },
  { domain: 'military', label: 'Japan Defense', hintLocation: 'japan',
    query: '(Japan OR Japanese) (military OR defense OR "East China Sea" OR missile OR Okinawa)' },

  // ── ZONES STRATÉGIQUES ──────────────────────────────────────────────
  { domain: 'naval',    label: 'South China Sea', hintLocation: 'south china sea',
    query: '("South China Sea") (military OR naval OR warship OR island OR tension OR patrol)' },
  { domain: 'naval',    label: 'Arctic Military', hintLocation: 'arctic',
    query: '(Arctic) (military OR naval OR Russia OR submarine OR base OR patrol OR route)' },
  { domain: 'naval',    label: 'Baltic Sea', hintLocation: 'baltic sea',
    query: '("Baltic Sea" OR Baltic) (military OR NATO OR Russia OR submarine OR cable OR patrol)' },

  // ── AFRIQUE / SAHEL ─────────────────────────────────────────────────
  { domain: 'military', label: 'Sudan Conflict', hintLocation: 'sudan',
    query: '(Sudan OR Sudanese OR Khartoum OR RSF OR Darfur) (military OR conflict OR war OR airstrike)' },
  { domain: 'military', label: 'Libya Conflict', hintLocation: 'libya',
    query: '(Libya OR Libyan OR Tripoli) (military OR militia OR drone OR Wagner OR Turkey)' },
  { domain: 'military', label: 'Somalia / Horn', hintLocation: 'somalia',
    query: '(Somalia OR "al-Shabaab" OR "Horn of Africa") (military OR attack OR piracy OR US strike)' },
];

function buildRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

// ── State ─────────────────────────────────────────────────────────────────────

let cache = { events: [], lastUpdate: null };
let isFetching = false;

// ── Disk persistence ──────────────────────────────────────────────────────────

function saveToDisk() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(DISK_PATH, JSON.stringify(cache));
    console.log(`[google-news] saved ${cache.events.length} events to disk`);
  } catch (err) {
    console.warn('[google-news] disk save failed:', err.message);
  }
}

function loadFromDisk() {
  try {
    const data = JSON.parse(fs.readFileSync(DISK_PATH, 'utf8'));
    if (data?.events?.length) {
      console.log(`[google-news] restored ${data.events.length} events from disk`);
      return data;
    }
  } catch (_) {}
  return null;
}

const _disk = loadFromDisk();
if (_disk) cache = _disk;

// ── XML parser (lightweight, no dep) ──────────────────────────────────────────

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m  = xml.match(re);
  return m ? m[1].trim() : '';
}

function extractCdata(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const m  = xml.match(re);
  if (m) return m[1].trim();
  return extractTag(xml, tag);
}

function extractSourceAttr(itemXml) {
  const m = itemXml.match(/<source[^>]*url="([^"]*)"[^>]*>([^<]*)<\/source>/i);
  if (m) return { sourceUrl: m[1], sourceName: m[2].trim() };
  return { sourceUrl: '', sourceName: extractTag(itemXml, 'source') };
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractCdata(block, 'title') || extractTag(block, 'title');
    const link  = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const { sourceUrl, sourceName } = extractSourceAttr(block);
    if (title) {
      items.push({ title: decodeEntities(title), link, pubDate, sourceName, sourceUrl });
    }
  }
  return items;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// ── Fetch RSS ─────────────────────────────────────────────────────────────────

async function fetchRssFeed(feed) {
  const url = buildRssUrl(feed.query);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OSINT-Monitor/1.0)',
        'Accept':     'application/rss+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    const items = parseRssItems(xml);
    console.log(`[google-news] ${feed.label}: ${items.length} items`);
    return items.map(item => ({ ...item, domain: feed.domain, feedLabel: feed.label, hintLocation: feed.hintLocation || '' }));
  } catch (err) {
    console.warn(`[google-news] fetch ${feed.label} failed:`, err.message);
    return [];
  }
}

// ── Link resolution ───────────────────────────────────────────────────────────

async function resolveGoogleLink(googleUrl) {
  if (!googleUrl || !googleUrl.includes('news.google.com')) return googleUrl;
  try {
    const resp = await fetch(googleUrl, {
      method:  'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OSINT-Monitor/1.0)' },
      signal:  AbortSignal.timeout(8000),
    });
    return resp.url || googleUrl;
  } catch {
    return googleUrl;
  }
}

// ── REGEX classification (gratuit, 0 token) ───────────────────────────────────

// Zones stratégiques non-urbaines (mers, détroits, bases, régions — absentes de all-the-cities)
// Pays exclus : ils vivent dans COUNTRY_COORDS et ne sont utilisés qu'en dernier recours,
// pour que "Russian strike on Kharkiv" épingle Kharkiv, pas Moscou.
const STRATEGIC_ZONES = new Map([
  ['south china sea',       { lat: 12.00, lon: 114.00 }],
  ['red sea',               { lat: 20.00, lon: 38.50  }],
  ['strait of hormuz',      { lat: 26.56, lon: 56.25  }],
  ['strait of taiwan',      { lat: 24.50, lon: 119.50 }],
  ['taiwan strait',         { lat: 24.50, lon: 119.50 }],
  ['hormuz',                { lat: 26.56, lon: 56.25  }],
  ['arctic',                { lat: 71.00, lon: 25.00  }],
  ['baltic sea',            { lat: 58.00, lon: 20.00  }],
  ['black sea',             { lat: 43.00, lon: 34.00  }],
  ['east china sea',        { lat: 30.00, lon: 125.00 }],
  ['persian gulf',          { lat: 26.00, lon: 52.00  }],
  ['mediterranean',         { lat: 35.00, lon: 18.00  }],
  ['mediterranean sea',     { lat: 35.00, lon: 18.00  }],
  ['gulf of aden',          { lat: 12.00, lon: 46.00  }],
  ['gulf of oman',          { lat: 22.00, lon: 59.00  }],
  ['arabian sea',           { lat: 15.00, lon: 65.00  }],
  ['north sea',             { lat: 56.00, lon: 3.00   }],
  ['bering strait',         { lat: 65.60, lon: -168.00}],
  ['strait of malacca',     { lat: 4.00,  lon: 100.00 }],
  ['suez canal',            { lat: 30.45, lon: 32.35  }],
  ['bab el-mandeb',         { lat: 12.58, lon: 43.33  }],
  ['strait of gibraltar',   { lat: 35.96, lon: -5.60  }],
  ['english channel',       { lat: 50.20, lon: -0.70  }],
  ['korean peninsula',      { lat: 38.32, lon: 127.24 }],
  ['horn of africa',        { lat: 8.00,  lon: 48.00  }],
  ['sahel',                 { lat: 14.50, lon: 0.00   }],
  ['senkaku',               { lat: 25.75, lon: 123.50 }],
  ['spratly',               { lat: 8.64,  lon: 111.92 }],
  ['paracel',               { lat: 16.50, lon: 112.00 }],
  ['kuril islands',         { lat: 46.83, lon: 151.75 }],
  ['guam',                  { lat: 13.44, lon: 144.79 }],
  ['diego garcia',          { lat: -7.31, lon: 72.41  }],
  ['cape canaveral',        { lat: 28.39, lon: -80.60 }],
  ['vandenberg',            { lat: 34.74, lon: -120.57}],
  ['vandenberg sfb',        { lat: 34.74, lon: -120.57}],
  ['pentagon',              { lat: 38.87, lon: -77.06 }],
  ['white house',           { lat: 38.90, lon: -77.04 }],
  ['kremlin',               { lat: 55.75, lon: 37.62  }],
  ['plesetsk',              { lat: 62.93, lon: 40.58  }],
  ['vostochny',             { lat: 51.88, lon: 128.33 }],
  ['baikonur',              { lat: 45.96, lon: 63.31  }],
  ['jiuquan',               { lat: 39.74, lon: 98.49  }],
  ['xichang',               { lat: 27.90, lon: 102.26 }],
  ['wenchang',              { lat: 19.61, lon: 110.95 }],
  ['crimea',                { lat: 44.95, lon: 34.10  }],
  ['donbas',                { lat: 48.20, lon: 38.00  }],
  ['donbass',               { lat: 48.20, lon: 38.00  }],
  ['gaza',                  { lat: 31.35, lon: 34.31  }],
  ['gaza strip',            { lat: 31.35, lon: 34.31  }],
  ['west bank',             { lat: 31.95, lon: 35.30  }],
  ['cisjordanie',           { lat: 31.95, lon: 35.30  }],
  ['golan heights',         { lat: 33.00, lon: 35.75  }],
]);

// Bâtiments-acteurs : résolvables comme lieux ("at the Pentagon") mais jamais
// prioritaires au scan du titre — "Pentagon confirms strike in Somalia" ≠ Washington.
const ACTOR_PLACES = new Set(['pentagon', 'white house', 'kremlin']);

// Pays (toutes langues des flux) → capitale/centroïde. Utilisés :
//  - en résolution locative ("in Lebanon" — et jamais Lebanon, Pennsylvanie)
//  - en fallback pays quand aucun lieu spécifique n'est trouvé dans le titre
const COUNTRY_COORDS = new Map([
  // English
  ['north korea',    { lat: 39.04, lon: 125.76 }], ['south korea',   { lat: 35.91, lon: 127.77 }],
  ['united states',  { lat: 38.90, lon: -77.04 }], ['usa',           { lat: 38.90, lon: -77.04 }],
  ['taiwan',         { lat: 23.70, lon: 120.96 }], ['china',         { lat: 39.90, lon: 116.40 }],
  ['russia',         { lat: 55.75, lon: 37.62  }], ['ukraine',       { lat: 50.45, lon: 30.52  }],
  ['iran',           { lat: 35.69, lon: 51.39  }], ['israel',        { lat: 31.77, lon: 35.22  }],
  ['india',          { lat: 28.61, lon: 77.21  }], ['pakistan',      { lat: 33.69, lon: 73.04  }],
  ['turkey',         { lat: 39.93, lon: 32.85  }], ['japan',         { lat: 35.68, lon: 139.69 }],
  ['syria',          { lat: 33.51, lon: 36.29  }], ['yemen',         { lat: 15.37, lon: 44.19  }],
  ['libya',          { lat: 32.90, lon: 13.18  }], ['sudan',         { lat: 15.60, lon: 32.53  }],
  ['somalia',        { lat: 2.05,  lon: 45.32  }], ['iraq',          { lat: 33.34, lon: 44.40  }],
  ['saudi arabia',   { lat: 24.71, lon: 46.68  }], ['egypt',         { lat: 30.04, lon: 31.24  }],
  ['france',         { lat: 48.86, lon: 2.35   }], ['germany',       { lat: 52.52, lon: 13.41  }],
  ['united kingdom', { lat: 51.51, lon: -0.13  }], ['myanmar',       { lat: 16.87, lon: 96.20  }],
  ['philippines',    { lat: 14.60, lon: 120.98 }], ['vietnam',       { lat: 21.03, lon: 105.85 }],
  ['afghanistan',    { lat: 34.53, lon: 69.17  }], ['brazil',        { lat: -15.79, lon: -47.88}],
  ['lebanon',        { lat: 33.89, lon: 35.50  }], ['palestine',     { lat: 31.90, lon: 35.20  }],
  ['jordan',         { lat: 31.95, lon: 35.93  }], ['georgia',       { lat: 41.72, lon: 44.79  }],
  ['armenia',        { lat: 40.18, lon: 44.51  }], ['azerbaijan',    { lat: 40.41, lon: 49.87  }],
  ['belarus',        { lat: 53.90, lon: 27.56  }], ['moldova',       { lat: 47.01, lon: 28.86  }],
  ['poland',         { lat: 52.23, lon: 21.01  }], ['romania',       { lat: 44.43, lon: 26.10  }],
  ['finland',        { lat: 60.17, lon: 24.94  }], ['sweden',        { lat: 59.33, lon: 18.07  }],
  ['norway',         { lat: 59.91, lon: 10.75  }], ['estonia',       { lat: 59.44, lon: 24.75  }],
  ['latvia',         { lat: 56.95, lon: 24.11  }], ['lithuania',     { lat: 54.69, lon: 25.28  }],
  ['greece',         { lat: 37.98, lon: 23.73  }], ['cyprus',        { lat: 35.17, lon: 33.36  }],
  ['qatar',          { lat: 25.29, lon: 51.53  }], ['kuwait',        { lat: 29.38, lon: 47.99  }],
  ['bahrain',        { lat: 26.23, lon: 50.59  }], ['oman',          { lat: 23.59, lon: 58.41  }],
  ['united arab emirates', { lat: 24.45, lon: 54.38 }], ['uae',      { lat: 24.45, lon: 54.38  }],
  ['ethiopia',       { lat: 9.01,  lon: 38.75  }], ['eritrea',       { lat: 15.34, lon: 38.93  }],
  ['nigeria',        { lat: 9.06,  lon: 7.49   }], ['algeria',       { lat: 36.75, lon: 3.06   }],
  ['morocco',        { lat: 34.02, lon: -6.84  }], ['tunisia',       { lat: 36.81, lon: 10.18  }],
  ['kenya',          { lat: -1.29, lon: 36.82  }], ['venezuela',     { lat: 10.49, lon: -66.88 }],
  ['colombia',       { lat: 4.71,  lon: -74.07 }], ['mexico',        { lat: 19.43, lon: -99.13 }],
  ['cuba',           { lat: 23.11, lon: -82.37 }], ['canada',        { lat: 45.42, lon: -75.70 }],
  ['australia',      { lat: -35.28, lon: 149.13}], ['indonesia',     { lat: -6.21, lon: 106.85 }],
  ['malaysia',       { lat: 3.14,  lon: 101.69 }], ['thailand',      { lat: 13.76, lon: 100.50 }],
  ['cambodia',       { lat: 11.55, lon: 104.92 }], ['bangladesh',    { lat: 23.81, lon: 90.41  }],
  ['sri lanka',      { lat: 6.93,  lon: 79.85  }], ['nepal',         { lat: 27.72, lon: 85.32  }],
  ['kazakhstan',     { lat: 51.13, lon: 71.43  }], ['uzbekistan',    { lat: 41.30, lon: 69.24  }],
  ['tajikistan',     { lat: 38.56, lon: 68.79  }], ['kyrgyzstan',    { lat: 42.87, lon: 74.59  }],
  ['turkmenistan',   { lat: 37.95, lon: 58.38  }], ['mongolia',      { lat: 47.89, lon: 106.91 }],
  ['italy',          { lat: 41.90, lon: 12.50  }], ['spain',         { lat: 40.42, lon: -3.70  }],
  ['portugal',       { lat: 38.72, lon: -9.14  }], ['netherlands',   { lat: 52.37, lon: 4.90   }],
  ['belgium',        { lat: 50.85, lon: 4.35   }], ['denmark',       { lat: 55.68, lon: 12.57  }],
  ['serbia',         { lat: 44.79, lon: 20.45  }], ['kosovo',        { lat: 42.66, lon: 21.17  }],
  ['hungary',        { lat: 47.50, lon: 19.04  }], ['bulgaria',      { lat: 42.70, lon: 23.32  }],
  ['croatia',        { lat: 45.81, lon: 15.98  }], ['albania',       { lat: 41.33, lon: 19.82  }],
  ['slovakia',       { lat: 48.15, lon: 17.11  }], ['czech republic',{ lat: 50.08, lon: 14.44  }],
  ['austria',        { lat: 48.21, lon: 16.37  }], ['switzerland',   { lat: 46.95, lon: 7.45   }],
  ['ireland',        { lat: 53.35, lon: -6.26  }], ['iceland',       { lat: 64.15, lon: -21.94 }],
  ['greenland',      { lat: 64.18, lon: -51.72 }], ['panama',        { lat: 8.98,  lon: -79.52 }],
  ['haiti',          { lat: 18.54, lon: -72.34 }], ['argentina',     { lat: -34.60, lon: -58.38}],
  ['chile',          { lat: -33.45, lon: -70.67}], ['peru',          { lat: -12.05, lon: -77.04}],
  ['ecuador',        { lat: -0.18, lon: -78.47 }], ['bolivia',       { lat: -16.50, lon: -68.15}],
  ['guyana',         { lat: 6.80,  lon: -58.16 }], ['south africa',  { lat: -25.75, lon: 28.19 }],
  ['angola',         { lat: -8.84, lon: 13.23  }], ['mozambique',    { lat: -25.97, lon: 32.57 }],
  ['uganda',         { lat: 0.35,  lon: 32.58  }], ['tanzania',      { lat: -6.79, lon: 39.21  }],
  ['rwanda',         { lat: -1.94, lon: 30.06  }], ['burkina faso',  { lat: 12.37, lon: -1.52  }],
  ['senegal',        { lat: 14.72, lon: -17.47 }], ['cameroon',      { lat: 3.87,  lon: 11.52  }],
  ['chad',           { lat: 12.13, lon: 15.06  }], ['djibouti',      { lat: 11.59, lon: 43.15  }],
  ['south sudan',    { lat: 4.85,  lon: 31.58  }], ['new zealand',   { lat: -41.29, lon: 174.78}],
  ['mali',           { lat: 12.65, lon: -8.00  }], ['niger',         { lat: 13.51, lon: 2.12   }],
  // French country names — France 24, RFI, Le Monde, TV5 coverage
  ['liban',          { lat: 33.89, lon: 35.50  }], ['syrie',         { lat: 34.80, lon: 38.90  }],
  ['irak',           { lat: 33.34, lon: 44.40  }], ['russie',        { lat: 55.75, lon: 37.62  }],
  ['chine',          { lat: 39.91, lon: 116.39 }], ['yémen',         { lat: 15.55, lon: 44.21  }],
  ['libye',          { lat: 32.90, lon: 13.18  }], ['soudan',        { lat: 15.55, lon: 32.53  }],
  ['corée du nord',  { lat: 39.04, lon: 125.76 }], ['corée du sud',  { lat: 35.91, lon: 127.77 }],
  ['birmanie',       { lat: 16.87, lon: 96.19  }],
  // Arabic romanized
  ['lubnan',         { lat: 33.89, lon: 35.50  }], ['suriya',        { lat: 34.80, lon: 38.90  }],
  ['al-yaman',       { lat: 15.55, lon: 44.21  }],
  // Spanish / Portuguese
  ['líbano',         { lat: 33.89, lon: 35.50  }], ['siria',         { lat: 34.80, lon: 38.90  }],
  ['irán',           { lat: 35.69, lon: 51.39  }], ['ucrania',       { lat: 48.38, lon: 31.17  }],
  ['corea del norte',{ lat: 39.04, lon: 125.76 }],
]);

// ── Index mondial de villes (all-the-cities, 135k entrées) ───────────────────
// Construit au premier accès — instantané, 0 appel HTTP, 0 token IA
let _cityIndex = null;

function getCityIndex() {
  if (_cityIndex) return _cityIndex;
  _cityIndex = new Map();
  try {
    const cities = require('all-the-cities');
    // Trier par population décroissante pour que les villes importantes
    // gagnent en cas de conflit de noms (ex: "Springfield" → USA, pop max)
    cities.sort((a, b) => (b.population || 0) - (a.population || 0));
    // Garde-fous anti-faux-positifs : les petits villages homonymes de mots
    // courants ("Of" en Turquie, "Along" en Inde) polluent la géolocalisation.
    const acceptName = (name, population) => {
      if (!name) return false;
      const key = name.toLowerCase();
      if (LOCATION_STOPWORDS.has(key)) return false;
      if (name.length < 4 && population < 500000) return false; // garde Qom/Ufa, vire "Of"
      if (population < 5000) return false;
      return true;
    };
    for (const c of cities) {
      const pop = c.population || 0;
      const coords = { lat: c.loc.coordinates[1], lon: c.loc.coordinates[0] };
      const key = c.name.toLowerCase();
      if (acceptName(c.name, pop) && !_cityIndex.has(key)) {
        _cityIndex.set(key, coords);
      }
      // Indexer aussi l'altName si présent
      if (c.altName && acceptName(c.altName, pop)) {
        const altKey = c.altName.toLowerCase();
        if (!_cityIndex.has(altKey)) {
          _cityIndex.set(altKey, coords);
        }
      }
    }
    console.log(`[google-news] city index: ${_cityIndex.size} entrées chargées`);
  } catch (e) {
    console.warn('[google-news] all-the-cities non disponible:', e.message);
  }
  return _cityIndex;
}

// Suffixes administratifs à supprimer pour normaliser "Sumy Region" → "Sumy"
const ADMIN_SUFFIXES = /\s+(region|oblast|province|district|county|prefecture|governorate|wilaya|state|raion|republic|area|zone|department|municipality)\s*$/i;

// Mots à exclure des candidats lieux
const LOCATION_STOPWORDS = new Set([
  'the', 'this', 'that', 'new', 'first', 'two', 'three', 'more', 'top', 'major',
  'says', 'said', 'reports', 'after', 'before', 'amid', 'during', 'about',
  'military', 'nuclear', 'missile', 'satellite', 'naval', 'army', 'navy',
  'air', 'force', 'defense', 'attack', 'strike', 'war', 'conflict',
  'breaking', 'update', 'analysis', 'opinion', 'exclusive', 'report',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  // Titraille / tournures fréquentes ("At Least 5 Killed", "In Pictures")
  'least', 'pictures', 'photos', 'photo', 'video', 'videos', 'watch', 'live',
  'alert', 'edge', 'terror', 'terrorism', 'crisis', 'peace', 'talks', 'deal',
  'agreement', 'summit', 'second', 'third', 'fourth', 'fifth', 'final', 'next',
  'last', 'day', 'days', 'week', 'weeks', 'month', 'year', 'years', 'state',
  'south', 'north', 'east', 'west', 'western', 'eastern', 'northern', 'southern',
  'central', 'strikes', 'attacks', 'forces', 'troops', 'weapons', 'drone', 'drones',
  // Agences / médias / organisations — jamais des lieux d'événement
  'reuters', 'bloomberg', 'associated press', 'afp', 'cnn', 'bbc', 'fox',
  'nato', 'un', 'eu', 'european union', 'united nations',
  'spacex', 'nasa', 'boeing', 'lockheed', 'lockheed martin', 'raytheon',
  'northrop', 'northrop grumman', 'airbus', 'starlink', 'roscosmos',
  'congress', 'senate', 'parliament', 'president', 'minister', 'ministry',
  // Dirigeants — "Austin says", "Biden warns" ne sont pas Austin TX / Biden ND
  'biden', 'trump', 'putin', 'zelensky', 'zelenskyy', 'netanyahu', 'khamenei',
  'erdogan', 'macron', 'modi', 'austin', 'hegseth', 'lavrov', 'wang',
]);

// ── Spatial noise: civil/tourism/entertainment space content ──────────────────
const SPATIAL_NOISE_RE = new RegExp([
  // NASA civil programs & exploration missions (not military/intel)
  'artemis\\s*(?:i{1,3}|[1-4]|program|mission|crew|moon|lunar)',
  'moon\\s*(?:mission|landing|base|program|exploration|return)',
  'mars\\s*(?:mission|rover|helicopter|sample|colony|base|exploration)',
  'james webb', 'hubble', 'jwst',
  'voyager', 'curiosity\\s*rover', 'perseverance\\s*rover',
  'europa\\s*clipper', 'dragonfly\\s*mission',
  // Space tourism & commercial crew (not strategic)
  'space\\s*tour', 'space\\s*tourism', 'space\\s*tourist',
  'civilian\\s*astronaut', 'private\\s*astronaut', 'space\\s*hotel',
  'axiom\\s*mission', 'inspiration4', 'polaris\\s*dawn',
  'blue\\s*origin.*(?:tourist|crew|passenger)',
  'virgin\\s*galactic',
  // Science/exploration (no military dimension)
  'asteroid\\s*(?:sample|mining|redirect|defense|mission)',
  'comet', 'exoplanet', 'telescope', 'deep\\s*space\\s*network',
  'planetary\\s*defense', 'solar\\s*probe', 'solar\\s*orbiter',
  // Public/entertainment
  'how\\s*to\\s*(?:see|watch|view)', 'viewing\\s*guide', 'visible\\s*(?:from|in)',
  'sonic\\s*boom', 'livestream', 'live\\s*stream', 'live\\s*coverage',
  'launch\\s*(?:photo|video|watch|viewing)', '(?:photo|video).*launch',
  'watching.*launch', 'launch.*watch',
  'spacex.*(?:record|milestone|anniversary|100th)',
].join('|'), 'i');

// Terms that override spatial noise (keep the article if these are present)
const SPATIAL_STRATEGIC_RE = /military|spy|reconnaissance|nro|classified|ussf|space force|dod|pentagon|space weapon|asat|anti.satellite|jamming|spoofing|electronic warfare|icbm|slbm|hypersonic|ballistic|nuclear|warhead|intelligence|surveillance|early warning|missile defense|missile tracking|space command|weaponiz/i;

function isSpatialNoise(title) {
  return SPATIAL_NOISE_RE.test(title) && !SPATIAL_STRATEGIC_RE.test(title);
}

function detectDomainFromTitle(title) {
  const t = title.toLowerCase();

  // Missile FIRST — avoids "rocket launch" false positives for military rocket / Hezbollah / IDF
  if (/missile|ballistic|hypersonic|icbm|slbm|warhead/i.test(t))                return 'missile';
  // Military rocket ≠ space: exclude "rocket launch" when context is clearly military strikes
  if (/hezbollah|hamas|idf|israel.*rocket|rocket.*platform.*target|strikes.*rocket/i.test(t)) return 'military';
  // Spatial: genuine space/satellite context — broad keyword set
  if (/satellite|space launch|orbit|space force|spaceforce|spacex|starlink|falcon 9|atlas v|vulcan|nasa.*launch|blue origin|vandenberg|cape canaveral|wallops|minotaur|delta iv|soyuz|long march|ariane|vega.*rocket|electron.*rocket|rocket lab|ula |iss |international space station|cosmodrome|baikonur|jiuquan|xichang|wenchang|space daily|spaceflight|spacety|xona space/i.test(t)) return 'spatial';
  // "rocket launch" only if no military context words
  if (/rocket launch|rocket.*liftoff|launch.*rocket/i.test(t) && !/strike|attack|target|military|bomb|shell|hezbollah|hamas|idf|israel|intercept/i.test(t)) return 'spatial';
  if (/naval|warship|carrier|submarine|fleet|destroyer|frigate|navy/i.test(t))   return 'naval';
  if (/fighter jet|airstrike|air force|drone strike|military aircraft|bomber|f-35|f-16|su-/i.test(t)) return 'aviation';
  return 'military';
}

function detectEventType(title, domain) {
  const t = title.toLowerCase();
  const types = {
    spatial:  [
      [/satellite launch|rocket launch|space launch|orbital launch/i, 'satellite_launch'],
      [/spy|reconnaissance|nro|classified satellite/i, 'spy_satellite'],
      [/debris|collision|space.*incident/i, 'space_incident'], [/reentry|re-entry/i, 'reentry_risk'],
      [/asat|anti.satellite|jamming|spoofing|space.*weapon/i, 'space_warfare'],
    ],
    missile: [
      [/test/i, 'missile_test'], [/ballistic/i, 'ballistic_missile'],
      [/hypersonic/i, 'hypersonic_test'], [/intercept/i, 'missile_defense'],
    ],
    naval: [
      [/exercise/i, 'naval_exercise'], [/deploy/i, 'fleet_deployment'],
      [/carrier/i, 'carrier_ops'], [/submarine/i, 'submarine_activity'],
      [/patrol/i, 'naval_patrol'],
    ],
    aviation: [
      [/airstrike|strike/i, 'airstrike'], [/drone/i, 'drone_strike'],
      [/intercept/i, 'air_intercept'], [/exercise/i, 'air_exercise'],
    ],
    military: [
      [/escalat/i, 'escalation'], [/deploy/i, 'troop_deployment'],
      [/clash/i, 'border_clash'], [/offensive/i, 'offensive'],
      [/ceasefire/i, 'ceasefire'], [/sanction/i, 'sanctions'],
    ],
  };
  for (const [re, type] of (types[domain] || types.military)) {
    if (re.test(t)) return type;
  }
  return domain;
}

// ── Country detection from title content ─────────────────────────────────────
// Maps country names/adjectives mentioned in titles to their canonical location key
// Used to override hintLocation when the article clearly discusses a different country
const TITLE_COUNTRY_MAP = new Map([
  ['china',         'china'],        ['chinese',       'china'],
  ['russia',        'russia'],       ['russian',       'russia'],
  ['ukraine',       'ukraine'],      ['ukrainian',     'ukraine'],
  ['iran',          'iran'],         ['iranian',       'iran'],
  ['israel',        'israel'],       ['israeli',       'israel'],
  ['india',         'india'],        ['indian',        'india'],
  ['pakistan',       'pakistan'],     ['pakistani',     'pakistan'],
  ['turkey',        'turkey'],       ['turkish',       'turkey'],
  ['japan',         'japan'],        ['japanese',      'japan'],
  ['north korea',   'north korea'],  ['dprk',          'north korea'],  ['pyongyang',     'north korea'],
  ['south korea',   'south korea'],  ['seoul',         'south korea'],
  ['taiwan',        'taiwan'],       ['taiwanese',     'taiwan'],
  ['france',        'france'],       ['french',        'france'],
  ['germany',       'germany'],      ['german',        'germany'],
  ['united kingdom','united kingdom'],['british',      'united kingdom'],['uk ',           'united kingdom'],
  ['syria',         'syria'],        ['syrian',        'syria'],
  ['yemen',         'yemen'],        ['houthi',        'yemen'],
  ['libya',         'libya'],        ['libyan',        'libya'],
  ['sudan',         'sudan'],        ['sudanese',      'sudan'],
  ['somalia',       'somalia'],
  ['iraq',          'iraq'],         ['iraqi',         'iraq'],
  ['saudi',         'saudi arabia'], ['saudi arabia',  'saudi arabia'],
  ['egypt',         'egypt'],        ['egyptian',      'egypt'],
  ['brazil',        'brazil'],       ['brazilian',     'brazil'],
  ['myanmar',       'myanmar'],
  ['philippines',   'philippines'],  ['philippine',    'philippines'],
  ['vietnam',       'vietnam'],      ['vietnamese',    'vietnam'],
  ['afghanistan',   'afghanistan'],  ['afghan',        'afghanistan'],
  ['lebanon',       'lebanon'],      ['lebanese',      'lebanon'],
  ['hezbollah',     'lebanon'],      ['hamas',         'gaza'],
  ['palestine',     'palestine'],    ['palestinian',   'palestine'],
  ['jordan',        'jordan'],       ['jordanian',     'jordan'],
  ['armenia',       'armenia'],      ['armenian',      'armenia'],
  ['azerbaijan',    'azerbaijan'],   ['azerbaijani',   'azerbaijan'],
  ['georgia',       'georgia'],
  ['belarus',       'belarus'],      ['belarusian',    'belarus'],
  ['moldova',       'moldova'],      ['moldovan',      'moldova'],
  ['poland',        'poland'],       ['polish',        'poland'],
  ['romania',       'romania'],      ['romanian',      'romania'],
  ['finland',       'finland'],      ['finnish',       'finland'],
  ['sweden',        'sweden'],       ['swedish',       'sweden'],
  ['norway',        'norway'],       ['norwegian',     'norway'],
  ['estonia',       'estonia'],      ['estonian',      'estonia'],
  ['latvia',        'latvia'],       ['latvian',       'latvia'],
  ['lithuania',     'lithuania'],    ['lithuanian',    'lithuania'],
  ['greece',        'greece'],       ['greek',         'greece'],
  ['cyprus',        'cyprus'],
  ['qatar',         'qatar'],        ['qatari',        'qatar'],
  ['kuwait',        'kuwait'],       ['kuwaiti',       'kuwait'],
  ['bahrain',       'bahrain'],      ['oman',          'oman'],
  ['emirati',       'united arab emirates'], ['uae',   'united arab emirates'],
  ['ethiopia',      'ethiopia'],     ['ethiopian',     'ethiopia'],
  ['eritrea',       'eritrea'],      ['eritrean',      'eritrea'],
  ['nigeria',       'nigeria'],      ['nigerian',      'nigeria'],
  ['algeria',       'algeria'],      ['algerian',      'algeria'],
  ['morocco',       'morocco'],      ['moroccan',      'morocco'],
  ['tunisia',       'tunisia'],      ['tunisian',      'tunisia'],
  ['kenya',         'kenya'],        ['kenyan',        'kenya'],
  ['mali',          'mali'],         ['malian',        'mali'],
  ['niger',         'niger'],        ['chad',          'chad'],
  ['venezuela',     'venezuela'],    ['venezuelan',    'venezuela'],
  ['colombia',      'colombia'],     ['colombian',     'colombia'],
  ['mexico',        'mexico'],       ['mexican',       'mexico'],
  ['cuba',          'cuba'],         ['cuban',         'cuba'],
  ['canada',        'canada'],       ['canadian',      'canada'],
  ['australia',     'australia'],    ['australian',    'australia'],
  ['indonesia',     'indonesia'],    ['indonesian',    'indonesia'],
  ['malaysia',      'malaysia'],     ['malaysian',     'malaysia'],
  ['thailand',      'thailand'],     ['thai',          'thailand'],
  ['cambodia',      'cambodia'],     ['cambodian',     'cambodia'],
  ['bangladesh',    'bangladesh'],   ['bangladeshi',   'bangladesh'],
  ['sri lanka',     'sri lanka'],    ['nepal',         'nepal'],
  ['kazakhstan',    'kazakhstan'],   ['kazakh',        'kazakhstan'],
  ['uzbekistan',    'uzbekistan'],   ['uzbek',         'uzbekistan'],
  ['tajikistan',    'tajikistan'],   ['kyrgyzstan',    'kyrgyzstan'],
  ['mongolia',      'mongolia'],     ['mongolian',     'mongolia'],
  ['italy',         'italy'],        ['italian',       'italy'],
  ['spain',         'spain'],        ['portugal',      'portugal'],
  ['netherlands',   'netherlands'],  ['dutch',         'netherlands'],
  ['belgium',       'belgium'],      ['belgian',       'belgium'],
  ['denmark',       'denmark'],      ['danish',        'denmark'],
  ['serbia',        'serbia'],       ['serbian',       'serbia'],
  ['kosovo',        'kosovo'],       ['hungary',       'hungary'],
  ['hungarian',     'hungary'],      ['bulgaria',      'bulgaria'],
  ['bulgarian',     'bulgaria'],     ['croatia',       'croatia'],
  ['albania',       'albania'],      ['albanian',      'albania'],
  ['slovakia',      'slovakia'],     ['czech republic','czech republic'],
  ['czech',         'czech republic'], ['austria',     'austria'],
  ['switzerland',   'switzerland'],  ['swiss',         'switzerland'],
  ['ireland',       'ireland'],      ['irish',         'ireland'],
  ['iceland',       'iceland'],      ['greenland',     'greenland'],
  ['panama',        'panama'],       ['haiti',         'haiti'],
  ['argentina',     'argentina'],    ['argentine',     'argentina'],
  ['chile',         'chile'],        ['chilean',       'chile'],
  ['peru',          'peru'],         ['peruvian',      'peru'],
  ['ecuador',       'ecuador'],      ['bolivia',       'bolivia'],
  ['guyana',        'guyana'],       ['south africa',  'south africa'],
  ['angola',        'angola'],       ['mozambique',    'mozambique'],
  ['uganda',        'uganda'],       ['tanzania',      'tanzania'],
  ['rwanda',        'rwanda'],       ['burkina faso',  'burkina faso'],
  ['senegal',       'senegal'],      ['cameroon',      'cameroon'],
  ['djibouti',      'djibouti'],     ['south sudan',   'south sudan'],
  ['new zealand',   'new zealand'],
]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Regex pays précompilées, triées multi-mots d'abord ("North Korea" avant "Korea")
let _countryMatchers = null;
function getCountryMatchers() {
  if (!_countryMatchers) {
    _countryMatchers = [...TITLE_COUNTRY_MAP.entries()]
      .sort((a, b) => b[0].length - a[0].length)
      .map(([name, canonical]) => ({ re: new RegExp(`\\b${escapeRe(name)}\\b`, 'i'), canonical }));
  }
  return _countryMatchers;
}

function detectCountryFromTitle(title) {
  for (const { re, canonical } of getCountryMatchers()) {
    if (re.test(title)) return canonical;
  }
  return null;
}

// Regex zones précompilées, plus longues d'abord ; bâtiments-acteurs exclus
// (le Pentagone qui *parle* d'une frappe en Somalie n'est pas le lieu de la frappe)
let _zoneMatchers = null;
function getZoneMatchers() {
  if (!_zoneMatchers) {
    _zoneMatchers = [...STRATEGIC_ZONES.keys()]
      .filter(name => !ACTOR_PLACES.has(name))
      .sort((a, b) => b.length - a.length)
      .map(name => ({ name, re: new RegExp(`\\b${escapeRe(name)}\\b`, 'i') }));
  }
  return _zoneMatchers;
}

// Modifieurs minuscules tolérés entre préposition/verbe et le nom propre
const LOC_MODIFIERS = `(?:(?:the|a|an|its|his|her|their|southern|northern|eastern|western|central|occupied|rebel-held|war-torn|coastal|northwestern|northeastern|southwestern|southeastern)\\s+){0,2}`;
const PROPER_NAME   = `([A-ZÀ-ÿ][a-zA-ZÀ-ÿ'’-]+(?:\\s+[A-ZÀ-ÿ][a-zA-ZÀ-ÿ'’-]+){0,3})`;

// Contexte LOCATIF : le lieu capturé est celui de l'ÉVÉNEMENT.
// C'est la seule source autorisée à interroger l'index villes et Nominatim.
const LOCATIVE_PATTERNS = [
  // "in Kharkiv", "near Odesa", "strike on Kharkiv", "into Poland"
  new RegExp(`\\b(?:in|near|over|off|at|around|across|inside|outside|on|onto|into|toward|towards)\\s+${LOC_MODIFIERS}${PROPER_NAME}`, 'g'),
  // Verbe → cible : "hits Moscow", "strikes Beirut", "captures Pokrovsk"
  new RegExp(`\\b(?:hits?|struck|strikes?|attack(?:s|ed)?|bomb(?:s|ed)?|shell(?:s|ed)?|pound(?:s|ed)?|target(?:s|ed)?|captures?|captured|seizes?|seized|liberates?|liberated|enters?|entered|invades?|invaded|reaches?|reached)\\s+${LOC_MODIFIERS}${PROPER_NAME}`, 'g'),
  // Prépositions FR : "en Syrie", "au Liban", "dans le Donbass", "sur Kharkiv"
  new RegExp(`\\b(?:en|au|aux|dans\\s+le|dans\\s+la|depuis|vers|sur)\\s+${PROPER_NAME}`, 'g'),
  // ES : "en el Líbano", "en la frontera"
  new RegExp(`\\b(?:en\\s+el|en\\s+la)\\s+${PROPER_NAME}`, 'g'),
];

// Contexte SUJET/ACTEUR : "China launches…", "Israel's military…". L'acteur n'est
// le lieu que s'il est un pays/zone — jamais résolu contre l'index villes,
// pour éviter "SpaceX launches" → ville, "Austin says" → Texas.
const SUBJECT_PATTERNS = [
  new RegExp(`\\b${PROPER_NAME}\\s+(?:launches?|tests?|fires?|deploys?|strikes?|attacks?|warns?|conducts?|holds?|begins?|masses?)`, 'g'),
  new RegExp(`\\b${PROPER_NAME}(?:'s|’s)?\\s+(?:military|navy|air\\s+force|army|defen[cs]e|missile|satellite|forces|troops)`, 'g'),
  // Article FR : "le Liban", "la Syrie" — trop ambigu pour l'index villes
  new RegExp(`\\b(?:le|la|les)\\s+${PROPER_NAME}`, 'g'),
];

function extractCandidates(title, patterns) {
  const out = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(title)) !== null) {
      const loc = m[1].replace(/['’]s$/i, '').trim();
      if (loc.length >= 3 && !LOCATION_STOPWORDS.has(loc.toLowerCase())) {
        out.push(loc);
      }
    }
  }
  return out;
}

// Résout un candidat en essayant des préfixes décroissants :
// "Kharkiv Amid Fierce Fighting" → "Kharkiv" ; "South China Sea Dispute" → "South China Sea"
function resolveCandidate(candidate) {
  const words = candidate.split(/\s+/);
  for (let n = Math.min(words.length, 4); n >= 1; n--) {
    const sub = words.slice(0, n).join(' ');
    if (LOCATION_STOPWORDS.has(sub.toLowerCase())) continue;
    if (lookupKnown(sub)) return sub;
  }
  return null;
}

// Résolution restreinte aux pays + zones (candidats sujets)
function matchZoneOrCountry(candidate) {
  const words = candidate.toLowerCase().split(/\s+/);
  for (let n = Math.min(words.length, 3); n >= 1; n--) {
    const key = words.slice(0, n).join(' ');
    if (LOCATION_STOPWORDS.has(key)) continue;
    if (STRATEGIC_ZONES.has(key) || COUNTRY_COORDS.has(key)) return key;
  }
  return null;
}

// Filtre de sécurité avant l'envoi d'un candidat non validé à Nominatim
function isSafeForGeocoding(candidate) {
  const words = candidate.split(/\s+/);
  if (candidate.length < 4 || words.length > 3) return false;
  return words.every(w => !LOCATION_STOPWORDS.has(w.toLowerCase().replace(/[^\wà-ÿ'-]/gi, '')));
}

function detectLocationFromTitle(title) {
  const t = title;

  // 1. Zones stratégiques spécifiques (mers, détroits, bases, régions contestées)
  for (const { name, re } of getZoneMatchers()) {
    if (re.test(t)) return name;
  }

  // 2. Candidats LOCATIFS — le lieu réel de l'événement prime sur le pays de
  //    l'acteur : "Russian missile strike on Kharkiv" → Kharkiv, pas Moscou
  const locative = extractCandidates(t, LOCATIVE_PATTERNS);
  for (const cand of locative) {
    const resolved = resolveCandidate(cand);
    if (resolved) return resolved;
  }

  // 3. Candidats SUJETS — pays/zones uniquement ("China launches satellite" → china)
  const subject = extractCandidates(t, SUBJECT_PATTERNS);
  for (const cand of subject) {
    const key = matchZoneOrCountry(cand);
    if (key) return key;
  }

  // 4. Mention de pays n'importe où, adjectifs inclus ("Russian", "Chinese")
  const country = detectCountryFromTitle(t);
  if (country && lookupKnown(country)) return country;

  // 5. Dernier recours : premier candidat locatif plausible — Nominatim le
  //    validera (classe + importance). Jamais un candidat sujet.
  return locative.find(isSafeForGeocoding) || '';
}

function computeConfidence(title, domain, feedDomain, location) {
  let score = 55; // base — les feeds sont déjà ciblés sécurité/défense
  const t = title.toLowerCase();

  // ── Bonus génériques ───────────────────────────────────────────────
  if (domain === feedDomain) score += 10;       // domaine flux = domaine détecté
  if (location)              score += 15;       // lieu identifié
  if (t.split(/\s+/).length <= 15) score += 5;  // titre court = info factuelle

  // Mots d'action forts (événement en cours) → +12  ("launch" exclu — traité par domaine)
  if (/test|strike|attack|deploy|exercise|fire|intercept|shoot|bomb|detonate|explosion|incident|breach|intrusion/i.test(t)) score += 12;

  // ── Bonus militaire/stratégique par domaine ────────────────────────
  if (domain === 'spatial') {
    // Spatial noise (Artemis, tourism, science publique) → forte pénalité
    if (isSpatialNoise(t)) score -= 50;
    // Vrai décollage spatial : rocket + satellite/orbit/space context → très pertinent
    if (/rocket launch|satellite launch|space launch|orbital launch|missile launch|ballistic.*launch|launch.*satellite|launch.*rocket|launch.*orbit|liftoff.*rocket|rocket.*liftoff/i.test(t)) score += 25;
    // Pertinente : militaire, renseignement, guerre spatiale
    if (SPATIAL_STRATEGIC_RE.test(t)) score += 20;
    // Non-spatial "launch" : produit, app, initiative, campagne → pénalité forte
    if (/launch/i.test(t) && !/rocket|satellite|space|orbital|orbit|missile|capsule|payload|vehicle|booster|spacecraft|probe|liftoff|pad|silo|ICBM|SLBM|sounding/i.test(t)) score -= 40;
    // Pénalité forte : contenu civil/tourisme/science grand public
    if (/how to (see|watch|view)|viewing guide|liftoff (time|tonight)|visible (from|in)|sonic boom|ticket|livestream|live stream|live coverage|photo.*launch|launch.*photo|watching.*launch|launch.*watch/i.test(t)) score -= 45;
    // Pénalité modérée : commercial SpaceX/Starlink sans enjeu militaire
    if (/spacex|falcon 9|starlink/i.test(t) && !SPATIAL_STRATEGIC_RE.test(t)) score -= 25;
    // Pénalité : Artemis, missions lunaires civiles sans dimension militaire
    if (/artemis|moon mission|lunar.*mission|mars.*mission/i.test(t) && !SPATIAL_STRATEGIC_RE.test(t)) score -= 40;
  }

  if (domain === 'aviation') {
    // Pertinente : militaire, frappe, drone militaire
    if (/military|airstrike|air strike|bomber|fighter|f-35|f-16|su-|mig|drone strike|shootdown|intercept|scramble|warplane|combat|air force|close air support/i.test(t)) score += 20;
    // Pénalité forte : aviation civile
    if (/airline|passenger|commercial flight|airport|flight delay|ticket|booking|baggage|travel|tourism|runway|gate|departure|arrival|cargo plane|freighter/i.test(t)) score -= 50;
  }

  if (domain === 'naval') {
    // Pertinente : militaire, exercice, tension navale
    if (/military|warship|navy|naval|destroyer|frigate|submarine|carrier|exercise|patrol|drill|blockade|incident|collision|intrusion|contested/i.test(t)) score += 20;
    // Pénalité forte : maritime civil
    if (/cruise ship|container ship|cargo ship|merchant|ferry|fishing|coast guard rescue|grounded|stuck|accident|pollution|piracy.*cargo|shipping lane.*trade/i.test(t)) score -= 50;
  }

  if (domain === 'missile') {
    // Vrai tir/test missile → bonus fort
    if (/launch|test|fire|intercept|detonate|explode|hit|struck|shoot down/i.test(t)) score += 15;
    // "launch" non-missile (produit, app, initiative) → pénalité
    if (/launch/i.test(t) && !/missile|rocket|ballistic|hypersonic|icbm|slbm|warhead|projectile|munition|weapon/i.test(t)) score -= 30;
  }

  if (domain === 'military') {
    // Pertinente : opérations, conflits, déploiements
    if (/offensive|assault|battle|war|conflict|casualt|killed|soldier|troops|frontline|ceasefire|escalat|invasion|occupation|siege/i.test(t)) score += 15;
    // Pénalité : opinion, analyse, diplomatie pure
    if (/summit|diplomat|sanction|trade war|tariff|negotiat/i.test(t) && !/military|troops|army|force|weapon/i.test(t)) score -= 25;
  }

  // ── Pénalités génériques (bruit) ──────────────────────────────────
  if (/opinion|editorial|could|might|may consider|if.*war|hypothetical|scenario|what if/i.test(t)) score -= 20;
  if (/historical|anniversary|years ago|world war ii|cold war era|in \d{4}|commemorat|memorial/i.test(t)) score -= 30;
  if (/sport|football|soccer|basketball|cricket|olympic|medal|tourism|hotel|restaurant|recipe|fashion|entertainment/i.test(t)) score -= 60;
  // Business/tech/finance noise
  if (/stock|shares|earnings|revenue|profit|ipo|startup|investment|market cap|quarterly|fiscal|dividend/i.test(t) && !/sanction|embargo|military|weapon|defense/i.test(t)) score -= 40;
  // Education / health / social
  if (/school board|curriculum|university|vaccine|covid|pandemic|hospital|patient|medical/i.test(t) && !/attack|military|weapon|strike|bomb/i.test(t)) score -= 35;
  // Routine diplomacy / non-crisis
  if (/summit|state visit|trade agreement|trade deal|diplomatic visit|bilateral talks/i.test(t) && !/military|weapon|nuclear|sanction|crisis|war|conflict/i.test(t)) score -= 25;

  return Math.max(10, Math.min(95, score));
}

// Seuil minimum par domaine — aviation/naval/spatial exigent plus de pertinence
const MIN_CONFIDENCE_BY_DOMAIN = {
  spatial:  62,
  aviation: 60,
  naval:    60,
  missile:  55,
  military: 50,
};

// ── Geocoding ─────────────────────────────────────────────────────────────────

const geocodeCache = new Map();

function lookupKnown(location) {
  if (!location) return null;
  let key = location.toLowerCase().trim();

  // 1. Zones stratégiques (mers, détroits, bases — priorité absolue)
  if (STRATEGIC_ZONES.has(key)) return STRATEGIC_ZONES.get(key);

  // 2. Pays (avant l'index villes : "Lebanon" = le pays, pas Lebanon, Pennsylvanie)
  if (COUNTRY_COORDS.has(key)) return COUNTRY_COORDS.get(key);

  // 3. Index mondial all-the-cities
  const idx = getCityIndex();
  if (idx.has(key)) return idx.get(key);

  // 4. Suppression des suffixes administratifs : "Sumy Region" → "Sumy"
  const stripped = key.replace(ADMIN_SUFFIXES, '').trim();
  if (stripped !== key) {
    if (STRATEGIC_ZONES.has(stripped)) return STRATEGIC_ZONES.get(stripped);
    if (COUNTRY_COORDS.has(stripped)) return COUNTRY_COORDS.get(stripped);
    if (idx.has(stripped)) return idx.get(stripped);
  }

  return null;
}

async function geocodeLocation(location) {
  if (!location) return null;
  const key = location.toLowerCase().trim();

  // 1. Lookup local (zones + 135k villes) — instantané
  const known = lookupKnown(location);
  if (known) return known;

  // 2. Cache mémoire Nominatim
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  // 3. Nominatim — dernier recours (zones inconnues, bases, régions exotiques)
  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=3&accept-language=en`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'OSINT-Monitor/1.0 (monitoring-cde)' },
      signal:  AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const pick = Array.isArray(data) ? data.find(isTrustedGeocodeResult) : null;
    if (pick) {
      const result = { lat: parseFloat(pick.lat), lon: parseFloat(pick.lon) };
      geocodeCache.set(key, result);
      return result;
    }
    if (Array.isArray(data) && data.length) {
      console.log(`[google-news] geocode "${location}" rejected (${data[0].class}/${data[0].type}, importance=${data[0].importance})`);
    }
  } catch (err) {
    console.warn(`[google-news] geocode "${location}" failed:`, err.message);
  }
  geocodeCache.set(key, null);
  return null;
}

// N'accepte que des résultats géographiques crédibles : sans ce filtre, Nominatim
// "trouve" un village obscur pour presque n'importe quelle chaîne (nom de société,
// personne, fragment de titre) et l'article atterrit au mauvais endroit.
function isTrustedGeocodeResult(r) {
  if (!r || !r.lat || !r.lon) return false;
  const cls  = String(r.class || '');
  const type = String(r.type || '');
  // Bases militaires / installations aériennes : noms spécifiques, toujours fiables
  if (cls === 'military' || cls === 'aeroway') return true;
  if (!['place', 'boundary', 'natural', 'water'].includes(cls)) return false;
  const importance = Number(r.importance || 0);
  // Entités administratives majeures : seuil bas ; le reste doit être notable
  if (['country', 'state', 'region', 'administrative', 'city', 'sea', 'ocean'].includes(type)) {
    return importance >= 0.25;
  }
  return importance >= 0.35;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function titleSimilarity(a, b) {
  const wa = new Set(a.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/));
  const wb = new Set(b.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isDuplicate(newEvent, existingEvents) {
  const now = Date.parse(newEvent.date) || Date.now();
  for (const ex of existingEvents) {
    const exTime = Date.parse(ex.date) || 0;
    if (Math.abs(now - exTime) > DEDUP_HOURS * 3600 * 1000) continue;
    if (titleSimilarity(newEvent.title, ex.title) > 0.55) return true;
    if (newEvent.source === ex.source && Math.abs(now - exTime) < 6 * 3600 * 1000) {
      if (titleSimilarity(newEvent.title, ex.title) > 0.35) return true;
    }
    if (newEvent.latitude && newEvent.longitude && ex.latitude && ex.longitude) {
      const dist = haversineKm(newEvent.latitude, newEvent.longitude, ex.latitude, ex.longitude);
      if (dist < DEDUP_GEO_KM && titleSimilarity(newEvent.title, ex.title) > 0.40) return true;
    }
  }
  return false;
}

// AI dedup zone grise (meme evenement, formulations differentes)

const AI_DEDUP_PROMPT = `You are an OSINT news deduplication expert.
Given pairs of headlines, decide if each pair covers the SAME real-world event.
Same event = same incident/operation/announcement, even if worded differently or from different sources.
Different event = different incident, different day, different location, or only thematically similar.
Return ONLY a JSON array: [{"pair":0,"same":true},{"pair":1,"same":false},...]`;

const DEDUP_GRAY_MIN      = 0.25;
const DEDUP_GRAY_MAX      = 0.55;
const DEDUP_AI_MAX_PAIRS  = 30;
const DEDUP_TIME_WINDOW_H = 24;

function findGrayZonePairs(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sim = titleSimilarity(items[i].title, items[j].title);
      if (sim < DEDUP_GRAY_MIN || sim >= DEDUP_GRAY_MAX) continue;
      const ti = Date.parse(items[i].pubDate) || Date.now();
      const tj = Date.parse(items[j].pubDate) || Date.now();
      if (Math.abs(ti - tj) > DEDUP_TIME_WINDOW_H * 3600 * 1000) continue;
      pairs.push({ i, j, sim });
    }
  }
  return pairs;
}

async function detectDuplicatePairsWithAI(items, pairs) {
  if (!openaiClient || !pairs.length) return new Set();
  const duplicateIndices = new Set();
  for (let b = 0; b < pairs.length; b += DEDUP_AI_MAX_PAIRS) {
    const batch = pairs.slice(b, b + DEDUP_AI_MAX_PAIRS);
    const prompt = batch.map((p, idx) =>
      'Pair ' + idx + ':\n  A: "' + items[p.i].title + '"\n  B: "' + items[p.j].title + '"'
    ).join('\n\n');
    try {
      const completion = await openaiClient.chat.completions.create({
        model:    OPENAI_MODEL,
        messages: [
          { role: 'system', content: AI_DEDUP_PROMPT },
          { role: 'user',   content: prompt },
        ],
        temperature:     0,
        response_format: { type: 'json_object' },
      }, { timeout: 30000 });
      const text    = completion.choices?.[0]?.message?.content || '';
      const results = parseJsonArray(text);
      if (!results) continue;
      for (const r of results) {
        if (!r.same) continue;
        const pair = batch[r.pair];
        if (!pair) continue;
        const ti      = Date.parse(items[pair.i].pubDate) || 0;
        const tj      = Date.parse(items[pair.j].pubDate) || 0;
        const discard = ti >= tj ? pair.j : pair.i;
        duplicateIndices.add(discard);
      }
    } catch (err) {
      if (isRetryableNetworkError(err)) {
        console.warn('[google-news] AI dedup network error: ' + err.message.slice(0, 80));
      } else {
        console.warn('[google-news] AI dedup failed: ' + err.message.slice(0, 80));
      }
    }
  }
  return duplicateIndices;
}

// ── Domain config ─────────────────────────────────────────────────────────────

const DOMAIN_CONFIG = {
  spatial:  { color: '#a855f7', icon: '🛰️', label: 'SPATIAL' },
  missile:  { color: '#ef4444', icon: '🚀', label: 'MISSILE' },
  naval:    { color: '#3b82f6', icon: '⚓', label: 'NAVAL' },
  aviation: { color: '#f59e0b', icon: '✈️', label: 'AVIATION' },
  military: { color: '#dc2626', icon: '⚔️', label: 'MILITARY' },
};

// ── AI — uniquement pour les doutes ───────────────────────────────────────────

const AI_DOUBT_PROMPT = `You are a geopolitical OSINT analyst. For each headline, extract ONLY:
1. "location": most specific geographic place mentioned (city, base, region, country). "" if none.
2. "confidence": 0-100 — is this a REAL ongoing event or just opinion/historical?
Return JSON array: [{"index":0,"location":"...","confidence":80},...]
ONLY the JSON array.`;

async function analyzeDoubtsWithOpenAI(titles) {
  if (!openaiClient) return null;
  const completion = await openaiClient.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: AI_DOUBT_PROMPT },
      { role: 'user',   content: titles.map((t, i) => `${i}. ${t}`).join('\n') },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  }, { timeout: 25000 });
  const text = completion.choices?.[0]?.message?.content || '';
  return parseJsonArray(text);
}

function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    const vals = Object.values(parsed);
    for (const v of vals) { if (Array.isArray(v)) return v; }
  } catch {}
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function isRetryableNetworkError(err) {
  const msg = err?.message || '';
  return msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('socket hang up');
}

async function analyzeDoubts(titles, attempt = 0) {
  try {
    const r = await analyzeDoubtsWithOpenAI(titles);
    if (r?.length) return r;
  } catch (err) {
    if (isRetryableNetworkError(err) && attempt < 2) {
      const delay = (attempt + 1) * 5000;
      console.warn(`[google-news] OpenAI doubt-analysis network error, retry in ${delay / 1000}s: ${err.message.slice(0, 80)}`);
      await new Promise(r => setTimeout(r, delay));
      return analyzeDoubts(titles, attempt + 1);
    }
    console.warn('[google-news] OpenAI doubt-analysis failed:', err.message);
  }
  return null;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function fetchGoogleNewsEvents() {
  if (isFetching) {
    console.log('[google-news] skipped — already in progress');
    return;
  }
  isFetching = true;

  try {
    console.log(`[google-news] starting fetch cycle — ${RSS_FEEDS.length} feeds...`);

    // ── STEP 1 : Fetch all feeds in parallel ────────────────────────────
    const allItems = [];
    const feedResults = await Promise.all(RSS_FEEDS.map(fetchRssFeed));
    for (const items of feedResults) allItems.push(...items);
    console.log(`[google-news] total raw items: ${allItems.length}`);
    if (!allItems.length) { isFetching = false; return; }

    // ── STEP 2 : Immediate dedup (avant tout traitement) ────────────────
    const seen = new Set();
    const unique = [];
    for (const item of allItems) {
      // Clé de dédup rapide : titre normalisé
      const key = item.title.toLowerCase().replace(/[^\w]/g, '').slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      // Aussi dédup contre le cache existant
      const fakeEvent = { title: item.title, source: item.sourceName, date: item.pubDate };
      if (!isDuplicate(fakeEvent, cache.events)) {
        unique.push(item);
      }
    }
    console.log(`[google-news] after dedup: ${unique.length} / ${allItems.length}`);
    if (!unique.length) {
      cache.lastUpdate = new Date().toISOString();
      saveToDisk();
      isFetching = false;
      return;
    }

    // ── STEP 2b : Filtre par âge — rejette les articles trop anciens ────
    const ageCutoff = Date.now() - MAX_ITEM_AGE_HOURS * 3600 * 1000;
    const fresh = unique.filter(item => {
      if (!item.pubDate) return true; // pas de date → on garde
      const t = Date.parse(item.pubDate);
      return !t || t >= ageCutoff;
    });
    if (fresh.length < unique.length) {
      console.log(`[google-news] age filter: ${unique.length - fresh.length} items dropped (>${MAX_ITEM_AGE_HOURS}h old), ${fresh.length} kept`);
    }
    if (!fresh.length) {
      cache.lastUpdate = new Date().toISOString();
      saveToDisk();
      isFetching = false;
      return;
    }

    // ── STEP 2c : AI dedup zone grise ──────────────────────────────────
    let deduped = fresh;
    if (openaiClient) {
      const grayPairs = findGrayZonePairs(fresh);
      if (grayPairs.length > 0) {
        console.log(`[google-news] AI dedup: ${grayPairs.length} gray-zone pairs to check`);
        const dupIndices = await detectDuplicatePairsWithAI(fresh, grayPairs);
        if (dupIndices.size > 0) {
          deduped = fresh.filter((_, idx) => !dupIndices.has(idx));
          console.log(`[google-news] AI dedup: removed ${dupIndices.size} duplicates → ${deduped.length} kept`);
        }
      }
    }

    // ── STEP 3 : Regex classification (0 token) ────────────────────────
    const classified = deduped.map(item => {
      const domain    = detectDomainFromTitle(item.title) || item.domain;
      // Location: d'abord regex sur le titre, sinon hintLocation du feed
      const titleLocation = detectLocationFromTitle(item.title);
      const location  = titleLocation || item.hintLocation || '';
      const eventType = detectEventType(item.title, domain);
      const confidence = computeConfidence(item.title, domain, item.domain, location);
      return { ...item, domain, location, eventType, confidence, needsAI: false, hasHintOnly: !titleLocation && !!item.hintLocation };
    });

    // ── STEP 4 : Identifier les doutes (→ seuls ceux-ci vont à l'IA) ──
    const doubts = [];
    const doubtIndices = [];
    for (let i = 0; i < classified.length; i++) {
      const c = classified[i];
      // Doute = pas de lieu extrait du titre (hint seul = source-country fallback, peu fiable)
      // OU confiance < 40. Les événements hasHintOnly passent par l'IA pour corriger
      // les cas où la source (France 24, RT…) couvre un pays différent du sien.
      const hasDoubt = !c.location || c.hasHintOnly || c.confidence < 40;
      if (hasDoubt) {
        doubts.push(c.title);
        doubtIndices.push(i);
        classified[i].needsAI = true;
      }
    }

    console.log(`[google-news] doubts needing AI: ${doubts.length} / ${classified.length} (${Math.round(100 * doubts.length / classified.length)}%)`);

    // ── STEP 5 : AI uniquement sur les doutes (batch max 100) ──────────
    if (doubts.length > 0 && doubts.length <= 100) {
      const aiResults = await analyzeDoubts(doubts);
      if (aiResults) {
        for (const r of aiResults) {
          const idx = doubtIndices[r.index ?? 0];
          if (idx === undefined) continue;
          // L'IA écrase le hintLocation du flux : c'est précisément pour corriger
          // les articles hors du pays du flux qu'ils lui ont été soumis.
          if (r.location && (!classified[idx].location || classified[idx].hasHintOnly)) {
            classified[idx].location = r.location;
            classified[idx].hasHintOnly = false;
          }
          if (typeof r.confidence === 'number') {
            // Moyenne entre regex et IA
            classified[idx].confidence = Math.round(
              (classified[idx].confidence + r.confidence) / 2
            );
          }
        }
        console.log(`[google-news] AI enriched ${aiResults.length} doubtful articles`);
      }
    } else if (doubts.length > 100) {
      console.log(`[google-news] too many doubts (${doubts.length}), skipping AI to save tokens`);
    }

    // ── STEP 6 : Geocode + build events ────────────────────────────────
    const newEvents = [];
    for (let i = 0; i < classified.length; i++) {
      const c = classified[i];
      const minConf = MIN_CONFIDENCE_BY_DOMAIN[c.domain] ?? 50;
      if (c.confidence < minConf) continue; // seuil par domaine

      let lat = null, lon = null;
      if (c.location) {
        // Dictionnaire d'abord (instantané), Nominatim ensuite
        const known = lookupKnown(c.location);
        if (known) {
          lat = known.lat;
          lon = known.lon;
        } else {
          const geo = await geocodeLocation(c.location);
          if (geo) { lat = geo.lat; lon = geo.lon; }
          await sleep(GEOCODE_DELAY);
        }
      }

      const event = {
        id:         `gnews-${c.domain}-${Date.now()}-${i}`,
        title:      c.title,
        url:        c.link,
        source:     c.sourceName || 'Google News',
        date:       c.pubDate || new Date().toISOString(),
        latitude:   lat,
        longitude:  lon,
        location:   c.location || null,
        domain:     c.domain,
        eventType:  c.eventType,
        confidence: c.confidence,
        feedLabel:  c.feedLabel,
        usedAI:     c.needsAI,
        domainConfig: DOMAIN_CONFIG[c.domain] || DOMAIN_CONFIG.military,
      };

      if (!isDuplicate(event, [...cache.events, ...newEvents])) {
        newEvents.push(event);
      }
    }

    // ── STEP 7 : Merge cache ───────────────────────────────────────────
    const cutoff = Date.now() - DEDUP_HOURS * 3600 * 1000;
    const existing = cache.events.filter(e => {
      const t = Date.parse(e.date);
      return t && t > cutoff;
    });
    const merged = [...newEvents, ...existing].slice(0, MAX_EVENTS);
    cache.events     = merged;
    cache.lastUpdate = new Date().toISOString();
    saveToDisk();

    const aiCount = newEvents.filter(e => e.usedAI).length;
    const byDomain = newEvents.reduce((acc, e) => { acc[e.domain] = (acc[e.domain]||0)+1; return acc; }, {});
    const rejCount = classified.length - newEvents.length;
    console.log(`[google-news] done — ${newEvents.length} new (${aiCount} via AI, ${rejCount} rejected by quality), ${merged.length} total`);
    console.log(`[google-news] by domain: ${JSON.stringify(byDomain)}`);

    // ── STEP 8 : Async link resolution (non-blocking) ──────────────────
    resolveLinksAsync(newEvents).catch(() => {});

  } catch (err) {
    console.error('[google-news] pipeline failed:', err.message);
  } finally {
    isFetching = false;
  }
}

async function resolveLinksAsync(events) {
  for (const ev of events) {
    if (ev.url && ev.url.includes('news.google.com')) {
      try {
        const resolved = await resolveGoogleLink(ev.url);
        if (resolved !== ev.url) ev.url = resolved;
      } catch {}
      await sleep(500);
    }
  }
  saveToDisk();
}

// ── Public API ────────────────────────────────────────────────────────────────

function getCache() { return cache; }

function isStale() {
  if (!cache.lastUpdate) return true;
  return Date.now() - new Date(cache.lastUpdate).getTime() > CACHE_TTL_MS;
}

function getNewsEventsForMap() {
  return cache.events
    .filter(e => e.latitude && e.longitude && e.confidence >= 30)
    .map(e => ({
      id:          e.id,
      title:       e.title,
      url:         e.url,
      source:      e.source,
      date:        e.date,
      lat:         e.latitude,
      lon:         e.longitude,
      location:    e.location,
      domain:      e.domain,
      eventType:   e.eventType,
      confidence:  e.confidence,
      feedLabel:   e.feedLabel,
      usedAI:      e.usedAI || false,
      color:       e.domainConfig?.color || '#888',
      icon:        e.domainConfig?.icon  || '📰',
      label:       e.domainConfig?.label || 'NEWS',
      dataSource:  'google-news',
    }));
}

module.exports = {
  fetchGoogleNewsEvents,
  getCache,
  isStale,
  getNewsEventsForMap,
  RSS_FEEDS,
  DOMAIN_CONFIG,
  // exposés pour les tests
  detectLocationFromTitle,
  lookupKnown,
};
