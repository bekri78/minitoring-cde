'use strict';

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { normalizeEvents, filterEventsWithAI } = require('./gemini-normalizer');

const MASTERFILELIST_URL = process.env.GDELT_MASTERFILELIST_URL || 'http://data.gdeltproject.org/gdeltv2/masterfilelist.txt';
const MASTERFILELIST_TRANSLATION_URL = process.env.GDELT_MASTERFILELIST_TRANSLATION_URL || 'http://data.gdeltproject.org/gdeltv2/masterfilelist-translation.txt';
const INCLUDE_TRANSLATION = process.env.GDELT_INCLUDE_TRANSLATION !== 'false'; // enabled by default
const CACHE_DIR = process.env.CACHE_DIR || '/data';
const STATE_PATH = path.join(CACHE_DIR, 'gdelt-file-state.json');

const BOOTSTRAP_WINDOWS = Number(process.env.GDELT_BOOTSTRAP_WINDOWS || 8);
const MAX_WINDOWS_PER_RUN = Number(process.env.GDELT_WINDOWS_PER_RUN || 8);
const SNAPSHOT_LOOKBACK_HOURS = Number(process.env.GDELT_LOOKBACK_HOURS || 24);
const MAX_DASHBOARD_EVENTS = Number(process.env.GDELT_MAX_EVENTS || 800);
const STRATEGIC_MIN_EVENTS = Number(process.env.GDELT_STRATEGIC_MIN || 200);
const MIN_RELEVANCE_SCORE = Number(process.env.GDELT_MIN_SCORE || 60);
const FINAL_EVENTS = Number(process.env.GDELT_FINAL_EVENTS || 800);
const BASELINE_FINAL_EVENTS = 800;
// Spatial / aviation / maritime domain classification removed — covered by Google News RSS feeds.

const STRATEGIC_COUNTRY_CODES = new Set([
  'RS', 'CH', 'KN', 'KS', 'TW', 'VM',
  'IR', 'SY', 'UP', 'IZ', 'AF', 'PK',
  'LY', 'YM', 'SU',
]);

const STRATEGIC_REGION_BOOST = new Set(['russia_cis', 'east_asia', 'middleeast', 'africa']);

const STRUCTURAL_ROOT_CODES = new Set(['13', '14', '15', '16', '17', '18', '19', '20']);
const STRUCTURAL_EVENT_CODES = new Set(['155', '181', '1831', '1832', '1833']);

// Spatial / aviation / maritime keyword lists removed — domain classification now handled by Google News RSS feeds.
// GDELT focuses on: military / conflict / terrorism / protest (non-English sources, CAMEO codes, multi-source confirmation).

const MILITARY_KEYWORDS = [
  'missile', 'ballistic', 'cruise missile', 'shelling', 'artillery',
  'troop movement', 'troop buildup', 'troop build-up', 'redeploy', 'redeployment',
  'mobilization', 'mobilisation', 'incursion', 'cross-border', 'staging area',
  'military drill', 'live-fire', 'war game', 'brigade', 'battalion', 'militia',
  'army', 'armed forces', 'military', 'navy', 'air force', 'air defense',
  'surface-to-air', 'sam', 'radar', 'airbase', 'base commander', 'sortie',
  'munitions', 'arms shipment', 'weapons transfer', 'defense ministry',
  'ministry of defence', 'general staff', 'special forces', 'paratrooper',
  'border guard', 'rocket force', 'naval task force', 'fleet command',
  'deployment', 'deployed', 'forward deployed', 'combat readiness', 'battle group',
  'carrier strike group', 'destroyer squadron', 'frigate squadron', 'air-defence',
  'air defence', 'combat drone', 'fighter squadron', 'naval exercise', 'joint exercise',
  'field exercise', 'warships', 'warship', 'submarine patrol', 'marines',
];

const CIVILIAN_NOISE_KEYWORDS = [
  'taxi', 'uber', 'bus', 'rail', 'train', 'student', 'teacher', 'hospital',
  'doctor', 'farmers', 'football', 'basketball', 'concert', 'festival',
  'celebrity', 'tourism', 'real estate',
  // Extended civilian noise
  'sushi', 'burger', 'cafe', 'café', 'restaurant reopens', 'shop reopens',
  'gems to discover', 'missed shop', 'food guide', 'recipe',
  'hospice', 'palliative', 'oncology', 'obstetric', 'maternity ward',
  'nursing home', 'elderly care', 'care for elderly', 'care for the elderly',
  'retirement home', 'care home', 'old age home', 'senior center', 'senior centre',
  'geriatric', 'old people home', 'home for elderly', 'home for the elderly',
  'social welfare', 'welfare center', 'charity opens', 'free clinic', 'free hospital',
  'celebrity divorce', 'celebrity couple', 'pop star', 'singer arrested',
  'weather forecast', 'flood warning', 'earthquake damage',
  // Labor / union disputes (not military)
  'workers strike', 'labor dispute', 'labour dispute', 'union strike', 'wage dispute',
  'workers demand', 'dockworkers', 'longshoremen', 'transport strike', 'healthcare strike',
  'teachers strike', 'nurses strike', 'workers protest wages', 'union negotiation',
  'industrial action', 'collective bargaining', 'work stoppage',
  // Local crime / police blotter (not conflict)
  'robbery', 'burglary', 'theft', 'shoplifting', 'carjacking',
  'drive-by shooting', 'gang shooting', 'gang related', 'gang activity',
  'workplace violence', 'school shooting', 'office shooting',
  'drug bust', 'drug trafficking arrest', 'drug seizure',
  // Civil accidents
  'industrial accident', 'construction accident', 'workplace accident',
  'factory fire', 'factory incident', 'assembly line', 'mine collapse',
  // Hotel / hospitality incidents
  'hotel', 'motel', 'inn', 'lodge', 'hostel', 'airbnb',
  // Multilingual civilian noise
  'acidente', 'veiculos', 'tombado', // PT: car accident
  'khospisc', 'khosp', 'vrachei', 'bolnitsa', // RU: medical
  'rozwod', 'slub', 'wesele', // PL: divorce/wedding
  'ristorante', 'cucina', 'ricetta', // IT
  'receta', 'cocina', 'boda', // ES
  'murder', 'homicide', 'killed wife', 'killed husband', 'couple arrested',
  'domestic violence', 'family dispute', 'child abuse', 'parents murdered',
  'femicide', 'kidnapped child', 'serial killer', 'body found', 'cadaver',
];

