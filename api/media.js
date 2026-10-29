// Drukbestanden en visuals per poster (zie api/_media.js). Eén route, ?actie=…
//
// Openbaar
//   GET  visuals                          { golf: [{positie, url, klein, alt}] } voor de webshop (60 s gecachet)
//   GET  druk&p=&f=&e=&s=                 ondertekende link uit mail/administratie → doorsturen naar de pdf
// Beheer (ingelogd in /admin)
//   GET  overzicht                        per poster: drukbestand per formaat (met maatcontrole) en de 6 visuals
//   GET  druk&p=&f=                       pdf downloaden (ingelogd, zonder handtekening)
//   POST herken {namen:[…]}               bestandsnamen → poster + formaat / positie
//   POST upload {soort, poster_id, formaat|positie, bytes}    ondertekende upload-URL(s) naar Supabase Storage
//   POST bevestig {soort, poster_id, formaat|positie, …}      upload controleren en koppelen
//   POST verwijder {soort, poster_id, formaat|positie}
//   POST drukker {id}                     drukopdracht van een bestelling (opnieuw) naar DRUKKER_EMAIL
import { dbAan, db, haalBestelling } from './_db.js';
import { isAdmin } from './_auth.js';
import { ALLE_POSTERS as POSTERS, ALLE_FORMATEN, BEELDEN, laadCatalogus } from './_catalogus.js';
import { uploadUrl, downloadUrl, info, verwijder } from './_opslag.js';
import { AANTAL_VISUALS, drukPad, drukNaam, maatStatus, herken, drukLinkGeldig, drukbestanden, visuals } from './_media.js';
import { vanRij } from './_mails.js';
import { drukopdracht } from './_verwerk.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });
const MAX_PDF = 2 * 1024 ** 3;          // 2 GB; de echte grens is de uploadlimiet van je Supabase-project
const MAX_VISUAL = 10 * 1024 ** 2;
const geldigPositie = (p) => Number.isInteger(p) && p >= 1 && p <= AANTAL_VISUALS;
const upsert = (tabel, rij) => db(tabel, { method: 'POST', body: rij, prefer: 'resolution=merge-duplicates,return=representation' });

async function overzicht() {
  const [druk, vis] = await Promise.all([drukbestanden(Object.keys(POSTERS)), visuals()]);
  const formaten = Object.entries(ALLE_FORMATEN).map(([id, f]) => ({ id, label: f.label, mm: f.mm, actief: f.actief }));
  const posters = Object.entries(POSTERS).map(([id, naam]) => ({
    id, naam,
    druk: Object.fromEntries(formaten.map((f) => {
      const d = druk.get(`${id}|${f.id}`);
      return [f.id, d ? { status: d.maat_status, bytes: d.bytes, breedte: d.breedte_mm, hoogte: d.hoogte_mm, afloop: d.afloop_mm, paginas: d.paginas, bestandsnaam: d.bestandsnaam, op: d.geupload_op } : null];
    })),
    visuals: vis[id] || [],
  }));
  const actief = formaten.filter((f) => f.actief);
  return {
    formaten, posters, aantalVisuals: AANTAL_VISUALS,
    drukker: !!process.env.DRUKKER_EMAIL,
    tellers: {
      druk: posters.reduce((t, p) => t + actief.filter((f) => p.druk[f.id]).length, 0),
      drukNodig: posters.length * actief.length,
      afwijkend: posters.reduce((t, p) => t + Object.values(p.druk).filter((d) => d?.status === 'afwijkend').length, 0),
      visuals: posters.reduce((t, p) => t + p.visuals.length, 0),
      visualsNodig: posters.length * AANTAL_VISUALS,
    },
  };
}

function doel(body) {
  const poster_id = String(body.poster_id || '');
  if (!POSTERS[poster_id]) return { fout: 'Onbekende poster.' };
  if (body.soort === 'druk') return ALLE_FORMATEN[body.formaat] ? { soort: 'druk', poster_id, formaat: body.formaat } : { fout: 'Onbekend formaat.' };
  if (body.soort === 'visual') { const positie = Number(body.positie); return geldigPositie(positie) ? { soort: 'visual', poster_id, positie } : { fout: 'Positie moet 1 t/m 6 zijn.' }; }
  return { fout: 'Onbekende soort.' };
}

async function upload(body) {
  const d = doel(body);
  if (d.fout) return d;
  const bytes = Number(body.bytes);
  if (d.soort === 'druk') {
    if (!(bytes > 0) || bytes > MAX_PDF) return { fout: 'Ongeldige bestandsgrootte.' };
    const pad = drukPad(d.poster_id, d.formaat);
    return { ok: true, pad, url: await uploadUrl('drukbestanden', pad) };
  }
  if (!(bytes > 0) || bytes > MAX_VISUAL) return { fout: 'Visual is te groot (max. 10 MB na verkleinen).' };
  const t = Date.now().toString(36), pad = `${d.poster_id}/${d.positie}-${t}.jpg`, pad_klein = `${d.poster_id}/${d.positie}-${t}-klein.jpg`;
  return { ok: true, pad, pad_klein, url: await uploadUrl('visuals', pad), url_klein: await uploadUrl('visuals', pad_klein) };
}

const mm = (b) => Array.isArray(b) ? b.slice(0, 2).map(Number) : null;

