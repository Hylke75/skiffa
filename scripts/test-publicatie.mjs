// Test van publiceren op verkoopkanalen (webshop en Etsy) vanuit de centrale catalogus, zonder echte
// diensten. Kern: nieuwe advertentie vs. bijwerken, nooit dubbel, eerlijke statussen.  npm test
import crypto from 'node:crypto';
import { T, S, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const E = { listings: {}, posts: 0, uploads: 0, deletes: 0, faalInventaris: 0 };
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url), body = typeof o.body === 'string' && o.body.startsWith('{') ? JSON.parse(o.body) : o.body;
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'skiffa.store' || u.pathname.includes('/object/public/')) return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  if (u.host === 'api.etsy.com') {
    const p = u.pathname.replace('/v3/application', '');
    if (u.pathname === '/v3/public/oauth/token') return antwoord({ access_token: 'etsy-at', refresh_token: 'etsy-rt', expires_in: 3600 });
    if (p === '/shops/555/listings' && o.method === 'POST') { E.posts++; const id = String(9000 + E.posts); const v = Object.fromEntries(new URLSearchParams(o.body)); E.listings[id] = { velden: v, tags: v.tags.split(','), state: 'draft', images: [] }; return antwoord({ listing_id: Number(id), url: `https://www.etsy.com/listing/${id}/x` }, 201); }
    if (p === '/shops/555/listings' && o.method === 'GET') { const st = u.searchParams.get('state'); return antwoord({ results: Object.entries(E.listings).filter(([, l]) => l.state === st).map(([id, l]) => ({ listing_id: Number(id), tags: l.tags })) }); }
    if (p === '/shops/555/receipts') return antwoord({ results: [] });
    let m = p.match(/^\/listings\/(\d+)\/images$/); if (m) return antwoord({ results: E.listings[m[1]].images.map((x) => ({ listing_image_id: x })) });
    m = p.match(/^\/shops\/555\/listings\/(\d+)\/images\/(\d+)$/); if (m && o.method === 'DELETE') { E.deletes++; E.listings[m[1]].images = E.listings[m[1]].images.filter((x) => String(x) !== m[2]); return antwoord(undefined, 204); }
    m = p.match(/^\/shops\/555\/listings\/(\d+)\/images$/); if (m) { E.uploads++; const iid = 100 + E.uploads; E.listings[m[1]].images.push(iid); return antwoord({ listing_image_id: iid }, 201); }
    m = p.match(/^\/listings\/(\d+)\/inventory$/); if (m) { if (E.faalInventaris > 0) { E.faalInventaris--; return antwoord({ error: 'Invalid property value' }, 400); } E.listings[m[1]].inventaris = body; return antwoord({ products: [] }); }
    m = p.match(/^\/shops\/555\/listings\/(\d+)$/); if (m && o.method === 'PATCH') { const v = Object.fromEntries(new URLSearchParams(o.body)); if (v.state) E.listings[m[1]].state = v.state; else { E.listings[m[1]].update = v; E.listings[m[1]].tags = (v.tags || '').split(','); } return antwoord({ url: `https://www.etsy.com/listing/${m[1]}/x` }); }
  }
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord', ETSY_KEYSTRING: 'ek', ETSY_SHARED_SECRET: 'es', CRON_SECRET: 'cron-geheim-1234567890' });

const cat = await import(R + '_catalogus.js');
const { prijsVolgensRegel } = await import(R + '_publicatie.js');
const kanalen = (await import(R + 'kanalen.js')).default, admin = (await import(R + 'admin.js')).default, catalogus = (await import(R + 'catalogus.js')).default;
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];
const K = (a, body) => call(kanalen, { method: body ? 'POST' : 'GET', url: `/api/kanalen?actie=${a}`, body, cookie });
const stand = async (id, k = 'etsy') => (await K('publicatie')).j.producten.find((p) => p.id === id).kanalen[k];

