'use strict';
// Bascule vers Claude Haiku : même interface « chat.completions » pour les modules existants
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-anth-test-'));
process.env.ANTHROPIC_API_KEY = 'k-test';
delete process.env.AI_PROVIDER;

const sent = [];
let reply = () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 2000 }, content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '{"same":[1]}' }] });
global.fetch = async (url, opts) => { const b = JSON.parse(opts.body); sent.push({ url, headers: opts.headers, body: b });
  const r = reply(b); if (r.__status) return { ok: false, status: r.__status, text: async () => 'refusé' };
  return { ok: true, text: async () => JSON.stringify(r) }; };

const ctrl = require('./ai-cost-control');
const anth = require('./ai-anthropic');

test('fournisseur : Anthropic dès que la clé est présente', () => { assert.equal(ctrl.PROVIDER, 'anthropic'); });

test('doublons et localisation : effort high ; réponse au format chat.completions', async () => {
  sent.length = 0;
  const c = ctrl.createDeepSeekClient(null, 'ignored', 'rss');
  const r = await c.chat.completions.create({ model: 'deepseek-v4-flash', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], ogReasoning: false, response_format: { type: 'json_object' } });
  await c.chat.completions.create({ messages: [{ role: 'user', content: 'U2' }] });
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent[0].headers['x-api-key'], 'k-test');
  assert.equal(sent[0].body.model, 'claude-haiku-5-5');
  assert.equal(sent[0].body.system, 'S');
  assert.deepEqual(sent[0].body.messages, [{ role: 'user', content: 'U' }]);
  assert.equal(sent[0].body.output_config.effort, 'high');
  assert.equal(sent[1].body.output_config.effort, 'high');
  assert.equal('response_format' in sent[0].body, false);
  assert.equal(r.choices[0].message.content, '{"same":[1]}');
  assert.equal(r.usage.prompt_tokens, 1000);
});

test('signaux et filtre/traduction : high', async () => {
  sent.length = 0;
  await ctrl.createDeepSeekClient(null, 'x', 'signals').chat.completions.create({ messages: [{ role: 'user', content: 'a' }], max_tokens: 800 });
  await ctrl.createDeepSeekClient(null, 'x', 'filter-translation').chat.completions.create({ messages: [{ role: 'user', content: 'b' }] });
  assert.deepEqual(sent.map(s => s.body.output_config.effort), ['high', 'high']);
  assert.equal(sent[0].body.max_tokens, 16000);
});

test('réponse tronquée (max_tokens) : erreur 422, rien n\'est mis en cache', async () => {
  reply = () => ({ stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: '{"sa' }] });
  await assert.rejects(ctrl.createDeepSeekClient(null, 'x', 'rss').chat.completions.create({ messages: [] }), { status: 422 });
});

test('réglage refusé (400) : cran inférieur sans perdre la demande', async () => {
  anth._reset(); sent.length = 0;
  reply = b => b.output_config ? { __status: 400 } : { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'ok' }] };
  const r = await ctrl.createDeepSeekClient(null, 'x', 'signals').chat.completions.create({ messages: [{ role: 'user', content: 'a' }] });
  assert.equal(r.choices[0].message.content, 'ok');
  assert.deepEqual(sent.map(s => !!s.body.output_config), [true, false]);
});

test('coût Haiku : 0,10 $ / 0,50 $ par million de jetons', () => {
  assert.ok(Math.abs(anth.costOf({ prompt_tokens: 1e6, completion_tokens: 1e6 }) - 0.6) < 1e-9);
});
