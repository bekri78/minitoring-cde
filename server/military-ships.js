'use strict';

const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');

// ── Config ────────────────────────────────────────────────────────────────
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const CACHE_FILE    = path.join(process.env.CACHE_DIR || '/data', 'military-ships.json');
const SHIP_EXPIRE   = 30 * 60 * 1000;   // 30min sans signal → retiré
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
  for (let len = 3; len >= 2; len--) {
    const prefix = s.slice(0, len);
    if (MID_MAP[prefix]) return MID_MAP[prefix];
  }
  return { country: 'MIL', color: '#e8f4ff' };
}

// ── État ──────────────────────────────────────────────────────────────────
// mmsi (string) → shipMeta : { name, callsign, country, color }
const shipMeta = new Map();
// mmsi (string) → ship : { id, name, callsign, country, color, lon, lat, cog, sog, heading, lastSeen, trail }
const ships    = new Map();

let ws             = null;
let reconnectTimer = null;
let wsFirstMsgLogged = false;
let msgCount       = 0;
let milCount       = 0;
// Log stats toutes les 60s
setInterval(() => {
  if (msgCount > 0)
    console.log(`[military-ships] stream: ${msgCount} msg/min, ${ships.size} navires mil, ${milCount} détectés`);
  msgCount = 0; milCount = 0;
}, 60_000);

// ── Persistance disque ────────────────────────────────────────────────────
function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    for (const s of (raw.ships || [])) ships.set(s.id, s);
    console.log(`[military-ships] cache chargé — ${ships.size} navires`);
  } catch { /* premier démarrage */ }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      ships:   [...ships.values()],
      savedAt: new Date().toISOString(),
    }));
  } catch (e) { console.warn('[military-ships] saveCache:', e.message); }
}

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

  ws = new WebSocket(AISSTREAM_URL);

  ws.on('open', () => {
    console.log('[military-ships] WebSocket connecté → abonnement global ShipType=35');
    ws.send(JSON.stringify({
      APIKey:             key,
      BoundingBoxes:      [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
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
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const type = msg.MessageType;
    const meta = msg.MetaData || {};
    const mmsi = String(meta.MMSI || '');
    if (!mmsi) return;

    // ── ShipStaticData → enregistrer/enrichir si ShipType = 35 ──────────
    if (type === 'ShipStaticData') {
      const sd = msg.Message?.ShipStaticData || {};
      if (sd.Type === 35) {
        const c = countryFromMmsi(mmsi);
        shipMeta.set(mmsi, {
          name:     (sd.Name || '').trim().replace(/@+$/, '') || mmsi,
          callsign: (sd.CallSign || '').trim(),
          country:  c.country,
          color:    c.color,
        });
        // Mettre à jour le navire si déjà connu
        const s = ships.get(mmsi);
        if (s) {
          const m = shipMeta.get(mmsi);
          s.name = m.name; s.callsign = m.callsign;
        }
      }
      return;
    }

    // ── PositionReport → identifier par MMSI (MID) directement ──────────
    // On n'attend plus ShipStaticData — on détecte via le préfixe MMSI
    if (type === 'PositionReport') {
      const pr  = msg.Message?.PositionReport || {};
      const lon = pr.Longitude ?? meta.longitude;
      const lat = pr.Latitude  ?? meta.latitude;
      if (lon == null || lat == null) return;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
      if (lat === 0 && lon === 0) return;

      // Est-ce un MMSI militaire connu (déjà reçu via ShipStaticData) ?
      let meta2 = shipMeta.get(mmsi);

      // Sinon : vérifier si le MID correspond à une marine connue
      if (!meta2) {
        const c = countryFromMmsi(mmsi);
        // countryFromMmsi retourne 'MIL' + '#e8f4ff' si inconnu — on ignore ces cas
        if (c.country === 'MIL') return;
        // MMSI d'une marine connue mais pas encore vu en ShipStaticData
        meta2 = { name: mmsi, callsign: '', country: c.country, color: c.color };
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

  ws.on('close', (code) => {
    console.warn(`[military-ships] ws fermé (${code}) — reconnexion dans 30s`);
    ws = null;
    wsFirstMsgLogged = false; // reset pour le prochain connect
    saveCache();
    reconnectTimer = setTimeout(wsConnect, 30_000);
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
  setInterval(() => { purgeOld(); saveCache(); }, 5 * 60 * 1000);
}

module.exports = { startMilitaryShips, getCache };
