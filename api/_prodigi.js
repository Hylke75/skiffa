// Fulfilment via Prodigi (Print API v4). Elke betaalde bestelling gaat hooguit één keer naar Prodigi:
// zie supabase/migrations/20261029040000_prodigi.sql (één fulfilmentregel per bestelling, atomaire
// claim) en de vaste idempotentiesleutel per bestelling die bij elke poging wordt meegestuurd.
//
//   aanmelden(o)       na betaling (webshop) of import (kanaal): regel 'wacht', verstuurd na de wachttijd
//   verwerk()          cron of handmatig: claimen → controleren → versturen (max. 10 per run)
//   statussen()        vangnet als een callback van Prodigi wegvalt: open orders opnieuw opvragen
//   callback(body)     statusmelding van Prodigi (via /api/prodigi?actie=callback&t=…): in productie,
//                      verzonden (track-and-trace → klantmail of kanaal), geannuleerd
//
// Sleutels (Vercel): PRODIGI_SANDBOX_API_KEY en PRODIGI_API_KEY (live). Instellingen in /admin → kanalen.
import { db, rpc, haalBestelling, werkBij, log } from './_db.js';
import { ALLE_FORMATEN } from './_catalogus.js';
import { downloadUrl } from './_opslag.js';
import { drukbestanden } from './_media.js';
import { mails, vanRij } from './_mails.js';
import { bedrijf } from './_bedrijf.js';
import crypto from 'node:crypto';
import { onderteken } from './_auth.js';

export const BASIS = { sandbox: 'https://api.sandbox.prodigi.com/v4.0', live: 'https://api.prodigi.com/v4.0' };
export const STANDAARD_PRODIGI = { aan: false, sandbox: true, verzendmethode: 'Standard', wachttijd_min: 30, sizing: 'fillPrintArea' };
export const VERZENDMETHODEN = ['Budget', 'Standard', 'Express', 'Overnight'];
export const MAX_POGINGEN = 5;
const omgevingVan = (s) => (s.sandbox ? 'sandbox' : 'live');
const sleutel = (omg) => (omg === 'live' ? process.env.PRODIGI_API_KEY : process.env.PRODIGI_SANDBOX_API_KEY) || '';
export const prodigiIngesteld = (omg) => !!sleutel(omg);

export async function instellingen() {
  const rij = (await db('kanaal_instellingen?kanaal=eq.prodigi&select=waarden'))?.[0];
  return { ...STANDAARD_PRODIGI, ...(rij?.waarden || {}) };
}
export async function zetInstellingen(w) {
  const schoon = {};
  if ('aan' in w) schoon.aan = !!w.aan;
  if ('sandbox' in w) schoon.sandbox = !!w.sandbox;
  if (VERZENDMETHODEN.includes(w.verzendmethode)) schoon.verzendmethode = w.verzendmethode;
  if (w.wachttijd_min !== undefined && Number.isFinite(Number(w.wachttijd_min))) schoon.wachttijd_min = Math.max(0, Math.min(24 * 60, Math.round(Number(w.wachttijd_min))));
  if (['fillPrintArea', 'fitPrintArea', 'stretchToPrintArea'].includes(w.sizing)) schoon.sizing = w.sizing;
  const huidig = (await db('kanaal_instellingen?kanaal=eq.prodigi&select=waarden'))?.[0]?.waarden || {};
  await db('kanaal_instellingen?on_conflict=kanaal', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { kanaal: 'prodigi', waarden: { ...huidig, ...schoon }, bijgewerkt_op: new Date().toISOString() } });
  return { ...STANDAARD_PRODIGI, ...huidig, ...schoon };
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
const foutTekst = (d) => {
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

const fulfilment = async (filter) => (await db(`fulfilments?${filter}&select=*&limit=1`))?.[0] || null;
const zet = (id, velden) => db(`fulfilments?id=eq.${id}`, { method: 'PATCH', body: { ...velden, bijgewerkt_op: new Date().toISOString() } });

/** Na betaling of import: fulfilment aanmelden (doet niets als Prodigi uit staat of al aangemeld is). */
export async function aanmelden(o, door = 'systeem') {
  const s = await instellingen();
  if (!s.aan) return { aangemeld: false, reden: 'Prodigi staat uit' };
  const omg = omgevingVan(s);
  const vanaf = new Date(Date.now() + s.wachttijd_min * 60000).toISOString();
  const rijen = await db('fulfilments?on_conflict=bestelling_id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { bestelling_id: o.id, omgeving: omg, status: 'wacht', idempotentie_sleutel: `skiffa-${omg}-${o.id}`, vanaf },
  });
  if (!rijen?.length) return { aangemeld: false, reden: 'al aangemeld' };
  await log(o.id, 'prodigi', `aangemeld bij Prodigi (${omg}); wordt ${s.wachttijd_min ? `na ${s.wachttijd_min} min ` : ''}verstuurd`, door);
  if (!s.wachttijd_min) await verwerk({ bestellingId: o.id });
  return { aangemeld: true };
}

