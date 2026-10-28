// Ontdek wat de sync-API bewaart. Pusht de content via meerdere kanalen tegelijk
// (design_tokens + header-blok subheading + een blok met content.posters) en leest daarna
// terug wat het CMS ervan heeft bewaard. Zo weten we welk kanaal betrouwbaar is vóór we echt seeden.
import { tagline, posters } from './lees-content.mjs';

const BASIS = process.env.CMS_URL || 'https://linkandlead.nl';
const TOKEN = process.env.CMS_TOKEN;
if (!TOKEN) { console.error('Zet CMS_TOKEN'); process.exit(1); }

const body = {
  design_tokens: { tagline, posters, _probe: 'dt' },
  paginas: [{
    slug: '/probe',
    titel: 'Probe',
    beschrijving: 'tijdelijke probe',
    blokken: [
      { type: 'header', content: { eyebrow: 'skiffa', heading: 'Skiffa', subheading: tagline } },
      { type: 'kaarten', content: { titel: 'Posters', posters, _probe: 'blok', items: posters.map(s => ({ titel: s.naam, tekst: s.sub })) } },
    ],
  }],
};

const push = await fetch(`${BASIS}/api/cms/sync`, {
  method: 'POST',
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
console.log('== SYNC ==', push.status);
console.log((await push.text()).slice(0, 800));

const get = await fetch(`${BASIS}/api/cms/content`, { headers: { authorization: `Bearer ${TOKEN}` } });
const data = await get.json();
console.log('\n== GET terug ==');
console.log('site.config:', JSON.stringify(data.site?.config));
console.log('site.design_tokens:', JSON.stringify(data.site?.design_tokens)?.slice(0, 400));
const probe = (data.paginas || []).find(p => p.slug === '/probe');
console.log('probe-pagina gevonden:', !!probe);
if (probe) {
  for (const b of probe.blokken || []) {
    console.log(`  blok type=${b.type} content-keys=${Object.keys(b.content || {})}`);
    if (b.content?.posters) console.log(`    -> content.posters BEWAARD (${b.content.posters.length})`);
    if (b.content?.subheading) console.log(`    -> subheading="${b.content.subheading}"`);
  }
}
