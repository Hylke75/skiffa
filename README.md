# Skiffa — made for the grey side of the sea

De losse frontend voor **Skiffa** (Scheveningen). Het is het **exacte aangeleverde ontwerp**
(`skiffa-noordzee`) als statische site, met een **optionele, env-gated koppeling** naar het centrale
CMS (`linkandlead.nl`) volgens `BOUW-EEN-SITE.md`.

De site is een bewuste single-page-ervaring en verkoopt **posters** over de Scheveningse surfcultuur:
een scène die met de tijd in Scheveningen meebeweegt (uitsneden uit de posters), live Noordzee-data
(wind, temperatuur, zeewater, golven en het getij via Open-Meteo), de posters als hotspots, een
**mandje** met afrekenen, en de overlays **over** en **contact**.

## Posters en bestellen

- **Beelden**: `posters/<id>.webp` (productbeeld, 1333 × 2000) en `posters/<id>-klein.webp` (600 × 900).
  `sfeer/` bevat uitsneden uit de posters: de drie scènes (ochtend/middag/avond) en het beeld bij contact.
  Het productvenster toont de poster, de poster in een houten lijst en in een zwarte lijst met passe-partout.
- **Catalogus**: `posters` en `formaten` in `index.html` (teksten, beelden), en `api/_catalogus.js`
  (ids en prijzen; de server rekent altijd zelf). Check: `node scripts/check-catalogus.mjs`.
- **Formaten**: 30 × 45 (€ 29), 50 × 75 (€ 45), 70 × 105 (€ 69). Verzending € 6,95 (BE € 9,95), gratis vanaf € 75.
- **Nieuwe poster toevoegen**: `python3 scripts/maak-beelden.py <bestand> <id>`, dan in `index.html` bij die
  poster `actief:true` zetten en de id toevoegen aan `api/_catalogus.js`.
  Reuzenrad en Vuurtoren staan al klaar met `actief:false` (de beelden ontbreken nog).
- **Mandje**: wordt in de browser bewaard (`localStorage`).
- **Afrekenen** (`api/bestel.js`, env-gated):
  1. `MOLLIE_API_KEY` → Mollie-betaling (iDEAL, Bancontact, kaart). Daarna terug naar `/?bestelling=terug`,
     waar de site de status opvraagt (`GET /api/bestel?id=tr_…`). Mollie meldt de betaling aan
     `api/mollie-webhook.js`; bij `paid` gaat de bestelling per mail naar winkel en klant (als Resend is
     ingesteld). Alle bestellingen staan ook in het Mollie-dashboard (beschrijving `Skiffa SK-…`, gegevens in de metadata).
  2. anders `RESEND_API_KEY` (+ `RESEND_FROM`, `BESTEL_EMAIL`) → bestelling per mail naar de winkel en een
     bevestiging naar de klant; de winkel stuurt een betaalverzoek.
  3. niets ingesteld (of statisch gehost) → de site opent een mail aan hallo@skiffa.nl met de bestelling erin.
  Spam: honeypot-veld en minimale invultijd.

## Hoe het in elkaar zit

- **`index.html`** — het volledige ontwerp (HTML + CSS + JS, GSAP via CDN). Alle content
  (de posters, de teksten, de FAQ) staat gewoon in de code. De site draait 100% zonder CMS.
- **`api/content.js`** — een Vercel-serverless-functie die *server-side* de CMS-lees-API ophaalt met
  het geheime token. Zo komt het token **nooit** in de browser. Zonder token antwoordt hij
  `{ok:false}` en verandert er niets.
- Onderaan `index.html` staat een kleine **CMS-hydratie**: die haalt `/api/content` op en vervangt —
  alléén als er content terugkomt — de **tagline** en de **posterteksten**. Komt er niets terug, dan blijft
  alles exact zoals in het ontwerp.

Kort: **geen token → exact het ontwerp. Wél een token → dezelfde site, maar met content uit het CMS.**

## Contactformulier

`api/contact.js` stuurt berichten via Resend naar `BESTEL_EMAIL` (standaard hallo@skiffa.nl). Zonder
`RESEND_API_KEY` opent de site een mail met het bericht erin. Spam: honeypot-veld en minimale invultijd.

## Link per poster

`/#<poster-id>` (bijv. `/#golf`) opent die poster direct; het productvenster zet de link zelf in de adresbalk.

## Environment variables

Zet deze pas als er een CMS-site + token voor Skiffa bestaat (`/admin/platform`). Zie `.env.example`.

| Variabele   | Waarde                     |
|-------------|----------------------------|
| `CMS_URL`   | `https://linkandlead.nl`   |
| `CMS_TOKEN` | `cms_...` (48 hex, geheim) |
| `MOLLIE_API_KEY` | optioneel, voor betalen via Mollie (`live_…` of `test_…`) |
| `RESEND_API_KEY`, `RESEND_FROM`, `BESTEL_EMAIL` | optioneel, mails bij bestellingen |
| `SITE_URL` | optioneel, basis-URL voor terugkeer na betalen |

Zet ze in Vercel onder **Production + Preview**. Nooit committen (`.env` staat in `.gitignore`).

## Wat het CMS mag aansturen (huidige mapping)

`api/content.js` leest conservatief, zodat een half ingevuld record de site niet breekt:

- **tagline** ← `site.config.tagline`, anders de `subheading` van het eerste `header`-blok.
- **posterteksten** ← `site.config.posters` (een array), of een blok met `content.posters`. Gekoppeld op
  `id` aan de bestaande posters; alleen `naam`, `sub`, `zin`, `kleur` en `punten` worden overgenomen.
  Prijzen, formaten en nieuwe posters komen bewust niet uit het CMS.

Seed de teksten met `node scripts/cms-seed.mjs` (leest ze uit `index.html`).

## Lokaal draaien

```bash
npx vercel dev      # draait index.html + /api/content + /api/bestel lokaal (Mollie-webhook alleen op een publieke https-URL)
# of gewoon een statische server; /api/content geeft dan {ok:false} en de code-content wordt gebruikt.
```

## Deploy

- Eigen Vercel-project, gekoppeld aan deze repo (`Hylke75/skiffa`). Geen build-stap.
- Eerst testen op de Vercel-preview-URL; het eigen domein pas koppelen **na akkoord**.
- Content ververst vanzelf binnen ~60s (cache), of na een redeploy.

