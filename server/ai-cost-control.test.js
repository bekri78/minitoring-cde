'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-spend-test-'));
const { createDeepSeekClient, persistentCache, costOf, _spend } = require('./ai-cost-control');

test('DeepSeek disables reasoning and SDK retries, honors limits and rejects truncation', async () => {
  let config, body;
  let finish = 'stop';
  class MockOpenAI {
    constructor(options) {
      config = options;
      this.chat = { completions: { create: async (request) => {
        body = request;
        return { choices: [{ finish_reason: finish }] };
      } } };
    }
  }
  const client = createDeepSeekClient(MockOpenAI, 'fake', 'test');
  await client.chat.completions.create({ model: 'deepseek-v4-flash', max_tokens: 500 });
  assert.equal(config.maxRetries, 0);
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.max_tokens, 500);
  finish = 'length';
  await assert.rejects(client.chat.completions.create({}), { status: 422 });
});

test('disk cache restores discard results, expires and bounds entries', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cache-test-'));
  const cache = persistentCache('test', { directory, max: 2 });
  cache.set('old', 1);
  cache.set('discard', null);
  cache.set('kept', { fr: 'Titre' });
  cache.flush();
  const restored = persistentCache('test', { directory });
  assert.equal(restored.has('old'), false);
  assert.equal(restored.has('discard'), true);
  assert.equal(restored.get('discard'), null);
  assert.deepEqual(restored.get('kept'), { fr: 'Titre' });
  const expired = persistentCache('expired', { directory, ttl: -1 });
  expired.set('x', 1);
  assert.equal(expired.has('x'), false);
  expired.flush();
});

test('concurrent identical translations share a request and retain caller IDs', async () => {
  let calls = 0;
  const caches = new Map();
  const sandbox = {
    require(name) {
      if (name === 'openai') return class {};
      if (name === './ai-cost-control') return {
        createDeepSeekClient: () => ({ chat: { completions: { create: async () => {
          calls++;
          await new Promise(resolve => setTimeout(resolve, 5));
          return { choices: [{ message: { content: '{"fr":"Titre traduit"}' } }] };
        } } } }),
        persistentCache: name => { const cache = new Map(); caches.set(name, cache); return cache; },
        cacheKey: JSON.stringify,
      };
      throw new Error(name);
    },
    process: { env: { DEEPSEEK_API_KEY: 'fake' } }, console,
    module: { exports: {} }, setTimeout,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'gemini-normalizer.js'), 'utf8'), sandbox);
  const translate = sandbox.module.exports.normalizeTitleWithGemini;
  const results = await Promise.all([translate({ id: 'a', title: 'Headline' }), translate({ id: 'b', title: 'Headline' })]);
  assert.equal(calls, 1);
  assert.equal(results[0].id, 'a');
  assert.equal(results[1].id, 'b');
  await translate({ id: 'c', title: 'Headline' });
  assert.equal(calls, 1);
});

test('fresh signals are reused without a rebuild or disk write', async () => {
  let writes = 0;
  const sandbox = {
    require(name) {
      if (name === 'fs') return {
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ signals: [{ id: 'cached' }], lastUpdate: new Date().toISOString() }),
        writeFileSync: () => writes++,
      };
      if (name === 'path') return path;
      if (name === 'openai') return class {};
      if (name === './ai-cost-control') return { createDeepSeekClient: () => ({}), cacheKey: v => JSON.stringify(v),
        persistentCache: () => ({ get: () => undefined, set: () => {} }) };
      throw new Error(name);
    },
    process: { env: { DEEPSEEK_API_KEY: 'fake' } }, console,
    module: { exports: {} }, setTimeout,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'signals.js'), 'utf8'), sandbox);
  await sandbox.module.exports.refreshSignals([]);
  assert.equal(writes, 0);
  assert.equal(sandbox.module.exports.getSignalsCache().signals[0].id, 'cached');
});

function mockFactory(responder) {
  const bodies = [];
  class MockOpenAI {
    constructor() {
      this.chat = { completions: { create: async (request) => { bodies.push(request); return responder(request, bodies.length); } } };
    }
  }
  return { MockOpenAI, bodies };
}
const ok = (usage, content = '{"same":[]}') => ({ usage, choices: [{ finish_reason: 'stop', message: { content } }] });

