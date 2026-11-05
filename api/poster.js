// Eigen productpagina per poster: /poster/<id>  (rewrite in vercel.json → /api/poster?id=<id>).
// Bedoeld voor Meta/Google (feed-link per variant: /poster/<id>?v=<SKU>) en om te delen: echte titel,
// beschrijving, beelden, prijs per variant, Open Graph en schema.org-productgegevens in de HTML zelf.
// "In winkelmand" zet de variant in hetzelfde mandje als de winkel (localStorage) en opent de winkel.
import { laadCatalogus, PRODUCTEN, VARIANTEN, ALLE_FORMATEN, PAPIER, BEELDEN, VASTE_BEELDEN, ophangLabel } from './_catalogus.js';
import { visuals, visualUrl } from './_media.js';
import { bedrijf } from './_bedrijf.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (n, en) => (en ? `€${Number(n).toFixed(2).replace('.00', '')}` : `€ ${Number(n).toFixed(2).replace('.', ',').replace(',00', ',-')}`);
const platteTekst = (v) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const param = (req, k) => new URL(req.url, 'http://x').searchParams.get(k) || '';

const LIJST_EN = { black: 'black frame', natural: 'natural frame', white: 'white frame', brown: 'brown frame' };
const lijstLabel = (v, en) => (v.lijst ? (en ? LIJST_EN[v.lijst_kleur] || 'frame' : ophangLabel(v.lijst, v.lijst_kleur)) : '');
export function variantNaam(v, en = false) {
  const lijst = lijstLabel(v, en);
  return `${ALLE_FORMATEN[v.formaat]?.label || v.formaat}${lijst ? `, ${lijst}` : ''}`;
}

function nietGevonden(res) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  return res.status(404).send('<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Poster niet gevonden — SKIFFA</title><meta name="robots" content="noindex"></head><body style="font-family:ui-monospace,Menlo,monospace;background:#F6F3ED;padding:40px"><p>Deze poster bestaat niet (meer).</p><p><a href="/">naar de winkel</a></p></body></html>');
}

