-- Centrale productcatalogus met varianten (beheer in /admin → producten).
--
--   producten        één poster: interne naam, productcode, verkooptitel, teksten, collectie, onderwerp,
--                    kleuren, zoekwoorden, SEO en status (concept → gereed → actief → gearchiveerd)
--   formaten         30×40, 50×70, 70×100 (later meer)
--   papiersoorten    met uitleg voor de klant
--   varianten        product × formaat × papier (× later lijst): eigen SKU, verkoopprijs, kostprijs,
--                    drukbestand, gekoppeld Prodigi-product, leverbaarheid
--   drukbestand_versies  privé (bucket drukbestanden), met versienummer en de uitkomst van de controles
--
-- Een variant is pas bestelbaar als hij actief is, een prijs heeft, leverbaar is bevestigd (Prodigi of
-- handmatig met reden) en een goedgekeurd drukbestand heeft (of een bevestigde uitzondering).
-- Startvulling: de huidige posters en formaten, op één papiersoort, nog niet bevestigd.

create table if not exists public.formaten (
  id            text primary key check (id ~ '^[0-9]{2,3}x[0-9]{2,3}(in)?$'),
  label         text not null,
  breedte_mm    numeric(7,1) not null check (breedte_mm > 0),
  hoogte_mm     numeric(7,1) not null check (hoogte_mm > 0),
  actief        boolean not null default false,
  volgorde      int not null default 0
);

create table if not exists public.papiersoorten (
  id            text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  naam          text not null,
  uitleg        text not null default '',          -- voor de klant op de productpagina
  gewicht_gsm   int,
  actief        boolean not null default true,
  volgorde      int not null default 0
);

create table if not exists public.producten (
  id               text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(id) <= 40),  -- ook de URL (/#id)
  code             text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,30}$'),               -- productcode
  interne_naam     text not null,
  titel            text not null,                     -- verkooptitel
  beschrijving     text not null default '',
  stijl            text not null default '',          -- korte regel onder de titel
  collectie        text not null default '',
  onderwerp        text not null default '',
  kleuren          text[] not null default '{}',
  zoekwoorden      text[] not null default '{}',
  accentkleur      text not null default '#1F4E79' check (accentkleur ~ '^#[0-9A-Fa-f]{6}$'),
  seo_titel        text not null default '',
  seo_beschrijving text not null default '',
  status           text not null default 'concept' check (status in ('concept','gereed','actief','gearchiveerd')),
  beeld            text,                              -- eigen hoofdbeeld (bucket visuals); leeg = /posters/<id>.webp
  beeld_klein      text,
  volgorde         int not null default 0,
  aangemaakt_op    timestamptz not null default now(),
  bijgewerkt_op    timestamptz not null default now()
);

create table if not exists public.varianten (
  sku                    text primary key check (sku ~ '^[A-Z0-9][A-Z0-9-]{2,60}$'),
  product_id             text not null references public.producten(id) on delete restrict,
  formaat_id             text not null references public.formaten(id),
  papier_id              text not null references public.papiersoorten(id),
  lijst                  text,                       -- later: lijst en lijstkleur
  lijst_kleur            text,
  prijs                  numeric(10,2) not null check (prijs > 0),     -- basisverkoopprijs incl. btw
  kostprijs              numeric(10,2),                                -- laatst bekende kostprijs (excl. btw)
  actief                 boolean not null default true,
  ean                    text unique check (ean ~ '^[0-9]{8}$|^[0-9]{12,14}$'),
  -- Prodigi
  prodigi_sku            text,
  prodigi_attributen     jsonb not null default '{}'::jsonb,
  sizing                 text not null default 'fitPrintArea' check (sizing in ('fitPrintArea','fillPrintArea')),
  prodigi_status         text not null default 'niet_gekoppeld' check (prodigi_status in ('niet_gekoppeld','bevestigd','ongeldig')),
  prodigi_product        jsonb,                      -- laatst gecontroleerde productgegevens (maten, pixels, landen)
  prodigi_melding        text,
  prodigi_gecontroleerd_op timestamptz,
  verzendmethode         text not null default 'Standard',
  kosten                 jsonb,                      -- laatste offerte (artikel, verzending, merk, btw, totaal)
  kosten_gecontroleerd_op timestamptz,
  -- leverbaar zonder Prodigi (eigen drukker): alleen met een reden
  handmatig_leverbaar    boolean not null default false,
  handmatig_reden        text,
  levertijd_productie_dagen int not null default 3,
  levertijd_verzending_dagen int not null default 3,
  -- drukbestand
  drukbestand_id         bigint,
  qc_uitzondering        text,                       -- gemotiveerde uitzondering op een afgekeurde controle
  qc_uitzondering_op     timestamptz,
  aangemaakt_op          timestamptz not null default now(),
  bijgewerkt_op          timestamptz not null default now(),
  check (not handmatig_leverbaar or length(coalesce(handmatig_reden, '')) >= 5)
);
create unique index if not exists varianten_uniek on public.varianten (product_id, formaat_id, papier_id, coalesce(lijst, ''), coalesce(lijst_kleur, ''));
create index if not exists varianten_product_idx on public.varianten (product_id);

