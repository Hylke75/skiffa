// Centrale productcatalogus met varianten (zie api/_catalogus.js en de migratie 20261029030000).
// Eén route, ?actie=…
//
// Openbaar
//   GET  (geen actie)                producten met hun bestelbare varianten, formaten, papiersoorten en beelden
// Beheer (ingelogd in /admin)
//   GET  beheer                      alle producten met de stand van hun varianten, formaten, papiersoorten
//   GET  product&id=                 één product: alle gegevens, varianten (met drukbestand, controles, versies,
//                                    Prodigi en kosten) en beelden
//   POST product {…}                 aanmaken (nieuw: true) of bijwerken; status actief/gereed alleen als er een
//                                    bestelbare variant is
//   POST variant {…}                 aanmaken (nieuw: true) of bijwerken
//   POST varianten-genereren {product_id, formaten, papieren, prijzen}
//   POST formaat {…} · papier {…}    aanmaken of bijwerken
//   POST uitzondering {sku, reden} · uitzondering-intrekken {sku}      afgekeurd drukbestand toch toestaan
//   POST beeld-upload {id, bytes} · beeld-bevestig {id, pad, pad_klein}  hoofdbeeld van een product
import { metAudit } from './_audit.js';
import * as feeds from './_feeds.js';
import { dbAan, db } from './_db.js';
import { isAdmin } from './_auth.js';
import { laadCatalogus, catalogusBron, ontbreektVoor, POSTERS, ALLE_FORMATEN, FORMATEN, PAPIER, VARIANTEN, TEKSTEN, BEELDEN, VASTE_BEELDEN, PRODUCTEN, STANDAARD_PAPIER, OPHANGING, ophangLabel, lijstSku } from './_catalogus.js';
import { uploadUrl, info, verwijder } from './_opslag.js';
import { visuals, visualUrl } from './_media.js';
import { instellingen as prodigiInstellingen, VERZENDMETHODEN } from './_prodigi.js';

const param = (req, k) => String(req.query?.[k] ?? new URL(req.url || '/', 'http://x').searchParams.get(k) ?? '');
const fout = (res, code, melding) => res.status(code).json({ ok: false, melding });
const tekst = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const lijst = (v, max = 20) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => tekst(x, 40).toLowerCase()).filter(Boolean).slice(0, max);
const geheel = (v, d) => (Number.isInteger(Number(v)) ? Number(v) : d);
const prijsVan = (v) => Math.round(Number(String(v ?? '').replace(',', '.')) * 100) / 100;
export const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const enc = encodeURIComponent;

function beeldVan(id) {
  if (BEELDEN[id]) return { beeld: visualUrl(BEELDEN[id].groot), klein: visualUrl(BEELDEN[id].klein) };
  return VASTE_BEELDEN.has(id) ? { beeld: `/posters/${id}.webp`, klein: `/posters/${id}-klein.webp` } : { beeld: null, klein: null };
}

async function openbaar() {
  let vis = {};
  try { vis = await visuals(); } catch { /* zonder beeldentabel */ }
  const bestelbaar = Object.values(VARIANTEN).filter((v) => v.bestelbaar && POSTERS[v.product_id]);
  const papieren = new Set(bestelbaar.map((v) => v.papier));
  return {
    ok: true, bron: catalogusBron(),
    producten: Object.keys(POSTERS).map((id) => {
      const p = PRODUCTEN[id] || {};
      return {
        id, titel: POSTERS[id], stijl: TEKSTEN[id]?.sub || '', beschrijving: TEKSTEN[id]?.zin || '', accentkleur: TEKSTEN[id]?.kleur || '#1F4E79',
        seo_titel: p.seo_titel || '', seo_beschrijving: p.seo_beschrijving || '', ...beeldVan(id),
        varianten: bestelbaar.filter((v) => v.product_id === id).map((v) => ({ sku: v.sku, formaat: v.formaat, papier: v.papier, lijst: v.lijst || null, lijst_kleur: v.lijst_kleur || null, ophanging: ophangLabel(v.lijst, v.lijst_kleur), prijs: v.prijs, levertijd: v.levertijd })),
      };
    }),
    formaten: Object.entries(FORMATEN).map(([id, f]) => ({ id, label: f.label, mm: f.mm })),
    papiersoorten: Object.entries(PAPIER).filter(([id]) => papieren.has(id)).map(([id, p]) => ({ id, naam: p.naam, uitleg: p.uitleg, gsm: p.gsm })),
    standaard_papier: STANDAARD_PAPIER, visuals: vis,
    // Actief in de database maar nog niet bestelbaar (bv. drukbestand of Prodigi nog niet klaar): de winkel toont ze als "binnenkort".
    binnenkort: catalogusBron() === 'database' ? Object.values(PRODUCTEN).filter((p) => p.status === 'actief' && !POSTERS[p.id]).map((p) => ({
      id: p.id, titel: p.titel, stijl: p.stijl || '', beschrijving: p.beschrijving || '', accentkleur: p.accentkleur || '#1F4E79', ...beeldVan(p.id),
    })) : [],
  };
}

