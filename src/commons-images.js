// Real product photos from Wikimedia Commons, freely licensed only (CC0, public domain, CC BY, CC BY-SA).
// Returns photo objects shaped like the Unsplash ones used by the pipeline, plus credit_html / credit_text for the required attribution.
const axios = require('axios');

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = { 'User-Agent': 'PotatoTechBot/1.0 (https://potatotech.in; contact via site) axios' };
const OK_LICENSE = /^(cc0|pd|public domain|cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?)/i;
const NOISE = new Set(['price', 'india', 'launch', 'launched', 'sale', 'deal', 'deals', 'offer', 'offers', 'black', 'friday', 'release', 'date', 'review', 'specs',
  'leak', 'leaks', 'news', 'update', 'discount', 'best', 'vs', 'the', 'and', 'for', 'new', 'live', 'now', 'below', 'drops', 'drop', 'features', 'details', 'rs', 'in', 'on', 'at', 'to', 'of']);

const VARIANTS = ['max', 'ultra', 'plus', 'mini', 'fe', 'lite', 'air', 'se', 'pro'];
const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const words = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !NOISE.has(w));

// "iPhone 17 Pro Black Friday deal price India" -> "iphone 17 pro"
function productPhrase(text) {
  const w = words(text), out = [];
  for (const x of w) { out.push(x); if (out.length >= 4) break; }
  return out.join(' ');
}

async function search(q) {
  const r = await axios.get(API, {
    params: {
      action: 'query', format: 'json', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 25,
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: 1600
    }, headers: UA, timeout: 20000
  });
  return Object.values(r.data.query?.pages || {});
}

// queries: candidate product names, most specific first. Every word of the query (and any model number) must appear in the file's title/description.
async function findCommonsPhotos(queries, usedIds = [], n = 2) {
  const seen = new Set();
  for (const raw of queries.map(productPhrase).filter(q => q && !seen.has(q) && seen.add(q))) {
    const need = words(raw);
    if (need.length < 2) continue; // "phone" alone would match anything
    try {
      const hits = [];
      for (const p of await search(raw)) {
        const ii = p.imageinfo?.[0]; if (!ii) continue;
        const id = `commons:${p.pageid}`, m = ii.extmetadata || {};
        const license = strip(m.LicenseShortName?.value);
        if (usedIds.includes(id) || !OK_LICENSE.test(license) || !/^image\/(jpeg|png)$/.test(ii.mime) || ii.width < 1000 || ii.height < 600) continue;
        const hay = `${p.title} ${strip(m.ObjectName?.value)}`.toLowerCase().replace(/[^a-z0-9 ]/g, ' '); // title only: descriptions mention other products
        const hw = hay.split(/\s+/);
        if (!need.every(w => hw.includes(w))) continue;
        if (VARIANTS.some(v => hw.includes(v) && !need.includes(v))) continue; // asked for "iPhone 17 Pro", this is the "Pro Max"
        if (/\b(logo|screenshot|diagram|map|chart|wallpaper)\b/.test(hay)) continue;
        const artist = strip(m.Artist?.value) || 'Wikimedia Commons contributor';
        const page = ii.descriptionurl, licUrl = strip(m.LicenseUrl?.value);
        hits.push({
          id, url: ii.thumburl || ii.url, alt: strip(m.ObjectName?.value) || raw, user: artist, user_url: page, download_location: null, source: 'commons',
          credit_text: `Photo: ${artist} / Wikimedia Commons, ${license}`,
          credit_html: `Photo: <a href="${esc(page)}" rel="noopener">${esc(artist)}</a> via Wikimedia Commons, ${licUrl ? `<a href="${esc(licUrl)}" rel="license noopener">${esc(license)}</a>` : esc(license)}`
        });
        if (hits.length >= n) break;
      }
      if (hits.length) return hits;
    } catch (e) { console.log(`   ⚠️  Commons search '${raw}' failed: ${e.response?.status || e.message}`); }
  }
  return [];
}

module.exports = { findCommonsPhotos };
