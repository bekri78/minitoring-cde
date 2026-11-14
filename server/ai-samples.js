'use strict';
/**
 * ai-samples.js — Échantillon quotidien des décisions de l'IA, pour contrôle humain.
 *
 * Chaque jour (UTC), un tirage aléatoire uniforme (« réservoir ») garde
 * 20 décisions de doublons et 15 localisations parmi toutes celles prises
 * dans la journée. Consultation : GET /api/admin/ai-samples?key=…[&date=AAAA-MM-JJ]
 * (page lisible ; &format=json pour les données brutes). 7 jours conservés.
 */

const fs = require('fs');
const path = require('path');

const CAP = { doublons: 20, localisation: 15 };
const KEEP_DAYS = 7;
const dir = () => process.env.CACHE_DIR || '/data';
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const fileOf = day => path.join(dir(), 'ai-samples-' + day + '.json');

let current = null;   // { day, seen: {kind: n}, items: {kind: [...]}, model }
let timer = null;

function load(day) {
  if (current && current.day === day) return current;
  if (current) flush();
  try { current = JSON.parse(fs.readFileSync(fileOf(day), 'utf8')); } catch { current = null; }
  if (!current || current.day !== day) current = { day, seen: {}, items: {} };
  return current;
}

function flush() {
  if (!current) return;
  clearTimeout(timer); timer = null;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(fileOf(current.day), JSON.stringify(current));
  } catch (e) { console.warn('[ai-samples] écriture impossible :', e.message); }
}

function prune() {
  try {
    const limit = utcDay(new Date(Date.now() - KEEP_DAYS * 86400000));
    for (const f of fs.readdirSync(dir())) {
      const m = /^ai-samples-(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
      if (m && m[1] < limit) fs.unlinkSync(path.join(dir(), f));
    }
  } catch { /* rien */ }
}

// Tirage « réservoir » : chaque décision de la journée a la même chance d'être gardée
function record(kind, item, rnd = Math.random) {
  const cap = CAP[kind];
  if (!cap) return;
  const s = load(utcDay());
  const n = (s.seen[kind] = (s.seen[kind] || 0) + 1);
  const list = (s.items[kind] = s.items[kind] || []);
  const entry = { ...item, at: new Date().toISOString() };
  if (list.length < cap) list.push(entry);
  else { const j = Math.floor(rnd() * n); if (j < cap) list[j] = entry; }
  if (process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_API_KEY) s.model = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
  if (!timer) { timer = setTimeout(() => { flush(); prune(); }, 2000); if (timer.unref) timer.unref(); }
}

function get(day = utcDay()) {
  if (current && current.day === day) return current;
  try { return JSON.parse(fs.readFileSync(fileOf(day), 'utf8')); } catch { return { day, seen: {}, items: {} }; }
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(s) {
  const d = s.items.doublons || [], l = s.items.localisation || [];
  const rows1 = d.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(x.a) + '</td><td>' + esc(x.b) + '</td><td class="n">' + Math.round((x.sim || 0) * 100) + ' %</td>'
    + '<td><b class="' + (x.verdict ? 'y' : 'n2') + '">' + (x.verdict ? 'Même événement' : 'Différent') + '</b></td><td class="chk">☐ juste ☐ faux</td></tr>').join('');
  const rows2 = l.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(x.titre) + '</td><td><b>' + esc(x.lieu || '—') + '</b></td><td class="n">' + esc(x.confiance ?? '—') + '</td><td class="chk">☐ juste ☐ faux</td></tr>').join('');
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OGMA AI — contrôle qualité ' + esc(s.day) + '</title>'
    + '<style>body{margin:0;background:#08090a;color:#c9ccd3;font:14px/1.5 "Segoe UI",system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:32px 20px}'
    + 'h1{color:#f2f2f4;font-size:22px;font-weight:600;margin:0 0 4px}h2{color:#f2f2f4;font-size:16px;font-weight:600;margin:32px 0 8px}p{color:#8a8f98;margin:0 0 12px}'
    + 'table{width:100%;border-collapse:collapse;background:#111113;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden}th,td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(255,255,255,.06)}'
    + 'th{color:#8a8f98;font-weight:500;font-size:12px}.n{white-space:nowrap;color:#8a8f98}.y{color:#f2994a}.n2{color:#7fd1a8}.chk{white-space:nowrap;color:#62666d}b{font-weight:500}</style></head><body><main>'
    + '<h1>OGMA AI — contrôle qualité du ' + esc(s.day) + '</h1>'
    + '<p>Tirage aléatoire parmi les décisions de la journée (UTC)' + (s.model ? ' · modèle ' + esc(s.model) : '') + '. Cochez sur une copie imprimée, ou notez simplement les numéros faux.</p>'
    + '<h2>Doublons — ' + d.length + ' paires sur ' + (s.seen.doublons || 0) + ' jugées</h2><p>« Même événement » : l’un des deux articles est retiré de la carte.</p>'
    + '<table><thead><tr><th>#</th><th>Titre A</th><th>Titre B</th><th>Ressemblance</th><th>Décision IA</th><th>Contrôle</th></tr></thead><tbody>' + (rows1 || '<tr><td colspan="6">Aucune décision aujourd’hui.</td></tr>') + '</tbody></table>'
    + '<h2>Localisation — ' + l.length + ' titres sur ' + (s.seen.localisation || 0) + ' analysés</h2><p>Lieu attribué par l’IA aux articles sans lieu évident.</p>'
    + '<table><thead><tr><th>#</th><th>Titre</th><th>Lieu attribué</th><th>Confiance</th><th>Contrôle</th></tr></thead><tbody>' + (rows2 || '<tr><td colspan="5">Aucune décision aujourd’hui.</td></tr>') + '</tbody></table>'
    + '</main></body></html>';
}

module.exports = { record, get, html, flush, _reset: () => { current = null; clearTimeout(timer); timer = null; } };
