 // ══════════════════════════════════════════════════════════════
//  map.js — Core : utilitaires, globals, allModeCluster, header,
//           filtre, init carte.
//  Chargement : avant tous les fichiers layer-*.js
// ══════════════════════════════════════════════════════════════

const MIN_ZOOM = 2;
const MAX_ZOOM = 18;

let maCarte;
let isMapInitialized = false;

// ── Connectivité ─────────────────────────────────────────────
// Le test d'accès Internet est fait par ogma-sync.js (GET /health, 4 s, mémorisé).
// Variables conservées pour compatibilité avec l'ancien code.
var _hasInternet = false;
var _hasSpAuth   = true;

// ── Utilitaires popup ────────────────────────────────────────
function mono(content) {
    return `<div style="font-family:'Share Tech Mono',monospace;font-size:11px;min-width:280px;max-width:340px;">${content}</div>`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function badge(label, color) {
    return `<span style="padding:2px 8px;font-size:9px;background:${color}22;color:${color};border:1px solid ${color}55;text-transform:uppercase;">${escapeHtml(label)}</span>`;
}

// Intensité sur une échelle 1-5
function intensityColor(level) {
    if (level >= 5) return '#ff2244';
    if (level >= 4) return '#ff5533';
    if (level >= 3) return '#ffaa00';
    if (level >= 2) return '#ffdd55';
    return '#00d4ff';
}

function dotIcon(color) {
    return L.divIcon({
        html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.6);box-shadow:0 0 6px ${color};"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -12],
        className: ''
    });
}

// ── Caches globaux pour le mode ALL ─────────────────────────
let _cacheSignal   = [];
let _cacheOsint    = [];
let _cacheMaritime = [];
let _cacheAviation = [];
let _cacheNews     = [];

