// Leest de canonieke content (tagline, posters, formaten) rechtstreeks uit index.html,
// zodat de seed nooit uit de pas loopt met het ontwerp. index.html blijft de bron van waarheid.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(hier, '..', 'index.html'), 'utf8');

const taglineMatch = html.match(/id="tagline">([^<]*)</);
export const tagline = taglineMatch ? taglineMatch[1].trim() : '';

function blok(re, naam) {
  const m = html.match(re);
  if (!m) throw new Error(`${naam} niet gevonden in index.html`);
  return m[1];
}
const formatenSrc = blok(/const formaten=(\[[\s\S]*?\]);/, 'formaten-array');
const puntenSrc = blok(/const PUNTEN=(\[[\s\S]*?\]);/, 'PUNTEN');
const postersSrc = blok(/let posters=(\[[\s\S]*?\n\]);/, 'posters-array');
// eslint-disable-next-line no-new-func
export const formaten = new Function(`return ${formatenSrc}`)();
// eslint-disable-next-line no-new-func
const allePosters = new Function('PUNTEN', `return ${postersSrc}`)(new Function(`return ${puntenSrc}`)());
// Alleen wat op de site staat (actief:false = klaargezet, nog zonder beeld).
export const posters = allePosters.filter((p) => p.actief !== false);

export default { tagline, posters, formaten };
