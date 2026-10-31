// Productie via Prodigi (Print API v4, https://www.prodigi.com/print-api/docs/reference/).
//
// Catalogus
//   productControle(sku)    Prodigi-product van een variant opvragen: bestaat het, kloppen de opties,
//                           de productiemaat, de pixeleis en het land van levering? → bevestigd / ongeldig
//   offerte(sku)            actuele kosten (artikel, verzending, merktoevoegingen, btw) via POST /quotes
//   proefOfferte / proefPlaatsen   proefbestelling: eerst kosten + adres tonen, dan pas na bevestiging plaatsen
// Orders (elke bestelling hooguit één keer; zie supabase/migrations/20261029040000_prodigi.sql)
//   aanmelden(o)            na betaling of import: regel 'wacht' tot na de wachttijd
//   verwerk()               claimen → controleren → merktoevoegingen → versturen; onduidelijk antwoord =
//                           'onzeker': eerst bij Prodigi zoeken (merchantReferences) voordat er opnieuw wordt besteld
//   callback / statussen    productiestatus, kosten en zendingen terug in de administratie
//
// Sleutels (Vercel): PRODIGI_SANDBOX_API_KEY (test, er wordt niets gedrukt) en PRODIGI_API_KEY (live).
import crypto from 'node:crypto';
import { db, rpc, haalBestelling, werkBij, log } from './_db.js';
import { ALLE_FORMATEN, VARIANTEN } from './_catalogus.js';
import { downloadUrl } from './_opslag.js';
import { metDrukbestanden, beoordeel, doelVoor } from './_media.js';
import { bedrijf } from './_bedrijf.js';
import { onderteken } from './_auth.js';
import { registreer } from './_zendingen.js';

export const BASIS = { sandbox: 'https://api.sandbox.prodigi.com/v4.0', live: 'https://api.prodigi.com/v4.0' };
export const VERZENDMETHODEN = ['Budget', 'Standard', 'StandardPlus', 'Express', 'Overnight'];
export const INSERTS = {
  postcard: 'kaartje (A6)', flyer: 'flyer (A5)', packing_slip_bw: 'pakbon (zwart-wit)', packing_slip_color: 'pakbon (kleur)',
  sticker_exterior_round: 'sticker buiten (rond)', sticker_exterior_rectangle: 'sticker buiten (rechthoek)',
  sticker_interior_round: 'sticker binnen (rond)', sticker_interior_rectangle: 'sticker binnen (rechthoek)',
};
export const STANDAARD_PRODIGI = {
  aan: false, sandbox: true, verzendmethode: 'Standard', wachttijd_min: 30,
  branding: [],                 // [{ type, url, verplicht }]
  branding_beleid: 'blokkeren', // blokkeren | alternatief | zonder (wat te doen als een verplichte toevoeging niet kan)
  branding_alternatief: null,   // type dat dan wordt gebruikt (bij 'alternatief')
};
export const MAX_POGINGEN = 5;
export const MAX_CONTROLES_ONZEKER = 6;
const omgevingVan = (s) => (s.sandbox ? 'sandbox' : 'live');
const sleutel = (omg) => (omg === 'live' ? process.env.PRODIGI_API_KEY : process.env.PRODIGI_SANDBOX_API_KEY) || '';
export const prodigiIngesteld = (omg) => !!sleutel(omg);
const ok2 = (s) => s >= 200 && s < 300;
const bedrag = (x) => (x && x.amount != null ? Number(x.amount) : null);

export async function instellingen() {
  const rij = (await db('kanaal_instellingen?kanaal=eq.prodigi&select=waarden'))?.[0];
  return { ...STANDAARD_PRODIGI, ...(rij?.waarden || {}) };
}
export async function zetInstellingen(w) {
  const schoon = {};
  if ('aan' in w) schoon.aan = !!w.aan;
  if ('sandbox' in w) schoon.sandbox = !!w.sandbox;
  if (VERZENDMETHODEN.includes(w.verzendmethode)) schoon.verzendmethode = w.verzendmethode;
  if (w.wachttijd_min !== undefined && Number.isFinite(Number(w.wachttijd_min))) schoon.wachttijd_min = Math.max(0, Math.min(7 * 24 * 60, Math.round(Number(w.wachttijd_min))));
  if (Array.isArray(w.branding)) {
    schoon.branding = w.branding.filter((x) => INSERTS[x?.type] && /^https:\/\/\S+$/.test(String(x.url || ''))).slice(0, 8)
      .map((x) => ({ type: x.type, url: String(x.url).slice(0, 500), verplicht: !!x.verplicht }));
  }
  if (['blokkeren', 'alternatief', 'zonder'].includes(w.branding_beleid)) schoon.branding_beleid = w.branding_beleid;
  if ('branding_alternatief' in w) schoon.branding_alternatief = INSERTS[w.branding_alternatief] ? w.branding_alternatief : null;
  const huidig = (await db('kanaal_instellingen?kanaal=eq.prodigi&select=waarden'))?.[0]?.waarden || {};
  const nieuw = { ...huidig, ...schoon };
  if (nieuw.branding_beleid === 'alternatief' && !(nieuw.branding || []).some((x) => x.type === nieuw.branding_alternatief))
    return { fout: 'Kies als alternatief een merktoevoeging die je ook hebt ingesteld (met afbeelding).' };
  await db('kanaal_instellingen?on_conflict=kanaal', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { kanaal: 'prodigi', waarden: nieuw, bijgewerkt_op: new Date().toISOString() } });
  return { ...STANDAARD_PRODIGI, ...nieuw };
}

