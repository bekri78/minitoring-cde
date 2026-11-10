'use strict';
/**
 * google-news-decode.js — Retrouve l'adresse réelle d'un article à partir d'un
 * lien Google Actualités (news.google.com/rss/articles/<id>).
 *
 * Google ne redirige plus ces liens par HTTP : il faut lui demander l'adresse.
 *  1. anciens identifiants : l'adresse est encodée directement dans l'id (base64) ;
 *  2. identifiants actuels (« AU_yqL… ») : on lit la signature et l'horodatage
 *     de la page de l'article, puis on interroge le point d'accès « batchexecute »
 *     utilisé par le site Google Actualités lui-même.
 * Méthode non officielle : si Google la change, le lien reste celui de Google
 * (le titre seul reste disponible) et ce module est à adapter.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 10000;

function articleId(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'news.google.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.findIndex(p => p === 'articles' || p === 'read');
    return i !== -1 && parts[i + 1] ? parts[i + 1] : null;
  } catch (_) { return null; }
}

// Ancien format : l'URL est en clair dans les octets décodés
function decodeLegacy(id) {
  try {
    const bytes = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    const m = bytes.match(/https?:\/\/[\x21-\x7e]+/);
    if (!m) return null;
    let url = m[0];
    // Les octets de longueur parasites éventuels en fin de chaîne
    url = url.replace(/[\x00-\x1f\x7f-\xff].*$/, '');
    return /^https?:\/\/[^/]+\.[a-z]{2,}/i.test(url) && !/news\.google\.com/.test(url) ? url : null;
  } catch (_) { return null; }
}

function withTimeout(ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; }

async function decodingParams(id, fetchImpl) {
  for (const base of ['https://news.google.com/articles/', 'https://news.google.com/rss/articles/']) {
    const to = withTimeout(TIMEOUT_MS);
    try {
      const res = await fetchImpl(base + id, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' }, signal: to.signal });
      if (!res.ok) continue;
      const html = await res.text();
      const sg = html.match(/data-n-a-sg="([^"]+)"/);
      const ts = html.match(/data-n-a-ts="([^"]+)"/);
      if (sg && ts) return { signature: sg[1], timestamp: ts[1] };
    } catch (_) { /* essai suivant */ } finally { to.done(); }
  }
  return null;
}

function batchBody(id, timestamp, signature) {
  const inner = '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"'
    + id + '",' + timestamp + ',"' + signature + '"]';
  return 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
}

function parseBatchResponse(text) {
  // Réponse : ")]}'\n\n<json>\n<longueur>..." ; le JSON utile est le 2e bloc
  const block = String(text).split('\n\n')[1];
  if (!block) return null;
  const outer = JSON.parse(block).slice(0, -2);
  const payload = outer && outer[0] && outer[0][2];
  if (!payload) return null;
  const inner = JSON.parse(payload);
  return typeof inner[1] === 'string' && /^https?:\/\//.test(inner[1]) ? inner[1] : null;
}

async function decodeGoogleNewsUrl(url, fetchImpl = fetch) {
  const id = articleId(url);
  if (!id) return null;
  if (!id.startsWith('AU_yqL')) {
    const legacy = decodeLegacy(id);
    if (legacy) return legacy;
  }
  const params = await decodingParams(id, fetchImpl);
  if (!params) return null;
  const to = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetchImpl('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
      body: batchBody(id, params.timestamp, params.signature),
      signal: to.signal,
    });
    if (!res.ok) return null;
    return parseBatchResponse(await res.text());
  } catch (_) {
    return null;
  } finally { to.done(); }
}

module.exports = { decodeGoogleNewsUrl, articleId, decodeLegacy, parseBatchResponse, batchBody };
