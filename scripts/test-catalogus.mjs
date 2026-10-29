// Test van de centrale catalogus: producten, varianten, beelden, drukbestanden (versies + controle),
// uitzonderingen en de webshop, zonder echte diensten (Supabase + Storage en Resend nagebootst).  npm test
import crypto from 'node:crypto';
import { T, S, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const mails = [];
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url);
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.resend.com') { const b = JSON.parse(o.body); mails.push({ aan: b.to[0], onderwerp: b.subject, html: b.html }); return antwoord({ id: 'm' }); }
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're_x', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord', DRUKKER_EMAIL: 'druk@drukkerij.test' });

const cat = await import(R + '_catalogus.js');
const { beoordeel, leesKop, herken, drukLink } = await import(R + '_media.js');
const catalogus = (await import(R + 'catalogus.js')).default, media = (await import(R + 'media.js')).default, admin = (await import(R + 'admin.js')).default, bestel = (await import(R + 'bestel.js')).default;
const { betaald } = await import(R + '_verwerk.js');
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];
const C = (a, body, q = '') => call(catalogus, { method: body ? 'POST' : 'GET', url: `/api/catalogus?actie=${a}${q}`, body, cookie });
const M = (a, body, q = '') => call(media, { method: body ? 'POST' : 'GET', url: `/api/media?actie=${a}${q}`, body, cookie });