async function call(omg, method, pad, body) {
  const r = await fetch(`${BASIS[omg]}${pad}`, {
    method, headers: { 'X-API-Key': sleutel(omg), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await r.text();
  let data = null;
  try { data = tekst ? JSON.parse(tekst) : null; } catch { data = tekst; }
  return { status: r.status, data };
}
export const foutTekst = (d) => {
  if (d && typeof d === 'object') {
    const f = d.failures || d.errors;
    if (f && typeof f === 'object') return JSON.stringify(f).slice(0, 400);
    return String(d.statusText || d.outcome || d.message || JSON.stringify(d)).slice(0, 400);
  }
  return String(d ?? '').slice(0, 400);
};

export const callbackToken = () => onderteken('prodigi-callback').slice(0, 40);
export function callbackGeldig(t) {
  const a = crypto.createHash('sha256').update(String(t || '')).digest(), b = crypto.createHash('sha256').update(callbackToken()).digest();
  return crypto.timingSafeEqual(a, b);
}
export const callbackUrl = () => `${bedrijf().site}/api/prodigi?actie=callback&t=${callbackToken()}`;

// =============================== catalogus ===============================
const naarMm = (v, units) => Number(v) * ({ mm: 1, cm: 10, in: 25.4, inch: 25.4, inches: 25.4 }[String(units || 'cm').toLowerCase()] || 10);

/**
 * Controleert het Prodigi-product van een variant bij Prodigi zelf. Pure beoordeling van het antwoord van
 * GET /products/{sku}: product, gekozen opties, maat, pixeleis en levering naar NL/BE.
 */
export function beoordeelProduct(product, variantRij, formaatMm, landen = ['NL', 'BE']) {
  const p = [];
  const opties = product.attributes || {};
  const gekozen = { ...(variantRij.prodigi_attributen || {}) };
  for (const [naam, waarden] of Object.entries(opties)) {
    if (!Array.isArray(waarden) || !waarden.length) continue;
    if (gekozen[naam] == null) { if (waarden.length === 1) gekozen[naam] = waarden[0]; else p.push(`kies een waarde voor "${naam}" (${waarden.join(', ')})`); }
    else if (!waarden.includes(gekozen[naam])) p.push(`"${gekozen[naam]}" is geen geldige waarde voor "${naam}" (${waarden.join(', ')})`);
  }
  for (const k of Object.keys(gekozen)) if (!opties[k]) p.push(`optie "${k}" bestaat niet bij dit product`);
  const passend = (product.variants || []).filter((v) => Object.entries(v.attributes || {}).every(([k, w]) => gekozen[k] == null || gekozen[k] === w));
  if (!passend.length && !p.length) p.push('geen leverbare uitvoering met deze opties');
  const vk = passend[0];
  const lev = vk?.shipsTo || [];
  for (const l of landen) if (vk && !lev.includes(l)) p.push(`wordt niet geleverd in ${l}`);
  const pa = vk?.printAreaSizes?.default || null;
  const px = pa ? { b: Number(pa.horizontalResolution), h: Number(pa.verticalResolution) } : null;
  const d = product.productDimensions;
  const mm = d ? [Math.round(naarMm(d.width, d.units) * 10) / 10, Math.round(naarMm(d.height, d.units) * 10) / 10] : null;
  if (mm && formaatMm) {
    // Prodigi geeft soms de nominale maat (lijst: 30 × 40 cm bij een print van 12 × 16 inch); de pixeleis is leidend.
    const zelfde = (a, b) => Math.abs(a - b) <= Math.max(5, b * 0.02);
    if (!(zelfde(mm[0], formaatMm[0]) && zelfde(mm[1], formaatMm[1])) && !(zelfde(mm[1], formaatMm[0]) && zelfde(mm[0], formaatMm[1])))
      p.push(`productiemaat is ${mm[0]} × ${mm[1]} mm, het formaat ${formaatMm[0]} × ${formaatMm[1]} mm`);
  }
  if (product.printAreas && !product.printAreas.default) p.push('product heeft geen standaard drukvlak');
  return {
    status: p.length ? 'ongeldig' : 'bevestigd', melding: p.length ? p.join('; ') : null, attributen: gekozen,
    product: { omschrijving: product.description || '', mm, px, landen: lev, opties },
  };
}

export async function productControle(skuIn) {
  const v = (await db(`varianten?sku=eq.${encodeURIComponent(String(skuIn || ''))}&select=*`))?.[0];
  if (!v) return { fout: 'Variant niet gevonden.' };
  if (!v.prodigi_sku) return { fout: 'Vul eerst de Prodigi-artikelcode in.' };
  const s = await instellingen(), omg = omgevingVan(s);
  if (!prodigiIngesteld(omg)) return { fout: `Prodigi-sleutel voor ${omg} ontbreekt in Vercel (${omg === 'live' ? 'PRODIGI_API_KEY' : 'PRODIGI_SANDBOX_API_KEY'}).` };
  const r = await call(omg, 'GET', `/products/${encodeURIComponent(v.prodigi_sku)}`);
  let uit;
  if (r.status === 404) uit = { status: 'ongeldig', melding: `Prodigi kent artikelcode ${v.prodigi_sku} niet`, attributen: v.prodigi_attributen, product: null };
  else if (r.status !== 200 || !r.data?.product) return { fout: `Prodigi antwoordde ${r.status}: ${foutTekst(r.data)}` };
  else uit = beoordeelProduct(r.data.product, v, ALLE_FORMATEN[v.formaat_id]?.mm);
  const nu = new Date().toISOString();
  await db(`varianten?sku=eq.${encodeURIComponent(v.sku)}`, { method: 'PATCH', body: {
    prodigi_status: uit.status, prodigi_melding: uit.melding, prodigi_attributen: uit.attributen || {},
    prodigi_product: uit.product ? { ...uit.product, omgeving: omg } : null, prodigi_gecontroleerd_op: nu, bijgewerkt_op: nu,
  } });
  // Het drukbestand opnieuw toetsen aan de eisen van dit product.
  if (v.drukbestand_id && uit.product) {
    const d = (await db(`drukbestand_versies?id=eq.${v.drukbestand_id}&select=*`))?.[0];
    if (d) {
      const q = beoordeel({ mime: d.mime, breedte_px: d.breedte_px, hoogte_px: d.hoogte_px, pagina_mm: d.pagina_breedte_mm ? [Number(d.pagina_breedte_mm), Number(d.pagina_hoogte_mm)] : null },
        doelVoor({ ...v, prodigi_status: uit.status, prodigi_product: uit.product }));
      await db(`drukbestand_versies?id=eq.${d.id}`, { method: 'PATCH', body: { controles: q.controles, status: q.status } });
      uit.drukbestand = q.status;
    }
  }
  return { ok: true, ...uit, melding: uit.status === 'bevestigd' ? `Prodigi-product ${v.prodigi_sku} bevestigd` : `Niet bevestigd: ${uit.melding}` };
}

function quoteSamenvatting(q, gevraagd = []) {
  const c = q.costSummary || {};
  const geleverd = (q.branding?.inserts || []).map((x) => x.id || x.type || x.name).filter(Boolean);
  return {
    methode: q.shipmentMethod, valuta: c.totalCost?.currency || c.items?.currency || 'EUR',
    artikel: bedrag(c.items), verzending: bedrag(c.shipping), merk: bedrag(c.branding) || 0, btw: bedrag(c.totalTax), totaal: bedrag(c.totalCost),
    vervoerder: q.shipments?.[0]?.carrier ? `${q.shipments[0].carrier.name || ''} ${q.shipments[0].carrier.service || ''}`.trim() : null,
    productielocatie: q.shipments?.[0]?.fulfillmentLocation?.countryCode || null,
    merk_gevraagd: gevraagd, merk_geleverd: geleverd,
  };
}

async function quote(omg, { items, land, methode, inserts = [] }) {
  return call(omg, 'POST', '/quotes', {
    shippingMethod: String(methode || 'Standard').toLowerCase(), destinationCountryCode: land, currencyCode: 'EUR',
    items: items.map((i) => ({ sku: i.sku, copies: i.copies, attributes: i.attributes || {}, assets: [{ printArea: 'default' }] })),
    ...(inserts.length ? { branding: { inserts } } : {}),
  });
}

/** Actuele kosten van een variant (1 stuk naar NL) inclusief de ingestelde merktoevoegingen. */
export async function offerte(skuIn, { land = 'NL' } = {}) {
  const v = (await db(`varianten?sku=eq.${encodeURIComponent(String(skuIn || ''))}&select=*`))?.[0];
  if (!v) return { fout: 'Variant niet gevonden.' };
  if (v.prodigi_status !== 'bevestigd') return { fout: 'Controleer eerst het Prodigi-product van deze variant.' };
  const s = await instellingen(), omg = omgevingVan(s);
  if (!prodigiIngesteld(omg)) return { fout: `Prodigi-sleutel voor ${omg} ontbreekt in Vercel.` };
  const inserts = (s.branding || []).map((x) => x.type);
  const r = await quote(omg, { items: [{ sku: v.prodigi_sku, copies: 1, attributes: v.prodigi_attributen }], land, methode: v.verzendmethode || s.verzendmethode, inserts });
  const q = r.data?.quotes?.[0];
  if (!ok2(r.status) || !q) return { fout: `Offerte mislukt (${r.status}): ${foutTekst(r.data)}` };
  const k = { ...quoteSamenvatting(q, inserts), land, omgeving: omg };
  const nu = new Date().toISOString();
  const kostprijs = k.totaal != null && k.btw != null ? Math.round((k.totaal - k.btw) * 100) / 100 : k.totaal;
  await db(`varianten?sku=eq.${encodeURIComponent(v.sku)}`, { method: 'PATCH', body: { kosten: k, kosten_gecontroleerd_op: nu, kostprijs, bijgewerkt_op: nu } });
  return { ok: true, kosten: k, kostprijs, melding: `Kosten bijgewerkt: € ${kostprijs == null ? '?' : kostprijs.toFixed(2).replace('.', ',')} excl. btw (${k.methode}, ${land})` };
}

// ---- proefbestelling: kosten + adres tonen, pas na expliciete bevestiging plaatsen ----
function adresVan(a) {
  const x = a && typeof a === 'object' ? a : {};
  const t = (v, m) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, m);
  const adres = { naam: t(x.naam, 100), straat: t(x.straat, 120), postcode: t(x.postcode, 12).toUpperCase(), plaats: t(x.plaats, 80), land: t(x.land, 2).toUpperCase(), email: t(x.email, 160) };
  const mist = ['naam', 'straat', 'postcode', 'plaats', 'land'].filter((k) => !adres[k] || (k === 'land' && !/^[A-Z]{2}$/.test(adres.land)));
  return mist.length ? { fout: `Afleveradres onvolledig: ${mist.join(', ')}.` } : { adres };
}

export async function proefOfferte({ regels, adres, verzendmethode }) {
  const a = adresVan(adres);
  if (a.fout) return a;
  if (!Array.isArray(regels) || !regels.length || regels.length > 10) return { fout: 'Kies één of meer varianten.' };
  const s = await instellingen(), omg = omgevingVan(s);
  if (!prodigiIngesteld(omg)) return { fout: `Prodigi-sleutel voor ${omg} ontbreekt in Vercel.` };
  const items = [];
  for (const r of regels) {
    const v = VARIANTEN[String(r.sku || '')];
    const aantal = Math.max(1, Math.min(10, Number(r.aantal) || 1));
    if (!v) return { fout: `Variant ${r.sku} bestaat niet.` };
    if (v.prodigi_status !== 'bevestigd') return { fout: `Prodigi-product van ${v.sku} is nog niet bevestigd.` };
    if (!v.drukbestand_id) return { fout: `Drukbestand ontbreekt voor ${v.sku}.` };
    if (v.drukbestand_status === 'afgekeurd' && !v.qc_uitzondering) return { fout: `Drukbestand van ${v.sku} is afgekeurd (zonder bevestigde uitzondering).` };
    items.push({ sku: v.prodigi_sku, copies: aantal, attributes: v.prodigi_attributen, variant: v.sku, drukbestand_id: v.drukbestand_id, sizing: v.sizing });
  }
  const methode = VERZENDMETHODEN.includes(verzendmethode) ? verzendmethode : s.verzendmethode;
  const inserts = (s.branding || []).map((x) => x.type);
  const q = await quote(omg, { items, land: a.adres.land, methode, inserts });
  const qq = q.data?.quotes?.[0];
  if (!ok2(q.status) || !qq) return { fout: `Offerte mislukt (${q.status}): ${foutTekst(q.data)}` };
  const offerteData = quoteSamenvatting(qq, inserts);
  const [rij] = await db('proefbestellingen', { method: 'POST', prefer: 'return=representation', body: {
    regels: items, adres: a.adres, verzendmethode: methode, omgeving: omg, offerte: offerteData, idempotentie_sleutel: `skiffa-proef-${crypto.randomUUID()}`,
  } });
  return { ok: true, id: rij.id, omgeving: omg, adres: a.adres, offerte: offerteData, geldig_tot: new Date(Date.now() + 30 * 60000).toISOString() };
}

export async function proefPlaatsen({ id, bevestigd }) {
  if (bevestigd !== true) return { fout: 'Bevestig eerst de kosten en het afleveradres.' };
  if (!/^[0-9a-f-]{36}$/.test(String(id || ''))) return { fout: 'Onbekende proefbestelling.' };
  const grens = new Date(Date.now() - 30 * 60000).toISOString();
  // Atomair van 'offerte' naar 'bezig': een dubbele klik plaatst niets twee keer.
  const p = (await db(`proefbestellingen?id=eq.${id}&status=eq.offerte&aangemaakt_op=gte.${encodeURIComponent(grens)}`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'bezig' } }))?.[0];
  if (!p) return { fout: 'Deze offerte is al gebruikt of verlopen (30 minuten). Vraag een nieuwe offerte aan.' };
  const s = await instellingen();
  const items = [];
  for (const [i, r] of p.regels.entries()) {
    const d = (await db(`drukbestand_versies?id=eq.${r.drukbestand_id}&select=pad`))?.[0];
    if (!d) { await db(`proefbestellingen?id=eq.${id}`, { method: 'PATCH', body: { status: 'fout', laatste_fout: 'drukbestand niet gevonden' } }); return { fout: 'Drukbestand niet gevonden.' }; }
    items.push({ merchantReference: `${r.variant}-${i + 1}`, sku: r.sku, copies: r.copies, sizing: r.sizing || 'fitPrintArea', attributes: r.attributes || {},
      assets: [{ printArea: 'default', url: await downloadUrl('drukbestanden', d.pad, 7 * 86400) }] });
  }
  const ref = `PROEF-${id.slice(0, 8).toUpperCase()}`;
  const body = {
    merchantReference: ref, idempotencyKey: p.idempotentie_sleutel, shippingMethod: p.verzendmethode, callbackUrl: callbackUrl(),
    recipient: { name: p.adres.naam, ...(p.adres.email ? { email: p.adres.email } : {}), address: { line1: p.adres.straat, postalOrZipCode: p.adres.postcode, countryCode: p.adres.land, townOrCity: p.adres.plaats } },
    items, metadata: { skiffa_proef: id }, ...brandingBody(s, p.offerte?.merk_geleverd || []),
  };
  let r;
  try { r = await call(p.omgeving, 'POST', '/orders', body); } catch (e) { r = { status: 0, data: e.message }; }
  let order = r.data?.order;
  if (!(ok2(r.status) && order?.id) && (r.status === 0 || r.status >= 500)) order = await zoekOrder(p.omgeving, ref, (o) => o?.metadata?.skiffa_proef === id);
  if (order?.id) {
    await db(`proefbestellingen?id=eq.${id}`, { method: 'PATCH', body: { status: 'geplaatst', extern_id: order.id, geplaatst_op: new Date().toISOString(), laatste_fout: null } });
    return { ok: true, extern_id: order.id, melding: `Proefbestelling geplaatst bij Prodigi (${p.omgeving}, ${order.id})` };
  }
  await db(`proefbestellingen?id=eq.${id}`, { method: 'PATCH', body: { status: 'fout', laatste_fout: `(${r.status || 'netwerk'}) ${foutTekst(r.data)}` } });
  return { fout: `Prodigi plaatste de proefbestelling niet (${r.status || 'netwerk'}): ${foutTekst(r.data)}` };
}

