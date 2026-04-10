'use strict';

const { BigQuery } = require('@google-cloud/bigquery');

// ── Table CAMEO EventCode → subEventType ──────────────────────────────────
const CAMEO_SUBTYPE = {
  '130':'Threaten','131':'Threaten with non-force','132':'Threaten with administrative sanctions',
  '133':'Threaten with political exclusion','134':'Threaten with military force',
  '135':'Threaten with arrest','136':'Threaten with repression','137':'Threaten with sanctions',
  '138':'Threaten with embargo or expulsion','139':'Threaten with military attack',
  '140':'Engage in political dissent','141':'Demonstrate or rally','142':'Conduct hunger strike',
  '143':'Conduct strike or boycott','144':'Obstruct or block','145':'Protest violently, riot',
  '150':'Demonstrate military or police power','151':'Increase police alert status',
  '152':'Increase military alert status','153':'Mobilize or increase police power',
  '154':'Mobilize or increase armed forces','155':'Mobilize cyber forces',
  '160':'Reduce relations','161':'Reduce or break diplomatic relations',
  '162':'Accuse','163':'Halt negotiations','164':'Halt mediation',
  '165':'Expel or recall ambassadors','170':'Coerce','171':'Seize or damage property',
  '172':'Arrest, detain, or charge','173':'Expel or deport individuals',
  '174':'Impose administrative sanctions','175':'Impose political restrictions',
  '176':'Impose curfew','180':'Use conventional military force',
  '181':'Abduct, hijack, or take hostage','182':'Physically assault',
  '1821':'Sexually assault','1822':'Torture','1823':'Kill by physical assault',
  '183':'Conduct bombing','1831':'Carry out suicide bombing','1832':'Carry out car bombing',
  '1833':'Carry out IED attack','184':'Use conventional weapons',
  '185':'Employ aerial weapons','186':'Violate ceasefire',
  '190':'Fight','191':'Impose blockade, restrict movement','192':'Occupy territory',
  '193':'Fight with small arms and light weapons','194':'Fight with artillery and tanks',
  '195':'Employ aerial weapons','196':'Violate ceasefire',
  '200':'Engage in mass violence','201':'Engage in mass expulsion',
  '202':'Engage in mass killings','2021':'Commit atrocities',
  '203':'Engage in ethnic cleansing','204':'Use weapons of mass destruction',
};

function getSubEventType(eventCode) {
  if (!eventCode) return 'Unknown';
  if (CAMEO_SUBTYPE[eventCode]) return CAMEO_SUBTYPE[eventCode];
  if (eventCode.length > 3 && CAMEO_SUBTYPE[eventCode.slice(0, 3)]) return CAMEO_SUBTYPE[eventCode.slice(0, 3)];
  if (eventCode.length > 2 && CAMEO_SUBTYPE[eventCode.slice(0, 2)]) return CAMEO_SUBTYPE[eventCode.slice(0, 2)];
  return 'Unknown';
}

// ── Bruit à exclure ───────────────────────────────────────────────────────
const NOISE_KEYWORDS = [
  'photo review', 'american dream', 'expo', 'conexpo', 'fashion', 'celebrity',
  'movie', 'film', 'music', 'festival', 'sports', 'match', 'football', 'soccer',
  'nba', 'nfl', 'baseball', 'cricket', 'concert', 'award', 'red carpet',
  'tv show', 'podcast', 'entertainment', 'gallery', 'photos', 'photo gallery',
  'weekend', 'lifestyle', 'recipe', 'restaurant', 'horoscope', 'tourism', 'travel',
  'stock', 'market', 'earnings', 'real estate', 'deal', 'shopping', 'review',
  'ipo', 'startup', 'funding round', 'quarterly results', 'revenue',
  'investment strategy', 'investing', 'shares', 'shareholders', 'analyst forecast',
  'samsung', 'semiconductor', 'semiconductors', 'memory chips', 'ai chips',
  'chip demand', 'artificial intelligence demand',
  'acciones', 'bolsa', 'inversion', 'inversión', 'resultados', 'beneficio',
  'crece', 'crecimiento', 'esperado', 'demanda', 'chips de memoria',
  'inteligencia artificial',
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
  'health tips', 'weight loss', 'diet', 'fitness', 'wellness',
  'birth', 'delivery', 'delivered', 'triplets', 'twins', 'pregnant',
  'pregnancy', 'mother', 'mothers', 'maternity', 'obstetric', 'high risk mother',
  'high-risk mother', '\uc774\ub300\ubaa9\ub3d9\ubcd1\uc6d0', '\ubcd1\uc6d0',
  '\uc138\uc30d\ub465\uc774', '\ucd9c\uc0b0', '\uc0b0\ubaa8', '\uace0\uc704\ud5d8',
  'stroller', 'baby killed', 'child killed in shooting', 'teen shot',
  'man shot', 'woman shot', 'killed in shooting', 'shooting in brooklyn',
  'shooting in chicago', 'shooting in los angeles', 'shooting in philadelphia',
  'drive by', 'drive-by', 'gang shooting', 'neighborhood shooting',
  'stabbing', 'carjacking', 'robbery', 'burglar', 'domestic violence',
  'drunk driver', 'hit and run', 'car accident', 'road accident', 'plane crash',
  'train derail', 'building collapse', 'fire kills', 'earthquake kills',
  'flood kills', 'storm kills', 'weather kills'
];

const NOISE_DOMAINS = new Set([
  'espn.com', 'bleacherreport.com', 'nba.com', 'nfl.com', 'mlb.com',
  'tmz.com', 'people.com', 'eonline.com', 'variety.com', 'hollywoodreporter.com',
  'buzzfeed.com', 'buzzfeednews.com', 'foodnetwork.com', 'allrecipes.com',
  'techcrunch.com', 'engadget.com', 'theverge.com', 'wired.com',
  'marketwatch.com', 'investopedia.com', 'fool.com',
  'estrategiasdeinversion.com'
]);

// ── Boost de score pour les sources étatiques stratégiques ─────────────────
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

// RS=Russie, CH=Chine, KN=Corée du Nord, KS=Corée du Sud, TW=Taiwan,
// VM=Vietnam, AF=Afghanistan, PK=Pakistan, IR=Iran, IZ=Iraq,
// SY=Syrie, UP=Ukraine, LY=Libye, YM=Yémen, SU=Soudan
const STRATEGIC_COUNTRY_CODES = new Set([
  'RS', 'CH', 'KN', 'KS', 'TW', 'VM',
  'IR', 'SY', 'UP', 'IZ', 'AF', 'PK',
  'LY', 'YM', 'SU',
]);
const MAX_DASHBOARD_EVENTS = Number(process.env.GDELT_MAX_EVENTS || 1500);
const STRATEGIC_MIN_EVENTS = Number(process.env.GDELT_STRATEGIC_MIN || 300);
const MIN_RELEVANCE_SCORE  = Number(process.env.GDELT_MIN_SCORE || 60);

// ── Domain-aware minimums — garantit la représentation des domaines rares ─────
// Ces slots sont réservés en priorité dans selectDiverseEvents.
// Ils ne gonflent pas le total : ils s'imputent sur MAX_DASHBOARD_EVENTS.
const DOMAIN_MIN_SPATIAL  = Number(process.env.GDELT_SPATIAL_MIN  || 70);
const DOMAIN_MIN_AVIATION = Number(process.env.GDELT_AVIATION_MIN || 150);
const DOMAIN_MIN_MARITIME = Number(process.env.GDELT_MARITIME_MIN || 180);

