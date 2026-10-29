// Test van de Prodigi-koppeling zonder echte diensten: Supabase (+ Storage), Prodigi en Resend nagebootst.
// Kern: elke betaalde bestelling levert precies één productieopdracht op, ook bij dubbele meldingen,
// gelijktijdige runs, storingen, onduidelijke antwoorden en herhaalde pogingen.  npm test
import crypto from 'node:crypto';
import { T, S, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const mails = [];
const P = { orders: {}, posts: [], quotes: [], faal: 0, faalNaAanmaken: 0, faal429: 0, lijstFaalt: 0, faal400: 0, merkLeverbaar: ['postcard', 'packing_slip_bw'], annuleerUitkomst: 'cancelled' };
const PRODUCTEN = {
  'GLOBAL-FAP-50X70': { sku: 'GLOBAL-FAP-50X70', description: 'EMA, Enhanced Matte Art Paper, 200gsm, 50x70cm / 20x28"', productDimensions: { width: 20, height: 28, units: 'in' }, attributes: {}, printAreas: { default: { required: true } }, variants: [{ attributes: {}, shipsTo: ['NL', 'BE', 'DE'], printAreaSizes: { default: { horizontalResolution: 6000, verticalResolution: 8400 } } }] },
  'GLOBAL-PAPER-30X40': { sku: 'GLOBAL-PAPER-30X40', description: 'Print 30x40cm / 12x16"', productDimensions: { width: 12, height: 16, units: 'in' }, attributes: { paperType: ['EMA', 'HPR'] }, printAreas: { default: { required: true } }, variants: [{ attributes: { paperType: 'EMA' }, shipsTo: ['NL', 'BE'], printAreaSizes: { default: { horizontalResolution: 3600, verticalResolution: 4800 } } }, { attributes: { paperType: 'HPR' }, shipsTo: ['GB'], printAreaSizes: { default: { horizontalResolution: 3600, verticalResolution: 4800 } } }] },
  'GLOBAL-FAP-20X28': { sku: 'GLOBAL-FAP-20X28', description: 'Fine art print 20x28 inch', productDimensions: { width: 20, height: 28, units: 'in' }, attributes: {}, printAreas: { default: { required: true } }, variants: [{ attributes: {}, shipsTo: ['NL', 'BE'], printAreaSizes: { default: { horizontalResolution: 6000, verticalResolution: 8400 } } }] },
};
const quote = (b) => {
  const inserts = (b.branding?.inserts || []).filter((x) => P.merkLeverbaar.includes(x));
  const items = b.items.reduce((t, i) => t + 12.5 * i.copies, 0), merk = inserts.length * 0.5;
  return { outcome: 'created', quotes: [{ shipmentMethod: 'Standard', costSummary: { items: { amount: items.toFixed(2), currency: 'EUR' }, shipping: { amount: '6.00', currency: 'EUR' }, branding: { amount: merk.toFixed(2), currency: 'EUR' }, totalTax: { amount: ((items + 6 + merk) * 0.21).toFixed(2), currency: 'EUR' }, totalCost: { amount: ((items + 6 + merk) * 1.21).toFixed(2), currency: 'EUR' } },
    shipments: [{ carrier: { name: 'PostNL', service: 'Pakket' }, fulfillmentLocation: { countryCode: 'NL', labCode: 'nl1' } }], ...(inserts.length ? { branding: { inserts: inserts.map((x) => ({ id: x, cost: { amount: '0.50', currency: 'EUR' } })) } } : {}) }] };
};
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url);
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.resend.com') { const b = JSON.parse(o.body); mails.push({ aan: b.to[0], onderwerp: b.subject, html: b.html }); return antwoord({ id: 'm' }); }
  if (u.host === 'api.sandbox.prodigi.com' || u.host === 'api.prodigi.com') {
    if (o.headers['X-API-Key'] !== (u.host === 'api.prodigi.com' ? 'live-sleutel' : 'sandbox-sleutel')) return antwoord({ statusText: 'Unauthorized' }, 401);
    const p = u.pathname.replace('/v4.0', '');
    let m = p.match(/^\/products\/(.+)$/); if (m) return PRODUCTEN[decodeURIComponent(m[1])] ? antwoord({ outcome: 'Ok', product: PRODUCTEN[decodeURIComponent(m[1])] }) : antwoord({ outcome: 'NotFound' }, 404);
    if (p === '/quotes') { const b = JSON.parse(o.body); P.quotes.push(b); return antwoord(quote(b)); }
    if (p === '/orders' && o.method === 'POST') {
      const b = JSON.parse(o.body); P.posts.push(b);
      if (P.faal > 0) { P.faal--; return antwoord({ statusText: 'Internal error' }, 500); }
      if (P.faal429 > 0) { P.faal429--; return antwoord({ statusText: 'Too many requests' }, 429); }
      if (P.faal400 > 0) { P.faal400--; return antwoord({ outcome: 'ValidationFailed', failures: { items: ['sku invalid'] } }, 400); }
      const bestaand = Object.values(P.orders).find((x) => x.idempotencyKey === b.idempotencyKey);
      if (bestaand) return antwoord({ outcome: 'alreadyExists', order: bestaand.order });
      const id = 'ord_' + crypto.randomBytes(4).toString('hex');
      P.orders[id] = { ...b, order: { id, merchantReference: b.merchantReference, metadata: b.metadata, status: { stage: 'InProgress' }, shipments: [], charges: [] } };
      if (P.faalNaAanmaken > 0) { P.faalNaAanmaken--; return antwoord({ statusText: 'Gateway timeout' }, 504); }
      return antwoord({ outcome: 'created', order: P.orders[id].order });
    }
    if (p === '/orders' && o.method === 'GET') {
      if (P.lijstFaalt > 0) { P.lijstFaalt--; return antwoord({ statusText: 'down' }, 503); }
      const refs = u.searchParams.getAll('merchantReferences');
      return antwoord({ outcome: 'Ok', orders: Object.values(P.orders).filter((x) => !refs.length || refs.includes(x.merchantReference)).map((x) => x.order), hasMore: false });
    }
    m = p.match(/^\/orders\/(ord_\w+)$/); if (m) return P.orders[m[1]] ? antwoord({ outcome: 'Ok', order: P.orders[m[1]].order }) : antwoord({}, 404);
    m = p.match(/^\/orders\/(ord_\w+)\/actions\/cancel$/); if (m) { if (P.annuleerUitkomst === 'cancelled') P.orders[m[1]].order.status.stage = 'Cancelled'; return antwoord({ outcome: P.annuleerUitkomst }); }
  }
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're_x', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord', PRODIGI_SANDBOX_API_KEY: 'sandbox-sleutel', PRODIGI_API_KEY: 'live-sleutel', DRUKKER_EMAIL: 'druk@drukkerij.test' });

