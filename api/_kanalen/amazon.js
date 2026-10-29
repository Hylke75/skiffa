// Amazon Selling Partner API (eigen verzending, FBM). Zelfde opzet als Luna Azul (amazon-sync):
//   listings      per poster + formaat: bestaat de EAN al in de catalogus → alleen aanbod, anders een
//                 volledige listing (Listings Items API 2021-08-01; proefmodus = VALIDATION_PREVIEW)
//   bijwerken     prijs en voorraad (PATCH) waar die afwijken
//   orders        gewijzigde FBM-orders importeren (Orders API 2026-01-01), annuleringen verwerken
//   verzendingen  verzending bevestigen met track-and-trace (Orders v0 confirmShipment)
// Secrets (Vercel): AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_REFRESH_TOKEN, AMAZON_SELLER_ID.
import { MAX_SCHRIJFACTIES, MAX_VERZENDPOGINGEN, foutTekst, isGeldigeEan, kanaalPrijs, sku, titel, omschrijving, vervoerderCode, varianten } from './gemeen.js';
import { kanaalBeelden } from '../_media.js';
import { listings, zetListing, eans, bekendeOrders, regel, importeer, teMelden, gemeld, meldenMislukt, annuleerVanKanaal, zetInstellingen } from './opslag.js';

const API = 'https://sellingpartnerapi-eu.amazon.com';
export const amazonIngesteld = () => !!(process.env.AMAZON_LWA_CLIENT_ID && process.env.AMAZON_LWA_CLIENT_SECRET && process.env.AMAZON_REFRESH_TOKEN && process.env.AMAZON_SELLER_ID);

