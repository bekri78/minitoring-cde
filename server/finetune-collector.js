'use strict';

/**
 * finetune-collector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline automatique de génération de dataset fine-tuning Mistral.
 *
 * Étapes :
 *  1. Fetch  — GET /events (API interne)
 *  2. Filter — score, catégorie, qualité du titre
 *  3. Dedup  — event_id + fingerprint sémantique (hash)
 *  4. Agent  — classification Mistral par batches de 20
 *  5. Raw    — stockage dans data/finetune-raw.jsonl (tout)
 *  6. Flags  — needs_review automatique selon critères qualité
 *  7. Approved — data/finetune-approved.jsonl (filtrés)
 *  8. Stats  — exposés via /api/finetune/stats
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────
const MISTRAL_API_KEY  = () => (process.env.MISTRAL_API_KEY || '').trim().replace(/^=+/, '');
const MISTRAL_AGENT_ID = process.env.MISTRAL_AGENT_ID || 'ag_019d80e9997f70f9821291b4ac8dde18';
const PROMPT_VERSION   = 'v1.0';
const AGENT_VERSION    = 1;
const INTERNAL_PORT    = process.env.PORT || 3000;
const INTERNAL_URL     = process.env.RAILWAY_INTERNAL_URL || `http://localhost:${INTERNAL_PORT}`;

// Filtres de qualité
const MIN_SCORE           = 60;
const MIN_TITLE_WORDS     = 6;
const VALID_CATEGORIES    = new Set(['military', 'conflict', 'strategic', 'cyber', 'incident']);
const BATCH_SIZE          = 20;
const CALL_DELAY_MS       = 1200; // anti-rate-limit entre chaque appel
const MAX_PER_RUN         = 150;  // 150 events max / cycle (≈ 3min)

// Patterns de titres "fallback" à rejeter
const FALLBACK_PATTERNS = [
  /^fight\s*[—–-]\s*(army|navy|military|police)/i,
  /^(army|navy|military|police)\s*[—–-]/i,
  /^(incident|protest|demonstration)\s*[—–-]/i,
  /^\w+\s*—\s*\w+\s*—\s*[\w\s,]+$/i, // "Act — ACTOR — Place, Country"
];

// Seuils pour needs_review (relevé pour minimiser les reviews manuelles)
const REVIEW_OP_THRESHOLD  = 95;
const REVIEW_STR_THRESHOLD = 95;
const REVIEW_KEEP_FALSE_SCORE = 80;

// ── Chemins ───────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, 'data');
const SEEN_FILE      = path.join(DATA_DIR, 'finetune-seen.json');
const RAW_FILE       = path.join(DATA_DIR, 'finetune-raw.jsonl');
const APPROVED_FILE  = path.join(DATA_DIR, 'finetune-approved.jsonl');

// ── État interne (stats en mémoire) ──────────────────────────────────────────
const _state = {
  lastRun:           null,
  lastRunProcessed:  0,
  lastRunDiscards:   0,
  running:           false,
};

// Seen store en mémoire — persiste entre les cycles dans la même instance
// (le fichier sert uniquement de backup au démarrage)
const _memSeen = { ids: new Set(), fingerprints: new Set() };

// ── Utilitaires ───────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Fingerprint sémantique : hash(titre_normalisé + countryCode + category)
 * Permet de détecter les événements identiques rephrased.
 */
function semanticFingerprint(event) {
  const raw = [
    (event.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(),
    (event.countryCode || '').toUpperCase(),
    (event.category || '').toLowerCase(),
  ].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

// ── Persistance seen store ────────────────────────────────────────────────────
function loadSeen() {
  // Priorité : mémoire (toujours à jour pendant la session)
  if (_memSeen.ids.size > 0) return _memSeen;
  // Fallback : fichier au démarrage
  try {
    if (!fs.existsSync(SEEN_FILE)) return _memSeen;
    const raw = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
    for (const id of (raw.ids || []))          _memSeen.ids.add(id);
    for (const fp of (raw.fingerprints || [])) _memSeen.fingerprints.add(fp);
  } catch { /* ignore */ }
  return _memSeen;
}

function saveSeen(ids, fingerprints) {
  for (const id of ids)  _memSeen.ids.add(id);
  for (const fp of fingerprints) _memSeen.fingerprints.add(fp);
  ensureDataDir();
  fs.writeFileSync(SEEN_FILE, JSON.stringify({
    ids:          [..._memSeen.ids],
    fingerprints: [..._memSeen.fingerprints],
  }), 'utf8');
}

// ── Écriture JSONL ────────────────────────────────────────────────────────────
function appendJsonl(filePath, obj) {
  ensureDataDir();
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

function countJsonlLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim()).length;
  } catch { return 0; }
}

function readAllJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// ── STEP 2 — Filtre qualité ───────────────────────────────────────────────────
function isFallbackTitle(title) {
  return FALLBACK_PATTERNS.some(p => p.test(title));
}

function passesFilter(event) {
  if ((event.score || 0) < MIN_SCORE)          return false;
  if (!VALID_CATEGORIES.has(event.category))   return false;

  const words = (event.title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_TITLE_WORDS)          return false;
  if (isFallbackTitle(event.title || ''))      return false;

  // Titre = copie du nativeTitle sans enrichissement → qualité insuffisante
  if (event.title === event.nativeTitle && event.language !== 'english') return false;

  return true;
}

// ── STEP 4 — Appel agent Mistral ──────────────────────────────────────────────
function buildPrompt(event) {
  // L'agent Mistral a déjà ses instructions système configurées sur la plateforme.
  // On envoie uniquement les données brutes de l'événement en JSON.
  return JSON.stringify({
    title:      event.title,
    country:    event.country || event.countryCode || 'unknown',
    category:   event.category,
    actor1:     event.actor1  || 'unknown',
    actor2:     event.actor2  || 'none',
    score:      event.score,
    severity:   event.severity || 'unknown',
    region:     event.region   || 'unknown',
    notes:      event.notes    || '',
    eventCode:  event.eventCode || '',
    rootCode:   event.rootCode  || '',
  });
}

