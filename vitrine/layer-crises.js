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

function crisisIcon(e, cems) {
    const lv = CRISIS_LEVEL[e.level] || CRISIS_LEVEL.green;
    const s = lv.size, g = Math.round(s * 0.62);
    return L.divIcon({
        html: '<span class="og-crisis og-crisis-' + e.level + '" style="width:' + s + 'px;height:' + s + 'px;background:' + lv.color + '">'
            + '<svg viewBox="0 0 24 24" width="' + g + '" height="' + g + '" fill="currentColor" aria-hidden="true">' + (CRISIS_GLYPH[e.type] || '') + '</svg>'
            + (cems ? '<span class="og-cems-dot" title="Cartographie Copernicus EMS"></span>' : '') + '</span>',
        iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2], className: ''
    });
}

function _crisisDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function _cemsLine(a) {
    return '<div style="margin:0 0 8px;padding:6px 8px;border-radius:6px;background:rgba(47,95,208,.18);color:#c9d6ff;">'
        + 'Cartographie d’urgence UE : <a href="' + escapeHtml(a.url) + '" target="_blank" rel="noopener" style="color:#a8c0ff;">' + escapeHtml(a.code) + '</a>'
        + (a.products ? ' · ' + a.products + ' carte' + (a.products > 1 ? 's' : '') : '') + (a.closed ? '' : ' · en cours') + '</div>';
}

function buildCrisisContent(e, cems) {
    const lv = CRISIS_LEVEL[e.level] || CRISIS_LEVEL.green;
    const period = _crisisDate(e.from) + (e.to && _crisisDate(e.to) !== _crisisDate(e.from) ? ' → ' + _crisisDate(e.to) : '');
    return mono(
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">'
        + badge(e.typeFr || e.type, lv.color) + badge(lv.label, lv.color)
        + (e.current === false ? badge('Terminé', '#8a8f98') : '')
        + (cems ? badge('Copernicus EMS', '#4f7cff') : '')
        + '</div>'
        + '<p style="margin:0 0 4px;font-size:13px;font-weight:500;color:#f2f2f4;">' + escapeHtml(e.name || '') + '</p>'
        + (cems ? _cemsLine(cems) : '')
        + (e.country ? '<p style="margin:0 0 8px;color:#8a8f98;">' + escapeHtml(typeof ogmaFr === 'function' ? ogmaFr(e.country) : e.country) + '</p>' : '')
        + (e.severity ? '<p style="margin:0 0 8px;color:#c9ccd3;">' + escapeHtml(e.severity) + '</p>' : '')
        + '<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;color:#8a8f98;">'
        + '<span>' + escapeHtml(period) + ' (UTC)</span>'
        + (e.url ? '<a href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener" style="color:#a8aeff;">Rapport GDACS</a>' : '')
        + '</div>'
        + '<div style="margin-top:6px;font-size:11px;color:#62666d;">Source : GDACS (ONU / Commission européenne)</div>'
    );
}

// v50 — Activation Copernicus EMS sans alerte GDACS : disque bleu UE, même pictogramme
function cemsIcon(a) {
    return L.divIcon({
        html: '<span class="og-crisis og-crisis-cems" style="width:20px;height:20px;background:#2f5fd0">'
            + '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">' + (CRISIS_GLYPH[a.type] || '<circle cx="12" cy="12" r="5"/>') + '</svg></span>',
        iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10], className: ''
    });
}
function buildCemsContent(a) {
    const when = _crisisDate(a.eventTime || a.activationTime);
    return mono(
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">'
        + badge('Copernicus EMS', '#4f7cff') + (a.categoryFr ? badge(a.categoryFr, '#4f7cff') : '') + (a.closed ? '' : badge('En cours', '#f2994a'))
        + '</div>'
        + '<p style="margin:0 0 4px;font-size:13px;font-weight:500;color:#f2f2f4;">' + escapeHtml(a.name || a.code) + '</p>'
        + (a.countries && a.countries.length ? '<p style="margin:0 0 8px;color:#8a8f98;">' + escapeHtml(a.countries.map(function (c) { return typeof ogmaFr === 'function' ? ogmaFr(c) : c; }).join(', ')) + '</p>' : '')
        + '<p style="margin:0 0 8px;color:#c9ccd3;">Cartographie d’urgence demandée à l’UE' + (a.products ? ' · ' + a.products + ' carte' + (a.products > 1 ? 's' : '') : '') + '</p>'
        + '<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;color:#8a8f98;">'
        + '<span>' + escapeHtml(when) + ' (UTC)</span>'
        + '<a href="' + escapeHtml(a.url) + '" target="_blank" rel="noopener" style="color:#a8aeff;">' + escapeHtml(a.code) + '</a>'
        + '</div>'
        + '<div style="margin-top:6px;font-size:11px;color:#62666d;">Source : © Union européenne, Copernicus EMS</div>'
    );
}

let _lastCrises = [];
let _lastGdacsFires = [];
let _lastCems = [];
function renderCrises(events, activations) {
    const all = events || [];
    _lastCems = activations || [];
    const byRef = {};
    _lastCems.forEach(function (a) { if (a.gdacsRef) byRef[a.gdacsRef] = a; });
    const linked = {};
    _lastCrises = all.filter(function (e) { return e.type !== 'WF'; });
    _lastGdacsFires = all.filter(function (e) { return e.type === 'WF'; });
    crisesLayer.clearLayers();
    gdacsFiresGroup.clearLayers();
    all.forEach(function (e) {
        if (typeof e.lat !== 'number' || typeof e.lon !== 'number') return;
        const cems = byRef[e.id] || null;
        if (cems) linked[cems.code] = true;
        const z = e.level === 'red' ? 1200 : e.level === 'orange' ? 900 : 100;
        const m = L.marker([e.lat, e.lon], { icon: crisisIcon(e, cems), zIndexOffset: z, title: (e.typeFr || '') + ' — ' + (e.name || '') });
        m.bindPopup(buildCrisisContent(e, cems), { maxWidth: 320 });
        (e.type === 'WF' ? gdacsFiresGroup : crisesLayer).addLayer(m);
    });
    // Activations sans alerte GDACS affichée : marqueur propre (feux de forêt avec le calque Feux)
    _lastCems.forEach(function (a) {
        if (linked[a.code] || typeof a.lat !== 'number' || typeof a.lon !== 'number') return;
        const m = L.marker([a.lat, a.lon], { icon: cemsIcon(a), zIndexOffset: 800, title: 'Copernicus EMS — ' + (a.name || a.code) });
        m.bindPopup(buildCemsContent(a), { maxWidth: 320 });
        if (a.type === 'WF') { gdacsFiresGroup.addLayer(m); _lastGdacsFires.push(a); }
        else { crisesLayer.addLayer(m); _lastCrises.push(a); }
    });
    if (typeof hdrUpdateCount === 'function') hdrUpdateCount('crises', _lastCrises.length);
    if (typeof firesLayer !== 'undefined' && !firesLayer.hasLayer(gdacsFiresGroup)) firesLayer.addLayer(gdacsFiresGroup);
    if (typeof _firesCountUpdate === 'function') _firesCountUpdate();
    if (typeof applyLayers === 'function') applyLayers();
}
