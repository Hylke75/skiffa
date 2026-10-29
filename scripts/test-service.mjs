// Test van fase 6: marges (werkelijk vs geschat), dashboard zonder verzonnen cijfers, actielijst met veilige
// vervolgstappen, serviceverzoeken met foto's, annuleringsverzoek van de klant en tracking op de statuspagina.
// Supabase, Prodigi en Resend nagebootst.  npm test
import { T, S, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const mails = [];
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url);
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.resend.com') { const b = JSON.parse(o.body); mails.push({ aan: b.to[0], onderwerp: b.subject }); return antwoord({ id: 'm' }); }
  throw new Error('fetch? ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord' });
const cat = await import(R + '_catalogus.js');
const admin = (await import(R + 'admin.js')).default, bestel = (await import(R + 'bestel.js')).default;
const { margeVan } = await import(R + '_service.js');
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];
const A = (actie, body, params = '') => call(admin, { method: body ? 'POST' : 'GET', url: `/api/admin?actie=${actie}${params}`, body, cookie });
zaaiCatalogus(cat.TEKSTEN);
await cat.laadCatalogus({ vers: true });

// ---- marge ----
const regels = [{ aantal: 2, kostprijs: 15 }, { aantal: 1, kostprijs: 20 }];
let m = margeVan({ totaal: 121, terugbetaald: 0, bestelregels: regels }, []);
ok(m.omzet_ex_btw === 100 && m.kosten_geschat === 50 && m.kosten_werkelijk === null && m.bron === 'schatting' && m.marge === 50, 'marge: schatting uit de kostprijs in de bestelregels');
m = margeVan({ totaal: 121, terugbetaald: 0, bestelregels: regels }, [{ herdruk_nr: 0, kosten: { totaal: 54.45, btw: 9.45 } }, { herdruk_nr: 1, kosten: { totaal: 24.2, btw: 4.2 } }]);
ok(m.kosten_werkelijk === 65 && m.bron === 'werkelijk' && m.marge === 35 && m.herdrukken === 1, 'marge: werkelijke Prodigi-kosten (excl. btw) incl. herdruk gaan voor');
m = margeVan({ totaal: 121, terugbetaald: 0, bestelregels: [{ aantal: 1, kostprijs: null }] }, []);
ok(m.bron === 'onbekend' && m.marge === null, 'marge: zonder kostprijs geen verzonnen marge');

// ---- dashboard zonder bestellingen ----
let r = await A('dashboard');
ok(r.c === 200 && r.j.totaal.bestellingen === 0 && r.j.populair.ontwerpen.length === 0 && r.j.aannames.length >= 3, 'dashboard: leeg = nullen, geen populaire ontwerpen, aannames erbij');

// ---- bestellingen ----
const klant = { naam: 'Ann de Vries', email: 'ann@voorbeeld.nl', straat: 'Strandweg 1', postcode: '2586 AA', plaats: 'Den Haag', land: 'NL' };
const nieuw = (status, extra = {}) => {
  const b = { id: crypto.randomUUID(), nummer: 'SK-T' + Math.random().toString(36).slice(2, 8).toUpperCase(), token: 'a'.repeat(36), status, kanaal: 'webshop', totaal: 60.5, terugbetaald: 0, verzending: 0, ...klant,
    betaald_op: new Date(Date.now() - 2 * 864e5).toISOString(), aangemaakt_op: new Date(Date.now() - 2 * 864e5).toISOString(), extern_meta: {}, ...extra };
  T.bestellingen.push(b);
  T.bestelregels.push({ id: Math.floor(Math.random() * 1e9), bestelling_id: b.id, poster_id: 'golf', poster_naam: 'Golf', formaat: '50x70', formaat_label: '50 × 70 cm', papier_label: 'Mat art-papier', aantal: 1, prijs: 60.5, kostprijs: 20 });
  return b;
};
const b1 = nieuw('verzonden'), b2 = nieuw('betaald', { kanaal: 'etsy', totaal: 121 }), b3 = nieuw('open', { betaald_op: null });
T.fulfilments.push({ id: 900, bestelling_id: b1.id, herdruk_nr: 0, status: 'verzonden', extern_id: 'ord_1', kosten: { totaal: 26.62, btw: 4.62 }, pogingen: 1 });
r = await A('dashboard');
ok(r.j.totaal.bestellingen === 2 && r.j.totaal.met_werkelijke_kosten === 1 && r.j.totaal.met_schatting === 1, 'dashboard: alleen betaalde bestellingen, werkelijk vs geschat geteld');
ok(r.j.perKanaal.webshop.omzet_ex_btw === 50 && r.j.perKanaal.etsy.omzet_ex_btw === 100 && r.j.totaal.marge === 108, 'dashboard: omzet excl. btw en resultaat per kanaal');
ok(r.j.populair.ontwerpen[0].naam === 'Golf' && r.j.populair.ontwerpen[0].stuks === 2 && r.j.populair.papieren[0].naam === 'Mat art-papier', 'dashboard: populair uit echte regels');