export class SpApi {
  constructor(proef) { this.proef = proef; this.token = null; this.verloopt = 0; this.overgeslagen = []; }
  async auth() {
    if (this.token && Date.now() < this.verloopt - 60e3) return this.token;
    const r = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.AMAZON_REFRESH_TOKEN, client_id: process.env.AMAZON_LWA_CLIENT_ID, client_secret: process.env.AMAZON_LWA_CLIENT_SECRET }),
    });
    if (!r.ok) throw new Error(`Amazon-login mislukt (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    this.token = j.access_token; this.verloopt = Date.now() + (j.expires_in ?? 3600) * 1000;
    return this.token;
  }
  async call(method, pad, query = {}, body) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    for (let poging = 0; poging < 3; poging++) {
      const r = await fetch(`${API}${pad}${qs.toString() ? `?${qs}` : ''}`, {
        method,
        headers: { 'x-amz-access-token': await this.auth(), 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Skiffa/1.0 (Language=JavaScript; Platform=Node)' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.status === 429 && poging < 2) { await new Promise((ok) => setTimeout(ok, 2000 * (poging + 1))); continue; }
      const t = await r.text(); let data = null;
      try { data = t ? JSON.parse(t) : null; } catch { data = t; }
      return { status: r.status, data };
    }
    throw new Error(`Amazon rate limit bleef staan voor ${pad}`);
  }
}
const SELLER = () => process.env.AMAZON_SELLER_ID;

function aanbod(s, prijs, aantal) {
  return {
    purchasable_offer: [{ marketplace_id: s.marketplace_id, currency: 'EUR', our_price: [{ schedule: [{ value_with_tax: prijs }] }] }],
    fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: aantal, lead_time_to_ship_max_days: s.verwerkingsdagen }],
  };
}
// Poster als hoofdfoto, visuals als extra foto's (Amazon: max. 8 extra).
const beeldAttributen = (urls, mid) => Object.fromEntries(urls.slice(0, 9).map((u, i) => [
  i === 0 ? 'main_product_image_locator' : `other_product_image_locator_${i}`, [{ media_location: u, marketplace_id: mid }],
]));
const problemen = (issues) => {
  const fout = (issues || []).filter((i) => i.severity === 'ERROR');
  return fout.length ? fout.map((i) => `${i.message}${i.attributeNames?.length ? ` (${i.attributeNames.join(', ')})` : ''}`).join(' · ').slice(0, 500) : null;
};

async function stapListings(sp, s, log) {
  const rijen = (await listings('amazon')).filter((l) => l.ingeschakeld && !l.extern_id);
  const ean = await eans(), v = new Map(varianten().map((x) => [`${x.poster_id}|${x.formaat}`, x]));
  const mid = s.marketplace_id, nl = (value) => ({ value, language_tag: 'nl_NL', marketplace_id: mid });
  let nieuw = 0, geldig = 0, ongeldig = 0;
  for (const l of rijen) {
    if (nieuw + geldig + ongeldig >= MAX_SCHRIJFACTIES) break;
    const variant = v.get(`${l.poster_id}|${l.formaat}`), code = ean.get(`${l.poster_id}|${l.formaat}`), s_ku = sku(l.poster_id, l.formaat);
    if (!isGeldigeEan(code)) { await zetListing(l.id, { status: 'fout', laatste_fout: 'Geen geldige EAN-code (Beheer → Kanalen → EAN-codes)' }); continue; }
    const prijs = kanaalPrijs(variant.prijs, s.opslag_pct);
    const cat = await sp.call('GET', '/catalog/2022-04-01/items', { identifiers: code, identifiersType: 'EAN', marketplaceIds: mid, includedData: ['summaries', 'productTypes'] });
    const item = cat.status === 200 ? cat.data?.items?.[0] : null;
    let body;
    if (item?.asin) {
      body = { productType: item.productTypes?.[0]?.productType || 'PRODUCT', requirements: 'LISTING_OFFER_ONLY', attributes: { condition_type: [{ value: 'new_new', marketplace_id: mid }], merchant_suggested_asin: [{ value: item.asin, marketplace_id: mid }], ...aanbod(s, prijs, s.voorraad) } };
    } else {
      body = {
        productType: s.producttype, requirements: 'LISTING',
        attributes: {
          condition_type: [{ value: 'new_new', marketplace_id: mid }],
          item_name: [nl(titel(variant).slice(0, 200))], brand: [nl(s.merk)],
          externally_assigned_product_identifier: [{ type: 'ean', value: code, marketplace_id: mid }],
          product_description: [nl(omschrijving(l.poster_id).slice(0, 2000))],
          bullet_point: ['Giclée op 250 grams mat fine-art papier, gedrukt in Den Haag', `Formaat ${variant.formaat_label}: een standaard lijstmaat`, 'Opgerold verstuurd in een stevige koker, zonder lijst', 'Ontworpen in Scheveningen: de surfcultuur van de Noordzee'].map(nl),
          ...beeldAttributen(await kanaalBeelden(l.poster_id), mid),
          ...aanbod(s, prijs, s.voorraad),
        },
      };
    }
    const res = await sp.call('PUT', `/listings/2021-08-01/items/${SELLER()}/${encodeURIComponent(s_ku)}`, { marketplaceIds: mid, includedData: ['issues'], ...(sp.proef ? { mode: 'VALIDATION_PREVIEW' } : {}) }, body);
    const p = problemen(res.data?.issues), meta = { ...l.meta, producttype: body.productType, asin: item?.asin ?? null };
    if (res.status !== 200 || res.data?.status === 'INVALID' || p) { ongeldig++; await zetListing(l.id, { status: 'fout', laatste_fout: p || `(${res.status}) ${foutTekst(res.data)}`, meta }); }
    else if (sp.proef) { geldig++; await zetListing(l.id, { status: 'concept', laatste_fout: null, meta: { ...meta, gevalideerd: true } }); }
    else { nieuw++; await zetListing(l.id, { extern_id: s_ku, status: 'wacht', laatste_fout: null, laatste_prijs: prijs, laatste_voorraad: s.voorraad, meta }); }
  }
  log.push({ stap: 'listings', ok: ongeldig === 0, info: `aangemaakt ${nieuw}, goedgekeurd in proef ${geldig}, afgekeurd ${ongeldig}` });
}

async function stapBijwerken(sp, s, log) {
  const rijen = (await listings('amazon')).filter((l) => l.extern_id);
  const v = new Map(varianten().map((x) => [`${x.poster_id}|${x.formaat}`, x]));
  let bij = 0, mis = 0;
  for (const l of rijen) {
    if (bij + mis >= MAX_SCHRIJFACTIES) break;
    const prijs = kanaalPrijs(v.get(`${l.poster_id}|${l.formaat}`).prijs, s.opslag_pct), aantal = l.ingeschakeld ? s.voorraad : 0;
    const a = aanbod(s, prijs, aantal), patches = [];
    if (Number(l.laatste_prijs) !== prijs) patches.push({ op: 'replace', path: '/attributes/purchasable_offer', value: a.purchasable_offer });
    if (l.laatste_voorraad !== aantal) patches.push({ op: 'replace', path: '/attributes/fulfillment_availability', value: a.fulfillment_availability });
    if (!patches.length) continue;
    if (sp.proef) { sp.overgeslagen.push(`PATCH ${l.extern_id}`); continue; }
    const r = await sp.call('PATCH', `/listings/2021-08-01/items/${SELLER()}/${encodeURIComponent(l.extern_id)}`, { marketplaceIds: s.marketplace_id, includedData: ['issues'] }, { productType: l.meta?.producttype || s.producttype, patches });
    const p = problemen(r.data?.issues);
    if (r.status === 200 && !p) { bij++; await zetListing(l.id, { status: l.ingeschakeld ? 'actief' : 'gepauzeerd', laatste_fout: null, laatste_prijs: prijs, laatste_voorraad: aantal }); }
    else { mis++; await zetListing(l.id, { laatste_fout: p || `Bijwerken (${r.status}): ${foutTekst(r.data)}` }); }
  }
  log.push({ stap: 'bijwerken', ok: mis === 0, info: `bijgewerkt ${bij}, mislukt ${mis}` });
}

const euro = (m) => (m?.amount != null ? Number(m.amount) : null);
export function mapAmazonOrder(o) {
  if ((o.fulfillment?.fulfilledBy ?? 'MERCHANT') !== 'MERCHANT' || !['UNSHIPPED', 'PARTIALLY_SHIPPED'].includes(o.fulfillment?.fulfillmentStatus ?? '')) return null;
  const regels = (o.orderItems || []).filter((i) => i.quantityOrdered > 0).map((i) => {
    const stuk = euro(i.product?.price?.unitPrice) ?? (euro(i.proceeds?.proceedsTotal) ?? 0) / i.quantityOrdered;
    return regel({ sku: i.product?.sellerSku, listing: null, titel: i.product?.title, prijs: stuk, aantal: i.quantityOrdered, extern_item_id: i.orderItemId });
  });
  if (!regels.length) return null;
  const a = o.recipient?.deliveryAddress || {};
  return {
    kanaal: 'amazon', extern_id: o.orderId, naam: a.name || o.buyer?.buyerName || '', email: o.buyer?.buyerEmail || '',
    straat: [a.addressLine1, a.addressLine2, a.addressLine3].filter(Boolean).join(', '), postcode: String(a.postalCode || '').toUpperCase(),
    plaats: a.city || '', land: String(a.countryCode || 'NL').toUpperCase(), opmerking: a.companyName ? `bedrijf: ${a.companyName}` : '', verzending: 0,
    meta: { marketplace_id: o.salesChannel?.marketplaceId ?? null, verzenden_voor: o.fulfillment?.shipByWindow?.endTime ?? null, totaal: euro(o.proceeds?.grandTotal) },
    regels,
  };
}

async function stapOrders(sp, s, log) {
  const sinds = s.laatste_ordersync ? new Date(Date.parse(s.laatste_ordersync) - 15 * 60e3) : new Date(Date.now() - 14 * 864e5);
  const start = new Date().toISOString(), orders = [];
  let token;
  for (let page = 0; page < 5; page++) {
    const r = await sp.call('GET', '/orders/2026-01-01/orders', { lastUpdatedAfter: sinds.toISOString(), marketplaceIds: s.marketplace_id, fulfilledBy: 'MERCHANT', includedData: ['BUYER', 'RECIPIENT', 'PROCEEDS', 'CANCELLATION', 'FULFILLMENT'], maxResultsPerPage: '100', paginationToken: token });
    if (r.status !== 200) throw new Error(`Orders ophalen (${r.status}): ${foutTekst(r.data)}`);
    orders.push(...(r.data?.orders || []));
    token = r.data?.pagination?.nextToken;
    if (!token) break;
  }
  const bekend = await bekendeOrders('amazon', orders.map((o) => o.orderId));
  let nieuw = 0, geannuleerd = 0, mis = 0;
  for (const o of orders) {
    const ons = bekend.get(o.orderId);
    if (ons) {
      if (o.fulfillment?.fulfillmentStatus === 'CANCELLED' && await annuleerVanKanaal(ons, 'geannuleerd op Amazon')) geannuleerd++;
      continue;
    }
    const p = mapAmazonOrder(o);
    if (!p) continue;
    const notities = [];
    if (p.meta.verzenden_voor) notities.push(`Verzenden vóór ${p.meta.verzenden_voor} (Amazon)`);
    if (!p.straat) notities.push('Geen afleveradres ontvangen (Amazon geeft adressen alleen met de juiste rol): bekijk de order in Seller Central');
    if ((o.orderItems || []).some((i) => i.cancellation?.cancellationRequest)) notities.push('De koper vraagt om annulering: handel af in Seller Central');
    try { if ((await importeer(p, notities))?.nieuw) nieuw++; } catch (e) { mis++; log.push({ stap: 'orders', ok: false, info: `Import ${o.orderId}: ${e.message}` }); }
  }
  if (!mis && !token && !sp.proef) await zetInstellingen('amazon', { laatste_ordersync: start });
  log.push({ stap: 'orders', ok: mis === 0, info: `gewijzigd ${orders.length}, geïmporteerd ${nieuw}, geannuleerd ${geannuleerd}` });
}

async function stapVerzendingen(sp, s, log) {
  let ok = 0;
  for (const b of await teMelden('amazon')) {
    if (Number(b.extern_meta?.verzend_pogingen || 0) >= MAX_VERZENDPOGINGEN) continue;
    const items = (b.bestelregels || []).filter((r) => r.extern_item_id);
    if (!items.length) continue;
    if (sp.proef) { sp.overgeslagen.push(`confirmShipment ${b.extern_id}`); continue; }
    const r = await sp.call('POST', `/orders/v0/orders/${encodeURIComponent(b.extern_id)}/shipmentConfirmation`, {}, {
      marketplaceId: b.extern_meta?.marketplace_id || s.marketplace_id,
      packageDetail: { packageReferenceId: String(b.zending?.id || 1), ...vervoerderCode('amazon', b.vervoerder), trackingNumber: b.track_trace, shipDate: new Date().toISOString(), orderItems: items.map((i) => ({ orderItemId: i.extern_item_id, quantity: i.aantal })) },
    });
    if (r.status === 204 || r.status === 200) { ok++; await gemeld(b); }
    else { log.push({ stap: 'verzendingen', ok: false, info: `${b.nummer}: ${foutTekst(r.data)}` }); await meldenMislukt(b, `(${r.status}) ${foutTekst(r.data)}`, MAX_VERZENDPOGINGEN); }
  }
  log.push({ stap: 'verzendingen', ok: true, info: `bevestigd ${ok}` });
}

export const STAPPEN = ['listings', 'bijwerken', 'orders', 'verzendingen'];
export async function draai(stappen, s) {
  const sp = new SpApi(s.proef), log = [];
  for (const stap of stappen) {
    try {
      if (stap === 'listings') await stapListings(sp, s, log);
      if (stap === 'bijwerken') await stapBijwerken(sp, s, log);
      if (stap === 'orders') await stapOrders(sp, s, log);
      if (stap === 'verzendingen') await stapVerzendingen(sp, s, log);
    } catch (e) { log.push({ stap, ok: false, info: String(e.message || e).slice(0, 500) }); }
  }
  return { log, proef_schrijfacties: sp.overgeslagen.slice(0, 50) };
}
export async function ping() {
  const r = await new SpApi(true).call('GET', '/sellers/v1/marketplaceParticipations');
  return { ok: r.status === 200, status: r.status, info: r.status === 200 ? (r.data?.payload || []).map((p) => p.marketplace?.name).filter(Boolean).join(', ') : foutTekst(r.data) };
}
