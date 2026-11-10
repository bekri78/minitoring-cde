 // ── Military Tracks (avions + bateaux) ───────────────────────

const tracksLayer    = L.layerGroup(); // air militaire
const tracksSeaLayer = L.layerGroup(); // mer militaire

let _tracksCache = [];
let _sitrepAbort = false;

const TIER_LABEL = {
    confirmed_military: '\u2b1b CONFIRMED MIL',
    likely_military:    '\u25aa LIKELY MIL',
    possible_state:     '\u25e6 POSSIBLE STATE',
    unknown:            '? UNKNOWN'
};
const TIER_COLOR = {
    confirmed_military: '#ff2244',
    likely_military:    '#ff8800',
    possible_state:     '#ffdd55',
    unknown:            '#4a6a7a'
};

const ADVERSARY_COUNTRIES = new Set([
    'RUS', 'CHN', 'IRN', 'PRK', 'BLR', 'SYR', 'VEN', 'MMR', 'CUB', 'NIC',
    'Russia', 'China', 'Iran', 'North Korea', 'Belarus', 'Syria',
    'Venezuela', 'Myanmar', 'Cuba', 'Nicaragua'
]);

function trackColor(t) {
    if (ADVERSARY_COUNTRIES.has(t.country)) return '#ff3300';
    return t.color || TIER_COLOR[t.milTier] || '#4a6a7a';
}

const SVG_BOAT = `<path d="M270 1805 l0 -115 -51 0 c-47 0 -50 -2 -47 -22 3 -20 9 -23 51 -23 l47 0 0 -57 0 -58 -135 0 -135 0 0 -35 0 -34 57 -3 58 -3 3 -252 2 -253 190 0 190 0 0 253 1 252 46 35 47 35 -142 3 -142 3 0 54 0 55 50 0 c47 0 50 2 50 25 0 23 -3 25 -50 25 l-50 0 0 115 c0 108 -1 115 -20 115 -19 0 -20 -7 -20 -115z m160 -465 l0 -60 -60 0 -60 0 0 60 0 60 60 0 60 0 0 -60z m0 -185 l0 -55 -60 0 -60 0 0 55 0 55 60 0 60 0 0 -55z"/><path d="M1057 1444 c-13 -13 -8 -469 5 -482 18 -18 302 -17 317 2 8 9 11 83 9 247 l-3 234 -161 3 c-88 1 -163 -1 -167 -4z"/><path d="M596 1324 c-13 -13 -16 -44 -16 -183 0 -116 4 -171 12 -179 8 -8 63 -12 179 -12 139 0 170 3 183 16 24 23 24 335 0 358 -13 13 -44 16 -179 16 -135 0 -166 -3 -179 -16z"/><path d="M1480 1281 c-14 -28 -13 -184 2 -199 17 -17 349 -17 366 0 15 15 16 171 2 199 -10 18 -23 19 -185 19 -162 0 -175 -1 -185 -19z"/><path d="M1473 978 c-12 -6 -27 -23 -34 -39 l-11 -29 -695 0 -695 0 4 -102 c5 -133 32 -196 120 -280 l61 -59 -6 -58 c-4 -38 -2 -62 5 -69 16 -16 1585 -17 1641 -1 69 19 105 62 179 217 37 78 99 207 137 287 l70 145 -377 -1 c-242 0 -385 -4 -399 -11z"/>`;

