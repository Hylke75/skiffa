// Test van de Meta-productfeed en de TikTok Shop-koppeling: feedformaat volgens de Meta-specificatie,
// ontbrekende velden, ophalen door Meta, goedkeuring; TikTok-handtekening (voorbeeld uit de documentatie),
// orders alleen als ze klaar zijn voor verzending, annuleringsverzoeken op de actielijst, tracking per pakket,
// concept hoogstens één keer. Supabase, Meta en TikTok nagebootst.  npm test
import { T, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const TT = { orders: [], annuleringen: [], verzonden: [], beslist: [], producten: 0, uploads: 0, sleutels: new Set(), providers: [{ id: 'p-postnl', name: 'PostNL' }, { id: 'p-dhl', name: 'DHL Parcel' }], ondertekend: [] };
const mails = [];
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url);
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.resend.com') { mails.push(JSON.parse(o.body).subject); return antwoord({ id: 'm' }); }
  if (u.host === 'graph.facebook.com') {
    if (o.headers.authorization !== 'Bearer mt') return antwoord({ error: { message: 'Invalid OAuth access token' } }, 401);
    return antwoord({ data: [{ id: 'm1', retailer_id: 'SKF-GOLF-50X70', review_status: 'rejected', review_rejection_reasons: ['Afbeelding bevat tekst'] }, { id: 'm2', retailer_id: 'SKF-GOLF-30X40', review_status: 'approved' }] });
  }
  if (u.host === 'skiffa.store') return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(8), text: async () => '<rss><item></item></rss>' };
  if (u.host === 'auth.tiktok-shops.com') return antwoord({ code: 0, data: { access_token: 'at2', refresh_token: 'rt2', access_token_expire_in: Math.floor(Date.now() / 1000) + 7 * 86400, refresh_token_expire_in: Math.floor(Date.now() / 1000) + 365 * 86400 } });
  if (u.host === 'open-api.tiktokglobalshop.com') {
    TT.ondertekend.push(u.searchParams.get('sign') && u.searchParams.get('app_key') === 'ak' && o.headers['x-tts-access-token'] === 'at');
    const p = u.pathname;
    if (p === '/order/202309/orders/search') return antwoord({ code: 0, data: { orders: TT.orders } });
    if (p === '/return_refund/202309/cancellations/search') return antwoord({ code: 0, data: { cancellations: TT.annuleringen } });
    if (/\/cancellations\/\w+\/(approve|reject)$/.test(p)) { TT.beslist.push([p, u.searchParams.get('idempotency_key')]); return antwoord({ code: 0, data: {} }); }
    if (/\/delivery_options\/.+\/shipping_providers$/.test(p)) return antwoord({ code: 0, data: { shipping_providers: TT.providers } });
    if (/\/fulfillment\/202309\/packages\/.+\/ship$/.test(p)) { TT.verzonden.push({ pakket: p.split('/')[4], ...JSON.parse(o.body).self_shipment }); return antwoord({ code: 0, data: {} }); }
    if (p === '/product/202309/images/upload') { TT.uploads++; return antwoord({ code: 0, data: { uri: `tos/${TT.uploads}` } }); }
    if (p === '/product/202309/products' && o.method === 'POST') { const b = JSON.parse(o.body); TT.laatsteProduct = b; if (!TT.sleutels.has(b.idempotency_key)) { TT.sleutels.add(b.idempotency_key); TT.producten++; } return antwoord({ code: 0, data: { product_id: '1729', skus: [] } }); }
    if (p === '/product/202309/products/1729') return antwoord({ code: 0, data: { status: 'FREEZE', audit: { status: 'FAILED' }, audit_failed_reasons: [{ reasons: ['Merk ontbreekt'] }] } });
    if (p === '/authorization/202309/shops') return antwoord({ code: 0, data: { shops: [{ id: 's1', name: 'SKIFFA NL', region: 'NL', cipher: 'ciph' }] } });
  }
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord', RESEND_API_KEY: 're', TIKTOK_APP_KEY: 'ak', TIKTOK_APP_SECRET: 'geheim', TIKTOK_SERVICE_ID: 'svc' });
const cat = await import(R + '_catalogus.js');
const admin = (await import(R + 'admin.js')).default, catalogus = (await import(R + 'catalogus.js')).default, kanalen = (await import(R + 'kanalen.js')).default;
const tiktok = await import(R + '_kanalen/tiktok.js');
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];
const K = (actie, body, params = '') => call(kanalen, { method: body ? 'POST' : 'GET', url: `/api/kanalen?actie=${actie}${params}`, body, cookie });
zaaiCatalogus(cat.TEKSTEN);
for (const id of ['golf', 'zon']) T.producten.find((p) => p.id === id).status = 'actief';
T.producten.find((p) => p.id === 'zon').beschrijving = '';
let did = 9000;
const gb = T.varianten.find((v) => v.sku === 'SKF-GOLF-50X70');
T.varianten.push({ ...gb, sku: 'SKF-GOLF-50X70-LIJST-NATUREL', lijst: 'classic', lijst_kleur: 'natural', prijs: 119, prodigi_sku: 'GLOBAL-CFP-20X28' });
for (const v of T.varianten.filter((x) => ['golf', 'zon'].includes(x.product_id))) { T.drukbestand_versies.push({ id: ++did, variant_sku: v.sku, versie: 1, pad: `p/${v.sku}.png`, status: 'ok', controles: [] }); Object.assign(v, { handmatig_leverbaar: true, handmatig_reden: 'eigen drukker', drukbestand_id: did }); }
T.varianten.find((v) => v.sku === 'SKF-GOLF-50X70-LIJST-NATUREL').drukbestand_id = null;
await cat.laadCatalogus({ vers: true });

