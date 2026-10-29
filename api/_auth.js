// Inloggen voor de administratie: één wachtwoord (ADMIN_WACHTWOORD, minstens 12 tekens) en een
// ondertekende sessiecookie (HMAC, 12 uur geldig, HttpOnly + Secure + SameSite=Strict).
import crypto from 'node:crypto';

const NAAM = 'skiffa_admin';
const DUUR = 12 * 60 * 60 * 1000;
const geheim = () => process.env.ADMIN_GEHEIM || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hmac = (s) => crypto.createHmac('sha256', geheim()).update(s).digest('hex');
const gelijk = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// Ondertekenen van links (drukbestanden) met hetzelfde geheim als de sessie.
export const onderteken = (s) => hmac(`link|${s}`);
export const handtekeningKlopt = (s, sig) => !!geheim() && typeof sig === 'string' && gelijk(sig, onderteken(s));

export const adminIngesteld = () => (process.env.ADMIN_WACHTWOORD || '').length >= 12 && !!geheim();

export function wachtwoordKlopt(w) {
  return adminIngesteld() && typeof w === 'string' && gelijk(w, process.env.ADMIN_WACHTWOORD);
}

export function sessieCookie() {
  const exp = String(Date.now() + DUUR);
  return `${NAAM}=${exp}.${hmac(exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DUUR / 1000}`;
}
export const uitlogCookie = () => `${NAAM}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function isAdmin(req) {
  if (!adminIngesteld()) return false;
  const c = String(req.headers?.cookie || '').split(/;\s*/).find((x) => x.startsWith(NAAM + '='));
  if (!c) return false;
  const [exp, sig] = c.slice(NAAM.length + 1).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return gelijk(sig, hmac(exp));
}
