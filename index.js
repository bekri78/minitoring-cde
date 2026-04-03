 
let allEvents = [];
let map = null;
let popup = null;
let refreshTimer = null;
let nextRefreshTime = 0;
let refreshCountdownTimer = null;

// ── Lookup country name → {lat, lon} ──────────────────────────────────────
const COUNTRY_COORDS = {
  "United States": { lat: 37.09, lon: -95.71 },
  "China": { lat: 35.86, lon: 104.19 },
  "Russia": { lat: 61.52, lon: 105.31 },
  "United Kingdom": { lat: 55.37, lon: -3.43 },
  "France": { lat: 46.23, lon: 2.21 },
  "Germany": { lat: 51.16, lon: 10.45 },
  "India": { lat: 20.59, lon: 78.96 },
  "Brazil": { lat: -14.23, lon: -51.92 },
  "Japan": { lat: 36.20, lon: 138.25 },
  "South Korea": { lat: 35.90, lon: 127.76 },
  "Israel": { lat: 31.04, lon: 34.85 },
  "Iran": { lat: 32.42, lon: 53.68 },
  "Ukraine": { lat: 48.37, lon: 31.16 },
  "Syria": { lat: 34.80, lon: 38.99 },
  "Iraq": { lat: 33.22, lon: 43.67 },
  "Afghanistan": { lat: 33.93, lon: 67.70 },
  "Pakistan": { lat: 30.37, lon: 69.34 },
  "Yemen": { lat: 15.55, lon: 48.51 },
  "Saudi Arabia": { lat: 23.88, lon: 45.07 },
  "Turkey": { lat: 38.96, lon: 35.24 },
  "Egypt": { lat: 26.82, lon: 30.80 },
  "Libya": { lat: 26.33, lon: 17.22 },
  "Sudan": { lat: 12.86, lon: 30.21 },
  "Ethiopia": { lat: 9.14, lon: 40.48 },
  "Somalia": { lat: 5.15, lon: 46.19 },
  "Nigeria": { lat: 9.08, lon: 8.67 },
  "Congo": { lat: -4.03, lon: 21.75 },
  "Mali": { lat: 17.57, lon: -3.99 },
  "Niger": { lat: 17.60, lon: 8.08 },
  "Myanmar": { lat: 21.91, lon: 95.95 },
  "Thailand": { lat: 15.87, lon: 100.99 },
  "Philippines": { lat: 12.87, lon: 121.77 },
  "Indonesia": { lat: -0.78, lon: 113.92 },
  "Mexico": { lat: 23.63, lon: -102.55 },
  "Colombia": { lat: 4.57, lon: -74.29 },
  "Venezuela": { lat: 6.42, lon: -66.58 },
  "Argentina": { lat: -38.41, lon: -63.61 },
  "Peru": { lat: -9.18, lon: -75.01 },
  "Chile": { lat: -35.67, lon: -71.54 },
  "Australia": { lat: -25.27, lon: 133.77 },
  "Canada": { lat: 56.13, lon: -106.34 },
  "Poland": { lat: 51.91, lon: 19.14 },
  "Romania": { lat: 45.94, lon: 24.96 },
  "Greece": { lat: 39.07, lon: 21.82 },
  "Spain": { lat: 40.46, lon: -3.74 },
  "Italy": { lat: 41.87, lon: 12.56 },
  "Taiwan": { lat: 23.69, lon: 120.96 },
  "North Korea": { lat: 40.33, lon: 127.51 },
  "Lebanon": { lat: 33.85, lon: 35.86 },
  "Jordan": { lat: 30.58, lon: 36.23 },
  "Kazakhstan": { lat: 48.01, lon: 66.92 },
  "Malaysia": { lat: 4.21, lon: 101.97 },
  "Vietnam": { lat: 14.05, lon: 108.27 },
  "Bangladesh": { lat: 23.68, lon: 90.35 },
  "Kenya": { lat: -0.02, lon: 37.90 },
  "South Africa": { lat: -30.55, lon: 22.93 },
  "Morocco": { lat: 31.79, lon: -7.09 },
  "Algeria": { lat: 28.03, lon: 1.65 },
  "Tunisia": { lat: 33.88, lon: 9.53 },
  "Cameroon": { lat: 3.84, lon: 11.50 },
  "Ghana": { lat: 7.94, lon: -1.02 },
  "Sweden": { lat: 60.12, lon: 18.64 },
  "Finland": { lat: 61.92, lon: 25.74 },
  "Norway": { lat: 60.47, lon: 8.46 },
  "Denmark": { lat: 56.26, lon: 9.50 },
  "Netherlands": { lat: 52.13, lon: 5.29 },
  "Belgium": { lat: 50.50, lon: 4.46 },
  "Switzerland": { lat: 46.81, lon: 8.22 },
  "Austria": { lat: 47.51, lon: 14.55 },
  "Czech Republic": { lat: 49.81, lon: 15.47 },
  "Hungary": { lat: 47.16, lon: 19.50 },
  "Portugal": { lat: 39.39, lon: -8.22 },
  "Serbia": { lat: 44.01, lon: 21.00 },
  "Croatia": { lat: 45.10, lon: 15.20 },
  "Bulgaria": { lat: 42.73, lon: 25.48 },
  "Georgia": { lat: 42.31, lon: 43.35 },
  "Armenia": { lat: 40.06, lon: 45.03 },
  "Azerbaijan": { lat: 40.14, lon: 47.57 },
  "Belarus": { lat: 53.70, lon: 27.95 },
  "Moldova": { lat: 47.41, lon: 28.36 },
  "Cuba": { lat: 21.52, lon: -77.78 },
  "Haiti": { lat: 18.97, lon: -72.28 },
  "Honduras": { lat: 15.19, lon: -86.24 },
  "Guatemala": { lat: 15.78, lon: -90.23 },
  "El Salvador": { lat: 13.79, lon: -88.89 }
};

