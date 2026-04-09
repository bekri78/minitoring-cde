'use strict';

const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');

// ── Config ────────────────────────────────────────────────────────────────
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const CACHE_FILE    = path.join(process.env.CACHE_DIR || '/data', 'military-ships.json');
const SHIP_EXPIRE   = 4 * 60 * 60 * 1000;   // 4h sans signal → retiré
const TRAIL_MAX_PTS = 5;

// ── MID (3 premiers chiffres du MMSI) → couleur pays ─────────────────────
const MID_MAP = {
  '338': { country: 'USA', color: '#4a9eff' },
  '366': { country: 'USA', color: '#4a9eff' },
  '367': { country: 'USA', color: '#4a9eff' },
  '368': { country: 'USA', color: '#4a9eff' },
  '369': { country: 'USA', color: '#4a9eff' },
  '232': { country: 'GBR', color: '#60ddff' },
  '233': { country: 'GBR', color: '#60ddff' },
  '234': { country: 'GBR', color: '#60ddff' },
  '235': { country: 'GBR', color: '#60ddff' },
  '226': { country: 'FRA', color: '#5588ff' },
  '227': { country: 'FRA', color: '#5588ff' },
  '228': { country: 'FRA', color: '#5588ff' },
  '211': { country: 'DEU', color: '#aaddff' },
  '212': { country: 'DEU', color: '#aaddff' },
  '316': { country: 'CAN', color: '#88ddff' },
  '503': { country: 'AUS', color: '#66ccff' },
  '247': { country: 'ITA', color: '#99bbff' },
  '248': { country: 'ITA', color: '#99bbff' },
  '224': { country: 'ESP', color: '#aabbff' },
  '225': { country: 'ESP', color: '#aabbff' },
  '244': { country: 'NLD', color: '#88ccff' },
  '245': { country: 'NLD', color: '#88ccff' },
  '261': { country: 'POL', color: '#8899ff' },
  '273': { country: 'RUS', color: '#ff5555' },
  '412': { country: 'CHN', color: '#ff6644' },
  '413': { country: 'CHN', color: '#ff6644' },
  '414': { country: 'CHN', color: '#ff6644' },
  '477': { country: 'CHN', color: '#ff6644' },
  '431': { country: 'JPN', color: '#ffdd55' },
  '432': { country: 'JPN', color: '#ffdd55' },
  '440': { country: 'KOR', color: '#ffffaa' },
  '441': { country: 'KOR', color: '#ffffaa' },
  '419': { country: 'IND', color: '#ffcc66' },
  '422': { country: 'IRN', color: '#ff4444' },
  '378': { country: 'TUR', color: '#ffaa44' },
  '271': { country: 'TUR', color: '#ffaa44' },
  '276': { country: 'ISR', color: '#ffcc55' },
  '563': { country: 'SGP', color: '#55ffcc' },
  '525': { country: 'IDN', color: '#66ff99' },
  '636': { country: 'LBR', color: '#aabbcc' },
};

function countryFromMmsi(mmsi) {
  const s = String(mmsi).padStart(9, '0');
  // Warship pattern (ITU): MMSI = 0 + MID (3 digits) + 5 digits
  const isWarshipFormat = s.startsWith('0') && !s.startsWith('00');
  const lookupStr = isWarshipFormat ? s.slice(1) : s;
  for (let len = 3; len >= 2; len--) {
    const prefix = lookupStr.slice(0, len);
    if (MID_MAP[prefix]) return { ...MID_MAP[prefix], isWarshipFormat };
  }
  return null; // MMSI inconnu → pas militaire
}

// Patterns de noms militaires connus (OTAN + Russie + Chine)
const MILITARY_NAME_RE = /^(USS|HMS|HMAS|HDMS|HNLMS|FS |FNS |RFS |INS |ROKS |JS |TCG|ITS |ESPS|NRP|HMCS|ADMIRAL |MARSHAL |VARYAG|SLAVA|MOSKVA|KUZNETSOV|UDALOY|SOVREMEN|STOIKY|NEUSTRASH|CNS |LIAONING|SHANDONG|FUJIAN|NANJING|GUANGZHOU|HARBIN|WUHAN|HAIKOU|LANZHOU|SHIJIAZHUANG)/i;

// ── État ──────────────────────────────────────────────────────────────────
// mmsi (string) → shipMeta : { name, callsign, country, color }
const shipMeta = new Map();
// mmsi (string) → ship : { id, name, callsign, country, color, lon, lat, cog, sog, heading, lastSeen, trail }
const ships    = new Map();

