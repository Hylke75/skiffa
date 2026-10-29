// Test van de centrale catalogus en de Prodigi-koppeling zonder echte diensten: Supabase (database +
// Storage), Prodigi en Resend worden nagebootst. Kern: elke betaalde bestelling gaat hooguit één keer
// naar Prodigi, ook bij dubbele meldingen, gelijktijdige runs en herhaalde pogingen.  npm test
import crypto from 'node:crypto';
import { T, S, supabase, antwoord, call, ok } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const mails = [];
const P = { orders: {}, posts: [], faal: 0, faalNaAanmaken: 0 };   // nagebootste Prodigi
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url);
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.resend.com') { const b = JSON.parse(o.body); mails.push({ aan: b.to[0], onderwerp: b.subject, html: b.html }); return antwoord({ id: 'm' }); }
  if (u.host === 'api.sandbox.prodigi.com' || u.host === 'api.prodigi.com') {
    if (o.headers['X-API-Key'] !== (u.host === 'api.prodigi.com' ? 'live-sleutel' : 'sandbox-sleutel')) return antwoord({ statusText: 'Unauthorized' }, 401);
    const p = u.pathname.replace('/v4.0', '');
    if (p === '/Orders' && o.method === 'POST') {
      const b = JSON.parse(o.body); P.posts.push(b);
      if (P.faal > 0) { P.faal--; return antwoord({ statusText: 'Internal error' }, 500); }
      const bestaand = Object.values(P.orders).find((x) => x.idempotencyKey === b.idempotencyKey);
      if (bestaand) return antwoord({ outcome: 'Ok', order: bestaand.order });
      const id = 'ord_' + crypto.randomBytes(4).toString('hex');
      P.orders[id] = { ...b, order: { id, status: { stage: 'InProgress' }, shipments: [] } };
      if (P.faalNaAanmaken > 0) { P.faalNaAanmaken--; return antwoord({ statusText: 'Gateway timeout' }, 504); }  // aangemaakt, maar wij horen het niet
      return antwoord({ outcome: 'Created', order: P.orders[id].order }, 200);
    }
    if (p === '/Orders' && o.method === 'GET') return antwoord({ orders: [] });
    let m = p.match(/^\/Orders\/(ord_\w+)$/); if (m) return P.orders[m[1]] ? antwoord({ order: P.orders[m[1]].order }) : antwoord({}, 404);
    m = p.match(/^\/Orders\/(ord_\w+)\/actions\/cancel$/); if (m) { P.orders[m[1]].order.status.stage = 'Cancelled'; return antwoord({ outcome: 'Cancelled' }); }
  }
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're_x', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord', PRODIGI_SANDBOX_API_KEY: 'sandbox-sleutel', PRODIGI_API_KEY: 'live-sleutel', DRUKKER_EMAIL: 'druk@drukkerij.test' });

const cat = await import(R + '_catalogus.js');
const catalogus = (await import(R + 'catalogus.js')).default, admin = (await import(R + 'admin.js')).default, prodigiRoute = (await import(R + 'prodigi.js')).default, bestel = (await import(R + 'bestel.js')).default;
const { betaald } = await import(R + '_verwerk.js');
const prodigi = await import(R + '_prodigi.js');
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];
const C = (actie, body) => call(catalogus, { method: body ? 'POST' : 'GET', url: `/api/catalogus?actie=${actie}`, body, cookie });
const Pr = (actie, body, q = '') => call(prodigiRoute, { method: body ? 'POST' : 'GET', url: `/api/prodigi?actie=${actie}${q}`, body, cookie });

