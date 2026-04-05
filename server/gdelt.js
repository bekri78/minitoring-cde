'use strict';

const JSZip = require('jszip');

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
  // Cherche le code exact d'abord (ex: "1823"), puis code court (ex: "182", "18")
  if (CAMEO_SUBTYPE[eventCode]) return CAMEO_SUBTYPE[eventCode];
  if (eventCode.length > 3 && CAMEO_SUBTYPE[eventCode.slice(0, 3)]) return CAMEO_SUBTYPE[eventCode.slice(0, 3)];
  if (eventCode.length > 2 && CAMEO_SUBTYPE[eventCode.slice(0, 2)]) return CAMEO_SUBTYPE[eventCode.slice(0, 2)];
  return 'Unknown';
}

// ── Codes CAMEO retenus ───────────────────────────────────────────────────
// QuadClass 4 (Material Conflict) — tous ces codes sont retenus
const MATERIAL_CONFLICT_CODES = new Set([
  '13', // THREATEN — menaces militaires, ultimatums, WMD
  '14', // PROTEST  — émeutes, manifestations violentes
  '15', // EXHIBIT FORCE POSTURE — mobilisation, alerte militaire
  '16', // REDUCE RELATIONS — sanctions, ruptures, expulsions
  '17', // COERCE — arrestations, état d'urgence, répression violente
  '18', // ASSAULT — attentats, prises d'otages, assassinats
  '19', // FIGHT — combats, frappes, occupation de territoire
  '20'  // UNCONVENTIONAL MASS VIOLENCE — massacres, armes de destruction massive
]);

// QuadClass 3 (Verbal Conflict) — seulement les codes à fort impact opérationnel
const VERBAL_CONFLICT_CODES = new Set([
  '13', // Menaces militaires directes
  '15', // Démonstration de force
  '17', // Coercition
  '18', // Assault (verbal reporting)
  '19', // Combat (verbal reporting)
  '20'  // Violence de masse
]);

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
  'health tips', 'weight loss', 'diet', 'fitness', 'wellness',

  // ── Violences civiles non-opérationnelles (crime ordinaire) ───────────────
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
  'marketwatch.com', 'investopedia.com', 'fool.com'
]);

// ── Boost de score pour les sources étatiques stratégiques ─────────────────
// Ces sources ont des URL sans slug anglais (ex: tass.ru/armiya-i-opk/20388435)
// → titleFromUrl extrait un numérique → score 0 sans ce boost
const PRIORITY_DOMAIN_BOOST = {
  // Russie
  'tass.ru': 65, 'tass.com': 65, 'ria.ru': 60, 'rt.com': 55,
  'sputniknews.com': 55, 'sputnikglobe.com': 55, 'interfax.ru': 60,
  // Chine
  'xinhuanet.com': 65, 'news.cn': 65, 'globaltimes.cn': 60,
  'chinadaily.com.cn': 55, 'cgtn.com': 55, 'china.org.cn': 55,
  // Corée du Nord
  'kcna.kp': 70, 'kcna.co.jp': 70, 'rodong.rep.kp': 70,
  // Iran
  'presstv.ir': 60, 'presstv.com': 60, 'irna.ir': 60, 'tasnimnews.com': 60,
  'farsnews.ir': 55, 'mehrnews.com': 55,
  // Pays arabes / autres zones sous-représentées
  'almayadeen.net': 55, 'aljazeera.net': 50, 'alarabiya.net': 50,
  'yonhapnews.co.kr': 55,
};

