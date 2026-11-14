 // ── OSINT Events ─────────────────────────────────────────────

const osintCluster = L.markerClusterGroup({
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
        return L.divIcon({
            html: `<div style="width:36px;height:36px;border-radius:50%;background:#ff440033;border:1px solid #ff4400;display:flex;align-items:center;justify-content:center;font-family:'Share Tech Mono',monospace;font-size:12px;color:#ff8800;">${count}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            className: ''
        });
    }
});

const OSINT_CATEGORY_COLOR = {
    protest:      '#cc44ff',
    civil_unrest: '#cc44ff',
    unrest:       '#cc44ff',
};

function osintEventColor(ev) {
    const cat = (ev.category ?? '').toLowerCase();
    if (OSINT_CATEGORY_COLOR[cat]) return OSINT_CATEGORY_COLOR[cat];
    const t = ev.tone ?? 0;
    if (t <= -7) return '#ff2244';
    if (t <= -5) return '#ff5533';
    if (t <= -2) return '#ffaa00';
    return '#00d4ff';
}

function osintFormatDate(raw) {
    if (!raw) return '';
    const s = String(raw);
    if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return s;
}

function osintSeverityLabel(ev) {
    const t = ev.tone ?? 0;
    if (t <= -7) return 'CRITICAL';
    if (t <= -5) return 'HIGH';
    if (t <= -2) return 'MODERATE';
    return 'LOW';
}

const osintCache = new Map();

function buildOsintContent(ev) {
    const color = osintEventColor(ev);
    const title = escapeHtml(ev.titleFr || ev.title || '');
    const dateStr = osintFormatDate(ev.date);
    const uid = 'osint-' + String(ev.id ?? Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/gi, '');
    osintCache.set(uid, ev);

    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            ${badge(ev.category ?? 'osint', color)}
            ${badge(osintSeverityLabel(ev), color)}
            <button type="button" id="${uid}-btn" onclick="osintTranslate('${uid}')"
                style="font-family:'Share Tech Mono',monospace;font-size:9px;padding:2px 10px;background:#0a1a2a;color:#00d4ff;border:1px solid #00d4ff55;cursor:pointer;letter-spacing:0.06em;">
                &#x21BB; TRADUIRE
            </button>
            <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${escapeHtml(dateStr)}</span>
        </div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">
            \uD83D\uDCCD ${escapeHtml(ev.country ?? '')}
        </div>
        <p style="color:#e8f4ff;margin:0 0 6px 0;font-size:11px;line-height:1.5;">
            ${ev.url
                ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" style="color:#e8f4ff;text-decoration:none;border-bottom:1px dotted #2a4a5a;">${title}</a>`
                : title}
        </p>
        <div id="${uid}-trans" style="display:none;color:#aad4ff;font-size:11px;line-height:1.6;margin-bottom:6px;padding:6px 8px;border-left:2px solid #00d4ff44;background:#00d4ff08;"></div>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
            <span>${escapeHtml(ev.domain ?? '')}</span>
        </div>
    `);
}

async function osintTranslate(uid) {
    const ev = osintCache.get(uid);
    if (!ev) return;
    const textToTranslate = ev.title || '';
    if (!textToTranslate) return;

    const btn   = document.getElementById(uid + '-btn');
    const trans = document.getElementById(uid + '-trans');
    if (!trans) return;

    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    trans.style.display = 'block';
    trans.textContent   = '';

    const messages = [
        { role: 'system', content: 'Tu es un traducteur expert en géopolitique et affaires militaires. Traduis le texte suivant en français de manière précise et concise. Réponds uniquement avec la traduction, sans commentaire.' },
        { role: 'user', content: textToTranslate }
    ];

    try {
        await APP.Genial.chatStream(messages, function (chunk) { trans.textContent += chunk; });
        if (btn) { btn.disabled = false; btn.textContent = '\u2713 TRADUIT'; }
    } catch (e) {
        trans.textContent = '[Erreur\u00a0: ' + e.message + ']';
        if (btn) { btn.disabled = false; btn.textContent = '\u21BB R\u00c9ESSAYER'; }
    }
}

function renderOsintEvents(events) {
    _cacheOsint = events;
    osintCluster.clearLayers();
    events.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null) return;
        if (ev.lat === 0 && ev.lon === 0) return;
        const color = osintEventColor(ev);
        const marker = L.marker([ev.lat, ev.lon], { icon: dotIcon(color) });
        marker.bindPopup(buildOsintContent(ev), { maxWidth: 340 });
        osintCluster.addLayer(marker);
    });
    if (_activeFilter === 'ALL') { _scheduleRebuildAllMode(); return; }
    if (!maCarte.hasLayer(osintCluster)) osintCluster.addTo(maCarte);
}

