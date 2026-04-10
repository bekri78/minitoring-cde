'use strict';

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

const MASTERFILELIST_URL = process.env.GDELT_MASTERFILELIST_URL || 'http://data.gdeltproject.org/gdeltv2/masterfilelist.txt';
const CACHE_DIR = process.env.CACHE_DIR || '/data';
const STATE_PATH = path.join(CACHE_DIR, 'gdelt-file-state.json');

const BOOTSTRAP_WINDOWS = Number(process.env.GDELT_BOOTSTRAP_WINDOWS || 4);
const MAX_WINDOWS_PER_RUN = Number(process.env.GDELT_WINDOWS_PER_RUN || 4);
const SNAPSHOT_LOOKBACK_HOURS = Number(process.env.GDELT_LOOKBACK_HOURS || 24);
const MAX_DASHBOARD_EVENTS = Number(process.env.GDELT_MAX_EVENTS || 1200);
const STRATEGIC_MIN_EVENTS = Number(process.env.GDELT_STRATEGIC_MIN || 250);
const MIN_RELEVANCE_SCORE = Number(process.env.GDELT_MIN_SCORE || 60);

const STRATEGIC_COUNTRY_CODES = new Set([
  'RS', 'CH', 'KN', 'KS', 'TW', 'VM',
  'IR', 'SY', 'UP', 'IZ', 'AF', 'PK',
  'LY', 'YM', 'SU',
]);

const CATEGORY_RULES = [
  { key: 'terrorism', cameo: ['181', '1831', '1832', '1833'], keywords: ['terrorist', 'terrorism', 'isis', 'al qaeda', 'boko haram', 'suicide bombing', 'ied', 'car bomb', 'hostage'] },
  { key: 'cyber', cameo: ['155'], keywords: ['cyberattack', 'cyber attack', 'ransomware', 'hacked', 'hackers', 'malware', 'ddos', 'cyber forces'] },
  { key: 'protest', cameo: ['14'], keywords: ['protest', 'riot', 'demonstration', 'unrest', 'march', 'rally', 'boycott'] },
  { key: 'strategic', cameo: ['13', '16', '17'], keywords: ['sanction', 'nuclear', 'ballistic missile', 'hypersonic', 'wmd', 'diplomatic rupture', 'strategic'] },
  { key: 'conflict', cameo: ['18', '19', '20'], keywords: ['clashes', 'fighting', 'battle', 'combat', 'war', 'rebels', 'militia', 'offensive', 'siege'] },
  { key: 'military', cameo: ['15', '180', '184', '185', '186', '190', '193', '194', '195', '196', '204'], keywords: ['airstrike', 'missile', 'artillery', 'shelling', 'bombardment', 'warplane', 'fighter jet', 'military aircraft', 'tank', 'drone strike', 'armed forces', 'military exercise', 'troops', 'mobilization', 'navy', 'naval', 'submarine', 'warship'] },
  { key: 'crisis', cameo: ['13', '16', '17'], keywords: ['expelled', 'detained', 'arrested', 'crisis', 'emergency', 'martial law', 'evacuation', 'refugee', 'ultimatum', 'warning', 'diplomatic', 'tension', 'border'] },
  { key: 'incident', cameo: [], keywords: ['security incident', 'incident', 'police operation', 'checkpoint'] },
];

const MILITARY_CRISIS_KEYWORDS = [
  'military', 'army', 'navy', 'air force', 'missile', 'strike', 'attack',
  'drone', 'artillery', 'troops', 'forces', 'defense', 'conflict', 'war',
  'battle', 'combat', 'terror', 'explosion', 'shelling', 'bombing', 'raid',
  'militia', 'hostage', 'coup', 'sanction', 'protest', 'riot', 'clashes',
  'crisis', 'security', 'martial law', 'offensive', 'gunfire', 'rocket',
];