// ── Codes CAMEO plus stricts ──────────────────────────────────────────────
// Material Conflict (QuadClass 4)
const MATERIAL_CONFLICT_CODES = new Set(['13','14','15','16','17','18','19','20']);
// Verbal Conflict (QuadClass 3) — seulement les plus opérationnels
const VERBAL_CONFLICT_CODES   = new Set(['13','15','17','18','19','20']);

// ── Bruit à exclure ────────────────────────────────────────────────────────
const NOISE_KEYWORDS = [
  // Divertissement / culture
  'photo review', 'american dream', 'expo', 'conexpo', 'fashion', 'celebrity',
  'movie', 'film', 'music', 'festival', 'sports', 'match', 'football', 'soccer',
  'nba', 'nfl', 'baseball', 'cricket', 'concert', 'award', 'red carpet',
  'tv show', 'podcast', 'entertainment', 'gallery', 'photos', 'photo gallery',
  'weekend', 'lifestyle', 'recipe', 'restaurant', 'horoscope', 'tourism', 'travel',

  // Économie / business / tech générique
  'stock', 'market', 'earnings', 'real estate', 'deal', 'shopping', 'review',
  'ipo', 'startup', 'funding round', 'quarterly results', 'revenue',

  // ── Contexte judiciaire / légal (rétrospectif, pas opérationnel) ──────────
  'pleads guilty', 'pleads not guilty', 'plead guilty', 'not guilty plea',
  'found guilty', 'found not guilty', 'convicted of', 'acquitted',
  'sentenced to', 'sentencing hearing', 'faces sentencing',
  'court hears', 'court rules', 'court finds', 'court orders', 'court rejects',
  'court dismisses', 'court blocks', 'court upholds', 'court denies',
  'fails in court', 'fails in nsw', 'nsw court', 'nsw supreme',
  'suppression order', 'suppress identities', 'non-publication',
  'inquest', 'coroner', 'coroners court', 'inquest hears',
  'bail hearing', 'bail granted', 'bail denied', 'remanded in custody',
  'arraigned', 'indicted', 'indictment', 'grand jury',
  'lawsuit filed', 'civil lawsuit', 'class action',
  'years in prison', 'life in prison', 'prison sentence',
  'appeal court', 'appeals court', 'court of appeal',
  'murder trial', 'terrorism trial', 'war crimes trial',
  'on trial for', 'stands trial', 'goes on trial',
  'testimony', 'takes the stand', 'witness stand',
  'prosecutor says', 'defense attorney', 'defence attorney',

  // ── Rétrospectif / commémoratif / analyse ─────────────────────────────────
  'anniversary', 'years ago', 'one year after', 'two years after',
  'looks back', 'in retrospect', 'remembering', 'commemorat',
  'memorial service', 'tribute to', 'in memory of',
  'explainer', 'fact check', 'what to know', 'everything you need',
  'how to protect', 'tips for', 'guide to', 'what is',
  'opinion:', 'op-ed', 'column:', 'letter to the editor',

  // ── Santé / bien-être générique ───────────────────────────────────────────
  'health tips', 'weight loss', 'diet', 'fitness', 'wellness',
  'mental health awareness', 'self care'
];

// ── Mots-clés métier ───────────────────────────────────────────────────────
const MILITARY_CRISIS_KEYWORDS = [
  'military',
  'army',
  'navy',
  'air force',
  'missile',
  'strike',
  'attack',
  'drone',
  'artillery',
  'troops',
  'troop',
  'soldier',
  'forces',
  'defense',
  'defence',
  'conflict',
  'war',
  'battle',
  'combat',
  'insurgent',
  'terror',
  'terrorist',
  'explosion',
  'blast',
  'shelling',
  'bombing',
  'raid',
  'airstrike',
  'militia',
  'border clash',
  'hostage',
  'coup',
  'sanction',
  'evacuation',
  'protest',
  'riot',
  'demonstration',
  'unrest',
  'clashes',
  'crisis',
  'incident',
  'security',
  'police',
  'emergency',
  'martial law',
  'ceasefire',
  'offensive',
  'detained',
  'arrested',
  'killed',
  'wounded',
  'rebels',
  'insurgency',
  'gunfire',
  'fighting',
  'rocket',
  'air raid',
  'siege',
  'mobilization',
  'paramilitary'
];


// ── Config Railway (serveur GDELT) ────────────────────────────────────────
const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

// ── Config ACLED ──────────────────────────────────────────────────────────
const ACLED_PROXY_URL = 'https://tight-river-31b9.projet7.workers.dev';

