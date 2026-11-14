 // ── Space — Lancements & Débris orbitaux ─────────────────────

const spaceLayer = L.layerGroup();

function spaceStatusColor(status) {
    const s = (typeof status === 'object' ? (status.label || '') : (status || '')).toLowerCase();
    if (s.includes('go'))      return '#00d4ff';
    if (s.includes('success')) return '#00ff88';
    if (s.includes('failure')) return '#ff2244';
    return '#ffaa00';
}

function _injectSpaceCSS() {
    if (document.getElementById('space-pulse-style')) return;
    const s = document.createElement('style');
    s.id = 'space-pulse-style';
    s.textContent = '@keyframes rocket-pulse{0%{transform:scale(.9);opacity:.7}100%{transform:scale(2.6);opacity:0}}';
    document.head.appendChild(s);
}

function isUpcomingLaunch(net) {
    if (!net) return false;
    const t = new Date(net).getTime();
    const now = Date.now();
    return t >= now - 3600000 && t <= now + 86400000;
}

// Images dédiées : fusée pour un lancement (ambre + halo pulsé si dans l'heure passée ou les 24 h à venir),
// objet en chute avec sa traînée pour une rentrée atmosphérique.
const OG_SVG_ROCKET = '<svg class="og-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
    + '<path d="M12 1.5c2.6 2 4 5.2 4 9v4.6l2.6 2.4v3l-3.4-1.6H8.8l-3.4 1.6v-3L8 15.1v-4.6c0-3.8 1.4-7 4-9zm0 6.3a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"/>'
    + '<path d="M10.2 20h3.6L12 23z" class="og-ico-flame"/></svg>';
// v47 : rentrée = trajectoire (objet cerclé de rouge + ligne de descente) ; l'objet marque le point de rentrée
const OG_SVG_REENTRY = '<svg class="og-met-svg" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">'
    + '<circle cx="27" cy="27" r="9" fill="none" stroke="#e5484d" stroke-width="2" opacity=".55"/>'
    + '<path d="M5 5 L22 22" stroke="#ff8a8d" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 3.5" opacity=".9"/>'
    + '<circle cx="27" cy="27" r="4.6" fill="#fff" stroke="#e5484d" stroke-width="2"/>'
    + '</svg>';

function rocketIcon(color, pulse) {
    return L.divIcon({
        html: '<span class="og-spc og-spc-launch' + (pulse ? ' og-spc-soon' : '') + '">' + OG_SVG_ROCKET + '</span>',
        iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10], className: ''
    });
}

// Rentrée atmosphérique (RAR) : objet potentiellement dangereux → trajectoire avec halo
// rouge pulsé centré sur l'objet (point de rentrée), étiquette permanente heure + coordonnées.
function debrisIcon() {
    return L.divIcon({
        html: '<span class="og-met"><span class="og-met-pulse"></span>' + OG_SVG_REENTRY + '</span>',
        iconSize: [40, 40], iconAnchor: [27, 27], popupAnchor: [0, -14], className: ''
    });
}

// 23,41° N · 45,12° E
function ogCoord(lat, lon) {
    const f = function (v) { return Math.abs(v).toFixed(2).replace('.', ','); };
    return f(lat) + '\u00b0 ' + (lat >= 0 ? 'N' : 'S') + ' \u00b7 ' + f(lon) + '\u00b0 ' + (lon >= 0 ? 'E' : 'O');
}
function _rarWhen(obj) {
    const epoch = obj.decayEpoch || obj.DECAY_EPOCH || null;
    const d = epoch ? new Date(String(epoch).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(epoch) ? '' : 'Z')) : null;
    return d && !isNaN(d) ? d : null;
}
function _rarLabel(obj) {
    const d = _rarWhen(obj);
    const when = d ? String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + ' '
        + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UTC' : 'date inconnue';
    return '<b>Rentrée · ' + when + '</b><span>' + ogCoord(obj.lat, obj.lon) + '</span>';
}

