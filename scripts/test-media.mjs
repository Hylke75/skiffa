import crypto from "node:crypto";
// Test van drukbestanden en visuals (koppelen, maatcontrole, downloadlinks, drukopdracht) zonder
// echte diensten: Supabase (database + Storage) en Resend worden nagebootst. Draai met:  npm test
import { T, S, supabase, antwoord, call, ok } from './_testmock.mjs';
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
const { maatStatus, herken, drukLink } = await import(R + '_media.js');
const { FORMATEN, ALLE_FORMATEN } = await import(R + '_catalogus.js');
const media = (await import(R + 'media.js')).default, admin = (await import(R + 'admin.js')).default;
const { betaald } = await import(R + '_verwerk.js');

// ---- formaten ----
ok(JSON.stringify(Object.keys(FORMATEN)) === '["30x40","50x70","70x100"]' && !ALLE_FORMATEN['18x24in'].actief && !ALLE_FORMATEN['24x36in'].actief, 'te koop: 30×40, 50×70, 70×100; 18×24 en 24×36 inch klaargezet voor later');

// ---- maatcontrole ----
ok(maatStatus('50x70', { media: [506, 706] }).status === 'ok' && maatStatus('50x70', { media: [506, 706] }).afloop === 3, '50×70 met 3 mm afloop rondom: goed');
ok(maatStatus('30x40', { media: [300.1, 399.8] }).status === 'ok', '30×40 zonder afloop: goed');
ok(maatStatus('70x100', { trim: [700, 1000], media: [710, 1010] }).status === 'ok', '70×100 met TrimBox: goed');
ok(maatStatus('50x70', { media: [500, 750] }).status === 'afwijkend', '50×75 (oude 2:3-maat) als 50×70: afwijkend');
ok(maatStatus('50x70', { media: [706, 506] }).status === 'afwijkend', 'liggende pagina: afwijkend');
ok(maatStatus('18x24in', { media: [463.2, 615.6] }).status === 'ok', '18×24 inch met 3 mm afloop: goed');
ok(maatStatus('50x70', {}).status === 'onbekend', 'geen maat uit de pdf: onbekend');

// ---- bestandsnamen automatisch koppelen ----
const h = (n) => JSON.stringify(herken(n));
ok(h('golf-50x70.pdf') === '{"soort":"druk","poster_id":"golf","formaat":"50x70"}', 'golf-50x70.pdf → Golf, 50 × 70');
ok(herken('Pier en Strand 30 x 40 cm.pdf').poster_id === 'pier-en-strand' && herken('Pier en Strand 30 x 40 cm.pdf').formaat === '30x40', '"Pier en Strand 30 x 40 cm.pdf" herkend');
ok(herken('noordzee-surf_70×100.pdf').poster_id === 'noordzee-surf' && herken('surf-70x100.pdf').poster_id === 'surf', 'Noordzee Surf en Surf niet verward');
ok(herken('regatta-18x24.pdf').formaat === '18x24in' && herken('regatta_24x36in.pdf').formaat === '24x36in', 'inchformaten herkend (met en zonder "in")');
ok(herken('golf-50x75.pdf').fout && herken('strand-50x70.pdf').fout && herken('golf.pdf').fout, 'onbekend formaat of poster: niet gekoppeld');
ok(h('Golf 3.JPG') === '{"soort":"visual","poster_id":"golf","positie":3}' && herken('golf-7.jpg').fout, 'visual: golf 3.jpg → positie 3; 7 bestaat niet');

// ---- beheer: inloggen vereist ----
let r = await call(media, { method: 'POST', url: '/api/media?actie=upload', body: { soort: 'druk', poster_id: 'golf', formaat: '50x70', bytes: 1000 } });
ok(r.c === 401, 'uploaden zonder inlog geweigerd');
const login = await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } });
const cookie = login.h['set-cookie'].split(';')[0];
const M = (actie, body, q = '') => call(media, { method: body ? 'POST' : 'GET', url: `/api/media?actie=${actie}${q}`, body, cookie });

