// Publiceren op verkoopkanalen vanuit de centrale catalogus.
//
// Per product per kanaal (product_kanalen): aangevinkt of niet, een sjabloon (herbruikbare kanaalinstellingen)
// en optionele afwijkingen (titel, beschrijving, taal, categorie, kenmerken, foto's, prijs). Standaard gelden
// de centrale productgegevens. De status volgt uit de inhoud:
//   niet_gepubliceerd  product staat alleen in SKIFFA
//   onvolledig         verplichte gegevens ontbreken (melding zegt welke)
//   gereed             klaar om te publiceren (nieuwe advertentie of wijziging)
//   verwerken          publicatie of wijziging is onderweg
//   actief             publicatie bevestigd (met externe link en tijdstip van de laatste synchronisatie)
//   fout               actie nodig, met uitleg
// De inhoud krijgt een vingerafdruk (hash): gelijk aan de laatst gepubliceerde = actief, anders gereed.
import crypto from 'node:crypto';
import { db } from './_db.js';
import { ALLE_POSTERS, PRODUCTEN, VARIANTEN, ALLE_FORMATEN, PAPIER, BEELDEN, VASTE_BEELDEN } from './_catalogus.js';
import { bedrijf } from './_bedrijf.js';
import { visuals, visualUrl } from './_media.js';

export const KANAAL_INFO = {
  webshop: { naam: 'SKIFFA-webshop', soort: 'eigen', uitleg: 'Je eigen winkel op skiffa.store.' },
  etsy: { naam: 'Etsy', soort: 'koppeling', uitleg: 'Eén advertentie per poster, met formaat en papier als keuze.' },
  bol: { naam: 'bol.com', soort: 'per-variant', uitleg: 'Per variant met EAN; beheer onder Koppelingen.' },
  amazon: { naam: 'Amazon', soort: 'per-variant', uitleg: 'Per variant met EAN; beheer onder Koppelingen.' },
  ebay: { naam: 'eBay', soort: 'niet-beschikbaar', uitleg: 'Nog geen koppeling: er wordt niets naar eBay gestuurd.' },
  tiktok: { naam: 'TikTok Shop', soort: 'elders', uitleg: 'Concept per poster en orders via Koppelingen → TikTok Shop (vraagt een eigen app in TikTok Partner Center).' },
  meta: { naam: 'Facebook / Instagram', soort: 'elders', uitleg: 'Productfeed voor Meta Commerce Manager; beheer onder Koppelingen.' },
};
export const PUBLICEERBAAR = ['webshop', 'etsy'];
export const STATUSSEN = ['niet_gepubliceerd', 'onvolledig', 'gereed', 'verwerken', 'actief', 'fout'];
export const VASTGELOPEN_MS = 15 * 60000;
const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 32);
const r2 = (v) => Math.round(v * 100) / 100;

/** Prijsregel: basis · vast bedrag erbij · percentage erbij · handmatig per SKU. Optioneel afronden op x,95. */
export function prijsVolgensRegel(basis, regel, sku) {
  const r = regel && typeof regel === 'object' ? regel : { type: 'basis' };
  let p;
  if (r.type === 'vast') p = basis + Number(r.waarde || 0);
  else if (r.type === 'procent') p = basis * (1 + Number(r.waarde || 0) / 100);
  else if (r.type === 'handmatig') p = r.prijzen?.[sku] != null && r.prijzen[sku] !== '' ? Number(String(r.prijzen[sku]).replace(',', '.')) : null;
  else p = basis;
  if (p == null || !Number.isFinite(p)) return null;
  p = r2(p);
  if (r.afronden_95 && r.type !== 'handmatig') p = Math.max(r2(Math.ceil(p + 0.05) - 0.05), r2(p));
  return p > 0 ? p : null;
}

export async function context() {
  const [pk, sj, etsy, vis] = await Promise.all([
    db('product_kanalen?select=*'), db('kanaal_sjablonen?select=*&order=kanaal.asc,id.asc'),
    db('etsy_koppeling?id=eq.1&select=shop_id,shop_naam').catch(() => []), visuals().catch(() => ({})),
  ]);
  let etsyBasis = {};
  try { etsyBasis = (await db('kanaal_instellingen?kanaal=eq.etsy&select=waarden'))?.[0]?.waarden || {}; } catch { /* geen instellingen */ }
  return { pk, sjablonen: sj, etsyGekoppeld: !!etsy?.[0]?.shop_id, visuals: vis, etsyBasis };
}

