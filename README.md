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
- **Nieuwe poster toevoegen**: met database in /admin → producten (zie hieronder). Zonder database:
  `python3 scripts/maak-beelden.py <bestand> <id>`, in `index.html` `actief:true` zetten en de id toevoegen aan `api/_catalogus.js`.
- **Mandje**: wordt in de browser bewaard (`localStorage`).
- **Afrekenen**: zie [Webshop en administratie](#webshop-en-administratie).

## Centrale catalogus (één keer invoeren)

Een poster voer je één keer in bij **/admin → producten**; webshop, kanalen en productie lezen dezelfde gegevens
(migratie `20261029030000_catalogus.sql`, code `api/_catalogus.js`, `api/catalogus.js`, `beheer/producten.js`).

- **Product**: interne naam, productcode (`SKF-001` …), verkooptitel, beschrijving, stijlregel, collectie, onderwerp,
  kleuren, zoekwoorden, SEO-titel en -beschrijving, URL (`/#<id>`, staat vast) en status: concept → gereed voor
  publicatie → actief → gearchiveerd. Gereed/actief kan pas als minstens één variant klaar is voor verkoop.
- **Varianten**: formaat × papiersoort (later ook lijst). Elke variant heeft een eigen SKU, verkoopprijs, kostprijs,
  levertijd, drukbestand en gekoppeld Prodigi-product. Formaten en papiersoorten (met uitleg voor de klant) beheer
  je onder "formaten en papier".
- **Bestelbaar** is een variant pas als: poster actief, variant/formaat/papier actief, prijs ingevuld, leverbaar
  bevestigd (Prodigi-product gecontroleerd; zonder Prodigi alleen "handmatig leverbaar" met reden) en een
  drukbestand dat de verplichte controles doorstond, of een gemotiveerde uitzondering. Wat ontbreekt staat per variant
  in gewone taal. De webshop toont alleen bestelbare varianten.
- **Beelden**: productfoto's, interieur-mock-ups, detail- en papierbeelden (max. 30, openbaar), optioneel per formaat of
  papiersoort; de webshop wisselt ze mee bij de keuze.
- **Vaste kopie bij bestelling**: elke bestelregel bewaart SKU, papier, prijs, drukbestandversie, Prodigi-product,
  opties en kostprijs. Latere wijzigingen veranderen een bestaande bestelling niet.
- Zonder database (of met lege tabellen) geldt de catalogus in de code: elke poster in elk formaat op mat papier.
  **Let op**: na het koppelen van Supabase toont de winkel alleen wat bestelbaar is; regel per variant eerst het
  drukbestand en de leverbaarheid.

## Drukbestanden en controle

- Per variant een eigen drukbestand (jpg, png of pdf) in de **privé** bucket `drukbestanden`, met versienummer. Downloaden
  kan alleen ingelogd (kortlevende link) of via een ondertekende link in de mail aan de drukker; Prodigi krijgt een
  tijdelijke link.
- Bij elke upload controleert de **server zelf** (eerste bytes van het bestand) type, leesbaarheid en pixelmaten; de
  browser meet alleen aanvullend. Controles: bestandstype, leesbaarheid, oriëntatie, beeldverhouding, resolutie op het
  formaat, en de pixeleis van het gekoppelde Prodigi-product. Pdf's moeten precies passen (Prodigi schaalt ze niet).
- Er wordt nooit stilzwijgend bijgesneden of vervormd: per variant kies je "passend" (witte rand) of "vullend" (bijsnijden,
  alleen met uitzondering). "Toon uitsnede op het papier" laat precies zien wat er op het papier komt.
- Meerdere bestanden tegelijk: sleep ze naar het vak in /admin → producten; de naam koppelt (`golf-50x70.png`,
  `golf-50x70-mat.pdf`, `golf-1.jpg` voor beelden).
- `python3 scripts/maak-drukbestanden.py <bron> <poster-id>` maakt jpg's op ware grootte voor alle formaten (bijgesneden vanuit
  het midden, of `--passend` met wit; `--pdf` voor pdf met afloop). Formaten 30×40 (3:4), 50×70 (5:7) en 70×100 (7:10)
  hebben elk een andere verhouding dan de 2:3-posters: een eigen ontwerp per formaat is beter.

## Prodigi: printen, verpakken en verzenden

Eén route naar productie: elke betaalde bestelling (webshop of kanaal) gaat vanuit SKIFFA **hooguit één keer** naar
Prodigi (`api/_prodigi.js`, `api/prodigi.js`, migratie `20261029040000_prodigi.sql`). Instellingen in **/admin → kanalen →
Prodigi**; per variant in **/admin → producten**.

