 // ── Synthèse géopolitique par zone (Signals widget) ──────────

// Cache complet des zones pour la modal
let _signalsZonesCache = [];

function signalsLevelColor(level) {
    const l = (level || '').toLowerCase();
    if (l === 'critical' || l === 'critique') return '#ff2244';
    if (l === 'high'     || l === 'élevé')   return '#ff5533';
    if (l === 'medium'   || l === 'modéré')  return '#ffaa00';
    return '#00d4ff';
}

// ── Modal compte-rendu géopolitique ─────────────────────────

function _ensureSignalsModal() {
    if (document.getElementById('signals-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'signals-modal';
    overlay.style.cssText = [
        'display:none;position:fixed;inset:0;z-index:99999',
        'background:rgba(0,0,0,0.72);align-items:center;justify-content:center'
    ].join(';');

    overlay.innerHTML = [
        '<div id="signals-modal-box" style="',
            'font-family:\'Share Tech Mono\',monospace;',
            'background:#0a0f16;border:1px solid #1a2a3a;',
            'width:min(680px,94vw);max-height:82vh;',
            'display:flex;flex-direction:column;',
            'box-shadow:0 8px 48px rgba(0,0,0,0.8);">',

          // — en-tête
          '<div id="signals-modal-hdr" style="',
              'display:flex;align-items:center;gap:10px;',
              'padding:14px 18px;border-bottom:1px solid #1a2a3a;flex-shrink:0;">',
            '<div style="flex:1;">',
              '<div id="signals-modal-title" style="color:#00d4ff;font-size:13px;letter-spacing:2px;"></div>',
              '<div id="signals-modal-meta"  style="color:#4a6a7a;font-size:9px;margin-top:3px;"></div>',
            '</div>',
            '<button onclick="_closeSignalsModal()" style="',
                'font-family:\'Share Tech Mono\',monospace;font-size:11px;',
                'background:transparent;border:1px solid #1a2a3a;color:#4a6a7a;',
                'padding:3px 10px;cursor:pointer;">',
              '&#x2715; FERMER',
            '</button>',
          '</div>',

          // — corps scrollable
          '<div id="signals-modal-body" style="',
              'overflow-y:auto;padding:18px;flex:1;',
              'font-size:11px;line-height:1.7;color:#c8d8e8;">',
            // Faits bruts (key_points)
            '<div id="signals-modal-facts" style="margin-bottom:16px;"></div>',
            // Séparateur + titre analyse
            '<div style="color:#4a6a7a;font-size:8px;letter-spacing:0.12em;',
                'border-top:1px solid #1a2a3a;padding-top:12px;margin-bottom:10px;">',
              'ANALYSE IA — GENIAL',
            '</div>',
            '<div id="signals-modal-report" style="white-space:pre-wrap;"></div>',
          '</div>',

        '</div>'
    ].join('');

    // Fermeture au clic sur l'overlay (hors box)
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) _closeSignalsModal();
    });

    document.body.appendChild(overlay);
}

let _signalsModalAbort = false;

function _closeSignalsModal() {
    _signalsModalAbort = true;
    const m = document.getElementById('signals-modal');
    if (m) m.style.display = 'none';
}

