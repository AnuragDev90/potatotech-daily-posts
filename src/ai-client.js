// One AI client for every call in the pipeline.
// AI_PROVIDER = gemini | openai | deepseek (gemini is picked automatically when GEMINI_API_KEY is set and AI_PROVIDER is not).
// AI_MODEL overrides the provider's default model.
const axios = require('axios');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROVIDERS = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: () => process.env.GEMINI_API_KEY,
    keyName: 'GEMINI_API_KEY',
    model: 'gemini-3.8-flash',
    fallback: 'gemini-3.5-flash-lite',
    minGapMs: 7000 // free tier is RPM-limited
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    key: () => process.env.OPENAI_API_KEY,
    keyName: 'OPENAI_API_KEY',
    model: process.env.MULTI_NICHE_MODEL || 'gpt-4o-mini',
    minGapMs: 0
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    key: () => process.env.DEEPSEEK_API_KEY,
    keyName: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
    minGapMs: 0
  }
};

const PROVIDER = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai')).toLowerCase();
if (!PROVIDERS[PROVIDER]) throw new Error(`AI_PROVIDER "${PROVIDER}" is not one of: ${Object.keys(PROVIDERS).join(', ')}`);
const P = PROVIDERS[PROVIDER];

let model = process.env.AI_MODEL || P.model;
const USAGE = { calls: 0, prompt: 0, completion: 0 };
let lastCall = 0;

// Gemini sometimes wraps JSON in ```json fences even in JSON mode
const stripFences = s => s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

function assertConfigured() {
  if (!P.key()) throw new Error(`${P.keyName} is not set (AI_PROVIDER=${PROVIDER})`);
}

// messages -> string. { json: true } returns the raw JSON text; callers JSON.parse it.
async function chat(messages, { json = false, maxTokens = 1200, temperature } = {}) {
  assertConfigured();
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = P.minGapMs - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const body = { model, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) };
    if (PROVIDER === 'gemini') {
      body.reasoning_effort = 'low';
      body.max_tokens = maxTokens + 2048; // thinking tokens count against the limit; without headroom the answer is cut off
    } else {
      body.max_tokens = maxTokens;
      if (temperature !== undefined) body.temperature = temperature;
    }
    try {
      const r = await axios.post(P.url, body, { headers: { Authorization: `Bearer ${P.key()}` }, timeout: 180000 });
      const choice = r.data.choices?.[0];
      let text = (choice?.message?.content || '').trim();
      USAGE.calls++; USAGE.prompt += r.data.usage?.prompt_tokens || 0; USAGE.completion += r.data.usage?.completion_tokens || 0;
      if (json) {
        text = stripFences(text);
        try { JSON.parse(text); } catch {
          if (attempt === 5) throw new Error(`${PROVIDER} returned invalid JSON (finish_reason=${choice?.finish_reason}): ${text.slice(0, 200)}`);
          continue; // truncated or malformed: ask again
        }
      } else if (!text) {
        if (attempt === 5) throw new Error(`${PROVIDER} returned an empty answer (finish_reason=${choice?.finish_reason})`);
        continue;
      }
      return text;
    } catch (e) {
      if (!e.response) { if (attempt === 5 || e.message?.startsWith(PROVIDER)) throw e; await sleep(attempt * 5000); continue; }
      const status = e.response.status;
      const data = Array.isArray(e.response.data) ? e.response.data[0] : e.response.data;
      const msg = data?.error?.message || e.message;
      if (status === 400 && /API key/i.test(msg) || status === 401 || status === 403) {
        throw new Error(`${PROVIDER} rejected the API key (${status}): ${msg}. Check ${P.keyName}.`);
      }
      if (status === 429) {
        if (/per ?day|daily|PerDay/i.test(JSON.stringify(data))) throw new Error(`${PROVIDER} daily quota is used up. Wait for the reset (midnight Pacific) or use another key/provider.`);
        if (/insufficient_quota/.test(JSON.stringify(data))) throw new Error(`${PROVIDER} account has no credits`);
        if (attempt === 5) throw new Error(`${PROVIDER} rate limit (429): ${msg}`);
        await sleep(Math.max(attempt * 15000, 20000)); // per-minute limit: let the window clear
        continue;
      }
      if (status === 404 && P.fallback && model !== P.fallback) {
        console.warn(`[ai-client] model ${model} not available (${msg}); falling back to ${P.fallback}`);
        model = P.fallback; continue;
      }
      if ([500, 502, 503, 504].includes(status)) {
        if (attempt >= 3 && P.fallback && model !== P.fallback) { console.warn(`[ai-client] ${model} keeps failing (${status}); falling back to ${P.fallback}`); model = P.fallback; }
        if (attempt === 5) throw new Error(`${PROVIDER} server error ${status}: ${msg}`);
        await sleep(attempt * 5000); continue;
      }
      throw new Error(`${PROVIDER} error ${status}: ${msg}`);
    }
  }
}

module.exports = { chat, USAGE, sleep, get MODEL() { return model; }, PROVIDER };