// ---- drukbestand uploaden en koppelen ----
r = await M('herken', { namen: ['golf-50x70.pdf', 'zon-30x40.pdf', 'golf-1.jpg', 'iets.docx'] });
ok(r.j.bestanden.filter((b) => !b.fout).length === 3 && r.j.bestanden[3].fout, 'meerdere bestanden tegelijk herkend');
r = await M('upload', { soort: 'druk', poster_id: 'golf', formaat: '50x70', bytes: 48e6 });
ok(r.j.ok && r.j.pad === 'golf/50x70.pdf' && r.j.url.startsWith('https://supa.test/storage/v1/object/upload/sign/drukbestanden/golf/50x70.pdf?token='), 'ondertekende upload-URL rechtstreeks naar Supabase Storage');
r = await M('bevestig', { soort: 'druk', poster_id: 'golf', formaat: '50x70', media: [506, 706] });
ok(r.c === 400 && /niet gevonden/.test(r.j.melding), 'bevestigen zonder upload geweigerd');
await fetch(`https://supa.test/storage/v1/object/upload/sign/drukbestanden/golf/50x70.pdf?token=x`, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '48000000' }, body: 'x' });
r = await M('bevestig', { soort: 'druk', poster_id: 'golf', formaat: '50x70', media: [506, 706], paginas: 1, bestandsnaam: 'golf-50x70.pdf' });
ok(r.j.ok && r.j.status === 'ok' && T.drukbestanden[0].bytes === 48e6 && T.drukbestanden[0].afloop_mm === 3, 'drukbestand gekoppeld, maat gecontroleerd (3 mm afloop)');
await fetch(`https://supa.test/storage/v1/object/upload/sign/drukbestanden/zon/30x40.pdf?token=x`, { method: 'PUT', headers: { 'content-length': '9' }, body: 'x' });
r = await M('bevestig', { soort: 'druk', poster_id: 'zon', formaat: '30x40', media: [300, 450] });
ok(r.j.ok && r.j.status === 'afwijkend' && /wijkt af/.test(r.j.melding), 'verkeerde maat: wel gekoppeld, met waarschuwing');
r = await M('upload', { soort: 'druk', poster_id: 'golf', formaat: '40x40', bytes: 5 }); ok(r.c === 400, 'onbekend formaat geweigerd');

// ---- visuals ----
const zetVisual = async (pos) => {
  const u = (await M('upload', { soort: 'visual', poster_id: 'golf', positie: pos, bytes: 400000 })).j;
  for (const p of [u.pad, u.pad_klein]) await fetch(`https://supa.test/storage/v1/object/upload/sign/visuals/${p}?token=x`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'content-length': '400000' }, body: 'x' });
  return M('bevestig', { soort: 'visual', poster_id: 'golf', positie: pos, pad: u.pad, pad_klein: u.pad_klein, breedte: 1600, hoogte: 2000 });
};
for (const p of [1, 2, 3, 4, 5, 6]) await zetVisual(p);
ok(T.poster_visuals.length === 6 && Object.keys(S.visuals).length === 12, 'zes visuals (groot + klein) opgeslagen');
const oud = T.poster_visuals.find((v) => v.positie === 2).pad;
await new Promise((x) => setTimeout(x, 5)); await zetVisual(2);
ok(!S.visuals[oud] && T.poster_visuals.length === 6 && T.poster_visuals.find((v) => v.positie === 2).pad !== oud, 'visual vervangen: oud bestand opgeruimd');
r = await M('upload', { soort: 'visual', poster_id: 'golf', positie: 7, bytes: 5 }); ok(r.c === 400, 'positie 7 geweigerd');
r = await M('bevestig', { soort: 'visual', poster_id: 'golf', positie: 1, pad: 'zon/1-abc.jpg', pad_klein: 'zon/1-abc-klein.jpg' }); ok(r.c === 400, 'pad van een andere poster geweigerd');
r = await call(media, { url: '/api/media?actie=visuals' });
ok(r.j.visuals.golf.length === 6 && r.j.visuals.golf[0].url.startsWith('https://supa.test/storage/v1/object/public/visuals/golf/1-') && /s-maxage/.test(r.h['cache-control']), 'webshop haalt de zes visuals op (openbaar, gecachet)');
const { kanaalBeelden } = await import(R + '_media.js');
const kb = await kanaalBeelden('golf'); ok(kb.length === 7 && kb[0] === 'https://skiffa.store/posters/golf.jpg', 'Etsy/Amazon: poster + zes visuals');

r = await M('overzicht');
const golf = r.j.posters.find((p) => p.id === 'golf');
ok(golf.druk['50x70'].status === 'ok' && golf.druk['30x40'] === null && golf.visuals.length === 6 && r.j.tellers.druk === 2 && r.j.tellers.drukNodig === 48 && r.j.tellers.afwijkend === 1 && r.j.formaten.length === 5, 'overzicht: status per poster × formaat en visuals');

