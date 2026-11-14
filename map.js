 // ══════════════════════════════════════════════════════════════
//  map.js — Core : utilitaires, globals, cluster commun, calques
//           cumulables, compteurs, init carte.
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
    return `<div class="og-pop" style="min-width:280px;max-width:340px;">${content}</div>`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function badge(label, color) {
    return `<span class="og-badge" style="color:${color};background:${color}1f;">${escapeHtml(label)}</span>`;
}

// Noms de pays affichés en français (les sources les donnent en anglais)
const OGMA_FR = {
    'Afghanistan': 'Afghanistan', 'Algeria': 'Algérie', 'Argentina': 'Argentine', 'Armenia': 'Arménie', 'Australia': 'Australie',
    'Azerbaijan': 'Azerbaïdjan', 'Bahrain': 'Bahreïn', 'Bangladesh': 'Bangladesh', 'Belarus': 'Biélorussie', 'Belgium': 'Belgique',
    'Bosnia and Herzegovina': 'Bosnie-Herzégovine', 'Brazil': 'Brésil', 'Bulgaria': 'Bulgarie', 'Burkina Faso': 'Burkina Faso',
    'Burundi': 'Burundi', 'Cameroon': 'Cameroun', 'Canada': 'Canada', 'Central African Republic': 'Centrafrique', 'Chad': 'Tchad',
    'China': 'Chine', 'Colombia': 'Colombie', 'Congo': 'Congo', 'Democratic Republic of the Congo': 'RD Congo', 'Cuba': 'Cuba',
    'Cyprus': 'Chypre', 'Czech Republic': 'Tchéquie', 'Denmark': 'Danemark', 'Djibouti': 'Djibouti', 'Egypt': 'Égypte',
    'Eritrea': 'Érythrée', 'Estonia': 'Estonie', 'Ethiopia': 'Éthiopie', 'Finland': 'Finlande', 'France': 'France', 'Georgia': 'Géorgie',
    'Germany': 'Allemagne', 'Greece': 'Grèce', 'Greenland': 'Groenland', 'Haiti': 'Haïti', 'Hungary': 'Hongrie', 'India': 'Inde',
    'Indonesia': 'Indonésie', 'Iran': 'Iran', 'Iraq': 'Irak', 'Ireland': 'Irlande', 'Israel': 'Israël', 'Italy': 'Italie', 'Japan': 'Japon',
    'Jordan': 'Jordanie', 'Kazakhstan': 'Kazakhstan', 'Kenya': 'Kenya', 'Kosovo': 'Kosovo', 'Kuwait': 'Koweït', 'Latvia': 'Lettonie',
    'Lebanon': 'Liban', 'Libya': 'Libye', 'Lithuania': 'Lituanie', 'Mali': 'Mali', 'Mauritania': 'Mauritanie', 'Mexico': 'Mexique',
    'Moldova': 'Moldavie', 'Morocco': 'Maroc', 'Mozambique': 'Mozambique', 'Myanmar': 'Birmanie', 'Netherlands': 'Pays-Bas',
    'Niger': 'Niger', 'Nigeria': 'Nigéria', 'North Korea': 'Corée du Nord', 'Norway': 'Norvège', 'Oman': 'Oman', 'Pakistan': 'Pakistan',
    'Palestine': 'Palestine', 'Philippines': 'Philippines', 'Poland': 'Pologne', 'Portugal': 'Portugal', 'Qatar': 'Qatar',
    'Romania': 'Roumanie', 'Russia': 'Russie', 'Rwanda': 'Rwanda', 'Saudi Arabia': 'Arabie saoudite', 'Senegal': 'Sénégal',
    'Serbia': 'Serbie', 'Somalia': 'Somalie', 'South Africa': 'Afrique du Sud', 'South Korea': 'Corée du Sud', 'South Sudan': 'Soudan du Sud',
    'Spain': 'Espagne', 'Sudan': 'Soudan', 'Sweden': 'Suède', 'Switzerland': 'Suisse', 'Syria': 'Syrie', 'Taiwan': 'Taïwan',
    'Thailand': 'Thaïlande', 'Tunisia': 'Tunisie', 'Turkey': 'Turquie', 'Uganda': 'Ouganda', 'Ukraine': 'Ukraine',
    'United Arab Emirates': 'Émirats arabes unis', 'United Kingdom': 'Royaume-Uni', 'United States': 'États-Unis',
    'Venezuela': 'Venezuela', 'Vietnam': 'Viêt Nam', 'Yemen': 'Yémen', 'West Bank': 'Cisjordanie', 'Gaza Strip': 'Gaza'
};
// « Tehran, Iran » → « Tehran, Iran » ; « United States » → « États-Unis »
function ogmaFr(name) {
    const parts = String(name == null ? '' : name).split(',').map(function (x) { return x.trim(); });
    const last = parts.length - 1;
    if (OGMA_FR[parts[last]]) parts[last] = OGMA_FR[parts[last]];
    return parts.join(', ');
}