async function context() {
  const [p, f, pa, s] = await Promise.all([db('producten?select=*&order=volgorde.asc,id.asc'), db('formaten?select=*&order=volgorde.asc,id.asc'), db('papiersoorten?select=*&order=volgorde.asc,id.asc'), prodigiInstellingen().catch(() => ({ aan: false }))]);
  return { p, f, pa, route: s.aan ? 'prodigi' : 'eigen', fOp: Object.fromEntries(f.map((x) => [x.id, x])), paOp: Object.fromEntries(pa.map((x) => [x.id, x])) };
}

async function beheer() {
  const c = await context();
  const rijen = await db('varianten?select=sku,product_id,formaat_id,papier_id,lijst,lijst_kleur,prijs,actief,prodigi_status,handmatig_leverbaar,drukbestand_id,qc_uitzondering,prodigi_sku,prodigi_melding');
  // Ingelijst: drukbestand en uitzondering van dezelfde losse poster in hetzelfde formaat.
  const v = rijen.map((x) => {
    const b = x.lijst ? rijen.find((y) => !y.lijst && y.product_id === x.product_id && y.formaat_id === x.formaat_id) : null;
    return b ? { ...x, drukbestand_id: b.drukbestand_id, qc_uitzondering: b.qc_uitzondering } : x;
  });
  const druk = await drukOp(v);
  return {
    ok: true, bron: catalogusBron(), productieRoute: c.route, formaten: c.f, papiersoorten: c.pa,
    producten: c.p.map((x) => {
      const eigen = v.filter((y) => y.product_id === x.id);
      const klaar = eigen.filter((y) => !ontbreektVoor(y, { product: { ...x, status: 'actief' }, formaat: c.fOp[y.formaat_id], papier: c.paOp[y.papier_id], druk: druk.get(y.drukbestand_id), productieRoute: c.route }).length);
      return { ...x, ...beeldVan(x.id), ...(x.beeld ? { beeld: visualUrl(x.beeld), klein: visualUrl(x.beeld_klein || x.beeld) } : {}), varianten: eigen.length, klaar: klaar.length };
    }),
  };
}

async function drukOp(varianten) {
  const ids = varianten.map((x) => x.drukbestand_id).filter(Boolean);
  const r = ids.length ? await db(`drukbestand_versies?id=in.(${ids.join(',')})&select=*`) : [];
  return new Map(r.map((d) => [d.id, d]));
}

async function product(id) {
  const c = await context();
  const p = c.p.find((x) => x.id === id);
  if (!p) return null;
  const v = await db(`varianten?product_id=eq.${enc(id)}&select=*&order=formaat_id.asc,papier_id.asc`);
  const druk = await drukOp(v);
  const versies = v.length ? await db(`drukbestand_versies?variant_sku=in.(${v.map((x) => `"${x.sku}"`).join(',')})&select=id,variant_sku,versie,status,bestandsnaam,bytes,mime,geupload_op&order=versie.desc`) : [];
  let beelden = [];
  try { beelden = (await visuals(id))[id] || []; } catch { /* geen beelden */ }
  return {
    product: { ...p, ...beeldVan(id), ...(p.beeld ? { beeld: visualUrl(p.beeld), klein: visualUrl(p.beeld_klein || p.beeld) } : {}) },
    productieRoute: c.route, formaten: c.f, papiersoorten: c.pa, verzendmethoden: VERZENDMETHODEN, beelden,
    varianten: v.map((rij) => {
      // Ingelijst: drukbestand (en uitzondering) van dezelfde losse poster in hetzelfde formaat.
      const b = rij.lijst ? v.find((y) => !y.lijst && y.formaat_id === rij.formaat_id) : null;
      const x = b ? { ...rij, drukbestand_id: b.drukbestand_id, qc_uitzondering: b.qc_uitzondering, qc_uitzondering_op: b.qc_uitzondering_op } : rij;
      const ontbreekt = ontbreektVoor(x, { product: { ...p, status: 'actief' }, formaat: c.fOp[x.formaat_id], papier: c.paOp[x.papier_id], druk: druk.get(x.drukbestand_id), productieRoute: c.route });
      if (rij.lijst && !b) ontbreekt.push('geen losse poster in dit formaat (daar hoort het drukbestand bij)');
      return { ...x, prijs: Number(x.prijs), kostprijs: x.kostprijs == null ? null : Number(x.kostprijs), klaar: !ontbreekt.length, ontbreekt, basis_sku: b?.sku || null,
        ophanging: ophangLabel(rij.lijst, rij.lijst_kleur), drukbestand: druk.get(x.drukbestand_id) || null, versies: versies.filter((d) => d.variant_sku === (b?.sku || x.sku)) };
    }),
  };
}

