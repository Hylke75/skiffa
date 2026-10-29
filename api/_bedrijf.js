// Bedrijfsgegevens voor facturen en mails. Vul ze in als Environment Variables in Vercel;
// zonder waarde staat er een zichtbare [placeholder] op de factuur, zodat je ziet wat er nog mist.
const v = (naam, standaard) => process.env[naam] || standaard;

export const bedrijf = () => ({
  naam: v('BEDRIJF_NAAM', 'Skiffa'),
  adres: v('BEDRIJF_ADRES', 'Keizerstraat 100, 2586 AZ Den Haag'),
  email: v('BESTEL_EMAIL', 'hallo@skiffa.nl'),
  kvk: v('BEDRIJF_KVK', '[KvK-nummer]'),
  btw: v('BEDRIJF_BTW', '[btw-nummer]'),
  iban: v('BEDRIJF_IBAN', '[IBAN]'),
  site: (process.env.SITE_URL || 'https://skiffa.store').replace(/\/$/, ''),
});

// Alle prijzen zijn incl. 21% btw. Btw-deel = totaal − totaal / 1,21 (afgerond op centen).
export const btwDeel = (bedrag, tarief = 21) => Math.round((bedrag - bedrag / (1 + tarief / 100)) * 100) / 100;
