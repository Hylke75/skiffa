// Factuur als printbare HTML-pagina (Afdrukken → Opslaan als PDF).
// Toegang: de klant met de geheime link uit de mail (?nr=…&t=…), of de winkel via de administratie.
import { dbAan, haalBestelling } from './_db.js';
import { isAdmin } from './_auth.js';
import { esc, euro, LANDEN } from './_bestelling.js';
import { bedrijf, btwDeel } from './_bedrijf.js';
import { vanRij } from './_mails.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const datum = (d) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' });

export function factuurHtml(r) {
  const o = vanRij(r), b = bedrijf();
  const excl = (v) => euro(v - btwDeel(v));
  const regels = o.regels.map((x) => `<tr><td>Poster ${esc(x.naam)}, ${esc(x.formaatLabel)}</td><td class="r">${x.aantal}</td><td class="r">${euro(x.prijs)}</td><td class="r">${euro(x.prijs * x.aantal)}</td></tr>`).join('') +
    (o.verzending ? `<tr><td>Verzending in koker</td><td class="r">1</td><td class="r">${euro(o.verzending)}</td><td class="r">${euro(o.verzending)}</td></tr>` : '');
  const terug = Number(r.terugbetaald || 0);
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Factuur ${esc(r.factuurnummer)} — ${esc(b.naam)}</title>
<style>
body{font-family:Helvetica,Arial,sans-serif;color:#111;background:#eee;margin:0;padding:24px;font-size:13px;line-height:1.55}
.vel{background:#fff;max-width:760px;margin:0 auto;padding:56px 56px 40px;box-shadow:0 4px 30px rgba(0,0,0,.08)}
.kop{display:flex;justify-content:space-between;gap:24px;margin-bottom:44px}
.merk{font-size:24px;font-weight:700;letter-spacing:.32em}
h1{font-size:15px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 6px}
table{width:100%;border-collapse:collapse;margin:28px 0 8px}
th{text-align:left;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#666;border-bottom:1px solid #111;padding:6px 0}
td{padding:8px 0;border-bottom:1px solid #e5e5e5}
.r{text-align:right}th.r{text-align:right}
.tot{margin-left:auto;width:300px}.tot td{border:0;padding:3px 0}.tot .som td{border-top:1px solid #111;font-weight:700;padding-top:8px}
.klein{font-size:11px;color:#666}
.knop{display:block;max-width:760px;margin:0 auto 14px;text-align:right}
.knop button{font:inherit;background:#000;color:#fff;border:0;border-radius:999px;padding:8px 18px;cursor:pointer}
@media print{body{background:#fff;padding:0}.vel{box-shadow:none;padding:0}.knop{display:none}}
@media (max-width:600px){.vel{padding:28px 20px}.kop{flex-direction:column}}
</style></head><body>
<div class="knop"><button onclick="print()">afdrukken / opslaan als pdf</button></div>
<div class="vel">
<div class="kop"><div><div class="merk">SKIFFA</div><div class="klein" style="margin-top:8px">${esc(b.naam)}<br>${esc(b.adres)}<br>${esc(b.email)}<br>KvK ${esc(b.kvk)} · btw ${esc(b.btw)}<br>IBAN ${esc(b.iban)}</div></div>
<div style="text-align:right"><h1>Factuur</h1>
<div>nummer <b>${esc(r.factuurnummer)}</b><br>datum ${datum(r.factuurdatum || r.betaald_op || r.aangemaakt_op)}<br>bestelling ${esc(r.nummer)}</div></div></div>
<div><div class="klein">factuur aan</div>${esc(r.naam)}<br>${esc(r.straat)}<br>${esc(r.postcode)} ${esc(r.plaats)}<br>${LANDEN[r.land] || esc(r.land)}<br>${esc(r.email)}</div>
<table><thead><tr><th>omschrijving</th><th class="r">aantal</th><th class="r">prijs</th><th class="r">bedrag</th></tr></thead><tbody>${regels}</tbody></table>
<table class="tot"><tbody>
<tr><td>totaal excl. btw</td><td class="r">${excl(o.totaal)}</td></tr>
<tr><td>btw ${Number(r.btw_tarief || 21)}%</td><td class="r">${euro(btwDeel(o.totaal, Number(r.btw_tarief || 21)))}</td></tr>
<tr class="som"><td>totaal incl. btw</td><td class="r">${euro(o.totaal)}</td></tr>
${terug > 0 ? `<tr><td>teruggestort</td><td class="r">− ${euro(terug)}</td></tr>` : ''}
</tbody></table>
<p class="klein" style="margin-top:36px">${r.betaald_op ? `Voldaan op ${datum(r.betaald_op)}${r.mollie_methode ? ` via ${esc(r.mollie_methode)}` : ''}.` : `Graag binnen 14 dagen overmaken op ${esc(b.iban)} o.v.v. ${esc(r.nummer)}.`}
Op deze bestelling zijn onze <a href="${b.site}/voorwaarden.html">algemene voorwaarden</a> van toepassing. Je hebt 14 dagen bedenktijd na ontvangst.</p>
</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!dbAan()) { res.status(404).send('Niet gevonden'); return; }
  const nr = param(req, 'nr'), t = param(req, 't');
  if (!/^SK-[A-Z0-9]{4,20}$/.test(nr)) { res.status(404).send('Niet gevonden'); return; }
  try {
    const r = await haalBestelling('nummer', nr);
    const mag = r && (isAdmin(req) || (/^[a-f0-9]{36}$/.test(t) && r.token === t));
    if (!mag || !r.factuurnummer) { res.status(404).send('Niet gevonden'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.status(200).send(factuurHtml(r));
  } catch {
    res.status(500).send('Er ging iets mis');
  }
}
