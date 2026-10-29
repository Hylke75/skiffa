// Beheer: dashboard, marges, actielijst en serviceverzoeken (annulering, schade, retour, klacht).
//
// Cijfers komen alleen uit echte bestellingen. Marges zijn "werkelijk" waar Prodigi de kosten heeft
// gefactureerd (charges van de order) en anders een schatting op basis van de kostprijs die bij bestellen in
// de bestelregel is vastgelegd. Wat niet is meegerekend (betaalkosten, kanaalcommissie) staat erbij.
import crypto from 'node:crypto';
import { db, log } from './_db.js';
import { uploadUrl, downloadUrl, info } from './_opslag.js';
import { MAX_KANAALPOGINGEN } from './_zendingen.js';

const r2 = (v) => Math.round(v * 100) / 100;
const exBtw = (v) => r2(Number(v || 0) / 1.21);
const BETAALD = ['betaald', 'in_productie', 'deels_verzonden', 'verzonden', 'geleverd', 'terugbetaald'];
export const WACHT_DAGEN = 7;

/** Productiekosten van één bestelling: werkelijk (Prodigi) of geschat (kostprijs uit de bestelregels). */
export function margeVan(b, fulfilments = []) {
  const omzet = exBtw(Number(b.totaal) - Number(b.terugbetaald || 0));
  const regels = b.bestelregels || [];
  const geschat = regels.every((r) => r.kostprijs != null) && regels.length ? r2(regels.reduce((t, r) => t + Number(r.kostprijs) * r.aantal, 0)) : null;
  const gefactureerd = fulfilments.filter((f) => f.kosten?.totaal != null);
  const werkelijk = gefactureerd.length ? r2(gefactureerd.reduce((t, f) => t + Number(f.kosten.totaal) - Number(f.kosten.btw || 0), 0)) : null;
  const kosten = werkelijk ?? geschat;
  return {
    omzet_ex_btw: omzet, kosten_geschat: geschat, kosten_werkelijk: werkelijk, bron: werkelijk != null ? 'werkelijk' : geschat != null ? 'schatting' : 'onbekend',
    marge: kosten == null ? null : r2(omzet - kosten), herdrukken: fulfilments.filter((f) => f.herdruk_nr > 0).length,
  };
}

export const AANNAMES = [
  'Omzet is excl. 21% btw en na terugbetalingen.',
  'Werkelijke kosten = wat Prodigi heeft gefactureerd (excl. btw), inclusief herdrukken.',
  'Schatting = kostprijs per stuk uit de laatste Prodigi-offerte (incl. verzending naar NL), vastgelegd bij het bestellen; bij meerdere stuks of een ander land wijkt dit af.',
  'Niet meegerekend: Mollie-transactiekosten, commissie van bol/Etsy/Amazon en eigen verpakking.',
];