const NOISE_KEYWORDS = [
  'photo review', 'fashion', 'celebrity', 'movie', 'film', 'music', 'festival',
  'sports', 'football', 'soccer', 'nba', 'nfl', 'concert', 'entertainment',
  'lifestyle', 'recipe', 'restaurant', 'tourism', 'travel', 'stock', 'market',
  'earnings', 'real estate', 'shopping', 'ipo', 'startup', 'revenue',
  'investment', 'shares', 'samsung', 'semiconductor', 'memory chips',
  'acciones', 'bolsa', 'inversion', 'inteligencia artificial', 'court rules',
  'lawsuit', 'anniversary', 'memorial service', 'fact check', 'opinion:',
  'birth', 'delivery', 'triplets', 'twins', 'pregnant', 'pregnancy', 'mother',
  'maternity', 'hospital', 'obstetric', 'car accident', 'road accident',
  'plane crash', 'train derail', 'building collapse', 'flood kills',
  'storm kills', 'weather kills',
];

const CIVILIAN_OVERRIDE = [
  'clinical trial', 'patient', 'vaccine', 'cancer', 'therapy', 'hospital',
  'birth', 'delivery', 'triplets', 'twins', 'pregnant', 'pregnancy', 'mother',
  'maternity', 'obstetric', 'election', 'vote', 'ballot', 'parliament',
  'economic growth', 'gdp', 'inflation', 'interest rate', 'trade deal',
  'stock market', 'share price', 'earnings', 'revenue', 'profit',
  'earthquake', 'flood', 'hurricane', 'wildfire', 'accident', 'crash',
  'collision', 'sports', 'tournament', 'championship', 'concert', 'movie',
];

const SECURITY_OVERRIDE_KEYWORDS = [
  'attack', 'airstrike', 'strike', 'missile', 'drone', 'military', 'war',
  'terror', 'bomb', 'explosion', 'hostage', 'raid', 'shelling', 'cyberattack',
  'ransomware', 'hack', 'sanction', 'border', 'coup', 'riot', 'protest',
];

const NOISE_DOMAINS = new Set([
  'espn.com', 'bleacherreport.com', 'nba.com', 'nfl.com', 'mlb.com',
  'tmz.com', 'people.com', 'eonline.com', 'variety.com', 'foodnetwork.com',
  'allrecipes.com', 'techcrunch.com', 'engadget.com', 'theverge.com',
  'marketwatch.com', 'investopedia.com', 'fool.com', 'estrategiasdeinversion.com',
]);

const PRIORITY_DOMAIN_BOOST = {
  'tass.ru': 65, 'tass.com': 65, 'ria.ru': 60, 'rt.com': 55,
  'sputniknews.com': 55, 'sputnikglobe.com': 55, 'interfax.ru': 60,
  'xinhuanet.com': 65, 'news.cn': 65, 'globaltimes.cn': 60,
  'chinadaily.com.cn': 55, 'cgtn.com': 55, 'china.org.cn': 55,
  'kcna.kp': 70, 'kcna.co.jp': 70, 'rodong.rep.kp': 70,
  'presstv.ir': 60, 'presstv.com': 60, 'irna.ir': 60, 'tasnimnews.com': 60,
  'farsnews.ir': 55, 'mehrnews.com': 55,
  'almayadeen.net': 55, 'aljazeera.net': 50, 'alarabiya.net': 50,
  'yonhapnews.co.kr': 55,
};

const URL_NAV_SEGMENTS = new Set([
  'view', 'news', 'article', 'articles', 'read', 'story', 'stories', 'post', 'posts',
  'page', 'pages', 'detail', 'details', 'content', 'index', 'home', 'default',
  'category', 'categories', 'tag', 'tags', 'search', 'author', 'authors',
  'section', 'topic', 'topics', 'latest', 'breaking', 'world', 'politics',
  'national', 'local', 'international', 'sports', 'business', 'technology',
  'opinion', 'editorial', 'comment', 'comments', 'html', 'htm', 'php', 'aspx', 'jsp',
  'en', 'fr', 'ru', 'zh', 'ar', 'ko', 'ja', 'de', 'es', 'pt', 'tr', 'fa', 'he',
]);

