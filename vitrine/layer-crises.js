// ── Crises : alertes catastrophes GDACS (ONU / Commission européenne) ────────
// Séismes, cyclones, inondations, volcans, sécheresses.
// Les feux de forêt GDACS (type WF) vont dans le calque Feux (gdacsFiresGroup) : sinon le
// calque Crises montrait surtout des feux et couper « Feux » laissait ces icônes à l'écran.
// Couleur = niveau d'alerte GDACS (impact humain estimé) : rouge, orange, vert.

const crisesLayer = L.layerGroup();
const gdacsFiresGroup = L.layerGroup();   // feux de forêt GDACS, affichés avec le calque Feux

const CRISIS_LEVEL = {
    red:    { label: 'Alerte rouge',  color: '#e5484d', size: 26 },
    orange: { label: 'Alerte orange', color: '#f2994a', size: 22 },
    green:  { label: 'Alerte verte',  color: '#4cb782', size: 16 }
};

// Pictogrammes blancs (24×24) par type d'événement
const CRISIS_GLYPH = {
    EQ: '<path d="M2 12h4l2-5 3 10 3-8 2 3h6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    TC: '<path d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/><path d="M19 6.5C16 3 9 3 6.5 7.5M5 17.5C8 21 15 21 17.5 16.5M12 4c-4 0-8 2.5-8 8M12 20c4 0 8-2.5 8-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    FL: '<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    VO: '<path d="M3 20l6-10h6l6 10z"/><path d="M10 7l-1-3M14 7l1-3M12 6V2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    DR: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    WF: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z"/>'
};

function crisisIcon(e) {
    const lv = CRISIS_LEVEL[e.level] || CRISIS_LEVEL.green;
    const s = lv.size, g = Math.round(s * 0.62);
    return L.divIcon({
        html: '<span class="og-crisis og-crisis-' + e.level + '" style="width:' + s + 'px;height:' + s + 'px;background:' + lv.color + '">'
            + '<svg viewBox="0 0 24 24" width="' + g + '" height="' + g + '" fill="currentColor" aria-hidden="true">' + (CRISIS_GLYPH[e.type] || '') + '</svg></span>',
        iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2], className: ''
    });
}

function _crisisDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function buildCrisisContent(e) {
    const lv = CRISIS_LEVEL[e.level] || CRISIS_LEVEL.green;
    const period = _crisisDate(e.from) + (e.to && _crisisDate(e.to) !== _crisisDate(e.from) ? ' → ' + _crisisDate(e.to) : '');
    return mono(
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">'
        + badge(e.typeFr || e.type, lv.color) + badge(lv.label, lv.color)
        + (e.current === false ? badge('Terminé', '#8a8f98') : '')
        + '</div>'
        + '<p style="margin:0 0 4px;font-size:13px;font-weight:500;color:#f2f2f4;">' + escapeHtml(e.name || '') + '</p>'
        + (e.country ? '<p style="margin:0 0 8px;color:#8a8f98;">' + escapeHtml(typeof ogmaFr === 'function' ? ogmaFr(e.country) : e.country) + '</p>' : '')
        + (e.severity ? '<p style="margin:0 0 8px;color:#c9ccd3;">' + escapeHtml(e.severity) + '</p>' : '')
        + '<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;color:#8a8f98;">'
        + '<span>' + escapeHtml(period) + ' (UTC)</span>'
        + (e.url ? '<a href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener" style="color:#a8aeff;">Rapport GDACS</a>' : '')
        + '</div>'
        + '<div style="margin-top:6px;font-size:11px;color:#62666d;">Source : GDACS (ONU / Commission européenne)</div>'
    );
}

let _lastCrises = [];
let _lastGdacsFires = [];
function renderCrises(events) {
    const all = events || [];
    _lastCrises = all.filter(function (e) { return e.type !== 'WF'; });
    _lastGdacsFires = all.filter(function (e) { return e.type === 'WF'; });
    crisesLayer.clearLayers();
    gdacsFiresGroup.clearLayers();
    all.forEach(function (e) {
        if (typeof e.lat !== 'number' || typeof e.lon !== 'number') return;
        const z = e.level === 'red' ? 1200 : e.level === 'orange' ? 900 : 100;
        const m = L.marker([e.lat, e.lon], { icon: crisisIcon(e), zIndexOffset: z, title: (e.typeFr || '') + ' — ' + (e.name || '') });
        m.bindPopup(buildCrisisContent(e), { maxWidth: 320 });
        (e.type === 'WF' ? gdacsFiresGroup : crisesLayer).addLayer(m);
    });
    if (typeof hdrUpdateCount === 'function') hdrUpdateCount('crises', _lastCrises.length);
    if (typeof firesLayer !== 'undefined' && !firesLayer.hasLayer(gdacsFiresGroup)) firesLayer.addLayer(gdacsFiresGroup);
    if (typeof _firesCountUpdate === 'function') _firesCountUpdate();
    if (typeof applyLayers === 'function') applyLayers();
}
