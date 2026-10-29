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
  '30x40': { label: '30 × 40 cm', prijs: 29, mm: [300, 400], actief: true },     // instap, cadeau
  '50x70': { label: '50 × 70 cm', prijs: 45, mm: [500, 700], actief: true },     // hoofdproduct
  '70x100': { label: '70 × 100 cm', prijs: 69, mm: [700, 1000], actief: true },  // grote uitvoering
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
// Centrale catalogus. Staat er in Supabase een catalogus (tabellen catalogus_producten en
// catalogus_formaten, beheer in /admin → posters), dan is die leidend: laadCatalogus() vult de
// objecten hierboven daarmee (in place, zodat alle bestaande imports meteen meedoen). Zonder database,
// of zolang de tabellen leeg zijn, blijft alles bij de waarden in deze code.
// Elke route die met producten of prijzen werkt, roept eerst `await laadCatalogus()` aan.
import { dbAan, db } from './_db.js';
import { POSTERTEKSTEN } from './_posterteksten.js';

/** Alle producten, ook niet-actieve (voor beheer en oude orders). POSTERS = alleen wat te koop is. */
export const ALLE_POSTERS = { ...POSTERS };
/** Teksten per product (naam, sub, zin, kleur) voor kanalen en catalogus. */
export const TEKSTEN = Object.fromEntries(Object.entries(POSTERTEKSTEN).map(([id, t]) => [id, { ...t }]));
/** Eigen productbeeld (opslagpaden) voor producten die niet als bestand in /posters staan. */
export const BEELDEN = {};
/** Producten waarvan het beeld als bestand in /posters/ staat (meegeleverd met de site). */
export const VASTE_BEELDEN = new Set(Object.keys(POSTERS));
export const CODE_FORMATEN = JSON.parse(JSON.stringify(ALLE_FORMATEN));

const CACHE_MS = 60 * 1000;
let geladenOp = 0, bron = 'code';
export const catalogusBron = () => bron;

function vervang(doel, nieuw) {
  for (const k of Object.keys(doel)) delete doel[k];
  Object.assign(doel, nieuw);
}

export async function laadCatalogus({ vers = false } = {}) {
  if (!dbAan() || (!vers && Date.now() - geladenOp < CACHE_MS)) return bron;
  geladenOp = Date.now();
  try {
    const [p, f] = await Promise.all([
      db('catalogus_producten?select=*&order=volgorde.asc,id.asc'),
      db('catalogus_formaten?select=*&order=volgorde.asc,id.asc'),
    ]);
    if (!p.length || !f.length) return (bron = 'code');
    vervang(ALLE_FORMATEN, Object.fromEntries(f.map((x) => [x.id, {
      label: x.label, prijs: Number(x.prijs), mm: [Number(x.breedte_mm), Number(x.hoogte_mm)], actief: !!x.actief,
      standaard: !!x.standaard, prodigi_sku: x.prodigi_sku || null,
    }])));
    vervang(FORMATEN, Object.fromEntries(Object.entries(ALLE_FORMATEN).filter(([, x]) => x.actief)));
    vervang(ALLE_POSTERS, Object.fromEntries(p.map((x) => [x.id, x.naam])));
    vervang(POSTERS, Object.fromEntries(p.filter((x) => x.actief).map((x) => [x.id, x.naam])));
    vervang(TEKSTEN, Object.fromEntries(p.map((x) => [x.id, { naam: x.naam, sub: x.sub, zin: x.zin, kleur: x.kleur }])));
    vervang(BEELDEN, Object.fromEntries(p.filter((x) => x.beeld).map((x) => [x.id, { groot: x.beeld, klein: x.beeld_klein || x.beeld }])));
    return (bron = 'database');
  } catch {
    return bron; // tabellen (nog) niet aanwezig of database even weg: laatst bekende stand houden
  }
}