const CAMEO_SUBTYPE = {
  '130': 'Threaten', '134': 'Threaten with military force', '139': 'Threaten with military attack',
  '141': 'Demonstrate or rally', '145': 'Protest violently, riot',
  '150': 'Demonstrate military or police power', '154': 'Mobilize or increase armed forces', '155': 'Mobilize cyber forces',
  '160': 'Reduce relations', '170': 'Coerce',
  '180': 'Use conventional military force', '181': 'Abduct, hijack, or take hostage', '182': 'Physically assault',
  '183': 'Conduct bombing', '1831': 'Carry out suicide bombing', '1832': 'Carry out car bombing', '1833': 'Carry out IED attack',
  '184': 'Use conventional weapons', '185': 'Employ aerial weapons', '186': 'Violate ceasefire',
  '190': 'Fight', '191': 'Impose blockade, restrict movement', '192': 'Occupy territory',
  '193': 'Fight with small arms and light weapons', '194': 'Fight with artillery and tanks',
  '195': 'Employ aerial weapons', '196': 'Violate ceasefire',
  '200': 'Engage in mass violence', '202': 'Engage in mass killings', '204': 'Use weapons of mass destruction',
};

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {
      lastBatchTs: null,
      snapshot: [],
      lastUpdate: null,
    };
  }
}

function saveState(state) {
  ensureCacheDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));
}

function parseMasterLine(line) {
  const parts = String(line || '').trim().split(/\s+/);
  const url = parts[parts.length - 1];
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const filename = url.split('/').pop() || '';
  const tsMatch = filename.match(/^(\d{14})\./);
  if (!tsMatch) return null;
  let kind = null;
  if (/\.export\.CSV\.zip$/i.test(filename)) kind = 'events';
  else if (/\.mentions\.CSV\.zip$/i.test(filename)) kind = 'mentions';
  else if (/\.gkg\.csv\.zip$/i.test(filename)) kind = 'gkg';
  if (!kind) return null;
  return { ts: tsMatch[1], kind, url, filename };
}

async function fetchMasterFileList() {
  const resp = await fetch(MASTERFILELIST_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'text/plain' },
  });
  if (!resp.ok) throw new Error(`masterfilelist HTTP ${resp.status}`);
  return resp.text();
}

function groupEntries(text) {
  const groups = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const parsed = parseMasterLine(line);
    if (!parsed) continue;
    const current = groups.get(parsed.ts) || {};
    current[parsed.kind] = parsed.url;
    groups.set(parsed.ts, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.events && group.mentions && group.gkg)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ts, group]) => ({ ts, ...group }));
}

