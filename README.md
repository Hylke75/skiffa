# Skiffa — made for the grey side of the sea

De losse frontend voor **Skiffa** (Scheveningen). Het is het **exacte aangeleverde ontwerp**
(`skiffa-noordzee`) als statische site, met een **optionele, env-gated koppeling** naar het centrale
CMS (`linkandlead.nl`) volgens `BOUW-EEN-SITE.md`.

De site is een bewuste single-page-ervaring: een scène die met de tijd in Scheveningen meebeweegt,
live Noordzee-data (wind, temperatuur, zeewater, golven en het getij via Open-Meteo), zes t-shirts als
hotspots, en de overlays **over** en **contact**.

## Hoe het in elkaar zit

- **`index.html`** — het volledige ontwerp (HTML + CSS + JS, GSAP via CDN). Alle content
  (de 6 shirts, de teksten, de FAQ) staat gewoon in de code. De site draait 100% zonder CMS.
- **`api/content.js`** — een Vercel-serverless-functie die *server-side* de CMS-lees-API ophaalt met
  het geheime token. Zo komt het token **nooit** in de browser. Zonder token antwoordt hij
  `{ok:false}` en verandert er niets.
- Onderaan `index.html` staat een kleine **CMS-hydratie**: die haalt `/api/content` op en vervangt —
  alléén als er content terugkomt — de **tagline** en de **shirts**. Komt er niets terug, dan blijft
  alles exact zoals in het ontwerp.

Kort: **geen token → exact het ontwerp. Wél een token → dezelfde site, maar met content uit het CMS.**

## Environment variables

Zet deze pas als er een CMS-site + token voor Skiffa bestaat (`/admin/platform`). Zie `.env.example`.

| Variabele   | Waarde                     |
|-------------|----------------------------|
| `CMS_URL`   | `https://linkandlead.nl`   |
| `CMS_TOKEN` | `cms_...` (48 hex, geheim) |

Zet ze in Vercel onder **Production + Preview**. Nooit committen (`.env` staat in `.gitignore`).

## Wat het CMS mag aansturen (huidige mapping)

`api/content.js` leest conservatief, zodat een half ingevuld record de site niet breekt:

- **tagline** ← `site.config.tagline`, anders de `subheading` van het eerste `header`-blok.
- **shirts** ← `site.config.shirts` (een array), of een blok met `content.shirts`. Elk shirt moet
  minimaal `id`, `naam` en `kleur` hebben; `licht`, `x`, `y`, `s`, `sub`, `zin`, `punten` zijn
  optioneel met nette defaults.

De shirt-vorm (`{id, naam, kleur, licht, x, y, s, sub, zin, punten}`) staat als bron van waarheid in
`index.html`. Zodra het token er is, seed je die shirts via de sync-API (`POST /api/cms/sync`) of vul
je ze in `site.config`, en verfijnen we deze mapping op de echte blokstructuur.

## Lokaal draaien

```bash
npx vercel dev      # draait index.html + /api/content lokaal
# of gewoon een statische server; /api/content geeft dan {ok:false} en de code-content wordt gebruikt.
```

## Deploy

- Eigen Vercel-project, gekoppeld aan deze repo (`Hylke75/skiffa`). Geen build-stap.
- Eerst testen op de Vercel-preview-URL; het eigen domein pas koppelen **na akkoord**.
- Content ververst vanzelf binnen ~60s (cache), of na een redeploy.

## Formulier

Het contactformulier is nu client-side (bevestiging in beeld). Echte afhandeling (Resend/CRM) komt in
een eigen serverless-route met honeypot + tijdmeting, conform `BOUW-EEN-SITE.md §9`.
