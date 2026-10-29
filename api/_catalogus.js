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
