'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { extractLead, collectLeads, buildArchive, dayStamp, _reset } = require('./archive');

const PAGE = `<html><head><meta charset="utf-8"><meta property="og:description" content="Des frappes ont visé un dépôt près d&#39;Erbil, selon les autorités kurdes.">
<script>var x = "<p>pas ça</p>";</script></head><body><nav><p>Accueil Monde Politique Économie Culture Sport Société Sciences</p></nav>
<article><p>Subscribe to our newsletter to get the latest news every morning in your inbox.</p>
<p>Le ministère de la Défense a confirmé dimanche que deux drones avaient été interceptés au-dessus de la province, sans faire de victime.</p>
<p>Les autorités ont annoncé un renforcement des patrouilles autour des installations militaires de la région pendant plusieurs jours.</p></article></body></html>`;

test('chapeau : description + paragraphes utiles, sans scripts ni bandeaux', () => {
  const t = extractLead(PAGE);
  assert.ok(t.startsWith("Des frappes ont visé un dépôt près d'Erbil"), t);
  assert.ok(t.includes('deux drones avaient été interceptés'));
  assert.ok(!/newsletter|pas ça|Accueil/.test(t), t);
  assert.ok(t.length <= 700);
});

test('chapeau : page sans texte exploitable → vide', () => {
  assert.strictEqual(extractLead('<html><body><p>Court.</p></body></html>'), '');
});

test('collecte : chaque article lu une seule fois, Google News ignoré, archive enrichie', async () => {
  _reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogma-arch-'));
  let calls = 0;
  const fakeFetch = async (url) => { calls++; return new Response(PAGE.replace('Erbil', url.slice(-1)), { headers: { 'content-type': 'text/html; charset=utf-8' } }); };
  const today = [
    { id: 1, title: 'A', url: 'https://ex.org/a', score: 5, country: 'Erbil, Iraq', persons: ['X'], organizations: ['Y'], actor1: 'IRQ' },
    { id: 2, title: 'B', url: 'https://news.google.com/rss/articles/zz', score: 9 },
    { id: 3, title: 'C', url: 'https://ex.org/c', score: 1 },
  ];
  fs.writeFileSync(path.join(dir, `events-${dayStamp(1)}.json`), JSON.stringify({ events: [{ id: 9, title: 'Hier', url: 'https://ex.org/y', score: 3 }] }));
  const r1 = await collectLeads({ cacheDir: dir, todayEvents: today, fetchImpl: fakeFetch });
  assert.strictEqual(r1.ok, 3);           // a, c, et rattrapage d'hier
  assert.strictEqual(calls, 3);
  await collectLeads({ cacheDir: dir, todayEvents: today, fetchImpl: fakeFetch });
  assert.strictEqual(calls, 3, 'pas de second téléchargement');
  const arch = buildArchive({ cacheDir: dir, day: dayStamp(0), todayEvents: today, news: [{ id: 'n1', title: 'N', url: 'u' }] });
  assert.strictEqual(arch.counts.events, 3);
  assert.strictEqual(arch.counts.withLead, 2);
  assert.ok(arch.events[0].lead.includes('près d\'a'));
  assert.deepStrictEqual(arch.events[0].organizations, ['Y']);
  assert.strictEqual(arch.final, false);
  const past = buildArchive({ cacheDir: dir, day: dayStamp(1), todayEvents: today });
  assert.strictEqual(past.final, true);
  assert.strictEqual(past.events[0].title, 'Hier');
  assert.ok(past.events[0].lead);
  assert.ok(fs.existsSync(path.join(dir, 'article-leads.json')));
});
