// TikTok Shop (Partner API, open-api.tiktokglobalshop.com), gecontroleerd oktober 2026 tegen
// partner.tiktokshop.com/docv2 (sign-your-api-request, authorization-overview-202407, order/fulfillment/return_refund 202309).
//
// Wat het doet: orders importeren (alleen AWAITING_SHIPMENT, dus betaald en buiten de annuleringstermijn),
// annuleringen overnemen of als verzoek op de actielijst zetten (jij beslist: goedkeuren of weigeren),
// zendingen met eigen vervoerder doorgeven (per pakket), en een product als CONCEPT aanmaken in TikTok Shop
// (afronden en indienen doe je in Seller Center; SKIFFA volgt daarna de beoordeling).
// Nodig: een TikTok Shop-verkopersaccount (NL sinds juni 2026) en een eigen app in Partner Center
// (TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_SERVICE_ID). Niets hiervan is getest tegen de echte API.
import crypto from 'node:crypto';
import { db } from '../_db.js';
import { PRODUCTEN, VARIANTEN, ALLE_FORMATEN, PAPIER, BEELDEN, VASTE_BEELDEN } from '../_catalogus.js';
import { visuals, visualUrl } from '../_media.js';
import { bedrijf } from '../_bedrijf.js';
import { bekendeOrders, regel, importeer, teMelden, gemeld, meldenMislukt, annuleerVanKanaal, zetInstellingen } from './opslag.js';
import { MAX_VERZENDPOGINGEN } from './gemeen.js';

const API = 'https://open-api.tiktokglobalshop.com';
const AUTH = 'https://auth.tiktok-shops.com';
const AUTHORIZE = 'https://services.tiktokshop.com/open/authorize';
export const tiktokIngesteld = () => !!(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_SERVICE_ID);
export const terugUrl = () => `${bedrijf().site}/tiktok/terug`;

/**
 * Handtekening: alle queryparameters behalve sign en access_token, op sleutel gesorteerd, als {key}{value};
 * pad ervoor; ruwe body erachter (behalve multipart); secret eromheen; HMAC-SHA256 met secret, hex.
 */
export function teken(pad, query, body, secret) {
  const delen = Object.keys(query).filter((k) => k !== 'sign' && k !== 'access_token').sort().map((k) => `${k}${query[k]}`).join('');
  const tekst = `${secret}${pad}${delen}${body || ''}${secret}`;
  return crypto.createHmac('sha256', secret).update(tekst).digest('hex');
}

// ---- koppelen (OAuth) ----
export async function startKoppelen() {
  await db(`etsy_oauth_states?aangemaakt_op=lt.${new Date(Date.now() - 3600e3).toISOString()}`, { method: 'DELETE' });
  const state = crypto.randomBytes(24).toString('hex');
  await db('etsy_oauth_states', { method: 'POST', body: { state, code_verifier: 'tiktok', redirect_uri: terugUrl() } });
  return `${AUTHORIZE}?${new URLSearchParams({ service_id: process.env.TIKTOK_SERVICE_ID, state })}`;
}

async function tokenVraag(pad, params) {
  const r = await fetch(`${AUTH}${pad}?${new URLSearchParams({ app_key: process.env.TIKTOK_APP_KEY, app_secret: process.env.TIKTOK_APP_SECRET, ...params })}`);
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.code !== 0) throw new Error(`TikTok-token mislukt: ${j?.message || r.status}`);
  return j.data;
}
// *_expire_in zijn Unix-tijdstippen (geen duur).
const tokenRij = (t) => ({
  access_token: t.access_token, refresh_token: t.refresh_token,
  access_verloopt_op: new Date(Number(t.access_token_expire_in) * 1000).toISOString(),
  refresh_verloopt_op: t.refresh_token_expire_in ? new Date(Number(t.refresh_token_expire_in) * 1000).toISOString() : null,
  bijgewerkt_op: new Date().toISOString(),
});