const cat = await import(R + '_catalogus.js');
const catalogus = (await import(R + 'catalogus.js')).default, media = (await import(R + 'media.js')).default, admin = (await import(R + 'admin.js')).default, prodigiRoute = (await import(R + 'prodigi.js')).default;
const { betaald } = await import(R + '_verwerk.js');
const prodigi = await import(R + '_prodigi.js');
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];
const C = (a, body) => call(catalogus, { method: 'POST', url: `/api/catalogus?actie=${a}`, body, cookie });
const M = (a, body) => call(media, { method: 'POST', url: `/api/media?actie=${a}`, body, cookie });
const Pr = (a, body) => call(prodigiRoute, { method: body ? 'POST' : 'GET', url: `/api/prodigi?actie=${a}`, body, cookie });
const png = (w, h) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
async function drukUpload(sku, w, h) {
  const u = (await M('druk-upload', { sku, bytes: 64, bestandsnaam: 'x.png' })).j;
  await fetch(u.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png(w, h) });
  return (await M('druk-bevestig', { sku, pad: u.pad, versie: u.versie, bestandsnaam: 'x.png', meting: {} })).j;
}
const F = (b, nr = 0) => T.fulfilments.find((f) => f.bestelling_id === b.id && f.herdruk_nr === nr);
const posts = (b) => P.posts.filter((x) => x.merchantReference === b.nummer);
const orders = (b) => Object.values(P.orders).filter((x) => x.merchantReference === b.nummer);
const maak = (regels, extra = {}) => {
  const b = { id: crypto.randomUUID(), nummer: 'SK-' + crypto.randomBytes(3).toString('hex').toUpperCase(), token: 'a'.repeat(36), status: 'open', kanaal: 'webshop', naam: 'Ann de Vries', email: 'ann@voorbeeld.nl', straat: 'Strandweg 1', postcode: '2586 AA', plaats: 'Den Haag', land: 'NL', opmerking: '', subtotaal: 45, verzending: 6.95, totaal: 51.95, terugbetaald: 0, betaald_op: null, factuurnummer: null, extern_meta: {}, ...extra };
  T.bestellingen.push(b);
  for (const [sku, aantal = 1] of regels) {
    const v = cat.VARIANTEN[sku];
    T.bestelregels.push({ id: Math.random(), bestelling_id: b.id, poster_id: v.product_id, poster_naam: cat.ALLE_POSTERS[v.product_id], formaat: v.formaat, formaat_label: cat.ALLE_FORMATEN[v.formaat].label, prijs: v.prijs, aantal,
      variant_sku: sku, papier_id: v.papier, papier_label: 'Mat', drukbestand_versie_id: v.drukbestand_id, prodigi_sku: v.prodigi_sku, prodigi_attributen: v.prodigi_attributen, sizing: v.sizing, kostprijs: v.kostprijs });
  }
  return b;
};
const verloop = (f) => { f.vanaf = new Date(Date.now() - 1000).toISOString(); };