// ---- order-detail met marge ----
r = await A('bestelling', null, `&id=${b1.id}`);
ok(r.j.bestelling.marge.bron === 'werkelijk' && r.j.bestelling.marge.kosten_geschat === 20 && r.j.bestelling.marge.kosten_werkelijk === 22, 'bestelpaneel: verwachte en werkelijke kosten naast elkaar');

// ---- actielijst ----
T.fulfilments.push({ id: 901, bestelling_id: b2.id, herdruk_nr: 0, status: 'fout', extern_id: null, laatste_fout: 'Drukbestand afgekeurd', pogingen: 1, bijgewerkt_op: new Date().toISOString() });
const oud = nieuw('betaald', { betaald_op: new Date(Date.now() - 10 * 864e5).toISOString() });
T.zendingen.push({ id: 950, bestelling_id: b1.id, bron: 'handmatig', extern_ref: 'X', tracking_code: 'X', kanaal_gemeld_op: null, kanaal_fout: 'HTTP 500', kanaal_pogingen: 5 });
T.product_kanalen.push({ product_id: 'golf', kanaal: 'etsy', publiceren: true, status: 'fout', melding: 'Etsy weigerde de categorie', bijgewerkt_op: 'x' });
r = await A('actielijst');
const soorten = r.j.acties.map((x) => x.soort);
ok(soorten.includes('productie') && soorten.includes('verzending') && soorten.includes('tracking') && soorten.includes('publicatie'), 'actielijst: productiefout, lang onderweg, tracking en publicatie');
ok(r.j.acties[0].ernst === 'hoog' && r.j.acties.find((x) => x.soort === 'productie').acties.includes('prodigi-opnieuw'), 'actielijst: hoog bovenaan, met veilige vervolgstap');
const wacht = r.j.acties.find((x) => x.soort === 'verzending' && x.bestelling.id === oud.id);
r = await A('afvinken', { sleutel: wacht.sleutel, notitie: 'klant gebeld' });
r = await A('actielijst');
ok(!r.j.acties.some((x) => x.sleutel === wacht.sleutel) && r.j.afgevinkt === 1, 'actielijst: afvinken verbergt de melding');
r = await A('afvinken', { sleutel: 'drop table; --' });
ok(r.c === 400, 'actielijst: onzinnige sleutel geweigerd');
r = await A('zending-opnieuw', { zending_id: 950 });
ok(r.c === 200 && T.zendingen.find((z) => z.id === 950).kanaal_pogingen === 0 && T.zendingen.find((z) => z.id === 950).kanaal_fout === null, 'actielijst: tracking opnieuw doorgeven zet pogingen terug');
T.zendingen.find((z) => z.id === 950).kanaal_gemeld_op = new Date().toISOString();
r = await A('zending-opnieuw', { zending_id: 950 });
ok(r.c === 400, 'actielijst: al doorgegeven zending niet opnieuw');
// terugbetaald terwijl de productie nog wacht
const b4 = nieuw('betaald', { terugbetaald: 60.5 });
T.fulfilments.push({ id: 902, bestelling_id: b4.id, herdruk_nr: 0, status: 'geblokkeerd', extern_id: null, laatste_fout: 'terugbetaald', pogingen: 0, bijgewerkt_op: new Date().toISOString() });
r = await A('actielijst');
ok(r.j.acties.filter((x) => x.bestelling?.id === b4.id).length === 1 && r.j.acties.find((x) => x.bestelling?.id === b4.id).titel.startsWith('Terugbetaald'), 'actielijst: terugbetaald + wachtende productie = één beslispunt');

