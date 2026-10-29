// Centrale productcatalogus (zie api/_catalogus.js). Eén route, ?actie=…
//
// Openbaar
//   GET  (geen actie)                     actieve producten + formaten + visuals voor de webshop (60 s gecachet)
// Beheer (ingelogd in /admin)
//   GET  beheer                           alle producten (ook inactief) en formaten
//   POST product {id?, nieuw?, naam, sub, zin, kleur, actief, volgorde}
//   POST formaat {id, label, prijs, actief, standaard, volgorde, prodigi_sku}
//   POST beeld-upload {id, bytes} → ondertekende upload-URL's · beeld-bevestig {id, pad, pad_klein}
import { dbAan, db } from './_db.js';
import { isAdmin } from './_auth.js';
import { laadCatalogus, catalogusBron, POSTERS, FORMATEN, TEKSTEN, BEELDEN, VASTE_BEELDEN } from './_catalogus.js';
import { uploadUrl, info, verwijder } from './_opslag.js';
import { visuals, visualUrl } from './_media.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });
const tekst = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
export const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function beeldVan(id) {
  if (BEELDEN[id]) return { beeld: visualUrl(BEELDEN[id].groot), klein: visualUrl(BEELDEN[id].klein) };
  return { beeld: `/posters/${id}.webp`, klein: `/posters/${id}-klein.webp` };
}

async function openbaar() {
  let vis = {};
  try { vis = await visuals(); } catch { /* zonder media-tabel */ }
  return {
    ok: true, bron: catalogusBron(),
    producten: Object.keys(POSTERS).map((id) => ({ id, ...TEKSTEN[id], naam: POSTERS[id], ...beeldVan(id) })),
    formaten: Object.entries(FORMATEN).map(([id, f]) => ({ id, label: f.label, prijs: f.prijs, ...(f.standaard ? { standaard: true } : {}) })),
    visuals: vis,
  };
}

async function beheer() {
  const [p, f] = await Promise.all([db('catalogus_producten?select=*&order=volgorde.asc,id.asc'), db('catalogus_formaten?select=*&order=volgorde.asc,id.asc')]);
  return {
    ok: true, bron: catalogusBron(),
    producten: p.map((x) => ({ ...x, vast_beeld: VASTE_BEELDEN.has(x.id), ...beeldVan(x.id), ...(x.beeld ? { beeld: visualUrl(x.beeld), klein: visualUrl(x.beeld_klein || x.beeld) } : {}) })),
    formaten: f.map((x) => ({ ...x, prijs: Number(x.prijs), breedte_mm: Number(x.breedte_mm), hoogte_mm: Number(x.hoogte_mm) })),
  };
}