function mapAcledCategory(eventType) {
  const map = {
    'Battles': 'military',
    'Explosions/Remote violence': 'military',
    'Violence against civilians': 'conflict',
    'Riots': 'protest',
    'Protests': 'protest',
    'Strategic developments': 'crisis'
  };
  return map[eventType] || 'incident';
}

function acledToTone(fatalities) {
  const f = parseInt(fatalities) || 0;
  if (f >= 20) return -10;
  if (f >= 10) return -8;
  if (f >= 5)  return -6;
  if (f >= 1)  return -4;
  return -2;
}

function mapAcledEvent(row) {
  const lat = parseFloat(row.latitude);
  const lon = parseFloat(row.longitude);
  if (isNaN(lat) || isNaN(lon)) return null;

  const cat  = mapAcledCategory(row.event_type);
  const tone = acledToTone(row.fatalities);
  const notes = (row.notes || '').trim();
  const title = notes.length > 180 ? notes.slice(0, 177) + '…' : (notes || `${row.event_type} — ${row.location}`);

  return {
    id: `acled_${row.event_id_cnty}`,
    title,
    url: '',
    domain: row.source || 'ACLED',
    date: (row.event_date || '').replace(/-/g, ''),
    country: row.country || '',
    rawLat: lat, rawLon: lon, lat, lon,
    tone,
    color: getColor(tone),
    category: cat,
    categoryColor: getCategoryColor(cat),
    score: 100 + (parseInt(row.fatalities) || 0) * 5,
    fatalities: parseInt(row.fatalities) || 0,
    actor1: row.actor1 || '',
    actor2: row.actor2 || '',
    subType: row.sub_event_type || '',
    dataSource: 'acled',
    _visible: true
  };
}

async function fetchAcledEvents() {
  if (!ACLED_PROXY_URL) return [];

  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - 1);
  const fmt = d => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    _format: 'json',
    event_date: `${fmt(from)}|${fmt(today)}`,
    event_date_where: 'BETWEEN',
    fields: 'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|location|latitude|longitude|fatalities|notes|source',
    limit: '500'
  });

  const resp = await fetch(`${ACLED_PROXY_URL}?${params}`);

  if (!resp.ok) throw new Error(`ACLED proxy failed (${resp.status})`);

  const data = await resp.json();
  const rows = data.data || [];
  console.log(`[ACLED] ${rows.length} raw events`);

  return rows.map(mapAcledEvent).filter(Boolean);
}

// ── Helpers UI ────────────────────────────────────────────────────────────
function updateLoadingMsg(msg, color = '#00d4ff') {
  const el = document.querySelector('.loading-text');
  if (el) {
    el.textContent = msg;
    el.style.color = color;
  }
}

function setStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

function setEventCount(count) {
  const el = document.getElementById('event-count');
  if (el) el.textContent = String(count);
}

// ── Helpers date ──────────────────────────────────────────────────────────
function getTodayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function formatDate(d) {
  if (!d || d.length < 8) return '';
  try {
    const s = String(d).replace('T', ' ').replace('Z', '');
    return s.substring(0, 16);
  } catch {
    return String(d);
  }
}

// ── Helpers divers ────────────────────────────────────────────────────────
function coordsForCountry(name) {
  if (!name) return null;
  if (COUNTRY_COORDS[name]) return COUNTRY_COORDS[name];

  const lower = name.toLowerCase();
  const key = Object.keys(COUNTRY_COORDS).find(
    k => lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)
  );

  return key ? COUNTRY_COORDS[key] : null;
}

function getColor(tone) {
  if (isNaN(tone)) return '#4a6a7a';
  if (tone <= -7) return '#ff2244';
  if (tone <= -5) return '#ff5533';
  if (tone < -2) return '#ffaa00';
  if (tone < 0) return '#ffdd55';
  return '#00d4ff';
}

function getSeverityLabel(tone) {
  if (tone <= -7) return 'CRITICAL';
  if (tone <= -5) return 'SEVERE';
  if (tone <= -2) return 'HIGH';
  if (tone < 0) return 'MODERATE';
  return 'LOW';
}

function getSeverityKey(tone) {
  if (tone <= -7) return 'critical';
  if (tone <= -5) return 'severe';
  if (tone <= -2) return 'high';
  if (tone < 0) return 'moderate';
  return 'low';
}


