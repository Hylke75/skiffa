// Controleert of de posters en prijzen in index.html gelijk lopen met api/_catalogus.js
// (de server rekent met die laatste) en of elk actief posterbeeld bestaat.
//   node scripts/check-catalogus.mjs
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { posters, formaten } from './lees-content.mjs';
import { POSTERS, FORMATEN } from '../api/_catalogus.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fouten = [];
const ids = posters.map((p) => p.id);
for (const id of ids) if (!POSTERS[id]) fouten.push(`poster '${id}' staat actief in index.html maar niet in api/_catalogus.js`);
for (const id of Object.keys(POSTERS)) if (!ids.includes(id)) fouten.push(`poster '${id}' staat in api/_catalogus.js maar niet actief in index.html`);
for (const f of formaten) {
  const s = FORMATEN[f.id];
  if (!s) fouten.push(`formaat '${f.id}' ontbreekt in api/_catalogus.js`);
  else if (s.prijs !== f.prijs) fouten.push(`formaat '${f.id}': € ${f.prijs} op de site, € ${s.prijs} op de server`);
}
for (const id of Object.keys(FORMATEN)) if (!formaten.some((f) => f.id === id)) fouten.push(`formaat '${id}' staat alleen op de server`);
for (const p of posters) {
  const bestanden = [`posters/${p.id}.webp`, `posters/${p.id}-klein.webp`];
  for (const b of bestanden) if (!existsSync(join(root, b))) fouten.push(`bestand ontbreekt: ${b}`);
}
if (fouten.length) {
  console.error(fouten.map((f) => '✗ ' + f).join('\n'));
  process.exit(1);
}
console.log(`✓ ${posters.length} posters en ${formaten.length} formaten lopen gelijk; alle beelden aanwezig`);
