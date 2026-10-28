// Bestel-endpoint voor de posters.
//
// De browser stuurt alleen wát er besteld wordt (poster-id, formaat, aantal) en de klantgegevens;
// de prijzen komen uit api/_catalogus.js. Afhandeling is env-gated, net als de CMS-koppeling:
//   1. STRIPE_SECRET_KEY            -> Stripe Checkout (iDEAL/kaart); antwoord {ok, url}
//   2. RESEND_API_KEY (+ BESTEL_EMAIL, RESEND_FROM)
//                                   -> bestelling per mail naar de winkel + bevestiging naar de klant
//   3. niets ingesteld              -> {ok:false}; de frontend opent dan een mail met de bestelling
// Spam: honeypot-veld `website` en een minimale invultijd `t` (ms).

import { POSTERS, FORMATEN, verzendkosten } from './_catalogus.js';

const LANDEN = { NL: 'Nederland', BE: 'België' };
const tekst = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (v) => '€ ' + v.toFixed(2).replace('.', ',');

function valideer(body) {
  const k = body.klant || {};
  const klant = {
    naam: tekst(k.naam, 100),
    email: tekst(k.email, 160),
    straat: tekst(k.straat, 120),
    postcode: tekst(k.postcode, 12).toUpperCase(),
    plaats: tekst(k.plaats, 80),
    land: LANDEN[k.land] ? k.land : '',
    opmerking: tekst(k.opmerking, 500),
  };
  if (klant.naam.length < 2) return { fout: 'Vul je naam in.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(klant.email)) return { fout: 'Vul een geldig e-mailadres in.' };
  if (klant.straat.length < 3) return { fout: 'Vul je straat en huisnummer in.' };
  if (klant.postcode.length < 4) return { fout: 'Vul je postcode in.' };
  if (klant.plaats.length < 2) return { fout: 'Vul je woonplaats in.' };
  if (!klant.land) return { fout: 'We versturen alleen naar Nederland en België.' };

  if (!Array.isArray(body.regels) || !body.regels.length || body.regels.length > 20) return { fout: 'Je mandje is leeg.' };
  const regels = [];
  for (const r of body.regels) {
    const naam = POSTERS[r?.id];
    const formaat = FORMATEN[r?.formaat];
    const aantal = Number(r?.aantal);
    if (!naam || !formaat || !Number.isInteger(aantal) || aantal < 1 || aantal > 10) return { fout: 'Er klopt iets niet in je mandje. Ververs de pagina en probeer het opnieuw.' };
    regels.push({ id: r.id, naam, formaat: r.formaat, formaatLabel: formaat.label, prijs: formaat.prijs, aantal });
  }
  const subtotaal = regels.reduce((t, r) => t + r.prijs * r.aantal, 0);
  const verzending = verzendkosten(subtotaal, klant.land);
  return { klant, regels, subtotaal, verzending, totaal: subtotaal + verzending };
}

function basisUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

async function stripeCheckout(req, b, nummer) {
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('locale', 'nl');
  p.set('customer_email', b.klant.email);
  p.set('client_reference_id', nummer);
  p.set('success_url', `${basisUrl(req)}/?bestelling=gelukt&nr=${nummer}`);
  p.set('cancel_url', `${basisUrl(req)}/?bestelling=geannuleerd`);
  const items = b.regels.map((r) => ({ naam: `Poster ${r.naam} — ${r.formaatLabel}`, bedrag: r.prijs, aantal: r.aantal }));
  if (b.verzending) items.push({ naam: 'Verzending in koker', bedrag: b.verzending, aantal: 1 });
  items.forEach((it, i) => {
    p.set(`line_items[${i}][quantity]`, String(it.aantal));
    p.set(`line_items[${i}][price_data][currency]`, 'eur');
    p.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(it.bedrag * 100)));
    p.set(`line_items[${i}][price_data][product_data][name]`, it.naam);
  });
  const meta = {
    nummer,
    naam: b.klant.naam,
    adres: `${b.klant.straat}, ${b.klant.postcode} ${b.klant.plaats}, ${LANDEN[b.klant.land]}`,
    opmerking: b.klant.opmerking,
  };
  for (const [k, v] of Object.entries(meta)) {
    p.set(`metadata[${k}]`, v);
    p.set(`payment_intent_data[metadata][${k}]`, v);
  }
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: p,
  });
  const d = await r.json();
  if (!r.ok || !d.url) throw new Error(`stripe-${r.status}`);
  return d.url;
}

function overzichtHtml(b, nummer) {
  const rij = (l, r) => `<tr><td style="padding:4px 16px 4px 0">${l}</td><td style="padding:4px 0;text-align:right">${r}</td></tr>`;
  return `<p><b>Bestelling ${esc(nummer)}</b></p><table style="border-collapse:collapse;font-family:monospace;font-size:13px">` +
    b.regels.map((r) => rij(`${r.aantal}× ${esc(r.naam)} — ${esc(r.formaatLabel)}`, euro(r.prijs * r.aantal))).join('') +
    rij('verzending', b.verzending ? euro(b.verzending) : 'gratis') +
    rij('<b>totaal</b>', `<b>${euro(b.totaal)}</b>`) +
    `</table><p>${esc(b.klant.naam)}<br>${esc(b.klant.straat)}<br>${esc(b.klant.postcode)} ${esc(b.klant.plaats)}<br>${LANDEN[b.klant.land]}<br>${esc(b.klant.email)}</p>` +
    (b.klant.opmerking ? `<p>Opmerking: ${esc(b.klant.opmerking)}</p>` : '');
}

async function mail(bericht) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'Skiffa <bestellingen@skiffa.nl>', ...bericht }),
  });
  if (!r.ok) throw new Error(`resend-${r.status}`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

  if (process.env.STRIPE_SECRET_KEY) {
    try {
      res.status(200).json({ ok: true, modus: 'stripe', nummer, url: await stripeCheckout(req, b, nummer) });
    } catch (e) {
      res.status(200).json({ ok: false, reden: 'betaling-niet-gestart' });
    }
    return;
  }

  if (process.env.RESEND_API_KEY) {
    const winkel = process.env.BESTEL_EMAIL || 'hallo@skiffa.nl';
    const overzicht = overzichtHtml(b, nummer);
    try {
      await mail({ to: [winkel], reply_to: b.klant.email, subject: `Nieuwe bestelling ${nummer} — ${euro(b.totaal)}`, html: overzicht });
    } catch (e) {
      res.status(200).json({ ok: false, reden: 'mail-mislukt' });
      return;
    }
    try {
      await mail({
        to: [b.klant.email],
        reply_to: winkel,
        subject: `Je Skiffa-bestelling ${nummer}`,
        html: `<p>Dank je, ${esc(b.klant.naam)}. We hebben je bestelling ontvangen en sturen je binnen één werkdag een betaalverzoek. Na betaling gaat je poster opgerold in een koker op de post.</p>${overzicht}`,
      });
    } catch { /* de winkel heeft de bestelling; de bevestiging is bijzaak */ }
    res.status(200).json({ ok: true, modus: 'mail', nummer });
    return;
  }

  res.status(200).json({ ok: false, reden: 'geen-afhandeling' });
}