zaaiCatalogus(cat.TEKSTEN);
await cat.laadCatalogus({ vers: true });

// ================= productcontrole =================
let r = (await Pr('product-controle', { sku: 'SKF-GOLF-50X70' })).j; ok(!r.ok && /artikelcode/.test(r.melding), 'zonder artikelcode: eerst invullen');
await C('variant', { sku: 'SKF-GOLF-50X70', prodigi_sku: 'GLOBAL-FAP-50X70' });
const d = await drukUpload('SKF-GOLF-50X70', 6000, 8400);
r = (await Pr('product-controle', { sku: 'SKF-GOLF-50X70' })).j;
let v = T.varianten.find((x) => x.sku === 'SKF-GOLF-50X70');
ok(r.ok && r.status === 'bevestigd' && v.prodigi_status === 'bevestigd' && v.prodigi_product.px.b === 6000 && v.prodigi_product.mm[0] === 508 && v.prodigi_product.landen.includes('NL'), 'Prodigi-product bevestigd: productiemaat, pixeleis en landen opgeslagen');
ok(T.drukbestand_versies.find((x) => x.id === d.versie_id).status === 'ok' && T.drukbestand_versies.find((x) => x.id === d.versie_id).controles.find((c) => c.code === 'prodigi').ernst === 'ok', 'drukbestand daarna getoetst aan de eisen van het product (nu goedgekeurd)');
await C('variant', { sku: 'SKF-GOLF-30X40', prodigi_sku: 'GLOBAL-PAPER-30X40' });
r = (await Pr('product-controle', { sku: 'SKF-GOLF-30X40' })).j; ok(r.status === 'ongeldig' && /paperType/.test(r.melding), 'product met opties: zonder keuze niet bevestigd');
await C('variant', { sku: 'SKF-GOLF-30X40', prodigi_attributen: { paperType: 'XYZ' } });
r = (await Pr('product-controle', { sku: 'SKF-GOLF-30X40' })).j; ok(r.status === 'ongeldig' && /geen geldige waarde/.test(r.melding), 'ongeldige optiewaarde: niet bevestigd');
await C('variant', { sku: 'SKF-GOLF-30X40', prodigi_attributen: { paperType: 'HPR' } });
r = (await Pr('product-controle', { sku: 'SKF-GOLF-30X40' })).j; ok(r.status === 'ongeldig' && /NL/.test(r.melding), 'uitvoering die niet naar NL levert: niet bevestigd');
await C('variant', { sku: 'SKF-GOLF-30X40', prodigi_attributen: { paperType: 'EMA' } });
r = (await Pr('product-controle', { sku: 'SKF-GOLF-30X40' })).j; ok(r.status === 'bevestigd' && T.varianten.find((x) => x.sku === 'SKF-GOLF-30X40').prodigi_attributen.paperType === 'EMA', 'met juiste optie bevestigd');
await C('variant', { sku: 'SKF-GOLF-70X100', prodigi_sku: 'GLOBAL-FAP-20X28' });
r = (await Pr('product-controle', { sku: 'SKF-GOLF-70X100' })).j; ok(r.status === 'ongeldig' && /productiemaat is 508 × 711.2 mm/.test(r.melding), 'productiemaat wijkt af van het formaat: niet bevestigd');
await C('variant', { sku: 'SKF-ZON-50X70', prodigi_sku: 'BESTAAT-NIET' });
r = (await Pr('product-controle', { sku: 'SKF-ZON-50X70' })).j; ok(r.status === 'ongeldig' && /kent artikelcode/.test(r.melding), 'onbekende artikelcode: niet bevestigd');

