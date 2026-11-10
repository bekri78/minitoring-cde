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
  calls = 0;
  await collectLeads({ cacheDir: dir, todayEvents: today, news: [{ id: 'n1', title: 'N', url: 'https://agence.fr/n1', confidence: 80 }], fetchImpl: fakeFetch });
  const arch = buildArchive({ cacheDir: dir, day: dayStamp(0), todayEvents: today, news: [{ id: 'n1', title: 'N', url: 'https://agence.fr/n1' }] });
  assert.strictEqual(arch.counts.newsWithLead, 1, 'actualité avec chapeau');
  // les actualités du jour restent dans l'archive même quand le cache Google les a oubliées
  const later = buildArchive({ cacheDir: dir, day: dayStamp(0), todayEvents: today, news: [{ id: 'n2', title: 'N2', url: 'x' }] });
  assert.deepStrictEqual(later.news.map(n => n.id).sort(), ['n1', 'n2']);
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

const { decodeLegacy, parseBatchResponse, articleId, decodeGoogleNewsUrl, batchBody } = require('./google-news-decode');

test('Google Actualités : identifiant ancien format décodé sans appel réseau', async () => {
  const real = 'https://www.lemonde.fr/international/article/2026/11/10/iran.html';
  const id = Buffer.concat([Buffer.from([0x08, 0x13, 0x22, real.length]), Buffer.from(real), Buffer.from([0xd2, 0x01, 0x00])]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(articleId('https://news.google.com/rss/articles/' + id + '?oc=5'), id);
  assert.strictEqual(decodeLegacy(id), real);
  let net = 0;
  assert.strictEqual(await decodeGoogleNewsUrl('https://news.google.com/rss/articles/' + id, async () => { net++; }), real);
  assert.strictEqual(net, 0);
});

test('Google Actualités : identifiant actuel via signature + batchexecute', async () => {
  const id = 'AU_yqLxyz123';
  const seen = [];
  const fakeFetch = async (url, opts = {}) => {
    seen.push(url);
    if (url.includes('/articles/')) return new Response('<c-wiz><div jscontroller="x" data-n-a-sg="SIG42" data-n-a-ts="1731234567"></div></c-wiz>');
    const b = decodeURIComponent(opts.body); if (!(b.includes(id) && b.includes('1731234567') && b.includes('SIG42') && b.includes('garturlreq'))) return new Response('', { status: 400 });
    const inner = JSON.stringify(['garturlres', 'https://www.reuters.com/world/iran-x/', 1]);
    return new Response(")]}'\n\n" + JSON.stringify([['wrb.fr', 'Fbv4je', inner, null, null, null, 'generic'], ['di', 42], ['af.httprm', 41, '-1', 3]]) + '\n\n25\n[["e",4,null,null,1]]');
  };
  assert.strictEqual(await decodeGoogleNewsUrl('https://news.google.com/rss/articles/' + id + '?oc=5', fakeFetch), 'https://www.reuters.com/world/iran-x/');
  assert.ok(seen[1].includes('batchexecute'));
});

test('Google Actualités : échec propre si Google change de format', async () => {
  const r = await decodeGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLabc', async () => new Response('<html>rien</html>'));
  assert.strictEqual(r, null);
  assert.strictEqual(await decodeGoogleNewsUrl('https://example.org/a'), null);
});
