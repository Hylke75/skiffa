// Drukbestanden en beelden.
//
// Drukbestand: per variant (poster × formaat × papier) een hoge-resolutie bestand (jpg, png of pdf) in de
// privé bucket 'drukbestanden', met versienummer (drukbestand_versies). Een bestelregel bewaart de versie
// die gold op het moment van bestellen; productie gebruikt altijd die versie. Niets is openbaar: de
// administratie downloadt via een kortlevende link, Prodigi en de drukker krijgen een ondertekende link.
// Bij elke upload wordt het bestand gecontroleerd (beoordeel()); afgekeurde bestanden blokkeren de verkoop
// tot er een nieuw bestand is of een gemotiveerde uitzondering is bevestigd.
//
// Beelden: productfoto's, interieurmock-ups, detail- en papierbeelden (poster_visuals, publieke bucket
// 'visuals'), los van de drukbestanden. Optioneel gekoppeld aan een formaat of papiersoort, zodat de
// webshop bij het wisselen van variant de passende beelden toont.
import { ALLE_POSTERS as POSTERS, ALLE_FORMATEN, BEELDEN, VARIANTEN, variantVoor } from './_catalogus.js';
import { db, log } from './_db.js';
import { onderteken, handtekeningKlopt } from './_auth.js';
import { publiekeUrl } from './_opslag.js';
import { bedrijf } from './_bedrijf.js';
import { mail, esc, LANDEN, winkelMail } from './_bestelling.js';

export const MAX_BEELDEN = 30;
export const AFLOOP_MAX = 5; // mm rondom
const rond = (v, d = 1) => Math.round(Number(v) * 10 ** d) / 10 ** d;
const nl = (v) => String(v).replace('.', ',');
export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' };

// ---- bestandskop lezen (server-side controle van wat er echt is geüpload) ----
/** Leest type en (voor png/jpeg) de pixelmaten uit de eerste bytes van een bestand. */
export function leesKop(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR')
    return { mime: 'image/png', breedte_px: b.readUInt32BE(16), hoogte_px: b.readUInt32BE(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf))
        return { mime: 'image/jpeg', hoogte_px: b.readUInt16BE(i + 5), breedte_px: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { mime: 'image/jpeg', breedte_px: null, hoogte_px: null };
  }
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') {
    const t = b.toString('latin1');
    const box = (n) => { const m = t.match(new RegExp(`/${n}\\s*\\[\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\]`)); return m ? [Math.abs(m[3] - m[1]), Math.abs(m[4] - m[2])].map((x) => rond(x * 25.4 / 72)) : null; };
    return { mime: 'application/pdf', trim: box('TrimBox'), media: box('MediaBox') };
  }
  return { mime: null };
}

// ---- controle van een drukbestand ----
/**
 * Beoordeelt een drukbestand voor een variant. bestand = { mime, breedte_px, hoogte_px, pagina_mm: [b, h] },
 * doel = { mm: [b, h] (formaat), sizing, prodigi: { px: {b, h}, mm: [b, h] } | null }.
 * Geeft { status: ok|waarschuwing|afgekeurd, controles: [{code, ernst, tekst}], uitsnede } terug. Er wordt
 * nooit stilzwijgend bijgesneden of vervormd: elke afwijking staat als controle in de lijst.
 */