// Détection de domaine sur le texte brut GDELT (avant enrichissement IA)
// Volontairement large : on veut des faux positifs plutôt que des manques.
const DOMAIN_KEYWORDS_SPATIAL = [
  // Satellites & anti-satellite
  'satellite', 'orbital', 'asat', 'anti-satellite',
  'spy satellite', 'reconnaissance satellite', 'military satellite', 'classified payload',
  // Commandements spatiaux
  'space force', 'space command', 'space domain', 'space weapon', 'space laser',
  // Lancements & rentrées
  'launch vehicle', 'space launch', 'orbital launch', 'rocket test',
  'reentry', 're-entry', 'deorbit',
  'spaceplane', 'x-37', 'fractional orbital', 'fobs',
  // Stratégique / missiles balistiques intercontinentaux
  'icbm', 'intercontinental ballistic', 'hypersonic glide', 'hypersonic missile',
  'missile defense', 'missile defence', 'ballistic missile submarine',
  // Brouillage GPS/GNSS
  'gps jamming', 'gps spoofing', 'gnss jamming', 'gnss spoofing',
  // Débris & surveillance spatiale
  'space debris', 'space junk', 'space surveillance', 'space situational awareness',
  // Cosmodromes / bases de lancement
  'cosmodrome', 'baikonur', 'plesetsk', 'vostochny',
  'cape canaveral', 'vandenberg', 'jiuquan', 'xichang', 'wenchang',
  'sriharikota', 'tanegashima', 'semnan',
  // Constellations & orbites
  'starlink', 'oneweb', 'kuiper', 'leo constellation',
  'geostationary', 'geosynchronous', 'low earth orbit',
  'sun-synchronous', 'polar orbit',
  // Programmes spatiaux
  'space race', 'moon mission', 'lunar mission', 'mars mission',
  'space station', 'tiangong', 'artemis',
  // Agences spatiales
  'nasa', 'esa ', 'roscosmos', 'isro', 'jaxa', 'cnsa', 'kari',
  'cnes', 'dlr ', 'uksa',
  // Entreprises spatiales
  'spacex', 'blue origin', 'arianespace', 'rocket lab', 'relativity space',
  'united launch alliance', 'northrop grumman', 'boeing starliner',
  // Sites spécialisés (domaines connus)
  'spacenews.com', 'spacedaily.com', 'nasaspaceflight.com', 'spaceflightnow.com',
  'space.com', 'thespacereview.com',
];

const DOMAIN_KEYWORDS_AVIATION = [
  'airstrike', 'air strike', 'fighter jet', 'warplane', 'air force', 'airbase', 'air base',
  'scrambled', 'intercept', 'intercepted', 'drone', 'uav', 'unmanned aerial',
  'shaheed', 'shahed', 'bayraktar', 'no-fly zone', 'notam', 'airspace', 'air defense',
  'shot down', 'downed', 'air patrol', 'surveillance flight', 'reconnaissance aircraft',
  's-400', 'patriot missile', 'iron dome', 'bomber', 'b-52', 'f-16', 'f-35', 'su-35',
  'tu-160', 'air wing', 'squadron', 'sortie', 'overflight',
  // ── Ajouts : vocabulaire aviation élargi ──
  'ucav', 'combat drone', 'kamikaze drone', 'loitering munition',
  'awacs', 'early warning', 'tanker aircraft', 'aerial refueling', 'air-to-air',
  'air-to-ground', 'ground attack', 'close air support', 'cas',
  'adiz', 'air defense identification zone', 'flight restriction',
  'air superiority', 'dogfight', 'aerial combat',
  'stealth', 'stealth bomber', 'stealth fighter', 'b-2', 'b-21',
  'su-57', 'j-20', 'j-35', 'eurofighter', 'typhoon', 'rafale', 'gripen',
  'mig-29', 'mig-31', 'su-30', 'su-34', 'a-10', 'warthog',
  'helicopter gunship', 'attack helicopter', 'apache', 'ka-52',
  'predator', 'reaper', 'global hawk', 'triton', 'heron', 'hermes',
  'air corridor', 'flight path', 'transponder off', 'squawk',
  'anti-aircraft', 'manpad', 'sam site', 'surface-to-air',
  'air campaign', 'carpet bombing', 'precision strike', 'guided bomb',
  'cruise missile', 'tomahawk', 'kalibr', 'storm shadow', 'scalp',
  'air drop', 'paratrooper', 'airborne', 'paratroop',
  'military helicopter', 'chinook', 'blackhawk', 'osprey', 'mi-24', 'mi-28',
];

const DOMAIN_KEYWORDS_MARITIME = [
  'naval', 'warship', 'destroyer', 'frigate', 'submarine', 'aircraft carrier', 'fleet',
  'task force', 'coast guard', 'strait', 'chokepoint', 'exclusive economic zone', 'eez',
  'south china sea', 'taiwan strait', 'hormuz', 'suez', 'red sea', 'black sea',
  'blockade', 'maritime patrol', 'boarding', 'ship-to-ship', 'port visit', 'naval exercise',
  // ── Ajouts : vocabulaire maritime élargi ──
  'corvette', 'cruiser', 'amphibious', 'landing ship', 'dock landing',
  'minesweeper', 'minelayer', 'patrol boat', 'missile boat', 'fast attack craft',
  'littoral combat', 'aegis', 'carrier strike group', 'carrier group',
  'battle group', 'flotilla', 'armada',
  'anti-submarine warfare', 'asw', 'sonar', 'torpedo', 'depth charge',
  'sea lane', 'shipping lane', 'sealift', 'maritime security',
  'piracy', 'pirate', 'hijack ship', 'seized vessel', 'boarded vessel',
  'freedom of navigation', 'fonop', 'innocent passage',
  'naval blockade', 'maritime interdiction', 'embargo',
  'persian gulf', 'gulf of aden', 'bab el-mandeb', 'malacca',
  'baltic sea', 'barents sea', 'arctic sea', 'east china sea',
  'sea of japan', 'philippine sea', 'arabian sea', 'mediterranean',
  'uss ', 'hms ', 'ins ', 'rfs ', 'cns ',
  'naval base', 'port call', 'homeport', 'dry dock',
  'ssbn', 'ssn', 'nuclear submarine', 'diesel submarine',
  'anti-ship missile', 'harpoon', 'exocet', 'brahmos',
  'unmanned surface vessel', 'usv', 'unmanned underwater', 'uuv',
  'naval aviation', 'carrier-based', 'catapult launch',
];

// Sites qui contiennent "space" dans le nom mais ne sont PAS des sites spatiaux
const SPATIAL_DOMAIN_BLACKLIST = ['spacewar.com', 'myspace.com', 'airspacemag.com'];

function detectEventDomain(event) {
  const text = `${event.title || ''} ${event.url || ''} ${event.actor1 || ''} ${event.actor2 || ''} ${event.subEventType || ''}`.toLowerCase();
  const url = (event.url || '').toLowerCase();
  const isSpatialBlacklisted = SPATIAL_DOMAIN_BLACKLIST.some(d => url.includes(d));
  if (!isSpatialBlacklisted && DOMAIN_KEYWORDS_SPATIAL.some(k => text.includes(k))) return 'spatial';
  if (DOMAIN_KEYWORDS_AVIATION.some(k => text.includes(k))) return 'aviation';
  if (DOMAIN_KEYWORDS_MARITIME.some(k => text.includes(k))) return 'maritime';
  return null;
}

const CATEGORY_QUOTAS = {
  conflict:   300,
  military:   270,
  terrorism:  120,
  strategic:  200,
  crisis:     170,
  cyber:       90,
};

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