// ================= kosten =================
r = (await Pr('instellingen', { waarden: { branding: [{ type: 'sticker_exterior_round', url: 'https://skiffa.store/merk/sticker.png', verplicht: true }, { type: 'postcard', url: 'https://skiffa.store/merk/kaart.png' }] } })).j;
ok(r.ok && r.instellingen.branding.length === 2, 'merktoevoegingen ingesteld (sticker verplicht, kaartje)');
r = (await Pr('offerte', { sku: 'SKF-GOLF-50X70' })).j; v = T.varianten.find((x) => x.sku === 'SKF-GOLF-50X70');
ok(r.ok && v.kosten.artikel === 12.5 && v.kosten.verzending === 6 && v.kosten.merk === 0.5 && v.kostprijs === 19 && v.kosten.merk_geleverd.join() === 'postcard' && v.kosten.vervoerder === 'PostNL Pakket', 'offerte: kosten per onderdeel, kostprijs excl. btw, en welke merktoevoeging leverbaar is');
r = (await Pr('offerte', { sku: 'SKF-GOLF-70X100' })).j; ok(!r.ok && /Controleer eerst/.test(r.melding), 'geen offerte voor een niet-bevestigd product');
r = (await Pr('instellingen', { waarden: { branding_beleid: 'alternatief', branding_alternatief: 'flyer' } })).j; ok(!r.ok && /alternatief/.test(r.melding), 'alternatief moet een ingestelde toevoeging zijn');

// ================= proefbestelling =================
r = (await Pr('proef-offerte', { regels: [{ sku: 'SKF-GOLF-50X70' }], adres: { naam: 'Skiffa', straat: '' } })).j; ok(!r.ok && /Afleveradres onvolledig/.test(r.melding), 'proefbestelling: adres moet compleet zijn');
r = (await Pr('proef-offerte', { regels: [{ sku: 'SKF-GOLF-70X100' }], adres: { naam: 'Skiffa', straat: 'Keizerstraat 100', postcode: '2586 AZ', plaats: 'Den Haag', land: 'NL' } })).j; ok(!r.ok && /niet bevestigd/.test(r.melding), 'proefbestelling alleen voor bevestigde varianten');
const vp = P.posts.length;
const po = (await Pr('proef-offerte', { regels: [{ sku: 'SKF-GOLF-50X70', aantal: 2 }], adres: { naam: 'Skiffa', straat: 'Keizerstraat 100', postcode: '2586 az', plaats: 'Den Haag', land: 'NL' }, verzendmethode: 'Express' })).j;
ok(po.ok && po.offerte.artikel === 25 && po.adres.postcode === '2586 AZ' && po.omgeving === 'sandbox' && P.posts.length === vp, 'eerst kosten en adres; er is nog niets besteld');
r = (await Pr('proef-plaatsen', { id: po.id })).j; ok(!r.ok && /Bevestig/.test(r.melding) && P.posts.length === vp, 'plaatsen zonder expliciete bevestiging: niets besteld');
const [p1, p2] = await Promise.all([Pr('proef-plaatsen', { id: po.id, bevestigd: true }), Pr('proef-plaatsen', { id: po.id, bevestigd: true })]);
ok([p1.j, p2.j].filter((x) => x.ok).length === 1 && P.posts.length === vp + 1 && P.posts.at(-1).shippingMethod === 'Express' && P.posts.at(-1).items[0].copies === 2 && P.posts.at(-1).idempotencyKey.startsWith('skiffa-proef-'), 'na bevestiging precies één proefbestelling (ook bij een dubbele klik)');
const proefRij = T.proefbestellingen.find((x) => x.id === po.id); proefRij.status = 'offerte'; proefRij.aangemaakt_op = new Date(Date.now() - 31 * 60000).toISOString();
r = (await Pr('proef-plaatsen', { id: po.id, bevestigd: true })).j; ok(!r.ok && /verlopen/.test(r.melding), 'verlopen offerte kan niet meer worden geplaatst');

// ================= productieroute: Prodigi aan =================
await Pr('instellingen', { waarden: { aan: true, sandbox: true, wachttijd_min: 0, branding: [], branding_beleid: 'blokkeren' } });
await C('variant', { sku: 'SKF-GOLF-30X40', handmatig_leverbaar: true, handmatig_reden: 'eigen drukker' });
await drukUpload('SKF-GOLF-30X40', 3600, 4800);
await cat.laadCatalogus({ vers: true });
ok(cat.VARIANTEN['SKF-GOLF-50X70'].bestelbaar && cat.VARIANTEN['SKF-GOLF-30X40'].bestelbaar && !cat.VARIANTEN['SKF-GOLF-70X100'].bestelbaar, 'met Prodigi aan: alleen varianten met bevestigd Prodigi-product zijn bestelbaar');

