// Schrijft api/_posterteksten.js (naam, stijl, omschrijving per actieve poster) uit index.html,
// zodat de koppelingen met bol, Etsy en Amazon dezelfde teksten gebruiken als de winkel.
//   node scripts/maak-posterteksten.mjs        (check-catalogus.mjs controleert of het bij is)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { posters } from './lees-content.mjs';

export const inhoud = () => `// Gegenereerd door scripts/maak-posterteksten.mjs uit index.html — niet met de hand wijzigen.
export const POSTERTEKSTEN = ${JSON.stringify(Object.fromEntries(posters.map((p) => [p.id, { naam: p.naam, sub: p.sub, zin: p.zin }])), null, 2)};
`;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../api/_posterteksten.js', import.meta.url), inhoud());
  console.log(`api/_posterteksten.js bijgewerkt (${posters.length} posters)`);
}
