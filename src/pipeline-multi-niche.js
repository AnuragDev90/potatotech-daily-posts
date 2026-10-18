// Multi-niche pipeline (AI / graphics cards / gaming): Google News headlines -> topic clustering -> duplicate check ->
// section-by-section article (gpt-4o-mini) -> fact check + de-AI pass -> Unsplash-only images -> WordPress.
// Sits next to src/pipeline.js (smartphones) and reuses its duplicate detector, registry and the shared SEO modules
// (seo-extras, fact-check, topic-discovery). Nothing existing is modified.
// Usage: node src/pipeline-multi-niche.js [--mix=ai:2,gpu:2,gaming:1] [--status=draft|publish] [--dry-run]
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { fetchNews, fetchQuestions, fetchTrendingToday, autocomplete } = require('./topic-discovery');
const { unverifiedClaims, dropSentencesWith } = require('./fact-check');
const { buildSchema, factsTable, figureHtml } = require('./seo-extras');
const { findDuplicate, tokens, norm } = require('./pipeline');
const yt = require('./youtube-videos'); // Potato Tech YouTube channel: videos / Shorts embedded in every post where one fits (mandatory step)

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const STATUS = arg('status', 'draft');
const DRY_RUN = process.argv.includes('--dry-run');
const parseMix = s => Object.fromEntries(s.split(',').filter(Boolean).map(p => { const [k, v] = p.split(':'); return [k.trim(), parseInt(v)]; }));
const MIX = parseMix(arg('mix', 'ai:2,gpu:2,gaming:1'));          // trending / news-driven articles per niche (always run first)
const TOPICS_FILE = arg('topics-file', '');                        // fixed topics: JSON [{keyword, angle, notes[]}] (skips discovery)
const EVERGREEN = parseMix(arg('evergreen', ''));                  // evergreen articles per niche (run after the trending ones)

const { WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD, OPENAI_API_KEY, UNSPLASH_ACCESS_KEY } = process.env;
const MODEL = process.env.MULTI_NICHE_MODEL || 'gpt-4o-mini'; // deliberately not OPENAI_MODEL: this pipeline is pinned to gpt-4o-mini
const WP = `${WORDPRESS_SITE}/wp-json/wp/v2`;
const WP_AUTH = { Authorization: 'Basic ' + Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64') };
const ROOT = path.join(__dirname, '..');
const REGISTRY_FILE = path.join(ROOT, 'published_registry.json');
const MIN_HEADLINES = parseInt(process.env.MIN_HEADLINES || '3');
const PLAN = { intro: 130, body: 3, bodyWords: 260, faqQuestions: 7, faqAnswerWords: 45, conclusion: 110 };
const DEEP = arg('depth', '') === 'deep'; // --depth=deep: longer, fuller articles (4 body sections, ~2,000+ words)
if (DEEP) Object.assign(PLAN, { intro: 170, bodyWords: 400, faqQuestions: 8, faqAnswerWords: 55, conclusion: 150 });
const UPDATED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const NICHES = {
  ai: {
    label: 'AI', category: 'Artificial Intelligence', queries: ['artificial intelligence', 'OpenAI ChatGPT', 'Google Gemini AI', 'AI India', 'Anthropic Claude', 'AI chips'],
    image: ['artificial intelligence', 'robot technology', 'computer code screen', 'data center servers'], desk: 'AI and machine-learning', affiliate: false, fixedNews: true
  },
  gpu: {
    label: 'graphics cards', category: 'Graphics Cards', queries: ['Nvidia GeForce RTX', 'AMD Radeon GPU', 'Intel Arc graphics card', 'graphics card price India', 'GPU launch'],
    image: ['graphics card', 'computer hardware', 'gaming pc', 'circuit board'], desk: 'PC hardware and graphics cards', affiliate: true
  },
  gaming: {
    label: 'gaming', category: 'Gaming', queries: ['video game news', 'PlayStation 5', 'Xbox', 'Steam PC gaming', 'Nintendo Switch 2', 'esports India', 'BGMI'],
    image: ['video game controller', 'gaming setup', 'gamer', 'esports'], desk: 'video games and gaming hardware', affiliate: false, fixedNews: true
  },
  claude: {
    label: 'Claude AI', category: 'Claude AI', queries: [], image: ['laptop coding', 'artificial intelligence', 'computer code screen', 'home office desk'],
    desk: 'Claude AI, Anthropic, MCP servers, plugins and using AI tools to earn money', affiliate: true
  },
  // Smartphones, and the two big Indian sale events. Fixed topics (--topics-file) with their own news queries; time-sensitive, so "Last updated" is shown
  mobile: {
    label: 'mobile', category: 'Smartphones', queries: [], image: ['smartphone', 'mobile phone', 'phone close up', 'technology'],
    desk: 'smartphones launched or launching in India: price, specs, availability and who should buy', affiliate: true, fixedNews: true
  },
  flipkart: {
    label: 'Flipkart sale', category: 'Flipkart Sale', queries: [], image: ['online shopping', 'smartphone', 'shopping bags', 'delivery boxes'],
    desk: 'Flipkart sale events in India: Big Billion Days deals, bank offers and what is worth buying', affiliate: true, fixedNews: true
  },
  amazonsale: {
    label: 'Amazon sale', category: 'Amazon Sale', queries: [], image: ['online shopping', 'smartphone', 'shopping bags', 'delivery boxes'],
    desk: 'Amazon sale events in India: Great Indian Festival dates, deals, bank offers and what is worth buying', affiliate: true, fixedNews: true
  },
  // General technology: topics come from what is hot on Reddit, Google Trends and Google News right now
  tech: {
    label: 'technology', category: 'Technology', queries: ['technology news', 'new gadget launch', 'tech India', 'cybersecurity', 'smartphone launch', 'laptop launch', 'AI chips', 'software update'],
    image: ['technology', 'laptop', 'circuit board', 'smartphone'], desk: 'consumer technology, gadgets, software, hardware, AI and the tech industry', affiliate: true, fixedNews: true
  },
  // Head-to-head graphics card comparisons (specs table from gpu_specs.json) with leaks and expected launches from fresh headlines
  gpuvs: {
    label: 'GPU comparisons', category: 'GPU Comparisons', queries: ['GPU comparison', 'graphics card vs'], image: ['graphics card', 'computer hardware', 'gaming pc', 'circuit board'],
    desk: 'PC graphics cards: head-to-head comparisons, leaks and expected launches', affiliate: true, bodies: 4, fixedNews: true
  }
};

const log = m => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10);
const AUDIENCE = process.env.MULTI_NICHE_AUDIENCE || 'tech fans, PC builders and gamers in India';

// ─────────────────────────── OpenAI (gpt-4o-mini) ───────────────────────────
const USAGE = { calls: 0, prompt: 0, completion: 0 };
async function chat(messages, { json = false, maxTokens = 1200, temperature = 0.7 } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: MODEL, messages, temperature, max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {})
      }, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 120000 });
      USAGE.calls++; USAGE.prompt += r.data.usage?.prompt_tokens || 0; USAGE.completion += r.data.usage?.completion_tokens || 0;
      return r.data.choices[0].message.content.trim();
    } catch (e) {
      const err = e.response?.data?.error;
      if (err?.type === 'insufficient_quota') throw new Error('OpenAI account has no credits');
      const retryable = [429, 500, 502, 503].includes(e.response?.status) || e.code === 'ECONNABORTED';
      if (!retryable || attempt === 4) throw new Error(err?.message || e.message);
      await sleep(attempt * 5000);
    }
  }
}