async function volgendeCode() {
  const rijen = await db("producten?select=code&code=like.SKF-*&order=code.desc&limit=200");
  const n = Math.max(0, ...rijen.map((r) => Number(String(r.code).match(/^SKF-(\d+)$/)?.[1] || 0))) + 1;
  return `SKF-${String(n).padStart(3, '0')}`;
}

async function bewaarProduct(b) {
  const titel = tekst(b.titel, 120);
  if (!titel) return { fout: 'Geef de poster een verkooptitel.' };
  const id = b.nieuw ? slug(b.id || b.interne_naam || titel) : String(b.id || '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return { fout: 'Ongeldige URL-naam (alleen kleine letters, cijfers en streepjes).' };
  const bestaand = (await db(`producten?id=eq.${enc(id)}&select=*`))?.[0];
  if (b.nieuw && bestaand) return { fout: `Er bestaat al een poster met URL-naam "${id}".` };
  if (!b.nieuw && !bestaand) return { fout: 'Poster niet gevonden.' };
  let code = tekst(b.code, 32).toUpperCase() || bestaand?.code || await volgendeCode();
  if (!/^[A-Z0-9][A-Z0-9-]{1,30}$/.test(code)) return { fout: 'Ongeldige productcode (hoofdletters, cijfers en streepjes).' };
  const dubbel = (await db(`producten?code=eq.${enc(code)}&id=neq.${enc(id)}&select=id`))?.[0];
  if (dubbel) return { fout: `Productcode ${code} is al in gebruik.` };
  const status = ['concept', 'gereed', 'actief', 'gearchiveerd'].includes(b.status) ? b.status : (bestaand?.status || 'concept');
  if (['gereed', 'actief'].includes(status) && status !== bestaand?.status) {
    const c = await context();
    const v = await db(`varianten?product_id=eq.${enc(id)}&select=*`);
    const druk = await drukOp(v);
    const heeftBeeld = !!bestaand?.beeld || VASTE_BEELDEN.has(id);
    const klaar = v.filter((x) => !ontbreektVoor(x, { product: { status: 'actief' }, formaat: c.fOp[x.formaat_id], papier: c.paOp[x.papier_id], druk: druk.get(x.drukbestand_id), productieRoute: c.route }).length);
    if (!heeftBeeld) return { fout: 'Upload eerst een productbeeld.' };
    if (!klaar.length) {
      const reden = v.length ? ontbreektVoor(v[0], { product: { status: 'actief' }, formaat: c.fOp[v[0].formaat_id], papier: c.paOp[v[0].papier_id], druk: druk.get(v[0].drukbestand_id), productieRoute: c.route }).join('; ') : 'er zijn nog geen varianten';
      return { fout: `Nog geen enkele variant is klaar voor verkoop (bv. ${reden}).` };
    }
  }
  const kleur = /^#[0-9A-Fa-f]{6}$/.test(String(b.accentkleur)) ? b.accentkleur : (bestaand?.accentkleur || '#1F4E79');
  const rij = {
    id, code, interne_naam: tekst(b.interne_naam, 120) || titel, titel, beschrijving: tekst(b.beschrijving, 2000), stijl: tekst(b.stijl, 120),
    collectie: tekst(b.collectie, 80), onderwerp: tekst(b.onderwerp, 80), kleuren: lijst(b.kleuren, 10), zoekwoorden: lijst(b.zoekwoorden, 30),
    accentkleur: kleur, seo_titel: tekst(b.seo_titel, 70), seo_beschrijving: tekst(b.seo_beschrijving, 170), status,
    volgorde: geheel(b.volgorde, bestaand?.volgorde || 0), bijgewerkt_op: new Date().toISOString(),
  };
  if (b.nieuw) {
    await db('producten', { method: 'POST', body: rij });
    await db('product_kanalen?on_conflict=product_id,kanaal', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { product_id: id, kanaal: 'webshop', publiceren: true } }).catch(() => {});
  } else await db(`producten?id=eq.${enc(id)}`, { method: 'PATCH', body: rij });
  return { ok: true, id, code, melding: b.nieuw ? `Poster ${titel} aangemaakt (${code})` : 'Opgeslagen' };
}

