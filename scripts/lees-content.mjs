// Leest de canonieke content (tagline + shirts) rechtstreeks uit index.html,
// zodat de seed nooit uit de pas loopt met het ontwerp. index.html blijft de bron van waarheid.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(hier, '..', 'index.html'), 'utf8');

const taglineMatch = html.match(/id="tagline">([^<]*)</);
export const tagline = taglineMatch ? taglineMatch[1].trim() : '';

const shirtsMatch = html.match(/let shirts=(\[[\s\S]*?\]);/);
if (!shirtsMatch) throw new Error('shirts-array niet gevonden in index.html');
// eslint-disable-next-line no-eval
export const shirts = eval(shirtsMatch[1]);

export default { tagline, shirts };
