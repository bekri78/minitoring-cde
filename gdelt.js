'use strict';

const JSZip = require('jszip');

// ── Codes CAMEO retenus ───────────────────────────────────────────────────
const RELEVANT_CODES = new Set(['14', '15', '17', '18', '19', '20']);

// ── Bruit à exclure ───────────────────────────────────────────────────────
const NOISE_KEYWORDS = [
  'photo review', 'american dream', 'expo', 'conexpo', 'fashion', 'celebrity',
  'movie', 'film', 'music', 'festival', 'sports', 'match', 'football', 'soccer',
  'nba', 'nfl', 'baseball', 'cricket', 'concert', 'award', 'red carpet',
  'tv show', 'podcast', 'entertainment', 'gallery', 'photos', 'photo gallery',
  'weekend', 'lifestyle', 'recipe', 'restaurant', 'horoscope', 'tourism', 'travel',
  'stock', 'market', 'earnings', 'real estate', 'deal', 'shopping', 'review',
  'ipo', 'startup', 'funding round', 'quarterly results', 'revenue',
  'pleads guilty', 'pleads not guilty', 'plead guilty', 'not guilty plea',
  'found guilty', 'found not guilty', 'convicted of', 'acquitted',
  'sentenced to', 'sentencing hearing', 'faces sentencing',
  'court hears', 'court rules', 'court finds', 'court orders', 'court rejects',
  'court dismisses', 'court blocks', 'court upholds', 'court denies',
  'fails in court', 'fails in nsw', 'nsw court', 'nsw supreme',
  'suppression order', 'suppress identities', 'non-publication',
  'inquest', 'coroner', 'coroners court', 'bail hearing', 'bail granted',
  'bail denied', 'remanded in custody', 'arraigned', 'indicted', 'indictment',
  'grand jury', 'lawsuit filed', 'civil lawsuit', 'class action',
  'years in prison', 'life in prison', 'prison sentence',
  'appeal court', 'appeals court', 'court of appeal',
  'murder trial', 'terrorism trial', 'war crimes trial',
  'on trial for', 'stands trial', 'goes on trial',
  'testimony', 'takes the stand', 'prosecutor says', 'defense attorney',
  'anniversary', 'years ago', 'one year after', 'two years after',
  'looks back', 'in retrospect', 'remembering', 'commemorat',
  'memorial service', 'tribute to', 'in memory of',
  'explainer', 'fact check', 'what to know', 'opinion:', 'op-ed',
  'health tips', 'weight loss', 'diet', 'fitness', 'wellness'
];

const NOISE_DOMAINS = new Set([
  'espn.com', 'bleacherreport.com', 'nba.com', 'nfl.com', 'mlb.com',
  'tmz.com', 'people.com', 'eonline.com', 'variety.com', 'hollywoodreporter.com',
  'buzzfeed.com', 'buzzfeednews.com', 'foodnetwork.com', 'allrecipes.com',
  'techcrunch.com', 'engadget.com', 'theverge.com', 'wired.com',
  'marketwatch.com', 'investopedia.com', 'fool.com'
]);

// ── Mots-clés opérationnels ────────────────────────────────────────────────
const MILITARY_CRISIS_KEYWORDS = [
  'military', 'army', 'navy', 'air force', 'missile', 'strike', 'attack',
  'drone', 'artillery', 'troops', 'troop', 'soldier', 'forces', 'defense',
  'defence', 'conflict', 'war', 'battle', 'combat', 'insurgent', 'terror',
  'terrorist', 'explosion', 'blast', 'shelling', 'bombing', 'raid', 'airstrike',
  'militia', 'border clash', 'hostage', 'coup', 'sanction', 'evacuation',
  'protest', 'riot', 'demonstration', 'unrest', 'clashes', 'crisis', 'incident',
  'security', 'police', 'emergency', 'martial law', 'ceasefire', 'offensive',
  'detained', 'arrested', 'killed', 'wounded', 'rebels', 'insurgency',
  'gunfire', 'fighting', 'rocket', 'air raid', 'siege', 'mobilization',
  'paramilitary'
];