// ================= Catalogus =================
let r = await call(catalogus, { url: '/api/catalogus' });
ok(r.j.ok && r.j.bron === 'code' && r.j.producten.length === 16 && r.j.formaten.length === 3, 'zonder catalogus in de database: de catalogus uit de code');
// startvulling zoals de migratie die zet
for (const [id, f] of Object.entries(cat.CODE_FORMATEN)) T.catalogus_formaten.push({ id, label: f.label, breedte_mm: f.mm[0], hoogte_mm: f.mm[1], prijs: f.prijs, actief: f.actief, standaard: id === '50x70', volgorde: 0, prodigi_sku: null });
Object.entries(cat.TEKSTEN).forEach(([id, t], i) => T.catalogus_producten.push({ id, naam: t.naam, sub: t.sub, zin: t.zin, kleur: '#123456', actief: true, volgorde: i, beeld: null, beeld_klein: null }));
await cat.laadCatalogus({ vers: true });
ok(cat.catalogusBron() === 'database' && Object.keys(cat.POSTERS).length === 16, 'catalogus geladen uit de database');

r = await C('formaat', { id: '50x70', label: '50 × 70 cm', prijs: '49,95', actief: true, standaard: true, volgorde: 20, prodigi_sku: 'global-fap-50x70' });
ok(r.j.ok && cat.FORMATEN['50x70'].prijs === 49.95 && cat.ALLE_FORMATEN['50x70'].prodigi_sku === 'GLOBAL-FAP-50X70', 'prijs en Prodigi-SKU in beheer aangepast');
r = await call(bestel, { method: 'POST', body: { klant: { naam: 'Ann de Vries', email: 'ann@voorbeeld.nl', straat: 'Strandweg 1', postcode: '2586 AA', plaats: 'Den Haag', land: 'NL' }, regels: [{ id: 'golf', formaat: '50x70', aantal: 1 }], akkoord: true, t: 5000 } });
const sk = T.bestellingen.at(-1); ok(sk && Number(sk.subtotaal) === 49.95, 'webshop rekent met de nieuwe prijs uit de catalogus');
r = await C('formaat', { id: '30x40', label: '30 × 40 cm', prijs: '29', actief: true, standaard: true, volgorde: 10 });
ok(T.catalogus_formaten.filter((f) => f.standaard).length === 1 && T.catalogus_formaten.find((f) => f.standaard).id === '30x40', 'maar één standaardformaat');
await C('formaat', { id: '50x70', label: '50 × 70 cm', prijs: '49,95', actief: true, standaard: true, volgorde: 20, prodigi_sku: 'GLOBAL-FAP-50X70' });
for (const id of ['30x40', '70x100']) await C('formaat', { id, label: cat.ALLE_FORMATEN[id].label, prijs: cat.ALLE_FORMATEN[id].prijs, actief: false });
r = await C('formaat', { id: '50x70', label: '50 × 70 cm', prijs: '49,95', actief: false });
ok(r.c === 400 && /minstens één/.test(r.j.melding), 'het laatste formaat kan niet uit de verkoop');
for (const id of ['30x40', '70x100']) await C('formaat', { id, label: cat.ALLE_FORMATEN[id].label, prijs: cat.ALLE_FORMATEN[id].prijs, actief: true });
r = await C('formaat', { id: '50x70', prijs: '0' }); ok(r.c === 400, 'prijs 0 geweigerd');