const variantSku = (product, formaat, papier) => `SKF-${product}-${formaat}${papier === STANDAARD_PAPIER ? '' : `-${papier}`}`.toUpperCase().slice(0, 61);

async function bewaarVariant(b) {
  if (b.nieuw) {
    const p = (await db(`producten?id=eq.${enc(String(b.product_id || ''))}&select=id`))?.[0];
    if (!p) return { fout: 'Poster niet gevonden.' };
    if (!(await db(`formaten?id=eq.${enc(String(b.formaat_id || ''))}&select=id`))?.[0]) return { fout: 'Onbekend formaat.' };
    if (!(await db(`papiersoorten?id=eq.${enc(String(b.papier_id || ''))}&select=id`))?.[0]) return { fout: 'Onbekende papiersoort.' };
    const prijs = prijsVan(b.prijs);
    if (!(prijs > 0 && prijs < 10000)) return { fout: 'Geef een geldige verkoopprijs.' };
    const sku = tekst(b.sku, 61).toUpperCase() || variantSku(p.id, b.formaat_id, b.papier_id);
    if (!/^[A-Z0-9][A-Z0-9-]{2,60}$/.test(sku)) return { fout: 'Ongeldige SKU.' };
    if ((await db(`varianten?sku=eq.${enc(sku)}&select=sku`))?.[0]) return { fout: `SKU ${sku} bestaat al.` };
    if ((await db(`varianten?product_id=eq.${enc(p.id)}&formaat_id=eq.${enc(b.formaat_id)}&papier_id=eq.${enc(b.papier_id)}&lijst=is.null&select=sku`))?.[0]) return { fout: 'Deze combinatie van formaat en papier bestaat al.' };
    await db('varianten', { method: 'POST', body: { sku, product_id: p.id, formaat_id: b.formaat_id, papier_id: b.papier_id, prijs } });
    return { ok: true, sku, melding: `Variant ${sku} aangemaakt` };
  }
  const v = (await db(`varianten?sku=eq.${enc(String(b.sku || ''))}&select=*`))?.[0];
  if (!v) return { fout: 'Variant niet gevonden.' };
  const patch = { bijgewerkt_op: new Date().toISOString() };
  if (b.prijs !== undefined) { const p = prijsVan(b.prijs); if (!(p > 0 && p < 10000)) return { fout: 'Ongeldige verkoopprijs.' }; patch.prijs = p; }
  if (b.kostprijs !== undefined) { const k = b.kostprijs === '' || b.kostprijs === null ? null : prijsVan(b.kostprijs); if (k !== null && !(k >= 0 && k < 10000)) return { fout: 'Ongeldige kostprijs.' }; patch.kostprijs = k; }
  if (b.actief !== undefined) patch.actief = !!b.actief;
  if (b.ean !== undefined) { const e = tekst(b.ean, 14); if (e && !/^\d{8}$|^\d{12,14}$/.test(e)) return { fout: 'Ongeldige EAN.' }; patch.ean = e || null; }
  if (b.sizing !== undefined) { if (!['fitPrintArea', 'fillPrintArea'].includes(b.sizing)) return { fout: 'Ongeldige plaatsing.' }; patch.sizing = b.sizing; }
  if (b.verzendmethode !== undefined) { if (!VERZENDMETHODEN.includes(b.verzendmethode)) return { fout: 'Ongeldige verzendmethode.' }; patch.verzendmethode = b.verzendmethode; }
  if (b.levertijd_productie_dagen !== undefined) patch.levertijd_productie_dagen = Math.max(0, Math.min(60, geheel(b.levertijd_productie_dagen, 3)));
  if (b.levertijd_verzending_dagen !== undefined) patch.levertijd_verzending_dagen = Math.max(0, Math.min(60, geheel(b.levertijd_verzending_dagen, 3)));
  // Ander Prodigi-product of andere opties = opnieuw controleren.
  if (b.prodigi_sku !== undefined || b.prodigi_attributen !== undefined) {
    const sku = b.prodigi_sku !== undefined ? tekst(b.prodigi_sku, 60).toUpperCase() : v.prodigi_sku;
    if (sku && !/^[A-Z0-9][A-Z0-9-_.]*$/.test(sku)) return { fout: 'Ongeldige Prodigi-artikelcode.' };
    const attr = b.prodigi_attributen !== undefined ? Object.fromEntries(Object.entries(b.prodigi_attributen && typeof b.prodigi_attributen === 'object' ? b.prodigi_attributen : {}).slice(0, 10).map(([k, w]) => [tekst(k, 40), tekst(w, 60)]).filter(([k, w]) => k && w)) : v.prodigi_attributen;
    if (sku !== v.prodigi_sku || JSON.stringify(attr) !== JSON.stringify(v.prodigi_attributen)) Object.assign(patch, { prodigi_sku: sku || null, prodigi_attributen: attr, prodigi_status: 'niet_gekoppeld', prodigi_melding: null, prodigi_product: null, kosten: null });
  }
  if (b.handmatig_leverbaar !== undefined) {
    if (b.handmatig_leverbaar && tekst(b.handmatig_reden, 300).length < 5) return { fout: 'Geef een reden waarom deze variant zonder Prodigi leverbaar is (minstens 5 tekens).' };
    Object.assign(patch, { handmatig_leverbaar: !!b.handmatig_leverbaar, handmatig_reden: b.handmatig_leverbaar ? tekst(b.handmatig_reden, 300) : null });
  }
  await db(`varianten?sku=eq.${enc(v.sku)}`, { method: 'PATCH', body: patch });
  return { ok: true, melding: `${v.sku} opgeslagen${patch.prodigi_status === 'niet_gekoppeld' ? '; controleer het Prodigi-product opnieuw' : ''}` };
}

