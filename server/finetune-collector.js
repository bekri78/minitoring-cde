'use strict';

/**
 * finetune-collector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline automatique de génération de dataset fine-tuning OpenAI.
 *
 * Étapes :
 *  1. Fetch  — GET /events (API interne)
 *  2. Filter — score, catégorie, qualité du titre
 *  3. Dedup  — event_id + fingerprint sémantique (hash)
 *  4. Agent  — classification Claude par batches de 20
 *  5. Raw    — stockage dans data/finetune-raw.jsonl (tout)
 *  6. Flags  — needs_review automatique selon critères qualité
 *  7. Approved — data/finetune-approved.jsonl (filtrés)
 *  8. Stats  — exposés via /api/finetune/stats
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────
const CLAUDE_API_KEY   = () => (process.env.CLAUDE_API_KEY || '').trim().replace(/^=+/, '');
const CLAUDE_MODEL     = process.env.CLAUDE_LABELER_MODEL || 'claude-sonnet-4-6';
const DEEPSEEK_API_KEY = () => (process.env.DEEPSEEK_API_KEY || '').trim().replace(/^=+/, '');
const DEEPSEEK_DEDUP_MODEL = 'deepseek-v4-flash';
const PROMPT_VERSION   = 'v2.0';
const AGENT_VERSION    = 2;
const INTERNAL_PORT    = process.env.PORT || 3000;
const INTERNAL_URL     = process.env.RAILWAY_INTERNAL_URL || `http://localhost:${INTERNAL_PORT}`;

// ── Dedup AI config ───────────────────────────────────────────────────────────
const DEDUP_RECENT_HOURS  = 48;       // fenêtre de comparaison avec les approuvés récents
const DEDUP_GRAY_MIN      = 0.20;     // similarité Jaccard min pour zone grise
const DEDUP_GRAY_MAX      = 0.70;     // similarité Jaccard max (au-dessus = doublon évident)
const DEDUP_AI_BATCH      = 30;       // max paires par appel LLM
const DEDUP_STOPWORDS     = new Set([
  'le','la','les','de','du','des','un','une','en','et','ou','sur','avec','pour',
  'par','dans','il','ils','elle','elles','se','qui','que','est','son','sa','ses',
  'leur','leurs','on','nous','vous','dont','mais','si','car','ni','au','aux','ce',
  'cette','ces','the','and','for','with','in','of','to','is','are','was','from',
]);

// Filtres de qualité
const MIN_SCORE           = 50;
const MIN_TITLE_WORDS     = 6;
const VALID_CATEGORIES    = new Set(['military', 'conflict', 'strategic', 'cyber', 'incident']);
const BATCH_SIZE          = 20;
const CALL_DELAY_MS       = 500;  // anti-rate-limit entre chaque appel
const MAX_PER_RUN         = 300;  // 300 events max / cycle (≈ 2.5min)

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
// Répertoire persistant — utilise le volume Railway (/data) si disponible,
// sinon fallback local pour le dev
const DATA_DIR       = process.env.FINETUNE_DATA_DIR || '/data';
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
// ids expire après 24h (pour retraiter les nouveaux events GDELT du lendemain)
// fingerprints expirent après 14j — évite les doublons stricts mais ne bloque pas indéfiniment
const ID_TTL_MS = 24 * 60 * 60 * 1000;       // 24h
const FP_TTL_MS = 14 * 24 * 60 * 60 * 1000;  // 14 jours
const _memSeen = { ids: new Set(), idTimestamps: new Map(), fpTimestamps: new Map() };

// Fingerprints déjà présents dans approved.jsonl — évite les doublons de training
const _approvedFps = new Set();
let   _approvedFpsLoaded = false;

function expireSeen() {
  const idCutoff = Date.now() - ID_TTL_MS;
  const fpCutoff = Date.now() - FP_TTL_MS;
  let expiredIds = 0, expiredFps = 0;
  for (const [id, ts] of _memSeen.idTimestamps) {
    if (ts < idCutoff) {
      _memSeen.ids.delete(id);
      _memSeen.idTimestamps.delete(id);
      expiredIds++;
    }
  }
  for (const [fp, ts] of _memSeen.fpTimestamps) {
    if (ts < fpCutoff) {
      _memSeen.fpTimestamps.delete(fp);
      expiredFps++;
    }
  }
  if (expiredIds > 0 || expiredFps > 0)
    console.log(`[finetune] seen store: ${expiredIds} ids, ${expiredFps} fingerprints expirés`);
}

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
    // ids peuvent être: [{id, ts}, ...] (nouveau format) ou ["id", ...] (ancien)
    for (const entry of (raw.ids || [])) {
      if (typeof entry === 'string') {
        _memSeen.ids.add(entry);
        _memSeen.idTimestamps.set(entry, Date.now()); // pas de ts → now
      } else if (entry?.id) {
        _memSeen.ids.add(entry.id);
        _memSeen.idTimestamps.set(entry.id, entry.ts || Date.now());
      }
    }
    for (const entry of (raw.fingerprints || [])) {
      if (typeof entry === 'string') {
        // Ancien format sans ts → ts=0 pour qu'ils expirent immédiatement
        _memSeen.fpTimestamps.set(entry, 0);
      } else if (entry?.fp) {
        _memSeen.fpTimestamps.set(entry.fp, entry.ts || 0);
      }
    }
  } catch { /* ignore */ }
  return _memSeen;
}

