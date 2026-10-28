// Seed de Skiffa-content naar het centrale CMS via de sync-API (BOUW-EEN-SITE.md §8).
// Bron van waarheid = index.html (via lees-content.mjs), zodat CMS en ontwerp niet uit de pas lopen.
//
// Kanalen (empirisch bepaald met scripts/probe.mjs — sync bewaart geen site.config/design_tokens,
// maar wél block-content verbatim):
//   - tagline -> header-blok `subheading`   (frontend leest 1e header-subheading)
//   - posters -> blok met `content.posters`  (frontend koppelt de teksten op id; prijzen blijven in de code)
//
// Draai:  CMS_URL=… CMS_TOKEN=cms_… node scripts/cms-seed.mjs
import { tagline, posters } from './lees-content.mjs';

// Alleen de teksten; beelden, formaten en prijzen blijven in de code.
const posterTekst = posters.map(({ id, naam, sub, zin, kleur, punten }) => ({ id, naam, sub, zin, kleur, punten }));

const BASIS = process.env.CMS_URL || 'https://linkandlead.nl';
const TOKEN = process.env.CMS_TOKEN;
if (!TOKEN) { console.error('Zet CMS_TOKEN'); process.exit(1); }

const body = {
  paginas: [
    {
      slug: '/',
      titel: 'Skiffa — posters van de Scheveningse surfcultuur',
      beschrijving: 'Skiffa is straattaal voor Scheveningen. Posters over de surfcultuur van ons strand.',
      blokken: [
        {
          type: 'header',
          content: {
            eyebrow: 'Scheveningen',
            heading: 'Skiffa',
            subheading: tagline,
          },
        },
        {
          // Draagt de postertekst voor de frontend (content.posters) én een leesbare
          // items-lijst zodat het blok in /admin ook betekenisvol is.
          type: 'kaarten',
          content: {
            eyebrow: 'de posters',
            titel: 'Surfcultuur aan de Noordzee',
            intro: 'Elke poster is een hoofdstuk uit de surfgeschiedenis van Scheveningen. Drie formaten, kleine oplages.',
            kolommen: 3,
            items: posters.map((s) => ({ titel: s.naam, tekst: s.zin })),
            posters: posterTekst,
          },
        },
      ],
    },
    {
      // Ruim de probe-pagina op: leeg blok-lijst.
      slug: '/probe',
      titel: '(leeg)',
      beschrijving: '',
      blokken: [],
    },
  ],
};

const push = await fetch(`${BASIS}/api/cms/sync`, {
  method: 'POST',
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
console.log('== SYNC ==', push.status, (await push.text()).slice(0, 300));

// Lees terug ter controle.
const get = await fetch(`${BASIS}/api/cms/content?slug=/`, { headers: { authorization: `Bearer ${TOKEN}` } });
const data = await get.json();
const home = (data.paginas || []).find((p) => p.slug === '/');
const posterBlok = home?.blokken?.find((b) => Array.isArray(b.content?.posters));
const header = home?.blokken?.find((b) => b.type === 'header');
console.log('\n== controle ==');
console.log('home gevonden:', !!home);
console.log('tagline (header.subheading):', header?.content?.subheading);
console.log('posters in CMS:', posterBlok?.content?.posters?.length);
