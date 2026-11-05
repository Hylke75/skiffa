// Markdown-versie van de winkel voor AI-agents ("Markdown for Agents"): middleware.js stuurt een aanvraag voor /
// met Accept: text/markdown hierheen. Browsers krijgen gewoon de HTML. ?lang=en geeft de Engelse versie.
import { laadCatalogus, POSTERS, PRODUCTEN, VARIANTEN, ALLE_FORMATEN, GRATIS_VANAF, VERZENDING } from './_catalogus.js';
import { bedrijf } from './_bedrijf.js';

const param = (req, k) => new URL(req.url, 'http://x').searchParams.get(k) || '';
const euro = (n, en) => (en ? `€${Number(n).toFixed(2).replace('.00', '')}` : `€ ${Number(n).toFixed(2).replace('.', ',').replace(',00', ',-')}`);

export function winkelMarkdown(en) {
  const site = bedrijf().site, T = (nl, e) => (en ? e : nl), L = en ? '?lang=en' : '';
  const kleur = { black: T('zwart', 'black'), natural: T('naturel', 'natural'), white: T('wit', 'white'), brown: T('bruin', 'brown') };
  const posters = Object.keys(POSTERS).map((id) => {
    const p = PRODUCTEN[id] || { titel: POSTERS[id] };
    const vs = Object.values(VARIANTEN).filter((v) => v.product_id === id && v.bestelbaar).sort((a, b) => (a.lijst ? 1 : 0) - (b.lijst ? 1 : 0) || a.prijs - b.prijs);
    const rijen = vs.map((v) => `| ${ALLE_FORMATEN[v.formaat]?.label || v.formaat} | ${v.lijst ? `${T('lijst', 'frame')} ${kleur[v.lijst_kleur] || v.lijst_kleur}` : T('zonder lijst', 'unframed')} | ${euro(v.prijs, en)} |`).join('\n');
    return `## ${(en && p.titel_en) || p.titel}\n\n${(en && p.stijl_en) || p.stijl || ''}\n\n${String((en && p.beschrijving_en) || p.beschrijving || '').replace(/<[^>]*>/g, '')}\n\n` +
      `| ${T('formaat', 'size')} | ${T('uitvoering', 'option')} | ${T('prijs', 'price')} |\n|---|---|---|\n${rijen}\n\n${T('Bekijken en bestellen', 'View and order')}: ${site}/poster/${encodeURIComponent(id)}${L}\n`;
  }).join('\n');
  return `# SKIFFA — ${T('posters van de Scheveningse surfcultuur', 'posters of Scheveningen surf culture')}\n\n` +
    T('SKIFFA is een klein merk uit Scheveningen (Den Haag). Elke poster wordt op bestelling gedrukt: los op Hahnemühle German Etching (310 g/m²), of ingelijst in een zwarte of naturel Classic-lijst met acrylaat.',
      'SKIFFA is a small brand from Scheveningen (The Hague, the Netherlands). Every poster is printed to order: unframed on Hahnemühle German Etching (310 gsm), or framed in a black or natural Classic frame with acrylic glazing.') + '\n\n' +
    `- ${T('Verzending', 'Shipping')}: ${T('Nederland', 'Netherlands')} ${euro(VERZENDING.NL, en)}, ${T('België', 'Belgium')} ${euro(VERZENDING.BE, en)}, ${T('gratis vanaf', 'free from')} ${euro(GRATIS_VANAF, en)}\n` +
    `- ${T('Levertijd: meestal 6 tot 8 werkdagen', 'Delivery: usually 6 to 8 working days')}\n` +
    `- ${T('14 dagen bedenktijd', '14-day right of withdrawal')}: ${site}${T('/voorwaarden.html', '/terms.html')}\n` +
    `- ${T('Contact', 'Contact')}: ${bedrijf().email}\n\n${posters}`;
}

export default async function handler(req, res) {
  await laadCatalogus();
  const md = winkelMarkdown(param(req, 'lang') === 'en');
  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.setHeader('x-markdown-tokens', String(Math.ceil(md.length / 4)));
  res.setHeader('Vary', 'Accept');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).send(md);
}
