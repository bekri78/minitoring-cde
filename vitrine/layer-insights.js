// ── Analyses croisées : convergences, ruptures, théâtres ─────
//  - Convergences : foyers où se croisent au moins 3 types de signaux
//    (avions / navires militaires, anomalies AIS, événements, articles).
//  - Ruptures : pays dont l'activité des dernières 24 h sort nettement
//    de sa normale des 28 jours précédents.
//  - Théâtre : recadre la carte et filtre les panneaux.
//  Données calculées par le serveur et livrées dans le snapshot.

const convergenceLayer = L.layerGroup();

// ── Théâtres ─────────────────────────────────────────────────
const THEATRES = {
    MONDE:          { label: 'MONDE',                 bounds: null },
    EUROPE:         { label: 'EUROPE · FLANC EST',    bounds: [[35, -12], [72, 45]] },
    LEVANT:         { label: 'LEVANT · MOYEN-ORIENT', bounds: [[12, 25], [42, 63]] },
    AFRIQUE:        { label: 'AFRIQUE · SAHEL',       bounds: [[-5, -20], [25, 40]] },
    INDOPACIFIQUE:  { label: 'INDO-PACIFIQUE',        bounds: [[-45, 60], [45, 180]] },
    AMERIQUES:      { label: 'AMÉRIQUES',             bounds: [[-55, -170], [72, -30]] }
};

let _theatre = 'MONDE';
try { _theatre = localStorage.getItem('ogma-theatre') || 'MONDE'; } catch (e) { /* confort */ }
if (!THEATRES[_theatre]) _theatre = 'MONDE';

function theatreContains(lat, lon) {
    const b = THEATRES[_theatre].bounds;
    if (!b) return true;
    if (typeof lat !== 'number' || typeof lon !== 'number') return false;
    return lat >= b[0][0] && lat <= b[1][0] && lon >= b[0][1] && lon <= b[1][1];
}

function setTheatre(name) {
    if (!THEATRES[name]) return;
    _theatre = name;
    try { localStorage.setItem('ogma-theatre', name); } catch (e) { /* confort */ }
    const sel = document.getElementById('theatre-select');
    if (sel && sel.value !== name) sel.value = name;
    const b = THEATRES[name].bounds;
    if (maCarte) {
        if (b) maCarte.fitBounds(b, { padding: [10, 10] });
        else maCarte.setView([30, 20], 3);
    }
    document.dispatchEvent(new CustomEvent('ogma:theatre', { detail: name }));
}

function _initTheatreSelect() {
    const sel = document.getElementById('theatre-select');
    if (!sel || sel.options.length) return;
    Object.keys(THEATRES).forEach(function (k) {
        const o = document.createElement('option');
        o.value = k; o.textContent = THEATRES[k].label;
        sel.appendChild(o);
    });
    sel.value = _theatre;
    sel.addEventListener('change', function () { setTheatre(sel.value); });
}

// ── Convergences ─────────────────────────────────────────────
const CONV_TYPE_LABEL = {
    air:   ['✈', 'Avions militaires'],
    sea:   ['⚓', 'Navires militaires'],
    ais:   ['⚠', 'Anomalies AIS'],
    event: ['◉', 'Événements'],
    news:  ['❙', 'Articles']
};
const CONV_COLOR = '#ff3dbb';

function _injectInsightsCSS() {
    if (document.getElementById('insights-style')) return;
    const s = document.createElement('style');
    s.id = 'insights-style';
    s.textContent = '@keyframes conv-pulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.2);opacity:0}}';
    document.head.appendChild(s);
}

function convergenceIcon(c) {
    const size = Math.min(40, 18 + c.types.length * 4);
    return L.divIcon({
        html: '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;">'
            + '<div style="position:absolute;inset:0;border-radius:50%;border:2px solid ' + CONV_COLOR + ';animation:conv-pulse 2.2s ease-out infinite;"></div>'
            + '<div style="position:absolute;inset:25%;border-radius:50%;background:' + CONV_COLOR + '33;border:2px solid ' + CONV_COLOR + ';'
            + 'display:flex;align-items:center;justify-content:center;color:#fff;font:bold 10px \'Share Tech Mono\',monospace;">' + c.types.length + '</div>'
            + '</div>',
        iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2], className: ''
    });
}