create table if not exists public.drukbestand_versies (
  id                 bigint generated always as identity primary key,
  variant_sku        text not null references public.varianten(sku) on update cascade on delete cascade,
  versie             int not null,
  pad                text not null unique,           -- <product>/<sku>/v<versie>.<ext> in de privé bucket
  bestandsnaam       text,
  bytes              bigint,
  mime               text,
  breedte_px         int,
  hoogte_px          int,
  pagina_breedte_mm  numeric(7,1),                    -- pdf: MediaBox/TrimBox
  pagina_hoogte_mm   numeric(7,1),
  controles          jsonb not null default '[]'::jsonb,   -- [{code, ernst: ok|waarschuwing|afgekeurd, tekst}]
  status             text not null check (status in ('ok','waarschuwing','afgekeurd')),
  geupload_op        timestamptz not null default now(),
  unique (variant_sku, versie)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'varianten_drukbestand_fk') then
    alter table public.varianten add constraint varianten_drukbestand_fk
      foreign key (drukbestand_id) references public.drukbestand_versies(id) on delete set null;
  end if;
end $$;

-- Productbeelden en mock-ups (openbaar, bucket visuals), los van de privé drukbestanden.
alter table public.poster_visuals add column if not exists soort text not null default 'foto';
alter table public.poster_visuals add column if not exists formaat_id text;
alter table public.poster_visuals add column if not exists papier_id text;
alter table public.poster_visuals drop constraint if exists poster_visuals_positie_check;
alter table public.poster_visuals drop constraint if exists poster_visuals_soort_check;
alter table public.poster_visuals add constraint poster_visuals_positie_check check (positie between 1 and 30);
alter table public.poster_visuals add constraint poster_visuals_soort_check check (soort in ('foto','mockup','detail','papier','video'));

-- Vaste kopie bij bestelling: latere productwijzigingen veranderen een bestaande bestelling niet.
alter table public.bestelregels add column if not exists variant_sku text;
alter table public.bestelregels add column if not exists papier_id text;
alter table public.bestelregels add column if not exists papier_label text;
alter table public.bestelregels add column if not exists lijst text;
alter table public.bestelregels add column if not exists drukbestand_versie_id bigint;
alter table public.bestelregels add column if not exists prodigi_sku text;
alter table public.bestelregels add column if not exists prodigi_attributen jsonb;
alter table public.bestelregels add column if not exists sizing text;
alter table public.bestelregels add column if not exists kostprijs numeric(10,2);

alter table public.formaten            enable row level security;
alter table public.papiersoorten       enable row level security;
alter table public.producten           enable row level security;
alter table public.varianten           enable row level security;
alter table public.drukbestand_versies enable row level security;

-- ---- startvulling ----
insert into public.formaten (id, label, breedte_mm, hoogte_mm, actief, volgorde) values
  ('30x40', '30 × 40 cm', 300, 400, true, 10),
  ('50x70', '50 × 70 cm', 500, 700, true, 20),
  ('70x100', '70 × 100 cm', 700, 1000, true, 30),
  ('18x24in', '18 × 24 inch', 457.2, 609.6, false, 40),
  ('24x36in', '24 × 36 inch', 609.6, 914.4, false, 50)
on conflict (id) do nothing;

insert into public.papiersoorten (id, naam, uitleg, gewicht_gsm, actief, volgorde) values
  ('mat', 'Mat fine-art papier', 'Dik, mat papier zonder glans: kleuren blijven rustig en er is geen spiegeling van lampen of ramen.', 250, true, 10)
