// Test van zendingen: gesplitste levering, één mail per zending, doorgeven aan het kanaal per zending,
// en geen dubbele meldingen. Supabase, Prodigi, Etsy en Resend nagebootst.  npm test
import crypto from 'node:crypto';
import { T, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const mails = [], etsyTracking = [], P = { orders: {} };
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url);
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.resend.com') { const b = JSON.parse(o.body); mails.push({ aan: b.to[0], onderwerp: b.subject, html: b.html }); return antwoord({ id: 'm' }); }
  if (u.host === 'api.sandbox.prodigi.com') {
    const p = u.pathname.replace('/v4.0', '');
    if (p === '/orders' && o.method === 'POST') { const b = JSON.parse(o.body); const id = 'ord_' + crypto.randomBytes(3).toString('hex'); P.orders[id] = { id, merchantReference: b.merchantReference, metadata: b.metadata, status: { stage: 'InProgress' }, items: b.items.map((x, i) => ({ id: `ori_${i}`, merchantReference: x.merchantReference })), shipments: [] }; return antwoord({ outcome: 'created', order: P.orders[id] }); }
    const m = p.match(/^\/orders\/(ord_\w+)$/); if (m) return antwoord({ order: P.orders[m[1]] });
  }
  if (u.host === 'api.etsy.com') {
    if (u.pathname === '/v3/public/oauth/token') return antwoord({ access_token: 'a', refresh_token: 'b', expires_in: 3600 });
    const m = u.pathname.match(/\/shops\/555\/receipts\/(\d+)\/tracking$/); if (m) { etsyTracking.push(JSON.parse(o.body)); return antwoord({}); }
    if (u.pathname.endsWith('/shops/555/receipts')) return antwoord({ results: [] });
  }
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord', PRODIGI_SANDBOX_API_KEY: 'sb', ETSY_KEYSTRING: 'ek', ETSY_SHARED_SECRET: 'es' });
const cat = await import(R + '_catalogus.js');
const admin = (await import(R + 'admin.js')).default, prodigiRoute = (await import(R + 'prodigi.js')).default, kanalen = (await import(R + 'kanalen.js')).default, bestel = (await import(R + 'bestel.js')).default;
const { betaald } = await import(R + '_verwerk.js');
const { dekking } = await import(R + '_zendingen.js');
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];

ok(dekking([{ id: 1 }, { id: 2 }], [{ regels: ['1'] }]) === 'deels' && dekking([{ id: 1 }, { id: 2 }], [{ regels: ['1'] }, { regels: ['2'] }]) === 'volledig' && dekking([{ id: 1 }], [{ regels: null }]) === 'volledig', 'dekking: deels of volledig verzonden');

zaaiCatalogus(cat.TEKSTEN);
let did = 7000;
for (const v of T.varianten.filter((x) => x.product_id === 'golf')) { T.drukbestand_versies.push({ id: ++did, variant_sku: v.sku, versie: 1, pad: `golf/${v.sku}/v1.png`, status: 'ok', controles: [] }); Object.assign(v, { prodigi_sku: 'GLOBAL-FAP', prodigi_status: 'bevestigd', drukbestand_id: did }); }
T.kanaal_instellingen.push({ kanaal: 'prodigi', waarden: { aan: true, sandbox: true, wachttijd_min: 0 } });
await cat.laadCatalogus({ vers: true });