// ---- downloadlinks ----
r = await M('druk', null, '&p=golf&f=50x70');
ok(r.c === 302 && r.h.location.includes('/object/sign/drukbestanden/golf/50x70.pdf') && r.h.location.includes('download=skiffa-golf-50x70.pdf'), 'ingelogd: download via kortlevende Storage-link');
const link = new URL(drukLink('golf', '50x70'));
r = await call(media, { url: link.pathname + link.search }); ok(r.c === 302, 'ondertekende link (mail/drukker) werkt zonder inlog');
r = await call(media, { url: (link.pathname + link.search).replace('f=50x70', 'f=70x100') }); ok(r.c === 403, 'gewijzigde link geweigerd');
r = await call(media, { url: '/api/media?actie=druk&p=golf&f=50x70' }); ok(r.c === 403, 'zonder inlog en zonder handtekening geweigerd');
r = await M('druk', null, '&p=golf&f=70x100'); ok(r.c === 404, 'niet-geüpload drukbestand: 404');

// ---- bestelling betaald → drukbestanden gekoppeld, drukopdracht ----
const maak = (regels) => {
  const b = { id: crypto.randomUUID(), nummer: 'SK-' + Math.random().toString(36).slice(2, 8).toUpperCase(), token: 'a'.repeat(36), status: 'open', kanaal: 'webshop', naam: 'Ann de Vries', email: 'ann@voorbeeld.nl', straat: 'Strandweg 1', postcode: '2586 AA', plaats: 'Den Haag', land: 'NL', opmerking: '', subtotaal: 45, verzending: 6.95, totaal: 51.95, terugbetaald: 0, betaald_op: null, factuurnummer: null, extern_meta: {} };
  T.bestellingen.push(b);
  for (const [poster_id, formaat] of regels) T.bestelregels.push({ id: Math.random(), bestelling_id: b.id, poster_id, poster_naam: poster_id, formaat, formaat_label: ALLE_FORMATEN[formaat].label, prijs: 45, aantal: 1 });
  return b;
};
const b1 = maak([['golf', '50x70']]);
await betaald(b1, 'ideal');
const druk = mails.find((m) => m.aan === 'druk@drukkerij.test');
ok(druk && druk.onderwerp.includes(b1.nummer) && druk.html.includes('/api/media?actie=druk&amp;p=golf&amp;f=50x70') === false && druk.html.includes('/api/media?actie=druk&p=golf&f=50x70') && druk.html.includes('Strandweg 1'), 'betaald: drukopdracht met adres en link naar het drukbestand naar de drukker');
const winkel = mails.find((m) => m.aan === 'hallo@skiffa.nl' && m.onderwerp.includes(b1.nummer));
ok(winkel && winkel.html.includes('Drukbestanden') && winkel.html.includes('f=50x70'), 'mail aan de winkel bevat de drukbestanden');
ok(T.bestelling_log.some((l) => l.bestelling_id === b1.id && l.soort === 'drukker'), 'drukopdracht in het logboek');

const b2 = maak([['golf', '70x100']]); mails.length = 0;
await betaald(b2, 'ideal');
ok(!mails.some((m) => m.aan === 'druk@drukkerij.test') && T.bestelling_log.some((l) => l.bestelling_id === b2.id && /drukbestand ontbreekt/.test(l.tekst)), 'drukbestand ontbreekt: niet naar de drukker, waarschuwing in het logboek');
ok(mails.find((m) => m.aan === 'hallo@skiffa.nl').html.includes('drukbestand ontbreekt'), 'winkel ziet welk drukbestand ontbreekt');
r = await M('drukker', { id: b2.id }); ok(r.c === 400 && /ontbreekt/.test(r.j.melding), 'opnieuw sturen kan pas na uploaden');
await fetch(`https://supa.test/storage/v1/object/upload/sign/drukbestanden/golf/70x100.pdf?token=x`, { method: 'PUT', headers: { 'content-length': '9' }, body: 'x' });
await M('bevestig', { soort: 'druk', poster_id: 'golf', formaat: '70x100', media: [706, 1006] });
r = await M('drukker', { id: b2.id }); ok(r.j.ok && mails.some((m) => m.aan === 'druk@drukkerij.test' && m.onderwerp.includes(b2.nummer)), 'na uploaden: drukopdracht vanuit de administratie');

r = await call(admin, { url: `/api/admin?actie=bestelling&id=${b1.id}`, cookie });
ok(r.j.bestelling.bestelregels[0].druk?.status === 'ok' && r.j.bestelling.bestelregels[0].druk.link === '/api/media?actie=druk&p=golf&f=50x70' && r.j.bestelling.drukker === true, 'administratie: drukbestand per orderregel');

// ---- verwijderen ----
r = await M('verwijder', { soort: 'druk', poster_id: 'zon', formaat: '30x40' });
ok(r.j.ok && !T.drukbestanden.some((d) => d.poster_id === 'zon') && !S.drukbestanden['zon/30x40.pdf'], 'drukbestand verwijderd (database en opslag)');
