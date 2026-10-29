-- Productie via Prodigi. Elke bestelling wordt hooguit één keer geproduceerd:
--   1. één fulfilmentregel per bestelling (unique op bestelling_id + herdruk_nr; herdruk_nr 0 = de
--      oorspronkelijke productie, 1, 2, … = expliciet bevestigde herdrukken);
--   2. alleen wie de regel via skiffa_claim_fulfilment() van 'wacht'/'opnieuw' naar 'bezig' zet, verstuurt;
--   3. elke poging gebruikt dezelfde idempotentiesleutel; bij een onduidelijk antwoord wordt eerst bij
--      Prodigi gezocht of de opdracht al bestaat (status 'onzeker' tot dat vaststaat).

alter table public.kanaal_instellingen drop constraint if exists kanaal_instellingen_kanaal_check;
alter table public.kanaal_instellingen add constraint kanaal_instellingen_kanaal_check
  check (kanaal in ('bol','etsy','amazon','prodigi','tiktok','meta','buffer'));

create table if not exists public.fulfilments (
  id                   bigint generated always as identity primary key,
  bestelling_id        uuid not null references public.bestellingen(id) on delete restrict,
  herdruk_nr           int not null default 0 check (herdruk_nr >= 0),
  herdruk_reden        text,
  aanbieder            text not null default 'prodigi' check (aanbieder in ('prodigi')),
  omgeving             text not null default 'sandbox' check (omgeving in ('sandbox','live')),
  status               text not null default 'wacht' check (status in
                         ('wacht','bezig','opnieuw','onzeker','verstuurd','in_productie','verzonden','geblokkeerd','fout','geannuleerd')),
  idempotentie_sleutel text not null unique,
  vanaf                timestamptz not null default now(),   -- tot dit moment kan de bestelling nog wijzigen
  pogingen             int not null default 0,
  geclaimd_op          timestamptz,
  extern_id            text unique,                          -- Prodigi-ordernummer (ord_…)
  extern_status        text,
  laatste_fout         text,
  vrijgegeven_reden    text,                                 -- bewust doorgezet ondanks bv. een terugbetaling
  branding             jsonb,                                -- gevraagde en geleverde merktoevoegingen
  kosten               jsonb,                                -- werkelijke kosten volgens Prodigi (charges)
  verstuurd_op         timestamptz,
  aangemaakt_op        timestamptz not null default now(),
  bijgewerkt_op        timestamptz not null default now(),
  unique (bestelling_id, herdruk_nr),
  check (herdruk_nr = 0 or length(coalesce(herdruk_reden, '')) >= 3)
);
create index if not exists fulfilments_open_idx on public.fulfilments (status, vanaf);

-- Proefbestellingen (betaald bij Prodigi, niet aan een klantbestelling gekoppeld): eerst offerte, dan
-- pas plaatsen na expliciete bevestiging; ook hooguit één keer per proefbestelling.
create table if not exists public.proefbestellingen (
  id                   uuid primary key default gen_random_uuid(),
  regels               jsonb not null,                       -- [{sku, aantal}]
  adres                jsonb not null,
  verzendmethode       text not null,
  omgeving             text not null check (omgeving in ('sandbox','live')),
  offerte              jsonb,
  status               text not null default 'offerte' check (status in ('offerte','bezig','geplaatst','fout','verlopen')),
  idempotentie_sleutel text not null unique,
  extern_id            text unique,
  laatste_fout         text,
  aangemaakt_op        timestamptz not null default now(),
  geplaatst_op         timestamptz
);

alter table public.fulfilments      enable row level security;
alter table public.proefbestellingen enable row level security;

-- Claim: atomair van wacht/opnieuw naar bezig. Oorspronkelijke productie alleen voor een betaalde,
-- niet-geannuleerde bestelling; een herdruk ook na verzending (maar niet na annulering).
create or replace function public.skiffa_claim_fulfilment(p_id bigint)
returns setof public.fulfilments
language sql security definer set search_path = public as $$
  update public.fulfilments f
     set status = 'bezig', geclaimd_op = now(), pogingen = f.pogingen + 1, bijgewerkt_op = now()
    from public.bestellingen b
   where f.id = p_id
     and b.id = f.bestelling_id
     and f.status in ('wacht','opnieuw')
     and f.vanaf <= now()
     and b.betaald_op is not null
     and ((f.herdruk_nr = 0 and b.status in ('betaald','in_productie'))
       or (f.herdruk_nr > 0 and b.status in ('betaald','in_productie','verzonden','geleverd')))
  returning f.*;
$$;

-- Vastgelopen claims (functie afgebroken tijdens het versturen) na 10 minuten op 'onzeker': de volgende
-- run controleert eerst bij Prodigi of de opdracht al bestaat.
create or replace function public.skiffa_vrijgeven_fulfilments()
returns int
language sql security definer set search_path = public as $$
  with x as (
    update public.fulfilments set status = 'onzeker', bijgewerkt_op = now()
     where status = 'bezig' and geclaimd_op < now() - interval '10 minutes'
    returning 1)
  select count(*)::int from x;
$$;

-- Claim voor het controleren van een onzekere opdracht (zelfde idee: maar één run tegelijk).
create or replace function public.skiffa_claim_onzeker(p_id bigint)
returns setof public.fulfilments
language sql security definer set search_path = public as $$
  update public.fulfilments f
     set status = 'bezig', geclaimd_op = now(), bijgewerkt_op = now()
   where f.id = p_id and f.status = 'onzeker'
  returning f.*;
$$;

revoke all on function public.skiffa_claim_fulfilment(bigint) from public;
revoke all on function public.skiffa_vrijgeven_fulfilments() from public;
revoke all on function public.skiffa_claim_onzeker(bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.skiffa_claim_fulfilment(bigint) from anon, authenticated;
    revoke all on function public.skiffa_vrijgeven_fulfilments() from anon, authenticated;
    revoke all on function public.skiffa_claim_onzeker(bigint) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.skiffa_claim_fulfilment(bigint) to service_role;
    grant execute on function public.skiffa_vrijgeven_fulfilments() to service_role;
    grant execute on function public.skiffa_claim_onzeker(bigint) to service_role;
  end if;
end $$;