function getRegionKey(lat, lon) {
  if (lat > 34 && lat < 72 && lon > -25 && lon < 45) return 'europe';
  if (lat > 12 && lat < 43 && lon > 25 && lon < 65) return 'middleeast';
  if (lat > -12 && lat < 55 && lon > 60 && lon < 150) return 'asia';
  if (lat > -35 && lat < 38 && lon > -20 && lon < 55) return 'africa';
  if (lon > -170 && lon < -30) return 'americas';
  return 'oceania';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function titleFromUrl(url) {
  if (!url) return 'Untitled article';

  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '');
    const segments = u.pathname.split('/').filter(Boolean);

    // Parcourir les segments du plus spécifique au plus général
    // et retourner le premier qui contient au moins un vrai mot (3+ lettres)
    for (let i = segments.length - 1; i >= 0; i--) {
      const cleaned = decodeURIComponent(segments[i])
        .replace(/\.[a-z0-9]{2,6}$/i, '')
        .replace(/[-_+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (/[a-zA-Z]{3,}/.test(cleaned)) {
        return cleaned;
      }
    }

    // Tous les segments sont des IDs numériques → fallback domaine
    return domain;
  } catch {
    return 'Untitled article';
  }
}

function safeDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s:/._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  return normalizeText(title)
    .replace(/[_/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAnyKeyword(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some(keyword => normalized.includes(normalizeText(keyword)));
}

function isNoiseEvent(event) {
  if (NOISE_DOMAINS.has(event.domain)) return true;
  const text = `${event.title || ''} ${event.url || ''} ${event.domain || ''}`;
  return containsAnyKeyword(text, NOISE_KEYWORDS);
}

function isOperationalEvent(event) {
  const text = `${event.title || ''} ${event.url || ''} ${event.domain || ''}`;
  return containsAnyKeyword(text, MILITARY_CRISIS_KEYWORDS);
}

function scoreEvent(event) {
  let score = 0;

  const tone = Math.abs(Number(event.tone) || 0);
  score += tone * 10;

  const text = `${event.title || ''} ${event.url || ''} ${event.domain || ''}`;
  const normalized = normalizeText(text);

  const SCORE_BONUSES = {
    missile: 25, war: 25, airstrike: 24, bombing: 24, terrorist: 24,
    attack: 22, military: 20, strike: 20, drone: 20, hostage: 20,
    protest: 18, riot: 18, explosion: 18, troops: 16, crisis: 15, incident: 12
  };
  for (const keyword of MILITARY_CRISIS_KEYWORDS) {
    if (normalized.includes(normalizeText(keyword))) {
      score += SCORE_BONUSES[keyword] ?? 20;
    }
  }

  return score;
}

// ── Classification opérationnelle ─────────────────────────────────────────
const CATEGORY_RULES = [
  {
    key: 'terrorism',
    label: 'TERRORISM',
    color: '#ff0044',   // rouge vif
    keywords: ['terrorist', 'terrorism', 'suicide bomb', 'isis', 'al-qaeda', 'al qaeda',
               'jihad', 'ied', 'car bomb', 'beheading', 'kidnap', 'hostage', 'extremist']
  },
  {
    key: 'military',
    label: 'MILITARY',
    color: '#ff6600',   // orange
    keywords: ['airstrike', 'air strike', 'missile', 'artillery', 'shelling', 'bombardment',
               'navy', 'air force', 'fighter jet', 'warplane', 'tank', 'drone strike',
               'mobilization', 'paramilitary', 'armed forces', 'military operation',
               'offensive', 'siege', 'ceasefire', 'air raid', 'rocket attack', 'troops deployed']
  },
  {
    key: 'conflict',
    label: 'CONFLICT',
    color: '#ffaa00',   // ambre — plus distinct de military
    keywords: ['war', 'battle', 'combat', 'fighting', 'clashes', 'gunfire', 'killed',
               'wounded', 'rebels', 'insurgent', 'insurgency', 'border clash', 'shootout',
               'armed clash', 'militia', 'raid', 'bombing', 'blast', 'explosion']
  },
  {
    key: 'protest',
    label: 'PROTEST',
    color: '#ffee00',   // jaune vif
    keywords: ['protest', 'riot', 'demonstration', 'unrest', 'march', 'rally',
               'uprising', 'civil unrest', 'dissent', 'blockade', 'occupy',
               'strike action', 'walkout', 'coup']
  },
  {
    key: 'crisis',
    label: 'CRISIS',
    color: '#cc44ff',   // violet
    keywords: ['crisis', 'emergency', 'martial law', 'sanction', 'evacuation',
               'displaced', 'refugee', 'humanitarian', 'famine', 'epidemic',
               'disaster', 'state of emergency', 'crackdown', 'detained', 'arrested']
  }
];

const CATEGORY_MAP = Object.fromEntries(CATEGORY_RULES.map(c => [c.key, c]));

function classifyEvent(event) {
  const text = normalizeText(`${event.title || ''} ${event.url || ''}`);
  for (const cat of CATEGORY_RULES) {
    if (cat.keywords.some(k => text.includes(normalizeText(k)))) {
      return cat.key;
    }
  }
  return 'incident';
}

function getCategoryColor(category) {
  return CATEGORY_MAP[category]?.color || '#4a6a7a';
}

function getCategoryLabel(category) {
  return CATEGORY_MAP[category]?.label || 'INCIDENT';
}

// ── Blacklist de domaines connus non-opérationnels ─────────────────────────
const NOISE_DOMAINS = new Set([
  'espn.com', 'bleacherreport.com', 'nba.com', 'nfl.com', 'mlb.com',
  'tmz.com', 'people.com', 'eonline.com', 'variety.com', 'hollywoodreporter.com',
  'buzzfeed.com', 'buzzfeednews.com', 'dailymail.co.uk',
  'foodnetwork.com', 'allrecipes.com', 'tripadvisor.com',
  'techcrunch.com', 'engadget.com', 'theverge.com', 'wired.com',
  'marketwatch.com', 'investopedia.com', 'fool.com'
]);

function buildDedupKey(event) {
  // URL is the unique article identifier — same article must produce one map point
  // regardless of how many GDELT rows reference it with different geo mentions
  if (event.url) return event.url;
  // fallback for rows without URL (rare)
  return `${normalizeTitle(event.title)}|${String(event.date || '').slice(0, 8)}`;
}

function applyJitterToEvent(event) {
  return {
    ...event,
    lat: Number(event.rawLat) + (Math.random() - 0.5) * 0.5,
    lon: Number(event.rawLon) + (Math.random() - 0.5) * 0.5
  };
}


// ── Parser une ligne CSV GDELT ────────────────────────────────────────────
function parseLine(line) {
  try {
    const c = line.split('\t');
    if (c.length < 61) return null;

    const rootCode  = (c[28] || '').trim();
    const quadClass = (c[29] || '').trim();
    const goldstein = parseFloat(c[30]);
    // ActionGeo = où l'événement s'est produit
    const geoType   = c[51];
    const geoName   = c[52] || '';
    const latRaw    = parseFloat(c[56]);
    const lonRaw    = parseFloat(c[57]);
    const url = (c[60] || '').trim();

    if (quadClass !== '3' && quadClass !== '4') return null;
    if (quadClass === '4' && !MATERIAL_CONFLICT_CODES.has(rootCode)) return null;
    if (quadClass === '3' && !VERBAL_CONFLICT_CODES.has(rootCode)) return null;
    const goldsteinThreshold = quadClass === '4' ? -1 : -5;
    if (isNaN(goldstein) || goldstein > goldsteinThreshold) return null;
    if (geoType !== '3' && geoType !== '4' && geoType !== '5') return null;
    if (!url) return null;

    let lat = latRaw;
    let lon = lonRaw;

    if (isNaN(lat) || isNaN(lon)) {
      const countryName = geoName || c[36] || '';
      const fallbackCoords = coordsForCountry(countryName);
      if (!fallbackCoords) return null;
      lat = fallbackCoords.lat;
      lon = fallbackCoords.lon;
    }

    return {
      id: c[0] || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title: titleFromUrl(url),
      url,
      domain: safeDomainFromUrl(url),
      date: c[1] || '',
      country: geoName || c[36] || '',
      rootCode,
      rawLat: lat,
      rawLon: lon,
      lat,
      lon,
      tone: goldstein,
      color: getColor(goldstein),
      _visible: true
    };
  } catch (err) {
    console.warn('parseLine failed:', err);
    return null;
  }
}

// ── Charger JSZip si pas encore dispo ─────────────────────────────────────
async function ensureJSZip() {
  if (typeof JSZip !== 'undefined') return;

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load JSZip'));
    document.head.appendChild(s);
  });
}

// ── Fetch un ZIP GDELT et retourne le texte CSV ───────────────────────────
async function fetchZip(url) {
  await ensureJSZip();

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`ZIP fetch failed (${resp.status}) for ${url}`);
  }

  const buf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const files = Object.values(zip.files).filter(f => !f.dir);
  if (!files.length) {
    throw new Error(`ZIP empty: ${url}`);
  }

  const targetFile =
    files.find(f => /\.csv$/i.test(f.name)) ||
    files[0];

  return targetFile.async('string');
}

