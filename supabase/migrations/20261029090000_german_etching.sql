-- Alle prints op Hahnemühle German Etching (Prodigi GLOBAL-HGE-*), opgezocht op 29 oktober 2026 in de live-API
-- van Prodigi (alleen productgegevens en offertes; er is niets besteld) en beoordeeld met beoordeelProduct().
--
--   30 × 40 cm   GLOBAL-HGE-12X16   304,8 × 406,4 mm (12 × 16 inch), drukbestand 3600 × 4800 px
--   50 × 70 cm   GLOBAL-HGE-20X28   508 × 711,2 mm (20 × 28 inch), drukbestand 6000 × 8400 px
--   70 × 100 cm  GLOBAL-HGE-28X40   711,2 × 1016 mm (28 × 40 inch), drukbestand 8400 × 12000 px
--   papier       Hahnemühle German Etching, 310 g/m² (paperType HGE, substrateWeight 310gsm)
--   kostprijs    1 stuk naar NL, Standard, excl. btw, incl. verzending: € 20,05 / € 31,05 / € 59,30
--
-- Mat art-papier (EMA) gaat uit de verkoop. De startvarianten verhuizen naar German Etching (SKU blijft gelijk) en
-- krijgen een nieuwe prijs (€ 39 / € 59 / € 99 incl. btw), alleen als die nog op de oude startprijs stond.
-- Varianten die je zelf al aan een ander Prodigi-artikel hebt gekoppeld, blijven ongemoeid.

insert into public.papiersoorten (id, naam, uitleg, gewicht_gsm, actief, volgorde) values
  ('german-etching', 'Hahnemühle German Etching', 'Fine-art papier van Hahnemühle, 310 g/m², met een fluweelachtige structuur. Mat, dus geen spiegeling van lampen of ramen; kleuren blijven diep en rustig.', 310, true, 5)
on conflict (id) do nothing;

update public.varianten set
    papier_id = 'german-etching',
    prijs = case when prijs = 29 then 39 else prijs end,
    prodigi_sku = 'GLOBAL-HGE-12X16', prodigi_attributen = '{"paperType":"HGE","substrateWeight":"310gsm"}'::jsonb,
    prodigi_status = 'bevestigd', prodigi_melding = null, prodigi_gecontroleerd_op = '2026-10-29T16:40:00Z',
    prodigi_product = '{"omschrijving":"Hahnemühle German Etching, 30x40cm / 12x16\"","mm":[304.8,406.4],"px":{"b":3600,"h":4800},"landen":["AD","AL","AM","AT","AX","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES","FI","FO","FR","GE","GI","GL","GR","HR","HU","IE","IM","IS","IT","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK","SM","TR","UA","VA","XK","AE","AF","AG","AI","AN","AO","AR","AS","AU","AW","AZ","BB","BD","BF","BH","BI","BJ","BL","BM","BN","BO","BR","BS","BT","BW","BZ","CA","CF","CG","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","DJ","DM","DO","DZ","EC","EG","ER","ET","FJ","FK","FM","GA","GB","GD","GF","GG","GH","GM","GN","GP","GQ","GT","GU","GW","GY","HK","HN","HT","ID","IL","IN","IQ","IR","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LK","LR","LS","LY","MA","MF","MG","MH","ML","MM","MN","MO","MP","MQ","MR","MS","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PM","PR","PS","PW","PY","QA","RE","RW","SA","SB","SC","SD","SG","SL","SN","SO","SR","ST","SV","SY","SZ","TC","TD","TG","TH","TJ","TL","TM","TN","TO","TT","TV","TW","TZ","UG","US","UY","UZ","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW","CD","SH","SX"],"opties":{"paperType":["HGE"],"substrateWeight":["310gsm"]},"omgeving":"live"}'::jsonb,
    kosten = '{"methode":"Standard","valuta":"EUR","artikel":12,"verzending":8.05,"merk":0,"btw":4.01,"totaal":24.06,"vervoerder":"EVRi EVRi International","productielocatie":"NL","merk_gevraagd":[],"merk_geleverd":[],"land":"NL","omgeving":"live"}'::jsonb, kostprijs = 20.05, kosten_gecontroleerd_op = '2026-10-29T16:40:00Z', bijgewerkt_op = now()
  where formaat_id = '30x40' and papier_id = 'mat' and lijst is null
    and (prodigi_sku is null or prodigi_sku = 'GLOBAL-FAP-12X16')
    and not exists (select 1 from public.varianten w where w.product_id = varianten.product_id and w.formaat_id = '30x40' and w.papier_id = 'german-etching' and w.lijst is null);

