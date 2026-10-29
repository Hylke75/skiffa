// Etsy Open API v3. Zelfde opzet als Luna Azul (etsy-sync):
//   koppelen      OAuth 2.0 + PKCE vanuit Beheer → Kanalen (refresh token 90 dagen, server-side)
//   publiceren    per product één advertentie (formaat en papier als keuze) vanuit de centrale catalogus:
//                 nieuw aanmaken of bijwerken, foto's, varianten en prijzen volgens de prijsregel, offline halen
//   orders        betaalde receipts importeren (venster op 'updated'), annuleringen verwerken
//   verzendingen  track-and-trace doorgeven (createReceiptShipment); Etsy mailt de koper zelf
// Secrets (Vercel): ETSY_KEYSTRING, ETSY_SHARED_SECRET (etsy.com/developers → Your apps).
import crypto from 'node:crypto';
import { ALLE_POSTERS } from '../_catalogus.js';
import { context as publicatieContext, inhoudEtsy, statusVan, VASTGELOPEN_MS } from '../_publicatie.js';
import { db } from '../_db.js';
import { MAX_VERZENDPOGINGEN, foutTekst, vervoerderCode } from './gemeen.js';
import { bekendeOrders, regel, importeer, teMelden, gemeld, meldenMislukt, annuleerVanKanaal, zetInstellingen } from './opslag.js';

