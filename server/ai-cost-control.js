'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const shadow = require('./ai-shadow');
const anthropic = require('./ai-anthropic');

// Fournisseur d'IA : Anthropic (Claude Haiku) dès que ANTHROPIC_API_KEY est définie,
// sauf AI_PROVIDER=deepseek. Plus aucune donnée n'est alors envoyée à DeepSeek.
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const PROVIDER = (process.env.AI_PROVIDER || (ANTHROPIC_KEY ? 'anthropic' : 'deepseek')).toLowerCase();
// Effort de raisonnement Haiku par tâche (mesuré lors de l'essai du 11-12/11) :
//  - doublons (lots de 200 paires) : « low » — en « high », ~14 000 jetons de réflexion par lot ;
//  - localisation : « high » (petits lots, peu coûteux) ; signaux : « medium » ; filtre/traduction : « low ».
const ANTHROPIC_EFFORT_BY_TASK = Object.fromEntries(String(process.env.ANTHROPIC_EFFORT_BY_TASK
  ?? 'rss:high,rss-dedup:low,signals:medium,filter-translation:low').split(',').map(x => x.split(':').map(y => y.trim())).filter(x => x[0] && x[1]));

// ── Raisonnement DeepSeek, sous plafond budgétaire ───────────────────────
// Le raisonnement (« thinking ») améliore la qualité mais ses jetons sont
// facturés comme des jetons reçus. Il est activé pour les tâches listées dans
// AI_REASONING_TASKS tant que la dépense IA du jour (toutes tâches, jour UTC)
// reste sous AI_DAILY_BUDGET_USD ; au-delà, retour au mode sans raisonnement
// jusqu'au lendemain. Plafond 0,13 $/jour : une fois atteint, les appels
// restants du jour (sans raisonnement, ~0,07 $ au plus) portent le pire cas à
// ~0,20 $/jour ≈ 6 $ ≈ 5 €/mois.
const PRICE = {                                   // $ par million de jetons (DeepSeek V4 Flash)
  input:  Number(process.env.AI_PRICE_INPUT  || 0.14),
  cached: Number(process.env.AI_PRICE_CACHED || 0.0028),
  output: Number(process.env.AI_PRICE_OUTPUT || 0.28),
};
const REASONING_TASKS  = String(process.env.AI_REASONING_TASKS ?? 'rss,signals,filter-translation').split(',').map(s => s.trim()).filter(Boolean);
// Effort par tâche : « max » là où la qualité compte le plus (résumés des signaux,
// localisation des articles), « high » pour le filtre/traduction (gros volumes).
const REASONING_EFFORT_BY_TASK = Object.fromEntries(String(process.env.AI_REASONING_EFFORT_BY_TASK
  ?? 'rss:max,signals:max,filter-translation:high').split(',').map(x => x.split(':').map(y => y.trim())).filter(x => x[0] && x[1]));
const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || 'high';   // tâche non listée ci-dessus
const effortFor = task => REASONING_EFFORT_BY_TASK[task] || REASONING_EFFORT;
const DAILY_BUDGET_USD = Number(process.env.AI_DAILY_BUDGET_USD || (PROVIDER === 'anthropic' ? 0.15 : 0.13));
const REASONING_EXTRA_TOKENS = 8000;              // place réservée au raisonnement en plus de la réponse

const spend = { day: '', usd: 0, loaded: false };
const spendFile = () => path.join(process.env.CACHE_DIR || '/data', 'ai-spend.json');
const utcDay = () => new Date().toISOString().slice(0, 10);
function loadSpend() {
  if (spend.loaded) return;
  spend.loaded = true;
  try { Object.assign(spend, JSON.parse(fs.readFileSync(spendFile(), 'utf8')), { loaded: true }); } catch { /* premier démarrage */ }
}
function todaySpend() {
  loadSpend();
  if (spend.day !== utcDay()) { spend.day = utcDay(); spend.usd = 0; }
  return spend.usd;
}
function costOf(usage) {
  const prompt = usage.prompt_tokens || 0;
  const hit = usage.prompt_cache_hit_tokens || 0;
  return ((prompt - hit) * PRICE.input + hit * PRICE.cached + (usage.completion_tokens || 0) * PRICE.output) / 1e6;
}
function addSpend(usd) {
  todaySpend();
  spend.usd += usd;
  try {
    fs.mkdirSync(path.dirname(spendFile()), { recursive: true });
    fs.writeFileSync(spendFile(), JSON.stringify({ day: spend.day, usd: spend.usd }));
  } catch { /* le plafond reste appliqué en mémoire */ }
}
let reasoningUnsupported = false;                 // l'API a refusé le paramètre : on n'insiste plus

function logUsage(task, completion, thinking) {
  const usage = completion.usage || {};
  console.log('[ai-usage]', JSON.stringify({ task, model: completion.model,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    cache_hit_tokens: usage.prompt_cache_hit_tokens || 0,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0,
    thinking: !!thinking,
    cost_usd: Number(costOf(usage).toFixed(6)),
    day_usd: Number(todaySpend().toFixed(4)) }));
}

