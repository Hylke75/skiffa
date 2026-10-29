// Bestel-endpoint voor de posters.
//
// POST: de browser stuurt alleen wát er besteld wordt (poster-id, formaat, aantal) en de klantgegevens;
// de prijzen komen uit api/_catalogus.js. Alles is env-gated:
//   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY -> elke bestelling komt in de administratie
//     (bestellingen, regels, logboek, factuurnummers; zie supabase/migrations en /admin.html)
//   - MOLLIE_API_KEY  -> Mollie-betaling (iDEAL, Bancontact, kaart); antwoord {ok, url}
//   - RESEND_API_KEY  -> mails aan klant en winkel (bevestiging, verzonden, terugbetaald)
//   - niets ingesteld -> {ok:false}; de frontend opent dan een mail met de bestelling
// GET ?nr=SK-…&t=token : status van een bestelling, voor /bestelling.html (klant)
// GET ?id=tr_…         : status van een Mollie-betaling (oude flow zonder database)
// Spam: honeypot-veld `website` en een minimale invultijd `t` (ms).

import { laadCatalogus } from './_catalogus.js';
import { valideer, overzichtHtml, mail, mollie, naarMetadata, euro, esc, winkelMail, regelRij } from './_bestelling.js';
import { dbAan, db, haalBestelling, log } from './_db.js';
import { mails, mailAan, vanRij, factuurLink } from './_mails.js';
import { verwerkMollie } from './_verwerk.js';

function basisUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}
const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');

async function status(req, res) {
  const nr = param(req, 'nr'), t = param(req, 't'), id = param(req, 'id');
  // Statuspagina van de klant (met administratie).
  if (nr && dbAan()) {
    if (!/^SK-[A-Z0-9]{4,20}$/.test(nr) || !/^[a-f0-9]{36}$/.test(t)) { res.status(400).json({ ok: false }); return; }
    try {
      let b = await haalBestelling('nummer', nr);
      if (!b || b.token !== t) { res.status(404).json({ ok: false }); return; }
      // Webhook nog niet binnen? Vraag de stand zelf op bij Mollie.
      if (b.status === 'open' && b.mollie_id && process.env.MOLLIE_API_KEY) {
        try { b = (await verwerkMollie(b.mollie_id)).bestelling || b; } catch { /* toon wat we weten */ }
      }
      const o = vanRij(b);
      // Alleen zendingen mét track-and-trace: nooit een volglink tonen die nog niet bestaat.
      let zendingen = [], annuleringAangevraagd = false;
      try {
        zendingen = (await db(`zendingen?bestelling_id=eq.${b.id}&select=vervoerder,tracking_code,tracking_url,verzonden_op&order=id.asc`))
          .filter((z) => z.tracking_code || z.tracking_url).map((z) => ({ vervoerder: z.vervoerder, code: z.tracking_code, url: z.tracking_url, op: z.verzonden_op }));
        annuleringAangevraagd = !!(await db(`serviceverzoeken?bestelling_id=eq.${b.id}&soort=eq.annulering&select=id&limit=1`))?.length;
      } catch { /* oudere database */ }
      res.status(200).json({
        zendingen, annulering_aangevraagd: annuleringAangevraagd, annuleren_mogelijk: ['betaald', 'in_productie'].includes(b.status) && !annuleringAangevraagd,
        ok: true, nummer: o.nummer, status: b.status, betaalwijze: b.betaalwijze, aangemaakt: b.aangemaakt_op,
        regels: o.regels, subtotaal: o.subtotaal, verzending: o.verzending, totaal: o.totaal,
        track_trace: b.track_trace, verzonden_op: b.verzonden_op, factuur: factuurLink(o) || null,
      });
    } catch { res.status(200).json({ ok: false }); }
    return;
  }
  // Oude flow: alleen een Mollie-id.
  if (!process.env.MOLLIE_API_KEY || !/^tr_[A-Za-z0-9]{4,40}$/.test(id)) { res.status(400).json({ ok: false }); return; }
  try {
    const p = await mollie(`payments/${id}`);
    res.status(200).json({ ok: true, status: p.status, nummer: p.metadata?.nr });
  } catch { res.status(200).json({ ok: false }); }
}