mails.length = 0;
const b1 = maak([['SKF-GOLF-50X70', 2]]); await betaald(b1, 'ideal');
const pp = posts(b1)[0];
ok(F(b1)?.status === 'verstuurd' && posts(b1).length === 1 && pp.idempotencyKey === `skiffa-sandbox-${b1.id}` && pp.items[0].sku === 'GLOBAL-FAP-50X70' && pp.items[0].copies === 2 && pp.items[0].sizing === 'fitPrintArea' && pp.items[0].assets[0].url.includes(`/object/sign/drukbestanden/golf/SKF-GOLF-50X70/v1-`) && pp.metadata.skiffa_fulfilment === F(b1).id, 'betaald → één opdracht met vaste sleutel, artikel, aantal, plaatsing en de bestelde drukbestandversie');
ok(T.bestellingen.find((x) => x.id === b1.id).status === 'in_productie' && !mails.some((m) => m.aan === 'druk@drukkerij.test'), 'in productie; geen tweede route (geen drukopdracht per mail)');
await betaald(b1, 'ideal'); await prodigi.aanmelden({ id: b1.id });
await Promise.all([prodigi.verwerk(), prodigi.verwerk(), Pr('verwerk', {})]);
ok(posts(b1).length === 1 && T.fulfilments.filter((f) => f.bestelling_id === b1.id).length === 1, 'dubbele webhook, dubbele aanmelding en gelijktijdige runs: één opdracht');

// vaste kopie: nieuwe drukbestandversie na de bestelling verandert de bestelling niet
await Pr('instellingen', { waarden: { wachttijd_min: 30 } });
const b2 = maak([['SKF-GOLF-50X70']]); await betaald(b2, 'ideal');
ok(F(b2).status === 'wacht' && !posts(b2).length && new Date(F(b2).vanaf) > new Date(Date.now() + 29 * 60000), 'wachttijd: nog niet verstuurd; tot wanneer wijzigen kan staat vast');
const dNieuw = await drukUpload('SKF-GOLF-50X70', 6000, 8400);
verloop(F(b2)); await Promise.all(Array.from({ length: 5 }, () => prodigi.verwerk()));
ok(posts(b2).length === 1 && posts(b2)[0].items[0].assets[0].url.includes('/v1-') && !posts(b2)[0].items[0].assets[0].url.includes('/v2-') && dNieuw.versie === 2, 'na de wachttijd één opdracht, met de drukbestandversie van het moment van bestellen');

// ================= onduidelijke antwoorden =================
await Pr('instellingen', { waarden: { wachttijd_min: 0 } });
P.faalNaAanmaken = 1; const b3 = maak([['SKF-GOLF-50X70']]); await betaald(b3, 'ideal');
ok(F(b3).status === 'onzeker' && orders(b3).length === 1, 'time-out terwijl Prodigi de opdracht wél aanmaakte: status onzeker');
verloop(F(b3)); await prodigi.verwerk();
ok(F(b3).status === 'verstuurd' && posts(b3).length === 1 && orders(b3).length === 1 && F(b3).extern_id === orders(b3)[0].order.id, 'eerst gecontroleerd bij Prodigi: bestaande opdracht vastgelegd, niet opnieuw besteld');
P.faal = 1; const b4 = maak([['SKF-GOLF-50X70']]); await betaald(b4, 'ideal');
ok(F(b4).status === 'onzeker' && !orders(b4).length, 'storing (500) zonder opdracht: onzeker');
verloop(F(b4)); await prodigi.verwerk();
ok(['opnieuw', 'verstuurd'].includes(F(b4).status) && orders(b4).length <= 1 && !/onzeker/.test(F(b4).status), 'na controle niet gevonden: veilig opnieuw aanbieden (geen dubbele opdracht)');
await prodigi.verwerk();
ok(F(b4).status === 'verstuurd' && posts(b4).length === 2 && new Set(posts(b4).map((x) => x.idempotencyKey)).size === 1 && orders(b4).length === 1, 'tweede poging met dezelfde sleutel: één opdracht');
P.faal = 1; P.lijstFaalt = 2; const b5 = maak([['SKF-GOLF-50X70']]); await betaald(b5, 'ideal');
verloop(F(b5)); await prodigi.verwerk(); verloop(F(b5)); await prodigi.verwerk();
ok(F(b5).status === 'onzeker' && /\[controle 2\]/.test(F(b5).laatste_fout) && posts(b5).length === 1, 'controle zelf mislukt: blijft onzeker, er wordt niet blind opnieuw besteld');
verloop(F(b5)); await prodigi.verwerk(); await prodigi.verwerk();
ok(F(b5).status === 'verstuurd' && orders(b5).length === 1, 'zodra de controle lukt: verder');
P.faal429 = 1; const b6 = maak([['SKF-GOLF-50X70']]); await betaald(b6, 'ideal');
ok(F(b6).status === 'opnieuw' && !orders(b6).length, '429: zeker niet aangemaakt, later opnieuw');
P.faal400 = 1; const b7 = maak([['SKF-GOLF-50X70']]); await betaald(b7, 'ideal');
ok(F(b7).status === 'fout' && /sku invalid/.test(F(b7).laatste_fout), 'Prodigi weigert (400): fout met uitleg');
r = (await Pr('opnieuw', { id: b7.id })).j; ok(r.ok && F(b7).status === 'verstuurd' && orders(b7).length === 1, 'na oplossen: veilig opnieuw proberen');
const b8 = maak([['SKF-GOLF-50X70']]); await betaald(b8, 'ideal');
const f8 = F(b8); f8.status = 'bezig'; f8.geclaimd_op = new Date(Date.now() - 11 * 60000).toISOString();
await prodigi.verwerk(); ok(F(b8).status === 'verstuurd' && posts(b8).length === 1, 'vastgelopen claim: na 10 min gecontroleerd, opdracht bestond al');

