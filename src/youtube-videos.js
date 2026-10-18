// Potato Tech YouTube channel (@potatotechi): catalog from the public channel RSS feed (videos AND Shorts, latest 15),
// relevance picking (gpt-4o-mini, strict), privacy-friendly embeds, VideoObject schema and the channel call-to-action.
// MANDATORY STEP for every new post: pipeline-multi-niche.js always runs pickVideos(); a post gets an embed when a video clearly fits
// and always gets the channel call-to-action.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC-txC0yiRhBcMxeQ3nWtV0g'; // https://www.youtube.com/@potatotechi
const CHANNEL_URL = process.env.YOUTUBE_CHANNEL_URL || 'https://www.youtube.com/@potatotechi';
const CACHE = path.join(__dirname, '..', 'youtube_catalog.json');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function fetchCatalog({ maxAgeHours = 12 } = {}) {
  try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (Date.now() - c.fetched < maxAgeHours * 36e5 && c.videos?.length) return c.videos; } catch { /* no cache */ }
  try {
    const r = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 });
    const videos = [...r.data.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
      const e = m[1], g = re => (e.match(re) || [])[1] || '';
      return {
        id: g(/<yt:videoId>(.*?)</), title: decode(g(/<title>([\s\S]*?)<\/title>/)), published: g(/<published>(.*?)</),
        short: /\/shorts\//.test(g(/<link rel="alternate" href="([^"]+)"/)), views: Number(g(/<media:statistics views="(\d+)"/)) || 0,
        description: decode(g(/<media:description>([\s\S]*?)<\/media:description>/)).slice(0, 300)
      };
    }).filter(v => v.id);
    if (videos.length) fs.writeFileSync(CACHE, JSON.stringify({ fetched: Date.now(), videos }, null, 2));
    return videos;
  } catch (e) {
    try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')).videos || []; } catch { return []; }
  }
}

// Deterministic matching (an unrelated video is worse than none): a video fits a post only when the post's title / slug / headings
// contain the video's BRAND and its MODEL, e.g. "iPhone 18" or "Pixel 9a" or "iPhone Duo". No LLM involved.
const BRANDS = { iphone: ['iphone'], macbook: ['macbook'], pixel: ['pixel'], nothing: ['nothing'], iqoo: ['iqoo'], gta: ['gta'], galaxy: ['galaxy'], oneplus: ['oneplus'], ipad: ['ipad'], airpods: ['airpods'] };
const MODEL_WORDS = new Set(['duo', 'neo', 'air', 'ultra', 'fold', 'flip', 'mini']);
const toks = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
function videoKey(title) {
  const t = toks(title), bi = t.findIndex(w => BRANDS[w]);
  if (bi < 0) return null;
  const model = [];
  for (const w of t.slice(bi + 1)) { // model = the 1-2 tokens right after the brand (digits or known model words), skipping "phone"/"pro"/"series"
    if (['phone', 'pro', 'series', 'max'].includes(w)) continue;
    if (MODEL_WORDS.has(w) || (/[0-9]/.test(w) && !model.some(m => /[0-9]/.test(m)))) { model.push(w); if (model.length >= 2) break; } else break; // first number + optional model word (Duo, Neo, Air...)
  }
  return model.length ? { brand: t[bi], model } : null;
}
function mayMatch(text, catalog) { return matchVideos(text, catalog, 1).length > 0; }
function matchVideos(text, catalog, max = 2) {
  const tt = new Set(toks(text));
  const hits = catalog.map(v => ({ v, k: videoKey(v.title) })).filter(x => x.k && tt.has(x.k.brand) && x.k.model.every(m => tt.has(m)));
  return hits.sort((a, b) => b.k.model.length - a.k.model.length || Number(a.v.short) - Number(b.v.short) || b.v.published.localeCompare(a.v.published)).slice(0, max).map(x => x.v);
}

async function pickVideos({ title, keyword = '', headings = [] }, catalog, max = 2) {
  return matchVideos(`${title} ${keyword}`, catalog || [], max); // title + keyword/slug only: headings carry boilerplate that causes false matches
}

// Embeds use youtube-nocookie.com. Shorts are vertical, long videos 16:9.
function embedHtml(v) {
  const url = v.short ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`;
  const style = v.short ? 'width:100%;max-width:360px;aspect-ratio:9/16;border:0;display:block;margin:0 auto' : 'width:100%;aspect-ratio:16/9;border:0';
  return `<figure class="wp-block-embed is-type-video is-provider-youtube potato-video"><div class="wp-block-embed__wrapper"><iframe src="https://www.youtube-nocookie.com/embed/${v.id}" title="${esc(v.title)}" style="${style}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><figcaption>${v.short ? 'Short' : 'Video'}: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(v.title)}</a> on the Potato Tech YouTube channel</figcaption></figure>`;
}

// Always added to every new post (the mandatory part): points readers and Google at the channel
function ctaHtml() {
  return `<p><strong>Watch more:</strong> new videos and Shorts every week on the <a href="${esc(CHANNEL_URL)}" target="_blank" rel="noopener">Potato Tech YouTube channel</a>. Subscribe so you don't miss the next one.</p>`;
}

// No topic match: still embed the channel's strongest content, one long video and one Short from the most-viewed, varied per post (seed = slug)
function fallbackVideos(seed, catalog) {
  const h = [...String(seed)].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
  const top = arr => arr.slice().sort((x, y) => y.views - x.views).slice(0, 4);
  const L = top(catalog.filter(v => !v.short)), S = top(catalog.filter(v => v.short));
  return [L.length ? L[h % L.length] : null, S.length ? S[(h >>> 3) % S.length] : null].filter(Boolean);
}
function channelBlockHtml(videos) { return ['<h2>More from the Potato Tech YouTube channel</h2>', ...videos.map(embedHtml), ctaHtml()].join('\n'); }

function videoSchema(videos) {
  return videos.map(v => ({
    '@type': 'VideoObject', name: v.title, description: v.description || v.title, thumbnailUrl: [`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`],
    uploadDate: v.published, embedUrl: `https://www.youtube.com/embed/${v.id}`, contentUrl: v.short ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`
  }));
}

module.exports = { fetchCatalog, pickVideos, mayMatch, embedHtml, ctaHtml, fallbackVideos, channelBlockHtml, videoSchema, CHANNEL_URL };
