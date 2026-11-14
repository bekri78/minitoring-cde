// ── Menu « Environnement » de la barre de calques (v41) ─────────────────────
// Crises (GDACS), Feux (FIRMS) et Brouillage GNSS sont rangés dans un menu pour
// garder une barre courte. Les entrées restent de vrais boutons [data-layer] :
// bascule, compteurs et mémorisation sont gérés comme les autres (ogma-ui.js, map.js).
// Le bouton du menu affiche le nombre de calques allumés (ex. 2/3).
// Sur téléphone, la barre défile au doigt : le menu est alors posé sur la page
// (sinon la barre défilante le couperait), en pleine largeur sous la barre.

(function () {
    'use strict';

    const MOBILE = '(max-width: 900px)';

    function init() {
        const group = document.getElementById('og-env');
        const btn = document.getElementById('og-env-btn');
        const menu = document.getElementById('og-env-menu');
        if (!group || !btn || !menu) return;
        const keys = Array.prototype.map.call(menu.querySelectorAll('[data-layer]'), function (b) { return b.getAttribute('data-layer'); });

        function sync() {
            const on = keys.filter(function (k) { return typeof layerOn === 'function' && layerOn(k); }).length;
            const n = document.getElementById('og-env-on');
            if (n) n.textContent = on + '/' + keys.length;
            btn.setAttribute('aria-pressed', on > 0 ? 'true' : 'false');
        }
        function isOpen() { return menu.classList.contains('og-env-menu-open'); }
        function open(v) {
            const mobile = window.matchMedia && window.matchMedia(MOBILE).matches;
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
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            open(!isOpen());
        });
        // Les clics dans le menu (bascule d'un calque) le laissent ouvert
        menu.addEventListener('click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function () { if (isOpen()) open(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) { open(false); btn.focus(); }
        });
        window.addEventListener('resize', function () { if (isOpen()) open(false); });
        document.addEventListener('ogma:layers', sync);
        sync();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
