// Smartphone topic discovery from live Google data.
//  1. Google Trends daily trending searches (RSS, IN + US)  -> kept only if smartphone-related
//  2. Google News RSS (last 7 days) across phone brands/launch queries -> phone models in the headlines,
//     ranked by how many headlines mention them (a proxy for what is hot right now)
//  3. Google Autocomplete for each hot model -> the long-tail query people really type (price / launch date / specs...)
// Each topic carries the recent headlines so the article can be grounded in real reporting
// (the writing model has no knowledge of phones launched after its training cutoff).
const axios = require('axios');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const GEO = process.env.NEWS_GEO || 'IN';
const LANG = GEO === 'IN' ? 'en-IN' : 'en-US';

const PHONE_WORDS = /\b(iphone|ipad|galaxy|samsung|pixel|oneplus|nothing phone|cmf|redmi|poco|xiaomi|realme|vivo|iqoo|oppo|motorola|hmd|infinix|tecno|lava|smartphones?|android)\b/i;

const NEWS_QUERIES = [
  'smartphone launch', 'new phone launched India', 'upcoming smartphones', 'iPhone', 'Samsung Galaxy',
  'Google Pixel', 'OnePlus', 'Xiaomi Redmi Poco', 'Vivo iQOO', 'Oppo Realme', 'Motorola', 'Nothing Phone', 'phone review'
];

// Evergreen smartphone fallbacks if the news yields too little
const EVERGREEN = [
  'best phone under 20000', 'best camera phone under 30000', 'best gaming phone under 25000',
  'phone battery draining fast', 'phone overheating fix', 'how to free up storage on android'
];

const MODEL_RE = new RegExp(
  '\\b(?:' + [
    'iPhone\\s?(?:Air|\\d{1,2}[es]?)(?:\\s(?:Pro Max|Pro|Plus|e))?',
    'Galaxy\\s(?:S|A|M|F|Z Fold|Z Flip)\\s?\\d{1,2}(?:\\s(?:Ultra|Plus|FE|Edge))?',
    'Pixel\\s\\d{1,2}(?:\\s(?:Pro XL|Pro Fold|Pro|a))?',
    'OnePlus\\s(?:Nord\\s?(?:CE\\s?)?\\d*|\\d{1,2}[RT]?)(?:\\s(?:Pro|Plus))?',
    'Nothing Phone\\s?\\(?\\d+a?\\)?(?:\\sPro)?',
    'CMF Phone\\s\\d',
    '(?:Redmi|Poco|Realme|Vivo|iQOO|Oppo|Motorola|Moto|HMD|Infinix|Tecno|Lava|Honor|Xiaomi)\\s(?:Note\\s|Edge\\s|Narzo\\s|GT\\s|Neo\\s|Vibe\\s|Hot\\s|Spark\\s|Camon\\s|Pro\\s)?[A-Z]?\\d{1,3}[A-Za-z]?(?:\\s(?:Pro\\+?|Plus|Ultra|Neo|Lite|5G|Max|FE))*'
  ].join('|') + ')', 'gi');

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/<!\[CDATA\[|\]\]>/g, '');
const stripTags = s => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ───────────── Google Trends (daily trending searches) ─────────────
async function fetchTrendingToday(geo = GEO) {
  try {
    const r = await axios.get(`https://trends.google.com/trending/rss?geo=${geo}`, { timeout: 20000, headers: UA });
    return [...r.data.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const it = m[1];
      return {
        term: decode((it.match(/<title>(.*?)<\/title>/) || [])[1] || '').toLowerCase(),
        traffic: (it.match(/<ht:approx_traffic>(.*?)</) || [])[1] || '',
        headlines: [...it.matchAll(/<ht:news_item_title>(.*?)<\/ht:news_item_title>/g)].map(x => decode(x[1]))
      };
    });
  } catch (e) { return []; }
}

