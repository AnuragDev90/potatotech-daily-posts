// Fact check for generated text: every price, spec figure, chipset and date must appear in the source
// headlines the article was grounded on. Anything else is treated as invented and removed.
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

const CLAIM_RES = [
  /(?:₹|Rs\.?\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|lakh|crore))?/gi,                              // prices
  /\b\d+(?:\.\d+)?[\s-]?(?:mAh|MP|W|Hz|inch(?:es)?|GB|TB|nm|mm|fps)\b/gi,                       // spec figures
  /\b(?:Snapdragon|Dimensity|Exynos|Tensor|Helio|Kirin|Unisoc)\s?[\w+]+(?:\s(?:Gen|Elite|Ultra|Plus)\s?\d?)*/gi, // chipsets
  /\b(?:Apple\s)?A\d{2}(?:\s(?:Pro|Bionic))?\b|\bBionic\b/g,                                       // Apple chips (A17 Bionic, A19 Pro...)
  /\b(?:iOS|iPadOS|Android|HyperOS|OxygenOS|ColorOS|One UI|Funtouch OS|OriginOS|Nothing OS)\s?\d+(?:\.\d+)?\b/gi, // OS versions
  /\bIP\d{2}\b|\bGorilla Glass(?: Victus| Armor)?(?:\s?\d)?\b/gi,                                   // durability claims
  new RegExp(`\\b(?:${MONTHS})\\s\\d{1,2}\\b|\\b\\d{1,2}\\s(?:${MONTHS})\\b`, 'gi')              // dates
];

const squash = t => String(t).toLowerCase().replace(/[\s,\-]/g, '');

function unverifiedClaims(text, allowed) {
  const ok = squash(allowed);
  const found = new Set();
  for (const re of CLAIM_RES) for (const m of text.match(re) || []) if (!ok.includes(squash(m))) found.add(m.trim());
  return [...found];
}

// Last resort: delete the sentences / list lines that still contain an unverified claim
function dropSentencesWith(text, claims) {
  return text.split('\n').map(line => /^\s*[-*\d]/.test(line)
    ? (claims.some(c => line.includes(c)) ? '' : line)
    : line.split(/(?<=[.!?])\s+/).filter(sen => !claims.some(c => sen.includes(c))).join(' ')
  ).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { unverifiedClaims, dropSentencesWith };
