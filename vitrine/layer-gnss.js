// ── GNSS : brouillage et leurrage du GPS vus par les avions ────────────────
// Hexagones (~22 km) : part des avions dont la position ADS-B est dégradée (NIC bas)
// sur une journée — brouillage probable, parfois panne ou équipement ancien.
// Points : sources de brouillage localisées et épisodes de leurrage (positions falsifiées).
// Données Stanford GPS Lab (CC BY-NC 4.0, attribution obligatoire), publiées avec
// 2 à 3 jours de décalage. Classement EASA des FIR touchées sur 7 jours.

const gnssLayer = L.layerGroup();
// Hexagones sur un canvas placé dans un plan juste SOUS celui des vecteurs : sinon le canvas,
// qui couvre toute la carte, intercepte les clics des points GNSS, Feux et Convergences.
// OGMA redéfinit les indices des plans (tuiles 2, vecteurs 4…) : on se cale sur le plan des vecteurs.
let _gnssRenderer = null;
function _gnssCanvas() {
    if (_gnssRenderer) return _gnssRenderer;
    if (!maCarte.getPane('ogGnss')) {
        const z = parseInt(getComputedStyle(maCarte.getPane('overlayPane')).zIndex, 10);
        const pane = maCarte.createPane('ogGnss');
        pane.style.zIndex = isNaN(z) ? 350 : String(z - 1);
        // L'ancienne leaflet.css de librairies/ ne positionne que les plans qu'elle connaît :
        // sans position, le z-index serait ignoré et le fond de carte passerait au-dessus.
        pane.style.position = 'absolute'; pane.style.left = '0'; pane.style.top = '0';
    }
    _gnssRenderer = L.canvas({ pane: 'ogGnss', padding: 0.5 });
    return _gnssRenderer;
}

const GNSS_LEVEL = {
    fort:   { label: 'Fort',   color: '#e879f9', fill: 0.55 },
    moyen:  { label: 'Moyen',  color: '#c084fc', fill: 0.40 },
    faible: { label: 'Faible', color: '#a78bfa', fill: 0.25 }
};
const GNSS_SOURCE = 'Source : Stanford GPS Lab, rfi.stanford.edu (CC BY-NC 4.0)';

function _gnssDay(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
}
function _gnssTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}
function _gnssMeta() {
    const s = (typeof APP !== 'undefined' && APP.Sync && APP.Sync.current && APP.Sync.current.sources) || {};
    return s.gnss || {};
}
function _gnssFoot(extra) {
    return '<div style="border-top:1px solid rgba(255,255,255,.08);padding-top:8px;color:#8a8f98;font-size:11px;">' + extra + '</div>'
        + '<div style="margin-top:6px;font-size:11px;color:#62666d;">' + GNSS_SOURCE + '</div>';
}

function buildGnssCellContent(c) {
    const lv = GNSS_LEVEL[c.level] || GNSS_LEVEL.faible;
    return mono(
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">'
        + badge('Brouillage GNSS', lv.color) + badge(lv.label, lv.color)
        + '</div>'
        + (c.region ? '<p style="margin:0 0 4px;font-size:13px;font-weight:500;color:#f2f2f4;">' + escapeHtml(c.region) + '</p>' : '')
        + '<p style="margin:0 0 8px;color:#c9ccd3;">' + c.pct + ' % des avions à position dégradée (' + c.low + ' sur ' + c.total + ')</p>'
        + '<p style="margin:0 0 8px;color:#8a8f98;">' + c.lat.toFixed(2) + ', ' + c.lon.toFixed(2) + ' · journée du ' + escapeHtml(_gnssDay(_gnssMeta().day)) + '</p>'
        + _gnssFoot('Brouillage probable ; une panne ou un équipement ancien donne le même signe : à recouper. Données publiées avec 2 à 3 jours de décalage.')
    );
}

function buildGnssEventContent(e) {
    const jam = e.kind === 'jam';
    const color = jam ? '#f472b6' : '#38bdf8';
    return mono(
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">'
        + badge(jam ? 'Source de brouillage' : 'Leurrage GNSS', color)
        + '</div>'
        + (e.region ? '<p style="margin:0 0 4px;font-size:13px;font-weight:500;color:#f2f2f4;">' + escapeHtml(e.region) + '</p>' : '')
        + '<p style="margin:0 0 8px;color:#c9ccd3;">' + e.flights + ' vol' + (e.flights > 1 ? 's' : '') + ' touché' + (e.flights > 1 ? 's' : '')
        + (jam ? '' : ' · positions falsifiées') + '</p>'
        + '<p style="margin:0 0 8px;color:#8a8f98;">' + e.lat.toFixed(2) + ', ' + e.lon.toFixed(2) + ' · ' + escapeHtml(_gnssTime(e.start)) + ' → ' + escapeHtml(_gnssTime(e.end)) + ' UTC</p>'
        + _gnssFoot(jam ? 'Position estimée de l’émetteur à partir des avions touchés.' : 'Les avions ont reçu une fausse position : leurrage délibéré probable.')
    );
}

