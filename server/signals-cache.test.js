'use strict';
// Résumés de signaux : une zone aux titres inchangés n'est pas resoumise à l'IA
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-cache-'));
process.env.ANTHROPIC_API_KEY = 'k';
let calls = 0;
global.fetch = async () => { calls++; return { ok: true, text: async () => JSON.stringify({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
  content: [{ type: 'text', text: '{"location_name":"Kyiv","summary":"S","key_points":[{"point":"P","category":"conflict"}]}' }] }) }; };
const signals = require('./signals');

test('même zone, mêmes titres : résumé réutilisé, aucun nouvel appel', async () => {
  const ev = Array.from({ length: 6 }, (_, i) => ({ title: 'Strike ' + i, lat: 50.4, lon: 30.5, country: 'Ukraine', score: 5 }));
  const built = await signals._buildSignals(ev);
  const n = calls;
  assert.ok(n >= 1 && built.length >= 1);
  const again = await signals._buildSignals(ev);
  assert.equal(calls, n);
  assert.equal(again[0].summary, 'S');
});
