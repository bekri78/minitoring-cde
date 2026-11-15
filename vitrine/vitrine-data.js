/**
 * vitrine-data.js — Source de données de la vitrine publique.
 *
 * Remplace ogma-sync.js (SharePoint) : lit data/snapshot.json, le valide et le
 * transmet aux couches avec la même interface APP.Sync. Fournit aussi des
 * substituts pour les fonctions internes absentes de la vitrine (IA GeniAL,
 * photos d'avions et de navires).
 */
(function () {
    'use strict';

    var CFG = APP.CONFIG.SYNC;
    var LISTS = ['osint', 'news', 'signals', 'signalMarkers', 'tracks', 'maritimeEvents',
        'aviationEvents', 'earthquakes'];

    function validate(s) {
        if (!s || s.type !== 'ogma-snapshot' || s.schemaVersion !== 1 || !s.data) return 'format inattendu';
        for (var i = 0; i < LISTS.length; i++) {
            if (!Array.isArray(s.data[LISTS[i]])) return LISTS[i] + ' absent';
        }
        return null;
    }

    var listeners = [];
    var current = null;
    var currentEtag = null;
    var nextCheckAt = Date.now() + CFG.POLL_INTERVAL_MS;

    function apply(snapshot) {
        current = snapshot;
        APP.Sync.current = snapshot;
        listeners.forEach(function (fn) {
            try { fn(snapshot, { source: 'vitrine' }); } catch (e) { console.error('[vitrine] abonné :', e); }
        });
        var tip = document.getElementById('hdr-lastupdate');
        if (tip && snapshot.generatedAt) {
            var age = Date.now() - Date.parse(snapshot.generatedAt);
            tip.title = 'Données publiques du ' + new Date(snapshot.generatedAt).toLocaleString('fr-FR')
                + '\nÉtat : ' + (age > 2 * 3600 * 1000 ? 'CACHE ANCIEN' : 'À JOUR')
                + '\nMise à jour automatique toutes les 30 minutes';
        }
    }

    async function load() {
        nextCheckAt = Date.now() + CFG.POLL_INTERVAL_MS;
        try {
            var res = await fetch(CFG.SNAPSHOT_URL + '?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var snap = await res.json();
            var problem = validate(snap);
            if (problem) throw new Error(problem);
            if (snap.etag && snap.etag === currentEtag) return;
            currentEtag = snap.etag;
            apply(snap);
        } catch (e) {
            console.warn('[vitrine] données indisponibles :', e.message);
            var el = document.getElementById('hdr-lastupdate');
            if (el && !current) { el.textContent = 'indisponible'; el.title = 'État : AUCUNE DONNÉE\n' + e.message; }
        }
    }

    APP.Sync = {
        current: null,
        start: function () {
            load();
            setInterval(function () { if (!document.hidden) load(); }, CFG.POLL_INTERVAL_MS);
            document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
        },
        onSnapshot: function (fn) { listeners.push(fn); if (current) fn(current, { source: 'vitrine' }); },
        nextCheckAt: function () { return nextCheckAt; },
        hasInternet: function () { return true; }
    };

    // ── Substituts des fonctions internes ──────────────────────────
    // Pas d'IA sur la version publique : les fenêtres affichent les faits bruts.
    APP.Genial = {
        chatStream: function (messages, onChunk) {
            if (onChunk) onChunk('Analyse IA réservée à la version interne. Les éléments factuels ci-dessus proviennent de sources ouvertes.');
            return Promise.resolve('');
        }
    };
    // Photos d'avions et de navires : non chargées sur la vitrine
    // v53 — Photos dans la vitrine : appels directs depuis le navigateur, sans clé ni serveur.
    // Avions : Planespotters (crédit du photographe et lien obligatoires, affichés).
    // Navires : photo MarineTraffic si disponible, sinon drapeau du pays (flagcdn).
    var esc = function (v) { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v == null ? '' : v); };
    var IMG = 'width:100%;max-height:130px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,.08);';
    var planeCache = {};
    window.loadPlanePhoto = function (icao24, el) {
        if (!el || !icao24) return;
        var key = String(icao24).toLowerCase();
        var draw = function (p) {
            if (!p || !p.src) return;
            el.innerHTML = '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">'
                + '<img src="' + esc(p.src) + '" onerror="var a=this.closest(\'a\');if(a)a.style.display=\'none\'" style="' + IMG + '" alt="photo"/>'
                + '<div style="font-size:11px;color:#8a8f98;margin-top:3px;">' + esc([p.model, p.reg, p.photographer ? '© ' + p.photographer + ' (Planespotters)' : ''].filter(Boolean).join(' · ')) + '</div></a>';
        };
        if (planeCache[key] !== undefined) { draw(planeCache[key]); return; }
        fetch('https://api.planespotters.net/pub/photos/hex/' + encodeURIComponent(key))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                var ph = j && j.photos && j.photos[0];
                planeCache[key] = ph ? { src: (ph.thumbnail_large || ph.thumbnail || {}).src, link: ph.link, photographer: ph.photographer,
                    model: ph.aircraft && ph.aircraft.model, reg: ph.aircraft && ph.aircraft.reg } : null;
                draw(planeCache[key]);
            })
            .catch(function () { /* pas de photo : rien à afficher */ });
    };
    var ISO2 = { USA:'us', GBR:'gb', FRA:'fr', DEU:'de', CAN:'ca', AUS:'au', ITA:'it', ESP:'es', NLD:'nl', POL:'pl', RUS:'ru', CHN:'cn',
        JPN:'jp', KOR:'kr', IND:'in', IRN:'ir', TUR:'tr', ISR:'il', SGP:'sg', IDN:'id', LBR:'lr', NOR:'no', GRC:'gr', DNK:'dk', SWE:'se',
        FIN:'fi', BRA:'br', ARG:'ar', ZAF:'za', EGY:'eg', PAK:'pk', BGD:'bd', PRT:'pt', BEL:'be', UKR:'ua', ROU:'ro', BGR:'bg', HRV:'hr',
        MLT:'mt', CYP:'cy', PAN:'pa', MHL:'mh', BHS:'bs', SAU:'sa', ARE:'ae', QAT:'qa', OMN:'om', DZA:'dz', MAR:'ma', TWN:'tw', PHL:'ph',
        VNM:'vn', THA:'th', MYS:'my', MEX:'mx', CHL:'cl', COL:'co', PER:'pe', VEN:'ve', CUB:'cu', NZL:'nz', IRL:'ie', EST:'ee', LVA:'lv', LTU:'lt' };
    window._shipImgFallback = function (img) {
        var flag = img.getAttribute('data-flag');
        if (flag && img.src !== flag) {
            img.setAttribute('data-flag', ''); img.src = flag;
            img.style.width = '48px'; img.style.objectFit = 'contain'; img.style.border = 'none'; img.style.borderRadius = '2px';
            return;
        }
        var a = img.closest('a'); if (a) a.style.display = 'none';
    };

    // v55 — Photo Wikipédia des navires de guerre (MarineTraffic ne sert plus ses photos : erreur 522).
    // Seulement pour un nom à préfixe naval (HMS, HMAS, HNLMS, USS…) dont le pays correspond au
    // pavillon de la piste, et si un article porte exactement ce nom (hors numéro de coque).
    // Parmi les homonymes, on garde l'article au présent (« is a … ») : le navire en service, pas
    // ses prédécesseurs (« was a … ») ; le titre de l'article est affiché sous la photo.
    var _SHIP_PREFIX_COUNTRY = { HMS:'GBR', HMAS:'AUS', HMCS:'CAN', HMNZS:'NZL', HNLMS:'NLD', USS:'USA', USNS:'USA', USCGC:'USA',
        NRP:'PRT', JS:'JPN', INS:'IND', KRI:'IDN', ROKS:'KOR', TCG:'TUR', HDMS:'DNK', HNOMS:'NOR', KNM:'NOR', HSWMS:'SWE',
        ESPS:'ESP', SPS:'ESP', ITS:'ITA', NAVE:'ITA', BNS:'BEL', FGS:'DEU', HS:'GRC', ARA:'ARG', BAP:'PER', CNS:'CHL', PNS:'PAK',
        RSS:'SGP', KD:'MYS', BRP:'PHL', ORP:'POL', ENS:'EST', FS:'FRA', LE:'IRL' };
    var _shipWikiCache = {};
    function _shipNameKey(s) {
        return String(s || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    }
    function _wikiShipPhoto(name, country) {
        var m = /^([A-Z]+)\s+(.+)$/.exec(String(name || '').trim().toUpperCase());
        if (!m || !_SHIP_PREFIX_COUNTRY[m[1]]) return Promise.resolve(null);
        var cty = String(country || '').toUpperCase();
        if (cty && cty !== 'MIL' && cty !== 'UNKNOWN' && _SHIP_PREFIX_COUNTRY[m[1]] !== cty) return Promise.resolve(null);
        var key = _shipNameKey(name);
        if (_shipWikiCache[key] !== undefined) return Promise.resolve(_shipWikiCache[key]);
        var url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=5'
            + '&gsrsearch=' + encodeURIComponent('intitle:"' + String(name).trim() + '"')
            + '&prop=pageimages|pageprops|extracts&ppprop=disambiguation&piprop=thumbnail&pithumbsize=480'
            + '&exintro=1&explaintext=1&exsentences=1&exlimit=5';
        return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
            var pages = j && j.query && j.query.pages ? Object.keys(j.query.pages).map(function (k) { return j.query.pages[k]; }) : [];
            pages.sort(function (a, b) { return a.index - b.index; });
            var p = pages.filter(function (p) {
                return _shipNameKey(p.title) === key && p.thumbnail && !(p.pageprops && 'disambiguation' in p.pageprops)
                    && /\bis an? /.test(p.extract || '');
            })[0];
            var res = p ? { src: p.thumbnail.source, title: p.title,
                link: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')) } : null;
            _shipWikiCache[key] = res;
            return res;
        }).catch(function () { return null; });
    }
    window.loadShipPhoto = function (mmsi, country, el, name) {
        if (!el || !mmsi) return;
        var iso2 = ISO2[String(country || '').toUpperCase()];
        var flag = iso2 ? 'https://flagcdn.com/w80/' + iso2 + '.png' : '';
        var link = 'https://www.marinetraffic.com/en/photos/of/vessels/mmsi:' + encodeURIComponent(mmsi) + '/';
        var thumb = 'https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi=' + encodeURIComponent(mmsi);
        // Tout de suite : drapeau (ou vignette) + lien ; la photo MarineTraffic, si elle charge, la remplace
        el.innerHTML = '<a href="' + link + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-decoration:none;">'
            + (flag ? '<img src="' + flag + '" onerror="this.style.display=\'none\'" style="width:40px;height:auto;border-radius:2px;flex:none;" alt="pavillon"/>' : '')
            + '<span style="font-size:11.5px;color:#8a8f98;line-height:1.35;">Photo non disponible<br><span style="color:#a8aeff;">Voir le navire sur MarineTraffic</span></span></a>';
        var probe = new Image();
        probe.onload = function () { if (probe.naturalWidth > 1 && el.isConnected) el.innerHTML = '<a href="' + link + '" target="_blank" rel="noopener"><img src="' + thumb + '" style="' + IMG + '" alt="navire"/></a>'; };
        probe.src = thumb;
        _wikiShipPhoto(name, country).then(function (w) {
            if (!w || !el.isConnected) return;
            probe.onload = null;
            el.innerHTML = '<a href="' + esc(w.link) + '" target="_blank" rel="noopener"><img src="' + esc(w.src) + '" style="' + IMG + '" alt="navire"/>'
                + '<div style="font-size:11px;color:#8a8f98;margin-top:3px;">' + esc(w.title) + ' · Wikipédia</div></a>';
        });
    };

    console.log('✓ vitrine-data.js chargé');
})();
