// Adds Potato Tech YouTube videos / Shorts to EXISTING posts where one clearly fits (new posts get this automatically in pipeline-multi-niche.js).
// Usage: node src/add-videos-to-posts.js [--all | --ids=1,2] [--status=draft,pending,publish,...] [--dry-run]
// Inserts at the end of the first / second body section, adds the channel call-to-action and a VideoObject JSON-LD block.
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const yt = require('./youtube-videos');

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DRY_RUN = process.argv.includes('--dry-run');
const FALLBACK = process.argv.includes('--fallback'); // posts with no topic-matched video get the channel's top video + Short in a "More from the channel" block
const IDS = arg('ids', '').split(',').map(Number).filter(Boolean);
const STATUSES = arg('status', 'publish,draft,pending,future,private');
const { WORDPRESS_SITE, WORDPRESS_USERNAME, WORDPRESS_PASSWORD } = process.env;
const WP = `${WORDPRESS_SITE}/wp-json/wp/v2`;
const AUTH = { Authorization: 'Basic ' + Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_PASSWORD}`).toString('base64') };
const SKIP = /^(Frequently Asked Questions|Conclusion|Related reading|Quick facts|Sources)$|specs$/;
const dec = s => String(s).replace(/&#8217;|&#039;/g, "'").replace(/&#8211;|&#8212;/g, '-').replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/<[^>]+>/g, '');

async function listPosts() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    try {
      const r = await axios.get(`${WP}/posts`, { params: { per_page: 100, page, status: STATUSES, _fields: 'id,title,slug,status,link' }, headers: AUTH, timeout: 30000 });
      all.push(...r.data); if (r.data.length < 100) break;
    } catch (e) { if (e.response?.status === 400) break; throw e; }
  }
  return all;
}

async function main() {
  const catalog = await yt.fetchCatalog();
  if (!catalog.length) throw new Error('could not load the YouTube channel feed');
  console.log(`Channel catalog: ${catalog.length} (${catalog.filter(v => v.short).length} Shorts, ${catalog.filter(v => !v.short).length} videos)`);
  const posts = IDS.length ? IDS.map(id => ({ id })) : await listPosts();
  let changed = 0;
  for (const post of posts) {
    const p = (await axios.get(`${WP}/posts/${post.id}?context=edit`, { headers: AUTH, timeout: 30000 })).data;
    const title = dec(p.title.raw);
    let html = p.content.raw;
    if (/potato-video|youtube(-nocookie)?\.com\/embed/.test(html)) continue; // already has a video
    const headings = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(m => dec(m[1]));
    const videos = await yt.pickVideos({ title, keyword: '', headings: headings.filter(h => !SKIP.test(h)) }, catalog);
    if (!videos.length) {
      if (!FALLBACK) continue;
      const fb = yt.fallbackVideos(p.slug, catalog);
      if (!fb.length) continue;
      const block = yt.channelBlockHtml(fb), cta = /<p><strong>Watch more:<\/strong>[\s\S]*?<\/p>/;
      html = cta.test(html) ? html.replace(cta, () => block) : /<h2>Related reading<\/h2>/.test(html) ? html.replace('<h2>Related reading</h2>', () => block + '\n<h2>Related reading</h2>') : html + '\n' + block;
      html += `\n<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': yt.videoSchema(fb) })}</script>`;
      changed++;
      console.log(`${post.id} [${p.status}] ${title}\n    -> channel favourites: ${fb.map(v => (v.short ? 'Short' : 'Video') + ': ' + v.title).join(' | ')}`);
      if (!DRY_RUN) await axios.post(`${WP}/posts/${post.id}`, { content: html }, { headers: AUTH, timeout: 60000 });
      continue;
    }

    const parts = html.split(/(?=<h2[ >])/); // part 0 = intro, then one part per H2
    let slot = 0;
    const out = parts.map((part, i) => {
      if (i === 0 || slot >= videos.length) return part;
      const h = dec((part.match(/^<h2[^>]*>(.*?)<\/h2>/) || [])[1] || '');
      if (SKIP.test(h)) return part;
      return part.replace(/\s*$/, '') + '\n' + yt.embedHtml(videos[slot++]) + '\n';
    });
    if (slot === 0) { console.log(`${post.id}: no body section to place a video in, skipped`); continue; }
    html = out.join('');
    if (/<h2>Related reading<\/h2>/.test(html)) html = html.replace('<h2>Related reading</h2>', () => yt.ctaHtml() + '\n<h2>Related reading</h2>');
    else html += '\n' + yt.ctaHtml();
    html += `\n<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': yt.videoSchema(videos.slice(0, slot)) })}</script>`;
    changed++;
    console.log(`${post.id} [${p.status}] ${title}\n    -> ${videos.slice(0, slot).map(v => (v.short ? 'Short' : 'Video') + ': ' + v.title).join(' | ')}`);
    if (!DRY_RUN) await axios.post(`${WP}/posts/${post.id}`, { content: html }, { headers: AUTH, timeout: 60000 });
  }
  console.log(`\n${DRY_RUN ? 'Would update' : 'Updated'} ${changed} posts`);
}
main().catch(e => { console.error('Fatal:', e.response?.data?.message || e.message); process.exit(1); });
