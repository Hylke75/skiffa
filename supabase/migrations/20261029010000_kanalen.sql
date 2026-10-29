-- Verkoopkanalen: bol.com, Etsy en Amazon (naar het voorbeeld van Luna Azul / dreamer-collectives).
-- Orders van de kanalen komen in dezelfde administratie als de webshop (zelfde factuurnummers,
-- export en verzendflow); listings en instellingen per kanaal; Etsy-OAuth-tokens server-side.

-- 1. Bestellingen: herkomst en externe kenmerken.
alter table public.bestellingen
  add column if not exists kanaal              text not null default 'webshop',
  add column if not exists extern_id           text,
  add column if not exists extern_meta         jsonb not null default '{}'::jsonb,
  add column if not exists extern_verzonden_op timestamptz,
  add column if not exists vervoerder          text not null default 'postnl';
alter table public.bestellingen drop constraint if exists bestellingen_kanaal_check;
alter table public.bestellingen add constraint bestellingen_kanaal_check
  check (kanaal in ('webshop','bol','etsy','amazon'));
alter table public.bestellingen drop constraint if exists bestellingen_land_check;
alter table public.bestellingen add constraint bestellingen_land_check check (land ~ '^[A-Z]{2}$');
alter table public.bestellingen drop constraint if exists bestellingen_betaalwijze_check;
alter table public.bestellingen add constraint bestellingen_betaalwijze_check
  check (betaalwijze in ('mollie','betaalverzoek','bol','etsy','amazon'));
create unique index if not exists bestellingen_kanaal_extern_uniek
  on public.bestellingen (kanaal, extern_id) where extern_id is not null;
create index if not exists bestellingen_kanaal_idx on public.bestellingen (kanaal, status);

alter table public.bestelregels add column if not exists extern_item_id text;

-- 2. EAN per poster + formaat (verplicht voor bol en Amazon; koop ze bij GS1 Nederland).
create table if not exists public.poster_ean (
  poster_id  text not null,
  formaat    text not null,
  ean        text not null unique check (ean ~ '^[0-9]{8}$|^[0-9]{12,14}$'),
  primary key (poster_id, formaat)
);

-- 3. Instellingen per kanaal (aan/uit, proefmodus, opslag, levertijd, kanaalspecifiek).
create table if not exists public.kanaal_instellingen (
  kanaal   text primary key check (kanaal in ('bol','etsy','amazon')),
  waarden  jsonb not null default '{}'::jsonb,
  bijgewerkt_op timestamptz not null default now()
);

-- 4. Listings: bol en Amazon per poster + formaat, Etsy per poster (formaat = 'alle').
create table if not exists public.kanaal_listings (
  id            bigint generated always as identity primary key,
  kanaal        text not null check (kanaal in ('bol','etsy','amazon')),
  poster_id     text not null,
  formaat       text not null,
  ingeschakeld  boolean not null default false,
  extern_id     text,                    -- bol offerId, Amazon SKU, Etsy listing_id
  status        text not null default 'concept'
                check (status in ('concept','wacht','actief','gepauzeerd','fout')),
  laatste_fout  text,
  laatste_prijs numeric(10,2),
  laatste_voorraad int,
  meta          jsonb not null default '{}'::jsonb,
  bijgewerkt_op timestamptz not null default now(),
  unique (kanaal, poster_id, formaat)
);

-- 5. Logboek van synchronisaties.
create table if not exists public.kanaal_sync_log (
  id      bigint generated always as identity primary key,
  kanaal  text not null,
  actie   text not null,
  ok      boolean not null,
  detail  jsonb not null default '{}'::jsonb,
  op      timestamptz not null default now()
);
create index if not exists kanaal_sync_log_idx on public.kanaal_sync_log (kanaal, op desc);

-- 6. Etsy-koppeling (OAuth 2.0 + PKCE). Tokens alleen server-side.
create table if not exists public.etsy_koppeling (
  id                 int primary key default 1 check (id = 1),
  shop_id            bigint,
  shop_naam          text,
  valuta             text,
  access_token       text not null,
  access_verloopt_op timestamptz not null,
  refresh_token      text not null,
  gekoppeld_op       timestamptz not null default now(),
  bijgewerkt_op      timestamptz not null default now()
);
create table if not exists public.etsy_oauth_states (
  state         text primary key,
  code_verifier text not null,
  redirect_uri  text not null,
  aangemaakt_op timestamptz not null default now()
);

alter table public.poster_ean          enable row level security;
alter table public.kanaal_instellingen enable row level security;
alter table public.kanaal_listings     enable row level security;
alter table public.kanaal_sync_log     enable row level security;
alter table public.etsy_koppeling      enable row level security;
alter table public.etsy_oauth_states   enable row level security;

-- 7. Kanaalorder importeren: idempotent (kanaal + extern_id), status betaald, factuurnummer
-- via skiffa_markeer_betaald. Bedragen komen van het kanaal (incl. btw).
-- p = { kanaal, extern_id, naam, email, straat, postcode, plaats, land, opmerking, verzending,
--       meta, regels: [{ poster_id, poster_naam, formaat, formaat_label, prijs, aantal, extern_item_id }] }
create or replace function public.skiffa_importeer_kanaalorder(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_sub numeric := 0; v_ship numeric := coalesce((p->>'verzending')::numeric, 0);
  it jsonb; v_nr text;
begin
  select id into v_id from public.bestellingen where kanaal = p->>'kanaal' and extern_id = p->>'extern_id';
  if v_id is not null then return jsonb_build_object('id', v_id, 'nieuw', false); end if;
  for it in select * from jsonb_array_elements(p->'regels') loop
    v_sub := v_sub + (it->>'prijs')::numeric * (it->>'aantal')::int;
  end loop;
  v_nr := upper(left(p->>'kanaal', 3)) || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.bestellingen (
    nummer, kanaal, extern_id, extern_meta, naam, email, straat, postcode, plaats, land, opmerking,
    subtotaal, verzending, totaal, betaalwijze
  ) values (
    v_nr, p->>'kanaal', p->>'extern_id', coalesce(p->'meta', '{}'::jsonb),
    coalesce(nullif(p->>'naam', ''), 'Klant ' || (p->>'kanaal')), coalesce(p->>'email', ''),
    coalesce(p->>'straat', ''), coalesce(p->>'postcode', ''), coalesce(p->>'plaats', ''),
    coalesce(nullif(upper(p->>'land'), ''), 'NL'), coalesce(p->>'opmerking', ''),
    v_sub, v_ship, v_sub + v_ship, p->>'kanaal'
  ) returning id into v_id;
  insert into public.bestelregels (bestelling_id, poster_id, poster_naam, formaat, formaat_label, prijs, aantal, extern_item_id)
  select v_id, r->>'poster_id', r->>'poster_naam', r->>'formaat', r->>'formaat_label',
         (r->>'prijs')::numeric, (r->>'aantal')::int, r->>'extern_item_id'
  from jsonb_array_elements(p->'regels') as x(r);
  insert into public.bestelling_log (bestelling_id, soort, tekst, door)
    values (v_id, 'aangemaakt', 'geïmporteerd van ' || (p->>'kanaal') || ' (' || (p->>'extern_id') || ')', p->>'kanaal');
  perform public.skiffa_markeer_betaald(v_id, p->>'kanaal', p->>'kanaal');
  return jsonb_build_object('id', v_id, 'nieuw', true, 'nummer', v_nr);
end $$;
revoke all on function public.skiffa_importeer_kanaalorder(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.skiffa_importeer_kanaalorder(jsonb) to service_role;
  end if;
end $$;