// ---- serviceverzoeken ----
r = await A('service-nieuw', { bestelling_id: b1.id, soort: 'schade', omschrijving: 'hoek' });
ok(r.c === 400, 'service: te korte omschrijving geweigerd');
r = await A('service-nieuw', { bestelling_id: b1.id, soort: 'diefstal', omschrijving: 'koker kwijt' });
ok(r.c === 400, 'service: onbekende soort geweigerd');
r = await A('service-nieuw', { bestelling_id: b1.id, soort: 'schade', omschrijving: 'Koker geknakt, hoek van de poster gekreukt', regels: ['999999999999'] });
const sv = T.serviceverzoeken.at(-1);
ok(r.c === 200 && sv.status === 'open' && sv.regels === null && T.bestelling_log.some((l) => l.bestelling_id === b1.id && l.soort === 'service'), 'service: schade geregistreerd, onbekende regels genegeerd, gelogd');
r = await A('service-foto-upload', { id: sv.id, bestandsnaam: 'schade.exe', bytes: 100 });
ok(r.c === 400, "service: alleen foto's");
r = await A('service-foto-upload', { id: sv.id, bestandsnaam: 'schade.jpg', bytes: 2e6 });
ok(r.c === 200 && r.j.pad.startsWith(`service/${b1.id}/${sv.id}-`), 'service: ondertekende upload in de privé-bucket');
const pad = r.j.pad;
r = await A('service-foto-bevestig', { id: sv.id, pad });
ok(r.c === 400, 'service: foto die niet is aangekomen wordt niet gekoppeld');
S.drukbestanden[pad] = { size: 2e6, type: 'image/jpeg', data: Buffer.alloc(10) };
r = await A('service-foto-bevestig', { id: sv.id, pad: `service/${b2.id}/x.jpg` });
ok(r.c === 400, 'service: pad van een andere bestelling geweigerd');
r = await A('service-foto-bevestig', { id: sv.id, pad });
ok(r.c === 200 && sv.fotos.length === 1, 'service: foto gekoppeld');
r = await A('bestelling', null, `&id=${b1.id}`);
ok(r.j.bestelling.service[0].foto_links[0].includes('token=dl'), 'service: foto alleen via tijdelijke link');
r = await A('service-zet', { id: sv.id, status: 'opgelost' });
ok(r.c === 400, 'service: opgelost vraagt een oplossing');
r = await A('service-zet', { id: sv.id, status: 'afgewezen', notitie: '' });
ok(r.c === 400, 'service: afwijzen vraagt een reden');
r = await A('service-zet', { id: sv.id, status: 'opgelost', oplossing: 'herdruk', notitie: 'herdruk geplaatst' });
ok(r.c === 200 && sv.status === 'opgelost' && sv.oplossing === 'herdruk' && sv.opgelost_op, 'service: opgelost met herdruk');
ok(T.bestellingen.find((x) => x.id === b1.id).status === 'verzonden' && !T.fulfilments.some((f) => f.bestelling_id === b1.id && f.herdruk_nr > 0), 'service: afsluiten plaatst zelf geen productie of terugbetaling');

