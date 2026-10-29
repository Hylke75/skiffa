-- Prodigi-producten voor de startcatalogus, opgezocht op 29 oktober 2026 in de live-API van Prodigi (alleen
-- productgegevens en offertes; er is niets besteld) en beoordeeld met beoordeelProduct() uit api/_prodigi.js.
--
--   30 × 40 cm   GLOBAL-FAP-12X16   productiemaat 304,8 × 406,4 mm (12 × 16 inch), drukbestand 3600 × 4800 px
--   50 × 70 cm   GLOBAL-FAP-20X28   productiemaat 508 × 711,2 mm (20 × 28 inch), drukbestand 6000 × 8400 px
--   70 × 100 cm  GLOBAL-FAP-28X40   productiemaat 711,2 × 1016 mm (28 × 40 inch), drukbestand 8400 × 12000 px
--   papier       EMA, Enhanced Matte Art Paper, 200 g/m² (niet 250 g/m² zoals eerst vermeld)
--   kostprijs    1 stuk naar NL, Standard, excl. btw: € 15,05 / € 20,05 / € 33,30 (incl. verzending)
--
-- De formaten krijgen de echte productiemaat (de klant ziet "exact 30,5 × 40,6 cm"); het label blijft 30 × 40 cm,
-- zoals Prodigi het zelf noemt. Varianten waar al een Prodigi-artikel op staat, blijven ongemoeid.
-- Kosten veranderen: gebruik "kosten ophalen" in /admin om ze te verversen.

update public.formaten set breedte_mm = 304.8, hoogte_mm = 406.4 where id = '30x40' and breedte_mm = 300;
update public.formaten set breedte_mm = 508,   hoogte_mm = 711.2 where id = '50x70' and breedte_mm = 500;
update public.formaten set breedte_mm = 711.2, hoogte_mm = 1016  where id = '70x100' and breedte_mm = 700;

update public.papiersoorten set
    naam = 'Mat art-papier',
    uitleg = 'Enhanced Matte Art Paper van 200 g/m²: mat, zonder glans, dus geen spiegeling van lampen of ramen. Kleuren blijven rustig en diep.',
    gewicht_gsm = 200
  where id = 'mat' and gewicht_gsm = 250;

update public.varianten set
    prodigi_sku = 'GLOBAL-FAP-12X16', prodigi_attributen = '{"paperType":"EMA","substrateWeight":"200gsm"}'::jsonb,
    prodigi_status = 'bevestigd', prodigi_melding = null, prodigi_gecontroleerd_op = '2026-10-29T12:30:00Z',
    prodigi_product = '{"omschrijving":"EMA, Enhanced Matte Art Paper, 200gsm, 30x40cm / 12x16\"","mm":[304.8,406.4],"px":{"b":3600,"h":4800},"landen":["AD","AL","AM","AT","AX","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES","FI","FO","FR","GE","GI","GL","GR","HR","HU","IE","IM","IS","IT","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK","SM","TR","UA","VA","XK","AE","AF","AG","AI","AN","AO","AR","AS","AU","AW","AZ","BB","BD","BF","BH","BI","BJ","BL","BM","BN","BO","BR","BS","BT","BW","BZ","CA","CF","CG","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","DJ","DM","DO","DZ","EC","EG","ER","ET","FJ","FK","FM","GA","GB","GD","GF","GG","GH","GM","GN","GP","GQ","GT","GU","GW","GY","HK","HN","HT","ID","IL","IN","IQ","IR","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LK","LR","LS","LY","MA","MF","MG","MH","ML","MM","MN","MO","MP","MQ","MR","MS","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PM","PR","PS","PW","PY","QA","RE","RW","SA","SB","SC","SD","SG","SL","SN","SO","SR","ST","SV","SY","SZ","TC","TD","TG","TH","TJ","TL","TM","TN","TO","TT","TV","TW","TZ","UG","US","UY","UZ","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW","CD","SH","SX"],"opties":{"paperType":["EMA"],"substrateWeight":["200gsm"]},"omgeving":"live"}'::jsonb,
    kosten = '{"methode":"Standard","valuta":"EUR","artikel":7,"verzending":8.05,"merk":0,"btw":3.01,"totaal":18.06,"vervoerder":"EVRi EVRi International","productielocatie":"NL","merk_gevraagd":[],"merk_geleverd":[],"land":"NL","omgeving":"live"}'::jsonb, kostprijs = 15.05, kosten_gecontroleerd_op = '2026-10-29T12:30:00Z', bijgewerkt_op = now()
  where formaat_id = '30x40' and papier_id = 'mat' and lijst is null and prodigi_sku is null;
