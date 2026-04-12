'use strict';

/**
 * finetune-uploader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Convertit finetune-approved.jsonl au format Mistral, l'uploade et lance
 * un job de fine-tuning automatiquement.
 *
 * Format Mistral attendu (une ligne par exemple) :
 * {"messages": [
 *   {"role": "system",    "content": "..."},
 *   {"role": "user",      "content": "..."},
 *   {"role": "assistant", "content": "..."}
 * ]}
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR       = path.join(__dirname, 'data');
const APPROVED_FILE  = path.join(DATA_DIR, 'finetune-approved.jsonl');
const EXPORT_FILE    = path.join(DATA_DIR, 'finetune-mistral-export.jsonl');
const STATUS_FILE    = path.join(DATA_DIR, 'finetune-job-status.json');

const MISTRAL_API_KEY = () => (process.env.MISTRAL_API_KEY || '').trim().replace(/^=+/, '');

// Modèle de base à fine-tuner (mistral-small = rapport qualité/coût optimal)
const BASE_MODEL = process.env.FINETUNE_BASE_MODEL || 'open-mistral-7b';
const AUTO_THRESHOLD = parseInt(process.env.FINETUNE_AUTO_THRESHOLD || '200', 10);

// Prompt système reproduit pour le fine-tuning (doit correspondre à celui de l'agent)
const SYSTEM_PROMPT = `You are a military and geopolitical OSINT classifier.
Given a raw event (JSON), you must return a JSON object with:
- keep (boolean): true if the event is relevant for OSINT monitoring, false otherwise
- domain_primary (string): one of air, land, maritime, space, cyber, strategic
- event_type (string): short label (e.g. "artillery_strike", "naval_maneuver")
- operational_relevance (integer 0-100): tactical/operational significance
- strategic_relevance (integer 0-100): strategic/geopolitical significance

Return only a valid JSON object. No explanation, no markdown.`;

// ── Lecture JSONL ─────────────────────────────────────────────────────────────
function readAllJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// ── Conversion vers format Mistral fine-tuning ────────────────────────────────
function convertToMistralFormat(entries) {
  const examples = [];

  for (const entry of entries) {
    // Reconstituer le message user (même format que buildPrompt dans collector)
    const userContent = JSON.stringify({
      title:     entry.input?.title,
      country:   entry.input?.country || entry.input?.countryCode || 'unknown',
      category:  entry.input?.category,
      actor1:    entry.input?.actor1  || 'unknown',
      actor2:    entry.input?.actor2  || 'none',
      score:     entry.input?.score,
      severity:  entry.input?.severity  || 'unknown',
      region:    entry.input?.region    || 'unknown',
      notes:     entry.input?.notes     || '',
      eventCode: entry.input?.eventCode || '',
      rootCode:  entry.input?.rootCode  || '',
    });

    // Reconstituer la réponse assistant
    const assistantContent = JSON.stringify({
      keep:                  entry.output?.keep,
      domain_primary:        entry.output?.domain_primary,
      event_type:            entry.output?.event_type,
      operational_relevance: entry.output?.operational_relevance,
      strategic_relevance:   entry.output?.strategic_relevance,
    });

    examples.push({
      messages: [
        { role: 'system',    content: SYSTEM_PROMPT },
        { role: 'user',      content: userContent },
        { role: 'assistant', content: assistantContent },
      ],
    });
  }

  return examples;
}

// ── Export fichier JSONL converti ─────────────────────────────────────────────
function exportForMistral() {
  const entries  = readAllJsonl(APPROVED_FILE);
  if (entries.length === 0) throw new Error('Aucune entrée approuvée à exporter');

  const examples = convertToMistralFormat(entries);
  const content  = examples.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(EXPORT_FILE, content, 'utf8');

  console.log(`[finetune-upload] Export : ${examples.length} exemples → ${EXPORT_FILE}`);
  return { count: examples.length, filePath: EXPORT_FILE };
}

// ── Upload vers Mistral Files API ─────────────────────────────────────────────
async function uploadToMistral(filePath) {
  const key = MISTRAL_API_KEY();
  if (!key) throw new Error('MISTRAL_API_KEY non définie');

  const fileContent = fs.readFileSync(filePath);
  const fileName    = path.basename(filePath);

  // Construire multipart/form-data manuellement (pas de dépendance form-data)
  const boundary = '----FormBoundary' + Date.now().toString(16);
  const CRLF = '\r\n';

  const preamble = Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="purpose"${CRLF}${CRLF}` +
    `fine-tune${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
    `Content-Type: application/octet-stream${CRLF}${CRLF}`
  );
  const epilogue = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body = Buffer.concat([preamble, fileContent, epilogue]);

  const res = await fetch('https://api.mistral.ai/v1/files', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload Mistral HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  console.log(`[finetune-upload] Fichier uploadé → file_id: ${data.id}`);
  return data.id;
}

// ── Créer le job de fine-tuning ───────────────────────────────────────────────
async function createFinetuneJob(fileId, approvedCount) {
  const key = MISTRAL_API_KEY();
  if (!key) throw new Error('MISTRAL_API_KEY non définie');

  const jobName = `world-monitor-osint-${new Date().toISOString().slice(0, 10)}-n${approvedCount}`;

  const res = await fetch('https://api.mistral.ai/v1/fine_tuning/jobs', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:           BASE_MODEL,
      job_type:        'FT',
      training_files:  [{ file_id: fileId, weight: 1 }],
      hyperparameters: {
        training_steps:  null,   // auto (Mistral calcule selon la taille du dataset)
        learning_rate:   0.0001,
      },
      suffix: 'osint-classifier',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Création job Mistral HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const job = await res.json();
  console.log(`[finetune-upload] Job créé → job_id: ${job.id} | status: ${job.status}`);
  return job;
}

// ── Lire / sauvegarder le statut du job ──────────────────────────────────────
function saveJobStatus(status) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}

function loadJobStatus() {
  if (!fs.existsSync(STATUS_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { return null; }
}

// ── Vérifier le statut d'un job en cours ─────────────────────────────────────
async function checkJobStatus(jobId) {
  const key = MISTRAL_API_KEY();
  if (!key) throw new Error('MISTRAL_API_KEY non définie');

  const res = await fetch(`https://api.mistral.ai/v1/fine_tuning/jobs/${jobId}`, {
    headers: { 'Authorization': `Bearer ${key}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Check job Mistral HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const job = await res.json();

  // Sauvegarder le statut mis à jour
  const current = loadJobStatus() || {};
  saveJobStatus({ ...current, ...job, checked_at: new Date().toISOString() });

  return job;
}

// ── Pipeline complet : export → upload → job ──────────────────────────────────
async function runFinetuneUpload(approvedCount) {
  const status = loadJobStatus();

  // Ne pas relancer si un job est déjà en cours
  if (status?.status && ['RUNNING', 'QUEUED'].includes(status.status)) {
    console.log(`[finetune-upload] Job déjà en cours (${status.id} - ${status.status}) — skip`);
    return { skipped: true, reason: 'job_already_running', job_id: status.id };
  }

  console.log(`[finetune-upload] Démarrage pipeline upload (${approvedCount} exemples approuvés)`);

  // 1. Export
  const { count, filePath } = exportForMistral();

  // 2. Upload
  const fileId = await uploadToMistral(filePath);

  // 3. Créer job
  const job = await createFinetuneJob(fileId, count);

  // 4. Sauvegarder
  saveJobStatus({
    ...job,
    approved_count:  count,
    launched_at:     new Date().toISOString(),
    export_file:     filePath,
    training_file_id: fileId,
  });

  return {
    ok:         true,
    job_id:     job.id,
    status:     job.status,
    model:      job.fine_tuned_model || 'pending',
    examples:   count,
    file_id:    fileId,
  };
}

module.exports = {
  runFinetuneUpload,
  checkJobStatus,
  loadJobStatus,
  exportForMistral,
  AUTO_THRESHOLD,
};
