// Verkoopkanalen (bol.com, Etsy, Amazon): beheer en synchronisatie. Eén route, ?actie=…
// Toegang: ingelogd in /admin, of de automatische run met `Authorization: Bearer CRON_SECRET`
// (GitHub Actions / Vercel Cron). Een kanaal doet niets zolang het in de instellingen uit staat;
// in proefmodus wordt er niets naar het kanaal geschreven.
//
// GET  overzicht                         per kanaal: sleutels aanwezig, instellingen, listings, laatste runs
// GET  listings&kanaal=                  assortiment met EAN, kanaalprijs, status en fout
// GET  log&kanaal=                       laatste synchronisaties
// POST instellingen {kanaal, waarden}    · listing {id, ingeschakeld} · alles {kanaal, aan}
// POST ean {poster_id, formaat, ean}     ('' = verwijderen)
// POST sync {kanaal, stap?}              · ping {kanaal}
// GET  etsy-koppel → {url} · etsy-terug (OAuth-callback, via /etsy/terug) · etsy-profielen
// GET/POST cron                          alle ingeschakelde kanalen, alle stappen
import { laadCatalogus } from './_catalogus.js';
import crypto from 'node:crypto';
import { dbAan, db } from './_db.js';
import { isAdmin } from './_auth.js';
import * as social from './_social.js';
import * as feeds from './_feeds.js';
import { POSTERS, FORMATEN, prijsVan } from './_catalogus.js';
import { bedrijf } from './_bedrijf.js';
import { KANALEN, STANDAARD, isGeldigeEan, kanaalPrijs } from './_kanalen/gemeen.js';
import { instellingen, zetInstellingen, listings, zetListing, eans, logRun } from './_kanalen/opslag.js';
import * as bol from './_kanalen/bol.js';
import * as etsy from './_kanalen/etsy.js';
import * as amazon from './_kanalen/amazon.js';
import * as tiktok from './_kanalen/tiktok.js';
import * as prodigi from './_prodigi.js';
import * as publicatie from './_publicatie.js';

const MOD = { bol, etsy, amazon, tiktok };
const INGESTELD = { bol: bol.bolIngesteld, etsy: etsy.etsyIngesteld, amazon: amazon.amazonIngesteld, tiktok: tiktok.tiktokIngesteld };
const SLEUTELS = { bol: 'BOL_CLIENT_ID, BOL_CLIENT_SECRET', etsy: 'ETSY_KEYSTRING, ETSY_SHARED_SECRET', amazon: 'AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_REFRESH_TOKEN, AMAZON_SELLER_ID', tiktok: 'TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_SERVICE_ID' };
const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });
const viaCron = (req) => {
  const geheim = process.env.CRON_SECRET || '';
  const h = String(req.headers?.authorization || '');
  if (geheim.length < 16 || !h.startsWith('Bearer ')) return false;
  const a = crypto.createHash('sha256').update(h.slice(7)).digest(), b = crypto.createHash('sha256').update(geheim).digest();
  return crypto.timingSafeEqual(a, b);
};

// Alleen bekende velden met het juiste type mogen in de instellingen.
function schoon(kanaal, w) {
  const uit = {};
  for (const [k, std] of Object.entries(STANDAARD[kanaal])) {
    if (!(k in w) || k === 'laatste_ordersync') continue;
    const v = w[k];
    if (typeof std === 'boolean') uit[k] = v === true || v === 'true';
    else if (typeof std === 'number') { const n = Number(String(v).replace(',', '.')); if (Number.isFinite(n) && n >= 0 && n <= 1000) uit[k] = n; }
    else if (std === null) uit[k] = v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
    else uit[k] = String(v ?? '').trim().slice(0, 60);
  }
  return uit;
}

