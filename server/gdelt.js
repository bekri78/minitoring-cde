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

const STRATEGIC_COUNTRY_CODES = new Set(['RS', 'CH', 'KN', 'IR', 'SY', 'UP', 'IZ']);
const STRATEGIC_MIN_EVENTS = 60;

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
  for (const cat of CATEGORY_RULES) {
    if (cat.cameo && cat.cameo.some(c => eventCode.startsWith(c))) {
      return cat.key;
    }
  }
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
  if (domain && PRIORITY_DOMAIN_BOOST[domain]) {
    score += PRIORITY_DOMAIN_BOOST[domain];
  }
  return score;
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

// ── BigQuery SQL — recent events (equivalent to recent_events_raw_24h view)
// Queries the public GDELT v2 dataset directly.
// Partition pruning via _PARTITIONTIME keeps scan costs low (~1-2 GB/query).
// If you have pre-created the views in your own dataset, set:
//   GDELT_EVENTS_VIEW=<project>.<dataset>.recent_events_raw_24h
// and the module will query that view instead.
const RECENT_EVENTS_SQL = (() => {
  const view = process.env.GDELT_EVENTS_VIEW;
  if (view) {
    return `
      SELECT
        CAST(id AS STRING)           AS id,
        CAST(event_timestamp AS STRING) AS date,
        location,
        country_code,
        IFNULL(Actor1Name, '')       AS actor1,
        IFNULL(Actor2Name, '')       AS actor2,
        IFNULL(EventCode, '')        AS event_code,
        CAST(NULL AS STRING)         AS root_code,
        CAST(NULL AS INT64)          AS quad_class,
        GoldsteinScale               AS goldstein,
        NumMentions                  AS num_mentions,
        NumSources                   AS num_sources,
        NumArticles                  AS num_articles,
        AvgTone                      AS avg_tone,
        CAST(NULL AS STRING)         AS geo_type,
        latitude,
        longitude,
        SOURCEURL                    AS source_url,
        layer_type
      FROM \`${view}\`
    `;
  }

  // Default: query the public GDELT v2 events table directly
  return `
    SELECT
      CAST(GlobalEventID AS STRING)     AS id,
      CAST(SQLDATE AS STRING)           AS date,
      IFNULL(ActionGeo_FullName, '')    AS location,
      IFNULL(ActionGeo_CountryCode, '') AS country_code,
      IFNULL(Actor1Name, '')            AS actor1,
      IFNULL(Actor2Name, '')            AS actor2,
      IFNULL(EventCode, '')             AS event_code,
      IFNULL(EventRootCode, '')         AS root_code,
      QuadClass                         AS quad_class,
      GoldsteinScale                    AS goldstein,
      NumMentions                       AS num_mentions,
      NumSources                        AS num_sources,
      NumArticles                       AS num_articles,
      AvgTone                           AS avg_tone,
      CAST(ActionGeo_Type AS STRING)    AS geo_type,
      ActionGeo_Lat                     AS latitude,
      ActionGeo_Long                    AS longitude,
      SOURCEURL                         AS source_url,
      CASE
        WHEN EventRootCode IN ('18','19','20') THEN 'hard_events'
        WHEN EventRootCode = '14'              THEN 'protests'
        WHEN EventRootCode IN ('03','04','05') THEN 'diplomacy'
        ELSE 'other'
      END AS layer_type
    FROM \`gdelt-bq.gdeltv2.events\`
    WHERE
      _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 26 HOUR)
      AND ActionGeo_Lat  IS NOT NULL
      AND ActionGeo_Long IS NOT NULL
      AND ActionGeo_Lat  != 0
      AND ActionGeo_Long != 0
      AND SOURCEURL IS NOT NULL
      AND SOURCEURL != ''
      AND QuadClass IN (3, 4)
      AND EventRootCode IN ('03','04','05','13','14','15','16','17','18','19','20')
      AND (
        (QuadClass = 4 AND GoldsteinScale <= -1.0)
        OR
        (QuadClass = 3 AND GoldsteinScale <= -5.0)
      )
    ORDER BY GoldsteinScale ASC
    LIMIT 5000
  `;
})();

// ── In-memory hotspot index (equivalent to signal_hotspots_24h view) ──────
// Groups events into 0.5° grid cells and computes a signal score per cluster.
// Used to boost individual event scores when they fall in a high-activity zone.
function buildHotspotIndex(rows) {
  const grid = new Map();

  for (const row of rows) {
    const lat = parseFloat(row.latitude);
    const lon = parseFloat(row.longitude);
    if (isNaN(lat) || isNaN(lon)) continue;

    // 0.5° grid cell key — ~55 km resolution at the equator
    const gridLat = Math.round(lat * 2) / 2;
    const gridLon = Math.round(lon * 2) / 2;
    const key = `${gridLat},${gridLon}`;

    // Base severity per CAMEO root code (mirrors signal_hotspots_24h logic)
    const rootCode = (row.root_code || '').trim();
    const baseSeverity =
      rootCode === '19' ? 100 :
      rootCode === '18' || rootCode === '20' ? 80 :
      rootCode === '14' ? 50 : 20;

    // Logarithmic media score — prevents major-outlet events dominating
    const mediaScore = Math.log1p(
      (Number(row.num_mentions) || 0) +
      (Number(row.num_sources)  || 0) * 2 +
      (Number(row.num_articles) || 0)
    ) * 5;

    if (!grid.has(key)) {
      grid.set(key, { count: 0, maxSeverity: 0, maxMedia: 0, layerType: row.layer_type });
    }

    const cell = grid.get(key);
    cell.count++;
    cell.maxSeverity = Math.max(cell.maxSeverity, baseSeverity);
    cell.maxMedia    = Math.max(cell.maxMedia, mediaScore);
  }

  return grid;
}