const CATEGORY_RULES = [
  {
    key: 'terrorism',
    cameo: ['181','1831','1832','1833'],
    keywords: ['terrorist', 'terrorism', 'isis', 'islamic state', 'al qaeda',
               'al-qaeda', 'boko haram', 'suicide bombing', 'ied', 'car bomb',
               'hostage', 'mass hostage', 'beheaded']
  },
  {
    key: 'cyber',
    cameo: ['155'],
    keywords: ['cyberattack', 'cyber attack', 'cybersecurity', 'ransomware',
               'hacked', 'hackers', 'malware', 'ddos', 'electronic warfare',
               'cyber forces', 'data breach', 'critical infrastructure']
  },
  {
    key: 'protest',
    cameo: ['14'],
    keywords: ['protest', 'riot', 'demonstration', 'unrest', 'march', 'rally',
               'uprising', 'civil unrest', 'dissent', 'blockade', 'occupy',
               'walkout', 'stormed', 'clashed with police', 'strike', 'boycott']
  },
  {
    key: 'strategic',
    cameo: ['13','16','17'],
    keywords: ['sanction', 'arms embargo', 'nuclear', 'ballistic missile',
               'hypersonic', 'wmd', 'weapons of mass destruction', 'naval incident',
               'border tension', 'military standoff', 'diplomatic rupture',
               'break relations', 'asset freeze', 'strategic']
  },
  {
    key: 'conflict',
    cameo: ['18','19','20'],
    keywords: ['clashes', 'fighting', 'battle', 'combat', 'frontline',
               'war', 'rebels', 'insurgent', 'militia', 'armed group',
               'civil war', 'offensive', 'counteroffensive', 'siege']
  },
  {
    key: 'military',
    cameo: ['15','180','184','185','186','190','193','194','195','196','204'],
    keywords: ['airstrike', 'air strike', 'missile', 'artillery', 'shelling',
               'bombardment', 'warplane', 'fighter jet', 'military aircraft',
               'tank', 'drone strike', 'armed forces', 'military operation',
               'military exercise', 'troops', 'mobilization', 'navy', 'naval',
               'submarine', 'warship', 'military base', 'air force base']
  },
  {
    key: 'crisis',
    cameo: ['13','16','17'],
    keywords: ['sanction', 'expel', 'expelled', 'detained', 'arrested', 'crisis',
               'emergency', 'martial law', 'evacuation', 'displaced', 'refugee',
               'state of emergency', 'crackdown', 'deported', 'ultimatum',
               'threatened', 'warning', 'diplomatic', 'tension', 'border']
  },
  {
    key: 'incident',
    cameo: [],
    keywords: ['security incident', 'incident', 'police operation', 'checkpoint']
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────
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
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function containsAnyKeyword(text, keywords) {
  const decoded = decodeHtmlEntities(text).toLowerCase();
  const normalized = normalizeText(decoded);
  return keywords.some(k => decoded.includes(decodeHtmlEntities(k).toLowerCase()) || normalized.includes(normalizeText(k)));
}

const SECURITY_OVERRIDE_KEYWORDS = [
  'attack', 'airstrike', 'strike', 'missile', 'drone', 'military', 'war',
  'terror', 'bomb', 'explosion', 'hostage', 'raid', 'shelling', 'cyberattack',
  'ransomware', 'hack', 'sanction', 'border', 'coup', 'riot', 'protest',
  '\uacf5\uaca9', '\ud14c\ub7ec', '\ud3ed\ubc1c', '\uc804\uc7c1', '\ubbf8\uc0ac\uc77c',
];

function isCivilianNoise(text) {
  return containsAnyKeyword(text, CIVILIAN_OVERRIDE) && !containsAnyKeyword(text, SECURITY_OVERRIDE_KEYWORDS);
}

// Segments URL qui ne sont pas des titres (navigation, catégories, IDs courts)
const URL_NAV_SEGMENTS = new Set([
  'view','news','article','articles','read','story','stories','post','posts',
  'page','pages','detail','details','content','index','home','default',
  'category','categories','tag','tags','search','author','authors',
  'section','topic','topics','latest','breaking','world','politics',
  'national','local','international','sports','business','technology',
  'opinion','editorial','comment','comments','html','htm','php','aspx','jsp',
  'en','fr','ru','zh','ar','ko','ja','de','es','pt','tr','fa','he',
]);

function titleFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const hasNativeScript = (value) =>
      /[\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\u0600-\u06ff\u0400-\u04ff]/.test(value);

    // 1) Certains sites injectent le titre natif dans les query params (?title=...).
    // On le récupère avant de parser les segments de path.
    for (const [, rawParam] of u.searchParams.entries()) {
      const candidate = decodeHtmlEntities(decodeURIComponent(String(rawParam || '')))
        .replace(/[+_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!candidate) continue;
      if (hasNativeScript(candidate) && candidate.length >= 4) return candidate;
    }

    const segments = u.pathname.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const raw = decodeHtmlEntities(decodeURIComponent(segments[i]))
        .replace(/\.[a-z0-9]{2,6}$/i, '')
        .replace(/[-_+%]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!raw) continue;
      if (/^\d+$/.test(raw)) continue;                          // ID numérique pur
      if (URL_NAV_SEGMENTS.has(raw.toLowerCase())) continue;    // segment navigation

      // Accepte : caractères CJK / Hangul / Kana / Arabe / Cyrillique
      // Même si court (<10), car les titres natifs peuvent être compacts.
      if (hasNativeScript(raw) && raw.length >= 4) return raw;

      if (raw.length < 10) continue;
      // Accepte : titre latin avec au moins 2 mots OU assez long
      if (/[a-zA-Z]{3,}/.test(raw) && (raw.includes(' ') || raw.length >= 20)) return raw;
    }
    return null;
  } catch {
    return null;
  }
}

// Construit un titre lisible depuis les métadonnées GDELT quand l'URL n'en contient pas
function buildFallbackTitle(row) {
  const parts = [];
  const sub = getSubEventType(row.event_code || row.root_code || '');
  if (sub && sub !== 'Unknown') parts.push(sub);
  const a1 = (row.actor1 || '').trim();
  if (a1 && a1.length < 50) parts.push(a1);
  const loc = (row.location || '').trim();
  if (loc && loc.length < 80) parts.push(loc);
  return parts.join(' — ') || 'Unknown Event';
}

function safeDomainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