// ---- Meta-feed ----
let r = await call(catalogus, { method: 'GET', url: '/api/catalogus?actie=feed&kanaal=meta', headers: { 'user-agent': 'facebookexternalhit/1.1' } });
const x = r.s;
ok(r.c === 200 && r.h['content-type'].startsWith('application/xml') && x.includes('xmlns:g="http://base.google.com/ns/1.0"'), 'meta: RSS-XML met g:-namespace');
ok(x.includes('<g:id>SKF-GOLF-50X70</g:id>') && x.includes('<g:availability>in stock</g:availability>') && x.includes('<g:condition>new</g:condition>') && x.includes('<g:brand>SKIFFA</g:brand>'), 'meta: verplichte velden');
ok(/<g:price>\d+\.\d{2} EUR<\/g:price>/.test(x) && x.includes('<g:item_group_id>') && x.includes('<g:size>'), 'meta: prijs "12.95 EUR", varianten gegroepeerd met maat');
ok(/<item><g:id>SKF-GOLF-50X70-LIJST-NATUREL<\/g:id>[^]*?<g:title>[^<]*in naturel lijst<\/g:title>[^]*?<g:description>[^<]*Classic-lijst[^<]*Enhanced Matte Art[^<]*<\/g:description>[^]*?<g:color>naturel<\/g:color>/.test(x), 'meta: lijst als variant met kleur en eerlijk papier in de beschrijving');
ok(!x.includes('SKF-ZON-') && !x.includes('SKF-BOULEVARD-'), 'meta: zonder beschrijving of niet actief = niet in de feed');
ok(/<g:image_link>[^<]+\.jpg<\/g:image_link>/.test(x) && !/<g:image_link>[^<]+\.webp/.test(x), 'meta: hoofdbeeld als jpg, nooit webp');
r = await call(catalogus, { method: 'GET', url: '/api/catalogus?actie=feed&kanaal=etsy' });
ok(r.c === 404, 'meta: onbekende feed = 404');
r = await K('meta-overzicht');
const zon = r.j.items.find((i) => i.id.startsWith('SKF-ZON-'));
ok(r.j.laatst_door_meta && !r.j.waarschuwingen.length && zon.ontbreekt.some((o) => /beschrijving/.test(o)), 'meta: ophalen door Meta geregistreerd; ontbrekende beschrijving gemeld');
ok(r.j.feed_url === 'https://skiffa.store/api/catalogus?actie=feed&kanaal=meta' && r.j.token === false, 'meta: feed-URL en eerlijk dat er geen token is');
T.kanaal_instellingen.find((k) => k.kanaal === 'meta').waarden.laatst_door_meta = new Date(Date.now() - 72 * 3600000).toISOString();
r = await K('meta-overzicht');
ok(r.j.waarschuwingen.some((w) => /72 uur/.test(w)), 'meta: waarschuwing als Meta te lang niet ophaalde');
r = await K('meta-review', {});
ok(r.c === 400 && /META_TOKEN/.test(r.j.melding), 'meta: goedkeuring zonder token = eerlijke melding');
process.env.META_TOKEN = 'mt'; process.env.META_CATALOG_ID = 'cat1';
r = await K('meta-review', {});
r = await K('meta-overzicht');
const g50 = r.j.items.find((i) => i.id === 'SKF-GOLF-50X70');
ok(g50.review === 'afgekeurd' && g50.meldingen[0] === 'Afbeelding bevat tekst' && r.j.tellingen.goedgekeurd === 1, 'meta: goedkeuring per item uit de catalogus');
await K('meta-opnemen', { skus: ['SKF-GOLF-50X70'], opnemen: false });
r = await call(catalogus, { method: 'GET', url: '/api/catalogus?actie=feed&kanaal=meta' });
ok(!r.s.includes('<g:id>SKF-GOLF-50X70<') && r.s.includes('SKF-GOLF-30X40'), 'meta: variant uit de feed halen');
r = await K('meta-bereikbaar', {});
ok(r.c === 200, 'meta: bereikbaarheidscontrole');