// Lijsten bij bestaande losse posters: Prodigi-product, papier en kleur staan al klaar,
// controleren bij Prodigi gaat daarna met één klik per variant.
async function genereerLijsten(p, b) {
  const L = OPHANGING.classic;
  const kleuren = (Array.isArray(b.lijsten?.kleuren) ? b.lijsten.kleuren : []).filter((k) => L.kleuren[k]);
  if (!kleuren.length) return { fout: 'Kies minstens één lijstkleur.' };
  const basis = await db(`varianten?product_id=eq.${enc(p.id)}&lijst=is.null&papier_id=eq.${enc(STANDAARD_PAPIER)}&select=sku,formaat_id`);
  let nieuw = 0, geprijsd = 0;
  for (const v of basis) {
    const prodigi = L.prodigi[v.formaat_id];
    if (!prodigi) continue;
    const prijs = prijsVan(b.lijsten?.prijzen?.[v.formaat_id]);
    if (!(prijs > 0)) continue; // geen prijs = dit formaat (nog) niet ingelijst
    geprijsd++;
    for (const k of kleuren) {
      const sku = lijstSku(v.sku, k);
      if ((await db(`varianten?sku=eq.${enc(sku)}&select=sku`))?.[0]) continue;
      await db('varianten', { method: 'POST', body: { sku, product_id: p.id, formaat_id: v.formaat_id, papier_id: L.papier, lijst: 'classic', lijst_kleur: k, prijs,
        prodigi_sku: prodigi, prodigi_attributen: { ...L.attributen, color: k } } });
      nieuw++;
    }
  }
  if (!geprijsd) return { fout: 'Geef een prijs voor minstens één formaat in lijst.' };
  return { nieuw };
}

