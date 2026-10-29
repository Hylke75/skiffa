// Drukbestanden (privé, per variant, met versies en controle) en productbeelden (openbaar).
// Zie api/_media.js. Eén route, ?actie=…
//
// Openbaar
//   GET  visuals                          beelden per product voor de webshop (60 s gecachet)
//   GET  druk&v=&e=&s=                    ondertekende link (mail aan winkel/drukker) → kortlevende link naar het bestand
// Beheer (ingelogd in /admin)
//   GET  druk&v=                          drukbestandversie downloaden
//   POST herken {namen:[…], beeld?}       bestandsnamen → variant (drukbestand) of product + positie (beeld)
//   POST druk-upload {sku, bytes, bestandsnaam}           ondertekende upload-URL naar de privé opslag
//   POST druk-bevestig {sku, pad, versie, bestandsnaam, meting}   bestand zelf controleren, versie vastleggen
//   POST druk-herbeoordeel {sku}          controle opnieuw (bv. na het koppelen van een Prodigi-product)
//   POST druk-verwijder {versie_id}       alleen versies die geen bestelling gebruikt
//   POST beeld-upload {poster_id, positie, bytes} · beeld-bevestig {…} · beeld-bijwerken {…} · beeld-verwijder {…}
//   POST drukker {id}                     drukopdracht van een bestelling (opnieuw) naar DRUKKER_EMAIL
import { metAudit } from './_audit.js';
import { dbAan, db, haalBestelling } from './_db.js';
import { isAdmin } from './_auth.js';
import { ALLE_POSTERS as POSTERS, ALLE_FORMATEN, PAPIER, laadCatalogus } from './_catalogus.js';
import { uploadUrl, downloadUrl, info, verwijder, kop } from './_opslag.js';
import { MAX_BEELDEN, MIME, leesKop, beoordeel, doelVoor, herken, drukLinkGeldig, visuals, visualUrl } from './_media.js';
import { vanRij } from './_mails.js';
import { drukopdracht } from './_verwerk.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });
const MAX_DRUK = 2 * 1024 ** 3;          // de echte grens is de uploadlimiet van het Supabase-project
const MAX_BEELD = 10 * 1024 ** 2;
const upsert = (tabel, rij) => db(tabel, { method: 'POST', body: rij, prefer: 'resolution=merge-duplicates,return=representation' });
const tekst = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const variantRij = async (sku) => (await db(`varianten?sku=eq.${encodeURIComponent(String(sku || ''))}&select=*`))?.[0] || null;

async function drukUpload(b) {
  const v = await variantRij(b.sku);
  if (!v) return { fout: 'Variant niet gevonden.' };
  if (v.lijst) return { fout: 'Een variant met posterhanger gebruikt het drukbestand van de poster zonder ophanging: upload het daar.' };
  const ext = String(b.bestandsnaam || '').toLowerCase().match(/\.(pdf|png|jpe?g)$/)?.[1];
  if (!ext) return { fout: 'Drukbestand moet jpg, png of pdf zijn.' };
  const bytes = Number(b.bytes);
  if (!(bytes > 0) || bytes > MAX_DRUK) return { fout: 'Ongeldige bestandsgrootte.' };
  const laatste = (await db(`drukbestand_versies?variant_sku=eq.${encodeURIComponent(v.sku)}&select=versie&order=versie.desc&limit=1`))?.[0]?.versie || 0;
  const versie = laatste + 1, pad = `${v.product_id}/${v.sku}/v${versie}-${Date.now().toString(36)}.${ext === 'jpeg' ? 'jpg' : ext}`;
  return { ok: true, pad, versie, mime: MIME[ext], url: await uploadUrl('drukbestanden', pad) };
}