/** Wat moet er kloppen voordat een bestelling naar Prodigi mag? Lege lijst = in orde. */
export function controleer(b, druk) {
  const p = [];
  if (!b.betaald_op) p.push('niet betaald');
  if (['geannuleerd', 'terugbetaald', 'mislukt', 'open'].includes(b.status)) p.push(`status is ${b.status}`);
  if (Number(b.terugbetaald) > 0) p.push('er is (deels) terugbetaald');
  for (const k of ['naam', 'straat', 'postcode', 'plaats', 'land']) if (!String(b[k] || '').trim()) p.push(`adres onvolledig (${k})`);
  const regels = b.bestelregels || [];
  if (!regels.length) p.push('geen orderregels');
  for (const r of regels) {
    const f = ALLE_FORMATEN[r.formaat];
    if (!f) p.push(`onbekend formaat bij ${r.poster_naam}`);
    else if (!f.prodigi_sku) p.push(`geen Prodigi-SKU voor ${f.label} (Beheer → posters → formaten)`);
    const d = druk.get(`${r.poster_id}|${r.formaat}`);
    if (!d) p.push(`drukbestand ontbreekt: ${r.poster_naam} ${r.formaat_label}`);
    else if (d.maat_status === 'afwijkend') p.push(`maat van het drukbestand wijkt af: ${r.poster_naam} ${r.formaat_label}`);
  }
  return p;
}

async function bouwOrder(b, f, s, druk) {
  const items = [];
  for (const [i, r] of (b.bestelregels || []).entries()) {
    const d = druk.get(`${r.poster_id}|${r.formaat}`);
    items.push({
      merchantReference: `${b.nummer}-${i + 1}`, sku: ALLE_FORMATEN[r.formaat].prodigi_sku, copies: r.aantal, sizing: s.sizing,
      assets: [{ printArea: 'default', url: await downloadUrl('drukbestanden', d.pad, 7 * 86400) }],
    });
  }
  return {
    merchantReference: b.nummer, idempotencyKey: f.idempotentie_sleutel, shippingMethod: s.verzendmethode, callbackUrl: callbackUrl(),
    recipient: {
      name: b.naam, ...((b.kanaal || 'webshop') === 'webshop' && b.email ? { email: b.email } : {}),
      address: { line1: b.straat, postalOrZipCode: b.postcode, countryCode: b.land, townOrCity: b.plaats },
    },
    items, metadata: { skiffa_bestelling: b.id, kanaal: b.kanaal || 'webshop' },
  };
}