test('raisonnement : effort max (rss, signals), high (filtre/traduction), aucun ailleurs', async () => {
  _spend.reset();
  const { MockOpenAI, bodies } = mockFactory(() => ok({ prompt_tokens: 1000, completion_tokens: 500 }));
  await createDeepSeekClient(MockOpenAI, 'k', 'rss').chat.completions.create({ model: 'm' });
  await createDeepSeekClient(MockOpenAI, 'k', 'signals').chat.completions.create({ model: 'm', max_tokens: 800 });
  await createDeepSeekClient(MockOpenAI, 'k', 'filter-translation').chat.completions.create({ model: 'm' });
  await createDeepSeekClient(MockOpenAI, 'k', 'autre').chat.completions.create({ model: 'm' });
  assert.equal(bodies[0].thinking.type, 'enabled');
  assert.equal(bodies[0].reasoning_effort, 'max');     // localisation des articles
  assert.equal(bodies[1].reasoning_effort, 'max');     // résumés des signaux
  assert.equal(bodies[1].max_tokens, 8800);            // place réservée au raisonnement
  assert.equal(bodies[2].thinking.type, 'enabled');    // filtre/traduction
  assert.equal(bodies[2].reasoning_effort, 'high');
  assert.equal(bodies[3].thinking.type, 'disabled');   // tâche non listée
});

test('raisonnement : coupé une fois le budget du jour atteint', async () => {
  _spend.reset();
  _spend.addSpend(0.25);
  const { MockOpenAI, bodies } = mockFactory(() => ok({ prompt_tokens: 10, completion_tokens: 5 }));
  await createDeepSeekClient(MockOpenAI, 'k', 'rss').chat.completions.create({ model: 'm' });
  assert.equal(bodies[0].thinking.type, 'disabled');
});

test('raisonnement : paramètre refusé par l\'API → nouvel essai sans, puis plus de tentative', async () => {
  _spend.reset();
  const { MockOpenAI, bodies } = mockFactory((req) => {
    if (req.thinking.type === 'enabled') { const e = new Error('bad param'); e.status = 400; throw e; }
    return ok({ prompt_tokens: 10, completion_tokens: 5 });
  });
  const c = createDeepSeekClient(MockOpenAI, 'k', 'rss');
  await c.chat.completions.create({ model: 'm' });
  await c.chat.completions.create({ model: 'm' });
  assert.deepEqual(bodies.map(b => b.thinking.type), ['enabled', 'disabled', 'disabled']);
});

test('raisonnement : réponse vide ou tronquée → refaite sans raisonnement', async () => {
  _spend.reset();
  const { MockOpenAI, bodies } = mockFactory((req) => req.thinking.type === 'enabled'
    ? { usage: { prompt_tokens: 10, completion_tokens: 9000 }, choices: [{ finish_reason: 'length', message: { content: '' } }] }
    : ok({ prompt_tokens: 10, completion_tokens: 5 }, '{"same":[1]}'));
  const r = await createDeepSeekClient(MockOpenAI, 'k', 'signals').chat.completions.create({ model: 'm' });
  assert.equal(r.choices[0].message.content, '{"same":[1]}');
  assert.deepEqual(bodies.map(b => b.thinking.type), ['enabled', 'disabled']);
});

test('coût d\'un appel au tarif V4 Flash, cache compris', () => {
  const usd = costOf({ prompt_tokens: 1000000, prompt_cache_hit_tokens: 500000, completion_tokens: 1000000 });
  assert.ok(Math.abs(usd - (0.07 + 0.0014 + 0.28)) < 1e-9);
});

test('raisonnement : désactivable appel par appel (ogReasoning: false), paramètre non transmis', async () => {
  _spend.reset();
  const { MockOpenAI, bodies } = mockFactory(() => ok({ prompt_tokens: 10, completion_tokens: 5 }));
  await createDeepSeekClient(MockOpenAI, 'k', 'rss').chat.completions.create({ model: 'm', ogReasoning: false });
  assert.equal(bodies[0].thinking.type, 'disabled');
  assert.equal('ogReasoning' in bodies[0], false);
});