function buildConvergenceContent(c) {
    const rows = c.types.map(function (t) {
        const lbl = CONV_TYPE_LABEL[t] || ['•', t];
        const items = (c.items && c.items[t] || []).slice(0, 3).map(function (it) {
            return '<div style="color:#8ab4c8;font-size:9px;margin-left:16px;line-height:1.4;">– '
                + escapeHtml(String(it.label || it.id || '').substring(0, 90)) + '</div>';
        }).join('');
        return '<div style="margin-bottom:6px;"><span style="color:' + CONV_COLOR + ';">' + lbl[0] + '</span> '
            + '<span style="color:#e8f4ff;">' + lbl[1] + '</span> '
            + '<span style="color:#4a6a7a;">× ' + (c.counts && c.counts[t] || 0) + '</span>' + items + '</div>';
    }).join('');
    return mono(
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">'
        + badge('CONVERGENCE', CONV_COLOR)
        + badge(c.types.length + ' TYPES DE SIGNAUX', CONV_COLOR)
        + '</div>'
        + '<div style="color:#4a6a7a;font-size:9px;margin-bottom:8px;">📍 ' + escapeHtml(c.label || 'Zone') + ' · rayon ≈ 200 km</div>'
        + rows
        + '<div style="font-size:9px;color:#4a6a7a;border-top:1px solid #1a2a3a;padding-top:6px;">Plusieurs sources indépendantes se croisent ici : à examiner en priorité.</div>'
    );
}

let _lastConvergences = [];

function renderConvergences(list) {
    _injectInsightsCSS();
    _lastConvergences = list || [];
    convergenceLayer.clearLayers();
    _lastConvergences.forEach(function (c) {
        if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return;
        const m = L.marker([c.lat, c.lon], { icon: convergenceIcon(c), zIndexOffset: 800 });
        m.bindPopup(buildConvergenceContent(c), { maxWidth: 360 });
        convergenceLayer.addLayer(m);
    });
    if (maCarte && !maCarte.hasLayer(convergenceLayer)) convergenceLayer.addTo(maCarte);
}

// ── Ruptures ─────────────────────────────────────────────────
const RUPTURE_CATEGORY_LABEL = {
    all: 'activité globale', military: 'militaire', conflict: 'conflit', terrorism: 'terrorisme',
    strategic: 'stratégique', crisis: 'crise', protest: 'contestation'
};

let _rupturesControl = null;
let _lastRuptures = [];

function _fmtRatio(r) {
    if (r.kind === 'emergence' || r.ratio == null) return 'nouveau';
    return '×' + String(r.ratio).replace('.', ',');
}

function renderRuptures(list) {
    _lastRuptures = list || [];
    if (!_rupturesControl) {
        _rupturesControl = L.control({ position: 'bottomleft' });
        _rupturesControl.onAdd = function () {
            const div = L.DomUtil.create('div', 'ruptures-widget');
            div.style.cssText = 'font-family:"Share Tech Mono",monospace;font-size:10px;background:#0a0f16cc;border:1px solid #1a2a3a;padding:8px 12px;max-width:260px;';
            L.DomEvent.disableClickPropagation(div);
            return div;
        };
        _rupturesControl.addTo(maCarte);
    }
    const el = document.querySelector('.ruptures-widget');
    if (!el) return;

    const shown = _lastRuptures.filter(function (r) { return theatreContains(r.lat, r.lon); }).slice(0, 5);
    const head = '<div style="color:#4a6a7a;font-size:8px;letter-spacing:0.1em;margin-bottom:6px;">RUPTURES 24 H <span title="Activité des dernières 24 h comparée à la moyenne des 28 jours précédents" style="cursor:help;">ⓘ</span></div>';
    if (!shown.length) {
        el.innerHTML = head + '<div style="color:#4a6a7a;font-size:9px;">Aucune activité inhabituelle</div>';
        return;
    }
    el.innerHTML = head + shown.map(function (r, i) {
        const color = r.level === 'forte' ? '#ff2244' : '#ffaa00';
        const cat = RUPTURE_CATEGORY_LABEL[r.category] || r.category;
        return '<div data-rupture="' + i + '" style="display:flex;align-items:baseline;gap:6px;padding:4px 2px;border-bottom:1px solid #1a2a3a;cursor:pointer;"'
            + ' onmouseover="this.style.background=\'#ff22440a\'" onmouseout="this.style.background=\'transparent\'">'
            + '<span style="color:' + color + ';font-size:9px;">▲</span>'
            + '<div style="flex:1;">'
            + '<div style="color:#c8d8e8;font-size:9px;">' + escapeHtml(r.country) + ' · ' + escapeHtml(cat) + '</div>'
            + '<div style="color:' + color + ';font-size:8px;">' + _fmtRatio(r) + ' · ' + r.today + ' signaux (normale ' + String(r.baseline).replace('.', ',') + '/j)</div>'
            + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-rupture]'), function (row) {
        row.addEventListener('click', function () {
            const r = shown[Number(row.getAttribute('data-rupture'))];
            if (r && typeof r.lat === 'number') maCarte.flyTo([r.lat, r.lon], 5, { duration: 0.8 });
        });
    });
}

// ── Point d'entrée appelé par ogma-feed.js ───────────────────
function renderInsights(data) {
    renderConvergences(data.convergences || []);
    renderRuptures(data.ruptures || []);
}

document.addEventListener('ogma:theatre', function () {
    renderRuptures(_lastRuptures);
});

document.addEventListener('DOMContentLoaded', function () {
    _initTheatreSelect();
    // Recadrage initial une fois la carte créée
    setTimeout(function () { if (_theatre !== 'MONDE') setTheatre(_theatre); }, 0);
});