// ---- prijsregels ----
ok(prijsVolgensRegel(45, { type: 'basis' }) === 45 && prijsVolgensRegel(45, { type: 'vast', waarde: 5 }) === 50 && prijsVolgensRegel(45, { type: 'procent', waarde: 15 }) === 51.75
  && prijsVolgensRegel(45, { type: 'procent', waarde: 15, afronden_95: true }) === 51.95 && prijsVolgensRegel(45, { type: 'handmatig', prijzen: { X: '49,50' } }, 'X') === 49.5 && prijsVolgensRegel(45, { type: 'handmatig', prijzen: {} }, 'X') === null, 'prijsregels: basis, vast, procent (optioneel x,95), handmatig');

// ---- catalogus: golf bestelbaar in 30×40 en 50×70, op twee papiersoorten ----
zaaiCatalogus(cat.TEKSTEN);
T.papiersoorten.push({ id: 'photo-rag', naam: 'Photo Rag', uitleg: 'Katoen', gewicht_gsm: 308, actief: true, volgorde: 20 });
T.varianten.push({ ...T.varianten.find((v) => v.sku === 'SKF-GOLF-50X70'), sku: 'SKF-GOLF-50X70-PHOTO-RAG', papier_id: 'photo-rag', prijs: 59 });
let did = 5000;
for (const v of T.varianten.filter((x) => x.product_id === 'golf' && x.formaat_id !== '70x100')) {
  T.drukbestand_versies.push({ id: ++did, variant_sku: v.sku, versie: 1, pad: `golf/${v.sku}/v1-a.png`, status: 'ok', controles: [] });
  Object.assign(v, { handmatig_leverbaar: true, handmatig_reden: 'eigen drukker', drukbestand_id: did });
}
for (const p of T.producten) T.product_kanalen.push({ product_id: p.id, kanaal: 'webshop', publiceren: true, afwijkingen: {}, status: 'niet_gepubliceerd', meta: {} });
T.etsy_koppeling.push({ id: 1, shop_id: 555, shop_naam: 'SkiffaPosters', access_token: 'etsy-at', access_verloopt_op: new Date(Date.now() + 3600e3).toISOString(), refresh_token: 'rt' });
await cat.laadCatalogus({ vers: true });

let r = await K('publicatie');
let g = r.j.producten.find((p) => p.id === 'golf');
ok(r.j.ok && g.kanalen.webshop.status === 'actief' && g.kanalen.webshop.extern_url === 'https://skiffa.store/#golf' && g.kanalen.etsy.status === 'niet_gepubliceerd' && r.j.producten.find((p) => p.id === 'zon').kanalen.webshop.status === 'onvolledig', 'overzicht: golf actief in de webshop, nog niet op Etsy; zon onvolledig (met reden)');
ok(/geen bestelbare variant/.test(r.j.producten.find((p) => p.id === 'zon').kanalen.webshop.melding) && r.j.kanalen.ebay.soort === 'niet-beschikbaar' && r.j.kanalen.tiktok.soort === 'elders', 'eerlijk: eBay als niet beschikbaar, TikTok Shop via Koppelingen');

// ---- aanvinken: eerst onvolledig, dan met sjabloon gereed ----
r = await K('publicatie-zet', { product_id: 'golf', kanaal: 'etsy', publiceren: true });
let e = await stand('golf'); ok(r.j.ok && e.status === 'onvolledig' && /categorie/.test(e.melding) && /verzendprofiel/.test(e.melding), 'aangevinkt zonder sjabloon: onvolledig, met wat ontbreekt');
r = await K('sjabloon', { kanaal: 'etsy', naam: 'Posters standaard', standaard: true, waarden: { taal: 'en', categorie: '1027', verzendprofiel_id: '111', verwerkingsprofiel_id: '222', tags: ['surf poster', 'scheveningen'], prijsregel: { type: 'vast', waarde: 5 }, titel_achtervoegsel: 'Scheveningen surf poster' } });
e = await stand('golf'); ok(r.j.ok && e.status === 'gereed' && /nieuwe advertentie/.test(e.melding) && JSON.stringify(e.prijzen.map((v) => v.prijs)) === '[34,50,64]', 'standaardsjabloon: gereed, prijzen volgens de regel (+ € 5)');
r = await K('publicatie-zet', { product_id: 'golf', kanaal: 'bol', publiceren: true }); ok(r.c === 400, 'kanalen zonder publicatiekoppeling hier geweigerd');

