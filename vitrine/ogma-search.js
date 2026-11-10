// ── Recherche de lieu (remplace le sélecteur de théâtre) ─────
//  Inspiré de address-search.js (géocodeur ESRI interne), adapté à OGMA :
//   - suggestions au fil de la frappe, flèches haut/bas, Entrée, Échap ;
//   - deux sources : les lieux déjà présents dans les données OGMA (immédiat,
//     fonctionne sans géocodeur) et le géocodeur ESRI (APP.CONFIG.GEOCODE_URL) ;
//   - zones prédéfinies (Europe, Levant…) proposées quand le champ est vide ;
//   - le lieu choisi recadre la carte ET filtre les panneaux (ruptures, tensions).
//  API conservée pour les autres couches : theatreContains(lat, lon) et
//  l'événement « ogma:theatre ».

const OGMA_ZONES = [
    { label: 'Europe · flanc Est',    bounds: [[35, -12], [72, 45]] },
    { label: 'Levant · Moyen-Orient', bounds: [[12, 25], [42, 63]] },
    { label: 'Afrique · Sahel',       bounds: [[-5, -20], [25, 40]] },
    { label: 'Indo-Pacifique',        bounds: [[-45, 60], [45, 180]] },
    { label: 'Amériques',             bounds: [[-55, -170], [72, -30]] }
];

// Zone active : null = monde entier
let _zone = null;
try {
    const saved = JSON.parse(localStorage.getItem('ogma-zone') || 'null');
    if (saved && saved.label && Array.isArray(saved.bounds)) _zone = saved;
} catch (e) { /* confort */ }

function theatreContains(lat, lon) {
    if (!_zone) return true;
    if (typeof lat !== 'number' || typeof lon !== 'number') return false;
    const b = _zone.bounds;
    return lat >= b[0][0] && lat <= b[1][0] && lon >= b[0][1] && lon <= b[1][1];
}

