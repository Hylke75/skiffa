/* Beheer → dashboard: actielijst bovenaan, daaronder cijfers over een periode.
   Alleen echte bestellingen; marges zijn werkelijk (Prodigi-facturen) of een gemarkeerde schatting.
   Gebruikt de helpers uit admin.html ($, esc, euro, datum, meld, toonLogin, api, papi, open, toonView). */
const Dashboard = (() => {
  const doos = () => $('#dashboard');
  let van = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), tot = new Date().toISOString().slice(0, 10);
  const ERNST = { hoog: 'nok', middel: '', info: 'mini', laag: 'mini' };
  const KNAAM = { webshop: 'webshop', bol: 'bol.com', etsy: 'Etsy', amazon: 'Amazon', ebay: 'eBay', tiktok: 'TikTok Shop' };
  const fout = (e) => { if (e.message !== 'uit') meld(e.message, true); };

  async function laad() {
    doos().innerHTML = '<div class="leeg">laden…</div>';
    try {
      const [a, d] = await Promise.all([api('actielijst'), api('dashboard', { params: { van, tot } })]);
      teken(a, d);
    } catch (e) { if (e.message !== 'uit') doos().innerHTML = `<div class="leeg">${esc(e.message)}</div>`; }
  }

  function actieKnoppen(x) {
    return (x.acties || []).map((k) => ({
      open: x.bestelling?.id ? `<button data-dopen="${esc(x.bestelling.id)}">open ${esc(x.bestelling.nummer || '')}</button>` : '',
      'prodigi-opnieuw': x.bestelling?.id ? `<button data-dprodigi="${esc(x.bestelling.id)}">opnieuw proberen</button>` : '',
      'zending-opnieuw': `<button data-dzending="${esc(x.zending_id)}">opnieuw doorgeven</button>`,
      verkoopkanalen: '<button data-dview="verkoop">naar verkoopkanalen</button>',
      koppelingen: '<button data-dview="kanalen">naar koppelingen</button>',
      afvinken: `<button data-dafvink="${esc(x.sleutel)}">afvinken</button>`,
    })[k] || '').join('');
  }

  function balken(rijen, veld, fmt) {
    const max = Math.max(...rijen.map((r) => r[veld]), 0);
    return rijen.map((r) => `<tr><td>${esc(r.naam)}</td><td style="width:45%"><div class="dbalk"><i style="width:${max ? Math.max(2, (r[veld] / max) * 100) : 0}%"></i></div></td><td class="r">${fmt(r[veld])}</td></tr>`).join('');
  }

  function teken(a, d) {
    const t = d.totaal, kanalen = Object.entries(d.perKanaal), dagen = Object.entries(d.perDag).sort();
    const leeg = !t.bestellingen;
    const pop = (titel, rijen) => `<div class="blok"><h3>${titel}</h3>${rijen.length ? `<table class="kaal">${balken(rijen, 'stuks', (v) => `${v}×`)}</table>` : '<p class="mini">Nog geen verkopen in deze periode.</p>'}</div>`;
    doos().innerHTML = `
      <div class="blok"><h3>actielijst ${a.acties.length ? `(${a.acties.length})` : ''}</h3>
        ${a.acties.length ? `<div class="dacties">${a.acties.map((x) => `<div class="dactie ${x.ernst}"><div><b class="${ERNST[x.ernst]}">${esc(x.titel)}</b>${x.tekst ? `<div class="mini">${esc(x.tekst)}</div>` : ''}<div class="mini">${esc(x.soort)}</div></div><div class="acties">${actieKnoppen(x)}</div></div>`).join('')}</div>`
          : '<p class="ok">Niets dat nu aandacht vraagt.</p>'}
        ${a.afgevinkt ? `<p class="mini" style="margin-top:6px">${a.afgevinkt} afgevinkte melding${a.afgevinkt > 1 ? 'en' : ''} verborgen (komen terug als er iets verandert).</p>` : ''}</div>
      <div class="balk" style="margin-top:14px"><b style="margin-right:8px">cijfers</b>
        <label>van <input type="date" id="dVan" value="${van}"></label><label>tot <input type="date" id="dTot" value="${tot}"></label>
        <button data-dperiode="7">7 dagen</button><button data-dperiode="30">30 dagen</button><button data-dperiode="365">jaar</button></div>
      <div class="kaarten">
        <div class="kaart"><small>bestellingen</small><b>${t.bestellingen}</b><div class="mini">${t.stuks} posters</div></div>
        <div class="kaart"><small>omzet excl. btw</small><b>${euro(t.omzet_ex_btw)}</b>${t.terugbetaald ? `<div class=\"mini\">na ${euro(t.terugbetaald)} terugbetaald</div>` : ''}</div>
        <div class="kaart"><small>productiekosten</small><b>${euro(t.kosten)}</b><div class="mini">${t.met_werkelijke_kosten} werkelijk · ${t.met_schatting} geschat${t.zonder_kosten ? ` · <span class="nok">${t.zonder_kosten} onbekend</span>` : ''}</div></div>
        <div class="kaart"><small>resultaat na productie</small><b>${euro(t.marge)}</b><div class="mini">${t.omzet_ex_btw ? `${Math.round((t.marge / t.omzet_ex_btw) * 100)}% van de omzet` : ''}${t.met_schatting ? ' · deels geschat' : ''}</div></div>
        <div class="kaart"><small>wacht op verzending</small><b>${d.wachtend}</b></div>
        <div class="kaart"><small>publicatiefouten</small><b class="${d.publicatieFouten ? 'nok' : ''}">${d.publicatieFouten}</b></div>
      </div>
      ${leeg ? '<div class="leeg">Geen betaalde bestellingen in deze periode. Er worden geen cijfers verzonnen.</div>' : `
      <div class="dgrid">
        <div class="blok"><h3>per kanaal</h3><table class="kaal"><thead><tr><th>kanaal</th><th class="r">bestellingen</th><th class="r">omzet excl. btw</th><th class="r">na productie</th></tr></thead><tbody>
          ${kanalen.map(([k, x]) => `<tr><td>${esc(KNAAM[k] || k)}</td><td class="r">${x.bestellingen}</td><td class="r">${euro(x.omzet_ex_btw)}</td><td class="r">${euro(x.marge)}</td></tr>`).join('')}</tbody></table></div>
        <div class="blok"><h3>omzet per dag</h3><table class="kaal">${balken(dagen.map(([dag, x]) => ({ naam: dag.split('-').reverse().slice(0, 2).join('-'), omzet: x.omzet_ex_btw })), 'omzet', euro)}</table></div>
        ${pop('populaire ontwerpen', d.populair.ontwerpen)}${pop('formaten', d.populair.formaten)}${pop('papier', d.populair.papieren)}
      </div>`}
      <div class="blok"><h3>hoe dit is berekend</h3><ul class="mini" style="margin-left:16px">${d.aannames.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }

  function koppel() {
    const d = doos();
    d.addEventListener('change', (e) => {
      if (e.target.id === 'dVan' || e.target.id === 'dTot') { van = $('#dVan').value || van; tot = $('#dTot').value || tot; laad(); }
    });
    d.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dperiode) { van = new Date(Date.now() - Number(b.dataset.dperiode) * 864e5).toISOString().slice(0, 10); tot = new Date().toISOString().slice(0, 10); return laad(); }
      if (b.dataset.dopen) return open(b.dataset.dopen);
      if (b.dataset.dview) return toonView(b.dataset.dview);
      b.disabled = true;
      try {
        if (b.dataset.dprodigi) { const r = await papi('opnieuw', { id: b.dataset.dprodigi }); meld(r.melding || 'Opnieuw ingepland'); }
        if (b.dataset.dzending) { const r = await api('zending-opnieuw', { method: 'POST', body: { zending_id: Number(b.dataset.dzending) } }); meld(r.melding); }
        if (b.dataset.dafvink) { const notitie = prompt('Notitie (optioneel), bv. "klant gebeld":'); if (notitie === null) { b.disabled = false; return; } await api('afvinken', { method: 'POST', body: { sleutel: b.dataset.dafvink, notitie } }); meld('Afgevinkt'); }
        laad();
      } catch (x) { fout(x); b.disabled = false; }
    });
  }
  let gekoppeld = false;
  return { open() { if (!gekoppeld) { koppel(); gekoppeld = true; } laad(); } };
})();