// ── Classification opérationnelle ─────────────────────────────────────────
const CATEGORY_RULES = [
  {
    key: 'terrorism',
    keywords: ['terrorist', 'terrorism', 'suicide bomb', 'isis', 'al-qaeda',
               'al qaeda', 'jihad', 'ied', 'car bomb', 'beheading', 'kidnap',
               'hostage', 'extremist']
  },
  {
    key: 'military',
    keywords: ['airstrike', 'air strike', 'missile', 'artillery', 'shelling',
               'bombardment', 'navy', 'air force', 'fighter jet', 'warplane',
               'tank', 'drone strike', 'mobilization', 'paramilitary',
               'armed forces', 'military operation', 'offensive', 'siege',
               'ceasefire', 'air raid', 'rocket attack', 'troops deployed']
  },
  {
    key: 'conflict',
    keywords: ['war', 'battle', 'combat', 'fighting', 'clashes', 'gunfire',
               'killed', 'wounded', 'rebels', 'insurgent', 'insurgency',
               'border clash', 'shootout', 'armed clash', 'militia', 'raid',
               'bombing', 'blast', 'explosion']
  },
  {
    key: 'protest',
    keywords: ['protest', 'riot', 'demonstration', 'unrest', 'march', 'rally',
               'uprising', 'civil unrest', 'dissent', 'blockade', 'occupy',
               'walkout', 'coup']
  },
  {
    key: 'crisis',
    keywords: ['crisis', 'emergency', 'martial law', 'sanction', 'evacuation',
               'displaced', 'refugee', 'humanitarian', 'famine', 'epidemic',
               'disaster', 'state of emergency', 'crackdown', 'detained',
               'arrested']
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s:/._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAnyKeyword(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some(k => normalized.includes(normalizeText(k)));
}

function titleFromUrl(url) {
  if (!url) return 'Untitled';
  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '');
    const segments = u.pathname.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const cleaned = decodeURIComponent(segments[i])
        .replace(/\.[a-z0-9]{2,6}$/i, '')
        .replace(/[-_+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (/[a-zA-Z]{3,}/.test(cleaned)) return cleaned;
    }
    return domain;
  } catch {
    return 'Untitled';
  }
}

function safeDomainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function classifyEvent(text) {
  const normalized = normalizeText(text);
  for (const cat of CATEGORY_RULES) {
    if (cat.keywords.some(k => normalized.includes(normalizeText(k)))) {
      return cat.key;
    }
  }
  return 'incident';
}

function scoreEvent(text, tone) {
  let score = Math.abs(Number(tone) || 0) * 10;
  const normalized = normalizeText(text);
  for (const kw of MILITARY_CRISIS_KEYWORDS) {
    if (normalized.includes(normalizeText(kw))) score += 20;
  }
  const bonuses = {
    missile: 25, war: 25, attack: 22, airstrike: 24, bombing: 24,
    terrorist: 24, military: 20, drone: 20, strike: 20, hostage: 20,
    protest: 18, riot: 18, explosion: 18, troops: 16, crisis: 15, incident: 12
  };
  for (const [word, bonus] of Object.entries(bonuses)) {
    if (normalized.includes(word)) score += bonus;
  }
  return score;
}

function isNoiseEvent(title, url, domain) {
  if (NOISE_DOMAINS.has(domain)) return true;
  const text = `${title} ${url} ${domain}`;
  return containsAnyKeyword(text, NOISE_KEYWORDS);
}

function isOperationalEvent(title, url) {
  const text = `${title} ${url}`;
  return containsAnyKeyword(text, MILITARY_CRISIS_KEYWORDS);
}

function getSeverityLabel(tone) {
  if (tone <= -7) return 'CRITICAL';
  if (tone <= -5) return 'SEVERE';
  if (tone <= -2) return 'HIGH';
  if (tone < 0)  return 'MODERATE';
  return 'LOW';
}

function getColor(tone) {
  if (isNaN(tone)) return '#4a6a7a';
  if (tone <= -7) return '#ff2244';
  if (tone <= -5) return '#ff5533';
  if (tone < -2)  return '#ffaa00';
  if (tone < 0)   return '#ffdd55';
  return '#00d4ff';
}

// ── Parser une ligne GDELT ────────────────────────────────────────────────
function parseLine(line) {
  try {
    const c = line.split('\t');
    if (c.length < 61) return null;

    const rootCode  = (c[28] || '').substring(0, 2);
    const goldstein = parseFloat(c[30]);
    const geoType   = c[35];
    const latRaw    = parseFloat(c[40]);
    const lonRaw    = parseFloat(c[41]);
    const url       = (c[60] || '').trim();

    if (!RELEVANT_CODES.has(rootCode)) return null;
    if (isNaN(goldstein) || goldstein > -2) return null;
    if (geoType === '2' || geoType === '3') return null;
    if (!url) return null;

    let lat = latRaw;
    let lon = lonRaw;

    if (isNaN(lat) || isNaN(lon)) return null;

    const title  = titleFromUrl(url);
    const domain = safeDomainFromUrl(url);
    const text   = `${title} ${url}`;

    if (isNoiseEvent(title, url, domain)) return null;
    if (!isOperationalEvent(title, url)) return null;

    const category = classifyEvent(text);
    const score    = scoreEvent(text, goldstein);

    return {
      id:            c[0] || `gdelt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title,
      url,
      domain,
      date:          c[1] || '',
      country:       c[36] || c[37] || '',
      rootCode,
      lat,
      lon,
      tone:          goldstein,
      color:         getColor(goldstein),
      severity:      getSeverityLabel(goldstein),
      category,
      score,
      dataSource:    'gdelt'
    };
  } catch {
    return null;
  }
}

// ── Fetch ZIP GDELT ───────────────────────────────────────────────────────
async function fetchZip(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`ZIP fetch failed (${resp.status})`);
  const buf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const files = Object.values(zip.files).filter(f => !f.dir);
  if (!files.length) throw new Error('ZIP empty');
  const target = files.find(f => /\.csv$/i.test(f.name)) || files[0];
  return target.async('string');
}

// ── Fetch tous les événements du jour ─────────────────────────────────────
async function fetchTodayEvents() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  console.log(`[gdelt] fetching masterfilelist for ${today}`);
  const masterResp = await fetch('http://data.gdeltproject.org/gdeltv2/masterfilelist.txt');
  if (!masterResp.ok) throw new Error(`masterfilelist failed (${masterResp.status})`);

  const masterText = await masterResp.text();
  const todayUrls = masterText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l.includes(`/${today}`) && l.includes('.export.CSV.zip'))
    .map(l => l.split(/\s+/)[2])
    .filter(Boolean);

  console.log(`[gdelt] ${todayUrls.length} files for ${today}`);
  if (!todayUrls.length) throw new Error(`No files for ${today}`);

  const BATCH_SIZE = 8;
  const dedupMap = new Map();
  let ok = 0, fail = 0;

  for (let i = 0; i < todayUrls.length; i += BATCH_SIZE) {
    const batch = todayUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(fetchZip));

    for (const result of results) {
      if (result.status !== 'fulfilled') { fail++; continue; }
      ok++;

      for (const line of result.value.split('\n')) {
        const ev = parseLine(line);
        if (!ev) continue;

        const key = ev.url;
        const existing = dedupMap.get(key);
        if (!existing || ev.score > existing.score) {
          dedupMap.set(key, ev);
        }
      }
    }

    console.log(`[gdelt] ${i + batch.length}/${todayUrls.length} — ${dedupMap.size} events — ${ok} OK / ${fail} fail`);
  }

  const events = Array.from(dedupMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 800);

  console.log(`[gdelt] done — ${events.length} events from ${ok}/${todayUrls.length} files`);
  return events;
}

module.exports = { fetchTodayEvents };