function saveSeen(ids, fingerprints) {
  const now = Date.now();
  for (const id of ids) {
    _memSeen.ids.add(id);
    _memSeen.idTimestamps.set(id, now);
  }
  for (const fp of fingerprints) _memSeen.fpTimestamps.set(fp, now);
  ensureDataDir();
  fs.writeFileSync(SEEN_FILE, JSON.stringify({
    ids:          [..._memSeen.idTimestamps].map(([id, ts]) => ({ id, ts })),
    fingerprints: [..._memSeen.fpTimestamps].map(([fp, ts]) => ({ fp, ts })),
  }), 'utf8');
}

// Charge les fingerprints déjà approved (une seule fois au démarrage)
function loadApprovedFps() {
  if (_approvedFpsLoaded) return;
  _approvedFpsLoaded = true;
  try {
    const entries = readAllJsonl(APPROVED_FILE);
    for (const e of entries) {
      if (e.input) _approvedFps.add(semanticFingerprint(e.input));
    }
    if (_approvedFps.size > 0)
      console.log(`[finetune] ${_approvedFps.size} fingerprints approved chargés (anti-doublon)`);
  } catch { /* ignore */ }
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

// ── STEP 3b — Dedup sémantique AI ────────────────────────────────────────────

function titleWords(title) {
  return new Set(
    (title || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !DEDUP_STOPWORDS.has(w))
  );
}

function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(w => b.has(w)).length;
  return intersection / (a.size + b.size - intersection);
}

function loadRecentApprovedTitles() {
  const cutoff = Date.now() - DEDUP_RECENT_HOURS * 3600 * 1000;
  return readAllJsonl(RAW_FILE)
    .filter(e => e.output?.keep === true && Date.parse(e.meta?.collected_at) > cutoff)
    .map(e => ({ id: String(e.input?.id || ''), title: e.input?.title || '' }));
}

function findDedupPairs(candidates, recentApproved) {
  const all = [
    ...candidates.map((e, i) => ({ idx: i, isCandidate: true, id: String(e.id), title: e.title || '', words: titleWords(e.title) })),
    ...recentApproved.map(e => ({ idx: -1, isCandidate: false, id: e.id, title: e.title, words: titleWords(e.title) })),
  ];
  const pairs = [];
  for (let i = 0; i < candidates.length; i++) {
    const a = all[i];
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      if (a.id === b.id) continue;
      const sim = jaccardSimilarity(a.words, b.words);
      if (sim >= DEDUP_GRAY_MIN && sim < DEDUP_GRAY_MAX) {
        pairs.push({ i: a.idx, j: b.idx, titleA: a.title, titleB: b.title, jIsCandidate: b.isCandidate });
      } else if (sim >= DEDUP_GRAY_MAX) {
        // Doublon évident → marquer directement sans LLM
        pairs.push({ i: a.idx, j: b.idx, titleA: a.title, titleB: b.title, jIsCandidate: b.isCandidate, obvious: true });
      }
    }
  }
  return pairs;
}