// =============================== orders ===============================
const fulfilment = async (filter) => (await db(`fulfilments?${filter}&select=*&order=herdruk_nr.asc&limit=1`))?.[0] || null;
const zet = (id, velden) => db(`fulfilments?id=eq.${id}`, { method: 'PATCH', body: { ...velden, bijgewerkt_op: new Date().toISOString() } });

/** Na betaling of import: productie aanmelden (doet niets als Prodigi uit staat of al aangemeld is). */
export async function aanmelden(o, door = 'systeem') {
  const s = await instellingen();
  if (!s.aan) return { aangemeld: false, reden: 'Prodigi staat uit' };
  const omg = omgevingVan(s);
  const vanaf = new Date(Date.now() + s.wachttijd_min * 60000).toISOString();
  const rijen = await db('fulfilments?on_conflict=bestelling_id,herdruk_nr', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { bestelling_id: o.id, herdruk_nr: 0, omgeving: omg, status: 'wacht', idempotentie_sleutel: `skiffa-${omg}-${o.id}`, vanaf },
  });
  if (!rijen?.length) return { aangemeld: false, reden: 'al aangemeld' };
  await log(o.id, 'prodigi', `aangemeld voor productie bij Prodigi (${omg}); wijzigen kan tot ${new Date(vanaf).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}`, door);
  if (!s.wachttijd_min) await verwerk({ bestellingId: o.id });
  return { aangemeld: true, vanaf };
}