/** De instellingen die voor dit product op dit kanaal gelden: basis < sjabloon < afwijkingen van het product. */
export function instellingenVoor(ctx, kanaal, pk) {
  const sj = (pk?.sjabloon_id && ctx.sjablonen.find((s) => s.id === pk.sjabloon_id)) || ctx.sjablonen.find((s) => s.kanaal === kanaal && s.standaard) || null;
  const basis = kanaal === 'etsy' ? {
    taal: 'en', categorie: ctx.etsyBasis.taxonomy_id || null, verzendprofiel_id: ctx.etsyBasis.verzendprofiel_id || null,
    verwerkingsprofiel_id: ctx.etsyBasis.verwerkingsprofiel_id || null, retourbeleid_id: ctx.etsyBasis.retourbeleid_id || null,
    voorraad: ctx.etsyBasis.voorraad || 20, prijsregel: { type: 'procent', waarde: ctx.etsyBasis.opslag_pct ?? 15, afronden_95: true },
  } : { prijsregel: { type: 'basis' } };
  const afw = pk?.afwijkingen || {};
  const leeg = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  const uit = { ...basis, ...(sj?.waarden || {}) };
  for (const [k, v] of Object.entries(afw)) if (!leeg(v)) uit[k] = v;
  uit.kenmerken = { ...(basis.kenmerken || {}), ...(sj?.waarden?.kenmerken || {}), ...(afw.kenmerken || {}) };
  return { cfg: uit, sjabloon: sj };
}

function fotosVoor(ctx, productId, cfg) {
  const hoofd = BEELDEN[productId] ? visualUrl(BEELDEN[productId].groot) : VASTE_BEELDEN.has(productId) ? `${bedrijf().site}/posters/${productId}.jpg` : null;
  const vis = (ctx.visuals[productId] || []).filter((x) => x.soort !== 'video');
  if (Array.isArray(cfg.fotos) && cfg.fotos.length)
    return cfg.fotos.map((p) => (Number(p) === 0 ? hoofd : vis.find((x) => x.positie === Number(p))?.url)).filter(Boolean).slice(0, 10);
  return [hoofd, ...vis.map((x) => x.url)].filter(Boolean).slice(0, 10);
}

