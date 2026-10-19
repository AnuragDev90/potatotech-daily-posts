// Daily orchestrator for the cloud (GitHub Actions) or local use:
//   1. discover today's topics (smartphones / Tesla and tech / offers) from Google News headlines
//   2. generate the posts with src/pipeline-multi-niche.js (always as drafts)
//   3. gate each draft: SEO audit score, length, YouTube embed
//   4. schedule the ones that pass (status=future, 45+ minutes apart, spread through the day); the rest stay drafts
//   5. write reports/YYYY-MM-DD.md (and the GitHub job summary)
// Usage: node src/daily-run.js [--count=5] [--min-score=100] [--no-schedule] [--discover-only]
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { fetchNews } = require('./topic-discovery');
const gsc = require('./gsc');
let DEMAND = [];   // queries the site already earns impressions for (Search Console), used as a hint when choosing topics

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ROOT = path.join(__dirname, '..');
const COUNT = Math.min(20, Math.max(1, parseInt(arg('count', process.env.POSTS_PER_DAY || '8'))));
const MIN_SCORE = parseInt(arg('min-score', process.env.MIN_SCORE || '100'));
const MIN_WORDS = 1500;
const GAP_MIN = 45;
const NO_SCHEDULE = process.argv.includes('--no-schedule');
const DISCOVER_ONLY = process.argv.includes('--discover-only');
const { WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD, OPENAI_API_KEY } = process.env;
const WP = `${WORDPRESS_SITE}/wp-json/wp/v2`;
const AUTH = { Authorization: 'Basic ' + Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64') };
const MODEL = process.env.MULTI_NICHE_MODEL || 'gpt-4o-mini';
const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); // IST date, so the one-run-per-day guard follows the IST day

// One post per desk per day; the desks rotate so a 5-6 post day covers most of them and every desk comes up several times a week.
// niche = the pipeline category (mobile -> Smartphones, tech -> Technology, gpu -> Graphics Cards, gaming -> Gaming, flipkart/amazonsale -> sale pages)
const DESKS = {
  mobile: { niche: 'mobile', always: true, label: 'new smartphone launches, leaks and price drops in India (any brand)',
    queries: ['smartphone launch India', 'upcoming phones India', 'phone price cut India', 'Samsung Galaxy India launch', 'OnePlus Vivo OPPO Xiaomi realme India launch', 'phone leaks specs'] },
  apple: { niche: 'mobile', label: 'Apple products: iPhone, iPad, Mac, Apple Watch, AirPods, iOS updates and Apple India pricing',
    queries: ['Apple iPhone India', 'iOS update', 'Apple launch India price', 'MacBook iPad Apple Watch news', 'iPhone leak'] },
  android: { niche: 'mobile', label: 'Android and Google Pixel news: Pixel phones, Android updates, One UI, Samsung and Google software and features',
    queries: ['Google Pixel', 'Android 17 update', 'One UI update Samsung Galaxy', 'Android news new feature', 'Pixel India price launch'] },
  gpu: { niche: 'gpu', label: 'graphics cards and PC hardware: Nvidia GeForce RTX, AMD Radeon, Intel Arc, CPUs, prices and launches',
    queries: ['Nvidia GeForce RTX', 'AMD Radeon GPU', 'Intel Arc graphics card', 'graphics card price India', 'AMD Ryzen Intel Core launch'] },
  gaming: { niche: 'gaming', label: 'video games and gaming hardware: PlayStation, Xbox, Nintendo, Steam, mobile gaming and BGMI in India',
    queries: ['video game news', 'PlayStation 5 Xbox news', 'Nintendo Switch 2', 'Steam PC gaming', 'BGMI India', 'GTA 6'] },
  tech: { niche: 'tech', label: 'Tesla, electric vehicles, AI tools and general consumer tech (gadgets, laptops, chips, software); prefer stories with an India angle',
    queries: ['Tesla', 'Tesla India', 'electric vehicle India launch', 'new gadget launch India', 'laptop launch India', 'ChatGPT Gemini AI new feature', 'tech India'] },
  offers: { niche: 'amazonsale', label: 'shopping sales and phone/gadget offers in India (Amazon, Flipkart, bank offers, festive sales)',
    queries: ['Flipkart sale phone offers', 'Amazon Great Indian Festival offers', 'smartphone discount India bank offer', 'Diwali sale deals India phones', 'iPhone price drop Flipkart Amazon'] }
};

function pickDesks(n) { // "always" desks first, then the rest rotate by day of the year
  const names = Object.keys(DESKS), always = names.filter(k => DESKS[k].always), rest = names.filter(k => !DESKS[k].always);
  const day = Math.floor(Date.now() / 86400000), out = [...always];
  for (let i = 0; out.length < Math.min(n, names.length); i++) out.push(rest[(day * 2 + i) % rest.length]);
  return out;
}