/** Dashboard over een periode (op besteldatum). */
export async function dashboard({ van, tot } = {}) {
  const v = /^\d{4}-\d{2}-\d{2}$/.test(van || '') ? van : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(tot || '') ? tot : new Date().toISOString().slice(0, 10);
  const best = await db(`bestellingen?aangemaakt_op=gte.${v}&aangemaakt_op=lt.${t}T23:59:59.999Z&status=in.(${BETAALD.join(',')})&select=id,nummer,kanaal,status,totaal,terugbetaald,betaald_op,aangemaakt_op,bestelregels(*)&order=aangemaakt_op.desc&limit=5000`);
  const fs = best.length ? await db(`fulfilments?bestelling_id=in.(${best.map((b) => b.id).join(',')})&select=bestelling_id,herdruk_nr,status,kosten`).catch(() => []) : [];
  const perKanaal = {}, ontwerpen = {}, formaten = {}, papieren = {};
  const totaal = { bestellingen: 0, omzet_ex_btw: 0, kosten: 0, marge: 0, met_werkelijke_kosten: 0, met_schatting: 0, zonder_kosten: 0, terugbetaald: 0, stuks: 0 };
  for (const b of best) {
    const m = margeVan(b, fs.filter((f) => f.bestelling_id === b.id));
    totaal.bestellingen++; totaal.omzet_ex_btw += m.omzet_ex_btw; totaal.terugbetaald += Number(b.terugbetaald || 0);
    if (m.marge != null) { totaal.kosten += m.omzet_ex_btw - m.marge; totaal.marge += m.marge; }
    totaal[m.bron === 'werkelijk' ? 'met_werkelijke_kosten' : m.bron === 'schatting' ? 'met_schatting' : 'zonder_kosten']++;
    const k = (perKanaal[b.kanaal] ||= { bestellingen: 0, omzet_ex_btw: 0, marge: 0 });
    k.bestellingen++; k.omzet_ex_btw += m.omzet_ex_btw; if (m.marge != null) k.marge += m.marge;
    for (const r of b.bestelregels || []) {
      totaal.stuks += r.aantal;
      (ontwerpen[r.poster_naam] ||= { stuks: 0, omzet: 0 }).stuks += r.aantal; ontwerpen[r.poster_naam].omzet += r.prijs * r.aantal;
      (formaten[r.formaat_label || r.formaat] ||= { stuks: 0 }).stuks += r.aantal;
      (papieren[r.papier_label || 'standaard'] ||= { stuks: 0 }).stuks += r.aantal;
    }
  }
  const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1].stuks - a[1].stuks).slice(0, n).map(([naam, x]) => ({ naam, ...x, ...(x.omzet != null ? { omzet: r2(x.omzet) } : {}) }));
  for (const k of Object.values(perKanaal)) { k.omzet_ex_btw = r2(k.omzet_ex_btw); k.marge = r2(k.marge); }
  for (const k of ['omzet_ex_btw', 'kosten', 'marge', 'terugbetaald']) totaal[k] = r2(totaal[k]);
  // Per dag (voor de grafiek), alleen dagen met bestellingen.
  const perDag = {};
  for (const b of best) { const d = b.aangemaakt_op.slice(0, 10); (perDag[d] ||= { bestellingen: 0, omzet_ex_btw: 0 }); perDag[d].bestellingen++; perDag[d].omzet_ex_btw = r2(perDag[d].omzet_ex_btw + exBtw(Number(b.totaal) - Number(b.terugbetaald || 0))); }
  const [wachtend, pubFout] = await Promise.all([
    db(`bestellingen?status=in.(betaald,in_productie,deels_verzonden)&select=id`).then((x) => x.length).catch(() => 0),
    db('product_kanalen?status=eq.fout&select=product_id').then((x) => x.length).catch(() => 0),
  ]);
  return { van: v, tot: t, totaal, perKanaal, perDag, populair: { ontwerpen: top(ontwerpen), formaten: top(formaten), papieren: top(papieren) }, wachtend, publicatieFouten: pubFout, aannames: AANNAMES };
}