async function verstuur(f, s) {
  const b = await haalBestelling('id', f.bestelling_id);
  const druk = await drukbestanden((b?.bestelregels || []).map((r) => r.poster_id));
  const problemen = b ? controleer(b, druk) : ['bestelling niet gevonden'];
  if (problemen.length) {
    await zet(f.id, { status: 'geblokkeerd', laatste_fout: problemen.join(' · ').slice(0, 500) });
    if (b) await log(b.id, 'waarschuwing', `Niet naar Prodigi: ${problemen.join(' · ')}. Los het op en klik "opnieuw proberen".`, 'prodigi');
    return 'geblokkeerd';
  }
  if (!prodigiIngesteld(f.omgeving)) {
    await zet(f.id, { status: 'opnieuw', laatste_fout: `sleutel voor ${f.omgeving} ontbreekt in Vercel` });
    return 'wacht op sleutel';
  }
  let res;
  try { res = await call(f.omgeving, 'POST', '/Orders', await bouwOrder(b, f, s, druk)); }
  catch (e) { res = { status: 0, data: e.message }; }
  const order = res.data?.order;
  if (res.status >= 200 && res.status < 300 && order?.id) {
    await zet(f.id, { status: 'verstuurd', extern_id: order.id, extern_status: order.status?.stage || null, laatste_fout: null, verstuurd_op: new Date().toISOString() });
    await log(b.id, 'prodigi', `naar Prodigi verstuurd (${f.omgeving}, order ${order.id})${res.data?.outcome && res.data.outcome !== 'Created' ? `, ${res.data.outcome}` : ''}`, 'prodigi');
    if (b.status === 'betaald') await werkBij(b.id, { status: 'in_productie' });
    return 'verstuurd';
  }
  const tijdelijk = res.status === 0 || res.status === 429 || res.status >= 500;
  const opgeven = !tijdelijk || f.pogingen >= MAX_POGINGEN;
  await zet(f.id, {
    status: opgeven ? 'fout' : 'opnieuw', laatste_fout: `(${res.status || 'netwerk'}) ${foutTekst(res.data)}`,
    ...(opgeven ? {} : { vanaf: new Date(Date.now() + f.pogingen * 5 * 60000).toISOString() }),
  });
  await log(b.id, 'fout', `Prodigi (${res.status || 'netwerk'}): ${foutTekst(res.data)}${opgeven ? ' — gestopt; controleer en klik "opnieuw proberen"' : ` — poging ${f.pogingen}, volgt later opnieuw (zelfde idempotentiesleutel)`}`, 'prodigi');
  return opgeven ? 'fout' : 'opnieuw';
}

/** Openstaande fulfilments claimen en versturen. */
export async function verwerk({ bestellingId, max = 10 } = {}) {
  const s = await instellingen();
  const uit = { verstuurd: 0, geblokkeerd: 0, fout: 0, opnieuw: 0, overgeslagen: 0 };
  if (!s.aan) return { ...uit, uit: true };
  await rpc('skiffa_vrijgeven_fulfilments', {}).catch(() => {});
  const nu = new Date().toISOString();
  const kandidaten = await db(`fulfilments?status=in.(wacht,opnieuw)&vanaf=lte.${encodeURIComponent(nu)}${bestellingId ? `&bestelling_id=eq.${bestellingId}` : ''}&select=id&order=vanaf.asc&limit=${max}`);
  for (const { id } of kandidaten) {
    const geclaimd = (await rpc('skiffa_claim_fulfilment', { p_id: id }))?.[0];
    if (!geclaimd) { uit.overgeslagen++; continue; }   // iemand anders was eerder, of bestelling niet (meer) geldig
    const r = await verstuur(geclaimd, s);
    if (r in uit) uit[r]++; else uit.opnieuw++;
  }
  return uit;
}

const VERVOERDERS = { postnl: 'postnl', dhl: 'dhl', dpd: 'dpd', ups: 'ups', gls: 'gls', bpost: 'bpost' };
const vervoerderVan = (naam) => VERVOERDERS[Object.keys(VERVOERDERS).find((k) => String(naam || '').toLowerCase().replace(/\s/g, '').includes(k))] || null;

