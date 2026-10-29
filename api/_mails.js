// Mails aan klant en winkel (via Resend). Eén opmaak, zodat alle mails er hetzelfde uitzien.
import { mail, esc, euro, LANDEN, winkelMail } from './_bestelling.js';
import { bedrijf, btwDeel } from './_bedrijf.js';

export const mailAan = () => !!process.env.RESEND_API_KEY;

// Een bestelling uit de database (of uit Mollie-metadata) in één vorm.
export function vanRij(r) {
  return {
    id: r.id, nummer: r.nummer, token: r.token, status: r.status,
    naam: r.naam, email: r.email, straat: r.straat, postcode: r.postcode, plaats: r.plaats, land: r.land, opmerking: r.opmerking || '',
    subtotaal: Number(r.subtotaal), verzending: Number(r.verzending), totaal: Number(r.totaal),
    factuurnummer: r.factuurnummer, track_trace: r.track_trace,
    regels: (r.bestelregels || []).map((x) => ({ poster_id: x.poster_id, formaat: x.formaat, naam: x.poster_naam, formaatLabel: x.formaat_label, prijs: Number(x.prijs), aantal: x.aantal })),
  };
}

export const statusLink = (o) => o.token ? `${bedrijf().site}/bestelling.html?nr=${encodeURIComponent(o.nummer)}&t=${o.token}` : '';
export const factuurLink = (o) => o.token && o.factuurnummer ? `${bedrijf().site}/api/factuur?nr=${encodeURIComponent(o.nummer)}&t=${o.token}` : '';

const knop = (href, tekst) => href ? `<p style="margin:22px 0"><a href="${href}" style="background:#000;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:12px;letter-spacing:.08em">${tekst}</a></p>` : '';

export function overzicht(o) {
  const rij = (l, r, b) => `<tr><td style="padding:5px 18px 5px 0;${b ? 'font-weight:600' : ''}">${l}</td><td style="padding:5px 0;text-align:right;${b ? 'font-weight:600' : ''}">${r}</td></tr>`;
  return `<table style="border-collapse:collapse;font-size:13px;width:100%;max-width:420px">` +
    o.regels.map((r) => rij(`${r.aantal}× poster ${esc(r.naam)}<br><span style="opacity:.6">${esc(r.formaatLabel)}</span>`, euro(r.prijs * r.aantal))).join('') +
    `<tr><td colspan="2" style="border-top:1px solid #ddd;padding-top:4px"></td></tr>` +
    rij('subtotaal', euro(o.subtotaal)) +
    rij('verzending', o.verzending ? euro(o.verzending) : 'gratis') +
    rij('totaal', euro(o.totaal), true) +
    `<tr><td colspan="2" style="font-size:11px;opacity:.6;padding-top:2px">waarvan btw (21%) ${euro(btwDeel(o.totaal))}</td></tr></table>`;
}

const adres = (o) => `${esc(o.naam)}<br>${esc(o.straat)}<br>${esc(o.postcode)} ${esc(o.plaats)}<br>${LANDEN[o.land] || esc(o.land)}`;

function opmaak(kop, inhoud) {
  const b = bedrijf();
  return `<!doctype html><html><body style="margin:0;background:#F6F3ED"><div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Helvetica,Arial,sans-serif;color:#111;line-height:1.6">
<p style="font-size:20px;letter-spacing:.3em;font-weight:700;margin:0 0 28px">SKIFFA</p>
<h1 style="font-size:17px;font-weight:600;margin:0 0 14px">${kop}</h1>${inhoud}
<p style="margin-top:34px;font-size:11px;opacity:.6">${esc(b.naam)} · ${esc(b.adres)} · ${esc(b.email)}<br>KvK ${esc(b.kvk)} · btw ${esc(b.btw)}</p>
</div></body></html>`;
}

async function stuur(aan, onderwerp, html, replyTo) {
  if (!mailAan()) return false;
  await mail({ to: [aan], subject: onderwerp, html, ...(replyTo ? { reply_to: replyTo } : {}) });
  return true;
}

