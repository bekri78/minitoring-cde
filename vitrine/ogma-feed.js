/**
 * ogma-feed.js — Distribue chaque snapshot aux couches de la carte.
 *
 * Remplace les anciennes fonctions fetchXxx() de chaque layer : les couches ne
 * contactent plus ni Railway ni les listes SharePoint, elles reçoivent leurs
 * données d'APP.Sync. Les fonctions renderXxx() existantes sont réutilisées
 * telles quelles.
 *
 * Si un popup est ouvert, le rafraîchissement attend sa fermeture (un rendu
 * fermerait le popup sous les yeux de l'utilisateur).
 */

(function () {
    'use strict';

    var pending = null;

    function popupOpen() {
        return !!(maCarte && maCarte._popup && maCarte._popup.isOpen && maCarte._popup.isOpen());
    }

    function safe(label, fn) {
        try { fn(); } catch (e) { console.error('[ogma-feed] ' + label + ' :', e); }
    }

    function renderAll(snapshot) {
        var d = snapshot.data || {};

        safe('signal markers', function () {
            renderSignalMarkers(d.signalMarkers || []);
            hdrUpdateCount('signal', (d.signalMarkers || []).length);
        });
        safe('osint', function () {
            renderOsintEvents(d.osint || []);
            hdrUpdateCount('osint', (d.osint || []).length);
        });
        safe('séismes', function () {
            renderSeismic(d.earthquakes || []);
            hdrUpdateCount('seismic', (d.earthquakes || []).length);
        });
        safe('pistes', function () { renderTracks(d.tracks || []); });
        safe('spatial', function () { renderSpace(d.space || {}); });
        safe('actualités', function () { renderNews(d.news || []); });
        safe('maritime', function () {
            renderMaritimeEvents(d.maritimeEvents || []);
            hdrUpdateCount('maritime', (d.maritimeEvents || []).length);
        });
        safe('aviation', function () {
            renderAviationEvents(d.aviationEvents || []);
            hdrUpdateCount('aviation', (d.aviationEvents || []).length);
        });
        safe('zones de tension', function () {
            if ((d.signals || []).length) renderSignals(d.signals);
        });
        safe('ruptures et convergences', function () { renderInsights(d); });

        console.log('[ogma-feed] carte mise à jour — snapshot du ' + snapshot.generatedAt);
    }

    // « DERNIÈRE MAJ » : date et heure de génération du snapshot affiché
    function showLastUpdate(snapshot) {
        var el = document.getElementById('hdr-lastupdate');
        if (!el || !snapshot.generatedAt) return;
        var d = new Date(snapshot.generatedAt);
        var p = function (n) { return String(n).padStart(2, '0'); };
        el.textContent = p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        var stale = Date.now() - d.getTime() > APP.CONFIG.SYNC.STALE_AFTER_MS;
        el.style.color = stale ? '#ffaa00' : '#00d4ff';
    }

    function onSnapshot(snapshot) {
        showLastUpdate(snapshot);
        if (!maCarte) { pending = snapshot; return; }
        if (popupOpen()) {
            pending = snapshot;
            maCarte.once('popupclose', function () {
                if (pending) { var s = pending; pending = null; renderAll(s); }
            });
            return;
        }
        pending = null;
        renderAll(snapshot);
    }

    // La couleur passe à l'orange si le snapshot vieillit sans être remplacé
    setInterval(function () { if (APP.Sync && APP.Sync.current) showLastUpdate(APP.Sync.current); }, 60000);

    // Changement de zone (recherche de lieu) : le widget des tensions est filtré à nouveau
    document.addEventListener('ogma:theatre', function () {
        var d = APP.Sync && APP.Sync.current && APP.Sync.current.data;
        if (d && (d.signals || []).length) safe('zones de tension', function () { renderSignals(d.signals); });
    });

    APP.Feed = {
        start: function () {
            APP.Sync.onSnapshot(onSnapshot);
            if (pending) { var s = pending; pending = null; onSnapshot(s); }
        }
    };

    console.log('✓ ogma-feed.js chargé');
})();