let ws             = null;
let reconnectTimer = null;
let pingTimer      = null;
let wsFirstMsgLogged = false;
let reconnectDelay = 30_000;   // backoff exponentiel: 30s → 60s → 120s → max 5min
let msgCount       = 0;
let milCount       = 0;
// Log stats toutes les 60s
setInterval(() => {
  if (msgCount > 0)
    console.log(`[military-ships] stream: ${msgCount} msg/min — ${ships.size} navires affichés, ${milCount} nouveaux confirmés`);
  msgCount = 0; milCount = 0;
}, 60_000);

// ── Persistance disque ────────────────────────────────────────────────────
function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const all = raw.ships || [];
    console.log(`[military-ships] fichier cache — ${all.length} navires total, savedAt=${raw.savedAt || 'inconnu'}`);

    let loaded = 0;
    for (const s of all) {
      if (s.milVerified) { s.lastSeen = Date.now(); ships.set(s.id, s); loaded++; }
    }

    // Fallback : si aucun navire n'a le flag milVerified (ancien format), charger tous
    if (loaded === 0 && all.length > 0) {
      console.log(`[military-ships] fallback — aucun milVerified, chargement de tous les navires`);
      for (const s of all) { s.lastSeen = Date.now(); s.milVerified = true; ships.set(s.id, s); loaded++; }
    }

    console.log(`[military-ships] cache chargé — ${loaded} navires vérifiés (${all.length - loaded} ignorés)`);
  } catch (e) {
    console.log(`[military-ships] pas de cache disque — ${e.message}`);
  }
}

function saveCache() {
  try {
    const list = [...ships.values()];
    // Lire le cache existant pour comparer
    let existingCount = 0;
    try {
      const existing = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      existingCount = existing?.ships?.length || 0;
    } catch { /* pas de fichier existant */ }
    // Ne jamais écraser avec moins de bateaux que ce qui est déjà sur disque
    if (list.length < existingCount) return;
    if (list.length === 0) return;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      ships:   list,
      savedAt: new Date().toISOString(),
    }));
    console.log(`[military-ships] cache sauvegardé — ${list.length} navires`);
  } catch (e) { console.warn('[military-ships] saveCache:', e.message); }
}

// Sauvegarder proprement sur SIGTERM (Railway graceful shutdown)
process.on('SIGTERM', () => {
  saveCache();
  process.exit(0);
});

// ── Trail ─────────────────────────────────────────────────────────────────
function updateTrail(ship, lon, lat) {
  if (!ship.trail) ship.trail = [];
  const last = ship.trail[ship.trail.length - 1];
  if (last && Math.abs(last[0] - lon) < 0.001 && Math.abs(last[1] - lat) < 0.001) return;
  ship.trail.push([lon, lat]);
  if (ship.trail.length > TRAIL_MAX_PTS) ship.trail.shift();
}