const SVG_HELO = `<path d="M5660 6216 l0 -94 -66 -138 c-36 -77 -81 -170 -99 -209 -18 -38 -61 -128 -95 -200 -34 -71 -71 -149 -81 -173 l-19 -43 -42 25 c-40 23 -308 91 -331 83 -5 -1 30 -40 79 -86 63 -60 85 -87 78 -96 -5 -7 -55 -66 -110 -131 -56 -66 -170 -200 -254 -299 -83 -99 -155 -183 -159 -188 -4 -4 -21 -1 -37 7 -16 8 -52 24 -80 35 -50 19 -53 19 -68 2 -21 -23 -20 -57 2 -71 15 -10 14 -10 -5 -5 -42 11 -61 -68 -20 -84 12 -5 35 -14 51 -20 16 -7 26 -14 23 -17 -3 -3 -27 4 -54 16 l-48 21 -18 -23 c-11 -12 -17 -32 -14 -45 3 -19 -1 -24 -22 -29 -107 -24 -139 -43 -166 -95 -9 -16 -19 -29 -23 -29 -4 0 -21 26 -38 58 -17 31 -131 244 -254 472 -122 228 -269 501 -325 605 -56 105 -141 263 -189 352 l-86 161 -91 56 -90 56 -84 -37 c-47 -21 -85 -41 -85 -45 0 -3 33 -33 74 -65 81 -63 59 -28 314 -508 30 -55 109 -203 177 -330 67 -126 148 -277 178 -335 31 -58 96 -179 145 -270 77 -143 87 -167 76 -181 -8 -9 -11 -19 -7 -24 5 -4 0 -5 -9 -2 -19 7 -43 -17 -33 -33 4 -7 0 -10 -11 -8 -12 2 -23 -6 -29 -19 -6 -14 -16 -21 -25 -18 -14 4 -1331 379 -1485 423 -48 13 -69 24 -67 33 2 8 53 133 113 278 60 145 109 266 109 270 0 3 -46 26 -102 50 -57 25 -172 76 -257 114 l-154 70 -18 -24 c-10 -13 -116 -148 -236 -299 -212 -266 -220 -275 -253 -275 -32 1 -222 45 -800 185 -113 27 -216 52 -230 55 -17 4 -12 -1 15 -16 22 -12 141 -83 265 -159 124 -76 317 -195 430 -264 l205 -125 -1 -63 c-1 -35 -18 -209 -39 -386 -20 -178 -35 -325 -33 -328 2 -2 121 -48 265 -102 l261 -99 113 279 c62 153 117 278 121 278 5 0 138 -71 296 -159 388 -215 819 -452 980 -540 72 -40 134 -76 137 -81 5 -7 -50 -12 -370 -30 -93 -5 -206 -12 -250 -15 -266 -17 -496 -36 -502 -43 -3 -3 -3 -19 0 -35 5 -27 9 -29 78 -37 40 -5 151 -16 247 -24 96 -9 184 -18 196 -21 l22 -5 -22 -18 c-22 -17 -22 -19 -7 -49 15 -29 20 -32 60 -32 l43 0 0 -50 0 -50 -57 0 c-58 0 -63 -4 -63 -50 0 -22 4 -25 38 -25 l37 -1 -38 -18 -37 -18 0 -64 c0 -64 0 -64 28 -64 l28 0 -26 -22 c-19 -16 -26 -31 -24 -50 2 -23 11 -30 54 -43 l51 -15 -31 -22 c-40 -29 -40 -55 0 -81 l30 -19 0 -107 0 -106 -32 -18 c-29 -15 -33 -22 -33 -56 0 -34 4 -41 33 -55 l32 -16 3 -122 3 -123 -33 -16 c-29 -14 -33 -21 -33 -55 0 -34 4 -41 33 -55 l32 -16 3 -1428 2 -1427 105 0 105 0 2 1427 3 1428 33 16 c28 14 32 21 32 55 0 34 -4 41 -32 55 l-33 16 0 123 0 122 33 16 c28 14 32 21 32 55 0 34 -4 41 -32 55 l-33 18 0 107 0 108 30 17 c40 23 40 57 0 81 l-30 19 51 15 c43 13 52 20 54 43 2 19 -5 34 -24 50 l-26 22 28 0 c28 0 28 0 25 58 l-3 57 38 18 37 17 -37 0 c-34 0 -38 3 -38 25 0 46 -5 50 -63 50 l-57 0 0 50 0 50 43 0 c40 0 45 3 60 33 15 29 15 31 -8 49 l-23 18 23 5 c12 3 100 12 196 21 96 8 207 19 247 24 69 8 73 10 78 37 3 16 3 32 0 35 -6 7 -236 26 -502 43 -44 3 -157 10 -250 15 -320 18 -375 23 -370 30 3 5 65 41 137 81 161 88 592 325 980 540 158 88 291 159 296 159 4 0 59 -125 121 -278 l113 -279 261 99 c144 54 263 100 265 102 2 3 -13 150 -33 328 -21 177 -38 351 -39 386 l-1 63 205 125 c113 69 306 188 430 264 124 76 243 147 265 159 27 15 32 20 15 16 -14 -3 -117 -28 -230 -55 -578 -140 -768 -184 -800 -185 -33 0 -41 9 -253 275 -120 151 -226 286 -236 299 l-18 24 -154 -70 c-85 -38 -200 -89 -257 -114 -56 -24 -102 -47 -102 -50 0 -4 49 -125 109 -270 60 -145 111 -270 113 -278 2 -9 -19 -20 -67 -33 -154 -44 -1471 -419 -1485 -423 -9 -3 -13 2 -11 8 10 16 -14 40 -33 33 -9 -3 -15 -2 -11 2 4 5 -2 15 -13 22 -18 11 -9 38 68 181 49 91 114 212 145 270 30 58 111 209 178 335 67 127 147 275 177 330 255 480 233 445 314 508 41 32 74 62 74 65 0 4 -38 24 -85 45 l-84 37 -90 -56 -91 -56 -86 -161 c-48 -89 -133 -247 -189 -352 -56 -104 -203 -377 -325 -605 -123 -228 -237 -441 -254 -472 -17 -32 -34 -58 -38 -58 -4 0 -14 13 -23 29 -27 52 -59 71 -166 95 -21 5 -25 10 -22 29 3 13 -3 33 -14 45 l-18 23 -48 -21 c-27 -12 -51 -19 -54 -16 -3 3 7 10 23 17 16 6 39 15 51 20 41 16 22 95 -20 84 -19 -5 -20 -5 -5 5 22 14 23 48 2 71 -15 17 -18 17 -68 -2 -28 -11 -64 -27 -80 -35 -16 -8 -33 -11 -37 -7 -4 5 -76 89 -159 188 -84 99 -198 233 -254 299 -55 65 -105 124 -110 131 -7 9 15 36 78 96 49 46 84 85 79 86 -23 8 -291 -60 -331 -83 l-42 -25 -19 43 c-10 24 -47 102 -81 173 -34 72 -77 162 -95 200 -18 39 -63 132 -99 209 l-66 138 0 94 0 94 -105 0 -105 0 0 -94z"/>`;

