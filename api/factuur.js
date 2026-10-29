// Factuur als printbare HTML-pagina (Afdrukken → Opslaan als PDF).
// Toegang: de klant met de geheime link uit de mail (?nr=…&t=…), of de winkel via de administratie.
import { dbAan, haalBestelling } from './_db.js';
import { isAdmin } from './_auth.js';
import { esc, euro, LANDEN } from './_bestelling.js';
import { bedrijf, btwDeel } from './_bedrijf.js';
import { vanRij } from './_mails.js';
import { maakPdf } from './_pdf.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const datum = (d) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' });

export function factuurHtml(r) {
  const o = vanRij(r), b = bedrijf();
  const excl = (v) => euro(v - btwDeel(v));
  const regels = o.regels.map((x) => `<tr><td>Poster ${esc(x.naam)}, ${esc(x.formaatLabel)}</td><td class="r">${x.aantal}</td><td class="r">${euro(x.prijs)}</td><td class="r">${euro(x.prijs * x.aantal)}</td></tr>`).join('') +
    (o.verzending ? `<tr><td>Verzending</td><td class="r">1</td><td class="r">${euro(o.verzending)}</td><td class="r">${euro(o.verzending)}</td></tr>` : '');
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

// Dezelfde factuur als PDF (o.a. voor bol.com, dat facturen als PDF opvraagt).
export function factuurPdf(r) {
  const o = vanRij(r), b = bedrijf();
  const d = datum(r.factuurdatum || r.betaald_op || r.aangemaakt_op);
  const R = [], L = [];
  const t = (x, y, tekst, extra = {}) => R.push({ x, y, tekst: String(tekst ?? ''), ...extra });
  t(50, 70, 'SKIFFA', { grootte: 20, vet: true });
  [b.naam, b.adres, b.email, `KvK ${b.kvk} · btw ${b.btw}`, `IBAN ${b.iban}`].forEach((x, i) => t(50, 92 + i * 12, x, { grootte: 8 }));
  t(545, 70, 'FACTUUR', { grootte: 13, vet: true, rechts: true });
  t(545, 92, `nummer ${r.factuurnummer}`, { rechts: true, grootte: 9 });
  t(545, 104, `datum ${d}`, { rechts: true, grootte: 9 });
  t(545, 116, `bestelling ${r.nummer}${r.extern_id ? ` (${r.kanaal} ${r.extern_id})` : ''}`, { rechts: true, grootte: 9 });
  t(50, 180, 'factuur aan', { grootte: 8 });
  [r.naam, r.straat, `${r.postcode} ${r.plaats}`, LANDEN[r.land] || r.land, r.email].filter(Boolean).forEach((x, i) => t(50, 194 + i * 13, x));
  let y = 290;
  t(50, y, 'OMSCHRIJVING', { grootte: 8, vet: true }); t(380, y, 'AANTAL', { grootte: 8, vet: true, rechts: true });
  t(460, y, 'PRIJS', { grootte: 8, vet: true, rechts: true }); t(545, y, 'BEDRAG', { grootte: 8, vet: true, rechts: true });
  L.push({ x1: 50, y1: y + 6, x2: 545, y2: y + 6 });
  const rijen = o.regels.map((x) => [`Poster ${x.naam}, ${x.formaatLabel}`, x.aantal, x.prijs]);
  if (o.verzending) rijen.push(['Verzending', 1, o.verzending]);
  for (const [oms, n, p] of rijen) { y += 20; t(50, y, oms); t(380, y, n, { rechts: true }); t(460, y, euro(p), { rechts: true }); t(545, y, euro(p * n), { rechts: true }); }
  y += 34; const btw = btwDeel(o.totaal, Number(r.btw_tarief || 21));
  t(400, y, 'totaal excl. btw'); t(545, y, euro(o.totaal - btw), { rechts: true });
  t(400, y + 15, `btw ${Number(r.btw_tarief || 21)}%`); t(545, y + 15, euro(btw), { rechts: true });
  L.push({ x1: 400, y1: y + 22, x2: 545, y2: y + 22 });
  t(400, y + 36, 'totaal incl. btw', { vet: true }); t(545, y + 36, euro(o.totaal), { vet: true, rechts: true });
  t(50, y + 80, r.betaald_op ? `Voldaan op ${datum(r.betaald_op)}${r.mollie_methode ? ` via ${r.mollie_methode}` : ''}.` : `Graag binnen 14 dagen overmaken op ${b.iban} o.v.v. ${r.nummer}.`, { grootte: 8 });
  t(50, y + 92, `Algemene voorwaarden: ${b.site}/voorwaarden.html · 14 dagen bedenktijd na ontvangst.`, { grootte: 8 });
  return maakPdf({ regels: R, lijnen: L });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!dbAan()) { res.status(404).send('Niet gevonden'); return; }
  const nr = param(req, 'nr'), t = param(req, 't');
  if (!/^(SK|BOL|ETS|AMA)-[A-Z0-9]{4,20}$/.test(nr)) { res.status(404).send('Niet gevonden'); return; }
  try {
    const r = await haalBestelling('nummer', nr);
    const mag = r && (isAdmin(req) || (/^[a-f0-9]{36}$/.test(t) && r.token === t));
    if (!mag || !r.factuurnummer) { res.status(404).send('Niet gevonden'); return; }
    if (param(req, 'pdf') === '1') {
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', `inline; filename="factuur-${r.factuurnummer}.pdf"`);
      res.status(200).send(factuurPdf(r));
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.status(200).send(factuurHtml(r));
  } catch {
    res.status(500).send('Er ging iets mis');
  }
}
