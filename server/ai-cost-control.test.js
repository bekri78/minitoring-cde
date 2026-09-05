'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createDeepSeekClient, persistentCache } = require('./ai-cost-control');

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
      if (name === './ai-cost-control') return { createDeepSeekClient: () => ({}) };
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