/** Herdruk: een nieuwe, expliciet bevestigde productieopdracht bij dezelfde bestelling. */
export async function herdruk(bestellingId, { reden, bevestigd } = {}, door = 'admin') {
  if (bevestigd !== true) return { fout: 'Bevestig de herdruk expliciet: er wordt opnieuw (betaald) geproduceerd.' };
  if (String(reden || '').trim().length < 3) return { fout: 'Geef een reden voor de herdruk.' };
  const b = await haalBestelling('id', bestellingId);
  if (!b?.betaald_op || b.status === 'geannuleerd') return { fout: 'Alleen betaalde, niet-geannuleerde bestellingen kunnen opnieuw worden gedrukt.' };
  const s = await instellingen(), omg = omgevingVan(s);
  const nr = ((await db(`fulfilments?bestelling_id=eq.${bestellingId}&select=herdruk_nr&order=herdruk_nr.desc&limit=1`))?.[0]?.herdruk_nr ?? 0) + 1;
  await db('fulfilments', { method: 'POST', body: { bestelling_id: bestellingId, herdruk_nr: nr, herdruk_reden: String(reden).trim().slice(0, 300), omgeving: omg, status: 'wacht', idempotentie_sleutel: `skiffa-${omg}-${bestellingId}-h${nr}`, vanaf: new Date().toISOString() } });
  await log(bestellingId, 'prodigi', `herdruk ${nr} aangevraagd: ${String(reden).trim()}`, door);
  await verwerk({ bestellingId });
  return { ok: true, herdruk_nr: nr, melding: `Herdruk ${nr} aangevraagd` };
}

