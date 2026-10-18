// Full pipeline: discover topics -> duplicate check -> write article section by section (~1200 words, FAQ,
// SEO metadata) -> Unsplash featured image -> WordPress post.
// Usage: node src/pipeline.js [--count=5] [--status=draft|publish] [--dry-run] [--keywords="a,b,c"]
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { discoverTopics, fetchQuestions, fetchNews } = require('./topic-discovery');
const { unverifiedClaims, dropSentencesWith } = require('./fact-check');
const { buildSchema, factsTable, sourcesHtml, figureHtml } = require('./seo-extras');

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const COUNT = parseInt(arg('count', '5'));
const STATUS = arg('status', 'draft');
const DRY_RUN = process.argv.includes('--dry-run');
const KEYWORDS = arg('keywords', '') ? arg('keywords').split(',').map(s => s.trim()).filter(Boolean) : null;

const { WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD, OPENAI_API_KEY, UNSPLASH_ACCESS_KEY } = process.env;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const WP = `${WORDPRESS_SITE}/wp-json/wp/v2`;
const WP_AUTH = { Authorization: 'Basic ' + Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64') };
const REGISTRY_FILE = path.join(__dirname, '..', 'published_registry.json');
const EXCLUDE_TOPIC = /\b(download|full form|login|free|crack|torrent)\b/i;

// Section plan: ~1200 words total
const PLAN = { intro: 130, body: 3, bodyWords: 230, faqQuestions: 7, faqAnswerWords: 45, conclusion: 100 };

const log = m => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────── OpenAI ───────────────────────────
// Token accounting from the usage object OpenAI returns on every call
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

const TODAY = new Date().toISOString().slice(0, 10);
const AUDIENCE = process.env.SITE_AUDIENCE || 'smartphone buyers and tech fans in India';

// Phrases that make text read as machine-written. Used both in the prompt and as a post-check.
const AI_PHRASES = [
  'in today\'s fast-paced', 'in today\'s digital', 'ever-evolving', 'delve', 'game-changer', 'game changer', 'unlock', 'landscape',
  'tapestry', 'it\'s important to note', 'it\'s worth noting', 'it is important to', 'in conclusion', 'to sum up', 'in summary',
  'look no further', 'comprehensive guide', 'ultimate guide', 'navigate', 'elevate', 'seamless', 'robust', 'realm', 'testament',
  'moreover', 'furthermore', 'additionally', 'firstly', 'secondly', 'not only', 'whether you\'re', 'whether you are', 'cutting-edge',
  'state-of-the-art', 'revolutionize', 'embark', 'dive into', 'dive in', 'myriad', 'plethora', 'boasts', 'a must-have', 'take your',
  'making waves', 'go-to', 'peace of mind', 'smart move', 'sleek', 'stylish', 'attractive', 'a splash', 'snag', 'solid choice', 'sweet spot', 'striking',
  'generating a buzz', 'buzz', 'powerhouse', 'buttery', 'stunning', 'sets the bar', 'in the right place', 'eager to', 'much-anticipated', 'might just be', 'enticing', 'impressive', 'sets the stage', 'stands out', 'in the world of', 'at the end of the day', 'when it comes to', 'bustling', 'vibrant', 'crucial', 'pivotal'
];
const AI_RE = new RegExp('(' + AI_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
const findAiPhrases = text => [...new Set((text.match(AI_RE) || []).map(s => s.toLowerCase()))];

const SYSTEM = `You are a veteran Indian smartphone journalist writing for ${AUDIENCE}. You've covered phone launches for years and write the way a good tech editor talks: direct, specific, a little opinionated, never salesy.
Today's date is ${TODAY}; the current year is ${TODAY.slice(0, 4)}.

INDIA FOCUS: write for Indian buyers. Use ₹ for prices, think about what matters here (price bands like under ₹15,000 / ₹20,000 / ₹30,000, Amazon/Flipkart sales, service centres, 5G bands, battery and heat in Indian summers, India launch and availability). Mention India explicitly where it matters.

VOICE
- Plain words, contractions, short sentences mixed with longer ones. An occasional one-line paragraph or sentence fragment is fine.
- Take a position where the facts support one (who should buy, who should skip, what to wait for). Concrete beats vague: name the phone, the trade-off, the use case.
- Never claim personal hands-on testing, owning or using the device, or invent anecdotes, quotes or user reviews. Write as an informed editor reporting and analysing, using "you" and "we" naturally.
- Write mostly in flowing prose. At most ONE short bullet list in the whole article, and never in the "Bold label: sentence" pattern. Each section must add something new: do not restate price/availability/sale details already covered in an earlier section.
- No rhetorical-question openers. No "Whether you're a X or a Y". No lists of exactly three vague adjectives. No sentence at the end of a paragraph that just repeats the paragraph. At most one em dash per section. Headings are plain and specific, sentence case.
- Never use these (they read as machine-written): ${AI_PHRASES.slice(0, 45).join(', ')}, or "Moreover/Furthermore/Additionally/Firstly".

FACTS
- Use ONLY specifics found in the "recent reporting" notes you are given (launch dates, prices, specs, rankings). Anything else must stay general. Never invent prices, specs, benchmarks, dates or statistics.
- Do not describe battery life, camera quality, performance, display, build or software as good/bad/improved/durable unless the reporting says so. Nobody on this site has tested these phones. Say what buyers should look for and that independent reviews will settle it.
- Never name a chipset, OS version, water-resistance rating or glass type unless it appears in the reporting.
- If a detail is unconfirmed or from a leak, say so once ("reportedly", "expected") instead of hedging every sentence. Tell readers to confirm final price and offers on the brand's site or Amazon/Flipkart.`;

function newsBlock(news) {
  if (!news?.length) return 'Recent reporting: none found. Keep everything general and evergreen; do not state model-specific facts.';
  return 'Recent reporting (headlines, your only source of model-specific facts):\n' +
    news.slice(0, 8).map(n => `- ${n.title}${n.source ? ` (${n.source}${n.date ? ', ' + n.date : ''})` : ''}`).join('\n');
}

async function planArticle(keyword, questions, news) {
  const prompt = `Plan an SEO article for the search query: "${keyword}" (audience: Indian smartphone buyers).
${newsBlock(news)}
Real related questions people search (use as inspiration for the FAQ): ${JSON.stringify(questions)}
Return JSON with exactly these keys:
- title: 50-60 characters, written like a real news/tech-site headline, includes the keyword (or a very close form) near the start. No "Guide", "Comprehensive", "Ultimate", "Everything you need to know", no colon-subtitle formula, no year unless it matters.
- meta_description: 140-155 characters, includes the keyword, plain and specific, not salesy
- slug: lowercase-hyphenated, max 6 words, includes the keyword
- category: "Smartphones"
- tags: array of 3-5 short tags (brand, model, topic)
- image_query: 2-3 concrete, photographable words for a stock photo search (e.g. "smartphone camera", "phone charging"; no brand names, no text)
- h2_headings: array of exactly ${PLAN.body} distinct H2 headings, plain and specific (like a person would write, not keyword-stuffed); at least 2 of them must contain the phone's name or the main keyword
- faq: array of exactly ${PLAN.faqQuestions} distinct questions Indian buyers actually ask (natural phrasing, each answerable in ~${PLAN.faqAnswerWords} words)`;
  return JSON.parse(await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], { json: true, maxTokens: 700 }));
}

