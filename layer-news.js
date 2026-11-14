 // ── News Events (Google News classifiés par domaine) ─────────

function _makeNewsCluster(color, bgColor) {
    return L.markerClusterGroup({
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
                html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bgColor};border:1px solid ${color};display:flex;align-items:center;justify-content:center;color:${color};font-family:'Share Tech Mono',monospace;font-size:${size < 40 ? 11 : 13}px;box-shadow:0 0 8px ${color}55;">${count}</div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
                className: ''
            });
        }
    });
}

const newsAirCluster   = _makeNewsCluster('#0ea5e9', '#001a2a'); // bleu — aviation
const newsSeaCluster   = _makeNewsCluster('#3b82f6', '#00102a'); // bleu foncé — naval
const newsSpaceCluster = _makeNewsCluster('#a855f7', '#1a002a'); // violet — spatial
const newsOsintCluster = _makeNewsCluster('#00cc66', '#003a1a'); // vert — militaire/OSINT

function _newsEventDomain(ev) {
    // Routing basé uniquement sur ev.label / ev.category (ce que le badge affiche)
    // feedLabel et title exclus — trop de faux positifs
    const d = [ev.label, ev.category, ev.eventType].filter(Boolean).join(' ').toLowerCase();
    if (/\bsea\b|naval|maritime|navy|ocean|shipping/.test(d))                  return 'sea';
    if (/\bspace\b|spatial|satellite|orbital|cosmos|astronaut/.test(d))        return 'space';
    if (/\bavia|aircraft|aerospace|\bair\b|\bflight\b/.test(d))               return 'air';
    return 'osint';
}

function newsConfidenceColor(confidence) {
    const pct = confidence > 1 ? confidence : confidence * 100;
    if (pct >= 80) return '#00cc66';
    if (pct >= 50) return '#ffaa00';
    return '#4a6a7a';
}

const newsCache = new Map();

function buildNewsContent(ev) {
    const color = ev.color || newsConfidenceColor(ev.confidence ?? 0);
    const rawDate = ev.publishedAt || ev.published_at || ev.date || null;
    const date = rawDate ? new Date(rawDate).toISOString().replace('T', ' ').substring(0, 16) + ' UTC' : '\u2014';
    const dateShort = rawDate ? date.substring(0, 10) : '\u2014';
    const typeLabel = (ev.icon ? ev.icon + '\u00a0' : '') + (ev.label || ev.feedLabel || ev.category || ev.topic || 'NEWS');
    const uid = 'news-' + String(ev.id ?? Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/gi, '');
    newsCache.set(uid, ev);
    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            ${badge(typeLabel, color)}
            <button type="button" id="${uid}-btn" onclick="newsTranslate('${uid}')"
                style="font-family:'Share Tech Mono',monospace;font-size:9px;padding:2px 10px;background:#0a1a2a;color:#00d4ff;border:1px solid #00d4ff55;cursor:pointer;letter-spacing:0.06em;">
                &#x21BB; TRADUIRE
            </button>
            <span style="margin-left:auto;font-size:9px;color:#4a6a7a;">${escapeHtml(dateShort)}</span>
        </div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">
            \uD83D\uDCCD ${escapeHtml(ev.location || ev.country || '')}
        </div>
        <p id="${uid}-title" style="color:#e8f4ff;margin:0 0 6px 0;font-size:11px;line-height:1.5;">
            ${ev.url
                ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" style="color:#e8f4ff;text-decoration:none;border-bottom:1px dotted #2a4a5a;">${escapeHtml(ev.title || '')}</a>`
                : escapeHtml(ev.title || '')}
        </p>
        <div id="${uid}-trans" style="display:none;color:#aad4ff;font-size:11px;line-height:1.6;margin-bottom:6px;padding:6px 8px;border-left:2px solid #00d4ff44;background:#00d4ff08;"></div>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
            <span>${escapeHtml(ev.source || ev.domain || '')}</span>
            &nbsp;&middot;&nbsp;
            <span>${escapeHtml(date)}</span>
        </div>
    `);
}

async function newsTranslate(uid) {
    const ev = newsCache.get(uid);
    if (!ev) return;

    const btn   = document.getElementById(uid + '-btn');
    const trans = document.getElementById(uid + '-trans');
    if (!trans) return;

    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    trans.style.display = 'block';
    trans.textContent   = '';

    const messages = [
        { role: 'system', content: 'Tu es un traducteur expert en géopolitique et affaires militaires. Traduis le titre suivant en français de manière précise et concise. Réponds uniquement avec la traduction, sans commentaire.' },
        { role: 'user', content: ev.title || '' }
    ];

    try {
        await APP.Genial.chatStream(messages, function (chunk) { trans.textContent += chunk; });
        if (btn) { btn.disabled = false; btn.textContent = '\u2713 TRADUIT'; }
    } catch (e) {
        trans.textContent = '[Erreur\u00a0: ' + e.message + ']';
        if (btn) { btn.disabled = false; btn.textContent = '\u21BB R\u00c9ESSAYER'; }
    }
}

// Décale les points news partageant le même lat/lon exact
const _newsJitterMap = new Map();

function _newsJitter(lat, lon) {
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    const count = (_newsJitterMap.get(key) || 0);
    _newsJitterMap.set(key, count + 1);
    if (count === 0) return [lat, lon];
    const angle  = Math.random() * 2 * Math.PI;
    const base   = 0.05 + Math.min(count, 50) * 0.008;
    const radius = base * (0.5 + Math.random() * 0.5);
    return [lat + radius * Math.sin(angle), lon + radius * Math.cos(angle)];
}

function renderNews(events) {
    _cacheNews = events;
    _newsJitterMap.clear();
    newsAirCluster.clearLayers();
    newsSeaCluster.clearLayers();
    newsSpaceCluster.clearLayers();
    newsOsintCluster.clearLayers();
    let cntAir = 0, cntSea = 0, cntSpace = 0, cntOsint = 0;

    events.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null) return;
        if (ev.lat === 0 && ev.lon === 0) return;
        const color = ev.color || newsConfidenceColor(ev.confidence ?? 0);
        const domain = _newsEventDomain(ev);
        const [jLat, jLon] = _newsJitter(ev.lat, ev.lon);
        const marker = L.marker([jLat, jLon], { icon: dotIcon(color) });
        marker.bindPopup(buildNewsContent(ev), { maxWidth: 340 });
        if (domain === 'air')        { newsAirCluster.addLayer(marker);   cntAir++; }
        else if (domain === 'sea')   { newsSeaCluster.addLayer(marker);   cntSea++; }
        else if (domain === 'space') { newsSpaceCluster.addLayer(marker); cntSpace++; }
        else                         { newsOsintCluster.addLayer(marker); cntOsint++; }
    });

    [
        { layer: newsAirCluster,   filter: 'AIR' },
        { layer: newsSeaCluster,   filter: 'SEA' },
        { layer: newsSpaceCluster, filter: 'SPACE' },
        { layer: newsOsintCluster, filter: 'OSINT' }
    ].forEach(function (item) {
        if (_activeFilter === item.filter) {
            if (!maCarte.hasLayer(item.layer)) item.layer.addTo(maCarte);
        }
    });

    if (_activeFilter === 'ALL') _scheduleRebuildAllMode();

    hdrUpdateCount('newsAir',   cntAir);
    hdrUpdateCount('newsSea',   cntSea);
    hdrUpdateCount('newsSpace', cntSpace);
    hdrUpdateCount('newsOsint', cntOsint);
}

