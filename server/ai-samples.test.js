'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-samples-'));
const samples = require('./ai-samples');

test('réservoir : au plus 20 doublons gardés, compteur exact, tirage sur toute la journée', () => {
  samples._reset();
  let k = 0; const rnd = () => ((k++ * 7919) % 1000) / 1000;
  for (let i = 0; i < 500; i++) samples.record('doublons', { a: 'A' + i, b: 'B' + i, sim: 0.3, verdict: i % 2 === 0 }, rnd);
  const s = samples.get();
  assert.equal(s.seen.doublons, 500);
  assert.equal(s.items.doublons.length, 20);
  assert.ok(s.items.doublons.some(x => Number(x.a.slice(1)) >= 20), 'des décisions tardives sont aussi tirées');
});

test('page de contrôle : tableaux lisibles, texte échappé', () => {
  samples._reset();
  samples.record('localisation', { titre: '<script>x</script> Frappe à Ispahan', lieu: 'Isfahan, Iran', confiance: 80 });
  const h = samples.html(samples.get());
  assert.ok(h.includes('Isfahan, Iran') && h.includes('Localisation — 1 titres'));
  assert.ok(!h.includes('<script>x'));
});

test('persistance sur disque', () => {
  samples._reset();
  samples.record('doublons', { a: 'x', b: 'y', sim: 0.5, verdict: true });
  samples.flush();
  samples._reset();
  assert.equal(samples.get().items.doublons.length, 1);
});
