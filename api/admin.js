// Administratie-API (één route, ?actie=…). Alles achter de inlog uit api/_auth.js.
//
// GET  overzicht                 kerncijfers (omzet, aantallen per status, te verzenden)
// GET  bestellingen&status=&q=   lijst, filter op status en zoekterm (nummer, naam, e-mail, factuur)
// GET  bestelling&id=            één bestelling met regels en logboek
// GET  export&van=&tot=          CSV voor de boekhouding (gefactureerde bestellingen in de periode)
// POST login {wachtwoord} · uitloggen
// POST status {id, status, track_trace?}   in_productie / verzonden (mail klant) / geleverd / geannuleerd (mail klant)
// POST betaald {id}               handmatig betaald zetten (betaalverzoek/overboeking): factuur + mails
// POST terugbetalen {id, bedrag?} via Mollie (of handmatig vastleggen bij betaalverzoek) + mail klant
// POST ververs {id}               actuele betaalstatus bij Mollie ophalen
// POST notitie {id, tekst}        interne notitie
// POST mail {id, soort}           mail opnieuw sturen (bevestiging, verzonden)
import { laadCatalogus } from './_catalogus.js';
import { dbAan, db, haalBestelling, werkBij, log } from './_db.js';
import { isAdmin, wachtwoordKlopt, sessieCookie, uitlogCookie, adminIngesteld } from './_auth.js';
import { mollie, euro } from './_bestelling.js';
import { btwDeel } from './_bedrijf.js';
import { mails, vanRij, mailAan } from './_mails.js';
import { betaald, verwerkMollie } from './_verwerk.js';
import { metDrukbestanden } from './_media.js';
import { fulfilmentVan, fulfilmentsVan, annuleer as prodigiAnnuleer } from './_prodigi.js';
import { registreer, zendingenVan } from './_zendingen.js';
import * as service from './_service.js';

const STATUSSEN = ['open', 'betaald', 'in_productie', 'deels_verzonden', 'verzonden', 'geleverd', 'geannuleerd', 'mislukt', 'terugbetaald'];
const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const isUuid = (s) => /^[0-9a-f-]{36}$/.test(String(s));
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });

async function mailEnLog(id, soort, fn) {
  try { if (await fn()) { await log(id, 'mail', soort, 'admin'); return true; } }
  catch (e) { await log(id, 'fout', `mail ${soort}: ${e.message}`, 'admin'); }
  return false;
}

// Amsterdam-dagbegin van een JJJJ-MM-DD in UTC (voor periodefilters).
const dag = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

async function overzicht() {
  const rijen = await db('bestellingen?select=status,totaal,terugbetaald,betaald_op,aangemaakt_op,kanaal&order=aangemaakt_op.desc&limit=5000');
  const nu = new Date();
  const maandStart = new Date(nu.getFullYear(), nu.getMonth(), 1).getTime();
  const jaarStart = new Date(nu.getFullYear(), 0, 1).getTime();
  const omzet = (van) => rijen.filter((r) => r.betaald_op && new Date(r.betaald_op).getTime() >= van)
    .reduce((t, r) => t + Number(r.totaal) - Number(r.terugbetaald), 0);
  const perStatus = Object.fromEntries(STATUSSEN.map((s) => [s, rijen.filter((r) => r.status === s).length]));
  return {
    perStatus,
    teVerzenden: perStatus.betaald + perStatus.in_productie + perStatus.deels_verzonden,
    omzetMaand: Math.round(omzet(maandStart) * 100) / 100,
    omzetJaar: Math.round(omzet(jaarStart) * 100) / 100,
    aantalBetaald: rijen.filter((r) => r.betaald_op).length,
    omzetPerKanaal: Object.fromEntries(['webshop', 'bol', 'etsy', 'amazon'].map((k) => [k, Math.round(rijen.filter((r) => r.kanaal === k && r.betaald_op && new Date(r.betaald_op).getTime() >= jaarStart).reduce((t, r) => t + Number(r.totaal) - Number(r.terugbetaald), 0) * 100) / 100])),
  };
}