(function () {
    const MIN_SPAN = 8;            // degrés : une ville filtre sur sa région, pas sur 10 km
    const GEOCODER_TIMEOUT = 5000;
    let marker = null;
    let timer = null;
    let items = [];                // résultats affichés
    let active = -1;               // résultat surligné au clavier
    let seq = 0;                   // ignore les réponses arrivées dans le désordre

    const $ = function (id) { return document.getElementById(id); };
    const geocodeUrl = function () { return (APP.CONFIG && APP.CONFIG.GEOCODE_URL) || ''; };

    function norm(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }
    function esc(s) {
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(String(s == null ? '' : s)));
        return d.innerHTML;
    }
    function highlight(text, q) {
        const t = String(text), i = norm(t).indexOf(norm(q));
        if (!q || i < 0) return esc(t);
        return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
    }

    // Emprise minimale autour d'un point, ou élargissement d'une emprise trop petite
    function widen(b) {
        let s = b[0][0], w = b[0][1], n = b[1][0], e = b[1][1];
        if (n - s < MIN_SPAN) { const c = (n + s) / 2; s = c - MIN_SPAN / 2; n = c + MIN_SPAN / 2; }
        if (e - w < MIN_SPAN) { const c = (e + w) / 2; w = c - MIN_SPAN / 2; e = c + MIN_SPAN / 2; }
        return [[Math.max(-90, s), Math.max(-180, w)], [Math.min(90, n), Math.min(180, e)]];
    }

    // ── Source 1 : lieux connus d'OGMA (snapshot courant) ───────────
    function localIndex() {
        const d = APP.Sync && APP.Sync.current && APP.Sync.current.data;
        if (!d) return [];
        const places = {};
        function add(name, kind, lat, lon) {
            name = String(name || '').trim();
            if (!name || typeof lat !== 'number' || typeof lon !== 'number') return;
            const k = kind + '|' + norm(name);
            const p = places[k] || (places[k] = { name: name, kind: kind, lats: [], lons: [] });
            p.lats.push(lat); p.lons.push(lon);
        }
        (d.osint || []).forEach(function (e) {
            const parts = String(e.country || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
            if (!parts.length) return;
            add(parts[parts.length - 1], 'pays', e.lat, e.lon);
            if (parts.length > 1) add(parts[0] + ', ' + parts[parts.length - 1], 'lieu', e.lat, e.lon);
        });
        (d.signals || []).forEach(function (z) { add(z.location_name, 'zone de tension', z.lat, z.lng); });
        return Object.keys(places).map(function (k) {
            const p = places[k];
            const lats = p.lats.slice().sort(function (a, b) { return a - b; });
            const lons = p.lons.slice().sort(function (a, b) { return a - b; });
            const mid = Math.floor(lats.length / 2);
            // pays : emprise des signaux (sans les extrêmes), sinon un point
            let bounds = null;
            if (p.kind === 'pays' && lats.length >= 3) {
                const q = Math.floor(lats.length * 0.1);
                bounds = [[lats[q], lons[q]], [lats[lats.length - 1 - q], lons[lons.length - 1 - q]]];
            }
            return { source: 'ogma', label: p.name, sub: p.kind + ' · ' + p.lats.length + (p.lats.length > 1 ? ' signaux' : ' signal'),
                     lat: lats[mid], lon: lons[mid], bounds: bounds, count: p.lats.length };
        });
    }

    function searchLocal(q) {
        const nq = norm(q);
        return localIndex()
            .map(function (p) { const i = norm(p.label).indexOf(nq); return i < 0 ? null : (p.rank = (i === 0 ? 0 : 1), p); })
            .filter(Boolean)
            .sort(function (a, b) { return a.rank - b.rank || b.count - a.count; })
            .slice(0, 4);
    }

    // ── Source 2 : géocodeur ESRI interne ───────────────────────────
    function fetchJson(url) {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const t = setTimeout(function () { if (ctrl) ctrl.abort(); }, GEOCODER_TIMEOUT);
        return fetch(url, ctrl ? { signal: ctrl.signal } : {})
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .finally(function () { clearTimeout(t); });
    }

    function suggestGeocoder(q) {
        if (!geocodeUrl()) return Promise.resolve({ list: [], error: null });
        return fetchJson(geocodeUrl() + '/suggest?text=' + encodeURIComponent(q) + '&f=json&maxSuggestions=6')
            .then(function (data) {
                return { list: (data.suggestions || []).map(function (s) {
                    return { source: 'geo', label: s.text, magicKey: s.magicKey };
                }), error: null };
            })
            .catch(function (e) {
                console.warn('[recherche] géocodeur indisponible :', e.message);
                return { list: [], error: 'Géocodeur indisponible : seuls les lieux présents dans OGMA sont proposés.' };
            });
    }

    const OUT_FIELDS = 'Match_addr,LongLabel,ShortLabel,Addr_type,Type,City,Region,Country';
    function resolveGeocoder(item) {
        const url = geocodeUrl() + '/findAddressCandidates?SingleLine=' + encodeURIComponent(item.label)
            + (item.magicKey ? '&magicKey=' + encodeURIComponent(item.magicKey) : '')
            + '&f=json&outSR=4326&maxLocations=1&outFields=' + OUT_FIELDS;
        return fetchJson(url).then(function (data) {
            const c = data.candidates && data.candidates[0];
            if (!c) throw new Error('aucun résultat');
            const a = c.attributes || {};
            const x = c.extent;
            return {
                label: a.ShortLabel || a.LongLabel || item.label,
                sub: [a.Type, a.Region, a.Country].filter(Boolean).join(' · '),
                lat: c.location.y, lon: c.location.x,
                bounds: x ? [[x.ymin, x.xmin], [x.ymax, x.xmax]] : null
            };
        });
    }

    // ── Liste déroulante ────────────────────────────────────────────
    const PIN = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10m0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6"/></svg>';
    const DOT = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
    const AREA = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="12" height="12" stroke-dasharray="2 2"/></svg>';

    function render(q, list, note) {
        const dd = $('ogma-search-dropdown');
        items = list; active = list.length ? 0 : -1;
        let html = '', lastGroup = '';
        list.forEach(function (it, i) {
            const group = it.source === 'zone' ? 'ZONES PRÉDÉFINIES' : it.source === 'ogma' ? 'DANS LES DONNÉES OGMA' : 'GÉOCODEUR';
            if (group !== lastGroup) { html += '<div class="ogma-search-group">' + group + '</div>'; lastGroup = group; }
            html += '<div class="ogma-search-item' + (i === active ? ' active' : '') + '" data-i="' + i + '">'
                + '<span class="ogma-search-ico">' + (it.source === 'zone' ? AREA : it.source === 'ogma' ? DOT : PIN) + '</span>'
                + '<span class="ogma-search-txt"><span>' + highlight(it.label, q) + '</span>'
                + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</span></div>';
        });
        if (!list.length) html += '<div class="ogma-search-empty">' + (q ? 'Aucun lieu trouvé pour « ' + esc(q) + ' »' : '') + '</div>';
        if (note) html += '<div class="ogma-search-note">' + esc(note) + '</div>';
        dd.innerHTML = html;
        dd.style.display = 'block';
        Array.prototype.forEach.call(dd.querySelectorAll('.ogma-search-item'), function (el) {
            el.addEventListener('mousedown', function (e) { e.preventDefault(); choose(items[Number(el.getAttribute('data-i'))]); });
        });
    }

    function loading(q, local) {
        render(q, local, null);
        const dd = $('ogma-search-dropdown');
        dd.insertAdjacentHTML('beforeend', '<div class="ogma-search-note"><span class="ogma-search-spin"></span> recherche dans le géocodeur…</div>');
    }

    function close() {
        const dd = $('ogma-search-dropdown');
        if (dd) { dd.innerHTML = ''; dd.style.display = 'none'; }
        items = []; active = -1;
    }

    function move(delta) {
        if (!items.length) return;
        active = (active + delta + items.length) % items.length;
        Array.prototype.forEach.call(document.querySelectorAll('#ogma-search-dropdown .ogma-search-item'), function (el, i) {
            el.classList.toggle('active', i === active);
            if (i === active) el.scrollIntoView({ block: 'nearest' });
        });
    }

    function presets() {
        return OGMA_ZONES.map(function (z) { return { source: 'zone', label: z.label, bounds: z.bounds }; });
    }

    function onInput() {
        const input = $('ogma-search-input');
        const q = input.value.trim();
        $('ogma-search-clear').style.display = q || _zone ? 'flex' : 'none';
        if (timer) clearTimeout(timer);
        if (q.length < 2) { render('', presets(), null); return; }
        const zones = presets().filter(function (z) { return norm(z.label).indexOf(norm(q)) >= 0; });
        const local = zones.concat(searchLocal(q));
        if (!geocodeUrl() || q.length < 3) { render(q, local, null); return; }
        loading(q, local);
        const my = ++seq;
        timer = setTimeout(function () {
            suggestGeocoder(q).then(function (res) {
                if (my !== seq) return;
                render(q, local.concat(res.list), res.error);
            });
        }, 300);
    }

    // ── Choix d'un résultat : carte + filtre des panneaux ───────────
    function choose(it) {
        if (!it) return;
        close();
        const input = $('ogma-search-input');
        input.value = it.label;
        input.blur();
        if (it.source === 'geo') {
            input.classList.add('ogma-search-busy');
            resolveGeocoder(it)
                .then(function (r) { applyPlace(r, true); })
                .catch(function (e) {
                    console.warn('[recherche] géocodage impossible :', e.message);
                    render(it.label, [], 'Impossible de localiser ce lieu (géocodeur indisponible).');
                })
                .finally(function () { input.classList.remove('ogma-search-busy'); });
        } else {
            applyPlace(it, it.source !== 'zone');
        }
    }

    function applyPlace(p, withPin) {
        const view = p.bounds || [[p.lat - 1.5, p.lon - 2], [p.lat + 1.5, p.lon + 2]];
        setZone({ label: p.label, bounds: widen(view) }, false);
        if (marker) { maCarte.removeLayer(marker); marker = null; }
        if (withPin && typeof p.lat === 'number') {
            const icon = L.divIcon({
                className: 'ogma-search-pin',
                html: '<svg width="26" height="34" viewBox="0 0 32 42"><path d="M16 0C7.163 0 0 7.163 0 16c0 12.5 16 26 16 26s16-13.5 16-26C32 7.163 24.837 0 16 0z" fill="#00d4ff" stroke="#0a0f16" stroke-width="2"/><circle cx="16" cy="15" r="5.5" fill="#0a0f16"/></svg>',
                iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -32]
            });
            const n = countInZone();
            marker = L.marker([p.lat, p.lon], { icon: icon, zIndexOffset: 1000 }).addTo(maCarte)
                .bindPopup('<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#c8d8e8;min-width:170px;">'
                    + '<div style="font-size:12px;margin-bottom:4px;">' + esc(p.label) + '</div>'
                    + (p.sub ? '<div style="color:#4a6a7a;margin-bottom:4px;">' + esc(p.sub) + '</div>' : '')
                    + '<div style="color:#4a6a7a;">' + p.lat.toFixed(4) + ', ' + p.lon.toFixed(4) + '</div>'
                    + '<div style="margin-top:6px;color:#00d4ff;">' + n + (n > 1 ? ' signaux' : ' signal') + ' OGMA dans la zone</div></div>',
                    { maxWidth: 280 });
        }
        if (p.bounds) maCarte.flyToBounds(p.bounds, { maxZoom: 9, duration: 0.8, padding: [20, 20] });
        else maCarte.flyTo([p.lat, p.lon], 7, { duration: 0.8 });
        if (marker) maCarte.once('moveend', function () { if (marker) marker.openPopup(); });
    }

    function countInZone() {
        const d = APP.Sync && APP.Sync.current && APP.Sync.current.data;
        return ((d && d.osint) || []).filter(function (e) { return theatreContains(e.lat, e.lon); }).length;
    }

    function setZone(z, reframe) {
        _zone = z;
        try {
            if (z) localStorage.setItem('ogma-zone', JSON.stringify(z));
            else localStorage.removeItem('ogma-zone');
        } catch (e) { /* confort */ }
        const box = $('ogma-search');
        if (box) box.classList.toggle('has-zone', !!z);
        const clear = $('ogma-search-clear');
        if (clear) clear.style.display = z ? 'flex' : 'none';
        if (reframe && maCarte) {
            if (z) maCarte.fitBounds(z.bounds, { padding: [10, 10] });
            else maCarte.setView([30, 20], 3);
        }
        document.dispatchEvent(new CustomEvent('ogma:theatre', { detail: z ? z.label : 'MONDE' }));
    }

    function clearZone() {
        const input = $('ogma-search-input');
        input.value = '';
        close();
        if (marker) { maCarte.removeLayer(marker); marker = null; }
        setZone(null, true);
    }

    function init() {
        const input = $('ogma-search-input');
        if (!input) return;
        // SharePoint : Entrée ne doit jamais soumettre le formulaire de la page
        ['keypress', 'keyup'].forEach(function (t) {
            input.addEventListener(t, function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); } }, true);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (items.length) choose(items[Math.max(0, active)]);
                else if (input.value.trim().length >= 2) onInput();
            } else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Escape') { close(); input.blur(); }
        }, true);
        const form = input.closest('form');
        if (form) form.addEventListener('submit', function (e) { if (document.activeElement === input) e.preventDefault(); });
        input.addEventListener('input', onInput);
        input.addEventListener('focus', function () { input.select(); onInput(); });
        input.addEventListener('blur', function () { setTimeout(close, 150); });
        $('ogma-search-clear').addEventListener('mousedown', function (e) { e.preventDefault(); clearZone(); });

        if (_zone) {
            input.value = _zone.label;
            setZone(_zone, true);
        }
        console.log('✓ recherche de lieu' + (geocodeUrl() ? ' (géocodeur interne)' : ' (données OGMA seulement)'));
    }

    window.OgmaSearch = { setZone: setZone, clear: clearZone, choose: choose, _local: searchLocal };
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
})();