async function drukBevestig(b) {
  const v = await variantRij(b.sku);
  if (!v) return { fout: 'Variant niet gevonden.' };
  const pad = String(b.pad || '');
  const m = pad.match(new RegExp(`^${v.product_id}/${v.sku}/v(\\d+)-[a-z0-9]+\\.(pdf|png|jpg)$`));
  if (!m || Number(m[1]) !== Number(b.versie)) return { fout: 'Ongeldig pad.' };
  const i = await info('drukbestanden', pad);
  if (!i) return { fout: 'Upload niet gevonden in de opslag; probeer het opnieuw.' };
  // Zelf controleren wat er staat (de browser-meting is alleen een aanvulling).
  let k = { mime: null };
  try { k = leesKop(await kop('drukbestanden', pad)); } catch { /* kop niet leesbaar: controle keurt af */ }
  const verwacht = MIME[m[2]];
  const meting = b.meting && typeof b.meting === 'object' ? b.meting : {};
  const bestand = {
    mime: k.mime === verwacht ? k.mime : k.mime ? `${k.mime} (extensie zegt ${m[2]})` : null,
    breedte_px: k.breedte_px || (k.mime === 'image/jpeg' && Number(meting.breedte_px)) || null,
    hoogte_px: k.hoogte_px || (k.mime === 'image/jpeg' && Number(meting.hoogte_px)) || null,
    pagina_mm: k.trim || k.media || (Array.isArray(meting.pagina_mm) ? meting.pagina_mm.slice(0, 2).map(Number) : null),
  };
  const uit = beoordeel(bestand, doelVoor(v));
  if (k.mime === 'image/jpeg' && !k.breedte_px && bestand.breedte_px) uit.controles.splice(1, 0, { code: 'meting', ernst: 'ok', tekst: 'Pixelmaten door de browser gemeten (staan ver in het bestand).' });
  const [rij] = await db('drukbestand_versies', { method: 'POST', prefer: 'return=representation', body: {
    variant_sku: v.sku, versie: Number(b.versie), pad, bestandsnaam: tekst(b.bestandsnaam, 200) || null, bytes: i.bytes, mime: k.mime,
    breedte_px: bestand.breedte_px, hoogte_px: bestand.hoogte_px, pagina_breedte_mm: bestand.pagina_mm?.[0] ?? null, pagina_hoogte_mm: bestand.pagina_mm?.[1] ?? null,
    controles: uit.controles, status: uit.status,
  } });
  // Nieuw bestand = nieuwe beoordeling: een eerdere uitzondering geldt niet automatisch mee.
  await db(`varianten?sku=eq.${encodeURIComponent(v.sku)}`, { method: 'PATCH', body: { drukbestand_id: rij.id, qc_uitzondering: null, qc_uitzondering_op: null, bijgewerkt_op: new Date().toISOString() } });
  return { ok: true, versie_id: rij.id, versie: rij.versie, status: uit.status, controles: uit.controles, uitsnede: uit.uitsnede,
    melding: uit.status === 'ok' ? `Drukbestand v${rij.versie} goedgekeurd` : uit.status === 'waarschuwing' ? `Drukbestand v${rij.versie} opgeslagen, met waarschuwingen` : `Drukbestand v${rij.versie} afgekeurd: zie de controles` };
}

async function drukHerbeoordeel(b) {
  const v = await variantRij(b.sku);
  if (!v?.drukbestand_id) return { fout: 'Deze variant heeft nog geen drukbestand.' };
  const d = (await db(`drukbestand_versies?id=eq.${v.drukbestand_id}&select=*`))?.[0];
  if (!d) return { fout: 'Drukbestand niet gevonden.' };
  const uit = beoordeel({ mime: d.mime, breedte_px: d.breedte_px, hoogte_px: d.hoogte_px, pagina_mm: d.pagina_breedte_mm ? [Number(d.pagina_breedte_mm), Number(d.pagina_hoogte_mm)] : null }, doelVoor(v));
  await db(`drukbestand_versies?id=eq.${d.id}`, { method: 'PATCH', body: { controles: uit.controles, status: uit.status } });
  return { ok: true, status: uit.status, controles: uit.controles, uitsnede: uit.uitsnede };
}

async function drukVerwijder(b) {
  const id = Number(b.versie_id);
  const d = Number.isInteger(id) ? (await db(`drukbestand_versies?id=eq.${id}&select=*`))?.[0] : null;
  if (!d) return { fout: 'Versie niet gevonden.' };
  const gebruikt = await db(`bestelregels?drukbestand_versie_id=eq.${id}&select=id&limit=1`);
  if (gebruikt.length) return { fout: 'Deze versie hoort bij een bestelling en blijft bewaard.' };
  const v = await variantRij(d.variant_sku);
  if (v?.drukbestand_id === id) {
    const vorige = (await db(`drukbestand_versies?variant_sku=eq.${encodeURIComponent(d.variant_sku)}&id=neq.${id}&select=id&order=versie.desc&limit=1`))?.[0];
    await db(`varianten?sku=eq.${encodeURIComponent(d.variant_sku)}`, { method: 'PATCH', body: { drukbestand_id: vorige?.id || null, qc_uitzondering: null, qc_uitzondering_op: null } });
  }
  await db(`drukbestand_versies?id=eq.${id}`, { method: 'DELETE' });
  await verwijder('drukbestanden', [d.pad]).catch(() => {});
  return { ok: true, melding: `Versie ${d.versie} verwijderd` };
}

