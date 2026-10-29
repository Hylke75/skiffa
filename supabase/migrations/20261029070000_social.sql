-- Fase 7: social (via Buffer), productfeeds (Meta, TikTok Shop) en campagnelinks.
--
-- Publiceren loopt via Buffer. Per bericht (social_posts) zijn er doelen per account (social_post_targets) met een
-- eigen tekstvariant, tijdstip en publicatiewijze:
--   automatisch  Buffer plaatst het bericht zelf
--   telefoon     Buffer stuurt een herinnering; jij rondt het af op je telefoon. Een herinnering is NOOIT
--                "gepubliceerd": pas als het in Buffer als gepubliceerd is gemarkeerd (of jij het hier bevestigt).
-- Elke verzending naar Buffer is een taak (publishing_jobs) met een unieke sleutel, zodat een bericht hoogstens
-- één keer in Buffer belandt; bij een onduidelijk antwoord wordt eerst in Buffer gezocht vóór een nieuwe poging.

create table if not exists public.social_connections (
  id              bigint generated always as identity primary key,
  aanbieder       text not null default 'buffer' check (aanbieder in ('buffer')),
  extern_id       text not null,                       -- Buffer channel id
  organisatie_id  text,                                -- Buffer organization id
  service         text not null,                       -- instagram, tiktok, facebook, pinterest, ...
  naam            text not null,
  avatar          text,
  status          text not null default 'actief' check (status in ('actief','ontkoppeld','vergrendeld','gepauzeerd','verdwenen')),
  extern_link     text,
  gebruiken       boolean not null default true,       -- mag SKIFFA hierop plannen
  laatste_sync_op timestamptz,
  meta            jsonb not null default '{}'::jsonb,
  unique (aanbieder, extern_id)
);

create table if not exists public.social_posts (
  id             bigint generated always as identity primary key,
  titel          text not null,                        -- interne naam
  product_id     text references public.producten(id) on delete set null,
  campagne       text,                                 -- utm_campaign
  tekst          text not null default '',             -- basistekst; varianten per account in de doelen
  status         text not null default 'concept' check (status in ('concept','gepland','deels','gepubliceerd','fout','geannuleerd')),
  door           text not null default 'admin',
  aangemaakt_op  timestamptz not null default now(),
  bijgewerkt_op  timestamptz not null default now()
);
create index if not exists social_posts_product_idx on public.social_posts (product_id);

create table if not exists public.social_assets (
  id                 bigint generated always as identity primary key,
  post_id            bigint not null references public.social_posts(id) on delete cascade,
  soort              text not null check (soort in ('afbeelding','video')),
  url                text not null,                    -- openbaar en blijvend (Buffer haalt het pas bij publicatie op)
  bron               text not null default 'visual' check (bron in ('visual','poster','upload')),
  pad                text,                             -- pad in de bucket visuals bij een upload
  alt_tekst          text,
  volgorde           int not null default 0,
  thumbnail_offset_ms int,
  aangemaakt_op      timestamptz not null default now()
);
create index if not exists social_assets_post_idx on public.social_assets (post_id, volgorde);

create table if not exists public.campaign_links (
  id             bigint generated always as identity primary key,
  doel_url       text not null,
  utm_source     text not null,
  utm_medium     text not null default 'social',
  utm_campaign   text not null,
  utm_content    text,
  product_id     text references public.producten(id) on delete set null,
  post_id        bigint references public.social_posts(id) on delete set null,
  aangemaakt_op  timestamptz not null default now(),
  unique (doel_url, utm_source, utm_medium, utm_campaign, utm_content)
);

create table if not exists public.social_post_targets (
  id               bigint generated always as identity primary key,
  post_id          bigint not null references public.social_posts(id) on delete cascade,
  connection_id    bigint not null references public.social_connections(id) on delete restrict,
  tekst            text,                               -- null = basistekst
  publicatie       text not null default 'automatisch' check (publicatie in ('automatisch','telefoon')),
  post_type        text not null default 'post' check (post_type in ('post','reel','story','short')),
  gepland_op       timestamptz,                        -- null = eerstvolgende plek in de Buffer-wachtrij
  metadata         jsonb not null default '{}'::jsonb, -- eerste reactie, TikTok-titel, Pinterest-bord, ...
  campaign_link_id bigint references public.campaign_links(id) on delete set null,
  status           text not null default 'concept' check (status in ('concept','klaar','versturen','onzeker','in_buffer','herinnering','gepubliceerd','fout','geannuleerd')),
  extern_id        text,                               -- Buffer post id
  extern_status    text,                               -- draft / scheduled / sending / sent / error ...
  extern_link      text,                               -- link naar het geplaatste bericht
  melding          text,
  gepubliceerd_op  timestamptz,
  herinnerd_op     timestamptz,
  handmatig_bevestigd boolean not null default false,
  bijgewerkt_op    timestamptz not null default now(),
  unique (post_id, connection_id)
);
create unique index if not exists social_post_targets_extern_idx on public.social_post_targets (extern_id) where extern_id is not null;
create index if not exists social_post_targets_status_idx on public.social_post_targets (status);

