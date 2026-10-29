// Prodigi: statusmeldingen en beheer (zie api/_prodigi.js). Eén route, ?actie=…
//
//   POST callback&t=…                 statusmelding van Prodigi (token in de URL; de order wordt altijd
//                                     opnieuw bij Prodigi opgevraagd, de inhoud van de melding telt niet)
// Beheer (ingelogd in /admin)
//   GET  overzicht                    instellingen, sleutels, tellers, bestellingen die aandacht vragen
//   POST instellingen {waarden} · ping · verwerk (nu versturen wat klaarstaat)
//   POST product-controle {sku} · offerte {sku, land?}            catalogus: Prodigi-product en actuele kosten
//   POST proef-offerte {regels:[{sku, aantal}], adres, verzendmethode} → kosten + adres
//   POST proef-plaatsen {id, bevestigd: true}                     plaatst de (betaalde) proefbestelling
//   POST aanmelden · opnieuw · annuleer · reset-sandbox {id} · vrijgeven {id, reden} · herdruk {id, reden, bevestigd}
import { metAudit } from './_audit.js';
import { dbAan } from './_db.js';
import { isAdmin } from './_auth.js';
import { laadCatalogus } from './_catalogus.js';
import * as prodigi from './_prodigi.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });
const isUuid = (s) => /^[0-9a-f-]{36}$/.test(String(s));

async function handler(req, res) {
  await laadCatalogus();
  res.setHeader('Cache-Control', 'no-store');
  const actie = param(req, 'actie');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  if (!dbAan()) return fout(res, 503, 'De administratie is nog niet gekoppeld (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');

  try {
    if (actie === 'callback') {
      if (req.method !== 'POST') return fout(res, 405, 'Alleen POST.');
      if (!prodigi.callbackGeldig(param(req, 't'))) return fout(res, 403, 'Ongeldig token.');
      const r = await prodigi.callback(body);
      return res.status(r.ok ? 200 : 502).json(r);
    }
    if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
    if (req.method === 'GET' && actie === 'overzicht') return res.status(200).json({ ok: true, ...(await prodigi.overzicht()) });
    if (req.method !== 'POST') return fout(res, 400, 'Onbekende actie.');

    if (actie === 'instellingen') {
      const r = await prodigi.zetInstellingen(body.waarden || {});
      return r.fout ? fout(res, 400, r.fout) : res.status(200).json({ ok: true, instellingen: r });
    }
    if (actie === 'ping') return res.status(200).json(await prodigi.ping(body.omgeving === 'live' ? 'live' : 'sandbox'));
    if (actie === 'verwerk') {
      const v = await prodigi.verwerk();
      const s = await prodigi.statussen().catch(() => ({ gecontroleerd: 0, bijgewerkt: 0 }));
      return res.status(200).json({ ok: true, verwerk: v, statussen: s });
    }
    let uit;
    if (actie === 'product-controle') uit = await prodigi.productControle(body.sku);
    else if (actie === 'offerte') uit = await prodigi.offerte(body.sku, { land: /^[A-Z]{2}$/.test(body.land) ? body.land : 'NL' });
    else if (actie === 'proef-offerte') uit = await prodigi.proefOfferte(body);
    else if (actie === 'proef-plaatsen') uit = await prodigi.proefPlaatsen(body);
    else {
      const id = String(body.id || '');
      if (!isUuid(id)) return fout(res, 400, 'Geen bestelling gekozen.');
      if (actie === 'herdruk') uit = await prodigi.herdruk(id, body, 'admin');
      else if (actie === 'vrijgeven') uit = await prodigi.vrijgeven(id, body.reden, 'admin');
      else {
        const fn = { aanmelden: prodigi.handmatigAanmelden, opnieuw: prodigi.opnieuw, annuleer: prodigi.annuleer, 'reset-sandbox': prodigi.resetSandbox }[actie];
        if (!fn) return fout(res, 400, 'Onbekende actie.');
        uit = await fn(id, 'admin');
      }
    }
    if (!uit.fout && ['product-controle', 'offerte'].includes(actie)) await laadCatalogus({ vers: true });
    return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json(uit);
  } catch (e) {
    console.error('prodigi', e);
    return fout(res, 500, 'Er ging iets mis. Probeer het opnieuw.');
  }
}

export default metAudit('prodigi', handler);