// ---- webshopbestelling met twee posters, twee zendingen ----
const klant = { naam: 'Ann de Vries', email: 'ann@voorbeeld.nl', straat: 'Strandweg 1', postcode: '2586 AA', plaats: 'Den Haag', land: 'NL' };
let r = await call(bestel, { method: 'POST', body: { klant, regels: [{ id: 'golf', sku: 'SKF-GOLF-30X40', aantal: 1 }, { id: 'golf', sku: 'SKF-GOLF-70X100', aantal: 1 }], akkoord: true, t: 5000 } });
const b = T.bestellingen.at(-1); await betaald(b, 'ideal');
const f = T.fulfilments.find((x) => x.bestelling_id === b.id), ord = P.orders[f.extern_id];
const regels = T.bestelregels.filter((x) => x.bestelling_id === b.id);
ok(ord.items[0].merchantReference === `${b.nummer}-R${regels[0].id}`, 'Prodigi-items dragen de orderregel als referentie');
r = await call(admin, { url: `/api/admin?actie=bestelling&id=${b.id}`, cookie });
ok(!r.j.bestelling.track_trace && !r.j.bestelling.zendingen.length, 'geen tracking zolang er geen zending is');
mails.length = 0;
ord.shipments = [{ id: 'shp_1', carrier: { name: 'PostNL', service: 'Pakket' }, tracking: { number: '3S1', url: 'https://jouw.postnl.nl/3S1' }, items: [{ itemId: 'ori_0' }] }];
const t = new URL(JSON.stringify(ord).match(/callbackUrl/) ? 'https://x' : 'https://x');
const token = (await import(R + '_prodigi.js')).callbackToken();
await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${token}`, body: { subject: ord.id } });
let nb = T.bestellingen.find((x) => x.id === b.id);
ok(nb.status === 'deels_verzonden' && T.zendingen.filter((z) => z.bestelling_id === b.id).length === 1 && T.zendingen[0].regels[0] === String(regels[0].id), 'eerste zending: deels verzonden, met de juiste orderregel');
ok(mails.length === 1 && /deelzending/.test(mails[0].onderwerp) && /de rest volgt/.test(mails[0].html), 'klant krijgt een mail over de deelzending');
await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${token}`, body: { subject: ord.id } });
ok(mails.length === 1 && T.zendingen.length === 1, 'dubbele statusmelding: geen tweede zending of mail');
ord.shipments.push({ id: 'shp_2', carrier: { name: 'DHL', service: 'Parcel' }, tracking: { number: 'JV2', url: 'https://dhl.example/JV2' }, items: [{ itemId: 'ori_1' }] });
ord.status.stage = 'Complete';
await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${token}`, body: { subject: ord.id } });
nb = T.bestellingen.find((x) => x.id === b.id);
ok(nb.status === 'verzonden' && T.zendingen.length === 2 && mails.length === 2 && !/deelzending/.test(mails[1].onderwerp) && T.fulfilments.find((x) => x.id === f.id).status === 'verzonden', 'tweede zending: volledig verzonden, één mail per zending');
r = await call(admin, { url: `/api/admin?actie=bestelling&id=${b.id}`, cookie });
ok(r.j.bestelling.zendingen.length === 2 && r.j.bestelling.zendingen[1].tracking_code === 'JV2', 'administratie toont beide zendingen met tracking');

// ---- Etsy-bestelling: elke zending één keer naar Etsy ----
T.etsy_koppeling.push({ id: 1, shop_id: 555, access_token: 'a', access_verloopt_op: new Date(Date.now() + 3600e3).toISOString(), refresh_token: 'b' });
T.kanaal_instellingen.push({ kanaal: 'etsy', waarden: { aan: true, proef: false } });
const { importeer } = await import(R + '_kanalen/opslag.js');
const ei = await importeer({ kanaal: 'etsy', extern_id: '5001', naam: 'Kim', straat: 'Laan 1', postcode: '1000AA', plaats: 'Amsterdam', land: 'NL', regels: [
  { poster_id: 'golf', poster_naam: 'Golf', formaat: '30x40', formaat_label: '30 × 40 cm', variant_sku: 'SKF-GOLF-30X40', drukbestand_versie_id: cat.VARIANTEN['SKF-GOLF-30X40'].drukbestand_id, prodigi_sku: 'GLOBAL-FAP', prijs: 30, aantal: 1, extern_item_id: 't1', gekoppeld: true },
  { poster_id: 'golf', poster_naam: 'Golf', formaat: '50x70', formaat_label: '50 × 70 cm', variant_sku: 'SKF-GOLF-50X70', drukbestand_versie_id: cat.VARIANTEN['SKF-GOLF-50X70'].drukbestand_id, prodigi_sku: 'GLOBAL-FAP', prijs: 50, aantal: 1, extern_item_id: 't2', gekoppeld: true }] });
const ef = T.fulfilments.find((x) => x.bestelling_id === ei.id), eord = P.orders[ef.extern_id];
mails.length = 0;
eord.shipments = [{ id: 'shp_a', carrier: { name: 'PostNL' }, tracking: { number: 'LX1' }, items: [{ itemId: 'ori_0' }] }];
await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${token}`, body: { subject: eord.id } });
await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=sync', cookie, body: { kanaal: 'etsy', stap: 'verzendingen' } });
ok(etsyTracking.length === 1 && etsyTracking[0].tracking_code === 'LX1' && !mails.some((m) => m.aan !== 'hallo@skiffa.nl'), 'Etsy-zending doorgegeven; wij mailen de Etsy-koper niet (Etsy doet dat)');
await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=sync', cookie, body: { kanaal: 'etsy', stap: 'verzendingen' } });
ok(etsyTracking.length === 1, 'opnieuw synchroniseren: niet dubbel doorgegeven');
eord.shipments.push({ id: 'shp_b', carrier: { name: 'PostNL' }, tracking: { number: 'LX2' }, items: [{ itemId: 'ori_1' }] });
await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${token}`, body: { subject: eord.id } });
await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=sync', cookie, body: { kanaal: 'etsy', stap: 'verzendingen' } });
const eb = T.bestellingen.find((x) => x.id === ei.id);
ok(etsyTracking.length === 2 && etsyTracking[1].tracking_code === 'LX2' && eb.status === 'verzonden' && eb.extern_verzonden_op, 'tweede zending ook doorgegeven; bestelling volledig verzonden en gemeld');

// ---- handmatig: gesplitst verzenden vanuit de administratie ----
r = await call(bestel, { method: 'POST', body: { klant, regels: [{ id: 'golf', sku: 'SKF-GOLF-30X40', aantal: 1 }, { id: 'golf', sku: 'SKF-GOLF-50X70', aantal: 1 }], akkoord: true, t: 5000 } });
const hb = T.bestellingen.at(-1); T.kanaal_instellingen.find((x) => x.kanaal === 'prodigi').waarden.aan = false; await betaald(hb, 'ideal');
const hr = T.bestelregels.filter((x) => x.bestelling_id === hb.id);
mails.length = 0;
r = await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: hb.id, status: 'verzonden', track_trace: 'H1', vervoerder: 'postnl', regels: [hr[0].id] } });
ok(r.j.ok && r.j.deels && T.bestellingen.find((x) => x.id === hb.id).status === 'deels_verzonden' && mails.length === 1, 'handmatig deel verzonden: deels verzonden, één mail');
r = await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: hb.id, status: 'verzonden', track_trace: 'H1', vervoerder: 'postnl' } });
ok(!r.j.ok && /al vastgelegd/.test(r.j.melding), 'dezelfde track-and-trace nogmaals: geweigerd (geen dubbele zending)');
r = await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: hb.id, status: 'verzonden', track_trace: 'H2', vervoerder: 'dhl', regels: [hr[1].id] } });
ok(r.j.ok && !r.j.deels && T.bestellingen.find((x) => x.id === hb.id).status === 'verzonden' && mails.length === 2, 'rest verzonden: volledig, tweede mail');