// ---- TikTok: handtekening ----
const sig = tiktok.teken('/authorization/202309/shops', { app_key: '29a39d', timestamp: '1623812664', access_token: 'x', sign: 'y' }, '', 'e59af819cc');
ok(sig.startsWith('b596b73e') && sig.endsWith('582dc8'), 'tiktok: handtekening klopt met het voorbeeld uit de documentatie');
ok(tiktok.teken('/a', { b: '2', a: '1' }, '{"x":1}', 's') === tiktok.teken('/a', { a: '1', b: '2' }, '{"x":1}', 's') && tiktok.teken('/a', { a: '1' }, '{"x":1}', 's') !== tiktok.teken('/a', { a: '1' }, '{"x":2}', 's'), 'tiktok: parameters gesorteerd, body telt mee');

// ---- TikTok: orders ----
const order = (id, status, extra = {}) => ({ id, status, delivery_option_id: 'do1', recipient_address: { name: 'Lotte', address_line1: 'Kade 2', postal_code: '1011 AB', region_code: 'NL', district_info: [{ address_level_name: 'City', address_name: 'Amsterdam' }] },
  payment: { currency: 'EUR', shipping_fee: '0', total_amount: '98.00' }, packages: [{ id: 'pk1' }],
  line_items: [{ id: 'li1', seller_sku: 'SKF-GOLF-30X40', product_name: 'Golf', sale_price: '49.00', package_id: 'pk1' }, { id: 'li2', seller_sku: 'SKF-GOLF-30X40', product_name: 'Golf', sale_price: '49.00', package_id: 'pk1' }], ...extra });
ok(tiktok.mapOrder(order('1', 'UNPAID')) === null && tiktok.mapOrder(order('1', 'ON_HOLD')) === null, 'tiktok: onbetaald of in de annuleringstermijn = niet importeren');
const m = tiktok.mapOrder(order('1', 'AWAITING_SHIPMENT'));
ok(m.regels.length === 1 && m.regels[0].aantal === 2 && m.regels[0].extern_item_id === 'li1,li2' && m.plaats === 'Amsterdam' && m.meta.pakketten[0].regels.length === 2, 'tiktok: één regel per stuk samengevoegd, adres en pakket');
r = await K('sync', { kanaal: 'tiktok' });
ok(r.j.ok === false && /nog niet gekoppeld/.test(r.j.log[0].info), 'tiktok: zonder koppeling geen schijnsucces');
T.tiktok_koppeling = [{ id: 1, shop_id: 's1', shop_naam: 'SKIFFA NL', shop_cipher: 'ciph', access_token: 'at', refresh_token: 'rt', access_verloopt_op: new Date(Date.now() + 5 * 86400000).toISOString() }];
T.kanaal_instellingen.push({ kanaal: 'tiktok', waarden: { aan: true, proef: false, categorie_id: '600154', magazijn_id: '7300000000000000001', gewicht_kg: 0.6, voorraad: 20 } });
TT.orders = [order('5001', 'AWAITING_SHIPMENT'), order('5002', 'UNPAID'), order('5003', 'ON_HOLD')];
r = await K('sync', { kanaal: 'tiktok', stap: 'orders' });
const tb = T.bestellingen.filter((b) => b.kanaal === 'tiktok');
ok(r.j.ok !== false && tb.length === 1 && tb[0].extern_id === '5001' && tb[0].status === 'betaald' && TT.ondertekend.every(Boolean), 'tiktok: alleen de verzendklare order geïmporteerd, verzoeken ondertekend');
await K('sync', { kanaal: 'tiktok', stap: 'orders' });
ok(T.bestellingen.filter((b) => b.kanaal === 'tiktok').length === 1, 'tiktok: opnieuw synchroniseren = geen dubbele order');