// Intensité sur une échelle 1-5
function intensityColor(level) {
    if (level >= 5) return '#ff2244';
    if (level >= 4) return '#ff5533';
    if (level >= 3) return '#ffaa00';
    if (level >= 2) return '#ffdd55';
    return '#00d4ff';
}

// Point discret (V2) : la couleur porte la gravité, sans halo
function dotIcon(color) {
    return L.divIcon({
        html: `<span class="og-pt" style="width:8px;height:8px;background:${color};opacity:.9"></span>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -8],
        className: 'og-pt-wrap'
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
        const w = count < 10 ? 26 : count < 100 ? 32 : 38;
        return L.divIcon({
            html: `<div class="og-cluster" style="width:${w}px">${count}</div>`,
            iconSize: [w, 22],
            iconAnchor: [w / 2, 11],
            className: ''
        });
    }
});

let _rebuildAllModeTimer = null;

// ── Calques cumulables (barre de gauche) ─────────────────────
// Chaque catégorie s'allume ou s'éteint indépendamment. Les points
// d'événements de toutes les catégories actives partagent un seul cluster
// (allModeCluster) pour ne pas superposer plusieurs grappes au même endroit.
const OG_LAYERS = ['osint', 'air', 'sea', 'space', 'fires', 'gnss', 'conv'];
let _layersOn = { osint: true, air: true, sea: true, space: true, fires: true, gnss: true, conv: true };
try {
    const saved = JSON.parse(localStorage.getItem('ogma-layers') || 'null');
    if (saved) OG_LAYERS.forEach(function (k) { if (typeof saved[k] === 'boolean') _layersOn[k] = saved[k]; });
} catch (e) { /* confort */ }

// Compatibilité : les couches testent _activeFilter === 'ALL' pour déléguer
// leur affichage au cluster commun.
let _activeFilter = 'ALL';

function layerOn(key) { return !!_layersOn[key]; }

function _scheduleRebuildAllMode() {
    clearTimeout(_rebuildAllModeTimer);
    _rebuildAllModeTimer = setTimeout(_rebuildAllMode, 60);
}

function _rebuildAllMode() {
    if (!maCarte) return;
    allModeCluster.clearLayers();
    const markers = [];
    function add(lat, lon, icon, html, maxWidth) {
        if (lat == null || lon == null || (lat === 0 && lon === 0)) return;
        const m = L.marker([lat, lon], { icon: icon });
        m.bindPopup(html, { maxWidth: maxWidth || 340 });
        markers.push(m);
    }

    if (layerOn('osint')) {
        _cacheSignal.forEach(function (loc) { add(loc.lat, loc.lng, dotIcon('#02dbf4'), buildSignalContent(loc)); });
        _cacheOsint.forEach(function (ev) { add(ev.lat, ev.lon, dotIcon(osintEventColor(ev)), buildOsintContent(ev)); });
    }
    if (layerOn('sea')) {
        _cacheMaritime.forEach(function (ev) { add(ev.lat, ev.lon, dotIcon(gdeltEventColor(ev.score ?? 0)), buildGdeltEventContent(ev, 'MARITIME'), 320); });
    }
    if (layerOn('air')) {
        _cacheAviation.forEach(function (ev) { add(ev.lat, ev.lon, dotIcon(gdeltEventColor(ev.score ?? 0)), buildGdeltEventContent(ev, 'AVIATION'), 320); });
    }
    _cacheNews.forEach(function (ev) {
        if (ev.lat == null || ev.lon == null || (ev.lat === 0 && ev.lon === 0)) return;
        if (!layerOn(_newsEventDomain(ev))) return;
        const color = ev.color || newsConfidenceColor(ev.confidence ?? 0);
        const [jLat, jLon] = _newsJitter(ev.lat, ev.lon);
        add(jLat, jLon, dotIcon(color), buildNewsContent(ev));
    });

    allModeCluster.addLayers(markers);
    if (!_focusLayer && !maCarte.hasLayer(allModeCluster)) allModeCluster.addTo(maCarte);
}

// Mode « focus » : une fiche ouverte limite la carte à ses propres éléments
let _focusLayer = null;
function setMapFocus(layer, label) {
    _focusLayer = layer;
    document.body.classList.add('og-focus');
    const l = document.getElementById('og-focus-label');
    if (l) l.textContent = label || '';
    applyLayers();
}
function clearMapFocus() {
    if (_focusLayer && maCarte && maCarte.hasLayer(_focusLayer)) maCarte.removeLayer(_focusLayer);
    _focusLayer = null;
    document.body.classList.remove('og-focus');
    applyLayers();
}

// Affiche exactement les couches des catégories actives
function applyLayers() {
    if (!maCarte) return;
    if (_focusLayer) {
        const others = [allModeCluster, signalCluster, osintCluster, seismicLayer, newsOsintCluster, newsAirCluster, newsSeaCluster,
            newsSpaceCluster, tracksLayer, tracksSeaLayer, aviationEvtCluster, maritimeEvtCluster, spaceLayer, convergenceLayer,
            typeof ruptureLayer !== 'undefined' ? ruptureLayer : null, typeof crisesLayer !== 'undefined' ? crisesLayer : null,
            typeof firesLayer !== 'undefined' ? firesLayer : null, typeof gnssLayer !== 'undefined' ? gnssLayer : null];
        others.forEach(function (layer) { if (layer && maCarte.hasLayer(layer)) maCarte.removeLayer(layer); });
        if (!maCarte.hasLayer(_focusLayer)) _focusLayer.addTo(maCarte);
        _hdrRefreshCount();
        return;
    }
    const visible = [allModeCluster];
    if (layerOn('osint')) visible.push(seismicLayer);
    if (layerOn('air'))   visible.push(tracksLayer);
    if (layerOn('sea'))   visible.push(tracksSeaLayer);
    if (layerOn('space')) visible.push(spaceLayer);
    if (layerOn('conv'))  visible.push(convergenceLayer);
    if (layerOn('fires') && typeof firesLayer !== 'undefined') visible.push(firesLayer);
    if (layerOn('gnss') && typeof gnssLayer !== 'undefined') visible.push(gnssLayer);
    if (typeof ruptureLayer !== 'undefined') visible.push(ruptureLayer);   // alertes : toujours visibles
    const allKnown = [
        allModeCluster,
        signalCluster, osintCluster, seismicLayer,
        newsOsintCluster, newsAirCluster, newsSeaCluster, newsSpaceCluster,
        tracksLayer, tracksSeaLayer, aviationEvtCluster, maritimeEvtCluster, spaceLayer, convergenceLayer,
        typeof ruptureLayer !== 'undefined' ? ruptureLayer : null,
        typeof crisesLayer !== 'undefined' ? crisesLayer : null,
        typeof firesLayer !== 'undefined' ? firesLayer : null,
        typeof gnssLayer !== 'undefined' ? gnssLayer : null
    ];
    allKnown.forEach(function (layer) {
        if (!layer) return;
        if (visible.indexOf(layer) !== -1) { if (!maCarte.hasLayer(layer)) layer.addTo(maCarte); }
        else if (maCarte.hasLayer(layer)) maCarte.removeLayer(layer);
    });
    _hdrRefreshCount();
}

function setLayer(key, on) {
    if (OG_LAYERS.indexOf(key) === -1) return;
    _layersOn[key] = !!on;
    try { localStorage.setItem('ogma-layers', JSON.stringify(_layersOn)); } catch (e) { /* confort */ }
    _rebuildAllMode();
    applyLayers();
    document.dispatchEvent(new CustomEvent('ogma:layers', { detail: Object.assign({}, _layersOn) }));
}

// Ancienne API (boutons ALL / OSINT / AIR / SEA / SPACE)
function setFilter(name) {
    const map = { OSINT: 'osint', AIR: 'air', SEA: 'sea', SPACE: 'space' };
    OG_LAYERS.forEach(function (k) { _layersOn[k] = name === 'ALL' || k === 'conv' || map[name] === k; });
    setLayer('conv', _layersOn.conv);
}

// ── Compteurs ────────────────────────────────────────────────
const _hdrCounts = {
    signal: 0, osint: 0, seismic: 0, tracks: 0, space: 0,
    newsAir: 0, newsSea: 0, newsSpace: 0, newsOsint: 0,
    maritime: 0, aviation: 0, crises: 0, fires: 0, gnss: 0
};

function hdrUpdateCount(key, n) {
    _hdrCounts[key] = n;
    _hdrRefreshCount();
}

function _layerCount(key) {
    const c = _hdrCounts;
    if (key === 'air')   return c.tracks + c.aviation + c.newsAir;
    if (key === 'sea')   return c.maritime + c.newsSea;
    if (key === 'space') return c.space + c.newsSpace;
    if (key === 'osint') return c.signal + c.osint + c.seismic + c.newsOsint;
    if (key === 'crises') return c.crises;
    if (key === 'fires')  return c.fires;
    if (key === 'gnss')   return c.gnss;
    if (key === 'conv')  return (typeof _lastConvergences !== 'undefined' ? _lastConvergences.length : 0);
    return 0;
}

function _hdrTotalForFilter(filter) {
    if (filter === 'ALL') return OG_LAYERS.reduce(function (s, k) { return s + _layerCount(k); }, 0);
    return _layerCount(String(filter).toLowerCase() === 'osint' ? 'osint' : { AIR: 'air', SEA: 'sea', SPACE: 'space' }[filter] || '');
}

function _hdrRefreshCount() {
    let total = 0;
    OG_LAYERS.forEach(function (k) {
        const n = _layerCount(k);
        if (layerOn(k)) total += n;
        const el = document.querySelector('[data-layer-count="' + k + '"]');
        if (el) el.textContent = n > 999 ? Math.round(n / 100) / 10 + 'k' : String(n);
    });
    const el = document.getElementById('hdr-events');
    if (el) el.textContent = total;
}

function _hdrResetCountdown() { /* conservé pour compatibilité */ }

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
        maxZoom: MAX_ZOOM,
        zoomControl: false
    });

    maCarte.setMaxBounds([[-90, -180], [90, 180]]);

    // Fond de carte public (vitrine) : défini dans config.js
    L.tileLayer(APP.CONFIG.BASEMAP.url, {
        maxZoom: MAX_ZOOM,
        minZoom: MIN_ZOOM,
        subdomains: APP.CONFIG.BASEMAP.subdomains || 'abc',
        attribution: APP.CONFIG.BASEMAP.attribution || ''
    }).addTo(maCarte);

    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(maCarte);
    // Avions et navires : simples points de loin, silhouettes à partir du zoom 6
    const nearClass = function () { maCarte.getContainer().classList.toggle('og-near', maCarte.getZoom() >= 6); };
    maCarte.on('zoomend', nearClass);
    nearClass();
    L.control.scale({ imperial: false, maxWidth: 160, position: 'bottomright' }).addTo(maCarte);

    // Redimensionnement automatique
    window.addEventListener('resize', function () { maCarte.invalidateSize(); });
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(function () { maCarte.invalidateSize(); })
            .observe(document.getElementById('maCarte'));
    }

    isMapInitialized = true;

    // Les couches reçoivent leurs données du snapshot SharePoint (ogma-feed.js),
    // et ce poste devient relais s'il a accès à Internet (ogma-sync.js).
    applyLayers();
    APP.Feed.start();
    APP.Sync.start();
}

document.addEventListener('DOMContentLoaded', initializeMap);
