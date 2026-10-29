/* Beheer → verkoopkanalen: per product aanvinken op welk kanaal het verschijnt, met sjablonen, afwijkingen
   en prijsregels. Alleen kanalen met een echte koppeling zijn aan te vinken; de rest staat er eerlijk bij.
   Gebruikt de helpers uit admin.html ($, esc, euro, datum, meld, toonLogin). */
const Verkoop = (() => {
  const doos = () => $('#verkoop');
  let data = null, open_ = null, zoek = '', filter = '', sjOpen = null;
  const KOLOMMEN = ['webshop', 'etsy'];
  const ST = { niet_gepubliceerd: 'Niet gepubliceerd', onvolledig: 'Onvolledig', gereed: 'Gereed', verwerken: 'Wordt verwerkt', actief: 'Actief', fout: 'Fout' };
  const BESCHIKBAAR = { eigen: '<span class="ok">altijd beschikbaar</span>', koppeling: '', 'per-variant': 'per variant via Koppelingen', 'niet-beschikbaar': '<span class="nok">geen koppeling</span>', elders: 'via Koppelingen' };
  const REGEL = { basis: 'zelfde als basisprijs', vast: 'basisprijs + vast bedrag', procent: 'basisprijs + percentage', handmatig: 'handmatig per variant' };

  async function vraag(actie, body) {
    const r = await fetch(`/api/kanalen?actie=${actie}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ ok: false, melding: 'Onverwacht antwoord van de server.' }));
    if (r.status === 401) { toonLogin(); throw new Error('uit'); }
    if (!j.ok) throw new Error(j.melding || j.info || 'Mislukt');
    return j;
  }
  const fout = (e) => { if (e.message !== 'uit') meld(e.message, true); };

  async function laad() {
    try { data = await vraag('publicatie'); teken(); }
    catch (e) { if (e.message !== 'uit') doos().innerHTML = `<div class="leeg">${esc(e.message)}</div>`; }
  }

  const chip = (s) => `<span class="pchip ${esc(s)}">${esc(ST[s] || s)}</span>`;
  function cel(p, k) {
    const c = p.kanalen[k];
    const knop = k === 'etsy' && c.publiceren && ['gereed', 'fout'].includes(c.status)
      ? `<button data-publiceer="${esc(p.id)}">${c.extern_url ? 'bijwerken' : 'aanmaken'}</button>` : '';
    const offline = k === 'etsy' && !c.publiceren && c.extern_url && c.status === 'gereed' ? `<button data-publiceer="${esc(p.id)}">offline halen</button>` : '';
    return `<td><label class="pcel"><input type="checkbox" class="schakel" data-zet="${esc(p.id)}|${k}" ${c.publiceren ? 'checked' : ''}>${chip(c.status)}</label>
      ${c.melding ? `<div class="mini ${c.status === 'fout' || c.status === 'onvolledig' ? 'nok' : ''}">${esc(c.melding)}</div>` : ''}
      <div class="mini">${c.extern_url ? `<a href="${esc(c.extern_url)}" target="_blank" rel="noopener">bekijk ↗</a>` : ''}${c.laatste_sync_op ? ` · gesynchroniseerd ${datum(c.laatste_sync_op)}` : ''}</div>
      ${knop || offline ? `<div class="acties" style="margin-top:4px">${knop}${offline}</div>` : ''}</td>`;
  }

  function teken() {
    const { producten, kanalen, sjablonen, etsyGekoppeld } = data;
    const telling = (k) => { const t = {}; producten.forEach((p) => { const s = p.kanalen[k].status; t[s] = (t[s] || 0) + 1; }); return t; };
    const lijst = producten.filter((p) => (!zoek || `${p.titel} ${p.code} ${p.id}`.toLowerCase().includes(zoek))
      && (!filter || KOLOMMEN.some((k) => p.kanalen[k].status === filter)));
    doos().innerHTML = `
      <div class="kanalen" style="margin-bottom:14px">${Object.entries(kanalen).map(([k, i]) => {
        const t = KOLOMMEN.includes(k) ? telling(k) : null;
        return `<div class="kanaal"><h3>${esc(i.naam)} <span class="mini">${k === 'etsy' ? (etsyGekoppeld ? '<span class="ok">gekoppeld</span>' : '<span class="nok">nog niet gekoppeld</span>') : BESCHIKBAAR[i.soort] || ''}</span></h3>
          <p class="mini">${esc(i.uitleg)}</p>
          ${t ? `<p class="mini" style="margin-top:6px">${Object.entries(t).map(([s, n]) => `${n} ${esc((ST[s] || s).toLowerCase())}`).join(' · ')}</p>` : ''}</div>`;
      }).join('')}</div>
      <div class="balk"><b style="margin-right:8px">producten per kanaal</b>
        <input type="search" id="vkZoek" placeholder="zoek poster of code" value="${esc(zoek)}">
        <select id="vkFilter"><option value="">alle statussen</option>${Object.entries(ST).map(([s, l]) => `<option value="${s}" ${s === filter ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="mini">Vink aan waar een poster moet verschijnen. Etsy: "aanmaken" maakt een nieuwe advertentie, "bijwerken" past de bestaande aan; een bestaande advertentie wordt nooit dubbel aangemaakt.</span></div>
      <div class="schuif"><table class="ptabel" style="min-width:640px"><thead><tr><th>poster</th>${KOLOMMEN.map((k) => `<th>${esc(kanalen[k].naam)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${lijst.map((p) => `<tr class="${open_ === p.id ? 'open' : ''}"><td><b>${esc(p.titel)}</b><div class="mini">${esc(p.code || p.id)} · ${esc(p.status || '')}</div></td>${KOLOMMEN.map((k) => cel(p, k)).join('')}
        <td><button data-open="${esc(p.id)}">${open_ === p.id ? 'sluiten' : 'instellingen'}</button></td></tr>
        ${open_ === p.id ? `<tr class="pdetail"><td colspan="${KOLOMMEN.length + 2}">${detail(p)}</td></tr>` : ''}`).join('') || `<tr><td colspan="4" class="leeg">Geen posters gevonden.</td></tr>`}
      </tbody></table></div>
      <div class="blok" style="margin-top:18px"><h3>sjablonen</h3>
        <p class="mini" style="margin-bottom:8px">Herbruikbare kanaalinstellingen. Volgorde: kanaalinstellingen &lt; sjabloon &lt; afwijkingen per product. Een product zonder eigen sjabloon gebruikt het standaardsjabloon van het kanaal.</p>
        <table class="kaal"><thead><tr><th>kanaal</th><th>naam</th><th>prijsregel</th><th></th></tr></thead><tbody>
        ${sjablonen.map((s) => `<tr><td>${esc(kanalen[s.kanaal]?.naam || s.kanaal)}</td><td>${esc(s.naam)}${s.standaard ? ' <span class="mini ok">standaard</span>' : ''}</td><td class="mini">${regelTekst(s.waarden?.prijsregel)}</td><td><button data-sj="${s.id}">bewerken</button></td></tr>`).join('') || '<tr><td colspan="4" class="mini">Nog geen sjablonen.</td></tr>'}
        </tbody></table>
        <div class="acties" style="margin-top:8px"><button data-sj="nieuw">nieuw sjabloon</button></div>
        ${sjOpen ? sjabloonForm(sjOpen === 'nieuw' ? { kanaal: 'etsy', naam: '', waarden: {} } : sjablonen.find((s) => s.id === sjOpen)) : ''}
      </div>`;
  }

  function regelTekst(r) {
    if (!r) return 'kanaalinstelling';
    const w = r.waarde != null ? String(r.waarde).replace('.', ',') : '';
    return `${REGEL[r.type] || r.type}${r.type === 'vast' ? ` (${euro(r.waarde)})` : r.type === 'procent' ? ` (${w}%)` : ''}${r.afronden_95 ? ', afgerond op ,95' : ''}`;
  }
  function regelVelden(r, varianten) {
    r = r || {};
    return `<label>prijsregel<select data-r="type"><option value="">— kanaal/sjabloon —</option>${Object.entries(REGEL).map(([k, l]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>waarde (€ of %)<input data-r="waarde" inputmode="decimal" value="${esc(r.waarde ?? '')}"></label>
      <label class="rijtje">afronden op ,95<input type="checkbox" class="schakel" data-r="afronden_95" ${r.afronden_95 ? 'checked' : ''}></label>
      ${varianten?.length ? `<div class="breed mini">handmatig per variant:</div>${varianten.map((v) => `<label>${esc(v.sku)}<input data-hand="${esc(v.sku)}" inputmode="decimal" value="${esc(r.prijzen?.[v.sku] ?? '')}"></label>`).join('')}` : ''}`;
  }
  function leesRegel(vak) {
    const type = vak.querySelector('[data-r=type]').value;
    if (!type) return null;
    const r = { type, waarde: vak.querySelector('[data-r=waarde]').value, afronden_95: vak.querySelector('[data-r=afronden_95]').checked };
    if (type === 'handmatig') { r.prijzen = {}; vak.querySelectorAll('[data-hand]').forEach((i) => { if (i.value) r.prijzen[i.dataset.hand] = i.value; }); }
    return r;
  }

  function detail(p) {
    const c = p.kanalen.etsy, a = c.afwijkingen || {};
    const sjs = data.sjablonen.filter((s) => s.kanaal === 'etsy');
    return `<div class="vdetail" data-detail="${esc(p.id)}">
      <h4 style="margin-bottom:8px">Etsy · afwijkingen voor ${esc(p.titel)}</h4>
      <p class="mini" style="margin-bottom:8px">Leeg = de centrale productgegevens en het sjabloon gelden. Opslaan zet de advertentie op "Gereed" als er iets verandert; publiceren gebeurt met de knop of automatisch (Koppelingen → Etsy → automatisch publiceren).</p>
      <div class="pform">
        <label>sjabloon<select data-a="sjabloon_id"><option value="">standaard${sjs.find((s) => s.standaard) ? ` (${esc(sjs.find((s) => s.standaard).naam)})` : ''}</option>${sjs.map((s) => `<option value="${s.id}" ${c.sjabloon_id === s.id ? 'selected' : ''}>${esc(s.naam)}</option>`).join('')}</select></label>
        <label>taal<select data-a="taal"><option value="">— sjabloon —</option>${['en', 'nl', 'de', 'fr'].map((t) => `<option ${a.taal === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>categorie (taxonomy-id)<input data-a="categorie" value="${esc(a.categorie || '')}"></label>
        <label class="breed">titel (max. 140)<input data-a="titel" maxlength="140" value="${esc(a.titel || '')}" placeholder="${esc(p.titel)}"></label>
        <label class="breed">beschrijving<textarea data-a="beschrijving" rows="4">${esc(a.beschrijving || '')}</textarea></label>
        <label class="breed">tags (komma's, max. 13)<input data-a="tags" value="${esc((a.tags || []).join(', '))}"></label>
        <label>foto's (posities, bv. 0,1,3; 0 = hoofdbeeld)<input data-a="fotos" value="${esc((a.fotos || []).join(','))}"></label>
        ${regelVelden(a.prijsregel, c.prijzen)}
      </div>
      ${c.prijzen?.length ? `<table class="kaal" style="margin-top:8px"><thead><tr><th>variant</th><th>formaat</th><th>papier</th><th class="r">prijs op Etsy</th></tr></thead><tbody>${c.prijzen.map((v) => `<tr><td>${esc(v.sku)}</td><td>${esc(v.formaat)}</td><td>${esc(v.papier)}</td><td class="r">${v.prijs == null ? '<span class="nok">ontbreekt</span>' : euro(v.prijs)}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="acties" style="margin-top:10px"><button class="vol" data-bewaar="${esc(p.id)}">opslaan</button></div></div>`;
  }

  function sjabloonForm(s) {
    if (!s) return '';
    const w = s.waarden || {};
    return `<div class="vdetail" data-sjform="${s.id || ''}"><div class="pform">
      <label>kanaal<select data-s="kanaal" ${s.id ? 'disabled' : ''}>${KOLOMMEN.filter((k) => k !== 'webshop').map((k) => `<option value="${k}" ${s.kanaal === k ? 'selected' : ''}>${esc(data.kanalen[k].naam)}</option>`).join('')}</select></label>
      <label>naam<input data-s="naam" value="${esc(s.naam || '')}"></label>
      <label class="rijtje">standaard voor dit kanaal<input type="checkbox" class="schakel" data-s="standaard" ${s.standaard ? 'checked' : ''}></label>
      <label>taal<select data-s="taal"><option value="">en (standaard)</option>${['en', 'nl', 'de', 'fr'].map((t) => `<option ${w.taal === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>categorie (taxonomy-id)<input data-s="categorie" value="${esc(w.categorie || '')}"></label>
      <label>voorraad tonen<input data-s="voorraad" inputmode="numeric" value="${esc(w.voorraad || '')}"></label>
      <label>verzendprofiel-id<input data-s="verzendprofiel_id" value="${esc(w.verzendprofiel_id || '')}"></label>
      <label>verwerkingsprofiel-id<input data-s="verwerkingsprofiel_id" value="${esc(w.verwerkingsprofiel_id || '')}"></label>
      <label>retourbeleid-id<input data-s="retourbeleid_id" value="${esc(w.retourbeleid_id || '')}"></label>
      <label>achter de titel<input data-s="titel_achtervoegsel" value="${esc(w.titel_achtervoegsel || '')}" placeholder="bv. Art Print, Wall Decor"></label>
      <label>tags (komma's)<input data-s="tags" value="${esc((w.tags || []).join(', '))}"></label>
      <label class="breed">onder elke beschrijving<textarea data-s="beschrijving_toevoeging" rows="3">${esc(w.beschrijving_toevoeging || '')}</textarea></label>
      ${regelVelden(w.prijsregel)}
    </div><div class="acties" style="margin-top:10px"><button class="vol" data-sjbewaar>opslaan</button><button data-sj="">annuleren</button></div></div>`;
  }

  const lijstVan = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

  function koppel() {
    const d = doos();
    d.addEventListener('input', (e) => {
      if (e.target.id === 'vkZoek') { zoek = e.target.value.toLowerCase(); const pos = e.target.selectionStart; teken(); const z = $('#vkZoek'); z.focus(); z.setSelectionRange(pos, pos); }
    });
    d.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.id === 'vkFilter') { filter = t.value; return teken(); }
      if (t.dataset.zet) {
        const [product_id, kanaal] = t.dataset.zet.split('|');
        if (kanaal === 'etsy' && !t.checked && !confirm('Niet meer op Etsy aanbieden? Een bestaande advertentie wordt bij de volgende publicatie offline gehaald (niet verwijderd).')) { t.checked = true; return; }
        if (kanaal === 'webshop' && !t.checked && !confirm('Deze poster uit de webshop halen?')) { t.checked = true; return; }
        try { await vraag('publicatie-zet', { product_id, kanaal, publiceren: t.checked }); meld('Opgeslagen'); laad(); }
        catch (x) { fout(x); t.checked = !t.checked; }
      }
    });
    d.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-open]');
      if (o) { open_ = open_ === o.dataset.open ? null : o.dataset.open; return teken(); }
      const pb = e.target.closest('[data-publiceer]');
      if (pb) {
        const p = data.producten.find((x) => x.id === pb.dataset.publiceer), c = p.kanalen.etsy;
        const wat = !c.publiceren ? 'offline halen' : c.extern_url ? 'bijwerken' : 'als nieuwe advertentie aanmaken';
        if (!confirm(`${p.titel} op Etsy ${wat}?`)) return;
        pb.disabled = true; pb.textContent = 'bezig…';
        try { const r = await vraag('publiceer', { product_id: p.id, kanaal: 'etsy' }); meld(r.melding || 'Verwerkt'); }
        catch (x) { fout(x); }
        return laad();
      }
      const bw = e.target.closest('[data-bewaar]');
      if (bw) {
        const vak = bw.closest('[data-detail]'), g = (k) => vak.querySelector(`[data-a=${k}]`).value.trim();
        const afwijkingen = { titel: g('titel'), beschrijving: g('beschrijving'), taal: g('taal'), categorie: g('categorie'), tags: lijstVan(g('tags')),
          fotos: lijstVan(g('fotos')).map(Number), prijsregel: leesRegel(vak) };
        bw.disabled = true;
        try { await vraag('publicatie-zet', { product_id: bw.dataset.bewaar, kanaal: 'etsy', sjabloon_id: g('sjabloon_id') || null, afwijkingen }); meld('Afwijkingen opgeslagen'); laad(); }
        catch (x) { fout(x); bw.disabled = false; }
        return;
      }
      const sj = e.target.closest('[data-sj]');
      if (sj) { sjOpen = sj.dataset.sj === 'nieuw' ? 'nieuw' : sj.dataset.sj ? Number(sj.dataset.sj) : null; return teken(); }
      const sb = e.target.closest('[data-sjbewaar]');
      if (sb) {
        const vak = sb.closest('[data-sjform]'), g = (k) => { const i = vak.querySelector(`[data-s=${k}]`); return i.type === 'checkbox' ? i.checked : i.value.trim(); };
        const body = { id: vak.dataset.sjform ? Number(vak.dataset.sjform) : undefined, kanaal: g('kanaal'), naam: g('naam'), standaard: g('standaard'),
          waarden: { taal: g('taal'), categorie: g('categorie'), voorraad: g('voorraad'), verzendprofiel_id: g('verzendprofiel_id'), verwerkingsprofiel_id: g('verwerkingsprofiel_id'),
            retourbeleid_id: g('retourbeleid_id'), titel_achtervoegsel: g('titel_achtervoegsel'), beschrijving_toevoeging: g('beschrijving_toevoeging'), tags: lijstVan(g('tags')), prijsregel: leesRegel(vak) } };
        sb.disabled = true;
        try { const r = await vraag('sjabloon', body); meld(r.melding); sjOpen = null; laad(); }
        catch (x) { fout(x); sb.disabled = false; }
      }
    });
  }
  let gekoppeld = false;
  return { open() { if (!gekoppeld) { koppel(); gekoppeld = true; } laad(); } };
})();