update public.varianten set
    papier_id = 'german-etching',
    prijs = case when prijs = 45 then 59 else prijs end,
    prodigi_sku = 'GLOBAL-HGE-20X28', prodigi_attributen = '{"paperType":"HGE","substrateWeight":"310gsm"}'::jsonb,
    prodigi_status = 'bevestigd', prodigi_melding = null, prodigi_gecontroleerd_op = '2026-10-29T16:40:00Z',
    prodigi_product = '{"omschrijving":"Hahnemühle German Etching, 50x70cm / 20x28\"","mm":[508,711.2],"px":{"b":6000,"h":8400},"landen":["AD","AL","AM","AT","AX","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES","FI","FO","FR","GE","GI","GL","GR","HR","HU","IE","IM","IS","IT","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK","SM","TR","UA","VA","XK","AE","AF","AG","AI","AN","AO","AR","AS","AU","AW","AZ","BB","BD","BF","BH","BI","BJ","BL","BM","BN","BO","BR","BS","BT","BW","BZ","CA","CF","CG","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","DJ","DM","DO","DZ","EC","EG","ER","ET","FJ","FK","FM","GA","GB","GD","GF","GG","GH","GM","GN","GP","GQ","GT","GU","GW","GY","HK","HN","HT","ID","IL","IN","IQ","IR","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LK","LR","LS","LY","MA","MF","MG","MH","ML","MM","MN","MO","MP","MQ","MR","MS","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PM","PR","PS","PW","PY","QA","RE","RW","SA","SB","SC","SD","SG","SL","SN","SO","SR","ST","SV","SY","SZ","TC","TD","TG","TH","TJ","TL","TM","TN","TO","TT","TV","TW","TZ","UG","US","UY","UZ","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW","CD","SH","SX"],"opties":{"paperType":["HGE"],"substrateWeight":["310gsm"]},"omgeving":"live"}'::jsonb,
    kosten = '{"methode":"Standard","valuta":"EUR","artikel":23,"verzending":8.05,"merk":0,"btw":6.21,"totaal":37.26,"vervoerder":"Spring Packet Tracked","productielocatie":"NL","merk_gevraagd":[],"merk_geleverd":[],"land":"NL","omgeving":"live"}'::jsonb, kostprijs = 31.05, kosten_gecontroleerd_op = '2026-10-29T16:40:00Z', bijgewerkt_op = now()
  where formaat_id = '50x70' and papier_id = 'mat' and lijst is null
    and (prodigi_sku is null or prodigi_sku = 'GLOBAL-FAP-20X28')
    and not exists (select 1 from public.varianten w where w.product_id = varianten.product_id and w.formaat_id = '50x70' and w.papier_id = 'german-etching' and w.lijst is null);

update public.varianten set
    papier_id = 'german-etching',
    prijs = case when prijs = 69 then 99 else prijs end,
    prodigi_sku = 'GLOBAL-HGE-28X40', prodigi_attributen = '{"paperType":"HGE","substrateWeight":"310gsm"}'::jsonb,
    prodigi_status = 'bevestigd', prodigi_melding = null, prodigi_gecontroleerd_op = '2026-10-29T16:40:00Z',
    prodigi_product = '{"omschrijving":"Hahnemühle German Etching, 70x100cm / 28x40\"","mm":[711.2,1016],"px":{"b":8400,"h":12000},"landen":["AD","AL","AT","AX","BA","BE","BG","CH","CY","CZ","DE","DK","EE","ES","FI","FR","GE","GR","HR","HU","IE","IM","IT","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK","TR","UA","VA","AE","AF","AG","AI","AM","AN","AO","AR","AS","AU","AW","AZ","BB","BD","BF","BH","BI","BJ","BL","BM","BN","BO","BR","BS","BT","BW","BY","BZ","CA","CF","CG","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","DJ","DM","DO","DZ","EC","EG","ER","ET","FJ","FK","FM","FO","GA","GB","GD","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GT","GU","GW","GY","HK","HN","HT","ID","IL","IN","IQ","IR","IS","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LK","LR","LS","LY","MA","MF","MG","MH","ML","MM","MN","MO","MP","MQ","MR","MS","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PM","PR","PS","PW","PY","QA","RE","RW","SA","SB","SC","SD","SG","SL","SM","SN","SO","SR","ST","SV","SY","SZ","TC","TD","TG","TH","TJ","TL","TM","TN","TO","TT","TV","TW","TZ","UG","US","UY","UZ","VC","VE","VG","VI","VN","VU","WF","WS","XK","YE","YT","ZA","ZM","ZW","CD","SH","SX"],"opties":{"paperType":["HGE"],"substrateWeight":["310gsm"]},"omgeving":"live"}'::jsonb,
    kosten = '{"methode":"Standard","valuta":"EUR","artikel":48,"verzending":11.3,"merk":0,"btw":11.86,"totaal":71.16,"vervoerder":"DPD NL DPD NL Classic","productielocatie":"NL","merk_gevraagd":[],"merk_geleverd":[],"land":"NL","omgeving":"live"}'::jsonb, kostprijs = 59.3, kosten_gecontroleerd_op = '2026-10-29T16:40:00Z', bijgewerkt_op = now()
  where formaat_id = '70x100' and papier_id = 'mat' and lijst is null
    and (prodigi_sku is null or prodigi_sku = 'GLOBAL-FAP-28X40')
    and not exists (select 1 from public.varianten w where w.product_id = varianten.product_id and w.formaat_id = '70x100' and w.papier_id = 'german-etching' and w.lijst is null);

-- Mat art-papier niet meer te koop (bestaande bestellingen houden hun papier).
update public.papiersoorten set actief = false where id = 'mat';
update public.varianten set actief = false where papier_id = 'mat';