const DEESCALATION_KEYWORDS = [
  'ceasefire', 'truce', 'peace talks', 'negotiation', 'negotiations', 'mediation', 'agreement',
];

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
  'maternity', 'hospital', 'obstetric', 'nursing home', 'elderly care',
  'retirement home', 'care home', 'old age home', 'geriatric', 'social welfare',
  'car accident', 'road accident',
  'plane crash', 'train derail', 'building collapse', 'flood kills',
  'storm kills', 'weather kills', 'quiz politics', 'columnist', 'op-ed',
  'opinion column', 'celeb', 'radaronline',
  // Extended — local incidents & lifestyle
  'burger king', 'fast food fire', 'sushi shop', 'japanese gems', 'wine bar',
  'shop reopens', 'café reopens', 'reopens plus', 'gems to discover',
  'hospice care', 'deficit ukhoda', 'khospisc',
  'celebrity singer', 'celebrity chef', 'pop singer', 'reality show',
  'fire burger', 'local fire', 'house fire', 'apartment fire',
  // Multilingual
  'acidente entre', 'carro tombado', 'veiculos deixa', // PT accident
  'defitcit ukhoda', 'ne khvataet vrachei', // RU hospice
  'prokuror zaprosila', 'byvshego muzha', // RU celebrity trial
  'sone shop', 'index id news sc', // garbage URL titles
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

// GDELT uses FIPS 10-4 codes which differ from ISO 3166-1 alpha-2
const GDELT_FIPS_TO_ISO = {
  'UP': 'UA', 'RS': 'RU', 'EI': 'IE', 'WE': 'PS', 'IZ': 'IQ',
  'IS': 'IL', 'CH': 'CN', 'KS': 'KR', 'KN': 'KP', 'SU': 'SD',
  'YM': 'YE', 'VM': 'VN', 'LE': 'LB', 'GM': 'DE', 'UK': 'GB',
  'SP': 'ES', 'PO': 'PT', 'AU': 'AT', 'AS': 'AU', 'SW': 'SE',
  'DA': 'DK', 'IC': 'IS', 'EN': 'EE', 'LG': 'LV', 'LH': 'LT',
  'AJ': 'AZ', 'GG': 'GE', 'MO': 'MA', 'TU': 'TR', 'EZ': 'CZ',
  'SN': 'SG', 'RI': 'RS', // Serbia ISO code
};

const LOW_QUALITY_NEWS_DOMAINS = new Set([
  'dailytrib.com', 'amren.com', 'bearingarms.com', 'nydailynews.com',
  'inquirer.com', 'ksl.com', 'norfolkdailynews.com', 'patch.com',
  'winnipegfreepress.com', 'radaronline.com', 'zazoom.it', 'inewsgr.com',
]);

const HARD_REJECT_DOMAINS = new Set([
  'zazoom.it', 'inewsgr.com',
]);

const DOMESTIC_SECURITY_KEYWORDS = [
  'faa', 'sheriff', 'county', 'police department', 'police chief',
  'state trooper', 'highway patrol', 'district attorney', 'court filing',
  'organized crime', 'gang unit', 'local police', 'border patrol',
  'county jail', 'public safety', 'police commissioner', 'municipal corporation',
  'city council', 'district court', 'lokayukta', 'demolition drive',
];

const LOCAL_ADMIN_NOISE_KEYWORDS = [
  'drug abuse', 'atm machine stolen', 'demolitions', 'illegal terrace',
  'contracts irregularities', 'public works contract', 'municipal tender',
  'urban development authority', 'police station', 'district administration',
  'civic body', 'encroachment drive', 'property dispute',
  'cordon and search operation', 'local murder case', 'couple arrested', 'civil dispute',
  'near san antonio', 'parents of a woman', 'otra forma de morir',
];

const CIVIL_CRIME_NOISE_KEYWORDS = [
  'murder', 'double murder', 'homicide', 'femicide', 'domestic violence',
  'couple arrested', 'parents of a woman', 'body in closet', 'family murder',
  'serial killer', 'stabbed to death', 'shot dead in home', 'civil crime',
  'san antonio', 'otra forma de morir', 'murder of parents',
];

const GLOBAL_SECURITY_OVERRIDE = [
  'pentagon', 'nato', 'iran', 'israel', 'russia', 'ukraine', 'china',
  'taiwan', 'north korea', 'south china sea', 'red sea', 'hormuz',
  'military', 'navy', 'air force', 'missile', 'warship', 'fighter jet',
  'drone', 'spacecraft', 'satellite',
];

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
  // Additional non-English priority sources (translation feed)
  'mil.ru': 70, 'iz.ru': 60, 'kommersant.ru': 60, 'vedomosti.ru': 55, 'rbc.ru': 55,
  'fontanka.ru': 55, 'meduza.io': 55, 'novayagazeta.ru': 55,
  'people.com.cn': 65, 'pla.cn': 70, 'mod.gov.cn': 70, 'guancha.cn': 60,
  'mil.news.sina.com.cn': 65, 'thepaper.cn': 55, 'huanqiu.com': 60,
  'chosun.com': 55, 'joongang.co.kr': 55, 'koreatimes.co.kr': 55,
  'asahi.com': 55, 'yomiuri.co.jp': 55, 'nikkei.com': 55, 'nhk.or.jp': 60,
  'iranintl.com': 60, 'aa.com.tr': 55, 'ahvalnews.com': 55,
  'rferl.org': 60, 'kavkazr.com': 55, 'currenttime.tv': 55,
  'kyivindependent.com': 60, 'ukrinform.ua': 60, 'pravda.com.ua': 55,
};