// ---- beelden ----
function beeldDoel(b) {
  const poster_id = String(b.poster_id || ''), positie = Number(b.positie);
  if (!POSTERS[poster_id]) return { fout: 'Onbekende poster.' };
  if (!Number.isInteger(positie) || positie < 1 || positie > MAX_BEELDEN) return { fout: `Positie moet 1 t/m ${MAX_BEELDEN} zijn.` };
  return { poster_id, positie };
}
const beeldVelden = (b) => ({
  soort: ['foto', 'mockup', 'detail', 'papier', 'video'].includes(b.soort) ? b.soort : 'foto',
  formaat_id: ALLE_FORMATEN[b.formaat_id] ? b.formaat_id : null,
  papier_id: PAPIER[b.papier_id] ? b.papier_id : null,
});

async function beeldUpload(b) {
  const d = beeldDoel(b);
  if (d.fout) return d;
  if (!(Number(b.bytes) > 0) || Number(b.bytes) > MAX_BEELD) return { fout: 'Beeld is te groot (max. 10 MB na verkleinen).' };
  const t = Date.now().toString(36), pad = `${d.poster_id}/${d.positie}-${t}.jpg`, pad_klein = `${d.poster_id}/${d.positie}-${t}-klein.jpg`;
  return { ok: true, pad, pad_klein, url: await uploadUrl('visuals', pad), url_klein: await uploadUrl('visuals', pad_klein) };
}

async function beeldBevestig(b) {
  const d = beeldDoel(b);
  if (d.fout) return d;
  const pad = String(b.pad || ''), pad_klein = String(b.pad_klein || '');
  const patroon = new RegExp(`^${d.poster_id}/${d.positie}-[a-z0-9]+(-klein)?\\.jpg$`);
  if (!patroon.test(pad) || !patroon.test(pad_klein)) return { fout: 'Ongeldig pad.' };
  if (!(await info('visuals', pad)) || !(await info('visuals', pad_klein))) return { fout: 'Upload niet gevonden in de opslag; probeer het opnieuw.' };
  const oud = (await db(`poster_visuals?poster_id=eq.${d.poster_id}&positie=eq.${d.positie}&select=pad,pad_klein`))?.[0];
  await upsert('poster_visuals', {
    poster_id: d.poster_id, positie: d.positie, pad, pad_klein, ...beeldVelden(b),
    breedte: Number(b.breedte) || null, hoogte: Number(b.hoogte) || null,
    alt: tekst(b.alt, 200) || `${POSTERS[d.poster_id]} — beeld ${d.positie}`, geupload_op: new Date().toISOString(),
  });
  if (oud && oud.pad !== pad) await verwijder('visuals', [oud.pad, oud.pad_klein]).catch(() => {});
  return { ok: true, melding: `Beeld ${d.positie} van ${POSTERS[d.poster_id]} opgeslagen` };
}

async function beeldBijwerken(b) {
  const d = beeldDoel(b);
  if (d.fout) return d;
  const rij = await db(`poster_visuals?poster_id=eq.${d.poster_id}&positie=eq.${d.positie}`, { method: 'PATCH', prefer: 'return=representation', body: { ...beeldVelden(b), ...(b.alt !== undefined ? { alt: tekst(b.alt, 200) } : {}) } });
  return rij?.length ? { ok: true, melding: 'Beeld bijgewerkt' } : { fout: 'Beeld niet gevonden.' };
}

async function beeldVerwijder(b) {
  const d = beeldDoel(b);
  if (d.fout) return d;
  const oud = (await db(`poster_visuals?poster_id=eq.${d.poster_id}&positie=eq.${d.positie}&select=pad,pad_klein`))?.[0];
  if (oud) await verwijder('visuals', [oud.pad, oud.pad_klein]).catch(() => {});
  await db(`poster_visuals?poster_id=eq.${d.poster_id}&positie=eq.${d.positie}`, { method: 'DELETE' });
  return { ok: true };
}

