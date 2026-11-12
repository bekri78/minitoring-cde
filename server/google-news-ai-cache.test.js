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
      calls.lastDedup = messages[1].content;
      content = JSON.stringify({ same: [0] });
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

test('doublons : format compact, chaque titre envoyé une seule fois', () => {
  const its = [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }];
  const prompt = news.buildDedupPrompt(its, [{ i: 0, j: 1 }, { i: 0, j: 2 }, { i: 1, j: 2 }, { i: 2, j: 3 }]);
  assert.strictEqual(prompt, 'HEADLINES:\n0. A\n1. B\n2. C\n3. D\n\nPAIRS:\n0: 0-1\n1: 0-2\n2: 1-2\n3: 2-3');
});

test('doublons : lecture de la réponse (nouveau et ancien format, valeurs hors bornes ignorées)', () => {
  assert.deepStrictEqual([...news.parseDedupAnswer('{"same":[2,0,9,-1,1.5]}', 4)], [2, 0]);
  assert.deepStrictEqual([...news.parseDedupAnswer('{"same":[]}', 4)], []);
  assert.deepStrictEqual([...news.parseDedupAnswer('[{"pair":1,"same":true},{"pair":2,"same":false}]', 4)], [1]);
  assert.deepStrictEqual([...news.parseDedupAnswer('Voici : {"same":[3]}', 4)], [3]);
  assert.strictEqual(news.parseDedupAnswer('désolé', 4), null);
});

test('doublons : un lot de 200 paires = un seul appel', async () => {
  const its = Array.from({ length: 40 }, (_, k) => ({ title: 'Titre unique numéro ' + k + ' zz', pubDate: '2026-11-10T08:00:00Z' }));
  const ps = [];
  for (let i = 0; i < 40 && ps.length < 200; i++) for (let j = i + 1; j < 40 && ps.length < 200; j++) ps.push({ i, j });
  const before = calls.dedup;
  await news.detectDuplicatePairsWithAI(its, ps);
  assert.strictEqual(calls.dedup - before, 1);
  assert.ok(calls.lastDedup.length < 200 * 57 * 4 / 3, 'prompt compact');
});

test('doutes : traités par lots de 40, chaque verdict revient au bon titre', async () => {
  const before = calls.doubts;
  const titles = Array.from({ length: 90 }, (_, k) => 'Titre lot ' + k);
  const r = await news.analyzeDoubts(titles);
  assert.strictEqual(calls.doubts - before, 3);
  assert.strictEqual(r.length, 90);
  assert.deepStrictEqual(r.map(x => x.index).sort((a, b) => a - b), titles.map((_, k) => k));
});

test('doublons : statistiques par tranche de ressemblance journalisées', async () => {
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const its = [{ title: 'Alpha strike Kyiv night', pubDate: '2026-11-10T08:00:00Z' }, { title: 'Beta strike Kyiv morning', pubDate: '2026-11-10T08:00:00Z' }];
    await news.detectDuplicatePairsWithAI(its, [{ i: 0, j: 1, sim: 0.42 }]);
  } finally { console.log = orig; }
  const line = logs.find(l => l.startsWith('[dedup-stats]'));
  assert.ok(line && line.includes('"0.40"'), line);
});
