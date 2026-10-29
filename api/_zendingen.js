// Zendingen: één of meer per bestelling (gesplitste levering). Bron: Prodigi (via status/callback), handmatig
// (administratie) of het kanaal. Elke zending wordt één keer vastgelegd (unique bestelling + extern_ref),
// de klant van de webshop krijgt per nieuwe zending één mail (klant_gemaild_op wordt atomair gezet) en het
// verkoopkanaal krijgt elke zending één keer door (kanaal_gemeld_op). Tracking wordt alleen getoond als
// die er echt is.
import { db, haalBestelling, werkBij, log } from './_db.js';
import { mails, vanRij } from './_mails.js';

export const MAX_KANAALPOGINGEN = 5;
const VERVOERDERS = ['postnl', 'dhl', 'dpd', 'ups', 'gls', 'bpost'];
export const vervoerderVan = (naam) => VERVOERDERS.find((k) => String(naam || '').toLowerCase().replace(/\s/g, '').includes(k)) || null;

/** Dekken de zendingen alle orderregels? (regels = null betekent: hele bestelling) */
export function dekking(bestelregels, zendingen) {
  if (zendingen.some((z) => !Array.isArray(z.regels))) return 'volledig';
  const gedekt = new Set(zendingen.flatMap((z) => z.regels.map(String)));
  const alle = (bestelregels || []).map((r) => String(r.id));
  return alle.length && alle.every((id) => gedekt.has(id)) ? 'volledig' : zendingen.length ? 'deels' : 'geen';
}

/**
 * Legt een zending vast (doet niets als hij al bestaat) en werkt de bestelling bij: status verzonden of
 * deels verzonden, track-and-trace, klantmail (webshop, één keer per zending).
 */
export async function registreer({ bestellingId, bron, extern_ref, vervoerder, tracking_code, tracking_url, regels = null, fulfilment_id = null, door = 'systeem', mail = true }) {
  if (!extern_ref) throw new Error('zending zonder referentie');
  const rijen = await db('zendingen?on_conflict=bestelling_id,extern_ref', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { bestelling_id: bestellingId, bron, extern_ref: String(extern_ref).slice(0, 200), vervoerder: vervoerder || null,
      tracking_code: tracking_code ? String(tracking_code).slice(0, 120) : null, tracking_url: tracking_url ? String(tracking_url).slice(0, 400) : null,
      regels: Array.isArray(regels) && regels.length ? regels.map(String) : null, fulfilment_id },
  });
  const z = rijen?.[0];
  if (!z) return { nieuw: false };
  const b = await haalBestelling('id', bestellingId);
  const alle = await db(`zendingen?bestelling_id=eq.${bestellingId}&select=*&order=id.asc`);
  const d = dekking(b.bestelregels, alle);
  const velden = { track_trace: String(tracking_url || tracking_code || '').slice(0, 300) || b.track_trace, verzonden_op: b.verzonden_op || new Date().toISOString() };
  const v = vervoerderVan(vervoerder); if (v) velden.vervoerder = v;
  if (!['geannuleerd', 'terugbetaald', 'geleverd'].includes(b.status)) velden.status = d === 'volledig' ? 'verzonden' : 'deels_verzonden';
  const nieuw = await werkBij(b.id, velden);
  await log(b.id, 'zending', `${d === 'volledig' ? (alle.length > 1 ? 'laatste zending' : 'verzonden') : `zending ${alle.length} (deel van de bestelling)`}: ${vervoerder || 'vervoerder onbekend'} ${tracking_code || tracking_url || ''}`.trim(), door);
  if (mail && (b.kanaal || 'webshop') === 'webshop') await mailKlant(z, { ...b, ...nieuw, bestelregels: b.bestelregels }, d, door);
  else if ((b.kanaal || 'webshop') !== 'webshop') await log(b.id, 'kanaal', `zending gaat bij de volgende synchronisatie naar ${b.kanaal}; ${b.kanaal} licht de koper in`, door);
  return { nieuw: true, zending: z, dekking: d };
}