// Met administratie: bestelling opslaan, dan betalen of bevestigen.
async function metAdministratie(req, res, b) {
  const nummer = 'SK-' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 4).toUpperCase();
  const viaMollie = !!process.env.MOLLIE_API_KEY;
  const [rij] = await db('bestellingen', {
    method: 'POST', prefer: 'return=representation',
    body: {
      nummer, naam: b.klant.naam, email: b.klant.email, straat: b.klant.straat, postcode: b.klant.postcode,
      plaats: b.klant.plaats, land: b.klant.land, opmerking: b.klant.opmerking,
      subtotaal: b.subtotaal, verzending: b.verzending, totaal: b.totaal,
      betaalwijze: viaMollie ? 'mollie' : 'betaalverzoek',
    },
  });
  await db('bestelregels', {
    method: 'POST',
    body: b.regels.map((r) => regelRij(rij.id, r)),   // met vaste kopie van de variant
  });
  await log(rij.id, 'aangemaakt', `${b.regels.reduce((t, r) => t + r.aantal, 0)} poster(s), ${euro(b.totaal)}`, 'klant');

  if (viaMollie) {
    const basis = basisUrl(req);
    const betaling = {
      amount: { currency: 'EUR', value: b.totaal.toFixed(2) },
      description: `Skiffa ${nummer}`,
      redirectUrl: `${basis}/bestelling.html?nr=${nummer}&t=${rij.token}`,
      locale: b.klant.land === 'BE' ? 'nl_BE' : 'nl_NL',
      metadata: { order_id: rij.id, nr: nummer },
    };
    if (/^https:\/\/(?!localhost|127\.)/.test(basis)) betaling.webhookUrl = `${basis}/api/mollie-webhook`;
    try {
      const p = await mollie('payments', { method: 'POST', body: JSON.stringify(betaling) });
      await db(`bestellingen?id=eq.${rij.id}`, { method: 'PATCH', body: { mollie_id: p.id } });
      await log(rij.id, 'betaling', `Mollie-betaling ${p.id} gestart`);
      res.status(200).json({ ok: true, modus: 'mollie', nummer, url: p._links?.checkout?.href });
    } catch (e) {
      await log(rij.id, 'fout', `Mollie: ${e.message}`);
      res.status(200).json({ ok: false, reden: 'betaling-niet-gestart' });
    }
    return;
  }

  // Zonder Mollie: betaalverzoek volgt handmatig (zichtbaar in de administratie).
  const o = vanRij({ ...rij, bestelregels: b.regels.map((r) => ({ poster_naam: r.naam, formaat_label: r.formaatLabel, papier_label: r.papierLabel, prijs: r.prijs, aantal: r.aantal })) });
  for (const [soort, fn] of [['ontvangen', () => mails.ontvangen(o)], ['winkel', () => mails.winkelNieuw(o, 'Nog niet betaald: stuur een betaalverzoek.')]]) {
    try { if (await fn()) await log(rij.id, 'mail', soort); } catch (e) { await log(rij.id, 'fout', `mail ${soort}: ${e.message}`); }
  }
  res.status(200).json({ ok: true, modus: 'mail', nummer, bevestigd: mailAan() });
}

// Zonder administratie (oude flow, blijft werken als Supabase nog niet is ingesteld).
async function zonderAdministratie(req, res, b) {
  const nummer = 'SK-' + Date.now().toString(36).toUpperCase();
  if (process.env.MOLLIE_API_KEY) {
    const basis = basisUrl(req);
    const betaling = {
      amount: { currency: 'EUR', value: b.totaal.toFixed(2) },
      description: `Skiffa ${nummer}`,
      redirectUrl: `${basis}/?bestelling=terug`,
      locale: b.klant.land === 'BE' ? 'nl_BE' : 'nl_NL',
      metadata: naarMetadata(b, nummer),
    };
    if (/^https:\/\/(?!localhost|127\.)/.test(basis)) betaling.webhookUrl = `${basis}/api/mollie-webhook`;
    try {
      const p = await mollie('payments', { method: 'POST', body: JSON.stringify(betaling) });
      try {
        await mollie(`payments/${p.id}`, { method: 'PATCH', body: JSON.stringify({ redirectUrl: `${betaling.redirectUrl}&id=${p.id}` }) });
      } catch { /* niet erg */ }
      res.status(200).json({ ok: true, modus: 'mollie', nummer, id: p.id, url: p._links?.checkout?.href });
    } catch {
      res.status(200).json({ ok: false, reden: 'betaling-niet-gestart' });
    }
    return;
  }
  if (process.env.RESEND_API_KEY) {
    const overzicht = overzichtHtml(b, nummer);
    try {
      await mail({ to: [winkelMail()], reply_to: b.klant.email, subject: `Nieuwe bestelling ${nummer} — ${euro(b.totaal)}`, html: overzicht });
    } catch {
      res.status(200).json({ ok: false, reden: 'mail-mislukt' });
      return;
    }
    try {
      await mail({
        to: [b.klant.email], reply_to: winkelMail(), subject: `Je Skiffa-bestelling ${nummer}`,
        html: `<p>Dank je, ${esc(b.klant.naam)}. We hebben je bestelling ontvangen en sturen je binnen één werkdag een betaalverzoek. Na betaling gaat je poster opgerold in een koker op de post.</p>${overzicht}`,
      });
    } catch { /* de winkel heeft de bestelling; de bevestiging is bijzaak */ }
    res.status(200).json({ ok: true, modus: 'mail', nummer, bevestigd: true });
    return;
  }
  res.status(200).json({ ok: false, reden: 'geen-afhandeling' });
}