r = await C('product', { nieuw: true, naam: 'Strandtent <b>', actief: true });
ok(r.c === 400 && /productbeeld/.test(r.j.melding), 'nieuwe poster kan niet te koop zonder beeld');
r = await C('product', { nieuw: true, naam: 'Strandtent <b>', sub: 'jaren vijftig', zin: 'Een tent op het strand.', kleur: '#AA3300' });
ok(r.j.ok && r.j.id === 'strandtent-b' && T.catalogus_producten.find((p) => p.id === 'strandtent-b').naam === 'Strandtent b', 'nieuwe poster aangemaakt (html eruit gefilterd, nog niet te koop)');
r = await C('product', { nieuw: true, naam: 'Strandtent b' }); ok(r.c === 400 && /bestaat al/.test(r.j.melding), 'dubbele id geweigerd');
const u = (await C('beeld-upload', { id: 'strandtent-b', bytes: 300000 })).j;
for (const p of [u.pad, u.pad_klein]) await fetch(`https://supa.test/storage/v1/object/upload/sign/visuals/${p}?token=x`, { method: 'PUT', headers: { 'content-length': '300000' }, body: 'x' });
r = await C('beeld-bevestig', { id: 'strandtent-b', pad: u.pad, pad_klein: u.pad_klein }); ok(r.j.ok, 'productbeeld geüpload');
r = await C('product', { id: 'strandtent-b', naam: 'Strandtent', sub: 'jaren vijftig', zin: 'Een tent op het strand.', kleur: '#AA3300', actief: true, volgorde: 5 });
ok(r.j.ok && cat.POSTERS['strandtent-b'] === 'Strandtent', 'met beeld: te koop');
r = await call(catalogus, { url: '/api/catalogus' });
const st = r.j.producten.find((p) => p.id === 'strandtent-b');
ok(r.j.bron === 'database' && st && st.beeld.includes('/object/public/visuals/producten/strandtent-b-') && r.j.formaten.find((f) => f.id === '50x70').prijs === 49.95 && /s-maxage/.test(r.h['cache-control']), 'webshop krijgt de nieuwe poster, het beeld en de prijzen');
await C('product', { id: 'zon', naam: 'Zon', actief: false });
await cat.laadCatalogus({ vers: true });
ok(!cat.POSTERS.zon && cat.ALLE_POSTERS.zon, 'poster uit de verkoop: niet te koop, wel nog bekend voor oude orders');
r = await call(bestel, { method: 'POST', body: { klant: { naam: 'X Y', email: 'x@y.nl', straat: 'A 1', postcode: '1234 AB', plaats: 'Ede', land: 'NL' }, regels: [{ id: 'zon', formaat: '50x70', aantal: 1 }], akkoord: true, t: 5000 } });
ok(r.c === 400, 'poster uit de verkoop kan niet besteld worden');
r = await C('beheer'); ok(r.j.producten.length === 17 && r.j.formaten.length === 5, 'beheer ziet alle posters en formaten');
r = await call(catalogus, { method: 'POST', url: '/api/catalogus?actie=product', body: { nieuw: true, naam: 'X' } }); ok(r.c === 401, 'catalogus wijzigen zonder inlog geweigerd');

// ================= Prodigi =================
const drukbestand = (poster, formaat, status = 'ok') => { T.drukbestanden.push({ poster_id: poster, formaat, pad: `${poster}/${formaat}.pdf`, maat_status: status, bytes: 1 }); S.drukbestanden[`${poster}/${formaat}.pdf`] = { size: 1 }; };
drukbestand('golf', '50x70'); drukbestand('golf', '30x40');
const maak = (regels, extra = {}) => {
  const b = { id: crypto.randomUUID(), nummer: 'SK-' + crypto.randomBytes(3).toString('hex').toUpperCase(), token: 'a'.repeat(36), status: 'open', kanaal: 'webshop', naam: 'Ann de Vries', email: 'ann@voorbeeld.nl', straat: 'Strandweg 1', postcode: '2586 AA', plaats: 'Den Haag', land: 'NL', opmerking: '', subtotaal: 49.95, verzending: 6.95, totaal: 56.9, terugbetaald: 0, betaald_op: null, factuurnummer: null, extern_meta: {}, ...extra };
  T.bestellingen.push(b);
  for (const [poster_id, formaat, aantal = 1] of regels) T.bestelregels.push({ id: Math.random(), bestelling_id: b.id, poster_id, poster_naam: poster_id, formaat, formaat_label: cat.ALLE_FORMATEN[formaat].label, prijs: 49.95, aantal });
  return b;
};
const F = (b) => T.fulfilments.find((f) => f.bestelling_id === b.id);

// uit: drukopdracht per mail zoals voorheen
const b0 = maak([['golf', '50x70']]); await betaald(b0, 'ideal');
ok(!F(b0) && mails.some((m) => m.aan === 'druk@drukkerij.test' && m.onderwerp.includes(b0.nummer)), 'Prodigi uit: geen fulfilment, drukopdracht per mail');