// ================= controles vooraf =================
const b9 = maak([['SKF-GOLF-50X70']], { straat: '' }); await betaald(b9, 'ideal');
ok(F(b9).status === 'geblokkeerd' && /Afleveradres onvolledig: straat/.test(F(b9).laatste_fout) && !posts(b9).length, 'afleveradres onvolledig: geblokkeerd, niets verstuurd');
const b10 = maak([['SKF-GOLF-50X70']]); T.bestelregels.find((x) => x.bestelling_id === b10.id).prodigi_sku = null; T.bestelregels.find((x) => x.bestelling_id === b10.id).drukbestand_versie_id = null;
const vv = T.varianten.find((x) => x.sku === 'SKF-GOLF-50X70'); const oudDruk = vv.drukbestand_id; vv.drukbestand_id = null; await cat.laadCatalogus({ vers: true });
await betaald(b10, 'ideal');
ok(F(b10).status === 'geblokkeerd' && /Drukbestand ontbreekt voor Golf 50 × 70 cm/.test(F(b10).laatste_fout), 'drukbestand ontbreekt: geblokkeerd met begrijpelijke melding');
vv.drukbestand_id = oudDruk; await cat.laadCatalogus({ vers: true });
// afgekeurd drukbestand met bevestigde uitzondering: mag naar productie; zonder uitzondering niet
await C('variant', { sku: 'SKF-SURF-50X70', prodigi_sku: 'GLOBAL-FAP-50X70' }); await Pr('product-controle', { sku: 'SKF-SURF-50X70' });
await drukUpload('SKF-SURF-50X70', 3000, 4200); await cat.laadCatalogus({ vers: true });
const b10a = maak([['SKF-SURF-50X70']]); await betaald(b10a, 'ideal');
ok(F(b10a).status === 'geblokkeerd' && /Drukbestand afgekeurd/.test(F(b10a).laatste_fout), 'afgekeurd drukbestand zonder uitzondering: geblokkeerd');
await C('uitzondering', { sku: 'SKF-SURF-50X70', reden: 'Bewust zachter beeld; proef op ware grootte goedgekeurd.' }); await cat.laadCatalogus({ vers: true });
await Pr('opnieuw', { id: b10a.id });
ok(F(b10a).status === 'verstuurd' && posts(b10a).length === 1, 'met bevestigde uitzondering: verstuurd');