async function deduplicateCandidatesWithAI(candidates) {
  const key = DEEPSEEK_API_KEY();
  if (!key || !candidates.length) return candidates;

  const recentApproved = loadRecentApprovedTitles();
  const allPairs = findDedupPairs(candidates, recentApproved);
  if (!allPairs.length) return candidates;

  const duplicateCandidateIndices = new Set();

  // Doublons évidents — sans LLM
  for (const p of allPairs.filter(p => p.obvious)) {
    duplicateCandidateIndices.add(p.i);
  }

  // Zone grise — LLM DeepSeek
  const grayPairs = allPairs.filter(p => !p.obvious);
  for (let b = 0; b < grayPairs.length; b += DEDUP_AI_BATCH) {
    const batch = grayPairs.slice(b, b + DEDUP_AI_BATCH);
    const prompt = batch.map((p, idx) =>
      `Pair ${idx}:\n  A: "${p.titleA}"\n  B: "${p.titleB}"`
    ).join('\n\n');
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_DEDUP_MODEL,
          messages: [
            { role: 'system', content: 'You are an OSINT news deduplication expert.\nGiven pairs of headlines, decide if each pair covers the SAME real-world event.\nSame event = same incident/operation/announcement, even if worded differently or from different sources.\nDifferent event = different incident, different day, different location, or only thematically similar.\nReturn ONLY a JSON object: {"pairs":[{"pair":0,"same":true},{"pair":1,"same":false},...]}' },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(text);
      const results = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pairs) ? parsed.pairs : []);
      for (const r of results) {
        if (!r.same) continue;
        const pair = batch[r.pair];
        if (pair) duplicateCandidateIndices.add(pair.i);
      }
    } catch (err) {
      console.warn('[finetune-dedup] batch AI failed:', err.message.slice(0, 80));
    }
  }

  if (duplicateCandidateIndices.size > 0) {
    console.log(`[finetune-dedup] ${duplicateCandidateIndices.size} doublons sémantiques supprimés sur ${candidates.length}`);
  }
  return candidates.filter((_, i) => !duplicateCandidateIndices.has(i));
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

// ── STEP 4 — Labélisation (Claude) ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are a military and geopolitical OSINT classifier.
Given a raw event (JSON), you must return a JSON object with:
- keep (boolean): true if the event is relevant for OSINT monitoring, false otherwise
- domain_primary (string): one of air, land, maritime, space, cyber, strategic
- event_type (string): short label (e.g. "artillery_strike", "naval_maneuver", "ballistic_missile_test")
- operational_relevance (integer 0-100): tactical/operational significance
- strategic_relevance (integer 0-100): strategic/geopolitical significance

Reject: sports, entertainment, business/finance, medical, court proceedings, opinion pieces, civilian accidents.
Keep: armed conflict, military operations, terrorism, cyberattacks, coups, sanctions with security impact, strategic crises.

Return only a valid JSON object. No explanation, no markdown.`;

function buildPrompt(event) {
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

function parseAndValidate(content, source) {
  // Extraction robuste : cherche le premier { jusqu'au } fermant correspondant
  const start = content.indexOf('{');
  if (start === -1) throw new Error(`Réponse non-JSON ${source}: ${content.slice(0, 150)}`);

  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < content.length; i++) {
    const c = content[i];
    if (esc)       { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr)     continue;
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error(`JSON incomplet ${source}: ${content.slice(0, 200)}`);

  let parsed;
  try {
    // Réparer le pattern fréquent : "key">value → "key":value (Claude confond > et :)
    const raw = content.slice(start, end + 1).replace(/"(\w+)">\s*(-?\d+(?:\.\d+)?)/g, '"$1":$2');
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON invalide ${source} (${e.message}): ${content.slice(start, start + 220)}`);
  }

  if (parsed.keep === false) return parsed;
  const VALID_DOMAINS = new Set(['air', 'land', 'maritime', 'space', 'cyber', 'strategic']);
  if (!VALID_DOMAINS.has(parsed.domain_primary)) {
    throw new Error(`domain_primary invalide: "${parsed.domain_primary}"`);
  }
  return parsed;
}

async function callClaudeLabeler(event) {
  const key = CLAUDE_API_KEY();
  if (!key) throw new Error('CLAUDE_API_KEY non définie');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: buildPrompt(event) }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const data    = await res.json();
  const content = data.content?.[0]?.text || '';
  return parseAndValidate(content, 'Claude');
}

function callLabeler(event) {
  return callClaudeLabeler(event);
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
      labeler:        'claude',
      agent_id:       CLAUDE_MODEL,
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

  // APPROVED — seulement keep=true sans flag de review ET pas déjà dans approved
  if (output.keep !== false && !needs_review) {
    const fp = semanticFingerprint(event);
    if (!_approvedFps.has(fp)) {
      appendJsonl(APPROVED_FILE, entry);
      _approvedFps.add(fp);
    } else {
      console.log(`[finetune] ~${event.id} skip approved (fingerprint déjà présent)`);
    }
  }

  return entry;
}