const API = 'https://api.etsy.com/v3/application';
const CONNECT = 'https://www.etsy.com/oauth/connect';
const TOKEN = 'https://api.etsy.com/v3/public/oauth/token';
const SCOPES = ['listings_r', 'listings_w', 'shops_r', 'transactions_r', 'transactions_w'];
const PROPERTY = 513; // eigen variatie-eigenschap ("custom variation")
export const etsyIngesteld = () => !!(process.env.ETSY_KEYSTRING && process.env.ETSY_SHARED_SECRET);
const apiKey = () => `${process.env.ETSY_KEYSTRING}:${process.env.ETSY_SHARED_SECRET}`;
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function tokenVraag(params) {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-key': apiKey() },
    body: new URLSearchParams({ client_id: process.env.ETSY_KEYSTRING, ...params }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Etsy-token mislukt (${r.status}): ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const tokenRij = (t) => ({
  access_token: t.access_token, refresh_token: t.refresh_token,
  access_verloopt_op: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  bijgewerkt_op: new Date().toISOString(),
});

// ---- OAuth (vanuit de administratie) ----
export async function startKoppelen(redirectUri) {
  await db(`etsy_oauth_states?aangemaakt_op=lt.${new Date(Date.now() - 3600e3).toISOString()}`, { method: 'DELETE' });
  const state = b64url(crypto.randomBytes(24)), verifier = b64url(crypto.randomBytes(48));
  await db('etsy_oauth_states', { method: 'POST', body: { state, code_verifier: verifier, redirect_uri: redirectUri } });
  const q = new URLSearchParams({
    response_type: 'code', client_id: process.env.ETSY_KEYSTRING, redirect_uri: redirectUri, scope: SCOPES.join(' '),
    state, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  });
  return `${CONNECT}?${q}`;
}

export async function rondKoppelenAf(code, state) {
  const rij = (await db(`etsy_oauth_states?state=eq.${encodeURIComponent(state)}`))?.[0];
  await db(`etsy_oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' });
  if (!rij) throw new Error('Onbekende of al gebruikte koppelpoging; probeer opnieuw');
  if (Date.now() - Date.parse(rij.aangemaakt_op) > 15 * 60e3) throw new Error('Koppelpoging verlopen; probeer opnieuw');
  const t = await tokenVraag({ grant_type: 'authorization_code', redirect_uri: rij.redirect_uri, code, code_verifier: rij.code_verifier });
  const get = async (pad) => {
    const r = await fetch(`${API}${pad}`, { headers: { 'x-api-key': apiKey(), authorization: `Bearer ${t.access_token}`, accept: 'application/json' } });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`Etsy ${pad} (${r.status}): ${foutTekst(d)}`);
    return d;
  };
  const ik = await get('/users/me');
  if (!ik?.shop_id) throw new Error('Dit Etsy-account heeft geen winkel');
  const shop = await get(`/shops/${ik.shop_id}`);
  await db('etsy_koppeling?on_conflict=id', {
    method: 'POST', prefer: 'resolution=merge-duplicates',
    body: { id: 1, shop_id: ik.shop_id, shop_naam: shop?.shop_name ?? null, valuta: shop?.currency_code ?? null, gekoppeld_op: new Date().toISOString(), ...tokenRij(t) },
  });
  return { shop_id: ik.shop_id, shop_naam: shop?.shop_name ?? null, valuta: shop?.currency_code ?? null };
}

export async function koppeling() {
  const k = (await db('etsy_koppeling?id=eq.1&select=shop_id,shop_naam,valuta,gekoppeld_op'))?.[0];
  return k || null;
}

// ---- API-client ----
export class EtsyClient {
  constructor(proef) { this.proef = proef; this.k = null; this.schrijf = []; }
  async laad() { this.k = (await db('etsy_koppeling?id=eq.1'))?.[0] || null; return this.k; }
  get shop() { if (!this.k?.shop_id) throw new Error('Etsy is niet gekoppeld: klik in Beheer → Kanalen op "koppel Etsy"'); return this.k.shop_id; }
  async token(forceer = false) {
    if (!this.k) await this.laad();
    if (!this.k) throw new Error('Etsy is niet gekoppeld: klik in Beheer → Kanalen op "koppel Etsy"');
    if (!forceer && Date.parse(this.k.access_verloopt_op) - Date.now() > 120e3) return this.k.access_token;
    const rij = tokenRij(await tokenVraag({ grant_type: 'refresh_token', refresh_token: this.k.refresh_token }));
    await db('etsy_koppeling?id=eq.1', { method: 'PATCH', body: rij });
    this.k = { ...this.k, ...rij };
    return this.k.access_token;
  }
  async call(method, pad, { query, json, form, multipart } = {}) {
    if (method !== 'GET' && this.proef) { this.schrijf.push(`${method} ${pad}`); return { status: 299, data: { proef: true } }; }
    const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
    let ververst = false;
    for (let poging = 0; poging < 3; poging++) {
      const headers = { 'x-api-key': apiKey(), authorization: `Bearer ${await this.token()}`, accept: 'application/json' };
      let body;
      if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
      else if (form !== undefined) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
      else if (multipart) body = multipart;
      const r = await fetch(`${API}${pad}${qs.toString() ? `?${qs}` : ''}`, { method, headers, body });
      if (r.status === 401 && !ververst) { ververst = true; await this.token(true); continue; }
      if (r.status === 429 && poging < 2) { await new Promise((ok) => setTimeout(ok, 1500 * (poging + 1))); continue; }
      const t = await r.text(); let data = null;
      try { data = t ? JSON.parse(t) : null; } catch { data = t; }
      return { status: r.status, data };
    }
    throw new Error(`Etsy rate limit bleef staan voor ${pad}`);
  }
}
const ok = (s) => s >= 200 && s < 300;

// ---- Publiceren vanuit de centrale catalogus (pagina Verkoopkanalen; zie api/_publicatie.js) ----
const PAPIER_PROPERTY = 514; // tweede eigen variatie-eigenschap: papiersoort (alleen als er meer dan één is)

/** Voorraad en prijzen per variant voor updateListingInventory: formaat (en papier) als keuze. */
export function inventaris(payload, verwerkingsprofiel) {
  const props = payload.twee_eigenschappen ? [PROPERTY, PAPIER_PROPERTY] : [PROPERTY];
  const products = payload.varianten.map((v) => ({
    sku: v.sku,
    property_values: [
      { property_id: PROPERTY, property_name: 'Size', value_ids: [], values: [v.formaat.replace(/ /g, '')] },
      ...(payload.twee_eigenschappen ? [{ property_id: PAPIER_PROPERTY, property_name: 'Paper', value_ids: [], values: [v.papier] }] : []),
    ],
    offerings: [{ price: v.prijs, quantity: payload.voorraad, is_enabled: true, readiness_state_id: Number(verwerkingsprofiel) }],
  }));
  return { products, price_on_property: props, quantity_on_property: props, sku_on_property: props, readiness_state_on_property: [] };
}

/** Na een onderbreking tijdens het aanmaken: bestaat de advertentie al (herkenbaar aan de tag skf-<code>)? */
async function zoekOpTag(etsy, tag) {
  for (const state of ['draft', 'active', 'inactive']) {
    const r = await etsy.call('GET', `/shops/${etsy.shop}/listings`, { query: { state, limit: 100 } });
    const hit = (r.data?.results || []).find((l) => (l.tags || []).map((t) => String(t).toLowerCase()).includes(tag));
    if (hit) return String(hit.listing_id);
  }
  return null;
}

async function vervangFotos(etsy, id, fotos) {
  const huidig = await etsy.call('GET', `/listings/${id}/images`);
  for (const img of huidig.data?.results || []) await etsy.call('DELETE', `/shops/${etsy.shop}/listings/${id}/images/${img.listing_image_id}`);
  for (const [i, url] of fotos.entries()) {
    const img = await fetch(url);
    if (!img.ok) throw new Error(`Foto ${i + 1} ophalen mislukt (${img.status})`);
    const form = new FormData();
    form.append('image', new Blob([Buffer.from(await img.arrayBuffer())], { type: 'image/jpeg' }), `foto-${i + 1}.jpg`);
    form.append('rank', String(i + 1));
    const up = await etsy.call('POST', `/shops/${etsy.shop}/listings/${id}/images`, { multipart: form });
    if (!ok(up.status)) throw new Error(`Foto ${i + 1} uploaden (${up.status}): ${foutTekst(up.data)}`);
  }
}

const pkPad = (productId) => `product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.etsy`;
const zetPk = (productId, velden) => db(pkPad(productId), { method: 'PATCH', body: { ...velden, bijgewerkt_op: new Date().toISOString() } });

/**
 * Eén product publiceren of bijwerken op Etsy. Claimt eerst de rij (status → verwerken), zodat twee runs
 * nooit tegelijk dezelfde advertentie aanmaken; een nieuwe advertentie krijgt meteen haar id opgeslagen.
 */
export async function publiceerProduct(etsy, ctx, productId) {
  const pk = ctx.pk.find((x) => x.product_id === productId && x.kanaal === 'etsy');
  if (!pk) return { overgeslagen: 'niet aangevinkt' };
  const inhoud = inhoudEtsy(ctx, productId, pk);
  const st = statusVan('etsy', pk, inhoud).status;
  if (st !== 'gereed') return { overgeslagen: st };
  if (etsy.proef) { etsy.schrijf.push(`${pk.extern_id ? `bijwerken ${pk.extern_id}` : 'nieuwe advertentie'}: "${inhoud.payload?.titel || productId}"`); return { proef: true }; }
  const grens = new Date(Date.now() - VASTGELOPEN_MS).toISOString();
  const claim = await db(`${pkPad(productId)}&or=(status.neq.verwerken,verwerken_sinds.lt.${encodeURIComponent(grens)})`, { method: 'PATCH', prefer: 'return=representation',
    body: { status: 'verwerken', verwerken_sinds: new Date().toISOString(), poging_hash: inhoud.hash, melding: pk.publiceren ? (pk.extern_id ? 'bijwerken…' : 'aanmaken…') : 'offline halen…' } });
  if (!claim?.length) return { overgeslagen: 'al in behandeling' };
  let id = pk.extern_id;
  try {
    if (!pk.publiceren) {
      const r = await etsy.call('PATCH', `/shops/${etsy.shop}/listings/${id}`, { form: { state: 'inactive' } });
      if (!ok(r.status)) throw new Error(`Offline halen (${r.status}): ${foutTekst(r.data)}`);
      await zetPk(productId, { status: 'niet_gepubliceerd', melding: null, laatste_sync_op: new Date().toISOString(), gepubliceerd_hash: null });
      return { offline: true };
    }
    const p = inhoud.payload, meta = { ...(pk.meta || {}) };
    const velden = {
      title: p.titel, description: p.beschrijving, taxonomy_id: p.categorie, tags: p.tags.join(','), materials: p.materialen.join(','),
      who_made: p.who_made, when_made: p.when_made, is_supply: 'false', type: 'physical', should_auto_renew: 'true',
      shipping_profile_id: p.verzendprofiel_id, readiness_state_id: p.verwerkingsprofiel_id, ...(p.retourbeleid_id ? { return_policy_id: p.retourbeleid_id } : {}),
    };
    let nieuw = false;
    if (!id && pk.aanmaken_gestart_op) {
      id = await zoekOpTag(etsy, `skf-${inhoud.code}`.toLowerCase());
      if (id) await zetPk(productId, { extern_id: id, aanmaken_gestart_op: null });   // eerder aangemaakt: overnemen, niet opnieuw aanmaken
    }
    if (!id) {
      await zetPk(productId, { aanmaken_gestart_op: new Date().toISOString() });
      const res = await etsy.call('POST', `/shops/${etsy.shop}/listings`, { form: { ...velden, quantity: String(p.voorraad), price: Math.min(...p.varianten.map((v) => v.prijs)).toFixed(2) } });
      if (!ok(res.status) || !res.data?.listing_id) throw new Error(`Aanmaken (${res.status}): ${foutTekst(res.data)}`);
      id = String(res.data.listing_id); nieuw = true;
      await zetPk(productId, { extern_id: id, extern_url: res.data.url || `https://www.etsy.com/listing/${id}`, aanmaken_gestart_op: null });
    } else {
      const res = await etsy.call('PATCH', `/shops/${etsy.shop}/listings/${id}`, { form: velden });
      if (!ok(res.status)) throw new Error(`Bijwerken (${res.status}): ${foutTekst(res.data)}`);
    }
    const fotoHash = crypto.createHash('sha256').update(p.fotos.join('|')).digest('hex').slice(0, 16);
    if (nieuw || meta.fotos !== fotoHash) { await vervangFotos(etsy, id, p.fotos); meta.fotos = fotoHash; await zetPk(productId, { meta }); }
    const ir = await etsy.call('PUT', `/listings/${id}/inventory`, { json: inventaris(p, p.verwerkingsprofiel_id) });
    if (!ok(ir.status)) throw new Error(`Varianten en prijzen (${ir.status}): ${foutTekst(ir.data)}`);
    const act = await etsy.call('PATCH', `/shops/${etsy.shop}/listings/${id}`, { form: { state: 'active' } });
    if (!ok(act.status)) throw new Error(`Activeren (${act.status}): ${foutTekst(act.data)}`);
    await zetPk(productId, { extern_id: id, status: 'actief', melding: null, gepubliceerd_hash: inhoud.hash, laatste_sync_op: new Date().toISOString(), extern_url: act.data?.url || pk.extern_url || `https://www.etsy.com/listing/${id}`, verwerken_sinds: null });
    return { ok: true, nieuw };
  } catch (e) {
    await zetPk(productId, { status: 'fout', melding: String(e.message || e).slice(0, 500), verwerken_sinds: null, ...(id ? { extern_id: id } : {}) });
    return { fout: String(e.message || e) };
  }
}

async function stapPubliceren(etsy, s, log, { productId, handmatig = false } = {}) {
  if (!handmatig && !s.auto_publiceren) { log.push({ stap: 'publiceren', ok: true, info: 'automatisch publiceren staat uit (gebruik "publiceer" op de pagina Verkoopkanalen)' }); return; }
  const ctx = await publicatieContext();
  const ids = productId ? [productId] : ctx.pk.filter((x) => x.kanaal === 'etsy' && (x.publiceren || x.extern_id)).map((x) => x.product_id);
  let nieuw = 0, bij = 0, offline = 0, mis = 0;
  for (const id of ids) {
    if (nieuw + bij + offline + mis >= 5) break;   // foto-uploads zijn zwaar; de volgende run gaat verder
    const r = await publiceerProduct(etsy, ctx, id);
    if (r.ok) r.nieuw ? nieuw++ : bij++;
    else if (r.offline) offline++;
    else if (r.fout) { mis++; log.push({ stap: 'publiceren', ok: false, info: `${ALLE_POSTERS[id] || id}: ${r.fout.slice(0, 200)}` }); }
  }
  log.push({ stap: 'publiceren', ok: mis === 0, info: `nieuw ${nieuw}, bijgewerkt ${bij}, offline gehaald ${offline}, mislukt ${mis}` });
}

const geld = (m) => (m ? Number(m.amount) / Number(m.divisor || 100) : 0);
export function mapReceipt(r, perListing) {
  if (!r.is_paid || ['canceled', 'fully refunded'].includes(String(r.status || '').toLowerCase())) return null;
  const regels = (r.transactions || []).filter((t) => t.quantity > 0).map((t) =>
    regel({ sku: t.sku, listing: null, titel: t.title, prijs: geld(t.price), aantal: t.quantity, extern_item_id: t.transaction_id }));
  if (!regels.length) return null;
  const valuta = r.grandtotal?.currency_code || 'EUR';
  return {
    kanaal: 'etsy', extern_id: String(r.receipt_id), naam: r.name || '', email: r.buyer_email || '',
    straat: [r.first_line, r.second_line].filter(Boolean).join(', '), postcode: String(r.zip || '').toUpperCase(), plaats: r.city || '',
    land: String(r.country_iso || 'NL').toUpperCase(), opmerking: r.message_from_buyer || '', verzending: geld(r.total_shipping_cost),
    meta: { valuta, totaal: geld(r.grandtotal), korting: geld(r.discount_amt), cadeau: r.is_gift ? r.gift_message || '' : null },
    regels,
  };
}

async function stapOrders(etsy, s, log) {
  const sinds = s.laatste_ordersync ? Date.parse(s.laatste_ordersync) - 15 * 60e3 : Date.now() - 14 * 864e5;
  const start = new Date().toISOString();
  const receipts = [];
  for (let page = 0; page < 3; page++) {
    const r = await etsy.call('GET', `/shops/${etsy.shop}/receipts`, { query: { min_last_modified: Math.floor(sinds / 1000), sort_on: 'updated', sort_order: 'asc', limit: 100, offset: page * 100 } });
    if (r.status !== 200) throw new Error(`Receipts ophalen (${r.status}): ${foutTekst(r.data)}`);
    receipts.push(...(r.data?.results || []));
    if ((r.data?.results || []).length < 100) break;
  }
  const bekend = await bekendeOrders('etsy', receipts.map((r) => String(r.receipt_id)));
  let nieuw = 0, geannuleerd = 0, mis = 0;
  for (const r of receipts) {
    const ons = bekend.get(String(r.receipt_id));
    if (ons) {
      if (['canceled', 'fully refunded'].includes(String(r.status || '').toLowerCase()) && await annuleerVanKanaal(ons, r.status === 'canceled' ? 'geannuleerd op Etsy' : 'volledig terugbetaald op Etsy')) geannuleerd++;
      continue;
    }
    const p = mapReceipt(r);
    if (!p) continue;
    const notities = [];
    if (p.meta.valuta !== 'EUR') notities.push(`Etsy-bedragen in ${p.meta.valuta}, niet in EUR: controleer de totalen`);
    if (p.opmerking) notities.push(`Bericht van de koper: ${p.opmerking}`);
    if (p.meta.cadeau !== null) notities.push(`Cadeau${p.meta.cadeau ? `: ${p.meta.cadeau}` : ''}`);
    if (!p.straat) notities.push('Geen afleveradres ontvangen: bekijk de bestelling in Etsy (Shop Manager → Orders)');
    try { if ((await importeer(p, notities))?.nieuw) nieuw++; } catch (e) { mis++; log.push({ stap: 'orders', ok: false, info: `Import ${r.receipt_id}: ${e.message}` }); }
  }
  if (!mis && !etsy.proef) await zetInstellingen('etsy', { laatste_ordersync: start });
  log.push({ stap: 'orders', ok: mis === 0, info: `opgehaald ${receipts.length}, geïmporteerd ${nieuw}, geannuleerd ${geannuleerd}` });
}

async function stapVerzendingen(etsy, log) {
  let ok2 = 0;
  for (const b of await teMelden('etsy')) {
    if (Number(b.extern_meta?.verzend_pogingen || 0) >= MAX_VERZENDPOGINGEN) continue;
    const r = await etsy.call('POST', `/shops/${etsy.shop}/receipts/${encodeURIComponent(b.extern_id)}/tracking`, { json: { tracking_code: b.track_trace, carrier_name: vervoerderCode('etsy', b.vervoerder, b.land), send_bcc: false } });
    if (r.status === 299) continue;
    if (ok(r.status)) { ok2++; await gemeld(b); }
    else { log.push({ stap: 'verzendingen', ok: false, info: `${b.nummer}: ${foutTekst(r.data)}` }); await meldenMislukt(b, `(${r.status}) ${foutTekst(r.data)}`, MAX_VERZENDPOGINGEN); }
  }
  log.push({ stap: 'verzendingen', ok: true, info: `doorgegeven ${ok2}` });
}

export const STAPPEN = ['publiceren', 'orders', 'verzendingen'];
export async function draai(stappen, s, opties = {}) {
  const etsy = new EtsyClient(s.proef), log = [];
  await etsy.laad();
  if (!etsy.k) return { log: [{ stap: 'koppeling', ok: false, info: 'Etsy is nog niet gekoppeld (Beheer → Kanalen → koppel Etsy)' }], proef_schrijfacties: [] };
  for (const stap of stappen) {
    try {
      if (stap === 'publiceren') await stapPubliceren(etsy, s, log, opties);
      if (stap === 'orders') await stapOrders(etsy, s, log);
      if (stap === 'verzendingen') await stapVerzendingen(etsy, log);
    } catch (e) { log.push({ stap, ok: false, info: String(e.message || e).slice(0, 500) }); }
  }
  return { log, proef_schrijfacties: etsy.schrijf.slice(0, 50) };
}
export async function ping() {
  const e = new EtsyClient(true);
  if (!(await e.laad())) return { ok: false, info: 'Nog niet gekoppeld' };
  const r = await e.call('GET', `/shops/${e.shop}`);
  return { ok: r.status === 200, status: r.status, info: r.status === 200 ? `winkel ${r.data?.shop_name}` : foutTekst(r.data) };
}
// Hulp voor de instellingen: profielen ophalen zodat je de id's kunt kiezen.
export async function profielen() {
  const e = new EtsyClient(true);
  if (!(await e.laad())) throw new Error('Etsy is nog niet gekoppeld');
  const [verzend, verwerk, retour] = await Promise.all([
    e.call('GET', `/shops/${e.shop}/shipping-profiles`),
    e.call('GET', `/shops/${e.shop}/readiness-state-definitions`),
    e.call('GET', `/shops/${e.shop}/policies/return`),
  ]);
  return {
    verzendprofielen: (verzend.data?.results || []).map((x) => ({ id: x.shipping_profile_id, naam: x.title })),
    verwerkingsprofielen: (verwerk.data?.results || []).map((x) => ({ id: x.readiness_state_definition_id ?? x.readiness_state_id, naam: `${x.readiness_state} ${x.min_processing_time ?? ''}-${x.max_processing_time ?? ''} ${x.processing_time_unit ?? ''}`.trim() })),
    retourbeleid: (retour.data?.results || []).map((x) => ({ id: x.return_policy_id, naam: `${x.accepts_returns ? 'retour' : 'geen retour'} ${x.return_deadline ?? ''} dagen` })),
  };
}
