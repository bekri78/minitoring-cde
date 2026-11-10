'use strict';

/**
 * sharepoint-snapshot.js — Instantané unique pour la synchronisation SharePoint.
 *
 * Un navigateur relais appelle GET /api/public/sharepoint/snapshot une fois par cycle,
 * dépose le JSON dans une bibliothèque SharePoint, puis bascule un pointeur.
 * Les autres navigateurs ne lisent que SharePoint.
 *
 *   - Un seul appel apporte toutes les couches.
 *   - Données allégées (copies et champs internes retirés).
 *   - ETag SHA-256 du contenu : ?etag=<connu> → 304 sans corps.
 *   - Réponse gzip si le client l'accepte (le navigateur décompresse seul).
 *   - Calcul mis en cache SNAPSHOT_TTL_MS pour ne pas recalculer à chaque appel.
 */

const crypto = require('crypto');
const zlib   = require('zlib');

const SCHEMA_VERSION  = 1;
const SNAPSHOT_TTL_MS = Number(process.env.SNAPSHOT_TTL_MS || 60 * 1000);

// Champs utilisés seulement pour le tri côté serveur : inutiles dans SharePoint
const EVENT_INTERNAL_FIELDS = ['editorial_dedup_key', 'text_blob'];

function slimEvent(e) {
  if (!e || typeof e !== 'object') return e;
  const out = {};
  for (const k of Object.keys(e)) {
    if (k.startsWith('_')) continue;
    if (EVENT_INTERNAL_FIELDS.includes(k)) continue;
    if (k === 'canonical_url' && e.canonical_url === e.url) continue;
    out[k] = e[k];
  }
  return out;
}

// Les événements proches sont déjà dans data.osint : on ne garde que la référence
function slimTrack(t) {
  if (!t || typeof t !== 'object') return t;
  const { nearbyEvents, _raw, ...rest } = t;
  rest.nearbyEventRefs = Array.isArray(nearbyEvents)
    ? nearbyEvents.map(n => ({ id: n.id, distanceKm: n.distanceKm }))
    : [];
  return rest;
}

const arr = v => (Array.isArray(v) ? v : []);
const status = c => (c && c.lastUpdate ? 'ok' : 'initializing');

/**
 * Assemble l'instantané. `src` fournit des fonctions de lecture des caches,
 * ce qui permet de tester le module sans démarrer le serveur.
 */
function buildSnapshot(src) {
  const osint   = src.osint();
  const events  = arr(osint.events);
  const news    = src.news();
  const signals = src.signals();
  const markers = src.signalMarkers();
  const world   = src.worldEvents();
  const tracks  = src.tracks(events);
  const anomal  = src.maritimeAnomalies();
  const quakes  = src.earthquakes();
  const sw      = src.spaceWeather();
  const launch  = src.launches();
  const decay   = src.decay();
  const tip     = src.tip();

  const data = {
    osint:             events.map(slimEvent),
    news:              arr(news.events),
    signals:           arr(signals.signals),
    signalMarkers:     arr(markers.markers),
    worldEvents:       arr(world.events),
    tracks:            arr(tracks.tracks).map(slimTrack),
    tracksMeta:        tracks.meta || null,
    maritimeEvents:    arr(src.maritimeEvents(events)),
    maritimeAnomalies: arr(anomal.anomalies),
    aviationEvents:    arr(src.aviationEvents(events)),
    spatialEvents:     arr(src.spatialEvents(events)),
    earthquakes:       arr(quakes.quakes),
    spaceWeather:      { kp: sw.kp ?? null, scales: sw.scales ?? null, alerts: arr(sw.alerts) },
    space: {
      launches: arr(launch.launches),
      previous: arr(launch.previous),
      events:   arr(launch.events),
      pads:     arr(launch.pads),
      decay:    arr(decay.objects),
      tip:      arr(tip.objects),
    },
    history:           arr(src.history()),
    // Analyses croisées (facultatives : absentes des anciens snapshots)
    ruptures:          src.ruptures ? arr(src.ruptures(events)) : [],
    convergences:      src.convergences ? arr(src.convergences({
                         tracks: arr(tracks.tracks), events, news: arr(news.events), anomalies: arr(anomal.anomalies),
                       })) : [],
  };

  const sources = {
    osint:             { lastUpdate: osint.lastUpdate || null, status: osint.status || status(osint) },
    news:              { lastUpdate: news.lastUpdate || null, status: status(news) },
    signals:           { lastUpdate: signals.lastUpdate || null, status: status(signals) },
    signalMarkers:     { lastUpdate: markers.lastUpdate || null, status: status(markers) },
    worldEvents:       { lastUpdate: world.lastUpdate || null, status: status(world) },
    tracks:            { lastUpdate: tracks.meta?.shipStream?.lastUpdate || null, status: tracks.meta?.shipStream?.status || 'ok' },
    maritimeAnomalies: { lastUpdate: anomal.meta?.lastUpdate || null, status: anomal.meta?.status || 'unknown' },
    earthquakes:       { lastUpdate: quakes.lastUpdate || null, status: status(quakes) },
    spaceWeather:      { lastUpdate: sw.lastUpdate || null, status: status(sw) },
    space:             { lastUpdate: launch.lastUpdate || decay.lastUpdate || tip.lastUpdate || null, status: status(launch) },
  };

  const counts = {};
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v)) counts[k] = v.length;

  // L'ETag ne dépend que du contenu : deux appels sans changement donnent le même ETag
  const etag = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

  return {
    schemaVersion: SCHEMA_VERSION,
    type:          'ogma-snapshot',
    generatedAt:   new Date().toISOString(),
    etag,
    counts,
    sources,
    data,
  };
}