// ── Pipeline principal ────────────────────────────────────────────────────────
async function runFinetuneCollector(directEvents = null) {
  if (_state.running) {
    console.log('[finetune] cycle déjà en cours — skip');
    return;
  }

  _state.running = true;
  _state.lastRun = new Date().toISOString();
  loadApprovedFps(); // charge les fps approved au premier cycle
  console.log(`[finetune] cycle start — labeler: claude model: ${CLAUDE_MODEL}`);

  try {
    // ── STEP 1 — Events (directs si fournis, sinon fetch /events) ───────────
    let events = [];
    if (directEvents) {
      events = directEvents;
      console.log(`[finetune] ${events.length} événements reçus (direct)`);
    } else {
      try {
        let body, attempts = 0;
        while (attempts < 10) {
          const res = await fetch(`${INTERNAL_URL}/events`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          body = await res.json();
          if (body.status !== 'refreshing') break;
          attempts++;
          console.log(`[finetune] /events en cours de refresh — attente 60s (tentative ${attempts}/10)`);
          await sleep(60000);
        }
        if (body.status === 'refreshing') {
          console.warn('[finetune] /events toujours en refresh après 10 tentatives — cycle annulé');
          return;
        }
        events = body.events || body || [];
      } catch (err) {
        console.error('[finetune] Erreur /events:', err.message);
        return;
      }
      console.log(`[finetune] ${events.length} événements reçus`);
    }

    // ── STEP 2 — Filtre qualité ──────────────────────────────────────────────
    const filtered = events.filter(passesFilter);
    console.log(`[finetune] ${filtered.length} après filtre qualité`);

    // ── STEP 3 — Déduplication ───────────────────────────────────────────────
    const seen        = loadSeen();
    expireSeen(); // purge event_ids > 24h et fingerprints > 14j
    const seenIds     = new Set(seen.ids);

    const candidates = filtered.filter(e => {
      if (seenIds.has(e.id))                                  return false;
      if (_memSeen.fpTimestamps.has(semanticFingerprint(e)))  return false;
      return true;
    }).slice(0, MAX_PER_RUN);

    console.log(`[finetune] ${candidates.length} candidats nouveaux (max ${MAX_PER_RUN}/cycle)`);

    // ── STEP 3b — Dedup sémantique AI ───────────────────────────────────────
    const dedupedCandidates = await deduplicateCandidatesWithAI(candidates);
    const finalCandidates = dedupedCandidates;

    if (finalCandidates.length === 0) {
      console.log('[finetune] Aucun événement à labéliser');
      _state.lastRunProcessed = 0;
      // Vérifier quand même l'auto-upload (le seuil peut être atteint sans nouveaux events)
      try {
        const { runFinetuneUpload, AUTO_THRESHOLD } = require('./finetune-uploader');
        const approvedCount = countJsonlLines(APPROVED_FILE);
        if (approvedCount >= AUTO_THRESHOLD) {
          console.log(`[finetune] Seuil ${AUTO_THRESHOLD} atteint (${approvedCount}) — lancement upload automatique`);
          runFinetuneUpload(approvedCount).catch(err =>
            console.error('[finetune-upload] Erreur auto-upload:', err.message)
          );
        }
      } catch (uploadErr) {
        console.error('[finetune] Impossible de charger finetune-uploader:', uploadErr.message);
      }
      return;
    }

    // ── STEP 4 — Labellisation ───────────────────────────────────────────────
    let processed = 0, discards = 0, errors = 0, reviewCount = 0;

    for (let i = 0; i < finalCandidates.length; i += BATCH_SIZE) {
      const batch = finalCandidates.slice(i, i + BATCH_SIZE);
      console.log(`[finetune] Batch ${Math.floor(i / BATCH_SIZE) + 1} — ${batch.length} events`);

      for (const event of batch) {
        try {
          const output = await callLabeler(event);
          const entry  = storeEntry(event, output);

          // Toujours marquer comme vu (keep=true ou keep=false)
          seenIds.add(event.id);

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
    saveSeen(seenIds, finalCandidates.map(e => semanticFingerprint(e)));
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
    labeler:            'claude',
    labeler_model:      CLAUDE_MODEL,
    total_events_seen:  _memSeen.ids.size,
    total_fingerprints: _memSeen.fpTimestamps.size,
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
  if (approvedEntry) {
    appendJsonl(APPROVED_FILE, approvedEntry);
    if (approvedEntry.input) _approvedFps.add(semanticFingerprint(approvedEntry.input));
  }
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
