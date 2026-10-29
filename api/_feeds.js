// Productfeed voor Meta Commerce Manager (Facebook/Instagram), volgens de Meta-specificatie (gecontroleerd
// oktober 2026: developers.facebook.com/docs/commerce-platform/catalog/fields en .../marketing-api/catalog/reference).
//
// - RSS 2.0-XML met namespace g: (http://base.google.com/ns/1.0); één item per bestelbare variant.
// - Verplicht: id, title, description, availability, condition, price, link, image_link + brand.
// - Varianten: item_group_id (zelfde per poster), size (formaat), material (papier).
// - Afbeeldingen: JPEG/PNG van minstens 500×500 px (WebP wordt niet geaccepteerd).
// - Afrekenen gebeurt op skiffa.store: Meta heeft afrekenen op Facebook/Instagram afgebouwd; link = productpagina.
// Meta haalt de feed volgens een schema op (hoogstens elk uur). De beheeromgeving toont wanneer Meta de feed
// voor het laatst ophaalde en waarschuwt als dat te lang geleden is; goedkeuring per item is alleen zichtbaar
// met een Meta-token (META_TOKEN + META_CATALOG_ID), anders in Commerce Manager zelf.
import { db } from './_db.js';
import { bedrijf } from './_bedrijf.js';
import { PRODUCTEN, VARIANTEN, ALLE_FORMATEN, PAPIER, BEELDEN, VASTE_BEELDEN } from './_catalogus.js';
import { visuals, visualUrl } from './_media.js';

export const META_GRAPH = 'https://graph.facebook.com/v26.0';
export const META_CATEGORIE = 'Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork';
const xml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const platteTekst = (v) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
const isJpgPng = (u) => /\.(jpe?g|png)(\?|$)/i.test(String(u || ''));

/** Alle feed-items met per item wat er nog ontbreekt. Alleen bestelbare varianten van actieve posters. */
export async function metaItems() {
  const site = bedrijf().site;
  const [vis, opn] = await Promise.all([visuals().catch(() => ({})), db('catalog_channels?kanaal=eq.meta&select=sku,opnemen,status,meldingen').catch(() => [])]);
  const items = [];
  for (const v of Object.values(VARIANTEN)) {
    const p = PRODUCTEN[v.product_id];
    if (!p || p.status !== 'actief') continue;
    const keuze = opn.find((x) => x.sku === v.sku);
    const f = ALLE_FORMATEN[v.formaat], papier = PAPIER[v.papier];
    const hoofd = BEELDEN[p.id] ? visualUrl(BEELDEN[p.id].groot) : VASTE_BEELDEN.has(p.id) ? `${site}/posters/${p.id}.jpg` : null;
    const extra = (vis[p.id] || []).filter((x) => x.soort !== 'video' && (!x.formaat || x.formaat === v.formaat) && (!x.papier || x.papier === v.papier)).map((x) => x.url).filter(isJpgPng).slice(0, 10);
    const titel = `${p.titel} – poster ${f?.label || v.formaat}${v.lijst ? `, lijst ${v.lijst}` : ''}${papier && Object.keys(PAPIER).length > 1 ? `, ${papier.naam}` : ''}`;
    let beschrijving = platteTekst(p.beschrijving);
    if (!beschrijving) beschrijving = '';
    else if (papier?.uitleg) beschrijving += `\n\n${platteTekst(papier.uitleg)}`;
    const item = {
      id: v.sku, item_group_id: p.code || p.id, title: titel.slice(0, 200), description: beschrijving.slice(0, 9999),
      availability: 'in stock', condition: 'new', price: `${Number(v.prijs).toFixed(2)} EUR`, link: `${site}/#${encodeURIComponent(p.id)}`,
      image_link: hoofd, additional_image_link: extra, brand: 'SKIFFA', size: f?.label || v.formaat, material: papier?.naam || null,
      google_product_category: META_CATEGORIE, product_type: ['Posters', p.collectie].filter(Boolean).join(' > '), custom_label_0: p.collectie || null, custom_label_1: p.code || null,
    };
    const ontbreekt = [];
    if (!v.bestelbaar) ontbreekt.push(`niet bestelbaar: ${(v.ontbreekt || []).join('; ') || 'zie de variant'}`);
    if (!item.description) ontbreekt.push('beschrijving ontbreekt (verplicht bij Meta)');
    else if (item.description.trim().toLowerCase() === item.title.trim().toLowerCase()) ontbreekt.push('beschrijving mag niet gelijk zijn aan de titel');
    if (item.description && item.description === item.description.toUpperCase() && /[A-Z]/.test(item.description)) ontbreekt.push('beschrijving in hoofdletters wordt afgekeurd');
    if (!item.image_link) ontbreekt.push('hoofdbeeld ontbreekt');
    else if (!isJpgPng(item.image_link)) ontbreekt.push('hoofdbeeld moet jpg of png zijn (geen webp)');
    if (!(Number(v.prijs) > 0)) ontbreekt.push('prijs ontbreekt');
    if (titel.length > 200) ontbreekt.push('titel langer dan 200 tekens (ingekort)');
    items.push({ ...item, product_id: p.id, opnemen: keuze ? keuze.opnemen : true, ontbreekt, review: keuze?.status || 'onbekend', meldingen: keuze?.meldingen || [] });
  }
  return items;
}