async function draaiKanaal(kanaal, stap, door, opties = {}) {
  const s = await instellingen(kanaal);
  const mod = MOD[kanaal];
  const stappen = stap ? mod.STAPPEN.filter((x) => x === stap) : mod.STAPPEN;
  if (!stappen.length) throw new Error(`Onbekende stap: ${stap}`);
  const start = Date.now();
  const uit = await mod.draai(stappen, s, opties);
  const ok = uit.log.every((l) => l.ok);
  const detail = { door, proef: s.proef, ms: Date.now() - start, ...uit };
  await logRun(kanaal, stap || 'alles', ok, detail);
  return { ok, ...detail };
}

export default async function handler(req, res) {
  await laadCatalogus();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const actie = param(req, 'actie');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  if (!dbAan()) return fout(res, 503, 'De administratie is nog niet gekoppeld (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');

  // Automatische run.
  if (actie === 'cron') {
    if (!viaCron(req) && !isAdmin(req)) return fout(res, 401, 'Niet geautoriseerd.');
    const resultaat = {};
    for (const k of KANALEN) {
      const s = await instellingen(k);
      if (!s.aan) { resultaat[k] = 'uit'; continue; }
      if (!INGESTELD[k]()) { resultaat[k] = `sleutels ontbreken (${SLEUTELS[k]})`; continue; }
      try { const r = await draaiKanaal(k, '', 'automatisch'); resultaat[k] = r.ok ? 'ok' : r.log.filter((l) => !l.ok).map((l) => l.info).join(' · '); }
      catch (e) { resultaat[k] = `fout: ${e.message}`; }
    }
    // Prodigi: klaarstaande bestellingen versturen en open orders bijwerken (vangnet voor callbacks).
    try {
      const v = await prodigi.verwerk();
      if (v.uit) resultaat.prodigi = 'uit';
      else { const st = await prodigi.statussen(); resultaat.prodigi = `verstuurd ${v.verstuurd}, geblokkeerd ${v.geblokkeerd}, fout ${v.fout}, opnieuw ${v.opnieuw}; status bijgewerkt ${st.bijgewerkt}`; }
    } catch (e) { resultaat.prodigi = `fout: ${e.message}`; }
    // Social (Buffer): wachtende berichten versturen, onzekere opzoeken, statussen bijwerken.
    try {
      const v = await social.verwerk();
      if (v.uit) resultaat.social = 'BUFFER_API_KEY ontbreekt';
      else { const st = await social.statussen(); resultaat.social = `verstuurd ${v.verstuurd}, fout ${v.fout}, onzeker ${v.onzeker}, teruggevonden ${v.gevonden}; status bijgewerkt ${st.bijgewerkt}`; }
    } catch (e) { resultaat.social = `fout: ${e.message}`; }
    return res.status(200).json({ ok: true, resultaat });
  }

  // OAuth-callback van Etsy (de beheerder komt hier terug met een geldige sessie).
  if (actie === 'etsy-terug') {
    if (!isAdmin(req)) { res.setHeader('location', '/admin.html'); return res.status(302).end(); }
    let melding;
    try {
      if (param(req, 'error')) throw new Error(param(req, 'error_description') || param(req, 'error'));
      const k = await etsy.rondKoppelenAf(param(req, 'code'), param(req, 'state'));
      melding = `Etsy gekoppeld: ${k.shop_naam || k.shop_id}`;
    } catch (e) { melding = `Etsy koppelen mislukt: ${e.message}`; }
    res.setHeader('location', `/admin.html?melding=${encodeURIComponent(melding)}#kanalen`);
    return res.status(302).end();
  }

  if (actie === 'tiktok-terug') {
    if (!isAdmin(req)) { res.setHeader('location', '/admin.html'); return res.status(302).end(); }
    let melding;
    try {
      const k = await tiktok.rondKoppelenAf(param(req, 'code'), param(req, 'state'));
      melding = `TikTok Shop gekoppeld: ${k.shop_naam}${k.regio ? ` (${k.regio})` : ''}`;
    } catch (e) { melding = `TikTok Shop koppelen mislukt: ${e.message}`; }
    res.setHeader('location', `/admin.html?melding=${encodeURIComponent(melding)}#kanalen`);
    return res.status(302).end();
  }

  if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
  // TikTok Shop: koppelen, concept per product, annuleringsverzoek beslissen.
  if (actie.startsWith('tiktok-')) {
    try {
      if (!tiktok.tiktokIngesteld()) return fout(res, 400, `Zet eerst in Vercel: ${SLEUTELS.tiktok}.`);
      if (actie === 'tiktok-koppel') return res.status(200).json({ ok: true, url: await tiktok.startKoppelen() });
      if (actie === 'tiktok-producten') {
        const s = await instellingen('tiktok');
        const pk = await db('product_kanalen?kanaal=eq.tiktok&select=product_id,status,melding,extern_id,laatste_sync_op');
        const { PRODUCTEN: P } = await import('./_catalogus.js');
        return res.status(200).json({ ok: true, producten: Object.values(P).filter((p) => p.status !== 'gearchiveerd').map((p) => ({ id: p.id, titel: p.titel, code: p.code, ontbreekt: tiktok.conceptOntbreekt(s, p.id), ...(pk.find((x) => x.product_id === p.id) || { status: 'niet_gepubliceerd' }) })) });
      }
      if (req.method !== 'POST') return fout(res, 405, 'Gebruik POST.');
      const s = await instellingen('tiktok');
      const c = await new tiktok.TikTokClient(s.proef).laad();
      if (!c.k?.shop_cipher) return fout(res, 400, 'TikTok Shop is nog niet gekoppeld.');
      let uit;
      if (actie === 'tiktok-concept') uit = await tiktok.maakConcept(c, s, String(body.product_id || ''));
      else if (actie === 'tiktok-status') uit = await tiktok.statusProduct(c, String(body.product_id || ''));
      else if (actie === 'tiktok-annulering') uit = await tiktok.beslisAnnulering(c, String(body.cancel_id || ''), body.besluit, body.reden);
      else return fout(res, 400, 'Onbekende actie.');
      return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json({ ok: true, ...uit });
    } catch (e) { console.error('tiktok', e); return fout(res, 500, String(e.message || 'Er ging iets mis.').slice(0, 300)); }
  }
  const kanaal = String(body.kanaal || param(req, 'kanaal'));
  // Verkoopkanalen per product (centrale catalogus): overzicht, aanvinken, sjablonen, publiceren.
  if (actie.startsWith('publicatie') || actie === 'sjabloon' || actie === 'publiceer') {
    try {
      if (actie === 'publicatie' && req.method === 'GET') return res.status(200).json({ ok: true, ...(await publicatie.overzicht()) });
      if (req.method !== 'POST') return fout(res, 405, 'Gebruik POST.');
      let uit;
      if (actie === 'publicatie-zet') uit = await publicatie.zetPublicatie(body);
      else if (actie === 'sjabloon') uit = await publicatie.zetSjabloon(body);
      else if (actie === 'publiceer') {
        if (body.kanaal === 'webshop') uit = { ok: true, melding: 'De webshop toont het product zodra het actief en bestelbaar is.' };
        else if (body.kanaal !== 'etsy') uit = { fout: 'Dit kanaal kan hier nog niet publiceren.' };
        else if (!etsy.etsyIngesteld()) uit = { fout: `Zet eerst in Vercel: ${SLEUTELS.etsy}.` };
        else {
          const r = await draaiKanaal('etsy', 'publiceren', 'beheer', { productId: String(body.product_id || ''), handmatig: true });
          uit = r.ok ? { ok: true, melding: r.proef ? `Proefmodus: ${r.proef_schrijfacties?.[0] || 'er is niets verstuurd'}` : (r.log.find((l) => l.stap === 'publiceren')?.info || 'Verwerkt'), log: r.log } : { fout: r.log.filter((l) => !l.ok).map((l) => l.info).join(' · ') };
        }
      } else return fout(res, 400, 'Onbekende actie.');
      if (!uit.fout && actie !== 'publiceer') await laadCatalogus({ vers: true });
      return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json(uit);
    } catch (e) {
      console.error('publicatie', e);
      return fout(res, 500, String(e.message || 'Er ging iets mis.').slice(0, 300));
    }
  }
  // Meta-productfeed: overzicht, goedkeuring, bereikbaarheid, items in/uit de feed.
  if (actie.startsWith('meta-')) {
    try {
      let uit;
      if (actie === 'meta-overzicht') uit = { ok: true, ...(await feeds.metaOverzicht()) };
      else if (req.method !== 'POST') return fout(res, 405, 'Gebruik POST.');
      else if (actie === 'meta-review') uit = await feeds.metaReview();
      else if (actie === 'meta-bereikbaar') uit = await feeds.metaBereikbaar();
      else if (actie === 'meta-opnemen') uit = await feeds.zetOpnemen('meta', (Array.isArray(body.skus) ? body.skus : []).map(String).slice(0, 500), body.opnemen === true);
      else return fout(res, 400, 'Onbekende actie.');
      return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json({ ok: true, ...uit });
    } catch (e) { console.error('meta', e); return fout(res, 500, String(e.message || 'Er ging iets mis.').slice(0, 300)); }
  }
  const kanaalNodig = !['overzicht'].includes(actie) && !actie.startsWith('etsy') && actie !== 'ean' && actie !== 'listing';
  if (kanaalNodig && !KANALEN.includes(kanaal)) return fout(res, 400, 'Kies een kanaal (bol, etsy, amazon of tiktok).');

  try {
    if (actie === 'overzicht') {
      const lijst = await db('kanaal_listings?select=kanaal,status,ingeschakeld');
      const runs = await db('kanaal_sync_log?select=kanaal,actie,ok,op,detail&order=op.desc&limit=30');
      const uit = {};
      for (const k of KANALEN) {
        const rijen = lijst.filter((r) => r.kanaal === k);
        uit[k] = {
          sleutels: INGESTELD[k](), sleutelnamen: SLEUTELS[k], instellingen: await instellingen(k),
          listings: { totaal: rijen.length, aan: rijen.filter((r) => r.ingeschakeld).length, ...Object.fromEntries(['actief', 'wacht', 'fout', 'gepauzeerd', 'concept'].map((s) => [s, rijen.filter((r) => r.status === s).length])) },
          laatste: runs.filter((r) => r.kanaal === k).slice(0, 5).map((r) => ({ actie: r.actie, ok: r.ok, op: r.op, proef: r.detail?.proef, log: r.detail?.log, proef_schrijfacties: r.detail?.proef_schrijfacties?.length || 0 })),
        };
      }
      uit.etsy.koppeling = await etsy.koppeling();
      uit.etsy.terugUrl = `${bedrijf().site}/etsy/terug`;
      uit.tiktok.koppeling = await tiktok.koppeling();
      uit.tiktok.terugUrl = tiktok.terugUrl();
      return res.status(200).json({ ok: true, kanalen: uit, cron: (process.env.CRON_SECRET || '').length >= 16 });
    }
    if (actie === 'listings') {
      if (kanaal === 'etsy') return res.status(200).json({ ok: true, listings: [], melding: 'Etsy publiceer je per poster op de pagina Verkoopkanalen.' });
      if (kanaal === 'tiktok') return res.status(200).json({ ok: true, listings: [], melding: 'TikTok Shop: maak per poster een concept aan (Koppelingen → TikTok Shop).' });
      const s = await instellingen(kanaal), rijen = await listings(kanaal), e = await eans();
      return res.status(200).json({
        ok: true,
        listings: rijen.map((r) => ({
          ...r, poster_naam: POSTERS[r.poster_id], formaat_label: FORMATEN[r.formaat]?.label || 'alle formaten',
          ean: r.formaat === 'alle' ? null : e.get(`${r.poster_id}|${r.formaat}`) || '',
          prijs: r.formaat === 'alle' ? Object.keys(FORMATEN).map((f) => prijsVan(r.poster_id, f)).filter(Boolean).map((x) => kanaalPrijs(x, s.opslag_pct))
            : prijsVan(r.poster_id, r.formaat) ? kanaalPrijs(prijsVan(r.poster_id, r.formaat), s.opslag_pct) : null,
        })),
      });
    }
    if (actie === 'log') return res.status(200).json({ ok: true, log: await db(`kanaal_sync_log?kanaal=eq.${kanaal}&order=op.desc&limit=20`) });
    if (req.method !== 'POST' && !actie.startsWith('etsy')) return fout(res, 405, 'Gebruik POST.');

    if (actie === 'instellingen') {
      await zetInstellingen(kanaal, schoon(kanaal, body.waarden || {}));
      return res.status(200).json({ ok: true, instellingen: await instellingen(kanaal) });
    }
    if (actie === 'listing') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return fout(res, 400, 'Geen listing gekozen.');
      await zetListing(id, { ingeschakeld: body.ingeschakeld === true });
      return res.status(200).json({ ok: true });
    }
    if (actie === 'alles') {
      if (!['bol', 'amazon'].includes(kanaal)) return fout(res, 400, 'Alleen voor bol.com en Amazon.');
      await listings(kanaal);
      await db(`kanaal_listings?kanaal=eq.${kanaal}`, { method: 'PATCH', body: { ingeschakeld: body.aan === true, bijgewerkt_op: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    if (actie === 'ean') {
      const { poster_id, formaat } = body, ean = String(body.ean || '').trim();
      if (!POSTERS[poster_id] || !FORMATEN[formaat]) return fout(res, 400, 'Onbekende poster of formaat.');
      if (!ean) { await db(`poster_ean?poster_id=eq.${poster_id}&formaat=eq.${formaat}`, { method: 'DELETE' }); return res.status(200).json({ ok: true }); }
      if (!isGeldigeEan(ean)) return fout(res, 400, `${ean} is geen geldige EAN (controlecijfer klopt niet).`);
      try { await db('poster_ean?on_conflict=poster_id,formaat', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { poster_id, formaat, ean } }); }
      catch (e) { return fout(res, 400, /duplicate|23505/.test(e.message) ? 'Deze EAN is al aan een andere poster gekoppeld.' : 'Opslaan mislukt.'); }
      return res.status(200).json({ ok: true });
    }
    if (actie === 'sync') {
      if (!INGESTELD[kanaal]()) return fout(res, 400, `Zet eerst in Vercel: ${SLEUTELS[kanaal]}.`);
      return res.status(200).json(await draaiKanaal(kanaal, String(body.stap || ''), 'beheer'));
    }
    if (actie === 'ping') {
      if (!INGESTELD[kanaal]()) return fout(res, 400, `Zet eerst in Vercel: ${SLEUTELS[kanaal]}.`);
      return res.status(200).json({ ok: true, ...(await MOD[kanaal].ping()) });
    }
    if (actie === 'etsy-koppel') {
      if (!etsy.etsyIngesteld()) return fout(res, 400, `Zet eerst in Vercel: ${SLEUTELS.etsy}.`);
      return res.status(200).json({ ok: true, url: await etsy.startKoppelen(`${bedrijf().site}/etsy/terug`) });
    }
    if (actie === 'etsy-profielen') return res.status(200).json({ ok: true, ...(await etsy.profielen()) });
    return fout(res, 400, 'Onbekende actie.');
  } catch (e) {
    console.error('kanalen', e);
    return fout(res, 500, String(e.message || 'Er ging iets mis.').slice(0, 300));
  }
}