async function mailKlant(z, b, d, door) {
  // Atomair: alleen wie klant_gemaild_op van leeg naar gevuld zet, mailt.
  const claim = await db(`zendingen?id=eq.${z.id}&klant_gemaild_op=is.null`, { method: 'PATCH', prefer: 'return=representation', body: { klant_gemaild_op: new Date().toISOString() } });
  if (!claim?.length) return false;
  try {
    const o = vanRij({ ...b, track_trace: z.tracking_url || z.tracking_code });
    const verstuurd = await mails.verzonden(o, { deel: d !== 'volledig' });
    if (verstuurd) await log(b.id, 'mail', `verzonden${d !== 'volledig' ? ' (deelzending)' : ''}`, door);
    else await db(`zendingen?id=eq.${z.id}`, { method: 'PATCH', body: { klant_gemaild_op: null } });
    return verstuurd;
  } catch (e) {
    await db(`zendingen?id=eq.${z.id}`, { method: 'PATCH', body: { klant_gemaild_op: null } });
    await log(b.id, 'fout', `verzendmail: ${e.message}`, door);
    return false;
  }
}

/**
 * Zendingen van kanaalorders die nog niet aan het kanaal zijn doorgegeven, in de vorm die de kanaalstappen
 * verwachten: de bestelling met track_trace/vervoerder van de zending en alleen de regels uit die zending.
 */
export async function teMelden(kanaal) {
  const best = await db(`bestellingen?kanaal=eq.${kanaal}&status=in.(deels_verzonden,verzonden,geleverd)&select=*,bestelregels(*)&order=bijgewerkt_op.asc&limit=100`);
  if (!best.length) return [];
  // Oudere bestellingen met alleen een track-and-trace (zonder zending): eerst als zending vastleggen.
  const zend = await db(`zendingen?bestelling_id=in.(${best.map((b) => b.id).join(',')})&select=*&order=id.asc`);
  for (const b of best) if (b.track_trace && !b.extern_verzonden_op && !zend.some((z) => z.bestelling_id === b.id)) {
    const r = await registreer({ bestellingId: b.id, bron: 'handmatig', extern_ref: b.track_trace, vervoerder: b.vervoerder, tracking_code: b.track_trace, mail: false });
    if (r.zending) zend.push(r.zending);
  }
  const uit = [];
  for (const z of zend) {
    if (z.kanaal_gemeld_op || z.kanaal_pogingen >= MAX_KANAALPOGINGEN || !(z.tracking_code || z.tracking_url)) continue;
    const b = best.find((x) => x.id === z.bestelling_id);
    const regels = Array.isArray(z.regels) ? (b.bestelregels || []).filter((r) => z.regels.includes(String(r.id))) : b.bestelregels;
    uit.push({ ...b, bestelregels: regels, track_trace: z.tracking_code || z.tracking_url, vervoerder: z.vervoerder || b.vervoerder, zending: z,
      extern_meta: { ...(b.extern_meta || {}), verzend_pogingen: z.kanaal_pogingen } });
    if (uit.length >= 50) break;
  }
  return uit;
}

export async function gemeld(b, extraMeta = {}) {
  const nu = new Date().toISOString();
  await db(`zendingen?id=eq.${b.zending.id}`, { method: 'PATCH', body: { kanaal_gemeld_op: nu, kanaal_fout: null } });
  const open = (await db(`zendingen?bestelling_id=eq.${b.id}&kanaal_gemeld_op=is.null&select=id`)).length;
  const huidig = await haalBestelling('id', b.id);
  if (!open && huidig.status !== 'deels_verzonden') await werkBij(b.id, { extern_verzonden_op: nu, extern_meta: { ...(huidig.extern_meta || {}), ...extraMeta, verzend_fout: null } });
  await log(b.id, 'kanaal', `zending ${b.zending.tracking_code || ''} doorgegeven aan ${b.kanaal}`, b.kanaal);
}

export async function meldenMislukt(b, fout, max = MAX_KANAALPOGINGEN) {
  const pogingen = Number(b.zending.kanaal_pogingen || 0) + 1;
  await db(`zendingen?id=eq.${b.zending.id}`, { method: 'PATCH', body: { kanaal_fout: String(fout).slice(0, 500), kanaal_pogingen: pogingen } });
  await log(b.id, 'fout', pogingen >= max
    ? `Zending doorgeven aan ${b.kanaal} ${pogingen}x mislukt; automatisch doorgeven gestopt. Geef de tracking handmatig door bij ${b.kanaal}. Laatste fout: ${fout}`
    : `Zending doorgeven aan ${b.kanaal} mislukt (poging ${pogingen}): ${fout}`, b.kanaal);
}

export const zendingenVan = (bestellingId) => db(`zendingen?bestelling_id=eq.${bestellingId}&select=*&order=id.asc`);
