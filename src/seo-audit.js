// Batch SEO audit (instruction #4 in CLAUDE-CODE-INSTRUCTIONS.md): scores posts 0-100 against the checklist
// in CLAUDE-CODE-SEO-MASTER.md / PRE-WRITING-SEO-CHECKLIST.md and writes reports to /audits.
// Works on drafts too (reads via the authenticated REST API).
// Usage: node src/seo-audit.js [--ids=589,591] [--registry]   (default: every post in published_registry.json)
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { unverifiedClaims } = require('./fact-check');

const { WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD } = process.env;
const WP = `${WORDPRESS_SITE}/wp-json/wp/v2`;
const AUTH = { Authorization: 'Basic ' + Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64') };
const OUT = path.join(__dirname, '..', 'audits');

const AI_TELLS = ['delve', 'game-changer', 'unlock', 'landscape', 'tapestry', 'it\'s important to note', 'in conclusion', 'moreover', 'furthermore',
  'seamless', 'robust', 'making waves', 'go-to', 'peace of mind', 'powerhouse', 'buttery', 'stunning', 'sets the bar', 'whether you\'re', 'look no further', 'comprehensive guide'];

const text = html => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => s.split(/\s+/).filter(Boolean).length;

async function audit(id, keyword) {
  const p = (await axios.get(`${WP}/posts/${id}?context=edit`, { headers: AUTH, timeout: 30000 })).data;
  const media = p.featured_media ? (await axios.get(`${WP}/media/${p.featured_media}`, { headers: AUTH })).data : null;
  const html = p.content.raw;
  const body = text(html);
  const title = p.title.raw;
  const meta = (p.excerpt.raw || '').trim();
  const kw = String(keyword || title).toLowerCase().replace(/ in india$/, '');
  const kwWords = kw.split(' ').filter(w => w.length > 2);
  const has = (s, k = kw) => String(s).toLowerCase().includes(k);
  const first100 = body.split(' ').slice(0, 100).join(' ').toLowerCase();
  const h2 = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(m => text(m[1]));
  const schema = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
  let types = [];
  try { const j = JSON.parse(schema); types = (j['@graph'] || [j]).map(x => x['@type']); } catch { /* none */ }
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)].map(m => ({ href: m[1], tag: m[0] }));
  const internal = links.filter(l => l.href.startsWith(WORDPRESS_SITE));
  const amazon = links.filter(l => /amazon\./.test(l.href));
  const external = links.filter(l => !l.href.startsWith(WORDPRESS_SITE) && !/amazon\.|unsplash\.com/.test(l.href));
  const imgs = [...html.matchAll(/<img [^>]*>/g)];
  const aiHits = AI_TELLS.filter(t => body.toLowerCase().includes(t));
  const faqs = [...html.matchAll(/<h3>([^<]*\?)<\/h3>/g)].length;

  // [points, check name, passed, tip]
  const checks = [
    [8, 'Title 40-65 chars', title.length >= 40 && title.length <= 65, `title is ${title.length} chars`],
    [6, 'Keyword in title', kwWords.every(w => has(title, w)), 'put the main keyword in the title'],
    [8, 'Meta description 120-160 chars', meta.length >= 120 && meta.length <= 160, `excerpt is ${meta.length} chars`],
    [4, 'Keyword in meta description', kwWords.every(w => has(meta, w)), 'mention the keyword in the excerpt'],
    [4, 'Slug short and keyword-based', p.slug.split('-').length <= 8 && kwWords.some(w => p.slug.includes(w)), `slug: ${p.slug}`],
    [6, 'Keyword in first 100 words', kwWords.every(w => first100.includes(w)), 'use the keyword in the first paragraph'],
    [8, 'Length 1,200+ words', words(body) >= 1200, `${words(body)} words`],
    [4, 'No H1 in body, 4+ H2s', !/<h1/.test(html) && h2.length >= 4, `${h2.length} H2s`],
    [4, 'Keyword/model in 2+ H2s', h2.filter(h => kwWords.some(w => has(h, w))).length >= 2, 'name the phone in at least two headings'],
    [8, 'FAQ section with 5+ questions', faqs >= 5, `${faqs} questions`],
    [10, 'Schema: NewsArticle + FAQPage + BreadcrumbList', ['NewsArticle', 'FAQPage', 'BreadcrumbList'].every(t => types.includes(t)), `found: ${types.join(', ') || 'none'}`],
    [6, 'Internal links (3+)', internal.length >= 3, `${internal.length} internal links`],
    [4, 'External source links (2+)', external.length >= 2, `${external.length} external links`],
    [4, 'Affiliate links tagged sponsored/nofollow', amazon.length > 0 && amazon.every(l => /sponsored/.test(l.tag)), `${amazon.length} Amazon links`],
    [4, 'Affiliate disclosure present', amazon.length === 0 || /Amazon Associate/.test(html), 'add the Associates disclosure'],
    [6, 'Featured image with alt text', !!media && !!media.alt_text, media ? 'alt text missing' : 'no featured image'],
    [4, 'Supporting image(s) with alt text', imgs.length >= 1 && imgs.every(i => /alt="[^"]+"/.test(i[0])), `${imgs.length} inline images`],
    [4, 'Table (quick facts)', /<table/.test(html), 'add a sourced facts table'],
    [4, 'No machine-sounding phrases', aiHits.length === 0, aiHits.length ? `found: ${aiHits.join(', ')}` : ''],
    [4, 'No ratings/reviews invented', !/\b\d(\.\d)?\s?\/\s?5\b|[★⭐]|\b(\d(\.\d)?|one|two|three|four|five)[- ]stars?\b|\bstar ratings?\b|\bout of 5\b/i.test(body), 'remove star ratings']
  ];
  const total = checks.reduce((a, c) => a + c[0], 0);
  const score = Math.round(checks.reduce((a, c) => a + (c[2] ? c[0] : 0), 0) / total * 100);
  return { id, title, link: p.link, status: p.status, words: words(body), score, failed: checks.filter(c => !c[2]).sort((a, b) => b[0] - a[0]).map(c => ({ check: c[1], points: c[0], note: c[3] })) };
}