update public.varianten set
    prodigi_sku = 'GLOBAL-FAP-20X28', prodigi_attributen = '{"paperType":"EMA","substrateWeight":"200gsm"}'::jsonb,
    prodigi_status = 'bevestigd', prodigi_melding = null, prodigi_gecontroleerd_op = '2026-10-29T12:30:00Z',
    prodigi_product = '{"omschrijving":"EMA, Enhanced Matte Art Paper, 200gsm, 50x70cm / 20x28\"","mm":[508,711.2],"px":{"b":6000,"h":8400},"landen":["AD","AL","AM","AT","AX","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES","FI","FO","FR","GE","GI","GL","GR","HR","HU","IE","IM","IS","IT","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK","SM","TR","UA","VA","XK","AE","AF","AG","AI","AN","AO","AR","AS","AU","AW","AZ","BB","BD","BF","BH","BI","BJ","BL","BM","BN","BO","BR","BS","BT","BW","BZ","CA","CF","CG","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","DJ","DM","DO","DZ","EC","EG","ER","ET","FJ","FK","FM","GA","GB","GD","GF","GG","GH","GM","GN","GP","GQ","GT","GU","GW","GY","HK","HN","HT","ID","IL","IN","IQ","IR","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LK","LR","LS","LY","MA","MF","MG","MH","ML","MM","MN","MO","MP","MQ","MR","MS","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PM","PR","PS","PW","PY","QA","RE","RW","SA","SB","SC","SD","SG","SL","SN","SO","SR","ST","SV","SY","SZ","TC","TD","TG","TH","TJ","TL","TM","TN","TO","TT","TV","TW","TZ","UG","US","UY","UZ","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW","CD","SH","SX"],"opties":{"paperType":["EMA"],"substrateWeight":["200gsm"]},"omgeving":"live"}'::jsonb,
    kosten = '{"methode":"Standard","valuta":"EUR","artikel":12,"verzending":8.05,"merk":0,"btw":4.01,"totaal":24.06,"vervoerder":"Spring Packet Tracked","productielocatie":"NL","merk_gevraagd":[],"merk_geleverd":[],"land":"NL","omgeving":"live"}'::jsonb, kostprijs = 20.05, kosten_gecontroleerd_op = '2026-10-29T12:30:00Z', bijgewerkt_op = now()
  where formaat_id = '50x70' and papier_id = 'mat' and lijst is null and prodigi_sku is null;
update public.varianten set
    prodigi_sku = 'GLOBAL-FAP-28X40', prodigi_attributen = '{"paperType":"EMA","substrateWeight":"200gsm"}'::jsonb,
    prodigi_status = 'bevestigd', prodigi_melding = null, prodigi_gecontroleerd_op = '2026-10-29T12:30:00Z',
    prodigi_product = '{"omschrijving":"EMA, Enhanced Matte Art Paper, 200gsm, 70x100cm / 28x40\"","mm":[711.2,1016],"px":{"b":8400,"h":12000},"landen":["AD","AL","AT","AX","BA","BE","BG","CH","CY","CZ","DE","DK","EE","ES","FI","FR","GE","GR","HR","HU","IE","IM","IT","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK","TR","UA","VA","AE","AF","AG","AI","AM","AN","AO","AR","AS","AU","AW","AZ","BB","BD","BF","BH","BI","BJ","BL","BM","BN","BO","BR","BS","BT","BW","BY","BZ","CA","CF","CG","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","DJ","DM","DO","DZ","EC","EG","ER","ET","FJ","FK","FM","FO","GA","GB","GD","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GT","GU","GW","GY","HK","HN","HT","ID","IL","IN","IQ","IR","IS","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LK","LR","LS","LY","MA","MF","MG","MH","ML","MM","MN","MO","MP","MQ","MR","MS","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PM","PR","PS","PW","PY","QA","RE","RW","SA","SB","SC","SD","SG","SL","SM","SN","SO","SR","ST","SV","SY","SZ","TC","TD","TG","TH","TJ","TL","TM","TN","TO","TT","TV","TW","TZ","UG","US","UY","UZ","VC","VE","VG","VI","VN","VU","WF","WS","XK","YE","YT","ZA","ZM","ZW","CD","SH","SX"],"opties":{"paperType":["EMA"],"substrateWeight":["200gsm"]},"omgeving":"live"}'::jsonb,
    kosten = '{"methode":"Standard","valuta":"EUR","artikel":22,"verzending":11.3,"merk":0,"btw":6.66,"totaal":39.96,"vervoerder":"DPD NL DPD NL Classic","productielocatie":"NL","merk_gevraagd":[],"merk_geleverd":[],"land":"NL","omgeving":"live"}'::jsonb, kostprijs = 33.3, kosten_gecontroleerd_op = '2026-10-29T12:30:00Z', bijgewerkt_op = now()
  where formaat_id = '70x100' and papier_id = 'mat' and lijst is null and prodigi_sku is null;