/** Verwerk de actuele stand van een Prodigi-order in de administratie. */
async function verwerkOrder(f, order) {
  const stage = order?.status?.stage || null;
  if (stage && stage !== f.extern_status) await zet(f.id, { extern_status: stage });
  if (stage === 'Cancelled' && f.status !== 'geannuleerd') {
    await zet(f.id, { status: 'geannuleerd' });
    await log(f.bestelling_id, 'fout', 'Prodigi heeft de order geannuleerd. Controleer de bestelling.', 'prodigi');
    return 'geannuleerd';
  }
  const zending = (order?.shipments || []).find((z) => z?.tracking?.number || z?.tracking?.url);
  if (zending && f.status !== 'verzonden') {
    await zet(f.id, { status: 'verzonden' });
    const b = await haalBestelling('id', f.bestelling_id);
    if (b && !['verzonden', 'geleverd', 'geannuleerd', 'terugbetaald'].includes(b.status)) {
      const tt = zending.tracking.url || zending.tracking.number;
      const v = vervoerderVan(zending.carrier?.name);
      const nieuw = await werkBij(b.id, { status: 'verzonden', track_trace: String(tt).slice(0, 300), verzonden_op: new Date().toISOString(), ...(v ? { vervoerder: v } : {}) });
      await log(b.id, 'status', `${b.status} → verzonden door Prodigi (${zending.carrier?.name || 'vervoerder onbekend'}: ${zending.tracking.number || tt})`, 'prodigi');
      if ((b.kanaal || 'webshop') === 'webshop') {
        try { if (await mails.verzonden(vanRij({ ...b, ...nieuw, bestelregels: b.bestelregels }))) await log(b.id, 'mail', 'verzonden', 'prodigi'); }
        catch (e) { await log(b.id, 'fout', `mail verzonden: ${e.message}`, 'prodigi'); }
      } else await log(b.id, 'kanaal', `track-and-trace gaat bij de volgende synchronisatie naar ${b.kanaal}`, 'prodigi');
    }
    return 'verzonden';
  }
  if (stage === 'InProgress' && f.status === 'verstuurd') await zet(f.id, { status: 'in_productie' });
  return stage || 'onbekend';
}

/** Statusmelding van Prodigi. We vertrouwen de inhoud niet: de order wordt altijd opnieuw opgevraagd. */
export async function callback(body) {
  const id = body?.data?.order?.id || body?.order?.id || body?.data?.id;
  if (!id || !/^ord_[A-Za-z0-9]+$/.test(String(id))) return { ok: true, genegeerd: 'geen order-id' };
  const f = await fulfilment(`extern_id=eq.${id}`);
  if (!f) return { ok: true, genegeerd: 'onbekende order' };
  const r = await call(f.omgeving, 'GET', `/Orders/${id}`);
  if (r.status !== 200 || !r.data?.order) return { ok: false, melding: `order opvragen mislukt (${r.status})` };
  return { ok: true, resultaat: await verwerkOrder(f, r.data.order) };
}

/** Vangnet: open Prodigi-orders zonder recente update opnieuw opvragen. */
export async function statussen({ max = 10 } = {}) {
  const grens = new Date(Date.now() - 60 * 60000).toISOString();
  const open = await db(`fulfilments?status=in.(verstuurd,in_productie)&bijgewerkt_op=lt.${encodeURIComponent(grens)}&select=*&order=bijgewerkt_op.asc&limit=${max}`);
  let bijgewerkt = 0;
  for (const f of open) {
    const r = await call(f.omgeving, 'GET', `/Orders/${f.extern_id}`).catch(() => null);
    if (r?.status === 200 && r.data?.order) { await verwerkOrder(f, r.data.order); bijgewerkt++; }
    await zet(f.id, {});   // bijgewerkt_op verschuiven, zodat de volgende run andere orders pakt
  }
  return { gecontroleerd: open.length, bijgewerkt };
}

// ---- acties vanuit de administratie ----
export async function opnieuw(bestellingId, door = 'admin') {
  const f = await fulfilment(`bestelling_id=eq.${bestellingId}`);
  if (!f) return { fout: 'Deze bestelling is niet bij Prodigi aangemeld.' };
  if (!['fout', 'geblokkeerd', 'wacht', 'opnieuw'].includes(f.status)) return { fout: `Kan niet: status is ${f.status}.` };
  await zet(f.id, { status: 'opnieuw', vanaf: new Date().toISOString(), laatste_fout: null });
  await log(bestellingId, 'prodigi', 'opnieuw aangeboden aan Prodigi (zelfde idempotentiesleutel)', door);
  const r = await verwerk({ bestellingId });
  return { ok: true, resultaat: r };
}

