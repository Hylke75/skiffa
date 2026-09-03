// Headless content-endpoint voor de Skiffa-frontend.
//
// Dit draait server-side op Vercel, zodat het CMS_TOKEN nooit in de browser terechtkomt.
// Zonder CMS_URL + CMS_TOKEN (dus zolang er nog geen token is) antwoordt hij {ok:false}
// en valt de site terug op de content die in index.html staat — pixel-identiek aan het ontwerp.
//
// Zodra er een token is: zet CMS_URL + CMS_TOKEN als Environment Variables in Vercel.
// De frontend (zie de CMS-hydratie onderaan index.html) haalt dit endpoint dan op en
// vervangt de tagline en de shirts.

const CMS_URL = process.env.CMS_URL;     // https://linkandlead.nl
const CMS_TOKEN = process.env.CMS_TOKEN; // cms_...

// Haal een tagline uit de CMS-content: eerst site.config.tagline, anders de subheading
// van het eerste header-blok dat we tegenkomen.
function leesTagline(data) {
  const cfg = data?.site?.config;
  if (cfg && typeof cfg.tagline === 'string' && cfg.tagline.trim()) return cfg.tagline.trim();
  for (const p of data?.paginas || []) {
    for (const b of p.blokken || []) {
      if (b.type === 'header' && b.content?.subheading) return String(b.content.subheading);
    }
  }
  return undefined;
}

// Haal de shirts uit de CMS-content. Twee bronnen worden ondersteund (de eerste die geldig is wint):
//   1. site.config.shirts  — een array met de volledige shirt-objecten (handig om te seeden/pushen)
//   2. een blok met content.shirts — zelfde vorm, op een pagina
// Elk shirt moet minimaal id, naam en kleur hebben; de rest is optioneel en heeft nette defaults,
// zodat een half ingevuld CMS-record de frontend niet breekt.
function leesShirts(data) {
  const kandidaten = [];
  const cfg = data?.site?.config;
  if (cfg && Array.isArray(cfg.shirts)) kandidaten.push(cfg.shirts);
  for (const p of data?.paginas || []) {
    for (const b of p.blokken || []) {
      if (Array.isArray(b.content?.shirts)) kandidaten.push(b.content.shirts);
    }
  }
  for (const lijst of kandidaten) {
    const geldig = lijst
      .filter((s) => s && s.id && s.naam && s.kleur)
      .map((s) => ({
        id: String(s.id),
        naam: String(s.naam),
        kleur: String(s.kleur),
        licht: s.licht ? String(s.licht) : '#EEF0EE',
        x: Number(s.x) || 0.5,
        y: Number(s.y) || 0.85,
        s: s.s ? String(s.s) : 'M',
        sub: s.sub ? String(s.sub) : '',
        zin: s.zin ? String(s.zin) : '',
        punten: Array.isArray(s.punten) ? s.punten.map(String) : [],
      }));
    if (geldig.length) return geldig;
  }
  return undefined;
}

export default async function handler(req, res) {
  // Kleine cache: content ververst binnen ~60s, net als de CMS-lees-API zelf.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');

  if (!CMS_URL || !CMS_TOKEN) {
    // Nog geen token: de site gebruikt de content in de code.
    res.status(200).json({ ok: false, reden: 'geen-cms-token' });
    return;
  }

  try {
    const url = `${CMS_URL.replace(/\/$/, '')}/api/cms/content`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${CMS_TOKEN}` } });
    if (!r.ok) {
      res.status(200).json({ ok: false, reden: `cms-status-${r.status}` });
      return;
    }
    const data = await r.json();
    if (!data || data.ok === false) {
      res.status(200).json({ ok: false, reden: 'cms-leeg' });
      return;
    }
    res.status(200).json({
      ok: true,
      naam: data.site?.naam,
      tagline: leesTagline(data),
      shirts: leesShirts(data),
    });
  } catch (e) {
    // Nooit de site laten breken op een CMS-hik: val terug op code-content.
    res.status(200).json({ ok: false, reden: 'cms-onbereikbaar' });
  }
}
