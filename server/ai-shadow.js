'use strict';
/**
 * ai-shadow.js — Essai comparatif DeepSeek / Claude Haiku, sans effet sur OGMA.
 *
 * Pendant une fenêtre limitée, chaque demande envoyée à DeepSeek est rejouée à
 * l'identique chez Anthropic (Claude Haiku). La réponse de Haiku est jetée :
 * seules sont journalisées ([ai-shadow]) la consommation et la concordance
 * des deux réponses, avec quelques exemples de désaccord.
 *
 * Activation : ANTHROPIC_API_KEY présente et AI_SHADOW différent de « off ».
 * Garde-fous : AI_SHADOW_HOURS (6 h par défaut, comptées depuis le premier appel,
 * conservées sur le volume), AI_SHADOW_MAX_USD (0,30 $), 60 appels par tâche.
 * Pour relancer un essai : changer AI_SHADOW_RUN (ex. « 2 »).
 */

const fs = require('fs');
const path = require('path');

const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_SHADOW_MODEL || 'claude-haiku-5-5';
const HOURS = Number(process.env.AI_SHADOW_HOURS || 6);
const MAX_USD = Number(process.env.AI_SHADOW_MAX_USD || 0.30);
const MAX_PER_TASK = Number(process.env.AI_SHADOW_MAX_PER_TASK || 60);
const RUN = process.env.AI_SHADOW_RUN || '2';   // 2 : relance après correction du raisonnement
const PRICE = { input: 0.10, output: 0.50 };             // $ par million de jetons (Haiku 5.5, < 100 k jetons)
const EFFORT = process.env.AI_SHADOW_EFFORT || 'high';
const MAX_OUT = Number(process.env.AI_SHADOW_MAX_TOKENS || 16000);   // raisonnement + réponse

const stateFile = () => path.join(process.env.CACHE_DIR || '/data', 'ai-shadow.json');
let state = null;
function loadState() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { state = null; }
  if (!state || state.run !== RUN) state = { run: RUN, startedAt: null, usd: 0, calls: {}, stats: {} };
  return state;
}
function saveState() {
  try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(state)); } catch { /* journal seul */ }
}

function active(task) {
  if (!KEY || String(process.env.AI_SHADOW || '').toLowerCase() === 'off') return false;
  const s = loadState();
  if (s.startedAt && Date.now() - s.startedAt > HOURS * 3600000) return false;
  if (s.usd >= MAX_USD) return false;
  return (s.calls[task] || 0) < MAX_PER_TASK;
}

// Haiku 5.5 : raisonnement « adaptive » réglé par output_config.effort
// (thinking.type « enabled » + budget est refusé pour ce modèle). Si l'API
// refuse encore un réglage, on descend d'un cran : adaptive seul, puis aucun.
const MODES = [
  { label: 'adaptive+' + EFFORT, extra: { thinking: { type: 'adaptive' }, output_config: { effort: EFFORT } } },
  { label: 'adaptive', extra: { thinking: { type: 'adaptive' } } },
  { label: 'none', extra: {} },
];
let mode = 0;
async function callAnthropic(messages, maxTokens, fetchImpl = fetch) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const msgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
  for (;;) {
    const body = { model: MODEL, max_tokens: Math.max(MAX_OUT, maxTokens || 0), system, messages: msgs, ...MODES[mode].extra };
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) return { r: JSON.parse(text), thinking: MODES[mode].label };
    if (res.status === 400 && mode < MODES.length - 1) {
      console.warn('[ai-shadow] réglage « ' + MODES[mode].label + ' » refusé, essai suivant :', text.slice(0, 200));
      mode++;
      continue;
    }
    const e = new Error('HTTP ' + res.status + ' ' + text.slice(0, 200)); e.status = res.status; throw e;
  }
}