export const mails = {
  // Na een geslaagde betaling (of handmatig betaald gezet): bevestiging + factuur.
  bevestiging: (o) => stuur(o.email, `Bedankt voor je bestelling ${o.nummer}`, opmaak(`Bedankt, ${esc(o.naam.split(' ')[0])}. Je betaling is binnen.`,
    `<p>We gaan je poster${o.regels.reduce((t, r) => t + r.aantal, 0) > 1 ? 's' : ''} drukken. Binnen twee werkdagen gaat je bestelling opgerold in een koker op de post; je krijgt dan een mail met de track-and-trace.</p>
<p style="font-size:12px;opacity:.7">Bestelnummer <b>${esc(o.nummer)}</b>${o.factuurnummer ? ` · factuur ${esc(o.factuurnummer)}` : ''}</p>${overzicht(o)}
<p style="margin-top:20px">Verzendadres:<br>${adres(o)}</p>${knop(factuurLink(o), 'bekijk je factuur')}${o.token ? `<p style="font-size:12px">Je bestelling volgen: <a href="${statusLink(o)}">${statusLink(o)}</a></p>` : ''}
<p style="font-size:12px;opacity:.7">Je hebt 14 dagen bedenktijd vanaf ontvangst. Retourneren of een vraag? Beantwoord deze mail.</p>`), winkelMail()),

  // Zonder Mollie: bestelling ontvangen, betaalverzoek volgt.
  ontvangen: (o) => stuur(o.email, `We hebben je bestelling ${o.nummer} ontvangen`, opmaak(`Dank je, ${esc(o.naam.split(' ')[0])}. Je bestelling is binnen.`,
    `<p>Je ontvangt binnen één werkdag een betaalverzoek. Na betaling gaat je poster opgerold in een koker op de post.</p>${overzicht(o)}<p style="margin-top:20px">Verzendadres:<br>${adres(o)}</p>`), winkelMail()),

  verzonden: (o) => stuur(o.email, `Je Skiffa-bestelling ${o.nummer} is onderweg`, opmaak('Je poster is onderweg.',
    `<p>Je bestelling ${esc(o.nummer)} is vandaag verstuurd, opgerold in een stevige koker.</p>
${o.track_trace ? `<p>Track-and-trace: ${/^https?:\/\//.test(o.track_trace) ? `<a href="${esc(o.track_trace)}">${esc(o.track_trace)}</a>` : `<b>${esc(o.track_trace)}</b>`}</p>` : ''}
<p>Tip: leg de poster na het uitpakken een nacht plat onder een paar boeken, dan ligt hij weer recht.</p>${knop(statusLink(o), 'bekijk je bestelling')}`), winkelMail()),

  terugbetaald: (o, bedrag) => stuur(o.email, `Terugbetaling voor bestelling ${o.nummer}`, opmaak('We hebben je geld teruggestort.',
    `<p>Voor bestelling ${esc(o.nummer)} is ${euro(bedrag)} teruggestort. Afhankelijk van je bank staat het binnen een paar werkdagen op je rekening.</p>`), winkelMail()),

  geannuleerd: (o) => stuur(o.email, `Bestelling ${o.nummer} is geannuleerd`, opmaak('Je bestelling is geannuleerd.',
    `<p>Bestelling ${esc(o.nummer)} is geannuleerd. Had je al betaald, dan krijg je daarover een aparte mail. Was dit niet de bedoeling? Beantwoord deze mail.</p>`), winkelMail()),

  // Aan de winkel.
  // `druk`: de drukbestanden per regel (html uit api/_media.js), zodat je direct kunt laten drukken.
  winkelNieuw: (o, extra = '', druk = '') => stuur(winkelMail(), `${o.factuurnummer ? 'Betaald' : 'Nieuwe bestelling'}: ${o.nummer} — ${euro(o.totaal)}`, opmaak(`Bestelling ${esc(o.nummer)}`,
    `${extra ? `<p>${extra}</p>` : ''}${overzicht(o)}${druk ? `<h2 style="font-size:13px;margin:22px 0 6px">Drukbestanden</h2>${druk}` : ''}<p style="margin-top:20px">${adres(o)}<br>${esc(o.email)}</p>${o.opmerking ? `<p>Opmerking: ${esc(o.opmerking)}</p>` : ''}
${knop(`${bedrijf().site}/admin.html#${encodeURIComponent(o.nummer)}`, 'open in de administratie')}`), o.email),
};
