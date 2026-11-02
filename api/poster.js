// Eigen productpagina per poster: /poster/<id>  (rewrite in vercel.json → /api/poster?id=<id>).
// Bedoeld voor Meta/Google (feed-link per variant: /poster/<id>?v=<SKU>) en om te delen: echte titel,
// beschrijving, beelden, prijs per variant, Open Graph en schema.org-productgegevens in de HTML zelf.
// "In winkelmand" zet de variant in hetzelfde mandje als de winkel (localStorage) en opent de winkel.
import { laadCatalogus, PRODUCTEN, VARIANTEN, ALLE_FORMATEN, PAPIER, BEELDEN, VASTE_BEELDEN, ophangLabel } from './_catalogus.js';
import { visuals, visualUrl } from './_media.js';
import { bedrijf } from './_bedrijf.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (n) => `€ ${Number(n).toFixed(2).replace('.', ',').replace(',00', ',-')}`;
const platteTekst = (v) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const param = (req, k) => new URL(req.url, 'http://x').searchParams.get(k) || '';

export function variantNaam(v) {
  const lijst = ophangLabel(v.lijst, v.lijst_kleur);
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
  const alle = Object.values(VARIANTEN).filter((v) => v.product_id === id && v.bestelbaar)
    .sort((a, b) => (a.lijst ? 1 : 0) - (b.lijst ? 1 : 0) || a.prijs - b.prijs);
  const gekozen = alle.find((v) => v.sku === param(req, 'v').toUpperCase()) || alle[0] || null;
  let vis = [];
  try { vis = ((await visuals())[id] || []).filter((x) => x.soort !== 'video'); } catch { /* zonder beelden */ }
  const hoofd = BEELDEN[id] ? visualUrl(BEELDEN[id].groot) : VASTE_BEELDEN.has(id) ? `${site}/posters/${id}.jpg` : vis[0]?.url || null;
  const beelden = [hoofd, ...vis.map((x) => x.url)].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i).slice(0, 8);
  const beschrijving = platteTekst(p.beschrijving);
  const titel = gekozen ? `${p.titel} – poster ${variantNaam(gekozen)}` : p.titel;
  const url = `${site}/poster/${encodeURIComponent(id)}${gekozen && gekozen !== alle[0] ? `?v=${encodeURIComponent(gekozen.sku)}` : ''}`;
  const papier = gekozen ? (gekozen.lijst ? 'Enhanced Matte Art Paper (200 g/m²), ingelijst achter acrylaat' : `${PAPIER[gekozen.papier]?.naam || gekozen.papier}${PAPIER[gekozen.papier]?.gsm ? ` (${PAPIER[gekozen.papier].gsm} g/m²)` : ''}`) : '';

  const ld = {
    '@context': 'https://schema.org', '@type': 'ProductGroup', name: p.titel, description: beschrijving, url: `${site}/poster/${id}`,
    productGroupID: p.code || id, brand: { '@type': 'Brand', name: 'SKIFFA' }, image: beelden, variesBy: ['https://schema.org/size', 'https://schema.org/color'],
    hasVariant: alle.map((v) => ({
      '@type': 'Product', sku: v.sku, name: `${p.titel} – poster ${variantNaam(v)}`, image: hoofd, size: ALLE_FORMATEN[v.formaat]?.label || v.formaat,
      ...(v.lijst ? { color: ophangLabel(v.lijst, v.lijst_kleur) } : {}),
      offers: { '@type': 'Offer', url: `${site}/poster/${id}?v=${v.sku}`, price: Number(v.prijs).toFixed(2), priceCurrency: 'EUR', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' },
    })),
  };
  const knoppen = alle.map((v) => `<a class="optie${v === gekozen ? ' aan' : ''}" href="/poster/${esc(id)}?v=${esc(v.sku)}" data-sku="${esc(v.sku)}" data-formaat="${esc(v.formaat)}" data-papier="${esc(v.papier)}"><span>${esc(variantNaam(v))}</span><b>${esc(euro(v.prijs))}</b></a>`).join('');

  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)} — SKIFFA</title>
<meta name="description" content="${esc((p.seo_beschrijving || beschrijving).slice(0, 300))}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beschrijving.slice(0, 300))}">
<meta property="og:url" content="${esc(url)}">
${hoofd ? `<meta property="og:image" content="${esc(hoofd)}">` : ''}
<meta property="og:site_name" content="SKIFFA">
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
<header><a class="merk" href="/">SKIFFA</a><nav><a href="/#posters">alle posters</a><a href="/">winkel</a></nav></header>
<main>
  <section>
    ${hoofd ? `<img class="hoofd" id="hoofd" src="${esc(hoofd)}" alt="${esc(p.titel)}">` : ''}
    ${beelden.length > 1 ? `<div class="duim">${beelden.map((u, i) => `<button type="button" class="${i ? '' : 'aan'}" data-src="${esc(u)}" aria-label="beeld ${i + 1}"><img src="${esc(u.replace(/(\.jpe?g)$/i, '-klein$1'))}" onerror="this.onerror=null;this.src='${esc(u)}'" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
  </section>
  <section>
    <h1>${esc(p.titel)}</h1>
    ${p.stijl ? `<p class="stijl">${esc(p.stijl)}</p>` : ''}
    ${gekozen ? `<p class="prijs" id="prijs">${esc(euro(gekozen.prijs))}</p><p class="klein">incl. btw · ${esc(variantNaam(gekozen))} · op bestelling gedrukt, meestal binnen 6 tot 8 werkdagen bij je</p>` : '<p class="prijs">binnenkort te koop</p>'}
    ${alle.length ? `<div class="opties">${knoppen}</div><button class="koop" id="koop" type="button">in winkelmand</button>` : ''}
    ${beschrijving ? `<p class="tekst">${esc(beschrijving)}</p>` : ''}
    ${gekozen ? `<dl><dt>formaat</dt><dd>${esc(ALLE_FORMATEN[gekozen.formaat]?.label || gekozen.formaat)}</dd><dt>papier</dt><dd>${esc(papier)}</dd>${gekozen.lijst ? `<dt>lijst</dt><dd>${esc(ophangLabel(gekozen.lijst, gekozen.lijst_kleur))} (Classic, acrylaat)</dd>` : ''}<dt>artikel</dt><dd>${esc(gekozen.sku)}</dd></dl>` : ''}
  </section>
</main>
<footer>SKIFFA · posters van de Scheveningse surfcultuur · <a href="/voorwaarden.html">voorwaarden</a> · <a href="/privacy.html">privacy</a></footer>
<script>
(()=>{const id=${JSON.stringify(id)};
document.querySelectorAll('.duim button').forEach(b=>b.addEventListener('click',()=>{document.getElementById('hoofd').src=b.dataset.src;document.querySelectorAll('.duim button').forEach(x=>x.classList.toggle('aan',x===b));}));
const koop=document.getElementById('koop');if(!koop)return;
koop.addEventListener('click',()=>{const a=document.querySelector('.optie.aan')||document.querySelector('.optie');if(!a)return;
  let r=[];try{r=JSON.parse(localStorage.getItem('skiffa-mandje')||'[]');}catch(_){}
  const x=r.find(q=>q.id===id&&q.sku===a.dataset.sku);if(x)x.aantal=Math.min(10,(x.aantal||1)+1);else r.push({id,sku:a.dataset.sku,formaat:a.dataset.formaat,papier:a.dataset.papier,aantal:1});
  try{localStorage.setItem('skiffa-mandje',JSON.stringify(r));}catch(_){}
  location.href='/#mandje';});
})();
</script>
</body>
</html>`;
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