// ── Lecture des réponses ───────────────────────────────────────────────────
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* suite */ }
  const m = String(text || '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* rien */ } }
  return null;
}
function asArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') { const v = Object.values(parsed).find(Array.isArray); if (v) return v; }
  return null;
}
function dedupSet(text, n) {
  const p = parseJson(text);
  if (!p) return null;
  const list = Array.isArray(p) ? p : Array.isArray(p.same) ? p.same : asArray(p);
  if (!list) return null;
  const out = new Set();
  for (const x of list) {
    if (Number.isInteger(x) && x >= 0 && x < n) out.add(x);
    else if (x && typeof x === 'object' && x.same && Number.isInteger(x.pair) && x.pair < n) out.add(x.pair);
  }
  return out;
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ── Comparaison par type de demande ─────────────────────────────────────────
function compareDedup(user, dsText, hkText) {
  const pairs = [...user.matchAll(/^(\d+): (\d+)-(\d+)$/gm)].map(m => [Number(m[2]), Number(m[3])]);
  const titles = {};
  for (const m of user.matchAll(/^(\d+)\. (.+)$/gm)) titles[m[1]] = m[2];
  const n = pairs.length;
  const a = dedupSet(dsText, n), b = dedupSet(hkText, n);
  if (!a || !b) return { kind: 'doublons', unreadable: !a ? 'deepseek' : 'haiku' };
  const onlyA = [...a].filter(x => !b.has(x)), onlyB = [...b].filter(x => !a.has(x));
  return {
    kind: 'doublons', pairs: n, doublons_deepseek: a.size, doublons_haiku: b.size, agree: n ? Math.round(100 * (n - onlyA.length - onlyB.length) / n) : 100,
    examples: onlyA.slice(0, 2).map(k => ({ seulement: 'deepseek', a: clip(titles[pairs[k][0]], 90), b: clip(titles[pairs[k][1]], 90) }))
      .concat(onlyB.slice(0, 2).map(k => ({ seulement: 'haiku', a: clip(titles[pairs[k][0]], 90), b: clip(titles[pairs[k][1]], 90) }))),
  };
}
function compareDoubts(user, dsText, hkText) {
  const titles = user.split('\n').map(l => l.replace(/^\d+\.\s*/, ''));
  const a = asArray(parseJson(dsText)), b = asArray(parseJson(hkText));
  if (!a || !b) return { kind: 'localisation', unreadable: !a ? 'deepseek' : 'haiku' };
  const byIdx = list => Object.fromEntries(list.filter(x => x && Number.isInteger(x.index)).map(x => [x.index, x]));
  const A = byIdx(a), B = byIdx(b);
  let same = 0; const diff = [];
  titles.forEach((t, i) => {
    const la = norm(A[i] && A[i].location), lb = norm(B[i] && B[i].location);
    if (la === lb || (la && lb && (la.includes(lb) || lb.includes(la)))) same++;
    else diff.push({ titre: clip(t, 90), deepseek: (A[i] && A[i].location) || '—', haiku: (B[i] && B[i].location) || '—' });
  });
  return { kind: 'localisation', titles: titles.length, agree: titles.length ? Math.round(100 * same / titles.length) : 100, examples: diff.slice(0, 3) };
}
function compareText(kind, dsText, hkText) {
  return { kind, texte_deepseek: clip(dsText, 220), texte_haiku: clip(hkText, 220) };
}

async function compare(task, body, dsCompletion, fetchImpl) {
  if (!active(task)) return null;
  const s = loadState();
  if (!s.startedAt) s.startedAt = Date.now();
  s.calls[task] = (s.calls[task] || 0) + 1;
  const messages = body.messages || [];
  const sys = String((messages.find(m => m.role === 'system') || {}).content || '');
  const user = String((messages.filter(m => m.role === 'user').pop() || {}).content || '');
  const dsText = String(dsCompletion.choices?.[0]?.message?.content || '');
  let out;
  try {
    const t0 = Date.now();
    const { r, thinking } = await callAnthropic(messages, body.max_tokens, fetchImpl);
    const hkText = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const u = r.usage || {};
    const cost = ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output) / 1e6;
    s.usd += cost;
    const du = dsCompletion.usage || {};
    const dsCost = (((du.prompt_tokens || 0) - (du.prompt_cache_hit_tokens || 0)) * 0.14 + (du.prompt_cache_hit_tokens || 0) * 0.0028 + (du.completion_tokens || 0) * 0.28) / 1e6;
    const cmp = /deduplication/i.test(sys) ? compareDedup(user, dsText, hkText)
      : /extract ONLY/i.test(sys) ? compareDoubts(user, dsText, hkText)
      : compareText(task, dsText, hkText);
    out = { task, model: r.model || MODEL, thinking, stop: r.stop_reason, ms: Date.now() - t0,
      haiku: { in: u.input_tokens || 0, out: u.output_tokens || 0, usd: Number(cost.toFixed(6)) },
      deepseek: { in: du.prompt_tokens || 0, out: du.completion_tokens || 0, usd: Number(dsCost.toFixed(6)) },
      ...cmp, total_usd: Number(s.usd.toFixed(4)) };
    if (cmp.unreadable) out.debut_reponse = clip(cmp.unreadable === 'haiku' ? hkText : dsText, 200);   // pour comprendre l'échec
    const st = s.stats[cmp.kind] = s.stats[cmp.kind] || { n: 0, agreeSum: 0, hkUsd: 0, dsUsd: 0 };
    st.n++; st.hkUsd += cost; st.dsUsd += dsCost; if (typeof cmp.agree === 'number') st.agreeSum += cmp.agree;
    console.log('[ai-shadow]', JSON.stringify(out));
  } catch (e) {
    out = { task, error: String(e.message || e).slice(0, 200) };
    console.warn('[ai-shadow]', JSON.stringify(out));
  }
  saveState();
  return out;
}

function summary() {
  const s = loadState();
  return { run: s.run, startedAt: s.startedAt, usd: s.usd, calls: s.calls,
    stats: Object.fromEntries(Object.entries(s.stats).map(([k, v]) => [k, { n: v.n, accord_moyen: v.n ? Math.round(v.agreeSum / v.n) : null, haiku_usd: Number(v.hkUsd.toFixed(5)), deepseek_usd: Number(v.dsUsd.toFixed(5)) }])) };
}

module.exports = { compare, summary, active, _reset: () => { state = null; mode = 0; }, compareDedup, compareDoubts };
