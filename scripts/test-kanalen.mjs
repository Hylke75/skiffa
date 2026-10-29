// Test van de koppelingen met bol.com, Etsy en Amazon zonder echte diensten: Supabase, de drie
// marktplaats-API's en Resend worden nagebootst. Draai met:  npm test
import { T, supabase, antwoord, call, ok } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const calls = [], mails = [];
const B = { offers: {}, orders: [{ orderId: 'BOL-1001', orderItems: [{ orderItemId: 'OI-1', quantity: 2, quantityShipped: 0, quantityCancelled: 0 }] }], facturen: [] };
const E = { listings: {}, receipts: [] }, A = { listings: {}, orders: [] };
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url), body = typeof o.body === 'string' && o.body.startsWith('{') ? JSON.parse(o.body) : o.body;
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.resend.com') { const b = JSON.parse(o.body); mails.push({ aan: b.to[0], onderwerp: b.subject }); return antwoord({ id: 'm' }); }
  calls.push(`${o.method} ${u.host}${u.pathname}${u.search}`);
  // ---- bol ----
  if (u.host === 'login.bol.com') return antwoord({ access_token: 'bol-token', expires_in: 299 });
  if (u.host === 'api.bol.com') {
    const p = u.pathname;
    if (p === '/retailer/offers' && o.method === 'POST') { const id = 'offer-' + body.ean; B.offers[id] = body; return antwoord({ offerId: id }, 201); }
    if (p.startsWith('/retailer/offers/') && o.method === 'PATCH') { B.offers[p.split('/').pop()].patch = body; return antwoord(undefined, 204); }
    if (p === '/retailer/orders' && o.method === 'GET') return antwoord({ orders: B.orders });
    if (p === '/retailer/orders/BOL-1001') return antwoord({ orderId: 'BOL-1001', orderPlacedDateTime: '2026-10-29T08:00:00Z',
      shipmentDetails: { firstName: 'Piet', surname: 'Jansen', streetName: 'Dorpsstraat', houseNumber: 12, houseNumberExtension: 'A', zipCode: '1234ab', city: 'Ede', countryCode: 'NL', email: 'xyz@verkopen.bol.com' },
      orderItems: [{ orderItemId: 'OI-1', quantity: 2, unitPrice: 51.95, commission: 7.5, offer: { offerId: 'offer-8712345678906', reference: 'SKF-GOLF-50X70' }, product: { ean: '8712345678906', title: 'Poster Golf' }, fulfilment: { method: 'FBR', latestDeliveryDate: '2026-11-02' } }] });
    if (p === '/retailer/shipments' && o.method === 'POST') { B.zending = body; return antwoord({ processStatusId: 'proc-1' }, 202); }
    if (p === '/retailer/shipments/invoices/requests') return antwoord({ invoiceRequests: B.facturen });
    if (p.startsWith('/retailer/shipments/invoices/') && o.method === 'POST') { B.factuurUpload = o.body; return antwoord({ processStatusId: 'p2' }, 202); }
    if (p === '/retailer/orders/cancellation') return antwoord({}, 202);
  }
  // ---- Etsy ----
  if (u.host === 'api.etsy.com') {
    const p = u.pathname.replace('/v3/application', '');
    if (u.pathname === '/v3/public/oauth/token') return antwoord({ access_token: 'etsy-at', refresh_token: 'etsy-rt', expires_in: 3600 });
    if (p === '/users/me') return antwoord({ user_id: 7, shop_id: 555 });
    if (p === '/shops/555' && o.method === 'GET') return antwoord({ shop_name: 'SkiffaPosters', currency_code: 'EUR' });
    if (p === '/shops/555/listings' && o.method === 'POST') { const id = 9000 + Object.keys(E.listings).length; E.listings[id] = { velden: Object.fromEntries(new URLSearchParams(o.body)) }; return antwoord({ listing_id: id }, 201); }
    let m = p.match(/^\/shops\/555\/listings\/(\d+)\/images$/); if (m) { E.listings[m[1]].foto = true; return antwoord({ listing_image_id: 1 }, 201); }
    m = p.match(/^\/listings\/(\d+)\/inventory$/); if (m) { E.listings[m[1]].inventaris = body; return antwoord({ products: body.products.map((x, i) => ({ product_id: 100 + i, sku: x.sku })) }); }
    m = p.match(/^\/shops\/555\/listings\/(\d+)$/); if (m && o.method === 'PATCH') { E.listings[m[1]].state = new URLSearchParams(o.body).get('state'); return antwoord({}); }
    if (p === '/shops/555/receipts') return antwoord({ results: E.receipts });
    m = p.match(/^\/shops\/555\/receipts\/(\d+)\/tracking$/); if (m) { E.tracking = body; return antwoord({}); }
  }
  // ---- Amazon ----
  if (u.host === 'api.amazon.com') return antwoord({ access_token: 'amz-at', expires_in: 3600 });
  if (u.host === 'sellingpartnerapi-eu.amazon.com') {
    const p = u.pathname;
    if (p === '/catalog/2022-04-01/items') return antwoord({ items: [] });
    if (p.startsWith('/listings/2021-08-01/items/SELLER1/') && o.method === 'PUT') { A.listings[decodeURIComponent(p.split('/').pop())] = { body, mode: u.searchParams.get('mode') }; return antwoord({ status: 'ACCEPTED', issues: [] }); }
    if (p === '/orders/2026-01-01/orders') return antwoord({ orders: A.orders, pagination: {} });
    if (p.endsWith('/shipmentConfirmation')) { A.bevestiging = body; return antwoord(undefined, 204); }
    if (p === '/sellers/v1/marketplaceParticipations') return antwoord({ payload: [{ marketplace: { name: 'Amazon.nl' } }] });
  }
  if (u.host === 'skiffa.store' && u.pathname.startsWith('/posters/')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer };
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, {
  SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord',
  CRON_SECRET: 'cron-geheim-1234567890', BOL_CLIENT_ID: 'b', BOL_CLIENT_SECRET: 'bs', ETSY_KEYSTRING: 'ek', ETSY_SHARED_SECRET: 'es',
  AMAZON_LWA_CLIENT_ID: 'a', AMAZON_LWA_CLIENT_SECRET: 'as', AMAZON_REFRESH_TOKEN: 'ar', AMAZON_SELLER_ID: 'SELLER1',
});
const kanalen = (await import(R + 'kanalen.js')).default, admin = (await import(R + 'admin.js')).default;
const login = await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } });
const cookie = login.h['set-cookie'].split(';')[0];
const K = (actie, body, extra = {}) => call(kanalen, { method: body ? 'POST' : 'GET', url: `/api/kanalen?actie=${actie}${extra.q || ''}`, body, cookie, ...extra });