r = await Pr('instellingen', { waarden: { aan: true, sandbox: true, wachttijd_min: 0, verzendmethode: 'Standard' } });
ok(r.j.ok && r.j.instellingen.aan && r.j.instellingen.sandbox, 'Prodigi aan in de proefomgeving');
r = await Pr('ping', { omgeving: 'sandbox' }); ok(r.j.ok, 'verbinding met Prodigi (sandbox)');

mails.length = 0;
const b1 = maak([['golf', '50x70', 2]]); await betaald(b1, 'ideal');
ok(F(b1)?.status === 'verstuurd' && P.posts.length === 1 && Object.keys(P.orders).length === 1, 'betaald → direct één order bij Prodigi');
const po = P.posts[0];
ok(po.idempotencyKey === `skiffa-sandbox-${b1.id}` && po.merchantReference === b1.nummer && po.items[0].sku === 'GLOBAL-FAP-50X70' && po.items[0].copies === 2 && po.items[0].assets[0].url.includes('/object/sign/drukbestanden/golf/50x70.pdf') && po.recipient.address.postalOrZipCode === '2586 AA' && po.callbackUrl.includes('/api/prodigi?actie=callback&t='), 'order: vaste idempotentiesleutel, SKU, aantal, drukbestand, adres, callback');
ok(T.bestellingen.find((x) => x.id === b1.id).status === 'in_productie' && !mails.some((m) => m.aan === 'druk@drukkerij.test'), 'bestelling in productie; geen drukopdracht per mail meer');
await betaald(b1, 'ideal');                                   // dubbele Mollie-melding
await prodigi.aanmelden({ id: b1.id });                        // dubbele aanmelding
await Promise.all([prodigi.verwerk(), prodigi.verwerk(), Pr('verwerk', {})]);
ok(P.posts.length === 1 && T.fulfilments.filter((f) => f.bestelling_id === b1.id).length === 1, 'dubbele melding, dubbele aanmelding en gelijktijdige runs: nog steeds één order');
r = await Pr('opnieuw', { id: b1.id }); ok(r.c === 400 && P.posts.length === 1, 'al verstuurd: opnieuw versturen kan niet');

// wachttijd en gelijktijdige runs
await Pr('instellingen', { waarden: { wachttijd_min: 30 } });
const b2 = maak([['golf', '30x40']]);
await C('formaat', { id: '30x40', label: '30 × 40 cm', prijs: 29, actief: true, prodigi_sku: 'GLOBAL-FAP-30X40' });
await betaald(b2, 'ideal'); await prodigi.verwerk();
ok(F(b2)?.status === 'wacht' && P.posts.length === 1, 'wachttijd: nog niet verstuurd');
F(b2).vanaf = new Date(Date.now() - 1000).toISOString();
await Promise.all(Array.from({ length: 5 }, () => prodigi.verwerk()));
ok(F(b2).status === 'verstuurd' && P.posts.filter((x) => x.merchantReference === b2.nummer).length === 1, 'na de wachttijd: vijf gelijktijdige runs, één order');

// tijdelijke fout en time-out na aanmaken: herhaling met dezelfde sleutel, Prodigi maakt geen tweede order
await Pr('instellingen', { waarden: { wachttijd_min: 0 } });
P.faal = 1; const b3 = maak([['golf', '50x70']]); await betaald(b3, 'ideal');
ok(F(b3).status === 'opnieuw' && /500/.test(F(b3).laatste_fout), 'Prodigi-storing: later opnieuw');
P.faalNaAanmaken = 1; F(b3).vanaf = new Date(Date.now() - 1000).toISOString(); await prodigi.verwerk();
ok(F(b3).status === 'opnieuw' && Object.values(P.orders).filter((x) => x.merchantReference === b3.nummer).length === 1, 'time-out terwijl Prodigi de order wel aanmaakte: nog niet als verstuurd gezien');
F(b3).vanaf = new Date(Date.now() - 1000).toISOString(); await prodigi.verwerk();
const sleutels3 = P.posts.filter((x) => x.merchantReference === b3.nummer).map((x) => x.idempotencyKey);
ok(F(b3).status === 'verstuurd' && new Set(sleutels3).size === 1 && sleutels3.length === 3 && Object.values(P.orders).filter((x) => x.merchantReference === b3.nummer).length === 1, 'derde poging: zelfde idempotentiesleutel, Prodigi geeft de bestaande order terug (één order)');
// vastgelopen claim
const b4 = maak([['golf', '50x70']]); await betaald(b4, 'ideal');
const f4 = F(b4); f4.status = 'bezig'; f4.geclaimd_op = new Date(Date.now() - 11 * 60000).toISOString(); f4.extern_id = null;
const voor4 = P.posts.length; await prodigi.verwerk();
ok(P.posts.length === voor4 + 1 && P.posts.at(-1).idempotencyKey === f4.idempotentie_sleutel, 'vastgelopen claim na 10 min vrijgegeven, opnieuw met dezelfde sleutel');