/** Wat er naar Etsy gaat, wat er ontbreekt, en de vingerafdruk van de inhoud. */
export function inhoudEtsy(ctx, productId, pk) {
  const p = PRODUCTEN[productId];
  const { cfg } = instellingenVoor(ctx, 'etsy', pk);
  const vs = Object.values(VARIANTEN).filter((v) => v.product_id === productId && v.bestelbaar && !v.lijst);
  const papieren = [...new Set(vs.map((v) => v.papier))];
  const ontbreekt = [];
  if (!ctx.etsyGekoppeld) ontbreekt.push('Etsy is nog niet gekoppeld (Koppelingen → koppel Etsy)');
  if (!p) return { ontbreekt: ['product niet gevonden'], payload: null, hash: null };
  if (p.status !== 'actief') ontbreekt.push(`poster staat op ${p.status}`);
  const titel = String(cfg.titel || `${p.titel}${cfg.titel_achtervoegsel ? ` – ${cfg.titel_achtervoegsel}` : ''}`).slice(0, 140);
  const beschrijving = String(cfg.beschrijving || [p.beschrijving, cfg.beschrijving_toevoeging].filter(Boolean).join('\n\n'));
  if (!titel.trim()) ontbreekt.push('titel ontbreekt');
  if (!beschrijving.trim()) ontbreekt.push('beschrijving ontbreekt');
  if (!cfg.categorie) ontbreekt.push('Etsy-categorie (taxonomy-id) ontbreekt in het sjabloon');
  if (!cfg.verzendprofiel_id) ontbreekt.push('Etsy-verzendprofiel ontbreekt in het sjabloon');
  if (!cfg.verwerkingsprofiel_id) ontbreekt.push('Etsy-verwerkingsprofiel ontbreekt in het sjabloon');
  const fotos = fotosVoor(ctx, productId, cfg);
  if (!fotos.length) ontbreekt.push('geen foto');
  if (!vs.length) ontbreekt.push('geen enkele variant is bestelbaar');
  const varianten = vs.map((v) => ({ sku: v.sku, formaat: ALLE_FORMATEN[v.formaat]?.label || v.formaat, papier: PAPIER[v.papier]?.naam || v.papier, prijs: prijsVolgensRegel(v.prijs, cfg.prijsregel, v.sku) }));
  const zonderPrijs = varianten.filter((v) => v.prijs == null);
  if (zonderPrijs.length) ontbreekt.push(`geen prijs voor ${zonderPrijs.map((v) => v.sku).join(', ')} (handmatige prijsregel)`);
  const tags = [...new Set([...(cfg.tags || []), ...(p.zoekwoorden || []), `skf-${p.code}`.toLowerCase()].map((t) => String(t).toLowerCase().replace(/[^a-z0-9 \-]/g, '').trim().slice(0, 20)).filter(Boolean))].slice(0, 13);
  const payload = {
    titel, beschrijving, taal: cfg.taal || 'en', categorie: cfg.categorie ? String(cfg.categorie) : null, tags,
    materialen: cfg.kenmerken?.materialen || ['paper'], who_made: cfg.kenmerken?.who_made || 'i_did', when_made: cfg.kenmerken?.when_made || 'made_to_order',
    verzendprofiel_id: cfg.verzendprofiel_id ? String(cfg.verzendprofiel_id) : null, verwerkingsprofiel_id: cfg.verwerkingsprofiel_id ? String(cfg.verwerkingsprofiel_id) : null,
    retourbeleid_id: cfg.retourbeleid_id ? String(cfg.retourbeleid_id) : null, voorraad: Number(cfg.voorraad) || 20,
    fotos, varianten, twee_eigenschappen: papieren.length > 1,
  };
  return { payload, ontbreekt, hash: hash(payload), code: p.code };
}

/** Webshop: actief zodra het product actief is en er bestelbare varianten zijn. */
export function inhoudWebshop(productId) {
  const p = PRODUCTEN[productId];
  const vs = Object.values(VARIANTEN).filter((v) => v.product_id === productId);
  const ontbreekt = [];
  if (!p) return { ontbreekt: ['product niet gevonden'] };
  if (p.status !== 'actief') ontbreekt.push(`poster staat op ${p.status}`);
  if (!vs.some((v) => v.bestelbaar)) ontbreekt.push(vs.length ? `geen bestelbare variant (bv. ${vs[0].ontbreekt.filter((o) => !/poster staat op/.test(o))[0] || 'zie de varianten'})` : 'nog geen varianten');
  return { ontbreekt };
}

/** De status die de beheeromgeving toont. */
export function statusVan(kanaal, pk, inhoud) {
  if (kanaal === 'webshop') {
    if (pk && !pk.publiceren) return { status: 'niet_gepubliceerd', melding: null };
    if (inhoud.ontbreekt.length) return { status: 'onvolledig', melding: inhoud.ontbreekt.join('; ') };
    return { status: 'actief', melding: null };
  }
  if (!pk?.publiceren) {
    if (pk?.extern_id && pk.status === 'actief') return { status: 'gereed', melding: 'wordt offline gehaald bij de volgende synchronisatie' };
    if (pk?.status === 'verwerken' && Date.now() - Date.parse(pk.verwerken_sinds || 0) < VASTGELOPEN_MS) return { status: 'verwerken', melding: pk.melding };
    return { status: 'niet_gepubliceerd', melding: pk?.status === 'fout' ? pk.melding : null };
  }
  if (inhoud.ontbreekt.length) return { status: 'onvolledig', melding: inhoud.ontbreekt.join('; ') };
  if (pk.status === 'verwerken' && Date.now() - Date.parse(pk.verwerken_sinds || 0) < VASTGELOPEN_MS) return { status: 'verwerken', melding: pk.melding };
  if (pk.status === 'fout' && pk.poging_hash === inhoud.hash) return { status: 'fout', melding: pk.melding };
  if (pk.extern_id && pk.gepubliceerd_hash === inhoud.hash && pk.status === 'actief') return { status: 'actief', melding: null };
  return { status: 'gereed', melding: pk.extern_id ? 'wijziging klaar om bij te werken' : 'nieuwe advertentie klaar om aan te maken' };
}