// ── Fetch TOUTE la journée via masterfilelist.txt ─────────────────────────
async function fetchTodayEvents() {
  const today = getTodayStr();

  updateLoadingMsg('FETCHING FILE LIST...', '#00d4ff');

  const masterResp = await fetch('http://data.gdeltproject.org/gdeltv2/masterfilelist.txt');
  if (!masterResp.ok) {
    throw new Error(`masterfilelist fetch failed (${masterResp.status})`);
  }

  const masterText = await masterResp.text();

  const todayUrls = masterText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l.includes(`/${today}`) && l.includes('.export.CSV.zip'))
    .map(l => {
      const parts = l.split(/\s+/);
      return parts[2];
    })
    .filter(Boolean);

  console.log(`Found ${todayUrls.length} files for ${today}`);

  if (!todayUrls.length) {
    throw new Error(`No .export.CSV.zip files found for ${today}`);
  }

  const BATCH_SIZE = 8;
  const dedupMap = new Map();
  let filesOk = 0;
  let filesFail = 0;

  for (let i = 0; i < todayUrls.length; i += BATCH_SIZE) {
    const batch = todayUrls.slice(i, i + BATCH_SIZE);
    const pct = Math.round((i / todayUrls.length) * 100);

    updateLoadingMsg(
      `LOADING... ${pct}% — ${filesOk} OK / ${filesFail} FAIL / ${dedupMap.size} events`,
      '#00d4ff'
    );

    const results = await Promise.allSettled(batch.map(fetchZip));

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        filesFail++;
        console.warn('fetchZip failed:', result.reason);
        continue;
      }

      filesOk++;

      const lines = result.value.split('\n');

      for (const line of lines) {
        const ev = parseLine(line);
        if (!ev) continue;

        const dedupKey = buildDedupKey(ev);
        const existing = dedupMap.get(dedupKey);

        if (!existing) {
          dedupMap.set(dedupKey, ev);
          continue;
        }

        const existingScore = scoreEvent(existing);
        const newScore = scoreEvent(ev);

        const existingDate = String(existing.date || '');
        const newDate = String(ev.date || '');

        if (newScore > existingScore || (newScore === existingScore && newDate > existingDate)) {
          dedupMap.set(dedupKey, ev);
        }
      }
    }
  }

  let events = Array.from(dedupMap.values())
    .filter(ev => !isNoiseEvent(ev))
    .filter(ev => isOperationalEvent(ev))
    .map(ev => {
      const category = classifyEvent(ev);
      return {
        ...ev,
        score: scoreEvent(ev),
        category,
        categoryColor: getCategoryColor(category)
      };
    });

  events.sort((a, b) => {
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const toneDiff = Math.abs(Number(b.tone) || 0) - Math.abs(Number(a.tone) || 0);
    if (toneDiff !== 0) return toneDiff;

    return String(b.date || '').localeCompare(String(a.date || ''));
  });

  const MAX_EVENTS_RENDER = 800;
  events = events
    .slice(0, MAX_EVENTS_RENDER)
    .map(applyJitterToEvent);

  updateLoadingMsg(
    `DONE — ${events.length} events / ${filesOk} files OK / ${filesFail} failed`,
    '#00ff88'
  );

  console.log(`Today complete: ${events.length} events from ${filesOk}/${todayUrls.length} files`);

  if (!events.length) {
    throw new Error('No events parsed after processing all ZIP files');
  }

  return events;
}