export function beoordeel(bestand, doel) {
  const c = [], zet = (code, ernst, tekst) => c.push({ code, ernst, tekst });
  const { mime } = bestand;
  if (!['image/png', 'image/jpeg', 'application/pdf'].includes(mime)) {
    zet('type', 'afgekeurd', `Bestandstype niet herkend of niet ondersteund (${mime || 'onleesbaar'}): gebruik jpg, png of pdf.`);
    return { status: 'afgekeurd', controles: c, uitsnede: null };
  }
  zet('type', 'ok', `Bestandstype ${mime === 'application/pdf' ? 'pdf' : mime.slice(6)}.`);
  const doelMm = doel.prodigi?.mm || doel.mm;
  const doelPx = doel.prodigi?.px || null;
  const doelRatio = doelPx ? doelPx.b / doelPx.h : doelMm[0] / doelMm[1];
  let uitsnede = null;

  if (mime === 'application/pdf') {
    const p = bestand.pagina_mm;
    if (!p) zet('leesbaar', 'waarschuwing', 'De paginamaat kon niet uit de pdf worden gelezen; controleer het bestand zelf.');
    else {
      zet('leesbaar', 'ok', `Pdf-pagina ${nl(p[0])} × ${nl(p[1])} mm.`);
      const a = (p[0] - doelMm[0]) / 2, b = (p[1] - doelMm[1]) / 2;
      const past = a >= -1 && a <= AFLOOP_MAX + 0.5 && Math.abs(a - b) <= 1;
      if (past) zet('afmeting', 'ok', a > 0.5 ? `Juiste maat met ${nl(rond(a))} mm afloop rondom.` : 'Juiste maat.');
      else zet('afmeting', 'afgekeurd', `Pagina is ${nl(p[0])} × ${nl(p[1])} mm; verwacht ${nl(doelMm[0])} × ${nl(doelMm[1])} mm (eventueel met gelijke afloop tot ${AFLOOP_MAX} mm). Een pdf wordt door Prodigi niet geschaald.`);
    }
    zet('resolutie', 'waarschuwing', 'De resolutie van beelden in een pdf kan niet automatisch worden gecontroleerd. Lever bij voorkeur jpg of png op ware grootte.');
  } else {
    const { breedte_px: w, hoogte_px: h } = bestand;
    if (!(w > 0 && h > 0)) {
      zet('leesbaar', 'afgekeurd', 'De afmetingen konden niet uit het bestand worden gelezen; het bestand is mogelijk beschadigd.');
      return { status: 'afgekeurd', controles: c, uitsnede: null };
    }
    zet('leesbaar', 'ok', `${w} × ${h} pixels.`);
    const r = w / h;
    if ((r > 1) !== (doelRatio > 1) && Math.abs(r - 1) > 0.02) zet('orientatie', 'afgekeurd', `Het bestand is ${r > 1 ? 'liggend' : 'staand'}, het formaat ${doelRatio > 1 ? 'liggend' : 'staand'}.`);
    const afwijking = Math.abs(r - doelRatio) / doelRatio;
    if (afwijking <= 0.01) zet('verhouding', 'ok', 'Beeldverhouding past bij het formaat.');
    else {
      // Wat gebeurt er op het papier? fit = witte rand, fill = bijsnijden.
      const breder = r > doelRatio;
      if (doel.sizing === 'fillPrintArea') {
        const weg = breder ? doelMm[0] * (r / doelRatio - 1) / 2 : doelMm[1] * (doelRatio / r - 1) / 2;
        uitsnede = { soort: 'bijsnijden', mm: rond(weg), zijde: breder ? 'links en rechts' : 'boven en onder' };
        zet('verhouding', 'afgekeurd', `Beeldverhouding wijkt af: bij "vullend" wordt ${nl(uitsnede.mm)} mm ${uitsnede.zijde} van het ontwerp afgesneden.`);
      } else {
        const rand = breder ? doelMm[1] * (1 - doelRatio / r) / 2 : doelMm[0] * (1 - r / doelRatio) / 2;
        uitsnede = { soort: 'witte rand', mm: rond(rand), zijde: breder ? 'boven en onder' : 'links en rechts' };
        zet('verhouding', 'waarschuwing', `Beeldverhouding wijkt af: bij "passend" komt er een witte rand van ${nl(uitsnede.mm)} mm ${uitsnede.zijde}.`);
      }
    }
    if (doelPx) {
      const f = Math.min(w / doelPx.b, h / doelPx.h);
      if (f >= 0.999) zet('resolutie', 'ok', `Voldoet aan de pixeleis van het Prodigi-product (${doelPx.b} × ${doelPx.h}).`);
      else if (f >= 0.75) zet('resolutie', 'waarschuwing', `${Math.round(f * 100)}% van de pixels die Prodigi voor dit product vraagt (${doelPx.b} × ${doelPx.h}); kan iets zachter afdrukken.`);
      else zet('resolutie', 'afgekeurd', `Te weinig pixels: ${Math.round(f * 100)}% van wat Prodigi vraagt (${doelPx.b} × ${doelPx.h}).`);
    } else {
      const dpi = Math.min(w / (doelMm[0] / 25.4), h / (doelMm[1] / 25.4));
      if (dpi >= 200) zet('resolutie', 'ok', `Ongeveer ${Math.round(dpi)} dpi op ${nl(doelMm[0] / 10)} × ${nl(doelMm[1] / 10)} cm.`);
      else if (dpi >= 120) zet('resolutie', 'waarschuwing', `Ongeveer ${Math.round(dpi)} dpi op ${nl(doelMm[0] / 10)} × ${nl(doelMm[1] / 10)} cm; liever 200 dpi of meer.`);
      else zet('resolutie', 'afgekeurd', `Te lage resolutie: ongeveer ${Math.round(dpi)} dpi op ${nl(doelMm[0] / 10)} × ${nl(doelMm[1] / 10)} cm.`);
    }
  }
  if (!doel.prodigi) zet('prodigi', 'waarschuwing', 'Nog niet getoetst aan de eisen van een Prodigi-product (koppel en controleer het product bij de variant).');
  else zet('prodigi', 'ok', 'Getoetst aan de eisen van het gekoppelde Prodigi-product.');
  const status = c.some((x) => x.ernst === 'afgekeurd') ? 'afgekeurd' : c.some((x) => x.ernst === 'waarschuwing') ? 'waarschuwing' : 'ok';
  return { status, controles: c, uitsnede };
}

