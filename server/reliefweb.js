'use strict';
/**
 * reliefweb.js — Crises humanitaires en cours et derniers rapports (ReliefWeb, ONU/OCHA).
 *
 * API v2 (https://apidoc.reliefweb.int) : chaque requête exige un « appname » approuvé par
 * ReliefWeb (formulaire sur apidoc.reliefweb.int/parameters#appname), lu dans la variable
 * RELIEFWEB_APPNAME. Sans elle, le module reste inactif (statut « no-appname »).
 *
 * Usage limité par les conditions ReliefWeb (pas de redistribution ni d'œuvre dérivée) :
 * on ne garde que des métadonnées — nom de la crise, titre, date, source, lien vers
 * ReliefWeb — et le début de la description des crises, jamais le texte des rapports.
 * Données retirées de la vitrine publique.
 *
 *   1. Crises (« disasters ») au statut alert ou current, regroupées par pays principal.
 *      Seules les crises actives sont gardées : en alerte, OU commencées il y a moins de
 *      6 mois, OU dont la fiche ReliefWeb a été mise à jour depuis moins de 90 jours.
 *      (Sur 91 crises « en cours » le 16/11/2026, 39 avaient commencé il y a plus d'un an
 *      et 44 fiches n'avaient pas bougé depuis 6 mois.)
 *   2. Rapports des 72 dernières heures (rapports de situation, flash updates, évaluations),
 *      rattachés au pays principal : 5 au plus par pays, les plus récents.
 *
 * Limites ReliefWeb : 1000 éléments par appel, 10 000 appels par jour (on en fait 2 / 2 h).
 */

const fs   = require('fs');
const path = require('path');

const API        = 'https://api.reliefweb.int/v2';
const CACHE_DIR  = process.env.CACHE_DIR || '/data';
const CACHE_FILE = path.join(CACHE_DIR, 'reliefweb.json');
const REPORT_HOURS   = 72;
const REPORTS_PER_COUNTRY = 5;
const REPORT_FORMATS = ['Situation Report', 'Flash Update', 'Assessment', 'Analysis'];
const RECENT_START_DAYS  = 183;   // crise commencée depuis moins de 6 mois
const RECENT_UPDATE_DAYS = 90;    // fiche mise à jour depuis moins de 90 jours

let cache = { countries: [], lastUpdate: null, status: 'initializing' };
let isFetching = false;

async function post(fetchImpl, resource, body, appname) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetchImpl(`${API}/${resource}?appname=${encodeURIComponent(appname)}`, {
      method: 'POST',
      // Pas de User-Agent personnalisé : « OGMA/1.0 (veille OSINT) » est bloqué par le pare-feu (406) ;
      // l'appname suffit à identifier l'application.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 403) throw new Error('appname refusé par ReliefWeb (403) : vérifier RELIEFWEB_APPNAME');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return Array.isArray(j.data) ? j.data : [];
  } finally { clearTimeout(t); }
}

const first = v => (Array.isArray(v) ? v[0] : v) || {};

