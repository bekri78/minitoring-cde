'use strict';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.chatgpt;
const OPENAI_MODEL   = 'gpt-4o-mini';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Appel Groq pour un batch d'événements ────────────────────────────────
const SYSTEM_PROMPT = `You are a strict intelligence analyst filtering news events for a geopolitical security monitoring dashboard.

Your task: classify each event as KEEP or REJECT based on direct operational relevance to national security and geopolitical intelligence.

KEEP events ONLY if they involve:
- Military operations, deployments, exercises, strikes, airstrikes, bombardments, frontline movements
- Armed conflicts, combat, clashes between armed groups
- Terrorism, counterterrorism, IED attacks, suicide bombings, mass hostage situations, beheadings
- Coups, attempted coups, seizure of power, armed uprisings, mutinies
- Cyberattacks, electronic warfare, sabotage of critical infrastructure (power grid, pipelines, government systems)
- Interstate border tensions, military standoffs, naval incidents, coercive state actions
- Sanctions with direct security or military implications (arms embargo, asset freeze on military entities)
- Nuclear weapons, ballistic missiles, WMD, hypersonic weapons, space defense activities
- Major geopolitical crises: state of emergency, martial law, diplomatic ruptures with military escalation
- Attacks on critical infrastructure (dams, ports, refineries, hospitals in war zones)

REJECT events that involve:
- Local or street crime (shootings, stabbings, robberies, carjacking, domestic violence, gang activity)
- Individual accidents (traffic, aviation, industrial, construction, workplace)
- Natural disasters, unless they trigger a military response or major political instability
- Court cases, trials, legal verdicts, indictments, sentencing, bail hearings
- Business, economy, markets, company earnings, trade deals, IPOs (unless a direct security sanction)
- Culture, arts, sports, entertainment, celebrity news
- Generic political speeches, press conferences, elections, routine diplomacy
- Opinion pieces, editorials, analysis articles, retrospectives, anniversaries
- Health, lifestyle, science discoveries, technology without security relevance
- Human interest stories, community events, social issues

STRICT RULE: When in doubt → REJECT. Only keep events an intelligence officer on watch duty would actively monitor. False positives are worse than false negatives. A relevance below 65 should mean keep=false.`;

async function enrichBatch(events, attempt = 0) {
  const userContent = `Classify these events. Return ONLY a valid JSON array, no markdown, no explanation.

Events:
${events.map(e => `{"id":"${e.id}","title":"${e.title}","country":"${e.country}"}`).join('\n')}

Required output format for each event:
{"id":"...","keep":true/false,"relevance":0-100,"title_fr":"titre français ≤12 mots","location":"Ville, Pays","category":"military|conflict|terrorism|protest|cyber|strategic|crisis|critical_incident|discard"}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let resp;
  try {
    resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userContent }
        ],
        temperature: 0,
        max_tokens: 5000
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (resp.status === 429) {
    if (attempt < 2) {
      const wait = (attempt + 1) * 10000; // 10s, 20s max
      console.warn(`[enrich] 429 rate limit — retry in ${wait/1000}s (attempt ${attempt+1}/2)`);
      await sleep(wait);
      return enrichBatch(events, attempt + 1);
    }
    // Quota épuisé — signaler via exception pour court-circuiter les batches restants
    throw new Error('QUOTA_EXHAUSTED');
  }

  if (!resp.ok) throw new Error(`HTTP_${resp.status}`);

  const data  = await resp.json();
  const text  = data.choices?.[0]?.message?.content || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('NO_JSON');

  const results = JSON.parse(match[0]);
  const byId    = Object.fromEntries(results.map(r => [r.id, r]));

  const RELEVANCE_THRESHOLD = 65;

  return events
    .filter(e => {
      const r = byId[e.id];
      // Strict opt-in: must be explicitly kept AND meet relevance threshold
      return r && r.keep === true && (r.relevance || 0) >= RELEVANCE_THRESHOLD;
    })
    .map(e => {
      const r = byId[e.id];
      return {
        ...e,
        title:     r.title_fr  || e.title,
        country:   r.location  || e.country,
        category:  r.category  || e.category,
        relevance: r.relevance || 0
      };
    });
}

// ── Enrichissement complet par batches de 20 ─────────────────────────────
async function enrichEvents(events) {
  console.log(`[enrich] API key present: ${!!OPENAI_API_KEY}`);
  if (!OPENAI_API_KEY || !events.length) return events;

  const BATCH_SIZE = 20;
  const enriched   = [];
  let kept = 0, rejected = 0, batchesDone = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    console.log(`[enrich] batch ${Math.floor(i/BATCH_SIZE)+1} — calling OpenAI...`);
    try {
      const result = await enrichBatch(batch);
      enriched.push(...result);
      kept     += result.length;
      rejected += batch.length - result.length;
      batchesDone++;
    } catch (err) {
      if (err.message === 'QUOTA_EXHAUSTED') {
        console.warn(`[enrich] quota épuisé après ${batchesDone} batches — abandon des batches restants`);
        // Ne pas injecter les événements bruts non filtrés dans le cache
        rejected += events.slice(i).length;
        break;
      }
      console.warn(`[enrich] batch ${batchesDone + 1} failed: ${err.message} — dropping (no raw passthrough)`);
      rejected += batch.length;
    }

    if (i + BATCH_SIZE < events.length) {
      await sleep(1000); // OpenAI a des rate limits bien plus généreux
    }
  }

  console.log(`[enrich] done — kept: ${kept} / rejected: ${rejected} / total: ${events.length}`);
  return enriched;
}

module.exports = { enrichEvents };
