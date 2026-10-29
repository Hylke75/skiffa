// Gedeelde, pure logica voor de verkoopkanalen (bol, Etsy, Amazon). Zelfde opzet als Luna Azul
// (dreamer-collectives/supabase/functions/_shared/bol.ts), vertaald naar posters op bestelling:
// geen fysieke voorraad, wel een vaste "voorraad" die we aan het kanaal doorgeven.
import { POSTERS, ALLE_POSTERS, FORMATEN, ALLE_FORMATEN, VARIANTEN, STANDAARD_PAPIER, PAPIER, sku as variantSku } from '../_catalogus.js';
import { TEKSTEN as POSTERTEKSTEN } from '../_catalogus.js';
import { bedrijf } from '../_bedrijf.js';

export const KANALEN = ['bol', 'etsy', 'amazon', 'tiktok'];

// Veilige standaardinstellingen: alles staat uit en in proefmodus tot je het zelf aanzet.
export const STANDAARD = {
  bol: { aan: false, proef: true, opslag_pct: 15, voorraad: 20, levertijd_min: 3, levertijd_max: 5, vervoerder: 'TNT' },
  etsy: { aan: false, proef: true, auto_publiceren: false, opslag_pct: 15, voorraad: 20, verzendprofiel_id: null, verwerkingsprofiel_id: null, retourbeleid_id: null, taxonomy_id: null, laatste_ordersync: null },
  tiktok: { aan: false, proef: true, voorraad: 20, categorie_id: '', magazijn_id: '', gewicht_kg: 0.6, lengte_cm: 80, breedte_cm: 10, hoogte_cm: 10, laatste_ordersync: null },
  amazon: { aan: false, proef: true, opslag_pct: 15, voorraad: 20, verwerkingsdagen: 3, marketplace_id: 'A1805IZSGTT6HS', producttype: 'POSTER', merk: 'Skiffa', laatste_ordersync: null },
};

export const MAX_SCHRIJFACTIES = 40;  // per run, i.v.m. limieten van de kanalen en de functieduur
export const MAX_VERZENDPOGINGEN = 5;

// Alle bestelbare varianten (poster × formaat, standaardpapier) die de kanalen aanbieden.
// (Andere papiersoorten volgen met de nieuwe kanaalpagina.)
export function varianten() {
  return Object.values(VARIANTEN).filter((v) => v.bestelbaar && v.papier === STANDAARD_PAPIER && !v.lijst && ALLE_POSTERS[v.product_id])
    .map((v) => ({ poster_id: v.product_id, poster_naam: ALLE_POSTERS[v.product_id], formaat: v.formaat, formaat_label: ALLE_FORMATEN[v.formaat]?.label || v.formaat, prijs: v.prijs, sku: v.sku }));
}
export const sku = (poster, formaat) => variantSku(poster, formaat);
export function vanSku(s) {
  const v = VARIANTEN[String(s || '').toUpperCase()];
  if (v) return { poster_id: v.product_id, formaat: v.formaat, sku: v.sku };
  const m = String(s || '').toUpperCase().match(/^SKF-(.+)-(\d+X\d+(?:IN)?)$/);
  if (!m) return null;
  const poster_id = Object.keys(POSTERS).find((p) => p.toUpperCase() === m[1]);
  const formaat = Object.keys(FORMATEN).find((f) => f.toUpperCase() === m[2]);
  return poster_id && formaat ? { poster_id, formaat } : null;
}

/** Geldige EAN-13 (of EAN-8 / GTIN-14) met correct GS1-controlecijfer. */
export function isGeldigeEan(raw) {
  const ean = String(raw ?? '').trim();
  if (!/^\d{8}$|^\d{12,14}$/.test(ean)) return false;
  const c = ean.split('').map(Number);
  const check = c.pop();
  const som = c.reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (som % 10)) % 10 === check;
}

/** Kanaalprijs: winkelprijs + opslag (commissie), afgerond op x,95. Nooit lager dan de winkelprijs. */
export function kanaalPrijs(winkelprijs, opslagPct) {
  const ruw = winkelprijs * (1 + Math.max(0, Number(opslagPct) || 0) / 100);
  const p = Math.ceil(ruw + 0.05) - 0.05;
  return Math.max(Math.round(p * 100) / 100, winkelprijs);
}

export const titel = (v) => `Poster ${v.poster_naam} – Scheveningen – ${v.formaat_label}`;
export const titelEn = (poster_naam) => `Scheveningen poster ${poster_naam} – Dutch North Sea surf culture print`;

// Papier uit de catalogus (geen vaste claims in de tekst: die moeten kloppen met wat Prodigi drukt).
const papierGsm = () => PAPIER[STANDAARD_PAPIER]?.gsm || null;
export const papierZin = () => { const p = PAPIER[STANDAARD_PAPIER]; return p ? `Op bestelling gedrukt op ${p.naam.toLowerCase()}${p.gsm ? ` (${p.gsm} g/m²)` : ''}.` : 'Op bestelling gedrukt.'; };

export function omschrijving(poster_id, taal = 'nl') {
  const t = POSTERTEKSTEN[poster_id] || {};
  if (taal === 'en')
    return `${t.naam || poster_id} — a poster from Skiffa, a small studio from Scheveningen (The Hague, Netherlands) about the surf culture of its own beach.\n\n` +
      `Printed to order on matte art paper${papierGsm() ? ` (${papierGsm()} gsm)` : ''}. Shipped rolled in a sturdy tube, frame not included.\n\n` +
      `Sizes: ${Object.values(FORMATEN).map((f) => f.label).join(', ')}.`;
  return `${t.zin || ''}\n\n${t.sub ? `Stijl: ${t.sub}. ` : ''}${papierZin()} Opgerold verstuurd in een stevige koker, zonder lijst.`.trim();
}


// Vervoerders: onze naam → code per kanaal.
export function vervoerderCode(kanaal, v, land = 'NL') {
  const x = String(v || 'postnl').toLowerCase();
  if (kanaal === 'bol') return { postnl: 'TNT', dhl: 'DHL', dpd: 'DPD-NL', ups: 'UPS', gls: 'GLS' }[x] || 'TNT';
  if (kanaal === 'etsy') return { postnl: land === 'NL' ? 'postnl' : 'postnl-international', dhl: 'dhlparcel-nl', dpd: 'dpd', ups: 'ups', gls: 'gls', bpost: 'bpost' }[x] || 'other';
  if (kanaal === 'amazon') return { postnl: { carrierCode: 'PostNL' }, dhl: { carrierCode: 'DHL' }, dpd: { carrierCode: 'DPD' }, ups: { carrierCode: 'UPS' } }[x] || { carrierCode: 'Other', carrierName: v || 'Onbekend' };
  return x;
}

export function splitsNaam(naam) {
  const n = String(naam || '').trim().replace(/\s+/g, ' ');
  const i = n.indexOf(' ');
  return i < 0 ? { voor: n, achter: '' } : { voor: n.slice(0, i), achter: n.slice(i + 1) };
}

export const foutTekst = (d) => {
  const e = d?.errors || d?.violations;
  if (Array.isArray(e) && e.length) return e.map((x) => [x.message || x.reason, x.details || x.name].filter(Boolean).join(': ')).join(' · ').slice(0, 500);
  if (d && typeof d === 'object' && d.error) return [d.error, d.error_description].filter(Boolean).join(': ').slice(0, 500);
  return (typeof d === 'string' ? d : JSON.stringify(d ?? '')).slice(0, 500);
};

export const centen = (v) => Math.round(Number(v) * 100) / 100;
