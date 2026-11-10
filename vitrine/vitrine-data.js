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
    window.loadPlanePhoto = function () {};
    window.loadShipPhoto = function () {};

    console.log('✓ vitrine-data.js chargé');
})();