// ================= terugbetaling ≠ annulering =================
await Pr('instellingen', { waarden: { wachttijd_min: 30 } });
const b11 = maak([['SKF-GOLF-50X70']]); await betaald(b11, 'ideal');
T.bestellingen.find((x) => x.id === b11.id).terugbetaald = 10; verloop(F(b11)); await prodigi.verwerk();
ok(F(b11).status === 'geblokkeerd' && /terugbetaald/.test(F(b11).laatste_fout) && !posts(b11).length, 'terugbetaling: productie wacht op beslissing (niet automatisch geannuleerd)');
r = (await Pr('vrijgeven', { id: b11.id, reden: 'x' })).j; ok(!r.ok, 'toch produceren vraagt een reden');
r = (await Pr('vrijgeven', { id: b11.id, reden: 'gedeeltelijke korting, poster gaat wel' })).j; ok(r.ok && F(b11).status === 'verstuurd' && posts(b11).length === 1, 'toch produceren met reden: verstuurd');
const b12 = maak([['SKF-GOLF-50X70']]); await betaald(b12, 'ideal');
await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: b12.id, status: 'geannuleerd' } });
verloop(F(b12)); await prodigi.verwerk();
ok(F(b12).status === 'geannuleerd' && !posts(b12).length, 'geannuleerd in de wachttijd: niets naar Prodigi');
P.annuleerUitkomst = 'failedToCancel'; r = (await Pr('annuleer', { id: b1.id })).j; ok(!r.ok && /failedtocancel/i.test(r.melding), 'Prodigi kan niet meer annuleren: eerlijk gemeld');
P.annuleerUitkomst = 'cancelled'; r = (await Pr('annuleer', { id: b11.id })).j; ok(r.ok && F(b11).status === 'geannuleerd', 'productie annuleren bij Prodigi');

// ================= merktoevoegingen =================
await Pr('instellingen', { waarden: { wachttijd_min: 0, branding: [{ type: 'sticker_exterior_round', url: 'https://skiffa.store/merk/sticker.png', verplicht: true }, { type: 'postcard', url: 'https://skiffa.store/merk/kaart.png' }], branding_beleid: 'blokkeren' } });
const b13 = maak([['SKF-GOLF-50X70']]); await betaald(b13, 'ideal');
ok(F(b13).status === 'geblokkeerd' && /Verplichte SKIFFA-merktoevoeging niet beschikbaar.*sticker/.test(F(b13).laatste_fout) && !posts(b13).length, 'verplichte sticker niet leverbaar + beleid blokkeren: geblokkeerd voor beoordeling');
await Pr('instellingen', { waarden: { branding_beleid: 'alternatief', branding_alternatief: 'postcard' } });
await Pr('opnieuw', { id: b13.id });
ok(F(b13).status === 'verstuurd' && posts(b13)[0].branding.postcard.url === 'https://skiffa.store/merk/kaart.png' && !posts(b13)[0].branding.sticker_exterior_round && F(b13).branding.beleid === 'alternatief', 'beleid alternatief: verzonden met het goedgekeurde kaartje');
await Pr('instellingen', { waarden: { branding: [{ type: 'sticker_exterior_round', url: 'https://skiffa.store/merk/sticker.png', verplicht: true }], branding_beleid: 'zonder' } });
const b14 = maak([['SKF-GOLF-50X70']]); await betaald(b14, 'ideal');
ok(F(b14).status === 'verstuurd' && !posts(b14)[0].branding && F(b14).branding.ontbrak.join() === 'sticker_exterior_round', 'beleid zonder (expliciet toegestaan): verzonden zonder, vastgelegd wat ontbrak');
P.merkLeverbaar.push('sticker_exterior_round');
const b15 = maak([['SKF-GOLF-50X70']]); await betaald(b15, 'ideal');
ok(posts(b15)[0].branding.sticker_exterior_round.url === 'https://skiffa.store/merk/sticker.png', 'leverbare sticker gaat mee');
await Pr('instellingen', { waarden: { branding: [], branding_beleid: 'blokkeren' } });

