// Bestel-endpoint voor de posters.
//
// POST: de browser stuurt alleen wát er besteld wordt (poster-id, formaat, aantal) en de klantgegevens;
// de prijzen komen uit api/_catalogus.js. Afhandeling is env-gated, net als de CMS-koppeling:
//   1. MOLLIE_API_KEY  -> Mollie-betaling (iDEAL, Bancontact, kaart); antwoord {ok, url, id}.
//                         Na betalen stuurt Mollie de klant terug naar /?bestelling=terug en meldt
//                         api/mollie-webhook.js de betaalde bestelling (mail via Resend, als ingesteld).
//   2. RESEND_API_KEY  -> bestelling per mail naar de winkel + bevestiging naar de klant
//   3. niets ingesteld -> {ok:false}; de frontend opent dan een mail met de bestelling
// GET ?id=tr_…: status van een Mollie-betaling, voor de terugkeerpagina.
// Spam: honeypot-veld `website` en een minimale invultijd `t` (ms).

import { valideer, overzichtHtml, mail, mollie, naarMetadata, euro, esc, winkelMail } from './_bestelling.js';

function basisUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

async function status(req, res) {
  const id = String(req.query?.id || new URL(req.url, 'http://x').searchParams.get('id') || '');
  if (!process.env.MOLLIE_API_KEY || !/^tr_[A-Za-z0-9]{4,40}$/.test(id)) {
    res.status(400).json({ ok: false });
    return;
  }
  try {
    const p = await mollie(`payments/${id}`);
    res.status(200).json({ ok: true, status: p.status, nummer: p.metadata?.nr });
  } catch {
    res.status(200).json({ ok: false });
  }
}

export default async function handler(req, res) {
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
  // Bot: geef een neutraal antwoord en doe niets.
  if (body.website || Number(body.t) < 1500) {
    res.status(200).json({ ok: true, modus: 'mail', nummer: 'SK-0' });
    return;
  }

  const b = valideer(body);
  if (b.fout) {
    res.status(400).json({ ok: false, reden: 'ongeldig', melding: b.fout });
    return;
  }
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
    // Mollie weigert een webhook die het niet kan bereiken (bijv. localhost).
    if (/^https:\/\/(?!localhost|127\.)/.test(basis)) betaling.webhookUrl = `${basis}/api/mollie-webhook`;
    try {
      const p = await mollie('payments', { method: 'POST', body: JSON.stringify(betaling) });
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
        to: [b.klant.email],
        reply_to: winkelMail(),
        subject: `Je Skiffa-bestelling ${nummer}`,
        html: `<p>Dank je, ${esc(b.klant.naam)}. We hebben je bestelling ontvangen en sturen je binnen één werkdag een betaalverzoek. Na betaling gaat je poster opgerold in een koker op de post.</p>${overzicht}`,
      });
    } catch { /* de winkel heeft de bestelling; de bevestiging is bijzaak */ }
    res.status(200).json({ ok: true, modus: 'mail', nummer });
    return;
  }

  res.status(200).json({ ok: false, reden: 'geen-afhandeling' });
}