// ─────────────────────────── Voice, de-AI, fact check ───────────────────────────
const AI_PHRASES = [
  'in today\'s fast-paced', 'in today\'s digital', 'ever-evolving', 'delve', 'game-changer', 'game changer', 'unlock', 'landscape', 'tapestry',
  'it\'s important to note', 'it\'s worth noting', 'it is important to', 'in conclusion', 'to sum up', 'in summary', 'look no further',
  'comprehensive guide', 'ultimate guide', 'navigate', 'elevate', 'seamless', 'robust', 'realm', 'testament', 'moreover', 'furthermore',
  'additionally', 'firstly', 'secondly', 'not only', 'whether you\'re', 'whether you are', 'cutting-edge', 'state-of-the-art', 'revolutionize',
  'embark', 'dive into', 'dive in', 'myriad', 'plethora', 'boasts', 'a must-have', 'take your', 'making waves', 'go-to', 'peace of mind',
  'powerhouse', 'stunning', 'sets the bar', 'much-anticipated', 'enticing', 'impressive', 'sets the stage', 'stands out', 'in the world of',
  'at the end of the day', 'when it comes to', 'bustling', 'vibrant', 'crucial', 'pivotal', 'groundbreaking', 'transformative', 'unleash', 'paradigm',
  'sweet spot', 'buzz', 'sleek', 'striking', 'solid choice'
];
const AI_RE = new RegExp('(' + AI_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
const findAiPhrases = text => [...new Set((text.match(AI_RE) || []).map(s => s.toLowerCase()))];

// Claims the shared fact-checker does not know about: GPU / model names, dollar prices, percentages, money-scale figures
const EXTRA_CLAIM_RES = [
  /\b(?:RTX|GTX|RX|Arc|GeForce|Radeon)\s?[A-Z]?\d{3,4}(?:\s?(?:Ti|XT|XTX|Super|GRE))*\b/g,
  /\b(?:GPT|Gemini|Llama|Claude|Grok|Mistral|DeepSeek|Qwen)[\s-]?\d+(?:\.\d+)?[A-Za-z]*\b/g,
  /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|billion|million|trillion))?/g,
  /\b\d+(?:\.\d+)?\s?(?:%|percent)/gi,
  /\b\d+(?:\.\d+)?\s?(?:billion|million|trillion|lakh crore|crore)\b/gi,
  /\b\d+(?:\.\d+)?[\s-]?(?:TFLOPS|TOPS|GB\/s|Gbps|GHz|MHz|CUDA cores|VRAM)\b/gi
];
const squash = t => String(t).toLowerCase().replace(/[\s,\-]/g, '');
const noDot = t => String(t).split('Rs.').join('Rs'); // sources write "Rs. 19,901", articles write "Rs 19,901": same figure
function claimsNotInSources(text, allowed) {
  text = noDot(text); allowed = noDot(allowed);
  const ok = squash(allowed);
  const extra = new Set();
  for (const re of EXTRA_CLAIM_RES) for (const m of text.match(re) || []) if (!ok.includes(squash(m))) extra.add(m.trim());
  return [...new Set([...unverifiedClaims(text, allowed), ...extra])];
}

const buildSystem = evergreen => `You are a veteran Indian technology journalist covering ${'AI, PC graphics cards and gaming'} for ${AUDIENCE}. You write the way a good tech editor talks: direct, specific, a little opinionated, never salesy.
Today's date is ${TODAY}; the current year is ${TODAY.slice(0, 4)}.

INDIA FOCUS: write for Indian readers. Use ₹ only when the reporting gives a rupee figure; never convert dollars to rupees yourself. Think about what matters here: import pricing and GST, availability on Amazon.in, Flipkart and PC retailers, power and heat in Indian summers, ISP/latency for online play, regional Steam and console pricing, Indian developers and esports scenes, and how AI tools are used by Indian students, creators and businesses. Mention India explicitly where it matters.

VOICE
- Plain words, contractions, short sentences mixed with longer ones. An occasional one-line paragraph is fine.
- Take a position where the facts support one (who should care, who should wait). Concrete beats vague: name the product, the trade-off, the use case.
- Never claim hands-on testing, owning or using a product, or invent anecdotes, quotes, benchmarks or user reviews. Write as an informed editor reporting and analysing, using "you" and "we" naturally.
- Mostly flowing prose. At most ONE short bullet list in the whole article, never in the "Bold label: sentence" pattern. Each section must add something new.
- No rhetorical-question openers. No "Whether you're a X or a Y". No lists of exactly three vague adjectives. No closing sentence that repeats the paragraph. At most one em dash per section. Headings are plain, specific, sentence case.
- Never use these (they read as machine-written): ${AI_PHRASES.slice(0, 50).join(', ')}.

FACTS
- When the reporting gives a price, date, discount or number, state it exactly and name the outlet in the sentence (for example "Gadgets 360 reports Rs. 19,901 off the iPhone 17"). Specific, attributed facts beat vague phrases like "a significant discount". If a figure is a leak or an expectation, say that in the same sentence.
- Use ONLY specifics found in the "recent reporting" headlines you are given (names, dates, prices, specs, numbers). Anything else stays general. Never invent prices, specs, benchmarks, release dates, funding figures, percentages or statistics.
- Do not call a product fast, efficient, accurate, good or bad unless the reporting says so; nobody on this site has tested it. Say what readers should look for and that independent reviews or benchmarks will settle it.
${evergreen
    ? '- This is an EVERGREEN explainer/buying-advice piece. General how-to steps, checklists of what to look for and plain explanations are welcome, but state no specific prices, benchmark numbers, release dates or model specs unless they appear in the reporting. Do not describe it as news or "latest".'
    : '- Do not write step-by-step instructions, install or settings advice, or how-to sections unless the reporting itself describes those steps. Avoid "how to" headings; prefer headings about what happened, what it means for readers in India, and what is still unknown.'}
- Never promise or imply guaranteed income. No earnings figures unless the reporting gives them; say results vary and depend on skill, effort and demand. Do not present any method as passive, easy or risk-free.
- Avoid vague hype such as "a big step forward" or "significant improvements" unless the reporting says it.
- If something is a leak, rumour or company claim, say so once ("reportedly", "the company says") instead of hedging every sentence.`;

let EVERGREEN_MODE = false; // set per job in main(); evergreen articles get how-to/explainer rules
const sysMsg = () => ({ role: 'system', content: buildSystem(EVERGREEN_MODE) });

const newsBlock = news => news?.length
  ? 'Recent reporting (headlines, your only source of specific facts):\n' + news.slice(0, 12).map(n => `- ${n.title}${n.source ? ` (${n.source}${n.date ? ', ' + n.date : ''})` : ''}`).join('\n')
  : 'Recent reporting: none. Keep everything general; state no specific facts.';
const allowedFacts = (news, keyword, title) => `${(news || []).map(n => n.title).join(' ')} ${keyword} ${title}`;

async function deAi(text) {
  let best = text, bestHits = findAiPhrases(text).length;
  for (let attempt = 0; attempt < 3 && bestHits > 0; attempt++) {
    const fixed = await chat([sysMsg(), {
      role: 'user',
      content: `Rewrite this text so it no longer contains these words or phrases: ${findAiPhrases(best).join(', ')}. Replace each with plain everyday wording (not a synonym that sounds just as formal). Keep the meaning, facts, markdown and length. Return only the rewritten text.\n\n${best}`
    }], { maxTokens: 1100, temperature: 0.8 });
    const n = findAiPhrases(fixed).length;
    if (n < bestHits) { best = fixed; bestHits = n; }
  }
  return best;
}

