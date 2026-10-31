// Gedeelde logica voor bestellen: valideren, prijzen uit de catalogus, mails.
// (Bestanden met een _ in /api worden door Vercel niet als route gepubliceerd.)
import { POSTERS, ALLE_FORMATEN, PAPIER, VARIANTEN, STANDAARD_PAPIER, variantVoor, verzendkosten, ophangLabel } from './_catalogus.js';

export const LANDEN = { NL: 'Nederland', BE: 'België' };
const tekst = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const euro = (v) => '€ ' + v.toFixed(2).replace('.', ',');

// Regels -> bedragen. Prijzen komen altijd uit de catalogus, nooit uit de browser. Een regel noemt de
// variant (sku) of poster + formaat (+ papier); alleen bestelbare varianten mogen. Elke regel krijgt een
// vaste kopie van de variant mee (sku, papier, drukbestandversie, Prodigi-product, kostprijs).
export function prijs(regelsIn, land) {
  if (!Array.isArray(regelsIn) || !regelsIn.length || regelsIn.length > 20) return null;
  const regels = [];
  for (const r of regelsIn) {
    const v = r?.sku ? VARIANTEN[r.sku] : variantVoor(r?.id, r?.formaat, r?.papier || STANDAARD_PAPIER);
    const aantal = Number(r?.aantal);
    if (!v || !v.bestelbaar || (r?.id && v.product_id !== r.id) || !POSTERS[v.product_id] || !Number.isInteger(aantal) || aantal < 1 || aantal > 10) return null;
    // De lijst staat in het label, zodat factuur, mails en statuspagina laten zien wat er verkocht is.
    const ophanging = ophangLabel(v.lijst, v.lijst_kleur);
    regels.push({
      id: v.product_id, naam: POSTERS[v.product_id], formaat: v.formaat, formaatLabel: `${ALLE_FORMATEN[v.formaat]?.label || v.formaat}${ophanging ? `, in ${ophanging}` : ''}`, ophanging,
      papier: v.papier, papierLabel: PAPIER[v.papier]?.naam || v.papier, sku: v.sku, prijs: v.prijs, aantal,
      snapshot: { lijst: v.lijst, lijst_kleur: v.lijst_kleur || null, drukbestand_versie_id: v.drukbestand_id, prodigi_sku: v.prodigi_sku, prodigi_attributen: v.prodigi_attributen, sizing: v.sizing, kostprijs: v.kostprijs },
    });
  }
  const subtotaal = regels.reduce((t, r) => t + r.prijs * r.aantal, 0);
  const verzending = verzendkosten(subtotaal, land);
  return { regels, subtotaal, verzending, totaal: subtotaal + verzending };
}

/** Bestelregel voor de database, met de vaste kopie van de variant. */
export const regelRij = (bestellingId, r) => ({
  bestelling_id: bestellingId, poster_id: r.id, poster_naam: r.naam, formaat: r.formaat, formaat_label: r.formaatLabel, prijs: r.prijs, aantal: r.aantal,
  variant_sku: r.sku || null, papier_id: r.papier || null, papier_label: r.papierLabel || null,
  ...(r.snapshot ? { lijst: r.snapshot.lijst, lijst_kleur: r.snapshot.lijst_kleur || null, drukbestand_versie_id: r.snapshot.drukbestand_versie_id, prodigi_sku: r.snapshot.prodigi_sku, prodigi_attributen: r.snapshot.prodigi_attributen, sizing: r.snapshot.sizing, kostprijs: r.snapshot.kostprijs } : {}),
});

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
    r: b.regels.map((r) => `${r.sku || `${r.id}:${r.formaat}`}:${r.aantal}`).join(','),
  };
}
export function uitMetadata(m) {
  if (!m || !Array.isArray(m.k) || typeof m.r !== 'string') return null;
  const [naam, email, straat, postcode, plaats, land, opmerking] = m.k;
  const klant = { naam, email, straat, postcode, plaats, land, opmerking: opmerking || '' };
  const b = prijs(m.r.split(',').map((s) => { const d = s.split(':'); return d.length === 2 ? { sku: d[0], aantal: Number(d[1]) } : { id: d[0], formaat: d[1], aantal: Number(d[2]) }; }), land);
  return b ? { nummer: m.nr, klant, ...b } : null;
}
