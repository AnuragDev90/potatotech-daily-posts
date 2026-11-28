// SEO building blocks from CLAUDE-CODE-SEO-MASTER.md / PRE-WRITING-SEO-CHECKLIST.md:
// NewsArticle + BreadcrumbList + FAQPage (+ Product) schema, a sourced quick-facts table, source links, inline figure.
// Deliberately NO ratings, reviews, prices or "tested by us" claims in schema: none of that is real data here.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BRANDS = [['iphone', 'Apple'], ['galaxy', 'Samsung'], ['pixel', 'Google'], ['oneplus', 'OnePlus'], ['nothing', 'Nothing'], ['cmf', 'Nothing'],
  ['redmi', 'Xiaomi'], ['poco', 'Xiaomi'], ['xiaomi', 'Xiaomi'], ['realme', 'Realme'], ['vivo', 'Vivo'], ['iqoo', 'iQOO'], ['oppo', 'Oppo'],
  ['motorola', 'Motorola'], ['moto ', 'Motorola'], ['hmd', 'HMD'], ['infinix', 'Infinix'], ['tecno', 'Tecno'], ['lava', 'Lava'], ['honor', 'Honor']];
const brandFor = model => (BRANDS.find(([k]) => String(model).toLowerCase().includes(k)) || [])[1] || null;

function buildSchema({ meta, faq, url, imageUrl, category, site, siteName, product, datePublished }) {
  const org = { '@type': 'Organization', name: siteName, url: site };
  const graph = [
    {
      '@type': 'NewsArticle', headline: String(meta.title).slice(0, 110), description: meta.meta_description,
      ...(imageUrl ? { image: [imageUrl] } : {}), datePublished, dateModified: datePublished,
      author: org, publisher: org, mainEntityOfPage: { '@type': 'WebPage', '@id': url }, inLanguage: 'en-IN'
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: site },
        ...(category ? [{ '@type': 'ListItem', position: 2, name: category.name, item: category.link }] : []),
        { '@type': 'ListItem', position: category ? 3 : 2, name: meta.title, item: url }
      ]
    },
    {
      '@type': 'FAQPage',
      mainEntity: faq.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } }))
    }
  ];
  if (product) {
    graph.push({
      '@type': 'Product', name: product, description: meta.meta_description, ...(imageUrl ? { image: [imageUrl] } : {}),
      ...(brandFor(product) ? { brand: { '@type': 'Brand', name: brandFor(product) } } : {})
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

function factsTable(rows) {
  if (!rows || rows.length < 3) return '';
  return '<h2>Quick facts</h2>\n<table><thead><tr><th>Detail</th><th>What\'s been reported</th></tr></thead><tbody>' +
    rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('') +
    '</tbody></table>\n<p><em>Based on recent media reports. Confirm final details on the brand\'s official site.</em></p>';
}

function sourcesHtml(news) {
  const seen = new Set();
  const items = (news || []).filter(n => n.link && n.title && !seen.has(n.title) && seen.add(n.title)).slice(0, 4);
  if (items.length < 2) return '';
  return '<h2>Sources</h2>\n<ul>' + items.map(n =>
    `<li><a href="${esc(n.link)}" target="_blank" rel="nofollow noopener">${esc(n.title)}</a>${n.source ? ` (${esc(n.source)}${n.date ? ', ' + esc(n.date) : ''})` : ''}</li>`).join('') + '</ul>';
}

function figureHtml(media, photo) {
  if (!media || !photo) return '';
  const alt = String(photo.alt || '').charAt(0).toUpperCase() + String(photo.alt || '').slice(1, 120);
  if (photo.credit_html) return `<figure class="wp-block-image size-large"><img src="${esc(media.source_url)}" alt="${esc(alt)}" loading="lazy"/><figcaption>${photo.credit_html}</figcaption></figure>`;
  return `<figure class="wp-block-image size-large"><img src="${esc(media.source_url)}" alt="${esc(alt)}" loading="lazy"/>` +
    `<figcaption>Photo by <a href="${esc(photo.user_url)}?utm_source=potatotech&amp;utm_medium=referral">${esc(photo.user)}</a> on <a href="https://unsplash.com/?utm_source=potatotech&amp;utm_medium=referral">Unsplash</a></figcaption></figure>`;
}

module.exports = { buildSchema, factsTable, sourcesHtml, figureHtml, brandFor, esc };
