-- Fase 6: serviceverzoeken (annulering, schade, retour, klacht) met foto's, en een vlag om acties af te vinken.
-- Een verzoek legt vast wat er gevraagd is en hoe het is opgelost. De oplossing zelf (annuleren, terugbetalen,
-- herdruk) is altijd een aparte, bevestigde actie: een terugbetaling annuleert de productie niet automatisch.

create table if not exists public.serviceverzoeken (
  id             bigint generated always as identity primary key,
  bestelling_id  uuid not null references public.bestellingen(id) on delete cascade,
  soort          text not null check (soort in ('annulering','schade','retour','klacht')),
  status         text not null default 'open' check (status in ('open','in_behandeling','opgelost','afgewezen')),
  omschrijving   text not null,
  regels         jsonb,                                  -- betrokken bestelregels (null = hele bestelling)
  fotos          text[] not null default '{}',           -- paden in de privé-bucket drukbestanden (service/...)
  oplossing      text check (oplossing in ('herdruk','terugbetaling','annulering','retour_ontvangen','geen')),
  oplossing_notitie text,
  fulfilment_id  bigint references public.fulfilments(id) on delete set null,   -- de herdruk, als die er is
  terugbetaald   numeric(10,2),
  aangemaakt_op  timestamptz not null default now(),
  bijgewerkt_op  timestamptz not null default now(),
  opgelost_op    timestamptz,
  door           text not null default 'admin'
);
create index if not exists serviceverzoeken_bestelling_idx on public.serviceverzoeken (bestelling_id);
create index if not exists serviceverzoeken_open_idx on public.serviceverzoeken (status) where status in ('open','in_behandeling');

alter table public.serviceverzoeken enable row level security;
-- geen policies: alleen de server (service role) leest en schrijft.

-- Actielijst: een melding kan worden afgevinkt (bijvoorbeeld "lang onderweg" als je de klant al hebt gesproken).
create table if not exists public.actie_afgehandeld (
  sleutel        text primary key,                       -- bv. 'wacht:<bestelling_id>'
  afgehandeld_op timestamptz not null default now(),
  notitie        text
);
alter table public.actie_afgehandeld enable row level security;
