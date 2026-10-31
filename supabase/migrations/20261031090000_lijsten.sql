-- Lijsten (Prodigi Classic-lijst, zonder passe-partout, acrylaat ervoor) als variant van een poster.
-- Een ingelijste variant heeft lijst = 'classic' en lijst_kleur = de Prodigi-kleur. Hij wordt op EMA (papier 'mat')
-- gedrukt en gebruikt het drukbestand van de losse poster in hetzelfde formaat (zie api/_catalogus.js).
alter table public.varianten drop constraint if exists varianten_lijst_check;
alter table public.varianten add constraint varianten_lijst_check
  check ((lijst is null and lijst_kleur is null) or (lijst = 'classic' and lijst_kleur in ('black','white','natural','brown')));
alter table public.bestelregels add column if not exists lijst_kleur text;
-- EMA moet bestaan als papiersoort voor ingelijste varianten (niet te koop als los papier).
insert into public.papiersoorten (id, naam, uitleg, gewicht_gsm, actief, volgorde)
values ('mat', 'Mat art-papier', 'Enhanced Matte Art Paper van 200 g/m²: mat, zonder glans. Gebruikt voor ingelijste posters.', 200, false, 90)
on conflict (id) do nothing;
