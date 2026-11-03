-- Engelse winkel: Engelse productteksten (leeg = de Nederlandse tekst) en de taal van een bestelling
-- (bepaalt de taal van de mails aan de klant en van de betaalpagina).
alter table public.producten add column if not exists titel_en text;
alter table public.producten add column if not exists stijl_en text;
alter table public.producten add column if not exists beschrijving_en text;
alter table public.bestellingen add column if not exists taal text not null default 'nl';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bestellingen_taal_check') then
    alter table public.bestellingen add constraint bestellingen_taal_check check (taal in ('nl', 'en'));
  end if;
end $$;
