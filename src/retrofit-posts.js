// Retrofit for posts made by pipeline-multi-niche.js: put an Amazon.in link (same tag/term as the post's existing affiliate link) after every body section and before the Conclusion.
// Usage: node src/retrofit-posts.js --ids=710,714 [--dry-run]
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const IDS = (process.argv.find(a => a.startsWith('--ids='))?.slice(6) || '').split(',').map(Number).filter(Boolean);
const DRY_RUN = process.argv.includes('--dry-run');
const { WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD } = process.env;
const WP = `${WORDPRESS_SITE}/wp-json/wp/v2`;
const AUTH = { Authorization: 'Basic ' + Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64') };
const ATTR = 'target="_blank" rel="sponsored nofollow noopener"';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SKIP = /^(Frequently Asked Questions|Conclusion|Related reading|Quick facts|Sources)$|specs$/;

async function main() {
  for (const id of IDS) {
    const p = (await axios.get(`${WP}/posts/${id}?context=edit`, { headers: AUTH, timeout: 30000 })).data;
    let html = p.content.raw;
    const before = html.length;
    const m = html.match(/<a href="(https:\/\/[^"]*amazon\.[^"]*[?&]k=([^&"]+)[^"]*)"/);
    if (!m) { console.log(`${id}: no Amazon link to copy`); }
    else {
      const url = m[1].replace(/&amp;/g, '&'), term = decodeURIComponent(m[2]);
      const line = `<p><a href="${esc(url)}" ${ATTR}>Browse ${esc(term)} on Amazon.in</a></p>`;
      const parts = html.split(/(?=<h2[ >])/); // each part starts with an <h2>; part 0 is the intro
      html = parts.map((part, i) => {
        if (i === 0) return part;
        const title = (part.match(/^<h2[^>]*>(.*?)<\/h2>/) || [])[1]?.replace(/<[^>]+>/g, '') || '';
        if (SKIP.test(title) || /amazon\./.test(part)) return part;
        return part.replace(/\s*$/, '') + '\n' + line + '\n';
      }).join('');
      // before the Conclusion too, if that section has no link yet
      html = html.replace(/(<h2>Frequently Asked Questions<\/h2>[\s\S]*?)(<h2>Conclusion<\/h2>)/, (all, faq, concl) => /amazon\./.test(faq) ? all : faq + `<p><a href="${esc(url)}" ${ATTR}>Compare ${esc(term)} prices on Amazon.in</a></p>\n` + concl);
    }
    const links = (html.match(/amazon\.in\/s\?/g) || []).length;
    if (!DRY_RUN) await axios.post(`${WP}/posts/${id}`, { content: html }, { headers: AUTH, timeout: 60000 });
    console.log(`${id}: ${DRY_RUN ? 'would update' : 'updated'} | Amazon links ${links} | Sources ${/<h2>Sources/.test(html) ? 'kept' : 'none'} | ${p.title.raw}`);
  }
}
main().catch(e => { console.error('Fatal:', e.response?.data?.message || e.message); process.exit(1); });
