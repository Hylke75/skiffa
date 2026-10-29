// Social via Buffer: accounts, contentstudio (bericht + varianten per account), kalender (Europe/Amsterdam),
// verzenden via taken (hoogstens één keer), statussen terughalen en campagnelinks (UTM).
//
// Niets wordt als gepubliceerd getoond voordat Buffer dat meldt. "Afronden op telefoon" = een herinnering;
// die blijft "herinnering" tot Buffer markedAsPublished meldt of jij hier bevestigt dat je het hebt geplaatst.
import crypto from 'node:crypto';
import { db, rpc } from './_db.js';
import { bedrijf } from './_bedrijf.js';
import { PRODUCTEN, ALLE_POSTERS, BEELDEN, VASTE_BEELDEN, VARIANTEN, prijsVan } from './_catalogus.js';
import { visuals, visualUrl } from './_media.js';
import { uploadUrl, info, publiekeUrl } from './_opslag.js';
import * as buffer from './_buffer.js';

export const STANDAARD = { aan: false, proef: true, organisatie_id: null };
export const TZ = 'Europe/Amsterdam';
const nu = () => new Date().toISOString();
const tekst = (v, m) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, m);
const BEWERKBAAR = ['concept', 'fout', 'geannuleerd'];

// ---- tijd: invoer en weergave in Europe/Amsterdam, opslag in UTC ----
function offsetMin(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs) / 60000;
}
/** '2026-11-03T10:00' (Amsterdamse tijd) -> ISO in UTC. */
export function amsterdamNaarUtc(lokaal) {
  const m = String(lokaal || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const alsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = alsUtc - offsetMin(alsUtc) * 60000;
  t = alsUtc - offsetMin(t) * 60000;   // rond de omschakeling naar zomer-/wintertijd
  return new Date(t).toISOString();
}
/** ISO (UTC) -> '2026-11-03T10:00' in Amsterdamse tijd. */
export function utcNaarAmsterdam(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return new Date(t + offsetMin(t) * 60000).toISOString().slice(0, 16);
}

// ---- instellingen ----
export async function instellingen() {
  const r = (await db('kanaal_instellingen?kanaal=eq.buffer&select=waarden'))?.[0];
  return { ...STANDAARD, ...(r?.waarden || {}) };
}
export async function zetInstellingen(w) {
  const huidig = await instellingen();
  const uit = { ...huidig };
  if ('aan' in w) uit.aan = w.aan === true;
  if ('proef' in w) uit.proef = w.proef !== false;
  if ('organisatie_id' in w) uit.organisatie_id = tekst(w.organisatie_id, 60) || null;
  await db('kanaal_instellingen?on_conflict=kanaal', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { kanaal: 'buffer', waarden: uit } });
  return uit;
}

// ---- accounts ----
export async function syncAccounts() {
  if (!buffer.bufferIngesteld()) return { fout: 'Zet eerst BUFFER_API_KEY in Vercel.' };
  const s = await instellingen();
  const { organisaties } = await buffer.ping();
  const org = organisaties.find((o) => o.id === s.organisatie_id) || organisaties[0];
  if (!org) return { fout: 'Je Buffer-account heeft geen organisatie.' };
  if (org.id !== s.organisatie_id) await zetInstellingen({ organisatie_id: org.id });
  const lijst = await buffer.kanalen(org.id);
  const bestaand = await db('social_connections?aanbieder=eq.buffer&select=id,extern_id');
  for (const c of lijst) {
    const status = c.isDisconnected ? 'ontkoppeld' : c.isLocked ? 'vergrendeld' : c.isQueuePaused ? 'gepauzeerd' : 'actief';
    await db('social_connections?on_conflict=aanbieder,extern_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: {
      aanbieder: 'buffer', extern_id: c.id, organisatie_id: org.id, service: c.service, naam: c.displayName || c.name, avatar: c.avatar || null, status,
      extern_link: c.externalLink || null, laatste_sync_op: nu(),
      meta: { telefoon_mogelijk: !!c.hasActiveMemberDevice, tijdzone: c.timezone || null, borden: (c.metadata?.boards || []).map((b) => ({ id: b.serviceId, naam: b.name })) },
    } });
  }
  const weg = bestaand.filter((b) => !lijst.some((c) => c.id === b.extern_id));
  for (const w of weg) await db(`social_connections?id=eq.${w.id}`, { method: 'PATCH', body: { status: 'verdwenen', laatste_sync_op: nu() } });
  return { ok: true, melding: `${lijst.length} account${lijst.length === 1 ? '' : 's'} bijgewerkt (${org.naam})${weg.length ? `; ${weg.length} niet meer in Buffer` : ''}` };
}

