// Database-kant van de kanalen: instellingen, listings, EAN's, import van orders en logboek.
import { db, rpc, log as orderLog } from '../_db.js';
import { POSTERS, FORMATEN } from '../_catalogus.js';
import { mails, vanRij } from '../_mails.js';
import { drukOverzicht, drukopdracht } from '../_verwerk.js';
import { haalBestelling } from '../_db.js';
import { STANDAARD, varianten, vanSku } from './gemeen.js';

export async function instellingen(kanaal) {
  const rij = (await db(`kanaal_instellingen?kanaal=eq.${kanaal}&select=waarden`))?.[0];
  return { ...STANDAARD[kanaal], ...(rij?.waarden || {}) };
}

export async function zetInstellingen(kanaal, patch) {
  const huidig = (await db(`kanaal_instellingen?kanaal=eq.${kanaal}&select=waarden`))?.[0]?.waarden || {};
  await db('kanaal_instellingen?on_conflict=kanaal', {
    method: 'POST', prefer: 'resolution=merge-duplicates',
    body: { kanaal, waarden: { ...huidig, ...patch }, bijgewerkt_op: new Date().toISOString() },
  });
}

// Zorg dat er voor elke variant (bol/Amazon) of poster (Etsy) een listingrij bestaat.
export async function zorgVoorListings(kanaal) {
  const rijen = kanaal === 'etsy'
    ? Object.keys(POSTERS).map((poster_id) => ({ kanaal, poster_id, formaat: 'alle' }))
    : varianten().map((v) => ({ kanaal, poster_id: v.poster_id, formaat: v.formaat }));
  await db('kanaal_listings?on_conflict=kanaal,poster_id,formaat', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: rijen });
}

export async function listings(kanaal) {
  await zorgVoorListings(kanaal);
  const rijen = await db(`kanaal_listings?kanaal=eq.${kanaal}&order=poster_id.asc,formaat.asc`);
  // Posters die niet (meer) in de catalogus staan worden niet meer aangeboden.
  return rijen.filter((r) => POSTERS[r.poster_id] && (r.formaat === 'alle' || FORMATEN[r.formaat]));
}

export async function zetListing(id, velden) {
  await db(`kanaal_listings?id=eq.${id}`, { method: 'PATCH', body: { ...velden, bijgewerkt_op: new Date().toISOString() } });
}

export async function eans() {
  const rijen = await db('poster_ean?select=*');
  return new Map(rijen.map((r) => [`${r.poster_id}|${r.formaat}`, r.ean]));
}

export async function bekendeOrders(kanaal, ids) {
  const uit = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const deel = ids.slice(i, i + 100).map((x) => `"${String(x).replace(/"/g, '')}"`).join(',');
    if (!deel) continue;
    const rijen = await db(`bestellingen?kanaal=eq.${kanaal}&extern_id=in.(${encodeURIComponent(deel)})&select=id,extern_id,status,extern_meta`);
    for (const r of rijen) uit.set(r.extern_id, r);
  }
  return uit;
}

/**
 * Een orderregel van een kanaal aan een poster/formaat koppelen: eerst via onze listing
 * (extern id → listing), dan via de SKU die we zelf meegaven (SKF-POSTER-FORMAAT).
 */
export function regel({ sku: s, listing, titel, prijs, aantal, extern_item_id }) {
  const v = (listing && listing.formaat !== 'alle' ? { poster_id: listing.poster_id, formaat: listing.formaat } : null) || vanSku(s);
  const f = v && FORMATEN[v.formaat];
  return {
    poster_id: v?.poster_id || 'onbekend',
    poster_naam: (v && POSTERS[v.poster_id]) || String(titel || 'Onbekend product').slice(0, 120),
    formaat: v?.formaat || '?',
    formaat_label: f?.label || '?',
    prijs: Math.round(Number(prijs) * 100) / 100,
    aantal: Number(aantal),
    extern_item_id: String(extern_item_id),
    gekoppeld: !!v,
  };
}

/** Importeert een kanaalorder (idempotent). Meldt nieuwe orders aan de winkel. */
export async function importeer(payload, notities = []) {
  const ongekoppeld = payload.regels.filter((r) => !r.gekoppeld).length;
  const res = await rpc('skiffa_importeer_kanaalorder', { p: { ...payload, regels: payload.regels.map(({ gekoppeld, ...r }) => r) } });
  if (res?.nieuw) {
    if (ongekoppeld) notities.push(`${ongekoppeld} orderregel(s) niet aan een poster gekoppeld (onbekende SKU): controleer welke poster gedrukt moet worden.`);
    for (const n of notities) await orderLog(res.id, 'waarschuwing', n, payload.kanaal);
    try {
      const o = vanRij(await haalBestelling('id', res.id));
      if (await mails.winkelNieuw(o, `Nieuwe ${payload.kanaal}-bestelling (${payload.extern_id}). Verstuur binnen de levertijd en vul de track-and-trace in; die gaat automatisch naar ${payload.kanaal}.`, await drukOverzicht(o)))
        await orderLog(res.id, 'mail', 'winkel', payload.kanaal);
      if (!ongekoppeld) await drukopdracht(o, payload.kanaal, payload.kanaal);
    } catch (e) { await orderLog(res.id, 'fout', `mail winkel: ${e.message}`, payload.kanaal); }
  }
  return res;
}

// Verzonden kanaalorders met track-and-trace die nog niet aan het kanaal zijn doorgegeven.
export async function teMelden(kanaal) {
  return db(`bestellingen?kanaal=eq.${kanaal}&status=in.(verzonden,geleverd)&extern_verzonden_op=is.null&track_trace=not.is.null&select=*,bestelregels(*)&limit=50`);
}

export async function gemeld(b, extraMeta = {}) {
  await db(`bestellingen?id=eq.${b.id}`, { method: 'PATCH', body: { extern_verzonden_op: new Date().toISOString(), extern_meta: { ...(b.extern_meta || {}), ...extraMeta, verzend_fout: null } } });
  await orderLog(b.id, 'kanaal', `track-and-trace doorgegeven aan ${b.kanaal}`, b.kanaal);
}

export async function meldenMislukt(b, fout, max) {
  const pogingen = Number(b.extern_meta?.verzend_pogingen || 0) + 1;
  await db(`bestellingen?id=eq.${b.id}`, { method: 'PATCH', body: { extern_meta: { ...(b.extern_meta || {}), verzend_fout: fout, verzend_pogingen: pogingen } } });
  await orderLog(b.id, 'fout', pogingen >= max
    ? `Track-and-trace doorgeven aan ${b.kanaal} ${pogingen}x mislukt; automatisch doorgeven gestopt. Markeer de order handmatig als verzonden bij ${b.kanaal}. Laatste fout: ${fout}`
    : `Track-and-trace doorgeven aan ${b.kanaal} mislukt (poging ${pogingen}): ${fout}`, b.kanaal);
}

export async function annuleerVanKanaal(b, reden) {
  if (['verzonden', 'geleverd', 'geannuleerd', 'terugbetaald'].includes(b.status)) return false;
  await db(`bestellingen?id=eq.${b.id}`, { method: 'PATCH', body: { status: 'geannuleerd' } });
  await orderLog(b.id, 'status', reden, b.kanaal);
  return true;
}

export async function logRun(kanaal, actie, ok, detail) {
  try { await db('kanaal_sync_log', { method: 'POST', body: { kanaal, actie, ok, detail } }); } catch { /* logboek is bijzaak */ }
}