async function chat(messages, maxTokens = 3000) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await axios.post('https://api.openai.com/v1/chat/completions', { model: MODEL, messages, temperature: 0.3, max_tokens: maxTokens, response_format: { type: 'json_object' } },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 120000 });
      return JSON.parse(r.data.choices[0].message.content);
    } catch (e) { if (i === 3) throw e; await new Promise(r => setTimeout(r, 4000 * i)); }
  }
}

async function existingTitles() {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    try {
      const r = await axios.get(`${WP}/posts`, { params: { per_page: 100, page, status: 'publish,draft,pending,future', _fields: 'title,date' }, headers: AUTH, timeout: 30000 });
      out.push(...r.data.map(p => p.title.rendered));
      if (r.data.length < 100) break;
    } catch { break; }
  }
  return out;
}

async function discover(desk, want, titles) {
  const seen = new Set(), heads = [];
  for (const q of DESKS[desk].queries) for (const n of await fetchNews(q, 3, 12)) {
    const k = n.title.toLowerCase().slice(0, 60);
    if (n.title && !seen.has(k)) { seen.add(k); heads.push(n); }
  }
  log(`${desk}: ${heads.length} fresh headlines`);
  if (heads.length < 6) return [];
  const list = heads.slice(0, 90).map((h, i) => `${i}. ${h.title} (${h.source}, ${h.date})`).join('\n');
  const out = await chat([
    { role: 'system', content: 'You are an editor choosing article topics from news headlines for an Indian tech blog.' },
    { role: 'user', content: `Desk: ${DESKS[desk].label}.\nGroup headlines about the SAME specific story or product and propose up to ${want + 2} distinct topics, strongest first (biggest, most searched, useful to readers in India).\nHARD RULES: no politics, crime, celebrity, sports, lawsuits or sensitive health; nothing about named private individuals; every topic needs a genuine India angle (price, availability, offers) or a clear tech angle. Each topic needs at least 4 headlines from at least 2 different outlets. Do not repeat anything already on the site: ${JSON.stringify(titles.slice(0, 120))}${DEMAND.length ? `
Search Console shows readers already find the site for these queries; when a headline group is close to one of them it is a good topic (extend, do not duplicate): ${JSON.stringify(DEMAND.slice(0, 25))}` : ''}\n\n${list}\n\nReturn JSON {"topics":[{"keyword":"2-5 lowercase words an Indian reader would search","niche":"${desk === 'offers' ? 'flipkart or amazonsale' : DESKS[desk].niche}","headline_ids":[...],"angle":"2-3 sentences: what the reader needs to know, and which claims are leaks or unconfirmed"}]}` }
  ]);
  return (out.topics || []).map(t => {
    const hs = [...new Set(t.headline_ids || [])].map(i => heads[i]).filter(Boolean).slice(0, 8);
    return { t, hs, outlets: new Set(hs.map(h => h.source)).size };
  }).filter(x => x.t.keyword && x.hs.length >= 4 && x.outlets >= 2).slice(0, want).map(({ t, hs }) => ({
    niche: desk === 'offers' ? (t.niche === 'flipkart' ? 'flipkart' : 'amazonsale') : DESKS[desk].niche, desk,
    latest: Math.max(0, ...hs.map(h => Date.parse(h.date) || 0)), // newest headline in the group, used to publish the freshest stories first
    keyword: String(t.keyword).toLowerCase().replace(/\s+/g, ' ').trim(), days: 3,
    queries: [String(t.keyword)],
    notes: hs.map(h => ({ title: h.title, link: h.link, source: h.source })),
    angle: `${t.angle || ''} Use only facts present in the supplied headlines. Label leaks, rumours and tipster claims as unconfirmed and attribute them to the outlet. Never state an unannounced price or date as official. Do not invent specifications, benchmarks or battery hours.`
  }));
}