// ── Cache localStorage ────────────────────────────────────────────────────
const LS_KEY_PREFIX = 'wm_events_';
const CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 min — aligne sur le refresh timer

function lsSave(dateStr, events) {
  try {
    const payload = JSON.stringify({ ts: Date.now(), events });
    localStorage.setItem(LS_KEY_PREFIX + dateStr, payload);
    // Nettoyer les jours précédents
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(LS_KEY_PREFIX) && key !== LS_KEY_PREFIX + dateStr) {
        localStorage.removeItem(key);
      }
    }
    console.log(`[cache] saved ${events.length} events for ${dateStr}`);
  } catch (e) {
    console.warn('[cache] localStorage save failed:', e);
  }
}

function lsLoad(dateStr, maxAgeMs = CACHE_MAX_AGE_MS) {
  try {
    const raw = localStorage.getItem(LS_KEY_PREFIX + dateStr);
    if (!raw) return null;
    const { ts, events } = JSON.parse(raw);
    if (Date.now() - ts > maxAgeMs) return null; // expiré
    return Array.isArray(events) ? events : null;
  } catch {
    return null;
  }
}


// ── Load principal ────────────────────────────────────────────────────────
async function loadGdelt(forceRefresh = false) {
  const today = getTodayStr();
  const loadingEl = document.getElementById('loading');

  // ── Lecture cache localStorage ────────────────────────────────────────
  if (!forceRefresh) {
    const cached = lsLoad(today);
    if (cached?.length) {
      console.log(`[cache] hit — ${cached.length} events (skipping GDELT fetch)`);
      renderEvents(cached);
      setStatus('CACHED');
      return;
    }
  }

  if (loadingEl) loadingEl.style.display = 'block';
  setStatus('FETCHING');

  // ── Source principale : Railway ───────────────────────────────────────
  try {
    updateLoadingMsg('FETCHING FROM SERVER...', '#00d4ff');

    const resp = await fetch(`${RAILWAY_URL}/events`);
    if (!resp.ok) throw new Error(`Railway responded ${resp.status}`);

    const data = await resp.json();
    const freshEvents = Array.isArray(data.events) ? data.events : [];

    if (!freshEvents.length) throw new Error('No events from Railway');

    freshEvents.forEach(e => { e._visible = true; });

    console.log(`[RAILWAY] ${freshEvents.length} events (server updated: ${data.lastUpdate})`);

    lsSave(today, freshEvents);
    renderEvents(freshEvents);
    setStatus('LIVE');
    return;
  } catch (err) {
    console.warn('[RAILWAY] fetch failed, falling back to direct GDELT:', err.message);
  }

  // ── Fallback : fetch GDELT direct depuis le navigateur ────────────────
  try {
    updateLoadingMsg('FETCHING GDELT DIRECT...', '#ffaa00');

    const freshEvents = await fetchTodayEvents();
    lsSave(today, freshEvents);
    renderEvents(freshEvents);
    setStatus('LIVE');
    return;
  } catch (err) {
    console.warn('GDELT direct fetch failed:', err);
  }

  setStatus('OFFLINE');

  if (loadingEl) {
    loadingEl.innerHTML = `
      <div class="loading-text" style="color:#ff4444">
        NO DATA AVAILABLE<br>
        <span style="font-size:10px;color:#4a6a7a">
          SERVER UNREACHABLE AND NO LOCAL CACHE FOUND
        </span>
      </div>
    `;
    loadingEl.style.display = 'block';
  }

  setEventCount('—');
}

// ── Rendu / refresh ───────────────────────────────────────────────────────
function renderEvents(events) {
  allEvents = Array.isArray(events) ? events : [];
  allEvents.forEach(e => {
    if (typeof e._visible === 'undefined') e._visible = true;
    if (!e.color) e.color = getColor(e.tone);
    if (!e.categoryColor) e.categoryColor = getCategoryColor(e.category || 'incident');
    // Jitter si pas encore appliqué (événements venant de Railway)
    if (e.rawLat === undefined) {
      e.rawLat = e.lat;
      e.rawLon = e.lon;
      e.lat = Number(e.lat) + (Math.random() - 0.5) * 0.5;
      e.lon = Number(e.lon) + (Math.random() - 0.5) * 0.5;
    }
  });

  setStatus('LIVE');
  setEventCount(allEvents.length);

  renderMap();

  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';

  clearTimeout(refreshTimer);
  if (refreshCountdownTimer) {
    clearTimeout(refreshCountdownTimer);
    refreshCountdownTimer = null;
  }

  nextRefreshTime = Date.now() + 15 * 60 * 1000;
  updateRefreshTimer();
  refreshTimer = setTimeout(() => loadGdelt(true), 15 * 60 * 1000);
}