// De klant vraagt annulering aan vanaf de statuspagina. Dat is een verzoek, geen automatische annulering:
// het komt op de actielijst, de winkel krijgt een mail en beslist (productie loopt mogelijk al).
async function annuleringsverzoek(res, body) {
  const nr = String(body.nr || ''), t = String(body.t || '');
  if (!dbAan() || !/^SK-[A-Z0-9]{4,20}$/.test(nr) || !/^[a-f0-9]{36}$/.test(t)) return res.status(400).json({ ok: false, melding: 'Onbekende bestelling.' });
  const b = await haalBestelling('nummer', nr);
  if (!b || b.token !== t) return res.status(404).json({ ok: false, melding: 'Onbekende bestelling.' });
  if (!['betaald', 'in_productie'].includes(b.status)) return res.status(400).json({ ok: false, melding: 'Deze bestelling kan niet meer worden geannuleerd via deze pagina. Mail ons gerust.' });
  if ((await db(`serviceverzoeken?bestelling_id=eq.${b.id}&soort=eq.annulering&select=id&limit=1`))?.length) return res.status(200).json({ ok: true, melding: 'Je verzoek is al binnen.' });
  const reden = String(body.reden || '').replace(/[<>]/g, '').trim().slice(0, 1000) || '(geen reden opgegeven)';
  await db('serviceverzoeken', { method: 'POST', body: { bestelling_id: b.id, soort: 'annulering', omschrijving: `Klant vraagt annulering aan: ${reden}`, door: 'klant' } });
  await log(b.id, 'service', `annulering aangevraagd door klant: ${reden.slice(0, 200)}`, 'klant');
  if (mailAan()) await mail({ to: winkelMail(), subject: `Annuleringsverzoek ${b.nummer}`, html: `<p>${esc(b.naam)} vraagt annulering aan van ${esc(b.nummer)}.</p><p>Reden: ${esc(reden)}</p><p>Beslis in /admin (actielijst). De productie loopt mogelijk al.</p>` }).catch(() => {});
  return res.status(200).json({ ok: true, melding: 'Je verzoek is ontvangen. We laten je zo snel mogelijk weten of annuleren nog kan; je poster kan al in productie zijn.' });
}

export default async function handler(req, res) {
  await laadCatalogus();
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return status(req, res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, reden: 'methode' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, reden: 'ongeldig', melding: 'Er ging iets mis met je bestelling.' });
    return;
  }
  if (body.actie === 'annuleringsverzoek') return annuleringsverzoek(res, body);
  // Bot: geef een neutraal antwoord en doe niets.
  if (body.website || Number(body.t) < 1500) {
    res.status(200).json({ ok: true, modus: 'mail', nummer: 'SK-0' });
    return;
  }
  if (body.akkoord !== true) {
    res.status(400).json({ ok: false, reden: 'ongeldig', melding: 'Ga akkoord met de algemene voorwaarden om te bestellen.' });
    return;
  }
  const b = valideer(body);
  if (b.fout) {
    res.status(400).json({ ok: false, reden: 'ongeldig', melding: b.fout });
    return;
  }
  if (dbAan()) {
    try { await metAdministratie(req, res, b); }
    catch (e) { console.error('bestel', e); res.status(200).json({ ok: false, reden: 'opslaan-mislukt' }); }
    return;
  }
  await zonderAdministratie(req, res, b);
}
