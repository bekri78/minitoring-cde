// ── Analyses croisées : convergences, ruptures ─────
//  - Convergences : foyers où se croisent au moins 3 types de signaux
//    (avions / navires militaires, anomalies AIS, événements, articles).
//  - Ruptures : pays dont l'activité des dernières 24 h sort nettement
//    de sa normale des 28 jours précédents.
//  - Zone : la recherche de lieu (ogma-search.js) filtre les panneaux.
//  Données calculées par le serveur et livrées dans le snapshot.

const convergenceLayer = L.layerGroup();

// Filtre géographique : theatreContains() est fourni par ogma-search.js

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
    if (APP.UI) APP.UI.renderAlerts();
}

// ── Ruptures ─────────────────────────────────────────────────
const RUPTURE_CATEGORY_LABEL = {
    all: 'activité globale', military: 'militaire', conflict: 'conflit', terrorism: 'terrorisme',
    strategic: 'stratégique', crisis: 'crise', protest: 'contestation'
};

let _lastRuptures = [];

function _fmtRatio(r) {
    if (r.kind === 'emergence' || r.ratio == null) return 'nouveau';
    return '×' + String(r.ratio).replace('.', ',');
}

// La liste est présentée par la barre de droite (« À surveiller », ogma-ui.js)
function renderRuptures(list) {
    _lastRuptures = list || [];
    if (APP.UI) APP.UI.renderAlerts();
}

// ── Détail d'une rupture : on cadre le pays sur ses événements et on explique ──
const ruptureFocusLayer = L.layerGroup();

function _ruptureEvents(r) {
    const all = (window.APP && APP.Sync && APP.Sync.current && APP.Sync.current.data && APP.Sync.current.data.osint) || [];
    const byId = {};
    all.forEach(function (e) { byId[String(e.id)] = e; });
    return (r.eventIds || []).map(function (id) { return byId[String(id)]; }).filter(Boolean);
}

function _distKm(aLat, aLon, bLat, bLon) {
    const R = 6371, t = Math.PI / 180;
    const dLat = (bLat - aLat) * t, dLon = (bLon - aLon) * t;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function _fr(n) { return String(n).replace('.', ','); }

function _ruptureExplain(r, events) {
    const cat = RUPTURE_CATEGORY_LABEL[r.category] || r.category;
    const strong = r.level === 'forte';
    const emergence = r.kind === 'emergence' || r.ratio == null;
    const why = emergence
        ? '<b>' + r.today + '</b> signaux « ' + escapeHtml(cat) + ' » en 24 h, alors que ce pays n\u2019en produit presque jamais (normale : '
            + _fr(r.baseline) + ' par jour sur les 28 derniers jours).'
        : '<b>' + r.today + '</b> signaux « ' + escapeHtml(cat) + ' » en 24 h contre <b>' + _fr(r.baseline)
            + '</b> par jour en moyenne sur les 28 derniers jours, soit <b>' + _fr(r.ratio) + ' fois</b> la normale.';
    const strength = strong
        ? 'Écart très au-delà des variations habituelles (' + _fr(r.z) + ' écarts-types).'
        : 'Écart net par rapport aux variations habituelles (' + _fr(r.z) + ' écarts-types).';
    const places = (r.places || []).length
        ? '<p class="og-d-muted">Lieux cités : <span class="og-d-text">' + r.places.map(function (p) { return escapeHtml(p.name) + ' (' + p.count + ')'; }).join(', ') + '</span></p>'
        : '';
    const list = events.length
        ? '<div class="og-d-label">PRINCIPAUX SIGNAUX</div><ul class="og-d-sources">'
          + events.slice(0, 6).map(function (e) {
                const t = escapeHtml(e.titleFr || e.title || '(sans titre)');
                const src = e.domain ? '<span class="og-d-muted"> — ' + escapeHtml(e.domain) + '</span>' : '';
                return '<li>' + (e.url ? '<a href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener">' + t + '</a>' : t) + src + '</li>';
            }).join('') + '</ul>'
        : '<p class="og-d-muted">Détail des signaux indisponible dans ce snapshot.</p>';
    return '<div class="og-d">'
        + '<div class="og-d-tags"><span class="og-d-tag ' + (strong ? 'og-d-crit' : 'og-d-warn') + '">' + (strong ? 'CRITIQUE' : 'À SURVEILLER') + '</span><span class="og-d-kind">RUPTURE 24 H</span></div>'
        + '<h3 class="og-d-title">' + escapeHtml(r.country) + ' · ' + escapeHtml(cat) + '</h3>'
        + '<p class="og-d-text">' + why + '</p>'
        + '<div class="og-d-kpis">'
        +   '<div><b>' + r.today + '</b><span>signaux 24 h</span></div>'
        +   '<div><b>' + _fr(r.baseline) + '</b><span>normale / jour</span></div>'
        +   '<div><b class="' + (strong ? 'og-d-crit-t' : 'og-d-warn-t') + '">' + (emergence ? 'nouveau' : '×' + _fr(r.ratio)) + '</b><span>écart</span></div>'
        + '</div>'
        + '<p class="og-d-muted">' + strength + '</p>'
        + places + list
        + '<p class="og-d-hint">Les cercles sur la carte montrent où ces signaux sont localisés.</p>'
        + '</div>';
}

function showRupture(r) {
    const events = _ruptureEvents(r);
    ruptureFocusLayer.clearLayers();
    if (!maCarte.hasLayer(ruptureFocusLayer)) ruptureFocusLayer.addTo(maCarte);

    // On garde les signaux proches du centre de la rupture (un article mal géolocalisé
    // à l'autre bout du monde ne doit pas faire dézoomer la carte)
    const hasCenter = typeof r.lat === 'number' && typeof r.lon === 'number';
    const pts = events.filter(function (e) {
        return typeof e.lat === 'number' && typeof e.lon === 'number'
            && (!hasCenter || _distKm(r.lat, r.lon, e.lat, e.lon) < 1500);
    });
    const color = r.level === 'forte' ? '#ff2244' : '#ffaa00';
    pts.forEach(function (e) {
        ruptureFocusLayer.addLayer(L.circleMarker([e.lat, e.lon], { radius: 9, color: color, weight: 2, fillOpacity: 0.15, interactive: false }));
    });

    const center = hasCenter ? [r.lat, r.lon] : (pts.length ? [pts[0].lat, pts[0].lon] : null);
    if (!center) return;
    if (pts.length >= 2) {
        const b = L.latLngBounds(pts.map(function (e) { return [e.lat, e.lon]; })).extend(center);
        maCarte.flyToBounds(b.pad(0.3), { maxZoom: 7, duration: 0.8 });
    } else {
        maCarte.flyTo(center, 6, { duration: 0.8 });
    }
    // La fiche s'ouvre dans la barre de droite ; les cercles disparaissent à sa fermeture
    const html = _ruptureExplain(r, events);
    if (APP.UI && APP.UI.showDetail(html, function () { ruptureFocusLayer.clearLayers(); })) return;
    const popup = L.popup({ maxWidth: 340, autoPan: true }).setLatLng(center).setContent(html);
    maCarte.once('moveend', function () { popup.openOn(maCarte); });
    popup.on('remove', function () { ruptureFocusLayer.clearLayers(); });
}

// ── Point d'entrée appelé par ogma-feed.js ───────────────────
function renderInsights(data) {
    renderConvergences(data.convergences || []);
    renderRuptures(data.ruptures || []);
}