function trackIcon(t) {
    const color = trackColor(t);
    let html;
    if (t.domain === 'sea') {
        html = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 225 225" width="22" height="22"><g transform="translate(0,225) scale(0.1,-0.1)" fill="${color}" stroke="none">${SVG_BOAT}</g></svg>`;
    } else if (t.isHelicopter) {
        html = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 669" width="18" height="15"><g transform="translate(0,669) scale(0.1,-0.1)" fill="${color}" stroke="none">${SVG_HELO}</g></svg>`;
    } else {
        const rotation = t.heading != null ? t.heading - 90 : 0;
        html = `<div style="font-size:24px;line-height:1;color:${color};transform:rotate(${rotation}deg);display:inline-block;">\u2708</div>`;
    }
    // Point discret de loin, silhouette de près (classe og-near sur la carte)
    const far = t.domain === 'sea' ? '#5f8fa8' : '#7c8db5';
    const adv = ADVERSARY_COUNTRIES.has(t.country);
    return L.divIcon({
        html: '<span class="og-trk"><span class="og-trk-dot" style="background:' + (adv ? '#f2994a' : far) + '"></span><span class="og-trk-full">' + html + '</span></span>',
        iconSize: [28, 24],
        iconAnchor: [14, 12],
        popupAnchor: [0, -10],
        className: ''
    });
}