/** Wat moet er kloppen voordat een bestelling naar Prodigi mag? Lege lijst = in orde. */
export function controleer(b, regelsMetDruk, f) {
  const p = [];
  if (!b.betaald_op) p.push('Betaling niet bevestigd.');
  if (b.status === 'geannuleerd') p.push('Bestelling is geannuleerd.');
  if (Number(b.terugbetaald) > 0 && !f?.vrijgegeven_reden && !f?.herdruk_nr) p.push('Er is (deels) terugbetaald: beslis of de productie doorgaat ("toch produceren").');
  for (const [k, n] of [['naam', 'naam'], ['straat', 'straat en huisnummer'], ['postcode', 'postcode'], ['plaats', 'plaats'], ['land', 'land']])
    if (!String(b[k] || '').trim()) p.push(`Afleveradres onvolledig: ${n} ontbreekt.`);
  if (!regelsMetDruk.length) p.push('Geen orderregels.');
  for (const r of regelsMetDruk) {
    const naam = `${r.naam || r.poster_naam} ${r.formaatLabel || r.formaat_label}`;
    const v = VARIANTEN[r.variant_sku];
    const prodigiSku = r.prodigi_sku || v?.prodigi_sku;
    if (!prodigiSku) p.push(`Variant niet gekoppeld aan een Prodigi-product: ${naam}.`);
    else if (!r.prodigi_sku && v && v.prodigi_status !== 'bevestigd') p.push(`Prodigi-product niet bevestigd: ${naam}.`);
    if (!r.druk) p.push(`Drukbestand ontbreekt voor ${naam}.`);
    else if (r.druk.status === 'afgekeurd' && !(v && v.drukbestand_id === r.druk.versie_id && v.qc_uitzondering)) p.push(`Drukbestand afgekeurd voor ${naam}.`);
  }
  return p;
}

function brandingBody(s, geleverd) {
  const keuze = (s.branding || []).filter((x) => geleverd.includes(x.type));
  return keuze.length ? { branding: Object.fromEntries(keuze.map((x) => [x.type, { url: x.url }])) } : {};
}

/** Merktoevoegingen voor deze zending: wat kan Prodigi leveren, en wat doet het beleid als iets ontbreekt? */
async function bepaalBranding(f, s, items, land) {
  const gevraagd = (s.branding || []).map((x) => x.type);
  if (!gevraagd.length) return { body: {}, info: null };
  const q = await quote(f.omgeving, { items, land, methode: s.verzendmethode, inserts: gevraagd });
  const qq = q.data?.quotes?.[0];
  if (!ok2(q.status) || !qq) return { tijdelijk: q.status === 0 || q.status >= 500 || q.status === 429, fout: `merktoevoegingen controleren mislukt (${q.status}): ${foutTekst(q.data)}` };
  const geleverd = (qq.branding?.inserts || []).map((x) => x.id || x.type || x.name).filter(Boolean);
  const mist = (s.branding || []).filter((x) => x.verplicht && !geleverd.includes(x.type));
  let gebruik = geleverd;
  if (mist.length) {
    const namen = mist.map((x) => INSERTS[x.type]).join(', ');
    if (s.branding_beleid === 'blokkeren') return { blokkeer: `Verplichte SKIFFA-merktoevoeging niet beschikbaar voor deze zending: ${namen}.` };
    if (s.branding_beleid === 'alternatief') {
      if (!geleverd.includes(s.branding_alternatief)) return { blokkeer: `Verplichte merktoevoeging (${namen}) én het alternatief (${INSERTS[s.branding_alternatief] || 'geen'}) niet beschikbaar.` };
    }
    // 'zonder': expliciet toegestaan om zonder te verzenden.
  }
  return { body: brandingBody(s, gebruik), info: { gevraagd, geleverd: gebruik, ontbrak: mist.map((x) => x.type), beleid: mist.length ? s.branding_beleid : null } };
}

async function bouwItems(b, regels) {
  const items = [];
  for (const [i, r] of regels.entries()) {
    const v = VARIANTEN[r.variant_sku];
    items.push({
      merchantReference: `${b.nummer}-R${r.id}`, sku: r.prodigi_sku || v?.prodigi_sku, copies: r.aantal, sizing: r.sizing || v?.sizing || 'fitPrintArea',
      attributes: r.prodigi_attributen || v?.prodigi_attributen || {},
      assets: [{ printArea: 'default', url: await downloadUrl('drukbestanden', r.druk.pad, 7 * 86400) }],
    });
  }
  return items;
}

/** Zoek een order bij Prodigi op onze referentie (na een onduidelijk antwoord). */
async function zoekOrder(omg, merchantReference, past) {
  const r = await call(omg, 'GET', `/orders?top=20&merchantReferences=${encodeURIComponent(merchantReference)}`);
  if (r.status !== 200) throw new Error(`opzoeken mislukt (${r.status}): ${foutTekst(r.data)}`);
  return (r.data?.orders || []).find(past) || null;
}
const referentie = (b, f) => (f.herdruk_nr ? `${b.nummer}-H${f.herdruk_nr}` : b.nummer);

async function geslaagd(f, b, order, extra = '') {
  await zet(f.id, { status: 'verstuurd', extern_id: order.id, extern_status: order.status?.stage || null, laatste_fout: null, verstuurd_op: new Date().toISOString() });
  await log(b.id, 'prodigi', `${f.herdruk_nr ? `herdruk ${f.herdruk_nr} ` : ''}naar Prodigi (${f.omgeving}, order ${order.id})${extra}`, 'prodigi');
  if (!f.herdruk_nr && b.status === 'betaald') await werkBij(b.id, { status: 'in_productie' });
  return 'verstuurd';
}