/** Overzicht voor de pagina Verkoopkanalen: elk product × elk publiceerbaar kanaal. */
export async function overzicht() {
  const ctx = await context();
  const producten = Object.keys(ALLE_POSTERS).filter((id) => PRODUCTEN[id]?.status !== 'gearchiveerd' || ctx.pk.some((x) => x.product_id === id && x.extern_id));
  const rijen = producten.map((id) => {
    const per = {};
    for (const k of PUBLICEERBAAR) {
      const pk = ctx.pk.find((x) => x.product_id === id && x.kanaal === k) || null;
      const inhoud = k === 'etsy' ? inhoudEtsy(ctx, id, pk) : inhoudWebshop(id);
      const st = statusVan(k, pk ? pk : (k === 'webshop' ? { publiceren: true } : null), inhoud);
      per[k] = {
        publiceren: k === 'webshop' ? (pk ? pk.publiceren : true) : !!pk?.publiceren, ...st,
        extern_url: k === 'webshop' ? (st.status === 'actief' ? `${bedrijf().site}/#${encodeURIComponent(id)}` : null) : pk?.extern_url || null,
        laatste_sync_op: k === 'webshop' ? null : pk?.laatste_sync_op || null, sjabloon_id: pk?.sjabloon_id || null, afwijkingen: pk?.afwijkingen || {},
        ...(k === 'etsy' && inhoud.payload ? { prijzen: inhoud.payload.varianten } : {}),
      };
    }
    return { id, titel: ALLE_POSTERS[id], code: PRODUCTEN[id]?.code, status: PRODUCTEN[id]?.status, kanalen: per };
  });
  return { producten: rijen, sjablonen: ctx.sjablonen, kanalen: KANAAL_INFO, etsyGekoppeld: ctx.etsyGekoppeld };
}

// ---- beheer: aanvinken, sjabloon kiezen, afwijkingen, sjablonen ----
const tekst = (v, m) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, m);
function schoneRegel(r) {
  if (!r || typeof r !== 'object' || !r.type) return null;
  if (!['basis', 'vast', 'procent', 'handmatig'].includes(r.type)) return null;
  const uit = { type: r.type };
  if (r.type === 'vast' || r.type === 'procent') { const w = Number(String(r.waarde ?? '').replace(',', '.')); if (!Number.isFinite(w) || w < -50 || w > 500) return null; uit.waarde = w; }
  if (r.type === 'handmatig') uit.prijzen = Object.fromEntries(Object.entries(r.prijzen || {}).map(([k, v]) => [tekst(k, 61).toUpperCase(), Number(String(v).replace(',', '.'))]).filter(([, v]) => v > 0 && v < 10000));
  if (r.afronden_95) uit.afronden_95 = true;
  return uit;
}
export function schoneAfwijkingen(a) {
  const x = a && typeof a === 'object' ? a : {};
  const uit = {};
  if (x.titel) uit.titel = tekst(x.titel, 140);
  if (x.beschrijving) uit.beschrijving = tekst(x.beschrijving, 5000);
  if (x.taal) uit.taal = /^[a-z]{2}$/.test(x.taal) ? x.taal : undefined;
  if (x.categorie) uit.categorie = tekst(x.categorie, 20);
  if (x.kenmerken && typeof x.kenmerken === 'object') uit.kenmerken = Object.fromEntries(Object.entries(x.kenmerken).slice(0, 20).map(([k, v]) => [tekst(k, 40), Array.isArray(v) ? v.map((y) => tekst(y, 40)).slice(0, 10) : tekst(v, 120)]));
  if (Array.isArray(x.fotos)) uit.fotos = x.fotos.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 30).slice(0, 10);
  if (Array.isArray(x.tags)) uit.tags = x.tags.map((t) => tekst(t, 20)).filter(Boolean).slice(0, 13);
  const r = schoneRegel(x.prijsregel); if (r) uit.prijsregel = r;
  for (const k of ['verzendprofiel_id', 'verwerkingsprofiel_id', 'retourbeleid_id']) if (x[k]) uit[k] = tekst(x[k], 20);
  Object.keys(uit).forEach((k) => uit[k] === undefined && delete uit[k]);
  return uit;
}