// ---- campagnelinks ----
export function utmUrl(doel, { source, medium = 'social', campaign, content }) {
  const u = new URL(doel);
  const hash = u.hash; u.hash = '';
  u.searchParams.set('utm_source', source); u.searchParams.set('utm_medium', medium); u.searchParams.set('utm_campaign', campaign);
  if (content) u.searchParams.set('utm_content', content);
  return u.toString() + hash;
}
const slug = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export async function campagneLink({ doel_url, source, medium = 'social', campaign, content = null, product_id = null, post_id = null }) {
  const rij = { doel_url, utm_source: slug(source), utm_medium: slug(medium) || 'social', utm_campaign: slug(campaign), utm_content: content ? slug(content) : null, product_id, post_id };
  if (!rij.utm_source || !rij.utm_campaign) throw new Error('Campagnelink: bron en campagne zijn nodig.');
  let [r] = await db(`campaign_links?doel_url=eq.${encodeURIComponent(doel_url)}&utm_source=eq.${rij.utm_source}&utm_medium=eq.${rij.utm_medium}&utm_campaign=eq.${rij.utm_campaign}&utm_content=${rij.utm_content ? `eq.${rij.utm_content}` : 'is.null'}&select=*`);
  if (!r) [r] = await db('campaign_links', { method: 'POST', prefer: 'return=representation', body: rij });
  return { ...r, url: utmUrl(doel_url, { source: rij.utm_source, medium: rij.utm_medium, campaign: rij.utm_campaign, content: rij.utm_content }) };
}
const productUrl = (id) => `${bedrijf().site}/#${encodeURIComponent(id)}`;

// ---- berichten ----
async function laadPosts(filter = '', limiet = 100) {
  const posts = await db(`social_posts?select=*${filter}&order=aangemaakt_op.desc&limit=${limiet}`);
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id).join(',');
  const [t, a] = await Promise.all([db(`social_post_targets?post_id=in.(${ids})&select=*&order=id.asc`), db(`social_assets?post_id=in.(${ids})&select=*&order=volgorde.asc`)]);
  return posts.map((p) => ({ ...p, doelen: t.filter((x) => x.post_id === p.id).map((x) => ({ ...x, gepland_lokaal: utcNaarAmsterdam(x.gepland_op) })), media: a.filter((x) => x.post_id === p.id) }));
}

export async function overzicht() {
  const [s, verb, posts] = await Promise.all([instellingen(), db('social_connections?select=*&order=service.asc,naam.asc'), laadPosts()]);
  return { instellingen: s, ingesteld: buffer.bufferIngesteld(), accounts: verb, posts, diensten: buffer.DIENSTEN, tijdzone: TZ, producten: ALLE_POSTERS };
}

export async function kalender(van, tot) {
  const v = amsterdamNaarUtc(`${van}T00:00`), t = amsterdamNaarUtc(`${tot}T23:59`);
  if (!v || !t) return { fout: 'Ongeldige periode.' };
  const doelen = await db(`social_post_targets?gepland_op=gte.${v}&gepland_op=lte.${t}&status=neq.geannuleerd&select=*&order=gepland_op.asc&limit=500`);
  const wachtrij = await db('social_post_targets?gepland_op=is.null&status=in.(klaar,versturen,onzeker,in_buffer)&select=*&limit=200');
  const ids = [...new Set([...doelen, ...wachtrij].map((d) => d.post_id))];
  const posts = ids.length ? await db(`social_posts?id=in.(${ids.join(',')})&select=id,titel,product_id`) : [];
  const verb = await db('social_connections?select=id,service,naam');
  const mk = (d) => ({ ...d, gepland_lokaal: utcNaarAmsterdam(d.gepland_op), post: posts.find((p) => p.id === d.post_id), account: verb.find((c) => c.id === d.connection_id) });
  return { ok: true, tijdzone: TZ, items: doelen.map(mk), wachtrij: wachtrij.map(mk) };
}