// ───────────── Google News ─────────────
async function fetchNews(query, days = 7, limit = 10) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:${days}d&hl=${LANG}&gl=${GEO}&ceid=${GEO}:en`;
    const r = await axios.get(url, { timeout: 20000, headers: UA });
    return [...r.data.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(m => {
      const it = m[1];
      const full = decode((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      const source = decode((it.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
      const title = source && full.endsWith(` - ${source}`) ? full.slice(0, -(source.length + 3)) : full;
      const link = decode((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
      return { title, source, link, date: ((it.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '').slice(5, 16) };
    });
  } catch (e) { return []; }
}

// ───────────── Google Autocomplete ─────────────
async function autocomplete(query) {
  try {
    const r = await axios.get('https://suggestqueries.google.com/complete/search', {
      params: { client: 'firefox', q: query, hl: 'en', gl: GEO.toLowerCase() }, timeout: 15000, headers: UA
    });
    return Array.isArray(r.data?.[1]) ? r.data[1] : [];
  } catch (e) { return []; }
}

// Real question-style queries for a keyword, used as FAQ hints
async function fetchQuestions(keyword) {
  const prefixes = ['how to', 'why', 'is', 'can', 'does', 'what is'];
  const lists = await Promise.all(prefixes.map(p => autocomplete(`${p} ${keyword}`)));
  const seen = new Set();
  return lists.flat().filter(q => {
    const k = q.toLowerCase();
    if (seen.has(k) || k.split(/\s+/).length < 4) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
}

// Every topic targets Indian searchers
const indiaKeyword = k => (/\bindia\b|under \d|₹|rs\.? ?\d/.test(k) ? k : `${k} in india`);
const modelKey = s => s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

// Returns { trendingToday, smartphoneTrends, topics: [{ keyword, model, score, trending, headlines }] }
async function discoverTopics(count = 5) {
  const trends = await fetchTrendingToday('IN'); // India focus
  const isPhone = txt => PHONE_WORDS.test(txt) || new RegExp(MODEL_RE.source, 'i').test(txt);
  const smartphoneTrends = trends.filter(t => isPhone(t.term) || t.headlines.some(isPhone));

  // Phone models mentioned across fresh news headlines
  const models = new Map(); // key -> { name, count, headlines[] }
  const newsBatches = await Promise.all(NEWS_QUERIES.map(q => fetchNews(q, 7, 15)));
  const seenHeadline = new Set();
  for (const item of newsBatches.flat()) {
    if (seenHeadline.has(item.title)) continue;
    seenHeadline.add(item.title);
    for (const raw of new Set(item.title.match(MODEL_RE) || [])) {
      const key = modelKey(raw);
      const m = models.get(key) || { name: raw.replace(/\s+/g, ' ').trim(), count: 0, headlines: [] };
      m.count++; m.headlines.push(item); models.set(key, m);
    }
  }

  const topics = [];
  const ranked = [...models.values()].sort((a, b) => b.count - a.count).slice(0, count * 4);
  for (const m of ranked) {
    const sugg = await autocomplete(m.name);
    const first = m.name.toLowerCase();
    // the long-tail query people really type for this model (price / launch date / specs ...)
    const best = sugg.find(s => s.toLowerCase().startsWith(first) && s.split(/\s+/).length > m.name.split(/\s+/).length) || `${m.name} price and specs`;
    const trending = smartphoneTrends.some(t => t.term.includes(first) || first.includes(t.term));
    topics.push({ keyword: indiaKeyword(best.toLowerCase()), model: m.name, score: m.count * 2 + (trending ? 6 : 0) + (sugg.length ? 1 : 0), trending, headlines: m.headlines.slice(0, 8) });
  }

  // Google-Trends smartphone searches become topics directly
  for (const t of smartphoneTrends) {
    topics.push({ keyword: indiaKeyword(t.term), model: t.term, score: 20, trending: true, headlines: t.headlines.map(title => ({ title, source: '', date: '' })) });
  }

  // Evergreen smartphone fallbacks to fill the quota
  if (topics.length < count * 2) EVERGREEN.forEach((k, i) => topics.push({ keyword: k, model: k, score: 1 - i * 0.01, trending: false, headlines: [] }));

  // de-dupe by keyword, best score first
  const seen = new Set();
  const uniq = topics.sort((a, b) => b.score - a.score).filter(t => !seen.has(t.keyword) && seen.add(t.keyword));
  return { trendingToday: trends.map(t => t.term), smartphoneTrends: smartphoneTrends.map(t => t.term), topics: uniq };
}

module.exports = { discoverTopics, fetchQuestions, fetchNews, fetchTrendingToday, autocomplete };

if (require.main === module) {
  discoverTopics(8).then(r => {
    console.log(`Google Trends today (${GEO}): ${r.trendingToday.slice(0, 12).join(' | ')}`);
    console.log(`Smartphone-related trending searches: ${r.smartphoneTrends.join(' | ') || '(none today)'}\n`);
    console.log('Smartphone topics (ranked):');
    r.topics.slice(0, 15).forEach(t => console.log(` ${t.trending ? '🔥' : '  '} ${t.keyword}  [${t.headlines.length} headlines, score ${t.score}]`));
  });
}