// ---- actielijst ----
/** Alles wat aandacht vraagt, met een veilige vervolgstap. Afgevinkte meldingen komen pas terug als ze veranderen. */
export async function actielijst() {
  const nu = Date.now(), uit = [];
  const veilig = (p) => p.catch(() => []);
  const [fs, oud, zend, pk, kl, sv, logs, af] = await Promise.all([
    veilig(db('fulfilments?status=in.(geblokkeerd,fout,onzeker,opnieuw)&select=id,bestelling_id,herdruk_nr,status,laatste_fout,pogingen,extern_id,bijgewerkt_op&order=bijgewerkt_op.asc&limit=100')),
    veilig(db(`bestellingen?status=in.(betaald,in_productie,deels_verzonden)&betaald_op=lt.${new Date(nu - WACHT_DAGEN * 864e5).toISOString()}&select=id,nummer,status,kanaal,betaald_op&order=betaald_op.asc&limit=100`)),
    veilig(db('zendingen?kanaal_gemeld_op=is.null&kanaal_fout=not.is.null&select=id,bestelling_id,kanaal_fout,kanaal_pogingen&limit=100')),
    veilig(db('product_kanalen?status=eq.fout&select=product_id,kanaal,melding,bijgewerkt_op')),
    veilig(db('kanaal_listings?ingeschakeld=eq.true&laatste_fout=not.is.null&select=id,kanaal,poster_id,formaat,laatste_fout&limit=100')),
    veilig(db('serviceverzoeken?status=in.(open,in_behandeling)&select=id,bestelling_id,soort,status,omschrijving,aangemaakt_op&order=aangemaakt_op.asc')),
    veilig(db('kanaal_sync_log?select=kanaal,actie,ok,detail,op&order=op.desc&limit=60')),
    veilig(db('actie_afgehandeld?select=sleutel')),
  ]);
  const afgevinkt = new Set(af.map((x) => x.sleutel));
  // Terugbetaald terwijl de productie nog niet is beslist.
  const wachtend = await veilig(db('fulfilments?status=in.(wacht,geblokkeerd)&extern_id=is.null&select=id,bestelling_id'));
  const ids = [...new Set([...fs, ...zend, ...sv, ...wachtend].map((x) => x.bestelling_id))];
  const bs = ids.length ? await veilig(db(`bestellingen?id=in.(${ids.join(',')})&select=id,nummer,kanaal,terugbetaald`)) : [];
  const bv = (id) => bs.find((b) => b.id === id) || {};
  const STAT = { geblokkeerd: 'Productie geblokkeerd', fout: 'Productie mislukt', onzeker: 'Productie onzeker: wordt gecontroleerd bij Prodigi', opnieuw: 'Productie volgt opnieuw' };
  for (const f of fs) {
    if (f.status === 'opnieuw' && (f.pogingen || 0) < 3) continue;   // gewone herhaalpoging, nog geen actie nodig
    if (f.status === 'geblokkeerd' && !f.extern_id && Number(bv(f.bestelling_id).terugbetaald) > 0) continue;   // staat hieronder als 'terugbetaald'
    uit.push({ sleutel: `prod:${f.id}:${f.status}:${f.pogingen || 0}`, ernst: f.status === 'onzeker' ? 'info' : 'hoog', soort: 'productie', titel: `${STAT[f.status]}${f.herdruk_nr ? ` (herdruk ${f.herdruk_nr})` : ''}`,
      tekst: f.laatste_fout || '', bestelling: { id: f.bestelling_id, nummer: bv(f.bestelling_id).nummer }, acties: f.status === 'onzeker' ? ['open'] : ['open', 'prodigi-opnieuw'] });
  }
  for (const b of oud) uit.push({ sleutel: `wacht:${b.id}:${b.status}`, ernst: 'middel', soort: 'verzending', titel: `Al ${Math.floor((nu - Date.parse(b.betaald_op)) / 864e5)} dagen betaald, ${b.status === 'deels_verzonden' ? 'deels' : 'nog niet'} verzonden`,
    tekst: b.kanaal !== 'webshop' ? `${b.kanaal}-order: let op de verzendtermijn van het kanaal.` : '', bestelling: { id: b.id, nummer: b.nummer }, acties: ['open', 'afvinken'] });
  for (const z of zend) uit.push({ sleutel: `zend:${z.id}:${z.kanaal_pogingen}`, ernst: z.kanaal_pogingen >= MAX_KANAALPOGINGEN ? 'hoog' : 'middel', soort: 'tracking',
    titel: `Tracking niet doorgegeven aan ${bv(z.bestelling_id).kanaal || 'kanaal'} (${z.kanaal_pogingen}×)`, tekst: z.kanaal_fout, bestelling: { id: z.bestelling_id, nummer: bv(z.bestelling_id).nummer },
    acties: ['open', ...(z.kanaal_pogingen >= MAX_KANAALPOGINGEN ? ['zending-opnieuw'] : [])], zending_id: z.id });
  for (const p of pk) uit.push({ sleutel: `pub:${p.product_id}:${p.kanaal}:${p.bijgewerkt_op}`, ernst: 'middel', soort: 'publicatie', titel: `Publicatie op ${p.kanaal} mislukt: ${p.product_id}`, tekst: p.melding || '', acties: ['verkoopkanalen'] });
  for (const l of kl) uit.push({ sleutel: `listing:${l.id}:${l.laatste_fout}`, ernst: 'laag', soort: 'publicatie', titel: `${l.kanaal}: ${l.poster_id} ${l.formaat}`, tekst: l.laatste_fout, acties: ['koppelingen', 'afvinken'] });
  for (const s of sv) uit.push({ sleutel: `service:${s.id}`, ernst: s.soort === 'schade' || s.soort === 'annulering' ? 'hoog' : 'middel', soort: 'service', titel: `${s.soort[0].toUpperCase()}${s.soort.slice(1)} (${s.status.replace('_', ' ')})`,
    tekst: s.omschrijving.slice(0, 160), bestelling: { id: s.bestelling_id, nummer: bv(s.bestelling_id).nummer }, acties: ['open'] });
  // Laatste synchronisatie per kanaal mislukt?
  const gezien = new Set();
  for (const l of logs) { if (gezien.has(l.kanaal)) continue; gezien.add(l.kanaal);
    if (!l.ok) uit.push({ sleutel: `sync:${l.kanaal}:${l.op}`, ernst: 'middel', soort: 'synchronisatie', titel: `Laatste synchronisatie met ${l.kanaal} mislukt`, tekst: (l.detail?.log || []).filter((x) => !x.ok).map((x) => x.info).join(' · ').slice(0, 240), acties: ['koppelingen', 'afvinken'] }); }
  for (const f of wachtend.filter((x) => Number(bv(x.bestelling_id).terugbetaald) > 0))
    uit.push({ sleutel: `terug:${f.id}`, ernst: 'hoog', soort: 'productie', titel: 'Terugbetaald: beslis over de productie', tekst: 'Toch produceren (vrijgeven) of productie annuleren.', bestelling: { id: f.bestelling_id, nummer: bv(f.bestelling_id).nummer }, acties: ['open'] });
  try { uit.push(...(await (await import('./_social.js')).actiepunten())); } catch { /* zonder social-tabellen */ }
  const ORDE = { hoog: 0, middel: 1, info: 2, laag: 3 };
  const zicht = uit.filter((x) => !afgevinkt.has(x.sleutel)).sort((a, b) => ORDE[a.ernst] - ORDE[b.ernst]);
  return { acties: zicht, afgevinkt: uit.length - zicht.length };
}

