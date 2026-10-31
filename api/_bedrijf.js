// Bedrijfsgegevens voor facturen en mails. Vul ze in als Environment Variables in Vercel;
// zonder waarde staat er een zichtbare [placeholder] op de factuur, zodat je ziet wat er nog mist.
const v = (naam, standaard) => process.env[naam] || standaard;

export const bedrijf = () => ({
  naam: v('BEDRIJF_NAAM', 'SKIFFA'),
  rechtspersoon: v('BEDRIJF_RECHTSPERSOON', 'Hylke Thiry | Promotie- & Communicatiebegeleiding'),
  adres: v('BEDRIJF_ADRES', 'Berkenbosch Blokstraat 99, 2586 HE Den Haag'),
  telefoon: v('BEDRIJF_TELEFOON', '+31 6 21410639'),
  email: v('BESTEL_EMAIL', 'hallo@skiffa.nl'),
  kvk: v('BEDRIJF_KVK', '74563270'),
  btw: v('BEDRIJF_BTW', 'NL002164368B10'),   // btw-identificatienummer (het omzetbelastingnummer blijft privé)
  iban: v('BEDRIJF_IBAN', 'NL19 KNAB 0413 3209 28'),
  site: (process.env.SITE_URL || 'https://skiffa.store').replace(/\/$/, ''),
});

// Alle prijzen zijn incl. 21% btw. Btw-deel = totaal − totaal / 1,21 (afgerond op centen).
export const btwDeel = (bedrag, tarief = 21) => Math.round((bedrag - bedrag / (1 + tarief / 100)) * 100) / 100;