async function verstuur(f, s) {
  const b = await haalBestelling('id', f.bestelling_id);
  const regels = b ? await metDrukbestanden((b.bestelregels || []).map((r) => ({ ...r, naam: r.poster_naam, formaatLabel: r.formaat_label }))) : [];
  const problemen = b ? controleer(b, regels, f) : ['Bestelling niet gevonden.'];
  if (problemen.length) {
    await zet(f.id, { status: 'geblokkeerd', laatste_fout: problemen.join(' ').slice(0, 500) });
    if (b) await log(b.id, 'waarschuwing', `Niet naar Prodigi: ${problemen.join(' ')} Los het op en klik "opnieuw proberen".`, 'prodigi');
    return 'geblokkeerd';
  }
  if (!prodigiIngesteld(f.omgeving)) {
    await zet(f.id, { status: 'opnieuw', laatste_fout: `sleutel voor ${f.omgeving} ontbreekt in Vercel`, vanaf: new Date(Date.now() + 15 * 60000).toISOString() });
    return 'opnieuw';
  }
  const items = await bouwItems(b, regels);
  const br = await bepaalBranding(f, s, items, b.land);
  if (br.blokkeer) {
    await zet(f.id, { status: 'geblokkeerd', laatste_fout: br.blokkeer });
    await log(b.id, 'waarschuwing', br.blokkeer, 'prodigi');
    return 'geblokkeerd';
  }
  if (br.fout) {
    await zet(f.id, { status: br.tijdelijk && f.pogingen < MAX_POGINGEN ? 'opnieuw' : 'fout', laatste_fout: br.fout, vanaf: new Date(Date.now() + f.pogingen * 5 * 60000).toISOString() });
    return br.tijdelijk ? 'opnieuw' : 'fout';
  }
  if (br.info) await zet(f.id, { branding: br.info });
  const ref = referentie(b, f);
  const body = {
    merchantReference: ref, idempotencyKey: f.idempotentie_sleutel, shippingMethod: s.verzendmethode, callbackUrl: callbackUrl(),
    recipient: {
      name: b.naam, ...((b.kanaal || 'webshop') === 'webshop' && b.email ? { email: b.email } : {}),
      address: { line1: b.straat, postalOrZipCode: b.postcode, countryCode: b.land, townOrCity: b.plaats },
    },
    items, ...br.body, metadata: { skiffa_bestelling: b.id, skiffa_fulfilment: f.id, kanaal: b.kanaal || 'webshop' },
  };
  let res;
  try { res = await call(f.omgeving, 'POST', '/orders', body); } catch (e) { res = { status: 0, data: e.message }; }
  const order = res.data?.order;
  if (ok2(res.status) && order?.id) return geslaagd(f, b, order, res.data?.outcome && !/^created$/i.test(res.data.outcome) ? `, ${res.data.outcome}` : '');
  if (res.status === 429) {   // zeker niet aangemaakt: gewoon later opnieuw
    await zet(f.id, { status: 'opnieuw', laatste_fout: '(429) te veel verzoeken', vanaf: new Date(Date.now() + 5 * 60000).toISOString() });
    return 'opnieuw';
  }
  if (res.status === 0 || res.status >= 500) {   // onduidelijk: misschien wél aangemaakt
    await zet(f.id, { status: 'onzeker', laatste_fout: `(${res.status || 'netwerk'}) ${foutTekst(res.data)} — wordt bij Prodigi gecontroleerd voordat er opnieuw wordt besteld`, vanaf: new Date(Date.now() + 60000).toISOString() });
    await log(b.id, 'waarschuwing', `Onduidelijk antwoord van Prodigi (${res.status || 'netwerk'}); de volgende run controleert eerst of de opdracht al bestaat.`, 'prodigi');
    return 'onzeker';
  }
  await zet(f.id, { status: 'fout', laatste_fout: `(${res.status}) ${foutTekst(res.data)}` });
  await log(b.id, 'fout', `Prodigi weigerde de opdracht (${res.status}): ${foutTekst(res.data)}. Los het op en klik "opnieuw proberen".`, 'prodigi');
  return 'fout';
}

/** Onzekere opdracht: bestaat hij al bij Prodigi? Ja → vastleggen; nee → veilig opnieuw (zelfde sleutel). */
async function controleerOnzeker(f) {
  const b = await haalBestelling('id', f.bestelling_id);
  if (!b) return 'fout';
  const controles = Number(f.laatste_fout?.match(/\[controle (\d+)\]/)?.[1] || 0) + 1;
  try {
    const order = await zoekOrder(f.omgeving, referentie(b, f), (o) => String(o?.metadata?.skiffa_fulfilment) === String(f.id));
    if (order) return geslaagd(f, b, order, ' (na controle: de opdracht bestond al)');
    await zet(f.id, { status: 'opnieuw', laatste_fout: 'Na controle niet gevonden bij Prodigi; wordt opnieuw aangeboden met dezelfde idempotentiesleutel.', vanaf: new Date().toISOString() });
    return 'opnieuw';
  } catch (e) {
    await zet(f.id, { status: 'onzeker', laatste_fout: `[controle ${controles}] ${e.message}${controles >= MAX_CONTROLES_ONZEKER ? ' — controle vereist in de administratie' : ''}`, vanaf: new Date(Date.now() + controles * 5 * 60000).toISOString() });
    return 'onzeker';
  }
}

/** Openstaande productieopdrachten verwerken (cron, na betaling of handmatig). */
export async function verwerk({ bestellingId, max = 10 } = {}) {
  const s = await instellingen();
  const uit = { verstuurd: 0, geblokkeerd: 0, fout: 0, opnieuw: 0, onzeker: 0, overgeslagen: 0 };
  if (!s.aan) return { ...uit, uit: true };
  await rpc('skiffa_vrijgeven_fulfilments', {}).catch(() => {});
  const nu = encodeURIComponent(new Date().toISOString()), filter = bestellingId ? `&bestelling_id=eq.${bestellingId}` : '';
  for (const { id } of await db(`fulfilments?status=eq.onzeker&vanaf=lte.${nu}${filter}&select=id&order=vanaf.asc&limit=${max}`)) {
    const g = (await rpc('skiffa_claim_onzeker', { p_id: id }))?.[0];
    if (!g) { uit.overgeslagen++; continue; }
    const r = await controleerOnzeker(g);
    uit[r] = (uit[r] || 0) + 1;
  }
  for (const { id } of await db(`fulfilments?status=in.(wacht,opnieuw)&vanaf=lte.${nu}${filter}&select=id&order=vanaf.asc&limit=${max}`)) {
    const g = (await rpc('skiffa_claim_fulfilment', { p_id: id }))?.[0];
    if (!g) { uit.overgeslagen++; continue; }   // iemand anders was eerder, of de bestelling is niet (meer) geldig
    const r = await verstuur(g, s);
    uit[r] = (uit[r] || 0) + 1;
  }
  return uit;
}