/** De feed zelf. Alleen complete, opgenomen items; onvolledige items staan in de beheeromgeving. */
export async function metaFeed() {
  const items = (await metaItems()).filter((i) => i.opnemen && !i.ontbreekt.length);
  const veld = (k, v) => (v == null || v === '' ? '' : `<g:${k}>${xml(v)}</g:${k}>`);
  const body = items.map((i) => `<item>${veld('id', i.id)}${veld('item_group_id', i.item_group_id)}${veld('title', i.title)}${veld('description', i.description)}${veld('availability', i.availability)}${veld('condition', i.condition)}${veld('price', i.price)}${veld('link', i.link)}${veld('image_link', i.image_link)}${i.additional_image_link.length ? veld('additional_image_link', i.additional_image_link.join(',')) : ''}${veld('brand', i.brand)}${veld('size', i.size)}${veld('material', i.material)}${veld('google_product_category', i.google_product_category)}${veld('product_type', i.product_type)}${veld('custom_label_0', i.custom_label_0)}${veld('custom_label_1', i.custom_label_1)}</item>`).join('\n');
  const site = bedrijf().site;
  return { aantal: items.length, xml: `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>SKIFFA posters</title><link>${xml(site)}</link><description>Posters van SKIFFA</description>\n${body}\n</channel></rss>\n` };
}

/** Elke keer dat de feed wordt opgehaald: bijhouden of Meta (of iemand anders) langskwam. */
export async function registreerOphalen(userAgent, aantal) {
  const isMeta = /facebook|meta-external|facebookcatalog/i.test(String(userAgent || ''));
  try {
    const huidig = (await db('kanaal_instellingen?kanaal=eq.meta&select=waarden'))?.[0]?.waarden || {};
    const nu = new Date().toISOString();
    const w = { ...huidig, laatst_opgehaald: nu, laatst_aantal: aantal, ...(isMeta ? { laatst_door_meta: nu } : {}) };
    await db('kanaal_instellingen?on_conflict=kanaal', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { kanaal: 'meta', waarden: w } });
  } catch { /* de feed moet hoe dan ook werken */ }
}

export const metaTokenIngesteld = () => !!(process.env.META_TOKEN && process.env.META_CATALOG_ID);