on conflict (id) do nothing;

insert into public.producten (id, code, interne_naam, titel, beschrijving, stijl, accentkleur, status, volgorde) values
  ('pier-en-strand', 'SKF-001', 'Pier en Strand', 'Pier en Strand', 'Parasols, rieten stoelen en de oude pier vol wandelaars. Scheveningen toen de badplaats nog in pak naar het strand ging.', 'jaren dertig · illustratie', '#E4572E', 'actief', 10),
  ('boulevard', 'SKF-002', 'Boulevard', 'Boulevard', 'Een vlag die klappert in de wind, auto''s met chroom op de boulevard en een strand zo vol dat je het zand niet meer ziet.', 'jaren vijftig · illustratie', '#1B2A6B', 'actief', 20),
  ('de-pier', 'SKF-003', 'De Pier', 'De Pier', 'Strandkorven, de uitkijktoren vol vlaggen en een hele zomer op hetzelfde stuk zand. De pier zoals je ouders hem kennen.', 'jaren zestig · foto', '#D7261E', 'actief', 30),
  ('surfcultuur', 'SKF-004', 'Surfcultuur', 'Surfcultuur', 'Nazomer bij de pier. Een oude BMW op het strand, planken in het zand en niemand die haast heeft. Zo begon het surfen in Scheveningen.', 'jaren zeventig · foto', '#E0201B', 'actief', 40),
  ('windsurf', 'SKF-005', 'Windsurf', 'Windsurf', 'Zeilen met nummers, neon op het zand en half Den Haag bij de vuurtoren. De zomer dat de wind het strand overnam.', 'jaren tachtig · foto', '#1D63D8', 'actief', 50),
  ('golf', 'SKF-006', 'Golf', 'Golf', 'Avond, het havenhoofd in tegenlicht en één golf die blijft staan. Roze, oranje en blauw, zoals de zee er alleen in je hoofd uitziet.', 'zeefdrukstijl · illustratie', '#F0287A', 'actief', 60),
  ('surf', 'SKF-007', 'Surf', 'Surf', 'Oranje lucht, het reuzenrad aan het eind van de pier en een rij surfers die wacht op de volgende set.', 'retro · illustratie', '#1F4E79', 'actief', 70),
  ('havenpier', 'SKF-008', 'Havenpier', 'Havenpier', 'Windkracht zeven bij het havenhoofd. Iedereen blijft op de pier staan kijken, één iemand gaat erin.', 'north sea surf · foto', '#0F4C6B', 'actief', 80),
  ('skiffa', 'SKF-009', 'Skiffa', 'Skiffa', 'De zon zakt achter de vuurtoren, de boulevard licht op en in het water wachten ze nog op die ene laatste golf.', 'zeefdrukstijl · illustratie', '#E8784A', 'actief', 90),
  ('skyview', 'SKF-010', 'Skyview', 'Skyview', 'Drie gondels van het reuzenrad, een zon die de hele lucht pakt en beneden de Noordzee in oranje en zwart.', 'zeefdrukstijl · illustratie', '#E5501F', 'actief', 100),
  ('havenhoofden', 'SKF-011', 'Havenhoofden', 'Havenhoofden', 'Twee vuurtorens op de havenhoofden, een rij grijze blokken en één surfer die de golf pakt. Gedrukt in één kleur, zoals vroeger.', 'linodrukstijl · illustratie', '#1F4E8C', 'actief', 110),
  ('noordzee-surf', 'SKF-012', 'Noordzee Surf', 'Noordzee Surf', 'Late middagzon, glinsterend water en één surfer die zijn golf vindt voor de havenhoofden. Zo ziet een goede dag in Scheveningen eruit.', 'foto · surfcultuur', '#1E3A5F', 'actief', 120),
  ('regatta', 'SKF-013', 'Regatta', 'Regatta', 'Zeilen op een rij bij de vuurtoren, een strand vol kijkers en een zomer die naar zonnebrand rook. Windsurfen zoals het in Scheveningen begon, in één kleur blauw.', 'jaren tachtig · blauwdruk', '#2F6DB5', 'actief', 130),
  ('vuurtoren', 'SKF-014', 'Vuurtoren', 'Vuurtoren', 'De rode vuurtoren van Scheveningen tegen een rode zon, met beneden de Noordzee in groen en wit.', 'houtsnedestijl · illustratie', '#C8402A', 'actief', 140),
  ('reuzenrad', 'SKF-015', 'Reuzenrad', 'Reuzenrad', 'Het reuzenrad aan het eind van de pier, in dikke verf tegen een gouden zon. Scheveningen zoals het nu is.', 'paletmes · schilderij', '#C99A2E', 'actief', 150),
  ('zon', 'SKF-016', 'Zon', 'Zon', 'Een oranje zon, een muur van blauw water en de vuurtoren klein in de verte. Een surfer loopt terug naar het strand; de zee mag even rusten.', 'linodrukstijl · illustratie', '#E8571E', 'actief', 160)
