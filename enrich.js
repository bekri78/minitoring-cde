'use strict';

const OPENAI_API_KEY = process.env.chatgpt;
const OPENAI_MODEL   = 'gpt-4o-mini';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Appel Groq pour un batch d'événements ────────────────────────────────
async function enrichBatch(events, attempt = 0) {
  const prompt = `You are an intelligence analyst assistant. For each event below, return a JSON array with one object per event containing:
- "id": the original event id
- "keep": true/false — keep only if genuinely relevant for military/security/intelligence monitoring (reject: civil crime, accidents, natural disasters, court cases, business news)
- "title_fr": a concise French title (max 12 words) describing what happened
- "location": the real place where the event occurred (city, country) — infer from the title text, ignore the provided country if it seems wrong
- "category": one of: military, conflict, terrorism, protest, threat, crisis, incident

Events:
${events.map(e => `{"id":"${e.id}","title":"${e.title}","country":"${e.country}","category":"${e.category}"}`).join('\n')}

Return ONLY a valid JSON array, no explanation.`;

  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4000
    })
  });

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

  return events
    .filter(e => byId[e.id]?.keep !== false)
    .map(e => {
      const r = byId[e.id];
      if (!r) return e;
      return {
        ...e,
        title:    r.title_fr || e.title,
        country:  r.location  || e.country,
        category: r.category  || e.category
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
    try {
      const result = await enrichBatch(batch);
      enriched.push(...result);
      kept     += result.length;
      rejected += batch.length - result.length;
      batchesDone++;
    } catch (err) {
      if (err.message === 'QUOTA_EXHAUSTED') {
        console.warn(`[enrich] quota épuisé après ${batchesDone} batches — abandon des batches restants`);
        // Garder les événements restants sans enrichissement
        enriched.push(...events.slice(i));
        break;
      }
      console.warn(`[enrich] batch ${batchesDone + 1} failed: ${err.message} — keeping raw`);
      enriched.push(...batch);
    }

    if (i + BATCH_SIZE < events.length) {
      await sleep(1000); // OpenAI a des rate limits bien plus généreux
    }
  }

  console.log(`[enrich] done — kept: ${kept} / rejected: ${rejected} / total: ${events.length}`);
  return enriched;
}

module.exports = { enrichEvents };