/** Doel voor de controle van een variant (formaat + eventueel de gegevens van het Prodigi-product). */
export function doelVoor(variantRij) {
  const f = ALLE_FORMATEN[variantRij.formaat_id || variantRij.formaat];
  const pp = variantRij.prodigi_status === 'bevestigd' ? variantRij.prodigi_product : null;
  return {
    mm: f?.mm || [0, 0], sizing: variantRij.sizing || 'fitPrintArea',
    prodigi: pp ? { px: pp.px || null, mm: pp.mm || null } : null,
  };
}

// ---- bestandsnamen automatisch koppelen ----
// golf-50x70.pdf · Pier en Strand 30 x 40 cm.png · golf-50x70-mat.jpg · regatta_18x24in.pdf (drukbestand)
// golf-3.jpg (beeld 3 van Golf)
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/×/g, 'x').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const vindPoster = (s) => Object.keys(POSTERS).find((id) => id === s || norm(POSTERS[id]) === s || `skiffa-${id}` === s) || null;

export function herken(bestandsnaam, { beeld = false } = {}) {
  const m = String(bestandsnaam || '').match(/^(.+)\.(pdf|jpe?g|png|webp)$/i);
  if (!m) return { fout: 'alleen pdf, jpg of png (drukbestand) of jpg/png/webp (beeld)' };
  const rest = norm(m[1]), ext = m[2].toLowerCase();
  const pm = rest.match(/(?:^|-)([1-9]|[12][0-9]|30)$/);
  if (beeld || (ext === 'webp') || (pm && !/\d{2,3}-?x-?\d{2,3}/.test(rest))) {
    if (!pm) return { soort: 'beeld', fout: 'geen positie aan het eind van de naam (bv. golf-1.jpg)' };
    const poster_id = vindPoster(rest.slice(0, pm.index).replace(/-+$/, ''));
    return poster_id ? { soort: 'beeld', poster_id, positie: Number(pm[1]) } : { soort: 'beeld', positie: Number(pm[1]), fout: 'poster niet herkend' };
  }
  const fm = rest.match(/(?:^|-)(\d{2,3})-?x-?(\d{2,3})(?:-?(cm|in|inch))?(?:-([a-z][a-z0-9-]*))?$/);
  if (!fm) return { soort: 'druk', fout: 'geen formaat in de naam (bv. golf-50x70.pdf)' };
  const cm = `${fm[1]}x${fm[2]}`, inch = `${cm}in`;
  const formaat = fm[3] === 'in' || fm[3] === 'inch' ? (ALLE_FORMATEN[inch] ? inch : null)
    : ALLE_FORMATEN[cm] ? cm : !fm[3] && ALLE_FORMATEN[inch] ? inch : null;
  const poster_id = vindPoster(rest.slice(0, fm.index).replace(/-+$/, ''));
  if (!formaat) return { soort: 'druk', poster_id, fout: `onbekend formaat ${fm[1]} × ${fm[2]}` };
  if (!poster_id) return { soort: 'druk', formaat, fout: 'poster niet herkend' };
  const v = fm[4] ? variantVoor(poster_id, formaat, fm[4]) : variantVoor(poster_id, formaat);
  return v ? { soort: 'druk', poster_id, formaat, sku: v.sku } : { soort: 'druk', poster_id, formaat, fout: `geen variant voor ${POSTERS[poster_id]} ${ALLE_FORMATEN[formaat].label}${fm[4] ? ` op ${fm[4]}` : ''}` };
}

