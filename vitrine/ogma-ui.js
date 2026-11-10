// ══════════════════════════════════════════════════════════════
//  ogma-ui.js — Interface : barre de calques, barre de droite
//  (état, « À surveiller », fiches). L'assistant est dans la barre de
//  recherche (ogma-agent.js).
//  Les données viennent des couches (ruptures, convergences, zones
//  de tension) ; ce fichier ne fait que les présenter.
// ══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const esc = function (s) { return escapeHtml(s == null ? '' : s); };
    const fr = function (n) { return String(n).replace('.', ','); };

    let chip = 'all';
    let detailOpen = false;
    let onDetailClose = null;

    // ── Barre de calques ─────────────────────────────────────
    function syncRail() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (b) {
            b.setAttribute('aria-pressed', layerOn(b.getAttribute('data-layer')) ? 'true' : 'false');
        });
    }

    function initRail() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (b) {
            b.addEventListener('click', function () {
                const k = b.getAttribute('data-layer');
                setLayer(k, !layerOn(k));
            });
        });
        document.addEventListener('ogma:layers', syncRail);
        syncRail();
    }

    // ── Panneau : ouvrir / replier ───────────────────────────
    function setPanel(open) {
        document.body.classList.toggle('og-panel-closed', !open);
        const t = $('og-panel-toggle');
        if (t) {
            t.setAttribute('aria-expanded', open ? 'true' : 'false');
            t.title = open ? 'Masquer la barre d’état' : 'Afficher la barre d’état';
        }
        try { localStorage.setItem('ogma-panel', open ? 'open' : 'closed'); } catch (e) { /* confort */ }
        if (typeof maCarte !== 'undefined' && maCarte) setTimeout(function () { maCarte.invalidateSize(); }, 220);
    }

    function initPanel() {
        let open = window.innerWidth > 900;
        try { const v = localStorage.getItem('ogma-panel'); if (v) open = v === 'open'; } catch (e) { /* confort */ }
        setPanel(open);
        const t = $('og-panel-toggle');
        if (t) t.addEventListener('click', function () { setPanel(document.body.classList.contains('og-panel-closed')); });
    }

    // ── État des données (lu dans l'info-bulle tenue par ogma-sync.js) ──
    const STATES = {
        'À JOUR':                    ['À jour', 'var(--og-ok)'],
        'ACTUALISATION…':            ['Actualisation…', 'var(--og-accent)'],
        'CACHE CONSERVÉ':            ['Cache conservé', 'var(--og-warn)'],
        'CACHE ANCIEN':              ['Données anciennes', 'var(--og-warn)'],
        'COPIE LOCALE':              ['Copie locale', 'var(--og-warn)'],
        'PREMIER CACHE EN ATTENTE':  ['En attente', 'var(--og-warn)'],
        'SHAREPOINT INDISPONIBLE':   ['SharePoint indisponible', 'var(--og-crit)'],
        'AUCUNE DONNÉE':             ['Aucune donnée', 'var(--og-crit)']
    };

    function syncState() {
        const tip = $('hdr-lastupdate');
        const label = $('og-state-label');
        const dot = $('og-state-dot');
        if (!tip || !label) return;
        const m = /État : ([^\n]+)/.exec(tip.getAttribute('title') || '');
        const st = m && STATES[m[1].trim()];
        label.textContent = st ? st[0] : (m ? m[1] : 'Chargement…');
        if (dot) dot.style.background = st ? st[1] : 'var(--og-faint)';
    }

    function initState() {
        const tip = $('hdr-lastupdate');
        if (tip && typeof MutationObserver === 'function') {
            new MutationObserver(syncState).observe(tip, { attributes: true, attributeFilter: ['title'] });
        }
        syncState();
        const tile = $('og-brief-tile');
        if (tile) {
            if (typeof openBrief !== 'function') { tile.remove(); const s = $('og-state-tile'); if (s) s.style.gridColumn = '1 / -1'; return; }
            tile.addEventListener('click', function () { openBrief(false); });
            refreshBrief();
            setInterval(refreshBrief, 10 * 60 * 1000);
            document.addEventListener('ogma:brief', refreshBrief);
        }
    }

    async function refreshBrief() {
        const t = $('og-brief-title'), s = $('og-brief-sub');
        if (!t || typeof _briefReadToday !== 'function') return;
        try {
            const r = await _briefReadToday();
            if (r && r.at) {
                const d = new Date(r.at);
                t.textContent = 'Brief ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
                s.innerHTML = 'partagé · <span class="og-dr">DR</span>';
            } else {
                t.textContent = 'Brief du jour';
                s.textContent = 'pas encore généré';
            }
        } catch (e) {
            t.textContent = 'Brief du jour';
            s.textContent = 'indisponible';
        }
    }

    // ── « À surveiller » : ruptures, convergences, zones de tension ──
    const CAT = { all: 'activité globale', military: 'militaire', conflict: 'conflit', terrorism: 'terrorisme',
                  strategic: 'stratégique', crisis: 'crise', protest: 'contestation' };

    function collect() {
        const out = [];
        const inZone = function (lat, lon) { return typeof theatreContains !== 'function' || theatreContains(lat, lon); };

        (typeof _lastRuptures !== 'undefined' ? _lastRuptures : []).forEach(function (r) {
            if (!inZone(r.lat, r.lon)) return;
            const strong = r.level === 'forte';
            out.push({
                kind: 'RUPTURE', sev: strong ? 3 : 2, color: strong ? 'var(--og-crit)' : 'var(--og-warn)',
                valueColor: strong ? 'var(--og-crit-text)' : 'var(--og-warn-text)',
                title: (r.country || r.countryCode) + ' · ' + (CAT[r.category] || r.category),
                meta: r.today + ' signaux en 24 h · normale ' + fr(r.baseline) + '/j',
                value: (r.kind === 'emergence' || r.ratio == null) ? 'nouveau' : '×' + fr(r.ratio),
                rank: r.z || 0,
                open: function () { showRupture(r); }
            });
        });

        (typeof _lastConvergences !== 'undefined' ? _lastConvergences : []).forEach(function (c) {
            if (!inZone(c.lat, c.lon)) return;
            const n = (c.types || []).length;
            const labels = (c.types || []).map(function (t) { return (CONV_TYPE_LABEL[t] || [null, t])[1].toLowerCase(); });
            out.push({
                kind: 'CONVERGENCE', sev: n >= 4 ? 3 : 2, color: '#ff3dbb', diamond: true, valueColor: '#ff8ad6',
                title: (c.label || 'Zone') + ' · convergence',
                meta: labels.join(', '),
                value: n + ' types', rank: n * 10,
                open: function () { showConvergence(c); }
            });
        });

        (typeof _signalsZonesCache !== 'undefined' ? _signalsZonesCache : []).forEach(function (z) {
            if (!inZone(z.lat, z.lng)) return;
            const cnt = z.event_count || 0;
            const lvl = cnt > 100 ? ['CRITIQUE', 3, 'var(--og-crit)', 'var(--og-crit-text)']
                      : cnt > 50 ? ['ÉLEVÉ', 2, 'var(--og-warn)', 'var(--og-warn-text)']
                      : cnt > 20 ? ['MOYEN', 1, 'var(--og-accent)', 'var(--og-accent-soft)']
                      : ['FAIBLE', 0, 'var(--og-faint)', 'var(--og-muted)'];
            const zid = String(z.id || z.location_name || '');
            out.push({
                kind: 'TENSION', sev: lvl[1], color: lvl[2], valueColor: lvl[3],
                title: z.location_name || z.country || zid,
                meta: cnt + ' signaux' + (z.zone_count > 1 ? ' · ' + z.zone_count + ' zones' : ''),
                value: lvl[0], rank: cnt / 10,
                open: function () { if (typeof openSignalsReport === 'function') openSignalsReport(zid); }
            });
        });

        return out.sort(function (a, b) { return b.sev - a.sev || b.rank - a.rank; });
    }

    function renderAlerts() {
        const list = $('og-alerts');
        if (!list || detailOpen) return;
        const all = collect();
        const shown = all.filter(function (a) { return chip === 'all' || a.kind === chip; });
        const count = $('og-watch-count');
        if (count) count.textContent = '24 h · ' + all.length;
        Array.prototype.forEach.call(document.querySelectorAll('[data-chip]'), function (c) {
            c.setAttribute('aria-pressed', c.getAttribute('data-chip') === chip ? 'true' : 'false');
        });
        if (!shown.length) {
            const zone = typeof _zone !== 'undefined' && _zone;
            list.innerHTML = '<li class="og-empty">' + (zone ? 'Rien à signaler dans la zone recherchée.' : 'Aucune activité inhabituelle.') + '</li>';
            return;
        }
        list.innerHTML = shown.map(function (a, i) {
            return '<li><button type="button" class="og-alert" data-alert="' + i + '">'
                + '<span class="og-alert-mark' + (a.diamond ? ' og-diamond' : '') + '" style="background:' + a.color + '"></span>'
                + '<span class="og-alert-body"><span class="og-alert-title">' + esc(a.title) + '</span>'
                + '<span class="og-alert-meta">' + esc(a.meta) + '</span></span>'
                + '<span class="og-alert-score"><span class="og-alert-value" style="color:' + a.valueColor + '">' + esc(a.value) + '</span>'
                + '<span class="og-alert-kind">' + a.kind + '</span></span>'
                + '</button></li>';
        }).join('');
        Array.prototype.forEach.call(list.querySelectorAll('[data-alert]'), function (b) {
            b.addEventListener('click', function () { shown[Number(b.getAttribute('data-alert'))].open(); });
        });
    }

    function initWatch() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-chip]'), function (c) {
            c.addEventListener('click', function () { chip = c.getAttribute('data-chip'); renderAlerts(); });
        });
        document.addEventListener('ogma:theatre', function () { if (!detailOpen) renderAlerts(); });
    }

    // ── Fiche détaillée dans la barre de droite ──────────────
    function showDetail(html, onClose) {
        const watch = $('og-watch'), detail = $('og-detail'), body = $('og-detail-body');
        if (!detail || !body) return false;
        if (onDetailClose) { try { onDetailClose(); } catch (e) { /* rien */ } }
        onDetailClose = onClose || null;
        body.innerHTML = html;
        watch.hidden = true;
        detail.hidden = false;
        detailOpen = true;
        if (document.body.classList.contains('og-panel-closed')) setPanel(true);
        const back = $('og-back');
        if (back) back.focus();
        return true;
    }

    function closeDetail() {
        const watch = $('og-watch'), detail = $('og-detail');
        if (!detail || detail.hidden) return;
        detail.hidden = true;
        watch.hidden = false;
        detailOpen = false;
        if (onDetailClose) { const f = onDetailClose; onDetailClose = null; try { f(); } catch (e) { /* rien */ } }
        renderAlerts();
    }

    // Convergence : la carte va sur le foyer, la fiche s'ouvre à droite
    window.showConvergence = function (c) {
        if (typeof c.lat === 'number' && maCarte) maCarte.flyTo([c.lat, c.lon], Math.max(maCarte.getZoom(), 6), { duration: 0.8 });
        const types = (c.types || []).map(function (t) {
            const lbl = CONV_TYPE_LABEL[t] || ['•', t];
            const items = ((c.items && c.items[t]) || []).slice(0, 3).map(function (it) {
                return '<li>' + esc(String(it.label || it.id || '').substring(0, 110)) + '</li>';
            }).join('');
            return '<div class="og-d-type"><div class="og-d-type-head"><span>' + lbl[0] + '</span><span>' + esc(lbl[1]) + '</span>'
                + '<span>× ' + ((c.counts && c.counts[t]) || 0) + '</span></div>' + (items ? '<ul>' + items + '</ul>' : '') + '</div>';
        }).join('');
        showDetail('<div class="og-d">'
            + '<div class="og-d-tags"><span class="og-d-tag og-d-conv">CONVERGENCE</span><span class="og-d-kind">' + (c.types || []).length + ' TYPES DE SIGNAUX</span></div>'
            + '<h3 class="og-d-title">' + esc(c.label || 'Zone') + '</h3>'
            + '<p class="og-d-text">Plusieurs sources indépendantes se croisent dans un rayon d\u2019environ 200 km : à examiner en priorité.</p>'
            + '<div class="og-d-types">' + types + '</div></div>');
    };

    // ── Touche « / » : la barre de recherche (lieu ou question) ──
    function initShortcut() {
        document.addEventListener('keydown', function (e) {
            const t = e.target;
            const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
            if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const input = $('ogma-search-input');
                if (!input) return;
                e.preventDefault();
                input.focus();
                input.select();
            } else if (e.key === 'Escape' && !typing && document.body.classList.contains('og-answer-open') && window.OgmaAgent) {
                OgmaAgent.close();
            }
        });
    }

    // ── Point d'entrée ────────────────────────────────────────
    function afterRender() {
        if (typeof _rebuildAllMode === 'function') _rebuildAllMode();
        if (typeof applyLayers === 'function') applyLayers();
        renderAlerts();
    }

    function init() {
        initRail();
        initPanel();
        initState();
        initWatch();
        initShortcut();
        const back = $('og-back');
        if (back) back.addEventListener('click', closeDetail);
        const about = $('og-about');
        if (about) about.addEventListener('click', function () { const m = $('about-modal'); if (m) m.style.display = 'flex'; });
        renderAlerts();
    }

    APP.UI = { afterRender: afterRender, renderAlerts: renderAlerts, showDetail: showDetail, closeDetail: closeDetail, setPanel: setPanel };
    document.addEventListener('DOMContentLoaded', init);
    console.log('✓ ogma-ui.js chargé');
})();