// controles vóór versturen
const b5 = maak([['golf', '70x100']]); await betaald(b5, 'ideal');
ok(F(b5).status === 'geblokkeerd' && /Prodigi-SKU/.test(F(b5).laatste_fout) && /drukbestand ontbreekt/.test(F(b5).laatste_fout) && !P.posts.some((x) => x.merchantReference === b5.nummer), 'geen SKU en geen drukbestand: geblokkeerd, niets verstuurd');
await C('formaat', { id: '70x100', label: '70 × 100 cm', prijs: 69, actief: true, prodigi_sku: 'GLOBAL-FAP-70X100' }); drukbestand('golf', '70x100');
r = await Pr('opnieuw', { id: b5.id }); ok(r.j.ok && F(b5).status === 'verstuurd', 'na oplossen: opnieuw proberen → verstuurd');
drukbestand('surf', '50x70', 'afwijkend');
const b6 = maak([['surf', '50x70']]); await betaald(b6, 'ideal'); ok(F(b6).status === 'geblokkeerd' && /wijkt af/.test(F(b6).laatste_fout), 'drukbestand met afwijkende maat: geblokkeerd');
const b7 = maak([['golf', '50x70']], { status: 'betaald', betaald_op: new Date().toISOString(), terugbetaald: 10 });
await prodigi.aanmelden(b7); ok(F(b7).status === 'wacht' && !P.posts.some((x) => x.merchantReference === b7.nummer), 'terugbetaald: de claim weigert, niets verstuurd');
const b8 = maak([['golf', '50x70']]);
r = await Pr('aanmelden', { id: b8.id }); ok(r.c === 400 && !F(b8), 'onbetaalde bestelling kan niet naar Prodigi');

// annuleren
await Pr('instellingen', { waarden: { wachttijd_min: 30 } });
const b9 = maak([['golf', '50x70']]); await betaald(b9, 'ideal');
await call(admin, { method: 'POST', url: '/api/admin?actie=status', cookie, body: { id: b9.id, status: 'geannuleerd' } });
F(b9).vanaf = new Date(0).toISOString(); await prodigi.verwerk();
ok(F(b9).status === 'geannuleerd' && !P.posts.some((x) => x.merchantReference === b9.nummer), 'geannuleerd in de wachttijd: niets naar Prodigi');
r = await Pr('annuleer', { id: b5.id }); ok(r.j.ok && P.orders[F(b5).extern_id].order.status.stage === 'Cancelled' && F(b5).status === 'geannuleerd', 'al verstuurd: annuleren bij Prodigi');