export async function rondKoppelenAf(code, state) {
  const rij = (await db(`etsy_oauth_states?state=eq.${encodeURIComponent(state)}&code_verifier=eq.tiktok`))?.[0];
  await db(`etsy_oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' });
  if (!rij) throw new Error('Onbekende of al gebruikte koppelpoging; probeer opnieuw');
  if (Date.now() - Date.parse(rij.aangemaakt_op) > 30 * 60e3) throw new Error('Koppelpoging verlopen; probeer opnieuw');
  const t = await tokenVraag('/api/v2/token/get', { auth_code: code, grant_type: 'authorized_code' });
  await db('tiktok_koppeling?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { id: 1, verkoper: t.seller_name || null, regio: t.seller_base_region || null, gekoppeld_op: new Date().toISOString(), ...tokenRij(t) } });
  const c = new TikTokClient(false); await c.laad();
  const r = await c.call('GET', '/authorization/202309/shops', { zonderShop: true });
  const shop = (r.data?.shops || [])[0];
  if (!shop) throw new Error('Geen TikTok-winkel gevonden bij dit account');
  await db('tiktok_koppeling?id=eq.1', { method: 'PATCH', body: { shop_id: shop.id, shop_naam: shop.name, shop_cipher: shop.cipher, regio: shop.region || t.seller_base_region || null } });
  return { shop_naam: shop.name, regio: shop.region };
}

export async function koppeling() {
  return (await db('tiktok_koppeling?id=eq.1&select=shop_id,shop_naam,regio,verkoper,gekoppeld_op,refresh_verloopt_op').catch(() => []))?.[0] || null;
}

// ---- API-client ----
export class TikTokClient {
  constructor(proef) { this.proef = proef; this.schrijf = []; this.k = null; }
  async laad() {
    this.k = (await db('tiktok_koppeling?id=eq.1&select=*'))?.[0] || null;
    if (this.k && Date.parse(this.k.access_verloopt_op) - Date.now() < 24 * 3600e3) {
      const t = await tokenVraag('/api/v2/token/refresh', { refresh_token: this.k.refresh_token, grant_type: 'refresh_token' });
      const rij = tokenRij(t);
      await db('tiktok_koppeling?id=eq.1', { method: 'PATCH', body: rij });
      Object.assign(this.k, rij);
    }
    return this;
  }
  /** Eén API-aanroep. Schrijfacties worden in proefmodus niet verstuurd maar opgesomd. */
  async call(method, pad, { query = {}, json, form, zonderShop = false, schrijf = method !== 'GET' && !pad.endsWith('/search') } = {}) {
    if (schrijf && this.proef) { this.schrijf.push(`${method} ${pad}`); return { status: 299, data: null }; }
    const q = { ...query, app_key: process.env.TIKTOK_APP_KEY, timestamp: Math.floor(Date.now() / 1000), ...(zonderShop || !this.k?.shop_cipher ? {} : { shop_cipher: this.k.shop_cipher }) };
    const body = json ? JSON.stringify(json) : '';
    q.sign = teken(pad, q, form ? '' : body, process.env.TIKTOK_APP_SECRET);
    const r = await fetch(`${API}${pad}?${new URLSearchParams(q)}`, {
      method, headers: { 'x-tts-access-token': this.k?.access_token || '', ...(json ? { 'content-type': 'application/json' } : {}) }, body: form || (json ? body : undefined),
    });
    const d = await r.json().catch(() => null);
    if (r.status === 429 || d?.code === 36009002) throw new Error('TikTok: te veel verzoeken, volgende run opnieuw');
    return { status: r.ok && d?.code === 0 ? 200 : r.status >= 400 ? r.status : 400, data: d?.data ?? null, melding: d?.code ? `${d.message} (${d.code})` : d?.message || '' };
  }
}

// ---- orders ----
const bedrag = (v) => Math.round(Number(v || 0) * 100) / 100;
export function mapOrder(o) {
  if (o.status !== 'AWAITING_SHIPMENT') return null;
  const a = o.recipient_address || {};
  const plaats = (a.district_info || []).find((d) => /city|town/i.test(d.address_level_name || ''))?.address_name || (a.district_info || []).at(-1)?.address_name || '';
  const regels = (o.line_items || []).map((li) => regel({ sku: li.seller_sku, listing: null, titel: li.product_name, prijs: bedrag(li.sale_price), aantal: 1, extern_item_id: li.id }));
  // TikTok geeft één regel per stuk; samenvoegen per SKU houdt de bestelling overzichtelijk.
  const samen = [];
  for (const r of regels) { const x = samen.find((y) => y.variant_sku && y.variant_sku === r.variant_sku && y.prijs === r.prijs); if (x) { x.aantal++; x.extern_item_id += `,${r.extern_item_id}`; } else samen.push({ ...r }); }
  return {
    kanaal: 'tiktok', extern_id: String(o.id), naam: a.name || '', email: o.buyer_email || '',
    straat: [a.address_line1, a.address_line2].filter(Boolean).join(' ') || a.address_detail || '', postcode: String(a.postal_code || '').toUpperCase(), plaats,
    land: String(a.region_code || 'NL').toUpperCase(), opmerking: o.buyer_message || '', verzending: bedrag(o.payment?.shipping_fee),
    meta: { valuta: o.payment?.currency || 'EUR', totaal: bedrag(o.payment?.total_amount), delivery_option_id: o.delivery_option_id || null,
      pakketten: (o.packages || []).map((p) => ({ id: p.id, regels: (o.line_items || []).filter((li) => li.package_id === p.id).map((li) => li.id) })),
      regel_items: Object.fromEntries((o.line_items || []).map((li) => [li.id, li.seller_sku || null])) },
    regels: samen,
  };
}

async function stapOrders(c, s, log) {
  const sinds = s.laatste_ordersync ? Math.floor(Date.parse(s.laatste_ordersync) / 1000) - 900 : Math.floor(Date.now() / 1000) - 14 * 86400;
  const start = new Date().toISOString();
  const orders = [];
  let token = '';
  for (let pagina = 0; pagina < 5; pagina++) {
    const r = await c.call('POST', '/order/202309/orders/search', { query: { page_size: 50, ...(token ? { page_token: token } : {}) }, json: { update_time_ge: sinds, shipping_type: 'SELLER' } });
    if (r.status !== 200) throw new Error(`Orders zoeken: ${r.melding || r.status}`);
    orders.push(...(r.data?.orders || []));
    token = r.data?.next_page_token || '';
    if (!token) break;
  }
  const bekend = await bekendeOrders('tiktok', orders.map((o) => String(o.id)));
  let nieuw = 0, geannuleerd = 0, mis = 0;
  for (const o of orders) {
    const ons = bekend.get(String(o.id));
    if (ons) { if (['CANCELLED', 'CANCEL'].includes(o.status) && await annuleerVanKanaal(ons, 'geannuleerd op TikTok Shop')) geannuleerd++; continue; }
    const p = mapOrder(o);
    if (!p) continue;
    const notities = [];
    if (p.meta.valuta !== 'EUR') notities.push(`TikTok-bedragen in ${p.meta.valuta}: controleer de totalen`);
    if (!p.straat || !p.postcode) notities.push('Afleveradres onvolledig ontvangen: bekijk de order in TikTok Seller Center');
    if (o.is_buyer_request_cancel) notities.push('De koper vraagt annulering aan: beslis in SKIFFA (actielijst) of in Seller Center');
    try { if ((await importeer(p, notities))?.nieuw) nieuw++; } catch (e) { mis++; log.push({ stap: 'orders', ok: false, info: `Import ${o.id}: ${e.message}` }); }
  }
  if (!mis && !c.proef) await zetInstellingen('tiktok', { laatste_ordersync: start });
  log.push({ stap: 'orders', ok: mis === 0, info: `opgehaald ${orders.length}, geïmporteerd ${nieuw}, geannuleerd ${geannuleerd}` });
}

// ---- annuleringen: verzoeken komen op de actielijst; afgeronde annuleringen worden overgenomen ----
async function stapAnnuleringen(c, log) {
  const r = await c.call('POST', '/return_refund/202309/cancellations/search', { query: { page_size: 50 }, json: { cancel_status: ['CANCELLATION_REQUEST_PENDING', 'CANCELLATION_REQUEST_SUCCESS', 'CANCELLATION_REQUEST_COMPLETE'] } });
  if (r.status !== 200) throw new Error(`Annuleringen zoeken: ${r.melding || r.status}`);
  const lijst = r.data?.cancellations || [];
  const bekend = await bekendeOrders('tiktok', [...new Set(lijst.map((x) => String(x.order_id)))]);
  let verzoeken = 0, overgenomen = 0;
  for (const x of lijst) {
    const ons = bekend.get(String(x.order_id));
    if (!ons) continue;
    if (x.cancel_status === 'CANCELLATION_REQUEST_PENDING') {
      const marker = `[tiktok:${x.cancel_id}]`;
      const al = await db(`serviceverzoeken?bestelling_id=eq.${ons.id}&omschrijving=like.*${encodeURIComponent(marker)}*&select=id`);
      if (!al.length) {
        await db('serviceverzoeken', { method: 'POST', body: { bestelling_id: ons.id, soort: 'annulering', door: 'tiktok', omschrijving: `Annuleringsverzoek via TikTok Shop${x.cancel_reason_text ? `: ${x.cancel_reason_text}` : ''} ${marker}` } });
        verzoeken++;
      }
    } else if (await annuleerVanKanaal(ons, 'annulering afgerond op TikTok Shop')) overgenomen++;
  }
  log.push({ stap: 'annuleringen', ok: true, info: `nieuwe verzoeken ${verzoeken}, overgenomen ${overgenomen}` });
}

/** Annuleringsverzoek goedkeuren of weigeren (vanuit de beheeromgeving). */
export async function beslisAnnulering(c, cancelId, besluit, reden) {
  if (!/^[\w-]{1,64}$/.test(String(cancelId))) return { fout: 'Onbekend annuleringsverzoek.' };
  if (besluit === 'reject' && !reden) return { fout: 'Kies een reden om te weigeren.' };
  const pad = `/return_refund/202309/cancellations/${cancelId}/${besluit === 'approve' ? 'approve' : 'reject'}`;
  const r = await c.call('POST', pad, { query: { idempotency_key: `skiffa-${cancelId}-${besluit}` }, json: besluit === 'approve' ? {} : { reject_reason: String(reden).slice(0, 100) } });
  if (r.status === 299) return { ok: true, melding: `Proefmodus: zou ${besluit === 'approve' ? 'goedkeuren' : 'weigeren'}` };
  return r.status === 200 ? { ok: true, melding: besluit === 'approve' ? 'Annulering goedgekeurd bij TikTok' : 'Annulering geweigerd bij TikTok' } : { fout: `TikTok: ${r.melding || r.status}` };
}

// ---- zendingen met eigen vervoerder, per pakket ----
async function vervoerders(c, deliveryOptionId, land) {
  const r = await c.call('GET', `/logistics/202309/delivery_options/${encodeURIComponent(deliveryOptionId)}/shipping_providers`, { query: { warehouse_region: 'NL', buyer_region: land || 'NL' } });
  return r.status === 200 ? r.data?.shipping_providers || [] : [];
}
async function stapVerzendingen(c, log) {
  let ok2 = 0;
  for (const b of await teMelden('tiktok')) {
    if (Number(b.extern_meta?.verzend_pogingen || 0) >= MAX_VERZENDPOGINGEN) continue;
    const m = b.extern_meta || {}, pakketten = m.pakketten || [];
    // Welk pakket hoort bij deze zending? Eén pakket: dat. Meer: het pakket waarvan alle items in deze zending zitten.
    const items = new Set((b.bestelregels || []).flatMap((r) => String(r.extern_item_id || '').split(',')).filter(Boolean));
    const pakket = pakketten.length === 1 ? pakketten[0] : pakketten.find((p) => p.regels.length && p.regels.every((id) => items.has(id)));
    if (!pakket) { await meldenMislukt(b, 'geen passend TikTok-pakket voor deze (gesplitste) zending; geef de tracking door in Seller Center', 1); continue; }
    const providers = m.delivery_option_id ? await vervoerders(c, m.delivery_option_id, b.land) : [];
    const naam = String(b.vervoerder || 'postnl').toLowerCase();
    const prov = providers.find((p) => String(p.name || '').toLowerCase().replace(/\s/g, '').includes(naam));
    if (!prov) { await meldenMislukt(b, `vervoerder ${b.vervoerder || 'postnl'} staat niet in de TikTok-lijst voor deze order${providers.length ? ` (wel: ${providers.map((p) => p.name).slice(0, 6).join(', ')})` : ''}`); continue; }
    const r = await c.call('POST', `/fulfillment/202309/packages/${encodeURIComponent(pakket.id)}/ship`, { json: { self_shipment: { tracking_number: b.track_trace, shipping_provider_id: prov.id } } });
    if (r.status === 299) continue;
    if (r.status === 200) { ok2++; await gemeld(b); }
    else { log.push({ stap: 'verzendingen', ok: false, info: `${b.nummer}: ${r.melding}` }); await meldenMislukt(b, r.melding || `HTTP ${r.status}`, MAX_VERZENDPOGINGEN); }
  }
  log.push({ stap: 'verzendingen', ok: true, info: `doorgegeven ${ok2}` });
}

// ---- product als concept in TikTok Shop ----
export function conceptOntbreekt(s, productId) {
  const p = PRODUCTEN[productId], mis = [];
  if (!p) return ['onbekende poster'];
  if (p.status !== 'actief') mis.push(`poster staat op ${p.status}`);
  if (!p.beschrijving) mis.push('beschrijving ontbreekt');
  if (!s.categorie_id) mis.push('TikTok-categorie (blad-categorie-id) ontbreekt in de instellingen');
  if (!s.magazijn_id) mis.push('TikTok-magazijn-id ontbreekt in de instellingen');
  if (!(Number(s.gewicht_kg) > 0)) mis.push('pakketgewicht ontbreekt');
  if (!Object.values(VARIANTEN).some((v) => v.product_id === productId && v.bestelbaar && !v.lijst)) mis.push('geen bestelbare variant');
  if (!BEELDEN[productId] && !VASTE_BEELDEN.has(productId)) mis.push('hoofdbeeld ontbreekt');
  return mis;
}

async function uploadBeeld(c, url) {
  const r0 = await fetch(url);
  if (!r0.ok) throw new Error(`beeld niet op te halen (${r0.status})`);
  const form = new FormData();
  form.append('data', new Blob([await r0.arrayBuffer()], { type: r0.headers.get('content-type') || 'image/jpeg' }), 'beeld.jpg');
  form.append('use_case', 'MAIN_IMAGE');
  const r = await c.call('POST', '/product/202309/images/upload', { form });
  if (r.status === 299) return 'proef-uri';
  if (r.status !== 200 || !r.data?.uri) throw new Error(`beeld uploaden: ${r.melding || r.status}`);
  return r.data.uri;
}

/** Maak (eenmalig) een concept aan. Bestaat er al een TikTok-product, dan alleen de status bijwerken. */
export async function maakConcept(c, s, productId) {
  const mis = conceptOntbreekt(s, productId);
  if (mis.length) return { fout: mis.join('; ') };
  const p = PRODUCTEN[productId];
  const pk = (await db(`product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.tiktok&select=*`))?.[0];
  if (pk?.extern_id) return statusProduct(c, productId);
  // Claim: één aanmaakpoging tegelijk; idempotency_key voorkomt een dubbel product bij TikTok zelf.
  const nu = new Date().toISOString(), vast = new Date(Date.now() - 15 * 60000).toISOString();
  if (!pk) await db('product_kanalen?on_conflict=product_id,kanaal', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { product_id: productId, kanaal: 'tiktok', publiceren: true, afwijkingen: {} } });
  const claim = await db(`product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.tiktok&extern_id=is.null&or=(status.neq.verwerken,verwerken_sinds.lt.${vast})`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'verwerken', verwerken_sinds: nu, aanmaken_gestart_op: pk?.aanmaken_gestart_op || nu, melding: 'concept wordt aangemaakt' } });
  if (!claim?.length) return { fout: 'Er loopt al een aanmaakpoging voor deze poster.' };
  const sleutel = `skiffa-${productId}-${crypto.createHash('sha256').update(claim[0].aanmaken_gestart_op).digest('hex').slice(0, 16)}`;
  try {
    const vis = (await visuals().catch(() => ({})))[productId] || [];
    const hoofd = BEELDEN[productId] ? visualUrl(BEELDEN[productId].groot) : `${bedrijf().site}/posters/${productId}.jpg`;
    const urls = [hoofd, ...vis.filter((x) => x.soort !== 'video' && /\.(jpe?g|png)$/i.test(x.url)).map((x) => x.url)].slice(0, 9);
    const uris = []; for (const u of urls) uris.push(await uploadBeeld(c, u));
    const vs = Object.values(VARIANTEN).filter((v) => v.product_id === productId && v.bestelbaar && !v.lijst);
    const meerPapier = new Set(vs.map((v) => v.papier)).size > 1;
    const json = {
      title: `${p.titel} – poster`.slice(0, 255), description: `<p>${String(p.beschrijving).replace(/[<>]/g, '').split(/\n+/).join('</p><p>')}</p>`,
      category_id: String(s.categorie_id), main_images: uris.map((uri) => ({ uri })), save_mode: 'AS_DRAFT', idempotency_key: sleutel,
      package_weight: { value: String(s.gewicht_kg), unit: 'KILOGRAM' },
      ...(Number(s.lengte_cm) > 0 ? { package_dimensions: { length: String(s.lengte_cm), width: String(s.breedte_cm || 10), height: String(s.hoogte_cm || 10), unit: 'CENTIMETER' } } : {}),
      skus: vs.map((v) => ({ seller_sku: v.sku, price: { amount: Number(v.prijs).toFixed(2), currency: 'EUR' }, inventory: [{ warehouse_id: String(s.magazijn_id), quantity: Number(s.voorraad) || 20 }],
        sales_attributes: [{ name: 'Size', value_name: ALLE_FORMATEN[v.formaat]?.label || v.formaat }, ...(meerPapier ? [{ name: 'Material', value_name: PAPIER[v.papier]?.naam || v.papier }] : [])] })),
    };
    const r = await c.call('POST', '/product/202309/products', { json });
    if (r.status === 299) { await db(`product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.tiktok`, { method: 'PATCH', body: { status: 'niet_gepubliceerd', melding: 'Proefmodus: er is niets naar TikTok gestuurd.' } }); return { ok: true, melding: `Proefmodus: zou een concept aanmaken met ${vs.length} variant(en)`, proef: c.schrijf }; }
    if (r.status !== 200 || !r.data?.product_id) throw new Error(r.melding || `HTTP ${r.status}`);
    await db(`product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.tiktok`, { method: 'PATCH', body: { extern_id: String(r.data.product_id), status: 'gereed', melding: 'Concept staat in TikTok Shop: rond af en dien in via Seller Center.', laatste_sync_op: new Date().toISOString(), meta: { skus: r.data.skus || [] } } });
    return { ok: true, melding: 'Concept aangemaakt in TikTok Shop' };
  } catch (e) {
    await db(`product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.tiktok`, { method: 'PATCH', body: { status: 'fout', melding: String(e.message).slice(0, 400) } });
    return { fout: `TikTok: ${e.message}` };
  }
}

/** Beoordeling en status van een TikTok-product bijwerken. */
export async function statusProduct(c, productId) {
  const pk = (await db(`product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.tiktok&select=*`))?.[0];
  if (!pk?.extern_id) return { fout: 'Nog geen TikTok-product.' };
  const r = await c.call('GET', `/product/202309/products/${encodeURIComponent(pk.extern_id)}`);
  if (r.status !== 200) return { fout: `TikTok: ${r.melding || r.status}` };
  const a = r.data?.audit?.status, st = r.data?.status || r.data?.product_status;
  const status = st === 'ACTIVATE' && (!a || a === 'APPROVED') ? 'actief' : a === 'FAILED' ? 'fout' : a === 'AUDITING' ? 'verwerken' : 'gereed';
  const melding = status === 'fout' ? `Afgekeurd door TikTok: ${(r.data?.audit_failed_reasons || r.data?.audit?.failed_reasons || []).map((x) => (x.reasons || [x.reason || x]).join(', ')).join('; ') || 'zie Seller Center'}`
    : status === 'verwerken' ? 'Wordt beoordeeld door TikTok' : status === 'gereed' ? 'Concept of niet actief in TikTok Shop' : null;
  await db(`product_kanalen?product_id=eq.${encodeURIComponent(productId)}&kanaal=eq.tiktok`, { method: 'PATCH', body: { status, melding, laatste_sync_op: new Date().toISOString(), ...(status === 'verwerken' ? { verwerken_sinds: new Date().toISOString() } : {}) } });
  return { ok: true, status, melding: melding || 'Actief in TikTok Shop' };
}

async function stapProducten(c, log) {
  const pks = await db('product_kanalen?kanaal=eq.tiktok&extern_id=not.is.null&status=neq.actief&select=product_id&limit=20');
  let n = 0; for (const x of pks) { const r = await statusProduct(c, x.product_id); if (r.ok) n++; }
  log.push({ stap: 'producten', ok: true, info: `status bijgewerkt ${n}` });
}

export const STAPPEN = ['producten', 'orders', 'annuleringen', 'verzendingen'];
export async function draai(stappen, s) {
  const c = new TikTokClient(s.proef), log = [];
  await c.laad();
  if (!c.k?.shop_cipher) return { log: [{ stap: 'koppeling', ok: false, info: 'TikTok Shop is nog niet gekoppeld (Koppelingen → koppel TikTok Shop)' }], proef_schrijfacties: [] };
  for (const stap of stappen) {
    try {
      if (stap === 'producten') await stapProducten(c, log);
      if (stap === 'orders') await stapOrders(c, s, log);
      if (stap === 'annuleringen') await stapAnnuleringen(c, log);
      if (stap === 'verzendingen') await stapVerzendingen(c, log);
    } catch (e) { log.push({ stap, ok: false, info: String(e.message || e).slice(0, 500) }); }
  }
  return { log, proef_schrijfacties: c.schrijf.slice(0, 50) };
}

export async function ping() {
  const c = new TikTokClient(false); await c.laad();
  if (!c.k) return { ok: false, info: 'nog niet gekoppeld' };
  const r = await c.call('GET', '/authorization/202309/shops', { zonderShop: true });
  return r.status === 200 ? { ok: true, info: `${(r.data?.shops || []).length} winkel(s) gekoppeld` } : { ok: false, status: r.status, info: r.melding };
}