function getHotspotBoost(lat, lon, hotspotIndex) {
  const key = `${Math.round(lat * 2) / 2},${Math.round(lon * 2) / 2}`;
  const cell = hotspotIndex.get(key);
  if (!cell || cell.count < 2) return 0; // single events don't get a cluster bonus

  // Cluster bonus: up to +40 for dense activity zones
  const clusterBonus  = Math.min(40, cell.count * 2);
  // Severity bonus: extra weight for combat/mass-violence zones
  const severityBonus = cell.maxSeverity >= 80 ? 15 : cell.maxSeverity >= 50 ? 8 : 0;

  return clusterBonus + severityBonus;
}

// ── Map one BigQuery row → existing event schema ──────────────────────────
function rowToEvent(row, hotspotIndex) {
  const url = (row.source_url || '').trim();
  if (!url) return null;

  const rootCode  = (row.root_code  || '').trim();
  const eventCode = (row.event_code || '').trim();
  const goldstein = parseFloat(row.goldstein);
  const quadClass = String(row.quad_class ?? '');
  const geoType   = String(row.geo_type   ?? '0');

  // Re-apply Goldstein thresholds (the SQL already filters, but views may not)
  if (isNaN(goldstein)) return null;
  if (quadClass === '4' && goldstein > -1) return null;
  if (quadClass === '3' && goldstein > -5) return null;
  // For rows from a pre-created view with no quad_class, accept any negative value
  if (!quadClass && goldstein >= 0) return null;

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
  const title  = titleFromUrl(url);

  if (isNoiseEvent(title, url, domain)) return null;

  const text     = `${title} ${url}`;
  const category = classifyEvent(text, eventCode);
  const base     = scoreEvent(text, goldstein, domain);

  // Media score bonus — logarithmic scaling prevents major-outlet bias
  const mediaBonus = Math.min(25, Math.log1p(
    (Number(row.num_mentions) || 0) +
    (Number(row.num_sources)  || 0) * 2 +
    (Number(row.num_articles) || 0)
  ) * 3);

  // Geographic hotspot cluster boost
  const hotspotBonus = hotspotIndex ? getHotspotBoost(lat, lon, hotspotIndex) : 0;

  return {
    id:           row.id || `gdelt_bq_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    title,
    url,
    domain,
    date:         String(row.date || ''),
    country:      row.location || '',
    countryCode:  (row.country_code || '').trim(),
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
    score:        base + mediaBonus + hotspotBonus,
    dataSource:   'gdelt-bq',
  };
}

// ── Main fetch function ───────────────────────────────────────────────────
async function fetchTodayEvents() {
  const bq = getBigQueryClient();

  console.log('[gdelt-bq] querying BigQuery — last 24h GDELT events...');

  const [rows] = await bq.query({
    query:        RECENT_EVENTS_SQL,
    location:     'US',
    useLegacySql: false,
  });

  console.log(`[gdelt-bq] received ${rows.length} rows from BigQuery`);

  // Build in-memory hotspot index for cluster score boosting
  const hotspotIndex = buildHotspotIndex(rows);
  console.log(`[gdelt-bq] hotspot grid: ${hotspotIndex.size} cells`);

  // Parse, filter, and deduplicate (keep highest-scoring URL)
  const dedupMap = new Map();
  for (const row of rows) {
    const ev = rowToEvent(row, hotspotIndex);
    if (!ev) continue;

    const existing = dedupMap.get(ev.url);
    if (!existing || ev.score > existing.score) {
      dedupMap.set(ev.url, ev);
    }
  }

  console.log(`[gdelt-bq] ${dedupMap.size} unique events after dedup and noise filter`);

  // ── Geographic diversity — reserve slots for strategic regions ────────
  // Russia (RS), China (CH), North Korea (KN), Iran (IR),
  // Syria (SY), Ukraine (UP), Iraq (IZ) often score lower due to
  // non-English URLs (same rationale as original gdelt.js)
  const allSorted      = Array.from(dedupMap.values()).sort((a, b) => b.score - a.score);
  const strategic      = allSorted.filter(e => STRATEGIC_COUNTRY_CODES.has(e.countryCode));
  const others         = allSorted.filter(e => !STRATEGIC_COUNTRY_CODES.has(e.countryCode));

  const strategicSlice = strategic.slice(0, STRATEGIC_MIN_EVENTS);
  const othersSlice    = others.slice(0, 800 - strategicSlice.length);

  const events = [...othersSlice, ...strategicSlice]
    .sort((a, b) => b.score - a.score)
    .slice(0, 800);

  const strategicCount = events.filter(e => STRATEGIC_COUNTRY_CODES.has(e.countryCode)).length;
  console.log(`[gdelt-bq] done — ${events.length} events (${strategicCount} strategic)`);
  return events;
}

module.exports = { fetchTodayEvents };