async function genereer(b) {
  const p = (await db(`producten?id=eq.${enc(String(b.product_id || ''))}&select=id`))?.[0];
  if (!p) return { fout: 'Poster niet gevonden.' };
  if (b.alleen_lijsten) {
    const h = await genereerLijsten(p, b);
    return h.fout ? h : { ok: true, melding: `${h.nieuw} ingelijste variant(en) aangemaakt; controleer ze bij Prodigi` };
  }
  const formaten = (Array.isArray(b.formaten) ? b.formaten : []).filter((f) => ALLE_FORMATEN[f]);
  const papieren = (Array.isArray(b.papieren) ? b.papieren : []).filter((x) => PAPIER[x]);
  if (!formaten.length || !papieren.length) return { fout: 'Kies minstens één formaat en één papiersoort.' };
  let nieuw = 0;
  for (const f of formaten) for (const pa of papieren) {
    const prijs = prijsVan(b.prijzen?.[f]);
    if (!(prijs > 0)) return { fout: `Geef een prijs voor ${ALLE_FORMATEN[f].label}.` };
    const r = await bewaarVariant({ nieuw: true, product_id: p.id, formaat_id: f, papier_id: pa, prijs });
    if (r.ok) nieuw++;
  }
  return { ok: true, melding: `${nieuw} variant(en) aangemaakt` };
}

async function bewaarFormaat(b) {
  const id = String(b.id || '').toLowerCase();
  if (!/^[0-9]{2,3}x[0-9]{2,3}(in)?$/.test(id)) return { fout: 'Formaat-id zoals 50x70 of 18x24in.' };
  const bestaand = (await db(`formaten?id=eq.${enc(id)}&select=*`))?.[0];
  if (b.nieuw && bestaand) return { fout: 'Dit formaat bestaat al.' };
  if (!b.nieuw && !bestaand) return { fout: 'Formaat niet gevonden.' };
  const bmm = Number(b.breedte_mm ?? bestaand?.breedte_mm), hmm = Number(b.hoogte_mm ?? bestaand?.hoogte_mm);
  if (!(bmm > 0 && hmm > 0)) return { fout: 'Geef breedte en hoogte in millimeters.' };
  const rij = { id, label: tekst(b.label, 40) || bestaand?.label || id, breedte_mm: bmm, hoogte_mm: hmm, actief: b.actief === undefined ? !!bestaand?.actief : !!b.actief, volgorde: geheel(b.volgorde, bestaand?.volgorde || 0) };
  if (b.nieuw) await db('formaten', { method: 'POST', body: rij }); else await db(`formaten?id=eq.${enc(id)}`, { method: 'PATCH', body: rij });
  return { ok: true, melding: `${rij.label} opgeslagen` };
}