- **Productcontrole**: "controleer bij Prodigi" vraagt het product op (`GET /products/{sku}`): bestaat het, kloppen de
  opties, de productiemaat (moet overeenkomen met het formaat), de pixeleis en levering naar NL/BE. Pas dan heet een
  variant leverbaar; het drukbestand wordt daarna aan de pixeleis getoetst.
- **Kosten**: "kosten ophalen" haalt een actuele offerte (`POST /quotes`): artikel, verzending, merktoevoegingen, btw,
  vervoerder en of je merktoevoegingen leverbaar zijn. De kostprijs (excl. btw) wordt opgeslagen met datum.
- **Proefbestelling**: toont eerst kosten en afleveradres; pas na expliciete bevestiging wordt hij geplaatst (in live is
  dat een betaalde bestelling). Een offerte is 30 minuten geldig en wordt maar één keer geplaatst.
- **Automatische productie**: na betaling (of import van een kanaalorder) een regel in `fulfilments` met wachttijd
  ("wijzigen kan tot …"). Vóór versturen: betaling bevestigd, adres compleet, varianten gekoppeld, juiste
  drukbestandversie aanwezig, niet geannuleerd/geblokkeerd. Atomaire claim, vaste idempotentiesleutel per bestelling.
  Bij een onduidelijk antwoord (time-out, 5xx) wordt de opdracht **onzeker** en zoekt de volgende run eerst bij Prodigi
  (`GET /orders?merchantReferences=`) of hij al bestaat, voordat er opnieuw wordt besteld.
- **Merktoevoegingen** (sticker, kaartje, pakbon): ontwerp-URL per toevoeging, verplicht ja/nee, en beleid als een
  verplichte toevoeging niet leverbaar is: blokkeren voor beoordeling, goedgekeurd alternatief, of zonder (expliciet
  toegestaan). Per zending gecontroleerd via een offerte; een voorkeur is geen garantie.
- **Terugkoppeling**: statusmeldingen op `/api/prodigi?actie=callback&t=<token>`; de opdracht wordt altijd opnieuw bij
  Prodigi opgevraagd. Verzonden → tracking in de administratie, klantmail (webshop) of door naar het kanaal. Werkelijke
  kosten (charges) worden bewaard. Vangnet: de cron vraagt open opdrachten elk uur op.
- **Terugbetalen ≠ annuleren**: een terugbetaling houdt een nog niet verstuurde productie tegen tot je beslist ("toch
  produceren" met reden, of productie annuleren). Annuleren bij Prodigi kan zolang Prodigi dat toestaat.
- **Herdruk**: een nieuwe, expliciet bevestigde opdracht bij dezelfde bestelling, met eigen sleutel.
- **Omgevingen**: sandbox (`PRODIGI_SANDBOX_API_KEY`, er wordt niets gedrukt) en live (`PRODIGI_API_KEY`); een proefopdracht
  kan na live zetten één keer live worden verstuurd, een live-opdracht nooit opnieuw.

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
supabase db push            # past de migraties in supabase/migrations toe (webshop, kanalen, media, catalogus, prodigi; nog op geen enkele database toegepast)
```

Zet daarna in Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_WACHTWOORD`, `MOLLIE_API_KEY`,
`RESEND_API_KEY`, `RESEND_FROM` (op een in Resend geverifieerd domein), `BESTEL_EMAIL`, `SITE_URL`, `BEDRIJF_*` en
eventueel `DRUKKER_EMAIL` en `PRODIGI_SANDBOX_API_KEY` / `PRODIGI_API_KEY`. Grote pdf's: verhoog in Supabase (Storage → Settings) de uploadlimiet; op het gratis plan
is die 50 MB per bestand.

**Testen**: `npm test` (catalogus, de hele bestelstroom, de drie kanalen, drukbestanden/visuals, de centrale catalogus en Prodigi, met nagebootste Supabase, Storage, Mollie, Resend, bol, Etsy, Amazon en Prodigi).

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
  geschreven (wel opgehaald); je ziet in Beheer → Koppelingen wat er verstuurd zou worden.
- **Automatisch**: `.github/workflows/kanalen-sync.yml` roept elke 15 minuten `/api/kanalen?actie=cron` aan
  (zet `CRON_SECRET` in Vercel én als GitHub-secret). Handmatig: "nu synchroniseren" in Beheer → Koppelingen.
- **Beelden**: Etsy en Amazon accepteren geen WebP; `posters/<id>.jpg` wordt meegeleverd (`maak-beelden.py`).

**Wat je per kanaal nodig hebt**
1. **bol.com**: verkopersaccount, API-sleutels, en per poster × formaat een **EAN** (GS1 Nederland). Vul de EAN's in
   onder Beheer → Koppelingen → assortiment (de controle op het GS1-controlecijfer zit erin).
2. **Etsy**: een Etsy-winkel en een app op etsy.com/developers (callback `https://skiffa.store/etsy/terug`). Klik
   "koppel Etsy", dan "profielen ophalen" en vul verzendprofiel, verwerkingsprofiel en categorie (taxonomy-id) in.
3. **Amazon**: Pro-verkopersaccount, een SP-API-app met refresh token en dezelfde EAN's (of een GTIN-vrijstelling
   voor merk Skiffa). Producttype standaard `POSTER`; Amazon meldt ontbrekende verplichte velden bij de listing.

