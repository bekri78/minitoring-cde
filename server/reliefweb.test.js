'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reliefweb-'));
const rw = require('./reliefweb');

// Éléments au format documenté de l'API v2 (data[].id + data[].fields)
const dis = (id, iso3, name, status, extra = {}) => ({ id, fields: { name, status, glide: 'FL-2026-0001-' + iso3,
  primary_country: [{ iso3: iso3.toLowerCase(), name: name.split(':')[0], shortname: name.split(':')[0] }],
  primary_type: [{ name: 'Flood' }], date: { event: '2026-11-10T00:00:00+00:00', created: '2026-11-10T08:00:00+00:00' },
  url_alias: 'https://reliefweb.int/disaster/' + id, ...extra } });
const rep = (id, iso3, country, date, extra = {}) => ({ id, fields: { title: 'Situation report ' + id,
  primary_country: { iso3, name: country, shortname: country }, source: [{ name: 'UN Office for the Coordination of Humanitarian Affairs', shortname: 'OCHA' }],
  format: [{ name: 'Situation Report' }], date: { created: date, original: date }, url: 'https://reliefweb.int/node/' + id, ...extra } });

test('normalisation : crise et rapport (pays principal, type, statut, source courte, lien)', () => {
  const d = rw._disasterOf(dis(1, 'SDN', 'Sudan: Floods - Nov 2026', 'alert'));
  assert.equal(d.iso3, 'SDN'); assert.equal(d.item.type, 'Flood'); assert.equal(d.item.status, 'alert');
  assert.equal(d.item.url, 'https://reliefweb.int/disaster/1'); assert.equal(d.item.date, '2026-11-10T00:00:00+00:00');
  const r = rw._reportOf(rep(9, 'SDN', 'Sudan', '2026-11-14T10:00:00+00:00'));
  assert.equal(r.item.source, 'OCHA'); assert.equal(r.item.format, 'Situation Report'); assert.ok(r.item.url.endsWith('/9'));
  assert.equal(rw._reportOf({ id: 5, fields: { title: 'sans pays' } }), null, 'sans pays principal : écarté');
});

test('regroupement par pays : alerte d’abord, 5 rapports au plus, les plus récents', () => {
  const reports = Array.from({ length: 7 }, (_, i) => rw._reportOf(rep(100 + i, 'SDN', 'Sudan', `2026-11-1${i}T00:00:00+00:00`)));
  const out = rw._groupByCountry(
    [rw._disasterOf(dis(1, 'HTI', 'Haiti: Cholera', 'current')), rw._disasterOf(dis(2, 'SDN', 'Sudan: Conflict', 'alert'))],
    [...reports, rw._reportOf(rep(200, 'UKR', 'Ukraine', '2026-11-14T00:00:00+00:00'))]);
  assert.deepEqual(out.map(c => c.iso3), ['SDN', 'HTI', 'UKR']);
  const sdn = out[0];
  assert.equal(sdn.alert, true); assert.equal(sdn.reportCount, 7); assert.equal(sdn.reports.length, 5);
  assert.equal(sdn.reports[0].id, 'rw-r-106', 'le plus récent en premier');
  assert.equal(out[2].disasters.length, 0, 'pays présent par ses seuls rapports');
});

test('récupération : appname dans l’URL, 2 appels POST ; appname refusé → cache conservé', async () => {
  rw._reset();
  assert.equal((await rw.fetchReliefWeb(async () => { throw new Error('ne doit pas appeler'); }, '')).status, 'no-appname');
  const calls = [];
  const ok = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const data = url.includes('/disasters') ? [dis(1, 'SDN', 'Sudan: Floods', 'alert')] : [rep(9, 'SDN', 'Sudan', '2026-11-14T10:00:00+00:00')];
    return { ok: true, status: 200, json: async () => ({ totalCount: 1, count: 1, data }) };
  };
  const c = await rw.fetchReliefWeb(ok, 'ogma-test', new Date('2026-11-15T12:00:00Z'));
  assert.equal(c.status, 'ok'); assert.equal(c.countries.length, 1); assert.equal(c.countries[0].reports.length, 1);
  assert.equal(calls.length, 2); assert.ok(calls.every(x => x.url.includes('appname=ogma-test')));
  const rq = calls.find(x => x.url.includes('/reports')).body;
  assert.equal(rq.filter.conditions[0].value.from, '2026-11-12T12:00:00+00:00', 'fenêtre de 72 h');
  const ko = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const c2 = await rw.fetchReliefWeb(ko, 'mauvais-appname');
  assert.equal(c2.status, 'stale'); assert.equal(c2.countries.length, 1);
});

test('résumé : liens réduits au texte, référence de source retirée, longueur bornée', () => {
  const { _summaryOf } = require('./reliefweb');
  const s = _summaryOf('Heavy rains hit [Gammo Zone](https://x.org) on 10 March 2026. ' + 'Many households were displaced. '.repeat(30) + '([ECHO, 13 Mar 2026](https://reliefweb.int/node/1))');
  assert.ok(s.startsWith('Heavy rains hit Gammo Zone on 10 March 2026.'), s);
  assert.ok(s.length <= 500 && !s.includes('http') && !s.includes('ECHO'), s);
  assert.equal(_summaryOf(''), '');
});

test('crises actives : alerte, début < 6 mois ou fiche mise à jour < 90 jours', () => {
  const { _isActive } = require('./reliefweb');
  const now = Date.parse('2026-11-16T00:00:00Z');
  assert.equal(_isActive({ status: 'alert', date: '2015-01-01', updated: '2016-01-01' }, now), true);
  assert.equal(_isActive({ status: 'ongoing', date: '2026-07-01', updated: null }, now), true);           // début < 6 mois
  assert.equal(_isActive({ status: 'ongoing', date: '2013-01-01', updated: '2026-10-20' }, now), true);   // ancienne mais suivie
  assert.equal(_isActive({ status: 'ongoing', date: '2015-06-09', updated: '2025-12-01' }, now), false);  // dormante
  assert.equal(_isActive({ status: 'ongoing', date: null, updated: null }, now), false);
});