function buildTrackAirPopup(t) {
    const tc = trackColor(t);
    const popId = 'ac-' + t.id;
    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            <span style="padding:2px 8px;font-size:9px;background:${tc}22;color:${tc};border:1px solid ${tc}55;">${escapeHtml(TIER_LABEL[t.milTier] || t.milTier)}</span>
            <span style="padding:2px 8px;font-size:9px;background:#1a2a3a;color:#c8d8e8;border:1px solid #2a3a4a;">${escapeHtml(t.country)}</span>
            <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${t.milScore}%</span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 6px 0;font-size:13px;letter-spacing:2px;">${escapeHtml(t.callsign || t.name || t.id)}</p>
        <div id="${popId}-photo" style="margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
            <div><span style="color:#4a6a7a;">ALTITUDE</span><br><span style="color:#c8d8e8;">${t.altFt != null ? Number(t.altFt).toLocaleString() + ' ft' : '\u2014'}</span></div>
            <div><span style="color:#4a6a7a;">VITESSE</span><br><span style="color:#c8d8e8;">${t.speed != null ? t.speed + ' kt' : '\u2014'}</span></div>
            <div><span style="color:#4a6a7a;">CAP</span><br><span style="color:#c8d8e8;">${t.heading != null ? Math.round(t.heading) + '\u00b0' : '\u2014'}</span></div>
        </div>
        <div style="margin-top:6px;font-size:9px;color:#4a6a7a;">${t.lat.toFixed(3)}\u00b0, ${t.lon.toFixed(3)}\u00b0 \u2014 ICAO ${escapeHtml(t.id)}</div>
    `);
}

function buildTrackSeaPopup(t) {
    const tc = trackColor(t);
    const popId = 'sh-' + t.id;
    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            <span style="padding:2px 8px;font-size:9px;background:${tc}22;color:${tc};border:1px solid ${tc}55;">${escapeHtml(TIER_LABEL[t.milTier] || t.milTier)}</span>
            <span style="padding:2px 8px;font-size:9px;background:#1a2a3a;color:#c8d8e8;border:1px solid #2a3a4a;">${escapeHtml(t.country)}</span>
            <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${t.milScore}%</span>
        </div>
        <p style="color:#e8f4ff;margin:0 0 4px 0;font-size:13px;letter-spacing:1px;">${escapeHtml(t.name || t.id)}</p>
        ${t.callsign
            ? `<p style="color:#8ab4c8;margin:0 0 8px 0;font-size:10px;">MMSI ${escapeHtml(t.id)} \u00b7 ${escapeHtml(t.callsign)}</p>`
            : `<p style="color:#4a6a7a;margin:0 0 8px 0;font-size:9px;">MMSI ${escapeHtml(t.id)}</p>`}
        <div id="${popId}-photo" style="margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
            <div><span style="color:#4a6a7a;">VITESSE</span><br><span style="color:#c8d8e8;">${t.sog != null ? Number(t.sog).toFixed(1) + ' kt' : '\u2014'}</span></div>
            <div><span style="color:#4a6a7a;">ROUTE</span><br><span style="color:#c8d8e8;">${t.cog != null ? Math.round(t.cog) + '\u00b0' : '\u2014'}</span></div>
            <div><span style="color:#4a6a7a;">CAP VRAI</span><br><span style="color:#c8d8e8;">${t.heading != null ? Math.round(t.heading) + '\u00b0' : '\u2014'}</span></div>
        </div>
        <div style="margin-top:6px;font-size:9px;color:#4a6a7a;">${t.lat.toFixed(3)}\u00b0, ${t.lon.toFixed(3)}\u00b0</div>
    `);
}

function renderTracks(tracks) {
    _tracksCache = tracks;
    tracksLayer.clearLayers();
    tracksSeaLayer.clearLayers();

    tracks.forEach(function (t) {
        if (t.lat == null || t.lon == null) return;
        const marker = L.marker([t.lat, t.lon], { icon: trackIcon(t), zIndexOffset: -500 });
        if (t.domain === 'air') {
            const popId = 'ac-' + t.id;
            marker.bindPopup(buildTrackAirPopup(t), { maxWidth: 360 });
            marker.on('popupopen', function () {
                loadPlanePhoto(t.id, document.getElementById(popId + '-photo'));
            });
            tracksLayer.addLayer(marker);
        } else {
            const popId = 'sh-' + t.id;
            marker.bindPopup(buildTrackSeaPopup(t), { maxWidth: 360 });
            marker.on('popupopen', function () {
                loadShipPhoto(t.id, t.country || '', document.getElementById(popId + '-photo'));
            });
            tracksSeaLayer.addLayer(marker);
        }
    });

    if (['ALL', 'AIR'].indexOf(_activeFilter) !== -1) {
        if (!maCarte.hasLayer(tracksLayer)) tracksLayer.addTo(maCarte);
    }
    if (['ALL', 'SEA'].indexOf(_activeFilter) !== -1) {
        if (!maCarte.hasLayer(tracksSeaLayer)) tracksSeaLayer.addTo(maCarte);
    }
    hdrUpdateCount('tracks', tracks.length);
}

