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
- **Formaten** (standaard lijstmaten): **50 × 70 cm** (€ 45, hoofdproduct en standaard geselecteerd), 30 × 40 cm
  (€ 29, instap/cadeau), 70 × 100 cm (€ 69, grote uitvoering). Klaargezet voor Noord-Amerika, nog niet te koop:
  18 × 24 inch en 24 × 36 inch (`actief: false` in `api/_catalogus.js`; prijzen voorlopig). Verzending € 6,95
  (BE € 9,95), gratis vanaf € 75.
- **Nieuwe poster toevoegen**: `python3 scripts/maak-beelden.py <bestand> <id>`, dan in `index.html` bij die
  poster `actief:true` zetten en de id toevoegen aan `api/_catalogus.js`.
- **Mandje**: wordt in de browser bewaard (`localStorage`).
- **Afrekenen**: zie [Webshop en administratie](#webshop-en-administratie).

## Drukbestanden en visuals

Per poster hoort bij **elk formaat een eigen drukbestand** (hoge-resolutie pdf) en heeft de poster **zes visuals**
voor de presentatie in de webshop. Beheer alles in **/admin → posters**.

- **Uploaden**: sleep een hele map tegelijk naar het vak bovenaan. De bestandsnaam bepaalt de koppeling:
  `golf-50x70.pdf`, `pier-en-strand-30x40.pdf`, `regatta-18x24in.pdf` (drukbestanden) en `golf-1.jpg` t/m
  `golf-6.jpg` (visuals). Niet herkend? Kies poster en formaat in de lijst. Losse bestanden kun je ook op een rij of
  vakje slepen. Bestanden gaan rechtstreeks naar Supabase Storage (privé bucket `drukbestanden`, publieke bucket
  `visuals`); de Vercel-functie geeft alleen een ondertekende upload-URL.
- **Maatcontrole**: de browser leest de MediaBox/TrimBox uit de pdf. Goed = precies het formaat, eventueel met
  0–5 mm afloop rondom. Wijkt de maat af, dan wordt het bestand wel gekoppeld maar rood gemarkeerd.
- **Automatisch gekoppeld aan bestellingen**: elke orderregel (webshop, bol, Etsy, Amazon) wijst via poster +
  formaat naar het drukbestand: in de administratie (download per regel), in de mail aan de winkel, en met
  `DRUKKER_EMAIL` gaat na elke betaling vanzelf een **drukopdracht** (verzendadres + downloadlinks, 30 dagen geldig,
  ondertekend) naar de drukker. Ontbreekt een drukbestand, dan gaat er niets naar de drukker en zie je een
  waarschuwing; na uploaden stuur je de opdracht met één knop vanuit de bestelling.
- **Visuals**: verkleind in de browser (2000 px + 900 px, jpg) en in volgorde 1–6 getoond in het productvenster.
  Zolang een poster geen visuals heeft, toont het venster de poster en de twee lijst-dia's. Etsy en Amazon krijgen
  de poster als hoofdfoto en de visuals als extra foto's.
- **Drukbestanden maken uit een hr-beeld**: `python3 scripts/maak-drukbestanden.py <bron> <poster-id>` schrijft
  `drukbestanden/<id>-<formaat>.pdf` voor alle formaten (ware grootte + 3 mm afloop, max. 300 dpi, bijgesneden vanuit
  het midden; `--passend` vult aan met wit, `--afloop 5` voor meer afloop). Sleep die map daarna in /admin.
  Let op: 30 × 40 (3:4), 50 × 70 (5:7) en 70 × 100 (7:10) hebben elk een andere verhouding dan de 2:3-posters;
  heb je per formaat een eigen ontwerp, exporteer dat dan als pdf met dezelfde namen.
- **Code**: `api/media.js` (route), `api/_media.js` (koppelen, maat, links, drukopdracht), `api/_opslag.js`
  (Storage), migratie `supabase/migrations/20261029020000_media.sql`.

## Webshop en administratie

Volledige bestelstroom, alles env-gated (wat ontbreekt valt netjes terug):

1. **Bestellen** (`api/bestel.js`): de klant vult adres in en vinkt de voorwaarden aan. De server rekent de
   prijzen zelf (`api/_catalogus.js`), slaat de bestelling op in Supabase (`bestellingen`, `bestelregels`,
   `bestelling_log`) en start een **Mollie**-betaling (iDEAL, Bancontact, kaart).
2. **Betaald**: Mollie meldt het aan `api/mollie-webhook.js` (of de statuspagina vraagt het zelf op). De
   database zet de bestelling op betaald en kent een **doorlopend factuurnummer** toe (`2026-0001`, functie
   `skiffa_markeer_betaald`, idempotent: dubbele meldingen doen niets). De klant krijgt een
   **bevestigingsmail met factuur**, de winkel een melding.
3. **Klant volgt de bestelling** op `/bestelling.html?nr=…&t=…` (geheime link uit de mail): besteld → betaald →
   in productie → verzonden (met track-and-trace) → bezorgd, plus de factuur.
4. **Administratie** op `/admin` (wachtwoord `ADMIN_WACHTWOORD`): kerncijfers (omzet maand/jaar, te verzenden),
   lijst met filters en zoeken, per bestelling: verzonden met track-and-trace (mail aan klant), in productie,
   geleverd, annuleren (mail), handmatig betaald zetten (overboeking), **terugbetalen via Mollie** (geheel of
   gedeeltelijk, mail), mails opnieuw sturen, interne notitie en een volledig logboek.
5. **Boekhouding**: `export csv` per periode met factuurnummer, datum, omzet excl. btw, btw 21%, totaal,
   verzending, terugbetaald en betaalwijze (puntkomma-gescheiden, opent direct in Excel/Numbers).
6. **Factuur** (`api/factuur.js`): printbare pagina (afdrukken → pdf) met bedrijfsgegevens uit `BEDRIJF_*`.

Zonder Supabase werkt bestellen nog steeds (Mollie-metadata + mails, zoals voorheen); zonder Mollie wordt het
een betaalverzoek (bestelling in de administratie, daar op betaald zetten); zonder Resend gaan er geen mails.
Juridisch: `voorwaarden.html` (incl. herroepingsrecht en modelformulier) en `privacy.html`; vul KvK/btw in.

**Opzetten**

```bash
supabase link --project-ref <project-ref>
supabase db push            # past de migraties in supabase/migrations toe (webshop, kanalen, media)
```

Zet daarna in Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_WACHTWOORD`, `MOLLIE_API_KEY`,
`RESEND_API_KEY`, `RESEND_FROM` (op een in Resend geverifieerd domein), `BESTEL_EMAIL`, `SITE_URL`, `BEDRIJF_*` en
eventueel `DRUKKER_EMAIL`. Grote pdf's: verhoog in Supabase (Storage → Settings) de uploadlimiet; op het gratis plan
is die 50 MB per bestand.

**Testen**: `npm test` (catalogus, de hele bestelstroom, de drie kanalen en de drukbestanden/visuals, met nagebootste Supabase, Storage, Mollie, Resend, bol, Etsy en Amazon).

## Verkoopkanalen: bol.com, Etsy en Amazon

Opgezet naar het voorbeeld van Luna Azul (`Hylke75/dreamer-collectives`, `supabase/functions/{bol,etsy,amazon}-sync`),
vertaald naar posters op bestelling (geen fysieke voorraad: we tonen een vaste voorraad per listing).

| | bol.com | Etsy | Amazon |
|---|---|---|---|
| API | Retailer API v10/v11 (client credentials) | Open API v3 (OAuth 2.0 + PKCE) | Selling Partner API (LWA-refresh-token) |
| Aanbod | per poster × formaat, op **EAN** | per poster één listing, formaten als variatie | per poster × formaat, op **EAN** (aanbod op bestaande ASIN of volledige listing) |
| Orders | open FBR-orders → administratie | betaalde receipts → administratie | FBM-orders (Orders API 2026-01-01) → administratie |
| Verzending | track-and-trace + vervoerder → bol | track-and-trace → Etsy (mailt koper) | confirmShipment → Amazon |
| Extra | annuleringsverzoeken accepteren, factuurverzoeken beantwoorden met PDF | annuleringen/terugbetalingen overnemen | proefmodus = `VALIDATION_PREVIEW` |

- **Code**: `api/kanalen.js` (beheer + synchronisatie, één route) en `api/_kanalen/{bol,etsy,amazon,gemeen,opslag}.js`.
  Database: `supabase/migrations/20261029010000_kanalen.sql` (`kanaal_listings`, `kanaal_instellingen`,
  `poster_ean`, `kanaal_sync_log`, `etsy_koppeling`, functie `skiffa_importeer_kanaalorder`).
- **Orders van kanalen** komen in dezelfde administratie: nummer `BOL-…`/`ETS-…`/`AMA-…`, direct betaald,
  zelfde doorlopende factuurnummers, filter per kanaal, omzet per kanaal en in de CSV-export. De koper krijgt géén
  mails van ons (dat doet het kanaal); jij krijgt een melding. Verzenden in `/admin` met vervoerder en
  track-and-trace; de volgende synchronisatie geeft die door. Terugbetalen en annuleren gaan via het kanaal zelf.
- **Prijzen**: winkelprijs + instelbare opslag (commissie), afgerond op x,95 (15% → € 33,95 / € 51,95 / € 79,95).
- **Veilig starten**: elk kanaal staat uit en in proefmodus. In proefmodus wordt er niets naar het kanaal
  geschreven (wel opgehaald); je ziet in Beheer → Kanalen wat er verstuurd zou worden.
- **Automatisch**: `.github/workflows/kanalen-sync.yml` roept elke 15 minuten `/api/kanalen?actie=cron` aan
  (zet `CRON_SECRET` in Vercel én als GitHub-secret). Handmatig: "nu synchroniseren" in Beheer → Kanalen.
- **Beelden**: Etsy en Amazon accepteren geen WebP; `posters/<id>.jpg` wordt meegeleverd (`maak-beelden.py`).

**Wat je per kanaal nodig hebt**
1. **bol.com**: verkopersaccount, API-sleutels, en per poster × formaat een **EAN** (GS1 Nederland). Vul de EAN's in
   onder Beheer → Kanalen → assortiment (de controle op het GS1-controlecijfer zit erin).
2. **Etsy**: een Etsy-winkel en een app op etsy.com/developers (callback `https://skiffa.store/etsy/terug`). Klik
   "koppel Etsy", dan "profielen ophalen" en vul verzendprofiel, verwerkingsprofiel en categorie (taxonomy-id) in.
3. **Amazon**: Pro-verkopersaccount, een SP-API-app met refresh token en dezelfde EAN's (of een GTIN-vrijstelling
   voor merk Skiffa). Producttype standaard `POSTER`; Amazon meldt ontbrekende verplichte velden bij de listing.

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

Zie `.env.example` voor alle variabelen met uitleg (CMS, administratie, Mollie, Resend, bedrijfsgegevens).
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