export async function afvinken(sleutel, notitie) {
  if (!/^[a-z]+:[\w:.\-]{1,200}$/i.test(String(sleutel || ''))) return { fout: 'Onbekende melding.' };
  await db('actie_afgehandeld?on_conflict=sleutel', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { sleutel, notitie: String(notitie || '').slice(0, 300) || null } });
  return { ok: true, melding: 'Afgevinkt' };
}

/** Een zending die na alle pogingen niet aan het kanaal is gemeld opnieuw laten proberen (bij de volgende sync). */
export async function zendingOpnieuw(id) {
  const r = await db(`zendingen?id=eq.${Number(id)}&kanaal_gemeld_op=is.null`, { method: 'PATCH', prefer: 'return=representation', body: { kanaal_pogingen: 0, kanaal_fout: null } });
  if (!r?.length) return { fout: 'Zending niet gevonden of al doorgegeven.' };
  await log(r[0].bestelling_id, 'zending', 'doorgeven aan het kanaal opnieuw ingepland', 'admin');
  return { ok: true, melding: 'Wordt bij de volgende synchronisatie opnieuw doorgegeven.' };
}

// ---- serviceverzoeken ----
const SOORTEN = ['annulering', 'schade', 'retour', 'klacht'];
const OPLOSSINGEN = ['herdruk', 'terugbetaling', 'annulering', 'retour_ontvangen', 'geen'];
const FOTO = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

export const verzoekenVan = (bestellingId) => db(`serviceverzoeken?bestelling_id=eq.${bestellingId}&select=*&order=id.asc`);

export async function nieuwVerzoek({ bestelling_id, soort, omschrijving, regels }, door = 'admin') {
  if (!SOORTEN.includes(soort)) return { fout: 'Kies annulering, schade, retour of klacht.' };
  const tekst = String(omschrijving || '').trim().slice(0, 2000);
  if (tekst.length < 5) return { fout: 'Beschrijf het verzoek (minstens 5 tekens).' };
  const b = (await db(`bestellingen?id=eq.${bestelling_id}&select=id,bestelregels(id)`))?.[0];
  if (!b) return { fout: 'Bestelling niet gevonden.' };
  const ids = new Set((b.bestelregels || []).map((r) => String(r.id)));
  const rg = Array.isArray(regels) && regels.length ? regels.map(String).filter((x) => ids.has(x)) : null;
  const [v] = await db('serviceverzoeken', { method: 'POST', prefer: 'return=representation', body: { bestelling_id, soort, omschrijving: tekst, regels: rg?.length ? rg : null, door } });
  await log(bestelling_id, 'service', `${soort} geregistreerd: ${tekst.slice(0, 200)}`, door);
  return { ok: true, verzoek: v, melding: `${soort[0].toUpperCase()}${soort.slice(1)} geregistreerd` };
}

