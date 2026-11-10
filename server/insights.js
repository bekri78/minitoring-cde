'use strict';

/**
 * insights.js — Analyses croisées pour le commandement
 *
 *  1. RUPTURES : ce qui est inhabituel, pas seulement ce qui est nombreux.
 *     Pour chaque pays (et pays × catégorie), volume des dernières 24 h comparé
 *     à la moyenne des BASELINE_DAYS jours précédents (fichiers events-AAAAMMJJ.json).
 *
 *  2. CONVERGENCES : là où plusieurs types de signaux se croisent.
 *     Cases d'environ 2° (≈ 200 km) ; une convergence réunit au moins 3 types
 *     distincts dont au moins un signal « information » (événement GDELT ou
 *     article) et au moins un signal « physique » (avion militaire, navire
 *     militaire, anomalie AIS hors pêche).
 *
 * Fonctions pures (testables) + chargement de la normale mis en cache par jour.
 */

const fs   = require('fs');
const path = require('path');

const BASELINE_DAYS = Number(process.env.INSIGHTS_BASELINE_DAYS || 28);

// ── Outils ────────────────────────────────────────────────────────────────

function countryNameOf(event) {
  const raw = String(event.country || '').trim();
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : (event.countryCode || '?');
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function std(xs, m) {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

function round1(x) { return Math.round(x * 10) / 10; }

// Catégories suivies en plus du total pays
const RUPTURE_CATEGORIES = ['military', 'conflict', 'terrorism', 'strategic', 'crisis', 'protest'];

function countsByKey(events) {
  const counts = new Map();
  for (const e of events) {
    const cc = e.countryCode;
    if (!cc) continue;
    const add = key => counts.set(key, (counts.get(key) || 0) + 1);
    add(cc + '|all');
    if (RUPTURE_CATEGORIES.includes(e.category)) add(cc + '|' + e.category);
  }
  return counts;
}

// ── 1. Ruptures ───────────────────────────────────────────────────────────

/**
 * @param {object[]} todayEvents  événements des dernières 24 h (cache courant)
 * @param {Map<string,number>[]} baselineCounts  un comptage par jour de référence
 * @returns {object[]} ruptures triées par intensité
 */
function computeRuptures(todayEvents, baselineCounts, opts = {}) {
  const minToday   = opts.minToday   ?? 6;    // volume minimum pour parler de rupture
  const minRatio   = opts.minRatio   ?? 2;    // au moins 2× la normale
  const minZ       = opts.minZ       ?? 2;    // écart statistique significatif
  const stdFloor   = opts.stdFloor   ?? 1.5;  // évite des z énormes sur des séries plates
  const emergence  = opts.emergence  ?? 8;    // pays absent de la normale : seuil plus haut
  const minDays    = opts.minDays    ?? 7;    // historique minimal pour juger

  if (baselineCounts.length < minDays) return [];

  const today = countsByKey(todayEvents);
  const byKeyEvents = new Map();
  for (const e of todayEvents) {
    if (!e.countryCode) continue;
    for (const key of [e.countryCode + '|all', e.countryCode + '|' + e.category]) {
      if (!byKeyEvents.has(key)) byKeyEvents.set(key, []);
      byKeyEvents.get(key).push(e);
    }
  }

  const out = [];
  for (const [key, n] of today) {
    if (n < minToday) continue;
    const series = baselineCounts.map(c => c.get(key) || 0);
    const m = mean(series);
    const s = Math.max(std(series, m), stdFloor);
    const z = (n - m) / s;
    const ratio = m > 0 ? n / m : Infinity;
    const isEmergence = m < 0.5;
    if (isEmergence ? n < emergence : (ratio < minRatio || z < minZ)) continue;

    const [cc, category] = key.split('|');
    const evs = (byKeyEvents.get(key) || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const located = evs.filter(e => typeof e.lat === 'number' && typeof e.lon === 'number');
    out.push({
      id: 'rupture-' + cc + '-' + category,
      countryCode: cc,
      country: evs.length ? countryNameOf(evs[0]) : cc,
      category,                                   // 'all' = tous types confondus
      today: n,
      baseline: round1(m),
      ratio: Number.isFinite(ratio) ? round1(ratio) : null,
      z: round1(z),
      kind: isEmergence ? 'emergence' : 'hausse',
      level: z >= 4 || (isEmergence && n >= emergence * 2) ? 'forte' : 'notable',
      lat: located.length ? round1(mean(located.map(e => e.lat))) : null,
      lon: located.length ? round1(mean(located.map(e => e.lon))) : null,
      eventIds: evs.slice(0, 5).map(e => e.id),
    });
  }

  // Doublons : si une catégorie explique l'essentiel (≥ 80 %) de la hausse d'un
  // pays, on garde la catégorie (plus précise) et on retire le total pays.
  const kept = out.filter(r => {
    if (r.category !== 'all') return true;
    return !out.some(o => o.countryCode === r.countryCode && o.category !== 'all' && o.today >= 0.8 * r.today);
  });
  return kept.sort((a, b) => b.z - a.z).slice(0, opts.limit ?? 15);
}

// Normale : comptages par jour, recalculés une seule fois par jour.
let _baseline = { day: null, counts: [] };

function loadBaselineCounts(cacheDir, todayStr, days = BASELINE_DAYS) {
  if (_baseline.day === todayStr) return _baseline.counts;
  let files = [];
  try {
    files = fs.readdirSync(cacheDir)
      .filter(f => /^events-\d{8}\.json$/.test(f) && f !== `events-${todayStr}.json`)
      .sort()
      .slice(-days);
  } catch (_) { files = []; }
  const counts = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
      counts.push(countsByKey(raw.events || []));
    } catch (_) { /* fichier illisible ignoré */ }
  }
  _baseline = { day: todayStr, counts };
  console.log(`[insights] normale recalculée sur ${counts.length} jour(s)`);
  return counts;
}

// ── 2. Convergences ───────────────────────────────────────────────────────

const CELL_DEG = Number(process.env.INSIGHTS_CELL_DEG || 2);

const TYPE_WEIGHT = { air: 2, sea: 1, ais: 2, event: 2, news: 1 };
const PHYSICAL = ['air', 'sea', 'ais'];
const INFORMATION = ['event', 'news'];

const EVENT_CATEGORIES = new Set(['conflict', 'military', 'terrorism', 'crisis']);
const EVENT_SEVERITIES = new Set(['CRITICAL', 'SEVERE', 'HIGH']);
const AIS_IGNORED = new Set(['fishing_activity', 'fishing']);

function validPoint(o) {
  return o && typeof o.lat === 'number' && typeof o.lon === 'number'
    && !Number.isNaN(o.lat) && !Number.isNaN(o.lon) && !(o.lat === 0 && o.lon === 0);
}

function collectSignals({ tracks = [], events = [], news = [], anomalies = [] }) {
  const signals = [];
  for (const t of tracks) {
    if (!validPoint(t)) continue;
    if (!['confirmed_military', 'likely_military'].includes(t.milTier)) continue;
    signals.push({ type: t.domain === 'air' ? 'air' : 'sea', lat: t.lat, lon: t.lon,
      ref: { id: t.id, label: t.callsign || t.name || t.id, country: t.country || null } });
  }
  for (const a of anomalies) {
    const lat = typeof a.lat === 'number' ? a.lat : a.latitude;
    const lon = typeof a.lon === 'number' ? a.lon : a.longitude;
    if (!validPoint({ lat, lon })) continue;
    if (AIS_IGNORED.has(String(a.type || '').toLowerCase())) continue;
    signals.push({ type: 'ais', lat, lon, ref: { id: a.id, label: a.type || 'anomalie AIS' } });
  }
  for (const e of events) {
    if (!validPoint(e)) continue;
    if (!EVENT_CATEGORIES.has(e.category) && !EVENT_SEVERITIES.has(e.severity)) continue;
    signals.push({ type: 'event', lat: e.lat, lon: e.lon,
      ref: { id: e.id, label: e.titleFr || e.title || '', country: countryNameOf(e) } });
  }
  for (const n of news) {
    if (!validPoint(n)) continue;
    signals.push({ type: 'news', lat: n.lat, lon: n.lon,
      ref: { id: n.id, label: n.title || '', country: n.location || null } });
  }
  return signals;
}

function cellOf(lat, lon) {
  return Math.floor(lat / CELL_DEG) + ':' + Math.floor(lon / CELL_DEG);
}

function computeConvergences(input, opts = {}) {
  const minTypes = opts.minTypes ?? 3;
  const limit    = opts.limit ?? 15;
  const signals  = collectSignals(input);

  const cells = new Map();
  for (const s of signals) {
    const key = cellOf(s.lat, s.lon);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(s);
  }

  // Chaque case est évaluée avec ses 8 voisines (un foyer à cheval sur deux cases)
  const candidates = [];
  for (const key of cells.keys()) {
    const [ci, cj] = key.split(':').map(Number);
    const members = [];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const near = cells.get((ci + di) + ':' + (cj + dj));
        if (near) members.push(...near);
      }
    }
    const byType = {};
    for (const m of members) (byType[m.type] = byType[m.type] || []).push(m);
    const types = Object.keys(byType);
    if (types.length < minTypes) continue;
    if (!types.some(t => PHYSICAL.includes(t)) || !types.some(t => INFORMATION.includes(t))) continue;

    const score = types.reduce((sum, t) => sum + TYPE_WEIGHT[t] * (1 + Math.log2(byType[t].length)), 0);
    candidates.push({ key, ci, cj, byType, types, score });
  }

  // Sélection gloutonne : on garde le meilleur foyer et on écarte ses voisins
  candidates.sort((a, b) => b.score - a.score);
  const taken = new Set();
  const out = [];
  for (const c of candidates) {
    if (taken.has(c.key)) continue;
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) taken.add((c.ci + di) + ':' + (c.cj + dj));

    const all = Object.values(c.byType).flat();
    const label = (c.byType.event || [])[0]?.ref.country
      || (c.byType.news || [])[0]?.ref.country
      || (c.byType.air || c.byType.sea || [])[0]?.ref.country
      || null;
    const items = {};
    const counts = {};
    for (const t of c.types) {
      counts[t] = c.byType[t].length;
      items[t] = c.byType[t].slice(0, 5).map(s => s.ref);
    }
    out.push({
      id: 'convergence-' + c.key.replace(':', '_').replace(/-/g, 'm'),
      lat: round1(mean(all.map(s => s.lat))),
      lon: round1(mean(all.map(s => s.lon))),
      label,
      types: c.types,
      counts,
      score: round1(c.score),
      items,
    });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  computeRuptures, loadBaselineCounts, countsByKey,
  computeConvergences, collectSignals, countryNameOf,
};
