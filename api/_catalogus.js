// Catalogus voor de server: welke posters en formaten er zijn en wat ze kosten.
// De prijs wordt altijd hier bepaald, nooit door de browser. Bestanden met een _ in /api
// worden door Vercel niet als route gepubliceerd.
//
// Moet gelijk lopen met `posters` en `formaten` in index.html — controleer met
//   node scripts/check-catalogus.mjs

export const POSTERS = {
  surfcultuur: 'Surfcultuur',
  windsurf: 'Windsurf',
  golf: 'Golf',
  havenpier: 'Havenpier',
  'de-pier': 'De Pier',
  surf: 'Surf',
  boulevard: 'Boulevard',
  'pier-en-strand': 'Pier en Strand',
  skiffa: 'Skiffa',
  skyview: 'Skyview',
  havenhoofden: 'Havenhoofden',
  'noordzee-surf': 'Noordzee Surf',
  regatta: 'Regatta',
  zon: 'Zon',
  vuurtoren: 'Vuurtoren',
  reuzenrad: 'Reuzenrad',
};

// Formaten (millimeters zonder afloop). Per poster × formaat hoort er een drukbestand (pdf) bij,
// zie api/_media.js. `actief: false` = klaargezet voor later (Noord-Amerika): drukbestanden kun je al
// uploaden, maar het formaat is nog nergens te koop. Aanzetten: actief op true en het formaat ook
// toevoegen aan `formaten` in index.html.
export const ALLE_FORMATEN = {
  '30x40': { label: '30 × 40 cm', prijs: 49, mm: [304.8, 406.4], actief: true },     // instap, cadeau
  '50x70': { label: '50 × 70 cm', prijs: 69, mm: [508, 711.2], actief: true },     // hoofdproduct
  '70x100': { label: '70 × 100 cm', prijs: 119, mm: [711.2, 1016], actief: true },  // grote uitvoering
  '18x24in': { label: '18 × 24 inch', prijs: 39, mm: [457.2, 609.6], actief: false },
  '24x36in': { label: '24 × 36 inch', prijs: 59, mm: [609.6, 914.4], actief: false },
};

// Wat nu te koop is (webshop en kanalen).
export const FORMATEN = Object.fromEntries(Object.entries(ALLE_FORMATEN).filter(([, f]) => f.actief));

export const VERZENDING = { NL: 6.95, BE: 9.95 };
export const GRATIS_VANAF = 75;

export function verzendkosten(subtotaal, land) {
  return subtotaal >= GRATIS_VANAF ? 0 : VERZENDING[land] ?? VERZENDING.NL;
}

// ---------------------------------------------------------------------------------------------
// Centrale catalogus met varianten (supabase/migrations/20261029030000_catalogus.sql, beheer in
// /admin → producten). Staat de catalogus in de database, dan is die leidend: laadCatalogus() vult de
// objecten in dit bestand in place, zodat alle bestaande imports meteen meedoen. Zonder database (of met
// lege tabellen) geldt de catalogus hierboven: elke poster in elk actief formaat op Hahnemühle German Etching.
//
// Een variant is in de database pas `bestelbaar` als: product actief, variant/formaat/papier actief,
// prijs > 0, leverbaar bevestigd (Prodigi-product gecontroleerd; zonder Prodigi: handmatig met reden) en
// een drukbestand dat de verplichte controles doorstond (of een bevestigde uitzondering). Wat ontbreekt
// staat in `ontbreekt`, in gewone taal, voor de beheeromgeving en de actielijst.
// Elke route die met producten of prijzen werkt, roept eerst `await laadCatalogus()` aan.
import { dbAan, db } from './_db.js';
import { POSTERTEKSTEN } from './_posterteksten.js';