function purgeOld() {
  const cutoff = Date.now() - SHIP_EXPIRE;
  for (const [mmsi, s] of ships) {
    if (s.lastSeen < cutoff) ships.delete(mmsi);
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────
function wsConnect() {
  const raw = process.env.AISSTREAM_KEY || '';
  const key = raw.trim().replace(/^=+/, ''); // nettoie espaces et = parasites
  if (!key) {
    console.warn('[military-ships] AISSTREAM_KEY manquante — module désactivé');
    return;
  }
  console.log(`[military-ships] clé utilisée: ${key.slice(0,8)}...${key.slice(-4)} (longueur: ${key.length})`);

  if (ws) { try { ws.terminate(); } catch {} ws = null; }
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);

  ws = new WebSocket(AISSTREAM_URL);

  ws.on('open', () => {
    console.log('[military-ships] WebSocket connecté → envoi souscription...');
    ws.send(JSON.stringify({
      APIKey:             key,
      BoundingBoxes:      [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
    // Keepalive ping toutes les 25s pour éviter les déconnexions idle
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 25_000);
  });

  // Réponse HTTP non-101 (ex: 401, 403, 429 rate limit)
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      console.error(`[military-ships] HTTP ${res.statusCode} rejeté par aisstream: ${body.slice(0, 200)}`);
    });
  });

  ws.on('message', (raw) => {
    msgCount++;
    // Log du premier message pour diagnostiquer les erreurs d'auth/format
    if (!wsFirstMsgLogged) {
      wsFirstMsgLogged = true;
      try {
        const preview = JSON.parse(raw);
        if (preview.error || preview.Error || preview.status === 'error') {
          console.error('[military-ships] erreur serveur:', JSON.stringify(preview));
        } else {
          console.log('[military-ships] premier msg reçu — stream OK');
        }
      } catch {}
    }
    // Reset du backoff dès qu'on reçoit des données
    reconnectDelay = 30_000;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const type = msg.MessageType;
    const meta = msg.MetaData || {};
    const mmsi = String(meta.MMSI || '');
    if (!mmsi) return;

    // ── ShipStaticData → valider seulement les vrais militaires ──────────
    if (type === 'ShipStaticData') {
      const sd   = msg.Message?.ShipStaticData || {};
      const name = (sd.Name || '').trim().replace(/@+$/, '');
      const c    = countryFromMmsi(mmsi);
      // Critère 1 : nom avec préfixe militaire (USS, HMS, RFS…) — quel que soit le pays
      const isMilName = name && MILITARY_NAME_RE.test(name);
      // Critère 2 : ShipType=35 — type AIS "Military ops", fiable sans condition de pays
      const isMilType35 = sd.Type === 35;
      if (isMilName || isMilType35) {
        const entry = {
          name:     name || mmsi,
          callsign: (sd.CallSign || '').trim(),
          country:  c ? c.country : 'MIL',
          color:    c ? c.color   : '#e8f4ff',
          confirmed: true,
        };
        shipMeta.set(mmsi, entry);
        milCount++;
        // Mettre à jour le navire si déjà connu
        const s = ships.get(mmsi);
        if (s) { s.name = entry.name; s.callsign = entry.callsign; }
      }
      return;
    }

    // ── PositionReport → accepter seulement les MMSI militaires confirmés ─
    if (type === 'PositionReport') {
      const pr  = msg.Message?.PositionReport || {};
      const lon = pr.Longitude ?? meta.longitude;
      const lat = pr.Latitude  ?? meta.latitude;
      if (lon == null || lat == null) return;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
      if (lat === 0 && lon === 0) return;

      // 1. Déjà confirmé militaire (ShipType=35 ou nom militaire) ?
      let meta2 = shipMeta.get(mmsi);

      // 2. Format MMSI warship ITU (0 + MID connu + 5 chiffres) ?
      if (!meta2) {
        const c = countryFromMmsi(mmsi);
        if (!c || !c.isWarshipFormat) return; // MMSI classique → attendre ShipStaticData
        // Format warship ITU confirmé pour une marine connue
        meta2 = { name: mmsi, callsign: '', country: c.country, color: c.color, confirmed: false };
        shipMeta.set(mmsi, meta2);
        milCount++;
      }

      let s = ships.get(mmsi);
      if (!s) {
        s = {
          id: mmsi, name: meta2.name, callsign: meta2.callsign,
          country: meta2.country, color: meta2.color,
          lon, lat, cog: 0, sog: 0, heading: null,
          lastSeen: Date.now(), trail: [],
          milVerified: true,  // flag pour le cache — seuls ces navires sont rechargés
        };
        ships.set(mmsi, s);
      }
      s.lon      = lon;
      s.lat      = lat;
      s.cog      = pr.Cog ?? 0;
      s.sog      = pr.Sog ?? 0;
      s.heading  = pr.TrueHeading !== 511 ? pr.TrueHeading : null;
      s.lastSeen = Date.now();
      updateTrail(s, lon, lat);
    }
  });

  ws.on('error', (err) => {
    console.warn('[military-ships] ws error:', err.message);
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingTimer);
    const reasonStr = reason?.toString() || '';
    console.warn(`[military-ships] ws fermé (${code})${reasonStr ? ' — ' + reasonStr : ''} — reconnexion dans ${Math.round(reconnectDelay/1000)}s`);
    ws = null;
    wsFirstMsgLogged = false;
    saveCache();
    reconnectTimer = setTimeout(wsConnect, reconnectDelay);
    // Backoff exponentiel: 30s, 60s, 2min, 4min, max 10min
    reconnectDelay = Math.min(reconnectDelay * 2, 10 * 60_000);
  });
}

// ── API ───────────────────────────────────────────────────────────────────
function getCache() {
  purgeOld();
  const list = [...ships.values()];
  return {
    ships:      list,
    count:      list.length,
    lastUpdate: new Date().toISOString(),
    connected:  ws?.readyState === WebSocket.OPEN,
  };
}

function startMilitaryShips() {
  loadCache();
  wsConnect();
  setInterval(() => { purgeOld(); saveCache(); }, 60 * 1000); // sauvegarde toutes les minutes
  setTimeout(() => saveCache(), 90 * 1000); // première sauvegarde forcée à 90s
}

module.exports = { startMilitaryShips, getCache };
