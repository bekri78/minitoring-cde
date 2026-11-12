'use strict';
/**
 * ai-anthropic.js — Appel à l'API Messages d'Anthropic (Claude Haiku), présenté
 * au reste du serveur sous la même forme qu'une réponse « chat.completions »
 * (choices[0].message.content, finish_reason, usage.prompt_tokens…), pour que
 * les modules existants (doublons, localisation, filtre/traduction, signaux)
 * n'aient rien à changer.
 *
 * Raisonnement : Haiku 5.5 n'accepte que thinking.type « adaptive », réglé par
 * output_config.effort (low / medium / high). Si l'API refuse un réglage, on
 * descend d'un cran (adaptive seul, puis sans) et on s'y tient.
 */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const PRICE = { input: 0.10, output: 0.50 };      // $ par million de jetons (Haiku 5.5, requêtes < 100 k jetons)
const MAX_OUT = Number(process.env.ANTHROPIC_MAX_TOKENS || 16000);

let level = 0;                                     // 0 : adaptive + effort ; 1 : adaptive ; 2 : sans
function reasoningParams(effort) {
  if (!effort || level >= 2) return {};
  if (level === 1) return { thinking: { type: 'adaptive' } };
  return { thinking: { type: 'adaptive' }, output_config: { effort } };
}

async function messages(apiKey, chatMessages, { effort, maxTokens, model = MODEL, timeoutMs = 120000, fetchImpl = fetch } = {}) {
  const system = chatMessages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const msgs = chatMessages.filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
  for (;;) {
    const body = { model, max_tokens: Math.max(MAX_OUT, maxTokens || 0), system, messages: msgs, ...reasoningParams(effort) };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, text;
    try {
      res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      text = await res.text();
    } finally { clearTimeout(timer); }
    if (res.ok) {
      const r = JSON.parse(text);
      return { raw: r, reasoning: effort ? ['adaptive+' + effort, 'adaptive', 'none'][Math.min(level, 2)] : 'none' };
    }
    if (res.status === 400 && effort && level < 2) {
      console.warn('[ai-anthropic] réglage de raisonnement refusé, cran inférieur :', text.slice(0, 200));
      level++;
      continue;
    }
    const e = new Error('Anthropic HTTP ' + res.status + ' ' + text.slice(0, 200));
    e.status = res.status;
    throw e;
  }
}

// Réponse Anthropic → forme « chat.completions »
function toCompletion(r) {
  const u = r.usage || {};
  const content = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return {
    model: r.model || MODEL,
    choices: [{ message: { role: 'assistant', content }, finish_reason: r.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
    usage: { prompt_tokens: u.input_tokens || 0, completion_tokens: u.output_tokens || 0, prompt_cache_hit_tokens: u.cache_read_input_tokens || 0 },
  };
}

function costOf(usage) {
  return ((usage.prompt_tokens || 0) * PRICE.input + (usage.completion_tokens || 0) * PRICE.output) / 1e6;
}

module.exports = { messages, toCompletion, costOf, MODEL, PRICE, _reset: () => { level = 0; } };