function run(script, args) {
  const r = spawnSync('node', [path.join(__dirname, script), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  return r.status;
}

// IST (UTC+5:30) slots: start 50 min from now (not before 10:00 IST), then every 150 min, skipping 23:00-09:00 IST, keeping 45 min from already-scheduled posts
async function makeSlots(n) {
  let taken = [];
  try { taken = (await axios.get(`${WP}/posts`, { params: { status: 'future', per_page: 100, _fields: 'date_gmt' }, headers: AUTH })).data.map(p => Date.parse(p.date_gmt + 'Z')); } catch { /* none */ }
  const IST = 330 * 60000, istHour = ms => new Date(ms + IST).getUTCHours() + new Date(ms + IST).getUTCMinutes() / 60;
  // window 08:00-23:00 IST; spacing shrinks as the count grows (5 posts: 150 min apart, 15 posts: 56 min apart)
  const step = Math.max(GAP_MIN, Math.min(150, Math.floor(840 / n)));
  let t = Date.now() + 50 * 60000; const slots = [];
  const nextMorning = ms => { const d = new Date(ms + IST); d.setUTCHours(8, 0, 0, 0); let r = d.getTime() - IST; if (r < ms) r += 86400000; return r; };
  while (slots.length < n) {
    if (istHour(t) < 8 || istHour(t) >= 23) t = nextMorning(t);
    if (taken.some(x => Math.abs(x - t) < GAP_MIN * 60000)) { t += GAP_MIN * 60000; continue; }
    slots.push(t); taken.push(t); t += step * 60000;
  }
  return slots;
}

async function main() {
  if (fs.existsSync(path.join(ROOT, 'reports', `${today}.md`)) && !process.argv.includes('--force') && !DISCOVER_ONLY) { log(`reports/${today}.md already exists: today's run is done, skipping (use --force to run again)`); return; }
  for (const k of ['OPENAI_API_KEY', 'UNSPLASH_ACCESS_KEY', 'WORDPRESS_SITE', 'WORDPRESS_USERNAME', 'WORDPRESS_PASSWORD']) if (!process.env[k]) throw new Error(`${k} is not set`);
  const todays = pickDesks(COUNT);
  log(`Plan: ${COUNT} posts, desks today: ${todays.join(', ')}; gate: score >= ${MIN_SCORE}, ${MIN_WORDS}+ words, YouTube embed`);
  const titles = await existingTitles();
  let gscNote = 'Search Console: not available this run.';
  if (process.env.GSC_SERVICE_ACCOUNT_JSON) try {
    const q = await gsc.query({ days: 28, dimensions: ['query'], rowLimit: 40 });
    DEMAND = q.filter(r => r.impressions >= 20).map(r => r.keys[0]);
    const pg = await gsc.query({ days: 28, dimensions: ['page'], rowLimit: 100 });
    const refresh = pg.filter(r => r.impressions >= 100 && r.position > 10).slice(0, 8);
    const wk = await gsc.query({ days: 7, dimensions: ['date'], rowLimit: 10 });
    gscNote = `Search Console (28 days): ${pg.reduce((a, r) => a + r.clicks, 0)} clicks, ${pg.reduce((a, r) => a + r.impressions, 0)} impressions; last 7 days ${wk.reduce((a, r) => a + r.clicks, 0)} clicks. ${refresh.length ? 'Seen but ranking below page 1 (worth refreshing): ' + refresh.map(r => `${r.keys[0].replace(WORDPRESS_SITE, '')} (pos ${r.position.toFixed(0)}, ${r.impressions} imp)`).join('; ') : 'No pages stuck below page 1.'}`;
    log(gscNote);
  } catch (e) { gscNote = `Search Console error: ${e.response?.status || ''} ${e.message}`; log(gscNote); }
  const topics = [];
  const backups = Object.keys(DESKS).filter(d => !todays.includes(d));
  // Ask every desk for several topics (spread evenly), and gather ~60% more than needed to cover duplicates and posts that fail a gate.
  const wanted = Math.ceil(COUNT * 1.6), perDesk = Math.max(1, Math.ceil(wanted / Object.keys(DESKS).length));
  for (const d of [...todays, ...backups]) {
    try { topics.push(...await discover(d, perDesk, titles)); } catch (e) { log(`${d}: discovery failed: ${e.message}`); }
  }
  topics.sort((a, b) => (b.latest - a.latest) || (b.notes.length - a.notes.length)); // newest story first
  if (topics.length > wanted) topics.length = wanted;
  const toks = k => new Set(k.split(' ').filter(w => w.length > 2 && !['price', 'india', 'launch', 'details', 'features', 'best'].includes(w)));
  for (let i = topics.length - 1; i >= 0; i--) { // drop near-duplicate topics across desks (keep the first)
    const a = toks(topics[i].keyword);
    if (topics.slice(0, i).some(o => { const b = toks(o.keyword); const common = [...a].filter(w => b.has(w)).length; return common && common >= Math.min(a.size, b.size) * 0.5; })) { log(`dropping near-duplicate topic "${topics[i].keyword}"`); topics.splice(i, 1); }
  }
  log(`Topics: ${topics.map(t => `${t.niche}/${t.keyword}`).join(' | ') || 'none'}`);
  const topicsFile = path.join(ROOT, `daily_topics_${today}.json`);
  fs.writeFileSync(topicsFile, JSON.stringify(topics, null, 2));
  if (DISCOVER_ONLY) return;
  if (!topics.length) throw new Error('no usable topics found today');

  const resultsFile = path.join(ROOT, 'multi_niche_results.json');
  try { fs.unlinkSync(resultsFile); } catch { /* none */ }
  run('pipeline-multi-niche.js', [`--topics-file=${topicsFile}`, '--depth=deep', '--status=draft']);
  let results = [];
  try { results = JSON.parse(fs.readFileSync(resultsFile, 'utf8')); } catch { /* none */ }
  const made = results.filter(r => r.post_id);
  log(`Generated ${made.length} drafts; ${results.length - made.length} skipped or failed`);

  let audits = [];
  if (made.length) {
    run('seo-audit.js', [`--ids=${made.map(r => r.post_id).join(',')}`]);
    try { audits = JSON.parse(fs.readFileSync(path.join(ROOT, 'audits', 'audit_results.json'), 'utf8')); } catch { /* none */ }
  }
  const rows = [];
  for (const r of made) {
    const a = audits.find(x => x.id === r.post_id);
    const problems = [];
    if (!a) problems.push('audit did not run');
    else {
      if (a.score < MIN_SCORE) problems.push(`SEO ${a.score}/${MIN_SCORE}: ${a.failed.slice(0, 3).map(f => f.check).join('; ')}`);
      if (a.words < MIN_WORDS) problems.push(`only ${a.words} words`);
    }
    try {
      const html = (await axios.get(`${WP}/posts/${r.post_id}?context=edit`, { headers: AUTH, timeout: 30000 })).data.content.raw;
      if (!/youtube(-nocookie)?\.com\/embed/i.test(html)) problems.push('no YouTube embed');
      if (/undefined|\[object |NaN/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) problems.push('placeholder text in body');
      // every price in the post must appear in the headlines of at least 2 different outlets, otherwise it is held for a human check
      const src = (topics.find(t => t.keyword === r.keyword) || {}).notes || [];
      const body = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
      const figs = [...new Set((body.match(/(?:₹|Rs\.?\s?|\$)\s?\d[\d,]*(?:\.\d+)?/g) || []).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 3))];
      const thin = figs.filter(f => new Set(src.filter(n => n.title.replace(/\D/g, '').includes(f)).map(n => n.source)).size < 2);
      if (thin.length) problems.push(`price figure(s) not confirmed by 2+ outlets: ${thin.slice(0, 4).join(', ')}`);
    } catch (e) { problems.push(`could not re-read post: ${e.message}`); }
    rows.push({ ...r, score: a?.score, words: a?.words, problems });
  }

  const latestOf = r => (topics.find(t => t.keyword === r.keyword) || {}).latest || 0;
  const ok = rows.filter(r => !r.problems.length).sort((a, b) => latestOf(b) - latestOf(a)); // freshest story gets the earliest slot
  for (const extra of ok.splice(COUNT)) extra.problems.push(`spare: already have ${COUNT} posts scheduled today`);
  if (!NO_SCHEDULE && ok.length) {
    const slots = await makeSlots(ok.length);
    for (let i = 0; i < ok.length; i++) {
      try {
        const d = new Date(slots[i]).toISOString().slice(0, 19);
        await axios.post(`${WP}/posts/${ok[i].post_id}`, { status: 'future', date: new Date(slots[i] + 330 * 60000).toISOString().slice(0, 19), date_gmt: d }, { headers: AUTH, timeout: 30000 });
        ok[i].scheduled = new Date(slots[i]).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST';
        log(`Scheduled post ${ok[i].post_id} for ${ok[i].scheduled}`);
      } catch (e) { ok[i].problems.push(`scheduling failed: ${e.response?.data?.message || e.message}`); }
    }
  }

  const lines = [`# Daily run ${today}`, '', `Planned ${COUNT}; generated ${made.length}; scheduled ${rows.filter(r => r.scheduled).length}; left as drafts ${rows.filter(r => !r.scheduled).length}; skipped or failed ${results.length - made.length}.`, ''];
  lines.push(gscNote, '');
  for (const r of rows) lines.push(`- ${r.scheduled ? `SCHEDULED ${r.scheduled}` : 'DRAFT'} | ${r.title} | post ${r.post_id} | score ${r.score ?? '?'} | ${r.words ?? '?'} words${r.problems.length ? ' | held: ' + r.problems.join(' / ') : ''}`);
  for (const r of results.filter(x => !x.post_id)) lines.push(`- NOT CREATED | ${r.keyword} | ${r.reason || r.error || r.status}`);
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports', `${today}.md`), lines.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  console.log('\n' + lines.join('\n'));
  if (!made.length) throw new Error('no posts were created');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