// Termes civils qui invalident une classification MILITARY (même si CAMEO le suggère)
const CIVILIAN_OVERRIDE = [
  // Médical / santé
  'clinical trial', 'phase i', 'phase ii', 'phase iii', 'clinical study',
  'drug trial', 'patient', 'vaccine', 'antibody', 'immunotherapy',
  'cancer', 'tumor', 'oncology', 'therapy', 'treatment', 'hospital',
  'biotech', 'pharmaceutical', 'fda', 'ema', 'approval', 'dosing',
  'birth', 'delivery', 'delivered', 'triplets', 'twins', 'pregnant',
  'pregnancy', 'mother', 'mothers', 'maternity', 'obstetric', 'high risk mother',
  'high-risk mother', '\uc774\ub300\ubaa9\ub3d9\ubcd1\uc6d0', '\ubcd1\uc6d0',
  '\uc138\uc30d\ub465\uc774', '\ucd9c\uc0b0', '\uc0b0\ubaa8', '\uace0\uc704\ud5d8',
  // Politique / élections
  'election', 'vote', 'ballot', 'parliament', 'legislation', 'law passed',
  // Économie / finance / transport civil
  'economic growth', 'gdp', 'inflation', 'interest rate', 'trade deal',
  'fuel surcharge', 'surcharge', 'airline', 'airfare', 'ticket price',
  'stock market', 'share price', 'earnings', 'revenue', 'profit', 'loss',
  'trade war tariff', 'import duty', 'export ban', 'supply chain',
  'oil price', 'gas price', 'energy cost', 'subsidy',
  'samsung', 'semiconductor', 'semiconductors', 'memory chips', 'chip demand',
  'artificial intelligence demand', 'acciones', 'bolsa', 'inversion',
  'inversión', 'resultados', 'beneficio', 'crece', 'crecimiento',
  'esperado', 'demanda', 'chips de memoria', 'inteligencia artificial',
  // Catastrophes naturelles
  'earthquake', 'flood', 'hurricane', 'wildfire', 'disaster relief', 'tsunami',
  // Accidents / faits divers
  'accident', 'crash', 'collision', 'car accident', 'road accident',
  'plane crash', 'train derail', 'building collapse',
  // Sport / culture
  'sports', 'tournament', 'championship', 'olympic', 'soccer', 'football',
  'concert', 'festival', 'movie', 'film',
];

// Keywords militaires confirmant qu'un événement à code CAMEO militaire est réellement militaire
function classifyEvent(text, eventCode = '') {
  const normalized = normalizeText(text);
  const normalizedCode = String(eventCode || '');

  // Si le texte contient des termes clairement civils → ne pas l'envoyer en faux positif sécurité.
  const isCivilian = isCivilianNoise(text);
  if (isCivilian) return 'discard';

  // Les mots du titre/article priment sur CAMEO: GDELT mappe souvent des articles
  // civils ou policiers vers des racines "force" trop larges.
  for (const cat of CATEGORY_RULES) {
    if (cat.keywords.some(k => normalized.includes(normalizeText(k)))) {
      return cat.key;
    }
  }

  for (const cat of CATEGORY_RULES) {
    if (cat.cameo && cat.cameo.some(c => normalizedCode.startsWith(c))) {
      return cat.key;
    }
  }

  return 'incident';
}

function scoreEvent(text, tone, domain) {
  let score = Math.abs(Number(tone) || 0) * 10;
  const normalized = normalizeText(text);
  for (const kw of MILITARY_CRISIS_KEYWORDS) {
    if (normalized.includes(normalizeText(kw))) score += 20;
  }
  const bonuses = {
    missile: 25, war: 25, attack: 22, airstrike: 24, bombing: 24,
    terrorist: 24, military: 20, drone: 20, strike: 20, hostage: 20,
    protest: 18, riot: 18, explosion: 18, troops: 16, crisis: 15, incident: 12,
    cyberattack: 24, ransomware: 20, sanctions: 16, nuclear: 25, clashes: 18
  };
  for (const [word, bonus] of Object.entries(bonuses)) {
    if (normalized.includes(word)) score += bonus;
  }
  if (domain && PRIORITY_DOMAIN_BOOST[domain]) {
    score += PRIORITY_DOMAIN_BOOST[domain];
  }
  return score;
}

function isRelevantEvent(event) {
  if (!event || event.category === 'discard') return false;

  const score = Number(event.score || 0);
  if (score >= MIN_RELEVANCE_SCORE) return true;

  // Les catégories rares mais utiles doivent passer avec un score un peu plus bas,
  // sinon le flux redevient une simple liste de combats très médiatisés.
  if (['cyber', 'strategic', 'protest'].includes(event.category) && score >= MIN_RELEVANCE_SCORE - 20) {
    return true;
  }

  // On tolère les sources stratégiques connues quand la région et le code CAMEO
  // indiquent un signal de sécurité, même si le titre non latin score mal.
  if (STRATEGIC_COUNTRY_CODES.has(event.countryCode) && PRIORITY_DOMAIN_BOOST[event.domain] && score >= MIN_RELEVANCE_SCORE - 25) {
    return true;
  }

  return false;
}