// Codes pays FIPS pour les zones stratégiques sous-représentées dans GDELT english
const STRATEGIC_COUNTRY_CODES = new Set(['RS', 'CH', 'KN', 'IR', 'SY', 'UP', 'IZ']);
const STRATEGIC_MIN_EVENTS = 60; // slots réservés dans le top 800

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
    cameo: ['181', '182', '183', '1831', '1832', '1833', '185', '186', '200', '201', '202', '203', '204'],
    keywords: ['terrorist', 'terrorism', 'suicide bomb', 'isis', 'isil', 'daesh',
               'al-qaeda', 'al qaeda', 'jihad', 'ied', 'car bomb', 'beheading',
               'kidnap', 'hostage', 'extremist', 'mass shooting', 'gunman',
               'massacre', 'ethnic cleansing', 'wmd', 'chemical weapon']
  },
  {
    key: 'military',
    cameo: ['150', '151', '152', '153', '154', '190', '191', '192', '193', '194', '195', '196'],
    keywords: ['airstrike', 'air strike', 'missile', 'artillery', 'shelling',
               'bombardment', 'navy', 'air force', 'fighter jet', 'warplane',
               'tank', 'drone strike', 'mobilization', 'armed forces',
               'military operation', 'offensive', 'siege', 'air raid',
               'rocket attack', 'troops deployed', 'naval', 'ground assault',
               'military advance', 'frontline', 'ceasefire violation']
  },
  {
    key: 'conflict',
    cameo: ['180', '184', '186', '193', '194', '195'],
    keywords: ['war', 'battle', 'combat', 'fighting', 'clashes', 'gunfire',
               'killed', 'wounded', 'dead', 'casualties', 'rebels', 'insurgent',
               'insurgency', 'border clash', 'shootout', 'armed clash', 'militia',
               'raid', 'bombing', 'blast', 'explosion', 'ambush', 'convoy attack']
  },
  {
    key: 'protest',
    cameo: ['140', '141', '142', '143', '144', '145'],
    keywords: ['protest', 'riot', 'demonstration', 'unrest', 'march', 'rally',
               'uprising', 'civil unrest', 'dissent', 'blockade', 'occupy',
               'walkout', 'coup', 'stormed', 'clashed with police']
  },
  {
    key: 'threat',
    cameo: ['130', '131', '132', '133', '137', '138', '139'],
    keywords: ['ultimatum', 'threatened', 'threatens', 'warned', 'warning',
               'nuclear threat', 'military threat', 'sanctions threat',
               'blockade threat', 'invasion threat', 'attack threat']
  },
  {
    key: 'crisis',
    cameo: ['160', '161', '162', '163', '170', '172', '173', '174', '175'],
    keywords: ['crisis', 'emergency', 'martial law', 'sanction', 'evacuation',
               'displaced', 'refugee', 'state of emergency', 'crackdown',
               'detained', 'arrested', 'expelled', 'deported', 'coup',
               'sanctions imposed', 'diplomatic expulsion']
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

function classifyEvent(text, eventCode = '') {
  // Priorité 1 : classification par code CAMEO exact
  for (const cat of CATEGORY_RULES) {
    if (cat.cameo && cat.cameo.some(c => eventCode.startsWith(c))) {
      return cat.key;
    }
  }
  // Priorité 2 : classification par mots-clés
  const normalized = normalizeText(text);
  for (const cat of CATEGORY_RULES) {
    if (cat.keywords.some(k => normalized.includes(normalizeText(k)))) {
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
    protest: 18, riot: 18, explosion: 18, troops: 16, crisis: 15, incident: 12
  };
  for (const [word, bonus] of Object.entries(bonuses)) {
    if (normalized.includes(word)) score += bonus;
  }
  // Boost pour les sources étatiques stratégiques (URL sans slug anglais)
  if (domain && PRIORITY_DOMAIN_BOOST[domain]) {
    score += PRIORITY_DOMAIN_BOOST[domain];
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

    const eventCode  = (c[26] || '').trim();  // EventCode complet (col 26)
    const rootCode   = (c[28] || '').trim();  // EventRootCode (col 28)
    const quadClass  = (c[29] || '').trim();  // QuadClass (col 29)
    const actor1Name = (c[6]  || '').trim();  // Actor1Name (col 6)
    const actor2Name = (c[16] || '').trim();  // Actor2Name (col 16)
    const goldstein = parseFloat(c[30]);
    // ActionGeo = où l'événement s'est produit (pas Actor1Geo qui est le pays d'origine)
    const geoType   = c[51];               // ActionGeo_Type
    const geoName   = c[52] || '';         // ActionGeo_FullName
    const latRaw    = parseFloat(c[56]);   // ActionGeo_Lat
    const lonRaw    = parseFloat(c[57]);   // ActionGeo_Long
    const url       = (c[60] || '').trim();

    // ── Filtre QuadClass : uniquement conflits verbaux et matériels ──────
    if (quadClass !== '3' && quadClass !== '4') return null;

    // ── Filtre codes CAMEO selon le type de conflit ──────────────────────
    if (quadClass === '4' && !MATERIAL_CONFLICT_CODES.has(rootCode)) return null;
    if (quadClass === '3' && !VERBAL_CONFLICT_CODES.has(rootCode)) return null;

    // ── Filtre Goldstein différencié ─────────────────────────────────────
    // Material Conflict : seuil -1 (événements violents réels)
    // Verbal Conflict   : seuil -5 (seulement les menaces très sérieuses)
    const goldsteinThreshold = quadClass === '4' ? -1 : -5;
    if (isNaN(goldstein) || goldstein > goldsteinThreshold) return null;

    // Accepter tous les niveaux de géolocalisation
    // 1=Country, 2=US State, 3=US City, 4=World City, 5=World State
    // GeoType 1 et 2 sont imprécis mais indispensables pour Russie, Chine, Corée, Amérique du Sud
    if (!geoType || geoType === '0') return null;
    if (!url) return null;

    let lat = latRaw;
    let lon = lonRaw;

    if (isNaN(lat) || isNaN(lon)) return null;

    // Jitter pour les centroïdes pays (type 1) et états US (type 2) — évite l'empilement visuel
    if (geoType === '1') {
      lat += (Math.random() - 0.5) * 6;
      lon += (Math.random() - 0.5) * 6;
    } else if (geoType === '2') {
      lat += (Math.random() - 0.5) * 2;
      lon += (Math.random() - 0.5) * 2;
    }

    const title  = titleFromUrl(url);
    const domain = safeDomainFromUrl(url);

    // isNoiseEvent filtre le bruit — isOperationalEvent SUPPRIMÉ car il rejette
    // toutes les sources non-anglophones (TASS, Xinhua, Itar-TASS, RT.ru, Yonhap KO)
    // Le filtre CAMEO + Goldstein est suffisant pour garantir la pertinence
    if (isNoiseEvent(title, url, domain)) return null;

    const text        = `${title} ${url}`;
    const category    = classifyEvent(text, eventCode);
    const countryCode = (c[53] || '').trim(); // ActionGeo_CountryCode (FIPS)
    const score       = scoreEvent(text, goldstein, domain);

    return {
      id:            c[0] || `gdelt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title,
      url,
      domain,
      date:          c[1] || '',
      country:       geoName || c[36] || '',
      countryCode,
      rootCode,
      eventCode,
      actor1:        actor1Name || null,
      actor2:        actor2Name || null,
      subEventType:  getSubEventType(eventCode),
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

  // ── Diversité géographique : réserver des slots pour les zones stratégiques ──
  // Russie (RS), Chine (CH), Corée du Nord (KN), Iran (IR), Syrie (SY),
  // Ukraine (UP), Irak (IZ) ont des sources aux URL sans slug anglais → scores bas
  const allSorted  = Array.from(dedupMap.values()).sort((a, b) => b.score - a.score);
  const strategic  = allSorted.filter(e => STRATEGIC_COUNTRY_CODES.has(e.countryCode));
  const others     = allSorted.filter(e => !STRATEGIC_COUNTRY_CODES.has(e.countryCode));

  const strategicSlice = strategic.slice(0, STRATEGIC_MIN_EVENTS);
  const othersSlice    = others.slice(0, 800 - strategicSlice.length);

  const events = [...othersSlice, ...strategicSlice]
    .sort((a, b) => b.score - a.score)
    .slice(0, 800);

  const strategicCount = events.filter(e => STRATEGIC_COUNTRY_CODES.has(e.countryCode)).length;
  console.log(`[gdelt] done — ${events.length} events (${strategicCount} strategic) from ${ok}/${todayUrls.length} files`);
  return events;
}

module.exports = { fetchTodayEvents };
