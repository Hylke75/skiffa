// Drukbestanden en visuals per poster.
//
// Drukbestand: één hoge-resolutie pdf per poster × formaat, in de privé bucket 'drukbestanden'
// op een vast pad (<poster>/<formaat>.pdf). Elke orderregel wijst daardoor vanzelf naar het juiste
// bestand: in de administratie, in de mail aan de winkel en (met DRUKKER_EMAIL) in de productieopdracht
// aan de drukker. Links zijn ondertekend en lopen via /api/media?actie=druk.
//
// Visuals: zes beelden per poster (positie 1–6) in de publieke bucket 'visuals', voor het
// productvenster in de webshop en als extra foto's op Etsy en Amazon.
import { ALLE_POSTERS as POSTERS, ALLE_FORMATEN, BEELDEN } from './_catalogus.js';
import { db, log } from './_db.js';
import { onderteken, handtekeningKlopt } from './_auth.js';
import { publiekeUrl } from './_opslag.js';
import { bedrijf } from './_bedrijf.js';
import { mail, esc, LANDEN, winkelMail } from './_bestelling.js';

export const AANTAL_VISUALS = 6;
export const AFLOOP_MAX = 5; // mm rondom; meer is waarschijnlijk een verkeerd bestand
const rond = (v) => Math.round(Number(v) * 10) / 10;

export const drukPad = (poster, formaat) => `${poster}/${formaat}.pdf`;
export const drukNaam = (poster, formaat) => `skiffa-${poster}-${formaat}.pdf`;

/**
 * Klopt de maat van de pdf met het formaat? `trim` en `media` zijn [breedte, hoogte] in mm (TrimBox en
 * MediaBox van de eerste pagina). Met een TrimBox moet die gelijk zijn aan het formaat; zonder alleen
 * een MediaBox mag die het formaat zijn plus een gelijke afloop rondom (0–5 mm).
 */
export function maatStatus(formaat, { trim, media } = {}) {
  const f = ALLE_FORMATEN[formaat];
  const maat = (b) => Array.isArray(b) && b.length === 2 && b.every((x) => Number.isFinite(Number(x)) && Number(x) > 0) ? b.map(Number) : null;
  trim = maat(trim); media = maat(media);
  if (!f || (!trim && !media)) return { status: 'onbekend', breedte: null, hoogte: null, afloop: null };
  const [w, h] = f.mm;
  if (trim) {
    const afloop = media ? rond((media[0] - trim[0]) / 2) : 0;
    const ok = Math.abs(trim[0] - w) <= 1 && Math.abs(trim[1] - h) <= 1 && afloop >= 0 && afloop <= AFLOOP_MAX + 0.5;
    return { status: ok ? 'ok' : 'afwijkend', breedte: rond(trim[0]), hoogte: rond(trim[1]), afloop };
  }
  const a = (media[0] - w) / 2, b = (media[1] - h) / 2;
  const ok = a >= -0.75 && a <= AFLOOP_MAX + 0.5 && Math.abs(a - b) <= 0.75;
  return ok
    ? { status: 'ok', breedte: rond(w), hoogte: rond(h), afloop: Math.max(0, rond(a)) }
    : { status: 'afwijkend', breedte: rond(media[0]), hoogte: rond(media[1]), afloop: null };
}

// Bestandsnamen automatisch aan poster en formaat (of positie) koppelen, zodat je alles in één keer
// kunt neerzetten:  golf-50x70.pdf · Pier en Strand 30 x 40 cm.pdf · regatta_18x24in.pdf · golf-3.jpg
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/×/g, 'x').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const vindPoster = (s) => Object.keys(POSTERS).find((id) => id === s || norm(POSTERS[id]) === s || `skiffa-${id}` === s) || null;

