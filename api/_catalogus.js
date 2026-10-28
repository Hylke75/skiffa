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
};

export const FORMATEN = {
  '30x45': { label: '30 × 45 cm', prijs: 29 },
  '50x75': { label: '50 × 75 cm', prijs: 45 },
  '70x105': { label: '70 × 105 cm', prijs: 69 },
};

export const VERZENDING = { NL: 6.95, BE: 9.95 };
export const GRATIS_VANAF = 75;

export function verzendkosten(subtotaal, land) {
  return subtotaal >= GRATIS_VANAF ? 0 : VERZENDING[land] ?? VERZENDING.NL;
}
