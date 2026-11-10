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

function rocketIcon(color, pulse) {
    if (pulse) {
        return L.divIcon({
            html: `<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center;">` +
                  `<div style="position:absolute;top:0;left:0;width:22px;height:22px;border-radius:50%;border:1px solid ${color};animation:rocket-pulse 2.4s cubic-bezier(0,.2,.4,1) infinite;transform-origin:center;"></div>` +
                  `<div style="position:absolute;top:0;left:0;width:22px;height:22px;border-radius:50%;border:1px solid ${color};animation:rocket-pulse 2.4s cubic-bezier(0,.2,.4,1) 1.2s infinite;transform-origin:center;"></div>` +
                  `<div style="font-size:13px;line-height:1;transform:rotate(-45deg);position:relative;">🚀</div>` +
                  `</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            popupAnchor: [0, -13],
            className: ''
        });
    }
    return L.divIcon({
        html: `<div style="font-size:13px;line-height:1;transform:rotate(-45deg);display:inline-block;">🚀</div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
        className: ''
    });
}

function debrisIcon() {
    return L.divIcon({
        html: `<div style="font-size:13px;line-height:1;opacity:0.7;">☄️</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10],
        className: ''
    });
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
        const marker = L.marker([obj.lat, obj.lon], { icon: debrisIcon(), zIndexOffset: -300 });
        marker.bindPopup(buildDecayContent(obj), { maxWidth: 300 });
        spaceLayer.addLayer(marker);
    });

    if (!maCarte.hasLayer(spaceLayer)) spaceLayer.addTo(maCarte);
    hdrUpdateCount('space', launches.length + decayList.length);
    console.log(`Space: ${launches.length} lancements, ${decayList.length} rentrées chargés`);
}

