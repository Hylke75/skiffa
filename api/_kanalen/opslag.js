// Database-kant van de kanalen: instellingen, listings, EAN's (uit varianten), import van orders en logboek.
import { db, rpc, log as orderLog } from '../_db.js';
import { POSTERS, ALLE_POSTERS, FORMATEN, ALLE_FORMATEN, VARIANTEN, PAPIER, STANDAARD_PAPIER, variantVoor, ophangLabel } from '../_catalogus.js';
import { mails, vanRij } from '../_mails.js';
import { drukOverzicht, naBetaling } from '../_verwerk.js';
import { haalBestelling } from '../_db.js';
import { STANDAARD, varianten, vanSku, isGeldigeEan } from './gemeen.js';

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
  // Etsy publiceert per product via de pagina Verkoopkanalen (product_kanalen); bol en Amazon per variant.
  if (kanaal === 'etsy') return;
  const rijen = varianten().map((v) => ({ kanaal, poster_id: v.poster_id, formaat: v.formaat }));
  if (!rijen.length) return;
  await db('kanaal_listings?on_conflict=kanaal,poster_id,formaat', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: rijen });
}

export async function listings(kanaal) {
  await zorgVoorListings(kanaal);
  const rijen = await db(`kanaal_listings?kanaal=eq.${kanaal}&order=poster_id.asc,formaat.asc`);
  // Posters die niet (meer) in de catalogus staan worden niet meer aangeboden.
  return rijen.filter((r) => ALLE_POSTERS[r.poster_id] && r.formaat !== 'alle' && FORMATEN[r.formaat]);
}

export async function zetListing(id, velden) {
  await db(`kanaal_listings?id=eq.${id}`, { method: 'PATCH', body: { ...velden, bijgewerkt_op: new Date().toISOString() } });
}

// EAN's staan op één plek: bij de variant (varianten.ean). bol en Amazon bieden per poster + formaat
// de losse poster op standaardpapier aan, dus die EAN hoort bij de listing.
export async function eans() {
  const rijen = await db(`varianten?ean=not.is.null&lijst=is.null&papier_id=eq.${STANDAARD_PAPIER}&select=product_id,formaat_id,ean`);
  return new Map(rijen.map((r) => [`${r.product_id}|${r.formaat_id}`, r.ean]));
}

/** EAN bij een variant zetten ('' = verwijderen). Geeft { fout } of { ok }. */
export async function zetEan(sku, ruw) {
  const ean = String(ruw ?? '').trim();
  if (ean && !isGeldigeEan(ean)) return { fout: `${ean} is geen geldige EAN (controlecijfer klopt niet).` };
  try {
    const rij = await db(`varianten?sku=eq.${encodeURIComponent(sku)}`, { method: 'PATCH', body: { ean: ean || null, bijgewerkt_op: new Date().toISOString() }, prefer: 'return=representation' });
    if (!rij?.length) return { fout: 'Deze variant staat nog niet in de database: maak hem eerst aan bij Producten.' };
  } catch (e) {
    if (/duplicate|23505/.test(e.message)) return { fout: 'Deze EAN is al aan een andere variant gekoppeld.' };
    throw e;
  }
  return { ok: true };
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
  const f = v && ALLE_FORMATEN[v.formaat];
  const vk = (v?.sku && VARIANTEN[v.sku]) || (v && variantVoor(v.poster_id, v.formaat)) || null;
  return {
    poster_id: v?.poster_id || 'onbekend',
    poster_naam: (v && ALLE_POSTERS[v.poster_id]) || String(titel || 'Onbekend product').slice(0, 120),
    formaat: v?.formaat || '?',
    formaat_label: `${f?.label || '?'}${ophangLabel(vk?.lijst, vk?.lijst_kleur) ? `, in ${ophangLabel(vk.lijst, vk.lijst_kleur)}` : ''}`,
    // vaste kopie van de variant op het moment van bestellen
    variant_sku: vk?.sku || null, papier_id: vk?.papier || null, papier_label: vk ? PAPIER[vk.papier]?.naam || vk.papier : null, lijst: vk?.lijst || null,
    drukbestand_versie_id: vk?.drukbestand_id || null, prodigi_sku: vk?.prodigi_sku || null, prodigi_attributen: vk?.prodigi_attributen || {}, sizing: vk?.sizing || null, kostprijs: vk?.kostprijs ?? null,
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
      if (!ongekoppeld) await naBetaling(o, payload.kanaal, payload.kanaal);
    } catch (e) { await orderLog(res.id, 'fout', `mail winkel: ${e.message}`, payload.kanaal); }
  }
  return res;
}

// Zendingen doorgeven aan het kanaal: zie api/_zendingen.js (per zending, nooit dubbel).
export { teMelden, gemeld, meldenMislukt } from '../_zendingen.js';

export async function annuleerVanKanaal(b, reden) {
  if (['deels_verzonden', 'verzonden', 'geleverd', 'geannuleerd', 'terugbetaald'].includes(b.status)) return false;
  await db(`bestellingen?id=eq.${b.id}`, { method: 'PATCH', body: { status: 'geannuleerd' } });
  await orderLog(b.id, 'status', reden, b.kanaal);
  return true;
}

export async function logRun(kanaal, actie, ok, detail) {
  try { await db('kanaal_sync_log', { method: 'POST', body: { kanaal, actie, ok, detail } }); } catch { /* logboek is bijzaak */ }
}
