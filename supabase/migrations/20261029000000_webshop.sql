-- Skiffa webshop: bestellingen, orderregels, logboek en doorlopende factuurnummers.
-- Alleen de server (service role) leest en schrijft; RLS staat aan zonder policies,
-- zodat de publieke anon-key niets kan.

create table if not exists public.bestellingen (
  id               uuid primary key default gen_random_uuid(),
  nummer           text not null unique,                 -- SK-XXXX, voor klant en winkel
  token            text not null default (replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), -- geheime link voor klant (status/factuur)
  status           text not null default 'open'
                   check (status in ('open','betaald','in_productie','verzonden','geleverd','geannuleerd','mislukt','terugbetaald')),
  -- klant
  naam             text not null,
  email            text not null,
  straat           text not null,
  postcode         text not null,
  plaats           text not null,
  land             text not null check (land in ('NL','BE')),
  opmerking        text not null default '',
  -- bedragen (incl. btw, in euro)
  subtotaal        numeric(10,2) not null,
  verzending       numeric(10,2) not null,
  totaal           numeric(10,2) not null,
  btw_tarief       numeric(4,2)  not null default 21.00,
  -- betaling
  betaalwijze      text not null default 'mollie' check (betaalwijze in ('mollie','betaalverzoek')),
  mollie_id        text unique,
  mollie_methode   text,
  betaald_op       timestamptz,
  terugbetaald     numeric(10,2) not null default 0,
  -- administratie
  factuurnummer    text unique,
  factuurdatum     date,
  track_trace      text,
  verzonden_op     timestamptz,
  notitie          text not null default '',
  aangemaakt_op    timestamptz not null default now(),
  bijgewerkt_op    timestamptz not null default now()
);
create index if not exists bestellingen_status_idx on public.bestellingen (status, aangemaakt_op desc);
create index if not exists bestellingen_email_idx on public.bestellingen (lower(email));
create index if not exists bestellingen_factuurdatum_idx on public.bestellingen (factuurdatum);

create table if not exists public.bestelregels (
  id             bigint generated always as identity primary key,
  bestelling_id  uuid not null references public.bestellingen(id) on delete cascade,
  poster_id      text not null,
  poster_naam    text not null,
  formaat        text not null,
  formaat_label  text not null,
  prijs          numeric(10,2) not null,  -- per stuk, incl. btw
  aantal         int not null check (aantal between 1 and 10)
);
create index if not exists bestelregels_bestelling_idx on public.bestelregels (bestelling_id);

create table if not exists public.bestelling_log (
  id             bigint generated always as identity primary key,
  bestelling_id  uuid not null references public.bestellingen(id) on delete cascade,
  soort          text not null,          -- aangemaakt, betaald, mail, status, terugbetaling, notitie, fout
  tekst          text not null default '',
  door           text not null default 'systeem',
  op             timestamptz not null default now()
);
create index if not exists bestelling_log_idx on public.bestelling_log (bestelling_id, op);

-- Doorlopende factuurnummers per jaar (wettelijk verplicht: opeenvolgend, zonder gaten).
create table if not exists public.factuurteller (
  jaar     int primary key,
  laatste  int not null default 0
);

alter table public.bestellingen   enable row level security;
alter table public.bestelregels   enable row level security;
alter table public.bestelling_log enable row level security;
alter table public.factuurteller  enable row level security;

create or replace function public.skiffa_touch() returns trigger language plpgsql as $$
begin new.bijgewerkt_op := now(); return new; end $$;
drop trigger if exists bestellingen_touch on public.bestellingen;
create trigger bestellingen_touch before update on public.bestellingen
  for each row execute function public.skiffa_touch();

-- Markeer een bestelling als betaald. Idempotent: wie hem als eerste betaald zet krijgt nieuw=true
-- (en stuurt de mails); latere aanroepen (Mollie herhaalt webhooks) krijgen nieuw=false.
-- Kent bij de eerste keer een factuurnummer toe (JJJJ-0001, doorlopend per jaar).
create or replace function public.skiffa_markeer_betaald(p_id uuid, p_methode text, p_door text default 'systeem')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_b public.bestellingen;
  v_jaar int := extract(year from (now() at time zone 'Europe/Amsterdam'))::int;
  v_nr int;
begin
  select * into v_b from public.bestellingen where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reden', 'onbekend'); end if;
  if v_b.status not in ('open','mislukt') then
    return jsonb_build_object('ok', true, 'nieuw', false, 'status', v_b.status);
  end if;
  if v_b.factuurnummer is null then
    insert into public.factuurteller (jaar, laatste) values (v_jaar, 1)
      on conflict (jaar) do update set laatste = public.factuurteller.laatste + 1
      returning laatste into v_nr;
  end if;
  update public.bestellingen set
    status = 'betaald',
    betaald_op = coalesce(betaald_op, now()),
    mollie_methode = coalesce(p_methode, mollie_methode),
    factuurnummer = coalesce(factuurnummer, v_jaar::text || '-' || lpad(v_nr::text, 4, '0')),
    factuurdatum = coalesce(factuurdatum, (now() at time zone 'Europe/Amsterdam')::date)
  where id = p_id;
  insert into public.bestelling_log (bestelling_id, soort, tekst, door)
    values (p_id, 'betaald', coalesce('betaald via ' || p_methode, 'betaald'), p_door);
  return jsonb_build_object('ok', true, 'nieuw', true, 'status', 'betaald');
end $$;
revoke all on function public.skiffa_markeer_betaald(uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.skiffa_markeer_betaald(uuid, text, text) to service_role;
  end if;
end $$;