// ── ALL mode — cluster unifié ────────────────────────────────
const allModeCluster = L.markerClusterGroup({
    maxClusterRadius: function (zoom) {
        if (zoom <= 3)  return 80;
        if (zoom <= 5)  return 60;
        if (zoom <= 7)  return 40;
        if (zoom <= 9)  return 25;
        if (zoom <= 11) return 15;
        return 1;
    },
    chunkedLoading: true,
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 6,
    showCoverageOnHover: false,
    iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        return L.divIcon({
            html: `<div style="width:36px;height:36px;border-radius:50%;background:#ff440033;border:1px solid #ff4400;display:flex;align-items:center;justify-content:center;font-family:'Share Tech Mono',monospace;font-size:12px;color:#ff8800;">${count}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            className: ''
        });
    }
});

let _rebuildAllModeTimer = null;

function _scheduleRebuildAllMode() {
    if (_activeFilter !== 'ALL') return;
    clearTimeout(_rebuildAllModeTimer);
    _rebuildAllModeTimer = setTimeout(_rebuildAllMode, 60);
}

function _rebuildAllMode() {
    if (!maCarte) return;
    allModeCluster.clearLayers();
    const markers = [];

    _cacheSignal.forEach(function (loc) {
        if (loc.lat == null || loc.lng == null || (loc.lat === 0 && loc.lng === 0)) return;
        const m = L.marker([loc.lat, loc.lng], { icon: dotIcon('#02dbf4') });
        m.bindPopup(buildSignalContent(loc), { maxWidth: 340 });
        markers.push(m);
    });
    _cacheOsint.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null || (ev.lat === 0 && ev.lon === 0)) return;
        const m = L.marker([ev.lat, ev.lon], { icon: dotIcon(osintEventColor(ev)) });
        m.bindPopup(buildOsintContent(ev), { maxWidth: 340 });
        markers.push(m);
    });
    _cacheMaritime.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null || (ev.lat === 0 && ev.lon === 0)) return;
        const m = L.marker([ev.lat, ev.lon], { icon: dotIcon(gdeltEventColor(ev.score ?? 0)) });
        m.bindPopup(buildGdeltEventContent(ev, 'MARITIME'), { maxWidth: 320 });
        markers.push(m);
    });
    _cacheAviation.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null || (ev.lat === 0 && ev.lon === 0)) return;
        const m = L.marker([ev.lat, ev.lon], { icon: dotIcon(gdeltEventColor(ev.score ?? 0)) });
        m.bindPopup(buildGdeltEventContent(ev, 'AVIATION'), { maxWidth: 320 });
        markers.push(m);
    });
    _cacheNews.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null || (ev.lat === 0 && ev.lon === 0)) return;
        const color = ev.color || newsConfidenceColor(ev.confidence ?? 0);
        const [jLat, jLon] = _newsJitter(ev.lat, ev.lon);
        const m = L.marker([jLat, jLon], { icon: dotIcon(color) });
        m.bindPopup(buildNewsContent(ev), { maxWidth: 340 });
        markers.push(m);
    });

    allModeCluster.addLayers(markers);
    if (!maCarte.hasLayer(allModeCluster)) allModeCluster.addTo(maCarte);
}

// ── Header : compteur & countdown ───────────────────────────
const _hdrCounts = {
    signal: 0, osint: 0, seismic: 0, tracks: 0, space: 0,
    newsAir: 0, newsSea: 0, newsSpace: 0, newsOsint: 0,
    maritime: 0, aviation: 0
};

function hdrUpdateCount(key, n) {
    _hdrCounts[key] = n;
    _hdrRefreshCount();
}

function _hdrTotalForFilter(filter) {
    if (filter === 'AIR')   return _hdrCounts.tracks + _hdrCounts.aviation + _hdrCounts.newsAir;
    if (filter === 'SEA')   return _hdrCounts.maritime + _hdrCounts.newsSea;
    if (filter === 'SPACE') return _hdrCounts.space + _hdrCounts.newsSpace;
    if (filter === 'OSINT') return _hdrCounts.signal + _hdrCounts.osint + _hdrCounts.seismic + _hdrCounts.newsOsint;
    return Object.values(_hdrCounts).reduce(function (s, v) { return s + v; }, 0);
}

function _hdrRefreshCount() {
    const el = document.getElementById('hdr-events');
    if (el) el.textContent = _hdrTotalForFilter(_activeFilter);
}

function _hdrResetCountdown() { /* conservé pour compatibilité */ }

// ── Filtre ───────────────────────────────────────────────────
// Fonctions lambdas pour éviter les référence avant chargement des layer files
const _filterLayers = {
    ALL:   function () { return [allModeCluster, seismicLayer, tracksLayer, tracksSeaLayer, spaceLayer, convergenceLayer]; },
    OSINT: function () { return [signalCluster, osintCluster, seismicLayer, newsOsintCluster, convergenceLayer]; },
    AIR:   function () { return [tracksLayer, aviationEvtCluster, newsAirCluster, convergenceLayer]; },
    SEA:   function () { return [tracksSeaLayer, maritimeEvtCluster, newsSeaCluster, convergenceLayer]; },
    SPACE: function () { return [spaceLayer, newsSpaceCluster]; }
};

let _activeFilter = 'ALL';

function setFilter(name) {
    if (!_filterLayers[name]) return;
    _activeFilter = name;

    ['ALL', 'OSINT', 'AIR', 'SEA', 'SPACE'].forEach(function (f) {
        const btn = document.getElementById('btn-' + f);
        if (!btn) return;
        if (f === name) { btn.classList.add('active'); } else { btn.classList.remove('active'); }
    });

    if (name === 'ALL') _rebuildAllMode();

    const visible = _filterLayers[name]();

    const allKnown = [
        allModeCluster,
        signalCluster, osintCluster, seismicLayer,
        newsOsintCluster, newsAirCluster, newsSeaCluster, newsSpaceCluster,
        tracksLayer, tracksSeaLayer, aviationEvtCluster, maritimeEvtCluster, spaceLayer, convergenceLayer
    ];

    allKnown.forEach(function (layer) {
        if (!layer || !maCarte) return;
        if (visible.indexOf(layer) !== -1) {
            if (!maCarte.hasLayer(layer)) layer.addTo(maCarte);
        } else {
            if (maCarte.hasLayer(layer)) maCarte.removeLayer(layer);
        }
    });

    _hdrRefreshCount();
}



// ── Initialisation carte ─────────────────────────────────────
async function initializeMap() {
    if (isMapInitialized) {
        maCarte.invalidateSize();
        return;
    }

    maCarte = L.map('maCarte', {
        center: [48.8566, 2.3522],
        zoom: 3,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM
    });

    maCarte.setMaxBounds([[-90, -180], [90, 180]]);

    // Couche de base Dark Gray → rendu noir via filtre CSS
    // Fond de carte public (vitrine) : défini dans config.js
    L.tileLayer(APP.CONFIG.BASEMAP.url, {
        maxZoom: MAX_ZOOM,
        minZoom: MIN_ZOOM,
        subdomains: APP.CONFIG.BASEMAP.subdomains || 'abc',
        attribution: APP.CONFIG.BASEMAP.attribution || ''
    }).addTo(maCarte);

    // Affichage du niveau de zoom
    const zoomDisplay = L.control({ position: 'topright' });
    zoomDisplay.onAdd = function (map) {
        const div = L.DomUtil.create('div', 'zoom-level-display');
        div.innerHTML = 'Zoom: ' + map.getZoom();
        div.style.background = 'white';
        div.style.opacity = '0.8';
        div.style.color = 'black';
        div.style.padding = '5px 10px';
        div.style.border = '2px solid rgba(0,0,0,0.2)';
        div.style.borderRadius = '4px';
        div.style.margin = '10px';
        return div;
    };
    zoomDisplay.addTo(maCarte);

    maCarte.on('zoomend', function () {
        const display = document.querySelector('.zoom-level-display');
        if (display) display.innerHTML = 'Zoom: ' + maCarte.getZoom();
    });

    // Échelle
    L.control.scale({ imperial: false, maxWidth: 200 }).addTo(maCarte);

    // Redimensionnement automatique
    window.addEventListener('resize', function () { maCarte.invalidateSize(); });
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(function () { maCarte.invalidateSize(); })
            .observe(document.getElementById('maCarte'));
    }

    isMapInitialized = true;

    // Les couches reçoivent leurs données du snapshot SharePoint (ogma-feed.js),
    // et ce poste devient relais s'il a accès à Internet (ogma-sync.js).
    APP.Feed.start();
    APP.Sync.start();
}

document.addEventListener('DOMContentLoaded', initializeMap);
