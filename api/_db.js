// Supabase-koppeling via de REST-API (geen extra pakketten nodig). Alleen server-side:
// de service-role-key komt nooit in de browser. Zonder SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// werkt de shop zonder administratie (zie api/bestel.js).

const URL_ = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const dbAan = () => !!(URL_() && KEY());

export async function db(pad, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${URL_()}/rest/v1/${pad}`, {
    method,
    headers: {
      apikey: KEY(),
      authorization: `Bearer ${KEY()}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await r.text();
  if (!r.ok) throw new Error(`db-${r.status}: ${tekst.slice(0, 200)}`);
  return tekst ? JSON.parse(tekst) : null;
}

export const rpc = (fn, args) => db(`rpc/${fn}`, { method: 'POST', body: args });

// Kleine helpers voor de bestellingen.
export async function haalBestelling(veld, waarde) {
  const rijen = await db(`bestellingen?${veld}=eq.${encodeURIComponent(waarde)}&select=*,bestelregels(*)&limit=1`);
  return rijen?.[0] || null;
}

export async function werkBij(id, velden) {
  const rijen = await db(`bestellingen?id=eq.${id}`, { method: 'PATCH', body: velden, prefer: 'return=representation' });
  return rijen?.[0] || null;
}

export async function log(id, soort, tekst = '', door = 'systeem') {
  try {
    await db('bestelling_log', { method: 'POST', body: { bestelling_id: id, soort, tekst: String(tekst).slice(0, 1000), door } });
  } catch { /* logboek mag een bestelling nooit laten mislukken */ }
}
