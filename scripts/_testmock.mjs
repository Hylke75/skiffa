// Nagebootste Supabase (PostgREST-subset + de RPC's uit supabase/migrations) voor de tests.
import crypto from 'node:crypto';
export const T = { bestellingen: [], bestelregels: [], bestelling_log: [], factuurteller: {}, poster_ean: [], kanaal_instellingen: [], kanaal_listings: [], kanaal_sync_log: [], etsy_koppeling: [], etsy_oauth_states: [], poster_visuals: [], producten: [], formaten: [], papiersoorten: [], varianten: [], drukbestand_versies: [], fulfilments: [], proefbestellingen: [], zendingen: [], kanaal_sjablonen: [], product_kanalen: [], serviceverzoeken: [], actie_afgehandeld: [], social_connections: [], social_posts: [], social_assets: [], social_post_targets: [], publishing_jobs: [], catalog_channels: [], campaign_links: [], tiktok_koppeling: [] };
// Nagebootste Supabase Storage: S[bucket][pad] = { size, type }
export const S = { drukbestanden: {}, visuals: {} };
let seq = 1;
const nu = () => new Date(Date.now() + seq++).toISOString();
const STANDAARD = {
  bestellingen: () => ({ id: crypto.randomUUID(), token: crypto.randomBytes(18).toString('hex'), status: 'open', terugbetaald: 0, btw_tarief: 21, notitie: '', factuurnummer: null, factuurdatum: null, mollie_id: null, betaald_op: null, track_trace: null, kanaal: 'webshop', extern_id: null, extern_meta: {}, extern_verzonden_op: null, vervoerder: 'postnl', aangemaakt_op: nu() }),
  kanaal_listings: () => ({ id: seq++, ingeschakeld: false, extern_id: null, status: 'concept', laatste_fout: null, laatste_prijs: null, laatste_voorraad: null, meta: {} }),
  etsy_oauth_states: () => ({ aangemaakt_op: nu() }),
  producten: () => ({ status: 'concept', kleuren: [], zoekwoorden: [], beschrijving: '', stijl: '', collectie: '', onderwerp: '', accentkleur: '#1F4E79', seo_titel: '', seo_beschrijving: '', beeld: null, beeld_klein: null, volgorde: 0, aangemaakt_op: nu() }),
  varianten: () => ({ lijst: null, lijst_kleur: null, kostprijs: null, actief: true, ean: null, prodigi_sku: null, prodigi_attributen: {}, sizing: 'fitPrintArea', prodigi_status: 'niet_gekoppeld', prodigi_product: null, prodigi_melding: null, prodigi_gecontroleerd_op: null, verzendmethode: 'Standard', kosten: null, kosten_gecontroleerd_op: null, handmatig_leverbaar: false, handmatig_reden: null, levertijd_productie_dagen: 3, levertijd_verzending_dagen: 3, drukbestand_id: null, qc_uitzondering: null, qc_uitzondering_op: null }),
  drukbestand_versies: () => ({ id: seq++, geupload_op: nu() }),
  zendingen: () => ({ id: seq++, fulfilment_id: null, regels: null, kanaal_gemeld_op: null, kanaal_fout: null, kanaal_pogingen: 0, klant_gemaild_op: null, verzonden_op: nu(), aangemaakt_op: nu() }),
  kanaal_sjablonen: () => ({ id: seq++, standaard: false, waarden: {}, bijgewerkt_op: nu() }),
  product_kanalen: () => ({ publiceren: false, sjabloon_id: null, afwijkingen: {}, status: 'niet_gepubliceerd', melding: null, extern_id: null, extern_url: null, gepubliceerd_hash: null, poging_hash: null, verwerken_sinds: null, aanmaken_gestart_op: null, laatste_sync_op: null, meta: {}, bijgewerkt_op: nu() }),
  proefbestellingen: () => ({ id: crypto.randomUUID(), status: 'offerte', extern_id: null, laatste_fout: null, aangemaakt_op: new Date().toISOString(), geplaatst_op: null }),
  serviceverzoeken: () => ({ id: seq++, status: 'open', regels: null, fotos: [], oplossing: null, oplossing_notitie: null, fulfilment_id: null, terugbetaald: null, opgelost_op: null, door: 'admin', aangemaakt_op: nu(), bijgewerkt_op: nu() }),
  social_connections: () => ({ id: seq++, aanbieder: 'buffer', status: 'actief', gebruiken: true, meta: {}, laatste_sync_op: null }),
  social_posts: () => ({ id: seq++, status: 'concept', tekst: '', campagne: null, product_id: null, door: 'admin', aangemaakt_op: nu(), bijgewerkt_op: nu() }),
  social_assets: () => ({ id: seq++, volgorde: 0, alt_tekst: null, thumbnail_offset_ms: null, pad: null, aangemaakt_op: nu() }),
  social_post_targets: () => ({ id: seq++, tekst: null, publicatie: 'automatisch', post_type: 'post', gepland_op: null, metadata: {}, campaign_link_id: null, status: 'concept', extern_id: null, extern_status: null, extern_link: null, melding: null, gepubliceerd_op: null, herinnerd_op: null, handmatig_bevestigd: false, bijgewerkt_op: nu() }),
  publishing_jobs: () => ({ id: seq++, status: 'wacht', pogingen: 0, volgende_poging_op: new Date(Date.now() - 1000).toISOString(), geclaimd_op: null, laatste_fout: null, resultaat: null, aangemaakt_op: new Date().toISOString(), bijgewerkt_op: nu() }),
  campaign_links: () => ({ id: seq++, aangemaakt_op: nu() }),
  catalog_channels: () => ({ opnemen: true, status: 'onbekend', meldingen: [], extern_id: null, laatste_check_op: null, bijgewerkt_op: nu() }),
  fulfilments: () => ({ id: seq++, herdruk_nr: 0, herdruk_reden: null, vrijgegeven_reden: null, branding: null, kosten: null, aanbieder: 'prodigi', status: 'wacht', pogingen: 0, geclaimd_op: null, extern_id: null, extern_status: null, laatste_fout: null, verstuurd_op: null, vanaf: new Date().toISOString(), aangemaakt_op: nu(), bijgewerkt_op: new Date().toISOString() }),
};
const UNIEK = { kanaal_listings: ['kanaal', 'poster_id', 'formaat'], poster_ean: ['poster_id', 'formaat'], kanaal_instellingen: ['kanaal'], etsy_koppeling: ['id'], poster_visuals: ['poster_id', 'positie'], producten: ['id'], formaten: ['id'], papiersoorten: ['id'], varianten: ['sku'], fulfilments: ['bestelling_id', 'herdruk_nr'], proefbestellingen: ['id'], zendingen: ['bestelling_id', 'extern_ref'], product_kanalen: ['product_id', 'kanaal'], actie_afgehandeld: ['sleutel'], social_connections: ['aanbieder', 'extern_id'], social_post_targets: ['post_id', 'connection_id'], publishing_jobs: ['sleutel'], catalog_channels: ['kanaal', 'sku'], tiktok_koppeling: ['id'] };
function voldoet(x, k, v) {
  if (k === 'or') {
    const conds = v.slice(1, -1).split(',').map((c) => { const [f, op, ...r] = c.split('.'); return [f, op, r.join('.')]; });
    return conds.some(([f, op, val]) => op === 'ilike' ? String(x[f] ?? '').toLowerCase().includes(val.replace(/\*/g, '').toLowerCase()) : voldoet(x, f, `${op}.${val}`));
  }
  const [op, ...r] = v.split('.'); const val = r.join('.');
  const xv = k.includes('->>') ? x[k.split('->>')[0]]?.[k.split('->>')[1]] : x[k];
  if (op === 'eq') return String(xv) === val;
  if (op === 'neq') return String(xv) !== val;
  if (op === 'in') return val.slice(1, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(xv));
  if (op === 'is') return val === 'null' ? xv == null : true;
  if (op === 'not') return val === 'is.null' ? xv != null : !voldoet(x, k, val);
  if (op === 'like') return new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(String(xv ?? ''));
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
  if (m && o.method === 'PUT') { const data = o.body == null ? Buffer.alloc(0) : Buffer.isBuffer(o.body) ? o.body : typeof o.body === 'string' ? Buffer.from(o.body) : Buffer.from(o.body); S[m[1]][m[2]] = { size: Number(o.headers?.['content-length'] || data.length || 1), type: o.headers?.['content-type'] || '', data }; return { Key: m[2] }; }
  const ma = p.match(/^object\/authenticated\/([^/]+)\/(.+)$/);
  if (ma) { const f = S[ma[1]][ma[2]]; if (!f) return { __status: 404 }; const r = String(o.headers?.range || '').match(/bytes=0-(\d+)/); return { __bytes: r ? f.data.subarray(0, Number(r[1]) + 1) : f.data }; }
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
  if (pad === 'rpc/skiffa_claim_fulfilment') {
    const f = T.fulfilments.find((x) => x.id === body.p_id), b = f && T.bestellingen.find((x) => x.id === f.bestelling_id);
    const okStatus = f && b && (f.herdruk_nr ? ['betaald', 'in_productie', 'verzonden', 'geleverd'] : ['betaald', 'in_productie']).includes(b.status);
    if (!f || !b || !['wacht', 'opnieuw'].includes(f.status) || f.vanaf > new Date().toISOString() || !b.betaald_op || !okStatus) return [];
    Object.assign(f, { status: 'bezig', geclaimd_op: new Date().toISOString(), pogingen: f.pogingen + 1 });
    return [{ ...f }];
  }
  if (pad === 'rpc/skiffa_vrijgeven_fulfilments') { let n = 0; for (const f of T.fulfilments) if (f.status === 'bezig' && f.geclaimd_op < new Date(Date.now() - 600000).toISOString()) { f.status = 'onzeker'; n++; } return n; }
  if (pad === 'rpc/skiffa_claim_onzeker') { const f = T.fulfilments.find((x) => x.id === body.p_id && x.status === 'onzeker'); if (!f) return []; Object.assign(f, { status: 'bezig', geclaimd_op: new Date().toISOString() }); return [{ ...f }]; }
  if (pad === 'rpc/skiffa_claim_job') {
    const j = T.publishing_jobs.find((x) => x.id === body.p_id), n = new Date().toISOString();
    if (!j || !((j.status === 'wacht' && j.volgende_poging_op <= n) || (j.status === 'bezig' && j.geclaimd_op < new Date(Date.now() - 600000).toISOString()))) return [];
    Object.assign(j, { status: 'bezig', geclaimd_op: n, pogingen: j.pogingen + 1 }); return [{ ...j }];
  }
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
export const antwoord = (d, status = 200) => {
  if (d && d.__bytes) { const b = d.__bytes; return { ok: true, status: 206, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), text: async () => b.toString('latin1'), headers: { get: () => null } }; }
  if (d && d.__status) return { ok: false, status: d.__status, text: async () => '', json: async () => null, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
  const t = d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)); return { ok: status < 400, status, text: async () => t, json: async () => (t ? JSON.parse(t) : null), headers: { get: () => null } };
};
export async function call(h, { method = 'GET', url = '/', body, cookie, headers = {} } = {}) {
  const u = new URL(url, 'http://x');
  const req = { method, url, headers: { host: 'skiffa.store', cookie, ...headers }, query: Object.fromEntries(u.searchParams), body };
  const out = { c: 200, h: {} };
  const res = { status(c) { out.c = c; return res; }, setHeader(k, v) { out.h[k.toLowerCase()] = v; }, json(x) { out.j = x; }, send(x) { out.s = x; }, end() {} };
  await h(req, res);
  return out;
}
export const ok = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) process.exitCode = 1; };