// Rewrite once if the text contains machine-sounding phrases
async function deAi(text) {
  const hits = findAiPhrases(text);
  if (!hits.length) return text;
  let best = text, bestHits = hits.length;
  for (let attempt = 0; attempt < 3 && bestHits > 0; attempt++) { // keep the version with the fewest machine-sounding phrases
    const cur = findAiPhrases(best);
    const fixed = await chat([{ role: 'system', content: SYSTEM }, {
      role: 'user',
      content: `Rewrite this text so it no longer contains these words or phrases: ${cur.join(', ')}. Replace each with plain, everyday wording (not a synonym that sounds just as formal). Keep the meaning, facts, markdown formatting and length. Return only the rewritten text.\n\n${best}`
    }], { maxTokens: 1000, temperature: 0.8 });
    const n = findAiPhrases(fixed).length;
    if (n < bestHits) { best = fixed; bestHits = n; }
  }
  return best;
}

// De-AI the wording, then strip any price/spec/date that is not in the source headlines
async function polish(text, allowed) {
  text = await deAi(text);
  let bad = unverifiedClaims(text, allowed);
  if (!bad.length) return text;
  const fixed = await chat([{ role: 'system', content: SYSTEM }, {
    role: 'user',
    content: `These specifics are NOT supported by the source headlines and must not appear: ${bad.join(' | ')}.\nRewrite the text with each of them removed or replaced by general wording (e.g. "a mid-range price", "a large battery"). Do not add any new numbers, prices, specs or dates. Keep the tone, markdown and length as close as possible. Return only the text.\n\n${text}`
  }], { maxTokens: 1000, temperature: 0.6 });
  bad = unverifiedClaims(fixed, allowed);
  return bad.length ? dropSentencesWith(fixed, bad) : fixed;
}
const allowedFacts = (news, keyword, title) => `${(news || []).map(n => n.title).join(' ')} ${keyword} ${title} ₹15,000 ₹20,000 ₹30,000 5G`;