// Alle prints op Hahnemühle German Etching (Prodigi GLOBAL-HGE-*, 310 g/m²).
export const STANDAARD_PAPIER = 'german-etching';
export const PAPIER = { 'german-etching': { naam: 'Hahnemühle German Etching', uitleg: 'Fine-art papier van Hahnemühle, 310 g/m², met een fluweelachtige structuur. Mat, dus geen spiegeling van lampen of ramen; kleuren blijven diep en rustig.', gsm: 310, actief: true } };
export const sku = (poster, formaat, papier = STANDAARD_PAPIER) => `SKF-${poster}-${formaat}${papier === STANDAARD_PAPIER ? '' : `-${papier}`}`.toUpperCase();

/** Alle producten (ook niet-actieve, voor beheer en oude orders). POSTERS = alleen wat te koop is. */
export const ALLE_POSTERS = { ...POSTERS };
/** Teksten per product (naam, sub, zin, kleur) voor kanalen en catalogus. */
export const TEKSTEN = Object.fromEntries(Object.entries(POSTERTEKSTEN).map(([id, t]) => [id, { ...t }]));
/** Volledige productgegevens uit de database (leeg zonder database). */
export const PRODUCTEN = {};
/** Eigen productbeeld (opslagpaden) voor producten die niet als bestand in /posters staan. */
export const BEELDEN = {};
/** Producten waarvan het beeld als bestand in /posters/ staat (meegeleverd met de site). */
export const VASTE_BEELDEN = new Set(Object.keys(POSTERS));
export const CODE_FORMATEN = JSON.parse(JSON.stringify(ALLE_FORMATEN));
// Ingelijst: Prodigi Classic-lijst (zonder passe-partout, met acrylaat ervoor). Prodigi drukt ingelijste posters op
// Enhanced Matte Art (EMA, 200 g/m²), niet op German Etching. De drukmaat is gelijk aan die van de losse poster, dus
// een variant met `lijst = 'classic'` en `lijst_kleur` (Prodigi-kleur) gebruikt het drukbestand van de losse poster.
export const OPHANGING = {
  classic: {
    naam: 'lijst',
    kleuren: { black: 'zwart', white: 'wit', natural: 'naturel', brown: 'bruin' },
    prodigi: { '30x40': 'GLOBAL-CFP-12X16', '50x70': 'GLOBAL-CFP-20X28', '70x100': 'GLOBAL-CFP-28X40' },
    papier: 'mat',      // EMA 200 g/m²
    attributen: { frame: 'Classic', glaze: 'Acrylic / Perspex', mount: 'No mount / Mat', paperType: 'EMA', substrateWeight: '200gsm' },
  },
};
export const ophangLabel = (lijst, kleur) => (lijst === 'classic' ? `${OPHANGING.classic.kleuren[kleur] || kleur || ''} lijst`.trim() : null);
export const lijstSku = (basisSku, kleur) => `${basisSku}-LIJST-${(OPHANGING.classic.kleuren[kleur] || kleur).toUpperCase()}`;

/** Alle varianten, op SKU. */
export const VARIANTEN = {};

function codeVarianten() {
  const uit = {};
  for (const id of Object.keys(POSTERS))
    for (const [f, x] of Object.entries(FORMATEN)) {
      const s = sku(id, f);
      uit[s] = { sku: s, product_id: id, formaat: f, papier: STANDAARD_PAPIER, lijst: null, prijs: x.prijs, bestelbaar: true, ontbreekt: [],
        prodigi_sku: null, prodigi_attributen: {}, sizing: 'fitPrintArea', drukbestand_id: null, kostprijs: null, levertijd: { productie: 3, verzending: 3 } };
    }
  return uit;
}
Object.assign(VARIANTEN, codeVarianten());

/** De variant voor poster + formaat (+ papier). */
export function variantVoor(poster, formaat, papier = STANDAARD_PAPIER) {
  return Object.values(VARIANTEN).find((v) => v.product_id === poster && v.formaat === formaat && v.papier === papier && !v.lijst) || null;
}
/** Basisprijs van een poster in een formaat (standaardpapier); voor de kanalen. */
export const prijsVan = (poster, formaat) => variantVoor(poster, formaat)?.prijs ?? ALLE_FORMATEN[formaat]?.prijs ?? null;