// Client Anthropic présenté comme un client « chat.completions »
function createAnthropicClient(task) {
  return { chat: { completions: { create: async (rawBody, options) => {
    const { ogReasoning, ...body } = rawBody || {};
    const key = ogReasoning === false ? task + '-dedup' : task;
    // Au-delà du budget du jour : effort minimal (Haiku sans raisonnement écrit ses
    // explications dans la réponse et devient plus long, donc pas moins cher)
    const effort = todaySpend() < DAILY_BUDGET_USD ? (ANTHROPIC_EFFORT_BY_TASK[key] || ANTHROPIC_EFFORT_BY_TASK[task] || 'low') : 'low';
    const { raw, reasoning } = await anthropic.messages(ANTHROPIC_KEY, body.messages || [], {
      effort, maxTokens: body.max_tokens, timeoutMs: Math.max(options?.timeout || 0, 120000) });
    const completion = anthropic.toCompletion(raw);
    const usd = anthropic.costOf(completion.usage);
    addSpend(usd);
    console.log('[ai-usage]', JSON.stringify({ task: key, provider: 'anthropic', model: completion.model,
      prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens,
      reasoning, cost_usd: Number(usd.toFixed(6)), day_usd: Number(todaySpend().toFixed(4)) }));
    if (completion.choices[0].finish_reason === 'length') {
      const error = new Error('AI output truncated; refusing to cache partial output');
      error.status = 422;
      throw error;
    }
    return completion;
  } } } };
}

function createDeepSeekClient(OpenAI, apiKey, task) {
  if (PROVIDER === 'anthropic') return createAnthropicClient(task);
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1', maxRetries: 0 });
  const create = client.chat.completions.create.bind(client.chat.completions);
  const call = async (body, options, thinking) => {
    const request = thinking
      ? { ...body, max_tokens: (body.max_tokens || 4000) + REASONING_EXTRA_TOKENS,
          thinking: { type: 'enabled' }, reasoning_effort: effortFor(task) }
      : { max_tokens: 12000, ...body, thinking: { type: 'disabled' } };
    const completion = await create(request, options);
    addSpend(costOf(completion.usage || {}));
    logUsage(task, completion, thinking);
    return completion;
  };
  client.chat.completions.create = async (rawBody, options) => {
    // ogReasoning: false → cet appel précis reste sans raisonnement (ex. lots de 200 paires de doublons,
    // où le raisonnement s'emballe jusqu'à la limite de jetons sans produire de réponse)
    const { ogReasoning, ...body } = rawBody || {};
    const thinking = ogReasoning !== false && REASONING_TASKS.includes(task) && !reasoningUnsupported && todaySpend() < DAILY_BUDGET_USD;
    let completion;
    try {
      completion = await call(body, options, thinking);
    } catch (err) {
      if (!thinking || (err.status !== 400 && err.status !== 422)) throw err;
      reasoningUnsupported = true;
      console.warn('[ai-usage] raisonnement refusé par l\'API (' + err.status + '), retour au mode sans raisonnement :', String(err.message).slice(0, 120));
      completion = await call(body, options, false);
    }
    const choice = completion.choices?.[0];
    // Raisonnement trop long ou réponse vide : on refait la demande sans raisonnement
    if (thinking && (choice?.finish_reason === 'length' || !String(choice?.message?.content || '').trim())) {
      console.warn('[ai-usage] réponse avec raisonnement inexploitable (' + (choice?.finish_reason || 'vide') + '), nouvel essai sans');
      completion = await call(body, options, false);
    }
    if (completion.choices?.[0]?.finish_reason === 'length') {
      const error = new Error('AI output truncated; refusing to cache partial output');
      error.status = 422;
      throw error;
    }
    // Essai comparatif : la même demande rejouée chez Claude Haiku, réponse jetée (ai-shadow.js)
    if (PROVIDER !== 'anthropic' && shadow.active(task)) shadow.compare(task, body, completion).catch(() => {});
    return completion;
  };
  return client;
}

function cacheKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Small, bounded cache on the same persistent volume as the event feeds.
function persistentCache(name, { directory = process.env.CACHE_DIR || '/data', ttl = 7 * 86400000, max = 10000 } = {}) {
  const file = path.join(directory, `${name}.json`);
  let entries = new Map();
  try {
    entries = new Map(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[ai-cache] load failed:', name, err.message);
  }
  let timer;
  function prune() {
    for (const [key, entry] of entries) {
      if (!entry || entry.expires <= Date.now()) entries.delete(key);
    }
    while (entries.size > max) entries.delete(entries.keys().next().value);
  }
  function flush() {
    clearTimeout(timer);
    timer = null;
    prune();
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify([...entries]));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) { console.warn('[ai-cache] save failed:', name, err.message); }
  }
  prune();
  return {
    has(key) {
      const entry = entries.get(key);
      if (entry && entry.expires > Date.now()) return true;
      entries.delete(key);
      return false;
    },
    get(key) { return this.has(key) ? entries.get(key).value : undefined; },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expires: Date.now() + ttl });
      prune();
      if (!timer) { timer = setTimeout(flush, 500); timer.unref(); }
    },
    flush,
  };
}

module.exports = { PROVIDER, createDeepSeekClient, logUsage, persistentCache, cacheKey, costOf, _spend: { todaySpend, addSpend, reset: () => { spend.day = utcDay(); spend.usd = 0; reasoningUnsupported = false; } } };