export async function zetPublicatie({ product_id, kanaal, publiceren, sjabloon_id, afwijkingen }) {
  if (!ALLE_POSTERS[product_id]) return { fout: 'Onbekende poster.' };
  if (!PUBLICEERBAAR.includes(kanaal)) return { fout: `${KANAAL_INFO[kanaal]?.naam || kanaal} kan hier (nog) niet worden gepubliceerd.` };
  const bestaand = (await db(`product_kanalen?product_id=eq.${encodeURIComponent(product_id)}&kanaal=eq.${kanaal}&select=*`))?.[0];
  const rij = { product_id, kanaal, bijgewerkt_op: new Date().toISOString() };
  if (publiceren !== undefined) rij.publiceren = !!publiceren;
  if (sjabloon_id !== undefined) {
    if (sjabloon_id && !(await db(`kanaal_sjablonen?id=eq.${Number(sjabloon_id)}&kanaal=eq.${kanaal}&select=id`))?.[0]) return { fout: 'Sjabloon hoort niet bij dit kanaal.' };
    rij.sjabloon_id = sjabloon_id ? Number(sjabloon_id) : null;
  }
  if (afwijkingen !== undefined) rij.afwijkingen = schoneAfwijkingen(afwijkingen);
  if (bestaand?.status === 'fout') rij.status = bestaand.extern_id ? 'gereed' : 'niet_gepubliceerd';   // wijziging = nieuwe poging
  await db('product_kanalen?on_conflict=product_id,kanaal', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { ...(bestaand ? {} : { publiceren: false, afwijkingen: {} }), ...rij } });
  return { ok: true, melding: 'Opgeslagen' };
}

export async function zetSjabloon(b) {
  if (!PUBLICEERBAAR.includes(b.kanaal) && !KANAAL_INFO[b.kanaal]) return { fout: 'Onbekend kanaal.' };
  const naam = tekst(b.naam, 80);
  if (!naam) return { fout: 'Geef het sjabloon een naam.' };
  const w = b.waarden && typeof b.waarden === 'object' ? b.waarden : {};
  const waarden = { ...schoneAfwijkingen(w), ...(w.titel_achtervoegsel ? { titel_achtervoegsel: tekst(w.titel_achtervoegsel, 60) } : {}),
    ...(w.beschrijving_toevoeging ? { beschrijving_toevoeging: tekst(w.beschrijving_toevoeging, 2000) } : {}),
    ...(w.voorraad ? { voorraad: Math.max(1, Math.min(999, Number(w.voorraad) || 20)) } : {}) };
  delete waarden.titel; delete waarden.beschrijving; delete waarden.fotos;
  if (b.standaard) await db(`kanaal_sjablonen?kanaal=eq.${b.kanaal}&standaard=eq.true`, { method: 'PATCH', body: { standaard: false } });
  const rij = { kanaal: b.kanaal, naam, standaard: !!b.standaard, waarden, bijgewerkt_op: new Date().toISOString() };
  if (b.id) {
    const r = await db(`kanaal_sjablonen?id=eq.${Number(b.id)}`, { method: 'PATCH', prefer: 'return=representation', body: rij });
    if (!r?.length) return { fout: 'Sjabloon niet gevonden.' };
    return { ok: true, id: r[0].id, melding: `Sjabloon ${naam} opgeslagen` };
  }
  const [n] = await db('kanaal_sjablonen', { method: 'POST', prefer: 'return=representation', body: rij });
  return { ok: true, id: n.id, melding: `Sjabloon ${naam} aangemaakt` };
}