function isNoiseEvent(title, url, domain) {
  if (NOISE_DOMAINS.has(domain)) return true;
  const text = `${title} ${url}`;
  return containsAnyKeyword(text, NOISE_KEYWORDS);
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

// ── BigQuery client (singleton) ───────────────────────────────────────────
let _bqClient = null;

function getBigQueryClient() {
  if (_bqClient) return _bqClient;

  const credJson   = process.env.GOOGLE_CREDENTIALS_JSON;
  const projectId  = process.env.BIGQUERY_PROJECT_ID;

  if (credJson) {
    let credentials;
    try {
      credentials = JSON.parse(credJson);
    } catch (err) {
      throw new Error(`[gdelt-bq] GOOGLE_CREDENTIALS_JSON is not valid JSON: ${err.message}`);
    }
    _bqClient = new BigQuery({
      projectId: credentials.project_id || projectId,
      credentials,
    });
    return _bqClient;
  }

  if (!projectId) {
    throw new Error(
      '[gdelt-bq] Missing BigQuery configuration. ' +
      'Set GOOGLE_CREDENTIALS_JSON (service account JSON) ' +
      'or GOOGLE_APPLICATION_CREDENTIALS + BIGQUERY_PROJECT_ID.'
    );
  }

  // Falls back to GOOGLE_APPLICATION_CREDENTIALS file path (standard GCP ADC)
  _bqClient = new BigQuery({ projectId });
  return _bqClient;
}

// ── Filtre temporel DATEADDED ─────────────────────────────────────────────
// DATEADDED est un INT64 au format YYYYMMDDHHMMSS (ex: 20260406143025).
// C'est la seule colonne GDELT avec une résolution à la seconde → fenêtre 24h exacte.
// SQLDATE est quotidien (YYYYMMDD) et ne convient pas pour une fenêtre glissante.
const DATEADDED_FILTER = (hours) =>
  `DATEADDED >= CAST(FORMAT_DATETIME('%Y%m%d%H%M%S', DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${hours} HOUR)) AS INT64)`;

// ── Couche 1 — recent_events_raw_24h ─────────────────────────────────────
// Événements individuels des dernières 24h, avec score composite BigQuery.
const RECENT_EVENTS_SQL = `
  SELECT
    CAST(e.GlobalEventID AS STRING)     AS id,
    CAST(e.SQLDATE AS STRING)           AS date,
    e.DATEADDED                         AS date_added,
    IFNULL(e.ActionGeo_FullName, '')    AS location,
    IFNULL(e.ActionGeo_CountryCode, '') AS country_code,
    IFNULL(e.Actor1Name, '')            AS actor1,
    IFNULL(e.Actor2Name, '')            AS actor2,
    IFNULL(e.EventCode, '')             AS event_code,
    IFNULL(e.EventRootCode, '')         AS root_code,
    e.QuadClass                         AS quad_class,
    e.GoldsteinScale                    AS goldstein,
    e.NumMentions                       AS num_mentions,
    e.NumSources                        AS num_sources,
    e.NumArticles                       AS num_articles,
    e.AvgTone                           AS avg_tone,
    CAST(e.ActionGeo_Type AS STRING)    AS geo_type,
    e.ActionGeo_Lat                     AS latitude,
    e.ActionGeo_Long                    AS longitude,
    e.SOURCEURL                         AS source_url,
    -- Titre réel de l'article depuis la table GKG (PAGE_TITLE dans Extras)
    REGEXP_EXTRACT(g.Extras, r'<PAGE_TITLE>([^<]{4,300})</PAGE_TITLE>') AS page_title,
    CASE
      WHEN e.EventCode = '155'                 THEN 'cyber'
      WHEN e.EventCode IN ('181','1831','1832','1833') THEN 'terrorism'
      WHEN e.EventRootCode IN ('18','19','20') THEN 'hard_events'
      WHEN e.EventRootCode = '14'             THEN 'protests'
      WHEN e.EventRootCode IN ('13','16','17') THEN 'strategic_crisis'
      ELSE 'other'
    END AS layer_type,
    -- Score composite BigQuery : sévérité + médias + bonus récence
    ROUND(
      ABS(e.GoldsteinScale) * 10
      + LN(1 + e.NumMentions)  * 3
      + LN(1 + e.NumSources)   * 5
      + LN(1 + e.NumArticles)  * 2
      + CASE
          WHEN ${DATEADDED_FILTER(2)}  THEN 20
          WHEN ${DATEADDED_FILTER(6)}  THEN 10
          ELSE 0
        END
    ) AS bq_signal_score,
    -- Clé de déduplication approximative : pays + code + heure + coordonnées arrondies
    CONCAT(
      IFNULL(e.ActionGeo_CountryCode, 'XX'), '_',
      IFNULL(e.EventRootCode, '00'), '_',
      CAST(CAST(FLOOR(e.DATEADDED / 10000) AS INT64) AS STRING), '_',
      CAST(ROUND(e.ActionGeo_Lat, 0) AS STRING), '_',
      CAST(ROUND(e.ActionGeo_Long, 0) AS STRING)
    ) AS dedup_key
  FROM \`gdelt-bq.gdeltv2.events\` e
  LEFT JOIN \`gdelt-bq.gdeltv2.gkg\` g
    ON g.DocumentIdentifier = e.SOURCEURL
    AND CAST(g.DATE AS STRING) >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)) || '000000'
  WHERE
    ${DATEADDED_FILTER(24)}
    AND e.ActionGeo_Lat  IS NOT NULL
    AND e.ActionGeo_Long IS NOT NULL
    AND e.ActionGeo_Lat  != 0
    AND e.ActionGeo_Long != 0
    AND e.SOURCEURL IS NOT NULL
    AND e.SOURCEURL != ''
    AND (
      -- Couche 1 : Violence militaire directe (combat, frappes, opérations armées)
      (e.EventRootCode IN ('18','19','20') AND e.GoldsteinScale <= -1.5)
      OR
      -- Couche 2 : Démonstrations de force, mobilisations, exercices (seuil abaissé)
      (e.EventRootCode = '15' AND e.GoldsteinScale <= -1.0)
      OR
      -- Couche 3 : Protestations violentes
      (e.EventRootCode = '14' AND e.GoldsteinScale <= -2.5)
      OR
      -- Couche 4 : Crises stratégiques (menaces, coercition, rupture diplomatique)
      (e.EventRootCode IN ('13','16','17') AND e.GoldsteinScale <= -3.0)
      OR
      -- Couche 5 : Cyber
      (e.EventCode = '155')
      OR
      -- Couche 6 : Domaines OSINT spécialisés — seuil Goldstein relâché
      -- Capture aviation, spatial, maritime même avec Goldstein modéré
      (e.GoldsteinScale <= -0.5 AND REGEXP_CONTAINS(
        LOWER(e.SOURCEURL),
        r'satellite|orbital|asat|space.force|rocket.launch|gps.jam|hypersonic|icbm|slbm|reentry|missile.test|spaceplane|space.weapon|airstrike|fighter.jet|air.force|drone|uav|intercept|airspace|air.defense|bomber|sortie|no.fly|scramble|warplane|reconnaissance|surveillance.flight|naval|warship|destroyer|frigate|submarine|aircraft.carrier|fleet|strait|blockade|maritime|coast.guard|military.exercis|troop.deploy|naval.exercis'
      ))
    )
  ORDER BY bq_signal_score DESC
  LIMIT 6000
`;

// ── Couche 2 — signal_hotspots_24h ───────────────────────────────────────
// Événements agrégés par cellule géographique (0.5°).
// Produit : event_count, severity_score, media_score, final_signal_score.
const HOTSPOTS_SQL = `
  SELECT
    ROUND(ActionGeo_Lat  * 2) / 2                          AS latitude,
    ROUND(ActionGeo_Long * 2) / 2                          AS longitude,
    ANY_VALUE(ActionGeo_FullName)                           AS location_name,
    ANY_VALUE(ActionGeo_CountryCode)                        AS country_code,
    CASE
      WHEN COUNTIF(EventCode = '155') > 0                  THEN 'cyber'
      WHEN COUNTIF(EventCode IN ('181','1831','1832','1833')) > 0 THEN 'terrorism'
      WHEN COUNTIF(EventRootCode IN ('18','19','20')) > 0  THEN 'hard_events'
      WHEN COUNTIF(EventRootCode = '14') > 0               THEN 'protests'
      ELSE 'strategic_crisis'
    END                                                     AS layer_type,
    COUNT(*)                                                AS event_count,
    SUM(NumMentions)                                        AS total_mentions,
    SUM(NumSources)                                         AS total_sources,
    SUM(NumArticles)                                        AS total_articles,
    ROUND(AVG(GoldsteinScale), 2)                          AS avg_goldstein_scale,
    ROUND(AVG(AvgTone), 2)                                 AS avg_tone,
    -- Sévérité : code le plus grave dans la cellule
    MAX(CASE EventRootCode
      WHEN '19' THEN 100
      WHEN '18' THEN 80
      WHEN '20' THEN 80
      WHEN '15' THEN 65
      WHEN '14' THEN 50
      ELSE 35
    END)                                                    AS severity_score,
    -- Score médias (log pour éviter la surreprésentation des grands médias)
    ROUND(LN(1 + SUM(NumMentions) + SUM(NumSources) * 2 + SUM(NumArticles)) * 5) AS media_score,
    -- Poids récence : 1.5 si < 2h, 1.2 si < 6h, 1.0 sinon
    MAX(CASE
      WHEN ${DATEADDED_FILTER(2)} THEN 1.5
      WHEN ${DATEADDED_FILTER(6)} THEN 1.2
      ELSE 1.0
    END)                                                    AS recency_weight,
    -- Score final plafonné à 200
    LEAST(200, ROUND(
      MAX(CASE EventRootCode
        WHEN '19' THEN 100 WHEN '18' THEN 80 WHEN '20' THEN 80 WHEN '15' THEN 65 WHEN '14' THEN 50 ELSE 35
      END)
      * MAX(CASE
          WHEN ${DATEADDED_FILTER(2)} THEN 1.5
          WHEN ${DATEADDED_FILTER(6)} THEN 1.2
          ELSE 1.0
        END)
      + LN(1 + SUM(NumMentions) + SUM(NumSources) * 2 + SUM(NumArticles)) * 5
      + COUNT(*) * 2
    ))                                                      AS final_signal_score
  FROM \`gdelt-bq.gdeltv2.events\`
  WHERE
    ${DATEADDED_FILTER(24)}
    AND ActionGeo_Lat  IS NOT NULL
    AND ActionGeo_Long IS NOT NULL
    AND ActionGeo_Lat  != 0
    AND ActionGeo_Long != 0
    AND (
      (QuadClass = 4 AND EventRootCode IN ('18','19','20') AND GoldsteinScale <= -1.0)
      OR
      (EventRootCode = '14' AND GoldsteinScale <= -3.0)
      OR
      (EventRootCode = '15' AND GoldsteinScale <= -1.0)
      OR
      (QuadClass = 3 AND EventRootCode IN ('13','16','17') AND GoldsteinScale <= -4.0)
      OR
      (EventCode = '155')
      OR
      -- Domaines OSINT spécialisés dans les hotspots
      (GoldsteinScale <= -0.5 AND REGEXP_CONTAINS(
        LOWER(SOURCEURL),
        r'satellite|orbital|asat|space|rocket|gps|hypersonic|icbm|airstrike|fighter|air.force|drone|uav|intercept|airspace|bomber|naval|warship|destroyer|frigate|submarine|carrier|fleet|strait|blockade|maritime'
      ))
    )
  GROUP BY latitude, longitude
  HAVING event_count > 1 OR severity_score >= 80
  ORDER BY final_signal_score DESC
  LIMIT 500
`;

// ── Requête A — analyse/calibrage ─────────────────────────────────────────
// Distribution réelle des événements GDELT 24h, filtrage large.
// Sert à comprendre la répartition par catégorie, domaine, pays et score.
// N'alimente PAS le pipeline opérationnel.
const ANALYSIS_SQL = `
  SELECT
    CASE
      WHEN EventCode = '155'                              THEN 'cyber'
      WHEN EventCode IN ('181','1831','1832','1833')      THEN 'terrorism'
      WHEN EventRootCode IN ('18','19','20')              THEN 'conflict'
      WHEN EventRootCode = '15'                           THEN 'military'
      WHEN EventRootCode = '14'                           THEN 'protest'
      WHEN EventRootCode IN ('13','16','17')              THEN 'strategic'
      ELSE 'other'
    END                                                    AS category,
    ActionGeo_CountryCode                                  AS country_code,
    EventRootCode                                          AS root_code,
    COUNT(*)                                               AS event_count,
    ROUND(AVG(GoldsteinScale), 2)                         AS avg_goldstein,
    ROUND(AVG(AvgTone), 2)                                AS avg_tone,
    SUM(NumMentions)                                       AS total_mentions,
    SUM(NumSources)                                        AS total_sources,
    SUM(NumArticles)                                       AS total_articles,
    ROUND(AVG(
      ABS(GoldsteinScale) * 10
      + LN(1 + NumMentions) * 3
      + LN(1 + NumSources) * 5
      + LN(1 + NumArticles) * 2
    ), 1)                                                  AS avg_score
  FROM \`gdelt-bq.gdeltv2.events\`
  WHERE
    ${DATEADDED_FILTER(24)}
    AND ActionGeo_Lat  IS NOT NULL
    AND ActionGeo_Long IS NOT NULL
    AND GoldsteinScale < 0
    AND (
      EventRootCode IN ('13','14','15','16','17','18','19','20')
      OR EventCode = '155'
    )
  GROUP BY category, country_code, root_code
  ORDER BY event_count DESC
  LIMIT 1000
`;

// ── Index hotspot depuis les résultats BigQuery (signal_hotspots_24h) ────
// Construit une Map lat/lon → hotspot à partir des lignes agrégées.
function buildHotspotIndex(hotspotRows) {
  const index = new Map();
  for (const h of hotspotRows) {
    const key = `${h.latitude},${h.longitude}`;
    index.set(key, h);
  }
  return index;
}

function getHotspotBoost(lat, lon, hotspotIndex) {
  const key = `${Math.round(lat * 2) / 2},${Math.round(lon * 2) / 2}`;
  const h = hotspotIndex.get(key);
  if (!h) return 0;

  // Bonus plafonné à 55 : cluster dense + zone sévère
  const clusterBonus  = Math.min(40, Number(h.event_count || 0) * 2);
  const severityBonus = Number(h.severity_score || 0) >= 80 ? 15
                      : Number(h.severity_score || 0) >= 50 ? 8 : 0;
  return clusterBonus + severityBonus;
}

// ── Map one BigQuery row → existing event schema ──────────────────────────
function selectDiverseEvents(events) {
  const sorted = [...events].sort((a, b) => b.score - a.score);
  const selected = [];
  const seen = new Set();

  function take(list, limit) {
    for (const event of list) {
      if (selected.length >= MAX_DASHBOARD_EVENTS || limit <= 0) break;
      if (seen.has(event.id)) continue;
      selected.push(event);
      seen.add(event.id);
      limit--;
    }
  }

  // ── Étape 1 : réserver les slots domaines rares en priorité ───────────────
  // Ordre : spatial (le plus rare) → aviation → maritime.
  // Sans cette étape, un pic d'actualité générale écrase ces domaines.
  const bySpatial  = sorted.filter(e => detectEventDomain(e) === 'spatial');
  const byAviation = sorted.filter(e => detectEventDomain(e) === 'aviation');
  const byMaritime = sorted.filter(e => detectEventDomain(e) === 'maritime');

  take(bySpatial,  DOMAIN_MIN_SPATIAL);
  take(byAviation, DOMAIN_MIN_AVIATION);
  take(byMaritime, DOMAIN_MIN_MARITIME);

  const domainCount = selected.length;
  console.log(`[gdelt] domain slots reserved — spatial:${bySpatial.length}→${selected.filter(e => detectEventDomain(e) === 'spatial').length} aviation:${byAviation.length}→${selected.filter(e => detectEventDomain(e) === 'aviation').length} maritime:${byMaritime.length}→${selected.filter(e => detectEventDomain(e) === 'maritime').length}`);

  // ── Étape 2 : quotas par catégorie GDELT ─────────────────────────────────
  for (const [category, limit] of Object.entries(CATEGORY_QUOTAS)) {
    take(sorted.filter(e => e.category === category), limit);
  }

  // ── Étape 3 : garantir les pays stratégiques ──────────────────────────────
  const strategicCount = selected.filter(e => STRATEGIC_COUNTRY_CODES.has(e.countryCode)).length;
  take(
    sorted.filter(e => STRATEGIC_COUNTRY_CODES.has(e.countryCode)),
    Math.max(0, STRATEGIC_MIN_EVENTS - strategicCount)
  );

  // ── Étape 4 : remplir le reste par score ─────────────────────────────────
  take(sorted, MAX_DASHBOARD_EVENTS - selected.length);

  console.log(`[gdelt] selectDiverseEvents — total:${selected.length} (domain:${domainCount} category+strategic+fill:${selected.length - domainCount})`);
  return selected.sort((a, b) => b.score - a.score);
}

function rowToEvent(row, hotspotIndex) {
  const url = (row.source_url || '').trim();
  if (!url) return null;

  const rootCode  = (row.root_code  || '').trim();
  const eventCode = (row.event_code || '').trim();
  const goldstein = parseFloat(row.goldstein);
  const quadClass = String(row.quad_class ?? '');
  const geoType   = String(row.geo_type   ?? '0');

  // Vérifier si l'URL/titre contient des termes de domaine OSINT spécialisé
  // avant d'appliquer les seuils Goldstein (ces événements ont des seuils relâchés)
  const preTitle = decodeHtmlEntities(row.page_title || '').toLowerCase();
  const preDomainText = `${preTitle} ${url} ${row.actor1 || ''} ${row.actor2 || ''}`.toLowerCase();
  const isDomainOSINT = DOMAIN_KEYWORDS_SPATIAL.some(k => preDomainText.includes(k))
                     || DOMAIN_KEYWORDS_AVIATION.some(k => preDomainText.includes(k))
                     || DOMAIN_KEYWORDS_MARITIME.some(k => preDomainText.includes(k));

  // Re-apply Goldstein thresholds — relâchés pour les événements domaine OSINT
  if (isNaN(goldstein)) return null;
  if (isDomainOSINT) {
    // Les événements aviation/spatial/maritime passent avec tout Goldstein négatif
    if (goldstein >= 0) return null;
  } else {
    if (eventCode !== '155' && quadClass === '4' && goldstein > -0.5) return null;
    if (quadClass === '3' && ['13','16','17'].includes(rootCode) && goldstein > -3) return null;
    if (quadClass === '3' && !['13','16','17'].includes(rootCode) && goldstein > -4) return null;
    // For rows from a pre-created view with no quad_class, accept any negative value
    if (!quadClass && goldstein >= 0) return null;
  }

  let lat = parseFloat(row.latitude);
  let lon = parseFloat(row.longitude);
  if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) return null;

  // Jitter for country centroids (geoType 1) and US state centroids (geoType 2)
  // — prevents visual stacking on the map, same as original gdelt.js
  if (geoType === '1') {
    lat += (Math.random() - 0.5) * 6;
    lon += (Math.random() - 0.5) * 6;
  } else if (geoType === '2') {
    lat += (Math.random() - 0.5) * 2;
    lon += (Math.random() - 0.5) * 2;
  }

  const domain = safeDomainFromUrl(url);
  // Priorité : titre GKG (PAGE_TITLE) → extraction URL → fallback GDELT metadata
  const gkgTitle = decodeHtmlEntities(row.page_title || '').trim().replace(/\s+/g, ' ');
  const title  = (gkgTitle.length > 4 ? gkgTitle : null)
              || titleFromUrl(url)
              || buildFallbackTitle(row);

  const countryCode = (row.country_code || '').trim();

  if (isNoiseEvent(title, url, domain)) return null;

  const text     = `${title} ${url} ${row.actor1 || ''} ${row.actor2 || ''} ${getSubEventType(eventCode)}`;
  const category = classifyEvent(text, eventCode);
  if (category === 'discard') return null;
  const base = scoreEvent(text, goldstein, domain);

  // Classify OSINT domain (spatial / aviation / maritime / null)
  const osintDomain = detectEventDomain({ title, url, actor1: row.actor1, actor2: row.actor2, subEventType: getSubEventType(eventCode) });

  // bq_signal_score : score composite calculé dans BigQuery
  const bqBonus = Math.min(50, Number(row.bq_signal_score || 0));

  // Boost géographique depuis les hotspots agrégés
  const hotspotBonus = hotspotIndex ? getHotspotBoost(lat, lon, hotspotIndex) : 0;

  // Bonus pour zones stratégiques asiatiques — compense les titres non-latins
  // qui ne matchent pas les keywords anglais de scoreEvent()
  const asiaBonus   = ['CH','KN','KS','TW','VM','AF','PK'].includes(countryCode) ? 30 : 0;
  const finalScore   = base + bqBonus + hotspotBonus + asiaBonus;

  return {
    id:           row.id || `gdelt_bq_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    title,
    url,
    domain,
    date:         String(row.date || ''),
    country:      row.location || '',
    countryCode,
    rootCode,
    eventCode,
    actor1:       row.actor1 || null,
    actor2:       row.actor2 || null,
    subEventType: getSubEventType(eventCode),
    lat,
    lon,
    tone:         goldstein,
    color:        getColor(goldstein),
    severity:     getSeverityLabel(goldstein),
    category,
    score:        finalScore,
    osintDomain:  osintDomain || null,
    geoType,
    dedup_key:    row.dedup_key || null,
    dataSource:   'gdelt-bq',
  };
}


// ── AI Geo-correction ─────────────────────────────────────────────────────
// Utilise GPT-4o-mini ou Mistral pour corriger le pays des events geo_type=1
// (centroïde pays GDELT basse confiance) en analysant le titre.
const GEO_AI_BATCH = 20;

function buildGeoPrompt(batch) {
  return `You are a geolocation analyst. For each news headline below, determine the PRIMARY country the article is about.
Return ONLY a valid JSON array with one object per input:
{ "id": "same id", "country": "Country Name", "lat": 0.0, "lon": 0.0, "corrected": true/false }
Rules:
- "corrected": true if the title clearly refers to a DIFFERENT country than "current_country"
- "corrected": false ONLY if current_country matches the primary country in the title
- lat/lon = approximate center of the PRIMARY country identified
- If multiple countries are mentioned but NONE match current_country → corrected=true, use the FIRST/main country
- If multiple countries are mentioned and current_country IS one of them → corrected=false
- Headlines in non-English languages: translate mentally to identify countries

Events:
${batch.map(e => JSON.stringify({
  id: e.id,
  title: e.title,
  current_country: e.country,
  current_countryCode: e.countryCode,
})).join('\n')}`;
}

async function callGeoAI(prompt) {
  // Réutilise les mêmes clés API que gemini-normalizer.js
  const oaiKey = process.env.OPENAI_API_KEY || process.env.chatgpt;
  const misKey = process.env.MISTRAL_API_KEY;
  const isOpenAI = !!oaiKey;
  const apiKey = oaiKey || misKey;
  const model  = isOpenAI ? 'gpt-4o-mini' : 'mistral-small-latest';
  const url    = isOpenAI
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.mistral.ai/v1/chat/completions';

  if (!apiKey) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a precise geolocation analyst. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        ...(isOpenAI ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.warn(`[geo-ai] ${provider} HTTP ${resp.status}: ${body.slice(0, 200)}`);
    return [];
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : (parsed.events || parsed.results || []);
  } catch (_) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  }
}

async function aiGeoCorrectEvents(events) {
  const oaiKey = process.env.OPENAI_API_KEY || process.env.chatgpt;
  const misKey = process.env.MISTRAL_API_KEY;
  const provider = oaiKey ? 'openai' : misKey ? 'mistral' : null;
  if (!provider) {
    console.log('[geo-ai] skipped: no OPENAI_API_KEY or MISTRAL_API_KEY');
    return events;
  }

  // Filtrer seulement les events geo_type=1 (centroïde pays, basse confiance)
  const candidates = events.filter(e => e.geoType === '1');
  if (!candidates.length) {
    console.log('[geo-ai] skipped: no geo_type=1 events');
    return events;
  }

  console.log(`[geo-ai] correcting ${candidates.length} geo_type=1 events via ${provider}...`);
  const corrections = new Map();
  let corrected = 0;

  for (let i = 0; i < candidates.length; i += GEO_AI_BATCH) {
    const batch = candidates.slice(i, i + GEO_AI_BATCH);
    try {
      const results = await callGeoAI(buildGeoPrompt(batch));
      for (const r of results) {
        if (r.corrected && r.lat && r.lon && r.country) {
          corrections.set(r.id, r);
          corrected++;
        }
      }
      console.log(`[geo-ai] batch ${Math.floor(i / GEO_AI_BATCH) + 1}: ${results.length} results`);
    } catch (err) {
      console.warn(`[geo-ai] batch ${Math.floor(i / GEO_AI_BATCH) + 1} failed: ${err.message}, retrying...`);
      // Retry une fois après 2s
      try {
        await new Promise(r => setTimeout(r, 2000));
        const results = await callGeoAI(buildGeoPrompt(batch));
        for (const r of results) {
          if (r.corrected && r.lat && r.lon && r.country) {
            corrections.set(r.id, r);
            corrected++;
          }
        }
        console.log(`[geo-ai] batch ${Math.floor(i / GEO_AI_BATCH) + 1} retry OK: ${results.length} results`);
      } catch (retryErr) {
        console.warn(`[geo-ai] batch ${Math.floor(i / GEO_AI_BATCH) + 1} retry failed: ${retryErr.message}`);
      }
    }
    // Rate-limit entre batches
    if (i + GEO_AI_BATCH < candidates.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Appliquer les corrections
  const out = events.map(e => {
    const fix = corrections.get(e.id);
    if (!fix) return e;
    return {
      ...e,
      lat: fix.lat + (Math.random() - 0.5) * 4,
      lon: fix.lon + (Math.random() - 0.5) * 4,
      country: fix.country,
    };
  });

  console.log(`[geo-ai] done: ${corrected}/${candidates.length} events geo-corrected`);
  return out;
}

// ── Main fetch function ───────────────────────────────────────────────────
async function fetchTodayEvents() {
  const bq = getBigQueryClient();
  const opts = { location: 'US', useLegacySql: false };

  console.log('[gdelt-bq] querying BigQuery — recent_events_raw_24h + signal_hotspots_24h...');

  // Les deux requêtes tournent en parallèle pour minimiser la latence
  const [[rawRows], [hotspotRows]] = await Promise.all([
    bq.query({ query: RECENT_EVENTS_SQL, ...opts }),
    bq.query({ query: HOTSPOTS_SQL,      ...opts }).catch(err => {
      console.warn('[gdelt-bq] hotspots query failed, proceeding without boost:', err.message);
      return [[]];
    }),
  ]);

  console.log(`[gdelt-bq] ${rawRows.length} raw events — ${hotspotRows.length} hotspot cells`);

  // Index hotspot depuis les résultats BigQuery (signal_hotspots_24h)
  const hotspotIndex = buildHotspotIndex(hotspotRows);
  console.log(`[gdelt-bq] hotspot grid: ${hotspotIndex.size} cells`);

  // Parse, filter, and deduplicate (keep highest-scoring URL)
  const dedupMap = new Map();
  let _dbg = { nullUrl:0, nullCoord:0, goldsteinFilter:0, noise:0, discard:0, lowScore:0, passed:0 };
  for (const row of rawRows) {
    const url = (row.source_url || '').trim();
    if (!url) { _dbg.nullUrl++; continue; }
    const goldstein = parseFloat(row.goldstein);
    if (isNaN(goldstein)) { _dbg.goldsteinFilter++; continue; }
    const lat = parseFloat(row.latitude), lon = parseFloat(row.longitude);
    if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) { _dbg.nullCoord++; continue; }
    const ev = rowToEvent(row, hotspotIndex);
    if (!ev) { _dbg.noise++; continue; }
    if (ev.category === 'discard') { _dbg.discard++; continue; }
    if (!isRelevantEvent(ev)) { _dbg.lowScore++; continue; }
    _dbg.passed++;
    const existing = dedupMap.get(ev.url);
    if (!existing || ev.score > existing.score) {
      dedupMap.set(ev.url, ev);
    }
  }
  console.log(`[gdelt-bq] filter breakdown — nullUrl:${_dbg.nullUrl} nullCoord:${_dbg.nullCoord} goldstein:${_dbg.goldsteinFilter} noise/null:${_dbg.noise} discard:${_dbg.discard} lowScore:${_dbg.lowScore} passed:${_dbg.passed}`);
  // Sample first discard to help debug
  for (const row of rawRows.slice(0, 50)) {
    const url = (row.source_url || '').trim();
    if (!url) continue;
    const gkgTitle = decodeHtmlEntities(row.page_title || '').trim().replace(/\s+/g, ' ');
    const title = gkgTitle.length > 4 ? gkgTitle : url.split('/').filter(Boolean).pop() || 'unknown';
    const text = `${title} ${url} ${row.actor1 || ''} ${row.actor2 || ''}`;
    const civilian = containsAnyKeyword(text, CIVILIAN_OVERRIDE);
    const security = containsAnyKeyword(text, SECURITY_OVERRIDE_KEYWORDS);
    const noise    = containsAnyKeyword(`${title} ${url}`, NOISE_KEYWORDS);
    console.log(`[gdelt-dbg] gs=${row.goldstein} qc=${row.quad_class} noise=${noise} civ=${civilian} sec=${security} | ${title.slice(0,80)}`);
  }

  console.log(`[gdelt-bq] ${dedupMap.size} unique events after URL dedup and noise filter`);

  // ── Phase 2 : déduplication approximative par événement ─────────────────
  // GDELT génère 20-50 lignes par événement (sources différentes, même fait).
  // Le dedup_key regroupe : pays + code CAMEO + heure + coordonnées arrondies.
  const dedupByEvent = new Map();
  for (const ev of dedupMap.values()) {
    const key = ev.dedup_key || ev.url;
    const existing = dedupByEvent.get(key);
    if (!existing || ev.score > existing.score) {
      dedupByEvent.set(key, ev);
    }
  }
  console.log(`[gdelt-bq] ${dedupByEvent.size} events after approximate dedup (was ${dedupMap.size} by URL)`);

  // ── Geographic diversity — reserve slots for strategic regions ────────
  // Russia (RS), China (CH), North Korea (KN), Iran (IR),
  // Syria (SY), Ukraine (UP), Iraq (IZ) often score lower due to
  // non-English URLs (same rationale as original gdelt.js)
  const events = selectDiverseEvents(Array.from(dedupByEvent.values()));

  // ── Simulation des quotas ───────────────────────────────────────────────
  logQuotaSimulation(events);

  // ── Phase AI : géo-correction par IA ────────────────────────────────────
  const geoFixed = await aiGeoCorrectEvents(events);

  const strategicCount = geoFixed.filter(e => STRATEGIC_COUNTRY_CODES.has(e.countryCode)).length;
  console.log(`[gdelt-bq] done — ${geoFixed.length} events (${strategicCount} strategic)`);

  return geoFixed;
}

// ── Requête A — analyse/calibrage (distribution GDELT brute) ──────────────
async function fetchAnalysisDistribution() {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({ query: ANALYSIS_SQL, location: 'US', useLegacySql: false });
  console.log(`[gdelt-bq] analysis — ${rows.length} distribution rows`);
  return rows;
}

// ── Simulation des quotas — affiche reserved / filled / gap ───────────────
function logQuotaSimulation(events) {
  const lines = ['[gdelt] ── Quota Simulation ──────────────────────────────'];

  // Domaines OSINT
  const domainQuotas = {
    spatial:  DOMAIN_MIN_SPATIAL,
    aviation: DOMAIN_MIN_AVIATION,
    maritime: DOMAIN_MIN_MARITIME,
  };
  for (const [domain, reserved] of Object.entries(domainQuotas)) {
    const filled = events.filter(e => detectEventDomain(e) === domain).length;
    const gap = Math.max(0, reserved - filled);
    lines.push(`  ${domain.padEnd(12)} reserved:${String(reserved).padStart(4)}  filled:${String(filled).padStart(4)}  gap:${String(gap).padStart(4)}${gap > 0 ? '  ⚠ STARVATION' : ''}`);
  }

  // Catégories
  for (const [category, reserved] of Object.entries(CATEGORY_QUOTAS)) {
    const filled = events.filter(e => e.category === category).length;
    const gap = Math.max(0, reserved - filled);
    lines.push(`  ${category.padEnd(12)} reserved:${String(reserved).padStart(4)}  filled:${String(filled).padStart(4)}  gap:${String(gap).padStart(4)}${gap > 0 ? '  ⚠ STARVATION' : ''}`);
  }

  lines.push('[gdelt] ────────────────────────────────────────────────────');
  console.log(lines.join('\n'));
}

module.exports = { fetchTodayEvents, fetchAnalysisDistribution };