function buildLaunchContent(lc) {
    const color       = spaceStatusColor(lc.status);
    const statusLabel = typeof lc.status === 'object' ? (lc.status.label || '\u2014') : (lc.status || '\u2014');
    const padName     = typeof lc.pad    === 'object' ? (lc.pad.name    || '\u2014') : (lc.pad    || '\u2014');
    const net         = lc.net ? new Date(lc.net).toISOString().replace('T', ' ').substring(0, 16) + ' UTC' : '\u2014';
    const upcoming    = isUpcomingLaunch(lc.net);
    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            ${badge('LANCEMENT', color)}
            ${badge(statusLabel, color)}
            ${upcoming ? badge('\u26a1 AUJOURD\u0027HUI', '#00ff88') : ''}
        </div>
        <p style="color:#e8f4ff;margin:0 0 6px 0;font-size:12px;line-height:1.4;">${escapeHtml(lc.name || '\u2014')}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;margin-bottom:6px;">
            <div><span style="color:#4a6a7a;">OP\u00c9RATEUR</span><br><span style="color:#c8d8e8;">${escapeHtml(lc.provider || '\u2014')}</span></div>
            <div><span style="color:#4a6a7a;">T-0</span><br><span style="color:${color};">${escapeHtml(net)}</span></div>
        </div>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
            \uD83D\uDCCD ${escapeHtml(padName)}
        </div>
    `);
}

function buildDecayContent(obj) {
    // Champs normalisés par le serveur (name, id, country, decayEpoch…),
    // avec repli sur les noms bruts de Space-Track pour les anciens caches.
    const name    = obj.name || obj.OBJECT_NAME || '\u2014';
    const norad   = obj.id || obj.NORAD_CAT_ID || '\u2014';
    const country = obj.country || obj.COUNTRY || '\u2014';
    const epoch   = obj.decayEpoch || obj.DECAY_EPOCH || null;
    const when    = epoch ? new Date(String(epoch).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(epoch) ? '' : 'Z')) : null;
    const whenTxt = when && !isNaN(when) ? when.toISOString().replace('T', ' ').substring(0, 16) + ' UTC' : (epoch || '\u2014');
    const window  = obj.window ? ' (\u00b1 ' + obj.window + (obj.lat != null && obj.highInterest !== undefined ? ' min' : ' h') + ')' : '';
    const color   = obj.color || '#ffaa00';
    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            ${badge('RENTR\u00c9E ATMOSPH\u00c9RIQUE', color)}
            ${obj.highInterest ? badge('INT\u00c9R\u00caT \u00c9LEV\u00c9', '#ff2244') : ''}
        </div>
        <p style="color:#e8f4ff;margin:0 0 6px 0;font-size:12px;">${escapeHtml(name)}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;">
            <div><span style="color:#4a6a7a;">NORAD ID</span><br><span style="color:#c8d8e8;">${escapeHtml(String(norad))}</span></div>
            <div><span style="color:#4a6a7a;">PAYS</span><br><span style="color:#c8d8e8;">${escapeHtml(country)}</span></div>
        </div>
        <div style="font-size:9px;color:${color};border-top:1px solid #1a2a3a;padding-top:6px;margin-top:6px;">
            Rentr\u00e9e estim\u00e9e : ${escapeHtml(whenTxt + window)}
        </div>
        <div style="margin-top:6px;font-size:9px;color:#4a6a7a;">POINT DE RENTR\u00c9E</div>
        <div class="og-rar-coord">${typeof obj.lat === 'number' ? escapeHtml(ogCoord(obj.lat, obj.lon)) : '\u2014'}</div>
        <div style="font-size:9px;color:#4a6a7a;">${typeof obj.lat === 'number' ? 'D\u00e9cimal : ' + obj.lat.toFixed(4) + ', ' + obj.lon.toFixed(4) : ''}</div>
        <div style="font-size:8px;color:#4a6a7a;margin-top:6px;line-height:1.4;">
            Position : point de rentr\u00e9e calcul\u00e9 par Space-Track (bulletin TIP).
            ${obj.kind ? '<br>Type : ' + escapeHtml(obj.kind) + (obj.rcsSize ? ' (taille ' + escapeHtml(String(obj.rcsSize).toLowerCase()) + ')' : '') : ''}
        </div>
    `);
}

function renderSpace(spaceData) {
    spaceLayer.clearLayers();
    _injectSpaceCSS();
    const launches  = (spaceData.launches  || []).concat(spaceData.previous || []);
    // TIP (point de chute calculé) prioritaire ; un objet présent dans les deux n'apparaît qu'une fois
    // Seuls les objets dont Space-Track a calculé le point de rentrée (bulletin TIP)
    // sont placés : une prévision DECAY ne donne qu'une date, pas de lieu.
    // Un objet = un seul point, bulletin le plus récent.
    const byId = {};
    (spaceData.tip || []).forEach(function (o) {
        const k = String(o.id), p = byId[k];
        if (!p || String(o.msgEpoch || '') > String(p.msgEpoch || '')) byId[k] = o;
    });
    const decayList = Object.keys(byId).map(function (k) { return byId[k]; });

    launches.forEach(function (lc) {
        const pad = lc.pad || {};
        const lat = pad.lat != null ? pad.lat : null;
        const lon = pad.lon != null ? pad.lon : null;
        if (lat == null || lon == null) return;
        const color  = spaceStatusColor(lc.status);
        const pulse  = isUpcomingLaunch(lc.net);
        const marker = L.marker([lat, lon], { icon: rocketIcon(color, pulse), zIndexOffset: pulse ? 200 : 100 });
        marker.bindPopup(buildLaunchContent(lc), { maxWidth: 320 });
        spaceLayer.addLayer(marker);
    });

    decayList.forEach(function (obj) {
        if (typeof obj.lat !== 'number' || typeof obj.lon !== 'number') return;
        const marker = L.marker([obj.lat, obj.lon], { icon: debrisIcon(), zIndexOffset: 1500, title: 'Rentrée atmosphérique — ' + (obj.name || '') });
        marker.bindPopup(buildDecayContent(obj), { maxWidth: 300 });
        // v47 : plus d'étiquette permanente (carte trop chargée) ; heure et coordonnées dans la fiche
        spaceLayer.addLayer(marker);
    });

    if (!maCarte.hasLayer(spaceLayer)) spaceLayer.addTo(maCarte);
    hdrUpdateCount('space', launches.length + decayList.length);
    console.log(`Space: ${launches.length} lancements, ${decayList.length} rentrées chargés`);
}