// ================= terugkoppeling =================
const o1 = P.orders[F(b1).extern_id].order;
o1.shipments = [{ carrier: { name: 'PostNL', service: 'Pakket' }, tracking: { number: '3SABC123', url: 'https://jouw.postnl.nl/track/3SABC123' } }];
o1.charges = [{ prodigiInvoiceNumber: 'INV-1', totalCost: { amount: '31.46', currency: 'EUR' }, totalTax: { amount: '5.46', currency: 'EUR' } }];
r = await call(prodigiRoute, { method: 'POST', url: '/api/prodigi?actie=callback&t=fout', body: { subject: o1.id } }); ok(r.c === 403, 'statusmelding met verkeerd token geweigerd');
mails.length = 0;
const t = new URL(pp.callbackUrl).searchParams.get('t');
r = await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${t}`, body: { specversion: '1.0', type: 'com.prodigi.order.status.stage.changed#Complete', subject: o1.id, data: { id: o1.id, shipments: [{ tracking: { number: 'VERVALST' } }] } } });
const nb1 = T.bestellingen.find((x) => x.id === b1.id);
ok(r.j.ok && nb1.status === 'verzonden' && nb1.track_trace === 'https://jouw.postnl.nl/track/3SABC123' && F(b1).kosten.totaal === 31.46 && F(b1).kosten.facturen[0] === 'INV-1', 'verzonden: tracking en werkelijke kosten uit Prodigi zelf (niet uit de melding)');
ok(mails.filter((m) => m.aan === 'ann@voorbeeld.nl').length === 1, 'klant krijgt één verzendmail');
await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${t}`, body: { subject: o1.id } });
ok(mails.filter((m) => m.aan === 'ann@voorbeeld.nl').length === 1, 'dubbele melding: geen tweede mail');
r = await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${t}`, body: { subject: proefRij.extern_id } }); ok(r.j.genegeerd === 'proefbestelling', 'melding over een proefbestelling verandert geen klantbestelling');

// ================= herdruk =================
r = (await Pr('herdruk', { id: b1.id, reden: 'beschadigd aangekomen' })).j; ok(!r.ok && /expliciet/.test(r.melding), 'herdruk vraagt expliciete bevestiging');
r = (await Pr('herdruk', { id: b1.id, reden: 'beschadigd aangekomen', bevestigd: true })).j;
const h1 = F(b1, 1);
ok(r.ok && h1.status === 'verstuurd' && h1.idempotentie_sleutel === `skiffa-sandbox-${b1.id}-h1` && P.posts.at(-1).merchantReference === `${b1.nummer}-H1` && F(b1).status === 'verzonden', 'herdruk: nieuwe, gekoppelde opdracht met eigen sleutel; de oorspronkelijke blijft verzonden');

// ================= kanaalorder, live en beheer =================
const { importeer } = await import(R + '_kanalen/opslag.js');
const ei = await importeer({ kanaal: 'etsy', extern_id: '777', naam: 'Kim Lee', email: 'kim@etsy.example', straat: 'High St 1', postcode: '1012AB', plaats: 'Amsterdam', land: 'NL', verzending: 6, meta: {}, regels: [{ poster_id: 'golf', poster_naam: 'Golf', formaat: '50x70', formaat_label: '50 × 70 cm', variant_sku: 'SKF-GOLF-50X70', drukbestand_versie_id: cat.VARIANTEN['SKF-GOLF-50X70'].drukbestand_id, prodigi_sku: 'GLOBAL-FAP-50X70', prodigi_attributen: {}, sizing: 'fitPrintArea', prijs: 59.95, aantal: 1, extern_item_id: 'x', gekoppeld: true }] });
await importeer({ kanaal: 'etsy', extern_id: '777', naam: 'Kim Lee', regels: [{ poster_id: 'golf', gekoppeld: true, prijs: 1, aantal: 1 }] });
const eb = T.bestellingen.find((x) => x.id === ei.id), ep = posts(eb);
ok(ep.length === 1 && !ep[0].recipient.email && ep[0].metadata.kanaal === 'etsy', 'Etsy-order (ook dubbel geïmporteerd): één opdracht, zonder e-mailadres van de koper');
r = (await Pr('reset-sandbox', { id: b2.id })).j; ok(!r.ok && /live/.test(r.melding), 'proefopdracht loskoppelen kan pas in live-modus');
await Pr('instellingen', { waarden: { sandbox: false } });
r = (await Pr('reset-sandbox', { id: b2.id })).j; await prodigi.verwerk();
ok(r.ok && F(b2).omgeving === 'live' && F(b2).status === 'verstuurd' && P.posts.at(-1).idempotencyKey === `skiffa-live-${b2.id}`, 'proefopdracht losgekoppeld: één keer live verstuurd');
r = (await Pr('reset-sandbox', { id: b2.id })).j; ok(!r.ok && /nooit twee keer/.test(r.melding), 'een live-opdracht nooit opnieuw');
r = (await Pr('overzicht')).j; ok(r.ok && r.sleutels.live && !JSON.stringify(r).includes('sandbox-sleutel') && r.proef.length >= 1 && r.inserts.sticker_exterior_round, 'overzicht in beheer (zonder sleutels), met proefbestellingen');
r = await call(admin, { url: `/api/admin?actie=bestelling&id=${b1.id}`, cookie }); ok(r.j.bestelling.fulfilments.length === 2 && r.j.bestelling.fulfilment.extern_id === F(b1).extern_id, 'bestelling toont productie en herdruk');
r = await call(prodigiRoute, { method: 'POST', url: '/api/prodigi?actie=verwerk', body: {} }); ok(r.c === 401, 'Prodigi-beheer zonder inlog geweigerd');
