 // ── Séismes USGS (M ≥ 5.5, 30 derniers jours) ────────────────

const seismicLayer = L.layerGroup();

function seismicColor(mag) {
    if (mag >= 7) return '#ff2244';
    if (mag >= 6) return '#ff5533';
    return '#ffaa00';
}

function seismicIcon(mag) {
    const color = seismicColor(mag);
    const size = mag >= 8 ? 20 : mag >= 7 ? 16 : mag >= 6 ? 12 : 9;
    return L.divIcon({
        html: `<div style="width:0;height:0;border-left:${size/2}px solid transparent;border-right:${size/2}px solid transparent;border-bottom:${size}px solid ${color};filter:drop-shadow(0 0 4px ${color});opacity:0.9;"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size],
        className: ''
    });
}

function buildSeismicContent(eq) {
    const mag   = eq.mag  != null ? eq.mag.toFixed(1) : '\u2014';
    const depth = eq.depth != null ? eq.depth.toFixed(0) + ' km' : '\u2014';
    const place = eq.place || '\u2014';
    const time  = eq.time ? new Date(eq.time).toISOString().replace('T', ' ').substring(0, 16) + ' UTC' : '\u2014';
    const color = seismicColor(eq.mag ?? 0);

    return mono(`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            ${badge('s\u00e9isme', color)}
            ${badge('M ' + mag, color)}
        </div>
        <div style="color:#4a6a7a;font-size:9px;margin-bottom:4px;">
            \uD83D\uDCCD ${escapeHtml(place)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;border-top:1px solid #1a2a3a;padding-top:8px;margin-bottom:6px;">
            <div><span style="color:#4a6a7a;">MAGNITUDE</span><br><span style="color:${color};font-size:13px;font-weight:bold;">M ${escapeHtml(mag)}</span></div>
            <div><span style="color:#4a6a7a;">PROFONDEUR</span><br><span style="color:#c8d8e8;">${escapeHtml(depth)}</span></div>
        </div>
        <div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">
            ${escapeHtml(time)}
            ${eq.url ? ` &nbsp;&middot;&nbsp; <a href="${escapeHtml(eq.url)}" target="_blank" rel="noopener" style="color:#4a6a7a;">USGS</a>` : ''}
        </div>
    `);
}

function renderSeismic(events) {
    seismicLayer.clearLayers();
    events.forEach(function (eq) {
        if (eq.lat == null || eq.lon == null) return;
        const mag = eq.mag ?? 0;
        if (mag < 5.5) return;
        const marker = L.marker([eq.lat, eq.lon], { icon: seismicIcon(mag), zIndexOffset: -200 });
        marker.bindPopup(buildSeismicContent(eq), { maxWidth: 320 });
        seismicLayer.addLayer(marker);
    });
    if (!maCarte.hasLayer(seismicLayer)) seismicLayer.addTo(maCarte);
}

