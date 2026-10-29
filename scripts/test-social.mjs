// Test van social via Buffer: tijden in Europe/Amsterdam, UTM-links, invoercontrole, statusvertaling (een
// herinnering is nooit gepubliceerd), hoogstens één keer naar Buffer (dubbel klikken, onduidelijk antwoord),
// tijdelijke en definitieve fouten, annuleren en handmatig bevestigen. Buffer en Supabase nagebootst.  npm test
import { T, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../api/', import.meta.url));

const B = { posts: {}, aangemaakt: 0, verwijderd: [], volgende: null, n: 0 };
globalThis.fetch = async (url, o = {}) => {
  o.method = o.method || 'GET';
  const u = new URL(url);
  if (u.host === 'supa.test') return antwoord(supabase(url, o));
  if (u.host === 'api.buffer.com') {
    if (o.headers.authorization !== 'Bearer bk') return antwoord({ errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }] });
    const { query, variables } = JSON.parse(o.body);
    if (/account \{/.test(query)) return antwoord({ data: { account: { id: 'a', email: 'x@y', organizations: [{ id: 'org1', name: 'SKIFFA' }] } } });
    if (/channels\(/.test(query)) return antwoord({ data: { channels: [
      { id: 'ig1', name: 'skiffa', displayName: 'SKIFFA', service: 'instagram', avatar: 'https://a', isDisconnected: false, isLocked: false, isQueuePaused: false, hasActiveMemberDevice: true },
      { id: 'tt1', name: 'skiffa_tt', service: 'tiktok', avatar: 'https://b', isDisconnected: false, isLocked: false, isQueuePaused: false, hasActiveMemberDevice: true },
      { id: 'pi1', name: 'skiffapins', service: 'pinterest', avatar: 'https://c', isDisconnected: true, isLocked: false, isQueuePaused: false, hasActiveMemberDevice: false, metadata: { boards: [{ serviceId: 'bord1', name: 'Posters' }] } },
    ] } });
    if (/createPost/.test(query)) {
      const s = B.volgende; B.volgende = null;
      if (s === 'netwerk') throw new TypeError('fetch failed');
      if (s === 'netwerk-na-aanmaken') { maak(variables.input); throw new TypeError('fetch failed'); }
      if (s === '429') return antwoord({}, 429);
      if (s === 'weiger') return antwoord({ data: { createPost: { message: 'Instagram vereist een afbeelding' } } });
      return antwoord({ data: { createPost: { post: maak(variables.input) } } });
    }
    if (/posts\(first/.test(query)) { const f = variables.input.filter; return antwoord({ data: { posts: { edges: Object.values(B.posts).filter((p) => p.channelId === f.channelIds[0] && p.createdAt >= f.createdAt.start).map((node) => ({ node })) } } }); }
    if (/post\(input/.test(query)) { const p = B.posts[variables.input.id]; return p ? antwoord({ data: { post: p } }) : antwoord({ errors: [{ message: 'not found', extensions: { code: 'NOT_FOUND' } }] }); }
    if (/deletePost/.test(query)) { B.verwijderd.push(variables.input.id); delete B.posts[variables.input.id]; return antwoord({ data: { deletePost: { _empty: '' } } }); }
  }
  throw new Error('fetch? ' + url);
};
function maak(input) { B.aangemaakt++; const id = `bp${++B.n}`; B.posts[id] = { id, text: input.text, status: 'scheduled', dueAt: input.dueAt || null, sentAt: null, externalLink: null, notificationStatus: null, schedulingType: input.schedulingType, createdAt: new Date().toISOString(), channelId: input.channelId, error: null, _input: input }; return B.posts[id]; }

Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', SITE_URL: 'https://skiffa.store', ADMIN_WACHTWOORD: 'zeer-geheim-wachtwoord', BUFFER_API_KEY: 'bk' });
const cat = await import(R + '_catalogus.js');
const admin = (await import(R + 'admin.js')).default, route = (await import(R + 'social.js')).default;
const S = await import(R + '_social.js'), buf = await import(R + '_buffer.js');
const cookie = (await call(admin, { method: 'POST', url: '/api/admin?actie=login', body: { wachtwoord: 'zeer-geheim-wachtwoord' } })).h['set-cookie'].split(';')[0];
const A = (actie, body, params = '') => call(route, { method: body ? 'POST' : 'GET', url: `/api/social?actie=${actie}${params}`, body, cookie });
zaaiCatalogus(cat.TEKSTEN);
T.producten.find((p) => p.id === 'golf').status = 'actief';
await cat.laadCatalogus({ vers: true });

// ---- tijd en links ----
ok(S.amsterdamNaarUtc('2026-11-03T10:00') === '2026-11-03T09:00:00.000Z' && S.amsterdamNaarUtc('2026-07-01T10:00') === '2026-07-01T08:00:00.000Z', 'tijd: Amsterdamse invoer naar UTC (winter +1, zomer +2)');
ok(S.utcNaarAmsterdam('2026-03-29T01:30:00.000Z') === '2026-03-29T03:30' && S.amsterdamNaarUtc('2026-10-25T12:00') === '2026-10-25T11:00:00.000Z', 'tijd: rond de omschakeling klopt het');
ok(S.utmUrl('https://skiffa.store/#golf', { source: 'instagram', campaign: 'poster-skf-006', content: 'post-1' }) === 'https://skiffa.store/?utm_source=instagram&utm_medium=social&utm_campaign=poster-skf-006&utm_content=post-1#golf', 'utm: parameters vóór het #-anker');

// ---- invoer en statusvertaling ----
let fout = ''; try { buf.postInput({ service: 'instagram', kanaalId: 'x', tekst: 'hoi', publicatie: 'automatisch', postType: 'post', assets: [] }); } catch (e) { fout = e.message; }
ok(/minstens één afbeelding/.test(fout), 'invoer: Instagram zonder beeld geweigerd');
fout = ''; try { buf.postInput({ service: 'pinterest', kanaalId: 'x', tekst: 'hoi', publicatie: 'automatisch', postType: 'post', assets: [{ soort: 'afbeelding', url: 'https://x/a.jpg' }] }); } catch (e) { fout = e.message; }
ok(/Pinterest-bord/.test(fout), 'invoer: Pinterest vraagt een bord');
const inp = buf.postInput({ service: 'instagram', kanaalId: 'ig', tekst: 'hoi', publicatie: 'telefoon', postType: 'post', dueAt: '2026-11-03T09:00:00.000Z', assets: [{ soort: 'afbeelding', url: 'https://x/a.jpg', alt_tekst: 'poster' }] });
ok(inp.schedulingType === 'notification' && inp.mode === 'customScheduled' && inp.metadata.instagram.shouldShareToFeed === true && inp.assets[0].image.metadata.altText === 'poster', 'invoer: telefoon = notification, tijdstip = customScheduled');
ok(buf.vertaalStatus({ status: 'sent', schedulingType: 'notification', notificationStatus: 'notified', sentAt: 'x' }).status === 'herinnering', 'status: verstuurde herinnering is NIET gepubliceerd');
ok(buf.vertaalStatus({ status: 'sent', schedulingType: 'notification', notificationStatus: null }).status === 'herinnering', 'status: herinnering zonder notificatiestatus is ook niet gepubliceerd');
ok(buf.vertaalStatus({ status: 'sent', schedulingType: 'notification', notificationStatus: 'markedAsPublished' }).status === 'gepubliceerd', 'status: als gepubliceerd gemarkeerd = gepubliceerd');
ok(buf.vertaalStatus({ status: 'sent', schedulingType: 'automatic', externalLink: 'https://instagram.com/p/1' }).extern_link === 'https://instagram.com/p/1', 'status: automatisch geplaatst met link');
ok(buf.vertaalStatus({ status: 'error', error: { message: 'token verlopen' } }).status === 'fout' && buf.vertaalStatus(null).status === 'geannuleerd', 'status: fout en verwijderd');

// ---- accounts ----
let r = await A('accounts-sync', {});
ok(r.c === 200 && T.social_connections.length === 3 && T.social_connections.find((c) => c.extern_id === 'pi1').status === 'ontkoppeld' && T.social_connections.find((c) => c.extern_id === 'pi1').meta.borden[0].id === 'bord1', 'accounts: opgehaald, ontkoppeld account herkend, Pinterest-borden');
process.env.BUFFER_API_KEY = 'fout';
r = await A('accounts-sync', {});
ok(r.c === 500 || r.c === 400, 'accounts: verkeerde sleutel geeft een fout, geen schijnsucces');
process.env.BUFFER_API_KEY = 'bk';

// ---- bericht vanuit product ----
r = await A('van-product', { product_id: 'golf' });
const postId = r.j.id;
let doelen = T.social_post_targets.filter((d) => d.post_id === postId);
ok(r.c === 200 && doelen.length === 2 && T.social_posts.find((p) => p.id === postId).tekst.includes('{link}'), 'van product: concept met {link} en de actieve accounts (niet het ontkoppelde)');
ok(T.social_assets.some((a) => a.post_id === postId && a.url.startsWith('https://')), 'van product: productbeeld met openbare url');
r = await A('voorbeeld', null, `&id=${postId}`);
const ig = r.j.per.find((x) => x.account.service === 'instagram'), tt = r.j.per.find((x) => x.account.service === 'tiktok');
ok(ig.tekst.includes('Link in bio') && !ig.tekst.includes('{link}') && ig.ontbreekt.length === 0, 'voorbeeld: Instagram krijgt "Link in bio", niets ontbreekt');
ok(tt.publicatie === 'telefoon', 'voorbeeld: TikTok met alleen foto gaat via de telefoon');

// ---- inplannen: uit, proef, echt ----
r = await A('inplannen', { id: postId });
ok(r.c === 400 && /staat uit/.test(r.j.melding) && B.aangemaakt === 0, 'inplannen: social uit = niets naar Buffer');
await A('instellingen', { waarden: { aan: true } });
r = await A('inplannen', { id: postId });
ok(r.c === 200 && B.aangemaakt === 0 && T.social_post_targets.filter((d) => d.post_id === postId).every((d) => d.status === 'concept' && /Proefmodus/.test(d.melding)), 'inplannen: proefmodus verstuurt niets en zegt dat ook');
await A('instellingen', { waarden: { proef: false } });
const ttDoel = T.social_post_targets.find((d) => d.post_id === postId && T.social_connections.find((c) => c.id === d.connection_id).service === 'tiktok');
await A('bewaar', { id: postId, doelen: T.social_post_targets.filter((d) => d.post_id === postId).map((d) => ({ connection_id: d.connection_id, publicatie: d.id === ttDoel.id ? 'telefoon' : 'automatisch', gepland_lokaal: d.id === ttDoel.id ? null : '2030-11-03T10:00', metadata: { link_toevoegen: true } })) });
const [r1, r2] = await Promise.all([A('inplannen', { id: postId }), A('inplannen', { id: postId })]);
ok(B.aangemaakt === 2, 'inplannen: twee keer tegelijk klikken = toch maar één bericht per account in Buffer');
doelen = T.social_post_targets.filter((d) => d.post_id === postId);
const igDoel = doelen.find((d) => d.id !== ttDoel.id);
ok(igDoel.status === 'in_buffer' && igDoel.extern_id && B.posts[igDoel.extern_id].dueAt === '2030-11-03T09:00:00.000Z', 'inplannen: in Buffer met het juiste UTC-tijdstip');
ok(T.campaign_links.length >= 1 && B.posts[ttDoel.extern_id || 'x']?._input.schedulingType === 'notification', 'inplannen: campagnelink vastgelegd, TikTok als herinnering');
ok(T.social_posts.find((p) => p.id === postId).status === 'gepland', 'bericht: status gepland');
r = await A('inplannen', { id: postId });
ok(B.aangemaakt === 2 && r.j.overgeslagen.length === 2, 'inplannen: opnieuw inplannen maakt niets dubbel');

// ---- statussen ----
Object.assign(B.posts[igDoel.extern_id], { status: 'sent', sentAt: '2030-11-03T09:00:05Z', externalLink: 'https://instagram.com/p/abc' });
Object.assign(B.posts[ttDoel.extern_id], { status: 'sent', sentAt: '2030-11-03T09:00:05Z', notificationStatus: 'notified' });
r = await A('verwerk', {});
doelen = T.social_post_targets.filter((d) => d.post_id === postId);
ok(doelen.find((d) => d.id === igDoel.id).status === 'gepubliceerd' && doelen.find((d) => d.id === igDoel.id).extern_link === 'https://instagram.com/p/abc', 'status: automatisch geplaatst met link');
ok(doelen.find((d) => d.id === ttDoel.id).status === 'herinnering' && T.social_posts.find((p) => p.id === postId).status === 'deels', 'status: herinnering blijft herinnering; bericht "deels", niet gepubliceerd');
r = await A('annuleer', { doel_id: ttDoel.id });
ok(r.c === 400, 'annuleren: verstuurde herinnering niet als "geannuleerd" verbergen');
r = await A('geplaatst', { doel_id: igDoel.id });
ok(r.c === 400, 'bevestigen: alleen voor herinneringen');
r = await A('geplaatst', { doel_id: ttDoel.id, link: 'https://www.tiktok.com/@skiffa/video/1' });
ok(r.c === 200 && T.social_post_targets.find((d) => d.id === ttDoel.id).status === 'gepubliceerd' && T.social_posts.find((p) => p.id === postId).status === 'gepubliceerd', 'bevestigen: na jouw bevestiging gepubliceerd');
await A('verwerk', {});
ok(T.social_post_targets.find((d) => d.id === ttDoel.id).status === 'gepubliceerd', 'bevestigen: volgende sync zet het niet terug naar herinnering');

// ---- onduidelijk antwoord: eerst zoeken, niet dubbel ----
const nieuwPost = async (tekst, lokaal) => {
  const igc = T.social_connections.find((c) => c.extern_id === 'ig1');
  const x = await A('bewaar', { titel: tekst, tekst, product_id: 'golf', media: [{ url: 'https://skiffa.store/posters/golf.jpg', soort: 'afbeelding', bron: 'poster' }], doelen: [{ connection_id: igc.id, publicatie: 'automatisch', gepland_lokaal: lokaal, metadata: {} }] });
  return x.j.id;
};
let p2 = await nieuwPost('Onduidelijk 1', '2030-12-01T12:00');
B.volgende = 'netwerk-na-aanmaken';
await A('inplannen', { id: p2 });
let d2 = T.social_post_targets.find((d) => d.post_id === p2);
ok(d2.status === 'onzeker' && B.aangemaakt === 3, 'onzeker: geen antwoord na aanmaken = onzeker (niet opnieuw)');
T.publishing_jobs.find((j) => j.target_id === d2.id).volgende_poging_op = new Date(Date.now() - 1000).toISOString();
await A('verwerk', {});
d2 = T.social_post_targets.find((d) => d.post_id === p2);
ok(d2.status === 'in_buffer' && d2.extern_id && B.aangemaakt === 3 && /Teruggevonden/.test(d2.melding), 'onzeker: teruggevonden in Buffer en overgenomen, niet dubbel aangemaakt');
let p3 = await nieuwPost('Onduidelijk 2', '2030-12-02T12:00');
B.volgende = 'netwerk';
await A('inplannen', { id: p3 });
let d3 = T.social_post_targets.find((d) => d.post_id === p3);
T.publishing_jobs.find((j) => j.target_id === d3.id).volgende_poging_op = new Date(Date.now() - 1000).toISOString();
await A('verwerk', {});
d3 = T.social_post_targets.find((d) => d.post_id === p3);
ok(d3.status === 'in_buffer' && B.aangemaakt === 4, 'onzeker: niet gevonden = precies één nieuwe poging');

// ---- tijdelijk en definitief ----
let p4 = await nieuwPost('Te druk', '2030-12-03T12:00');
B.volgende = '429';
await A('inplannen', { id: p4 });
let d4 = T.social_post_targets.find((d) => d.post_id === p4), j4 = T.publishing_jobs.find((j) => j.target_id === d4.id);
ok(d4.status === 'klaar' && j4.status === 'wacht' && j4.volgende_poging_op > new Date().toISOString(), 'tijdelijk (429): later automatisch opnieuw');
let p5 = await nieuwPost('Geweigerd', '2030-12-04T12:00');
B.volgende = 'weiger';
await A('inplannen', { id: p5 });
let d5 = T.social_post_targets.find((d) => d.post_id === p5);
ok(d5.status === 'fout' && /Instagram vereist/.test(d5.melding) && T.publishing_jobs.find((j) => j.target_id === d5.id).status === 'fout', 'definitief: Buffer weigert = fout met uitleg, geen herhaling');
r = await A('inplannen', { id: p5 });
ok(T.social_post_targets.find((d) => d.post_id === p5).status === 'in_buffer' && T.publishing_jobs.filter((j) => j.target_id === d5.id).length === 2, 'na een fout: opnieuw inplannen is een nieuwe, eigen taak');

// ---- annuleren en verwijderen ----
r = await A('annuleer', { doel_id: d2.id });
ok(r.c === 200 && B.verwijderd.includes(d2.extern_id || B.verwijderd.at(-1)) && T.social_post_targets.find((d) => d.id === d2.id).status === 'geannuleerd', 'annuleren: uit Buffer verwijderd');
r = await A('verwijder', { id: p3 });
ok(r.c === 400, 'verwijderen: niet zolang er iets in Buffer staat');
r = await A('verwijder', { id: p2 });
ok(r.c === 200 && !T.social_posts.some((p) => p.id === p2), 'verwijderen: geannuleerd bericht mag weg');

// ---- kalender en actielijst ----
r = await A('kalender', null, '&van=2030-12-01&tot=2030-12-31');
ok(r.c === 200 && r.j.items.some((x) => x.gepland_lokaal === '2030-12-02T12:00') && r.j.tijdzone === 'Europe/Amsterdam', 'kalender: in Amsterdamse tijd');
const acties = await S.actiepunten();
ok(acties.some((a) => /ontkoppeld/.test(a.titel)) && !acties.some((a) => /Herinnering/.test(a.titel)), 'actielijst: ontkoppeld account; bevestigde herinnering niet meer');
r = await call(route, { method: 'GET', url: '/api/social?actie=overzicht' });
ok(r.c === 401, 'social: alleen voor de beheerder');
