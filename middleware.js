// Vercel Routing Middleware, alleen voor de homepage: een AI-agent die om Markdown vraagt
// (Accept: text/markdown) krijgt de winkel als Markdown (api/markdown.js). Alle andere aanvragen gaan
// ongewijzigd door naar index.html. Productpagina's (/poster/...) regelen dit zelf in api/poster.js.
export const config = { matcher: '/' };

export default async function middleware(request) {
  if (!/text\/markdown/i.test(request.headers.get('accept') || '')) return;
  const url = new URL('/api/markdown', request.url);
  const lang = new URL(request.url).searchParams.get('lang');
  if (lang) url.searchParams.set('lang', lang);
  return fetch(url, { headers: { accept: 'text/markdown' } });
}