/** Vult de catalogus zoals de migratie 20261029030000_catalogus.sql dat doet. */
export function zaaiCatalogus(teksten) {
  const F = [['30x40', '30 × 40 cm', 300, 400, true, 10, 29], ['50x70', '50 × 70 cm', 500, 700, true, 20, 45], ['70x100', '70 × 100 cm', 700, 1000, true, 30, 69], ['18x24in', '18 × 24 inch', 457.2, 609.6, false, 40], ['24x36in', '24 × 36 inch', 609.6, 914.4, false, 50]];
  for (const [id, label, b, h, actief, volgorde] of F) T.formaten.push({ id, label, breedte_mm: b, hoogte_mm: h, actief, volgorde });
  T.papiersoorten.push({ id: 'mat', naam: 'Mat fine-art papier', uitleg: 'Dik, mat papier.', gewicht_gsm: 250, actief: true, volgorde: 10 });
  Object.entries(teksten).forEach(([id, t], i) => {
    T.producten.push({ ...STANDAARD.producten(), id, code: 'SKF-' + String(i + 1).padStart(3, '0'), interne_naam: t.naam, titel: t.naam, beschrijving: t.zin, stijl: t.sub, status: 'actief', volgorde: (i + 1) * 10 });
    for (const [f, , , , , , prijs] of F.slice(0, 3)) T.varianten.push({ ...STANDAARD.varianten(), sku: ('SKF-' + id + '-' + f).toUpperCase(), product_id: id, formaat_id: f, papier_id: 'mat', prijs });
  });
}