async function writeSection(kind, meta, keyword, words, heading, written, news) {
  const common = `Article title: "${meta.title}". Primary keyword: "${keyword}".
${newsBlock(news)}
Already written headings (do not repeat their content): ${JSON.stringify(written)}.
Write at least ${words} words (aim for ${Math.round(words * 1.1)}). Markdown only. Do NOT output the section heading itself.`;
  const specific = {
    intro: `Write the introduction. Open with the actual news or the reader's real situation, not a generic scene-setter. Use the primary keyword naturally within the first two sentences. Say plainly what this article answers. No lists.`,
    body: `Write the body section for the H2 "${heading}". Be specific and useful: real trade-offs, who it suits, what to check. Use a short bullet list or one H3 only if it genuinely helps. Don't number items as "1. **Name**" headings; use H3 for sub-sections.`,
    conclusion: `Write the closing section: your honest take in 2-3 sentences (who should buy or wait), then one natural line inviting comments. No new facts, no "in conclusion".`
  }[kind];
  const text = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: `${common}\n\n${specific}` }], { maxTokens: 900, temperature: 0.85 });
  // the model sometimes repeats the section heading as its first line
  const lines = text.split('\n');
  const first = norm(lines[0].replace(/^#+\s*/, ''));
  if (heading && first && (first === norm(heading) || (lines[0].startsWith('#') && first.length < 120))) lines.shift();
  return polish(lines.join('\n').trim(), allowedFacts(news, keyword, meta.title));
}

async function writeFaq(meta, keyword, news) {
  const prompt = `Answer these FAQ questions about "${keyword}" for Indian buyers. Each answer: ${PLAN.faqAnswerWords}-${PLAN.faqAnswerWords + 15} words, direct (answer in the first sentence), conversational plain text, no markdown. If the reporting does not cover a question, say plainly what is not confirmed yet and where to check (brand site, Amazon/Flipkart); never guess specs, prices or dates.
${newsBlock(news)}
Questions: ${JSON.stringify(meta.faq)}
Return JSON: {"faq":[{"question":"...","answer":"..."}]} keeping the questions as given.`;
  const faq = JSON.parse(await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], { json: true, maxTokens: 900, temperature: 0.8 })).faq;
  for (const f of faq) f.answer = (await polish(f.answer, allowedFacts(news, keyword, meta.title))).replace(/\s+/g, ' ').trim();
  return faq;
}