## Publiceren per kanaal (Beheer → Verkoopkanalen)

Eén product, één keer ingevoerd; per kanaal vink je aan of het daar verschijnt.

- **Kanalen**: SKIFFA-webshop en Etsy zijn per product te publiceren. bol.com en Amazon werken per variant met EAN
  (Beheer → Koppelingen → assortiment). eBay en TikTok Shop staan er eerlijk bij als "geen koppeling": er wordt
  niets naartoe gestuurd.
- **Statussen**: Niet gepubliceerd · Onvolledig (melding zegt wat ontbreekt) · Gereed · Wordt verwerkt · Actief
  (met link en tijdstip van de laatste synchronisatie) · Fout (met uitleg).
- **Sjablonen en afwijkingen**: kanaalinstellingen < sjabloon < afwijkingen per product (titel, beschrijving, taal,
  categorie, tags, foto's, prijsregel). Leeg = de centrale gegevens gelden.
- **Prijsregels**: zelfde als basisprijs, + vast bedrag, + percentage (optioneel afgerond op ,95) of handmatig per
  variant. De prijs per variant staat bij de afwijkingen.
- **Geen dubbele advertenties**: "aanmaken" maakt een nieuwe Etsy-advertentie, "bijwerken" past de bestaande aan.
  De verwerking wordt geclaimd (één tegelijk); na een onderbreking wordt een al aangemaakte advertentie
  teruggevonden via de tag `skf-<code>` en overgenomen in plaats van opnieuw aangemaakt. Uitvinken haalt de
  advertentie offline (inactief), verwijdert niets.
- **Automatisch publiceren** staat standaard uit (Koppelingen → Etsy). Uit = alleen via de knop.
  Tabellen: `product_kanalen`, `kanaal_sjablonen` (`supabase/migrations/20261029050000_publicatie_zendingen.sql`).

## Zendingen en tracking

- Een bestelling kan in **meerdere zendingen** gaan (tabel `zendingen`, één rij per pakket, met regels, vervoerder
  en track-and-trace). Status `deels_verzonden` tot alle regels onderweg zijn.
- Prodigi-zendingen komen binnen via de callback; handmatig: in het bestelpaneel vervoerder + code invullen en
  aanvinken welke regels in het pakket zitten.
- **Webshop**: per zending precies één mail in SKIFFA-stijl (geclaimd vóór verzending, dus ook bij dubbele
  callbacks niet twee keer); zonder code staat er geen tracking in de mail.
- **Kanalen**: elke zending wordt apart aan het oorspronkelijke kanaal gemeld (Etsy, bol, Amazon), met
  herhaalpogingen en de foutmelding in het bestelpaneel.
- Het bestelpaneel toont **betaling, productie en verzending los van elkaar**: een terugbetaling stopt de productie
  niet automatisch (annuleer die apart). Herdruk = een nieuwe, expliciet bevestigde productieopdracht met reden.

## Dashboard, actielijst en service (Beheer → dashboard)

- **Actielijst** bovenaan: mislukte of geblokkeerde productie (met "opnieuw proberen"), bestellingen die langer dan
  7 dagen betaald maar niet verzonden zijn, tracking die niet aan het kanaal is doorgegeven ("opnieuw doorgeven"
  na 5 mislukte pogingen), publicatiefouten, mislukte synchronisaties, open serviceverzoeken, en terugbetaalde
  bestellingen waarvan de productie nog op een besluit wacht. Een melding afvinken (met notitie) verbergt haar
  tot er iets verandert.
- **Cijfers per periode**: bestellingen, omzet excl. btw, productiekosten, resultaat na productie, per kanaal, per
  dag, populaire ontwerpen/formaten/papier. Alleen echte, betaalde bestellingen; zonder data staat er "geen
  bestellingen" en niets verzonnens.
- **Marge** (ook per bestelling in het paneel): werkelijk = wat Prodigi factureerde (excl. btw, incl. herdrukken);
  anders een schatting op basis van de kostprijs die bij het bestellen is vastgelegd. Niet meegerekend:
  Mollie-kosten, kanaalcommissie en eigen verpakking (staat ook op het dashboard).
- **Serviceverzoeken** (annulering, schade, retour, klacht) per bestelling, met foto's in de privé-bucket
  (alleen via tijdelijke links). Afsluiten vraagt een oplossing; afwijzen vraagt een reden. De oplossing zelf
  (terugbetalen, herdruk, annuleren) is altijd een aparte, bevestigde actie.
- **Klant**: op de statuspagina kan een webshopklant annulering *aanvragen* zolang de bestelling betaald of in
  productie is. Dat wordt een serviceverzoek en een mail aan de winkel, geen automatische annulering. Tracking
  verschijnt pas als er een code is, per zending. Schadefoto's stuurt de klant (nog) per mail; jij voegt ze toe.
  Tabellen: `serviceverzoeken`, `actie_afgehandeld` (`supabase/migrations/20261029060000_service.sql`).

## Social via Buffer (Beheer → social)

- **Accounts** koppel je in Buffer zelf; "accounts ophalen" haalt ze op (met status: actief, ontkoppeld, vergrendeld,
  gepauzeerd). Per account kies je of SKIFFA erop mag plannen. Geen inbox en geen statistieken.
- **Contentstudio**: één bericht met een basistekst (`{link}` = campagnelink naar het product met UTM-codes),
  media (openbaar en blijvend; Buffer haalt ze pas bij plaatsing op) en per account een eigen variant: tekst,
  soort (post/reel/story), tijdstip in Europe/Amsterdam en publicatiewijze. "Voorbeeld" toont per account de
  definitieve tekst, de lengte tegen de limiet en wat er ontbreekt, zonder iets te versturen.
- **Automatisch of afronden op telefoon**: automatisch = Buffer plaatst zelf. Telefoon = Buffer stuurt een
  herinnering; die staat als "herinnering" en wordt **nooit** als geplaatst getoond, tot Buffer meldt dat je het
  als gepubliceerd hebt gemarkeerd of jij hier op "ik heb het geplaatst" klikt.
- **Hoogstens één keer**: elk account krijgt een taak met een unieke sleutel (`publishing_jobs`), geclaimd door één
  verwerker. Bij een onduidelijk antwoord (time-out, serverfout) zoekt SKIFFA eerst in Buffer of het bericht er al
  staat en neemt het dan over; alleen als het er niet is, wordt het één keer opnieuw verstuurd.
- **Maak socialmediabericht**: knop bij elk product (Beheer → producten) maakt een concept met tekst, beelden en de
  actieve accounts.
- **Aan/uit**: social staat los aan/uit en heeft een eigen proefmodus. De cron (elke 15 minuten) verwerkt taken en
  haalt statussen op; mislukte berichten, herinneringen en ontkoppelde accounts staan op de actielijst.

## Meta-productfeed (Facebook / Instagram)

- Feed-URL: `https://skiffa.store/api/catalogus?actie=feed&kanaal=meta`: RSS-XML met `g:`-velden volgens de
  Meta-specificatie (gecontroleerd oktober 2026). Eén item per bestelbare variant: id = SKU, item_group_id per
  poster, size = formaat, material = papier, prijs als `49.95 EUR`, brand SKIFFA, hoofdbeeld als jpg/png.
- In Commerce Manager: Catalogus → Gegevensbronnen → Gegevensfeed → gepland (bv. dagelijks) met deze URL.
- Beheer → koppelingen toont per variant wat ontbreekt (onvolledige items gaan niet in de feed), laat je varianten
  uitsluiten, controleert of de feed bereikbaar is en waarschuwt als Meta de feed nooit of meer dan 48 uur geleden
  ophaalde. Goedkeuring per item (goedgekeurd/afgekeurd met reden) alleen met `META_TOKEN` + `META_CATALOG_ID`.
- Meta biedt geen afrekenen op Facebook/Instagram meer: kopers rekenen af op skiffa.store.

## TikTok Shop

- Vraagt een TikTok Shop-verkopersaccount (Nederland sinds juni 2026) en een eigen app in TikTok Partner Center
  (`TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID`, callback `https://skiffa.store/tiktok/terug`).
  Daarna "koppel TikTok Shop" onder Koppelingen.
- **Orders**: alleen orders met status AWAITING_SHIPMENT (betaald en buiten de annuleringstermijn) worden
  geïmporteerd, idempotent, met een vaste kopie van de variant; daarna gaan ze de normale productieroute in.
- **Annuleringen**: een verzoek van de koper komt als serviceverzoek op de actielijst (jij beslist; goedkeuren of
  weigeren gaat met een idempotency-sleutel). Afgeronde annuleringen worden overgenomen.
- **Tracking**: per pakket, met eigen vervoerder uit de TikTok-lijst voor die order; staat je vervoerder er niet
  in, dan meldt SKIFFA dat in plaats van te gokken.
- **Producten**: SKIFFA maakt per poster een **concept** (beelden, varianten, EUR-prijzen, magazijn). Afronden en
  indienen doe je in Seller Center; daarna volgt SKIFFA de beoordeling (afgekeurd = melding met reden).
- Niets hiervan is getest tegen de echte TikTok-API; begin met de proefmodus.

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