async function main() {
  const idsArg = process.argv.find(a => a.startsWith('--ids='))?.slice(6);
  let targets;
  const reg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'published_registry.json'), 'utf8')); } catch { return { items: [] }; } })();
  if (idsArg) targets = idsArg.split(',').map(id => ({ id: +id, keyword: reg.items.find(i => i.post_id === +id)?.keyword }));
  else {
    targets = reg.items.map(i => ({ id: i.post_id, keyword: i.keyword }));
  }
  const res = [];
  for (const t of targets) { try { res.push(await audit(t.id, t.keyword)); } catch (e) { console.log(`❌ ${t.id}: ${e.response?.data?.message || e.message}`); } }
  res.sort((a, b) => b.score - a.score);

  fs.mkdirSync(OUT, { recursive: true });
  const scores = res.map(r => `${String(r.score).padStart(3)}/100  [${r.status}] ${r.title}  (post ${r.id}, ${r.words} words)`).join('\n');
  fs.writeFileSync(path.join(OUT, 'BATCH_AUDIT_SCORES.txt'), `BATCH SEO AUDIT - ${new Date().toISOString().slice(0, 10)}\n\n${scores}\n\nAverage: ${Math.round(res.reduce((a, r) => a + r.score, 0) / (res.length || 1))}/100\n`);
  fs.writeFileSync(path.join(OUT, 'PRIORITY_FIXES.txt'), res.slice().sort((a, b) => a.score - b.score)
    .map(r => `${r.title} (post ${r.id}) - ${r.score}/100\n${r.failed.slice(0, 5).map(f => `  - ${f.check}${f.note ? ': ' + f.note : ''}`).join('\n') || '  (no issues)'}`).join('\n\n'));
  const common = {};
  res.forEach(r => r.failed.forEach(f => (common[f.check] = (common[f.check] || 0) + 1)));
  fs.writeFileSync(path.join(OUT, 'COMMON_ISSUES.txt'), Object.entries(common).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}/${res.length} posts: ${k}`).join('\n') || 'No common issues');
  fs.writeFileSync(path.join(OUT, 'audit_results.json'), JSON.stringify(res, null, 2));

  console.log(scores);
  console.log(`\nAverage: ${Math.round(res.reduce((a, r) => a + r.score, 0) / (res.length || 1))}/100\n\nMost common issues:`);
  Object.entries(common).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([k, v]) => console.log(`  ${v}/${res.length}  ${k}`));
  console.log(`\nReports saved in ${OUT}`);
}

if (require.main === module) main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
