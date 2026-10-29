/* Beheer → producten: centrale productcatalogus met varianten, beelden, drukbestanden en Prodigi.
   Gebruikt de helpers uit admin.html ($, esc, euro, datum, meld, toonLogin, papi). */
const Producten = (() => {
  const doos = () => $('#producten');
  let beheer = null, huidig = null, open_ = new Set(), zoek = '', statusFilter = '';
  const STATUS = { concept: 'concept', gereed: 'gereed voor publicatie', actief: 'actief', gearchiveerd: 'gearchiveerd' };
  const SOORT = { foto: 'productfoto', mockup: 'interieur-mock-up', detail: 'detail', papier: 'papier', video: 'video' };
  const ERNST = { ok: '✓', waarschuwing: '⚠', afgekeurd: '✗' };
  const mb = (b) => b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : (b / 1e6).toFixed(b < 1e7 ? 1 : 0).replace('.', ',') + ' MB';
  const nl = (v) => String(v ?? '').replace('.', ',');
  const bedrag = (v) => (v == null ? '—' : euro(v));

  async function vraag(route, actie, body, params) {
    const q = new URLSearchParams({ actie, ...(params || {}) });
    const r = await fetch(`/api/${route}?${q}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ ok: false, melding: 'Onverwacht antwoord van de server.' }));
    if (r.status === 401) { toonLogin(); throw new Error('uit'); }
    if (!j.ok) throw new Error(j.melding || j.info || 'Mislukt');
    return j;
  }
  const capi = (a, b, p) => vraag('catalogus', a, b, p), mapi = (a, b, p) => vraag('media', a, b, p);
  const fout = (e) => { if (e.message !== 'uit') meld(e.message, true); };

  // ---- bestanden ----
  async function meetPdf(file) {
    const box = (n) => new RegExp('/' + n + '\\s*\\[\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\]');
    const mm = (m) => m ? [(m[3] - m[1]) * 25.4 / 72, (m[4] - m[2]) * 25.4 / 72].map((x) => Math.abs(Math.round(x * 10) / 10)) : null;
    let media = null, trim = null, rest = ''; const STUK = 8 * 1024 * 1024;
    for (let i = 0; i < file.size && !(media && trim); i += STUK) {
      const t = rest + new TextDecoder('latin1').decode(await file.slice(i, i + STUK).arrayBuffer());
      if (!media) { const m = t.match(box('MediaBox')); if (m) media = mm(m); }
      if (!trim) { const m = t.match(box('TrimBox')); if (m) trim = mm(m); }
      rest = t.slice(-200);
    }
    return { pagina_mm: trim || media };
  }
  async function meetBeeld(file) {
    try { const b = await createImageBitmap(file); const r = { breedte_px: b.width, hoogte_px: b.height }; b.close?.(); return r; } catch { return {}; }
  }
  function verklein(file, max) {
    return createImageBitmap(file).then((bmp) => {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h);
      return new Promise((r) => c.toBlob((b) => r({ blob: b, w, h }), 'image/jpeg', 0.86));
    });
  }
  function put(url, body, type, voortgang) {
    return new Promise((ok, nok) => {
      const x = new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('content-type', type); x.setRequestHeader('x-upsert', 'true');
      x.upload.onprogress = (e) => { if (e.lengthComputable && voortgang) voortgang(e.loaded / e.total); };
      x.onload = () => x.status < 300 ? ok() : nok(new Error(x.status === 413 ? 'Bestand te groot voor de uploadlimiet van je Supabase-project (Storage → Settings).' : `Upload mislukt (${x.status})`));
      x.onerror = () => nok(new Error('Upload mislukt (verbinding)')); x.send(body);
    });
  }
  function kiesBestand(accept, fn, meer = false) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = meer; i.onchange = () => i.files.length && fn(meer ? [...i.files] : i.files[0]); i.click(); }

  async function uploadDruk(file, sku, voortgang) {
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) throw new Error(`${file.name}: drukbestand moet jpg, png of pdf zijn`);
    const meting = /\.pdf$/i.test(file.name) ? await meetPdf(file) : await meetBeeld(file);
    const u = await mapi('druk-upload', { sku, bytes: file.size, bestandsnaam: file.name });
    await put(u.url, file, u.mime, voortgang);
    return mapi('druk-bevestig', { sku, pad: u.pad, versie: u.versie, bestandsnaam: file.name, meting });
  }
  async function uploadBeeld(file, posterId, positie, extra = {}) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`${file.name}: alleen jpg, png of webp`);
    const [groot, klein] = await Promise.all([verklein(file, 2000), verklein(file, 900)]);
    const u = await mapi('beeld-upload', { poster_id: posterId, positie, bytes: groot.blob.size });
    await put(u.url, groot.blob, 'image/jpeg'); await put(u.url_klein, klein.blob, 'image/jpeg');
    return mapi('beeld-bevestig', { poster_id: posterId, positie, pad: u.pad, pad_klein: u.pad_klein, breedte: groot.w, hoogte: groot.h, ...extra });
  }

  // ---- uitsnede-voorbeeld: precies wat er op het papier komt (witte rand of bijsnijden) ----
  function uitsnede(src, beeldRatio, doelRatio, sizing, uits) {
    if (!src || !beeldRatio || !doelRatio) return '';
    const W = 220;
    if (sizing === 'fillPrintArea') {
      const ih = W / beeldRatio, aw = beeldRatio > doelRatio ? ih * doelRatio : W, ah = beeldRatio > doelRatio ? ih : W / doelRatio;
      return `<div class="uits" style="width:${W}px;height:${ih}px"><img src="${esc(src)}" alt=""><i style="left:${(W - aw) / 2}px;top:${(ih - ah) / 2}px;width:${aw}px;height:${ah}px;box-shadow:0 0 0 999px rgba(0,0,0,.5)"></i></div>
        <div class="mini">${uits ? `Donker = wordt afgesneden (${nl(uits.mm)} mm ${esc(uits.zijde)}).` : 'Kader = wat er op het papier komt.'}</div>`;
    }
    const ah = W / doelRatio, iw = beeldRatio > doelRatio ? W : ah * beeldRatio, ih = beeldRatio > doelRatio ? W / beeldRatio : ah;
    return `<div class="uits papier" style="width:${W}px;height:${ah}px"><img src="${esc(src)}" alt="" style="left:${(W - iw) / 2}px;top:${(ah - ih) / 2}px;width:${iw}px;height:${ih}px"></div>
      <div class="mini">${uits ? `Witte rand: ${nl(uits.mm)} mm ${esc(uits.zijde)}.` : 'Het hele vlak = het papier.'}</div>`;
  }
  const doelRatio = (v) => { const pp = v.prodigi_status === 'bevestigd' ? v.prodigi_product : null; if (pp?.px?.b) return pp.px.b / pp.px.h; const f = huidig?.formaten.find((x) => x.id === v.formaat_id); return f ? f.breedte_mm / f.hoogte_mm : null; };

  // ================= overzicht =================
  async function overzicht() {
    huidig = null;
    if (!location.hash.startsWith('#producten')) history.replaceState(null, '', '#producten');
    doos().innerHTML = '<div class="leeg">laden…</div>';
    try { beheer = await capi('beheer'); } catch (e) { if (e.message !== 'uit') doos().innerHTML = `<div class="waarschuw">${esc(e.message)} Tot dan gelden de producten en prijzen uit de code.</div>`; return; }
    tekenOverzicht();
  }
  function tekenOverzicht() {
    const b = beheer, q = zoek.toLowerCase();
    const rijen = b.producten.filter((p) => (!statusFilter || p.status === statusFilter) && (!q || `${p.titel} ${p.interne_naam} ${p.code} ${p.collectie} ${p.onderwerp} ${(p.zoekwoorden || []).join(' ')}`.toLowerCase().includes(q)));
    doos().innerHTML = `
      ${b.productieRoute === 'prodigi' ? '' : '<div class="waarschuw">Prodigi staat uit: varianten zijn alleen bestelbaar als je ze handmatig leverbaar verklaart (met reden). Zet Prodigi aan bij Kanalen.</div>'}
      <div class="balk"><input type="search" id="pZoek" placeholder="zoek op titel, code, collectie, zoekwoord…" value="${esc(zoek)}">
        <select id="pStatus"><option value="">alle statussen</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === statusFilter ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span style="flex:1"></span><button data-p="instellingen">formaten en papier</button><button class="vol" data-p="nieuw">+ nieuwe poster</button></div>
      <label class="drop" id="pDrop"><input type="file" id="pDropInput" multiple accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" hidden>
        <b>Sleep drukbestanden en beelden van meerdere posters tegelijk hierheen.</b> De bestandsnaam bepaalt de koppeling:
        <span class="mini" style="display:block;margin-top:4px">drukbestand: <code>golf-50x70.png</code> · <code>golf-50x70-mat.pdf</code> &nbsp;—&nbsp; beeld: <code>golf-1.jpg</code>, <code>golf-2.jpg</code> …</span></label>
      <div id="pWachtrij"></div>
      ${rijen.length ? `<table class="ptabel"><thead><tr><th></th><th>poster</th><th>code</th><th>status</th><th class="vb">collectie</th><th>varianten klaar</th></tr></thead><tbody>${rijen.map((p) => `
        <tr data-id="${esc(p.id)}"><td>${p.klein ? `<img src="${esc(p.klein)}" alt="" class="duim">` : '<span class="duim leegbeeld"></span>'}</td>
        <td><b>${esc(p.titel)}</b>${p.interne_naam && p.interne_naam !== p.titel ? `<div class="mini">${esc(p.interne_naam)}</div>` : ''}</td><td>${esc(p.code)}</td>
        <td><span class="st ${esc(p.status)}">${esc(STATUS[p.status] || p.status)}</span></td><td class="vb">${esc(p.collectie || '')}</td>
        <td class="${p.klaar ? 'ok' : 'nok'}">${p.klaar} / ${p.varianten}</td></tr>`).join('')}</tbody></table>` : '<div class="leeg">Geen posters gevonden.</div>'}
      <div id="pInstellingen"></div>`;
    tekenWachtrij();
  }

  // ---- formaten en papiersoorten ----
  function tekenInstellingen() {
    const b = beheer;
    $('#pInstellingen').innerHTML = `<div class="blok"><h3>formaten</h3><div class="schuif"><table class="kaal"><thead><tr><th>id</th><th>label</th><th>breedte (mm)</th><th>hoogte (mm)</th><th>actief</th><th>volgorde</th><th></th></tr></thead><tbody>
      ${b.formaten.map((f) => `<tr data-fid="${esc(f.id)}"><td>${esc(f.id)}</td><td><input data-v="label" value="${esc(f.label)}"></td><td><input data-v="breedte_mm" value="${esc(f.breedte_mm)}" class="kort"></td><td><input data-v="hoogte_mm" value="${esc(f.hoogte_mm)}" class="kort"></td>
        <td><input type="checkbox" class="schakel" data-v="actief" ${f.actief ? 'checked' : ''}></td><td><input data-v="volgorde" value="${esc(f.volgorde)}" class="kort"></td><td><button data-p="formaat">opslaan</button></td></tr>`).join('')}
      <tr data-fid="" class="nieuw"><td><input data-v="id" placeholder="40x50" class="kort"></td><td><input data-v="label" placeholder="40 × 50 cm"></td><td><input data-v="breedte_mm" class="kort"></td><td><input data-v="hoogte_mm" class="kort"></td><td><input type="checkbox" class="schakel" data-v="actief"></td><td><input data-v="volgorde" class="kort"></td><td><button data-p="formaat-nieuw">toevoegen</button></td></tr>
      </tbody></table></div></div>
      <div class="blok"><h3>papiersoorten</h3><p class="mini">De uitleg zie je op de productpagina. Een papiersoort is pas bestelbaar als het bijbehorende Prodigi-product per variant is bevestigd.</p><div class="schuif"><table class="kaal"><thead><tr><th>id</th><th>naam</th><th>uitleg voor de klant</th><th>g/m²</th><th>actief</th><th>volgorde</th><th></th></tr></thead><tbody>
      ${b.papiersoorten.map((p) => `<tr data-paid="${esc(p.id)}"><td>${esc(p.id)}</td><td><input data-v="naam" value="${esc(p.naam)}"></td><td><textarea data-v="uitleg" rows="2">${esc(p.uitleg)}</textarea></td><td><input data-v="gewicht_gsm" value="${esc(p.gewicht_gsm ?? '')}" class="kort"></td>
        <td><input type="checkbox" class="schakel" data-v="actief" ${p.actief ? 'checked' : ''}></td><td><input data-v="volgorde" value="${esc(p.volgorde)}" class="kort"></td><td><button data-p="papier">opslaan</button></td></tr>`).join('')}
      <tr data-paid="" class="nieuw"><td></td><td><input data-v="naam" placeholder="bv. Hahnemühle Photo Rag"></td><td><textarea data-v="uitleg" rows="2"></textarea></td><td><input data-v="gewicht_gsm" class="kort"></td><td><input type="checkbox" class="schakel" data-v="actief" checked></td><td><input data-v="volgorde" class="kort"></td><td><button data-p="papier-nieuw">toevoegen</button></td></tr>
      </tbody></table></div></div>`;
  }
  const rijWaarden = (tr) => { const w = {}; tr.querySelectorAll('[data-v]').forEach((i) => { w[i.dataset.v] = i.type === 'checkbox' ? i.checked : i.value; }); return w; };

  // ---- meerdere bestanden tegelijk ----
  let wachtrij = [];
  async function nieuweBestanden(files) {
    files = [...files]; if (!files.length) return;
    try { const { bestanden } = await mapi('herken', { namen: files.map((f) => f.name) }); wachtrij = bestanden.map((b, i) => ({ ...b, file: files[i] })); tekenWachtrij(); } catch (e) { fout(e); }
  }
  function tekenWachtrij() {
    const w = $('#pWachtrij'); if (!w) return;
    if (!wachtrij.length) { w.innerHTML = ''; return; }
    const goed = wachtrij.filter((b) => !b.fout && !b.klaar).length;
    w.innerHTML = `<table><thead><tr><th>bestand</th><th>koppeling</th><th>status</th></tr></thead><tbody>${wachtrij.map((b, i) => `<tr data-i="${i}"><td>${esc(b.naam)}<div class="mini">${mb(b.file.size)}</div></td>
      <td>${b.fout ? `<span class="nok">${esc(b.fout)}</span>` : b.soort === 'druk' ? `drukbestand <b>${esc(b.sku)}</b>` : `beeld ${esc(b.positie)} van <b>${esc(b.poster_id)}</b>`}</td>
      <td class="mini">${esc(b.status || (b.fout ? 'niet gekoppeld' : 'klaar om te uploaden'))}<div class="balkje"><i style="width:${(b.voortgang || 0) * 100}%"></i></div></td></tr>`).join('')}</tbody></table>
      <div class="acties" style="margin:6px 0 18px"><button class="vol" data-p="upload-alles" ${goed ? '' : 'disabled'}>upload ${goed} bestand${goed === 1 ? '' : 'en'}</button><button data-p="wis-wachtrij">wis lijst</button><span class="mini">Een nieuw drukbestand wordt een nieuwe versie; eerdere bestellingen houden hun eigen versie.</span></div>`;
  }
  async function uploadAlles(knop) {
    knop.disabled = true;
    const zet = (i, v) => { Object.assign(wachtrij[i], v); const tr = document.querySelector(`#pWachtrij tr[data-i="${i}"]`); if (tr) { tr.lastElementChild.firstChild.textContent = wachtrij[i].status; tr.querySelector('.balkje i').style.width = (wachtrij[i].voortgang || 0) * 100 + '%'; } };
    let ok = 0, mis = 0;
    for (const [i, b] of wachtrij.entries()) {
      if (b.fout || b.klaar) continue;
      zet(i, { status: 'bezig…', voortgang: 0 });
      try {
        const r = b.soort === 'druk' ? await uploadDruk(b.file, b.sku, (f) => zet(i, { voortgang: f })) : await uploadBeeld(b.file, b.poster_id, b.positie);
        zet(i, { status: `${b.soort === 'druk' ? ERNST[r.status] + ' ' : '✓ '}${r.melding || 'opgeslagen'}`, voortgang: 1, klaar: true }); ok++;
      } catch (e) { if (e.message === 'uit') return; zet(i, { status: '✗ ' + e.message }); mis++; }
    }
    meld(`${ok} bestand${ok === 1 ? '' : 'en'} verwerkt${mis ? `, ${mis} mislukt` : ''}`, !!mis);
    beheer = await capi('beheer').catch(() => beheer); tekenOverzicht();
  }

  // ================= één product =================
  async function product(id) {
    history.replaceState(null, '', '#product/' + encodeURIComponent(id));
    doos().innerHTML = '<div class="leeg">laden…</div>';
    try { huidig = await capi('product', null, { id }); } catch (e) { if (e.message !== 'uit') doos().innerHTML = `<div class="leeg">${esc(e.message)}</div>`; return; }
    tekenProduct();
  }
  async function herlaad() { const id = huidig.product.id; const scroll = scrollY; huidig = await capi('product', null, { id }); tekenProduct(); scrollTo(0, scroll); }

  function tekenProduct() {
    const { product: p, varianten, beelden, formaten, papiersoorten, productieRoute } = huidig;
    const klaar = varianten.filter((v) => v.klaar).length;
    doos().innerHTML = `
      <div class="balk"><button data-p="terug">← alle posters</button><h2 style="font-size:15px;font-weight:500;letter-spacing:.06em">${esc(p.titel)}</h2><span class="st ${esc(p.status)}">${esc(STATUS[p.status])}</span>
        <span class="mini">${esc(p.code)} · ${klaar} van ${varianten.length} varianten klaar voor verkoop</span><span style="flex:1"></span>
        ${p.status === 'actief' ? `<a href="/#${encodeURIComponent(p.id)}" target="_blank" rel="noopener">bekijk in de winkel ↗</a>` : ''}</div>

      <div class="pgrid">
        <div class="blok"><h3>productgegevens</h3>
          <div class="pform">
            <label>verkooptitel<input data-g="titel" value="${esc(p.titel)}"></label>
            <label>interne naam<input data-g="interne_naam" value="${esc(p.interne_naam)}"></label>
            <label>productcode<input data-g="code" value="${esc(p.code)}"></label>
            <label>URL<input value="/#${esc(p.id)}" disabled title="De URL-naam staat vast zodra de poster bestaat (bestellingen en kanalen verwijzen ernaar)."></label>
            <label class="breed">beschrijving<textarea data-g="beschrijving" rows="4">${esc(p.beschrijving)}</textarea></label>
            <label>stijlregel (onder de titel)<input data-g="stijl" value="${esc(p.stijl)}"></label>
            <label>collectie<input data-g="collectie" value="${esc(p.collectie)}"></label>
            <label>onderwerp<input data-g="onderwerp" value="${esc(p.onderwerp)}"></label>
            <label>kleuren (komma's)<input data-g="kleuren" value="${esc((p.kleuren || []).join(', '))}"></label>
            <label class="breed">zoekwoorden (komma's)<input data-g="zoekwoorden" value="${esc((p.zoekwoorden || []).join(', '))}"></label>
            <label>SEO-titel <span class="mini" data-teller="seo_titel">${(p.seo_titel || '').length}/70</span><input data-g="seo_titel" maxlength="70" value="${esc(p.seo_titel)}"></label>
            <label class="breed">SEO-beschrijving <span class="mini" data-teller="seo_beschrijving">${(p.seo_beschrijving || '').length}/170</span><textarea data-g="seo_beschrijving" maxlength="170" rows="2">${esc(p.seo_beschrijving)}</textarea></label>
            <label>accentkleur<input type="color" data-g="accentkleur" value="${esc(p.accentkleur)}"></label>
            <label>volgorde<input data-g="volgorde" value="${esc(p.volgorde)}" class="kort"></label>
            <label>status<select data-g="status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
          <div class="acties" style="margin-top:10px"><button class="vol" data-p="product-opslaan">opslaan</button><button data-p="social">maak socialmediabericht</button><span class="mini">Gereed of actief kan pas als minstens één variant klaar is voor verkoop.</span></div>
        </div>
        <div class="blok"><h3>productbeeld</h3>
          <div class="pbeeld" data-p="hoofdbeeld" title="productbeeld vervangen">${p.klein ? `<img src="${esc(p.klein)}" alt="">` : '<span>+ productbeeld</span>'}</div>
          <p class="mini" style="margin-top:6px">Het hoofdbeeld in de winkel en op de kanalen. Drukbestanden staan hier los van en zijn nooit openbaar.</p>
        </div>
      </div>

      <div class="blok"><h3>beelden: productfoto's, interieur-mock-ups, details en papier</h3>
        <div class="beelden">${beelden.map((b) => `<div class="bl" data-pos="${b.positie}"><img src="${esc(b.klein)}" alt="${esc(b.alt)}" loading="lazy">
          <div class="blv"><span class="mini">#${b.positie}</span>
            <select data-b="soort">${Object.entries(SOORT).map(([k, l]) => `<option value="${k}" ${k === b.soort ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select data-b="formaat_id"><option value="">alle formaten</option>${formaten.map((f) => `<option value="${esc(f.id)}" ${f.id === b.formaat ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
            <select data-b="papier_id"><option value="">alle papiersoorten</option>${papiersoorten.map((x) => `<option value="${esc(x.id)}" ${x.id === b.papier ? 'selected' : ''}>${esc(x.naam)}</option>`).join('')}</select>
            <input data-b="alt" value="${esc(b.alt)}" placeholder="omschrijving (alt-tekst)">
            <div class="acties"><button data-p="beeld-opslaan">opslaan</button><button data-p="beeld-weg" aria-label="verwijder">×</button></div></div></div>`).join('')}
          <div class="bl nieuw" data-p="beelden-toevoegen"><span>+ beelden toevoegen</span></div></div>
        <p class="mini">Beelden met een formaat of papiersoort verschijnen in de winkel alleen bij die keuze.</p>
      </div>

      <div class="blok"><h3>varianten</h3>
        ${productieRoute === 'prodigi' ? '' : '<p class="waarschuw" style="margin:0 0 10px">Prodigi staat uit: een variant is alleen bestelbaar als je hem handmatig leverbaar verklaart.</p>'}
        <div class="schuif"><table class="kaal vtabel"><thead><tr><th>SKU</th><th>formaat</th><th>papier</th><th>ophanging</th><th class="r">prijs</th><th class="r">kostprijs</th><th>Prodigi</th><th>drukbestand</th><th>stand</th></tr></thead><tbody>
        ${varianten.map((v) => `<tr class="vrij ${open_.has(v.sku) ? 'open' : ''}" data-sku="${esc(v.sku)}"><td><b>${esc(v.sku)}</b>${v.actief ? '' : ' <span class="kb">uit</span>'}</td><td>${esc(formaten.find((f) => f.id === v.formaat_id)?.label || v.formaat_id)}</td>
          <td>${esc(papiersoorten.find((x) => x.id === v.papier_id)?.naam || v.papier_id)}</td><td>${esc(v.ophanging || '—')}</td><td class="r">${euro(v.prijs)}</td><td class="r">${bedrag(v.kostprijs)}</td>
          <td class="${v.prodigi_status === 'bevestigd' ? 'ok' : v.prodigi_status === 'ongeldig' ? 'nok' : ''}">${v.prodigi_status === 'bevestigd' ? '✓ bevestigd' : v.prodigi_status === 'ongeldig' ? '✗ ongeldig' : v.prodigi_sku ? 'niet gecontroleerd' : '—'}${v.handmatig_leverbaar ? '<div class="mini">handmatig leverbaar</div>' : ''}</td>
          <td class="${v.drukbestand?.status === 'afgekeurd' && !v.qc_uitzondering ? 'nok' : v.drukbestand?.status === 'ok' ? 'ok' : ''}">${v.drukbestand ? `${ERNST[v.drukbestand.status]} v${v.drukbestand.versie}${v.qc_uitzondering ? ' (uitzondering)' : ''}` : '<span class="nok">ontbreekt</span>'}</td>
          <td class="${v.klaar ? 'ok' : 'nok'}">${v.klaar ? '✓ klaar' : `${v.ontbreekt.length} punt${v.ontbreekt.length > 1 ? 'en' : ''}`}</td></tr>
`).join('')}
        </tbody></table></div>
        ${varianten.filter((v) => open_.has(v.sku)).map((v) => `<div class="vdetail" data-sku="${esc(v.sku)}"><div class="balk" style="margin:0"><b>${esc(v.sku)}</b><span class="mini">${esc(formaten.find((f) => f.id === v.formaat_id)?.label || '')} · ${esc(papiersoorten.find((x) => x.id === v.papier_id)?.naam || '')}${v.ophanging ? ` · ${esc(v.ophanging)}` : ''}</span><span style="flex:1"></span><button data-p="sluit-variant">sluiten</button></div>${variantDetail(v)}</div>`).join('')}
        <details style="margin-top:10px"><summary class="mini">varianten toevoegen</summary>
          <div class="genereer"><div><b class="mini">formaten</b>${formaten.map((f) => `<label class="mini"><input type="checkbox" data-gf="${esc(f.id)}" ${f.actief ? 'checked' : ''}> ${esc(f.label)} · € <input data-gp="${esc(f.id)}" class="kort" placeholder="prijs"></label>`).join('')}</div>
            <div><b class="mini">papiersoorten</b>${papiersoorten.map((x) => `<label class="mini"><input type="checkbox" data-gpa="${esc(x.id)}" ${x.actief ? 'checked' : ''}> ${esc(x.naam)}</label>`).join('')}</div>
            <div><button data-p="genereer">maak ontbrekende varianten</button><p class="mini">Bestaande combinaties blijven ongewijzigd.</p></div></div></details>
        <details style="margin-top:6px"><summary class="mini">posterhangers toevoegen</summary>
          <p class="mini">Prodigi-posterhanger: latten van massief hout boven en onder, magneetsluiting en ophangkoord in dezelfde kleur. Ze bedekken boven en onder tot 1,5 cm van de poster. Voor elk bestaand formaat zonder ophanging komt er per kleur een variant bij; die gebruikt het drukbestand van die poster.</p>
          <div class="genereer"><div><b class="mini">kleuren</b>${[['black', 'zwart'], ['natural', 'naturel'], ['white', 'wit']].map(([k, n]) => `<label class="mini"><input type="checkbox" data-hk="${k}" checked> ${n}</label>`).join('')}</div>
            <div><b class="mini">prijs incl. btw per formaat</b>${[...new Set(varianten.filter((v) => !v.lijst).map((v) => v.formaat_id))].map((f) => `<label class="mini">${esc(formaten.find((x) => x.id === f)?.label || f)} · € <input data-hp="${esc(f)}" class="kort" placeholder="prijs"></label>`).join('') || '<span class="mini">eerst een poster zonder ophanging aanmaken</span>'}</div>
            <div><button data-p="genereer-hangers">maak posterhanger-varianten</button><p class="mini">Daarna per variant "controleer bij Prodigi".</p></div></div></details>
      </div>`;
  }

  function variantDetail(v) {
    const pp = v.prodigi_product, k = v.kosten, d = v.drukbestand;
    const attr = Object.entries(v.prodigi_attributen || {}).map(([a, w]) => `${a}=${w}`).join('\n');
    return `<div class="vgrid">
      <div><h4>verkoop</h4>
        <label>verkoopprijs incl. btw<input data-v="prijs" value="${nl(v.prijs)}" class="kort"></label>
        <label>kostprijs excl. btw <span class="mini">(uit offerte of handmatig)</span><input data-v="kostprijs" value="${v.kostprijs == null ? '' : nl(v.kostprijs)}" class="kort"></label>
        <label>EAN<input data-v="ean" value="${esc(v.ean || '')}"></label>
        <label>productie (werkdagen)<input data-v="levertijd_productie_dagen" value="${esc(v.levertijd_productie_dagen)}" class="kort"></label>
        <label>verzending (werkdagen)<input data-v="levertijd_verzending_dagen" value="${esc(v.levertijd_verzending_dagen)}" class="kort"></label>
        <label class="rijtje">te koop <input type="checkbox" class="schakel" data-v="actief" ${v.actief ? 'checked' : ''}></label>
        <label class="rijtje">leverbaar zonder Prodigi <input type="checkbox" class="schakel" data-v="handmatig_leverbaar" ${v.handmatig_leverbaar ? 'checked' : ''}></label>
        <label>reden (verplicht bij handmatig)<input data-v="handmatig_reden" value="${esc(v.handmatig_reden || '')}" placeholder="bv. eigen drukker, proef goedgekeurd op …"></label>
        <div class="acties"><button class="vol" data-p="variant-opslaan">opslaan</button></div>
        ${v.ontbreekt.length ? `<ul class="ontbreekt">${v.ontbreekt.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '<p class="ok mini">Klaar voor verkoop.</p>'}
      </div>
      <div><h4>Prodigi</h4>
        <label>artikelcode<input data-v="prodigi_sku" value="${esc(v.prodigi_sku || '')}" placeholder="uit de Prodigi-catalogus"></label>
        <label>opties <span class="mini">(één per regel: naam=waarde)</span><textarea data-v="prodigi_attributen" rows="2">${esc(attr)}</textarea></label>
        <label>plaatsing op het papier<select data-v="sizing"><option value="fitPrintArea" ${v.sizing === 'fitPrintArea' ? 'selected' : ''}>passend (niets afsnijden, eventueel witte rand)</option><option value="fillPrintArea" ${v.sizing === 'fillPrintArea' ? 'selected' : ''}>vullend (kan afsnijden)</option></select></label>
        <label>verzendmethode<select data-v="verzendmethode">${huidig.verzendmethoden.map((m) => `<option ${m === v.verzendmethode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <div class="acties"><button data-p="variant-opslaan">opslaan</button><button data-p="prodigi-controle" ${v.prodigi_sku ? '' : 'disabled'}>controleer bij Prodigi</button><button data-p="offerte" ${v.prodigi_status === 'bevestigd' ? '' : 'disabled'}>kosten ophalen</button></div>
        <div class="mini" style="margin-top:6px">${v.prodigi_status === 'bevestigd' && pp ? `<span class="ok">Bevestigd</span> ${datum(v.prodigi_gecontroleerd_op)} (${esc(pp.omgeving || '')}): ${esc(pp.omschrijving || '')}<br>productiemaat ${pp.mm ? `${nl(pp.mm[0])} × ${nl(pp.mm[1])} mm` : 'onbekend'} · pixeleis ${pp.px ? `${pp.px.b} × ${pp.px.h}` : 'onbekend'} · levert in ${esc((pp.landen || []).slice(0, 12).join(', '))}${(pp.landen || []).length > 12 ? ' …' : ''}`
          : v.prodigi_status === 'ongeldig' ? `<span class="nok">Niet bevestigd: ${esc(v.prodigi_melding || '')}</span>` : 'Nog niet gecontroleerd. Een niet-bevestigd product wordt nergens als leverbaar getoond.'}</div>
        ${k ? `<div class="kosten"><b>Laatste offerte</b> ${datum(v.kosten_gecontroleerd_op)} (${esc(k.omgeving)}, ${esc(k.methode || '')} naar ${esc(k.land)}):<br>artikel ${bedrag(k.artikel)} · verzending ${bedrag(k.verzending)} · merk ${bedrag(k.merk)} · btw ${bedrag(k.btw)} · <b>totaal ${bedrag(k.totaal)}</b>
          ${k.vervoerder ? `<br>vervoerder ${esc(k.vervoerder)}${k.productielocatie ? ` · productie in ${esc(k.productielocatie)}` : ''}` : ''}
          ${(k.merk_gevraagd || []).length ? `<br>merktoevoegingen: ${k.merk_gevraagd.map((x) => `${esc(x)} ${(k.merk_geleverd || []).includes(x) ? '<span class="ok">✓ leverbaar</span>' : '<span class="nok">✗ niet leverbaar</span>'}`).join(' · ')}` : ''}</div>` : ''}
        <div class="acties" style="margin-top:8px"><button data-p="proef" ${v.prodigi_status === 'bevestigd' && d && (d.status !== 'afgekeurd' || v.qc_uitzondering) ? '' : 'disabled'} title="vraagt een bevestigd Prodigi-product en een goedgekeurd drukbestand">proefbestelling maken</button></div>
        <div class="proef" data-proef="${esc(v.sku)}"></div>
      </div>
      ${v.lijst ? `<div><h4>drukbestand <span class="mini">(privé)</span></h4>
        <p>Gebruikt het drukbestand van <b>${esc(v.basis_sku || 'de poster zonder ophanging')}</b>${d ? `: <span class="${d.status === 'ok' ? 'ok' : d.status === 'afgekeurd' ? 'nok' : ''}">${ERNST[d.status]} versie ${d.versie}</span>` : ' — <span class="nok">nog geen drukbestand</span>'}.</p>
        <p class="mini">Uploaden, controleren en uitzonderingen gaan bij die variant. De posterhanger bedekt boven en onder tot 1,5 cm: houd daar geen tekst of belangrijke details.</p></div></div>` : `<div><h4>drukbestand <span class="mini">(privé)</span></h4>
        ${d ? `<p><span class="${d.status === 'ok' ? 'ok' : d.status === 'afgekeurd' ? 'nok' : ''}">${ERNST[d.status]} versie ${d.versie} — ${d.status === 'ok' ? 'goedgekeurd' : d.status === 'afgekeurd' ? 'afgekeurd' : 'met waarschuwingen'}</span> <span class="mini">${esc(d.bestandsnaam || '')} · ${d.bytes ? mb(d.bytes) : ''} · ${datum(d.geupload_op)}</span></p>
          <ul class="controles">${(d.controles || []).map((c) => `<li class="${c.ernst}">${ERNST[c.ernst] || ''} ${esc(c.tekst)}</li>`).join('')}</ul>
          ${d.mime && d.mime.startsWith('image/') ? `<div class="uitsnede" data-uits="${esc(v.sku)}"><button data-p="toon-uitsnede">toon uitsnede op het papier</button></div>` : ''}
          ${d.status === 'afgekeurd' ? (v.qc_uitzondering ? `<p class="mini">Uitzondering bevestigd ${datum(v.qc_uitzondering_op)}: ${esc(v.qc_uitzondering)} <button data-p="uitzondering-weg">intrekken</button></p>`
            : `<label>gemotiveerde uitzondering<textarea data-v="uitzondering" rows="2" placeholder="Wat wijkt af en waarom is dat aanvaardbaar?"></textarea></label><div class="acties"><button data-p="uitzondering">uitzondering bevestigen</button></div>`) : ''}`
          : '<p class="nok">Nog geen drukbestand. Zonder goedgekeurd drukbestand is deze variant niet te koop.</p>'}
        <div class="acties" style="margin-top:8px"><button class="vol" data-p="druk-upload">${d ? 'nieuwe versie uploaden' : 'drukbestand uploaden'}</button>${d ? `<a href="/api/media?actie=druk&v=${d.id}" target="_blank" rel="noopener"><button>download</button></a><button data-p="herbeoordeel">opnieuw controleren</button>` : ''}</div>
        <div class="voortgang-upload" data-voortgang="${esc(v.sku)}"></div>
        ${v.versies.length > 1 ? `<details><summary class="mini">eerdere versies (${v.versies.length - 1})</summary>${v.versies.filter((x) => x.id !== d?.id).map((x) => `<div class="mini">v${x.versie} · ${ERNST[x.status]} · ${esc(x.bestandsnaam || '')} · ${datum(x.geupload_op)} <a href="/api/media?actie=druk&v=${x.id}" target="_blank" rel="noopener">download</a> <button data-p="versie-weg" data-versie="${x.id}">verwijder</button></div>`).join('')}</details>` : ''}
      </div></div>`}`;
  }

  const variantVan = (sku) => huidig.varianten.find((v) => v.sku === sku);
  function detailWaarden(tr) {
    const w = {};
    tr.querySelectorAll('[data-v]').forEach((i) => { w[i.dataset.v] = i.type === 'checkbox' ? i.checked : i.value; });
    if ('prodigi_attributen' in w) w.prodigi_attributen = Object.fromEntries(String(w.prodigi_attributen).split('\n').map((r) => r.split('=').map((x) => x.trim())).filter(([a, b]) => a && b));
    delete w.uitzondering;
    return w;
  }

  function proefFormulier(sku) {
    return `<div class="proefvak"><b>Proefbestelling</b> <span class="mini">eerst kosten en adres, daarna pas plaatsen</span>
      <div class="pform"><label>aantal<input data-pr="aantal" value="1" class="kort"></label><label>naam<input data-pr="naam"></label><label>straat + nr<input data-pr="straat"></label>
        <label>postcode<input data-pr="postcode" class="kort"></label><label>plaats<input data-pr="plaats"></label><label>land<input data-pr="land" value="NL" class="kort"></label>
        <label>e-mail (optioneel)<input data-pr="email"></label><label>verzendmethode<select data-pr="verzendmethode">${huidig.verzendmethoden.map((m) => `<option ${m === variantVan(sku).verzendmethode ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
      <div class="acties"><button data-p="proef-offerte">kosten opvragen</button><button data-p="proef-sluit">annuleren</button></div><div data-proefuit></div></div>`;
  }

  // ================= gebeurtenissen =================
  async function klik(e) {
    const tr = e.target.closest('tr[data-id]');
    if (tr && !huidig) return product(tr.dataset.id);
    const vrij = e.target.closest('tr.vrij');
    if (vrij && !e.target.closest('button,input,select,a')) { const s = vrij.dataset.sku; open_.has(s) ? open_.delete(s) : open_.add(s); return tekenProduct(); }
    const b = e.target.closest('[data-p]'); if (!b) return;
    const a = b.dataset.p, sku = e.target.closest('.vdetail')?.dataset.sku;
    try {
      if (a === 'terug') return overzicht();
      if (a === 'nieuw') {
        const titel = prompt('Verkooptitel van de nieuwe poster:'); if (!titel) return;
        const r = await capi('product', { nieuw: true, titel, status: 'concept' }); meld(r.melding); return product(r.id);
      }
      if (a === 'instellingen') { const d = $('#pInstellingen'); if (d.innerHTML) d.innerHTML = ''; else tekenInstellingen(); return; }
      if (a === 'formaat' || a === 'formaat-nieuw') { const t = b.closest('tr'); const w = rijWaarden(t); if (a === 'formaat') w.id = t.dataset.fid; else w.nieuw = true; const r = await capi('formaat', w); meld(r.melding); beheer = await capi('beheer'); tekenOverzicht(); tekenInstellingen(); return; }
      if (a === 'papier' || a === 'papier-nieuw') { const t = b.closest('tr'); const w = rijWaarden(t); if (a === 'papier') w.id = t.dataset.paid; else w.nieuw = true; const r = await capi('papier', w); meld(r.melding); beheer = await capi('beheer'); tekenOverzicht(); tekenInstellingen(); return; }
      if (a === 'wis-wachtrij') { wachtrij = []; return tekenWachtrij(); }
      if (a === 'upload-alles') return uploadAlles(b);
      const p = huidig?.product; if (!p) return;
      if (a === 'product-opslaan') {
        const w = { id: p.id }; doos().querySelectorAll('[data-g]').forEach((i) => { w[i.dataset.g] = i.value; });
        b.disabled = true; const r = await capi('product', w); meld(r.melding); return herlaad();
      }
      if (a === 'social') { b.disabled = true; try { await Social.vanProduct(p.id); } catch (x) { fout(x); b.disabled = false; } return; }
      if (a === 'hoofdbeeld') return kiesBestand('image/jpeg,image/png,image/webp', async (f) => {
        try { const [g, k] = await Promise.all([verklein(f, 2000), verklein(f, 600)]); const u = await capi('beeld-upload', { id: p.id, bytes: g.blob.size }); await put(u.url, g.blob, 'image/jpeg'); await put(u.url_klein, k.blob, 'image/jpeg'); meld((await capi('beeld-bevestig', { id: p.id, pad: u.pad, pad_klein: u.pad_klein })).melding); await herlaad(); } catch (x) { fout(x); }
      });
      if (a === 'beelden-toevoegen') return kiesBestand('image/jpeg,image/png,image/webp', async (files) => {
        const bezet = new Set(huidig.beelden.map((x) => x.positie)); let n = 0;
        for (const f of files) { let pos = 1; while (bezet.has(pos)) pos++; if (pos > 30) { meld('Maximaal 30 beelden per poster', true); break; } bezet.add(pos); meld(`Uploaden ${++n}/${files.length}…`); try { await uploadBeeld(f, p.id, pos); } catch (x) { fout(x); } }
        await herlaad();
      }, true);
      if (a === 'beeld-opslaan' || a === 'beeld-weg') {
        const bl = b.closest('.bl'), pos = Number(bl.dataset.pos);
        if (a === 'beeld-weg') { if (!confirm('Beeld verwijderen?')) return; await mapi('beeld-verwijder', { poster_id: p.id, positie: pos }); meld('Verwijderd'); return herlaad(); }
        const w = { poster_id: p.id, positie: pos }; bl.querySelectorAll('[data-b]').forEach((i) => { w[i.dataset.b] = i.value; });
        meld((await mapi('beeld-bijwerken', w)).melding); return herlaad();
      }
      if (a === 'genereer') {
        const formaten = [...doos().querySelectorAll('[data-gf]:checked')].map((i) => i.dataset.gf), papieren = [...doos().querySelectorAll('[data-gpa]:checked')].map((i) => i.dataset.gpa);
        const prijzen = Object.fromEntries([...doos().querySelectorAll('[data-gp]')].map((i) => [i.dataset.gp, i.value]));
        const r = await capi('varianten-genereren', { product_id: p.id, formaten, papieren, prijzen }); meld(r.melding); return herlaad();
      }
      if (a === 'genereer-hangers') {
        const kleuren = [...doos().querySelectorAll('[data-hk]:checked')].map((i) => i.dataset.hk);
        const prijzen = Object.fromEntries([...doos().querySelectorAll('[data-hp]')].map((i) => [i.dataset.hp, i.value]));
        const r = await capi('varianten-genereren', { product_id: p.id, alleen_hangers: true, hangers: { kleuren, prijzen } }); meld(r.melding); return herlaad();
      }
      if (a === 'sluit-variant' && sku) { open_.delete(sku); return tekenProduct(); }
      if (!sku) return;
      const det = b.closest('.vdetail');
      if (a === 'variant-opslaan') { b.disabled = true; meld((await capi('variant', { sku, ...detailWaarden(det) })).melding); return herlaad(); }
      if (a === 'prodigi-controle') { b.disabled = true; b.textContent = 'controleren…'; const r = await papi('product-controle', { sku }); meld(r.melding, r.status !== 'bevestigd'); return herlaad(); }
      if (a === 'offerte') { b.disabled = true; b.textContent = 'ophalen…'; meld((await papi('offerte', { sku })).melding); return herlaad(); }
      if (a === 'druk-upload') return kiesBestand('.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', async (f) => {
        const vg = det.querySelector(`[data-voortgang="${CSS.escape(sku)}"]`), url = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
        try {
          vg.innerHTML = '<div class="balkje"><i></i></div>';
          const r = await uploadDruk(f, sku, (x) => { vg.querySelector('i').style.width = x * 100 + '%'; });
          meld(r.melding, r.status === 'afgekeurd'); await herlaad();
          const m = url ? await meetBeeld(f) : null, v = variantVan(sku), box = doos().querySelector(`[data-uits="${CSS.escape(sku)}"]`);
          if (box && m?.breedte_px) box.innerHTML = uitsnede(url, m.breedte_px / m.hoogte_px, doelRatio(v), v.sizing, r.uitsnede);
        } catch (x) { fout(x); vg.innerHTML = ''; }
      });
      if (a === 'toon-uitsnede') {
        const v = variantVan(sku), d = v.drukbestand, box = b.parentElement;
        if (!d?.breedte_px) { box.innerHTML = '<span class="mini">Maten onbekend.</span>'; return; }
        const uits = (() => { const t = (d.controles || []).find((c) => c.code === 'verhouding' && c.ernst !== 'ok'); const m = t?.tekst.match(/([\d,.]+) mm (links en rechts|boven en onder)/); return m ? { mm: m[1].replace(',', '.'), zijde: m[2] } : null; })();
        box.innerHTML = uitsnede(`/api/media?actie=druk&v=${d.id}`, d.breedte_px / d.hoogte_px, doelRatio(v), v.sizing, uits) + '<p class="mini">Het originele bestand wordt geladen; bij grote bestanden kan dat even duren.</p>';
        return;
      }
      if (a === 'herbeoordeel') { const r = await mapi('druk-herbeoordeel', { sku }); meld(`Controle: ${r.status}`, r.status === 'afgekeurd'); return herlaad(); }
      if (a === 'versie-weg') { if (!confirm('Deze versie verwijderen?')) return; meld((await mapi('druk-verwijder', { versie_id: Number(b.dataset.versie) })).melding); return herlaad(); }
      if (a === 'uitzondering') {
        const reden = det.querySelector('[data-v="uitzondering"]').value;
        if (!confirm('Uitzondering bevestigen? De variant mag dan verkocht worden ondanks de afgekeurde controle.')) return;
        meld((await capi('uitzondering', { sku, reden })).melding); return herlaad();
      }
      if (a === 'uitzondering-weg') { meld((await capi('uitzondering-intrekken', { sku })).melding); return herlaad(); }
      if (a === 'proef') { det.querySelector(`[data-proef="${CSS.escape(sku)}"]`).innerHTML = proefFormulier(sku); return; }
      if (a === 'proef-sluit') { b.closest('.proef').innerHTML = ''; return; }
      if (a === 'proef-offerte') {
        const vak = b.closest('.proefvak'), w = {}; vak.querySelectorAll('[data-pr]').forEach((i) => { w[i.dataset.pr] = i.value; });
        b.disabled = true; b.textContent = 'opvragen…';
        const r = await papi('proef-offerte', { regels: [{ sku, aantal: Number(w.aantal) || 1 }], adres: w, verzendmethode: w.verzendmethode });
        const o = r.offerte, live = r.omgeving === 'live';
        vak.querySelector('[data-proefuit]').innerHTML = `<div class="kosten"><b>Kosten volgens Prodigi (${esc(r.omgeving)})</b><br>artikel ${bedrag(o.artikel)} · verzending ${bedrag(o.verzending)} · merk ${bedrag(o.merk)} · btw ${bedrag(o.btw)} · <b>totaal ${bedrag(o.totaal)}</b>
          ${o.vervoerder ? `<br>vervoerder ${esc(o.vervoerder)}` : ''}<br><b>Afleveradres</b>: ${esc(r.adres.naam)}, ${esc(r.adres.straat)}, ${esc(r.adres.postcode)} ${esc(r.adres.plaats)}, ${esc(r.adres.land)}
          <br><label class="mini"><input type="checkbox" data-proefok> ${live ? `Ik plaats een <b>betaalde</b> proefbestelling van ${bedrag(o.totaal)} bij Prodigi.` : 'Ik plaats een proefbestelling in de sandbox (er wordt niets gedrukt of betaald).'}</label>
          <div class="acties"><button class="vol" data-p="proef-plaatsen" data-proefid="${esc(r.id)}">proefbestelling plaatsen</button></div><p class="mini">Deze offerte is 30 minuten geldig.</p></div>`;
        b.disabled = false; b.textContent = 'kosten opnieuw opvragen'; return;
      }
      if (a === 'proef-plaatsen') {
        const vak = b.closest('.proefvak');
        if (!vak.querySelector('[data-proefok]').checked) return meld('Vink eerst aan dat je de kosten en het adres hebt gecontroleerd.', true);
        b.disabled = true; const r = await papi('proef-plaatsen', { id: b.dataset.proefid, bevestigd: true });
        vak.innerHTML = `<p class="ok">${esc(r.melding)}</p>`; meld(r.melding); return;
      }
    } catch (x) { fout(x); if (b.tagName === 'BUTTON') b.disabled = false; }
  }

  function koppel() {
    const d = doos();
    if (d.dataset.gekoppeld) return; d.dataset.gekoppeld = '1';
    d.addEventListener('click', klik);
    d.addEventListener('input', (e) => {
      if (e.target.id === 'pZoek') { zoek = e.target.value; clearTimeout(d._t); d._t = setTimeout(() => { const pos = e.target.selectionStart; tekenOverzicht(); const z = $('#pZoek'); z.focus(); z.setSelectionRange(pos, pos); }, 200); }
      const t = e.target.dataset.g && d.querySelector(`[data-teller="${e.target.dataset.g}"]`); if (t) t.textContent = `${e.target.value.length}/${e.target.maxLength}`;
    });
    d.addEventListener('change', (e) => { if (e.target.id === 'pStatus') { statusFilter = e.target.value; tekenOverzicht(); } if (e.target.id === 'pDropInput') { nieuweBestanden(e.target.files); e.target.value = ''; } });
    d.addEventListener('dragover', (e) => { const z = e.target.closest('#pDrop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
    d.addEventListener('dragleave', (e) => { e.target.closest('#pDrop')?.classList.remove('over'); });
    d.addEventListener('drop', (e) => { const z = e.target.closest('#pDrop'); if (z) { e.preventDefault(); z.classList.remove('over'); nieuweBestanden(e.dataTransfer.files); } });
  }

  return {
    open() { koppel(); const h = decodeURIComponent(location.hash.slice(1)); return h.startsWith('product/') ? product(h.slice(8)) : overzicht(); },
    product(id) { koppel(); return product(id); },
    // voor tests
    _uitsnede: uitsnede,
  };
})();