async function product(b) {
  const naam = tekst(b.naam, 80);
  if (!naam) return { fout: 'Geef de poster een naam.' };
  const id = b.nieuw ? slug(b.id || naam) : String(b.id || '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return { fout: 'Ongeldige id (alleen kleine letters, cijfers en streepjes).' };
  const bestaand = (await db(`catalogus_producten?id=eq.${id}&select=id,beeld`))?.[0];
  if (b.nieuw && bestaand) return { fout: `Er bestaat al een poster met id "${id}".` };
  if (!b.nieuw && !bestaand) return { fout: 'Poster niet gevonden.' };
  const kleur = /^#[0-9A-Fa-f]{6}$/.test(String(b.kleur)) ? b.kleur : '#1F4E79';
  const actief = !!b.actief;
  if (actief && !bestaand?.beeld && !VASTE_BEELDEN.has(id)) return { fout: 'Upload eerst een productbeeld; zonder beeld kan de poster niet te koop.' };
  const rij = { id, naam, sub: tekst(b.sub, 120), zin: tekst(b.zin, 600), kleur, actief, volgorde: Number.isInteger(Number(b.volgorde)) ? Number(b.volgorde) : 0, bijgewerkt_op: new Date().toISOString() };
  if (b.nieuw) await db('catalogus_producten', { method: 'POST', body: rij });
  else await db(`catalogus_producten?id=eq.${id}`, { method: 'PATCH', body: rij });
  return { ok: true, id, melding: b.nieuw ? `Poster ${naam} aangemaakt${actief ? '' : ' (nog niet te koop)'}` : 'Opgeslagen' };
}

async function formaat(b) {
  const id = String(b.id || '');
  const oud = (await db(`catalogus_formaten?id=eq.${encodeURIComponent(id)}&select=*`))?.[0];
  if (!oud) return { fout: 'Formaat niet gevonden.' };
  const prijs = Math.round(Number(String(b.prijs).replace(',', '.')) * 100) / 100;
  if (!(prijs > 0 && prijs < 10000)) return { fout: 'Ongeldige prijs.' };
  const actief = !!b.actief, standaard = !!b.standaard && actief;
  if (!actief) {
    const rest = (await db('catalogus_formaten?actief=eq.true&select=id')).filter((x) => x.id !== id);
    if (!rest.length) return { fout: 'Er moet minstens één formaat te koop blijven.' };
  }
  if (standaard) await db('catalogus_formaten?standaard=eq.true', { method: 'PATCH', body: { standaard: false } });
  const sku = tekst(b.prodigi_sku, 60).toUpperCase();
  if (sku && !/^[A-Z0-9][A-Z0-9-_.]*$/.test(sku)) return { fout: 'Ongeldige Prodigi-SKU.' };
  await db(`catalogus_formaten?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: {
    label: tekst(b.label, 40) || oud.label, prijs, actief, standaard,
    volgorde: Number.isInteger(Number(b.volgorde)) ? Number(b.volgorde) : oud.volgorde, prodigi_sku: sku || null, bijgewerkt_op: new Date().toISOString(),
  } });
  return { ok: true, melding: `${oud.label} opgeslagen` };
}

async function beeldUpload(b) {
  const id = String(b.id || '');
  if (!(await db(`catalogus_producten?id=eq.${encodeURIComponent(id)}&select=id`))?.[0]) return { fout: 'Poster niet gevonden.' };
  if (!(Number(b.bytes) > 0) || Number(b.bytes) > 10 * 1024 ** 2) return { fout: 'Beeld is te groot (max. 10 MB na verkleinen).' };
  const t = Date.now().toString(36), pad = `producten/${id}-${t}.jpg`, pad_klein = `producten/${id}-${t}-klein.jpg`;
  return { ok: true, pad, pad_klein, url: await uploadUrl('visuals', pad), url_klein: await uploadUrl('visuals', pad_klein) };
}

async function beeldBevestig(b) {
  const id = String(b.id || ''), pad = String(b.pad || ''), pad_klein = String(b.pad_klein || '');
  const patroon = new RegExp(`^producten/${id}-[a-z0-9]+(-klein)?\\.jpg$`);
  if (!patroon.test(pad) || !patroon.test(pad_klein)) return { fout: 'Ongeldig pad.' };
  if (!(await info('visuals', pad)) || !(await info('visuals', pad_klein))) return { fout: 'Upload niet gevonden in de opslag; probeer het opnieuw.' };
  const oud = (await db(`catalogus_producten?id=eq.${encodeURIComponent(id)}&select=beeld,beeld_klein`))?.[0];
  if (!oud) return { fout: 'Poster niet gevonden.' };
  await db(`catalogus_producten?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { beeld: pad, beeld_klein: pad_klein, bijgewerkt_op: new Date().toISOString() } });
  if (oud.beeld) await verwijder('visuals', [oud.beeld, oud.beeld_klein].filter(Boolean)).catch(() => {});
  return { ok: true, melding: 'Productbeeld opgeslagen' };
}

export default async function handler(req, res) {
  await laadCatalogus();
  const actie = param(req, 'actie');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  try {
    if (!actie && req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      return res.status(200).json(await openbaar());
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
    if (!dbAan()) return fout(res, 503, 'De administratie is nog niet gekoppeld: zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.');
    if (actie === 'beheer' && req.method === 'GET') {
      try { return res.status(200).json(await beheer()); }
      catch { return fout(res, 503, 'De catalogus staat nog niet in de database: draai de migratie 20261029030000_catalogus.sql.'); }
    }
    if (req.method !== 'POST') return fout(res, 400, 'Onbekende actie.');
    const fn = { product, formaat, 'beeld-upload': beeldUpload, 'beeld-bevestig': beeldBevestig }[actie];
    if (!fn) return fout(res, 400, 'Onbekende actie.');
    const uit = await fn(body);
    if (uit.fout) return fout(res, 400, uit.fout);
    await laadCatalogus({ vers: true });
    return res.status(200).json(uit);
  } catch (e) {
    console.error('catalogus', e);
    return fout(res, 500, 'Er ging iets mis. Probeer het opnieuw.');
  }
}