// ---- automatisch publiceren uit: niets; handmatig publiceren: één advertentie ----
await K('instellingen', { kanaal: 'etsy', waarden: { aan: true, proef: false } });
await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=cron', headers: { authorization: 'Bearer cron-geheim-1234567890' } });
ok(E.posts === 0, 'automatisch publiceren staat uit: de cron publiceert niets');
const [p1, p2] = await Promise.all([K('publiceer', { product_id: 'golf', kanaal: 'etsy' }), K('publiceer', { product_id: 'golf', kanaal: 'etsy' })]);
const L = E.listings['9001'];
ok(E.posts === 1 && L.state === 'active' && L.images.length === 1 && L.velden.title === 'Golf – Scheveningen surf poster' && L.velden.taxonomy_id === '1027' && L.tags.includes('skf-skf-006'), 'publiceren: één advertentie (ook bij een dubbele klik), met foto, titel uit sjabloon, categorie en herkenningstag');
ok(L.inventaris.products.length === 3 && L.inventaris.price_on_property.join() === '513,514' && L.inventaris.products.find((x) => x.sku === 'SKF-GOLF-50X70-PHOTO-RAG').offerings[0].price === 64, 'varianten: formaat én papier als keuze, prijs per variant');
e = await stand('golf'); ok(e.status === 'actief' && e.extern_url === 'https://www.etsy.com/listing/9001/x' && e.laatste_sync_op, 'status actief, met link naar de advertentie en tijdstip van de laatste synchronisatie');

// ---- wijziging = bijwerken, geen nieuwe advertentie ----
await K('publicatie-zet', { product_id: 'golf', kanaal: 'etsy', afwijkingen: { titel: 'Golf poster – Dutch North Sea' } });
e = await stand('golf'); ok(e.status === 'gereed' && /wijziging/.test(e.melding), 'afwijkende titel: wijziging klaar om bij te werken');
const uploadsVoor = E.uploads;
await K('publiceer', { product_id: 'golf', kanaal: 'etsy' });
ok(E.posts === 1 && L.update.title === 'Golf poster – Dutch North Sea' && E.uploads === uploadsVoor && (await stand('golf')).status === 'actief', 'bijwerken: bestaande advertentie aangepast, foto\'s niet opnieuw geüpload');
await call(catalogus, { method: 'POST', url: '/api/catalogus?actie=variant', cookie, body: { sku: 'SKF-GOLF-30X40', prijs: 31 } });
e = await stand('golf'); ok(e.status === 'gereed', 'prijswijziging in de centrale catalogus: Etsy moet bijgewerkt worden');
await K('publiceer', { product_id: 'golf', kanaal: 'etsy' });
ok(L.inventaris.products.find((x) => x.sku === 'SKF-GOLF-30X40').offerings[0].price === 36, 'nieuwe prijs doorgezet (€ 31 + € 5)');

// ---- fout: concrete uitleg; zelfde inhoud blijft fout tot er iets verandert ----
E.faalInventaris = 1;
await K('publicatie-zet', { product_id: 'golf', kanaal: 'etsy', afwijkingen: { titel: 'Golf poster – North Sea' } });
r = await K('publiceer', { product_id: 'golf', kanaal: 'etsy' });
e = await stand('golf'); ok(!r.j.ok && e.status === 'fout' && /Invalid property value/.test(e.melding), 'Etsy weigert: status fout met de reden van Etsy');
await K('publicatie-zet', { product_id: 'golf', kanaal: 'etsy', afwijkingen: { titel: 'Golf poster – North Sea!' } });
e = await stand('golf'); ok(e.status === 'gereed', 'na een wijziging: weer gereed om opnieuw te proberen');
await K('publiceer', { product_id: 'golf', kanaal: 'etsy' }); ok((await stand('golf')).status === 'actief' && E.posts === 1, 'opnieuw geprobeerd: actief, nog steeds één advertentie');