async function downloadZipText(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`${url} HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const zip = await unzipper.Open.buffer(buf);
  const entry = zip.files.find(file => !file.path.endsWith('/'));
  if (!entry) return '';
  return (await entry.buffer()).toString('utf8');
}

function normalizeText(value) {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\u0600-\u06ff\u0400-\u04ffa-z0-9\s:/._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function containsAnyKeyword(text, keywords) {
  const decoded = decodeHtmlEntities(text).toLowerCase();
  const normalized = normalizeText(decoded);
  return keywords.some(keyword =>
    decoded.includes(decodeHtmlEntities(keyword).toLowerCase()) ||
    normalized.includes(normalizeText(keyword))
  );
}

function safeDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function titleFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const hasNativeScript = (value) => /[\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\u0600-\u06ff\u0400-\u04ff]/.test(value);
    for (const [, rawParam] of u.searchParams.entries()) {
      const candidate = decodeHtmlEntities(decodeURIComponent(String(rawParam || '')))
        .replace(/[+_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (hasNativeScript(candidate) && candidate.length >= 4) return candidate;
    }
    const segments = u.pathname.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const raw = decodeHtmlEntities(decodeURIComponent(segments[i]))
        .replace(/\.[a-z0-9]{2,6}$/i, '')
        .replace(/[-_+%]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw || /^\d+$/.test(raw) || URL_NAV_SEGMENTS.has(raw.toLowerCase())) continue;
      if (hasNativeScript(raw) && raw.length >= 4) return raw;
      if (raw.length >= 20 || (/[a-zA-Z]{3,}/.test(raw) && raw.includes(' '))) return raw;
    }
  } catch {}
  return null;
}

function getSubEventType(eventCode) {
  if (!eventCode) return 'Unknown';
  return CAMEO_SUBTYPE[eventCode] || CAMEO_SUBTYPE[eventCode.slice(0, 3)] || CAMEO_SUBTYPE[eventCode.slice(0, 2)] || 'Unknown';
}

function buildFallbackTitle(event) {
  const parts = [];
  const subtype = getSubEventType(event.eventCode || event.rootCode);
  if (subtype !== 'Unknown') parts.push(subtype);
  if (event.actor1) parts.push(event.actor1);
  if (event.location) parts.push(event.location);
  return parts.filter(Boolean).join(' — ') || 'Unknown Event';
}

function pageTitleFromExtras(extras) {
  const match = String(extras || '').match(/<PAGE_TITLE>([^<]{4,300})<\/PAGE_TITLE>/i);
  return match ? decodeHtmlEntities(match[1]).trim().replace(/\s+/g, ' ') : null;
}

function toneFromV2Tone(value) {
  if (!value) return null;
  const first = String(value).split(',')[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

function splitPipeField(value) {
  if (!value) return [];
  return String(value)
    .split(';')
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function isCivilianNoise(text) {
  return containsAnyKeyword(text, CIVILIAN_OVERRIDE) && !containsAnyKeyword(text, SECURITY_OVERRIDE_KEYWORDS);
}

function isNoiseEvent(title, url, domain) {
  if (NOISE_DOMAINS.has(domain)) return true;
  return containsAnyKeyword(`${title} ${url}`, NOISE_KEYWORDS);
}

function classifyEvent(text, eventCode = '') {
  const normalized = normalizeText(text);
  if (isCivilianNoise(text)) return 'discard';
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(keyword => normalized.includes(normalizeText(keyword)))) return rule.key;
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.cameo.some(prefix => String(eventCode || '').startsWith(prefix))) return rule.key;
  }
  return 'incident';
}

function scoreEvent(text, tone, domain) {
  let score = Math.abs(Number(tone) || 0) * 10;
  const normalized = normalizeText(text);
  for (const keyword of MILITARY_CRISIS_KEYWORDS) {
    if (normalized.includes(normalizeText(keyword))) score += 20;
  }
  const bonuses = {
    missile: 25, war: 25, attack: 22, airstrike: 24, bombing: 24,
    terrorist: 24, military: 20, drone: 20, strike: 20, hostage: 20,
    protest: 18, riot: 18, explosion: 18, troops: 16, crisis: 15, incident: 12,
    cyberattack: 24, ransomware: 20, sanctions: 16, nuclear: 25, clashes: 18,
  };
  for (const [word, bonus] of Object.entries(bonuses)) {
    if (normalized.includes(word)) score += bonus;
  }
  if (domain && PRIORITY_DOMAIN_BOOST[domain]) score += PRIORITY_DOMAIN_BOOST[domain];
  return score;
}

function isRelevantEvent(event) {
  if (!event || event.category === 'discard') return false;
  const score = Number(event.score || 0);
  if (score >= MIN_RELEVANCE_SCORE) return true;
  if (['cyber', 'strategic', 'protest'].includes(event.category) && score >= MIN_RELEVANCE_SCORE - 20) return true;
  if (STRATEGIC_COUNTRY_CODES.has(event.countryCode) && PRIORITY_DOMAIN_BOOST[event.domain] && score >= MIN_RELEVANCE_SCORE - 25) return true;
  return false;
}

function getSeverityLabel(tone) {
  if (tone <= -7) return 'CRITICAL';
  if (tone <= -5) return 'SEVERE';
  if (tone <= -2) return 'HIGH';
  if (tone < 0) return 'MODERATE';
  return 'LOW';
}

function getColor(tone) {
  if (!Number.isFinite(tone)) return '#4a6a7a';
  if (tone <= -7) return '#ff2244';
  if (tone <= -5) return '#ff5533';
  if (tone < -2) return '#ffaa00';
  if (tone < 0) return '#ffdd55';
  return '#00d4ff';
}

function parseEventRows(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 58) continue;
    const lat = Number(cols[53]);
    const lon = Number(cols[54]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const sourceUrl = cols[57] || '';
    if (!sourceUrl) continue;
    out.push({
      globalEventId: cols[0],
      date: cols[1],
      actor1: cols[6] || '',
      actor2: cols[16] || '',
      eventCode: cols[26] || '',
      rootCode: cols[28] || '',
      quadClass: cols[29] || '',
      goldstein: Number(cols[30] || 0),
      numMentions: Number(cols[31] || 0),
      numSources: Number(cols[32] || 0),
      numArticles: Number(cols[33] || 0),
      avgTone: Number(cols[34] || 0),
      actionGeoType: cols[49] || '',
      location: cols[50] || '',
      countryCode: cols[51] || '',
      lat,
      lon,
      dateAdded: cols[56] || '',
      sourceUrl,
    });
  }
  return out;
}

function parseMentions(text) {
  const aggregated = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 14) continue;
    const eventId = cols[0];
    if (!eventId) continue;
    const mentionIdentifier = cols[5] || '';
    const confidence = Number(cols[11] || 0);
    const docTone = Number(cols[13] || 0);
    const current = aggregated.get(eventId) || {
      mentionCount: 0,
      bestConfidence: -1,
      bestIdentifier: '',
      bestDocTone: null,
      latestMentionTime: '',
    };
    current.mentionCount += 1;
    if (confidence >= current.bestConfidence && mentionIdentifier) {
      current.bestConfidence = confidence;
      current.bestIdentifier = mentionIdentifier;
      current.bestDocTone = Number.isFinite(docTone) ? docTone : current.bestDocTone;
    }
    const mentionTime = cols[2] || '';
    if (mentionTime > current.latestMentionTime) current.latestMentionTime = mentionTime;
    aggregated.set(eventId, current);
  }
  return aggregated;
}

function parseGkg(text) {
  const docs = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 16) continue;
    const documentIdentifier = cols[3] || '';
    if (!documentIdentifier) continue;
    docs.set(documentIdentifier, {
      documentIdentifier,
      themes: splitPipeField(cols[7] || cols[6]),
      locations: splitPipeField(cols[9] || cols[8]),
      persons: splitPipeField(cols[11] || cols[10]),
      organizations: splitPipeField(cols[13] || cols[12]),
      v2Tone: cols[14] || '',
      extras: cols[25] || '',
    });
  }
  return docs;
}

function buildEventsForBatch(batch, eventRows, mentionMap, gkgMap) {
  const events = [];
  for (const row of eventRows) {
    const mention = mentionMap.get(row.globalEventId) || null;
    const candidateUrl = mention?.bestIdentifier || row.sourceUrl;
    const gkg = gkgMap.get(candidateUrl) || gkgMap.get(row.sourceUrl) || null;
    const domain = safeDomainFromUrl(candidateUrl || row.sourceUrl);
    const title =
      pageTitleFromExtras(gkg?.extras) ||
      titleFromUrl(candidateUrl || row.sourceUrl) ||
      buildFallbackTitle(row);

    if (!title || isNoiseEvent(title, candidateUrl || row.sourceUrl, domain)) continue;

    const subtype = getSubEventType(row.eventCode);
    const themes = gkg?.themes || [];
    const organizations = gkg?.organizations || [];
    const persons = gkg?.persons || [];
    const text = [
      title,
      candidateUrl || row.sourceUrl,
      row.actor1,
      row.actor2,
      subtype,
      themes.join(' '),
      organizations.join(' '),
      persons.join(' '),
    ].filter(Boolean).join(' ');

    const category = classifyEvent(text, row.eventCode);
    if (category === 'discard') continue;

    const tone = Number.isFinite(row.goldstein) ? row.goldstein : (toneFromV2Tone(gkg?.v2Tone) ?? row.avgTone ?? 0);
    let score = scoreEvent(text, tone, domain);
    score += Math.min(40, Math.log1p(row.numMentions + row.numSources + row.numArticles) * 8);
    score += Math.min(30, Math.log1p(mention?.mentionCount || 0) * 10);
    if (themes.some(theme => /MILITARY|ARMED|TERROR|CYBER|NUCLEAR|MISSILE/i.test(theme))) score += 25;

    const event = {
      id: row.globalEventId,
      title,
      originalTitle: title,
      nativeTitle: title,
      url: candidateUrl || row.sourceUrl,
      domain,
      date: row.date,
      dateAdded: row.dateAdded,
      country: row.location || '',
      countryCode: row.countryCode || '',
      lat: row.lat,
      lon: row.lon,
      tone,
      color: getColor(tone),
      severity: getSeverityLabel(tone),
      score,
      category,
      dataSource: 'gdelt-files',
      actor1: row.actor1 || null,
      actor2: row.actor2 || null,
      subType: subtype,
      rootCode: row.rootCode || '',
      eventCode: row.eventCode || '',
      mentionCount: mention?.mentionCount || row.numMentions || 0,
      numSources: row.numSources || 0,
      numArticles: row.numArticles || 0,
      headline: title,
      notes: themes.slice(0, 6).join(' · '),
      themes,
      persons,
      organizations,
      batchTs: batch.ts,
    };

    if (isRelevantEvent(event)) events.push(event);
  }
  return events;
}

function isoFromGdeltTimestamp(ts) {
  const str = String(ts || '');
  if (!/^\d{14}$/.test(str)) return null;
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T${str.slice(8, 10)}:${str.slice(10, 12)}:${str.slice(12, 14)}Z`;
}

