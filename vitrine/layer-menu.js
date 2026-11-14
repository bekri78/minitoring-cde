// ── Menus de la barre de calques (v41-v42) ──────────────────────────────────
// « Événements » (événements + convergences) et « Environnement » (crises, feux,
// brouillage GNSS) rangent plusieurs calques dans un menu pour garder une barre courte.
// Les entrées restent de vrais boutons [data-layer] : bascule, compteurs et mémorisation
// sont gérés comme les autres (ogma-ui.js, map.js). Chaque bouton de menu affiche le
// nombre de calques allumés (ex. 2/3). Un seul menu ouvert à la fois.
// Sur téléphone, la barre défile au doigt : le menu est alors posé sur la page
// (sinon la barre défilante le couperait), en pleine largeur sous la barre.
//
// Structure attendue :  .og-env > button.og-env-btn (+ .og-env-on)  et  .og-env-menu > [data-layer]

(function () {
    'use strict';

    const MOBILE = '(max-width: 900px)';
    const menus = [];

    // v47 — Styles du menu embarqués : le menu et ses cases à cocher s'affichent correctement
    // même si SharePoint sert encore un ogma.css plus ancien (fichier non archivé / non publié,
    // cache). Copie des règles « v41/v42 » d'ogma.css ; à garder identiques.
    const CSS = ".og-env { position: relative; display: flex; } .og-env-caret { opacity: .6; transition: transform .15s ease; } .og-env-open .og-env-caret { transform: rotate(180deg); } .og-env-btn[aria-pressed=\"true\"] .og-layer-dot { opacity: 1; } .og-env-menu { display: none; position: absolute; bottom: calc(100% + 10px); right: 0; min-width: 236px; padding: 5px; border-radius: 11px; flex-direction: column; gap: 2px; z-index: 1060; } .og-env-menu.og-env-menu-open { display: flex; } .og-env-menu .og-layer { width: 100%; justify-content: flex-start; height: 34px; } .og-env-menu .og-layer small { font-size: 11px; color: var(--og-faint); font-weight: 400; } .og-env-menu .og-layer .og-layer-count { margin-left: auto; } .og-env-check { width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid rgba(255, 255, 255, .28); box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; flex: none; } .og-env-menu .og-layer[aria-pressed=\"true\"] .og-env-check { background: var(--og-accent-soft, #8b93ff); border-color: transparent; } .og-env-menu .og-layer[aria-pressed=\"true\"] .og-env-check::after { content: ''; width: 7px; height: 4px; border: solid #0b0b10; border-width: 0 0 2px 2px; transform: translateY(-1px) rotate(-45deg); } @media (max-width: 900px) { .og-layers { left: 16px; right: 16px; transform: none; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; } .og-layers::-webkit-scrollbar { display: none; } .og-layer { flex: none; } .og-env-menu.og-env-menu-mobile { position: fixed; left: 16px; right: 16px; bottom: auto; min-width: 0; z-index: 1100; } } .og-env-left .og-env-menu { right: auto; left: 0; }";
    function injectCss() {
        if (document.getElementById('og-env-style')) return;
        const st = document.createElement('style');
        st.id = 'og-env-style';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    function setup(group) {
        const btn = group.querySelector('.og-env-btn');
        const menu = group.querySelector('.og-env-menu');
        const count = group.querySelector('.og-env-on');
        if (!btn || !menu) return;
        const keys = Array.prototype.map.call(menu.querySelectorAll('[data-layer]'), function (b) { return b.getAttribute('data-layer'); });

        const m = {
            isOpen: function () { return menu.classList.contains('og-env-menu-open'); },
            sync: function () {
                const on = keys.filter(function (k) { return typeof layerOn === 'function' && layerOn(k); }).length;
                if (count) count.textContent = on + '/' + keys.length;
                btn.setAttribute('aria-pressed', on > 0 ? 'true' : 'false');
            },
            open: function (v) {
                const mobile = window.matchMedia && window.matchMedia(MOBILE).matches;
                if (v) menus.forEach(function (o) { if (o !== m && o.isOpen()) o.open(false); });
                if (v && mobile) {
                    document.body.appendChild(menu);
                    menu.classList.add('og-env-menu-mobile');
                    const bar = btn.closest('.og-layers') || btn;
                    menu.style.top = Math.round(bar.getBoundingClientRect().bottom + 8) + 'px';
                } else if (!v && menu.parentNode !== group) {
                    group.appendChild(menu);
                    menu.classList.remove('og-env-menu-mobile');
                    menu.style.top = '';
                }
                menu.classList.toggle('og-env-menu-open', v);
                group.classList.toggle('og-env-open', v);
                btn.setAttribute('aria-expanded', v ? 'true' : 'false');
            },
            btn: btn
        };

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            m.open(!m.isOpen());
        });
        // Les clics dans le menu (bascule d'un calque) le laissent ouvert
        menu.addEventListener('click', function (e) { e.stopPropagation(); });
        menus.push(m);
        m.sync();
    }

    function init() {
        injectCss();
        Array.prototype.forEach.call(document.querySelectorAll('.og-env'), setup);
        if (!menus.length) return;
        document.addEventListener('click', function () { menus.forEach(function (m) { if (m.isOpen()) m.open(false); }); });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            menus.forEach(function (m) { if (m.isOpen()) { m.open(false); m.btn.focus(); } });
        });
        window.addEventListener('resize', function () { menus.forEach(function (m) { if (m.isOpen()) m.open(false); }); });
        document.addEventListener('ogma:layers', function () { menus.forEach(function (m) { m.sync(); }); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