function updateRefreshTimer() {
  const remaining = Math.max(0, nextRefreshTime - Date.now());
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);

  const el = document.getElementById('next-refresh');
  if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;

  if (remaining > 0) {
    refreshCountdownTimer = setTimeout(updateRefreshTimer, 1000);
  }
}

// ── Carte MapLibre ────────────────────────────────────────────────────────
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        carto: {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© CartoDB'
        }
      },
      layers: [
        { id: 'carto', type: 'raster', source: 'carto' }
      ]
    },
    center: [20, 20],
    zoom: 2,
    minZoom: 1.5,
    maxZoom: 16
  });

  popup = new maplibregl.Popup({
    closeButton: true,
    maxWidth: '380px'
  });

  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    'bottom-left'
  );
}

function removeLayerIfExists(id) {
  if (map && map.getLayer(id)) {
    map.removeLayer(id);
  }
}

function removeSourceIfExists(id) {
  if (map && map.getSource(id)) {
    map.removeSource(id);
  }
}

function getFilteredEvents() {
  return allEvents.filter(e => e._visible !== false);
}

function renderMap() {
  if (!map || !map.loaded()) return;

  removeLayerIfExists('clusters-glow');
  removeLayerIfExists('clusters');
  removeLayerIfExists('cluster-count');
  removeLayerIfExists('events-glow');
  removeLayerIfExists('events-circles');
  removeSourceIfExists('events');

  const filtered = getFilteredEvents();

  // Detect co-located events (same coords rounded to ~1km) and spread them
  const coordCount = new Map();
  const coordIdx   = new Map();
  filtered.forEach(e => {
    const key = `${Number(e.lon).toFixed(2)},${Number(e.lat).toFixed(2)}`;
    coordCount.set(key, (coordCount.get(key) || 0) + 1);
  });

  const geojson = {
    type: 'FeatureCollection',
    features: filtered.map(e => {
      const key = `${Number(e.lon).toFixed(2)},${Number(e.lat).toFixed(2)}`;
      const total = coordCount.get(key) || 1;
      const idx   = coordIdx.get(key) || 0;
      coordIdx.set(key, idx + 1);

      let lon = Number(e.lon);
      let lat = Number(e.lat);
      if (total > 1) {
        const angle  = (idx / total) * 2 * Math.PI;
        const radius = 0.18; // ~18km spread
        lon += Math.cos(angle) * radius;
        lat += Math.sin(angle) * radius;
      }

      return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lon, lat]
      },
      properties: {
        id: e.id,
        title: e.title || '',
        url: e.url || '',
        domain: e.domain || '',
        date: e.date || '',
        country: e.country || '',
        tone: Number(e.tone),
        color: e.color || getColor(e.tone),
        severity: getSeverityLabel(Number(e.tone)),
        score: Number(e.score || 0),
        size: Math.max(5, Math.min(16, Math.abs(Number(e.tone) || 0) + 5)),
        category: e.category || 'incident',
        categoryColor: e.categoryColor || getCategoryColor(e.category || 'incident'),
        dataSource: e.dataSource || 'gdelt',
        fatalities: Number(e.fatalities || 0),
        actor1: e.actor1 || '',
        actor2: e.actor2 || '',
        subType: e.subType || ''
      }
    };
    })
  };

  map.addSource('events', {
    type: 'geojson',
    data: geojson,
    cluster: true,
    clusterMaxZoom: 7,
    clusterRadius: 25
  });

  map.addLayer({
    id: 'clusters-glow',
    type: 'circle',
    source: 'events',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        'rgba(255,170,0,0.12)',  3,
        'rgba(255,100,0,0.12)', 10,
        'rgba(255,60,0,0.12)',  30,
        'rgba(255,34,68,0.12)'
      ],
      'circle-radius': [
        'step', ['get', 'point_count'],
        24,  3,
        32, 10,
        42, 30,
        56
      ],
      'circle-opacity': 1,
      'circle-stroke-width': 0
    }
  });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'events',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        'rgba(255,170,0,0.92)',  3,
        'rgba(255,100,0,0.92)', 10,
        'rgba(255,60,0,0.92)',  30,
        'rgba(255,34,68,0.92)'
      ],
      'circle-radius': [
        'step', ['get', 'point_count'],
        14,  3,
        18, 10,
        24, 30,
        32
      ],
      'circle-opacity': 1,
      'circle-stroke-width': 1,
      'circle-stroke-color': [
        'step', ['get', 'point_count'],
        'rgba(255,170,0,0.4)',  3,
        'rgba(255,100,0,0.4)', 10,
        'rgba(255,60,0,0.4)',  30,
        'rgba(255,34,68,0.4)'
      ]
    }
  });

  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'events',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['step', ['get', 'point_count'], 10, 10, 12, 30, 14],
      'text-allow-overlap': true
    },
    paint: {
      'text-color': '#ffffff'
    }
  });

  map.addLayer({
    id: 'events-glow',
    type: 'circle',
    source: 'events',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'categoryColor'],
      'circle-radius': ['*', ['get', 'size'], 2],
      'circle-opacity': 0.12,
      'circle-stroke-width': 0
    }
  });

  map.addLayer({
    id: 'events-circles',
    type: 'circle',
    source: 'events',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'categoryColor'],
      'circle-radius': ['get', 'size'],
      'circle-opacity': 0.92,
      'circle-stroke-width': 0
    }
  });
}

