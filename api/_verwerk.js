// Gedeelde stappen rond een betaling: wordt gebruikt door de Mollie-webhook, de statuspagina
// van de klant (als de webhook nog niet is geweest) en de administratie.
import { mollie } from './_bestelling.js';
import { rpc, haalBestelling, werkBij, log } from './_db.js';
import { mails, vanRij } from './_mails.js';

async function probeer(id, soort, fn) {
  try { if (await fn()) await log(id, 'mail', soort); }
  catch (e) { await log(id, 'fout', `mail ${soort} mislukt: ${e.message}`); }
}

// Zet een bestelling op betaald (idempotent) en stuurt alleen de eerste keer de mails.
export async function betaald(bestelling, methode, door = 'systeem') {
  const res = await rpc('skiffa_markeer_betaald', { p_id: bestelling.id, p_methode: methode || null, p_door: door });
  if (res?.nieuw) {
    const o = vanRij(await haalBestelling('id', bestelling.id));
    await probeer(o.id, 'bevestiging', () => mails.bevestiging(o));
    await probeer(o.id, 'winkel', () => mails.winkelNieuw(o, `Betaald${methode ? ` via ${methode}` : ''}.`));
  }
  return res;
}

// Haal de actuele stand bij Mollie op en verwerk die in de administratie.
export async function verwerkMollie(paymentId) {
  const p = await mollie(`payments/${paymentId}`);
  let b = await haalBestelling('mollie_id', paymentId);
  if (!b && p.metadata?.order_id) b = await haalBestelling('id', p.metadata.order_id);
  if (!b) return { p, bestelling: null };

  if (p.status === 'paid' || p.status === 'authorized') {
    await betaald(b, p.method);
    // Terugbetalingen die in het Mollie-dashboard zijn gedaan, ook in de administratie zetten.
    const terug = Number(p.amountRefunded?.value || 0);
    if (terug > Number(b.terugbetaald) + 0.001) {
      const volledig = terug >= Number(b.totaal) - 0.001;
      await werkBij(b.id, { terugbetaald: terug, ...(volledig ? { status: 'terugbetaald' } : {}) });
      await log(b.id, 'terugbetaling', `€ ${(terug - Number(b.terugbetaald)).toFixed(2)} teruggestort (via Mollie)`);
      await probeer(b.id, 'terugbetaald', async () => mails.terugbetaald(vanRij(b), terug - Number(b.terugbetaald)));
    }
  } else if (['canceled', 'expired', 'failed'].includes(p.status) && b.status === 'open') {
    await werkBij(b.id, { status: 'mislukt' });
    await log(b.id, 'status', `betaling ${p.status}`);
  }
  return { p, bestelling: await haalBestelling('id', b.id) };
}
