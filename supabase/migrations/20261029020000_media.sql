-- Drukbestanden en visuals per poster.
--   drukbestanden   één hoge-resolutie pdf per poster × formaat (privé bucket 'drukbestanden'),
--                   automatisch gekoppeld aan elke orderregel met die poster en dat formaat.
--   poster_visuals  zes beelden per poster voor de presentatie in de webshop (publieke bucket 'visuals').
-- Bestanden gaan rechtstreeks van de browser naar Supabase Storage (ondertekende upload-URL van de
-- server); deze tabellen houden bij wat er staat en of de maat klopt.

create table if not exists public.drukbestanden (
  poster_id    text not null,
  formaat      text not null,
  pad          text not null,                 -- <poster>/<formaat>.pdf in bucket drukbestanden
  bestandsnaam text,
  bytes        bigint,
  breedte_mm   numeric(7,1),                  -- gemeten (TrimBox, anders MediaBox)
  hoogte_mm    numeric(7,1),
  afloop_mm    numeric(4,1),
  paginas      int,
  maat_status  text not null default 'onbekend' check (maat_status in ('ok','afwijkend','onbekend')),
  geupload_op  timestamptz not null default now(),
  primary key (poster_id, formaat)
);

create table if not exists public.poster_visuals (
  poster_id    text not null,
  positie      int  not null check (positie between 1 and 6),
  pad          text not null,                 -- <poster>/<positie>-<tijd>.jpg in bucket visuals
  pad_klein    text not null,
  breedte      int,
  hoogte       int,
  alt          text,
  geupload_op  timestamptz not null default now(),
  primary key (poster_id, positie)
);

alter table public.drukbestanden  enable row level security;
alter table public.poster_visuals enable row level security;

-- Storage-buckets (alleen als Supabase Storage aanwezig is, zodat de migratie ook op een kale
-- Postgres draait). Drukbestanden zijn privé (downloaden via een ondertekende link), visuals publiek.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, allowed_mime_types)
    values ('drukbestanden', 'drukbestanden', false, array['application/pdf'])
    on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
    insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
    values ('visuals', 'visuals', true, array['image/jpeg','image/png','image/webp'], 10485760)
    on conflict (id) do update set public = true, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;
  end if;
end $$;