async function lijst(req) {
  const status = param(req, 'status');
  const q = param(req, 'q').trim().slice(0, 60).replace(/[,()*%]/g, ' ');
  let pad = 'bestellingen?select=id,nummer,status,naam,email,plaats,land,totaal,factuurnummer,aangemaakt_op,betaald_op,track_trace,betaalwijze,kanaal,extern_id&order=aangemaakt_op.desc&limit=300';
  const kanaal = param(req, 'kanaal');
  if (['webshop', 'bol', 'etsy', 'amazon'].includes(kanaal)) pad += `&kanaal=eq.${kanaal}`;
  if (STATUSSEN.includes(status)) pad += `&status=eq.${status}`;
  else if (status === 'actie') pad += '&status=in.(betaald,in_productie,deels_verzonden)';
  if (q) {
    const v = encodeURIComponent(`*${q}*`);
    pad += `&or=(nummer.ilike.${v},naam.ilike.${v},email.ilike.${v},factuurnummer.ilike.${v},plaats.ilike.${v},extern_id.ilike.${v})`;
  }
  return db(pad);
}

async function bestelling(id) {
  const r = await haalBestelling('id', id);
  if (!r) return null;
  r.log = await db(`bestelling_log?bestelling_id=eq.${id}&order=op.asc`);
  // Drukbestand per regel: de versie uit de vaste kopie van de bestelregel.
  try {
    const m = await metDrukbestanden(r.bestelregels || []);
    r.bestelregels = m.map((x) => ({ ...x, druk: x.druk ? { status: x.druk.status, versie: x.druk.versie, link: `/api/media?actie=druk&v=${x.druk.versie_id}` } : null }));
  } catch { /* zonder catalogus-tabellen: geen drukbestanden */ }
  r.drukker = !!process.env.DRUKKER_EMAIL;
  try { r.zendingen = await zendingenVan(id); } catch { r.zendingen = []; }
  try { r.fulfilments = await fulfilmentsVan(id); r.fulfilment = r.fulfilments.find((f) => !f.herdruk_nr) || null; } catch { r.fulfilments = []; r.fulfilment = null; }
  try { r.service = await service.verzoekenMetFotos(id); } catch { r.service = []; }
  r.marge = service.margeVan(r, r.fulfilments);
  return r;
}