// ---- TikTok: annuleringen ----
TT.annuleringen = [{ cancel_id: 'c77', order_id: '5001', cancel_status: 'CANCELLATION_REQUEST_PENDING', cancel_reason_text: 'Verkeerd formaat' }];
await K('sync', { kanaal: 'tiktok', stap: 'annuleringen' });
await K('sync', { kanaal: 'tiktok', stap: 'annuleringen' });
const sv = T.serviceverzoeken.filter((s) => s.bestelling_id === tb[0].id);
ok(sv.length === 1 && sv[0].soort === 'annulering' && sv[0].door === 'tiktok' && tb[0].status === 'betaald', 'tiktok: annuleringsverzoek één keer op de actielijst, niet automatisch geannuleerd');
r = await K('tiktok-annulering', { cancel_id: 'c77', besluit: 'reject' });
ok(r.c === 400, 'tiktok: weigeren vraagt een reden');
r = await K('tiktok-annulering', { cancel_id: 'c77', besluit: 'approve' });
ok(r.c === 200 && TT.beslist[0][0].endsWith('/c77/approve') && TT.beslist[0][1] === 'skiffa-c77-approve', 'tiktok: goedkeuren met idempotency-sleutel');

// ---- TikTok: tracking per pakket ----
const b2 = T.bestellingen.find((b) => b.extern_id === '5001');
r = await call(admin, { method: 'POST', url: '/api/admin?actie=status', body: { id: b2.id, status: 'verzonden', track_trace: '3SXYZ', vervoerder: 'postnl' }, cookie });
await K('sync', { kanaal: 'tiktok', stap: 'verzendingen' });
ok(TT.verzonden.length === 1 && TT.verzonden[0].pakket === 'pk1' && TT.verzonden[0].tracking_number === '3SXYZ' && TT.verzonden[0].shipping_provider_id === 'p-postnl', 'tiktok: tracking op het pakket met de juiste vervoerder');
await K('sync', { kanaal: 'tiktok', stap: 'verzendingen' });
ok(TT.verzonden.length === 1, 'tiktok: tracking niet dubbel doorgegeven');
TT.orders = [order('5004', 'AWAITING_SHIPMENT')];
await K('sync', { kanaal: 'tiktok', stap: 'orders' });
const b3 = T.bestellingen.find((b) => b.extern_id === '5004');
await call(admin, { method: 'POST', url: '/api/admin?actie=status', body: { id: b3.id, status: 'verzonden', track_trace: 'GLS123', vervoerder: 'gls' }, cookie });
await K('sync', { kanaal: 'tiktok', stap: 'verzendingen' });
const z3 = T.zendingen.find((z) => z.bestelling_id === b3.id);
ok(TT.verzonden.length === 1 && /gls staat niet in de TikTok-lijst/i.test(z3.kanaal_fout), 'tiktok: vervoerder die TikTok niet kent = duidelijke fout, niets verstuurd');

// ---- TikTok: concept ----
r = await K('tiktok-producten');
ok(r.j.producten.find((p) => p.id === 'zon').ontbreekt.includes('beschrijving ontbreekt') && r.j.producten.find((p) => p.id === 'golf').ontbreekt.length === 0, 'tiktok: wat ontbreekt per poster');
T.kanaal_instellingen.find((k) => k.kanaal === 'tiktok').waarden.proef = true;
r = await K('tiktok-concept', { product_id: 'golf' });
ok(r.c === 200 && TT.producten === 0 && /Proefmodus/.test(r.j.melding), 'tiktok: proefmodus maakt niets aan');
T.kanaal_instellingen.find((k) => k.kanaal === 'tiktok').waarden.proef = false;
r = await K('tiktok-concept', { product_id: 'golf' });
const pk = T.product_kanalen.find((x) => x.product_id === 'golf' && x.kanaal === 'tiktok');
ok(r.c === 200 && TT.producten === 1 && TT.laatsteProduct.save_mode === 'AS_DRAFT' && TT.laatsteProduct.skus.every((s) => s.price.currency === 'EUR' && s.inventory[0].warehouse_id === '7300000000000000001') && pk.extern_id === '1729', 'tiktok: concept met EUR-prijzen en magazijn (id niet afgerond)');
ok(TT.laatsteProduct.main_images[0].uri.startsWith('tos/') && TT.laatsteProduct.idempotency_key.startsWith('skiffa-golf-'), 'tiktok: beelden geüpload, idempotency-sleutel');
r = await K('tiktok-concept', { product_id: 'golf' });
ok(TT.producten === 1 && T.product_kanalen.find((x) => x.product_id === 'golf' && x.kanaal === 'tiktok').status === 'fout' && /Merk ontbreekt/.test(T.product_kanalen.find((x) => x.product_id === 'golf' && x.kanaal === 'tiktok').melding), 'tiktok: tweede keer = alleen status (afgekeurd met reden), geen tweede product');
r = await call(kanalen, { method: 'GET', url: '/api/kanalen?actie=tiktok-producten' });
ok(r.c === 401, 'tiktok: alleen voor de beheerder');
