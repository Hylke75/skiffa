-- Centrale productcatalogus: producten (posters) en formaten met prijs, beheerd in /admin → posters.
-- De server (api/_catalogus.js) en de webshop (/api/catalogus) lezen hieruit; zolang de tabellen leeg
-- zijn, gelden de waarden in de code. Startvulling = de huidige catalogus uit de code.

create table if not exists public.catalogus_formaten (
  id            text primary key check (id ~ '^[0-9]{2,3}x[0-9]{2,3}(in)?$'),
  label         text not null,
  breedte_mm    numeric(7,1) not null check (breedte_mm > 0),
  hoogte_mm     numeric(7,1) not null check (hoogte_mm > 0),
  prijs         numeric(10,2) not null check (prijs > 0),
  actief        boolean not null default false,
  standaard     boolean not null default false,       -- voorgeselecteerd in de webshop
  volgorde      int not null default 0,
  prodigi_sku   text,                                 -- product bij Prodigi voor dit formaat
  bijgewerkt_op timestamptz not null default now()
);
create unique index if not exists catalogus_formaten_een_standaard on public.catalogus_formaten (standaard) where standaard;

create table if not exists public.catalogus_producten (
  id            text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(id) <= 40),
  naam          text not null check (length(naam) between 1 and 80),
  sub           text not null default '',
  zin           text not null default '',
  kleur         text not null default '#1F4E79' check (kleur ~ '^#[0-9A-Fa-f]{6}$'),
  actief        boolean not null default false,
  volgorde      int not null default 0,
  beeld         text,                                 -- eigen productbeeld (pad in bucket visuals); leeg = /posters/<id>.webp
  beeld_klein   text,
  aangemaakt_op timestamptz not null default now(),
  bijgewerkt_op timestamptz not null default now()
);

alter table public.catalogus_formaten  enable row level security;
alter table public.catalogus_producten enable row level security;

insert into public.catalogus_formaten (id, label, breedte_mm, hoogte_mm, prijs, actief, standaard, volgorde) values
  ('30x40', '30 × 40 cm', 300, 400, 29, true, false, 10),
  ('50x70', '50 × 70 cm', 500, 700, 45, true, true, 20),
  ('70x100', '70 × 100 cm', 700, 1000, 69, true, false, 30),
  ('18x24in', '18 × 24 inch', 457.2, 609.6, 39, false, false, 40),
  ('24x36in', '24 × 36 inch', 609.6, 914.4, 59, false, false, 50)
on conflict (id) do nothing;

insert into public.catalogus_producten (id, naam, sub, zin, kleur, actief, volgorde) values
  ('pier-en-strand', 'Pier en Strand', 'jaren dertig · illustratie', 'Parasols, rieten stoelen en de oude pier vol wandelaars. Scheveningen toen de badplaats nog in pak naar het strand ging.', '#E4572E', true, 10),
  ('boulevard', 'Boulevard', 'jaren vijftig · illustratie', 'Een vlag die klappert in de wind, auto''s met chroom op de boulevard en een strand zo vol dat je het zand niet meer ziet.', '#1B2A6B', true, 20),
  ('de-pier', 'De Pier', 'jaren zestig · foto', 'Strandkorven, de uitkijktoren vol vlaggen en een hele zomer op hetzelfde stuk zand. De pier zoals je ouders hem kennen.', '#D7261E', true, 30),
  ('surfcultuur', 'Surfcultuur', 'jaren zeventig · foto', 'Nazomer bij de pier. Een oude BMW op het strand, planken in het zand en niemand die haast heeft. Zo begon het surfen in Scheveningen.', '#E0201B', true, 40),
  ('windsurf', 'Windsurf', 'jaren tachtig · foto', 'Zeilen met nummers, neon op het zand en half Den Haag bij de vuurtoren. De zomer dat de wind het strand overnam.', '#1D63D8', true, 50),
  ('golf', 'Golf', 'zeefdrukstijl · illustratie', 'Avond, het havenhoofd in tegenlicht en één golf die blijft staan. Roze, oranje en blauw, zoals de zee er alleen in je hoofd uitziet.', '#F0287A', true, 60),
  ('surf', 'Surf', 'retro · illustratie', 'Oranje lucht, het reuzenrad aan het eind van de pier en een rij surfers die wacht op de volgende set.', '#1F4E79', true, 70),
  ('havenpier', 'Havenpier', 'north sea surf · foto', 'Windkracht zeven bij het havenhoofd. Iedereen blijft op de pier staan kijken, één iemand gaat erin.', '#0F4C6B', true, 80),
  ('skiffa', 'Skiffa', 'zeefdrukstijl · illustratie', 'De zon zakt achter de vuurtoren, de boulevard licht op en in het water wachten ze nog op die ene laatste golf.', '#E8784A', true, 90),
  ('skyview', 'Skyview', 'zeefdrukstijl · illustratie', 'Drie gondels van het reuzenrad, een zon die de hele lucht pakt en beneden de Noordzee in oranje en zwart.', '#E5501F', true, 100),
  ('havenhoofden', 'Havenhoofden', 'linodrukstijl · illustratie', 'Twee vuurtorens op de havenhoofden, een rij grijze blokken en één surfer die de golf pakt. Gedrukt in één kleur, zoals vroeger.', '#1F4E8C', true, 110),
  ('noordzee-surf', 'Noordzee Surf', 'foto · surfcultuur', 'Late middagzon, glinsterend water en één surfer die zijn golf vindt voor de havenhoofden. Zo ziet een goede dag in Scheveningen eruit.', '#1E3A5F', true, 120),
  ('regatta', 'Regatta', 'jaren tachtig · blauwdruk', 'Zeilen op een rij bij de vuurtoren, een strand vol kijkers en een zomer die naar zonnebrand rook. Windsurfen zoals het in Scheveningen begon, in één kleur blauw.', '#2F6DB5', true, 130),
  ('vuurtoren', 'Vuurtoren', 'houtsnedestijl · illustratie', 'De rode vuurtoren van Scheveningen tegen een rode zon, met beneden de Noordzee in groen en wit.', '#C8402A', true, 140),
  ('reuzenrad', 'Reuzenrad', 'paletmes · schilderij', 'Het reuzenrad aan het eind van de pier, in dikke verf tegen een gouden zon. Scheveningen zoals het nu is.', '#C99A2E', true, 150),
  ('zon', 'Zon', 'linodrukstijl · illustratie', 'Een oranje zon, een muur van blauw water en de vuurtoren klein in de verte. Een surfer loopt terug naar het strand; de zee mag even rusten.', '#E8571E', true, 160)
on conflict (id) do nothing;
