// Supabase Storage via de REST-API (zelfde sleutel als api/_db.js, alleen server-side).
// Grote bestanden gaan nooit door een Vercel-functie: de server geeft een ondertekende upload-URL
// en de browser zet het bestand er rechtstreeks neer.

const URL_ = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function st(pad, { method = 'POST', body, headers = {} } = {}) {
  const r = await fetch(`${URL_()}/storage/v1/${pad}`, {
    method,
    // content-type alleen mét body: Supabase Storage weigert een lege body met content-type JSON (400).
    headers: { apikey: KEY(), authorization: `Bearer ${KEY()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await r.text();
  if (!r.ok) throw new Error(`opslag-${r.status}: ${tekst.slice(0, 200)}`);
  return tekst ? JSON.parse(tekst) : null;
}

/** Ondertekende upload-URL (2 uur geldig); overschrijft een bestaand bestand. */
export async function uploadUrl(bucket, pad) {
  const j = await st(`object/upload/sign/${bucket}/${pad}`, { headers: { 'x-upsert': 'true' } });
  return `${URL_()}/storage/v1${j.url}`;
}

/** Ondertekende download-URL voor een privé bestand. */
export async function downloadUrl(bucket, pad, seconden = 300, bestandsnaam) {
  const j = await st(`object/sign/${bucket}/${pad}`, { body: { expiresIn: seconden } });
  const u = `${URL_()}/storage/v1${j.signedURL || j.signedUrl}`;
  return bestandsnaam ? `${u}&download=${encodeURIComponent(bestandsnaam)}` : u;
}

/** Bestaat het bestand, en hoe groot is het? */
export async function info(bucket, pad) {
  const i = pad.lastIndexOf('/');
  const rijen = await st(`object/list/${bucket}`, { body: { prefix: pad.slice(0, i + 1), search: pad.slice(i + 1), limit: 20 } });
  const r = (rijen || []).find((x) => x.name === pad.slice(i + 1));
  return r ? { bytes: Number(r.metadata?.size || 0), type: r.metadata?.mimetype || '' } : null;
}

export async function verwijder(bucket, paden) {
  if (!paden.length) return;
  await st(`object/${bucket}`, { method: 'DELETE', body: { prefixes: paden } });
}

/** De eerste bytes van een (privé) bestand, om het type en de maten zelf te controleren. */
export async function kop(bucket, pad, bytes = 512 * 1024) {
  const r = await fetch(`${URL_()}/storage/v1/object/authenticated/${bucket}/${pad}`, {
    headers: { apikey: KEY(), authorization: `Bearer ${KEY()}`, range: `bytes=0-${bytes - 1}` },
  });
  if (!r.ok && r.status !== 206) throw new Error(`opslag-${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export const publiekeUrl = (bucket, pad) => `${URL_()}/storage/v1/object/public/${bucket}/${pad}`;
