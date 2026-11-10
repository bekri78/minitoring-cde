'use strict';
/**
 * archive.js — Matière pour l'analyste OGMA, sans coût d'IA.
 *
 * 1. Chapeaux d'articles : pour chaque événement retenu, le serveur ouvre
 *    l'article une seule fois et garde sa description et ses premiers
 *    paragraphes (≈ 700 caractères). Cache disque gardé 35 jours.
 * 2. Archive quotidienne : les événements d'une journée (fichier
 *    events-AAAAMMJJ.json déjà tenu par le serveur) enrichis des chapeaux,
 *    acteurs et organisations. Servie par /api/public/sharepoint/archive,
 *    déposée chaque jour dans OgmaCache par le relais, gardée 30 jours.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const LEAD_MAX         = 700;
const LEAD_TTL_DAYS    = 35;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES        = 1_500_000;
const PER_RUN          = Number(process.env.ARCHIVE_LEADS_PER_RUN || 120);
const CONCURRENCY      = 6;
const BACKFILL_DAYS    = 7;
const UA = 'Mozilla/5.0 (compatible; OGMA-veille/1.0; lecture du chapeau d\'article)';

let leads = null;            // url -> { t: texte|null, at: ms, s: 'ok'|'vide'|'erreur' }
let leadsPath = null;
let dirty = false;
let running = false;

// ── Cache disque ─────────────────────────────────────────────────────────
function loadLeads(cacheDir) {
  if (leads) return leads;
  leadsPath = path.join(cacheDir, 'article-leads.json');
  try { leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8')); } catch (_) { leads = {}; }
  const limit = Date.now() - LEAD_TTL_DAYS * 86400e3;
  for (const [u, v] of Object.entries(leads)) if (!v || v.at < limit) delete leads[u];
  return leads;
}

function saveLeads() {
  if (!dirty || !leadsPath) return;
  try {
    fs.writeFileSync(leadsPath + '.tmp', JSON.stringify(leads));
    fs.renameSync(leadsPath + '.tmp', leadsPath);
    dirty = false;
  } catch (e) { console.warn('[archive] écriture du cache des chapeaux impossible :', e.message); }
}

// ── Extraction du chapeau ────────────────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch (_) { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (_) { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const clean = s => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Phrases d'interface à ignorer (cookies, abonnement, partage…)
const BOILER = /cookie|subscribe|sign up|newsletter|javascript|all rights reserved|copyright|advertis|click here|read more|abonnez|connectez|inscrivez|partager|share this|follow us|getty images|reuters\/|ap photo|photo:|image:/i;

function extractLead(html) {
  html = String(html || '');
  const meta = (name) => {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*>', 'i');
    const tag = html.match(re);
    if (!tag) return '';
    const c = tag[0].match(/content=["']([^"']*)["']/i);
    return c ? clean(c[1]) : '';
  };
  const desc = meta('og:description') || meta('description') || meta('twitter:description');

  let body = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ');
  const art = body.match(/<article[\s\S]*?<\/article>/i);
  if (art) body = art[0];
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(body)) && paras.length < 6) {
    const t = clean(m[1]);
    if (t.length < 60 || BOILER.test(t)) continue;
    if (desc && desc.slice(0, 60) === t.slice(0, 60)) continue;   // pas de doublon avec la description
    paras.push(t);
  }
  let out = desc && desc.length >= 40 ? desc : '';
  for (const p of paras) {
    if (out.length >= LEAD_MAX) break;
    out += (out ? ' ' : '') + p;
  }
  out = out.trim();
  if (out.length > LEAD_MAX) out = out.slice(0, LEAD_MAX - 1).replace(/\s+\S*$/, '') + '…';
  return out.length >= 40 ? out : '';
}

function charsetOf(contentType, head) {
  const m = /charset=([\w-]+)/i.exec(contentType || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head || '');
  const cs = (m && m[1] || 'utf-8').toLowerCase();
  return cs === 'latin1' ? 'iso-8859-1' : cs;
}

async function fetchLead(url, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr,en;q=0.8' }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) return { t: null, s: 'erreur' };
    const type = res.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return { t: null, s: 'vide' };
    // Lecture bornée
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
    try { reader.cancel(); } catch (_) { /* rien */ }
    const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
    let html;
    try { html = new TextDecoder(charsetOf(type, buf.subarray(0, 2048).toString('latin1'))).decode(buf); }
    catch (_) { html = buf.toString('utf8'); }
    const t = extractLead(html);
    return t ? { t, s: 'ok' } : { t: null, s: 'vide' };
  } catch (_) {
    return { t: null, s: 'erreur' };
  } finally {
    clearTimeout(timer);
  }
}