// Légende et classement EASA, visibles quand le calque est allumé
let _gnssLegend = null;
let _lastGnssFirs = [];
function _gnssLegendHtml() {
    const m = _gnssMeta();
    const sw = function (lv) { return '<span class="og-gnss-sw" style="background:' + GNSS_LEVEL[lv].color + '"></span>'; };
    let h = '<div class="og-gnss-title">Brouillage GNSS <span>· ' + escapeHtml(_gnssDay(m.day)) + '</span></div>'
        + '<div class="og-gnss-row">' + sw('faible') + '10–25 % ' + sw('moyen') + '25–50 % ' + sw('fort') + '≥ 50 %</div>'
        + '<div class="og-gnss-row"><span class="og-gnss-pt" style="background:#f472b6"></span>source <span class="og-gnss-pt" style="background:#38bdf8"></span>leurrage</div>';
    if (_lastGnssFirs.length) {
        h += '<details class="og-gnss-firs"><summary>FIR touchées (EASA, 7 j au ' + escapeHtml(_gnssDay(m.easaDate)) + ')</summary><ol>'
            + _lastGnssFirs.slice(0, 15).map(function (f) {
                return '<li>' + escapeHtml(f.name) + ' <span>' + escapeHtml(f.icao) + (f.spoofing ? ' · leurrage' : '') + '</span></li>';
            }).join('') + '</ol></details>';
    }
    return h + '<div class="og-gnss-src">Stanford GPS Lab, rfi.stanford.edu · EASA</div>';
}
function _gnssLegendSync() {
    if (!maCarte) return;
    if (!_gnssLegend) {
        _gnssLegend = L.control({ position: 'topleft' });
        _gnssLegend.onAdd = function () {
            const div = L.DomUtil.create('div', 'og-gnss-legend og-glass');
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);
            return div;
        };
    }
    const show = maCarte.hasLayer(gnssLayer) && (gnssLayer.getLayers().length > 0 || _lastGnssFirs.length > 0);
    if (show && !_gnssLegend._map) _gnssLegend.addTo(maCarte);
    if (!show && _gnssLegend._map) _gnssLegend.remove();
    if (show) {
        const div = _gnssLegend.getContainer();
        const open = !!(div.querySelector('details') && div.querySelector('details').open);
        div.innerHTML = _gnssLegendHtml();
        if (open && div.querySelector('details')) div.querySelector('details').open = true;
    }
}
gnssLayer.on('add remove', function () { setTimeout(_gnssLegendSync, 0); });

let _lastGnssCells = [];
let _lastGnssEvents = [];
function renderGnss(cells, events, firs) {
    _lastGnssCells = cells || [];
    _lastGnssEvents = events || [];
    _lastGnssFirs = firs || [];
    gnssLayer.clearLayers();
    _lastGnssCells.forEach(function (c) {
        if (!Array.isArray(c.b) || c.b.length < 3) return;
        const lv = GNSS_LEVEL[c.level] || GNSS_LEVEL.faible;
        const poly = L.polygon(c.b, {
            renderer: _gnssCanvas(), pane: 'ogGnss', color: lv.color, weight: 0.6, opacity: 0.7, fillColor: lv.color, fillOpacity: lv.fill
        });
        poly.bindPopup(buildGnssCellContent(c), { maxWidth: 300 });
        gnssLayer.addLayer(poly);
    });
    _lastGnssEvents.forEach(function (e) {
        if (typeof e.lat !== 'number' || typeof e.lon !== 'number') return;
        const jam = e.kind === 'jam';
        const m = L.circleMarker([e.lat, e.lon], {
            radius: jam ? Math.min(9, 4 + Math.log10(1 + e.flights) * 2) : 5,
            color: '#0b0b10', weight: 1.5, fillColor: jam ? '#f472b6' : '#38bdf8', fillOpacity: 0.95,
            className: 'og-gnss-' + e.kind
        });
        m.bindPopup(buildGnssEventContent(e), { maxWidth: 300 });
        gnssLayer.addLayer(m);
    });
    // Compteur : sources, leurrages et hexagones « forts » (les zones à regarder)
    const n = _lastGnssEvents.length + _lastGnssCells.filter(function (c) { return c.level === 'fort'; }).length;
    if (typeof hdrUpdateCount === 'function') hdrUpdateCount('gnss', n);
    if (typeof applyLayers === 'function') applyLayers();
    _gnssLegendSync();
}