async function polish(text, allowed) {
  text = await deAi(text);
  let bad = claimsNotInSources(text, allowed);
  if (!bad.length) return text;
  const fixed = await chat([sysMsg(), {
    role: 'user',
    content: `These specifics are NOT supported by the source headlines and must not appear: ${bad.join(' | ')}.\nRewrite the text with each removed or replaced by general wording. Do not add any new numbers, prices, specs, names or dates. Keep tone, markdown and length as close as possible. Return only the text.\n\n${text}`
  }], { maxTokens: 1100, temperature: 0.6 });
  bad = claimsNotInSources(fixed, allowed);
  return bad.length ? dropSentencesWith(fixed, bad) : fixed;
}

// ─────────────────────────── Topic discovery per niche ───────────────────────────
// Trends first: Google Trends (India + US) terms belonging to this niche are searched in the news before the generic queries
const NICHE_RE = {
  ai: /\b(ai|a\.i\.|artificial intelligence|openai|chatgpt|gpt|gemini|claude|anthropic|llm|copilot|deepseek|grok|llama|nvidia|machine learning|robot|agent)\b/i,
  gpu: /\b(gpu|graphics cards?|geforce|rtx|gtx|radeon|rx ?\d{4}|arc|nvidia|amd|intel|dlss|fsr|vram|ryzen|blackwell|rdna)\b/i,
  tech: /\b(iphone|android|samsung|google|apple|microsoft|windows|openai|chatgpt|ai|chip|nvidia|amd|intel|qualcomm|laptop|phone|pixel|tesla|starlink|meta|amazon|netflix|spotify|whatsapp|instagram|youtube|hack|breach|launch|gadget|robot|software|update|5g|6g|satellite|quantum)\b/i,
  gaming: /\b(gaming|video games?|videogames?|gamer|playstation|ps5|ps6|xbox|nintendo|switch 2|steam|gta|bgmi|esports|fortnite|minecraft|valorant|call of duty|zelda|mario|pokemon|battlefield|elden ring)\b/i
};
let TRENDS = null;
async function loadTrends() {
  if (TRENDS) return TRENDS;
  const [inT, usT] = await Promise.all([fetchTrendingToday('IN'), fetchTrendingToday('US')]);
  const seen = new Set();
  TRENDS = [...inT.map(t => ({ ...t, geo: 'IN' })), ...usT.map(t => ({ ...t, geo: 'US' }))].filter(t => t.term && !seen.has(t.term) && seen.add(t.term));
  return TRENDS;
}