// ---- toegang ----
let r = await call(kanalen, { url: '/api/kanalen?actie=overzicht' }); ok(r.c === 401, 'kanalen zonder inlog geweigerd');
r = await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=cron', headers: { authorization: 'Bearer fout-geheim-xxxxxxxx' } }); ok(r.c === 401, 'cron met verkeerd geheim geweigerd');
r = await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=cron', headers: { authorization: 'Bearer cron-geheim-1234567890' } }); ok(r.j.ok && r.j.resultaat.bol === 'uit', 'cron met juist geheim: kanalen staan standaard uit');
r = await K('overzicht'); ok(r.j.kanalen.bol.sleutels && r.j.kanalen.bol.instellingen.proef === true && r.j.cron, 'overzicht: sleutels aanwezig, standaard proefmodus');

// ---- bol ----
r = await K('ean', { poster_id: 'golf', formaat: '50x70', ean: '8712345678907' }); ok(r.c === 400 && /controlecijfer/.test(r.j.melding), 'EAN met fout controlecijfer geweigerd');
r = await K('ean', { poster_id: 'golf', formaat: '50x70', ean: '8712345678906' }); ok(r.j.ok, 'geldige EAN opgeslagen');
r = await K('ean', { poster_id: 'zon', formaat: '50x70', ean: '8712345678906' }); ok(r.c === 400 && /andere poster/.test(r.j.melding), 'dubbele EAN geweigerd');
r = await K('listings', null, { q: '&kanaal=bol' }); ok(r.j.listings.length === 48, 'bol-assortiment: 16 posters × 3 formaten');
const golf = r.j.listings.find((l) => l.poster_id === 'golf' && l.formaat === '50x70'), zon = r.j.listings.find((l) => l.poster_id === 'zon' && l.formaat === '30x40');
ok(golf.prijs === 51.95 && golf.ean === '8712345678906', 'kanaalprijs € 45 + 15% → € 51,95');
await K('listing', { id: golf.id, ingeschakeld: true }); await K('listing', { id: zon.id, ingeschakeld: true });
await K('instellingen', { kanaal: 'bol', waarden: { aan: true, proef: true, opslag_pct: '15', onzin: 'x' } });
r = await K('sync', { kanaal: 'bol', stap: 'aanbiedingen' }); ok(r.j.proef && r.j.proef_schrijfacties.some((x) => x.startsWith('POST /retailer/offers')) && !Object.keys(B.offers).length, 'proefmodus: aanbieding alleen verzameld, niets naar bol');
await K('instellingen', { kanaal: 'bol', waarden: { proef: false } });
r = await K('sync', { kanaal: 'bol', stap: 'aanbiedingen' });
const offer = B.offers['offer-8712345678906'];
ok(offer && offer.pricing.bundlePrices[0].unitPrice === 51.95 && offer.reference === 'SKF-GOLF-50X70' && offer.fulfilment.method === 'FBR' && offer.stock.amount === 20, 'aanbieding aangemaakt: prijs, referentie, FBR en voorraad');
const lijst = (await K('listings', null, { q: '&kanaal=bol' })).j.listings;
ok(lijst.find((l) => l.id === golf.id).status === 'actief' && /EAN/.test(lijst.find((l) => l.id === zon.id).laatste_fout), 'listing actief; zonder EAN een duidelijke fout');
await K('instellingen', { kanaal: 'bol', waarden: { opslag_pct: 20 } });
await K('sync', { kanaal: 'bol', stap: 'bijwerken' }); ok(offer.patch?.pricing?.bundlePrices[0].unitPrice === 54.95, 'prijswijziging (20% opslag → € 54,95) doorgegeven');
await K('listing', { id: golf.id, ingeschakeld: false }); await K('sync', { kanaal: 'bol', stap: 'aanbiedingen' }); ok(offer.patch?.onHoldByRetailer === true, 'uitgeschakeld → aanbieding gepauzeerd');
r = await K('sync', { kanaal: 'bol', stap: 'orders' });
const bo = T.bestellingen.find((b) => b.kanaal === 'bol');
ok(bo && bo.extern_id === 'BOL-1001' && bo.status === 'betaald' && bo.factuurnummer === '2026-0001' && bo.totaal === 103.9, 'bol-order geïmporteerd: betaald, factuur 2026-0001, € 103,90');
ok(bo.straat === 'Dorpsstraat 12 A' && bo.postcode === '1234AB' && T.bestelregels.find((x) => x.bestelling_id === bo.id).poster_id === 'golf', 'adres en regel (via offerId → poster golf) goed overgenomen');
ok(mails.length === 1 && mails[0].aan === 'hallo@skiffa.nl', 'winkel krijgt melding, klant niet (bol mailt zelf)');
await K('sync', { kanaal: 'bol', stap: 'orders' }); ok(T.bestellingen.filter((b) => b.kanaal === 'bol').length === 1, 'tweede sync: order niet dubbel');
r = await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: bo.id, status: 'verzonden' } }); ok(r.c === 400 && /track-and-trace/.test(r.j.melding), 'verzenden zonder track-and-trace geweigerd voor bol');
r = await call(admin, { method: 'POST', url: '/api/admin?actie=terugbetalen', cookie, body: { id: bo.id } }); ok(r.c === 400 && /via bol/.test(r.j.melding), 'terugbetalen van bol-order verwijst naar bol');
r = await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: bo.id, status: 'verzonden', track_trace: '3SBOL123', vervoerder: 'dhl' } }); ok(r.j.ok && r.j.kanaal === 'bol' && mails.length === 1, 'verzonden: geen klantmail, gaat naar bol');
await K('sync', { kanaal: 'bol', stap: 'verzendingen' });
ok(B.zending?.transport.trackAndTrace === '3SBOL123' && B.zending.transport.transporterCode === 'DHL' && B.zending.orderItems[0].orderItemId === 'OI-1' && bo.extern_verzonden_op, 'track-and-trace + DHL doorgegeven aan bol');
const n1 = calls.filter((c) => c.includes('/retailer/shipments') && c.startsWith('POST')).length; await K('sync', { kanaal: 'bol', stap: 'verzendingen' });
ok(calls.filter((c) => c.includes('/retailer/shipments') && c.startsWith('POST')).length === n1, 'verzending niet twee keer doorgegeven');
B.facturen = [{ orderId: 'BOL-1001', shipmentId: 777 }]; await K('sync', { kanaal: 'bol', stap: 'facturen' });
ok(B.factuurUpload instanceof FormData && bo.extern_meta.factuur_voor === '777', 'factuurverzoek van bol beantwoord met PDF');
// ---- Etsy ----
r = await K('etsy-koppel'); const auth = new URL(r.j.url);
ok(auth.host === 'www.etsy.com' && auth.searchParams.get('code_challenge_method') === 'S256' && auth.searchParams.get('redirect_uri') === 'https://skiffa.store/etsy/terug', 'Etsy-koppeling start met PKCE en juiste callback');
r = await call(kanalen, { url: `/api/kanalen?actie=etsy-terug&code=abc&state=${auth.searchParams.get('state')}`, cookie }); ok(r.c === 302 && /gekoppeld/.test(decodeURIComponent(r.h.location)) && T.etsy_koppeling[0]?.shop_id === 555, 'Etsy-callback: winkel gekoppeld, tokens server-side');
r = await call(kanalen, { url: `/api/kanalen?actie=etsy-terug&code=abc&state=${auth.searchParams.get('state')}`, cookie }); ok(/mislukt/.test(decodeURIComponent(r.h.location)), 'zelfde koppelpoging kan niet twee keer');
await K('instellingen', { kanaal: 'etsy', waarden: { aan: true, proef: false } });
const el = (await K('listings', null, { q: '&kanaal=etsy' })).j.listings; ok(el.length === 16 && el[0].formaat === 'alle', 'Etsy: één listing per poster');
const eg = el.find((l) => l.poster_id === 'golf'); await K('listing', { id: eg.id, ingeschakeld: true });
await K('sync', { kanaal: 'etsy', stap: 'listings' }); ok(/verzendprofiel/.test(T.kanaal_listings.find((l) => l.id === eg.id).laatste_fout), 'Etsy-listing wacht op verzendprofiel');
await K('instellingen', { kanaal: 'etsy', waarden: { verzendprofiel_id: '111', verwerkingsprofiel_id: '222', taxonomy_id: '1027' } });
await K('sync', { kanaal: 'etsy', stap: 'listings' });
const L = Object.values(E.listings)[0];
ok(L && L.foto && L.state === 'active' && L.velden.when_made === 'made_to_order' && L.velden.taxonomy_id === '1027', 'Etsy-listing: concept → foto → voorraad → actief');
ok(JSON.stringify(L.inventaris.products.map((p) => p.offerings[0].price)) === '[33.95,51.95,79.95]' && L.inventaris.products[1].sku === 'SKF-GOLF-50X70', 'Etsy-variaties: drie formaten met eigen prijs en SKU');
E.receipts = [{ receipt_id: 4242, status: 'paid', is_paid: true, name: 'Anna Smith', buyer_email: 'anna@example.com', first_line: '1 High St', city: 'London', zip: 'sw1a 1aa', country_iso: 'GB', message_from_buyer: 'Mooi!', grandtotal: { amount: 5795, divisor: 100, currency_code: 'EUR' }, total_shipping_cost: { amount: 600, divisor: 100, currency_code: 'EUR' }, transactions: [{ transaction_id: 1, sku: 'SKF-GOLF-50X70', title: 'Scheveningen poster Golf', quantity: 1, price: { amount: 5195, divisor: 100, currency_code: 'EUR' } }], updated_timestamp: 1793260000 }];
await K('sync', { kanaal: 'etsy', stap: 'orders' });
const eo = T.bestellingen.find((b) => b.kanaal === 'etsy');
ok(eo && eo.land === 'GB' && eo.totaal === 57.95 && eo.verzending === 6 && eo.factuurnummer === '2026-0002' && T.bestelregels.find((x) => x.bestelling_id === eo.id).formaat === '50x70', 'Etsy-order geïmporteerd (VK, € 51,95 + € 6 verzending), regel via SKU');
ok(T.bestelling_log.some((l) => l.bestelling_id === eo.id && /Mooi!/.test(l.tekst)), 'bericht van de koper in het logboek');
await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: eo.id, status: 'verzonden', track_trace: 'LX123NL', vervoerder: 'postnl' } });
await K('sync', { kanaal: 'etsy', stap: 'verzendingen' }); ok(E.tracking?.tracking_code === 'LX123NL' && E.tracking.carrier_name === 'postnl-international', 'Etsy: track-and-trace met postnl-international doorgegeven');
// ---- Amazon ----
await K('ean', { poster_id: 'zon', formaat: '70x100', ean: '4006381333931' });
const al = (await K('listings', null, { q: '&kanaal=amazon' })).j.listings; const az = al.find((l) => l.poster_id === 'zon' && l.formaat === '70x100');
await K('listing', { id: az.id, ingeschakeld: true });
await K('instellingen', { kanaal: 'amazon', waarden: { aan: true, proef: true } });
await K('sync', { kanaal: 'amazon', stap: 'listings' });
ok(A.listings['SKF-ZON-70X100']?.mode === 'VALIDATION_PREVIEW' && T.kanaal_listings.find((l) => l.id === az.id).meta.gevalideerd, 'Amazon-proef: listing alleen gevalideerd (VALIDATION_PREVIEW)');
await K('instellingen', { kanaal: 'amazon', waarden: { proef: false } });
await K('sync', { kanaal: 'amazon', stap: 'listings' });
const ab = A.listings['SKF-ZON-70X100'];
ok(!ab.mode && ab.body.productType === 'POSTER' && ab.body.attributes.purchasable_offer[0].our_price[0].schedule[0].value_with_tax === 79.95 && ab.body.attributes.main_product_image_locator[0].media_location.endsWith('/posters/zon.jpg'), 'Amazon-listing: producttype POSTER, € 79,95, JPEG-foto');
A.orders = [{ orderId: '403-1234567-1234567', createdTime: '2026-10-29T09:00:00Z', salesChannel: { marketplaceId: 'A1805IZSGTT6HS' }, buyer: { buyerEmail: 'x@marketplace.amazon.nl' }, recipient: { deliveryAddress: { name: 'Kees de Boer', addressLine1: 'Laan 5', city: 'Utrecht', postalCode: '3511aa', countryCode: 'NL' } }, fulfillment: { fulfillmentStatus: 'UNSHIPPED', fulfilledBy: 'MERCHANT', shipByWindow: { endTime: '2026-11-01T23:00:00Z' } }, orderItems: [{ orderItemId: 'AI-1', quantityOrdered: 1, product: { sellerSku: 'SKF-ZON-70X100', title: 'Poster Zon', price: { unitPrice: { amount: '79.95', currencyCode: 'EUR' } } } }] }];
await K('sync', { kanaal: 'amazon', stap: 'orders' });
const ao = T.bestellingen.find((b) => b.kanaal === 'amazon'); ok(ao && ao.totaal === 79.95 && ao.factuurnummer === '2026-0003' && ao.postcode === '3511AA', 'Amazon-order geïmporteerd');
await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: ao.id, status: 'verzonden', track_trace: '3SAMZ9', vervoerder: 'postnl' } });
await K('sync', { kanaal: 'amazon', stap: 'verzendingen' }); ok(A.bevestiging?.packageDetail.trackingNumber === '3SAMZ9' && A.bevestiging.packageDetail.carrierCode === 'PostNL' && ao.extern_verzonden_op, 'Amazon: verzending bevestigd met PostNL');
// ---- administratie en cron ----
r = await call(admin, { url: '/api/admin?actie=bestellingen&kanaal=etsy', cookie }); ok(r.j.bestellingen.length === 1 && r.j.bestellingen[0].kanaal === 'etsy', 'administratie: filter op kanaal');
r = await call(admin, { url: '/api/admin?actie=overzicht', cookie }); ok(r.j.omzetPerKanaal.bol === 103.9 && r.j.omzetPerKanaal.amazon === 79.95, 'omzet per kanaal');
r = await call(admin, { url: '/api/admin?actie=export', cookie }); ok(r.s.split('\r\n')[1].includes(';bol;BOL-1001;'), 'CSV-export bevat kanaal en extern ordernummer');
r = await call(kanalen, { method: 'POST', url: '/api/kanalen?actie=cron', headers: { authorization: 'Bearer cron-geheim-1234567890' } }); ok(r.j.resultaat.bol === 'ok' && r.j.resultaat.etsy === 'ok' && r.j.resultaat.amazon === 'ok', 'automatische run: alle drie de kanalen ok');
ok(T.kanaal_sync_log.length > 5 && T.kanaal_sync_log.every((l) => l.detail), 'elke run staat in het logboek');