// "Quick facts" table: rows only from the source headlines, each value re-checked by the fact-checker
async function writeFacts(keyword, title, news) {
  if (!news?.length) return [];
  const prompt = `From ONLY the headlines below, extract up to 6 concrete facts about "${keyword}" for a quick-facts table (e.g. launch status, launch date, price, RAM/storage variants, battery, chipset, where it is sold). Skip anything the headlines do not state. Each value max 12 words, plain text.
${newsBlock(news)}
Return JSON: {"rows":[{"label":"...","value":"..."}]}`;
  try {
    const rows = JSON.parse(await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], { json: true, maxTokens: 500, temperature: 0.2 })).rows || [];
    const allowed = allowedFacts(news, keyword, title);
    const EMPTY = /not (mentioned|specified|confirmed|available|announced|disclosed)|unknown|n\/a|tbd|to be (announced|confirmed)|unconfirmed/i;
    return rows.filter(r => r.label && r.value && !EMPTY.test(r.value) && !unverifiedClaims(`${r.label} ${r.value}`, allowed).length).slice(0, 6);
  } catch (e) { return []; }
}

// ─────────────────────────── HTML ───────────────────────────
const decodeEntities = s => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mdToHtml(md) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trim(); let m;
    if (!line) continue; // blank lines don't end a list; the next non-list line does
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); } // body sections sit under an H2
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\d+[.)]\s+\*\*([^*]+)\*\*:?$/))) { close(); out.push(`<h3>${esc(m[1])}</h3>`); } // "1. **Name**" is a subheading, not a list item
    else if ((m = line.match(/^(\d+)[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push(`<ol start="${m[1]}">`); list = 'ol'; } out.push(`<li>${inline(m[2])}</li>`); }
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('\n');
}

const countWords = s => s.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

// Amazon Associates search link for the product being written about (no PA-API needed). Null if no tag is configured.
const AMAZON_TAG = process.env.AMAZON_AFFILIATE_TAG;
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || 'www.amazon.in';
function amazonLink(topic) {
  if (!AMAZON_TAG) return null;
  const STRIP = ['in india', 'price', 'launch date', 'specs and features', 'specs', 'review'];
  const term = STRIP.reduce((t, w) => t.split(w).join(' '), String(topic).toLowerCase()).split(' ').filter(Boolean).join(' ');
  return { term, url: `https://${AMAZON_DOMAIN}/s?k=${encodeURIComponent(term)}&tag=${encodeURIComponent(AMAZON_TAG)}` };
}
const AFF_ATTR = 'target="_blank" rel="sponsored nofollow noopener"';

function buildHtml({ meta, intro, bodies, faq, conclusion, related, photo, affiliate, facts, sources, figure, schema }) {
  const parts = [];
  if (affiliate) parts.push('<p><em>Disclosure: this post contains Amazon affiliate links. As an Amazon Associate we earn from qualifying purchases, at no extra cost to you.</em></p>');
  parts.push(mdToHtml(intro));
  if (affiliate) parts.push(`<p><strong>Want to see what it costs right now?</strong> <a href="${esc(affiliate.url)}" ${AFF_ATTR}>Check current prices for ${esc(affiliate.term)} on Amazon.in</a>.</p>`);
  if (facts) parts.push(facts);
  meta.h2_headings.forEach((h, i) => {
    parts.push(`<h2>${esc(h)}</h2>`, mdToHtml(bodies[i]));
    if (i === 0 && figure) parts.push(figure); // supporting image after the first body section
  });
  parts.push('<h2>Frequently Asked Questions</h2>');
  faq.forEach(f => parts.push(`<h3>${esc(f.question)}</h3>`, `<p>${esc(f.answer)}</p>`));
  parts.push('<h2>Conclusion</h2>', mdToHtml(conclusion));
  if (affiliate) parts.push(`<p><a href="${esc(affiliate.url)}" ${AFF_ATTR}>See ${esc(affiliate.term)} deals on Amazon.in</a> (prices and offers change often, so check before you buy).</p>`);
  if (related.length) {
    parts.push('<h2>Related reading</h2>', '<ul>' + related.map(p => `<li><a href="${esc(p.link)}">${esc(p.title)}</a></li>`).join('') + '</ul>');
  }
  if (sources) parts.push(sources);
  if (photo) {
    parts.push(`<p><em>Featured photo by <a href="${esc(photo.user_url)}?utm_source=potatotech&utm_medium=referral">${esc(photo.user)}</a> on <a href="https://unsplash.com/?utm_source=potatotech&utm_medium=referral">Unsplash</a></em></p>`);
  }
  if (schema) parts.push(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`);
  return parts.join('\n');
}

// ─────────────────────────── Duplicate detection ───────────────────────────
const STOP = new Set('a an the and or of to in on for with how to is are what why best guide your you my vs 2024 2025 2026 2027'.split(' '));
const norm = s => String(s).toLowerCase().replace(/&amp;|&#\d+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = s => new Set(norm(s).split(' ').filter(w => w && !STOP.has(w)));
function jaccard(a, b) { const i = [...a].filter(x => b.has(x)).length; return i / (a.size + b.size - i || 1); }

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
    } catch (e) {
      if (e.response?.status === 400) break; // past last page
      throw e;
    }
  }
  return all;
}

// Returns the conflicting existing item, or null
function findDuplicate({ keyword, title, slug }, existing) {
  const kt = tokens(keyword);
  const tt = title ? tokens(title) : null;
  for (const e of existing) {
    const et = tokens(e.title);
    if (slug && e.slug === slug) return e;
    if (title && norm(title) === norm(e.title)) return e;
    if (e.keyword && norm(e.keyword) === norm(keyword)) return e;
    if (kt.size && [...kt].every(w => et.has(w))) return e;           // existing title already covers the keyword
    if (tt && jaccard(tt, et) >= 0.6) return e;                          // near-identical title
    if (e.keyword && jaccard(kt, tokens(e.keyword)) >= 0.75) return e;  // near-identical keyword
  }
  return null;
}

// ─────────────────────────── Unsplash ───────────────────────────
// Tries the model's query, then generic phone queries; the model sometimes returns a list instead of a string
// Returns up to `n` unused photos (first = featured, second = supporting image)
async function findPhotos(imageQuery, usedIds, keyword, n = 2) {
  const first = (Array.isArray(imageQuery) ? imageQuery.join(' ') : String(imageQuery || '')).trim().slice(0, 80);
  for (const q of [first, 'smartphone', 'mobile phone close up', 'phone technology'].filter(Boolean)) {
    try {
      const p = await pickPhotos(q, usedIds, keyword, n);
      if (p.length) return p;
    } catch (e) { log(`   ⚠️  Unsplash search '${q}' failed: ${e.response?.status} ${JSON.stringify(e.response?.data?.errors || e.message)}`); }
  }
  return [];
}

let unsplashRemaining = Infinity; // demo keys allow 50 requests/hour
async function pickPhotos(query, usedIds, keyword = query, n = 2) {
  const r = await axios.get('https://api.unsplash.com/search/photos', {
    params: { query, per_page: 15, orientation: 'landscape', content_filter: 'high' },
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }, timeout: 20000
  });
  unsplashRemaining = Number(r.headers['x-ratelimit-remaining'] ?? Infinity);
  if (unsplashRemaining < 8) n = 1; // keep headroom: featured image only
  const BRANDS = ['iphone', 'apple', 'android', 'samsung', 'pixel', 'windows', 'macbook', 'dell', 'hp', 'lenovo', 'asus', 'sony', 'bose', 'google', 'ipad', 'tablet', 'laptop', 'computer', 'watch'];
  const kw = String(keyword).toLowerCase();
  const clashes = x => { const a = `${x.alt_description || ''} ${x.description || ''}`.toLowerCase(); return BRANDS.some(b => a.includes(b) && !kw.includes(b)); };
  return r.data.results.filter(x => !usedIds.includes(x.id) && !clashes(x)).slice(0, n).map(p => ({
    id: p.id, url: p.urls.regular, alt: p.alt_description || p.description || query,
    user: p.user.name, user_url: p.user.links.html, download_location: p.links.download_location
  }));
}

async function uploadPhoto(photo, keyword, title) {
  // Unsplash API guideline: trigger the download endpoint when a photo is used
  await axios.get(photo.download_location, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }, timeout: 20000 }).catch(() => {});
  const img = await axios.get(photo.url, { responseType: 'arraybuffer', timeout: 60000 });
  if (!String(img.headers['content-type']).startsWith('image/') || img.data.length < 5000) throw new Error('Unsplash image download invalid');
  const form = new FormData();
  form.append('file', Buffer.from(img.data), { filename: `${norm(keyword).replace(/ /g, '-')}.jpg`, contentType: 'image/jpeg' });
  const up = await axios.post(`${WP}/media`, form, { headers: { ...form.getHeaders(), ...WP_AUTH }, timeout: 90000, maxBodyLength: Infinity });
  const alt = String(photo.alt).charAt(0).toUpperCase() + String(photo.alt).slice(1, 120); // describe the photo itself
  await axios.post(`${WP}/media/${up.data.id}`, {
    alt_text: alt, title, caption: `Photo by ${photo.user} on Unsplash`
  }, { headers: WP_AUTH, timeout: 30000 });
  return { id: up.data.id, source_url: up.data.source_url };
}

// ─────────────────────────── WordPress helpers ───────────────────────────
async function getOrCreateTerm(taxonomy, name) {
  const found = await axios.get(`${WP}/${taxonomy}`, { params: { search: name, per_page: 20 }, headers: WP_AUTH });
  const hit = found.data.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (hit) return { id: hit.id, name: hit.name, link: hit.link };
  try {
    const made = await axios.post(`${WP}/${taxonomy}`, { name }, { headers: WP_AUTH });
    return { id: made.data.id, name: made.data.name, link: made.data.link };
  } catch (e) {
    if (e.response?.data?.code === 'term_exists') { // same slug, different spelling
      const t = (await axios.get(`${WP}/${taxonomy}/${e.response.data.data.term_id}`, { headers: WP_AUTH })).data;
      return { id: t.id, name: t.name, link: t.link };
    }
    throw e;
  }
}

function relatedPosts(existing, keyword, limit = 4) {
  const GENERIC = new Set(['india', 'indian', 'price', 'phone', 'phones', 'review', 'launch', 'launched', 'specs', 'features', 'buyers', 'guide']);
  const topical = t => new Set([...t].filter(w => !GENERIC.has(w)));
  const kt = topical(tokens(keyword));
  return existing.filter(p => p.status === 'publish')
    .map(p => { const pt = topical(tokens(p.title)); return { ...p, shared: [...kt].filter(w => pt.has(w)).length, score: jaccard(kt, pt) }; })
    .filter(p => p.shared >= 1 && p.score >= 0.15)
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

// Fill up to 3 internal links: topical matches first, then the newest published smartphone posts
const PHONE_TITLE = new RegExp('phone|iphone|galaxy|pixel|oneplus|vivo|oppo|iqoo|nothing|redmi|realme|android|motorola|poco', 'i');
function internalLinks(existing, keyword) {
  const picked = relatedPosts(existing, keyword);
  for (const p of existing) {
    if (picked.length >= 3) break;
    if (p.status === 'publish' && PHONE_TITLE.test(p.title) && !picked.some(x => x.id === p.id) && !findDuplicate({ keyword, title: '' }, [p]) ) picked.push(p);
  }
  return picked;
}

// ─────────────────────────── Main ───────────────────────────
async function main() {
  console.log(`\nPipeline: ${COUNT} articles | status=${STATUS}${DRY_RUN ? ' | DRY RUN (nothing sent to WordPress)' : ''} | model=${MODEL}\n`);
  for (const k of ['OPENAI_API_KEY', 'UNSPLASH_ACCESS_KEY', 'WORDPRESS_SITE', 'WORDPRESS_USERNAME', 'WORDPRESS_PASSWORD']) {
    if (!process.env[k]) throw new Error(`${k} missing in .env`);
  }

  const registry = loadRegistry();
  const wpPosts = await fetchExistingPosts();
  const existing = [...wpPosts, ...registry.items];
  log(`Duplicate index: ${wpPosts.length} WordPress posts + ${registry.items.length} registry entries`);

  // Topics
  let candidates;
  if (KEYWORDS) candidates = KEYWORDS.map(keyword => ({ keyword }));
  else {
    const d = await discoverTopics(COUNT);
    log(`Google Trends (India) today: ${d.trendingToday.slice(0, 5).join(" | ")}`);
    log(`Smartphone trending searches: ${d.smartphoneTrends.join(" | ") || "none today -> using phones making headlines in Google News"}`);
    candidates = d.topics.filter(t => !EXCLUDE_TOPIC.test(t.keyword));
  }

  const results = [];
  const batch = []; // keywords/titles used in this run
  for (const cand of candidates) {
    if (results.filter(r => r.status !== 'skipped').length >= COUNT) break;
    const keyword = cand.keyword;
    const row = { keyword };

    const dup0 = findDuplicate({ keyword }, [...existing, ...batch]);
    if (dup0) { log(`⏭️  SKIP "${keyword}" - duplicate of "${dup0.title || dup0.keyword}"`); results.push({ ...row, status: 'skipped', reason: `duplicate of ${dup0.title || dup0.keyword}` }); continue; }

    const usageBefore = { ...USAGE };
    try {
      log(`\n📝 "${keyword}"`);
      const [questions, fetched] = await Promise.all([fetchQuestions(keyword), cand.headlines?.length ? null : fetchNews(keyword, 14, 8)]);
      const news = cand.headlines?.length ? cand.headlines : fetched;
      log(`   📰 ${news.length} recent headlines used as source material`);
      // Quality guard: too little reporting means a padded article. Evergreen topics (no model-specific facts needed) are exempt.
      const MIN_HEADLINES = parseInt(process.env.MIN_HEADLINES || '3');
      if (cand.model && cand.headlines && news.length < MIN_HEADLINES) {
        log(`⏭️  SKIP "${keyword}" - only ${news.length} headline(s), need ${MIN_HEADLINES}+ for a well-sourced article`);
        results.push({ ...row, status: 'skipped', reason: `only ${news.length} source headline(s)` });
        continue;
      }
      const meta = await planArticle(keyword, questions, news);
      row.title = meta.title;

      const dup1 = findDuplicate({ keyword, title: meta.title, slug: meta.slug }, [...existing, ...batch]);
      if (dup1) { log(`⏭️  SKIP - generated title/slug duplicates "${dup1.title || dup1.keyword}"`); results.push({ ...row, status: 'skipped', reason: `duplicate of ${dup1.title || dup1.keyword}` }); continue; }

      // Write section by section (sequential so each knows what came before)
      const written = [];
      const intro = await writeSection('intro', meta, keyword, PLAN.intro, null, written, news); written.push('Introduction');
      const bodies = [];
      for (const h of meta.h2_headings) { bodies.push(await writeSection('body', meta, keyword, PLAN.bodyWords, h, written, news)); written.push(h); }
      const faq = await writeFaq(meta, keyword, news);
      const conclusion = await writeSection('conclusion', meta, keyword, PLAN.conclusion, null, written, news);

      const photos = await findPhotos(meta.image_query, registry.unsplash_ids, keyword, 2);
      const photo = photos[0];
      if (!photo) throw new Error('no Unsplash photo found');
      const photo2 = photos[1] || null;

      const related = internalLinks(wpPosts, keyword);
      const affiliate = amazonLink(keyword); // keyword keeps variants like "Pro"; cand.model may drop them
      const factRows = await writeFacts(keyword, meta.title, news);
      const facts = factsTable(factRows);
      const sources = sourcesHtml(news);
      const isProduct = !!(cand.model && cand.headlines?.length); // phone-model topics only
      const baseArgs = { meta, intro, bodies, faq, conclusion, related, photo, affiliate, facts, sources };
      let html = buildHtml({ ...baseArgs, figure: null, schema: null });
      row.words = countWords(html.replace(/<script[\s\S]*?<\/script>/g, ''));
      row.faq = faq.length;
      row.image = photo.id;
      row.facts = factRows.length;
      row.sources = (sources.match(/<li>/g) || []).length;
      row.internal_links = related.length;
      row.tokens = { calls: USAGE.calls - usageBefore.calls, input: USAGE.prompt - usageBefore.prompt, output: USAGE.completion - usageBefore.completion };
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
        // Now the canonical URL is known: add NewsArticle + Breadcrumb + FAQ (+ Product) schema
        const schema = buildSchema({
          meta, faq, url: post.data.link, imageUrl: media.source_url, category: cat,
          site: WORDPRESS_SITE, siteName: process.env.SITE_NAME || 'Potato Tech',
          product: isProduct ? (affiliate?.term || keyword).replace(/\b\w/g, c => c.toUpperCase()).replace(/Iphone/g, 'iPhone').replace(/Iqoo/g, 'iQOO') : null, datePublished: new Date().toISOString()
        });
        await axios.post(`${WP}/posts/${post.data.id}`, { content: buildHtml({ ...baseArgs, figure, schema }) }, { headers: WP_AUTH, timeout: 60000 });
        Object.assign(row, { status: post.data.status, post_id: post.data.id, link: post.data.link, media_id: media.id });
        registry.items.push({ keyword, title: meta.title, slug: post.data.slug, post_id: post.data.id, status: post.data.status, link: post.data.link, date: new Date().toISOString() });
        registry.unsplash_ids.push(photo.id, ...(media2 ? [photo2.id] : []));
        saveRegistry(registry);
        log(`   ✅ posted as ${row.status}: ${row.link}`);
      } else {
        row.status = 'dry-run';
        fs.writeFileSync(path.join(__dirname, '..', `dryrun_${norm(keyword).replace(/ /g, '-')}.html`), html);
      }
      batch.push({ keyword, title: meta.title, slug: meta.slug });
      results.push(row);
    } catch (e) {
      row.status = 'error'; row.error = `${e.response?.data?.message || e.response?.data?.error?.message || e.message} [${String(e.config?.url || '').split('/').slice(3).join('/')}]`;
      log(`   ❌ ${row.error}`);
      results.push(row);
    }
  }

  fs.writeFileSync(path.join(__dirname, '..', 'pipeline_results.json'), JSON.stringify(results, null, 2));
  console.log('\n' + '═'.repeat(70));
  results.forEach(r => console.log(`${{ skipped: '⏭️ ', error: '❌', 'dry-run': '🧪' }[r.status] || '✅'} ${r.keyword} | ${r.words ?? '-'} words | ${r.link || r.reason || r.error || r.status}`));
}

if (require.main === module) main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
module.exports = { findDuplicate, tokens, norm, SYSTEM, newsBlock };