export default async function handler(req, res) {
  await laadCatalogus();
  const id = param(req, 'id').toLowerCase();
  const p = PRODUCTEN[id];
  if (!p || p.status !== 'actief') return nietGevonden(res);
  const site = bedrijf().site;
  const en = param(req, 'lang') === 'en', T = (nl, eng) => (en ? eng : nl), L = en ? 'lang=en&' : '';
  const naam = (en && p.titel_en) || p.titel;
  const alle = Object.values(VARIANTEN).filter((v) => v.product_id === id && v.bestelbaar)
    .sort((a, b) => (a.lijst ? 1 : 0) - (b.lijst ? 1 : 0) || a.prijs - b.prijs);
  const gekozen = alle.find((v) => v.sku === param(req, 'v').toUpperCase()) || alle[0] || null;
  let vis = [];
  try { vis = ((await visuals())[id] || []).filter((x) => x.soort !== 'video'); } catch { /* zonder beelden */ }
  const hoofd = BEELDEN[id] ? visualUrl(BEELDEN[id].groot) : VASTE_BEELDEN.has(id) ? `${site}/posters/${id}.jpg` : vis[0]?.url || null;
  const beelden = [hoofd, ...vis.map((x) => x.url)].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i).slice(0, 8);
  const beschrijving = platteTekst((en && p.beschrijving_en) || p.beschrijving);
  const titel = gekozen ? `${naam} – poster ${variantNaam(gekozen, en)}` : naam;
  const zoek = (lang) => { const q = [lang === 'en' ? 'lang=en' : '', gekozen && gekozen !== alle[0] ? `v=${encodeURIComponent(gekozen.sku)}` : ''].filter(Boolean).join('&'); return `${site}/poster/${encodeURIComponent(id)}${q ? `?${q}` : ''}`; };
  const url = zoek(en ? 'en' : 'nl');
  const papierNaam = gekozen?.papier === 'mat' && en ? 'Enhanced Matte Art Paper' : PAPIER[gekozen?.papier]?.naam || gekozen?.papier;
  const papier = gekozen ? (gekozen.lijst ? T('Enhanced Matte Art Paper (200 g/m²), ingelijst achter acrylaat', 'Enhanced Matte Art Paper (200 gsm), framed behind acrylic') : `${papierNaam}${PAPIER[gekozen.papier]?.gsm ? ` (${PAPIER[gekozen.papier].gsm} ${T('g/m²', 'gsm')})` : ''}`) : '';

  const ld = {
    '@context': 'https://schema.org', '@type': 'ProductGroup', name: naam, description: beschrijving, url: `${site}/poster/${id}${en ? '?lang=en' : ''}`,
    productGroupID: p.code || id, brand: { '@type': 'Brand', name: 'SKIFFA' }, image: beelden, variesBy: ['https://schema.org/size', 'https://schema.org/color'],
    hasVariant: alle.map((v) => ({
      '@type': 'Product', sku: v.sku, name: `${naam} – poster ${variantNaam(v, en)}`, image: hoofd, size: ALLE_FORMATEN[v.formaat]?.label || v.formaat,
      ...(v.lijst ? { color: lijstLabel(v, en) } : {}),
      offers: { '@type': 'Offer', url: `${site}/poster/${id}?${L}v=${v.sku}`, price: Number(v.prijs).toFixed(2), priceCurrency: 'EUR', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' },
    })),
  };
  const knoppen = alle.map((v) => `<a class="optie${v === gekozen ? ' aan' : ''}" href="/poster/${esc(id)}?${L}v=${esc(v.sku)}" data-sku="${esc(v.sku)}" data-formaat="${esc(v.formaat)}" data-papier="${esc(v.papier)}"><span>${esc(variantNaam(v, en))}</span><b>${esc(euro(v.prijs, en))}</b></a>`).join('');
  const thuis = en ? '/?lang=en' : '/';

  // Markdown for Agents: met Accept: text/markdown dezelfde gegevens als platte Markdown.
  if (/text\/markdown/i.test(String(req.headers?.accept || ''))) {
    const md = `# ${naam}\n\n${((en && p.stijl_en) || p.stijl) ? `${(en && p.stijl_en) || p.stijl}\n\n` : ''}${beschrijving}\n\n` +
      (alle.length ? `| ${T('uitvoering', 'option')} | ${T('prijs', 'price')} |\n|---|---|\n${alle.map((v) => `| ${variantNaam(v, en)} | ${euro(v.prijs, en)} |`).join('\n')}\n\n` : `${T('Binnenkort te koop.', 'Coming soon.')}\n\n`) +
      `${T('Prijzen incl. btw. Op bestelling gedrukt, meestal binnen 6 tot 8 werkdagen bij je.', 'Prices incl. VAT. Printed to order, usually with you within 6 to 8 working days.')}\n\n` +
      `${T('Bestellen', 'Order')}: ${url}\n` + (hoofd ? `\n![${naam}](${hoofd})\n` : '');
    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.setHeader('x-markdown-tokens', String(Math.ceil(md.length / 4)));
    res.setHeader('Vary', 'Accept');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(md);
  }

  const html = `<!DOCTYPE html>
<html lang="${en ? 'en' : 'nl'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)} — SKIFFA</title>
<meta name="description" content="${esc(((en ? '' : p.seo_beschrijving) || beschrijving).slice(0, 300))}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" hreflang="nl" href="${esc(zoek('nl'))}">
<link rel="alternate" hreflang="en" href="${esc(zoek('en'))}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beschrijving.slice(0, 300))}">
<meta property="og:url" content="${esc(url)}">
${hoofd ? `<meta property="og:image" content="${esc(hoofd)}">` : ''}
<meta property="og:site_name" content="SKIFFA">
<meta property="og:locale" content="${en ? 'en_GB' : 'nl_NL'}">
${gekozen ? `<meta property="product:price:amount" content="${Number(gekozen.prijs).toFixed(2)}">
<meta property="product:price:currency" content="EUR">
<meta property="product:availability" content="in stock">
<meta property="product:condition" content="new">
<meta property="product:brand" content="SKIFFA">
<meta property="product:retailer_item_id" content="${esc(gekozen.sku)}">
<meta property="product:item_group_id" content="${esc(p.code || id)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
:root{--zwart:#000;--papier:#F6F3ED;--grijs:#BFB3B2;--mono:"DM Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--papier);color:var(--zwart);font-family:var(--mono);font-size:12px;letter-spacing:.06em;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid rgba(0,0,0,.12)}
header .merk{font-weight:500;letter-spacing:.42em;text-decoration:none;font-size:14px}
header nav a{text-decoration:none;margin-left:18px;font-size:11px;text-transform:uppercase}
main{max-width:1180px;margin:0 auto;padding:32px 24px 64px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:48px}
.hoofd{width:100%;aspect-ratio:3/4;object-fit:cover;background:#e8e3da;display:block}
.duim{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;margin-top:10px}
.duim button{border:1px solid transparent;padding:0;background:none;cursor:pointer;aspect-ratio:3/4;overflow:hidden}
.duim button.aan{border-color:#000}
.duim img{width:100%;height:100%;object-fit:cover;display:block}
h1{font-size:22px;font-weight:400;letter-spacing:.04em;line-height:1.3;margin-bottom:6px}
.stijl{opacity:.6;font-size:11px;text-transform:uppercase;margin-bottom:22px}
.prijs{font-size:20px;margin:0 0 4px}
.klein{opacity:.65;font-size:11px}
.opties{display:grid;gap:6px;margin:22px 0}
.optie{display:flex;justify-content:space-between;padding:10px 12px;border:1px solid rgba(0,0,0,.18);text-decoration:none;font-size:12px}
.optie.aan{border-color:#000;background:#fff}
.koop{display:block;width:100%;padding:15px;background:#000;color:#fff;border:0;font:inherit;letter-spacing:.2em;text-transform:uppercase;cursor:pointer}
.koop:hover{background:#222}
.tekst{margin-top:28px;white-space:pre-line}
dl{margin-top:22px;display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:11px}
dt{opacity:.6}
footer{border-top:1px solid rgba(0,0,0,.12);padding:20px 24px;font-size:10px;opacity:.7;text-align:center}
@media (max-width:820px){main{grid-template-columns:1fr;gap:26px;padding:16px 16px 48px}header{padding:14px 16px}}
</style>
</head>
<body>
<header><a class="merk" href="${thuis}">SKIFFA</a><nav><a href="${thuis}#posters">${T('alle posters', 'all posters')}</a><a href="${thuis}">${T('winkel', 'shop')}</a><a href="${esc(zoek(en ? 'nl' : 'en').replace(site, ''))}" lang="${en ? 'nl' : 'en'}">${en ? 'NL' : 'EN'}</a></nav></header>
<main>
  <section>
    ${hoofd ? `<img class="hoofd" id="hoofd" src="${esc(hoofd)}" alt="${esc(naam)}">` : ''}
    ${beelden.length > 1 ? `<div class="duim">${beelden.map((u, i) => `<button type="button" class="${i ? '' : 'aan'}" data-src="${esc(u)}" aria-label="${T('beeld', 'image')} ${i + 1}"><img src="${esc(u.replace(/(\.jpe?g)$/i, '-klein$1'))}" onerror="this.onerror=null;this.src='${esc(u)}'" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
  </section>
  <section>
    <h1>${esc(naam)}</h1>
    ${((en && p.stijl_en) || p.stijl) ? `<p class="stijl">${esc((en && p.stijl_en) || p.stijl)}</p>` : ''}
    ${gekozen ? `<p class="prijs" id="prijs">${esc(euro(gekozen.prijs, en))}</p><p class="klein">${T('incl. btw', 'incl. VAT')} · ${esc(variantNaam(gekozen, en))} · ${T('op bestelling gedrukt, meestal binnen 6 tot 8 werkdagen bij je', 'printed to order, usually with you within 6 to 8 working days')}</p>` : `<p class="prijs">${T('binnenkort te koop', 'coming soon')}</p>`}
    ${alle.length ? `<div class="opties">${knoppen}</div><button class="koop" id="koop" type="button">${T('in winkelmand', 'add to basket')}</button>` : ''}
    ${beschrijving ? `<p class="tekst">${esc(beschrijving)}</p>` : ''}
    ${gekozen ? `<dl><dt>${T('formaat', 'size')}</dt><dd>${esc(ALLE_FORMATEN[gekozen.formaat]?.label || gekozen.formaat)}</dd><dt>${T('papier', 'paper')}</dt><dd>${esc(papier)}</dd>${gekozen.lijst ? `<dt>${T('lijst', 'frame')}</dt><dd>${esc(lijstLabel(gekozen, en))} (Classic, ${T('acrylaat', 'acrylic')})</dd>` : ''}<dt>${T('artikel', 'item')}</dt><dd>${esc(gekozen.sku)}</dd></dl>` : ''}
  </section>
</main>
<footer>SKIFFA · ${T('posters van de Scheveningse surfcultuur', 'posters of Scheveningen surf culture')} · <a href="${T('/voorwaarden.html', '/terms.html')}">${T('voorwaarden', 'terms')}</a> · <a href="${T('/privacy.html', '/privacy-en.html')}">privacy</a></footer>
<script>
(()=>{const id=${JSON.stringify(id)};
document.querySelectorAll('.duim button').forEach(b=>b.addEventListener('click',()=>{document.getElementById('hoofd').src=b.dataset.src;document.querySelectorAll('.duim button').forEach(x=>x.classList.toggle('aan',x===b));}));
const koop=document.getElementById('koop');if(!koop)return;
koop.addEventListener('click',()=>{const a=document.querySelector('.optie.aan')||document.querySelector('.optie');if(!a)return;
  let r=[];try{r=JSON.parse(localStorage.getItem('skiffa-mandje')||'[]');}catch(_){}
  const x=r.find(q=>q.id===id&&q.sku===a.dataset.sku);if(x)x.aantal=Math.min(10,(x.aantal||1)+1);else r.push({id,sku:a.dataset.sku,formaat:a.dataset.formaat,papier:a.dataset.papier,aantal:1});
  try{localStorage.setItem('skiffa-mandje',JSON.stringify(r));}catch(_){}
  location.href=${JSON.stringify(thuis)}+'#mandje';});
})();
</script>
</body>
</html>`;
  res.setHeader('Vary', 'Accept');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
