'use strict';

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.groq;
const GROQ_MODEL   = 'llama-3.1-8b-instant';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

// ── Appel Groq pour un batch d'événements ────────────────────────────────
// On traite par batch de 20 pour minimiser les appels API
async function enrichBatch(events) {
  if (!GROQ_API_KEY) {
    console.warn('[enrich] no GROQ_API_KEY — skipping enrichment');
    return events;
  }

  const prompt = `You are an intelligence analyst assistant. For each event below, return a JSON array with one object per event containing:
- "id": the original event id
- "keep": true/false — keep only if genuinely relevant for military/security/intelligence monitoring (reject: civil crime, accidents, natural disasters, court cases, business news)
- "title_fr": a concise French title (max 12 words) describing what happened
- "location": the real place where the event occurred (city, country) — infer from the title text, ignore the provided country if it seems wrong
- "category": one of: military, conflict, terrorism, protest, threat, crisis, incident

Events:
${events.map(e => `{"id":"${e.id}","title":"${e.title}","country":"${e.country}","category":"${e.category}"}`).join('\n')}

Return ONLY a valid JSON array, no explanation.`;

  try {
    const resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!resp.ok) {
      console.warn(`[enrich] Groq API error ${resp.status}`);
      return events;
    }

    const data  = await resp.json();
    const text  = data.choices?.[0]?.message?.content || '';

    // Extraire le JSON de la réponse
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn('[enrich] no JSON array in Groq response');
      return events;
    }

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

  } catch (err) {
    console.warn('[enrich] batch failed:', err.message);
    return events;
  }
}

// ── Enrichissement complet par batches de 20 ─────────────────────────────
async function enrichEvents(events) {
  if (!GROQ_API_KEY || !events.length) return events;

  const BATCH_SIZE = 20;
  const enriched   = [];
  let kept = 0, rejected = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch  = events.slice(i, i + BATCH_SIZE);
    const result = await enrichBatch(batch);
    enriched.push(...result);
    kept     += result.length;
    rejected += batch.length - result.length;

    // Petite pause pour respecter les rate limits Groq (30 req/min free tier)
    if (i + BATCH_SIZE < events.length) {
      await new Promise(r => setTimeout(r, 2100));
    }
  }

  console.log(`[enrich] done — kept: ${kept} / rejected: ${rejected} / total: ${events.length}`);
  return enriched;
}

module.exports = { enrichEvents };