/** Handmatig aanmelden (bv. een bestelling van vóór Prodigi). */
export async function handmatigAanmelden(bestellingId, door = 'admin') {
  const b = await haalBestelling('id', bestellingId);
  if (!b?.betaald_op) return { fout: 'Alleen betaalde bestellingen kunnen naar Prodigi.' };
  const r = await aanmelden(b, door);
  return r.aangemeld ? { ok: true } : { fout: r.reden === 'al aangemeld' ? 'Deze bestelling is al bij Prodigi aangemeld.' : r.reden };
}

/** Een proeforder (sandbox) loskoppelen, zodat de bestelling live opnieuw kan. Live-orders nooit. */
export async function resetSandbox(bestellingId, door = 'admin') {
  const f = await fulfilment(`bestelling_id=eq.${bestellingId}`);
  if (!f) return { fout: 'Niet aangemeld.' };
  if (f.omgeving !== 'sandbox') return { fout: 'Alleen proeforders (sandbox) kunnen opnieuw; een live-order gaat nooit twee keer.' };
  const s = await instellingen();
  if (s.sandbox) return { fout: 'Zet Prodigi eerst op live.' };
  await zet(f.id, { omgeving: 'live', status: 'wacht', idempotentie_sleutel: `skiffa-live-${bestellingId}`, extern_id: null, extern_status: null, laatste_fout: null, pogingen: 0, vanaf: new Date().toISOString() });
  await log(bestellingId, 'prodigi', 'proeforder losgekoppeld; wordt live naar Prodigi verstuurd', door);
  return { ok: true };
}

export async function annuleer(bestellingId, door = 'admin') {
  const f = await fulfilment(`bestelling_id=eq.${bestellingId}`);
  if (!f) return { fout: 'Niet aangemeld bij Prodigi.' };
  if (['wacht', 'opnieuw', 'geblokkeerd', 'fout'].includes(f.status) && !f.extern_id) {
    await zet(f.id, { status: 'geannuleerd' });
    await log(bestellingId, 'prodigi', 'fulfilment geannuleerd vóór verzending naar Prodigi', door);
    return { ok: true, melding: 'Geannuleerd; er is niets naar Prodigi gegaan.' };
  }
  if (!f.extern_id) return { fout: `Kan niet: status is ${f.status}.` };
  const r = await call(f.omgeving, 'POST', `/Orders/${f.extern_id}/actions/cancel`, {});
  if (r.status >= 200 && r.status < 300) {
    await zet(f.id, { status: 'geannuleerd', extern_status: 'Cancelled' });
    await log(bestellingId, 'prodigi', `order ${f.extern_id} bij Prodigi geannuleerd`, door);
    return { ok: true, melding: 'Geannuleerd bij Prodigi.' };
  }
  await log(bestellingId, 'fout', `annuleren bij Prodigi mislukt (${r.status}): ${foutTekst(r.data)}`, door);
  return { fout: `Prodigi weigerde het annuleren (${r.status}); waarschijnlijk is de order al in productie.` };
}

export async function ping(omg) {
  if (!prodigiIngesteld(omg)) return { ok: false, info: `sleutel voor ${omg} ontbreekt (${omg === 'live' ? 'PRODIGI_API_KEY' : 'PRODIGI_SANDBOX_API_KEY'})` };
  const r = await call(omg, 'GET', '/Orders?top=1');
  return { ok: r.status === 200, info: r.status === 200 ? `verbonden met Prodigi (${omg})` : `(${r.status}) ${foutTekst(r.data)}` };
}

export async function overzicht() {
  const s = await instellingen();
  const rijen = await db('fulfilments?select=status');
  const tel = {};
  for (const r of rijen) tel[r.status] = (tel[r.status] || 0) + 1;
  const aandacht = await db('fulfilments?status=in.(fout,geblokkeerd)&select=bestelling_id,status,laatste_fout,bijgewerkt_op,bestellingen(nummer)&order=bijgewerkt_op.desc&limit=20').catch(() => []);
  return { instellingen: s, sleutels: { sandbox: prodigiIngesteld('sandbox'), live: prodigiIngesteld('live') }, tellers: tel, aandacht, callbackUrl: callbackUrl().replace(/t=.*/, 't=…'), verzendmethoden: VERZENDMETHODEN };
}

export const fulfilmentVan = (bestellingId) => fulfilment(`bestelling_id=eq.${bestellingId}`);