const REDDIT_SUBS = ['technology', 'gadgets', 'Android', 'apple', 'hardware', 'artificial', 'IndiaTech', 'pcgaming'];
// Reddit's JSON API blocks scripts (403); the public RSS feed of each subreddit's hot posts works. Order = hot rank.
async function fetchRedditHot(sub, n = 12) {
  try {
    let r;
    for (let attempt = 1; ; attempt++) { // Reddit answers 429 when requests come too fast: wait and retry
      try { r = await axios.get(`https://www.reddit.com/r/${sub}/hot/.rss?limit=${n + 4}`, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) potatotech-trends/1.0' } }); break; }
      catch (e) { if (e.response?.status !== 429 || attempt >= 3) throw e; await sleep(Math.max(Number(e.response.headers['retry-after']) || 0, 8) * 1000 * attempt); }
    }
    return [...r.data.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m, i) => {
      const e = m[1];
      return {
        title: decodeEntities((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(), link: (e.match(/<link href="([^"]+)"/) || [])[1] || '',
        source: `Reddit r/${sub}`, date: ((e.match(/<updated>(.*?)</) || [])[1] || '').slice(0, 10), trending: `reddit r/${sub} #${i + 1}`
      };
    }).filter(x => x.title && !/\b(megathread|daily thread|weekly thread|discussion thread)\b/i.test(x.title)).slice(0, n);
  } catch (e) { log(`   Reddit r/${sub} unavailable: ${e.response?.status || e.message}`); return []; }
}

async function nicheHeadlines(niche) {
  const trends = (await loadTrends()).filter(t => NICHE_RE[niche].test(t.term));
  const trendNews = (await Promise.all(trends.slice(0, 8).map(async t => (await fetchNews(t.term, 7, 8)).map(n => ({ ...n, trending: t.term }))))).flat();
  const generic = (await Promise.all(NICHES[niche].queries.map(q => fetchNews(q, 7, 12)))).flat();
  const reddit = [];
  if (niche === 'tech') for (const sub of REDDIT_SUBS) { reddit.push(...await fetchRedditHot(sub, 10)); await sleep(3000); }
  const seen = new Set();
  const all = [...trendNews, ...reddit, ...generic].filter(n => n.title && !seen.has(norm(n.title)) && seen.add(norm(n.title)));
  return { trends: trends.map(t => `${t.term} (${t.geo}${t.traffic ? ', ' + t.traffic : ''})`), headlines: all.slice(0, niche === 'tech' ? 110 : 60), reddit: niche === 'tech' ? reddit.length : undefined };
}

// Ask the model to group headlines about the same story, so every article is grounded in several real sources
async function pickTopics(niche, headlines, want, trends = []) {
  const list = headlines.map((h, i) => `${i}. ${h.trending ? '[TRENDING] ' : ''}${h.title} (${h.source}, ${h.date})`).join('\n');
  const prompt = `These are recent ${NICHES[niche].label} headlines. Group headlines that cover the SAME specific story, product or event and propose up to ${want} distinct article topics, strongest first. PRIORITISE what is trending right now. Google Trends today (India/US) for this niche: ${trends.length ? trends.join(' | ') : 'none'}. Headlines tagged [TRENDING] belong to those trends; topics built on them come first, then fill the remaining slots with the biggest, most searched stories useful to readers in India. HARD RULES: every topic must be squarely about ${NICHES[niche].desk} (products, releases, companies, tools, games, hardware). Reject sports, film/celebrity, politics, crime and general-news stories even if tagged [TRENDING], and reject stories about deepfakes or controversies involving named private or public individuals. Also reject stories that are mainly US politics, US law enforcement or court cases between named companies, and sensitive health topics. Every topic needs a clear, genuine angle for readers in India (product availability, pricing, apps and services used in India, Indian companies).
${list}

Return JSON: {"topics":[{"keyword":"...","headline_ids":[...]}]}
- keyword: 2-5 words, lowercase, the phrase an Indian reader would type into Google (e.g. "rtx 5070 super", "gta 6 release date", "chatgpt agent"). Specific to one story or product, not a broad category.
- headline_ids: indexes of 3-8 headlines about that exact topic. Only topics with at least ${MIN_HEADLINES} headlines.`;
  const out = JSON.parse(await chat([{ role: 'system', content: 'You are an editor choosing article topics from news headlines.' }, { role: 'user', content: prompt }], { json: true, maxTokens: Math.min(3500, 400 + want * 70), temperature: 0.3 }));
  return (out.topics || []).map(t => ({
    niche, keyword: String(t.keyword || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    headlines: [...new Set(t.headline_ids || [])].map(i => headlines[i]).filter(Boolean).slice(0, 8)
  })).filter(t => t.keyword && t.headlines.length >= MIN_HEADLINES)
    .map(t => ({ ...t, trending: t.headlines.some(h => h.trending) }))
    .sort((a, b) => Number(b.trending) - Number(a.trending)); // trending topics first, model order otherwise
}

// Evergreen topics: searches that stay relevant all year (explainers, buying advice, how-tos), none already on the site
async function pickEvergreen(niche, want, existingTitles) {
  const prompt = `Propose ${want} evergreen article topics for a site covering ${NICHES[niche].desk}, for readers in India. Evergreen = still searched and useful a year from now: explainers, buying advice, how-to and troubleshooting. Not news, not tied to one launch, no year in the keyword.
Already on the site (do not repeat or closely overlap): ${JSON.stringify(existingTitles.slice(0, 80))}
Return JSON: {"topics":["..."]}. Each topic is a 3-6 word lowercase search phrase real people type into Google (e.g. "how to choose a graphics card", "what is vram in gpu", "how to speed up gaming laptop").`;
  const out = JSON.parse(await chat([{ role: 'system', content: 'You are an SEO editor choosing evergreen article topics.' }, { role: 'user', content: prompt }], { json: true, maxTokens: 500, temperature: 0.8 }));
  return (out.topics || []).map(k => String(k).toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ─────────────────────────── GPU comparison category (gpuvs) ───────────────────────────
const GPU_SPECS = (() => { try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'gpu_specs.json'), 'utf8')); delete j._note; return j; } catch { return {}; } })();
const LEAK_QUERIES = ['RTX 60 series release leak', 'Nvidia RTX 50 Super', 'AMD next generation Radeon leak', 'upcoming graphics cards launch'];
// Comparisons differ by one model number, so the fuzzy detector would reject them; only the same pair (either order), title or slug counts as a duplicate
const pairKey = k => [...String(k).toLowerCase().split(' vs ')].map(x => norm(x)).sort().join('|');
const isDup = (niche, q, list) => niche !== 'gpuvs' ? findDuplicate(q, list)
  : list.find(e => (e.keyword && pairKey(e.keyword) === pairKey(q.keyword)) || (q.slug && e.slug === q.slug) || (q.title && e.title && norm(q.title) === norm(e.title))) || null;
const bare = k => k.replace(/^(rtx|gtx|rx|arc)\s+/, '');

// Table, verified facts, Amazon terms and extra news queries for one A-vs-B pair
function compareTopic(t) {
  const A = GPU_SPECS[t.a], B = GPU_SPECS[t.b];
  if (!A || !B) throw new Error(`no specs for "${!A ? t.a : t.b}" in gpu_specs.json`);
  const rows = [['Architecture', 'arch'], ['VRAM', 'vram'], ['Memory type', 'memory'], ['Memory bus', 'bus'], ['Shader cores', 'cores'], ['Board power', 'power'], ['Launch MSRP (US)', 'msrp'], ['Launched', 'launch'], ['Upscaling', 'upscaler']];
  const table = `<h2>${esc(A.name)} vs ${esc(B.name)} specs</h2>\n<table><thead><tr><th>Spec</th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>` +
    rows.map(([l, k]) => `<tr><td>${l}</td><td>${esc(A[k])}</td><td>${esc(B[k])}</td></tr>`).join('') +
    '</tbody></table>\n<p><em>Launch specs and US launch prices as announced by the manufacturers. Street prices change and differ in India, so check current listings before you buy.</em></p>';
  const note = g => `${g.name} (${g.vendor}, ${g.arch}) launched ${g.launch} with ${g.vram} ${g.memory}, a ${g.bus} memory bus, ${g.cores}, ${g.power} board power and a launch MSRP of ${g.msrp}; it supports ${g.upscaler}`;
  return {
    keyword: `${t.a} vs ${t.b}`, table, notes: [note(A), note(B)], affTerms: [A.name, B.name], extraQueries: [`${A.name} vs ${B.name}`, ...LEAK_QUERIES],
    headlines: [note(A), note(B)].map(title => ({ title, source: 'manufacturer launch specs', date: '' })),
    angle: `Head-to-head for buyers in India: which of the two to pick and for whom. Cover what the spec table shows (VRAM, memory bus, board power, upscaling tech) and launch price positioning, using only the facts given. Use exactly these H2 topics in order, and put both card names (short form, e.g. "RTX 5070 vs RX 9070 XT") in at least two of the four headings: (1) specs and architecture compared, (2) price and value for buyers in India (US launch MSRPs only, no rupee conversion, street prices vary), (3) who should buy which, (4) leaks and expected launches: what the reporting says about upcoming or next-generation GPUs and their timing, clearly flagged as rumours or unconfirmed. ACCURACY RULES: every sentence about a spec or feature must name the card it belongs to (FSR is AMD-only, DLSS is NVIDIA-only, XeSS is Intel-only; never attribute one vendor's feature to another vendor's card). Only use the specs given in the reporting notes. Do not repeat the full spec list in later sections: section 2 covers price positioning and India factors only, section 3 gives clear buy-this-if / buy-that-if advice. No benchmark numbers or fps claims unless the reporting states them; say independent reviews settle real-world performance.`
  };
}

// Most searched pairs in the specs database, ranked by Google Autocomplete (how often and how high a pair is suggested)
async function discoverComparisons(n) {
  const keys = Object.keys(GPU_SPECS), score = new Map();
  for (const a of keys) {
    const sugg = await autocomplete(`${a} vs`);
    sugg.forEach((s, i) => {
      const rest = s.toLowerCase().split(' vs ')[1]?.trim();
      const b = keys.find(k => k !== a && (rest === k || rest === bare(k)));
      if (b) { const id = [a, b].sort().join('|'); score.set(id, (score.get(id) || 0) + (8 - i)); }
    });
  }
  return [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([id]) => { const [a, b] = id.split('|'); return { a, b }; });
}

// ─────────────────────────── Article writing ───────────────────────────
const kwWordsOf = keyword => keyword.replace(/ in india$/, '').split(' ').filter(w => w.length > 2);
const hasAll = (s, ws) => ws.every(w => String(s).toLowerCase().includes(w));

async function planArticle(niche, keyword, questions, news, angle = '') {
  const base = `Plan an SEO article for the search query: "${keyword}" (desk: ${NICHES[niche].desk}; audience: readers in India).
${newsBlock(news)}${angle ? `
EDITORIAL ANGLE (shape the H2 headings and FAQ around it, without changing the keyword in the title): ${angle}` : ''}
Real related questions people search (inspiration for the FAQ): ${JSON.stringify(questions)}
Return JSON with exactly these keys:
- title: 50-60 characters, a real news-site headline that contains every word of "${keyword}" near the start. No "Guide", "Comprehensive", "Ultimate", "Everything you need to know", no colon-subtitle formula.
- meta_description: 140-155 characters, contains every word of "${keyword}", plain and specific, not salesy
- slug: lowercase-hyphenated, max 6 words, includes the keyword
- tags: array of 3-5 short tags (company, product, topic)
- image_query: 2-3 concrete, photographable words for a stock photo search (e.g. "graphics card", "gaming setup", "robot hand"; no brand names, no text)
- amazon_search: a 2-4 word product search for Amazon.in that a reader of THIS article might genuinely buy (e.g. "gaming laptop", "graphics card", "ps5 controller", "gaming headset", "mechanical keyboard", "ai books"). Generic product category, no brand unless the article is about that brand's product. Never a person, event or subscription.
- h2_headings: array of exactly ${PLAN.body} distinct plain, specific H2 headings; at least 2 must contain a word from "${keyword}"
- faq: array of exactly ${PLAN.faqQuestions} distinct questions Indian readers actually ask (each answerable in ~${PLAN.faqAnswerWords} words)`;
  const ws = kwWordsOf(keyword);
  let problems = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = JSON.parse(await chat([sysMsg(), { role: 'user', content: base + problems }], { json: true, maxTokens: 800, temperature: 0.7 }));
    const issues = [];
    if (!meta.title || meta.title.length < 42 || meta.title.length > 64) issues.push(`title must be 42-64 characters (was ${meta.title?.length})`);
    else if (!hasAll(meta.title, ws)) issues.push(`title must contain every word of "${keyword}"`);
    if (!meta.meta_description || meta.meta_description.length < 125 || meta.meta_description.length > 158) issues.push(`meta_description must be 125-158 characters (was ${meta.meta_description?.length})`);
    else if (!hasAll(meta.meta_description, ws)) issues.push(`meta_description must contain every word of "${keyword}"`);
    if (!Array.isArray(meta.h2_headings) || meta.h2_headings.length !== PLAN.body) issues.push(`h2_headings must have exactly ${PLAN.body} items`);
    if (!Array.isArray(meta.faq) || meta.faq.length < 5) issues.push('faq must have 7 questions');
    if (!issues.length) { meta.category = NICHES[niche].category; meta.angle = angle; return meta; }
    problems = `\n\nYour previous attempt failed these checks, fix them: ${issues.join('; ')}.`;
  }
  throw new Error('could not produce title/meta that pass SEO length and keyword checks');
}