// ---- testbestanden ----
const png = (w, h) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpg = (w, h) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3]), Buffer.alloc(32)]);
const pdf = (bmm, hmm) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 ${(bmm / 25.4 * 72).toFixed(3)} ${(hmm / 25.4 * 72).toFixed(3)}] >> endobj\n`, 'latin1');
const klant = { naam: 'Ann de Vries', email: 'ann@voorbeeld.nl', straat: 'Strandweg 1', postcode: '2586 AA', plaats: 'Den Haag', land: 'NL' };

async function drukUpload(sku, naam, data) {
  const u = (await M('druk-upload', { sku, bytes: data.length, bestandsnaam: naam })).j;
  if (!u.ok) return u;
  await fetch(u.url, { method: 'PUT', headers: { 'content-type': u.mime, 'content-length': String(data.length) }, body: data });
  return (await M('druk-bevestig', { sku, pad: u.pad, versie: u.versie, bestandsnaam: naam, meting: {} })).j;
}

// ================= zonder catalogus in de database =================
let r = await call(catalogus, { url: '/api/catalogus' });
ok(r.j.bron === 'code' && r.j.producten.length === 16 && r.j.producten[0].varianten.length === 3 && r.j.producten[0].varianten[0].sku.startsWith('SKF-'), 'zonder database: 16 posters met elk 3 varianten uit de code');

// ================= controles op drukbestanden (pure functies) =================
const doel50 = { mm: [500, 700], sizing: 'fitPrintArea', prodigi: null };
let q = beoordeel({ mime: 'image/png', breedte_px: 5906, hoogte_px: 8268 }, doel50);
ok(q.status === 'waarschuwing' && q.controles.find((c) => c.code === 'resolutie').ernst === 'ok' && q.controles.find((c) => c.code === 'prodigi').ernst === 'waarschuwing', '50×70 op 300 dpi: goed, maar nog niet getoetst aan Prodigi (waarschuwing)');
q = beoordeel({ mime: 'image/png', breedte_px: 4000, hoogte_px: 6000 }, doel50);
ok(q.controles.find((c) => c.code === 'verhouding').ernst === 'waarschuwing' && q.uitsnede.soort === 'witte rand' && q.uitsnede.zijde === 'links en rechts' && q.uitsnede.mm > 15, '2:3-ontwerp op 50×70 passend: witte rand links en rechts, met maat in mm');
q = beoordeel({ mime: 'image/png', breedte_px: 4000, hoogte_px: 6000 }, { ...doel50, sizing: 'fillPrintArea' });
ok(q.status === 'afgekeurd' && q.uitsnede.soort === 'bijsnijden' && /afgesneden/.test(q.controles.find((c) => c.code === 'verhouding').tekst), 'vullend: bijsnijden wordt nooit stilzwijgend gedaan (afgekeurd tot uitzondering)');
q = beoordeel({ mime: 'image/jpeg', breedte_px: 1000, hoogte_px: 1400 }, doel50);
ok(q.status === 'afgekeurd' && /dpi/.test(q.controles.find((c) => c.code === 'resolutie').tekst), 'te lage resolutie: afgekeurd');
q = beoordeel({ mime: 'image/png', breedte_px: 5000, hoogte_px: 7000 }, { ...doel50, prodigi: { px: { b: 5906, h: 8268 }, mm: [500, 700] } });
ok(q.status === 'waarschuwing' && /85%/.test(q.controles.find((c) => c.code === 'resolutie').tekst), 'getoetst aan de pixeleis van het Prodigi-product (85%: waarschuwing)');
q = beoordeel({ mime: 'image/png', breedte_px: 8268, hoogte_px: 5906 }, doel50);
ok(q.status === 'afgekeurd' && q.controles.some((c) => c.code === 'orientatie'), 'liggend bestand voor staand formaat: afgekeurd');
ok(beoordeel({ mime: 'application/pdf', pagina_mm: [506, 706] }, doel50).controles.find((c) => c.code === 'afmeting').ernst === 'ok', 'pdf op maat met 3 mm afloop: goed');
ok(beoordeel({ mime: 'application/pdf', pagina_mm: [500, 750] }, doel50).status === 'afgekeurd', 'pdf met verkeerde maat: afgekeurd (Prodigi schaalt geen pdf)');
ok(beoordeel({ mime: 'image/webp' }, doel50).status === 'afgekeurd', 'onbekend bestandstype: afgekeurd');
ok(JSON.stringify(leesKop(png(10, 20))) === '{"mime":"image/png","breedte_px":10,"hoogte_px":20}' && leesKop(jpg(300, 400)).breedte_px === 300 && leesKop(jpg(300, 400)).hoogte_px === 400 && leesKop(pdf(500, 700)).media[0] === 500, 'bestandskop: png, jpeg en pdf herkend met maten');

// ================= catalogus in de database =================
zaaiCatalogus(cat.TEKSTEN);
await cat.laadCatalogus({ vers: true });
ok(cat.catalogusBron() === 'database' && Object.keys(cat.VARIANTEN).length === 48 && !Object.keys(cat.POSTERS).length, 'startvulling: 48 varianten, maar nog niets bestelbaar (niet bevestigd, geen drukbestanden)');
ok(cat.VARIANTEN['SKF-GOLF-50X70'].ontbreekt.some((o) => /leverbaarheid/.test(o)) && cat.VARIANTEN['SKF-GOLF-50X70'].ontbreekt.some((o) => /drukbestand ontbreekt/.test(o)), 'wat ontbreekt staat er in gewone taal bij');
r = await call(catalogus, { url: '/api/catalogus' }); ok(r.j.bron === 'database' && r.j.producten.length === 0, 'webshop toont niets wat niet besteld kan worden');
r = await call(bestel, { method: 'POST', body: { klant, regels: [{ id: 'golf', formaat: '50x70', aantal: 1 }], akkoord: true, t: 5000 } });
ok(r.c === 400, 'niet-bestelbare variant kan niet besteld worden');

// ---- bestandsnamen ----
ok(herken('golf-50x70.png').sku === 'SKF-GOLF-50X70' && herken('Golf 50 x 70 cm-mat.pdf').sku === 'SKF-GOLF-50X70' && herken('golf-3.jpg').soort === 'beeld' && herken('golf-3.jpg').positie === 3 && herken('golf-50x70-hahnemuhle.png').fout, 'bestandsnamen → variant (drukbestand) of beeld; onbekende papiersoort niet gekoppeld');

// ---- drukbestand uploaden: controle op wat er echt staat ----
r = await call(media, { method: 'POST', url: '/api/media?actie=druk-upload', body: { sku: 'SKF-GOLF-50X70', bytes: 10, bestandsnaam: 'x.png' } }); ok(r.c === 401, 'drukbestand uploaden zonder inlog geweigerd');
r = (await M('druk-upload', { sku: 'SKF-GOLF-50X70', bytes: 10, bestandsnaam: 'golf.tif' })).j; ok(!r.ok && /jpg, png of pdf/.test(r.melding), 'alleen jpg, png of pdf');
let d1 = await drukUpload('SKF-GOLF-50X70', 'golf-50x70.png', png(5906, 8268));
ok(d1.ok && d1.versie === 1 && d1.status === 'waarschuwing' && T.varianten.find((v) => v.sku === 'SKF-GOLF-50X70').drukbestand_id === d1.versie_id, 'drukbestand v1 gecontroleerd (maten door de server zelf gelezen) en gekoppeld');
ok(Object.keys(S.drukbestanden).some((k) => k.startsWith('golf/SKF-GOLF-50X70/v1-')), 'opgeslagen in de privé bucket, per variant en versie');
let dX = await drukUpload('SKF-GOLF-30X40', 'golf-30x40.png', jpg(3543, 4724));
ok(dX.status === 'afgekeurd' && dX.controles.find((c) => c.code === 'type').tekst.includes('extensie zegt png'), 'bestand dat zich als png voordoet maar jpeg is: afgekeurd');

// ---- leverbaarheid (zonder Prodigi: handmatig met reden) en status ----
r = (await C('variant', { sku: 'SKF-GOLF-50X70', handmatig_leverbaar: true, handmatig_reden: '' })).j; ok(!r.ok && /reden/.test(r.melding), 'handmatig leverbaar alleen met reden');
r = (await C('variant', { sku: 'SKF-GOLF-50X70', handmatig_leverbaar: true, handmatig_reden: 'eigen drukker, proef goedgekeurd' })).j; ok(r.ok, 'handmatig leverbaar met reden');
await cat.laadCatalogus({ vers: true });
ok(cat.VARIANTEN['SKF-GOLF-50X70'].bestelbaar && cat.POSTERS.golf === 'Golf' && !cat.VARIANTEN['SKF-GOLF-70X100'].bestelbaar, 'golf 50×70 is nu bestelbaar, 70×100 niet');
r = await call(catalogus, { url: '/api/catalogus' });
ok(r.j.producten.length === 1 && r.j.producten[0].varianten.length === 1 && r.j.producten[0].varianten[0].sku === 'SKF-GOLF-50X70' && r.j.papiersoorten[0].uitleg && r.j.formaten.length === 1, 'webshop: alleen golf in 50×70, met papieruitleg');
r = await call(bestel, { method: 'POST', body: { klant, regels: [{ id: 'golf', sku: 'SKF-GOLF-50X70', aantal: 1 }], akkoord: true, t: 5000 } });
const b1 = T.bestellingen.at(-1), rg = T.bestelregels.find((x) => x.bestelling_id === b1.id);
ok(r.j.ok && rg.variant_sku === 'SKF-GOLF-50X70' && rg.drukbestand_versie_id === d1.versie_id && rg.papier_label === 'Mat art-papier' && Number(b1.subtotaal) === 45, 'bestelling met vaste kopie: SKU, drukbestandversie, papier, prijs');
r = await call(bestel, { method: 'POST', body: { klant, regels: [{ id: 'golf', formaat: '70x100', aantal: 1 }], akkoord: true, t: 5000 } }); ok(r.c === 400, 'niet-bestelbare variant (70×100) geweigerd');

// ---- nieuwe versie: bestaande bestelling houdt zijn versie ----
const d2 = await drukUpload('SKF-GOLF-50X70', 'golf-50x70-v2.png', png(5906, 8268));
ok(d2.versie === 2 && T.varianten.find((v) => v.sku === 'SKF-GOLF-50X70').drukbestand_id === d2.versie_id && T.bestelregels.find((x) => x.bestelling_id === b1.id).drukbestand_versie_id === d1.versie_id, 'nieuwe versie; de eerdere bestelling blijft naar v1 wijzen');
r = (await M('druk-verwijder', { versie_id: d1.versie_id })).j; ok(!r.ok && /bestelling/.test(r.melding), 'versie die bij een bestelling hoort kan niet weg');
await betaald(b1, 'ideal');
const dm = mails.find((m) => m.aan === 'druk@drukkerij.test');
ok(dm && dm.html.includes(`v=${d1.versie_id}&amp;`) === false && dm.html.includes(`actie=druk&v=${d1.versie_id}&e=`) && dm.html.includes('drukbestand v1'), 'drukopdracht (Prodigi uit) bevat de besteld versie v1');

// ---- downloads ----
r = await M('druk', null, `&v=${d2.versie_id}`); ok(r.c === 302 && r.h.location.includes('/object/sign/drukbestanden/golf/SKF-GOLF-50X70/v2-') && r.h.location.includes('download=skiffa-skf-golf-50x70-v2.png'), 'beheer: download via kortlevende link');
const link = new URL(drukLink(d1.versie_id)); r = await call(media, { url: link.pathname + link.search }); ok(r.c === 302, 'ondertekende link werkt zonder inlog');
r = await call(media, { url: (link.pathname + link.search).replace(`v=${d1.versie_id}`, `v=${d2.versie_id}`) }); ok(r.c === 403, 'gewijzigde link geweigerd');
r = await call(media, { url: `/api/media?actie=druk&v=${d1.versie_id}` }); ok(r.c === 403, 'zonder inlog en zonder handtekening geweigerd');

// ---- afgekeurd: uitzondering met motivatie ----
await C('variant', { sku: 'SKF-GOLF-70X100', handmatig_leverbaar: true, handmatig_reden: 'eigen drukker' });
const d3 = await drukUpload('SKF-GOLF-70X100', 'golf-70x100.png', png(2000, 2857));
await cat.laadCatalogus({ vers: true });
ok(d3.status === 'afgekeurd' && !cat.VARIANTEN['SKF-GOLF-70X100'].bestelbaar && cat.VARIANTEN['SKF-GOLF-70X100'].ontbreekt.some((o) => /afgekeurd/.test(o)), 'afgekeurd drukbestand blokkeert de verkoop');
r = (await C('uitzondering', { sku: 'SKF-GOLF-70X100', reden: 'mag wel' })).j; ok(!r.ok && /Motiveer/.test(r.melding), 'uitzondering vraagt een echte motivatie');
r = (await C('uitzondering', { sku: 'SKF-GOLF-70X100', reden: 'Bewust zacht beeld (schilderij); proef op 70×100 goedgekeurd.' })).j;
await cat.laadCatalogus({ vers: true });
ok(r.ok && cat.VARIANTEN['SKF-GOLF-70X100'].bestelbaar, 'met bevestigde uitzondering bestelbaar');
await drukUpload('SKF-GOLF-70X100', 'golf-70x100-v2.png', png(1500, 2143));
await cat.laadCatalogus({ vers: true });
ok(!cat.VARIANTEN['SKF-GOLF-70X100'].bestelbaar && !T.varianten.find((v) => v.sku === 'SKF-GOLF-70X100').qc_uitzondering, 'nieuw bestand = nieuwe beoordeling: de oude uitzondering vervalt');

// ================= producten beheren =================
r = (await C('product', { nieuw: true, titel: 'Strandtent <b>', beschrijving: 'Een tent.', kleuren: 'oranje, blauw', zoekwoorden: ['strand', 'tent'], seo_titel: 'x'.repeat(90) })).j;
const nieuw = T.producten.find((p) => p.id === r.id);
ok(r.ok && r.id === 'strandtent-b' && r.code === 'SKF-017' && nieuw.titel === 'Strandtent b' && nieuw.kleuren.join() === 'oranje,blauw' && nieuw.seo_titel.length === 70 && nieuw.status === 'concept', 'nieuwe poster: URL-naam, volgende productcode, html eruit, lijsten, SEO-lengte, concept');
r = (await C('product', { nieuw: true, titel: 'Strandtent b' })).j; ok(!r.ok && /bestaat al/.test(r.melding), 'dubbele URL-naam geweigerd');
r = (await C('product', { id: 'strandtent-b', titel: 'Strandtent', code: 'SKF-001' })).j; ok(!r.ok && /al in gebruik/.test(r.melding), 'dubbele productcode geweigerd');
r = (await C('product', { id: 'strandtent-b', titel: 'Strandtent', status: 'actief' })).j; ok(!r.ok && /productbeeld/.test(r.melding), 'actief zonder productbeeld kan niet');
r = (await C('papier', { nieuw: true, naam: 'Hahnemühle Photo Rag', uitleg: 'Katoen, zacht, 308 g/m².', gewicht_gsm: 308 })).j; ok(r.ok && r.id === 'hahnemuhle-photo-rag', 'papiersoort toegevoegd');
await cat.laadCatalogus({ vers: true });
r = (await C('varianten-genereren', { product_id: 'strandtent-b', formaten: ['30x40', '50x70'], papieren: ['mat', 'hahnemuhle-photo-rag'], prijzen: { '30x40': '29', '50x70': '49,95' } })).j;
ok(r.ok && T.varianten.filter((v) => v.product_id === 'strandtent-b').length === 4 && T.varianten.find((v) => v.sku === 'SKF-STRANDTENT-B-50X70-HAHNEMUHLE-PHOTO-RAG').prijs === 49.95, 'varianten per formaat × papier gegenereerd met eigen SKU en prijs');
r = (await C('variant', { nieuw: true, product_id: 'strandtent-b', formaat_id: '30x40', papier_id: 'mat', prijs: 30 })).j; ok(!r.ok && /bestaat al/.test(r.melding), 'dubbele combinatie geweigerd');
r = (await C('variant', { sku: 'SKF-STRANDTENT-B-30X40', prodigi_sku: 'global-fap-12x16', prodigi_attributen: { paperType: 'EMA' } })).j;
ok(r.ok && T.varianten.find((v) => v.sku === 'SKF-STRANDTENT-B-30X40').prodigi_sku === 'GLOBAL-FAP-12X16' && /opnieuw/.test(r.melding), 'Prodigi-product koppelen: opnieuw te controleren');
r = await C('product', null, '&id=strandtent-b');
ok(r.j.ok && r.j.varianten.length === 4 && r.j.varianten.every((v) => !v.klaar && v.ontbreekt.length), 'productkaart: varianten met wat er nog ontbreekt');

// ---- beelden per formaat/papier ----
const u = (await M('beeld-upload', { poster_id: 'golf', positie: 1, bytes: 300000 })).j;
for (const p of [u.pad, u.pad_klein]) await fetch(`https://supa.test/storage/v1/object/upload/sign/visuals/${p}?token=x`, { method: 'PUT', body: Buffer.from('x') });
r = (await M('beeld-bevestig', { poster_id: 'golf', positie: 1, pad: u.pad, pad_klein: u.pad_klein, soort: 'mockup', formaat_id: '50x70', alt: 'Golf in de woonkamer' })).j;
ok(r.ok && T.poster_visuals[0].soort === 'mockup' && T.poster_visuals[0].formaat_id === '50x70', 'interieur-mock-up bij 50×70 opgeslagen');
r = await call(catalogus, { url: '/api/catalogus' }); ok(r.j.visuals.golf[0].soort === 'mockup' && r.j.visuals.golf[0].formaat === '50x70', 'webshop krijgt het beeld met formaat (wisselt mee bij de keuze)');
r = (await M('beeld-upload', { poster_id: 'golf', positie: 31, bytes: 5 })).j; ok(!r.ok, 'maximaal 30 beelden');

// ---- archiveren ----
await C('product', { id: 'golf', titel: 'Golf', status: 'gearchiveerd' }); await cat.laadCatalogus({ vers: true });
ok(!cat.POSTERS.golf && cat.ALLE_POSTERS.golf, 'gearchiveerd: niet meer te koop, wel bekend voor oude bestellingen');
r = await call(admin, { url: `/api/admin?actie=bestelling&id=${b1.id}`, cookie });
ok(r.j.bestelling.bestelregels[0].druk.versie === 1 && r.j.bestelling.bestelregels[0].druk.link === `/api/media?actie=druk&v=${d1.versie_id}`, 'administratie: de bestelling wijst naar de bestelde versie');
r = await call(catalogus, { method: 'POST', url: '/api/catalogus?actie=product', body: { nieuw: true, titel: 'X' } }); ok(r.c === 401, 'catalogus wijzigen zonder inlog geweigerd');
