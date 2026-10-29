// Etsy Open API v3. Zelfde opzet als Luna Azul (etsy-sync):
//   koppelen      OAuth 2.0 + PKCE vanuit Beheer → Kanalen (refresh token 90 dagen, server-side)
//   listings      per poster één listing met de drie formaten als variatie: concept → foto → voorraad → actief
//   bijwerken     prijzen/voorraad opnieuw pushen als ze afwijken (vingerafdruk), pauzeren/hervatten
//   orders        betaalde receipts importeren (venster op 'updated'), annuleringen verwerken
//   verzendingen  track-and-trace doorgeven (createReceiptShipment); Etsy mailt de koper zelf
// Secrets (Vercel): ETSY_KEYSTRING, ETSY_SHARED_SECRET (etsy.com/developers → Your apps).
import crypto from 'node:crypto';
import { POSTERS, FORMATEN } from '../_catalogus.js';
import { db } from '../_db.js';
import { MAX_SCHRIJFACTIES, MAX_VERZENDPOGINGEN, foutTekst, kanaalPrijs, sku, titelEn, omschrijving, vervoerderCode } from './gemeen.js';
import { kanaalBeelden } from '../_media.js';
import { listings, zetListing, bekendeOrders, regel, importeer, teMelden, gemeld, meldenMislukt, annuleerVanKanaal, zetInstellingen } from './opslag.js';

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

// Voorraad/prijzen voor updateListingInventory: één product per formaat, prijs per formaat.
export function inventaris(poster_id, s, aan) {
  const products = Object.entries(FORMATEN).map(([formaat, f]) => ({
    sku: sku(poster_id, formaat),
    property_values: [{ property_id: PROPERTY, property_name: 'Size', value_ids: [], values: [f.label.replace(/ /g, '')] }],
    offerings: [{ price: kanaalPrijs(f.prijs, s.opslag_pct), quantity: aan ? s.voorraad : 0, is_enabled: aan, readiness_state_id: Number(s.verwerkingsprofiel_id) }],
  }));
  return { products, price_on_property: [PROPERTY], quantity_on_property: [PROPERTY], sku_on_property: [PROPERTY], readiness_state_on_property: [] };
}
const vingerafdruk = (inv) => JSON.stringify(inv.products.map((p) => [p.sku, p.offerings[0].price, p.offerings[0].quantity, p.offerings[0].is_enabled]));

function blokkade(s) {
  if (!s.verzendprofiel_id) return 'Vul eerst het Etsy-verzendprofiel-id in (Beheer → Kanalen → Etsy)';
  if (!s.verwerkingsprofiel_id) return 'Vul eerst het Etsy-verwerkingsprofiel-id (readiness state) in';
  if (!s.taxonomy_id) return 'Vul eerst de Etsy-categorie (taxonomy-id, bv. posters/prints) in';
  return null;
}

