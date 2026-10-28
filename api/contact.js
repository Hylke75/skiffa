// Contactformulier: stuurt het bericht via Resend naar de winkel (env-gated, net als bestellen).
// Zonder RESEND_API_KEY antwoordt hij {ok:false} en opent de site een mail met het bericht erin.
// Spam: honeypot-veld `website` en een minimale invultijd `t` (ms).
import { esc, mail, winkelMail } from './_bestelling.js';

const ONDERWERPEN = { bestelling: 'bestelling', ruilen: 'ruilen of retour', anders: 'iets anders' };
const tekst = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false });
    return;
  }
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { b = null; }
  }
  if (!b || typeof b !== 'object') {
    res.status(400).json({ ok: false });
    return;
  }
  if (b.website || Number(b.t) < 1500) {
    res.status(200).json({ ok: true });
    return;
  }
  const naam = tekst(b.naam, 100);
  const contact = tekst(b.mail, 160);
  const bericht = tekst(b.bericht, 3000);
  const onderwerp = ONDERWERPEN[b.waarover] || 'iets anders';
  const bellen = b.hoe === 'bel';
  if (naam.length < 2 || contact.length < 5 || bericht.length < 2) {
    res.status(400).json({ ok: false, reden: 'ongeldig' });
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    res.status(200).json({ ok: false, reden: 'geen-afhandeling' });
    return;
  }
  const isMail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
  try {
    await mail({
      to: [winkelMail()],
      ...(isMail ? { reply_to: contact } : {}),
      subject: `Contact (${onderwerp}) — ${naam}`,
      html: `<p><b>${esc(naam)}</b> · ${esc(contact)} · wil graag ${bellen ? 'gebeld worden' : 'een mail'}</p><p style="white-space:pre-wrap">${esc(bericht)}</p>`,
    });
    res.status(200).json({ ok: true });
  } catch {
    res.status(200).json({ ok: false, reden: 'mail-mislukt' });
  }
}
