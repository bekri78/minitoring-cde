'use strict';

// Vérifie que les verdicts IA (doublons, doutes) sont mémorisés entre deux cycles.
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const Module = require('module');

process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ogma-ai-cache-'));
process.env.DEEPSEEK_API_KEY = 'test';

const calls = { dedup: 0, doubts: 0 };
const fakeClient = {
  chat: { completions: { create: async ({ messages }) => {
    const sys = messages[0].content;
    let content;
    if (sys.includes('deduplication')) {
      calls.dedup++;
      const n = (messages[1].content.match(/Pair \d+:/g) || []).length;
      content = JSON.stringify(Array.from({ length: n }, (_, i) => ({ pair: i, same: i === 0 })));
    } else {
      calls.doubts++;
      const n = messages[1].content.split('\n').length;
      content = JSON.stringify(Array.from({ length: n }, (_, i) => ({ index: i, location: 'Kyiv', confidence: 70 })));
    }
    return { choices: [{ message: { content } }] };
  } } },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './ai-cost-control') {
    const real = realLoad.apply(this, arguments);
    return { ...real, createDeepSeekClient: () => fakeClient };
  }
  return realLoad.apply(this, arguments);
};
const news = require('./google-news-rss');
Module._load = realLoad;

const items = [
  { title: 'Missile strike hits Kyiv overnight', pubDate: '2026-11-10T08:00:00Z' },
  { title: 'Overnight missile attack on Kyiv',   pubDate: '2026-11-10T07:00:00Z' },
  { title: 'Navy drill in Baltic Sea',           pubDate: '2026-11-10T06:00:00Z' },
];
const pairs = [{ i: 0, j: 1 }, { i: 0, j: 2 }];

test('doublons : 2e cycle sans appel IA, même résultat', async () => {
  const first = await news.detectDuplicatePairsWithAI(items, pairs);
  assert.strictEqual(calls.dedup, 1);
  assert.deepStrictEqual([...first], [1]);           // le plus ancien des deux est écarté
  const second = await news.detectDuplicatePairsWithAI(items, pairs);
  assert.strictEqual(calls.dedup, 1);                 // aucune nouvelle requête
  assert.deepStrictEqual([...second], [1]);
});

test('doutes : seuls les titres nouveaux partent à l\'IA', async () => {
  const r1 = await news.analyzeDoubts(['Titre A', 'Titre B']);
  assert.strictEqual(calls.doubts, 1);
  assert.strictEqual(r1.length, 2);
  const r2 = await news.analyzeDoubts(['Titre B', 'Titre C']);
  assert.strictEqual(calls.doubts, 2);                // un appel, pour Titre C seulement
  const byIndex = Object.fromEntries(r2.map(r => [r.index, r]));
  assert.strictEqual(byIndex[0].location, 'Kyiv');   // Titre B depuis le cache
  assert.strictEqual(byIndex[1].confidence, 70);     // Titre C depuis l'IA
  const r3 = await news.analyzeDoubts(['Titre A', 'Titre C']);
  assert.strictEqual(calls.doubts, 2);                // tout vient du cache
  assert.strictEqual(r3.length, 2);
});
