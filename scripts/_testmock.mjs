// Nagebootste Supabase (PostgREST-subset + de RPC's uit supabase/migrations) voor de tests.
import crypto from 'node:crypto';
export const T = { bestellingen: [], bestelregels: [], bestelling_log: [], factuurteller: {}, poster_ean: [], kanaal_instellingen: [], kanaal_listings: [], kanaal_sync_log: [], etsy_koppeling: [], etsy_oauth_states: [], drukbestanden: [], poster_visuals: [] };
// Nagebootste Supabase Storage: S[bucket][pad] = { size, type }
export const S = { drukbestanden: {}, visuals: {} };
let seq = 1;
const nu = () => new Date(Date.now() + seq++).toISOString();
const STANDAARD = {
  bestellingen: () => ({ id: crypto.randomUUID(), token: crypto.randomBytes(18).toString('hex'), status: 'open', terugbetaald: 0, btw_tarief: 21, notitie: '', factuurnummer: null, factuurdatum: null, mollie_id: null, betaald_op: null, track_trace: null, kanaal: 'webshop', extern_id: null, extern_meta: {}, extern_verzonden_op: null, vervoerder: 'postnl', aangemaakt_op: nu() }),
  kanaal_listings: () => ({ id: seq++, ingeschakeld: false, extern_id: null, status: 'concept', laatste_fout: null, laatste_prijs: null, laatste_voorraad: null, meta: {} }),
  etsy_oauth_states: () => ({ aangemaakt_op: nu() }),
};
const UNIEK = { kanaal_listings: ['kanaal', 'poster_id', 'formaat'], poster_ean: ['poster_id', 'formaat'], kanaal_instellingen: ['kanaal'], etsy_koppeling: ['id'], drukbestanden: ['poster_id', 'formaat'], poster_visuals: ['poster_id', 'positie'] };
function voldoet(x, k, v) {
  if (k === 'or') {
    const conds = v.slice(1, -1).split(',').map((c) => { const [f, op, ...r] = c.split('.'); return [f, op, r.join('.')]; });
    return conds.some(([f, op, val]) => op === 'ilike' && String(x[f] ?? '').toLowerCase().includes(val.replace(/\*/g, '').toLowerCase()));
  }
  const [op, ...r] = v.split('.'); const val = r.join('.');
  const xv = k.includes('->>') ? x[k.split('->>')[0]]?.[k.split('->>')[1]] : x[k];
  if (op === 'eq') return String(xv) === val;
  if (op === 'neq') return String(xv) !== val;
  if (op === 'in') return val.slice(1, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(xv));
  if (op === 'is') return val === 'null' ? xv == null : true;
  if (op === 'not') return val === 'is.null' ? xv != null : true;
  if (op === 'lt') return String(xv) < val;
  if (op === 'lte') return String(xv) <= val;
  if (op === 'gt') return String(xv) > val;
  if (op === 'gte') return String(xv) >= val;
  return true;
}
function filter(rows, params) {
  for (const [k, v] of params) if (!['select', 'order', 'limit', 'on_conflict'].includes(k)) rows = rows.filter((x) => voldoet(x, k, v));
  const o = params.get('order');
  if (o) { const keys = o.split(',').map((s) => s.split('.')); rows = [...rows].sort((a, b) => { for (const [f, d] of keys) { if (a[f] !== b[f]) return (a[f] > b[f] ? 1 : -1) * (d === 'desc' ? -1 : 1); } return 0; }); }
  if (params.get('limit')) rows = rows.slice(0, +params.get('limit'));
  if ((params.get('select') || '').includes('bestelregels(*)')) rows = rows.map((x) => ({ ...x, bestelregels: T.bestelregels.filter((r) => r.bestelling_id === x.id) }));
  return rows;
}
function markeerBetaald({ p_id, p_methode, p_door }) {
  const b = T.bestellingen.find((x) => x.id === p_id);
  if (!b) return { ok: false, reden: 'onbekend' };
  if (!['open', 'mislukt'].includes(b.status)) return { ok: true, nieuw: false, status: b.status };
  if (!b.factuurnummer) { T.factuurteller[2026] = (T.factuurteller[2026] || 0) + 1; b.factuurnummer = '2026-' + String(T.factuurteller[2026]).padStart(4, '0'); b.factuurdatum = '2026-10-29'; }
  Object.assign(b, { status: 'betaald', betaald_op: b.betaald_op || nu(), mollie_methode: p_methode || b.mollie_methode });
  T.bestelling_log.push({ bestelling_id: b.id, soort: 'betaald', tekst: 'betaald', door: p_door, op: nu() });
  return { ok: true, nieuw: true, status: 'betaald' };
}
function importeer({ p }) {
  const bestaand = T.bestellingen.find((x) => x.kanaal === p.kanaal && x.extern_id === p.extern_id);
  if (bestaand) return { id: bestaand.id, nieuw: false };
  const sub = p.regels.reduce((t, r) => t + r.prijs * r.aantal, 0), ship = Number(p.verzending || 0);
  const b = { ...STANDAARD.bestellingen(), nummer: p.kanaal.slice(0, 3).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase(), kanaal: p.kanaal, extern_id: p.extern_id, extern_meta: p.meta || {},
    naam: p.naam || 'Klant', email: p.email || '', straat: p.straat || '', postcode: p.postcode || '', plaats: p.plaats || '', land: (p.land || 'NL').toUpperCase(), opmerking: p.opmerking || '',
    subtotaal: Math.round(sub * 100) / 100, verzending: ship, totaal: Math.round((sub + ship) * 100) / 100, betaalwijze: p.kanaal };
  T.bestellingen.push(b);
  for (const r of p.regels) T.bestelregels.push({ id: seq++, bestelling_id: b.id, ...r });
  T.bestelling_log.push({ bestelling_id: b.id, soort: 'aangemaakt', tekst: 'geïmporteerd', door: p.kanaal, op: nu() });
  markeerBetaald({ p_id: b.id, p_methode: p.kanaal, p_door: p.kanaal });
  return { id: b.id, nieuw: true, nummer: b.nummer };
}
function opslag(u, o) {
  const p = decodeURIComponent(u.pathname.replace('/storage/v1/', '')), body = o.body && typeof o.body === 'string' && o.body.startsWith('{') ? JSON.parse(o.body) : null;
  let m = p.match(/^object\/upload\/sign\/([^/]+)\/(.+)$/);
  if (m && o.method === 'PUT') { S[m[1]][m[2]] = { size: Number(o.headers?.['content-length'] || o.body?.length || 1), type: o.headers?.['content-type'] || '' }; return { Key: m[2] }; }
  if (m) return { url: `/object/upload/sign/${m[1]}/${m[2]}?token=tok-${m[2]}` };
  m = p.match(/^object\/sign\/([^/]+)\/(.+)$/); if (m) return { signedURL: `/object/sign/${m[1]}/${m[2]}?token=dl&exp=${body.expiresIn}` };
  m = p.match(/^object\/list\/([^/]+)$/);
  if (m) return Object.entries(S[m[1]]).filter(([k]) => k === body.prefix + body.search).map(([k, v]) => ({ name: k.slice(body.prefix.length), metadata: { size: v.size, mimetype: v.type } }));
  m = p.match(/^object\/([^/]+)$/); if (m && o.method === 'DELETE') { for (const k of body.prefixes) delete S[m[1]][k]; return []; }
  throw new Error('opslag? ' + p);
}
export function supabase(url, o) {
  const u = new URL(url);
  if (u.pathname.startsWith('/storage/v1/')) return opslag(u, o);
  const pad = u.pathname.replace('/rest/v1/', ''); const body = o.body ? JSON.parse(o.body) : undefined;
  if (pad === 'rpc/skiffa_markeer_betaald') return markeerBetaald(body);
  if (pad === 'rpc/skiffa_importeer_kanaalorder') return importeer(body);
  const rows = T[pad]; if (!rows) throw new Error('onbekende tabel ' + pad);
  if (o.method === 'POST') {
    const prefer = o.headers?.prefer || '';
    const uniek = UNIEK[pad], uit = [];
    for (const x of Array.isArray(body) ? body : [body]) {
      const bestaand = uniek && rows.find((r) => uniek.every((k) => String(r[k]) === String(x[k])));
      if (bestaand) { if (/merge-duplicates/.test(prefer)) { Object.assign(bestaand, x); uit.push(bestaand); } else if (/ignore-duplicates/.test(prefer)) continue; else throw new Error('db-409: duplicate key 23505'); }
      else { if (pad === 'poster_ean' && rows.some((r) => r.ean === x.ean)) throw new Error('db-409: duplicate key 23505'); const n = { ...(STANDAARD[pad]?.() || { id: seq++, op: nu() }), ...x }; rows.push(n); uit.push(n); }
    }
    return uit;
  }
  if (o.method === 'PATCH') { const hit = filter(rows, u.searchParams); hit.forEach((x) => Object.assign(x, body)); return hit; }
  if (o.method === 'DELETE') { const hit = new Set(filter(rows, u.searchParams)); T[pad] = rows.filter((x) => !hit.has(x)); return null; }
  return filter(rows, u.searchParams);
}
export const antwoord = (d, status = 200) => { const t = d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)); return { ok: status < 400, status, text: async () => t, json: async () => (t ? JSON.parse(t) : null), headers: { get: () => null } }; };
export async function call(h, { method = 'GET', url = '/', body, cookie, headers = {} } = {}) {
  const u = new URL(url, 'http://x');
  const req = { method, url, headers: { host: 'skiffa.store', cookie, ...headers }, query: Object.fromEntries(u.searchParams), body };
  const out = { c: 200, h: {} };
  const res = { status(c) { out.c = c; return res; }, setHeader(k, v) { out.h[k.toLowerCase()] = v; }, json(x) { out.j = x; }, send(x) { out.s = x; }, end() {} };
  await h(req, res);
  return out;
}
export const ok = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) process.exitCode = 1; };
