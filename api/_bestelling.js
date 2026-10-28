// Gedeelde logica voor bestellen: valideren, prijzen uit de catalogus, mails.
// (Bestanden met een _ in /api worden door Vercel niet als route gepubliceerd.)
import { POSTERS, FORMATEN, verzendkosten } from './_catalogus.js';

export const LANDEN = { NL: 'Nederland', BE: 'België' };
const tekst = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const euro = (v) => '€ ' + v.toFixed(2).replace('.', ',');

// Regels -> bedragen. Prijzen komen altijd uit de catalogus, nooit uit de browser.
export function prijs(regelsIn, land) {
  if (!Array.isArray(regelsIn) || !regelsIn.length || regelsIn.length > 20) return null;
  const regels = [];
  for (const r of regelsIn) {
    const naam = POSTERS[r?.id];
    const formaat = FORMATEN[r?.formaat];
    const aantal = Number(r?.aantal);
    if (!naam || !formaat || !Number.isInteger(aantal) || aantal < 1 || aantal > 10) return null;
    regels.push({ id: r.id, naam, formaat: r.formaat, formaatLabel: formaat.label, prijs: formaat.prijs, aantal });
  }
  const subtotaal = regels.reduce((t, r) => t + r.prijs * r.aantal, 0);
  const verzending = verzendkosten(subtotaal, land);
  return { regels, subtotaal, verzending, totaal: subtotaal + verzending };
}

export function valideer(body) {
  const k = body.klant || {};
  const klant = {
    naam: tekst(k.naam, 100),
    email: tekst(k.email, 160),
    straat: tekst(k.straat, 120),
    postcode: tekst(k.postcode, 12).toUpperCase(),
    plaats: tekst(k.plaats, 80),
    land: LANDEN[k.land] ? k.land : '',
    opmerking: tekst(k.opmerking, 300),
  };
  if (klant.naam.length < 2) return { fout: 'Vul je naam in.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(klant.email)) return { fout: 'Vul een geldig e-mailadres in.' };
  if (klant.straat.length < 3) return { fout: 'Vul je straat en huisnummer in.' };
  if (klant.postcode.length < 4) return { fout: 'Vul je postcode in.' };
  if (klant.plaats.length < 2) return { fout: 'Vul je woonplaats in.' };
  if (!klant.land) return { fout: 'We versturen alleen naar Nederland en België.' };
  if (!Array.isArray(body.regels) || !body.regels.length) return { fout: 'Je mandje is leeg.' };
  const b = prijs(body.regels, klant.land);
  if (!b) return { fout: 'Er klopt iets niet in je mandje. Ververs de pagina en probeer het opnieuw.' };
  return { klant, ...b };
}

export function overzichtHtml(b, nummer) {
  const rij = (l, r) => `<tr><td style="padding:4px 16px 4px 0">${l}</td><td style="padding:4px 0;text-align:right">${r}</td></tr>`;
  return `<p><b>Bestelling ${esc(nummer)}</b></p><table style="border-collapse:collapse;font-family:monospace;font-size:13px">` +
    b.regels.map((r) => rij(`${r.aantal}× ${esc(r.naam)} — ${esc(r.formaatLabel)}`, euro(r.prijs * r.aantal))).join('') +
    rij('verzending', b.verzending ? euro(b.verzending) : 'gratis') +
    rij('<b>totaal</b>', `<b>${euro(b.totaal)}</b>`) +
    `</table><p>${esc(b.klant.naam)}<br>${esc(b.klant.straat)}<br>${esc(b.klant.postcode)} ${esc(b.klant.plaats)}<br>${LANDEN[b.klant.land]}<br>${esc(b.klant.email)}</p>` +
    (b.klant.opmerking ? `<p>Opmerking: ${esc(b.klant.opmerking)}</p>` : '');
}

export const winkelMail = () => process.env.BESTEL_EMAIL || 'hallo@skiffa.nl';

export async function mail(bericht) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'Skiffa <bestellingen@skiffa.nl>', ...bericht }),
  });
  if (!r.ok) throw new Error(`resend-${r.status}`);
}

// Mollie
export async function mollie(pad, opties = {}) {
  const r = await fetch(`https://api.mollie.com/v2/${pad}`, {
    ...opties,
    headers: { authorization: `Bearer ${process.env.MOLLIE_API_KEY}`, 'content-type': 'application/json' },
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(`mollie-${r.status}`);
  return d;
}

// Mollie-metadata is max. 1 KB: bewaar de bestelling compact en reken de prijzen later opnieuw uit.
export function naarMetadata(b, nummer) {
  return {
    nr: nummer,
    k: [b.klant.naam, b.klant.email, b.klant.straat, b.klant.postcode, b.klant.plaats, b.klant.land, b.klant.opmerking.slice(0, 200)],
    r: b.regels.map((r) => `${r.id}:${r.formaat}:${r.aantal}`).join(','),
  };
}
export function uitMetadata(m) {
  if (!m || !Array.isArray(m.k) || typeof m.r !== 'string') return null;
  const [naam, email, straat, postcode, plaats, land, opmerking] = m.k;
  const klant = { naam, email, straat, postcode, plaats, land, opmerking: opmerking || '' };
  const b = prijs(m.r.split(',').map((s) => { const [id, formaat, aantal] = s.split(':'); return { id, formaat, aantal: Number(aantal) }; }), land);
  return b ? { nummer: m.nr, klant, ...b } : null;
}