async function bevestig(body) {
  const d = doel(body);
  if (d.fout) return d;
  if (d.soort === 'druk') {
    const pad = drukPad(d.poster_id, d.formaat), i = await info('drukbestanden', pad);
    if (!i) return { fout: 'Upload niet gevonden in de opslag; probeer het opnieuw.' };
    const m = maatStatus(d.formaat, { trim: mm(body.trim), media: mm(body.media) });
    const [rij] = await upsert('drukbestanden', {
      poster_id: d.poster_id, formaat: d.formaat, pad, bestandsnaam: String(body.bestandsnaam || '').slice(0, 200) || null,
      bytes: i.bytes, breedte_mm: m.breedte, hoogte_mm: m.hoogte, afloop_mm: m.afloop,
      paginas: Number.isInteger(body.paginas) ? body.paginas : null, maat_status: m.status, geupload_op: new Date().toISOString(),
    });
    const f = ALLE_FORMATEN[d.formaat];
    return { ok: true, status: m.status, rij, melding: m.status === 'ok' ? `Gekoppeld aan ${POSTERS[d.poster_id]} ${f.label}`
      : m.status === 'afwijkend' ? `Gekoppeld, maar de maat wijkt af: ${m.breedte} × ${m.hoogte} mm in plaats van ${f.mm.join(' × ')} mm (+ max. 5 mm afloop)`
      : 'Gekoppeld; de maat kon niet uit de pdf gelezen worden, controleer hem zelf' };
  }
  const pad = String(body.pad || ''), pad_klein = String(body.pad_klein || '');
  const patroon = new RegExp(`^${d.poster_id}/${d.positie}-[a-z0-9]+(-klein)?\\.jpg$`);
  if (!patroon.test(pad) || !patroon.test(pad_klein)) return { fout: 'Ongeldig pad.' };
  if (!(await info('visuals', pad)) || !(await info('visuals', pad_klein))) return { fout: 'Upload niet gevonden in de opslag; probeer het opnieuw.' };
  const oud = (await db(`poster_visuals?poster_id=eq.${d.poster_id}&positie=eq.${d.positie}&select=pad,pad_klein`))?.[0];
  await upsert('poster_visuals', {
    poster_id: d.poster_id, positie: d.positie, pad, pad_klein,
    breedte: Number(body.breedte) || null, hoogte: Number(body.hoogte) || null,
    alt: String(body.alt || `${POSTERS[d.poster_id]} — beeld ${d.positie}`).slice(0, 200), geupload_op: new Date().toISOString(),
  });
  if (oud && oud.pad !== pad) await verwijder('visuals', [oud.pad, oud.pad_klein]).catch(() => {});
  return { ok: true, melding: `Visual ${d.positie} van ${POSTERS[d.poster_id]} opgeslagen` };
}

async function weg(body) {
  const d = doel(body);
  if (d.fout) return d;
  if (d.soort === 'druk') {
    await verwijder('drukbestanden', [drukPad(d.poster_id, d.formaat)]).catch(() => {});
    await db(`drukbestanden?poster_id=eq.${d.poster_id}&formaat=eq.${d.formaat}`, { method: 'DELETE' });
  } else {
    const oud = (await db(`poster_visuals?poster_id=eq.${d.poster_id}&positie=eq.${d.positie}&select=pad,pad_klein`))?.[0];
    if (oud) await verwijder('visuals', [oud.pad, oud.pad_klein]).catch(() => {});
    await db(`poster_visuals?poster_id=eq.${d.poster_id}&positie=eq.${d.positie}`, { method: 'DELETE' });
  }
  return { ok: true };
}

async function stuurDruk(res, p, f) {
  if (!POSTERS[p] || !ALLE_FORMATEN[f]) return fout(res, 404, 'Onbekend drukbestand.');
  const rij = (await db(`drukbestanden?poster_id=eq.${p}&formaat=eq.${f}&select=pad`))?.[0];
  if (!rij) return fout(res, 404, 'Dit drukbestand is (nog) niet geüpload.');
  res.setHeader('Location', await downloadUrl('drukbestanden', rij.pad, 600, drukNaam(p, f)));
  return res.status(302).end();
}

export default async function handler(req, res) {
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
      const p = param(req, 'p'), f = param(req, 'f');
      if (param(req, 's') ? drukLinkGeldig(p, f, param(req, 'e'), param(req, 's')) : isAdmin(req)) return stuurDruk(res, p, f);
      return fout(res, 403, 'Deze link is verlopen of ongeldig. Vraag een nieuwe aan bij Skiffa.');
    }

    if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
    if (req.method === 'GET' && actie === 'overzicht') return res.status(200).json({ ok: true, ...(await overzicht()) });
    if (req.method !== 'POST') return fout(res, 400, 'Onbekende actie.');

    let uit;
    if (actie === 'herken') {
      const namen = Array.isArray(body.namen) ? body.namen.slice(0, 500) : [];
      uit = { ok: true, bestanden: namen.map((naam) => ({ naam: String(naam), ...herken(naam) })) };
    } else if (actie === 'upload') uit = await upload(body);
    else if (actie === 'bevestig') uit = await bevestig(body);
    else if (actie === 'verwijder') uit = await weg(body);
    else if (actie === 'drukker') {
      const id = String(body.id || '');
      const r = /^[0-9a-f-]{36}$/.test(id) ? await haalBestelling('id', id) : null;
      if (!r) uit = { fout: 'Bestelling niet gevonden.' };
      else if (!r.betaald_op) uit = { fout: 'Deze bestelling is nog niet betaald.' };
      else {
        const x = await drukopdracht(vanRij(r), 'admin', r.kanaal);
        uit = x.verstuurd ? { ok: true, melding: 'Drukopdracht verstuurd' } : { fout: x.reden };
      }
    } else return fout(res, 400, 'Onbekende actie.');
    return uit.fout ? fout(res, 400, uit.fout) : res.status(200).json(uit);
  } catch (e) {
    console.error('media', e);
    return fout(res, 500, 'Er ging iets mis. Probeer het opnieuw.');
  }
}
