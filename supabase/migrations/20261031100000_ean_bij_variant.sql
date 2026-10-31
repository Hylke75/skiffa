-- EAN's op één plek: bij de variant (varianten.ean, al uniek met formaatcheck).
-- De oude tabel poster_ean (één EAN per poster + formaat, alleen voor bol/Amazon) gaat op in de
-- losse variant op standaardpapier; daarna vervalt die tabel. Ingelijste varianten krijgen een eigen EAN.
do $$
begin
  if to_regclass('public.poster_ean') is not null then
    update public.varianten v
       set ean = e.ean, bijgewerkt_op = now()
      from public.poster_ean e
     where v.product_id = e.poster_id
       and v.formaat_id = e.formaat
       and v.lijst is null
       and v.papier_id = 'german-etching'
       and v.ean is null
       and not exists (select 1 from public.varianten x where x.ean = e.ean);
    drop table public.poster_ean;
  end if;
end $$;