// Ontwerpen voor merktoevoegingen (sticker, kaartje, pakbon): openbaar, want Prodigi haalt ze op via een URL.
async function merkUpload(b) {
  const type = String(b.type || '');
  if (!/^(postcard|flyer|packing_slip_(bw|color)|sticker_(exterior|interior)_(round|rectangle))$/.test(type)) return { fout: 'Onbekende merktoevoeging.' };
  const ext = String(b.bestandsnaam || '').toLowerCase().match(/\.(png|jpe?g)$/)?.[1];
  if (!ext) return { fout: 'Ontwerp moet png of jpg zijn.' };
  if (!(Number(b.bytes) > 0) || Number(b.bytes) > 20 * 1024 ** 2) return { fout: 'Ongeldige bestandsgrootte (max. 20 MB).' };
  const pad = `merk/${type}-${Date.now().toString(36)}.${ext === 'jpeg' ? 'jpg' : ext}`;
  return { ok: true, pad, url: await uploadUrl('visuals', pad) };
}
async function merkBevestig(b) {
  const pad = String(b.pad || '');
  if (!/^merk\/[a-z_]+-[a-z0-9]+\.(png|jpg)$/.test(pad)) return { fout: 'Ongeldig pad.' };
  if (!(await info('visuals', pad))) return { fout: 'Upload niet gevonden.' };
  return { ok: true, url: visualUrl(pad) };
}

async function stuurDruk(res, versieId) {
  const d = Number.isInteger(Number(versieId)) ? (await db(`drukbestand_versies?id=eq.${Number(versieId)}&select=pad,variant_sku,versie`))?.[0] : null;
  if (!d) return fout(res, 404, 'Drukbestand niet gevonden.');
  const ext = d.pad.split('.').pop();
  res.setHeader('Location', await downloadUrl('drukbestanden', d.pad, 600, `skiffa-${d.variant_sku.toLowerCase()}-v${d.versie}.${ext}`));
  return res.status(302).end();
}

async function handler(req, res) {
  await laadCatalogus();
  const actie = param(req, 'actie');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};

  try {
    if (actie === 'visuals' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      if (!dbAan()) return res.status(200).json({ ok: true, visuals: {} });
      return res.status(200).json({ ok: true, visuals: await visuals() });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!dbAan()) return fout(res, 503, 'De administratie is nog niet gekoppeld: zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.');

    if (actie === 'druk' && req.method === 'GET') {
      const v = param(req, 'v');
      if (param(req, 's') ? drukLinkGeldig(v, param(req, 'e'), param(req, 's')) : isAdmin(req)) return stuurDruk(res, v);
      return fout(res, 403, 'Deze link is verlopen of ongeldig. Vraag een nieuwe aan bij Skiffa.');
    }

    if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
    if (req.method !== 'POST') return fout(res, 400, 'Onbekende actie.');

    let uit;
    if (actie === 'herken') {
      const namen = Array.isArray(body.namen) ? body.namen.slice(0, 500) : [];
      uit = { ok: true, bestanden: namen.map((naam) => ({ naam: String(naam), ...herken(naam, { beeld: !!body.beeld }) })) };
    } else if (actie === 'drukker') {
      const id = String(body.id || '');
      const r = /^[0-9a-f-]{36}$/.test(id) ? await haalBestelling('id', id) : null;
      if (!r) uit = { fout: 'Bestelling niet gevonden.' };
      else if (!r.betaald_op) uit = { fout: 'Deze bestelling is nog niet betaald.' };
      else {
        const x = await drukopdracht(vanRij(r), 'admin', r.kanaal);
        uit = x.verstuurd ? { ok: true, melding: 'Drukopdracht verstuurd' } : { fout: x.reden };
      }
    } else {
      const fn = { 'druk-upload': drukUpload, 'druk-bevestig': drukBevestig, 'druk-herbeoordeel': drukHerbeoordeel, 'druk-verwijder': drukVerwijder,
        'beeld-upload': beeldUpload, 'beeld-bevestig': beeldBevestig, 'beeld-bijwerken': beeldBijwerken, 'beeld-verwijder': beeldVerwijder, 'merk-upload': merkUpload, 'merk-bevestig': merkBevestig }[actie];
      if (!fn) return fout(res, 400, 'Onbekende actie.');
      uit = await fn(body);
      if (!uit.fout) await laadCatalogus({ vers: true });
    }
    return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json(uit);
  } catch (e) {
    console.error('media', e);
    return fout(res, 500, 'Er ging iets mis. Probeer het opnieuw.');
  }
}

export default metAudit('media', handler);