// ── SITREP IA ─────────────────────────────────────────────────
function openSitrep() {
    const modal = document.getElementById('sitrep-modal');
    modal.style.display = 'flex';
    _sitrepAbort = false;

    const now = new Date();
    const dtStr = now.toISOString().replace('T', ' ').substring(0, 16) + 'Z';
    document.getElementById('sitrep-datetime').textContent = dtStr;

    const reportEl = document.getElementById('sitrep-report');
    reportEl.innerHTML = '<span style="color:#4a6a7a;font-size:9px;animation:pulse 1s infinite;">Génération en cours…</span>';

    const airTracks = _tracksCache.filter(function (t) { return t.domain === 'air'; });
    const seaTracks = _tracksCache.filter(function (t) { return t.domain !== 'air'; });

    function groupByCountry(tracks) {
        const map = {};
        tracks.forEach(function (t) {
            const c = t.country || 'UNKNOWN';
            map[c] = (map[c] || 0) + 1;
        });
        return Object.entries(map).sort(function (a, b) { return b[1] - a[1]; });
    }

    const adversaryAir = airTracks.filter(function (t) { return ADVERSARY_COUNTRIES.has(t.country); });
    const adversarySea = seaTracks.filter(function (t) { return ADVERSARY_COUNTRIES.has(t.country); });

    const tensionZones = (typeof _signalsZonesCache !== 'undefined' ? _signalsZonesCache : [])
        .slice().sort(function (a, b) { return (b.event_count || 0) - (a.event_count || 0); })
        .slice(0, 5);

    document.getElementById('sitrep-stats').innerHTML =
        '<span style="color:#c8d8e8;">\u2708 ' + airTracks.length + ' AIR</span>' +
        '<span style="color:#4a6a7a;margin:0 8px;">|</span>' +
        '<span style="color:#c8d8e8;">\u2693 ' + seaTracks.length + ' SEA</span>' +
        '<span style="color:#4a6a7a;margin:0 8px;">|</span>' +
        '<span style="color:#ff5533;">\u26a0 ' + (adversaryAir.length + adversarySea.length) + ' ADV</span>' +
        '<span style="color:#4a6a7a;margin:0 8px;">|</span>' +
        '<span style="color:#ffdd55;">\u25c8 ' + tensionZones.length + ' ZONES</span>';

    // Construction du contexte enrichi pour l'IA
    const airByCountry = groupByCountry(airTracks);
    const seaByCountry = groupByCountry(seaTracks);

    const airDetail = airByCountry.slice(0, 8).map(function (x) {
        const isAdv = ADVERSARY_COUNTRIES.has(x[0]);
        const sample = airTracks.filter(function (t) { return t.country === x[0]; })
            .slice(0, 2).map(function (t) { return t.callsign || t.id; }).join(', ');
        return '  - ' + x[0] + ' : ' + x[1] + ' aéronefs' + (isAdv ? ' [ADVERSAIRE]' : '') + (sample ? ' (ex: ' + sample + ')' : '');
    }).join('\n');

    const seaDetail = seaByCountry.slice(0, 8).map(function (x) {
        const isAdv = ADVERSARY_COUNTRIES.has(x[0]);
        const sample = seaTracks.filter(function (t) { return t.country === x[0]; })
            .slice(0, 2).map(function (t) { return t.name || t.id; }).join(', ');
        return '  - ' + x[0] + ' : ' + x[1] + ' bâtiments' + (isAdv ? ' [ADVERSAIRE]' : '') + (sample ? ' (ex: ' + sample + ')' : '');
    }).join('\n');

    const zonesDetail = tensionZones.map(function (z, i) {
        const nom = z.location_name || z.country || z.id || ('Zone ' + (i + 1));
        const kps = (z.key_points || []).slice(0, 3).map(function (kp) {
            return '    • [' + (kp.category || '?') + '] ' + (kp.point || '');
        }).join('\n');
        return '  - ' + nom + ' | niveau ' + (z.tension_level || '?') + ' | ' + (z.event_count || 0) + ' signaux\n'
            + (z.summary ? '    Contexte: ' + z.summary + '\n' : '')
            + (kps ? kps : '');
    }).join('\n');

    const dataBlock = [
        '=== DONNÉES BRUTES DU TABLEAU DE BORD ===',
        '',
        'CONTACTS AÉRIENS MILITAIRES (' + airTracks.length + ' total, ' + adversaryAir.length + ' adversaires) :',
        airDetail || '  Aucun',
        '',
        'CONTACTS MARITIMES MILITAIRES (' + seaTracks.length + ' total, ' + adversarySea.length + ' adversaires) :',
        seaDetail || '  Aucun',
        '',
        'ZONES DE TENSION GÉOPOLITIQUE (' + tensionZones.length + ' zones actives) :',
        zonesDetail || '  Aucune zone active'
    ].join('\n');

    const messages = [
        {
            role: 'system',
            content: [
                'Tu es un analyste stratégique senior combinant expertise militaire et géopolitique.',
                'À partir de données de surveillance en temps réel (ADS-B aérien, AIS maritime, signaux géopolitiques),',
                'tu dois produire une analyse opérationnelle approfondie, structurée en 4 sections :',
                '',
                '**SITUATION GÉNÉRALE** — En 4-5 phrases, dresse un tableau d\'ensemble narratif de la situation mondiale à cet instant :',
                'quels sont les foyers d\'instabilité, comment se positionnent les grandes puissances, y a-t-il une logique d\'ensemble',
                'dans les déploiements observés ? Ne récite pas les chiffres : interprète-les.',
                '',
                '**DYNAMIQUES AÉRIENNES & MARITIMES** — Analyse croisée air+mer : quels pays montrent une posture agressive ou défensive,',
                'quels déploiements sont inhabituels ou préoccupants, y a-t-il des convergences géographiques à noter ?',
                'Contextualise par rapport aux tensions géopolitiques connues.',
                '',
                '**ANALYSE DES ZONES DE CRISE** — Pour chaque zone de tension, développe une analyse narrative :',
                'acteurs impliqués, dynamiques récentes, risque d\'escalade, liens avec les déploiements militaires observés.',
                'Cite les signaux concrets qui motivent ton évaluation.',
                '',
                '**PERSPECTIVES 24-48H** — Quels scénarios d\'évolution sont plausibles ? Quels signaux faibles surveiller ?',
                'Y a-t-il des risques de conjonction entre plusieurs crises ?',
                '',
                'Style : analytique, narratif, argumenté. Évite les listes à tirets sauf pour des énumérations courtes.',
                'Ton analyse doit apporter une vraie valeur ajoutée, pas une simple reformulation des chiffres. En français.'
            ].join('\n')
        },
        {
            role: 'user',
            content: ['Analyse demandée le ' + dtStr, '', dataBlock].join('\n')
        }
    ];

    let output = '';
    APP.Genial.chatStream(messages, function (chunk) {
        if (_sitrepAbort) return;
        output += chunk;
        reportEl.innerHTML = output
            .replace(/\r\n/g, '\n')
            .replace(/^\*{0,2}(#{1,4})\s+(.+?)\*{0,2}$/gm, '$1 $2')
            .replace(/^## (.+)$/gm, '<span style="display:block;color:#ff8800;font-weight:bold;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-top:8px;border-bottom:1px solid #2a3a4a;padding-bottom:2px;">$1</span>')
            .replace(/^#{3,4} (.+)$/gm, '<span style="display:block;color:#ffcc44;font-weight:bold;font-size:11px;letter-spacing:1px;margin-top:6px;">$1</span>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#ff8800;letter-spacing:1px;">$1</strong>')
            .replace(/\n/g, '<br>');
    }, null, { profile: 'brief' }).catch(function (e) {
        if (!_sitrepAbort) reportEl.textContent = 'Point de situation indisponible : ' + (e.message || e) + '.';
    });
}

function closeSitrep() {
    _sitrepAbort = true;
    document.getElementById('sitrep-modal').style.display = 'none';
}