async function bewaarPapier(b) {
  const id = b.nieuw ? slug(b.id || b.naam) : String(b.id || '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return { fout: 'Ongeldige papier-id.' };
  const bestaand = (await db(`papiersoorten?id=eq.${enc(id)}&select=*`))?.[0];
  if (b.nieuw && bestaand) return { fout: 'Deze papiersoort bestaat al.' };
  if (!b.nieuw && !bestaand) return { fout: 'Papiersoort niet gevonden.' };
  const naam = tekst(b.naam, 80) || bestaand?.naam;
  if (!naam) return { fout: 'Geef de papiersoort een naam.' };
  const rij = { id, naam, uitleg: tekst(b.uitleg, 600), gewicht_gsm: b.gewicht_gsm ? geheel(b.gewicht_gsm, null) : null, actief: b.actief === undefined ? (bestaand ? !!bestaand.actief : true) : !!b.actief, volgorde: geheel(b.volgorde, bestaand?.volgorde || 0) };
  if (b.nieuw) await db('papiersoorten', { method: 'POST', body: rij }); else await db(`papiersoorten?id=eq.${enc(id)}`, { method: 'PATCH', body: rij });
  return { ok: true, id, melding: `${naam} opgeslagen` };
}

async function uitzondering(b, aan) {
  const v = (await db(`varianten?sku=eq.${enc(String(b.sku || ''))}&select=sku,lijst,drukbestand_id`))?.[0];
  if (v?.lijst) return { fout: 'Een ingelijste variant gebruikt het drukbestand van de losse poster: bevestig de uitzondering daar.' };
  if (!v?.drukbestand_id) return { fout: 'Deze variant heeft geen drukbestand.' };
  if (aan && tekst(b.reden, 500).length < 10) return { fout: 'Motiveer de uitzondering (minstens 10 tekens): wat wijkt af en waarom is dat aanvaardbaar?' };
  await db(`varianten?sku=eq.${enc(v.sku)}`, { method: 'PATCH', body: aan ? { qc_uitzondering: tekst(b.reden, 500), qc_uitzondering_op: new Date().toISOString() } : { qc_uitzondering: null, qc_uitzondering_op: null } });
  return { ok: true, melding: aan ? 'Uitzondering vastgelegd' : 'Uitzondering ingetrokken' };
}

async function beeldUpload(b) {
  const id = String(b.id || '');
  if (!(await db(`producten?id=eq.${enc(id)}&select=id`))?.[0]) return { fout: 'Poster niet gevonden.' };
  if (!(Number(b.bytes) > 0) || Number(b.bytes) > 10 * 1024 ** 2) return { fout: 'Beeld is te groot (max. 10 MB na verkleinen).' };
  const t = Date.now().toString(36), pad = `producten/${id}-${t}.jpg`, pad_klein = `producten/${id}-${t}-klein.jpg`;
  return { ok: true, pad, pad_klein, url: await uploadUrl('visuals', pad), url_klein: await uploadUrl('visuals', pad_klein) };
}

async function beeldBevestig(b) {
  const id = String(b.id || ''), pad = String(b.pad || ''), pad_klein = String(b.pad_klein || '');
  const patroon = new RegExp(`^producten/${id}-[a-z0-9]+(-klein)?\\.jpg$`);
  if (!patroon.test(pad) || !patroon.test(pad_klein)) return { fout: 'Ongeldig pad.' };
  if (!(await info('visuals', pad)) || !(await info('visuals', pad_klein))) return { fout: 'Upload niet gevonden in de opslag; probeer het opnieuw.' };
  const oud = (await db(`producten?id=eq.${enc(id)}&select=beeld,beeld_klein`))?.[0];
  if (!oud) return { fout: 'Poster niet gevonden.' };
  await db(`producten?id=eq.${enc(id)}`, { method: 'PATCH', body: { beeld: pad, beeld_klein: pad_klein, bijgewerkt_op: new Date().toISOString() } });
  if (oud.beeld) await verwijder('visuals', [oud.beeld, oud.beeld_klein].filter(Boolean)).catch(() => {});
  return { ok: true, melding: 'Productbeeld opgeslagen' };
}

async function handler(req, res) {
  await laadCatalogus();
  const actie = param(req, 'actie');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  try {
    if (!actie && req.method === 'GET') {
      // Kort cachen: wijzigingen in beheer (beelden, teksten, prijzen) moeten binnen een halve minuut in de winkel staan.
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
      return res.status(200).json(await openbaar());
    }
    // Openbare productfeed voor Meta Commerce Manager (alleen openbare productgegevens).
    if (actie === 'feed' && req.method === 'GET') {
      if (param(req, 'kanaal') !== 'meta') return fout(res, 404, 'Onbekende feed.');
      const f = await feeds.metaFeed();
      if (dbAan()) await feeds.registreerOphalen(req.headers?.['user-agent'], f.aantal);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('content-type', 'application/xml; charset=utf-8');
      return res.status(200).send(f.xml);
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdmin(req)) return fout(res, 401, 'Niet ingelogd.');
    if (!dbAan()) return fout(res, 503, 'De administratie is nog niet gekoppeld: zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.');
    if (req.method === 'GET' && actie === 'beheer') {
      try { return res.status(200).json(await beheer()); }
      catch { return fout(res, 503, 'De catalogus staat nog niet in de database: draai de migratie 20261029030000_catalogus.sql.'); }
    }
    if (req.method === 'GET' && actie === 'product') {
      const p = await product(param(req, 'id'));
      return p ? res.status(200).json({ ok: true, ...p }) : fout(res, 404, 'Poster niet gevonden.');
    }
    if (req.method !== 'POST') return fout(res, 400, 'Onbekende actie.');
    const fn = { product: bewaarProduct, variant: bewaarVariant, 'varianten-genereren': genereer, formaat: bewaarFormaat, papier: bewaarPapier,
      uitzondering: (b) => uitzondering(b, true), 'uitzondering-intrekken': (b) => uitzondering(b, false), 'beeld-upload': beeldUpload, 'beeld-bevestig': beeldBevestig }[actie];
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

export default metAudit('catalogus', handler);