function kostenVan(order) {
  const ch = (order?.charges || []).filter(Boolean);
  if (!ch.length) return null;
  const som = (k) => ch.reduce((t, c) => t + (bedrag(c[k]) || 0), 0);
  return { totaal: Math.round(som('totalCost') * 100) / 100, btw: Math.round(som('totalTax') * 100) / 100, valuta: ch[0].totalCost?.currency || 'EUR', facturen: ch.map((c) => c.prodigiInvoiceNumber).filter(Boolean) };
}

/** Verwerk de actuele stand van een Prodigi-order in de administratie. */
async function verwerkOrder(f, order) {
  const stage = order?.status?.stage || null;
  const kosten = kostenVan(order);
  if ((stage && stage !== f.extern_status) || (kosten && JSON.stringify(kosten) !== JSON.stringify(f.kosten))) await zet(f.id, { ...(stage ? { extern_status: stage } : {}), ...(kosten ? { kosten } : {}) });
  if (stage === 'Cancelled' && f.status !== 'geannuleerd') {
    await zet(f.id, { status: 'geannuleerd' });
    await log(f.bestelling_id, 'fout', 'Prodigi heeft de productieopdracht geannuleerd. Controleer de bestelling.', 'prodigi');
    return 'geannuleerd';
  }
  // Zendingen (ook gesplitst): elke zending met tracking één keer vastleggen; klant en kanaal krijgen hem één keer.
  const regelVan = Object.fromEntries((order?.items || []).map((i) => [i.id, String(i.merchantReference || '').match(/-R(\d+)$/)?.[1] || null]));
  const metTracking = (order?.shipments || []).filter((z) => z?.tracking?.number || z?.tracking?.url);
  let nieuw = 0;
  for (const z of metTracking) {
    const regels = (z.items || []).map((x) => regelVan[x.itemId || x.id]).filter(Boolean);
    const r = await registreer({ bestellingId: f.bestelling_id, bron: 'prodigi', extern_ref: z.id || z.tracking.number || z.tracking.url,
      vervoerder: [z.carrier?.name, z.carrier?.service].filter(Boolean).join(' ') || null, tracking_code: z.tracking.number || null, tracking_url: z.tracking.url || null,
      regels: regels.length ? regels : null, fulfilment_id: f.id, door: 'prodigi' });
    if (r.nieuw) nieuw++;
  }
  if (metTracking.length) {
    const alleItems = (order.items || []).map((i) => i.id);
    const gedekt = metTracking.some((z) => !(z.items || []).length) || alleItems.every((id) => metTracking.some((z) => (z.items || []).some((x) => (x.itemId || x.id) === id)));
    const fst = gedekt || stage === 'Complete' ? 'verzonden' : 'in_productie';
    if (fst !== f.status) await zet(f.id, { status: fst });
    if (nieuw) return fst === 'verzonden' ? 'verzonden' : 'deels verzonden';
  }
  if (stage === 'InProgress' && f.status === 'verstuurd') await zet(f.id, { status: 'in_productie' });
  return stage || 'onbekend';
}

/** Statusmelding van Prodigi. De inhoud telt niet: de order wordt altijd opnieuw opgevraagd. */
export async function callback(body) {
  const id = body?.subject || body?.data?.order?.id || body?.order?.id || body?.data?.id;
  if (!id || !/^ord_[A-Za-z0-9]+$/.test(String(id))) return { ok: true, genegeerd: 'geen order-id' };
  const f = await fulfilment(`extern_id=eq.${id}`);
  if (!f) {
    const p = (await db(`proefbestellingen?extern_id=eq.${id}&select=id`))?.[0];
    return { ok: true, genegeerd: p ? 'proefbestelling' : 'onbekende order' };
  }
  const r = await call(f.omgeving, 'GET', `/orders/${id}`);
  if (r.status !== 200 || !r.data?.order) return { ok: false, melding: `order opvragen mislukt (${r.status})` };
  return { ok: true, resultaat: await verwerkOrder(f, r.data.order) };
}

/** Vangnet: open Prodigi-orders zonder recente update opnieuw opvragen. */
export async function statussen({ max = 10 } = {}) {
  const grens = new Date(Date.now() - 60 * 60000).toISOString();
  const open = await db(`fulfilments?status=in.(verstuurd,in_productie)&bijgewerkt_op=lt.${encodeURIComponent(grens)}&select=*&order=bijgewerkt_op.asc&limit=${max}`);
  let bijgewerkt = 0;
  for (const f of open) {
    const r = await call(f.omgeving, 'GET', `/orders/${f.extern_id}`).catch(() => null);
    if (r?.status === 200 && r.data?.order) { await verwerkOrder(f, r.data.order); bijgewerkt++; }
    await zet(f.id, {});   // bijgewerkt_op verschuiven, zodat de volgende run andere orders pakt
  }
  return { gecontroleerd: open.length, bijgewerkt };
}

// ---- acties vanuit de administratie ----
export async function opnieuw(bestellingId, door = 'admin') {
  const f = await fulfilment(`bestelling_id=eq.${bestellingId}&status=in.(fout,geblokkeerd,wacht,opnieuw,onzeker)`);
  if (!f) return { fout: 'Er staat geen productieopdracht klaar om opnieuw te proberen.' };
  if (f.status === 'onzeker') { await zet(f.id, { vanaf: new Date().toISOString() }); }
  else await zet(f.id, { status: 'opnieuw', vanaf: new Date().toISOString(), laatste_fout: null });
  await log(bestellingId, 'prodigi', 'opnieuw aangeboden aan Prodigi (zelfde idempotentiesleutel)', door);
  return { ok: true, resultaat: await verwerk({ bestellingId }) };
}

