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