// ---- klant: annuleringsverzoek en tracking op de statuspagina ----
const kb = nieuw('betaald', { token: 'b'.repeat(36) });
T.zendingen.push({ id: 960, bestelling_id: kb.id, bron: 'prodigi', extern_ref: 'sh_1', vervoerder: 'PostNL', tracking_code: null, tracking_url: null });
r = await call(bestel, { method: 'GET', url: `/api/bestel?nr=${kb.nummer}&t=${kb.token}` });
ok(r.j.ok && r.j.zendingen.length === 0 && r.j.annuleren_mogelijk === true, 'statuspagina: geen tracking tonen zolang er geen code is');
r = await call(bestel, { method: 'POST', body: { actie: 'annuleringsverzoek', nr: kb.nummer, t: 'c'.repeat(36), reden: 'verkeerd formaat' } });
ok(r.c === 404, 'annuleringsverzoek: verkeerde link geweigerd');
const voor = mails.length;
r = await call(bestel, { method: 'POST', body: { actie: 'annuleringsverzoek', nr: kb.nummer, t: kb.token, reden: 'verkeerd <b>formaat</b>' } });
const av = T.serviceverzoeken.filter((x) => x.bestelling_id === kb.id);
ok(r.c === 200 && av.length === 1 && av[0].soort === 'annulering' && av[0].door === 'klant' && !av[0].omschrijving.includes('<'), 'annuleringsverzoek: verzoek vastgelegd (geen html)');
ok(T.bestellingen.find((x) => x.id === kb.id).status === 'betaald' && mails.length === voor + 1 && mails.at(-1).onderwerp.startsWith('Annuleringsverzoek'), 'annuleringsverzoek: geen automatische annulering, winkel gemaild');
r = await call(bestel, { method: 'POST', body: { actie: 'annuleringsverzoek', nr: kb.nummer, t: kb.token } });
ok(T.serviceverzoeken.filter((x) => x.bestelling_id === kb.id).length === 1 && mails.length === voor + 1, 'annuleringsverzoek: tweede keer geen dubbel verzoek of dubbele mail');
Object.assign(T.zendingen.find((z) => z.id === 960), { tracking_code: '3SABC', tracking_url: 'https://postnl.nl/t/3SABC' });
r = await call(bestel, { method: 'GET', url: `/api/bestel?nr=${kb.nummer}&t=${kb.token}` });
ok(r.j.zendingen.length === 1 && r.j.zendingen[0].code === '3SABC' && r.j.annuleren_mogelijk === false && r.j.annulering_aangevraagd, 'statuspagina: tracking zodra die er is, verzoek zichtbaar');
const vb = nieuw('verzonden', { token: 'd'.repeat(36) });
r = await call(bestel, { method: 'POST', body: { actie: 'annuleringsverzoek', nr: vb.nummer, t: vb.token } });
ok(r.c === 400, 'annuleringsverzoek: verzonden bestelling niet meer via de pagina');

// ---- auditlog ----
const login = T.audit_log.find((a) => a.actie === 'login');
ok(login && login.details.wachtwoord === '[verborgen]' && !JSON.stringify(T.audit_log).includes('zeer-geheim-wachtwoord'), 'audit: inlogpoging gelogd, wachtwoord nooit opgeslagen');
ok(T.audit_log.some((a) => a.route === 'admin' && a.actie === 'service-nieuw' && a.ok === false) && T.audit_log.some((a) => a.actie === 'service-zet' && a.ok && a.details.oplossing === 'herdruk'), 'audit: geweigerde en gelukte beheeracties met details');
const voorAudit = T.audit_log.length;
await call(bestel, { method: 'GET', url: `/api/bestel?nr=${kb.nummer}&t=${kb.token}` });
await A('dashboard');
ok(T.audit_log.length === voorAudit, 'audit: lezen en klantverzoeken vullen het beheerlog niet');
r = await A('audit');
ok(r.c === 200 && r.j.log.length === voorAudit && r.j.log[0].op >= r.j.log.at(-1).op, 'audit: laatste acties op te vragen');