const CACHE_MS = 60 * 1000;
let geladenOp = 0, bron = 'code';
export const catalogusBron = () => bron;

function vervang(doel, nieuw) {
  for (const k of Object.keys(doel)) delete doel[k];
  Object.assign(doel, nieuw);
}

/** Wat ontbreekt er nog om deze variant te verkopen? (lege lijst = bestelbaar) */
export function ontbreektVoor(v, { product, formaat, papier, druk, productieRoute }) {
  const o = [];
  const naam = `${formaat?.label || v.formaat_id}${papier ? `, ${papier.naam.toLowerCase()}` : ''}`;
  if (!product || product.status !== 'actief') o.push(`poster staat op ${product?.status || 'onbekend'}`);
  if (!v.actief) o.push(`variant ${naam} staat uit`);
  if (!formaat?.actief) o.push(`formaat ${formaat?.label || v.formaat_id} staat uit`);
  if (!papier?.actief) o.push(`papiersoort ${papier?.naam || v.papier_id} staat uit`);
  if (!(Number(v.prijs) > 0)) o.push(`geen verkoopprijs voor ${naam}`);
  if (productieRoute === 'prodigi') {
    if (v.prodigi_status !== 'bevestigd') o.push(v.prodigi_sku ? `Prodigi-product voor ${naam} is niet bevestigd${v.prodigi_melding ? `: ${v.prodigi_melding}` : ''}` : `geen Prodigi-product gekoppeld aan ${naam}`);
  } else if (!v.handmatig_leverbaar && v.prodigi_status !== 'bevestigd') o.push(`leverbaarheid van ${naam} is niet bevestigd`);
  if (!druk) o.push(`drukbestand ontbreekt voor ${naam}`);
  else if (druk.status === 'afgekeurd' && !v.qc_uitzondering) o.push(`drukbestand voor ${naam} is afgekeurd`);
  return o;
}