// Résumé d'une crise : début de la description ReliefWeb (texte brut, ~2-3 phrases, 500 caractères max).
// Liens Markdown réduits à leur texte, références « (ECHO, 13 Mar 2026) » retirées.
const SUMMARY_MAX = 500;
function summaryOf(text) {
  let s = String(text || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // [texte](lien) → texte
    .replace(/\(\s*[A-Z][^()]{0,60}\d{4}\s*\)/g, '')     // (ECHO, 13 Mar 2026)
    .replace(/[*_#>`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= SUMMARY_MAX) return s;
  const parts = s.match(/[^.!?]+[.!?]+(\s|$)/g) || [s];
  let out = '';
  for (const p of parts) {
    if ((out + p).length > SUMMARY_MAX) break;
    out += p;
    if (out.length >= 280) break;
  }
  return (out || s.slice(0, SUMMARY_MAX - 1) + '…').trim();
}

function disasterOf(item) {
  const f = item.fields || {};
  const pc = first(f.primary_country);
  if (!pc.iso3) return null;
  return {
    iso3: String(pc.iso3).toUpperCase(),
    country: pc.shortname || pc.name || '',
    item: {
      id: 'rw-d-' + item.id,
      name: f.name || '',
      type: first(f.primary_type).name || first(f.type).name || '',
      status: f.status || '',
      glide: f.glide || '',
      summary: summaryOf(f.description),
      date: (f.date && (f.date.event || f.date.created)) || null,
      updated: (f.date && f.date.changed) || null,
      url: f.url_alias || f.url || ('https://reliefweb.int/node/' + item.id),
    },
  };
}

function reportOf(item) {
  const f = item.fields || {};
  const pc = first(f.primary_country);
  if (!pc.iso3) return null;
  const src = first(f.source);
  return {
    iso3: String(pc.iso3).toUpperCase(),
    country: pc.shortname || pc.name || '',
    item: {
      id: 'rw-r-' + item.id,
      title: String(f.title || '').slice(0, 220),
      date: (f.date && (f.date.original || f.date.created)) || null,
      source: src.shortname || src.name || '',
      format: first(f.format).name || '',
      url: f.url_alias || f.url || ('https://reliefweb.int/node/' + item.id),
    },
  };
}

// Regroupe crises et rapports par pays ; un pays apparaît s'il a au moins une crise en cours
// ou un rapport récent. Tri : crises en alerte d'abord, puis nombre de rapports.
/** Crise encore active : en alerte, récente, ou fiche récemment mise à jour. */
function isActive(item, now = Date.now()) {
  if (!item) return false;
  if (item.status === 'alert') return true;
  const ageDays = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (now - t) / 86400000 : Infinity; };
  return ageDays(item.date) < RECENT_START_DAYS || ageDays(item.updated) < RECENT_UPDATE_DAYS;
}

function groupByCountry(disasters, reports) {
  const by = new Map();
  const get = (iso3, country) => {
    if (!by.has(iso3)) by.set(iso3, { iso3, country, disasters: [], reports: [], reportCount: 0 });
    const c = by.get(iso3);
    if (!c.country && country) c.country = country;
    return c;
  };
  for (const d of disasters) if (d) get(d.iso3, d.country).disasters.push(d.item);
  for (const r of reports) if (r) { const c = get(r.iso3, r.country); c.reportCount++; c.reports.push(r.item); }
  const out = [];
  for (const c of by.values()) {
    c.reports.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    c.reports = c.reports.slice(0, REPORTS_PER_COUNTRY);
    c.disasters.sort((a, b) => (a.status === 'alert' ? -1 : 0) - (b.status === 'alert' ? -1 : 0) || String(b.date || '').localeCompare(String(a.date || '')));
    c.alert = c.disasters.some(d => d.status === 'alert');
    out.push(c);
  }
  return out.sort((a, b) => (b.alert - a.alert) || (b.disasters.length - a.disasters.length) || (b.reportCount - a.reportCount));
}

function saveToDisk() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }
  catch (err) { console.warn('[reliefweb] save failed:', err.message); }
}
try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  if (raw && raw.lastUpdate && Array.isArray(raw.countries)) cache = { ...raw, status: 'cached' };
} catch (_) {}

async function fetchReliefWeb(fetchImpl = fetch, appname = process.env.RELIEFWEB_APPNAME, now = new Date()) {
  if (!appname) { cache = { ...cache, status: 'no-appname' }; return cache; }
  if (isFetching) return cache;
  isFetching = true;
  try {
    const since = new Date(now.getTime() - REPORT_HOURS * 3600000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const [dis, rep] = await Promise.all([
      post(fetchImpl, 'disasters', {
        profile: 'list', limit: 300, sort: ['date.created:desc'],
        filter: { field: 'status', value: ['alert', 'current'], operator: 'OR' },
        fields: { include: ['primary_country.iso3', 'primary_country.name', 'primary_country.shortname', 'primary_type.name', 'date.event', 'date.created', 'date.changed', 'url_alias', 'description'] },
      }, appname),
      post(fetchImpl, 'reports', {
        profile: 'list', limit: 1000, sort: ['date.created:desc'],
        filter: { operator: 'AND', conditions: [
          { field: 'date.created', value: { from: since } },
          { field: 'format.name', value: REPORT_FORMATS, operator: 'OR' },
        ] },
        fields: { include: ['primary_country.iso3', 'primary_country.shortname', 'source.shortname', 'format.name', 'date.original', 'url_alias'] },
      }, appname),
    ]);
    const active = dis.map(disasterOf).filter(d => d && isActive(d.item, now.getTime()));
    const countries = groupByCountry(active, rep.map(reportOf));
    cache = { countries, lastUpdate: new Date().toISOString(), status: 'ok' };
    saveToDisk();
    console.log(`[reliefweb] ${countries.length} pays · ${active.length} crises actives sur ${dis.length} en cours (${countries.filter(c => c.alert).length} pays en alerte) · ${rep.length} rapports sur ${REPORT_HOURS} h`);
  } catch (err) {
    console.warn('[reliefweb] fetch failed:', err.message);
    cache = { ...cache, status: cache.countries.length ? 'stale' : 'error' };
  } finally { isFetching = false; }
  return cache;
}

function getCache() { return cache; }

module.exports = { fetchReliefWeb, getCache, _groupByCountry: groupByCountry, _disasterOf: disasterOf, _reportOf: reportOf, _summaryOf: summaryOf, _isActive: isActive,
  _reset: () => { cache = { countries: [], lastUpdate: null, status: 'initializing' }; } };