const URL_NAV_SEGMENTS = new Set([
  'view', 'news', 'article', 'articles', 'read', 'story', 'stories', 'post', 'posts',
  'page', 'pages', 'detail', 'details', 'content', 'index', 'home', 'default',
  'category', 'categories', 'tag', 'tags', 'search', 'author', 'authors',
  'section', 'topic', 'topics', 'latest', 'breaking', 'world', 'politics',
  'national', 'local', 'international', 'sports', 'business', 'technology',
  'opinion', 'editorial', 'comment', 'comments', 'html', 'htm', 'php', 'aspx', 'jsp',
  'en', 'fr', 'ru', 'zh', 'ar', 'ko', 'ja', 'de', 'es', 'pt', 'tr', 'fa', 'he',
  // Generic nav/update segments that produce meaningless titles
  'update', 'updates', 'brief', 'briefing', 'briefings',
  'report', 'reports', 'coverage', 'headline', 'headlines',
  'alert', 'alerts', 'notice', 'notices', 'bulletin',
  'summary', 'recap', 'roundup', 'digest',
  'live', 'video', 'photo', 'photos', 'gallery',
  'explainer', 'analysis', 'feature', 'features',
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

function containsAnyPhrase(text, phrases) {
  const normalized = normalizeText(text);
  return phrases.some(phrase => normalized.includes(normalizeText(phrase)));
}

function matchedPhrases(text, phrases) {
  const normalized = normalizeText(text);
  return phrases.filter(phrase => normalized.includes(normalizeText(phrase)));
}

function safeDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const keepParams = ['id', 'article', 'story', 'news', 'p', 'pid'];
    const next = new URL(parsed.origin + parsed.pathname);
    for (const key of keepParams) {
      if (parsed.searchParams.has(key)) next.searchParams.set(key, parsed.searchParams.get(key));
    }
    return next.toString().replace(/\/$/, '');
  } catch {
    return String(url || '').trim();
  }
}

