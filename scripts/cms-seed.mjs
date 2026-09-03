// Seed de Skiffa-content naar het centrale CMS via de sync-API (BOUW-EEN-SITE.md §8).
// Bron van waarheid = index.html (via lees-content.mjs), zodat CMS en ontwerp niet uit de pas lopen.
//
// Kanalen (empirisch bepaald met scripts/probe.mjs — sync bewaart geen site.config/design_tokens,
// maar wél block-content verbatim):
//   - tagline -> header-blok `subheading`   (frontend leest 1e header-subheading)
//   - shirts  -> blok met `content.shirts`   (frontend leest 1e blok met content.shirts)
//
// Draai:  CMS_URL=… CMS_TOKEN=cms_… node scripts/cms-seed.mjs
import { tagline, shirts } from './lees-content.mjs';

const BASIS = process.env.CMS_URL || 'https://linkandlead.nl';
const TOKEN = process.env.CMS_TOKEN;
if (!TOKEN) { console.error('Zet CMS_TOKEN'); process.exit(1); }

const body = {
  paginas: [
    {
      slug: '/',
      titel: 'Skiffa — made for the grey side of the sea',
      beschrijving: 'Skiffa is straattaal voor Scheveningen. Zes t-shirts voor de grijze kant van de zee.',
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
          // Draagt de volledige shirt-data voor de frontend (content.shirts) én een leesbare
          // items-lijst zodat het blok in /admin ook betekenisvol is.
          type: 'kaarten',
          content: {
            eyebrow: 'de collectie',
            titel: 'Zes shirts, en meer niet',
            intro: 'Elk shirt is een plek of een moment aan zee. Eén prijs, vier maten, kleine oplages.',
            kolommen: 3,
            items: shirts.map((s) => ({ titel: s.naam, tekst: s.zin })),
            shirts,
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
const shirtBlok = home?.blokken?.find((b) => Array.isArray(b.content?.shirts));
const header = home?.blokken?.find((b) => b.type === 'header');
console.log('\n== controle ==');
console.log('home gevonden:', !!home);
console.log('tagline (header.subheading):', header?.content?.subheading);
console.log('shirts in CMS:', shirtBlok?.content?.shirts?.length);
