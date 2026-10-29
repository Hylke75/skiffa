// bol.com Retailer API (eigen verzending, FBR). Zelfde stappen als Luna Azul (bol-sync):
//   aanbiedingen  aanmaken op EAN / pauzeren / hervatten           (Offer API v11)
//   bijwerken     prijs en "voorraad" bijwerken waar die afwijken    (v11)
//   orders        nieuwe FBR-orders importeren, annuleringsverzoeken (v10)
//   verzendingen  verzonden orders met track-and-trace doorgeven     (v10)
//   facturen      factuurverzoeken beantwoorden met een PDF          (v10)
// Proefmodus: GET-calls gaan door, schrijfacties richting bol worden alleen verzameld.
// Secrets (Vercel): BOL_CLIENT_ID, BOL_CLIENT_SECRET (bol partnerplatform → Instellingen → API).
import { MAX_SCHRIJFACTIES, MAX_VERZENDPOGINGEN, foutTekst, isGeldigeEan, kanaalPrijs, sku, titel, vervoerderCode, varianten } from './gemeen.js';
import { listings, zetListing, eans, bekendeOrders, regel, importeer, teMelden, gemeld, meldenMislukt, annuleerVanKanaal } from './opslag.js';
import { db } from '../_db.js';
import { factuurPdf } from '../factuur.js';

const API = 'https://api.bol.com', LOGIN = 'https://login.bol.com';
const V10 = 'application/vnd.retailer.v10+json', V11 = 'application/vnd.retailer.v11+json';
export const bolIngesteld = () => !!(process.env.BOL_CLIENT_ID && process.env.BOL_CLIENT_SECRET);