export async function fotoUpload({ id, bestandsnaam, bytes }) {
  const v = (await db(`serviceverzoeken?id=eq.${Number(id)}&select=id,bestelling_id,fotos`))?.[0];
  if (!v) return { fout: 'Verzoek niet gevonden.' };
  const ext = String(bestandsnaam || '').toLowerCase().split('.').pop();
  if (!FOTO[ext]) return { fout: "Foto's als jpg, png, webp of heic." };
  if (!(Number(bytes) > 0) || Number(bytes) > 25e6) return { fout: 'Foto mag maximaal 25 MB zijn.' };
  if ((v.fotos || []).length >= 10) return { fout: "Maximaal 10 foto's per verzoek." };
  const pad = `service/${v.bestelling_id}/${v.id}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  return { ok: true, pad, mime: FOTO[ext], url: await uploadUrl('drukbestanden', pad) };
}

export async function fotoBevestig({ id, pad }) {
  const v = (await db(`serviceverzoeken?id=eq.${Number(id)}&select=id,bestelling_id,fotos`))?.[0];
  if (!v) return { fout: 'Verzoek niet gevonden.' };
  if (!String(pad || '').startsWith(`service/${v.bestelling_id}/${v.id}-`) || /\.\./.test(pad)) return { fout: 'Onbekend bestand.' };
  if (!(await info('drukbestanden', pad))) return { fout: 'De foto is niet aangekomen; probeer opnieuw.' };
  if ((v.fotos || []).includes(pad)) return { ok: true };
  await db(`serviceverzoeken?id=eq.${v.id}`, { method: 'PATCH', body: { fotos: [...(v.fotos || []), pad], bijgewerkt_op: new Date().toISOString() } });
  return { ok: true, melding: 'Foto toegevoegd' };
}

/** Verzoeken met tijdelijke links naar de foto's (privé bucket). */
export async function verzoekenMetFotos(bestellingId) {
  const vs = await verzoekenVan(bestellingId);
  return Promise.all(vs.map(async (v) => ({ ...v, foto_links: await Promise.all((v.fotos || []).map((p) => downloadUrl('drukbestanden', p, 900).catch(() => null))) })));
}

/** Status of oplossing vastleggen. De oplossing zelf (terugbetalen, herdruk, annuleren) is een aparte actie. */
export async function zetVerzoek({ id, status, oplossing, notitie, fulfilment_id, terugbetaald }, door = 'admin') {
  const v = (await db(`serviceverzoeken?id=eq.${Number(id)}&select=*`))?.[0];
  if (!v) return { fout: 'Verzoek niet gevonden.' };
  if (status && !['open', 'in_behandeling', 'opgelost', 'afgewezen'].includes(status)) return { fout: 'Onbekende status.' };
  if (oplossing && !OPLOSSINGEN.includes(oplossing)) return { fout: 'Onbekende oplossing.' };
  if (status === 'opgelost' && !(oplossing || v.oplossing)) return { fout: 'Kies hoe het is opgelost.' };
  if (status === 'afgewezen' && String(notitie || '').trim().length < 5) return { fout: 'Geef een reden voor de afwijzing.' };
  const nu = new Date().toISOString();
  const patch = { bijgewerkt_op: nu };
  if (status) { patch.status = status; patch.opgelost_op = ['opgelost', 'afgewezen'].includes(status) ? nu : null; }
  if (oplossing) patch.oplossing = oplossing;
  if (notitie !== undefined) patch.oplossing_notitie = String(notitie || '').trim().slice(0, 1000) || null;
  if (fulfilment_id) patch.fulfilment_id = Number(fulfilment_id);
  if (terugbetaald != null && terugbetaald !== '') patch.terugbetaald = r2(Number(String(terugbetaald).replace(',', '.')));
  await db(`serviceverzoeken?id=eq.${v.id}`, { method: 'PATCH', body: patch });
  await log(v.bestelling_id, 'service', `${v.soort}: ${status ? status.replace('_', ' ') : 'bijgewerkt'}${oplossing ? ` (${oplossing.replace('_', ' ')})` : ''}${patch.oplossing_notitie ? ` – ${patch.oplossing_notitie}` : ''}`, door);
  return { ok: true, melding: 'Verzoek bijgewerkt' };
}
