// Google Search Console (read-only) via a service account. No extra dependencies: signs the JWT with node:crypto.
// Credentials: GSC_SERVICE_ACCOUNT_JSON (the JSON text) or GSC_KEY_FILE (a path). Property: GSC_SITE (default sc-domain:potatotech.in).
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function creds() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON || (process.env.GSC_KEY_FILE && fs.readFileSync(process.env.GSC_KEY_FILE, 'utf8'));
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON or GSC_KEY_FILE not set');
  return JSON.parse(raw);
}
async function token() {
  const c = creds(), now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(c.private_key, 'base64url');
  const r = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }));
  return r.data.access_token;
}
const SITE = process.env.GSC_SITE || 'sc-domain:potatotech.in';

async function query({ days = 28, dimensions = ['query'], rowLimit = 250, site = SITE, offsetDays = 3 } = {}) {
  const t = await token(), d = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const r = await axios.post(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { startDate: d(days + offsetDays), endDate: d(offsetDays), dimensions, rowLimit }, { headers: { Authorization: `Bearer ${t}` } });
  return (r.data.rows || []).map(x => ({ keys: x.keys, clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position }));
}
async function sites() {
  const t = await token();
  return (await axios.get('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${t}` } })).data.siteEntry || [];
}
module.exports = { query, sites, SITE };

if (require.main === module) (async () => {
  try {
    console.log('Sites this account can read:', JSON.stringify(await sites()));
    const rows = await query({ days: 90, dimensions: ['page'], rowLimit: 15 });
    console.log(`Top pages, last 90 days (${rows.length}):`);
    rows.forEach(r => console.log(`${String(r.clicks).padStart(5)} clicks ${String(r.impressions).padStart(7)} imp  pos ${r.position.toFixed(1)}  ${r.keys[0]}`));
  } catch (e) { console.error('Error:', e.response?.status, JSON.stringify(e.response?.data?.error || e.message)); process.exit(1); }
})();