/** Bericht opslaan (nieuw of bestaand). Doelen die al in Buffer staan, zijn op slot. */
export async function bewaarPost(b, door = 'admin') {
  const titel = tekst(b.titel, 120) || 'Bericht';
  const product_id = b.product_id && ALLE_POSTERS[b.product_id] ? b.product_id : null;
  const velden = { titel, product_id, campagne: tekst(b.campagne, 60) || null, tekst: tekst(b.tekst, 5000), bijgewerkt_op: nu() };
  let id = Number(b.id) || null;
  if (id) {
    const r = await db(`social_posts?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: velden });
    if (!r?.length) return { fout: 'Bericht niet gevonden.' };
  } else id = (await db('social_posts', { method: 'POST', prefer: 'return=representation', body: { ...velden, door } }))[0].id;

  if (Array.isArray(b.media)) {
    const oud = await db(`social_assets?post_id=eq.${id}&select=id`);
    const houden = new Set();
    for (const [i, m] of b.media.slice(0, 10).entries()) {
      const url = String(m.url || '');
      if (!/^https:\/\/[^\s]+$/.test(url)) return { fout: `Media moet openbaar via https bereikbaar zijn (Buffer haalt het bestand zelf op): ${url.slice(0, 80)}` };
      const rij = { post_id: id, soort: m.soort === 'video' ? 'video' : 'afbeelding', url, bron: ['visual', 'poster', 'upload'].includes(m.bron) ? m.bron : 'visual', pad: m.pad || null,
        alt_tekst: tekst(m.alt_tekst, 300) || null, volgorde: i, thumbnail_offset_ms: Number.isFinite(Number(m.thumbnail_offset_ms)) && m.thumbnail_offset_ms !== '' && m.thumbnail_offset_ms != null ? Number(m.thumbnail_offset_ms) : null };
      if (m.id && oud.some((o) => o.id === Number(m.id))) { await db(`social_assets?id=eq.${Number(m.id)}`, { method: 'PATCH', body: rij }); houden.add(Number(m.id)); }
      else houden.add((await db('social_assets', { method: 'POST', prefer: 'return=representation', body: rij }))[0].id);
    }
    const weg = oud.filter((o) => !houden.has(o.id)).map((o) => o.id);
    if (weg.length) await db(`social_assets?id=in.(${weg.join(',')})`, { method: 'DELETE' });
  }

  if (Array.isArray(b.doelen)) {
    const verb = await db('social_connections?select=*');
    const bestaand = await db(`social_post_targets?post_id=eq.${id}&select=*`);
    const gewenst = new Set();
    for (const d of b.doelen) {
      const c = verb.find((x) => x.id === Number(d.connection_id));
      if (!c) continue;
      gewenst.add(c.id);
      const huidig = bestaand.find((x) => x.connection_id === c.id);
      if (huidig && !BEWERKBAAR.includes(huidig.status)) continue;   // staat al in Buffer: eerst annuleren
      const gepland = d.gepland_lokaal ? amsterdamNaarUtc(d.gepland_lokaal) : null;
      if (d.gepland_lokaal && !gepland) return { fout: `Ongeldig tijdstip voor ${c.naam}.` };
      const md = d.metadata && typeof d.metadata === 'object' ? d.metadata : {};
      const rij = { post_id: id, connection_id: c.id, tekst: d.tekst == null || d.tekst === '' ? null : tekst(d.tekst, 5000), publicatie: d.publicatie === 'telefoon' ? 'telefoon' : 'automatisch',
        post_type: ['post', 'reel', 'story', 'short'].includes(d.post_type) ? d.post_type : 'post', gepland_op: gepland,
        metadata: { eerste_reactie: tekst(md.eerste_reactie, 2200) || undefined, titel: tekst(md.titel, 100) || undefined, bord: tekst(md.bord, 60) || undefined, ai_gegenereerd: md.ai_gegenereerd === true || undefined, link_toevoegen: md.link_toevoegen !== false },
        bijgewerkt_op: nu(), ...(huidig && huidig.status !== 'concept' ? { status: 'concept', melding: null } : {}) };
      if (huidig) await db(`social_post_targets?id=eq.${huidig.id}`, { method: 'PATCH', body: rij });
      else await db('social_post_targets', { method: 'POST', body: rij });
    }
    const weg = bestaand.filter((x) => !gewenst.has(x.connection_id) && BEWERKBAAR.includes(x.status) && !x.extern_id).map((x) => x.id);
    if (weg.length) await db(`social_post_targets?id=in.(${weg.join(',')})`, { method: 'DELETE' });
  }
  await werkPostStatusBij(id);
  return { ok: true, id, melding: 'Bericht opgeslagen' };
}

/** "Maak socialmediabericht" vanuit een product: concept met tekst, beelden en alle bruikbare accounts. */
export async function vanProduct(productId, door = 'admin') {
  const p = PRODUCTEN[productId];
  if (!p) return { fout: 'Onbekende poster.' };
  const vis = (await visuals().catch(() => ({})))[productId] || [];
  const hoofd = BEELDEN[productId] ? visualUrl(BEELDEN[productId].groot) : VASTE_BEELDEN.has(productId) ? `${bedrijf().site}/posters/${productId}.jpg` : null;
  const media = [hoofd && { url: hoofd, soort: 'afbeelding', bron: 'poster', alt_tekst: `Poster ${p.titel}` },
    ...vis.filter((v) => v.soort !== 'video').slice(0, 5).map((v) => ({ url: v.url, soort: 'afbeelding', bron: 'visual', alt_tekst: v.alt || `${p.titel}` })),
    ...vis.filter((v) => v.soort === 'video').slice(0, 1).map((v) => ({ url: v.url, soort: 'video', bron: 'visual' }))].filter(Boolean);
  const vanaf = Object.values(VARIANTEN).filter((v) => v.product_id === productId && v.bestelbaar).map((v) => v.prijs);
  const tekstBasis = [p.titel, p.beschrijving ? String(p.beschrijving).split(/\n+/)[0].slice(0, 280) : '', vanaf.length ? `Vanaf € ${Math.min(...vanaf).toFixed(2).replace('.', ',')}.` : '', '{link}'].filter(Boolean).join('\n\n');
  const verb = await db('social_connections?status=eq.actief&gebruiken=eq.true&select=*');
  const doelen = verb.filter((c) => buffer.DIENSTEN[c.service]).map((c) => ({ connection_id: c.id, publicatie: c.service === 'tiktok' && !media.some((m) => m.soort === 'video') ? 'telefoon' : 'automatisch', post_type: 'post', metadata: { link_toevoegen: true } }));
  return bewaarPost({ titel: `${p.titel} (${p.code || productId})`, product_id: productId, campagne: `poster-${slug(p.code || productId)}`, tekst: tekstBasis, media, doelen }, door);
}

/** Uiteindelijke tekst per doel: variant of basistekst, met {link} vervangen door de campagnelink. */
async function tekstVoor(post, doel, account, opslaan = true) {
  let t = doel.tekst ?? post.tekst ?? '';
  let link = null;
  if (post.product_id && doel.metadata?.link_toevoegen !== false) {
    const l = opslaan
      ? await campagneLink({ doel_url: productUrl(post.product_id), source: account.service, campaign: post.campagne || `post-${post.id}`, content: `post-${post.id}`, product_id: post.product_id, post_id: post.id })
      : { url: utmUrl(productUrl(post.product_id), { source: account.service, campaign: slug(post.campagne || `post-${post.id}`), content: `post-${post.id}` }) };
    link = l;
  }
  if (t.includes('{link}')) t = t.replaceAll('{link}', link ? (account.service === 'instagram' || account.service === 'tiktok' ? 'Link in bio' : link.url) : '').trim();
  return { tekst: t, link };
}

/** Voorbeeld per account: definitieve tekst, lengte en wat er nog ontbreekt (zonder iets te versturen). */
export async function voorbeeld(postId) {
  const [post] = await laadPosts(`&id=eq.${Number(postId)}`, 1);
  if (!post) return { fout: 'Bericht niet gevonden.' };
  const verb = await db('social_connections?select=*');
  const per = [];
  for (const d of post.doelen) {
    const c = verb.find((x) => x.id === d.connection_id);
    const { tekst: t, link } = await tekstVoor(post, d, c, false);
    let ontbreekt = [];
    const slot = !BEWERKBAAR.includes(d.status);
    if (!slot) try { buffer.postInput({ service: c.service, kanaalId: c.extern_id, tekst: t, publicatie: d.publicatie, postType: d.post_type, dueAt: d.gepland_op, assets: post.media, metadata: { ...d.metadata, link: link?.url } }); }
    catch (e) { ontbreekt = String(e.message).split('; '); }
    if (!slot && c.status !== 'actief') ontbreekt.push(`account is ${c.status} in Buffer`);
    if (!slot && d.publicatie === 'telefoon' && c.meta?.telefoon_mogelijk === false) ontbreekt.push('geen telefoon met de Buffer-app gekoppeld voor herinneringen');
    if (!slot && d.gepland_op && Date.parse(d.gepland_op) < Date.now()) ontbreekt.push('het tijdstip ligt in het verleden');
    per.push({ doel_id: d.id, account: { id: c.id, naam: c.naam, service: c.service, avatar: c.avatar }, tekst: t, lengte: t.length, limiet: buffer.DIENSTEN[c.service]?.limiet || null,
      link: link?.url || null, publicatie: d.publicatie, gepland_lokaal: d.gepland_lokaal, ontbreekt, status: d.status, slot });
  }
  return { ok: true, post: { id: post.id, titel: post.titel, media: post.media }, per };
}

// ---- verzenden ----
/** Inplannen: per doel een taak met een unieke sleutel; daarna meteen verwerken. */
export async function inplannen(postId, door = 'admin') {
  if (!buffer.bufferIngesteld()) return { fout: 'Zet eerst BUFFER_API_KEY in Vercel.' };
  const s = await instellingen();
  if (!s.aan) return { fout: 'Social staat uit (Social → instellingen). Er wordt niets naar Buffer gestuurd.' };
  const v = await voorbeeld(postId);
  if (v.fout) return v;
  const [post] = await laadPosts(`&id=eq.${Number(postId)}`, 1);
  const klaar = [], overgeslagen = [];
  for (const d of post.doelen) {
    const pv = v.per.find((x) => x.doel_id === d.id);
    if (!BEWERKBAAR.includes(d.status) || d.extern_id) { overgeslagen.push(`${pv.account.naam}: staat al ${d.status === 'in_buffer' ? 'in Buffer' : d.status}`); continue; }
    if (pv.ontbreekt.length) { await db(`social_post_targets?id=eq.${d.id}`, { method: 'PATCH', body: { status: 'fout', melding: pv.ontbreekt.join('; '), bijgewerkt_op: nu() } }); overgeslagen.push(`${pv.account.naam}: ${pv.ontbreekt.join('; ')}`); continue; }
    const r = await db(`social_post_targets?id=eq.${d.id}&status=in.(${BEWERKBAAR.join(',')})&extern_id=is.null`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'klaar', melding: null, bijgewerkt_op: nu() } });
    if (!r?.length) continue;
    const n = (await db(`publishing_jobs?target_id=eq.${d.id}&soort=eq.buffer_post&select=id`)).length + 1;
    try { await db('publishing_jobs', { method: 'POST', body: { sleutel: `buffer-post:${d.id}:${n}`, soort: 'buffer_post', target_id: d.id } }); klaar.push(pv.account.naam); }
    catch (e) { if (!/23505|duplicate/.test(e.message)) throw e; }   // dubbel klikken: de eerste taak geldt
  }
  await werkPostStatusBij(post.id);
  const res = klaar.length ? await verwerk({ postId: post.id }) : null;
  return { ok: true, ingepland: klaar, overgeslagen, resultaat: res, melding: klaar.length ? `Naar Buffer: ${klaar.join(', ')}` : 'Niets ingepland' };
}

async function zetDoel(id, velden) { await db(`social_post_targets?id=eq.${id}`, { method: 'PATCH', body: { ...velden, bijgewerkt_op: nu() } }); }
async function zetJob(id, velden) { await db(`publishing_jobs?id=eq.${id}`, { method: 'PATCH', body: { ...velden, bijgewerkt_op: nu() } }); }

/** Wachtende taken verwerken (ook vanuit de cron) en onzekere eerst in Buffer opzoeken. */
export async function verwerk({ postId } = {}) {
  const uit = { verstuurd: 0, fout: 0, later: 0, onzeker: 0, gevonden: 0, proef: 0 };
  if (!buffer.bufferIngesteld()) return { ...uit, uit: true };
  const s = await instellingen();
  await zoekOnzeker(s, uit);
  let filter = `status=in.(wacht,bezig)&volgende_poging_op=lte.${nu()}&soort=eq.buffer_post`;
  if (postId) { const ids = (await db(`social_post_targets?post_id=eq.${postId}&select=id`)).map((x) => x.id); if (!ids.length) return uit; filter += `&target_id=in.(${ids.join(',')})`; }
  const jobs = await db(`publishing_jobs?${filter}&select=*&order=volgende_poging_op.asc&limit=20`);
  for (const j of jobs) {
    const [claim] = await rpc('skiffa_claim_job', { p_id: j.id });
    if (!claim) continue;
    await verstuurJob(claim, s, uit);
  }
  return uit;
}

async function verstuurJob(job, s, uit) {
  const [d] = await db(`social_post_targets?id=eq.${job.target_id}&select=*`);
  if (!d || d.extern_id || !['klaar', 'onzeker', 'versturen'].includes(d.status)) { await zetJob(job.id, { status: d?.status === 'geannuleerd' ? 'geannuleerd' : 'klaar', resultaat: { overgeslagen: d?.status || 'weg' } }); return; }
  if (!s.aan) { await zetJob(job.id, { status: 'wacht', volgende_poging_op: new Date(Date.now() + 15 * 60000).toISOString(), laatste_fout: 'social staat uit' }); uit.later++; return; }
  const [post] = await laadPosts(`&id=eq.${d.post_id}`, 1);
  const [c] = await db(`social_connections?id=eq.${d.connection_id}&select=*`);
  const { tekst: t, link } = await tekstVoor(post, d, c, true);
  let input;
  try { input = buffer.postInput({ service: c.service, kanaalId: c.extern_id, tekst: t, publicatie: d.publicatie, postType: d.post_type, dueAt: d.gepland_op, assets: post.media, metadata: { ...d.metadata, link: link?.url } }); }
  catch (e) { await zetDoel(d.id, { status: 'fout', melding: e.message }); await zetJob(job.id, { status: 'fout', laatste_fout: e.message }); uit.fout++; return werkPostStatusBij(d.post_id); }
  if (link) await zetDoel(d.id, { campaign_link_id: link.id });
  if (s.proef) {
    await zetDoel(d.id, { status: 'concept', melding: `Proefmodus: er is niets naar Buffer gestuurd. Zou plaatsen op ${c.naam}${d.gepland_op ? ` om ${utcNaarAmsterdam(d.gepland_op).replace('T', ' ')}` : ' (eerstvolgende plek in de wachtrij)'}.` });
    await zetJob(job.id, { status: 'klaar', resultaat: { proef: true, input: { ...input, text: input.text.slice(0, 200) } } });
    uit.proef++; return werkPostStatusBij(d.post_id);
  }
  await zetDoel(d.id, { status: 'versturen' });
  try {
    const p = await buffer.maakPost(input);
    const st = buffer.vertaalStatus(p);
    await zetDoel(d.id, { extern_id: p.id, extern_status: p.status, ...st, status: st.status === 'geannuleerd' ? 'in_buffer' : st.status });
    await zetJob(job.id, { status: 'klaar', resultaat: { buffer_id: p.id }, laatste_fout: null });
    uit.verstuurd++;
  } catch (e) {
    const soort = e instanceof buffer.BufferFout ? e.soort : 'onbekend';
    if (soort === 'definitief') { await zetDoel(d.id, { status: 'fout', melding: e.message }); await zetJob(job.id, { status: 'fout', laatste_fout: e.message }); uit.fout++; }
    else if (soort === 'tijdelijk' && job.pogingen < 6) { await zetDoel(d.id, { status: 'klaar', melding: `${e.message}; volgt automatisch` }); await zetJob(job.id, { status: 'wacht', laatste_fout: e.message, volgende_poging_op: new Date(Date.now() + job.pogingen * 5 * 60000).toISOString() }); uit.later++; }
    else if (soort === 'tijdelijk') { await zetDoel(d.id, { status: 'fout', melding: `${e.message} (na ${job.pogingen} pogingen gestopt)` }); await zetJob(job.id, { status: 'fout', laatste_fout: e.message }); uit.fout++; }
    else { await zetDoel(d.id, { status: 'onzeker', melding: `${e.message}. Wordt in Buffer opgezocht voordat het opnieuw wordt verstuurd.` }); await zetJob(job.id, { status: 'onzeker', laatste_fout: e.message, volgende_poging_op: new Date(Date.now() + 2 * 60000).toISOString() }); uit.onzeker++; }
  }
  return werkPostStatusBij(d.post_id);
}

/** Onduidelijk antwoord? Eerst in Buffer zoeken of het bericht er al staat; pas als het er niet is, opnieuw. */
async function zoekOnzeker(s, uit) {
  const jobs = await db(`publishing_jobs?status=eq.onzeker&volgende_poging_op=lte.${nu()}&select=*&limit=10`);
  for (const j of jobs) {
    const [d] = await db(`social_post_targets?id=eq.${j.target_id}&select=*`);
    if (!d || d.status === 'geannuleerd') { await zetJob(j.id, { status: 'geannuleerd' }); continue; }
    const [c] = await db(`social_connections?id=eq.${d.connection_id}&select=*`);
    const [post] = await laadPosts(`&id=eq.${d.post_id}`, 1);
    const { tekst: t } = await tekstVoor(post, d, c, true);
    let gevonden;
    try {
      const sinds = new Date(Date.parse(j.aangemaakt_op) - 60000).toISOString();
      const bekend = new Set((await db('social_post_targets?extern_id=not.is.null&select=extern_id')).map((x) => x.extern_id));
      gevonden = (await buffer.zoekPosts(c.organisatie_id || s.organisatie_id, c.extern_id, sinds)).find((p) => (p.text || '').trim() === t.trim() && !bekend.has(p.id)
        && (!d.gepland_op || !p.dueAt || Math.abs(Date.parse(p.dueAt) - Date.parse(d.gepland_op)) < 120000));
    } catch (e) { await zetJob(j.id, { laatste_fout: `zoeken in Buffer mislukt: ${e.message}`, volgende_poging_op: new Date(Date.now() + 5 * 60000).toISOString() }); continue; }
    if (gevonden) {
      const st = buffer.vertaalStatus(gevonden);
      await zetDoel(d.id, { extern_id: gevonden.id, extern_status: gevonden.status, ...st, melding: 'Teruggevonden in Buffer na een onduidelijk antwoord (niet opnieuw verstuurd).' });
      await zetJob(j.id, { status: 'klaar', resultaat: { buffer_id: gevonden.id, teruggevonden: true } });
      uit.gevonden++;
    } else {
      await zetDoel(d.id, { status: 'klaar', melding: 'Niet gevonden in Buffer; wordt opnieuw verstuurd.' });
      await zetJob(j.id, { status: 'wacht', volgende_poging_op: nu() });
    }
    await werkPostStatusBij(d.post_id);
  }
}

/** Status van berichten in Buffer ophalen (gepland, geplaatst, herinnering, fout). */
export async function statussen() {
  if (!buffer.bufferIngesteld()) return { bijgewerkt: 0, uit: true };
  const doelen = await db('social_post_targets?status=in.(in_buffer,herinnering)&extern_id=not.is.null&select=*&order=bijgewerkt_op.asc&limit=40');
  let bijgewerkt = 0;
  for (const d of doelen) {
    let p;
    try { p = await buffer.haalPost(d.extern_id); } catch { continue; }
    const st = buffer.vertaalStatus(p);
    if (d.handmatig_bevestigd && st.status === 'herinnering') continue;
    const velden = { extern_status: p?.status || null, status: st.status, melding: st.melding ?? null };
    if (st.gepubliceerd_op) velden.gepubliceerd_op = st.gepubliceerd_op;
    if (st.herinnerd_op) velden.herinnerd_op = st.herinnerd_op;
    if (st.extern_link) velden.extern_link = st.extern_link;
    if (velden.status !== d.status || velden.extern_status !== d.extern_status || (velden.extern_link && velden.extern_link !== d.extern_link)) { await zetDoel(d.id, velden); bijgewerkt++; await werkPostStatusBij(d.post_id); }
    else await zetDoel(d.id, {});
  }
  return { bijgewerkt };
}

export async function annuleer(doelId) {
  const [d] = await db(`social_post_targets?id=eq.${Number(doelId)}&select=*`);
  if (!d) return { fout: 'Niet gevonden.' };
  if (['gepubliceerd', 'herinnering'].includes(d.status)) return { fout: d.status === 'herinnering' ? 'De herinnering is al verstuurd; verwijder het bericht zo nodig in de Buffer-app.' : 'Al geplaatst; verwijder het op het netwerk zelf.' };
  if (d.status === 'versturen' || d.status === 'onzeker') return { fout: 'Wordt nu verstuurd of gecontroleerd; probeer het over een paar minuten opnieuw.' };
  if (d.extern_id) {
    try { await buffer.verwijderPost(d.extern_id); }
    catch (e) { return { fout: `Buffer: ${e.message}` }; }
  }
  await db(`publishing_jobs?target_id=eq.${d.id}&status=in.(wacht,onzeker)`, { method: 'PATCH', body: { status: 'geannuleerd', bijgewerkt_op: nu() } });
  await zetDoel(d.id, { status: 'geannuleerd', extern_id: null, extern_status: null, melding: d.extern_id ? 'Uit Buffer verwijderd.' : 'Niet verstuurd.' });
  await werkPostStatusBij(d.post_id);
  return { ok: true, melding: 'Geannuleerd' };
}

/** Na een herinnering: jij bevestigt dat je het op je telefoon hebt geplaatst. */
export async function bevestigGeplaatst(doelId, link) {
  const [d] = await db(`social_post_targets?id=eq.${Number(doelId)}&select=*`);
  if (!d) return { fout: 'Niet gevonden.' };
  if (d.status !== 'herinnering') return { fout: 'Alleen een verstuurde herinnering kun je als geplaatst bevestigen.' };
  const l = String(link || '').trim();
  if (l && !/^https:\/\/[^\s]+$/.test(l)) return { fout: 'Link moet met https:// beginnen.' };
  await zetDoel(d.id, { status: 'gepubliceerd', handmatig_bevestigd: true, gepubliceerd_op: nu(), extern_link: l || d.extern_link, melding: 'Door jou bevestigd als geplaatst.' });
  await werkPostStatusBij(d.post_id);
  return { ok: true, melding: 'Bevestigd als geplaatst' };
}

export async function werkPostStatusBij(postId) {
  const t = (await db(`social_post_targets?post_id=eq.${postId}&select=status`)).map((x) => x.status);
  const levend = t.filter((x) => x !== 'geannuleerd');
  const status = !t.length ? 'concept' : !levend.length ? 'geannuleerd'
    : levend.every((x) => x === 'gepubliceerd') ? 'gepubliceerd'
      : levend.some((x) => x === 'fout') ? 'fout'
        : levend.some((x) => x === 'gepubliceerd') ? 'deels'
          : levend.some((x) => ['klaar', 'versturen', 'onzeker', 'in_buffer', 'herinnering'].includes(x)) ? 'gepland' : 'concept';
  await db(`social_posts?id=eq.${postId}`, { method: 'PATCH', body: { status, bijgewerkt_op: nu() } });
  return status;
}

// ---- eigen media (afbeelding of video) in de openbare bucket ----
const MEDIA = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' };
export async function mediaUpload({ bestandsnaam, bytes }) {
  const ext = String(bestandsnaam || '').toLowerCase().split('.').pop();
  if (!MEDIA[ext]) return { fout: 'Afbeelding (jpg, png, webp) of video (mp4, mov).' };
  if (!(Number(bytes) > 0) || Number(bytes) > 500e6) return { fout: 'Maximaal 500 MB.' };
  const pad = `social/${crypto.randomUUID()}.${ext}`;
  return { ok: true, pad, mime: MEDIA[ext], soort: MEDIA[ext].startsWith('video') ? 'video' : 'afbeelding', url: await uploadUrl('visuals', pad) };
}
export async function mediaBevestig({ pad }) {
  if (!/^social\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|mov)$/.test(String(pad || ''))) return { fout: 'Onbekend bestand.' };
  if (!(await info('visuals', pad))) return { fout: 'Het bestand is niet aangekomen.' };
  return { ok: true, url: publiekeUrl('visuals', pad), soort: /\.(mp4|mov)$/.test(pad) ? 'video' : 'afbeelding' };
}

/** Voor de actielijst op het dashboard. */
export async function actiepunten() {
  const uit = [];
  const doelen = await db('social_post_targets?status=in.(fout,onzeker,herinnering)&select=id,post_id,status,melding,herinnerd_op,bijgewerkt_op').catch(() => []);
  for (const d of doelen) {
    if (d.status === 'herinnering' && Date.now() - Date.parse(d.herinnerd_op || d.bijgewerkt_op) < 3600000) continue;
    uit.push({ sleutel: `social:${d.id}:${d.status}`, ernst: d.status === 'fout' ? 'middel' : 'info', soort: 'social',
      titel: d.status === 'fout' ? 'Socialmediabericht mislukt' : d.status === 'onzeker' ? 'Socialmediabericht wordt in Buffer gecontroleerd' : 'Herinnering: rond het bericht af op je telefoon',
      tekst: d.melding || '', acties: ['social', ...(d.status === 'herinnering' ? ['afvinken'] : [])], post_id: d.post_id });
  }
  const weg = await db('social_connections?status=in.(ontkoppeld,vergrendeld,gepauzeerd)&gebruiken=eq.true&select=id,naam,service,status').catch(() => []);
  for (const c of weg) uit.push({ sleutel: `socialacc:${c.id}:${c.status}`, ernst: 'middel', soort: 'social', titel: `${c.naam} (${c.service}) is ${c.status} in Buffer`, tekst: 'Geplande berichten op dit account worden niet geplaatst. Herstel de koppeling in Buffer.', acties: ['social', 'afvinken'] });
  return uit;
}
