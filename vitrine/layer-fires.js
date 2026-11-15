// ── Feux : points chauds satellitaires NASA FIRMS (VIIRS, dernières 24 h) ────
// Zones suivies : Ukraine-Russie, Moyen-Orient, Soudan-Corne, Sahel-Libye, Myanmar.
// Une détection thermique peut être un incendie, une frappe (dépôt, raffinerie),
// une torchère ou un feu agricole : toujours à recouper.

const firesLayer = L.layerGroup();

const FIRE_LEVEL = {
    fort:   { label: 'Intense',  color: '#ff5a1f', r: 7 },
    moyen:  { label: 'Moyen',    color: '#f2994a', r: 5 },
    faible: { label: 'Faible',   color: '#d9b44a', r: 4 }
};

function _fireTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' UTC';
}

// v51 — Liens vers l'imagerie satellite (utiles aux postes qui ont Internet)
//  - NASA Worldview : image VIIRS du jour de la détection (couleurs naturelles, ~375 m) avec
//    les anomalies thermiques par-dessus : fumée et étendue du feu.
//  - Copernicus Browser : Sentinel-2 (10 m) des 10 jours précédents, plus précis mais pas
//    forcément du jour même (passage tous les 2 à 5 jours, nuages).
function _fireDay(f) {
    const d = f.last ? new Date(f.last) : new Date();
    return isNaN(d) ? new Date() : d;
}
function fireWorldviewUrl(f) {
    const d = _fireDay(f), day = d.toISOString().slice(0, 10);
    const r = function (x) { return Math.round(x * 100) / 100; };
    return 'https://worldview.earthdata.nasa.gov/?v=' + [r(f.lon - 0.6), r(f.lat - 0.4), r(f.lon + 0.6), r(f.lat + 0.4)].join(',')
        + '&l=VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_SNPP_Thermal_Anomalies_375m_All,Reference_Labels_15m,Coastlines_15m,VIIRS_NOAA20_CorrectedReflectance_TrueColor'
        + '&t=' + day + '-T' + d.toISOString().slice(11, 16) + ':00Z';
}
function fireSentinelUrl(f) {
    const d = _fireDay(f), from = new Date(d.getTime() - 10 * 86400000);
    return 'https://browser.dataspace.copernicus.eu/?zoom=12&lat=' + f.lat.toFixed(4) + '&lng=' + f.lon.toFixed(4)
        + '&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS&layerId=1_TRUE_COLOR'
        + '&fromTime=' + from.toISOString().slice(0, 10) + 'T00%3A00%3A00.000Z&toTime=' + d.toISOString().slice(0, 10) + 'T23%3A59%3A59.999Z';
}

function buildFireContent(f) {
    const lv = FIRE_LEVEL[f.level] || FIRE_LEVEL.faible;
    return mono(
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">'
        + badge('Point chaud', lv.color) + badge(lv.label, lv.color) + (f.night ? badge('Nuit', '#8a8f98') : '')
        + '</div>'
        + '<p style="margin:0 0 4px;font-size:13px;font-weight:500;color:#f2f2f4;">' + escapeHtml(f.zone || '') + '</p>'
        + '<p style="margin:0 0 8px;color:#c9ccd3;">' + f.count + ' détection' + (f.count > 1 ? 's' : '') + ' · puissance max ' + f.frpMax + ' MW</p>'
        + '<p style="margin:0 0 8px;color:#8a8f98;">' + f.lat.toFixed(3) + ', ' + f.lon.toFixed(3) + ' · ' + escapeHtml(_fireTime(f.last)) + '</p>'
        + '<p style="margin:0 0 8px;display:flex;gap:12px;flex-wrap:wrap;">'
        + '<a href="' + escapeHtml(fireWorldviewUrl(f)) + '" target="_blank" rel="noopener" style="color:#a8aeff;">Image du jour (NASA Worldview)</a>'
        + '<a href="' + escapeHtml(fireSentinelUrl(f)) + '" target="_blank" rel="noopener" style="color:#a8aeff;">Image détaillée (Sentinel-2)</a>'
        + '</p>'
        + '<div style="border-top:1px solid rgba(255,255,255,.08);padding-top:8px;color:#8a8f98;font-size:11px;">Incendie, frappe, torchère ou feu agricole : à recouper.</div>'
        + '<div style="margin-top:6px;font-size:11px;color:#62666d;">Source : NASA FIRMS (satellites VIIRS)</div>'
    );
}

let _lastFires = [];
// Compteur Feux = points chauds FIRMS + feux de forêt GDACS
function _firesCountUpdate() {
    const wf = typeof _lastGdacsFires !== 'undefined' ? _lastGdacsFires.length : 0;
    if (typeof hdrUpdateCount === 'function') hdrUpdateCount('fires', _lastFires.length + wf);
}
function renderFires(cells) {
    _lastFires = cells || [];
    firesLayer.clearLayers();
    if (typeof gdacsFiresGroup !== 'undefined') firesLayer.addLayer(gdacsFiresGroup);   // feux de forêt GDACS
    _lastFires.forEach(function (f) {
        if (typeof f.lat !== 'number' || typeof f.lon !== 'number') return;
        const lv = FIRE_LEVEL[f.level] || FIRE_LEVEL.faible;
        const m = L.circleMarker([f.lat, f.lon], {
            radius: lv.r, color: '#1a0d05', weight: 1, fillColor: lv.color, fillOpacity: f.level === 'fort' ? 0.95 : 0.8,
            className: 'og-fire og-fire-' + f.level
        });
        m.bindPopup(buildFireContent(f), { maxWidth: 300 });
        firesLayer.addLayer(m);
    });
    _firesCountUpdate();
    if (typeof applyLayers === 'function') applyLayers();
}