async function stapListings(etsy, s, log) {
  const rijen = (await listings('etsy')).filter((r) => r.ingeschakeld && !r.meta?.actief);
  let nieuw = 0, af = 0, mis = 0;
  for (const r of rijen) {
    if (nieuw + af + mis >= Math.min(5, MAX_SCHRIJFACTIES)) break; // foto-uploads zijn zwaar
    const b = blokkade(s);
    if (b) { await zetListing(r.id, { status: 'concept', laatste_fout: b }); continue; }
    const naam = POSTERS[r.poster_id];
    try {
      let id = r.extern_id;
      const inv = inventaris(r.poster_id, s, true);
      if (!id) {
        const velden = {
          quantity: String(s.voorraad), title: titelEn(naam).slice(0, 140), description: omschrijving(r.poster_id, 'en'),
          price: Math.min(...inv.products.map((p) => p.offerings[0].price)).toFixed(2),
          who_made: 'i_did', when_made: 'made_to_order', is_supply: 'false', taxonomy_id: String(s.taxonomy_id), type: 'physical',
          shipping_profile_id: String(s.verzendprofiel_id), readiness_state_id: String(s.verwerkingsprofiel_id), should_auto_renew: 'true',
          tags: ['scheveningen', 'surf poster', 'dutch poster', 'north sea', 'beach art', 'wall art', 'the hague', 'retro poster', 'surf art', 'holland'].join(','),
          materials: 'paper',
          ...(s.retourbeleid_id ? { return_policy_id: String(s.retourbeleid_id) } : {}),
        };
        if (etsy.proef) { etsy.schrijf.push(`createDraftListing "${velden.title}"`); continue; }
        const res = await etsy.call('POST', `/shops/${etsy.shop}/listings`, { form: velden });
        if (!ok(res.status) || !res.data?.listing_id) throw new Error(`Aanmaken (${res.status}): ${foutTekst(res.data)}`);
        id = String(res.data.listing_id); nieuw++;
        await zetListing(r.id, { extern_id: id, status: 'wacht', laatste_fout: null });
      } else { if (etsy.proef) { etsy.schrijf.push(`listing ${id} afmaken`); continue; } af++; }
      const meta = { ...(r.meta || {}) };
      if (!meta.foto) {
        // De poster als eerste foto, daarna de visuals (max. 10 op Etsy). Bij een fout gaat de volgende run verder.
        const urls = (await kanaalBeelden(r.poster_id)).slice(0, 10);
        for (let i = Number(meta.fotos || 0); i < urls.length; i++) {
          const img = await fetch(urls[i]);
          if (!img.ok) throw new Error(`Foto ${i + 1} ophalen mislukt (${img.status})`);
          const form = new FormData();
          form.append('image', new Blob([Buffer.from(await img.arrayBuffer())], { type: 'image/jpeg' }), `${r.poster_id}-${i + 1}.jpg`);
          form.append('rank', String(i + 1));
          const up = await etsy.call('POST', `/shops/${etsy.shop}/listings/${id}/images`, { multipart: form });
          if (!ok(up.status)) throw new Error(`Foto ${i + 1} uploaden (${up.status}): ${foutTekst(up.data)}`);
          meta.fotos = i + 1; await zetListing(r.id, { meta });
        }
        meta.foto = true; await zetListing(r.id, { meta });
      }
      const ir = await etsy.call('PUT', `/listings/${id}/inventory`, { json: inv });
      if (!ok(ir.status)) throw new Error(`Voorraad (${ir.status}): ${foutTekst(ir.data)}`);
      const act = await etsy.call('PATCH', `/shops/${etsy.shop}/listings/${id}`, { form: { state: 'active' } });
      if (!ok(act.status)) throw new Error(`Activeren (${act.status}): ${foutTekst(act.data)}`);
      await zetListing(r.id, { status: 'actief', laatste_fout: null, meta: { ...meta, actief: true, inventaris: vingerafdruk(inv) } });
    } catch (e) {
      mis++;
      await zetListing(r.id, { status: 'fout', laatste_fout: String(e.message || e).slice(0, 500) });
      log.push({ stap: 'listings', ok: false, info: `${naam}: ${String(e.message || e).slice(0, 200)}` });
    }
  }
  log.push({ stap: 'listings', ok: mis === 0, info: `aangemaakt ${nieuw}, afgemaakt ${af}, mislukt ${mis}` });
}

async function stapBijwerken(etsy, s, log) {
  const rijen = (await listings('etsy')).filter((r) => r.extern_id && r.meta?.actief);
  let bij = 0, mis = 0;
  for (const r of rijen) {
    if (bij + mis >= MAX_SCHRIJFACTIES) break;
    const inv = inventaris(r.poster_id, s, r.ingeschakeld);
    const vinger = vingerafdruk(inv);
    const wilStatus = r.ingeschakeld ? 'actief' : 'gepauzeerd';
    if (r.meta?.inventaris === vinger && r.status === wilStatus) continue;
    const res = await etsy.call('PUT', `/listings/${r.extern_id}/inventory`, { json: inv });
    if (res.status === 299) continue;
    if (!ok(res.status)) { mis++; await zetListing(r.id, { laatste_fout: `Bijwerken (${res.status}): ${foutTekst(res.data)}` }); continue; }
    if (r.status !== wilStatus) await etsy.call('PATCH', `/shops/${etsy.shop}/listings/${r.extern_id}`, { form: { state: r.ingeschakeld ? 'active' : 'inactive' } });
    bij++;
    await zetListing(r.id, { status: wilStatus, laatste_fout: null, meta: { ...r.meta, inventaris: vinger } });
  }
  log.push({ stap: 'bijwerken', ok: mis === 0, info: `bijgewerkt ${bij}, mislukt ${mis}` });
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

export const STAPPEN = ['listings', 'bijwerken', 'orders', 'verzendingen'];
export async function draai(stappen, s) {
  const etsy = new EtsyClient(s.proef), log = [];
  await etsy.laad();
  if (!etsy.k) return { log: [{ stap: 'koppeling', ok: false, info: 'Etsy is nog niet gekoppeld (Beheer → Kanalen → koppel Etsy)' }], proef_schrijfacties: [] };
  for (const stap of stappen) {
    try {
      if (stap === 'listings') await stapListings(etsy, s, log);
      if (stap === 'bijwerken') await stapBijwerken(etsy, s, log);
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
