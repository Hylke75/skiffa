// Headless content-endpoint voor de Skiffa-frontend.
//
// Dit draait server-side op Vercel, zodat het CMS_TOKEN nooit in de browser terechtkomt.
// Zonder CMS_URL + CMS_TOKEN (dus zolang er nog geen token is) antwoordt hij {ok:false}
// en valt de site terug op de content die in index.html staat — pixel-identiek aan het ontwerp.
//
// Zodra er een token is: zet CMS_URL + CMS_TOKEN als Environment Variables in Vercel.
// De frontend (zie de CMS-hydratie onderaan index.html) haalt dit endpoint dan op en
// vervangt de tagline en de postertitels en -teksten.

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

// Haal de postertekst uit de CMS-content. Twee bronnen worden ondersteund (de eerste die geldig is wint):
//   1. site.config.posters  — een array met poster-objecten
//   2. een blok met content.posters — zelfde vorm, op een pagina
// Elke poster moet minimaal een id hebben. Alleen teksten (naam, sub, zin, kleur, punten) worden
// doorgegeven; de frontend koppelt ze op id aan de posters die al bestaan. Prijzen en formaten
// komen nooit uit het CMS (de server rekent met api/_catalogus.js).
function leesPosters(data) {
  const kandidaten = [];
  const cfg = data?.site?.config;
  if (cfg && Array.isArray(cfg.posters)) kandidaten.push(cfg.posters);
  for (const p of data?.paginas || []) {
    for (const b of p.blokken || []) {
      if (Array.isArray(b.content?.posters)) kandidaten.push(b.content.posters);
    }
  }
  const tekst = (v) => (typeof v === 'string' && v.trim() ? v : undefined);
  for (const lijst of kandidaten) {
    const geldig = lijst
      .filter((s) => s && s.id)
      .map((s) => ({
        id: String(s.id),
        naam: tekst(s.naam),
        sub: tekst(s.sub),
        zin: tekst(s.zin),
        kleur: tekst(s.kleur),
        punten: Array.isArray(s.punten) ? s.punten.map(String) : undefined,
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
      posters: leesPosters(data),
    });
  } catch (e) {
    // Nooit de site laten breken op een CMS-hik: val terug op code-content.
    res.status(200).json({ ok: false, reden: 'cms-onbereikbaar' });
  }
}
