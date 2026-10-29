// Beheer → social: Buffer-accounts, contentstudio, kalender en publiceren. Alleen voor de ingelogde beheerder.
//   GET  overzicht · kalender&van=&tot= (Europe/Amsterdam) · voorbeeld&id=
//   POST instellingen · accounts-sync · account {id, gebruiken} · bewaar · van-product {product_id} · inplannen {id}
//        annuleer {doel_id} · geplaatst {doel_id, link} · verwerk · media-upload · media-bevestig · verwijder {id}
import { metAudit } from './_audit.js';
import { isAdmin } from './_auth.js';
import { dbAan, db } from './_db.js';
import { laadCatalogus } from './_catalogus.js';
import * as social from './_social.js';
import { bufferIngesteld } from './_buffer.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
  if (!dbAan()) return fout(res, 503, 'De administratie is nog niet gekoppeld (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  await laadCatalogus();
  const actie = param(req, 'actie');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  try {
    if (req.method === 'GET') {
      if (actie === 'overzicht') return res.status(200).json({ ok: true, ...(await social.overzicht()) });
      if (actie === 'kalender') { const k = await social.kalender(param(req, 'van'), param(req, 'tot')); return k.fout ? fout(res, 400, k.fout) : res.status(200).json(k); }
      if (actie === 'voorbeeld') { const v = await social.voorbeeld(param(req, 'id')); return v.fout ? fout(res, 404, v.fout) : res.status(200).json(v); }
      return fout(res, 400, 'Onbekende actie.');
    }
    if (req.method !== 'POST') return fout(res, 405, 'Gebruik POST.');
    let uit;
    if (actie === 'instellingen') {
      if (body.waarden?.aan === true && !bufferIngesteld()) uit = { fout: 'Zet eerst BUFFER_API_KEY in Vercel.' };
      else uit = { ok: true, instellingen: await social.zetInstellingen(body.waarden || {}), melding: 'Instellingen opgeslagen' };
    } else if (actie === 'accounts-sync') uit = await social.syncAccounts();
    else if (actie === 'account') { await db(`social_connections?id=eq.${Number(body.id)}`, { method: 'PATCH', body: { gebruiken: body.gebruiken === true } }); uit = { ok: true, melding: 'Opgeslagen' }; }
    else if (actie === 'bewaar') uit = await social.bewaarPost(body);
    else if (actie === 'van-product') uit = await social.vanProduct(String(body.product_id || ''));
    else if (actie === 'inplannen') uit = await social.inplannen(Number(body.id));
    else if (actie === 'annuleer') uit = await social.annuleer(body.doel_id);
    else if (actie === 'geplaatst') uit = await social.bevestigGeplaatst(body.doel_id, body.link);
    else if (actie === 'verwerk') { const v = await social.verwerk(); const s = await social.statussen(); uit = { ok: true, verwerk: v, statussen: s, melding: `verstuurd ${v.verstuurd} · fout ${v.fout} · later ${v.later} · onzeker ${v.onzeker} · teruggevonden ${v.gevonden} · status bijgewerkt ${s.bijgewerkt}` }; }
    else if (actie === 'media-upload') uit = await social.mediaUpload(body);
    else if (actie === 'media-bevestig') uit = await social.mediaBevestig(body);
    else if (actie === 'verwijder') {
      const t = await db(`social_post_targets?post_id=eq.${Number(body.id)}&status=not.in.(concept,fout,geannuleerd)&select=id`);
      if (t.length) uit = { fout: 'Annuleer eerst de berichten die al in Buffer staan of geplaatst zijn.' };
      else { await db(`social_posts?id=eq.${Number(body.id)}`, { method: 'DELETE' }); uit = { ok: true, melding: 'Bericht verwijderd' }; }
    } else return fout(res, 400, 'Onbekende actie.');
    return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json(uit);
  } catch (e) {
    if (e.soort) return fout(res, e.soort === 'definitief' ? 400 : 503, e.message);   // Buffer-fout: eerlijk doorgeven
    console.error('social', e);
    return fout(res, 500, String(e.message || 'Er ging iets mis.').slice(0, 300));
  }
}

export default metAudit('social', handler);