/** Goedkeuring per item ophalen uit de Meta-catalogus (Graph API, permissie catalog_management). */
export async function metaReview() {
  if (!metaTokenIngesteld()) return { fout: 'Zet META_TOKEN en META_CATALOG_ID in Vercel om de goedkeuring hier te zien; anders: Commerce Manager → Catalogus → Problemen.' };
  const STATUS = { approved: 'goedgekeurd', rejected: 'afgekeurd', pending: 'ingediend', outdated: 'verouderd' };
  let url = `${META_GRAPH}/${encodeURIComponent(process.env.META_CATALOG_ID)}/products?fields=retailer_id,review_status,review_rejection_reasons,errors&limit=200`;
  let n = 0;
  const items = new Set((await metaItems()).map((i) => i.id));
  for (let pagina = 0; url && pagina < 20; pagina++) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${process.env.META_TOKEN}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return { fout: `Meta: ${j.error?.message || `HTTP ${r.status}`}` };
    for (const x of j.data || []) {
      if (!items.has(x.retailer_id)) continue;
      const v = VARIANTEN[x.retailer_id];
      const meldingen = [...(x.review_rejection_reasons || []), ...(x.errors || []).map((e) => e.description || e.title || e.message || String(e))].filter(Boolean).slice(0, 10);
      await db('catalog_channels?on_conflict=kanaal,sku', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { kanaal: 'meta', sku: x.retailer_id, product_id: v.product_id, status: STATUS[x.review_status] || 'onbekend', meldingen, extern_id: x.id || null, laatste_check_op: new Date().toISOString(), bijgewerkt_op: new Date().toISOString() } });
      n++;
    }
    url = j.paging?.next || null;
  }
  return { ok: true, melding: `Goedkeuring bijgewerkt voor ${n} item${n === 1 ? '' : 's'}` };
}

/** Overzicht voor de beheeromgeving: feed-URL, ontbrekende velden, goedkeuring en bereikbaarheid. */
export async function metaOverzicht() {
  const items = await metaItems();
  const w = (await db('kanaal_instellingen?kanaal=eq.meta&select=waarden').catch(() => []))?.[0]?.waarden || {};
  const uren = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600000 : null);
  const metaUren = uren(w.laatst_door_meta);
  const waarschuwingen = [];
  if (metaUren == null) waarschuwingen.push('Meta heeft de feed nog nooit opgehaald. Voeg de feed-URL toe in Commerce Manager (Catalogus → Gegevensbronnen → Gegevensfeed, gepland).');
  else if (metaUren > 48) waarschuwingen.push(`Meta haalde de feed ${Math.round(metaUren)} uur geleden voor het laatst op. Controleer het schema in Commerce Manager.`);
  const opgenomen = items.filter((i) => i.opnemen);
  return {
    feed_url: `${bedrijf().site}/api/catalogus?actie=feed&kanaal=meta`, items,
    tellingen: { totaal: items.length, in_feed: opgenomen.filter((i) => !i.ontbreekt.length).length, onvolledig: opgenomen.filter((i) => i.ontbreekt.length).length, uitgesloten: items.length - opgenomen.length,
      goedgekeurd: items.filter((i) => i.review === 'goedgekeurd').length, afgekeurd: items.filter((i) => i.review === 'afgekeurd').length },
    laatst_opgehaald: w.laatst_opgehaald || null, laatst_door_meta: w.laatst_door_meta || null, token: metaTokenIngesteld(), waarschuwingen,
  };
}

/** Is de feed van buitenaf bereikbaar? (De server haalt zijn eigen openbare feed-URL op.) */
export async function metaBereikbaar() {
  const url = `${bedrijf().site}/api/catalogus?actie=feed&kanaal=meta`;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'skiffa-feedcontrole' }, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    const t = await r.text();
    if (!r.ok) return { ok: false, melding: `Feed niet bereikbaar: HTTP ${r.status}` };
    if (!t.includes('<rss')) return { ok: false, melding: 'De feed-URL geeft geen XML-feed terug.' };
    return { ok: true, melding: `Bereikbaar: ${(t.match(/<item>/g) || []).length} items` };
  } catch (e) { return { ok: false, melding: `Feed niet bereikbaar: ${e.message}` }; }
}

export async function zetOpnemen(kanaal, skus, opnemen) {
  for (const sku of skus) {
    const v = VARIANTEN[sku]; if (!v) continue;
    await db('catalog_channels?on_conflict=kanaal,sku', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { kanaal, sku, product_id: v.product_id, opnemen: !!opnemen, bijgewerkt_op: new Date().toISOString() } });
  }
  return { ok: true, melding: opnemen ? 'Opgenomen in de feed' : 'Uit de feed gehaald' };
}