create table if not exists public.publishing_jobs (
  id                 bigint generated always as identity primary key,
  sleutel            text not null unique,             -- bv. 'buffer-post:<target_id>:<poging>'
  soort              text not null check (soort in ('buffer_post','buffer_annuleer','meta_feed','tiktok_product','tiktok_tracking')),
  target_id          bigint references public.social_post_targets(id) on delete cascade,
  status             text not null default 'wacht' check (status in ('wacht','bezig','klaar','fout','onzeker','geannuleerd')),
  pogingen           int not null default 0,
  volgende_poging_op timestamptz not null default now(),
  geclaimd_op        timestamptz,
  laatste_fout       text,
  resultaat          jsonb,
  aangemaakt_op      timestamptz not null default now(),
  bijgewerkt_op      timestamptz not null default now()
);
create index if not exists publishing_jobs_wacht_idx on public.publishing_jobs (status, volgende_poging_op);

-- Productcatalogi buiten de webshop (Meta-feed, TikTok Shop): per variant opnemen + goedkeuringsstatus.
create table if not exists public.catalog_channels (
  kanaal          text not null check (kanaal in ('meta','tiktok')),
  sku             text not null references public.varianten(sku) on delete cascade,
  product_id      text not null references public.producten(id) on delete cascade,
  opnemen         boolean not null default true,
  status          text not null default 'onbekend' check (status in ('onbekend','ontbreekt','gereed','ingediend','goedgekeurd','afgekeurd','verouderd')),
  meldingen       jsonb not null default '[]'::jsonb,
  extern_id       text,
  laatste_check_op timestamptz,
  bijgewerkt_op   timestamptz not null default now(),
  primary key (kanaal, sku)
);

alter table public.social_connections  enable row level security;
alter table public.social_posts        enable row level security;
alter table public.social_assets       enable row level security;
alter table public.social_post_targets enable row level security;
alter table public.publishing_jobs     enable row level security;
alter table public.catalog_channels    enable row level security;
alter table public.campaign_links      enable row level security;
-- geen policies: alleen de server (service role) leest en schrijft.

-- Een taak claimen: één verwerker tegelijk, en een vastgelopen claim (>10 min) mag opnieuw.
create or replace function public.skiffa_claim_job(p_id bigint)
returns setof public.publishing_jobs language sql security definer set search_path = public as $$
  update public.publishing_jobs
     set status = 'bezig', geclaimd_op = now(), pogingen = pogingen + 1, bijgewerkt_op = now()
   where id = p_id
     and ((status = 'wacht' and volgende_poging_op <= now())
          or (status = 'bezig' and geclaimd_op < now() - interval '10 minutes'))
  returning *;
$$;
revoke all on function public.skiffa_claim_job(bigint) from public, anon, authenticated;

-- TikTok Shop-koppeling (OAuth). Tokens alleen server-side; de koppelpoging gebruikt etsy_oauth_states (code_verifier = 'tiktok').
create table if not exists public.tiktok_koppeling (
  id                  int primary key check (id = 1),
  shop_id             text,
  shop_naam           text,
  shop_cipher         text,
  regio               text,
  verkoper            text,
  access_token        text not null,
  refresh_token       text not null,
  access_verloopt_op  timestamptz not null,
  refresh_verloopt_op timestamptz,
  gekoppeld_op        timestamptz not null default now(),
  bijgewerkt_op       timestamptz not null default now()
);
alter table public.tiktok_koppeling enable row level security;

alter table public.kanaal_instellingen drop constraint if exists kanaal_instellingen_kanaal_check;
alter table public.kanaal_instellingen add constraint kanaal_instellingen_kanaal_check
  check (kanaal in ('bol','etsy','amazon','prodigi','tiktok','meta','buffer'));