async function writeSection(kind, meta, keyword, words, heading, written, news) {
  const common = `Article title: "${meta.title}". Primary keyword: "${keyword}".${meta.angle ? `
Editorial angle: ${meta.angle}` : ''}
${newsBlock(news)}
Already written headings (do not repeat their content): ${JSON.stringify(written)}.
Write at least ${words} words (aim for ${Math.round(words * 1.15)}). Markdown only. Do NOT output the section heading itself.`;
  const specific = {
    intro: `Write the introduction. Open with the actual news or the reader's real situation, not a generic scene-setter. Use the exact phrase "${keyword}" within the first two sentences. Say plainly what this article covers. No lists.`,
    body: `Write the body section for the H2 "${heading}". Be specific and useful: real trade-offs, who it matters to, what to check, what is still unconfirmed. Use a short bullet list or one H3 only if it genuinely helps.`,
    conclusion: `Write the closing section: your honest take in 2-3 sentences (who should care, buy or wait), then one natural line inviting comments. No new facts, no "in conclusion".`
  }[kind];
  const text = await chat([sysMsg(), { role: 'user', content: `${common}\n\n${specific}` }], { maxTokens: 1000, temperature: 0.85 });
  const lines = text.split('\n'); // the model sometimes repeats the heading as the first line
  const first = norm(lines[0].replace(/^#+\s*/, ''));
  if (heading && first && (first === norm(heading) || (lines[0].startsWith('#') && first.length < 120))) lines.shift();
  return polish(lines.join('\n').trim(), allowedFacts(news, keyword, meta.title));
}

async function writeIntro(meta, keyword, news) {
  let intro = await writeSection('intro', meta, keyword, PLAN.intro, null, [], news);
  const ws = kwWordsOf(keyword);
  if (!hasAll(intro.split(/\s+/).slice(0, 100).join(' '), ws)) { // SEO audit: keyword inside the first 100 words
    intro = await polish(await chat([sysMsg(), {
      role: 'user', content: `Rewrite this introduction so the exact phrase "${keyword}" appears in the first two sentences. Keep every fact and the length. Return only the text.\n\n${intro}`
    }], { maxTokens: 700, temperature: 0.6 }), allowedFacts(news, keyword, meta.title));
  }
  return intro;
}

async function writeFaq(meta, keyword, news) {
  const prompt = `Answer these FAQ questions about "${keyword}" for readers in India. Each answer: ${PLAN.faqAnswerWords}-${PLAN.faqAnswerWords + 15} words, direct (answer in the first sentence), conversational plain text, no markdown. If the reporting does not cover a question, say plainly what is not confirmed yet and where to check (the company's official site, Amazon.in/Flipkart, Steam); never guess specs, prices or dates.
${newsBlock(news)}
Questions: ${JSON.stringify(meta.faq.slice(0, PLAN.faqQuestions))}
Return JSON: {"faq":[{"question":"...","answer":"..."}]} keeping the questions as given.`;
  const faq = JSON.parse(await chat([sysMsg(), { role: 'user', content: prompt }], { json: true, maxTokens: 1100, temperature: 0.8 })).faq;
  for (const f of faq) f.answer = (await polish(f.answer, allowedFacts(news, keyword, meta.title))).replace(/\s+/g, ' ').trim();
  return faq;
}

// "Key takeaways" box (answer-first, snippet-friendly): points come only from the reporting; any point with an unverified specific is dropped
async function writeTakeaways(meta, keyword, news, intro) {
  const prompt = `Write 4 key takeaways for the article "${meta.title}" (keyword "${keyword}"). Each is one plain sentence of at most 28 words that tells a reader in India something concrete to act on or remember. Use ONLY facts in the reporting below; flag rumours or leaks as such; no hype.
${newsBlock(news)}
Article intro: ${intro.slice(0, 600)}
Return JSON: {"points":["...","...","...","..."]}`;
  try {
    const pts = JSON.parse(await chat([sysMsg(), { role: 'user', content: prompt }], { json: true, maxTokens: 400, temperature: 0.3 })).points || [];
    const allowed = allowedFacts(news, keyword, meta.title);
    const ok = pts.map(x => String(x).trim()).filter(x => x && !claimsNotInSources(x, allowed).length && !findAiPhrases(x).length).slice(0, 5);
    return ok.length >= 3 ? `<h2>Key takeaways</h2>
<ul>${ok.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  } catch (e) { return ''; }
}

async function writeFacts(keyword, title, news) {
  if (EVERGREEN_MODE) return []; // no news facts to tabulate in an evergreen piece
  const prompt = `From ONLY the headlines below, extract up to 6 concrete facts about "${keyword}" for a quick-facts table (e.g. company, release or launch date, price, key specs, platforms, availability). Skip anything the headlines do not state. Each value max 12 words, plain text.
${newsBlock(news)}
Return JSON: {"rows":[{"label":"...","value":"..."}]}`;
  try {
    const rows = JSON.parse(await chat([sysMsg(), { role: 'user', content: prompt }], { json: true, maxTokens: 500, temperature: 0.2 })).rows || [];
    const allowed = allowedFacts(news, keyword, title);
    const EMPTY = /not (mentioned|specified|confirmed|available|announced|disclosed)|unknown|n\/a|tbd|to be (announced|confirmed)|unconfirmed/i;
    return rows.filter(r => r.label && r.value && !EMPTY.test(r.value) && !claimsNotInSources(`${r.label} ${r.value}`, allowed).length).slice(0, 6);
  } catch (e) { return []; }
}

// ─────────────────────────── HTML ───────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decodeEntities = s => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');

function mdToHtml(md) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trim(); let m;
    if (!line) continue;
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); } // body sections sit under an H2
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\d+[.)]\s+\*\*([^*]+)\*\*:?$/))) { close(); out.push(`<h3>${esc(m[1])}</h3>`); }
    else if ((m = line.match(/^(\d+)[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push(`<ol start="${m[1]}">`); list = 'ol'; } out.push(`<li>${inline(m[2])}</li>`); }
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('\n');
}
const countWords = s => s.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

const AMAZON_TAG = process.env.AMAZON_AFFILIATE_TAG;
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || 'www.amazon.in';
const AFF_ATTR = 'target="_blank" rel="sponsored nofollow noopener"';
function amazonLink(keyword) {
  if (!AMAZON_TAG || !keyword) return null;
  return { term: keyword, url: `https://${AMAZON_DOMAIN}/s?k=${encodeURIComponent(keyword)}&tag=${encodeURIComponent(AMAZON_TAG)}` };
}

function buildHtml({ meta, intro, bodies, faq, conclusion, related, photo, affiliate, affiliates, facts, sources, figure, schema, videos = [], channelVideos = [], takeaways = '' }) {
  const parts = [];
  const affs = affiliates?.length ? affiliates : (affiliate ? [affiliate] : []); // Amazon links in three places only (top box, after the first section, conclusion): link-stuffed pages read as thin affiliate content (AdSense rejection)
  const link = (a, text) => `<a href="${esc(a.url)}" ${AFF_ATTR}>${text}</a>`;
  const linkAll = text => affs.map(a => link(a, `${text(a)}`)).join(' | ');
  if (affs.length) parts.push('<p><em>Disclosure: this post contains Amazon affiliate links. As an Amazon Associate we earn from qualifying purchases, at no extra cost to you.</em></p>');
  parts.push(`<p><em>Last updated: ${UPDATED}</em></p>`, mdToHtml(intro));
  if (affs.length) parts.push(`<p><strong>Want to see what it costs right now?</strong> ${linkAll(a => `Check ${esc(a.term)} price on Amazon.in`)}</p>`);
  if (takeaways) parts.push(takeaways);
  if (facts) parts.push(facts);
  meta.h2_headings.forEach((h, i) => {
    parts.push(`<h2>${esc(h)}</h2>`, mdToHtml(bodies[i]));
    if (i === 0 && figure) parts.push(figure);
    if (videos[i]) parts.push(yt.embedHtml(videos[i])); // first video after the first section, second after the second
    if (affs.length && i === 0) parts.push(`<p>${affs.length > 1 ? linkAll(a => `See ${esc(a.term)} on Amazon.in`) : link(affs[0], `Browse ${esc(affs[0].term)} on Amazon.in`)}</p>`);
  });
  parts.push('<h2>Frequently Asked Questions</h2>');
  faq.forEach(f => parts.push(`<h3>${esc(f.question)}</h3>`, `<p>${esc(f.answer)}</p>`));
  parts.push('<h2>Conclusion</h2>', mdToHtml(conclusion));
  if (affs.length) parts.push(`<p>${linkAll(a => `See ${esc(a.term)} deals on Amazon.in`)} (prices and offers change often, so check before you buy).</p>`);
  parts.push(channelVideos.length ? yt.channelBlockHtml(channelVideos) : yt.ctaHtml()); // no topic match: embed the channel's top video + Short; channel link always present
  if (related.length) parts.push('<h2>Related reading</h2>', '<ul>' + related.map(p => `<li><a href="${esc(p.link)}">${esc(p.title)}</a></li>`).join('') + '</ul>');
  if (sources) parts.push(sources);
  if (photo) parts.push(`<p><em>Featured photo by <a href="${esc(photo.user_url)}?utm_source=potatotech&utm_medium=referral">${esc(photo.user)}</a> on <a href="https://unsplash.com/?utm_source=potatotech&utm_medium=referral">Unsplash</a></em></p>`);
  if (schema) parts.push(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`);
  return parts.join('\n');
}

// ─────────────────────────── Registry, existing posts, internal links ───────────────────────────
function loadRegistry() { try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); } catch { return { items: [], unsplash_ids: [] }; } }
function saveRegistry(r) { fs.writeFileSync(REGISTRY_FILE, JSON.stringify(r, null, 2)); }

async function fetchExistingPosts() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    try {
      const r = await axios.get(`${WP}/posts`, {
        params: { per_page: 100, page, status: 'publish,draft,pending,future,private', _fields: 'id,title,slug,link,status' },
        headers: WP_AUTH, timeout: 30000
      });
      all.push(...r.data.map(p => ({ id: p.id, title: decodeEntities(p.title.rendered), slug: p.slug, link: p.link, status: p.status })));
      if (r.data.length < 100) break;
    } catch (e) { if (e.response?.status === 400) break; throw e; }
  }
  return all;
}

// Topical matches first, then the newest published posts, so every article carries 3 internal links
function internalLinks(existing, keyword, limit = 3) {
  const GENERIC = new Set(['india', 'price', 'launch', 'release', 'date', 'news', 'review', 'specs', 'new']);
  const kt = new Set([...tokens(keyword)].filter(w => !GENERIC.has(w)));
  const pub = existing.filter(p => p.status === 'publish');
  const scored = pub.map(p => ({ p, shared: [...tokens(p.title)].filter(w => kt.has(w)).length })).filter(x => x.shared >= 1).sort((a, b) => b.shared - a.shared).map(x => x.p);
  const picked = scored.slice(0, limit);
  for (const p of pub) { if (picked.length >= limit) break; if (!picked.includes(p)) picked.push(p); }
  return picked;
}

// ─────────────────────────── Unsplash (only image source) ───────────────────────────
const CLASH_BRANDS = ['iphone', 'apple', 'samsung', 'pixel', 'macbook', 'ipad', 'android', 'watch', 'tablet'];
async function findPhotos(queries, usedIds, keyword, n = 2) {
  for (const q of queries.map(x => (Array.isArray(x) ? x.join(' ') : String(x || '')).trim().slice(0, 80)).filter(Boolean)) {
    try {
      const r = await axios.get('https://api.unsplash.com/search/photos', {
        params: { query: q, per_page: 20, orientation: 'landscape', content_filter: 'high' },
        headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }, timeout: 20000
      });
      if (Number(r.headers['x-ratelimit-remaining'] ?? Infinity) < 8) n = 1; // demo keys: 50 requests/hour
      const kw = keyword.toLowerCase();
      const clashes = x => { const a = `${x.alt_description || ''} ${x.description || ''}`.toLowerCase(); return CLASH_BRANDS.some(b => a.includes(b) && !kw.includes(b)); };
      const hits = r.data.results.filter(x => !usedIds.includes(x.id) && !clashes(x)).slice(0, n).map(p => ({
        id: p.id, url: p.urls.regular, alt: p.alt_description || p.description || q,
        user: p.user.name, user_url: p.user.links.html, download_location: p.links.download_location
      }));
      if (hits.length) return hits;
    } catch (e) { log(`   ⚠️  Unsplash search '${q}' failed: ${e.response?.status} ${JSON.stringify(e.response?.data?.errors || e.message)}`); }
  }
  return [];
}

async function uploadPhoto(photo, keyword, title) {
  await axios.get(photo.download_location, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }, timeout: 20000 }).catch(() => {}); // Unsplash API guideline
  const img = await axios.get(photo.url, { responseType: 'arraybuffer', timeout: 60000 });
  if (!String(img.headers['content-type']).startsWith('image/') || img.data.length < 5000) throw new Error('Unsplash image download invalid');
  const form = new FormData();
  form.append('file', Buffer.from(img.data), { filename: `${norm(keyword).replace(/ /g, '-')}.jpg`, contentType: 'image/jpeg' });
  const up = await axios.post(`${WP}/media`, form, { headers: { ...form.getHeaders(), ...WP_AUTH }, timeout: 90000, maxBodyLength: Infinity });
  const alt = String(photo.alt).charAt(0).toUpperCase() + String(photo.alt).slice(1, 120);
  await axios.post(`${WP}/media/${up.data.id}`, { alt_text: alt, title, caption: `Photo by ${photo.user} on Unsplash` }, { headers: WP_AUTH, timeout: 30000 });
  return { id: up.data.id, source_url: up.data.source_url };
}

async function getOrCreateTerm(taxonomy, name) {
  const found = await axios.get(`${WP}/${taxonomy}`, { params: { search: name, per_page: 20 }, headers: WP_AUTH });
  const hit = found.data.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (hit) return { id: hit.id, name: hit.name, link: hit.link };
  try {
    const made = await axios.post(`${WP}/${taxonomy}`, { name }, { headers: WP_AUTH });
    return { id: made.data.id, name: made.data.name, link: made.data.link };
  } catch (e) {
    if (e.response?.data?.code === 'term_exists') {
      const t = (await axios.get(`${WP}/${taxonomy}/${e.response.data.data.term_id}`, { headers: WP_AUTH })).data;
      return { id: t.id, name: t.name, link: t.link };
    }
    throw e;
  }
}

// ─────────────────────────── Main ───────────────────────────
async function main() {
  const total = [...Object.values(MIX), ...Object.values(EVERGREEN)].reduce((a, b) => a + b, 0);
  console.log(`\nMulti-niche pipeline: ${total} articles (${Object.entries(MIX).map(([k, v]) => `${k}:${v}`).join(', ')}) | status=${STATUS}${DRY_RUN ? ' | DRY RUN (nothing sent to WordPress)' : ''} | model=${MODEL} | images=Unsplash only\n`);
  for (const k of ['OPENAI_API_KEY', 'UNSPLASH_ACCESS_KEY', 'WORDPRESS_SITE', 'WORDPRESS_USERNAME', 'WORDPRESS_PASSWORD']) if (!process.env[k]) throw new Error(`${k} missing in .env`);
  for (const k of [...Object.keys(MIX), ...Object.keys(EVERGREEN)]) if (!NICHES[k]) throw new Error(`unknown niche "${k}" (use ai, gpu, gaming)`);

  const registry = loadRegistry();
  const wpPosts = await fetchExistingPosts();
  const existing = [...wpPosts, ...registry.items];
  log(`Duplicate index: ${wpPosts.length} WordPress posts + ${registry.items.length} registry entries`);

  const results = [];
  const batch = [];
  // Trending / news jobs always run first, evergreen jobs after them
  const JOBS = [...Object.entries(MIX).map(([niche, want]) => ({ niche, want, evergreen: false })), ...Object.entries(EVERGREEN).map(([niche, want]) => ({ niche, want, evergreen: true }))];
  const FIXED = TOPICS_FILE ? JSON.parse(fs.readFileSync(path.resolve(TOPICS_FILE), 'utf8')) : null;
  if (FIXED) { // one job per category found in the file (default claude); comparison topics run as news-style, the rest as evergreen
    JOBS.length = 0;
    for (const niche of [...new Set(FIXED.map(t => t.niche || 'claude'))]) {
      const fixed = FIXED.filter(t => (t.niche || 'claude') === niche);
      JOBS.push({ niche, want: fixed.length, evergreen: !NICHES[niche].fixedNews, fixed });
    }
  }
  for (const { niche, want, evergreen, fixed } of JOBS) {
    if (!want) continue;
    EVERGREEN_MODE = evergreen;
    PLAN.body = NICHES[niche].bodies || (DEEP ? 4 : 3);
    log(`\n═══ ${NICHES[niche].label.toUpperCase()}${evergreen ? ' (EVERGREEN)' : ' (TRENDING)'} ═══`);
    let candidates;
    if (fixed && niche === 'gpuvs') {
      candidates = fixed.map(compareTopic);
      log(`Comparisons: ${candidates.map(c => c.keyword).join(' | ')}`);
    } else if (niche === 'gpuvs') { // no file: pick the head-to-heads people actually search for (Google Autocomplete), from the specs database
      candidates = (await discoverComparisons(want * 3)).map(compareTopic);
      log(`Most searched comparisons: ${candidates.map(c => c.keyword).join(' | ')}`);
    } else if (fixed) {
      candidates = fixed.map(t => ({ keyword: t.keyword.toLowerCase(), angle: t.angle || '', headlines: (t.notes || []).map(n => typeof n === 'string' ? { title: n, source: 'editor notes', date: '' } : { title: n.title, link: n.link, source: n.source || 'editor notes', date: '' }), extraQueries: t.queries, days: t.days, table: t.table_html, evergreen: !NICHES[niche].fixedNews }));
      log(`Fixed topics: ${candidates.map(c => c.keyword).join(' | ')}`);
    } else if (evergreen) {
      const titles = [...existing, ...batch].map(e => e.title || e.keyword).filter(Boolean);
      candidates = (await pickEvergreen(niche, want * 4, titles)).map(keyword => ({ keyword, headlines: [], evergreen: true }));
      log(`Evergreen candidates: ${candidates.map(c => c.keyword).join(' | ')}`);
    } else {
      const { trends, headlines, reddit } = await nicheHeadlines(niche);
      if (reddit !== undefined) log(`Reddit hot posts read (${REDDIT_SUBS.map(x => 'r/' + x).join(', ')}): ${reddit}`);
      log(`Trending now (Google Trends IN/US) in this niche: ${trends.join(' | ') || 'nothing matching today, using top news'}`);
      log(`${headlines.length} fresh headlines (${headlines.filter(h => h.trending).length} from trending searches)`);
      if (headlines.length < MIN_HEADLINES) { log('not enough headlines, skipping niche'); continue; }
      candidates = await pickTopics(niche, headlines, want * 4, trends);
      { const cat = await yt.fetchCatalog(); candidates.sort((x, y) => Number(yt.mayMatch(y.keyword, cat)) - Number(yt.mayMatch(x.keyword, cat))); } // topics that have a Potato Tech video go first (stable sort keeps trending order otherwise)
      log(`Candidate topics: ${candidates.map(c => `${c.trending ? '🔥' : ''}${c.keyword} (${c.headlines.length})`).join(' | ')}`);
    }

    let done = 0;
    for (const cand of candidates) {
      if (done >= want) break;
      const keyword = cand.keyword, row = { niche, keyword, kind: evergreen ? 'evergreen' : 'trending' };
      let news = cand.headlines;
      const dup0 = isDup(niche, { keyword }, [...existing, ...batch]);
      if (dup0) { log(`⏭️  SKIP "${keyword}" - duplicate of "${dup0.title || dup0.keyword}"`); results.push({ ...row, status: 'skipped', reason: `duplicate of ${dup0.title || dup0.keyword}` }); continue; }

      const usageBefore = { ...USAGE };
      try {
        if (cand.extraQueries) { // comparisons: fresh headlines on the pair plus leaks / expected launches (these feed the "what's next" section)
          const found = (await Promise.all(cand.extraQueries.map(async q => (await fetchNews(q, cand.days || 30, cand.days ? 6 : 4)).map(n => ({ ...n, q }))))).flat();
          const seenT = new Set(); news = [...cand.headlines, ...found.filter(n => n.title && !seenT.has(norm(n.title)) && seenT.add(norm(n.title)))].slice(0, 12);
        } else if (niche === 'tech') { // Reddit tells us what is hot; Google News on the same topic supplies the reporting
          const seenT = new Set();
          news = [...cand.headlines, ...(await fetchNews(keyword, 7, 8))].filter(n => n.title && !seenT.has(norm(n.title)) && seenT.add(norm(n.title))).slice(0, 12);
        } else if (evergreen) { // real reporting on the subject becomes source links; only headlines mentioning the topic are kept
          const kws = kwWordsOf(keyword).filter(w => w.length > 3);
          news = [...cand.headlines, ...(await fetchNews(keyword, 90, 8)).filter(n => kws.some(w => n.title.toLowerCase().includes(w))).slice(0, 5)];
        }
        log(`\n📝 "${keyword}" [${row.kind}] (${news.length} source headlines)`);
        const questions = await fetchQuestions(keyword);
        const meta = await planArticle(niche, keyword, questions, news, cand.angle);
        row.title = meta.title;
        const dup1 = isDup(niche, { keyword, title: meta.title, slug: meta.slug }, [...existing, ...batch]);
        if (dup1) { log(`⏭️  SKIP - generated title/slug duplicates "${dup1.title || dup1.keyword}"`); results.push({ ...row, status: 'skipped', reason: `duplicate of ${dup1.title || dup1.keyword}` }); continue; }

        const written = ['Introduction'];
        const intro = await writeIntro(meta, keyword, news);
        const bodies = [];
        for (const h of meta.h2_headings) { bodies.push(await writeSection('body', meta, keyword, PLAN.bodyWords, h, written, news)); written.push(h); }
        const faq = await writeFaq(meta, keyword, news);
        const conclusion = await writeSection('conclusion', meta, keyword, PLAN.conclusion, null, written, news);

        const photos = await findPhotos([meta.image_query, ...NICHES[niche].image], registry.unsplash_ids, keyword, 2);
        const photo = photos[0];
        if (!photo) throw new Error('no Unsplash photo found');
        const photo2 = photos[1] || null;

        const related = internalLinks(wpPosts, keyword);
        const FALLBACK_TERM = { ai: 'ai books', gpu: 'graphics card', gaming: 'gaming accessories', claude: 'ai books', gpuvs: 'graphics card', tech: 'tech gadgets', mobile: 'smartphone', flipkart: 'smartphone', amazonsale: 'smartphone' };
        const affiliate = amazonLink(String(meta.amazon_search || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 40) || FALLBACK_TERM[niche]); // every article gets an Amazon.in search link, never none
        const factRows = cand.table ? [] : await writeFacts(keyword, meta.title, news);
        const sources = ''; // the Sources section was removed by request
        const affiliates = cand.affTerms ? cand.affTerms.map(amazonLink).filter(Boolean) : null; // one Amazon link per compared product
        const ytCatalog = await yt.fetchCatalog();
        const videos = await yt.pickVideos({ title: meta.title, keyword, headings: meta.h2_headings }, ytCatalog); // MANDATORY step: always runs for every post
        const channelVideos = videos.length ? [] : yt.fallbackVideos(meta.slug, ytCatalog); // nothing matches the topic: embed the channel's best video + Short anyway
        log(`   🎬 ${videos.length ? videos.map(v => (v.short ? 'Short' : 'Video') + ': ' + v.title).join(' | ') : 'no topic-matched video; embedding channel favourites: ' + channelVideos.map(v => (v.short ? 'Short' : 'Video') + ': ' + v.title).join(' | ')}`);
        const takeaways = await writeTakeaways(meta, keyword, news, intro);
        const baseArgs = { meta, takeaways, intro, bodies, faq, conclusion, related, photo, affiliate, affiliates, videos, channelVideos, facts: cand.table || factsTable(factRows), sources };
        const html = buildHtml({ ...baseArgs, figure: null, schema: null });
        Object.assign(row, {
          words: countWords(html.replace(/<script[\s\S]*?<\/script>/g, '')), faq: faq.length, facts: factRows.length,
          sources: (sources.match(/<li>/g) || []).length, internal_links: related.length, videos: videos.length + channelVideos.length, image: photo.id,
          tokens: { calls: USAGE.calls - usageBefore.calls, input: USAGE.prompt - usageBefore.prompt, output: USAGE.completion - usageBefore.completion }
        });
        log(`   ✍️  ${row.words} words | ${faq.length} FAQs | ${factRows.length} quick facts | ${row.sources} sources | ${related.length} internal links | title: ${meta.title}`);

        if (!DRY_RUN) {
          const media = await uploadPhoto(photo, keyword, meta.title);
          let media2 = null;
          if (photo2) { try { media2 = await uploadPhoto(photo2, keyword, `${meta.title} (photo 2)`); } catch (e) { log(`   ⚠️  supporting image skipped: ${e.message}`); } }
          const figure = media2 ? figureHtml(media2, photo2) : '';
          const cat = await getOrCreateTerm('categories', meta.category);
          const tags = [];
          for (const t of meta.tags.slice(0, 5)) tags.push((await getOrCreateTerm('tags', t)).id);
          const post = await axios.post(`${WP}/posts`, {
            title: meta.title, slug: meta.slug, content: buildHtml({ ...baseArgs, figure, schema: null }), excerpt: meta.meta_description,
            status: STATUS, featured_media: media.id, categories: [cat.id], tags
          }, { headers: WP_AUTH, timeout: 60000 });
          const schema = buildSchema({
            meta, faq, url: post.data.link, imageUrl: media.source_url, category: cat,
            site: WORDPRESS_SITE, siteName: process.env.SITE_NAME || 'Potato Tech', product: null, datePublished: new Date().toISOString()
          });
          schema['@graph'][0].author = { '@type': 'Person', name: 'Anurag', url: `${WORDPRESS_SITE}/about-potato-tech/` }; // named author (E-E-A-T)
          if (videos.length || channelVideos.length) schema['@graph'].push(...yt.videoSchema([...videos, ...channelVideos]));
          await axios.post(`${WP}/posts/${post.data.id}`, { content: buildHtml({ ...baseArgs, figure, schema }) }, { headers: WP_AUTH, timeout: 60000 });
          Object.assign(row, { status: post.data.status, post_id: post.data.id, link: post.data.link, media_id: media.id });
          registry.items.push({ keyword, title: meta.title, slug: post.data.slug, post_id: post.data.id, status: post.data.status, link: post.data.link, date: new Date().toISOString(), niche });
          registry.unsplash_ids.push(photo.id, ...(media2 ? [photo2.id] : []));
          saveRegistry(registry);
          log(`   ✅ posted as ${row.status}: ${row.link}`);
        } else {
          row.status = 'dry-run';
          fs.writeFileSync(path.join(ROOT, `dryrun_${norm(keyword).replace(/ /g, '-')}.html`), html);
        }
        batch.push({ keyword, title: meta.title, slug: meta.slug });
        results.push(row);
        done++;
      } catch (e) {
        row.status = 'error'; row.error = `${e.response?.data?.message || e.response?.data?.error?.message || e.message} [${String(e.config?.url || '').split('/').slice(3).join('/')}]`;
        log(`   ❌ ${row.error}`);
        results.push(row);
      }
    }
  }

  fs.writeFileSync(path.join(ROOT, 'multi_niche_results.json'), JSON.stringify(results, null, 2));
  const cost = USAGE.prompt / 1e6 * 0.15 + USAGE.completion / 1e6 * 0.60; // gpt-4o-mini list prices
  console.log('\n' + '═'.repeat(70));
  results.forEach(r => console.log(`${{ skipped: '⏭️ ', error: '❌', 'dry-run': '🧪' }[r.status] || '✅'} [${r.niche}/${r.kind || '-'}] ${r.keyword} | ${r.words ?? '-'} words | ${r.link || r.reason || r.error || r.status}`));
  console.log(`\n${USAGE.calls} OpenAI calls | ${USAGE.prompt} in / ${USAGE.completion} out tokens | ~$${cost.toFixed(3)} (${MODEL})`);
}

if (require.main === module) main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
module.exports = { writeTakeaways, claimsNotInSources, findAiPhrases, newsBlock };
