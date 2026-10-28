// Mollie-webhook: Mollie POST hier `id=tr_…` bij elke statuswijziging van een betaling.
// We vertrouwen de melding zelf niet, maar halen de betaling op bij Mollie. Is hij betaald,
// dan gaat de bestelling (uit de metadata, prijzen opnieuw uit de catalogus) per mail naar de
// winkel en de klant — als RESEND_API_KEY is ingesteld. Zonder Resend staat alles in het Mollie-dashboard.
import { mollie, uitMetadata, overzichtHtml, mail, euro, esc, winkelMail } from './_bestelling.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  let id = req.body?.id;
  if (!id && typeof req.body === 'string') id = new URLSearchParams(req.body).get('id');
  if (!process.env.MOLLIE_API_KEY || !/^tr_[A-Za-z0-9]{4,40}$/.test(String(id || ''))) {
    res.status(200).end(); // onbekend id: niets doen, Mollie niet laten herhalen
    return;
  }
  let p;
  try {
    p = await mollie(`payments/${id}`);
  } catch {
    res.status(500).end(); // Mollie probeert het later opnieuw
    return;
  }
  if (p.status !== 'paid' || !process.env.RESEND_API_KEY) {
    res.status(200).end();
    return;
  }
  const b = uitMetadata(p.metadata);
  if (!b) {
    res.status(200).end();
    return;
  }
  const overzicht = overzichtHtml(b, b.nummer);
  try {
    await mail({
      to: [winkelMail()],
      reply_to: b.klant.email,
      subject: `Betaald: bestelling ${b.nummer} — ${euro(Number(p.amount.value))}`,
      html: `<p>Betaald via Mollie (${esc(p.method || 'onbekend')}, ${esc(p.id)}).</p>${overzicht}`,
    });
  } catch {
    res.status(500).end(); // opnieuw proberen, zodat de winkel de bestelling krijgt
    return;
  }
  try {
    await mail({
      to: [b.klant.email],
      reply_to: winkelMail(),
      subject: `Je Skiffa-bestelling ${b.nummer} is betaald`,
      html: `<p>Dank je, ${esc(b.klant.naam)}. Je betaling is binnen; je poster gaat opgerold in een koker op de post.</p>${overzicht}`,
    });
  } catch { /* bijzaak */ }
  res.status(200).end();
}
