 // ── Events GDELT maritimes & aviation ────────────────────────

const maritimeEvtCluster = L.markerClusterGroup({
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
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#002a4a;border:1px solid #0088cc;display:flex;align-items:center;justify-content:center;color:#0088cc;font-family:'Share Tech Mono',monospace;font-size:${size < 40 ? 11 : 13}px;box-shadow:0 0 8px rgba(0,136,204,0.35);">${count}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            className: ''
        });
    }
});

const aviationEvtCluster = L.markerClusterGroup({
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
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#2a0a4a;border:1px solid #9933ff;display:flex;align-items:center;justify-content:center;color:#9933ff;font-family:'Share Tech Mono',monospace;font-size:${size < 40 ? 11 : 13}px;box-shadow:0 0 8px rgba(153,51,255,0.35);">${count}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            className: ''
        });
    }
});

function gdeltEventColor(score) {
    if (score >= 7) return '#ff2244';
    if (score >= 4) return '#ff8800';
    if (score >= 2) return '#ffaa00';
    return '#0088cc';
}

function buildGdeltEventContent(ev, domainLabel) {
    const color = gdeltEventColor(ev.score ?? 0);
    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            ${badge(domainLabel, color)}
            ${ev.eventType ? badge(escapeHtml(ev.eventType), color) : ''}
        </div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">
            \uD83D\uDCCD ${escapeHtml(ev.country ?? '')}
        </div>
        <p style="color:#e8f4ff;margin:0 0 6px 0;font-size:11px;line-height:1.5;">${escapeHtml(ev.title || '')}</p>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
            SCORE ${ev.score != null ? Number(ev.score).toFixed(1) : '\u2014'}
        </div>
    `);
}

// ── Maritime ─────────────────────────────────────────────────

function renderMaritimeEvents(events) {
    _cacheMaritime = events;
    maritimeEvtCluster.clearLayers();
    events.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null) return;
        if (ev.lat === 0 && ev.lon === 0) return;
        const color = gdeltEventColor(ev.score ?? 0);
        const marker = L.marker([ev.lat, ev.lon], { icon: dotIcon(color) });
        marker.bindPopup(buildGdeltEventContent(ev, 'MARITIME'), { maxWidth: 320 });
        maritimeEvtCluster.addLayer(marker);
    });
    if (_activeFilter === 'ALL') { _scheduleRebuildAllMode(); return; }
    if (_activeFilter === 'SEA') {
        if (!maCarte.hasLayer(maritimeEvtCluster)) maritimeEvtCluster.addTo(maCarte);
    }
}

// ── Aviation ─────────────────────────────────────────────────

function renderAviationEvents(events) {
    _cacheAviation = events;
    aviationEvtCluster.clearLayers();
    events.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null) return;
        if (ev.lat === 0 && ev.lon === 0) return;
        const color = gdeltEventColor(ev.score ?? 0);
        const marker = L.marker([ev.lat, ev.lon], { icon: dotIcon(color) });
        marker.bindPopup(buildGdeltEventContent(ev, 'AVIATION'), { maxWidth: 320 });
        aviationEvtCluster.addLayer(marker);
    });
    if (_activeFilter === 'ALL') { _scheduleRebuildAllMode(); return; }
    if (!maCarte.hasLayer(aviationEvtCluster)) aviationEvtCluster.addTo(maCarte);
}