// ── Collecte : événements du jour d'abord, puis rattrapage des 7 jours ───
function dayStamp(offsetDays = 0) {
  return new Date(Date.now() - offsetDays * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
}

function readDay(cacheDir, day) {
  try { return JSON.parse(fs.readFileSync(path.join(cacheDir, `events-${day}.json`), 'utf8')).events || []; }
  catch (_) { return []; }
}

const fetchable = u => typeof u === 'string' && /^https?:\/\//.test(u) && !/news\.google\.com\//.test(u);

async function collectLeads({ cacheDir, todayEvents = [], fetchImpl } = {}) {
  if (running) return { skipped: true };
  running = true;
  const store = loadLeads(cacheDir);
  try {
    const queue = [];
    const seen = new Set();
    const push = (e) => {
      const u = e && e.url;
      if (!fetchable(u) || seen.has(u) || store[u]) return;
      seen.add(u); queue.push(u);
    };
    [...todayEvents].sort((a, b) => (b.score || 0) - (a.score || 0)).forEach(push);
    for (let d = 1; d <= BACKFILL_DAYS && queue.length < PER_RUN; d++) {
      readDay(cacheDir, dayStamp(d)).sort((a, b) => (b.score || 0) - (a.score || 0)).forEach(push);
    }
    const batch = queue.slice(0, PER_RUN);
    let ok = 0, empty = 0, err = 0, i = 0;
    async function worker() {
      while (i < batch.length) {
        const url = batch[i++];
        const r = await fetchLead(url, fetchImpl);
        store[url] = { t: r.t, s: r.s, at: Date.now() };
        dirty = true;
        if (r.s === 'ok') ok++; else if (r.s === 'vide') empty++; else err++;
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
    saveLeads();
    if (batch.length) console.log(`[archive] chapeaux : ${ok} lus, ${empty} sans texte, ${err} inaccessibles (${queue.length - batch.length} en attente)`);
    return { ok, empty, err, pending: queue.length - batch.length };
  } finally {
    running = false;
  }
}

function leadOf(url) { const v = leads && url && leads[url]; return v && v.t ? v.t : null; }

// ── Archive d'une journée ────────────────────────────────────────────────
const top = (arr, n) => (Array.isArray(arr) ? arr : []).filter(Boolean).slice(0, n);

function slimForArchive(e) {
  return {
    id: e.id, title: e.titleFr || e.title, url: e.url, domain: e.domain,
    country: e.country, countryCode: e.countryCode, lat: e.lat, lon: e.lon,
    category: e.category, date: e.date, score: e.score, tone: e.tone,
    actors: [e.actor1, e.actor2].filter(Boolean),
    persons: top(e.persons, 4), organizations: top(e.organizations, 4),
    lead: leadOf(e.url),
  };
}

function buildArchive({ cacheDir, day, todayEvents, news = [] }) {
  loadLeads(cacheDir);
  const isToday = day === dayStamp(0);
  const events = (isToday && todayEvents && todayEvents.length ? todayEvents : readDay(cacheDir, day)).map(slimForArchive);
  const withLead = events.filter(e => e.lead).length;
  return {
    type: 'ogma-archive', schemaVersion: 1,
    date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
    generatedAt: new Date().toISOString(),
    final: !isToday,
    counts: { events: events.length, withLead, news: isToday ? news.length : 0 },
    events,
    news: isToday ? news.map(n => ({
      id: n.id, title: n.title, url: n.url, source: n.source, label: n.label,
      location: n.location, country: n.country, lat: n.lat, lon: n.lon, date: n.publishedAt || n.date,
    })) : [],
  };
}

// Route : ?date=AAAAMMJJ (30 derniers jours), ?etag= → 304, gzip
function createArchiveHandler({ cacheDir, todayEvents, news }) {
  return (req, res) => {
    const day = String(req.query.date || dayStamp(0)).replace(/-/g, '');
    if (!/^\d{8}$/.test(day)) return res.status(400).json({ error: 'date attendue : AAAAMMJJ' });
    const age = (Date.now() - Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`)) / 86400e3;
    if (!(age >= -1 && age <= 31)) return res.status(404).json({ error: 'archive limitée aux 30 derniers jours' });
    const archive = buildArchive({ cacheDir, day, todayEvents: todayEvents(), news: news() });
    if (!archive.events.length) return res.status(404).json({ error: 'aucun événement pour ce jour' });
    const json = JSON.stringify(archive);
    const etag = crypto.createHash('sha256').update(json.replace(/"generatedAt":"[^"]*"/, '')).digest('hex').slice(0, 16);
    if (req.query.etag && req.query.etag === etag) return res.status(304).end();
    const body = Buffer.from(JSON.stringify({ ...archive, etag }));
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/json; charset=utf-8');
    if (/gzip/.test(req.get('accept-encoding') || '')) {
      res.set('Content-Encoding', 'gzip');
      return res.end(zlib.gzipSync(body));
    }
    res.end(body);
  };
}

module.exports = { extractLead, fetchLead, collectLeads, buildArchive, createArchiveHandler, loadLeads, dayStamp, _reset: () => { leads = null; dirty = false; } };
