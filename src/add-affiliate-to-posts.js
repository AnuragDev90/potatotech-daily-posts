// Adds the Amazon.in affiliate block (disclosure + two links, rel="sponsored nofollow") to existing posts that have none.
// Same markup as pipeline-multi-niche.js. Usage: node src/add-affiliate-to-posts.js --ids=734,738 [--dry-run]
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const IDS = arg('ids', '').split(',').map(Number).filter(Boolean);
const DRY_RUN = process.argv.includes('--dry-run');
const { WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD, OPENAI_API_KEY, AMAZON_AFFILIATE_TAG } = process.env;
const DOMAIN = process.env.AMAZON_DOMAIN || 'www.amazon.in';
const WP = `${WORDPRESS_SITE}/wp-json/wp/v2`;
const AUTH = { Authorization: 'Basic ' + Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64') };
const ATTR = 'target="_blank" rel="sponsored nofollow noopener"';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function searchTerm(title) {
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 60, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `Article title: "${title}". Give a 2-4 word product search for Amazon.in that a reader of this article might genuinely buy (e.g. "gaming laptop", "graphics card", "ps5 controller", "gaming headset", "mechanical keyboard", "ai books"). Generic product category, no brand unless the article is about that brand's product. Never a person, event or subscription. Return JSON: {"amazon_search":"..."}` }]
  }, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 60000 });
  return String(JSON.parse(r.data.choices[0].message.content).amazon_search || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 40);
}

async function main() {
  if (!AMAZON_AFFILIATE_TAG) throw new Error('AMAZON_AFFILIATE_TAG missing in .env');
  for (const id of IDS) {
    const p = (await axios.get(`${WP}/posts/${id}?context=edit`, { headers: AUTH, timeout: 30000 })).data;
    let html = p.content.raw;
    if (/amazon\./.test(html)) { console.log(`${id}: already has Amazon links, skipped`); continue; }
    let term = await searchTerm(p.title.raw);
    if (term.length < 4) term = 'tech gadgets'; // every post gets a link
    const url = `https://${DOMAIN}/s?k=${encodeURIComponent(term)}&tag=${encodeURIComponent(AMAZON_AFFILIATE_TAG)}`;
    const disclosure = '<p><em>Disclosure: this post contains Amazon affiliate links. As an Amazon Associate we earn from qualifying purchases, at no extra cost to you.</em></p>';
    const top = `<p><strong>Want to see what it costs right now?</strong> <a href="${esc(url)}" ${ATTR}>Check current prices for ${esc(term)} on Amazon.in</a>.</p>`;
    const bottom = `<p><a href="${esc(url)}" ${ATTR}>See ${esc(term)} deals on Amazon.in</a> (prices and offers change often, so check before you buy).</p>`;
    const firstH2 = html.indexOf('<h2');
    const tail = ['<h2>Related reading</h2>', '<h2>Sources</h2>'].map(m => html.indexOf(m)).filter(i => i > -1).sort((a, b) => a - b)[0];
    if (firstH2 < 0 || tail === undefined) { console.log(`${id}: unexpected layout, skipped`); continue; }
    html = disclosure + '\n' + html.slice(0, firstH2) + top + '\n' + html.slice(firstH2, tail) + bottom + '\n' + html.slice(tail);
    if (!DRY_RUN) await axios.post(`${WP}/posts/${id}`, { content: html }, { headers: AUTH, timeout: 60000 });
    console.log(`${id}: ${DRY_RUN ? 'would add' : 'added'} Amazon links for "${term}" | ${p.title.raw}`);
  }
}
main().catch(e => { console.error('Fatal:', e.response?.data?.message || e.message); process.exit(1); });
