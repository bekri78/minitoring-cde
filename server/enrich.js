'use strict';

const BUSINESS_NOISE_TERMS = [
  'stock', 'market', 'earnings', 'revenue', 'profit', 'loss', 'shares',
  'share price', 'analyst forecast', 'quarterly results', 'investing',
  'investment', 'samsung', 'semiconductor', 'semiconductors', 'memory chips',
  'chip demand', 'artificial intelligence demand',
  'acciones', 'bolsa', 'inversion', 'inversión', 'resultados', 'beneficio',
  'crece', 'crecimiento', 'esperado', 'demanda', 'chips de memoria',
  'inteligencia artificial',
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

const TARGET_EVENTS = Number(process.env.GDELT_FINAL_EVENTS || 600);

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

function normalizeText(value) {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\u0600-\u06ff\u0400-\u04ffa-z0-9\s:/._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

// enrichEvents — sélection régionale locale uniquement (le filtrage AI est déjà fait par gemini-normalizer)
async function enrichEvents(events) {
  if (!events?.length) return [];

  const cleaned = events.filter(event => !isCivilianNoise(event));
  const finalEvents = selectFinalEvents(cleaned);
  console.log(`[enrich] done — ${finalEvents.length}/${events.length} events selected (${events.length - cleaned.length} civilian noise removed, no AI re-filter)`);
  return finalEvents;
}

module.exports = { enrichEvents, regionForEvent, selectFinalEvents };