const csvVeld = (v) => {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const bedrag = (v) => Number(v).toFixed(2).replace('.', ',');

async function exporteer(req) {
  const van = dag(param(req, 'van')), tot = dag(param(req, 'tot'));
  let pad = 'bestellingen?select=*,bestelregels(*)&factuurnummer=not.is.null&order=factuurnummer.asc&limit=10000';
  if (van) pad += `&factuurdatum=gte.${van}`;
  if (tot) pad += `&factuurdatum=lte.${tot}`;
  const rijen = await db(pad);
  const kop = ['factuurnummer', 'factuurdatum', 'bestelnummer', 'kanaal', 'extern ordernummer', 'status', 'klant', 'e-mail', 'land', 'posters', 'omzet excl btw', 'btw 21%', 'totaal incl btw', 'waarvan verzending', 'teruggestort', 'betaalwijze', 'betaald op'];
  const regels = rijen.map((r) => [
    r.factuurnummer, r.factuurdatum, r.nummer, r.kanaal, r.extern_id || '', r.status, r.naam, r.email, r.land,
    (r.bestelregels || []).map((x) => `${x.aantal}x ${x.poster_naam} ${x.formaat}`).join(' | '),
    bedrag(Number(r.totaal) - btwDeel(Number(r.totaal))), bedrag(btwDeel(Number(r.totaal))), bedrag(r.totaal),
    bedrag(r.verzending), bedrag(r.terugbetaald), r.mollie_methode || r.betaalwijze, r.betaald_op ? r.betaald_op.slice(0, 10) : '',
  ].map(csvVeld).join(';'));
  return '﻿' + [kop.join(';'), ...regels].join('\r\n');
}

async function zetStatus(id, body) {
  const nieuw = String(body.status || '');
  if (!['in_productie', 'verzonden', 'geleverd', 'geannuleerd', 'open'].includes(nieuw)) return { fout: 'Onbekende status.' };
  const r = await haalBestelling('id', id);
  if (!r) return { fout: 'Bestelling niet gevonden.' };
  // Verzonden = een zending vastleggen (ook bij gesplitste levering: één zending per pakket).
  if (nieuw === 'verzonden') {
    const tt = String(body.track_trace || '').trim().slice(0, 300);
    if (r.kanaal !== 'webshop' && !tt) return { fout: `${r.kanaal} eist een track-and-trace-code.` };
    const vervoerder = ['postnl', 'dhl', 'dpd', 'ups', 'gls', 'bpost'].includes(body.vervoerder) ? body.vervoerder : r.vervoerder;
    const regels = Array.isArray(body.regels) && body.regels.length ? body.regels.map(String) : null;
    const z = await registreer({ bestellingId: id, bron: 'handmatig', extern_ref: tt || `handmatig-${Date.now()}`, vervoerder,
      tracking_code: /^https?:\/\//.test(tt) ? null : tt || null, tracking_url: /^https?:\/\//.test(tt) ? tt : null, regels, door: 'admin', mail: body.mail !== false });
    if (!z.nieuw) return { fout: 'Deze zending (track-and-trace) is al vastgelegd.' };
    return r.kanaal !== 'webshop' ? { ok: true, gemaild: false, kanaal: r.kanaal } : { ok: true, gemaild: body.mail !== false, deels: z.dekking !== 'volledig' };
  }
  const velden = { status: nieuw };
  if (nieuw === 'geannuleerd' && r.kanaal !== 'webshop') return { fout: `Annuleer een ${r.kanaal}-order bij ${r.kanaal} zelf; de volgende synchronisatie neemt dat over.` };
  // Nog niet naar Prodigi verstuurd? Dan gaat het ook niet meer. Al verstuurd: melden.
  if (nieuw === 'geannuleerd') {
    try {
      const f = await fulfilmentVan(id);
      if (f && !f.extern_id && !['geannuleerd'].includes(f.status)) await prodigiAnnuleer(id, 'admin');
      else if (f?.extern_id && !['geannuleerd'].includes(f.status)) await log(id, 'waarschuwing', `Deze bestelling is al bij Prodigi (${f.extern_id}); annuleer de productie daar ook (knop "productie annuleren").`, 'admin');
    } catch { /* zonder Prodigi-tabel */ }
  }
  const bijgewerkt = await werkBij(id, velden);
  await log(id, 'status', `${r.status} → ${nieuw}`, 'admin');
  let gemaild = false;
  if (r.kanaal !== 'webshop') return { ok: true, gemaild: false, kanaal: r.kanaal };
  if (body.mail !== false && nieuw === 'geannuleerd') gemaild = await mailEnLog(id, 'geannuleerd', () => mails.geannuleerd(vanRij({ ...r, ...bijgewerkt, bestelregels: r.bestelregels })));
  return { ok: true, gemaild };
}

async function terugbetalen(id, body) {
  const r = await haalBestelling('id', id);
  if (!r) return { fout: 'Bestelling niet gevonden.' };
  if (!r.betaald_op) return { fout: 'Deze bestelling is nog niet betaald.' };
  if (r.kanaal !== 'webshop') return { fout: `Betaal een ${r.kanaal}-order terug via ${r.kanaal} zelf (het geld ging via ${r.kanaal}).` };
  const ruimte = Math.round((Number(r.totaal) - Number(r.terugbetaald)) * 100) / 100;
  const b = body.bedrag === undefined || body.bedrag === '' ? ruimte : Math.round(Number(String(body.bedrag).replace(',', '.')) * 100) / 100;
  if (!(b > 0) || b > ruimte + 0.001) return { fout: `Bedrag moet tussen € 0,01 en ${euro(ruimte)} liggen.` };
  if (r.mollie_id && process.env.MOLLIE_API_KEY) {
    try {
      await mollie(`payments/${r.mollie_id}/refunds`, { method: 'POST', body: JSON.stringify({ amount: { currency: 'EUR', value: b.toFixed(2) }, description: `Skiffa ${r.nummer}` }) });
    } catch (e) {
      await log(id, 'fout', `terugbetaling mislukt: ${e.message}`, 'admin');
      return { fout: 'Mollie weigerde de terugbetaling (onvoldoende saldo of al terugbetaald?).' };
    }
  }
  const totaalTerug = Math.round((Number(r.terugbetaald) + b) * 100) / 100;
  const volledig = totaalTerug >= Number(r.totaal) - 0.001;
  await werkBij(id, { terugbetaald: totaalTerug, ...(volledig ? { status: 'terugbetaald' } : {}) });
  await log(id, 'terugbetaling', `${euro(b)} teruggestort${r.mollie_id ? ' via Mollie' : ' (handmatig)'}`, 'admin');
  // Terugbetalen is niet hetzelfde als de productie annuleren: een opdracht die nog niet bij Prodigi is,
  // wordt tegengehouden tot je beslist ("toch produceren" of "productie annuleren").
  try {
    const f = await fulfilmentVan(id);
    if (f && !f.extern_id && !['geannuleerd', 'verzonden'].includes(f.status)) await log(id, 'waarschuwing', 'Terugbetaling geregistreerd: de productie wacht op jouw beslissing (toch produceren of productie annuleren).', 'admin');
    else if (f?.extern_id && !['geannuleerd', 'verzonden'].includes(f.status)) await log(id, 'waarschuwing', `De productie loopt bij Prodigi (${f.extern_id}). Annuleer de productie apart als er niet meer gedrukt moet worden.`, 'admin');
  } catch { /* zonder Prodigi-tabel */ }
  const gemaild = await mailEnLog(id, 'terugbetaald', () => mails.terugbetaald(vanRij(r), b));
  return { ok: true, gemaild };
}

export default async function handler(req, res) {
  await laadCatalogus();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const actie = param(req, 'actie');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};

  if (actie === 'status-inlog') {
    res.status(200).json({ ok: true, ingesteld: adminIngesteld(), database: dbAan(), mollie: !!process.env.MOLLIE_API_KEY, mail: mailAan(), ingelogd: isAdmin(req) });
    return;
  }
  if (actie === 'login' && req.method === 'POST') {
    if (!adminIngesteld()) return fout(res, 503, 'Zet eerst ADMIN_WACHTWOORD (minstens 12 tekens) in Vercel.');
    if (!wachtwoordKlopt(body.wachtwoord)) {
      await new Promise((r) => setTimeout(r, 800)); // remt raden af
      return fout(res, 401, 'Onjuist wachtwoord.');
    }
    res.setHeader('Set-Cookie', sessieCookie());
    res.status(200).json({ ok: true });
    return;
  }
  if (actie === 'uitloggen') {
    res.setHeader('Set-Cookie', uitlogCookie());
    res.status(200).json({ ok: true });
    return;
  }
  if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
  if (!dbAan()) return fout(res, 503, 'De administratie is nog niet gekoppeld: zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.');

  try {
    if (req.method === 'GET') {
      if (actie === 'overzicht') return res.status(200).json({ ok: true, ...(await overzicht()) });
      if (actie === 'dashboard') return res.status(200).json({ ok: true, ...(await service.dashboard({ van: param(req, 'van'), tot: param(req, 'tot') })) });
      if (actie === 'actielijst') return res.status(200).json({ ok: true, ...(await service.actielijst()) });
      if (actie === 'bestellingen') return res.status(200).json({ ok: true, bestellingen: await lijst(req) });
      if (actie === 'bestelling') {
        const id = param(req, 'id');
        const r = isUuid(id) ? await bestelling(id) : await haalBestelling('nummer', id).then((x) => x && bestelling(x.id));
        return r ? res.status(200).json({ ok: true, bestelling: r }) : fout(res, 404, 'Niet gevonden.');
      }
      if (actie === 'export') {
        res.setHeader('content-type', 'text/csv; charset=utf-8');
        res.setHeader('content-disposition', `attachment; filename="skiffa-facturen-${param(req, 'van') || 'alles'}-${param(req, 'tot') || 'nu'}.csv"`);
        return res.status(200).send(await exporteer(req));
      }
    }
    // Actielijst en serviceverzoeken (eigen id's, geen bestelling-id).
    const SERVICE = { afvinken: () => service.afvinken(body.sleutel, body.notitie), 'zending-opnieuw': () => service.zendingOpnieuw(body.zending_id),
      'service-foto-upload': () => service.fotoUpload(body), 'service-foto-bevestig': () => service.fotoBevestig(body), 'service-zet': () => service.zetVerzoek(body, 'admin'),
      'service-nieuw': () => (isUuid(body.bestelling_id) ? service.nieuwVerzoek(body, 'admin') : { fout: 'Geen bestelling gekozen.' }) };
    if (req.method === 'POST' && SERVICE[actie]) {
      const uit = await SERVICE[actie]();
      return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json(uit);
    }
    if (req.method === 'POST') {
      const id = String(body.id || '');
      if (!isUuid(id)) return fout(res, 400, 'Geen bestelling gekozen.');
      let uit;
      if (actie === 'status') uit = await zetStatus(id, body);
      else if (actie === 'betaald') {
        const r = await haalBestelling('id', id);
        if (!r) uit = { fout: 'Niet gevonden.' };
        else { const x = await betaald(r, body.methode || 'overboeking', 'admin'); uit = x?.nieuw ? { ok: true } : { fout: `Al verwerkt (status: ${x?.status}).` }; }
      } else if (actie === 'terugbetalen') uit = await terugbetalen(id, body);
      else if (actie === 'ververs') {
        const r = await haalBestelling('id', id);
        if (!r?.mollie_id || !process.env.MOLLIE_API_KEY) uit = { fout: 'Geen Mollie-betaling bij deze bestelling.' };
        else { const x = await verwerkMollie(r.mollie_id); uit = { ok: true, mollie: x.p.status }; }
      } else if (actie === 'notitie') {
        const tekst = String(body.tekst || '').trim().slice(0, 2000);
        await werkBij(id, { notitie: tekst });
        await log(id, 'notitie', tekst ? 'notitie bijgewerkt' : 'notitie gewist', 'admin');
        uit = { ok: true };
      } else if (actie === 'mail') {
        const r = await haalBestelling('id', id);
        const o = r && vanRij(r);
        const fn = o && r.kanaal === 'webshop' ? { bevestiging: () => mails.bevestiging(o), verzonden: () => mails.verzonden(o) }[body.soort] : null;
        uit = !o || !fn ? { fout: 'Onbekende mail.' } : (await mailEnLog(id, `${body.soort} (opnieuw)`, fn)) ? { ok: true } : { fout: 'Mail niet verstuurd (Resend niet ingesteld of fout, zie logboek).' };
      } else return fout(res, 400, 'Onbekende actie.');
      return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json(uit);
    }
    return fout(res, 400, 'Onbekende actie.');
  } catch (e) {
    console.error('admin', e);
    return fout(res, 500, 'Er ging iets mis. Probeer het opnieuw.');
  }
}