function bindMapEvents() {
  map.on('click', 'events-circles', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;

    const p = feature.properties || {};
    const coords = feature.geometry?.coordinates;
    if (!coords) return;

    const sevColor = getColor(Number(p.tone));
    const catColor = p.categoryColor || getCategoryColor(p.category || 'incident');
    const catLabel = getCategoryLabel(p.category || 'incident');
    const isAcled = p.dataSource === 'acled';
    const dateStr = formatDate(p.date);
    const safeTitle = escapeHtml(p.title || p.domain || 'Event');
    const safeCountry = escapeHtml(p.country || 'Unknown');
    const safeDomain = escapeHtml(p.domain || '');
    const safeUrl = escapeHtml(p.url || '');

    const sourceTag = isAcled
      ? `<span style="padding:2px 8px;font-size:9px;background:rgba(0,255,136,0.12);color:#00ff88;border:1px solid rgba(0,255,136,0.3);">ACLED</span>`
      : ``;

    const fatalitiesTag = isAcled && Number(p.fatalities) > 0
      ? `<span style="padding:2px 8px;font-size:9px;background:rgba(255,34,68,0.12);color:#ff2244;border:1px solid rgba(255,34,68,0.3);">☠ ${escapeHtml(p.fatalities)}</span>`
      : '';

    const actorsLine = isAcled && p.actor1
      ? `<div style="color:#4a6a7a;font-size:9px;margin-bottom:5px;">⚔ ${escapeHtml(p.actor1)}${p.actor2 ? ' <span style="color:#2a3a4a">vs</span> ' + escapeHtml(p.actor2) : ''}</div>`
      : '';

    const titleBlock = safeUrl
      ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:#e8f4ff;text-decoration:none;border-bottom:1px dotted #2a4a5a;">${safeTitle}</a>`
      : `<span style="color:#c8d8e8;">${safeTitle}</span>`;

    popup
      .setLngLat(coords)
      .setHTML(`
        <div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:290px;max-width:340px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;">
            ${sourceTag}
            <span style="padding:2px 8px;font-size:9px;background:${catColor}22;color:${catColor};border:1px solid ${catColor}55;">${catLabel}</span>
            <span style="padding:2px 8px;font-size:9px;background:${sevColor}22;color:${sevColor};border:1px solid ${sevColor}55;">${escapeHtml(p.severity || '')}</span>
            ${fatalitiesTag}
          </div>
          <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">📍 ${safeCountry}</div>
          ${actorsLine}
          <p style="color:#c8d8e8;line-height:1.5;margin:0 0 8px 0;font-size:11px;">
            ${titleBlock}
          </p>
          <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
            ${escapeHtml(dateStr)} &nbsp;·&nbsp; ${safeDomain}
          </div>
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'events-circles', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', 'events-circles', () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('click', 'clusters', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
    if (!features.length) return;

    const clusterId = features[0].properties?.cluster_id;
    const source = map.getSource('events');

    if (!source || typeof source.getClusterExpansionZoom !== 'function') return;

    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({
        center: features[0].geometry.coordinates,
        zoom: Math.max(zoom, 8),
        duration: 400
      });
    });
  });

  map.on('mouseenter', 'clusters', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', 'clusters', () => {
    map.getCanvas().style.cursor = '';
  });
}

// ── Filtres ────────────────────────────────────────────────────────────────
function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const overlay = document.getElementById('filter-overlay');
  const btn = document.getElementById('filter-btn');

  if (!panel || !overlay || !btn) return;

  const open = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = open ? 'block' : 'none';
  overlay.style.display = open ? 'block' : 'none';
  btn.style.borderColor = open ? 'var(--accent)' : '';
  btn.style.color = open ? 'var(--accent)' : '';
}

function getChecked(filterName) {
  return [...document.querySelectorAll(`input[data-filter="${filterName}"]:checked`)]
    .map(el => el.value);
}

function applyFilters() {
  const sevOk = new Set(getChecked('sev'));
  const regionOk = new Set(getChecked('region'));
  const catOk = new Set(getChecked('cat'));

  allEvents.forEach(e => {
    const sevMatch = sevOk.has(getSeverityKey(Number(e.tone)));
    const regionMatch = regionOk.has(getRegionKey(Number(e.lat), Number(e.lon)));
    const catMatch = catOk.has(e.category || 'incident');
    e._visible = sevMatch && regionMatch && catMatch;
  });

  renderMap();
}

function resetFilters() {
  document.querySelectorAll('.f-check input[type=checkbox]').forEach(el => {
    el.checked = true;
  });

  allEvents.forEach(e => {
    e._visible = true;
  });

  renderMap();
}

// ── Init ──────────────────────────────────────────────────────────────────
initMap();

map.on('load', () => {
  bindMapEvents();
  loadGdelt();
});
 