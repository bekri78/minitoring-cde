 // ── Signal Markers ───────────────────────────────────────────

const signalCluster = L.markerClusterGroup({
    maxClusterRadius: function (zoom) {
        if (zoom <= 3) return 80;
        if (zoom <= 5) return 60;
        if (zoom <= 7) return 45;
        return 30;
    },
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 6,
    showCoverageOnHover: false,
    iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        const size = count < 10 ? 32 : count < 50 ? 40 : count < 200 ? 50 : 62;
        return L.divIcon({
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#006070;border:1px solid #00e5ff;display:flex;align-items:center;justify-content:center;color:#00e5ff;font-family:'Share Tech Mono',monospace;font-size:${size < 40 ? 11 : 13}px;box-shadow:0 0 8px rgba(0,229,255,0.4);">${count}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            className: ''
        });
    }
});

const signalCache = new Map();

function buildSignalContent(loc) {
    const uid = 'sig-' + String(loc.id ?? Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/gi, '');
    signalCache.set(uid, loc);

    const keyPointsHtml = (loc.key_points && loc.key_points.length)
        ? `<div style="border-top:1px solid #1a2a3a;margin-top:8px;padding-top:8px;">
            <div style="color:#4a6a7a;font-size:9px;letter-spacing:0.08em;margin-bottom:6px;">CHRONOLOGIE</div>
            ${loc.key_points.slice(0, 5).map(function (kp, i) {
                return `<div style="display:flex;gap:8px;margin-bottom:6px;">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;padding-top:2px;">
                        <div style="width:6px;height:6px;border-radius:50%;background:#1a2a3a;border:1px solid #00d4ff44;flex-shrink:0;"></div>
                        <div style="width:1px;flex:1;background:#1a2a3a;"></div>
                    </div>
                    <div style="padding-bottom:4px;">
                        <div style="color:#4a6a7a;font-size:9px;margin-bottom:2px;">${escapeHtml(kp.date ?? '')}</div>
                        <div id="${uid}-kp-${i}" style="color:#c8d8e8;font-size:10px;line-height:1.4;">${escapeHtml(kp.point ?? '')}</div>
                    </div>
                </div>`;
            }).join('')}
        </div>`
        : '';

    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            ${badge('signal', '#00d4ff')}
            ${badge('INTENSIT\u00c9 ' + (loc.intensity ?? '\u2014'), intensityColor(loc.intensity ?? 0))}
            <button type="button" id="${uid}-btn" onclick="signalTranslate('${uid}')"
                style="font-family:'Share Tech Mono',monospace;font-size:9px;padding:2px 10px;background:#0a1a2a;color:#00d4ff;border:1px solid #00d4ff55;cursor:pointer;letter-spacing:0.06em;">
                &#x21BB; TRADUIRE
            </button>
            <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${escapeHtml(loc.last_mentioned_at?.substring(0, 10))}</span>
        </div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">
            \uD83D\uDCCD ${escapeHtml(loc.country)}${loc.location_name ? ' \u2014 ' + escapeHtml(loc.location_name) : ''}
        </div>
        <p id="${uid}-summary" style="color:#e8f4ff;margin:0 0 8px 0;font-size:11px;line-height:1.5;">
            ${escapeHtml(loc.summary ?? '')}
        </p>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
            ${escapeHtml(loc.last_mentioned_at?.substring(0, 16)?.replace('T', ' ') ?? '')}
            ${loc.mention_count ? `&nbsp;\u00b7&nbsp; ${loc.mention_count} mentions` : ''}
        </div>
        ${keyPointsHtml}
    `);
}

async function signalTranslate(uid) {
    const loc = signalCache.get(uid);
    if (!loc) return;

    const btn = document.getElementById(uid + '-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    const texts = [];
    if (loc.summary) texts.push(loc.summary);
    (loc.key_points || []).slice(0, 5).forEach(function (kp) {
        if (kp.point) texts.push(kp.point);
    });
    if (!texts.length) { if (btn) { btn.disabled = false; } return; }

    const combined = texts.map(function (t, i) { return '[' + (i + 1) + '] ' + t; }).join('\n');
    const messages = [
        { role: 'system', content: 'Traduis chaque segment numéroté en français (domaine géopolitique/militaire). Réponds uniquement avec les traductions au même format [1] ... [2] ... sans commentaire.' },
        { role: 'user', content: combined }
    ];

    let result = '';
    try {
        await APP.Genial.chatStream(messages, function (chunk) { result += chunk; });

        const resultMap = {};
        let cur = -1;
        result.split('\n').forEach(function (line) {
            const m = line.match(/^\[(\d+)\]\s*(.*)/);
            if (m) { cur = parseInt(m[1]) - 1; resultMap[cur] = m[2]; }
            else if (cur >= 0 && line.trim()) { resultMap[cur] = (resultMap[cur] || '') + ' ' + line.trim(); }
        });

        let kpOffset = 0;
        if (loc.summary) {
            const el = document.getElementById(uid + '-summary');
            if (el && resultMap[0] != null) el.textContent = resultMap[0].trim();
            kpOffset = 1;
        }
        (loc.key_points || []).slice(0, 5).forEach(function (kp, i) {
            if (!kp.point) return;
            const el = document.getElementById(uid + '-kp-' + i);
            if (el && resultMap[kpOffset + i] != null) el.textContent = resultMap[kpOffset + i].trim();
        });

        if (btn) { btn.disabled = false; btn.textContent = '\u2713 TRADUIT'; }
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = '\u21BB R\u00c9ESSAYER'; }
    }
}

function renderSignalMarkers(locations) {
    _cacheSignal = locations;
    signalCluster.clearLayers();
    locations.forEach(function (loc) {
        if (loc.lat == null || loc.lng == null) return;
        if (loc.lat === 0 && loc.lng === 0) return;
        const marker = L.marker([loc.lat, loc.lng], { icon: dotIcon('#02dbf4') });
        marker.bindPopup(buildSignalContent(loc), { maxWidth: 340 });
        signalCluster.addLayer(marker);
    });
    if (_activeFilter === 'ALL') { _scheduleRebuildAllMode(); return; }
    if (!maCarte.hasLayer(signalCluster)) signalCluster.addTo(maCarte);
}

