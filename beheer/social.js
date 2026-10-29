/* Beheer → social: Buffer-accounts, kalender (Europe/Amsterdam) en contentstudio met varianten per account.
   Niets wordt als geplaatst getoond voordat Buffer dat meldt; een herinnering ("afronden op telefoon") blijft
   een herinnering tot Buffer of jij bevestigt dat het geplaatst is.
   Gebruikt de helpers uit admin.html ($, esc, datum, meld, toonLogin). */
const Social = (() => {
  const doos = () => $('#social');
  let data = null, open_ = null, weekStart = maandag(new Date()), kal = null, vb = null;
  const ST = { concept: 'concept', klaar: 'klaar om te versturen', versturen: 'wordt verstuurd', onzeker: 'wordt gecontroleerd in Buffer', in_buffer: 'gepland in Buffer',
    herinnering: 'herinnering verstuurd: rond af op je telefoon', gepubliceerd: 'geplaatst', fout: 'fout', geannuleerd: 'geannuleerd' };
  const PST = { concept: 'concept', gepland: 'gepland', deels: 'deels geplaatst', gepubliceerd: 'geplaatst', fout: 'fout', geannuleerd: 'geannuleerd' };
  const KLEUR = { gepubliceerd: 'actief', in_buffer: 'gereed', klaar: 'gereed', herinnering: 'onvolledig', onzeker: 'verwerken', versturen: 'verwerken', fout: 'fout', gepland: 'gereed', deels: 'onvolledig' };
  const chip = (s, lab) => `<span class="pchip ${KLEUR[s] || ''}">${esc(lab[s] || s)}</span>`;
  function maandag(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  const dag = (d) => d.toISOString().slice(0, 10);
  const fout = (e) => { if (e.message !== 'uit') meld(e.message, true); };

  async function vraag(actie, body, params) {
    const q = new URLSearchParams({ actie, ...(params || {}) });
    const r = await fetch(`/api/social?${q}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ ok: false, melding: 'Onverwacht antwoord van de server.' }));
    if (r.status === 401) { toonLogin(); throw new Error('uit'); }
    if (!j.ok) throw new Error(j.melding || 'Mislukt');
    return j;
  }

  async function laad() {
    try {
      const eind = new Date(weekStart); eind.setDate(eind.getDate() + 6);
      [data, kal] = await Promise.all([vraag('overzicht'), vraag('kalender', null, { van: dag(weekStart), tot: dag(eind) })]);
      teken();
    } catch (e) { if (e.message !== 'uit') doos().innerHTML = `<div class="leeg">${esc(e.message)}</div>`; }
  }

  function teken() {
    const { instellingen: s, ingesteld, accounts, posts, diensten } = data;
    const post = open_ === 'nieuw' ? { id: null, titel: '', tekst: '', campagne: '', product_id: '', media: [], doelen: [] } : posts.find((p) => p.id === open_);
    doos().innerHTML = `
      <div class="kanalen" style="margin-bottom:14px">
        <div class="kanaal"><h3>Buffer <span class="${s.aan ? 'ok' : ''}">${s.aan ? (s.proef ? 'aan · proefmodus' : 'aan · live') : 'uit'}</span></h3>
          <p class="mini">${ingesteld ? '<span class="ok">API-sleutel aanwezig</span>' : '<span class="nok">nog in Vercel zetten: BUFFER_API_KEY</span>'}</p>
          <div class="rij"><label>social aan (berichten naar Buffer sturen)</label><input type="checkbox" class="schakel" data-si="aan" ${s.aan ? 'checked' : ''}></div>
          <div class="rij"><label>proefmodus (niets versturen, wel controleren)</label><input type="checkbox" class="schakel" data-si="proef" ${s.proef ? 'checked' : ''}></div>
          <div class="acties" style="margin-top:8px"><button data-so="sync" ${ingesteld ? '' : 'disabled'}>accounts ophalen</button><button data-so="verwerk" ${ingesteld ? '' : 'disabled'}>status bijwerken</button></div>
          <p class="mini" style="margin-top:6px">Accounts koppel je in Buffer zelf; SKIFFA plant en volgt. Geen inbox of statistieken.</p></div>
        <div class="kanaal sbreed"><h3>accounts</h3>
          ${accounts.length ? `<table class="kaal">${accounts.map((c) => `<tr><td>${c.avatar ? `<img src="${esc(c.avatar)}" alt="" style="width:22px;height:22px;border-radius:50%;vertical-align:middle">` : ''} ${esc(c.naam)}</td><td class="mini">${esc(diensten[c.service]?.naam || c.service)}${diensten[c.service] ? '' : ' (niet ondersteund)'}</td>
            <td class="mini ${c.status === 'actief' ? 'ok' : 'nok'}">${esc(c.status)}${c.meta?.telefoon_mogelijk === false ? ' · geen telefoon voor herinneringen' : ''}</td>
            <td><label class="mini"><input type="checkbox" class="schakel" data-acc="${c.id}" ${c.gebruiken ? 'checked' : ''}> gebruiken</label></td></tr>`).join('')}</table>`
            : `<p class="mini">${ingesteld ? 'Nog geen accounts: klik "accounts ophalen".' : 'Zet eerst BUFFER_API_KEY in Vercel (Buffer → Settings → API).'}</p>`}</div>
      </div>

      <div class="blok"><h3>kalender · ${esc(data.tijdzone)}</h3>
        <div class="acties" style="margin-bottom:8px"><button data-wk="-1">← vorige week</button><button data-wk="0">deze week</button><button data-wk="1">volgende week →</button></div>
        <div class="skal">${[...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); const k = dag(d);
          const items = kal.items.filter((x) => x.gepland_lokaal?.startsWith(k));
          return `<div class="skdag"><b class="mini">${d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</b>
            ${items.map((x) => `<button class="skitem" data-open="${x.post_id}">${esc(x.gepland_lokaal.slice(11))} ${esc(x.account?.naam || '')}<br><span>${esc(x.post?.titel || '')}</span><br>${chip(x.status, ST)}</button>`).join('') || '<span class="mini">—</span>'}</div>`; }).join('')}</div>
        ${kal.wachtrij.length ? `<p class="mini" style="margin-top:8px">In de Buffer-wachtrij zonder vast tijdstip: ${kal.wachtrij.map((x) => `${esc(x.post?.titel || '')} (${esc(x.account?.naam || '')})`).join(', ')}</p>` : ''}
      </div>

      <div class="blok"><h3>berichten</h3>
        <div class="acties" style="margin-bottom:8px"><button class="vol" data-open="nieuw">nieuw bericht</button></div>
        ${posts.length ? `<table class="kaal">${posts.map((p) => `<tr><td><button class="link" data-open="${p.id}">${esc(p.titel)}</button><div class="mini">${datum(p.aangemaakt_op)}${p.product_id ? ` · ${esc(p.product_id)}` : ''}</div></td>
          <td>${chip(p.status, PST)}</td><td class="mini">${p.doelen.map((d) => esc(ST[d.status] || d.status)).join(' · ')}</td></tr>`).join('')}</table>` : '<p class="mini">Nog geen berichten. Tip: "Maak socialmediabericht" bij een product.</p>'}
      </div>
      ${post ? studio(post) : ''}`;
  }

  function studio(p) {
    const { accounts, diensten } = data;
    const bruikbaar = accounts.filter((c) => diensten[c.service] && (c.gebruiken || p.doelen.some((d) => d.connection_id === c.id)));
    const opties = Object.entries(data.producten || {}).map(([id, t]) => `<option value="${esc(id)}" ${p.product_id === id ? 'selected' : ''}>${esc(t)}</option>`).join('');
    return `<div class="vdetail" id="studio" data-post="${p.id || ''}">
      <h4 style="margin-bottom:8px">${p.id ? `bericht #${p.id}` : 'nieuw bericht'} ${p.id ? chip(p.status, PST) : ''}</h4>
      <div class="pform">
        <label>interne titel<input data-f="titel" value="${esc(p.titel)}"></label>
        <label>product<select data-f="product_id"><option value="">— geen —</option>${opties}</select></label>
        <label>campagne (utm_campaign)<input data-f="campagne" value="${esc(p.campagne || '')}" placeholder="bv. najaar-2026"></label>
        <label class="breed">tekst (basis voor alle accounts; {link} = campagnelink naar het product)<textarea data-f="tekst" rows="5">${esc(p.tekst)}</textarea></label>
      </div>
      <h4 style="margin:12px 0 6px">media <span class="mini">(openbaar en blijvend; Buffer haalt ze pas bij plaatsing op)</span></h4>
      <div class="smedia">${p.media.map((m, i) => `<div class="sm" data-m="${i}">${m.soort === 'video' ? `<video src="${esc(m.url)}" muted></video>` : `<img src="${esc(m.url)}" alt="">`}
        <input data-mf="alt_tekst" placeholder="alt-tekst" value="${esc(m.alt_tekst || '')}">${m.soort === 'video' ? `<input data-mf="thumbnail_offset_ms" placeholder="omslag (ms)" value="${esc(m.thumbnail_offset_ms ?? '')}">` : ''}
        <div class="acties"><button data-mv="${i}|-1">←</button><button data-mv="${i}|1">→</button><button data-mx="${i}">×</button></div></div>`).join('')}
        <button class="sm nieuw" data-upload>+ afbeelding of video</button></div>
      <h4 style="margin:12px 0 6px">accounts</h4>
      ${bruikbaar.length ? bruikbaar.map((c) => doelVak(p, c, diensten[c.service])).join('') : '<p class="mini">Geen bruikbare accounts. Haal ze op uit Buffer.</p>'}
      <div class="acties" style="margin-top:10px"><button class="vol" data-sa="bewaar">opslaan</button><button data-sa="voorbeeld" ${p.id ? '' : 'disabled'}>voorbeeld</button>
        <button data-sa="inplannen" ${p.id ? '' : 'disabled'}>inplannen in Buffer</button>${p.id ? '<button data-sa="verwijder">verwijderen</button>' : ''}<button data-open="">sluiten</button></div>
      ${vb && vb.post.id === p.id ? `<div class="svb">${vb.per.map((x) => `<div class="kanaal"><h3>${esc(x.account.naam)} <span class="mini">${esc(diensten[x.account.service]?.naam || '')}</span></h3>
        <pre class="svbtekst">${esc(x.tekst)}</pre><p class="mini ${x.limiet && x.lengte > x.limiet ? 'nok' : ''}">${x.lengte}${x.limiet ? ` / ${x.limiet}` : ''} tekens · ${x.publicatie === 'telefoon' ? 'afronden op telefoon' : 'automatisch'} · ${x.gepland_lokaal ? esc(x.gepland_lokaal.replace('T', ' ')) : 'eerstvolgende plek in de wachtrij'}</p>
        ${x.link ? `<p class="mini">link: ${esc(x.link)}</p>` : ''}${x.slot ? `<p class="mini">${esc(ST[x.status] || x.status)}</p>` : x.ontbreekt.length ? `<ul class="ontbreekt">${x.ontbreekt.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '<p class="mini ok">klaar om in te plannen</p>'}</div>`).join('')}</div>` : ''}
    </div>`;
  }

  function doelVak(p, c, d) {
    const t = p.doelen.find((x) => x.connection_id === c.id);
    const slot = t && !['concept', 'fout', 'geannuleerd'].includes(t.status);
    const md = t?.metadata || {};
    return `<div class="sdoel" data-acc-doel="${c.id}">
      <label class="pcel"><input type="checkbox" class="schakel" data-d="aan" ${t ? 'checked' : ''} ${slot ? 'disabled' : ''}> <b>${esc(c.naam)}</b> <span class="mini">${esc(d.naam)}</span> ${t ? chip(t.status, ST) : ''}</label>
      ${t?.melding ? `<p class="mini ${t.status === 'fout' ? 'nok' : ''}">${esc(t.melding)}</p>` : ''}
      ${t?.extern_link ? `<p class="mini"><a href="${esc(t.extern_link)}" target="_blank" rel="noopener">bekijk het bericht ↗</a></p>` : ''}
      ${slot ? `<div class="acties">${t.status === 'herinnering' ? `<button data-geplaatst="${t.id}">ik heb het geplaatst</button>` : ''}${['in_buffer', 'klaar'].includes(t.status) ? `<button data-annuleer="${t.id}">annuleren${t.extern_id ? ' (uit Buffer halen)' : ''}</button>` : ''}</div>` : `
      <div class="pform">
        <label>publicatie<select data-d="publicatie"><option value="automatisch" ${t?.publicatie !== 'telefoon' ? 'selected' : ''}>automatisch</option><option value="telefoon" ${t?.publicatie === 'telefoon' ? 'selected' : ''}>afronden op telefoon (herinnering)</option></select></label>
        <label>soort<select data-d="post_type">${d.types.map((x) => `<option ${t?.post_type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>tijdstip (Amsterdam; leeg = wachtrij)<input type="datetime-local" data-d="gepland_lokaal" value="${esc(t?.gepland_lokaal || '')}"></label>
        <label class="breed">eigen tekst voor ${esc(d.naam)} (leeg = basistekst)<textarea data-d="tekst" rows="3">${esc(t?.tekst || '')}</textarea></label>
        ${['instagram', 'facebook', 'linkedin'].includes(c.service) ? `<label>eerste reactie<input data-d="eerste_reactie" value="${esc(md.eerste_reactie || '')}"></label>` : ''}
        ${['tiktok', 'pinterest'].includes(c.service) ? `<label>titel<input data-d="titel" value="${esc(md.titel || '')}"></label>` : ''}
        ${c.service === 'pinterest' ? `<label>bord<select data-d="bord"><option value="">— kies —</option>${(c.meta?.borden || []).map((b) => `<option value="${esc(b.id)}" ${md.bord === b.id ? 'selected' : ''}>${esc(b.naam)}</option>`).join('')}</select></label>` : ''}
        ${c.service === 'tiktok' ? `<label class="rijtje">gemaakt met AI<input type="checkbox" class="schakel" data-d="ai_gegenereerd" ${md.ai_gegenereerd ? 'checked' : ''}></label>` : ''}
        <label class="rijtje">campagnelink toevoegen<input type="checkbox" class="schakel" data-d="link_toevoegen" ${md.link_toevoegen !== false ? 'checked' : ''}></label>
      </div>`}</div>`;
  }

  function lees() {
    const st = $('#studio'), g = (k) => st.querySelector(`[data-f=${k}]`).value;
    const p = open_ === 'nieuw' ? { media: [] } : data.posts.find((x) => x.id === open_);
    const media = (p.media || []).map((m, i) => { const v = st.querySelector(`[data-m="${i}"]`); return { ...m, alt_tekst: v?.querySelector('[data-mf=alt_tekst]')?.value || '', thumbnail_offset_ms: v?.querySelector('[data-mf=thumbnail_offset_ms]')?.value ?? m.thumbnail_offset_ms }; });
    const doelen = [...st.querySelectorAll('[data-acc-doel]')].map((v) => {
      const aan = v.querySelector('[data-d=aan]');
      if (!aan.checked) return null;
      const w = (k) => { const i = v.querySelector(`[data-d=${k}]`); return i ? (i.type === 'checkbox' ? i.checked : i.value) : undefined; };
      return { connection_id: Number(v.dataset.accDoel), publicatie: w('publicatie'), post_type: w('post_type'), gepland_lokaal: w('gepland_lokaal') || null, tekst: w('tekst'),
        metadata: { eerste_reactie: w('eerste_reactie'), titel: w('titel'), bord: w('bord'), ai_gegenereerd: w('ai_gegenereerd'), link_toevoegen: w('link_toevoegen') } };
    }).filter(Boolean);
    // Doelen die op slot staan (al in Buffer) blijven bestaan: stuur ze mee zodat ze niet worden verwijderd.
    for (const d of (p.doelen || [])) if (!['concept', 'fout', 'geannuleerd'].includes(d.status) && !doelen.some((x) => x.connection_id === d.connection_id)) doelen.push({ connection_id: d.connection_id });
    return { id: p.id, titel: g('titel'), product_id: g('product_id'), campagne: g('campagne'), tekst: g('tekst'), media, doelen };
  }

  async function bewaar() { const r = await vraag('bewaar', lees()); open_ = r.id; return r; }

  function koppel() {
    const d = doos();
    d.addEventListener('change', async (e) => {
      const t = e.target;
      try {
        if (t.dataset.si) {
          if (t.dataset.si === 'proef' && !t.checked && !confirm('Proefmodus uit? Ingeplande berichten gaan dan echt naar Buffer en worden geplaatst.')) { t.checked = true; return; }
          await vraag('instellingen', { waarden: { [t.dataset.si]: t.checked } }); meld('Opgeslagen'); laad();
        }
        if (t.dataset.acc) { await vraag('account', { id: Number(t.dataset.acc), gebruiken: t.checked }); meld('Opgeslagen'); }
      } catch (x) { fout(x); t.checked = !t.checked; }
    });
    d.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.open !== undefined) { open_ = b.dataset.open === 'nieuw' ? 'nieuw' : b.dataset.open ? Number(b.dataset.open) : null; vb = null; teken(); if (open_) $('#studio')?.scrollIntoView({ behavior: 'smooth' }); return; }
      if (b.dataset.wk !== undefined) { const n = Number(b.dataset.wk); if (n === 0) weekStart = maandag(new Date()); else weekStart.setDate(weekStart.getDate() + 7 * n); return laad(); }
      if (b.dataset.mv || b.dataset.mx !== undefined) {
        const p = open_ === 'nieuw' ? null : data.posts.find((x) => x.id === open_); if (!p) return;
        const huidig = lees();
        if (b.dataset.mx !== undefined) huidig.media.splice(Number(b.dataset.mx), 1);
        else { const [i, r] = b.dataset.mv.split('|').map(Number), j = i + r; if (j < 0 || j >= huidig.media.length) return; [huidig.media[i], huidig.media[j]] = [huidig.media[j], huidig.media[i]]; }
        try { await vraag('bewaar', huidig); await laad(); } catch (x) { fout(x); }
        return;
      }
      b.disabled = true;
      try {
        if (b.dataset.so === 'sync') { const r = await vraag('accounts-sync', {}); meld(r.melding); await laad(); }
        if (b.dataset.so === 'verwerk') { const r = await vraag('verwerk', {}); meld(r.melding); await laad(); }
        if (b.dataset.upload !== undefined) {
          if (!open_ || open_ === 'nieuw') { await bewaar(); }
          const f = await new Promise((ok) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime'; i.onchange = () => ok(i.files[0]); i.click(); });
          if (f) {
            const u = await vraag('media-upload', { bestandsnaam: f.name, bytes: f.size });
            const put = await fetch(u.url, { method: 'PUT', headers: { 'content-type': u.mime, 'x-upsert': 'true' }, body: f }); if (!put.ok) throw new Error(`Upload mislukt (${put.status})`);
            const m = await vraag('media-bevestig', { pad: u.pad });
            await laad(); const huidig = lees(); huidig.media.push({ url: m.url, soort: m.soort, bron: 'upload', pad: u.pad });
            await vraag('bewaar', huidig); meld('Toegevoegd');
          }
          await laad();
        }
        if (b.dataset.sa === 'bewaar') { const r = await bewaar(); meld(r.melding); vb = null; await laad(); }
        if (b.dataset.sa === 'voorbeeld') { await bewaar(); vb = await vraag('voorbeeld', null, { id: open_ }); await laad(); }
        if (b.dataset.sa === 'inplannen') {
          await bewaar(); vb = await vraag('voorbeeld', null, { id: open_ });
          const mis = vb.per.filter((x) => !x.slot && x.ontbreekt.length);
          if (mis.length && !confirm(`Bij ${mis.map((x) => x.account.naam).join(', ')} ontbreekt nog iets; die worden overgeslagen. De rest inplannen?`)) { await laad(); return; }
          if (!mis.length && !confirm(data.instellingen.proef ? 'Proefmodus: er wordt niets verstuurd, alleen gecontroleerd. Doorgaan?' : 'Inplannen in Buffer? Automatische berichten worden op het gekozen tijdstip geplaatst.')) { b.disabled = false; return; }
          const r = await vraag('inplannen', { id: open_ }); meld(r.melding + (r.overgeslagen.length ? ` · overgeslagen: ${r.overgeslagen.length}` : '')); vb = null; await laad();
        }
        if (b.dataset.sa === 'verwijder') { if (!confirm('Bericht verwijderen?')) { b.disabled = false; return; } const r = await vraag('verwijder', { id: open_ }); meld(r.melding); open_ = null; await laad(); }
        if (b.dataset.annuleer) { if (!confirm('Annuleren? Een bericht dat al in Buffer staat, wordt daar verwijderd.')) { b.disabled = false; return; } const r = await vraag('annuleer', { doel_id: Number(b.dataset.annuleer) }); meld(r.melding); await laad(); }
        if (b.dataset.geplaatst) { const link = prompt('Heb je het geplaatst? Plak eventueel de link naar het bericht (https://…):', ''); if (link === null) { b.disabled = false; return; } const r = await vraag('geplaatst', { doel_id: Number(b.dataset.geplaatst), link }); meld(r.melding); await laad(); }
      } catch (x) { fout(x); b.disabled = false; }
    });
  }
  let gekoppeld = false;
  return {
    open(postId) { if (!gekoppeld) { koppel(); gekoppeld = true; } if (postId) open_ = postId; laad(); },
    async vanProduct(productId) {
      const r = await vraag('van-product', { product_id: productId });
      meld('Concept gemaakt: controleer tekst en accounts, dan inplannen');
      toonView('social'); Social.open(r.id);
    },
  };
})();