/** Bewust doorzetten ondanks een terugbetaling (met reden). */
export async function vrijgeven(bestellingId, reden, door = 'admin') {
  if (String(reden || '').trim().length < 5) return { fout: 'Geef een reden (minstens 5 tekens).' };
  const f = await fulfilment(`bestelling_id=eq.${bestellingId}&herdruk_nr=eq.0`);
  if (!f || !['geblokkeerd', 'wacht', 'opnieuw', 'fout'].includes(f.status)) return { fout: 'Er is geen geblokkeerde productieopdracht.' };
  await zet(f.id, { vrijgegeven_reden: String(reden).trim().slice(0, 300), status: 'opnieuw', vanaf: new Date().toISOString(), laatste_fout: null });
  await log(bestellingId, 'prodigi', `productie toch vrijgegeven: ${String(reden).trim()}`, door);
  return { ok: true, resultaat: await verwerk({ bestellingId }) };
}

export async function handmatigAanmelden(bestellingId, door = 'admin') {
  const b = await haalBestelling('id', bestellingId);
  if (!b?.betaald_op) return { fout: 'Alleen betaalde bestellingen kunnen naar Prodigi.' };
  const r = await aanmelden(b, door);
  return r.aangemeld ? { ok: true } : { fout: r.reden === 'al aangemeld' ? 'Deze bestelling is al bij Prodigi aangemeld.' : r.reden };
}

/** Een proeforder (sandbox) loskoppelen, zodat de bestelling live opnieuw kan. Live-orders nooit. */
export async function resetSandbox(bestellingId, door = 'admin') {
  const f = await fulfilment(`bestelling_id=eq.${bestellingId}&herdruk_nr=eq.0`);
  if (!f) return { fout: 'Niet aangemeld.' };
  if (f.omgeving !== 'sandbox') return { fout: 'Alleen proeforders (sandbox) kunnen opnieuw; een live-order gaat nooit twee keer.' };
  const s = await instellingen();
  if (s.sandbox) return { fout: 'Zet Prodigi eerst op live.' };
  await zet(f.id, { omgeving: 'live', status: 'wacht', idempotentie_sleutel: `skiffa-live-${bestellingId}`, extern_id: null, extern_status: null, laatste_fout: null, pogingen: 0, vanaf: new Date().toISOString() });
  await log(bestellingId, 'prodigi', 'proeforder losgekoppeld; wordt live naar Prodigi verstuurd', door);
  return { ok: true };
}

/** Productie annuleren (los van terugbetalen). Vóór verzending: tegenhouden; daarna bij Prodigi. */
export async function annuleer(bestellingId, door = 'admin') {
  const f = await fulfilment(`bestelling_id=eq.${bestellingId}&status=neq.geannuleerd&status=neq.verzonden`);
  if (!f) return { fout: 'Er is geen productieopdracht om te annuleren.' };
  if (!f.extern_id && ['wacht', 'opnieuw', 'geblokkeerd', 'fout'].includes(f.status)) {
    await zet(f.id, { status: 'geannuleerd' });
    await log(bestellingId, 'prodigi', 'productie geannuleerd vóór verzending naar Prodigi', door);
    return { ok: true, melding: 'Productie geannuleerd; er is niets naar Prodigi gegaan.' };
  }
  if (!f.extern_id) return { fout: `Kan nu niet: status is ${f.status}. Probeer het zo opnieuw.` };
  const r = await call(f.omgeving, 'POST', `/orders/${f.extern_id}/actions/cancel`, {});
  const uitkomst = String(r.data?.outcome || '').toLowerCase();
  if (ok2(r.status) && (!uitkomst || uitkomst === 'cancelled')) {
    await zet(f.id, { status: 'geannuleerd', extern_status: 'Cancelled' });
    await log(bestellingId, 'prodigi', `productieopdracht ${f.extern_id} bij Prodigi geannuleerd`, door);
    return { ok: true, melding: 'Geannuleerd bij Prodigi.' };
  }
  await log(bestellingId, 'fout', `annuleren bij Prodigi mislukt (${r.status}${uitkomst ? `, ${uitkomst}` : ''}): ${foutTekst(r.data)}`, door);
  return { fout: `Prodigi annuleerde niet (${uitkomst || r.status}); waarschijnlijk is de opdracht al in productie.` };
}

export async function ping(omg) {
  if (!prodigiIngesteld(omg)) return { ok: false, info: `sleutel voor ${omg} ontbreekt (${omg === 'live' ? 'PRODIGI_API_KEY' : 'PRODIGI_SANDBOX_API_KEY'})` };
  const r = await call(omg, 'GET', '/orders?top=1');
  return { ok: r.status === 200, info: r.status === 200 ? `verbonden met Prodigi (${omg})` : `(${r.status}) ${foutTekst(r.data)}` };
}

export async function overzicht() {
  const s = await instellingen();
  const rijen = await db('fulfilments?select=status');
  const tel = {};
  for (const r of rijen) tel[r.status] = (tel[r.status] || 0) + 1;
  const aandacht = await db('fulfilments?status=in.(fout,geblokkeerd,onzeker)&select=bestelling_id,status,laatste_fout,bijgewerkt_op,herdruk_nr,bestellingen(nummer)&order=bijgewerkt_op.desc&limit=30').catch(() => []);
  const proef = await db('proefbestellingen?select=id,status,extern_id,omgeving,offerte,aangemaakt_op,geplaatst_op,laatste_fout&order=aangemaakt_op.desc&limit=10').catch(() => []);
  return { instellingen: s, sleutels: { sandbox: prodigiIngesteld('sandbox'), live: prodigiIngesteld('live') }, tellers: tel, aandacht, proef,
    callbackUrl: callbackUrl().replace(/t=.*/, 't=…'), verzendmethoden: VERZENDMETHODEN, inserts: INSERTS };
}

export const fulfilmentsVan = (bestellingId) => db(`fulfilments?bestelling_id=eq.${bestellingId}&select=*&order=herdruk_nr.asc`);
export const fulfilmentVan = (bestellingId) => fulfilment(`bestelling_id=eq.${bestellingId}&herdruk_nr=eq.0`);