function normalizeTitleForDedup(title) {
  return normalizeText(title)
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/\b[a-f0-9]{8,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function storyFamilyKey(event) {
  const normalized = normalizeTitleForDedup(event.title || event.headline || '');
  const importantTerms = normalized
    .split(' ')
    .filter(token => token.length >= 4)
    .filter(token => ![
      'after', 'before', 'first', 'images', 'historic', 'historical', 'mission',
      'returns', 'return', 'earth', 'safely', 'crew', 'capsule', 'lunar',
      'around', 'travel', 'journey', 'where', 'does', 'from', 'with',
    ].includes(token))
    .slice(0, 6);

  if (!importantTerms.length) return null;
  return [
    event.domain_bucket || 'general',
    event.countryCode || 'UNK',
    importantTerms.join('|'),
  ].join('|');
}

function editorialDedupKey(event) {
  const hour = String(event.dateAdded || event.batchTs || '').slice(0, 10);
  return [
    event.countryCode || 'UNK',
    event.domain || 'nodomain',
    hour,
    normalizeTitleForDedup(event.title || event.headline || ''),
  ].join('|');
}

function isDomesticSecurityNoise(text, event) {
  const country = String(event?.countryCode || '');
  const domain = String(event?.domain || '');
  const domesticGeo = country === 'US' || country === 'CA' || domain.endsWith('.us');
  if (!domesticGeo) return false;
  if (!containsAnyKeyword(text, DOMESTIC_SECURITY_KEYWORDS)) return false;
  if (containsAnyKeyword(text, GLOBAL_SECURITY_OVERRIDE)) return false;
  return true;
}

function isLocalAdministrativeNoise(textBlob) {
  if (containsAnyKeyword(textBlob, GLOBAL_SECURITY_OVERRIDE)) return false;
  if (containsAnyKeyword(textBlob, MILITARY_KEYWORDS)) return false;
  return containsAnyKeyword(textBlob, LOCAL_ADMIN_NOISE_KEYWORDS);
}

function isCivilCrimeNoise(textBlob) {
  if (containsAnyKeyword(textBlob, GLOBAL_SECURITY_OVERRIDE)) return false;
  if (containsAnyKeyword(textBlob, MILITARY_KEYWORDS)) return false;
  return containsAnyKeyword(textBlob, CIVIL_CRIME_NOISE_KEYWORDS);
}

/**
 * Normalise the GDELT FIPS 10-4 country code to ISO 3166-1 alpha-2.
 * GDELT uses FIPS codes (UP=Ukraine, RS=Russia, IS=Israel…) not ISO,
 * which causes wrong region assignment. This is a pure code remap —
 * geolocation (lat/lon/location string) is never changed.
 */
function correctCountryCode(rawCode) {
  const fips = String(rawCode || '').toUpperCase();
  return { countryCode: GDELT_FIPS_TO_ISO[fips] || fips, geoSuspect: false };
}

function titleFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const hasNativeScript = (value) => /[\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\u0600-\u06ff\u0400-\u04ff]/.test(value);

    // Query params : native script en priorité absolue
    for (const [, rawParam] of u.searchParams.entries()) {
      const candidate = decodeHtmlEntities(decodeURIComponent(String(rawParam || '')))
        .replace(/[+_]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (hasNativeScript(candidate) && candidate.length >= 4) return candidate;
    }

    const segments = u.pathname.split('/').filter(Boolean);
    const candidates = [];

    for (const seg of segments) {
      const raw = decodeHtmlEntities(decodeURIComponent(seg))
        .replace(/\.[a-z0-9]{2,6}$/i, '')   // extension
        .replace(/[-_+%]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(\s+\d+)+\s*$/, '')         // trailing numeric IDs
        .replace(/^\s*\d+\s+/, '')             // leading numeric IDs (ex: "956431 clanok" → "clanok")
        .trim();

      if (!raw) continue;
      if (/^\d+$/.test(raw)) continue;                               // purement numérique
      if (/^[0-9a-f]{16,64}$/i.test(raw.replace(/ /g, ''))) continue; // hash hex
      if (URL_NAV_SEGMENTS.has(raw.toLowerCase())) continue;          // segment de navigation

      const words     = raw.split(/\s+/).filter(Boolean);
      const alphaWords = words.filter(w => /[a-z]{2,}/i.test(w));

      if (alphaWords.length === 0) continue;
      // Un seul mot générique (rubrique, type d'article) → skip
      if (alphaWords.length === 1 && raw.length < 12) continue;

      // Score : nombre de mots alpha × longueur totale
      // Bonus si script non-latin, pénalité si tous les mots sont des nav-segments
      const allGeneric = alphaWords.every(w =>
        URL_NAV_SEGMENTS.has(w.toLowerCase()) ||
        /^(world|local|global|middle|east|west|north|south|cross|strait|politics|business|technology|defense|opinion|commentary|analysis|life|travel|culture)$/i.test(w)
      );
      if (allGeneric) continue;

      let score = alphaWords.length * raw.length;
      if (hasNativeScript(raw)) score += 500;

      candidates.push({ raw, score });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0].raw;

    if (hasNativeScript(best) && best.length >= 4) return best;
    if (best.length >= 15 || (/[a-zA-Z]{3,}/.test(best) && best.includes(' '))) return best;
  } catch {}
  return null;
}

function getSubEventType(eventCode) {
  if (!eventCode) return 'Unknown';
  return CAMEO_SUBTYPE[eventCode] || CAMEO_SUBTYPE[eventCode.slice(0, 3)] || CAMEO_SUBTYPE[eventCode.slice(0, 2)] || 'Unknown';
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
  return (
    (containsAnyKeyword(text, CIVILIAN_OVERRIDE) || containsAnyKeyword(text, CIVILIAN_NOISE_KEYWORDS)) &&
    !containsAnyKeyword(text, SECURITY_OVERRIDE_KEYWORDS) &&
    !containsAnyKeyword(text, MILITARY_KEYWORDS)
  );
}

function isNoiseEvent(title, url, domain) {
  if (NOISE_DOMAINS.has(domain)) return true;
  return containsAnyKeyword(`${title} ${url}`, NOISE_KEYWORDS);
}

function shouldRejectLowQualityDomain(domain, flags, row) {
  if (HARD_REJECT_DOMAINS.has(domain)) return true;
  if (!LOW_QUALITY_NEWS_DOMAINS.has(domain)) return false;
  if (STRUCTURAL_EVENT_CODES.has(String(row.eventCode || ''))) return false;
  if (['18', '19', '20'].includes(String(row.rootCode || '')) && Number(row.goldstein || 0) <= -5) return false;
  return true;
}

function buildTextBlob(title, actor1, actor2, url, themes = [], organizations = [], persons = []) {
  return [title, actor1, actor2, url, themes.join(' '), organizations.join(' '), persons.join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildSignalTextBlob(title, actor1, actor2, themes = [], organizations = [], persons = []) {
  return [title, actor1, actor2, themes.join(' '), organizations.join(' '), persons.join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildFlags(textBlob) {
  return {
    military_keyword_flag: containsAnyKeyword(textBlob, MILITARY_KEYWORDS) ? 1 : 0,
    civilian_noise_flag: isCivilianNoise(textBlob) ? 1 : 0,
    deescalation_flag: containsAnyKeyword(textBlob, DEESCALATION_KEYWORDS) ? 1 : 0,
    // Legacy domain flags kept as 0 to avoid breaking downstream references
    spatial_flag: 0, aviation_flag: 0, maritime_flag: 0,
    spatial_anchor_flag: 0, aviation_anchor_flag: 0, maritime_anchor_flag: 0,
    spatial_eligible: false, aviation_eligible: false, maritime_eligible: false,
    spatial_exclusion_flag: 0, aviation_exclusion_flag: 0, maritime_exclusion_flag: 0,
    spatial_support_flag: 0, aviation_support_flag: 0, maritime_support_flag: 0,
    spatial_pattern_flag: 0, aviation_pattern_flag: 0, maritime_pattern_flag: 0,
  };
}

function militaryContextBoost(themes, organizations, persons, textBlob) {
  let score = 0;
  const joinedThemes = (themes || []).join(' ');
  const joinedOrgs = (organizations || []).join(' ');
  if (/MILITARY|ARMED|MISSILE|NUCLEAR|TERROR|WAR|DEFENCE|DEFENSE|NAVAL|AVIATION|AIR_FORCE|AIRFORCE/i.test(joinedThemes)) score += 16;
  if (/ministry of defence|ministry of defense|defense ministry|defence ministry|armed forces|air force|navy|army|revolutionary guard|idf|pentagon|nato/i.test(normalizeText(joinedOrgs))) score += 14;
  if (/general|admiral|colonel|brigadier|commander/i.test(normalizeText((persons || []).join(' ')))) score += 6;
  if (containsAnyKeyword(textBlob, ['exercise', 'drill', 'deployment', 'munition', 'ordnance', 'airbase', 'warship', 'fighter'])) score += 8;
  return score;
}

function classifyEvent(text, eventCode = '', rootCode = '', flags = {}) {
  const normalized = normalizeText(text);
  // Civilian noise check first
  if (flags.civilian_noise_flag && !flags.military_keyword_flag) return 'discard';
  if (String(eventCode || '').startsWith('155')) return 'cyber';
  if (['181', '1831', '1832', '1833'].some(prefix => String(eventCode || '').startsWith(prefix))) return 'terrorism';
  if (['18', '19', '20'].includes(String(rootCode || ''))) {
    if (flags.military_keyword_flag || /\b(attack|airstrike|strike|missile|drone|troops|forces|army|navy|militia|rebels|offensive|shelling|artillery|deployment|deployed|warship|submarine)\b/.test(normalized)) {
      return 'conflict';
    }
    // No independent military signal → GDELT CAMEO code is unreliable here, discard
    return 'discard';
  }
  if (String(rootCode || '') === '15') return 'military';
  if (String(rootCode || '') === '14') return 'protest';
  // Keyword-based classification
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(keyword => normalized.includes(normalizeText(keyword)))) return rule.key;
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.cameo.some(prefix => String(eventCode || '').startsWith(prefix))) return rule.key;
  }
  if (['13', '16', '17'].includes(String(rootCode || ''))) {
    if (flags.military_keyword_flag || /\b(sanction|nuclear|ballistic|hypersonic|missile|border|diplomatic|naval|warship|drone|satellite|space)\b/.test(normalized)) {
      return 'strategic';
    }
    // No security signal → discard routine diplomacy/coercion
    return 'discard';
  }
  return 'discard';
}

function structuralSeverityScore(rootCode, eventCode) {
  if (STRUCTURAL_EVENT_CODES.has(String(eventCode || ''))) return 44;
  if (['18', '19', '20'].includes(String(rootCode || ''))) return 38;
  if (String(rootCode || '') === '15') return 34;
  if (String(rootCode || '') === '14') return 20;
  if (['13', '16', '17'].includes(String(rootCode || ''))) return 24;
  return 10;
}

function freshnessScore(dateAdded) {
  const iso = isoFromGdeltTimestamp(dateAdded);
  if (!iso) return 0;
  const ageHours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000);
  return Math.max(0, 16 - Math.min(16, ageHours * 1.0));
}

function geoPrecisionScore(actionGeoType) {
  const value = String(actionGeoType || '');
  if (value === '4') return 12;
  if (value === '3') return 8;
  if (value === '2') return 4;
  if (value === '1') return 1;
  return 0;
}

function mediaVisibilityScore(row, mention) {
  const sourceScore = Math.min(12, Math.log1p(Number(row.numSources || 0)) * 4);
  const articleScore = Math.min(12, Math.log1p(Number(row.numArticles || 0)) * 4);
  const mentionScore = Math.min(14, Math.log1p(Number(mention?.mentionCount || row.numMentions || 0)) * 5);
  return sourceScore + articleScore + mentionScore;
}

function domainBonus(flags) {
  let score = 0;
  if (flags.military_keyword_flag) score += 12;
  return score;
}

function scoreEvent(row, mention, tone, domain, flags, region) {
  let score = 0;
  score += structuralSeverityScore(row.rootCode, row.eventCode);
  score += Math.min(24, Math.abs(Number(tone) || 0) * 4);
  score += mediaVisibilityScore(row, mention);
  score += freshnessScore(row.dateAdded);
  score += geoPrecisionScore(row.actionGeoType);
  score += domainBonus(flags);
  if (domain && PRIORITY_DOMAIN_BOOST[domain]) score += Math.min(20, PRIORITY_DOMAIN_BOOST[domain] / 3);
  if (STRATEGIC_COUNTRY_CODES.has(row.countryCode || '')) score += 18;
  if (STRATEGIC_REGION_BOOST.has(region)) score += 8;
  if (flags.civilian_noise_flag) score -= 45;
  if (flags.deescalation_flag) score -= 20;
  return Math.round(score);
}

function shouldKeepEvent(row, flags, isStructural = false) {
  const rootCode = String(row.rootCode || '');
  const eventCode = String(row.eventCode || '');
  const sources = Number(row.numSources || 0);

  // Terrorism / cyber event codes → always keep
  if (STRUCTURAL_EVENT_CODES.has(eventCode)) return true;

  // Civilian noise with no military signal → always reject
  if (flags.civilian_noise_flag && !flags.military_keyword_flag) return false;

  // Military keyword confirmed → keep (positive signal approach)
  if (flags.military_keyword_flag) return true;

  // Without military keyword: CAMEO conflict root code alone is not enough — GDELT often
  // misclassifies civilian articles (hotel incidents, labor disputes, local crime) as rootCode 18.
  // Require very high source count (5+) as a proxy for genuine armed conflict coverage.
  if (!STRUCTURAL_ROOT_CODES.has(rootCode)) return false;
  if (['18', '19', '20'].includes(rootCode) && sources >= 5) return true; // armed conflict, high-confidence
  if (['14', '15'].includes(rootCode) && sources >= 5) return true;       // protest / force display
  if (['13', '16', '17'].includes(rootCode) && sources >= 6) return true; // threaten / coerce / sanction

  return false;
}

function domainBucketFromFlags(_flags) {
  return 'general';
}

function isStrategicEvent(row, score) {
  const rootCode = String(row.rootCode || '');
  const eventCode = String(row.eventCode || '');
  const goldstein = Number(row.goldstein || 0);
  const s = Number(score || 0);

  // Terrorism / cyber / WMD — always strategic
  if (STRUCTURAL_EVENT_CODES.has(eventCode)) return true;

  // Active armed conflict with significant impact (tightened from -7 to -8)
  if (['18', '19', '20'].includes(rootCode) && goldstein <= -8) return true;

  // Extreme negativity regardless of event type (tightened from -9 to -9.5)
  if (goldstein <= -9.5) return true;

  // Very high score AND known hotspot country (raised from 115 to 130)
  if (s >= 130 && STRATEGIC_COUNTRY_CODES.has(String(row.countryCode || ''))) return true;

  // Extreme score regardless of country (raised from 135 to 150)
  if (s >= 150) return true;

  return false;
}

function buildDedupKey(row) {
  const hour = String(row.dateAdded || '').slice(0, 10);
  const lat = Number.isFinite(row.lat) ? Number(row.lat).toFixed(2) : 'na';
  const lon = Number.isFinite(row.lon) ? Number(row.lon).toFixed(2) : 'na';
  const actor1 = normalizeText(row.actor1 || '').slice(0, 80);
  const actor2 = normalizeText(row.actor2 || '').slice(0, 80);
  return [
    row.countryCode || 'UNK',
    row.rootCode || '00',
    hour,
    lat,
    lon,
    actor1 || '-',
    actor2 || '-',
  ].join('|');
}

function isRelevantEvent(event) {
  if (!event || event.category === 'discard') return false;
  if (!event.keep) return false;
  const score = Number(event.score || 0);

  // ── Minimum source count: GDELT's strength is multi-source confirmation ──
  // Single-source events are likely noise that Google News RSS handles better
  const sources = Number(event.numSources || 0);
  const isMultiSource = sources >= 2;
  const isHighSource = sources >= 4;

  // Strategic events or strong domain hits bypass source check
  const hasDomainAnchor = event.spatial_anchor_flag || event.aviation_anchor_flag || event.maritime_anchor_flag;
  if (!isMultiSource && !event.is_strategic && !hasDomainAnchor && score < MIN_RELEVANCE_SCORE + 20) return false;

  if (score >= MIN_RELEVANCE_SCORE) return true;
  // Specialized buckets: only relax threshold if truly eligible (anchor/pattern confirmed)
  if (event.domain_bucket !== 'general') {
    const eligible = event.spatial_eligible || event.aviation_eligible || event.maritime_eligible;
    const hasAnchor = event.spatial_anchor_flag || event.aviation_anchor_flag || event.maritime_anchor_flag;
    if (eligible && hasAnchor && score >= MIN_RELEVANCE_SCORE - 10) return true;
    if (eligible && score >= MIN_RELEVANCE_SCORE - 5) return true;
    return false;
  }
  // Military with strong keyword evidence AND multi-source
  if (event.category === 'military' && event.military_keyword_flag && isMultiSource && score >= MIN_RELEVANCE_SCORE - 8) return true;
  // Strategic: only relax if genuinely strategic
  if (event.is_strategic && score >= MIN_RELEVANCE_SCORE - 8) return true;
  if (event.category === 'conflict' && isMultiSource && score >= MIN_RELEVANCE_SCORE - 6) return true;
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

function getRegionKey(lat, lon, countryCode) {
  if (countryCode === 'FR') return 'france';
  if (lat > 34 && lat < 72 && lon > -25 && lon < 45) {
    if (['RS', 'UP', 'AM', 'AJ', 'GG', 'KG', 'KZ', 'MD'].includes(countryCode)) return 'russia_cis';
    return 'europe';
  }
  if (lat > 12 && lat < 43 && lon > 25 && lon < 65) return 'middleeast';
  if (lat > -12 && lat < 55 && lon > 95 && lon < 150) return 'east_asia';
  if (lat > 0 && lat < 40 && lon > 60 && lon < 95) return 'south_asia';
  if (lat > -35 && lat < 38 && lon > -20 && lon < 55) return 'africa';
  if (lat > -60 && lat < 15 && lon > -90 && lon < -30) return 'south_america';
  if (lat > 15 && lon > -170 && lon < -50) return 'north_america';
  if (lat < -10 && lon > 110 && lon < 180) return 'oceania';
  if (countryCode === 'CH' || countryCode === 'KN' || countryCode === 'KS' || countryCode === 'TW' || countryCode === 'VM') return 'east_asia';
  if (countryCode === 'AF' || countryCode === 'PK' || countryCode === 'IN' || countryCode === 'BD') return 'south_asia';
  if (countryCode === 'BR' || countryCode === 'AR' || countryCode === 'CL' || countryCode === 'CO' || countryCode === 'PE' || countryCode === 'VE') return 'south_america';
  return 'other';
}

function parseEventRows(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 61) continue;
    const lat = Number(cols[56]);
    const lon = Number(cols[57]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const sourceUrl = cols[60] || '';
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
      actionGeoType: cols[51] || '',
      location: cols[52] || '',
      countryCode: cols[53] || '',
      lat,
      lon,
      dateAdded: cols[59] || '',
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
    const rootCode = String(row.rootCode || '');
    const eventCode = String(row.eventCode || '');
    const isStructural = STRUCTURAL_ROOT_CODES.has(rootCode) || STRUCTURAL_EVENT_CODES.has(eventCode);

    const mention = mentionMap.get(row.globalEventId) || null;
    const candidateUrl = mention?.bestIdentifier || row.sourceUrl;
    const gkg = gkgMap.get(candidateUrl) || gkgMap.get(row.sourceUrl) || null;
    const domain = safeDomainFromUrl(candidateUrl || row.sourceUrl);
    const title = pageTitleFromExtras(gkg?.extras) || titleFromUrl(candidateUrl || row.sourceUrl);
    if (!title) continue;

    if (isNoiseEvent(title, candidateUrl || row.sourceUrl, domain)) continue;

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

    const textBlob = buildTextBlob(title, row.actor1, row.actor2, candidateUrl || row.sourceUrl, themes, organizations, persons);
    const signalTextBlob = buildSignalTextBlob(title, row.actor1, row.actor2, themes, organizations, persons);
    const flags = buildFlags(signalTextBlob);
    if (!shouldKeepEvent(row, flags, isStructural)) continue;
    if (shouldRejectLowQualityDomain(domain, flags, row)) continue;
    if (isDomesticSecurityNoise(signalTextBlob, { countryCode: row.countryCode, domain })) continue;
    if (isLocalAdministrativeNoise(signalTextBlob)) continue;
    if (isCivilCrimeNoise(signalTextBlob)) continue;

    const category = classifyEvent(text, row.eventCode, row.rootCode, flags);
    if (category === 'discard') continue;

    const tone = Number.isFinite(row.goldstein) ? row.goldstein : (toneFromV2Tone(gkg?.v2Tone) ?? row.avgTone ?? 0);
    const { countryCode: correctedCode } = correctCountryCode(row.countryCode);
    const region = getRegionKey(row.lat, row.lon, correctedCode);
    let score = scoreEvent(row, mention, tone, domain, flags, region);
    if (themes.some(theme => /MILITARY|ARMED|TERROR|CYBER|NUCLEAR|MISSILE|SPACE|AVIATION|MARITIME/i.test(theme))) score += 12;
    score += militaryContextBoost(themes, organizations, persons, signalTextBlob);
    const domain_bucket = domainBucketFromFlags(flags);
    const is_strategic = isStrategicEvent(row, score) ? 1 : 0;
    const dedup_key = buildDedupKey(row);
    const canonical_url = canonicalUrl(candidateUrl || row.sourceUrl);

    // Build diagnostic reject reason
    let rejectReason = null;
    if (flags.civilian_noise_flag && !flags.military_keyword_flag) rejectReason = 'civilian_noise_no_military_context';

    const event = {
      id: row.globalEventId,
      title,
      originalTitle: title,
      nativeTitle: title,
      url: candidateUrl || row.sourceUrl,
      canonical_url,
      domain,
      date: row.date,
      dateAdded: row.dateAdded,
      country: row.location || '',
      countryCode: correctedCode,
      lat: row.lat,
      lon: row.lon,
      tone,
      color: getColor(tone),
      severity: getSeverityLabel(tone),
      score,
      bq_signal_score: score,
      category,
      region,
      domain_bucket,
      osintDomain: null,
      is_strategic,
      dedup_key,
      editorial_dedup_key: [
        row.countryCode || 'UNK',
        domain || 'nodomain',
        String(row.dateAdded || '').slice(0, 10),
        normalizeTitleForDedup(title),
      ].join('|'),
      keep: true,
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
      text_blob: signalTextBlob,
      military_keyword_flag: flags.military_keyword_flag,
      civilian_noise_flag: flags.civilian_noise_flag,
      deescalation_flag: flags.deescalation_flag,
      rejectReason,
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
  const minTs = cutoffTimestamp(SNAPSHOT_LOOKBACK_HOURS);
  const candidates = [...(existingSnapshot || []), ...(freshEvents || [])]
    .filter(event => String(event.dateAdded || event.batchTs || '').localeCompare(minTs) >= 0)
    .sort((a, b) =>
      Number(b.score || 0) - Number(a.score || 0) ||
      Number(b.numSources || 0) - Number(a.numSources || 0) ||
      Number(b.numArticles || 0) - Number(a.numArticles || 0) ||
      Number(b.mentionCount || 0) - Number(a.mentionCount || 0)
    );

  const dedupKeys = new Set();
  const urlKeys = new Set();
  const editorialKeys = new Set();
  const storyFamilyKeys = new Set();
  const kept = [];

  for (const event of candidates) {
    const dedupKey = event.dedup_key || `id:${event.id}`;
    const urlKey = event.canonical_url || canonicalUrl(event.url || '');
    const editorialKey = event.editorial_dedup_key || editorialDedupKey(event);
    const familyKey = storyFamilyKey(event);
    if (dedupKeys.has(dedupKey) || (urlKey && urlKeys.has(urlKey)) || editorialKeys.has(editorialKey) || (familyKey && storyFamilyKeys.has(familyKey))) continue;
    dedupKeys.add(dedupKey);
    if (urlKey) urlKeys.add(urlKey);
    editorialKeys.add(editorialKey);
    if (familyKey) storyFamilyKeys.add(familyKey);
    kept.push(event);
  }

  return kept;
}

function selectDiverseEvents(events) {
  const sorted = [...events].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const byBucket = new Map();
  for (const event of sorted) {
    const bucket = event.domain_bucket || 'general';
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(event);
  }

  const selected = [];
  const seen = new Set();
  const storyFamilies = new Set();
  const pushFromList = (list, limit, predicate = null) => {
    if (!Array.isArray(list) || limit <= 0) return;
    let added = 0;
    for (const event of list) {
      if (HARD_REJECT_DOMAINS.has(String(event.domain || '')) && event.domain_bucket === 'general') continue;
      const key = event.dedup_key || event.url || `id:${event.id}`;
      const familyKey = storyFamilyKey(event);
      if (seen.has(key)) continue;
      if (familyKey && storyFamilies.has(familyKey)) continue;
      if (predicate && !predicate(event)) continue;
      seen.add(key);
      if (familyKey) storyFamilies.add(familyKey);
      selected.push(event);
      added += 1;
      if (selected.length >= FINAL_EVENTS || added >= limit) return;
    }
  };

  // First: fill strategic events, then backfill with everything else sorted by score
  pushFromList(byBucket.get('general') || [], Math.min(STRATEGIC_MIN_EVENTS, FINAL_EVENTS), event => Boolean(event.is_strategic));

  for (const event of sorted) {
    if (HARD_REJECT_DOMAINS.has(String(event.domain || '')) && event.domain_bucket === 'general') continue;
    const key = event.dedup_key || event.url || `id:${event.id}`;
    const familyKey = storyFamilyKey(event);
    if (seen.has(key)) continue;
    if (familyKey && storyFamilies.has(familyKey)) continue;
    seen.add(key);
    if (familyKey) storyFamilies.add(familyKey);
    selected.push(event);
    if (selected.length >= FINAL_EVENTS) break;
  }

  return selected.slice(0, Math.min(FINAL_EVENTS, MAX_DASHBOARD_EVENTS));
}

function topEntries(map, limit = 8) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function logCalibration(snapshot, selected) {
  const regionCounts = new Map();
  const categoryCounts = new Map();
  const countryCounts = new Map();
  const domainCounts = new Map();
  const bucketCounts = new Map();
  let strategicCount = 0;

  for (const event of selected) {
    const region = event.region || 'other';
    regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
    categoryCounts.set(event.category || 'incident', (categoryCounts.get(event.category || 'incident') || 0) + 1);
    if (event.countryCode) countryCounts.set(event.countryCode, (countryCounts.get(event.countryCode) || 0) + 1);
    if (event.domain) domainCounts.set(event.domain, (domainCounts.get(event.domain) || 0) + 1);
    bucketCounts.set(event.domain_bucket || 'general', (bucketCounts.get(event.domain_bucket || 'general') || 0) + 1);
    if (event.is_strategic) strategicCount += 1;
  }

  const topPreview = selected
    .slice(0, 12)
    .map(event => `[${event.region || 'other'}|${event.category}|${Math.round(event.score || 0)}] ${(event.title || '').slice(0, 90)}`)
    .join('\n');

  console.log(`[gdelt-cal] snapshot=${snapshot.length} selected=${selected.length}`);
  console.log(`[gdelt-cal] regions  ${topEntries(regionCounts, 12)}`);
  console.log(`[gdelt-cal] cats     ${topEntries(categoryCounts, 12)}`);
  console.log(`[gdelt-cal] buckets  ${topEntries(bucketCounts, 8)} strategic=${strategicCount}`);
  console.log(`[gdelt-cal] countries ${topEntries(countryCounts, 12)}`);
  console.log(`[gdelt-cal] domains  ${topEntries(domainCounts, 10)}`);
  console.log(`[gdelt-cal] top\n${topPreview}`);
}

let _gkgOutage = false; // true when GDELT GKG is consistently unavailable this run

async function downloadZipTextOptional(url, retries = 2, delayMs = 10000) {
  // If GKG was already missing for a previous batch this run, skip retries immediately
  if (_gkgOutage) {
    try {
      return await downloadZipText(url);
    } catch {
      return '';
    }
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await downloadZipText(url);
      _gkgOutage = false; // recovered
      return result;
    } catch (err) {
      const is404 = err.message.includes('HTTP 404');
      if (attempt < retries && is404) {
        console.warn(`[gdelt-files] GKG not yet available (attempt ${attempt}/${retries}), retrying in ${delayMs / 1000}s — ${url}`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.warn(`[gdelt-files] GKG unavailable after ${attempt} attempt(s), proceeding without it — ${err.message}`);
        _gkgOutage = true; // skip retries for remaining batches this run
        return '';
      }
    }
  }
  return '';
}

async function processBatch(batch) {
  console.log(`[gdelt-files] batch ${batch.ts} — download events/mentions/gkg`);
  // events + mentions are mandatory; gkg is optional (themes/tone enrichment only)
  const [eventsText, mentionsText, gkgText] = await Promise.all([
    downloadZipText(batch.events),
    downloadZipText(batch.mentions),
    downloadZipTextOptional(batch.gkg),
  ]);
  const eventRows = parseEventRows(eventsText);
  const mentionMap = parseMentions(mentionsText);
  const gkgMap = parseGkg(gkgText);
  const events = buildEventsForBatch(batch, eventRows, mentionMap, gkgMap);
  console.log(`[gdelt-files] batch ${batch.ts} — ${eventRows.length} raw events, ${events.length} kept`);
  return events;
}

async function fetchTranslationMasterFileList() {
  const resp = await fetch(MASTERFILELIST_TRANSLATION_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'text/plain' },
  });
  if (!resp.ok) throw new Error(`masterfilelist-translation HTTP ${resp.status}`);
  return resp.text();
}

async function fetchTodayEvents(options = {}) {
  const forceReprocess = Boolean(options.forceReprocess);
  const state = loadState();

  // Fetch English and translation masterlists in parallel
  const [masterText, translationText] = await Promise.all([
    fetchMasterFileList(),
    INCLUDE_TRANSLATION ? fetchTranslationMasterFileList().catch(err => {
      console.warn('[gdelt-files] translation masterlist failed:', err.message);
      return '';
    }) : Promise.resolve(''),
  ]);

  const grouped = groupEntries(masterText);
  const groupedTranslation = INCLUDE_TRANSLATION ? groupEntries(translationText) : [];

  const pending = forceReprocess
    ? grouped.slice(-Math.max(BOOTSTRAP_WINDOWS, MAX_WINDOWS_PER_RUN))
    : state.lastBatchTs
    ? grouped.filter(batch => batch.ts > state.lastBatchTs)
    : grouped.slice(-BOOTSTRAP_WINDOWS);

  const pendingTranslation = forceReprocess
    ? groupedTranslation.slice(-Math.max(BOOTSTRAP_WINDOWS, MAX_WINDOWS_PER_RUN))
    : state.lastBatchTsTranslation
    ? groupedTranslation.filter(batch => batch.ts > state.lastBatchTsTranslation)
    : groupedTranslation.slice(-BOOTSTRAP_WINDOWS);

  const toProcess = pending.slice(0, MAX_WINDOWS_PER_RUN);
  const toProcessTranslation = pendingTranslation.slice(0, MAX_WINDOWS_PER_RUN);

  if (!toProcess.length && !toProcessTranslation.length) {
    console.log(`[gdelt-files] no new batches — returning snapshot ${state.snapshot?.length || 0}`);
    const selected = selectDiverseEvents(state.snapshot || []);
    logCalibration(state.snapshot || [], selected);
    const filtered = await filterEventsWithAI(selected);
    const normalized = await normalizeEvents(filtered);
    return normalized;
  }

  const firstTs = toProcess[0]?.ts || toProcessTranslation[0]?.ts;
  const lastTs = toProcess[toProcess.length - 1]?.ts || toProcessTranslation[toProcessTranslation.length - 1]?.ts;
  console.log(`[gdelt-files] processing EN=${toProcess.length} TR=${toProcessTranslation.length} batch(es) from ${firstTs} to ${lastTs}`);

  _gkgOutage = false; // reset per-run GKG outage flag
  let snapshot = forceReprocess ? [] : (state.snapshot || []);

  // Process English batches
  for (const batch of toProcess) {
    try {
      const fresh = await processBatch(batch);
      snapshot = mergeSnapshot(snapshot, fresh);
      state.lastBatchTs = batch.ts;
    } catch (err) {
      console.warn(`[gdelt-files] English batch ${batch.ts} failed (skipping):`, err.message);
    }
  }

  // Process translation batches (non-English sources: RU, ZH, AR, KO, JA, FA, etc.)
  for (const batch of toProcessTranslation) {
    try {
      const fresh = await processBatch(batch);
      console.log(`[gdelt-files] translation batch ${batch.ts} — ${fresh.length} events`);
      snapshot = mergeSnapshot(snapshot, fresh);
      state.lastBatchTsTranslation = batch.ts;
    } catch (err) {
      console.warn(`[gdelt-files] translation batch ${batch.ts} failed:`, err.message);
    }
  }

  // keep fake compatibility — advance state even if only translation ran (no-op, state already set above)

  state.snapshot = snapshot;
  state.lastUpdate = new Date().toISOString();
  saveState(state);
  console.log(`[gdelt-files] snapshot ready — ${snapshot.length} events`);
  const selected = selectDiverseEvents(snapshot);
  logCalibration(snapshot, selected);
  const filtered = await filterEventsWithAI(selected);
  const normalized = await normalizeEvents(filtered);
  return normalized;
}

function isCameoFallbackTitle(title) {
  if (!title) return false;
  return String(title).toLowerCase().startsWith('use conventional military force');
}

function purgeSnapshot(cacheDir) {
  const statePath = path.join(cacheDir || CACHE_DIR, 'gdelt-file-state.json');
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const before = (state.snapshot || []).length;
    state.snapshot = (state.snapshot || []).filter(e => !isCameoFallbackTitle(e.title));
    const removed = before - state.snapshot.length;
    fs.writeFileSync(statePath, JSON.stringify(state));
    console.log(`[purge-snapshot] removed ${removed} CAMEO fallback titles from snapshot (${state.snapshot.length} remain)`);
    return { removed, remaining: state.snapshot.length };
  } catch (err) {
    console.warn('[purge-snapshot] failed:', err.message);
    return { removed: 0, remaining: 0, error: err.message };
  }
}

module.exports = { fetchTodayEvents, isCameoFallbackTitle, purgeSnapshot };
