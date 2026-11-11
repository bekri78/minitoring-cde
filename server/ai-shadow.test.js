'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-shadow-test-'));
process.env.ANTHROPIC_API_KEY = 'test-key';
const shadow = require('./ai-shadow');

const dedupUser = 'HEADLINES:\n0. Strike hits Kyiv\n1. Kyiv hit by strike\n2. Navy drill\n\nPAIRS:\n0: 0-1\n1: 0-2\n2: 1-2';
const dedupBody = { messages: [{ role: 'system', content: 'You are an OSINT news deduplication expert.' }, { role: 'user', content: dedupUser }] };
const ds = text => ({ usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [{ message: { content: text } }] });

test('doublons : concordance et exemples de désaccord', () => {
  const r = shadow.compareDedup(dedupUser, '{"same":[0]}', '{"same":[0,2]}');
  assert.equal(r.pairs, 3); assert.equal(r.agree, 67);
  assert.deepEqual(r.examples, [{ seulement: 'haiku', a: 'Kyiv hit by strike', b: 'Navy drill' }]);
});

test('localisation : lieux comparés sans tenir compte des accents ni de la casse', () => {
  const r = shadow.compareDoubts('0. A\n1. B', '[{"index":0,"location":"Kyiv"},{"index":1,"location":"Tehran"}]', '[{"index":0,"location":"kyiv"},{"index":1,"location":"Isfahan"}]');
  assert.equal(r.agree, 50); assert.equal(r.examples[0].haiku, 'Isfahan');
});

test('appel Anthropic : format Messages, système séparé, raisonnement, coût', async () => {
  shadow._reset();
  let sent;
  const fakeFetch = async (url, opts) => { sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, text: async () => JSON.stringify({ model: 'claude-haiku-5-5', usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '{"same":[0]}' }] }) }; };
  const out = await shadow.compare('rss', dedupBody, ds('{"same":[0]}'), fakeFetch);
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'test-key');
  assert.equal(sent.body.system, 'You are an OSINT news deduplication expert.');
  assert.deepEqual(sent.body.messages.map(m => m.role), ['user']);
  assert.equal(sent.body.thinking.type, 'enabled');
  assert.equal(out.agree, 100);
  assert.equal(out.haiku.usd, 0.0002);
});

test('raisonnement refusé (400) : nouvel essai sans, puis plus de tentative', async () => {
  shadow._reset();
  const seen = [];
  const fakeFetch = async (url, opts) => { const b = JSON.parse(opts.body); seen.push(!!b.thinking);
    if (b.thinking) return { ok: false, status: 400, text: async () => 'thinking not supported' };
    return { ok: true, text: async () => JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: '{"same":[]}' }] }) }; };
  await shadow.compare('rss', dedupBody, ds('{"same":[]}'), fakeFetch);
  await shadow.compare('rss', dedupBody, ds('{"same":[]}'), fakeFetch);
  assert.deepEqual(seen, [true, false, false]);
});

test('garde-fou : plus aucun appel une fois le budget de l\'essai atteint', async () => {
  shadow._reset();
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: true, text: async () => JSON.stringify({ usage: { input_tokens: 2000000, output_tokens: 0 }, content: [{ type: 'text', text: '{}' }] }) }; };
  await shadow.compare('signals', { messages: [{ role: 'user', content: 'x' }] }, ds('{}'), fakeFetch);   // 0,20 $
  await shadow.compare('signals', { messages: [{ role: 'user', content: 'x' }] }, ds('{}'), fakeFetch);   // 0,40 $ ≥ 0,30 $
  assert.equal(shadow.active('signals'), false);
  await shadow.compare('signals', { messages: [{ role: 'user', content: 'x' }] }, ds('{}'), fakeFetch);
  assert.equal(calls, 2);
});
