/* Beheer → koppelingen: TikTok Shop-producten (concepten) en de Meta-productfeed.
   Eerlijk over wat ontbreekt: zonder sleutels of koppeling staat er wat er nodig is, niet een schijnsucces.
   Gebruikt de helpers uit admin.html ($, esc, datum, meld, kapi). */
const Feeds = (() => {
  const PST = { niet_gepubliceerd: 'niet in TikTok', onvolledig: 'onvolledig', gereed: 'concept in TikTok', verwerken: 'wordt beoordeeld', actief: 'actief', fout: 'fout' };
  const RV = { onbekend: 'onbekend', goedgekeurd: 'goedgekeurd', afgekeurd: 'afgekeurd', ingediend: 'in beoordeling', verouderd: 'verouderd' };
  let metaFilter = 'problemen';
  const fout = (e) => { if (e.message !== 'uit') meld(e.message, true); };

  async function tiktok() {
    const d = $('#tiktokProducten');
    try {
      const r = await kapi('tiktok-producten');
      d.innerHTML = `<div class="blok"><h3>TikTok Shop · producten</h3>
        <p class="mini" style="margin-bottom:8px">SKIFFA maakt een <b>concept</b> aan (met beelden, varianten en prijzen). Afronden en indienen doe je in TikTok Seller Center; daarna volgt SKIFFA de beoordeling. Wijzigingen na indienen voer je in Seller Center door.</p>
        <div class="schuif"><table class="kaal" style="min-width:560px"><thead><tr><th>poster</th><th>status</th><th></th></tr></thead><tbody>
        ${r.producten.map((p) => `<tr><td><b>${esc(p.titel)}</b><div class="mini">${esc(p.code || p.id)}</div></td>
          <td><span class="pchip ${esc(p.status)}">${esc(PST[p.status] || p.status)}</span>${p.melding ? `<div class="mini ${p.status === 'fout' ? 'nok' : ''}">${esc(p.melding)}</div>` : ''}${!p.extern_id && p.ontbreekt.length ? `<div class="mini nok">${p.ontbreekt.map(esc).join('; ')}</div>` : ''}</td>
          <td class="acties">${p.extern_id ? `<button data-tt="status" data-id="${esc(p.id)}">status bijwerken</button>` : `<button data-tt="concept" data-id="${esc(p.id)}" ${p.ontbreekt.length ? 'disabled' : ''}>concept aanmaken</button>`}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    } catch (e) { d.innerHTML = e.message === 'uit' ? '' : `<div class="blok"><h3>TikTok Shop · producten</h3><p class="mini">${esc(e.message)}</p></div>`; }
  }

  async function meta() {
    const d = $('#metaFeed');
    try {
      const r = await kapi('meta-overzicht');
      const t = r.tellingen;
      const lijst = r.items.filter((i) => metaFilter === 'alles' || (metaFilter === 'problemen' ? i.opnemen && (i.ontbreekt.length || i.review === 'afgekeurd') : !i.opnemen));
      d.innerHTML = `<div class="blok"><h3>Meta-productfeed (Facebook / Instagram)</h3>
        <p class="mini">Feed-URL voor Commerce Manager → Catalogus → Gegevensbronnen → Gegevensfeed (gepland, bv. dagelijks):</p>
        <p style="margin:4px 0 8px"><code style="word-break:break-all">${esc(r.feed_url)}</code> <button data-mf="kopieer">kopieer</button></p>
        ${r.waarschuwingen.map((w) => `<div class="waarschuw" style="margin-bottom:6px">${esc(w)}</div>`).join('')}
        <p class="mini">${t.in_feed} in de feed · ${t.onvolledig} onvolledig · ${t.uitgesloten} uitgesloten${r.token ? ` · ${t.goedgekeurd} goedgekeurd · ${t.afgekeurd} afgekeurd` : ' · goedkeuring: zet META_TOKEN en META_CATALOG_ID in Vercel, of kijk in Commerce Manager'}</p>
        <p class="mini">laatst opgehaald: ${r.laatst_opgehaald ? datum(r.laatst_opgehaald) : 'nog nooit'} · door Meta: ${r.laatst_door_meta ? datum(r.laatst_door_meta) : 'nog nooit'}</p>
        <div class="acties" style="margin:8px 0"><button data-mf="bereikbaar">controleer bereikbaarheid</button>${r.token ? '<button data-mf="review">goedkeuring ophalen</button>' : ''}
          <select data-mf="filter"><option value="problemen" ${metaFilter === 'problemen' ? 'selected' : ''}>met problemen</option><option value="alles" ${metaFilter === 'alles' ? 'selected' : ''}>alle varianten</option><option value="uit" ${metaFilter === 'uit' ? 'selected' : ''}>uitgesloten</option></select></div>
        <p class="mini">Alleen complete varianten gaan de feed in. Afrekenen gebeurt op skiffa.store (Meta biedt geen afrekenen op Facebook/Instagram meer).</p>
        ${lijst.length ? `<div class="schuif"><table class="kaal" style="min-width:560px"><thead><tr><th>variant</th><th>in feed</th><th>ontbreekt / Meta</th></tr></thead><tbody>
          ${lijst.slice(0, 40).map((i) => `<tr><td><b>${esc(i.title)}</b><div class="mini">${esc(i.id)} · ${esc(i.price)}</div></td>
            <td><input type="checkbox" class="schakel" data-mopn="${esc(i.id)}" ${i.opnemen ? 'checked' : ''}></td>
            <td class="mini">${i.ontbreekt.length ? `<span class="nok">${i.ontbreekt.map(esc).join('; ')}</span>` : '<span class="ok">compleet</span>'}${i.review !== 'onbekend' ? ` · Meta: ${esc(RV[i.review] || i.review)}` : ''}${i.meldingen.length ? `<div class="nok">${i.meldingen.map(esc).join('; ')}</div>` : ''}</td></tr>`).join('')}
        </tbody></table></div>${lijst.length > 40 ? `<p class="mini">… en nog ${lijst.length - 40} varianten. Los eerst de meldingen bij de producten op (meestal: variant nog niet bestelbaar).</p>` : ''}` : '<p class="mini ok">Niets te melden.</p>'}</div>`;
      d.dataset.url = r.feed_url;
    } catch (e) { d.innerHTML = e.message === 'uit' ? '' : `<div class="blok"><h3>Meta-productfeed</h3><p class="mini">${esc(e.message)}</p></div>`; }
  }

  function koppel() {
    $('#tiktokProducten').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tt]'); if (!b) return;
      if (b.dataset.tt === 'concept' && !confirm('Concept aanmaken in TikTok Shop? Beelden en varianten worden geüpload; indienen doe je daarna zelf in Seller Center.')) return;
      b.disabled = true;
      try { const r = await kapi(b.dataset.tt === 'concept' ? 'tiktok-concept' : 'tiktok-status', { method: 'POST', body: { product_id: b.dataset.id } }); meld(r.melding); }
      catch (x) { fout(x); }
      tiktok();
    });
    const m = $('#metaFeed');
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mf]'); if (!b || b.tagName === 'SELECT') return;
      if (b.dataset.mf === 'kopieer') { try { await navigator.clipboard.writeText(m.dataset.url); meld('Gekopieerd'); } catch { meld('Kopiëren lukt niet; selecteer de URL', true); } return; }
      b.disabled = true;
      try { const r = await kapi(b.dataset.mf === 'review' ? 'meta-review' : 'meta-bereikbaar', { method: 'POST', body: {} }); meld(r.melding); }
      catch (x) { fout(x); }
      meta();
    });
    m.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.mf === 'filter') { metaFilter = t.value; return meta(); }
      if (t.dataset.mopn) {
        try { const r = await kapi('meta-opnemen', { method: 'POST', body: { skus: [t.dataset.mopn], opnemen: t.checked } }); meld(r.melding); meta(); }
        catch (x) { fout(x); t.checked = !t.checked; }
      }
    });
  }
  let gekoppeld = false;
  return { open() { if (!gekoppeld) { koppel(); gekoppeld = true; } tiktok(); meta(); } };
})();
