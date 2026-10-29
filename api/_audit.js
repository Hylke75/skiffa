// Auditlog: elke schrijfactie in de beheeromgeving (wie niet: de route zelf weet dat; wat, wanneer, uitkomst).
// Gevoelige velden (wachtwoorden, tokens, sleutels) en grote waarden worden nooit opgeslagen.
import { db, dbAan } from './_db.js';
import { isAdmin } from './_auth.js';

const GEHEIM = /wachtwoord|password|token|secret|sleutel|cipher|code_verifier|authorization/i;
export function samenvatting(body) {
  if (!body || typeof body !== 'object') return {};
  const uit = {};
  for (const [k, v] of Object.entries(body).slice(0, 15)) {
    if (GEHEIM.test(k)) { uit[k] = '[verborgen]'; continue; }
    if (v == null || typeof v === 'number' || typeof v === 'boolean') uit[k] = v;
    else if (typeof v === 'string') uit[k] = v.length > 80 ? `${v.slice(0, 80)}…` : v;
    else if (Array.isArray(v)) uit[k] = `[${v.length} item${v.length === 1 ? '' : 's'}]`;
    else uit[k] = samenvatting(v);
  }
  return uit;
}

/** Omhult een route: POST-verzoeken van de beheerder (en inlogpogingen) komen in audit_log. */
export function metAudit(route, handler) {
  return async (req, res) => {
    const actie = String(req.query?.actie ?? new URL(req.url || '/', 'http://x').searchParams.get('actie') ?? '');
    const loggen = req.method === 'POST' && dbAan() && (actie === 'login' || isAdmin(req)) && actie !== 'cron';
    if (!loggen) return handler(req, res);
    let status = 200, uit = null;
    const st = res.status.bind(res), js = res.json.bind(res);
    res.status = (c) => { status = c; st(c); return res; };
    res.json = (o) => { uit = o; return js(o); };
    try { await handler(req, res); }
    finally {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      try {
        await db('audit_log', { method: 'POST', body: { route, actie: actie.slice(0, 60), ok: status < 400 && uit?.ok !== false, status,
          details: samenvatting(body), melding: String(uit?.melding || '').slice(0, 300) || null } });
      } catch { /* het auditlog mag een actie nooit laten mislukken */ }
    }
  };
}