async function callMistralAgent(event) {
  const key = MISTRAL_API_KEY();
  if (!key) throw new Error('MISTRAL_API_KEY non définie');

  const res = await fetch('https://api.mistral.ai/v1/agents/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      agent_id: MISTRAL_AGENT_ID,
      messages: [{ role: 'user', content: buildPrompt(event) }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const match   = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Réponse non-JSON Mistral: ${content.slice(0, 150)}`);

  const parsed = JSON.parse(match[0]);

  // Si keep=false — réponse valide, pas besoin de valider les autres champs
  if (parsed.keep === false) return parsed;

  // Si keep=true — valider domain_primary obligatoire
  const VALID_DOMAINS = new Set(['air', 'land', 'maritime', 'space', 'cyber', 'strategic']);
  if (!VALID_DOMAINS.has(parsed.domain_primary)) {
    throw new Error(`domain_primary invalide: "${parsed.domain_primary}"`);
  }

  return parsed;
}

// ── STEP 6 — Flags qualité ────────────────────────────────────────────────────
const DOMAIN_CATEGORY_MAP = {
  military:  ['air', 'land', 'maritime', 'space', 'strategic'],
  conflict:  ['land', 'air', 'maritime', 'strategic'],
  strategic: ['strategic', 'cyber', 'land'],
  cyber:     ['cyber', 'strategic'],
  incident:  ['land', 'maritime', 'air'],
};

function computeQualityFlags(event, output) {
  const flags = [];

  // keep=false est un rejet valide — aucun flag de qualité nécessaire
  if (output.keep === false) return { needs_review: false, review_flags: [] };

  if (output.domain_primary === 'strategic')                        flags.push('domain_strategic');
  if ((output.operational_relevance || 0) > REVIEW_OP_THRESHOLD)   flags.push('high_operational');
  if ((output.strategic_relevance   || 0) > REVIEW_STR_THRESHOLD)  flags.push('high_strategic');

  // Mismatch catégorie event ↔ domaine AI
  const allowedDomains = DOMAIN_CATEGORY_MAP[event.category] || [];
  if (allowedDomains.length > 0 && !allowedDomains.includes(output.domain_primary))
    flags.push('domain_mismatch');

  const needs_review = flags.length > 0;
  return { needs_review, review_flags: flags };
}

// ── STEP 5+6+7 — Stocker une paire ───────────────────────────────────────────
function storeEntry(event, output) {
  const { needs_review, review_flags } = computeQualityFlags(event, output);

  const entry = {
    event_id: event.id,
    input: {
      title:       event.title,
      originalTitle: event.originalTitle || null,
      countryCode: event.countryCode,
      country:     event.country || null,
      lat:         event.lat,
      lon:         event.lon,
      score:       event.score,
      category:    event.category,
      severity:    event.severity    || null,
      region:      event.region      || null,
      actor1:      event.actor1      || null,
      actor2:      event.actor2      || null,
      rootCode:    event.rootCode    || null,
      eventCode:   event.eventCode   || null,
      is_strategic: event.is_strategic || 0,
      notes:       event.notes       || null,
      language:    event.language    || null,
    },
    output: {
      keep:                  output.keep,
      domain_primary:        output.domain_primary,
      event_type:            output.event_type,
      operational_relevance: output.operational_relevance,
      strategic_relevance:   output.strategic_relevance,
    },
    meta: {
      agent_id:       MISTRAL_AGENT_ID,
      agent_version:  AGENT_VERSION,
      prompt_version: PROMPT_VERSION,
      collected_at:   new Date().toISOString(),
      label_origin:   'agent_auto',
      needs_review,
      review_flags,
    },
  };

  // RAW — toujours (keep=true et keep=false)
  appendJsonl(RAW_FILE, entry);

  // APPROVED — seulement keep=true sans flag de review
  if (output.keep !== false && !needs_review) {
    appendJsonl(APPROVED_FILE, entry);
  }

  return entry;
}

// ── Pipeline principal ────────────────────────────────────────────────────────
async function runFinetuneCollector() {
  if (_state.running) {
    console.log('[finetune] cycle déjà en cours — skip');
    return;
  }

  const key = MISTRAL_API_KEY();
  if (!key) {
    console.warn('[finetune] MISTRAL_API_KEY non définie — pipeline désactivé');
    return;
  }

  _state.running = true;
  _state.lastRun = new Date().toISOString();
  console.log('[finetune] ── Démarrage du cycle ──');

  try {
    // ── STEP 1 — Fetch events (avec attente si cache en cours de refresh) ────
    let events = [];
    try {
      let body, attempts = 0;
      while (attempts < 5) {
        const res = await fetch(`${INTERNAL_URL}/events`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        body = await res.json();
        if (body.status !== 'refreshing') break;
        attempts++;
        console.log(`[finetune] /events en cours de refresh — attente 30s (tentative ${attempts}/5)`);
        await sleep(30000);
      }
      if (body.status === 'refreshing') {
        console.warn('[finetune] /events toujours en refresh après 5 tentatives — cycle annulé');
        return;
      }
      events = body.events || body || [];
    } catch (err) {
      console.error('[finetune] Erreur /events:', err.message);
      return;
    }
    console.log(`[finetune] ${events.length} événements reçus`);

    // ── STEP 2 — Filtre qualité ──────────────────────────────────────────────
    const filtered = events.filter(passesFilter);
    console.log(`[finetune] ${filtered.length} après filtre qualité`);

    // ── STEP 3 — Déduplication ───────────────────────────────────────────────
    const seen        = loadSeen();
    const seenIds     = new Set(seen.ids);
    const seenFprints = new Set(seen.fingerprints);

    const candidates = filtered.filter(e => {
      if (seenIds.has(e.id))                        return false;
      if (seenFprints.has(semanticFingerprint(e)))  return false;
      return true;
    }).slice(0, MAX_PER_RUN);

    console.log(`[finetune] ${candidates.length} candidats nouveaux (max ${MAX_PER_RUN}/cycle)`);

    if (candidates.length === 0) {
      console.log('[finetune] Aucun événement à labéliser');
      _state.lastRunProcessed = 0;
      return;
    }

    // ── STEP 4 — Batches Mistral ─────────────────────────────────────────────
    let processed = 0, discards = 0, errors = 0, reviewCount = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      console.log(`[finetune] Batch ${Math.floor(i / BATCH_SIZE) + 1} — ${batch.length} events`);

      for (const event of batch) {
        try {
          const output = await callMistralAgent(event);
          const entry  = storeEntry(event, output);

          // Toujours marquer comme vu (keep=true ou keep=false)
          seenIds.add(event.id);
          seenFprints.add(semanticFingerprint(event));

          if (output.keep === false) {
            discards++;
            console.log(`[finetune] ○ ${event.id} keep=false discard`);
          } else {
            processed++;
            if (entry.meta.needs_review) reviewCount++;
            console.log(
              `[finetune] ✓ ${event.id}` +
              ` domain=${output.domain_primary}` +
              ` keep=true` +
              ` op=${output.operational_relevance}` +
              `${entry.meta.needs_review ? ' ⚑ review' : ''}`
            );
          }
        } catch (err) {
          errors++;
          // Ne pas marquer comme vu — sera retenté au prochain cycle
          console.error(`[finetune] ✗ ${event.id}: ${err.message}`);
        }

        await sleep(CALL_DELAY_MS);
      }
    }

    // ── Sauvegarder le seen store ────────────────────────────────────────────
    saveSeen(seenIds, seenFprints);
    _state.lastRunProcessed = processed;
    _state.lastRunDiscards  = discards;

    console.log(
      `[finetune] ── Cycle terminé ── ` +
      `${processed} keep=true | ${discards} discards | ${errors} erreurs | ${reviewCount} needs_review`
    );
    const approvedCount = countJsonlLines(APPROVED_FILE);
    console.log(
      `[finetune] Dataset : raw=${countJsonlLines(RAW_FILE)} ` +
      `| approved=${approvedCount}`
    );

    // ── Auto-upload si seuil atteint ─────────────────────────────────────
    try {
      const { runFinetuneUpload, AUTO_THRESHOLD } = require('./finetune-uploader');
      if (approvedCount >= AUTO_THRESHOLD) {
        console.log(`[finetune] Seuil ${AUTO_THRESHOLD} atteint (${approvedCount}) — lancement upload automatique`);
        runFinetuneUpload(approvedCount).catch(err =>
          console.error('[finetune-upload] Erreur auto-upload:', err.message)
        );
      }
    } catch (uploadErr) {
      console.error('[finetune] Impossible de charger finetune-uploader:', uploadErr.message);
    }

  } finally {
    _state.running = false;
  }
}

// ── STEP 8 — Stats pour monitoring ───────────────────────────────────────────
function getDatasetStats() {
  // ── Comptage par lignes (robuste, pas de dépendance au parsing JSON) ────
  const rawCount      = countJsonlLines(RAW_FILE);
  const approvedCount = countJsonlLines(APPROVED_FILE);

  // ── Distributions et flags — lecture JSON optionnelle (best-effort) ────
  let needsReview  = 0;
  let totalDiscards = 0;
  const domainDist = {};
  const flagDist   = {};

  try {
    const rawEntries = readAllJsonl(RAW_FILE);
    needsReview   = rawEntries.filter(e => e.meta?.needs_review).length;
    totalDiscards = rawEntries.filter(e => e.output?.keep === false).length;

    for (const e of rawEntries.filter(e => e.output?.keep !== false)) {
      const d = e.output?.domain_primary || 'unknown';
      domainDist[d] = (domainDist[d] || 0) + 1;
    }
    for (const e of rawEntries.filter(e => e.meta?.needs_review)) {
      for (const f of (e.meta.review_flags || [])) {
        flagDist[f] = (flagDist[f] || 0) + 1;
      }
    }
  } catch { /* si le fichier est illisible, on garde les zéros */ }

  loadSeen(); // synchronise _memSeen depuis le fichier si besoin

  return {
    // ── Comptages principaux (ligne par ligne, fiable) ──────────────────
    total_raw:          rawCount,
    total_keep_true:    rawCount - totalDiscards,
    total_discards:     totalDiscards,
    total_approved:     approvedCount,
    total_needs_review: needsReview,

    // ── Distributions ────────────────────────────────────────────────────
    domain_distribution:     domainDist,
    review_flag_distribution: flagDist,

    // ── État pipeline ────────────────────────────────────────────────────
    total_events_seen:  _memSeen.ids.size,
    total_fingerprints: _memSeen.fingerprints.size,
    last_run:           _state.lastRun,
    last_run_processed: _state.lastRunProcessed,
    last_run_discards:  _state.lastRunDiscards,
    pipeline_running:   _state.running,

    // ── Debug chemins (pour vérifier que le bon répertoire est utilisé) ──
    raw_file_path:      RAW_FILE,
    approved_file_path: APPROVED_FILE,
    seen_file_path:     SEEN_FILE,
    raw_file_exists:      fs.existsSync(RAW_FILE),
    approved_file_exists: fs.existsSync(APPROVED_FILE),
    seen_file_exists:     fs.existsSync(SEEN_FILE),
  };
}

// ── Review manuel ───────────────────────────────────────────────────────────

/**
 * Retourne toutes les entrées needs_review avec leurs flags.
 * Utilisé par GET /api/finetune/review
 */
function getReviewEntries() {
  const entries = readAllJsonl(RAW_FILE);
  return entries
    .filter(e => e.meta?.needs_review === true)
    .map(e => ({
      event_id:     e.event_id,
      title:        e.input?.title,
      country:      e.input?.country,
      countryCode:  e.input?.countryCode,
      score:        e.input?.score,
      category:     e.input?.category,
      keep:         e.output?.keep,
      domain:       e.output?.domain_primary,
      op_relevance: e.output?.operational_relevance,
      str_relevance: e.output?.strategic_relevance,
      review_flags: e.meta?.review_flags || [],
      collected_at: e.meta?.collected_at,
    }));
}

/**
 * Réécrit une ligne dans finetune-raw.jsonl par event_id.
 * Retourne true si trouvé, false sinon.
 */
function patchRawEntry(eventId, patchFn) {
  if (!fs.existsSync(RAW_FILE)) return false;
  const lines = fs.readFileSync(RAW_FILE, 'utf8').split('\n').filter(l => l.trim());
  let found = false;
  const updated = lines.map(l => {
    try {
      const entry = JSON.parse(l);
      if (entry.event_id === eventId) {
        found = true;
        return JSON.stringify(patchFn(entry));
      }
      return l;
    } catch { return l; }
  });
  if (found) fs.writeFileSync(RAW_FILE, updated.join('\n') + '\n', 'utf8');
  return found;
}

/**
 * Approve manuel : supprime le flag needs_review, ajoute dans approved.
 */
function approveEntry(eventId) {
  let approvedEntry = null;
  const found = patchRawEntry(eventId, entry => {
    entry.meta.needs_review   = false;
    entry.meta.review_flags   = [];
    entry.meta.label_origin   = 'human_approved';
    entry.meta.reviewed_at    = new Date().toISOString();
    approvedEntry = entry;
    return entry;
  });
  if (!found) return { ok: false, error: 'event_id not found' };
  if (approvedEntry) appendJsonl(APPROVED_FILE, approvedEntry);
  return { ok: true, event_id: eventId, action: 'approved' };
}

/**
 * Reject manuel : passe keep=false dans le raw (ne touche pas approved).
 */
function rejectEntry(eventId) {
  const found = patchRawEntry(eventId, entry => {
    entry.output.keep       = false;
    entry.meta.needs_review = false;
    entry.meta.review_flags = [];
    entry.meta.label_origin = 'human_rejected';
    entry.meta.reviewed_at  = new Date().toISOString();
    return entry;
  });
  if (!found) return { ok: false, error: 'event_id not found' };
  return { ok: true, event_id: eventId, action: 'rejected' };
}

module.exports = { runFinetuneCollector, getDatasetStats, getReviewEntries, approveEntry, rejectEntry };