export function herken(bestandsnaam) {
  const m = String(bestandsnaam || '').match(/^(.+)\.(pdf|jpe?g|png|webp)$/i);
  if (!m) return { fout: 'alleen pdf (drukbestand) of jpg/png/webp (visual)' };
  const rest = norm(m[1]);
  if (m[2].toLowerCase() === 'pdf') {
    const fm = rest.match(/(?:^|-)(\d{2,3})-?x-?(\d{2,3})(?:-?(cm|in|inch))?$/);
    if (!fm) return { soort: 'druk', fout: 'geen formaat in de naam (bv. golf-50x70.pdf)' };
    const cm = `${fm[1]}x${fm[2]}`, inch = `${cm}in`;
    const formaat = fm[3] === 'in' || fm[3] === 'inch' ? (ALLE_FORMATEN[inch] ? inch : null)
      : ALLE_FORMATEN[cm] ? cm : !fm[3] && ALLE_FORMATEN[inch] ? inch : null;
    const poster_id = vindPoster(rest.slice(0, fm.index).replace(/-+$/, ''));
    if (!formaat) return { soort: 'druk', poster_id, fout: `onbekend formaat ${fm[1]} × ${fm[2]}` };
    return poster_id ? { soort: 'druk', poster_id, formaat } : { soort: 'druk', formaat, fout: 'poster niet herkend' };
  }
  const pm = rest.match(/(?:^|-)([1-6])$/);
  if (!pm) return { soort: 'visual', fout: 'geen positie 1–6 aan het eind van de naam (bv. golf-1.jpg)' };
  const poster_id = vindPoster(rest.slice(0, pm.index).replace(/-+$/, ''));
  return poster_id ? { soort: 'visual', poster_id, positie: Number(pm[1]) } : { soort: 'visual', positie: Number(pm[1]), fout: 'poster niet herkend' };
}

// ---- ondertekende downloadlinks voor drukbestanden ----
export const DRUKLINK_DAGEN = 30;
export function drukLink(poster, formaat, dagen = DRUKLINK_DAGEN) {
  const e = Math.floor(Date.now() / 1000) + dagen * 86400;
  const s = onderteken(`druk|${poster}|${formaat}|${e}`);
  return `${bedrijf().site}/api/media?actie=druk&p=${encodeURIComponent(poster)}&f=${encodeURIComponent(formaat)}&e=${e}&s=${s}`;
}
export function drukLinkGeldig(p, f, e, s) {
  return Number(e) * 1000 > Date.now() && handtekeningKlopt(`druk|${p}|${f}|${e}`, s);
}

// ---- opvragen ----
export async function drukbestanden(posterIds) {
  const ids = [...new Set(posterIds)].filter((p) => POSTERS[p]);
  if (!ids.length) return new Map();
  const rijen = await db(`drukbestanden?poster_id=in.(${ids.join(',')})&select=*`);
  return new Map(rijen.map((r) => [`${r.poster_id}|${r.formaat}`, r]));
}

/** Drukbestand per orderregel: { …regel, druk: { status, link } | null } */
export async function metDrukbestanden(regels) {
  const m = await drukbestanden(regels.map((r) => r.poster_id));
  return regels.map((r) => {
    const d = m.get(`${r.poster_id}|${r.formaat}`);
    return { ...r, druk: d ? { status: d.maat_status, bytes: d.bytes, link: drukLink(r.poster_id, r.formaat) } : null };
  });
}

export const visualUrl = (pad) => publiekeUrl('visuals', pad);

/** Visuals per poster, in volgorde van positie: { golf: [{positie, url, klein, alt}] } */
export async function visuals(posterId) {
  const rijen = await db(`poster_visuals?select=*&order=poster_id.asc,positie.asc${posterId ? `&poster_id=eq.${encodeURIComponent(posterId)}` : ''}`);
  const uit = {};
  for (const r of rijen) {
    if (!POSTERS[r.poster_id]) continue;
    (uit[r.poster_id] ||= []).push({ positie: r.positie, url: visualUrl(r.pad), klein: visualUrl(r.pad_klein), alt: r.alt || '', breedte: r.breedte, hoogte: r.hoogte });
  }
  return uit;
}