/**
 * Validation stricte : la même règle sert au serveur (avant envoi) et
 * peut être reprise telle quelle côté SharePoint (avant écriture et à la lecture).
 * Renvoie la liste des problèmes ; vide = valide.
 */
function validateSnapshot(s) {
  const errors = [];
  if (!s || typeof s !== 'object') return ['snapshot absent'];
  if (s.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion inattendue: ' + s.schemaVersion);
  if (s.type !== 'ogma-snapshot') errors.push('type inattendu');
  if (!/^[0-9a-f]{64}$/.test(String(s.etag || ''))) errors.push('etag invalide');
  if (!s.generatedAt || isNaN(Date.parse(s.generatedAt))) errors.push('generatedAt invalide');
  if (!s.data || typeof s.data !== 'object') return errors.concat('data absent');

  const lists = ['osint', 'news', 'signals', 'signalMarkers', 'worldEvents', 'tracks',
    'maritimeEvents', 'maritimeAnomalies', 'aviationEvents', 'spatialEvents', 'earthquakes', 'history'];
  for (const k of lists) {
    if (!Array.isArray(s.data[k])) { errors.push(k + ' doit être une liste'); continue; }
    if (s.counts && s.counts[k] !== s.data[k].length) errors.push(k + ': nombre incohérent');
  }
  if (!s.data.space || typeof s.data.space !== 'object') errors.push('space absent');

  // Doublons d'identifiants dans les couches principales
  for (const k of ['osint', 'news', 'tracks']) {
    const ids = new Set();
    for (const it of s.data[k] || []) {
      if (it && it.id != null) {
        const id = String(it.id);
        if (ids.has(id)) { errors.push(k + ': identifiant en double ' + id); break; }
        ids.add(id);
      }
    }
  }

  // Une base vide n'est jamais publiée : on garderait le cache précédent
  if ((s.data.osint || []).length === 0 && (s.data.news || []).length === 0) {
    errors.push('aucun événement (osint et news vides)');
  }
  return errors;
}

/** Cache du dernier instantané calculé, avec ses versions JSON et gzip. */
function createSnapshotHandler(src) {
  let memo = null; // { at, snapshot, json, gzip }

  function current() {
    if (memo && Date.now() - memo.at < SNAPSHOT_TTL_MS) return memo;
    const snapshot = buildSnapshot(src);
    const json = JSON.stringify(snapshot);
    const d = snapshot.data;
    console.log('[snapshot] ' + Math.round(json.length / 1024) + ' Ko · ruptures: '
      + d.ruptures.slice(0, 5).map(r => r.country + '/' + r.category + ' ' + r.today + ' vs ' + r.baseline).join(', ')
      + ' · convergences: ' + d.convergences.slice(0, 5).map(c => (c.label || '?') + ' [' + c.types.join('+') + ']').join(', '));
    memo = { at: Date.now(), snapshot, json, gzip: zlib.gzipSync(json) };
    return memo;
  }

  return function snapshotHandler(req, res) {
    let m;
    try {
      m = current();
    } catch (err) {
      console.error('[snapshot] build failed:', err.message);
      return res.status(500).json({ error: 'snapshot_build_failed' });
    }

    const problems = validateSnapshot(m.snapshot);
    if (problems.length) {
      console.warn('[snapshot] invalide:', problems.join(' | '));
      return res.status(503).json({ error: 'snapshot_invalid', problems });
    }

    res.set('Cache-Control', 'no-store');
    res.set('ETag', '"' + m.snapshot.etag + '"');
    res.set('Access-Control-Expose-Headers', 'ETag');

    // ETag passé dans l'URL : requête « simple » au sens CORS, sans pré-requête OPTIONS
    if (String(req.query.etag || '') === m.snapshot.etag) {
      return res.status(304).end();
    }

    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Vary', 'Accept-Encoding');
    if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
      res.set('Content-Encoding', 'gzip');
      return res.send(m.gzip);
    }
    return res.send(m.json);
  };
}

module.exports = { buildSnapshot, validateSnapshot, createSnapshotHandler, slimEvent, slimTrack, SCHEMA_VERSION };
