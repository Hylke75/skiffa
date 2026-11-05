// /sitemap.xml (rewrite in vercel.json): alle openbare pagina's, Nederlands en Engels, uit de actuele catalogus.
// Wordt bij elke aanvraag opgebouwd, dus nieuwe of verwijderde posters staan er vanzelf in (of uit).
import { laadCatalogus, POSTERS } from './_catalogus.js';
import { bedrijf } from './_bedrijf.js';

const xml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemap(site, posterIds) {
  // Paren NL/EN met hreflang-verwijzingen naar elkaar.
  const paren = [
    ['/', '/?lang=en', '1.0'],
    ...posterIds.map((id) => [`/poster/${encodeURIComponent(id)}`, `/poster/${encodeURIComponent(id)}?lang=en`, '0.8']),
    ['/voorwaarden.html', '/terms.html', '0.2'],
    ['/privacy.html', '/privacy-en.html', '0.2'],
  ];
  const url = (loc, nl, en, prio) => `  <url><loc>${xml(site + loc)}</loc><priority>${prio}</priority>` +
    `<xhtml:link rel="alternate" hreflang="nl" href="${xml(site + nl)}"/><xhtml:link rel="alternate" hreflang="en" href="${xml(site + en)}"/></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    paren.flatMap(([nl, en, prio]) => [url(nl, nl, en, prio), url(en, nl, en, prio)]).join('\n') + '\n</urlset>\n';
}

export default async function handler(req, res) {
  await laadCatalogus();
  res.setHeader('content-type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(sitemap(bedrijf().site, Object.keys(POSTERS)));
}