// ---- onderbreking tijdens aanmaken: bestaande advertentie wordt herkend ----
for (const v of T.varianten.filter((x) => x.product_id === 'zon' && x.formaat_id === '50x70')) { T.drukbestand_versies.push({ id: ++did, variant_sku: v.sku, versie: 1, pad: 'zon/x.png', status: 'ok', controles: [] }); Object.assign(v, { handmatig_leverbaar: true, handmatig_reden: 'eigen drukker', drukbestand_id: did }); }
await cat.laadCatalogus({ vers: true });
E.listings['8888'] = { velden: {}, tags: ['skf-skf-016'], state: 'draft', images: [] };
T.product_kanalen.push({ product_id: 'zon', kanaal: 'etsy', publiceren: true, afwijkingen: {}, status: 'verwerken', verwerken_sinds: new Date(Date.now() - 20 * 60000).toISOString(), aanmaken_gestart_op: new Date(Date.now() - 20 * 60000).toISOString(), meta: {}, extern_id: null });
e = await stand('zon'); ok(e.status === 'gereed', 'vastgelopen verwerking (> 15 min): weer gereed');
await K('publiceer', { product_id: 'zon', kanaal: 'etsy' });
ok(E.posts === 1 && T.product_kanalen.find((x) => x.product_id === 'zon' && x.kanaal === 'etsy').extern_id === '8888' && E.listings['8888'].state === 'active', 'na onderbreking: bestaande advertentie herkend aan de tag, geen tweede aangemaakt');

// ---- handmatige prijs ontbreekt: onvolledig ----
await K('publicatie-zet', { product_id: 'zon', kanaal: 'etsy', afwijkingen: { prijsregel: { type: 'handmatig', prijzen: {} } } });
e = await stand('zon'); ok(e.status === 'onvolledig' && /geen prijs/.test(e.melding), 'handmatige prijsregel zonder prijs: onvolledig');
await K('publicatie-zet', { product_id: 'zon', kanaal: 'etsy', afwijkingen: { prijsregel: { type: 'handmatig', prijzen: { 'SKF-ZON-50X70': '55' } } } });
e = await stand('zon'); ok(e.status === 'gereed' && e.prijzen[0].prijs === 55, 'met handmatige prijs: gereed');

// ---- offline halen ----
await K('publicatie-zet', { product_id: 'golf', kanaal: 'etsy', publiceren: false });
e = await stand('golf'); ok(e.status === 'gereed' && /offline/.test(e.melding), 'uitgevinkt: wordt offline gehaald');
await K('publiceer', { product_id: 'golf', kanaal: 'etsy' });
ok(L.state === 'inactive' && (await stand('golf')).status === 'niet_gepubliceerd' && E.posts === 1, 'offline gehaald (advertentie blijft bewaard voor later)');

// ---- automatisch publiceren aan, proefmodus ----
await K('instellingen', { kanaal: 'etsy', waarden: { auto_publiceren: true, proef: true } });
r = await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=cron', headers: { authorization: 'Bearer cron-geheim-1234567890' } });
ok(r.j.resultaat.etsy === 'ok' && (await stand('zon')).status === 'gereed' && E.listings['8888'].inventaris.products[0].offerings[0].price !== 55, 'proefmodus: er wordt niets naar Etsy geschreven, status blijft gereed');
await K('instellingen', { kanaal: 'etsy', waarden: { proef: false } });
await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=cron', headers: { authorization: 'Bearer cron-geheim-1234567890' } });
ok((await stand('zon')).status === 'actief' && E.listings['8888'].inventaris.products[0].offerings[0].price === 55, 'automatisch publiceren: de cron werkt gereedstaande producten bij');

// ---- webshop uitvinken ----
await K('publicatie-zet', { product_id: 'golf', kanaal: 'webshop', publiceren: false });
ok(!cat.POSTERS.golf && (await stand('golf', 'webshop')).status === 'niet_gepubliceerd', 'webshop uitgevinkt: niet meer te koop in de eigen winkel');
r = await call(catalogus, { url: '/api/catalogus' }); ok(!r.j.producten.some((p) => p.id === 'golf'), 'de winkel toont de poster niet meer');
r = await call(kanalen, { url: '/api/kanalen?actie=publicatie' }); ok(r.c === 401, 'verkoopkanalen zonder inlog geweigerd');