export async function laadCatalogus({ vers = false } = {}) {
  if (!dbAan() || (!vers && Date.now() - geladenOp < CACHE_MS)) return bron;
  geladenOp = Date.now();
  try {
    const [p, f, pa, v, ins] = await Promise.all([
      db('producten?select=*&order=volgorde.asc,id.asc'),
      db('formaten?select=*&order=volgorde.asc,id.asc'),
      db('papiersoorten?select=*&order=volgorde.asc,id.asc'),
      db('varianten?select=*'),
      db('kanaal_instellingen?kanaal=eq.prodigi&select=waarden').catch(() => []),
    ]);
    const webshop = await db('product_kanalen?kanaal=eq.webshop&select=product_id,publiceren').catch(() => []);
    const opWebshop = (id) => { const r = webshop.find((x) => x.product_id === id); return r ? !!r.publiceren : true; };
    if (!p.length || !f.length || !pa.length) return (bron = 'code');
    const ids = v.map((x) => x.drukbestand_id).filter(Boolean);
    const druk = ids.length ? await db(`drukbestand_versies?id=in.(${ids.join(',')})&select=id,status`) : [];
    const drukOp = new Map(druk.map((d) => [d.id, d]));
    const productieRoute = ins?.[0]?.waarden?.aan ? 'prodigi' : 'eigen';
    const fOp = Object.fromEntries(f.map((x) => [x.id, x])), paOp = Object.fromEntries(pa.map((x) => [x.id, x])), pOp = Object.fromEntries(p.map((x) => [x.id, x]));

    // Drukbestand: een ingelijste variant gebruikt het bestand (en een eventuele uitzondering) van dezelfde losse poster
    // in hetzelfde formaat (de lijst wordt op ander papier gedrukt, de drukmaat is gelijk).
    const basisVan = (x) => (x.lijst ? v.find((y) => !y.lijst && y.product_id === x.product_id && y.formaat_id === x.formaat_id && y.papier_id === STANDAARD_PAPIER) || v.find((y) => !y.lijst && y.product_id === x.product_id && y.formaat_id === x.formaat_id) || null : null);
    const varianten = {};
    for (const rij of v) {
      const b = basisVan(rij);
      const x = b ? { ...rij, drukbestand_id: b.drukbestand_id, qc_uitzondering: b.qc_uitzondering } : rij;
      const ontbreekt = ontbreektVoor(x, { product: pOp[x.product_id], formaat: fOp[x.formaat_id], papier: paOp[x.papier_id], druk: drukOp.get(x.drukbestand_id), productieRoute });
      if (rij.lijst && !b) ontbreekt.push('geen losse poster in dit formaat (daar hoort het drukbestand bij)');
      varianten[x.sku] = {
        sku: x.sku, product_id: x.product_id, formaat: x.formaat_id, papier: x.papier_id, lijst: x.lijst, lijst_kleur: x.lijst_kleur, basis_sku: b?.sku || null,
        prijs: Number(x.prijs), kostprijs: x.kostprijs == null ? null : Number(x.kostprijs), bestelbaar: !ontbreekt.length, ontbreekt,
        prodigi_sku: x.prodigi_sku, prodigi_attributen: x.prodigi_attributen || {}, sizing: x.sizing, prodigi_status: x.prodigi_status,
        drukbestand_id: x.drukbestand_id, drukbestand_status: drukOp.get(x.drukbestand_id)?.status || null, qc_uitzondering: x.qc_uitzondering || null, ean: x.ean,
        levertijd: { productie: x.levertijd_productie_dagen, verzending: x.levertijd_verzending_dagen }, verzendmethode: x.verzendmethode,
      };
    }
    vervang(VARIANTEN, varianten);
    vervang(ALLE_FORMATEN, Object.fromEntries(f.map((x) => [x.id, { label: x.label, mm: [Number(x.breedte_mm), Number(x.hoogte_mm)], actief: !!x.actief, prijs: null }])));
    vervang(PAPIER, Object.fromEntries(pa.map((x) => [x.id, { naam: x.naam, uitleg: x.uitleg, gsm: x.gewicht_gsm, actief: !!x.actief }])));
    const bestelbaar = Object.values(varianten).filter((x) => x.bestelbaar);
    // Te koop: formaten waarin minstens één variant bestelbaar is; prijs = laagste prijs in dat formaat.
    vervang(FORMATEN, Object.fromEntries(Object.entries(ALLE_FORMATEN).filter(([id, x]) => x.actief && bestelbaar.some((b) => b.formaat === id))
      .map(([id, x]) => [id, { ...x, prijs: Math.min(...bestelbaar.filter((b) => b.formaat === id).map((b) => b.prijs)) }])));
    vervang(ALLE_POSTERS, Object.fromEntries(p.map((x) => [x.id, x.titel])));
    // POSTERS = te koop in de eigen webshop (actief, bestelbare variant, aangevinkt voor de webshop).
    vervang(POSTERS, Object.fromEntries(p.filter((x) => x.status === 'actief' && opWebshop(x.id) && bestelbaar.some((b) => b.product_id === x.id)).map((x) => [x.id, x.titel])));
    vervang(TEKSTEN, Object.fromEntries(p.map((x) => [x.id, { naam: x.titel, sub: x.stijl, zin: x.beschrijving, kleur: x.accentkleur }])));
    vervang(PRODUCTEN, pOp);
    vervang(BEELDEN, Object.fromEntries(p.filter((x) => x.beeld).map((x) => [x.id, { groot: x.beeld, klein: x.beeld_klein || x.beeld }])));
    return (bron = 'database');
  } catch {
    return bron; // tabellen (nog) niet aanwezig of database even weg: laatst bekende stand houden
  }
}
