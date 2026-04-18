'use strict';

/**
 * finetune-uploader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Convertit finetune-approved.jsonl au format OpenAI, l'uploade et lance
 * un job de fine-tuning automatiquement.
 *
 * Format OpenAI attendu (une ligne par exemple) :
 * {"messages": [
 *   {"role": "system",    "content": "..."},
 *   {"role": "user",      "content": "..."},
 *   {"role": "assistant", "content": "..."}
 * ]}
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR       = process.env.FINETUNE_DATA_DIR || '/data';
const APPROVED_FILE  = path.join(DATA_DIR, 'finetune-approved.jsonl');
const EXPORT_FILE    = path.join(DATA_DIR, 'finetune-openai-export.jsonl');
const STATUS_FILE    = path.join(DATA_DIR, 'finetune-job-status.json');

const OPENAI_API_KEY = () => (process.env.OPENAI_API_KEY || '').trim().replace(/^=+/, '');

// gpt-4o-mini-2024-07-18 = ID exact requis par l'API fine-tuning OpenAI (l'alias gpt-4o-mini est refusé)
const BASE_MODEL     = process.env.FINETUNE_BASE_MODEL || 'gpt-4o-mini-2024-07-18';
const AUTO_THRESHOLD = parseInt(process.env.FINETUNE_AUTO_THRESHOLD || '200', 10);

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

// ── Conversion vers format OpenAI fine-tuning ─────────────────────────────────
function convertToOpenAIFormat(entries) {
  const examples = [];

  for (const entry of entries) {
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
function exportForOpenAI() {
  const entries  = readAllJsonl(APPROVED_FILE);
  if (entries.length === 0) throw new Error('Aucune entrée approuvée à exporter');

  const examples = convertToOpenAIFormat(entries);
  const content  = examples.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(EXPORT_FILE, content, 'utf8');

  console.log(`[finetune-upload] Export : ${examples.length} exemples → ${EXPORT_FILE}`);
  return { count: examples.length, filePath: EXPORT_FILE };
}

// ── Upload vers OpenAI Files API ──────────────────────────────────────────────
async function uploadToOpenAI(filePath) {
  const key = OPENAI_API_KEY();
  if (!key) throw new Error('OPENAI_API_KEY non définie');

  const fileContent = fs.readFileSync(filePath);
  const fileName    = path.basename(filePath);

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

  const res = await fetch('https://api.openai.com/v1/files', {
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
    throw new Error(`Upload OpenAI HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  console.log(`[finetune-upload] Fichier uploadé → file_id: ${data.id}`);
  return data.id;
}

// ── Créer le job de fine-tuning ───────────────────────────────────────────────
async function createFinetuneJob(fileId) {
  const key = OPENAI_API_KEY();
  if (!key) throw new Error('OPENAI_API_KEY non définie');

  const res = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:         BASE_MODEL,
      training_file: fileId,
      suffix:        'osint-classifier',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Création job OpenAI HTTP ${res.status}: ${err.slice(0, 300)}`);
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
  const key = OPENAI_API_KEY();
  if (!key) throw new Error('OPENAI_API_KEY non définie');

  const res = await fetch(`https://api.openai.com/v1/fine_tuning/jobs/${jobId}`, {
    headers: { 'Authorization': `Bearer ${key}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Check job OpenAI HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const job = await res.json();

  const current = loadJobStatus() || {};
  saveJobStatus({ ...current, ...job, checked_at: new Date().toISOString() });

  return job;
}

// ── Polling automatique jusqu'à succeeded/failed ──────────────────────────────
async function pollJobUntilComplete(jobId) {
  const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 min
  const MAX_POLLS = 36; // 6h max

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const job = await checkJobStatus(jobId);
      console.log(`[finetune-poll] job ${jobId} → ${job.status}${job.fine_tuned_model ? ` | model: ${job.fine_tuned_model}` : ''}`);
      if (job.status === 'succeeded') {
        console.log(`[finetune-poll] ✅ Fine-tuning terminé — modèle actif: ${job.fine_tuned_model}`);
        return;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        console.warn(`[finetune-poll] ❌ Job ${job.status}: ${JSON.stringify(job.error || {})}`);
        return;
      }
    } catch (err) {
      console.warn(`[finetune-poll] erreur check job: ${err.message}`);
    }
  }
  console.warn(`[finetune-poll] timeout après ${MAX_POLLS} polls — vérifier manuellement`);
}

// ── Pipeline complet : export → upload → job ──────────────────────────────────
async function runFinetuneUpload(approvedCount) {
  const status = loadJobStatus();

  // Ne pas relancer si un job est déjà en cours
  if (status?.status && ['running', 'queued', 'validating_files'].includes(status.status)) {
    console.log(`[finetune-upload] Job déjà en cours (${status.id} - ${status.status}) — skip`);
    return { skipped: true, reason: 'job_already_running', job_id: status.id };
  }

  // Ne pas relancer si la dernière tentative a échoué il y a moins de 2h
  if (status?.status === 'error' && status.failed_at) {
    const elapsed = Date.now() - new Date(status.failed_at).getTime();
    if (elapsed < 2 * 60 * 60 * 1000) {
      console.log(`[finetune-upload] Dernière erreur il y a ${Math.round(elapsed / 60000)}min — skip (cooldown 2h)`);
      return { skipped: true, reason: 'error_cooldown', last_error: status.error };
    }
  }

  console.log(`[finetune-upload] Démarrage pipeline upload (${approvedCount} exemples approuvés)`);

  // 1. Export
  const { count, filePath } = exportForOpenAI();

  // 2. Upload
  let fileId;
  try {
    fileId = await uploadToOpenAI(filePath);
  } catch (err) {
    saveJobStatus({ status: 'error', error: err.message, failed_at: new Date().toISOString() });
    throw err;
  }

  // 3. Créer job
  let job;
  try {
    job = await createFinetuneJob(fileId, count);
  } catch (err) {
    saveJobStatus({ status: 'error', error: err.message, failed_at: new Date().toISOString(), training_file_id: fileId });
    throw err;
  }

  // 4. Sauvegarder
  saveJobStatus({
    ...job,
    approved_count:   count,
    launched_at:      new Date().toISOString(),
    export_file:      filePath,
    training_file_id: fileId,
  });

  // 5. Polling en background — met à jour le status file automatiquement
  pollJobUntilComplete(job.id).catch(err => console.warn('[finetune-poll] fatal:', err.message));

  return {
    ok:       true,
    job_id:   job.id,
    status:   job.status,
    model:    job.fine_tuned_model || 'pending',
    examples: count,
    file_id:  fileId,
  };
}

module.exports = {
  runFinetuneUpload,
  checkJobStatus,
  loadJobStatus,
  exportForOpenAI,
  AUTO_THRESHOLD,
};