// statusmeldingen
const o1 = P.orders[F(b1).extern_id].order;
o1.shipments = [{ carrier: { name: 'PostNL', service: 'Standard' }, tracking: { number: '3SABC123', url: 'https://jouw.postnl.nl/track/3SABC123' } }];
r = await call(prodigiRoute, { method: 'POST', url: '/api/prodigi?actie=callback&t=fout', body: { data: { order: { id: o1.id } } } }); ok(r.c === 403, 'statusmelding met verkeerd token geweigerd');
mails.length = 0;
const t = new URL(P.posts[0].callbackUrl).searchParams.get('t');
r = await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${t}`, body: { type: 'com.prodigi.order.status.stage.changed#Complete', data: { order: { id: o1.id, shipments: [{ tracking: { number: 'VERVALST' } }] } } } });
const nb1 = T.bestellingen.find((x) => x.id === b1.id);
ok(r.j.ok && nb1.status === 'verzonden' && nb1.track_trace === 'https://jouw.postnl.nl/track/3SABC123' && nb1.vervoerder === 'postnl' && F(b1).status === 'verzonden', 'verzonden: track-and-trace uit Prodigi zelf (niet uit de melding), vervoerder herkend');
ok(mails.some((m) => m.aan === 'ann@voorbeeld.nl' && /onderweg/.test(m.onderwerp)), 'klant krijgt de verzendmail');
await call(prodigiRoute, { method: 'POST', url: `/api/prodigi?actie=callback&t=${t}`, body: { data: { order: { id: o1.id } } } });
ok(mails.filter((m) => m.aan === 'ann@voorbeeld.nl').length === 1, 'dubbele melding: geen tweede mail');
// vangnet zonder callback
const f2 = F(b2); f2.bijgewerkt_op = new Date(Date.now() - 2 * 3600000).toISOString();
P.orders[f2.extern_id].order.shipments = [{ carrier: { name: 'DHL Parcel' }, tracking: { number: 'JVGL123' } }];
r = await prodigi.statussen(); ok(r.bijgewerkt >= 1 && T.bestellingen.find((x) => x.id === b2.id).status === 'verzonden', 'zonder callback: de cron haalt de status zelf op');

// kanaalorder (Etsy): geen e-mailadres van de koper naar Prodigi
await Pr('instellingen', { waarden: { wachttijd_min: 0 } });
const { importeer } = await import(R + '_kanalen/opslag.js');
const ei = await importeer({ kanaal: 'etsy', extern_id: '777', naam: 'Kim Lee', email: 'kim@etsy.example', straat: 'High St 1', postcode: 'SW1A 1AA', plaats: 'London', land: 'GB', verzending: 6, meta: {}, regels: [{ poster_id: 'golf', poster_naam: 'Golf', formaat: '50x70', formaat_label: '50 × 70 cm', prijs: 59.95, aantal: 1, extern_item_id: 'x', gekoppeld: true }] });
const ep = P.posts.find((x) => x.merchantReference === T.bestellingen.find((b) => b.id === ei.id).nummer);
ok(ep && ep.recipient.address.countryCode === 'GB' && !ep.recipient.email && ep.metadata.kanaal === 'etsy', 'Etsy-order: automatisch naar Prodigi, zonder e-mailadres van de koper');

// live en proeforders
r = await Pr('reset-sandbox', { id: b3.id }); ok(r.c === 400 && /live/.test(r.j.melding), 'proeforder loskoppelen kan pas in live-modus');
await Pr('instellingen', { waarden: { sandbox: false } });
r = await Pr('reset-sandbox', { id: b3.id }); await prodigi.verwerk();
ok(r.j.ok && F(b3).omgeving === 'live' && F(b3).status === 'verstuurd' && P.posts.at(-1).idempotencyKey === `skiffa-live-${b3.id}`, 'proeforder losgekoppeld: één keer live verstuurd');
r = await Pr('reset-sandbox', { id: b3.id }); ok(r.c === 400 && /nooit twee keer/.test(r.j.melding), 'een live-order kan nooit opnieuw');

r = await Pr('overzicht'); ok(r.j.ok && r.j.sleutels.live && r.j.tellers.verzonden >= 2 && !JSON.stringify(r.j).includes('sandbox-sleutel'), 'overzicht in beheer (zonder sleutels)');
r = await call(admin, { url: `/api/admin?actie=bestelling&id=${b1.id}`, cookie }); ok(r.j.bestelling.fulfilment?.extern_id === F(b1).extern_id, 'bestelling in de administratie toont de Prodigi-status');
r = await call(prodigiRoute, { method: 'POST', url: '/api/prodigi?actie=verwerk', body: {} }); ok(r.c === 401, 'Prodigi-beheer zonder inlog geweigerd');