on conflict (id) do nothing;

-- Varianten: elke poster in de drie formaten op mat papier, met de huidige prijzen. Nog niet leverbaar
-- bevestigd en zonder drukbestand, dus nog niet bestelbaar tot dat in /admin is geregeld.
insert into public.varianten (sku, product_id, formaat_id, papier_id, prijs)
select upper('SKF-' || p.id || '-' || f.id), p.id, f.id, 'mat',
       case f.id when '30x40' then 29 when '50x70' then 45 else 69 end
  from public.producten p cross join public.formaten f
 where f.id in ('30x40','50x70','70x100')
on conflict do nothing;

-- Drukbestanden uit de vorige opzet (per poster + formaat) overnemen als versie 1 van de variant op
-- mat papier, en die tabel daarna opruimen.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'drukbestanden') then
    insert into public.drukbestand_versies (variant_sku, versie, pad, bestandsnaam, bytes, mime, pagina_breedte_mm, pagina_hoogte_mm, controles, status, geupload_op)
    select v.sku, 1, d.pad, d.bestandsnaam, d.bytes, 'application/pdf', d.breedte_mm, d.hoogte_mm,
           '[{"code":"overgenomen","ernst":"waarschuwing","tekst":"Overgenomen uit de vorige opzet; upload opnieuw voor een volledige controle."}]'::jsonb,
           case d.maat_status when 'afwijkend' then 'afgekeurd' else 'waarschuwing' end, d.geupload_op
      from public.drukbestanden d
      join public.varianten v on v.product_id = d.poster_id and v.formaat_id = d.formaat and v.papier_id = 'mat'
    on conflict do nothing;
    update public.varianten v set drukbestand_id = dv.id
      from public.drukbestand_versies dv where dv.variant_sku = v.sku and v.drukbestand_id is null;
    drop table public.drukbestanden;
  end if;
end $$;

-- Kanaalorders: regels met de vaste kopie van de variant (overschrijft de versie uit de kanalenmigratie).
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
  insert into public.bestelregels (bestelling_id, poster_id, poster_naam, formaat, formaat_label, prijs, aantal, extern_item_id,
                                   variant_sku, papier_id, papier_label, lijst, drukbestand_versie_id, prodigi_sku, prodigi_attributen, sizing, kostprijs)
  select v_id, r->>'poster_id', r->>'poster_naam', r->>'formaat', r->>'formaat_label',
         (r->>'prijs')::numeric, (r->>'aantal')::int, r->>'extern_item_id',
         r->>'variant_sku', r->>'papier_id', r->>'papier_label', r->>'lijst', (r->>'drukbestand_versie_id')::bigint,
         r->>'prodigi_sku', r->'prodigi_attributen', r->>'sizing', (r->>'kostprijs')::numeric
  from jsonb_array_elements(p->'regels') as x(r);
  insert into public.bestelling_log (bestelling_id, soort, tekst, door)
    values (v_id, 'aangemaakt', 'geïmporteerd van ' || (p->>'kanaal') || ' (' || (p->>'extern_id') || ')', p->>'kanaal');
  perform public.skiffa_markeer_betaald(v_id, p->>'kanaal', p->>'kanaal');
  return jsonb_build_object('id', v_id, 'nieuw', true, 'nummer', v_nr);
end $$;
revoke all on function public.skiffa_importeer_kanaalorder(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.skiffa_importeer_kanaalorder(jsonb) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.skiffa_importeer_kanaalorder(jsonb) to service_role;
  end if;
end $$;