// ---- ondertekende downloadlinks (mail aan winkel/drukker) ----
export const DRUKLINK_DAGEN = 30;
export function drukLink(versieId, dagen = DRUKLINK_DAGEN) {
  const e = Math.floor(Date.now() / 1000) + dagen * 86400;
  return `${bedrijf().site}/api/media?actie=druk&v=${versieId}&e=${e}&s=${onderteken(`druk|${versieId}|${e}`)}`;
}
export const drukLinkGeldig = (v, e, s) => Number(e) * 1000 > Date.now() && handtekeningKlopt(`druk|${v}|${e}`, s);

// ---- opvragen ----
/** Huidige drukbestandversies van varianten: Map sku → versie. */
export async function huidigeDrukbestanden(skus) {
  const ids = [...new Set(skus.map((s) => VARIANTEN[s]?.drukbestand_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const rijen = await db(`drukbestand_versies?id=in.(${ids.join(',')})&select=*`);
  return new Map(rijen.map((r) => [r.variant_sku, r]));
}

/**
 * Drukbestand per bestelregel: de versie uit de vaste kopie van de regel; voor oudere regels zonder kopie
 * de huidige versie van de variant. Geeft { …regel, druk: { versie_id, status, pad, link } | null }.
 */
export async function metDrukbestanden(regels) {
  const sku = (r) => r.variant_sku || r.sku || variantVoor(r.poster_id, r.formaat)?.sku;
  const ids = [...new Set(regels.map((r) => r.drukbestand_versie_id || VARIANTEN[sku(r)]?.drukbestand_id).filter(Boolean))];
  const rijen = ids.length ? await db(`drukbestand_versies?id=in.(${ids.join(',')})&select=*`) : [];
  const op = new Map(rijen.map((r) => [r.id, r]));
  return regels.map((r) => {
    const d = op.get(r.drukbestand_versie_id || VARIANTEN[sku(r)]?.drukbestand_id);
    return { ...r, druk: d ? { versie_id: d.id, versie: d.versie, status: d.status, pad: d.pad, mime: d.mime, link: drukLink(d.id) } : null };
  });
}

export const visualUrl = (pad) => publiekeUrl('visuals', pad);

/** Beelden per product, in volgorde: { golf: [{positie, soort, url, klein, alt, formaat, papier}] } */
export async function visuals(posterId) {
  const rijen = await db(`poster_visuals?select=*&order=poster_id.asc,positie.asc${posterId ? `&poster_id=eq.${encodeURIComponent(posterId)}` : ''}`);
  const uit = {};
  for (const r of rijen) {
    if (!POSTERS[r.poster_id]) continue;
    (uit[r.poster_id] ||= []).push({ positie: r.positie, soort: r.soort || 'foto', url: visualUrl(r.pad), klein: visualUrl(r.pad_klein), alt: r.alt || '', breedte: r.breedte, hoogte: r.hoogte, formaat: r.formaat_id || null, papier: r.papier_id || null });
  }
  return uit;
}

// ---- productieopdracht aan de eigen drukker (alleen als Prodigi uit staat) ----
const isWebshop = (b) => (b.kanaal || 'webshop') === 'webshop';

export function drukLijstHtml(regels) {
  return `<table style="border-collapse:collapse;font-size:13px;width:100%">${regels.map((r) => `<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid #eee">${r.aantal}× <b>${esc(r.naam)}</b> · ${esc(r.formaatLabel)}${r.papierLabel ? ` · ${esc(r.papierLabel)}` : ''}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${r.druk
    ? `<a href="${r.druk.link}">drukbestand v${r.druk.versie}</a>${r.druk.status === 'afgekeurd' ? ' <span style="color:#a3261a">· afgekeurd (uitzondering)</span>' : ''}`
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
    const t = `Niet naar de drukker: drukbestand ontbreekt voor ${mist.map((r) => `${r.naam} ${r.formaatLabel}`).join(', ')}. Upload het in Beheer → producten en stuur de opdracht opnieuw.`;
    await log(o.id, 'waarschuwing', t, door);
    return { verstuurd: false, reden: t };
  }
  const b = bedrijf();
  await mail({
    to: [aan], reply_to: winkelMail(),
    subject: `Drukopdracht Skiffa ${o.nummer}${kanaal && kanaal !== 'webshop' ? ` (${kanaal})` : ''}`,
    html: `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#111;line-height:1.6;max-width:620px;margin:0 auto;padding:24px">
<p style="letter-spacing:.3em;font-weight:700">SKIFFA</p><h1 style="font-size:17px">Drukopdracht ${esc(o.nummer)}</h1>
<p>Stevig verpakt (opgerold of plat), zonder lijst. De drukbestanden zijn op ware grootte; de links zijn ${DRUKLINK_DAGEN} dagen geldig.</p>
${drukLijstHtml(regels)}
<p style="margin-top:20px"><b>Verzenden naar</b><br>${esc(o.naam)}<br>${esc(o.straat)}<br>${esc(o.postcode)} ${esc(o.plaats)}<br>${LANDEN[o.land] || esc(o.land)}</p>
${o.opmerking ? `<p>Opmerking klant: ${esc(o.opmerking)}</p>` : ''}
<p style="font-size:12px;opacity:.7">Afzender op het pakket: ${esc(b.naam)}, ${esc(b.adres)}. Graag de track-and-trace terugsturen naar ${esc(winkelMail())}.</p>
</body></html>`,
  });
  await log(o.id, 'drukker', `drukopdracht naar ${aan}`, door);
  return { verstuurd: true };
}

export { isWebshop };

/** Foto's voor Etsy en Amazon: het productbeeld en daarna de foto's en mock-ups (geen papierdetails). */
export async function kanaalBeelden(poster_id) {
  let v = [];
  try { v = ((await visuals(poster_id))[poster_id] || []).filter((x) => x.soort !== 'video'); } catch { /* zonder media-tabel: alleen de poster */ }
  const hoofd = BEELDEN[poster_id] ? visualUrl(BEELDEN[poster_id].groot) : `${bedrijf().site}/posters/${poster_id}.jpg`;
  return [hoofd, ...v.map((x) => x.url)];
}
