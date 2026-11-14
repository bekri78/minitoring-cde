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

// Convergence : anneau indigo discret (V2)
function convergenceIcon(c) {
    return L.divIcon({
        html: '<span class="og-conv" title="' + c.types.length + ' types de signaux"></span>',
        iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10], className: ''
    });
}

// Ruptures : point rouge (forte) ou orange (notable) avec halo, sur la carte en permanence
const ruptureLayer = L.layerGroup();
function renderRuptureMarkers(list) {
    ruptureLayer.clearLayers();
    (list || []).forEach(function (r) {
        if (typeof r.lat !== 'number' || typeof r.lon !== 'number') return;
        const color = r.level === 'forte' ? '#f2555a' : '#f2994a';
        const chip = r.level === 'forte' ? '<span class="og-rupt-chip">' + escapeHtml(ogmaFr(r.country)) + ' ' + (r.ratio ? '×' + String(r.ratio).replace('.', ',') : '') + '</span>' : '';
        const m = L.marker([r.lat, r.lon], {
            icon: L.divIcon({
                html: '<span class="og-rupt"><span class="og-rupt-halo" style="background:' + color + '"></span><span class="og-rupt-dot" style="background:' + color + '"></span>' + chip + '</span>',
                iconSize: [0, 0], className: ''
            }),
            zIndexOffset: 900
        });
        m.on('click', function () { showRupture(r); });
        ruptureLayer.addLayer(m);
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
    renderRuptureMarkers(_lastRuptures);
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

function _ruptureExplain(r, events, siblings) {
    siblings = siblings || [];
    const also = siblings.length
        ? '<div class="og-d-label">Autres ruptures dans ce pays</div><ul class="og-d-sources">' + siblings.map(function (o) {
              return '<li>' + escapeHtml(RUPTURE_CATEGORY_LABEL[o.category] || o.category) + ' — ' + o.today + ' signaux contre ' + _fr(o.baseline)
                  + '/j <b class="' + (o.level === 'forte' ? 'og-d-crit-t' : 'og-d-warn-t') + '">' + (o.ratio ? '×' + _fr(o.ratio) : 'nouveau') + '</b></li>';
          }).join('') + '</ul>'
        : '';
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
        ? '<div class="og-d-label">Principaux signaux</div><ul class="og-d-sources">'
          + events.slice(0, 6).map(function (e) {
                const t = escapeHtml(e.titleFr || e.title || '(sans titre)');
                const src = e.domain ? '<span class="og-d-muted"> — ' + escapeHtml(e.domain) + '</span>' : '';
                return '<li>' + (e.url ? '<a href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener">' + t + '</a>' : t) + src + '</li>';
            }).join('') + '</ul>'
        : '<p class="og-d-muted">Détail des signaux indisponible dans ce snapshot.</p>';
    return '<div class="og-d">'
        + '<div class="og-d-tags"><span class="og-d-tag ' + (strong ? 'og-d-crit' : 'og-d-warn') + '">' + (strong ? 'Rupture critique' : 'Rupture à surveiller') + ' · 24 h</span></div>'
        + '<h3 class="og-d-title">' + escapeHtml(ogmaFr(r.country)) + ' — ' + escapeHtml(cat) + '</h3>'
        + '<p class="og-d-text">' + why + '</p>'
        + '<div class="og-d-kpis">'
        +   '<div><b>' + r.today + '</b><span>signaux 24 h</span></div>'
        +   '<div><b>' + _fr(r.baseline) + '</b><span>normale / jour</span></div>'
        +   '<div><b class="' + (strong ? 'og-d-crit-t' : 'og-d-warn-t') + '">' + (emergence ? 'nouveau' : '×' + _fr(r.ratio)) + '</b><span>écart</span></div>'
        + '</div>'
        + '<p class="og-d-muted">' + strength + '</p>'
        + places + also + list
        + '<p class="og-d-hint">La carte n\u2019affiche plus que les signaux de cette rupture. « Tout afficher » rétablit les autres.</p>'
        + '<button type="button" class="og-d-ask" data-ask="' + escapeHtml('Pourquoi ' + ogmaFr(r.country) + ' ressort-il en rupture « ' + cat + ' » aujourd\u2019hui ?') + '">'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>Demander à OGMA d\u2019expliquer</button>'
        + '</div>';
}

// Fiche d'une rupture : pas de déplacement de la carte. Tous les autres marqueurs
// disparaissent ; seuls restent la rupture et les événements du jour qui la
// composent (même pays, même catégorie). « Tout afficher » ou le retour rétablit la carte.
function _ruptureRelated(r, siblings) {
    const all = (window.APP && APP.Sync && APP.Sync.current && APP.Sync.current.data && APP.Sync.current.data.osint) || [];
    const cats = [r].concat(siblings || []).map(function (x) { return x.category; });
    const whole = cats.indexOf('all') !== -1;
    const related = all.filter(function (e) {
        return e.countryCode === r.countryCode && (whole || cats.indexOf(e.category) !== -1);
    });
    // Repli : les identifiants cités par le serveur (anciens snapshots sans countryCode)
    return related.length ? related : _ruptureEvents(r);
}

function showRupture(r, siblings) {
    siblings = siblings || [];
    const events = _ruptureRelated(r, siblings);
    const color = r.level === 'forte' ? '#f2555a' : '#f2994a';
    ruptureFocusLayer.clearLayers();
    events.forEach(function (e) {
        if (typeof e.lat !== 'number' || typeof e.lon !== 'number') return;
        const m = L.marker([e.lat, e.lon], { icon: dotIcon(color) });
        if (typeof buildOsintContent === 'function') m.bindPopup(buildOsintContent(e), { maxWidth: 340 });
        ruptureFocusLayer.addLayer(m);
    });
    if (typeof r.lat === 'number') {
        ruptureFocusLayer.addLayer(L.marker([r.lat, r.lon], {
            icon: L.divIcon({ html: '<span class="og-rupt"><span class="og-rupt-halo" style="background:' + color + '"></span><span class="og-rupt-dot" style="background:' + color + '"></span></span>', iconSize: [0, 0], className: '' }),
            zIndexOffset: 900, interactive: false
        }));
    }
    const cat = RUPTURE_CATEGORY_LABEL[r.category] || r.category;
    const label = ogmaFr(r.country || r.countryCode) + (siblings.length ? '' : ' — ' + cat) + ' (' + events.length + (events.length > 1 ? ' signaux' : ' signal') + ')';
    if (typeof setMapFocus === 'function') setMapFocus(ruptureFocusLayer, label);
    const html = _ruptureExplain(r, events, siblings);
    const close = function () { ruptureFocusLayer.clearLayers(); if (typeof clearMapFocus === 'function') clearMapFocus(); };
    if (APP.UI && APP.UI.showDetail(html, close)) return;
    L.popup({ maxWidth: 340 }).setLatLng([r.lat, r.lon]).setContent(html).openOn(maCarte).on('remove', close);
}

// ── Point d'entrée appelé par ogma-feed.js ───────────────────
function renderInsights(data) {
    // v44 : convergences retirées de l'interface (toujours calculées par le serveur, transmises à l'IA)
    renderConvergences([]);
    renderRuptures(data.ruptures || []);
}



