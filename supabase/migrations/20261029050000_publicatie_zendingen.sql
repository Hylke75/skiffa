-- Verkoopkanalen per product en zendingen per bestelling.
--
--   kanaal_sjablonen   herbruikbare instellingen per kanaal (taal, categorie, kenmerken, verzend- en
--                      retourprofiel, prijsregel), zodat je ze niet per poster opnieuw invult
--   product_kanalen    per product per kanaal: aangevinkt (publiceren), sjabloon, afwijkingen (titel,
--                      beschrijving, taal, categorie, kenmerken, foto's, prijs), status, externe link en
--                      laatste synchronisatie. Eén rij per product + kanaal en één extern id per kanaal
--                      voorkomen dubbele publicaties.
--   zendingen          één of meer zendingen per bestelling (gesplitste levering), met tracking en of het
--                      kanaal en de klant er al over zijn ingelicht (nooit dubbel).

create table if not exists public.kanaal_sjablonen (
  id            bigint generated always as identity primary key,
  kanaal        text not null check (kanaal in ('webshop','etsy','bol','amazon','ebay','tiktok','meta')),
  naam          text not null,
  standaard     boolean not null default false,
  waarden       jsonb not null default '{}'::jsonb,
  bijgewerkt_op timestamptz not null default now()
);
create unique index if not exists kanaal_sjablonen_een_standaard on public.kanaal_sjablonen (kanaal) where standaard;

create table if not exists public.product_kanalen (
  product_id          text not null references public.producten(id) on delete cascade,
  kanaal              text not null check (kanaal in ('webshop','etsy','bol','amazon','ebay','tiktok','meta')),
  publiceren          boolean not null default false,
  sjabloon_id         bigint references public.kanaal_sjablonen(id) on delete set null,
  afwijkingen         jsonb not null default '{}'::jsonb,
  status              text not null default 'niet_gepubliceerd'
                      check (status in ('niet_gepubliceerd','onvolledig','gereed','verwerken','actief','fout')),
  melding             text,
  extern_id           text,
  extern_url          text,
  gepubliceerd_hash   text,                         -- inhoud van de laatste geslaagde publicatie
  poging_hash         text,                         -- inhoud van de lopende/mislukte poging
  verwerken_sinds     timestamptz,
  aanmaken_gestart_op timestamptz,                  -- nieuwe advertentie aangevraagd (herstel na onderbreking)
  laatste_sync_op     timestamptz,
  meta                jsonb not null default '{}'::jsonb,   -- kanaalgegevens (bv. foto-id's bij Etsy)
  bijgewerkt_op       timestamptz not null default now(),
  primary key (product_id, kanaal)
);
create unique index if not exists product_kanalen_extern_uniek on public.product_kanalen (kanaal, extern_id) where extern_id is not null;

-- Elk bestaand product staat in de eigen webshop.
insert into public.product_kanalen (product_id, kanaal, publiceren)
select id, 'webshop', true from public.producten
on conflict do nothing;

create table if not exists public.zendingen (
  id               bigint generated always as identity primary key,
  bestelling_id    uuid not null references public.bestellingen(id) on delete cascade,
  fulfilment_id    bigint references public.fulfilments(id) on delete set null,
  bron             text not null check (bron in ('prodigi','handmatig','kanaal')),
  extern_ref       text not null,                   -- zending-id bij Prodigi of de tracking-code
  vervoerder       text,
  tracking_code    text,
  tracking_url     text,
  verzonden_op     timestamptz not null default now(),
  regels           jsonb,                           -- welke orderregels erin zitten (null = alles)
  kanaal_gemeld_op timestamptz,
  kanaal_fout      text,
  kanaal_pogingen  int not null default 0,
  klant_gemaild_op timestamptz,
  aangemaakt_op    timestamptz not null default now(),
  unique (bestelling_id, extern_ref)
);
create index if not exists zendingen_bestelling_idx on public.zendingen (bestelling_id);

alter table public.bestellingen drop constraint if exists bestellingen_status_check;
alter table public.bestellingen add constraint bestellingen_status_check
  check (status in ('open','betaald','in_productie','deels_verzonden','verzonden','geleverd','geannuleerd','mislukt','terugbetaald'));
alter table public.bestellingen drop constraint if exists bestellingen_kanaal_check;
alter table public.bestellingen add constraint bestellingen_kanaal_check
  check (kanaal in ('webshop','bol','etsy','amazon','ebay','tiktok'));

alter table public.kanaal_sjablonen enable row level security;
alter table public.product_kanalen  enable row level security;
alter table public.zendingen        enable row level security;