async function openSignalsReport(zoneId) {
    const zone = _signalsZonesCache.find(function (z) { return (z.id || z.location_name) === zoneId; });
    if (!zone) return;

    _ensureSignalsModal();
    _signalsModalAbort = false;

    const cnt   = zone.event_count || 0;
    const lvl   = cnt > 100 ? 'CRITICAL' : cnt > 50 ? 'HIGH' : cnt > 20 ? 'MEDIUM' : 'LOW';
    const color = signalsLevelColor(lvl);
    const name  = zone.location_name || zone.country || zone.id || '';

    // Remplir en-tête
    document.getElementById('signals-modal-title').textContent = name.toUpperCase();
    document.getElementById('signals-modal-meta').innerHTML =
        '<span style="color:' + color + ';">' + lvl + '</span>'
        + ' &nbsp;&middot;&nbsp; ' + cnt + ' signaux'
        + ' &nbsp;&middot;&nbsp; ' + new Date().toISOString().substring(0, 10);

    // Afficher les key_points bruts
    const factsEl = document.getElementById('signals-modal-facts');
    const kps = zone.key_points || [];
    if (kps.length) {
        const catColor = { military: '#ff5533', diplomatic: '#00d4ff', conflict: '#ff2244', terrorism: '#ff8800' };
        factsEl.innerHTML = '<div style="color:#4a6a7a;font-size:8px;letter-spacing:0.12em;margin-bottom:8px;">SIGNAUX BRUTS</div>'
            + kps.map(function (kp) {
                const c = catColor[kp.category] || '#4a6a7a';
                return '<div style="display:flex;gap:8px;margin-bottom:6px;">'
                    + '<span style="color:' + c + ';font-size:8px;flex-shrink:0;padding-top:2px;">▸</span>'
                    + '<span style="color:#c8d8e8;font-size:10px;">' + escapeHtml(kp.point || '') + '</span>'
                    + '</div>';
            }).join('');
    } else {
        factsEl.innerHTML = '';
    }

    // Zone rapport + curseur clignotant pendant le stream
    const reportEl = document.getElementById('signals-modal-report');
    reportEl.textContent = '';
    reportEl.innerHTML = '<span style="color:#4a6a7a;font-size:9px;animation:pulse 1s infinite;">Génération en cours…</span>';

    // Afficher la modal
    const modal = document.getElementById('signals-modal');
    modal.style.display = 'flex';

    // Construire le prompt à partir des données réelles
    const kpText = kps.map(function (kp) { return '- [' + (kp.category || '?') + '] ' + kp.point; }).join('\n');
    const summaryText = zone.summary || '';

    const messages = [
        {
            role: 'system',
            content: [
                'Tu es un analyste géopolitique chargé de produire une note de situation opérationnelle à forte valeur décisionnelle.',
                
                'Ta mission est d’identifier ce qui compte réellement sur la zone suivie : dynamiques récentes, facteurs de tension, risques immédiats et évolution probable.',
                
                'Tu ne fais pas un résumé journalistique. Tu produis une analyse exploitable rapidement.',
                
                'Style attendu : note de renseignement courte, dense, factuelle, orientée décision.',
                
                'Interdictions : pas de généralités, pas de contexte inutile, pas de ton journalistique, pas d’introduction ni de conclusion.',
                
                'Exigences : prioriser les informations, mettre en avant les évolutions récentes, hiérarchiser les risques, signaler les incertitudes sans inventer.',
                
                'Réponds en français.',
                
                '',
                '**SITUATION ACTUELLE**',
                '4 à 6 phrases maximum. Décrire la dynamique réelle, les faits récents structurants et pourquoi la tension existe maintenant.',
                
                '',
                '**FACTEURS DE TENSION**',
                '- Acteurs impliqués et posture',
                '- Événements déclencheurs ou aggravants',
                '- Leviers de pression (militaire, économique, politique)',
                '- Influences externes',
                
                '',
                '**RISQUES À COURT TERME**',
                '- [Critique] ...',
                '- [Élevé] ...',
                '- [Modéré] ...',
                'Classer impérativement du plus grave au moins grave.',
                
                '',
                '**APPRÉCIATION**',
                '3 à 4 phrases. Décrire le scénario probable à 48-72h et le déclencheur principal à surveiller.',
                
                '',
                '**NIVEAU D’ALERTE**',
                '- Intensité : Critique / Élevée / Modérée / Faible',
                '- Déclencheur principal : ...',
                '- Fenêtre de vigilance : 24-72h'
            ].join('\n')
        },
        {
            role: 'user',
            content: [
                'Zone : ' + name + (zone.localities && zone.localities.length > 1 ? ' (foyers : ' + zone.localities.join(' ; ') + ')' : ''),
                'Niveau de tension : ' + lvl + ' (' + cnt + ' signaux)',
                '',
                'Résumé disponible :',
                summaryText,
                '',
                'Points clés détectés :',
                kpText
            ].join('\n')
        }
    ];

    try {
        let output = '';
        await APP.Genial.chatStream(messages, function (chunk) {
            if (_signalsModalAbort) return;
            output += chunk;
            reportEl.innerHTML = output
                .replace(/\r\n/g, '\n')
                .replace(/^\*{0,2}(#{1,4})\s+(.+?)\*{0,2}$/gm, '$1 $2')
                .replace(/^## (.+)$/gm, '<span style="display:block;color:#00d4ff;font-weight:bold;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-top:8px;border-bottom:1px solid #1a3a4a;padding-bottom:2px;">$1</span>')
                .replace(/^#{3,4} (.+)$/gm, '<span style="display:block;color:#66eecc;font-weight:bold;font-size:11px;letter-spacing:1px;margin-top:6px;">$1</span>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#00d4ff;letter-spacing:1px;">$1</strong>')
                .replace(/\n/g, '<br>');
        });
    } catch (e) {
        if (!_signalsModalAbort) {
            reportEl.textContent = '[Erreur : ' + (e.message || e) + ']';
        }
    }
}

// ── Regroupement des zones par pays ─────────────────────────
// Le serveur calcule les zones par point géographique : un même pays peut donc
// apparaître plusieurs fois (« Tehran, Iran » et « Iran », deux « Moscow, Russia »)
// et occuper plusieurs des 5 places du widget. On fusionne par pays : signaux
// additionnés, points clés et synthèses réunis sans doublon.
const ZONE_COUNTRY_ALIAS = {
    'usa': 'United States', 'us': 'United States', 'united states of america': 'United States',
    'uk': 'United Kingdom', 'great britain': 'United Kingdom',
    'russian federation': 'Russia', 'burma': 'Myanmar'
};

function _zoneCountry(z) {
    // Le pays est la dernière partie du libellé affiché, sans les précisions entre parenthèses
    let name = String(z.location_name || z.country || z.id || '').replace(/\s*\([^)]*\)/g, '').trim();
    const parts = name.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const country = parts.length ? parts[parts.length - 1] : name;
    return ZONE_COUNTRY_ALIAS[country.toLowerCase()] || country;
}

function _mergeZonesByCountry(zones) {
    const groups = new Map();
    zones.forEach(function (z) {
        const country = _zoneCountry(z);
        const key = country.toLowerCase();
        if (!groups.has(key)) groups.set(key, { country: country, zones: [] });
        groups.get(key).zones.push(z);
    });

    return Array.from(groups.values()).map(function (g) {
        const list = g.zones.slice().sort(function (a, b) { return (b.event_count || 0) - (a.event_count || 0); });
        const top = list[0];
        if (list.length === 1) return Object.assign({ zone_count: 1 }, top);

        const seenPoints = new Set();
        const keyPoints = [];
        list.forEach(function (z) {
            (z.key_points || []).forEach(function (kp) {
                const k = String(kp.point || '').trim().toLowerCase();
                if (!k || seenPoints.has(k)) return;
                seenPoints.add(k);
                keyPoints.push(kp);
            });
        });

        const seenSummaries = new Set();
        const summaries = [];
        list.forEach(function (z) {
            const sm = String(z.summary || '').trim();
            if (sm && !seenSummaries.has(sm)) { seenSummaries.add(sm); summaries.push(sm); }
        });

        const localities = list.map(function (z) { return z.location_name || z.id; })
            .filter(function (v, i, a) { return v && a.indexOf(v) === i; });

        return Object.assign({}, top, {
            id: 'pays-' + g.country.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            location_name: g.country,
            country: g.country,
            event_count: list.reduce(function (n, z) { return n + (z.event_count || 0); }, 0),
            summary: summaries.slice(0, 3).join(' '),
            key_points: keyPoints.slice(0, 10),
            zone_count: list.length,
            localities: localities
        });
    });
}

// Les zones de tension sont présentées par la barre de droite (« À surveiller »,
// ogma-ui.js) ; un clic ouvre le rapport de zone (openSignalsReport).
function renderSignals(zones) {
    _signalsZonesCache = _mergeZonesByCountry(zones || []);
    if (APP.UI) APP.UI.renderAlerts();
}

// ── Historique journalier (sync SP uniquement) ────────────────

// ── Aircraft ADS-B brut (sync SP — tracks assure l'affichage) ─

// ── Ships AIS brut (sync SP — tracks assure l'affichage) ─────

