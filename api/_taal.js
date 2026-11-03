// Engelse vertaling van meldingen die de klant van de server te zien krijgt (bestellen, statuspagina).
// Sleutel = de Nederlandse tekst; onbekende teksten blijven Nederlands.
const EN = {
  'Er ging iets mis met je bestelling.': 'Something went wrong with your order.',
  'Ga akkoord met de algemene voorwaarden om te bestellen.': 'Please agree to the terms and conditions to place your order.',
  'Vul je naam in.': 'Please enter your name.',
  'Vul een geldig e-mailadres in.': 'Please enter a valid e-mail address.',
  'Vul je straat en huisnummer in.': 'Please enter your street and house number.',
  'Vul je postcode in.': 'Please enter your postcode.',
  'Vul je woonplaats in.': 'Please enter your town or city.',
  'We versturen alleen naar Nederland en België.': 'We only ship to the Netherlands and Belgium.',
  'Je mandje is leeg.': 'Your basket is empty.',
  'Er klopt iets niet in je mandje. Ververs de pagina en probeer het opnieuw.': 'Something is wrong with your basket. Refresh the page and try again.',
  'Onbekende bestelling.': 'Unknown order.',
  'Deze bestelling kan niet meer worden geannuleerd via deze pagina. Mail ons gerust.': 'This order can no longer be cancelled via this page. Feel free to e-mail us.',
  'Je verzoek is al binnen.': 'We already have your request.',
  'Je verzoek is ontvangen. We laten je zo snel mogelijk weten of annuleren nog kan; je poster kan al in productie zijn.': 'Your request has been received. We\'ll let you know as soon as possible whether cancelling is still possible; your poster may already be in production.',
  'Melden kan zodra je bestelling onderweg is. Mail ons gerust.': 'You can report a problem once your order is on its way. Feel free to e-mail us.',
  'Je hebt al meerdere meldingen gedaan; we nemen contact met je op. Mail ons gerust als het dringend is.': 'You have already reported several problems; we\'ll contact you. Feel free to e-mail us if it\'s urgent.',
  'Kies wat er aan de hand is.': 'Please choose what the problem is.',
  'Beschrijf kort wat er aan de hand is.': 'Please describe briefly what\'s wrong.',
  'Melding niet gevonden.': 'Report not found.',
};
export const naarEngels = (tekst) => EN[tekst] || tekst;
export const taalVan = (x) => (x === 'en' ? 'en' : 'nl');