// ---- productieopdracht aan de drukker ----
const isWebshop = (b) => (b.kanaal || 'webshop') === 'webshop';

export function drukLijstHtml(regels) {
  return `<table style="border-collapse:collapse;font-size:13px;width:100%">${regels.map((r) => `<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid #eee">${r.aantal}× <b>${esc(r.naam)}</b> · ${esc(r.formaatLabel)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${r.druk
    ? `<a href="${r.druk.link}">drukbestand (pdf)</a>${r.druk.status === 'afwijkend' ? ' <span style="color:#a3261a">· maat wijkt af</span>' : ''}`
    : '<span style="color:#a3261a">drukbestand ontbreekt</span>'}</td></tr>`).join('')}</table>`;
}

/**
 * Stuurt de productieopdracht (verzendadres + drukbestanden) naar DRUKKER_EMAIL. Niet als er een
 * drukbestand ontbreekt: dan krijgt alleen de winkel een waarschuwing en kan het later vanuit /admin.
 */
export async function naarDrukker(o, { door = 'systeem', kanaal } = {}) {
  const aan = process.env.DRUKKER_EMAIL;
  if (!aan || !process.env.RESEND_API_KEY) return { verstuurd: false, reden: 'DRUKKER_EMAIL of RESEND_API_KEY niet ingesteld' };
  const regels = await metDrukbestanden(o.regels);
  const mist = regels.filter((r) => !r.druk);
  if (mist.length) {
    const t = `Niet naar de drukker: drukbestand ontbreekt voor ${mist.map((r) => `${r.naam} ${r.formaatLabel}`).join(', ')}. Upload het in Beheer → Posters en stuur de opdracht opnieuw.`;
    await log(o.id, 'waarschuwing', t, door);
    return { verstuurd: false, reden: t };
  }
  const b = bedrijf();
  await mail({
    to: [aan], reply_to: winkelMail(),
    subject: `Drukopdracht Skiffa ${o.nummer}${kanaal && kanaal !== 'webshop' ? ` (${kanaal})` : ''}`,
    html: `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#111;line-height:1.6;max-width:620px;margin:0 auto;padding:24px">
<p style="letter-spacing:.3em;font-weight:700">SKIFFA</p><h1 style="font-size:17px">Drukopdracht ${esc(o.nummer)}</h1>
<p>Giclée op 250 grams mat fine-art papier, opgerold in een koker, zonder lijst. De drukbestanden zijn op ware grootte (met afloop als die erin staat); de links zijn ${DRUKLINK_DAGEN} dagen geldig.</p>
${drukLijstHtml(regels)}
<p style="margin-top:20px"><b>Verzenden naar</b><br>${esc(o.naam)}<br>${esc(o.straat)}<br>${esc(o.postcode)} ${esc(o.plaats)}<br>${LANDEN[o.land] || esc(o.land)}</p>
${o.opmerking ? `<p>Opmerking klant: ${esc(o.opmerking)}</p>` : ''}
<p style="font-size:12px;opacity:.7">Afzender op het pakket: ${esc(b.naam)}, ${esc(b.adres)}. Graag de track-and-trace terugsturen naar ${esc(winkelMail())}.</p>
</body></html>`,
  });
  await log(o.id, 'drukker', `drukopdracht naar ${aan}`, door);
  return { verstuurd: true };
}

export const automatischNaarDrukker = () => !!process.env.DRUKKER_EMAIL;
export { isWebshop };

/** Foto's voor Etsy en Amazon: de poster zelf (jpg) en daarna de visuals. */
export async function kanaalBeelden(poster_id) {
  let v = [];
  try { v = (await visuals(poster_id))[poster_id] || []; } catch { /* zonder media-tabel: alleen de poster */ }
  const hoofd = BEELDEN[poster_id] ? visualUrl(BEELDEN[poster_id].groot) : `${bedrijf().site}/posters/${poster_id}.jpg`;
  return [hoofd, ...v.map((x) => x.url)];
}
