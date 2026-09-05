'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function logUsage(task, completion) {
  const usage = completion.usage || {};
  console.log('[ai-usage]', JSON.stringify({ task, model: completion.model,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    cache_hit_tokens: usage.prompt_cache_hit_tokens || 0,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0 }));
}

function createDeepSeekClient(OpenAI, apiKey, task) {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1', maxRetries: 0 });
  const create = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = async (body, options) => {
    const completion = await create({ max_tokens: 12000, ...body,
      thinking: { type: 'disabled' } }, options);
    logUsage(task, completion);
    if (completion.choices?.[0]?.finish_reason === 'length') {
      const error = new Error('AI output truncated; refusing to cache partial output');
      error.status = 422;
      throw error;
    }
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

module.exports = { createDeepSeekClient, logUsage, persistentCache, cacheKey };