export class BolClient {
  constructor(proef) { this.proef = proef; this.token = null; this.verloopt = 0; this.schrijf = []; }
  async auth() {
    if (this.token && Date.now() < this.verloopt - 20000) return this.token;
    const r = await fetch(`${LOGIN}/token?grant_type=client_credentials`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${process.env.BOL_CLIENT_ID}:${process.env.BOL_CLIENT_SECRET}`).toString('base64')}`, accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`bol-login mislukt (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    this.token = j.access_token; this.verloopt = Date.now() + (j.expires_in ?? 299) * 1000;
    return this.token;
  }
  async call(method, pad, { versie = V10, body, form } = {}) {
    if (method !== 'GET' && this.proef) { this.schrijf.push(`${method} ${pad}`); return { status: 299, data: { proef: true } }; }
    for (let poging = 0; poging < 2; poging++) {
      const headers = { authorization: `Bearer ${await this.auth()}`, accept: versie };
      let b;
      if (form) b = form; else if (body !== undefined) { headers['content-type'] = versie; b = JSON.stringify(body); }
      const r = await fetch(`${API}${pad}`, { method, headers, body: b });
      if (r.status === 429 && poging === 0) { await new Promise((ok) => setTimeout(ok, Math.min(Number(r.headers.get?.('retry-after') || 3), 10) * 1000)); continue; }
      const t = await r.text(); let data = null;
      try { data = t ? JSON.parse(t) : null; } catch { data = t; }
      return { status: r.status, data };
    }
    throw new Error(`bol rate limit bleef staan voor ${pad}`);
  }
}

async function stapAanbiedingen(bol, s, log) {
  const rijen = await listings('bol'), ean = await eans();
  const v = new Map(varianten().map((x) => [`${x.poster_id}|${x.formaat}`, x]));
  const c = { aangemaakt: 0, gepauzeerd: 0, hervat: 0, schrijf: 0 };
  for (const l of rijen) {
    if (c.schrijf >= MAX_SCHRIJFACTIES) break;
    const variant = v.get(`${l.poster_id}|${l.formaat}`);
    if (!l.extern_id && l.ingeschakeld) {
      const code = ean.get(`${l.poster_id}|${l.formaat}`);
      if (!isGeldigeEan(code)) { await zetListing(l.id, { status: 'fout', laatste_fout: 'Geen geldige EAN-code (Beheer → Kanalen → EAN-codes)' }); continue; }
      const prijs = kanaalPrijs(variant.prijs, s.opslag_pct);
      c.schrijf++;
      const r = await bol.call('POST', '/retailer/offers', {
        versie: V11,
        body: {
          ean: code, reference: sku(l.poster_id, l.formaat), onHoldByRetailer: false,
          unknownProductTitle: titel(variant), condition: { category: 'NEW' },
          pricing: { bundlePrices: [{ quantity: 1, unitPrice: prijs }] },
          stock: { amount: s.voorraad, managedByRetailer: true },
          fulfilment: { method: 'FBR', schedule: 'MY_DELIVERY_PROMISE', deliveryPromise: { minimumDaysToCustomer: s.levertijd_min, maximumDaysToCustomer: s.levertijd_max } },
        },
      });
      if (r.status === 299) continue;
      let offerId = r.status === 201 || r.status === 202 ? r.data?.offerId : null;
      if (r.status === 409 || (!offerId && r.status === 202)) {
        const gevonden = await bol.call('GET', `/retailer/offers?eans=${encodeURIComponent(code)}`, { versie: V11 });
        offerId = gevonden.data?.offers?.[0]?.offerId ?? null;
      }
      if (offerId) { c.aangemaakt++; await zetListing(l.id, { extern_id: offerId, status: 'actief', laatste_fout: null, laatste_prijs: prijs, laatste_voorraad: s.voorraad, meta: { ...l.meta, ean: code } }); }
      else await zetListing(l.id, { status: r.status === 202 ? 'wacht' : 'fout', laatste_fout: r.status === 202 ? 'Aangemeld bij bol, wordt verwerkt' : `Aanmaken mislukt (${r.status}): ${foutTekst(r.data)}` });
      continue;
    }
    if (l.extern_id) {
      const hold = !l.ingeschakeld;
      if ((hold && l.status !== 'gepauzeerd') || (!hold && l.status === 'gepauzeerd')) {
        c.schrijf++;
        const r = await bol.call('PATCH', `/retailer/offers/${l.extern_id}`, { versie: V11, body: { onHoldByRetailer: hold } });
        if (r.status === 204 || r.status === 202) { await zetListing(l.id, { status: hold ? 'gepauzeerd' : 'actief', laatste_fout: null }); hold ? c.gepauzeerd++ : c.hervat++; }
        else if (r.status !== 299) await zetListing(l.id, { laatste_fout: `${hold ? 'Pauzeren' : 'Hervatten'}: ${foutTekst(r.data)}` });
      }
    }
  }
  log.push({ stap: 'aanbiedingen', ok: true, info: `aangemaakt ${c.aangemaakt}, gepauzeerd ${c.gepauzeerd}, hervat ${c.hervat}` });
}

async function stapBijwerken(bol, s, log) {
  const rijen = (await listings('bol')).filter((l) => l.extern_id && l.status === 'actief');
  const v = new Map(varianten().map((x) => [`${x.poster_id}|${x.formaat}`, x]));
  let bij = 0, mis = 0;
  for (const l of rijen) {
    if (bij + mis >= MAX_SCHRIJFACTIES) break;
    const prijs = kanaalPrijs(v.get(`${l.poster_id}|${l.formaat}`).prijs, s.opslag_pct);
    const voorraad = l.ingeschakeld ? s.voorraad : 0;
    const body = {};
    if (Number(l.laatste_prijs) !== prijs) body.pricing = { bundlePrices: [{ quantity: 1, unitPrice: prijs }] };
    if (l.laatste_voorraad !== voorraad) body.stock = { amount: voorraad, managedByRetailer: true };
    if (!Object.keys(body).length) continue;
    const r = await bol.call('PATCH', `/retailer/offers/${l.extern_id}`, { versie: V11, body });
    if (r.status === 299) continue;
    if (r.status === 204 || r.status === 202) { bij++; await zetListing(l.id, { laatste_fout: null, ...(body.pricing ? { laatste_prijs: prijs } : {}), ...(body.stock ? { laatste_voorraad: voorraad } : {}) }); }
    else { mis++; await zetListing(l.id, { laatste_fout: `Bijwerken (${r.status}): ${foutTekst(r.data)}` }); }
  }
  log.push({ stap: 'bijwerken', ok: mis === 0, info: `bijgewerkt ${bij}, mislukt ${mis}` });
}

export function mapBolOrder(o, perOffer) {
  const sh = o.shipmentDetails || {}, bi = o.billingDetails || sh;
  const regels = (o.orderItems || [])
    .filter((i) => (i.fulfilment?.method ?? 'FBR') === 'FBR')
    .map((i) => ({ i, n: i.quantity - (i.quantityCancelled ?? 0) }))
    .filter(({ n }) => n > 0)
    .map(({ i, n }) => regel({ sku: i.offer?.reference, listing: perOffer.get(i.offer?.offerId), titel: i.product?.title, prijs: i.unitPrice, aantal: n, extern_item_id: i.orderItemId }));
  if (!regels.length) return null;
  const nr = [sh.houseNumber, sh.houseNumberExtension].filter((x) => x != null && x !== '').join(' ');
  return {
    kanaal: 'bol', extern_id: o.orderId,
    naam: [sh.firstName, sh.surname].filter(Boolean).join(' ') || [bi.firstName, bi.surname].filter(Boolean).join(' '),
    email: sh.email || bi.email || '',
    straat: [sh.streetName, nr].filter(Boolean).join(' ').trim() + (sh.extraAddressInformation ? `, ${sh.extraAddressInformation}` : ''),
    postcode: String(sh.zipCode || '').toUpperCase(), plaats: sh.city || '', land: String(sh.countryCode || 'NL').toUpperCase(),
    opmerking: sh.company ? `bedrijf: ${sh.company}` : '', verzending: 0,
    meta: { uiterste_leverdatum: (o.orderItems || []).map((i) => i.fulfilment?.latestDeliveryDate).filter(Boolean).sort()[0] ?? null, commissie: (o.orderItems || []).reduce((t, i) => t + Number(i.commission || 0), 0) },
    regels,
  };
}

async function stapOrders(bol, log) {
  const lijst = [];
  for (let page = 1; page <= 2; page++) {
    const r = await bol.call('GET', `/retailer/orders?fulfilment-method=FBR&status=OPEN&page=${page}`);
    if (r.status !== 200) throw new Error(`Orders ophalen (${r.status}): ${foutTekst(r.data)}`);
    lijst.push(...(r.data?.orders || []));
    if ((r.data?.orders || []).length < 50) break;
  }
  const bekend = await bekendeOrders('bol', lijst.map((o) => o.orderId));
  const perOffer = new Map((await listings('bol')).filter((l) => l.extern_id).map((l) => [l.extern_id, l]));
  let nieuw = 0, details = 0, geannuleerd = 0;
  for (const o of lijst) {
    const ons = bekend.get(o.orderId);
    // Annuleringsverzoek van de klant op een nog niet verzonden order: accepteren.
    const open = (o.orderItems || []).filter((i) => i.quantity - (i.quantityShipped ?? 0) - (i.quantityCancelled ?? 0) > 0);
    if (ons && open.length && open.every((i) => i.cancellationRequest === true) && !['verzonden', 'geleverd'].includes(ons.status)) {
      const r = await bol.call('PUT', '/retailer/orders/cancellation', { body: { orderItems: open.map((i) => ({ orderItemId: i.orderItemId, reasonCode: 'REQUESTED_BY_CUSTOMER' })) } });
      if (r.status === 202 && await annuleerVanKanaal(ons, 'geannuleerd op verzoek van de klant (bol)')) geannuleerd++;
      continue;
    }
    if (ons || details >= 6) continue; // bol staat maar ±8 orderdetails per minuut toe
    details++;
    const d = await bol.call('GET', `/retailer/orders/${o.orderId}`);
    if (d.status !== 200) { log.push({ stap: 'orders', ok: false, info: `Detail ${o.orderId}: ${foutTekst(d.data)}` }); continue; }
    const p = mapBolOrder(d.data, perOffer);
    if (!p) continue;
    const res = await importeer(p, p.meta.uiterste_leverdatum ? [`Uiterste leverdatum volgens bol: ${p.meta.uiterste_leverdatum}`] : []);
    if (res?.nieuw) nieuw++;
  }
  log.push({ stap: 'orders', ok: true, info: `open bij bol ${lijst.length}, geïmporteerd ${nieuw}, geannuleerd ${geannuleerd}` });
}

async function stapVerzendingen(bol, s, log) {
  let ok = 0;
  for (const b of await teMelden('bol')) {
    if (Number(b.extern_meta?.verzend_pogingen || 0) >= MAX_VERZENDPOGINGEN) continue;
    const items = (b.bestelregels || []).filter((r) => r.extern_item_id);
    if (!items.length) continue;
    const r = await bol.call('POST', '/retailer/shipments', {
      body: {
        orderItems: items.map((i) => ({ orderItemId: i.extern_item_id, quantity: i.aantal })),
        shipmentReference: b.zending ? `${b.nummer}-${b.zending.id}` : b.nummer,
        transport: { transporterCode: vervoerderCode('bol', b.vervoerder) || s.vervoerder, trackAndTrace: b.track_trace },
      },
    });
    if (r.status === 299) continue;
    if (r.status === 202) { ok++; await gemeld(b, { proces_id: r.data?.processStatusId ?? null }); }
    else { log.push({ stap: 'verzendingen', ok: false, info: `${b.nummer}: ${foutTekst(r.data)}` }); await meldenMislukt(b, `(${r.status}) ${foutTekst(r.data)}`, MAX_VERZENDPOGINGEN); }
  }
  log.push({ stap: 'verzendingen', ok: true, info: `doorgegeven ${ok}` });
}

async function stapFacturen(bol, log) {
  const r = await bol.call('GET', '/retailer/shipments/invoices/requests?state=OPEN&page=1');
  if (r.status !== 200) throw new Error(`Factuurverzoeken (${r.status}): ${foutTekst(r.data)}`);
  const verzoeken = r.data?.invoiceRequests || [];
  if (bol.proef) { log.push({ stap: 'facturen', ok: true, info: `open verzoeken ${verzoeken.length} (proef)` }); return; }
  let up = 0;
  for (const v of verzoeken) {
    const b = (await db(`bestellingen?kanaal=eq.bol&extern_id=eq.${encodeURIComponent(v.orderId)}&select=*,bestelregels(*)`))?.[0];
    if (!b?.factuurnummer || b.extern_meta?.factuur_voor === String(v.shipmentId)) continue;
    const form = new FormData();
    form.append('invoice', new Blob([factuurPdf(b)], { type: 'application/pdf' }), `factuur-${b.factuurnummer}.pdf`);
    const u = await bol.call('POST', `/retailer/shipments/invoices/${v.shipmentId}`, { form });
    if (u.status === 202) { up++; await db(`bestellingen?id=eq.${b.id}`, { method: 'PATCH', body: { extern_meta: { ...(b.extern_meta || {}), factuur_voor: String(v.shipmentId) } } }); }
    else log.push({ stap: 'facturen', ok: false, info: `Upload ${v.orderId}: ${foutTekst(u.data)}` });
  }
  log.push({ stap: 'facturen', ok: true, info: `geüpload ${up}` });
}

export const STAPPEN = ['aanbiedingen', 'bijwerken', 'orders', 'verzendingen', 'facturen'];
export async function draai(stappen, s) {
  const bol = new BolClient(s.proef), log = [];
  for (const stap of stappen) {
    try {
      if (stap === 'aanbiedingen') await stapAanbiedingen(bol, s, log);
      if (stap === 'bijwerken') await stapBijwerken(bol, s, log);
      if (stap === 'orders') await stapOrders(bol, log);
      if (stap === 'verzendingen') await stapVerzendingen(bol, s, log);
      if (stap === 'facturen') await stapFacturen(bol, log);
    } catch (e) { log.push({ stap, ok: false, info: String(e.message || e).slice(0, 500) }); }
  }
  return { log, proef_schrijfacties: bol.schrijf.slice(0, 50) };
}
export async function ping() {
  const r = await new BolClient(true).call('GET', '/retailer/orders?fulfilment-method=FBR&status=OPEN&page=1');
  return { ok: r.status === 200, status: r.status, info: r.status === 200 ? `${r.data?.orders?.length ?? 0} open orders` : foutTekst(r.data) };
}
