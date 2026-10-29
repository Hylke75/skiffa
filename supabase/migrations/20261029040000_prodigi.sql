-- Fulfilment via Prodigi. Elke betaalde bestelling (webshop of kanaal) krijgt hooguit één fulfilmentregel
-- (unique op bestelling_id) en wordt hooguit één keer naar Prodigi gestuurd:
--   1. alleen wie de regel via skiffa_claim_fulfilment() van 'wacht'/'opnieuw' naar 'bezig' zet, verstuurt;
--   2. elke poging gebruikt dezelfde idempotentiesleutel, zodat Prodigi een herhaalde poging (na een
--      time-out of een vastgelopen functie) als dezelfde order herkent.

alter table public.kanaal_instellingen drop constraint if exists kanaal_instellingen_kanaal_check;
alter table public.kanaal_instellingen add constraint kanaal_instellingen_kanaal_check
  check (kanaal in ('bol','etsy','amazon','prodigi'));

create table if not exists public.fulfilments (
  id                   bigint generated always as identity primary key,
  bestelling_id        uuid not null unique references public.bestellingen(id) on delete restrict,
  aanbieder            text not null default 'prodigi' check (aanbieder in ('prodigi')),
  omgeving             text not null default 'sandbox' check (omgeving in ('sandbox','live')),
  status               text not null default 'wacht' check (status in
                         ('wacht','bezig','opnieuw','verstuurd','in_productie','verzonden','geblokkeerd','fout','geannuleerd')),
  idempotentie_sleutel text not null unique,
  vanaf                timestamptz not null default now(),   -- niet eerder versturen (bedenktijd)
  pogingen             int not null default 0,
  geclaimd_op          timestamptz,
  extern_id            text unique,                          -- Prodigi-ordernummer (ord_…)
  extern_status        text,
  laatste_fout         text,
  verstuurd_op         timestamptz,
  aangemaakt_op        timestamptz not null default now(),
  bijgewerkt_op        timestamptz not null default now()
);
create index if not exists fulfilments_open_idx on public.fulfilments (status, vanaf);
alter table public.fulfilments enable row level security;

-- Claim: atomair van wacht/opnieuw naar bezig, alleen voor een betaalde, niet-geannuleerde bestelling
-- zonder terugbetaling. Geeft de regel terug als deze aanroep de claim kreeg, anders niets.
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
     and b.status in ('betaald','in_productie')
     and coalesce(b.terugbetaald, 0) = 0
  returning f.*;
$$;

-- Vastgelopen claims (functie afgebroken tijdens het versturen) na 10 minuten vrijgeven. De volgende
-- poging gebruikt dezelfde idempotentiesleutel, dus Prodigi maakt geen tweede order.
create or replace function public.skiffa_vrijgeven_fulfilments()
returns int
language sql security definer set search_path = public as $$
  with x as (
    update public.fulfilments set status = 'opnieuw', bijgewerkt_op = now()
     where status = 'bezig' and geclaimd_op < now() - interval '10 minutes'
    returning 1)
  select count(*)::int from x;
$$;

revoke all on function public.skiffa_claim_fulfilment(bigint) from public;
revoke all on function public.skiffa_vrijgeven_fulfilments() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.skiffa_claim_fulfilment(bigint) from anon, authenticated;
    revoke all on function public.skiffa_vrijgeven_fulfilments() from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.skiffa_claim_fulfilment(bigint) to service_role;
    grant execute on function public.skiffa_vrijgeven_fulfilments() to service_role;
  end if;
end $$;