function cutoffTimestamp(hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const d = new Date(cutoff);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function mergeSnapshot(existingSnapshot, freshEvents) {
  const byKey = new Map();
  for (const event of existingSnapshot || []) {
    const key = event.url || `id:${event.id}`;
    byKey.set(key, event);
  }
  for (const event of freshEvents) {
    const key = event.url || `id:${event.id}`;
    const existing = byKey.get(key);
    if (!existing || Number(event.score || 0) >= Number(existing.score || 0)) {
      byKey.set(key, event);
    }
  }

  const minTs = cutoffTimestamp(SNAPSHOT_LOOKBACK_HOURS);
  return [...byKey.values()]
    .filter(event => String(event.dateAdded || event.batchTs || '').localeCompare(minTs) >= 0)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function selectDiverseEvents(events) {
  const sorted = [...events].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const strategic = sorted.filter(event => STRATEGIC_COUNTRY_CODES.has(event.countryCode));
  const others = sorted.filter(event => !STRATEGIC_COUNTRY_CODES.has(event.countryCode));
  const selected = [
    ...strategic.slice(0, STRATEGIC_MIN_EVENTS),
    ...others,
  ];
  const dedup = new Map();
  for (const event of selected) {
    const key = event.url || `id:${event.id}`;
    if (!dedup.has(key)) dedup.set(key, event);
    if (dedup.size >= MAX_DASHBOARD_EVENTS) break;
  }
  return [...dedup.values()];
}

async function processBatch(batch) {
  console.log(`[gdelt-files] batch ${batch.ts} — download events/mentions/gkg`);
  const [eventsText, mentionsText, gkgText] = await Promise.all([
    downloadZipText(batch.events),
    downloadZipText(batch.mentions),
    downloadZipText(batch.gkg),
  ]);
  const eventRows = parseEventRows(eventsText);
  const mentionMap = parseMentions(mentionsText);
  const gkgMap = parseGkg(gkgText);
  const events = buildEventsForBatch(batch, eventRows, mentionMap, gkgMap);
  console.log(`[gdelt-files] batch ${batch.ts} — ${eventRows.length} raw events, ${events.length} kept`);
  return events;
}

async function fetchTodayEvents() {
  const state = loadState();
  const masterText = await fetchMasterFileList();
  const grouped = groupEntries(masterText);
  const pending = state.lastBatchTs
    ? grouped.filter(batch => batch.ts > state.lastBatchTs)
    : grouped.slice(-BOOTSTRAP_WINDOWS);

  const toProcess = pending.slice(0, MAX_WINDOWS_PER_RUN);
  if (!toProcess.length) {
    console.log(`[gdelt-files] no new batches — returning snapshot ${state.snapshot?.length || 0}`);
    return selectDiverseEvents(state.snapshot || []);
  }

  console.log(`[gdelt-files] processing ${toProcess.length} batch(es) from ${toProcess[0].ts} to ${toProcess[toProcess.length - 1].ts}`);
  let snapshot = state.snapshot || [];
  for (const batch of toProcess) {
    const fresh = await processBatch(batch);
    snapshot = mergeSnapshot(snapshot, fresh);
    state.lastBatchTs = batch.ts;
  }

  state.snapshot = snapshot;
  state.lastUpdate = new Date().toISOString();
  saveState(state);
  console.log(`[gdelt-files] snapshot ready — ${snapshot.length} events`);
  return selectDiverseEvents(snapshot);
}

module.exports = { fetchTodayEvents };
